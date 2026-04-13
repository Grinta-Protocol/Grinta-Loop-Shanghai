/// LiquidationEngine — Checks safe health, seizes collateral, starts auctions
/// Permissionless: anyone can call liquidate() on an unhealthy safe
#[starknet::contract]
pub mod LiquidationEngine {
    use starknet::storage::{StoragePointerReadAccess, StoragePointerWriteAccess};
    use starknet::{ContractAddress, get_caller_address};
    use grinta::types::{WAD, wmul, wdiv};
    use grinta::interfaces::isafe_engine::{ISAFEEngineDispatcher, ISAFEEngineDispatcherTrait};
    use grinta::interfaces::icollateral_join::{ICollateralJoinDispatcher, ICollateralJoinDispatcherTrait};
    use grinta::interfaces::icollateral_auction_house::{ICollateralAuctionHouseDispatcher, ICollateralAuctionHouseDispatcherTrait};
    use grinta::interfaces::iaccounting_engine::{IAccountingEngineDispatcher, IAccountingEngineDispatcherTrait};

    #[storage]
    struct Storage {
        admin: ContractAddress,
        safe_engine: ContractAddress,
        collateral_join: ContractAddress,
        auction_house: ContractAddress,
        accounting_engine: ContractAddress,

        // Parameters
        liquidation_penalty: u256,            // WAD (1.13e18 = 13% penalty)
        max_liquidation_quantity: u256,        // Max debt per single liquidation (WAD)
        on_auction_system_debt_limit: u256,    // Global cap on debt being auctioned (WAD)

        // State
        current_on_auction_system_debt: u256,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    pub enum Event {
        Liquidated: Liquidated,
    }

    #[derive(Drop, starknet::Event)]
    pub struct Liquidated {
        #[key] pub safe_id: u64,
        pub debt_to_cover: u256,
        pub collateral_seized: u256,
        pub auction_id: u64,
    }

    #[constructor]
    fn constructor(
        ref self: ContractState,
        admin: ContractAddress,
        safe_engine: ContractAddress,
        collateral_join: ContractAddress,
        auction_house: ContractAddress,
        accounting_engine: ContractAddress,
        liquidation_penalty: u256,
        max_liquidation_quantity: u256,
        on_auction_system_debt_limit: u256,
    ) {
        self.admin.write(admin);
        self.safe_engine.write(safe_engine);
        self.collateral_join.write(collateral_join);
        self.auction_house.write(auction_house);
        self.accounting_engine.write(accounting_engine);
        self.liquidation_penalty.write(liquidation_penalty);
        self.max_liquidation_quantity.write(max_liquidation_quantity);
        self.on_auction_system_debt_limit.write(on_auction_system_debt_limit);
    }

    #[generate_trait]
    impl InternalImpl of InternalTrait {
        fn _assert_admin(self: @ContractState) {
            assert(get_caller_address() == self.admin.read(), 'LIQ: not admin');
        }

        fn _assert_auction_house(self: @ContractState) {
            assert(get_caller_address() == self.auction_house.read(), 'LIQ: not auction house');
        }

        fn _engine(self: @ContractState) -> ISAFEEngineDispatcher {
            ISAFEEngineDispatcher { contract_address: self.safe_engine.read() }
        }

        /// Compute how much debt to cover and collateral to seize for a liquidation.
        /// Returns (debt_to_cover, collateral_to_seize).
        fn _compute_liquidation(self: @ContractState, safe_id: u64) -> (u256, u256) {
            let engine = self._engine();
            let safe = engine.get_safe(safe_id);

            let mut debt_to_cover = safe.debt;

            // Cap at max_liquidation_quantity
            let max_q = self.max_liquidation_quantity.read();
            if debt_to_cover > max_q {
                debt_to_cover = max_q;
            }

            // Cap at remaining auction capacity
            let current_on_auction = self.current_on_auction_system_debt.read();
            let limit = self.on_auction_system_debt_limit.read();
            if current_on_auction >= limit {
                return (0, 0); // No capacity
            }
            let remaining_capacity = limit - current_on_auction;
            if debt_to_cover > remaining_capacity {
                debt_to_cover = remaining_capacity;
            }

            // Compute proportional collateral to seize
            let collateral_to_seize = if debt_to_cover == safe.debt {
                safe.collateral // Full liquidation: seize all
            } else {
                // Partial: proportional
                // collateral_to_seize = (debt_to_cover / safe.debt) * safe.collateral
                wdiv(wmul(debt_to_cover, safe.collateral), safe.debt)
            };

            (debt_to_cover, collateral_to_seize)
        }
    }

    #[abi(embed_v0)]
    impl LiquidationEngineImpl of grinta::interfaces::iliquidation_engine::ILiquidationEngine<ContractState> {
        fn liquidate(ref self: ContractState, safe_id: u64) -> u64 {
            let engine = self._engine();

            // 1. Check safe is unhealthy
            let liq_ratio = engine.get_liquidation_ratio();
            // Safe is unhealthy if col_value < debt_usd * liq_ratio
            // We use the existing health check: if LTV * liq_ratio >= WAD, it's unhealthy
            // Actually, we need to re-derive: healthy = col_value * WAD >= debt_usd * liq_ratio
            // debt_usd is computed with redemption_price. Let's just read safe and check directly.
            let safe = engine.get_safe(safe_id);
            assert(safe.debt > 0, 'LIQ: no debt');

            let col_price = engine.get_collateral_price();
            let col_value = wmul(safe.collateral, col_price);
            let redemption_price_ray = engine.get_redemption_price();
            let debt_ray = safe.debt * 1_000_000_000; // WAD -> RAY
            let debt_usd_ray = (debt_ray * redemption_price_ray + 500_000_000_000_000_000_000_000_000) / 1_000_000_000_000_000_000_000_000_000;
            let debt_usd = debt_usd_ray / 1_000_000_000; // RAY -> WAD

            // Unhealthy if col_value * WAD < debt_usd * liq_ratio
            assert(col_value * WAD < debt_usd * liq_ratio, 'LIQ: safe is healthy');

            // 2. Compute amounts
            let (debt_to_cover, collateral_to_seize) = self._compute_liquidation(safe_id);
            assert(debt_to_cover > 0, 'LIQ: auction capacity full');
            assert(collateral_to_seize > 0, 'LIQ: zero collateral');

            // 3. Confiscate from SAFEEngine
            engine.confiscate(safe_id, collateral_to_seize, debt_to_cover);

            // 4. Move collateral from CollateralJoin to AuctionHouse
            let join = ICollateralJoinDispatcher { contract_address: self.collateral_join.read() };
            join.seize(self.auction_house.read(), collateral_to_seize);

            // 5. Push debt to AccountingEngine
            let ae = IAccountingEngineDispatcher { contract_address: self.accounting_engine.read() };
            ae.push_debt(debt_to_cover);

            // 6. Start auction with penalty
            let auction_debt = wmul(debt_to_cover, self.liquidation_penalty.read());
            let safe_owner = engine.get_safe_owner(safe_id);
            let ah = ICollateralAuctionHouseDispatcher { contract_address: self.auction_house.read() };
            let auction_id = ah.start_auction(collateral_to_seize, auction_debt, safe_owner);

            // 7. Update on-auction tracking
            self.current_on_auction_system_debt.write(
                self.current_on_auction_system_debt.read() + debt_to_cover,
            );

            self.emit(Liquidated { safe_id, debt_to_cover, collateral_seized: collateral_to_seize, auction_id });

            auction_id
        }

        fn preview_liquidation(self: @ContractState, safe_id: u64) -> (u256, u256) {
            self._compute_liquidation(safe_id)
        }

        fn is_liquidatable(self: @ContractState, safe_id: u64) -> bool {
            let engine = self._engine();
            let safe = engine.get_safe(safe_id);
            if safe.debt == 0 {
                return false;
            }

            let col_price = engine.get_collateral_price();
            let col_value = wmul(safe.collateral, col_price);
            let liq_ratio = engine.get_liquidation_ratio();
            let redemption_price_ray = engine.get_redemption_price();
            let debt_ray = safe.debt * 1_000_000_000;
            let debt_usd_ray = (debt_ray * redemption_price_ray + 500_000_000_000_000_000_000_000_000) / 1_000_000_000_000_000_000_000_000_000;
            let debt_usd = debt_usd_ray / 1_000_000_000;

            col_value * WAD < debt_usd * liq_ratio
        }

        fn remove_coins_from_auction(ref self: ContractState, amount: u256) {
            self._assert_auction_house();
            let current = self.current_on_auction_system_debt.read();
            if amount > current {
                self.current_on_auction_system_debt.write(0);
            } else {
                self.current_on_auction_system_debt.write(current - amount);
            }
        }

        // ---- Getters ----

        fn get_liquidation_penalty(self: @ContractState) -> u256 {
            self.liquidation_penalty.read()
        }

        fn get_max_liquidation_quantity(self: @ContractState) -> u256 {
            self.max_liquidation_quantity.read()
        }

        fn get_on_auction_system_debt_limit(self: @ContractState) -> u256 {
            self.on_auction_system_debt_limit.read()
        }

        fn get_current_on_auction_system_debt(self: @ContractState) -> u256 {
            self.current_on_auction_system_debt.read()
        }

        // ---- Admin ----

        fn set_auction_house(ref self: ContractState, auction_house: ContractAddress) {
            self._assert_admin();
            self.auction_house.write(auction_house);
        }

        fn set_liquidation_penalty(ref self: ContractState, penalty: u256) {
            self._assert_admin();
            self.liquidation_penalty.write(penalty);
        }

        fn set_max_liquidation_quantity(ref self: ContractState, quantity: u256) {
            self._assert_admin();
            self.max_liquidation_quantity.write(quantity);
        }

        fn set_on_auction_system_debt_limit(ref self: ContractState, limit: u256) {
            self._assert_admin();
            self.on_auction_system_debt_limit.write(limit);
        }
    }
}
