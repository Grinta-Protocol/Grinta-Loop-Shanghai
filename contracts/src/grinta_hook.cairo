/// GrintaHook — Ekubo extension that acts as the OracleRelayer
/// Keeper-less: every swap computes GRIT/USDC price from delta, updates collateral price, and tries PID rate
/// Dual throttle: price updates every 60s, rate updates every 3600s (matches PID cooldown)
#[starknet::contract]
pub mod GrintaHook {
    use starknet::storage::{StoragePointerReadAccess, StoragePointerWriteAccess};
    use starknet::{ContractAddress, get_caller_address, get_block_timestamp};
    use core::num::traits::Zero;
    use grinta::types::WAD;
    use grinta::types_ekubo::{PoolKey, SwapParameters, Delta, i129, CALL_POINTS_AFTER_SWAP};
    use grinta::interfaces::isafe_engine::{ISAFEEngineDispatcher, ISAFEEngineDispatcherTrait};
    use grinta::interfaces::ipid_controller::{IPIDControllerDispatcher, IPIDControllerDispatcherTrait};
    use grinta::interfaces::iekubo::{
        IEkuboOracleExtensionDispatcher, IEkuboOracleExtensionDispatcherTrait,
        IEkuboCoreDispatcher, IEkuboCoreDispatcherTrait, CallPoints,
    };

    // Minimum seconds between collateral price updates
    const PRICE_UPDATE_INTERVAL: u64 = 60; // 1 minute

    // Minimum seconds between PID rate updates (matches PID controller cooldown)
    const RATE_UPDATE_INTERVAL: u64 = 3600; // 1 hour

    // Scale factor: USDC has 6 decimals, GRIT has 18 decimals
    // To get price in WAD: |usdc_amount| * 1e(18+18-6) / |grit_amount| = |usdc| * 1e30 / |grit|
    // If reversed: |grit_amount| has 18 dec, USDC has 6 dec
    // price = |usdc| * 1e30 / |grit|  (always, regardless of token ordering)
    const USDC_TO_WAD_SCALE: u256 = 1_000_000_000_000_000_000_000_000_000_000; // 1e30

    #[storage]
    struct Storage {
        admin: ContractAddress,

        // External contracts
        safe_engine: ContractAddress,
        pid_controller: ContractAddress,
        ekubo_oracle: ContractAddress,    // MockEkuboOracle for BTC/USDC
        ekubo_core: ContractAddress,      // Ekubo Core (for set_call_points registration)

        // Token addresses
        grit_token: ContractAddress,       // Grit stablecoin (= SAFEEngine address)
        wbtc_token: ContractAddress,       // WBTC collateral
        usdc_token: ContractAddress,       // USDC quote token

        // Cached prices
        last_market_price: u256,           // Grit/USD price (WAD)
        last_collateral_price: u256,       // BTC/USD price (WAD)

        // Separate throttle timestamps
        last_price_update_time: u64,       // Last collateral price update
        last_rate_update_time: u64,        // Last PID rate update
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    pub enum Event {
        PricesUpdated: PricesUpdated,
        MarketPriceUpdated: MarketPriceUpdated,
        RateUpdated: RateUpdated,
    }

    #[derive(Drop, starknet::Event)]
    pub struct PricesUpdated {
        pub collateral_price: u256,
        pub timestamp: u64,
    }

    #[derive(Drop, starknet::Event)]
    pub struct MarketPriceUpdated {
        pub market_price: u256,
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
        ekubo_core: ContractAddress,
        grit_token: ContractAddress,
        wbtc_token: ContractAddress,
        usdc_token: ContractAddress,
    ) {
        self.admin.write(admin);
        self.safe_engine.write(safe_engine);
        self.pid_controller.write(pid_controller);
        self.ekubo_oracle.write(ekubo_oracle);
        self.ekubo_core.write(ekubo_core);
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

        /// Compute GRIT/USDC price in WAD from swap delta amounts
        /// If pool_key.token0 == grit_token: price = |amount1| * 1e30 / |amount0|
        /// If pool_key.token0 == usdc_token: price = |amount0| * 1e30 / |amount1|
        fn _price_from_delta(self: @ContractState, pool_key: PoolKey, delta: Delta) -> u256 {
            let amount0_mag: u256 = delta.amount0.mag.into();
            let amount1_mag: u256 = delta.amount1.mag.into();

            // Skip if either amount is zero (would divide by zero)
            if amount0_mag == 0 || amount1_mag == 0 {
                return 0;
            }

            let grit = self.grit_token.read();

            if pool_key.token0 == grit {
                // token0 = GRIT (18 dec), token1 = USDC (6 dec)
                // price = usdc_amount * 1e30 / grit_amount → WAD
                amount1_mag * USDC_TO_WAD_SCALE / amount0_mag
            } else {
                // token0 = USDC (6 dec), token1 = GRIT (18 dec)
                // price = usdc_amount * 1e30 / grit_amount → WAD
                amount0_mag * USDC_TO_WAD_SCALE / amount1_mag
            }
        }

        /// Read BTC/USDC from mock oracle, push to SAFEEngine. Throttled to PRICE_UPDATE_INTERVAL.
        fn _update_collateral_price(ref self: ContractState) {
            let now = get_block_timestamp();
            if now - self.last_price_update_time.read() < PRICE_UPDATE_INTERVAL {
                return;
            }

            let oracle = IEkuboOracleExtensionDispatcher {
                contract_address: self.ekubo_oracle.read(),
            };
            // Read BTC/USDC price from mock oracle (admin-set for testnet)
            let btc_price = oracle.get_price_x128_over_last(
                self.wbtc_token.read(), self.usdc_token.read(), 1800,
            );

            // Convert x128 to WAD: price_wad = price_x128 * WAD / 2^128
            let two_pow_128: u256 = 0x100000000000000000000000000000000;
            let btc_price_wad = (btc_price * WAD) / two_pow_128;

            self.last_collateral_price.write(btc_price_wad);
            self.last_price_update_time.write(now);

            let engine = ISAFEEngineDispatcher { contract_address: self.safe_engine.read() };
            engine.update_collateral_price(btc_price_wad);

            self.emit(PricesUpdated { collateral_price: btc_price_wad, timestamp: now });
        }

        /// Try to update PID rate. Only fires if RATE_UPDATE_INTERVAL elapsed AND we have a market price.
        fn _try_update_rate(ref self: ContractState) {
            let now = get_block_timestamp();
            if now - self.last_rate_update_time.read() < RATE_UPDATE_INTERVAL {
                return;
            }

            let market_price = self.last_market_price.read();
            if market_price == 0 {
                return; // No market price yet, skip
            }

            let engine = ISAFEEngineDispatcher { contract_address: self.safe_engine.read() };
            let redemption_price = engine.get_redemption_price();

            let pid = IPIDControllerDispatcher { contract_address: self.pid_controller.read() };
            let new_rate = pid.compute_rate(market_price, redemption_price);

            engine.update_redemption_rate(new_rate);
            self.last_rate_update_time.write(now);

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
        /// Computes GRIT price from the actual swap delta (real market data!)
        /// Then updates collateral price and tries PID rate update
        fn after_swap(
            ref self: ContractState,
            caller: ContractAddress,
            pool_key: PoolKey,
            params: SwapParameters,
            delta: Delta,
        ) {
            // Compute GRIT/USDC price from swap amounts
            let price = self._price_from_delta(pool_key, delta);
            if price > 0 {
                self.last_market_price.write(price);
                let now = get_block_timestamp();
                self.emit(MarketPriceUpdated { market_price: price, timestamp: now });
            }

            // Update collateral price (throttled to 60s)
            self._update_collateral_price();

            // Try PID rate update (throttled to 3600s)
            self._try_update_rate();
        }
    }

    // ========================================================================
    // IGrintaHook — manual interface (called by SafeManager or anyone)
    // ========================================================================

    #[abi(embed_v0)]
    impl GrintaHookImpl of grinta::interfaces::igrinta_hook::IGrintaHook<ContractState> {
        /// Manual update — called by SafeManager before SAFE operations
        /// Uses cached last_market_price for rate updates
        fn update(ref self: ContractState) {
            self._update_collateral_price();
            self._try_update_rate();
        }

        fn get_market_price(self: @ContractState) -> u256 {
            self.last_market_price.read()
        }

        fn get_collateral_price(self: @ContractState) -> u256 {
            self.last_collateral_price.read()
        }

        fn get_last_update_time(self: @ContractState) -> u64 {
            self.last_price_update_time.read()
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

    /// Register this extension's call points with Ekubo Core.
    /// Must be called after deployment so Ekubo knows which hooks to call.
    /// This call comes FROM the extension contract, which is how Ekubo identifies the caller.
    #[external(v0)]
    fn register_extension(ref self: ContractState) {
        self._assert_admin();
        let core_addr = self.ekubo_core.read();
        assert(!core_addr.is_zero(), 'HOOK: ekubo_core not set');
        IEkuboCoreDispatcher { contract_address: core_addr }.set_call_points(
            CallPoints {
                before_initialize_pool: true,
                after_initialize_pool: false,
                before_swap: false,
                after_swap: true,
                before_update_position: false,
                after_update_position: false,
                before_collect_fees: false,
                after_collect_fees: false,
            },
        );
    }
}
