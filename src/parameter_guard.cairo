/// ParameterGuard — Bounded parameter governance for PIDController
/// Allows an LLM agent to modify Kp/Ki within safe bounds defined by a human admin.
/// Inspired by starknet-agentic SessionPolicy/SpendingPolicy enforcement patterns.
///
/// Enforcement layers (mirroring starknet-agentic's 3-layer model):
///   1. Identity: caller must be the registered agent
///   2. Bounds: new values within absolute min/max AND per-call delta cap
///   3. Rate limit: cooldown + call budget
///
/// PDR (Policy Decision Record) events emitted for every action (paper #5 pattern).
#[starknet::contract]
pub mod ParameterGuard {
    use starknet::storage::{StoragePointerReadAccess, StoragePointerWriteAccess};
    use starknet::{ContractAddress, get_caller_address, get_block_timestamp};
    use core::num::traits::Zero;
    use grinta::types::AgentPolicy;
    use grinta::interfaces::ipid_controller::{IPIDControllerDispatcher, IPIDControllerDispatcherTrait};

    #[storage]
    struct Storage {
        admin: ContractAddress,
        agent: ContractAddress,
        pid_controller: ContractAddress,
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
        AgentSet: AgentSet,
        AgentRevoked: AgentRevoked,
        PolicyUpdated: PolicyUpdated,
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
    pub struct AgentSet {
        #[key]
        pub admin: ContractAddress,
        pub agent: ContractAddress,
        pub timestamp: u64,
    }

    #[derive(Drop, starknet::Event)]
    pub struct AgentRevoked {
        #[key]
        pub admin: ContractAddress,
        pub old_agent: ContractAddress,
        pub timestamp: u64,
    }

    #[derive(Drop, starknet::Event)]
    pub struct PolicyUpdated {
        #[key]
        pub admin: ContractAddress,
        pub timestamp: u64,
    }

    // ========================================================================
    // Constructor
    // ========================================================================

    #[constructor]
    fn constructor(
        ref self: ContractState,
        admin: ContractAddress,
        agent: ContractAddress,
        pid_controller: ContractAddress,
        policy: AgentPolicy,
    ) {
        assert(!admin.is_zero(), 'GUARD: admin is zero');
        assert(!pid_controller.is_zero(), 'GUARD: pid is zero');

        self.admin.write(admin);
        self.agent.write(agent);
        self.pid_controller.write(pid_controller);
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

        fn _assert_agent(self: @ContractState) {
            let agent = self.agent.read();
            assert(!agent.is_zero(), 'GUARD: no agent set');
            assert(get_caller_address() == agent, 'GUARD: not agent');
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
    }

    // ========================================================================
    // Agent functions
    // ========================================================================

    #[external(v0)]
    fn propose_parameters(ref self: ContractState, new_kp: i128, new_ki: i128, is_emergency: bool) {
        // Layer 1: Identity
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

        // Emit PDR event
        self.emit(ParameterUpdate {
            agent: get_caller_address(),
            old_kp,
            new_kp,
            old_ki,
            new_ki,
            update_number: new_count,
            emergency_mode,
            timestamp: now,
        });
    }

    // ========================================================================
    // Admin functions
    // ========================================================================

    #[external(v0)]
    fn set_agent(ref self: ContractState, agent: ContractAddress) {
        self._assert_admin();
        self.agent.write(agent);
        self.emit(AgentSet {
            admin: get_caller_address(),
            agent,
            timestamp: get_block_timestamp(),
        });
    }

    /// Redirect the Guard's PID reference to a new PIDController contract.
    ///
    /// Why: when we redeploy the PIDController (e.g. V11 RAY migration), the
    /// Guard must be repointed to the new address so its proxy_* admin calls
    /// and propose_parameters route to the correct contract. Without this
    /// setter the Guard would be stuck pointing at the old (corrupt) PID and
    /// we'd have to redeploy the Guard itself — losing the update_count,
    /// stopped flag, and any accumulated state. Admin-only.
    #[external(v0)]
    fn set_pid_controller(ref self: ContractState, controller: ContractAddress) {
        self._assert_admin();
        assert(!controller.is_zero(), 'GUARD: pid is zero');
        self.pid_controller.write(controller);
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

    #[external(v0)]
    fn revoke_agent(ref self: ContractState) {
        self._assert_admin();
        let old_agent = self.agent.read();
        self.agent.write(Zero::zero());
        self.emit(AgentRevoked {
            admin: get_caller_address(),
            old_agent,
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
    fn get_agent(self: @ContractState) -> ContractAddress {
        self.agent.read()
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
}
