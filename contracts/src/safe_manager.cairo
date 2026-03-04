/// SafeManager — User and agent-facing safe management
/// Handles open/close/deposit/withdraw/borrow/repay
/// Agent-friendly: single-call operations, delegation, rich views
/// Keeper-less: calls hook.update() before every SAFE operation that needs fresh prices
#[starknet::contract]
pub mod SafeManager {
    use starknet::storage::{Map, StorageMapReadAccess, StorageMapWriteAccess, StoragePointerReadAccess, StoragePointerWriteAccess};
    use starknet::{ContractAddress, get_caller_address};
    use core::num::traits::Zero;
    use grinta::types::{Health, wmul, wdiv};
    use grinta::interfaces::isafe_engine::{ISAFEEngineDispatcher, ISAFEEngineDispatcherTrait};
    use grinta::interfaces::icollateral_join::{ICollateralJoinDispatcher, ICollateralJoinDispatcherTrait};
    use grinta::interfaces::igrinta_hook::{IGrintaHookDispatcher, IGrintaHookDispatcherTrait};

    #[storage]
    struct Storage {
        admin: ContractAddress,
        safe_engine: ContractAddress,
        collateral_join: ContractAddress,
        hook: ContractAddress,
        // Agent delegation: (safe_id, agent_address) -> authorized
        agents: Map<(u64, ContractAddress), bool>,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    pub enum Event {
        SafeOpened: SafeOpened,
        SafeClosed: SafeClosed,
        AgentAuthorized: AgentAuthorized,
        AgentRevoked: AgentRevoked,
    }

    #[derive(Drop, starknet::Event)]
    pub struct SafeOpened { #[key] pub safe_id: u64, pub owner: ContractAddress }
    #[derive(Drop, starknet::Event)]
    pub struct SafeClosed { #[key] pub safe_id: u64 }
    #[derive(Drop, starknet::Event)]
    pub struct AgentAuthorized { #[key] pub safe_id: u64, pub agent: ContractAddress }
    #[derive(Drop, starknet::Event)]
    pub struct AgentRevoked { #[key] pub safe_id: u64, pub agent: ContractAddress }

    #[constructor]
    fn constructor(
        ref self: ContractState,
        admin: ContractAddress,
        safe_engine: ContractAddress,
        collateral_join: ContractAddress,
        hook: ContractAddress,
    ) {
        self.admin.write(admin);
        self.safe_engine.write(safe_engine);
        self.collateral_join.write(collateral_join);
        self.hook.write(hook);
    }

    #[generate_trait]
    impl InternalImpl of InternalTrait {
        fn _assert_admin(self: @ContractState) {
            assert(get_caller_address() == self.admin.read(), 'MGR: not admin');
        }

        fn _assert_authorized(self: @ContractState, safe_id: u64) {
            let caller = get_caller_address();
            let engine = ISAFEEngineDispatcher { contract_address: self.safe_engine.read() };
            let owner = engine.get_safe_owner(safe_id);
            let is_owner = caller == owner;
            let is_agent = self.agents.read((safe_id, caller));
            assert(is_owner || is_agent, 'MGR: not authorized');
        }

        fn _engine(self: @ContractState) -> ISAFEEngineDispatcher {
            ISAFEEngineDispatcher { contract_address: self.safe_engine.read() }
        }

        fn _join(self: @ContractState) -> ICollateralJoinDispatcher {
            ICollateralJoinDispatcher { contract_address: self.collateral_join.read() }
        }

        /// Call hook.update() to refresh prices before SAFE operations
        fn _update_prices(ref self: ContractState) {
            let hook_addr = self.hook.read();
            if !hook_addr.is_zero() {
                IGrintaHookDispatcher { contract_address: hook_addr }.update();
            }
        }
    }

    #[abi(embed_v0)]
    impl SafeManagerImpl of grinta::interfaces::isafe_manager::ISafeManager<ContractState> {
        fn open_safe(ref self: ContractState) -> u64 {
            let caller = get_caller_address();
            let engine = self._engine();
            let safe_id = engine.create_safe(caller);
            self.emit(SafeOpened { safe_id, owner: caller });
            safe_id
        }

        fn close_safe(ref self: ContractState, safe_id: u64) {
            self._update_prices();
            self._assert_authorized(safe_id);
            let engine = self._engine();
            let safe = engine.get_safe(safe_id);
            assert(safe.debt == 0, 'MGR: safe has debt');
            if safe.collateral > 0 {
                engine.withdraw_collateral(safe_id, safe.collateral);
                let caller = get_caller_address();
                let join = self._join();
                join.exit(caller, safe.collateral);
            }
            self.emit(SafeClosed { safe_id });
        }

        fn deposit(ref self: ContractState, safe_id: u64, amount: u256) {
            self._update_prices();
            self._assert_authorized(safe_id);
            let caller = get_caller_address();
            let join = self._join();
            let internal_amount = join.join(caller, amount);
            let engine = self._engine();
            engine.deposit_collateral(safe_id, internal_amount);
        }

        fn withdraw(ref self: ContractState, safe_id: u64, amount: u256) {
            self._update_prices();
            self._assert_authorized(safe_id);
            let caller = get_caller_address();
            let engine = self._engine();
            engine.withdraw_collateral(safe_id, amount);
            let join = self._join();
            join.exit(caller, amount);
        }

        fn borrow(ref self: ContractState, safe_id: u64, amount: u256) {
            self._update_prices();
            self._assert_authorized(safe_id);
            let engine = self._engine();
            engine.borrow(safe_id, amount);
        }

        fn repay(ref self: ContractState, safe_id: u64, amount: u256) {
            self._update_prices();
            self._assert_authorized(safe_id);
            let engine = self._engine();
            engine.repay(safe_id, amount);
        }

        /// Open a safe, deposit collateral, and borrow in one transaction
        fn open_and_borrow(
            ref self: ContractState, collateral_amount: u256, borrow_amount: u256,
        ) -> u64 {
            self._update_prices();
            let caller = get_caller_address();
            let engine = self._engine();
            let join = self._join();

            let safe_id = engine.create_safe(caller);
            let internal_amount = join.join(caller, collateral_amount);
            engine.deposit_collateral(safe_id, internal_amount);
            engine.borrow(safe_id, borrow_amount);

            self.emit(SafeOpened { safe_id, owner: caller });
            safe_id
        }

        fn get_position_health(self: @ContractState, safe_id: u64) -> Health {
            let engine = self._engine();
            engine.get_safe_health(safe_id)
        }

        fn get_max_borrow(self: @ContractState, safe_id: u64) -> u256 {
            let engine = self._engine();
            let safe = engine.get_safe(safe_id);
            let col_price = engine.get_collateral_price();
            let col_value = wmul(safe.collateral, col_price);
            let liq_ratio = engine.get_liquidation_ratio();
            let max_debt_usd = wdiv(col_value, liq_ratio);

            let r_price = engine.get_redemption_price();
            let r_price_wad = r_price / 1_000_000_000; // RAY -> WAD
            let max_grit = if r_price_wad > 0 { wdiv(max_debt_usd, r_price_wad) } else { 0 };
            if max_grit > safe.debt { max_grit - safe.debt } else { 0 }
        }

        fn get_safe_owner(self: @ContractState, safe_id: u64) -> ContractAddress {
            let engine = self._engine();
            engine.get_safe_owner(safe_id)
        }

        fn authorize_agent(ref self: ContractState, safe_id: u64, agent: ContractAddress) {
            let caller = get_caller_address();
            let engine = self._engine();
            assert(caller == engine.get_safe_owner(safe_id), 'MGR: only owner can delegate');
            self.agents.write((safe_id, agent), true);
            self.emit(AgentAuthorized { safe_id, agent });
        }

        fn revoke_agent(ref self: ContractState, safe_id: u64, agent: ContractAddress) {
            let caller = get_caller_address();
            let engine = self._engine();
            assert(caller == engine.get_safe_owner(safe_id), 'MGR: only owner can revoke');
            self.agents.write((safe_id, agent), false);
            self.emit(AgentRevoked { safe_id, agent });
        }

        fn is_authorized(self: @ContractState, safe_id: u64, agent: ContractAddress) -> bool {
            self.agents.read((safe_id, agent))
        }
    }

    #[external(v0)]
    fn set_hook(ref self: ContractState, hook: ContractAddress) {
        self._assert_admin();
        self.hook.write(hook);
    }
}
