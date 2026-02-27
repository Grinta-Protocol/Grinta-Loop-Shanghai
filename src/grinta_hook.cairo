/// GrintaHook — Ekubo extension that acts as the OracleRelayer
/// Triggers on every Grit/USDC swap to update collateral price, market price, and redemption rate
/// Also exposes a manual update() fallback for when there's no trading activity
#[starknet::contract]
pub mod GrintaHook {
    use starknet::storage::{StoragePointerReadAccess, StoragePointerWriteAccess};
    use starknet::{ContractAddress, get_caller_address, get_block_timestamp};
    use grinta::types::WAD;
    use grinta::types_ekubo::{PoolKey, SwapParameters, Delta, i129, CALL_POINTS_AFTER_SWAP};
    use grinta::interfaces::isafe_engine::{ISAFEEngineDispatcher, ISAFEEngineDispatcherTrait};
    use grinta::interfaces::ipid_controller::{IPIDControllerDispatcher, IPIDControllerDispatcherTrait};
    use grinta::interfaces::iekubo::{IEkuboOracleExtensionDispatcher, IEkuboOracleExtensionDispatcherTrait};

    // Minimum seconds between rate updates to prevent spam
    const MIN_UPDATE_INTERVAL: u64 = 60; // 1 minute

    // TWAP period for price reads (seconds)
    const TWAP_PERIOD: u64 = 1800; // 30 minutes

    // 2^128 for converting Ekubo x128 prices
    const TWO_POW_128: u256 = 0x100000000000000000000000000000000;

    #[storage]
    struct Storage {
        admin: ContractAddress,

        // External contracts
        safe_engine: ContractAddress,
        pid_controller: ContractAddress,
        ekubo_oracle: ContractAddress,    // Ekubo's deployed oracle extension

        // Token addresses for price lookups
        grit_token: ContractAddress,       // Grit stablecoin (= SAFEEngine address)
        wbtc_token: ContractAddress,       // WBTC collateral
        usdc_token: ContractAddress,       // USDC quote token

        // Cached prices
        last_market_price: u256,           // Grit/USD price (WAD)
        last_collateral_price: u256,       // BTC/USD price (WAD)
        last_update_time: u64,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    pub enum Event {
        PricesUpdated: PricesUpdated,
        RateUpdated: RateUpdated,
    }

    #[derive(Drop, starknet::Event)]
    pub struct PricesUpdated {
        pub market_price: u256,
        pub collateral_price: u256,
        pub timestamp: u64,
    }

    #[derive(Drop, starknet::Event)]
    pub struct RateUpdated {
        pub new_rate: u256,
        pub timestamp: u64,
    }

    #[constructor]
    fn constructor(
        ref self: ContractState,
        admin: ContractAddress,
        safe_engine: ContractAddress,
        pid_controller: ContractAddress,
        ekubo_oracle: ContractAddress,
        grit_token: ContractAddress,
        wbtc_token: ContractAddress,
        usdc_token: ContractAddress,
    ) {
        self.admin.write(admin);
        self.safe_engine.write(safe_engine);
        self.pid_controller.write(pid_controller);
        self.ekubo_oracle.write(ekubo_oracle);
        self.grit_token.write(grit_token);
        self.wbtc_token.write(wbtc_token);
        self.usdc_token.write(usdc_token);
    }

    // ========================================================================
    // Internal
    // ========================================================================

    #[generate_trait]
    impl InternalImpl of InternalTrait {
        fn _assert_admin(self: @ContractState) {
            assert(get_caller_address() == self.admin.read(), 'HOOK: not admin');
        }

        /// Read TWAP from Ekubo oracle extension and convert from x128 to WAD
        fn _read_twap(
            self: @ContractState, base_token: ContractAddress, quote_token: ContractAddress,
        ) -> u256 {
            let oracle = IEkuboOracleExtensionDispatcher {
                contract_address: self.ekubo_oracle.read(),
            };
            let price_x128 = oracle.get_price_x128_over_last(base_token, quote_token, TWAP_PERIOD);

            // Convert x128 fixed point to WAD (18 decimals)
            // price_wad = price_x128 * WAD / 2^128
            // But we also need to account for decimal differences:
            // USDC has 6 decimals, WBTC has 8 decimals
            // The x128 price is base/quote in raw token units
            // We want the price in WAD (18 decimals)
            (price_x128 * WAD) / TWO_POW_128
        }

        /// Core update logic: read prices, compute PID rate, push to SAFEEngine
        fn _do_update(ref self: ContractState) {
            let now = get_block_timestamp();

            // Throttle: skip if updated too recently
            if now - self.last_update_time.read() < MIN_UPDATE_INTERVAL {
                return;
            }

            // 1. Read BTC/USDC TWAP from Ekubo → collateral price
            let btc_price = self._read_twap(self.wbtc_token.read(), self.usdc_token.read());

            // 2. Read Grit/USDC TWAP from Ekubo → market price
            let grit_price = self._read_twap(self.grit_token.read(), self.usdc_token.read());

            // Store cached prices
            self.last_collateral_price.write(btc_price);
            self.last_market_price.write(grit_price);
            self.last_update_time.write(now);
            self.emit(PricesUpdated { market_price: grit_price, collateral_price: btc_price, timestamp: now });

            let engine = ISAFEEngineDispatcher { contract_address: self.safe_engine.read() };

            // 3. Update collateral price in SAFEEngine
            engine.update_collateral_price(btc_price);

            // 4. Get current redemption price from SAFEEngine
            let redemption_price = engine.get_redemption_price();

            // 5. Compute new rate via PID controller
            let pid = IPIDControllerDispatcher { contract_address: self.pid_controller.read() };
            let new_rate = pid.compute_rate(grit_price, redemption_price);

            // 6. Push new rate to SAFEEngine
            engine.update_redemption_rate(new_rate);

            self.emit(RateUpdated { new_rate, timestamp: now });
        }
    }

    // ========================================================================
    // Ekubo IExtension implementation
    // ========================================================================

    #[abi(embed_v0)]
    impl ExtensionImpl of grinta::interfaces::igrinta_hook::IExtension<ContractState> {
        /// Called when pool is initialized — we request only after_swap callbacks
        fn before_initialize_pool(
            ref self: ContractState,
            caller: ContractAddress,
            pool_key: PoolKey,
            initial_tick: i129,
        ) -> u16 {
            // Return call points: we only want after_swap
            CALL_POINTS_AFTER_SWAP
        }

        fn after_initialize_pool(
            ref self: ContractState,
            caller: ContractAddress,
            pool_key: PoolKey,
            initial_tick: i129,
        ) {
            // No-op
        }

        fn before_swap(
            ref self: ContractState,
            caller: ContractAddress,
            pool_key: PoolKey,
            params: SwapParameters,
        ) {
            // No-op
        }

        /// THE KEY HOOK: fires after every swap on the Grit/USDC pool
        /// Every trader automatically triggers a rate update
        fn after_swap(
            ref self: ContractState,
            caller: ContractAddress,
            pool_key: PoolKey,
            params: SwapParameters,
            delta: Delta,
        ) {
            // Update prices and rates
            self._do_update();
        }
    }

    // ========================================================================
    // IGrintaHook — manual interface
    // ========================================================================

    #[abi(embed_v0)]
    impl GrintaHookImpl of grinta::interfaces::igrinta_hook::IGrintaHook<ContractState> {
        /// Manual update — anyone can call this when there's no trading activity
        fn update(ref self: ContractState) {
            self._do_update();
        }

        fn get_market_price(self: @ContractState) -> u256 {
            self.last_market_price.read()
        }

        fn get_collateral_price(self: @ContractState) -> u256 {
            self.last_collateral_price.read()
        }

        fn get_last_update_time(self: @ContractState) -> u64 {
            self.last_update_time.read()
        }
    }

    // ========================================================================
    // Admin
    // ========================================================================

    #[external(v0)]
    fn set_safe_engine(ref self: ContractState, engine: ContractAddress) {
        self._assert_admin();
        self.safe_engine.write(engine);
    }

    #[external(v0)]
    fn set_pid_controller(ref self: ContractState, controller: ContractAddress) {
        self._assert_admin();
        self.pid_controller.write(controller);
    }

    #[external(v0)]
    fn set_ekubo_oracle(ref self: ContractState, oracle: ContractAddress) {
        self._assert_admin();
        self.ekubo_oracle.write(oracle);
    }
}
