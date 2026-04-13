/// AccountingEngine — System balance sheet for debt and surplus tracking
/// Receives bad debt from LiquidationEngine, surplus from CollateralAuctionHouse
/// Settles debt against surplus by burning GRIT via SAFEEngine
#[starknet::contract]
pub mod AccountingEngine {
    use starknet::storage::{StoragePointerReadAccess, StoragePointerWriteAccess};
    use starknet::{ContractAddress, get_caller_address, get_contract_address};
    use grinta::interfaces::isafe_engine::{ISAFEEngineDispatcher, ISAFEEngineDispatcherTrait};

    #[storage]
    struct Storage {
        admin: ContractAddress,
        safe_engine: ContractAddress,
        liquidation_engine: ContractAddress,
        auction_house: ContractAddress,

        // Debt tracking
        total_queued_debt: u256,
        // Surplus tracking
        surplus_balance: u256,
        // Settlement
        total_settled_debt: u256,
        unresolved_deficit: u256,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    pub enum Event {
        DebtPushed: DebtPushed,
        SurplusReceived: SurplusReceived,
        DebtSettled: DebtSettled,
        DeficitMarked: DeficitMarked,
    }

    #[derive(Drop, starknet::Event)]
    pub struct DebtPushed { pub amount: u256 }
    #[derive(Drop, starknet::Event)]
    pub struct SurplusReceived { pub amount: u256 }
    #[derive(Drop, starknet::Event)]
    pub struct DebtSettled { pub amount: u256, pub remaining_debt: u256, pub remaining_surplus: u256 }
    #[derive(Drop, starknet::Event)]
    pub struct DeficitMarked { pub amount: u256 }

    #[constructor]
    fn constructor(
        ref self: ContractState,
        admin: ContractAddress,
        safe_engine: ContractAddress,
    ) {
        self.admin.write(admin);
        self.safe_engine.write(safe_engine);
    }

    #[generate_trait]
    impl InternalImpl of InternalTrait {
        fn _assert_admin(self: @ContractState) {
            assert(get_caller_address() == self.admin.read(), 'ACC: not admin');
        }

        fn _assert_liquidation_engine(self: @ContractState) {
            assert(get_caller_address() == self.liquidation_engine.read(), 'ACC: not liq engine');
        }

        fn _assert_auction_house(self: @ContractState) {
            assert(get_caller_address() == self.auction_house.read(), 'ACC: not auction house');
        }
    }

    #[abi(embed_v0)]
    impl AccountingEngineImpl of grinta::interfaces::iaccounting_engine::IAccountingEngine<ContractState> {
        fn push_debt(ref self: ContractState, amount: u256) {
            self._assert_liquidation_engine();
            let current = self.total_queued_debt.read();
            self.total_queued_debt.write(current + amount);
            self.emit(DebtPushed { amount });
        }

        fn receive_surplus(ref self: ContractState, amount: u256) {
            self._assert_auction_house();
            let current = self.surplus_balance.read();
            self.surplus_balance.write(current + amount);
            self.emit(SurplusReceived { amount });
        }

        fn settle_debt(ref self: ContractState) -> u256 {
            let surplus = self.surplus_balance.read();
            let debt = self.total_queued_debt.read();

            if surplus == 0 || debt == 0 {
                return 0;
            }

            let amount_to_settle = if surplus < debt { surplus } else { debt };

            // Update accounting BEFORE external call (checks-effects-interactions)
            self.surplus_balance.write(surplus - amount_to_settle);
            self.total_queued_debt.write(debt - amount_to_settle);
            self.total_settled_debt.write(self.total_settled_debt.read() + amount_to_settle);

            // Burn the settled GRIT from this contract's balance
            let engine = ISAFEEngineDispatcher { contract_address: self.safe_engine.read() };
            engine.burn_system_coins(get_contract_address(), amount_to_settle);

            self.emit(DebtSettled {
                amount: amount_to_settle,
                remaining_debt: debt - amount_to_settle,
                remaining_surplus: surplus - amount_to_settle,
            });

            amount_to_settle
        }

        fn mark_deficit(ref self: ContractState, amount: u256) {
            self._assert_admin();
            let debt = self.total_queued_debt.read();
            assert(amount <= debt, 'ACC: deficit exceeds debt');
            self.total_queued_debt.write(debt - amount);
            self.unresolved_deficit.write(self.unresolved_deficit.read() + amount);
            self.emit(DeficitMarked { amount });
        }

        // ---- Getters ----

        fn get_total_queued_debt(self: @ContractState) -> u256 {
            self.total_queued_debt.read()
        }

        fn get_surplus_balance(self: @ContractState) -> u256 {
            self.surplus_balance.read()
        }

        fn get_total_settled_debt(self: @ContractState) -> u256 {
            self.total_settled_debt.read()
        }

        fn get_unresolved_deficit(self: @ContractState) -> u256 {
            self.unresolved_deficit.read()
        }

        // ---- Admin ----

        fn set_liquidation_engine(ref self: ContractState, engine: ContractAddress) {
            self._assert_admin();
            self.liquidation_engine.write(engine);
        }

        fn set_auction_house(ref self: ContractState, auction: ContractAddress) {
            self._assert_admin();
            self.auction_house.write(auction);
        }
    }
}
