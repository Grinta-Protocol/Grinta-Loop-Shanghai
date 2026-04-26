/// ParameterGuard — Bounded parameter governance for PIDController
/// Allows an ERC-8004 registered agent to modify Kp/Ki within safe bounds
/// defined by a human admin.
///
/// Identity model: the proposer's wallet must be the SNIP-6 bound wallet of
/// a live NFT in the configured ERC-8004 IdentityRegistry. The registry is
/// the single source of truth for "who is the agent" — there is no local
/// agent storage. To rotate the agent, admin updates `proposer_agent_id`
/// (or rotates the NFT's wallet binding via the registry directly).
///
/// Enforcement layers:
///   1. Identity: ERC-8004 wallet-binding check (`get_agent_wallet == caller`)
///   2. Bounds: new values within absolute min/max AND per-call delta cap
///   3. Rate limit: cooldown + call budget
///
/// PDR (Policy Decision Record) events emitted for every action.
#[starknet::contract]
pub mod ParameterGuard {
    use starknet::storage::{StoragePointerReadAccess, StoragePointerWriteAccess};
    use starknet::{ContractAddress, get_caller_address, get_block_timestamp};
    use core::num::traits::Zero;
    use grinta::types::AgentPolicy;
    use grinta::interfaces::ipid_controller::{IPIDControllerDispatcher, IPIDControllerDispatcherTrait};
    use grinta::interfaces::iidentity_registry::{IIdentityRegistryDispatcher, IIdentityRegistryDispatcherTrait};

    #[storage]
    struct Storage {
        admin: ContractAddress,
        pid_controller: ContractAddress,
        // ERC-8004 identity — mandatory, set in constructor, rotatable by admin
        identity_registry: ContractAddress,
        proposer_agent_id: u256,
        // Policy bounds
        policy_kp_min: i128,
        policy_kp_max: i128,
        policy_ki_min: i128,
        policy_ki_max: i128,
        policy_max_kp_delta: u128,
        policy_max_ki_delta: u128,
        policy_cooldown_seconds: u64,
        policy_emergency_cooldown_seconds: u64,
        policy_max_updates: u32,
        // State
        stopped: bool,
        update_count: u32,
        last_update_timestamp: u64,
    }

    // ========================================================================
    // Events — PDR (Policy Decision Record) pattern
    // ========================================================================

    #[event]
    #[derive(Drop, starknet::Event)]
    pub enum Event {
        ParameterUpdate: ParameterUpdate,
        EmergencyStop: EmergencyStop,
        Resumed: Resumed,
        PolicyUpdated: PolicyUpdated,
        ProposalAttributed: ProposalAttributed,
        IdentityConfigured: IdentityConfigured,
    }

    #[derive(Drop, starknet::Event)]
    pub struct ParameterUpdate {
        #[key]
        pub agent: ContractAddress,
        pub old_kp: i128,
        pub new_kp: i128,
        pub old_ki: i128,
        pub new_ki: i128,
        pub update_number: u32,
        pub emergency_mode: bool,
        pub timestamp: u64,
    }

    #[derive(Drop, starknet::Event)]
    pub struct EmergencyStop {
        #[key]
        pub admin: ContractAddress,
        pub timestamp: u64,
    }

    #[derive(Drop, starknet::Event)]
    pub struct Resumed {
        #[key]
        pub admin: ContractAddress,
        pub timestamp: u64,
    }

    #[derive(Drop, starknet::Event)]
    pub struct PolicyUpdated {
        #[key]
        pub admin: ContractAddress,
        pub timestamp: u64,
    }

    /// Emitted on every successful proposal, binding the action to its
    /// on-chain ERC-8004 identity. Indexers (The Graph, Voyager) key on
    /// agent_id to build per-agent feeds.
    #[derive(Drop, starknet::Event)]
    pub struct ProposalAttributed {
        #[key]
        pub agent_id: u256,
        #[key]
        pub caller: ContractAddress,
        pub new_kp: i128,
        pub new_ki: i128,
        pub is_emergency: bool,
        pub timestamp: u64,
    }

    /// Emitted when admin rotates either the registry pointer or the
    /// proposer agent_id. Snapshots both fields so a single stream
    /// captures every config transition.
    #[derive(Drop, starknet::Event)]
    pub struct IdentityConfigured {
        #[key]
        pub admin: ContractAddress,
        pub identity_registry: ContractAddress,
        pub proposer_agent_id: u256,
        pub timestamp: u64,
    }

    // ========================================================================
    // Constructor
    // ========================================================================

    #[constructor]
    fn constructor(
        ref self: ContractState,
        admin: ContractAddress,
        pid_controller: ContractAddress,
        identity_registry: ContractAddress,
        proposer_agent_id: u256,
        policy: AgentPolicy,
    ) {
        assert(!admin.is_zero(), 'GUARD: admin is zero');
        assert(!pid_controller.is_zero(), 'GUARD: pid is zero');
        assert(!identity_registry.is_zero(), 'GUARD: registry is zero');
        assert(proposer_agent_id != 0, 'GUARD: agent_id is zero');

        self.admin.write(admin);
        self.pid_controller.write(pid_controller);
        self.identity_registry.write(identity_registry);
        self.proposer_agent_id.write(proposer_agent_id);
        self._write_policy(policy);
        self.stopped.write(false);
        self.update_count.write(0);
        self.last_update_timestamp.write(0);
    }

    // ========================================================================
    // Internal helpers
    // ========================================================================

    #[generate_trait]
    impl InternalImpl of InternalTrait {
        fn _assert_admin(self: @ContractState) {
            assert(get_caller_address() == self.admin.read(), 'GUARD: not admin');
        }

        /// Authorize the caller via ERC-8004 wallet binding. The registry
        /// returns the SNIP-6 bound wallet for the configured agent_id;
        /// caller must match. Zero-wallet (no binding set, or NFT
        /// transferred without re-binding) is rejected.
        fn _assert_agent(self: @ContractState) {
            let registry = IIdentityRegistryDispatcher {
                contract_address: self.identity_registry.read(),
            };
            let bound = registry.get_agent_wallet(self.proposer_agent_id.read());
            assert(!bound.is_zero(), 'GUARD: NFT not bound');
            assert(bound == get_caller_address(), 'GUARD: not bound wallet');
        }

        fn _pid(self: @ContractState) -> IPIDControllerDispatcher {
            IPIDControllerDispatcher { contract_address: self.pid_controller.read() }
        }

        fn _write_policy(ref self: ContractState, p: AgentPolicy) {
            // Validate policy coherence
            assert(p.kp_min <= p.kp_max, 'GUARD: kp_min > kp_max');
            assert(p.ki_min <= p.ki_max, 'GUARD: ki_min > ki_max');
            assert(
                p.emergency_cooldown_seconds <= p.cooldown_seconds,
                'GUARD: emg_cd > normal_cd',
            );

            self.policy_kp_min.write(p.kp_min);
            self.policy_kp_max.write(p.kp_max);
            self.policy_ki_min.write(p.ki_min);
            self.policy_ki_max.write(p.ki_max);
            self.policy_max_kp_delta.write(p.max_kp_delta);
            self.policy_max_ki_delta.write(p.max_ki_delta);
            self.policy_cooldown_seconds.write(p.cooldown_seconds);
            self.policy_emergency_cooldown_seconds.write(p.emergency_cooldown_seconds);
            self.policy_max_updates.write(p.max_updates);
        }

        fn _read_policy(self: @ContractState) -> AgentPolicy {
            AgentPolicy {
                kp_min: self.policy_kp_min.read(),
                kp_max: self.policy_kp_max.read(),
                ki_min: self.policy_ki_min.read(),
                ki_max: self.policy_ki_max.read(),
                max_kp_delta: self.policy_max_kp_delta.read(),
                max_ki_delta: self.policy_max_ki_delta.read(),
                cooldown_seconds: self.policy_cooldown_seconds.read(),
                emergency_cooldown_seconds: self.policy_emergency_cooldown_seconds.read(),
                max_updates: self.policy_max_updates.read(),
            }
        }

        /// Compute |a - b| as u128, safe for i128 values
        fn _abs_diff(self: @ContractState, a: i128, b: i128) -> u128 {
            let diff = a - b;
            if diff < 0 {
                let neg: u128 = (-diff).try_into().unwrap();
                neg
            } else {
                diff.try_into().unwrap()
            }
        }

        fn _emit_identity_configured(ref self: ContractState) {
            self.emit(IdentityConfigured {
                admin: get_caller_address(),
                identity_registry: self.identity_registry.read(),
                proposer_agent_id: self.proposer_agent_id.read(),
                timestamp: get_block_timestamp(),
            });
        }
    }

    // ========================================================================
    // Agent functions
    // ========================================================================

    #[external(v0)]
    fn propose_parameters(ref self: ContractState, new_kp: i128, new_ki: i128, is_emergency: bool) {
        // Layer 1: Identity — ERC-8004 wallet binding
        self._assert_agent();
        assert(!self.stopped.read(), 'GUARD: stopped');

        // Layer 3: Rate limit — budget
        let count = self.update_count.read();
        let max = self.policy_max_updates.read();
        if max > 0 {
            assert(count < max, 'GUARD: budget exhausted');
        }

        // Layer 3: Rate limit — two-tier cooldown
        // Agent declares emergency → shorter cooldown (for off-chain crash detection)
        // Otherwise → normal cooldown
        let now = get_block_timestamp();
        let last = self.last_update_timestamp.read();
        let emergency_mode = is_emergency;

        if last > 0 {
            let cooldown = if is_emergency {
                self.policy_emergency_cooldown_seconds.read()
            } else {
                self.policy_cooldown_seconds.read()
            };
            assert(now >= last + cooldown, 'GUARD: cooldown active');
        }

        // Layer 2: Absolute bounds
        assert(new_kp >= self.policy_kp_min.read(), 'GUARD: kp below min');
        assert(new_kp <= self.policy_kp_max.read(), 'GUARD: kp above max');
        assert(new_ki >= self.policy_ki_min.read(), 'GUARD: ki below min');
        assert(new_ki <= self.policy_ki_max.read(), 'GUARD: ki above max');

        // Layer 2: Per-call delta cap
        let pid = self._pid();
        let gains = pid.get_controller_gains();
        let old_kp = gains.kp;
        let old_ki = gains.ki;

        let kp_delta = self._abs_diff(new_kp, old_kp);
        let ki_delta = self._abs_diff(new_ki, old_ki);
        assert(kp_delta <= self.policy_max_kp_delta.read(), 'GUARD: kp delta too large');
        assert(ki_delta <= self.policy_max_ki_delta.read(), 'GUARD: ki delta too large');

        // Apply — effects before interactions (CEI pattern)
        let new_count = count + 1;
        self.update_count.write(new_count);
        self.last_update_timestamp.write(now);

        // Interact — forward to PIDController (we are its admin)
        // Use low-level call since set_kp/set_ki are #[external(v0)] not in the interface trait
        let pid_addr = self.pid_controller.read();

        // Call set_kp
        let mut kp_calldata: Array<felt252> = array![];
        kp_calldata.append(new_kp.into());
        starknet::syscalls::call_contract_syscall(
            pid_addr,
            selector!("set_kp"),
            kp_calldata.span(),
        ).unwrap();

        // Call set_ki
        let mut ki_calldata: Array<felt252> = array![];
        ki_calldata.append(new_ki.into());
        starknet::syscalls::call_contract_syscall(
            pid_addr,
            selector!("set_ki"),
            ki_calldata.span(),
        ).unwrap();

        // Emit PDR events — both legacy ParameterUpdate (kept for indexer
        // compat) and ERC-8004 ProposalAttributed (always, since identity
        // is mandatory now)
        let caller = get_caller_address();
        self.emit(ParameterUpdate {
            agent: caller,
            old_kp,
            new_kp,
            old_ki,
            new_ki,
            update_number: new_count,
            emergency_mode,
            timestamp: now,
        });

        self.emit(ProposalAttributed {
            agent_id: self.proposer_agent_id.read(),
            caller,
            new_kp,
            new_ki,
            is_emergency: emergency_mode,
            timestamp: now,
        });
    }

    // ========================================================================
    // Admin functions
    // ========================================================================

    /// Redirect the Guard's PID reference to a new PIDController contract.
    /// Useful when redeploying PID (e.g. RAY migration) without losing
    /// Guard state (update_count, stopped, etc.). Admin-only.
    #[external(v0)]
    fn set_pid_controller(ref self: ContractState, controller: ContractAddress) {
        self._assert_admin();
        assert(!controller.is_zero(), 'GUARD: pid is zero');
        self.pid_controller.write(controller);
    }

    /// Repoint the registry. Mostly useful if the official IdentityRegistry
    /// gets upgraded to a new address (rare, but the keep-starknet-strange
    /// repo upgrades via replace_class so address shouldn't change). Admin-only.
    #[external(v0)]
    fn set_identity_registry(ref self: ContractState, registry: ContractAddress) {
        self._assert_admin();
        assert(!registry.is_zero(), 'GUARD: registry is zero');
        self.identity_registry.write(registry);
        self._emit_identity_configured();
    }

    /// Rotate the active proposer to a different ERC-8004 NFT. The new
    /// agent_id must already be minted; subsequent propose_parameters
    /// calls will route to whichever wallet that NFT is bound to.
    #[external(v0)]
    fn set_proposer_agent_id(ref self: ContractState, agent_id: u256) {
        self._assert_admin();
        assert(agent_id != 0, 'GUARD: agent_id is zero');
        self.proposer_agent_id.write(agent_id);
        self._emit_identity_configured();
    }

    #[external(v0)]
    fn set_policy(ref self: ContractState, policy: AgentPolicy) {
        self._assert_admin();
        self._write_policy(policy);
        self.emit(PolicyUpdated {
            admin: get_caller_address(),
            timestamp: get_block_timestamp(),
        });
    }

    #[external(v0)]
    fn emergency_stop(ref self: ContractState) {
        self._assert_admin();
        self.stopped.write(true);
        self.emit(EmergencyStop {
            admin: get_caller_address(),
            timestamp: get_block_timestamp(),
        });
    }

    #[external(v0)]
    fn resume(ref self: ContractState) {
        self._assert_admin();
        self.stopped.write(false);
        self.emit(Resumed {
            admin: get_caller_address(),
            timestamp: get_block_timestamp(),
        });
    }

    // ========================================================================
    // Proxy admin — human retains PIDController control via Guard
    // ========================================================================

    #[external(v0)]
    fn proxy_set_seed_proposer(ref self: ContractState, proposer: ContractAddress) {
        self._assert_admin();
        let pid_addr = self.pid_controller.read();
        let mut calldata: Array<felt252> = array![];
        calldata.append(proposer.into());
        starknet::syscalls::call_contract_syscall(
            pid_addr,
            selector!("set_seed_proposer"),
            calldata.span(),
        ).unwrap();
    }

    #[external(v0)]
    fn proxy_set_noise_barrier(ref self: ContractState, barrier: u256) {
        self._assert_admin();
        let pid_addr = self.pid_controller.read();
        let mut calldata: Array<felt252> = array![];
        calldata.append(barrier.low.into());
        calldata.append(barrier.high.into());
        starknet::syscalls::call_contract_syscall(
            pid_addr,
            selector!("set_noise_barrier"),
            calldata.span(),
        ).unwrap();
    }

    #[external(v0)]
    fn proxy_set_per_second_cumulative_leak(ref self: ContractState, leak: u256) {
        self._assert_admin();
        let pid_addr = self.pid_controller.read();
        let mut calldata: Array<felt252> = array![];
        calldata.append(leak.low.into());
        calldata.append(leak.high.into());
        starknet::syscalls::call_contract_syscall(
            pid_addr,
            selector!("set_per_second_cumulative_leak"),
            calldata.span(),
        ).unwrap();
    }

    #[external(v0)]
    fn proxy_transfer_pid_admin(ref self: ContractState, new_admin: ContractAddress) {
        self._assert_admin();
        let pid_addr = self.pid_controller.read();
        let mut calldata: Array<felt252> = array![];
        calldata.append(new_admin.into());
        starknet::syscalls::call_contract_syscall(
            pid_addr,
            selector!("transfer_admin"),
            calldata.span(),
        ).unwrap();
    }

    // ========================================================================
    // View functions
    // ========================================================================

    #[external(v0)]
    fn get_policy(self: @ContractState) -> AgentPolicy {
        self._read_policy()
    }

    #[external(v0)]
    fn is_stopped(self: @ContractState) -> bool {
        self.stopped.read()
    }

    #[external(v0)]
    fn get_update_count(self: @ContractState) -> u32 {
        self.update_count.read()
    }

    #[external(v0)]
    fn get_last_update_timestamp(self: @ContractState) -> u64 {
        self.last_update_timestamp.read()
    }

    #[external(v0)]
    fn get_identity_registry(self: @ContractState) -> ContractAddress {
        self.identity_registry.read()
    }

    #[external(v0)]
    fn get_proposer_agent_id(self: @ContractState) -> u256 {
        self.proposer_agent_id.read()
    }

    /// Convenience view: the wallet currently authorized to propose.
    /// Reads from the registry, so it reflects the live SNIP-6 binding.
    /// Returns zero if NFT is not bound (or transferred without re-binding).
    #[external(v0)]
    fn get_authorized_wallet(self: @ContractState) -> ContractAddress {
        let registry = IIdentityRegistryDispatcher {
            contract_address: self.identity_registry.read(),
        };
        registry.get_agent_wallet(self.proposer_agent_id.read())
    }
}
