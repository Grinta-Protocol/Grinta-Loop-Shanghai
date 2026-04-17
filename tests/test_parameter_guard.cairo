use starknet::ContractAddress;
use snforge_std::{cheat_caller_address, CheatSpan, start_cheat_block_timestamp_global};

use grinta::types::AgentPolicy;
use grinta::interfaces::ipid_controller::{IPIDControllerDispatcher, IPIDControllerDispatcherTrait};
use grinta::interfaces::iparameter_guard::{IParameterGuardDispatcher, IParameterGuardDispatcherTrait};

use super::test_common::{
    admin, agent1, user1,
    deploy_pid_controller, deploy_parameter_guard,
    IPIDTransferAdminDispatcher, IPIDTransferAdminDispatcherTrait,
    IPIDSetNoiseDispatcher, IPIDSetNoiseDispatcherTrait,
};

// ============================================================================
// Test helpers
// ============================================================================

/// Default permissive policy for happy-path tests (emergency mode disabled)
fn default_policy() -> AgentPolicy {
    AgentPolicy {
        kp_min: 0,                                     // Allow down to 0
        kp_max: 2_000_000_000_000_000_000,             // 2.0 WAD
        ki_min: 0,
        ki_max: 1_000_000_000_000_000_000,             // 1.0 WAD
        max_kp_delta: 500_000_000_000_000_000,         // 0.5 WAD per call
        max_ki_delta: 500_000_000_000_000_000,         // 0.5 WAD per call
        cooldown_seconds: 60,                          // 1 minute (normal tier)
        emergency_cooldown_seconds: 0,                 // Disabled
        max_updates: 10,                               // 10 updates budget
    }
}

/// Deploy PID + Guard, transfer PID admin to Guard. Returns both dispatchers + addresses.
fn setup() -> (
    ContractAddress, IPIDControllerDispatcher,
    ContractAddress, IParameterGuardDispatcher,
) {
    let admin_addr = admin();
    let agent_addr = agent1();

    // Deploy PID with admin as seed_proposer (for simplicity)
    let (pid_addr, pid) = deploy_pid_controller(admin_addr, admin_addr);

    // Deploy ParameterGuard
    let (guard_addr, guard) = deploy_parameter_guard(admin_addr, agent_addr, pid_addr, default_policy());

    // Transfer PID admin to ParameterGuard
    let pid_transfer = IPIDTransferAdminDispatcher { contract_address: pid_addr };
    cheat_caller_address(pid_addr, admin_addr, CheatSpan::TargetCalls(1));
    pid_transfer.transfer_admin(guard_addr);

    (pid_addr, pid, guard_addr, guard)
}

// ============================================================================
// Test 1: Happy path — propose within bounds updates PID gains
// ============================================================================
#[test]
fn test_propose_within_bounds() {
    let (_, pid, guard_addr, guard) = setup();
    let agent_addr = agent1();

    let new_kp: i128 = 1_200_000_000_000_000_000; // 1.2 WAD (delta = 0.2 from KP=1.0)
    let new_ki: i128 = 300_000_000_000_000_000;   // 0.3 WAD (delta = 0.2 from KI=0.5)

    start_cheat_block_timestamp_global(1000);
    cheat_caller_address(guard_addr, agent_addr, CheatSpan::TargetCalls(1));
    guard.propose_parameters(new_kp, new_ki, false);

    // Verify PID gains were updated
    let gains = pid.get_controller_gains();
    assert(gains.kp == new_kp, 'kp not updated');
    assert(gains.ki == new_ki, 'ki not updated');

    // Verify guard state
    assert(guard.get_update_count() == 1, 'count should be 1');
    assert(guard.get_last_update_timestamp() == 1000, 'wrong timestamp');
}

// ============================================================================
// Test 2: Kp above max bound — reverts
// ============================================================================
#[test]
#[should_panic(expected: 'GUARD: kp above max')]
fn test_propose_exceeds_kp_max() {
    let (_, _, guard_addr, guard) = setup();

    // kp_max = 2.0 WAD, try 2.5
    let bad_kp: i128 = 2_500_000_000_000_000_000;
    let ok_ki: i128 = 500_000_000_000_000_000;

    start_cheat_block_timestamp_global(1000);
    cheat_caller_address(guard_addr, agent1(), CheatSpan::TargetCalls(1));
    guard.propose_parameters(bad_kp, ok_ki, false);
}

// ============================================================================
// Test 3: Ki below min bound — reverts
// ============================================================================
#[test]
#[should_panic(expected: 'GUARD: ki below min')]
fn test_propose_ki_below_min() {
    let (_, _, guard_addr, guard) = setup();

    let ok_kp: i128 = 1_000_000_000_000_000_000;
    let bad_ki: i128 = -1; // ki_min = 0, try -1

    start_cheat_block_timestamp_global(1000);
    cheat_caller_address(guard_addr, agent1(), CheatSpan::TargetCalls(1));
    guard.propose_parameters(ok_kp, bad_ki, false);
}

// ============================================================================
// Test 4: Kp delta too large — reverts
// ============================================================================
#[test]
#[should_panic(expected: 'GUARD: kp delta too large')]
fn test_propose_kp_delta_too_large() {
    let (_, _, guard_addr, guard) = setup();

    // Current KP = 1.0 WAD. max_kp_delta = 0.5 WAD. Try 1.6 WAD (delta = 0.6)
    let bad_kp: i128 = 1_600_000_000_000_000_000;
    let ok_ki: i128 = 500_000_000_000_000_000;

    start_cheat_block_timestamp_global(1000);
    cheat_caller_address(guard_addr, agent1(), CheatSpan::TargetCalls(1));
    guard.propose_parameters(bad_kp, ok_ki, false);
}

// ============================================================================
// Test 5: Ki delta too large — reverts
// ============================================================================
#[test]
#[should_panic(expected: 'GUARD: ki delta too large')]
fn test_propose_ki_delta_too_large() {
    let admin_addr = admin();
    let agent_addr = agent1();
    let (pid_addr, _) = deploy_pid_controller(admin_addr, admin_addr);

    // Policy with ki_max = 2.0 WAD but max_ki_delta = 0.3 WAD
    // Current KI = 0.5 WAD. Proposing 0.9 WAD (delta = 0.4 > 0.3) should fail on delta, not bounds.
    let tight_delta_policy = AgentPolicy {
        kp_min: 0,
        kp_max: 2_000_000_000_000_000_000,
        ki_min: 0,
        ki_max: 2_000_000_000_000_000_000,             // 2.0 WAD — well above target
        max_kp_delta: 500_000_000_000_000_000,
        max_ki_delta: 300_000_000_000_000_000,          // 0.3 WAD — tight
        cooldown_seconds: 60,
        emergency_cooldown_seconds: 0,
        max_updates: 10,
    };

    let (guard_addr, guard) = deploy_parameter_guard(admin_addr, agent_addr, pid_addr, tight_delta_policy);


    let pid_transfer = IPIDTransferAdminDispatcher { contract_address: pid_addr };
    cheat_caller_address(pid_addr, admin_addr, CheatSpan::TargetCalls(1));
    pid_transfer.transfer_admin(guard_addr);

    let ok_kp: i128 = 1_000_000_000_000_000_000;   // Same as current — delta = 0
    let bad_ki: i128 = 900_000_000_000_000_000;     // 0.9 WAD — delta from 0.5 = 0.4 > 0.3

    start_cheat_block_timestamp_global(1000);
    cheat_caller_address(guard_addr, agent_addr, CheatSpan::TargetCalls(1));
    guard.propose_parameters(ok_kp, bad_ki, false);
}

// ============================================================================
// Test 6: Cooldown active — reverts
// ============================================================================
#[test]
#[should_panic(expected: 'GUARD: cooldown active')]
fn test_propose_during_cooldown() {
    let (_, _, guard_addr, guard) = setup();
    let agent_addr = agent1();

    let new_kp: i128 = 1_100_000_000_000_000_000;
    let new_ki: i128 = 400_000_000_000_000_000;

    // First update at t=1000
    start_cheat_block_timestamp_global(1000);
    cheat_caller_address(guard_addr, agent_addr, CheatSpan::TargetCalls(1));
    guard.propose_parameters(new_kp, new_ki, false);

    // Second update at t=1050 (only 50s, cooldown = 60s)
    start_cheat_block_timestamp_global(1050);
    cheat_caller_address(guard_addr, agent_addr, CheatSpan::TargetCalls(1));
    guard.propose_parameters(new_kp, new_ki, false); // Should panic
}

// ============================================================================
// Test 7: Budget exhausted — reverts
// ============================================================================
#[test]
#[should_panic(expected: 'GUARD: budget exhausted')]
fn test_propose_budget_exhausted() {
    let admin_addr = admin();
    let agent_addr = agent1();
    let (pid_addr, _) = deploy_pid_controller(admin_addr, admin_addr);

    // Policy with max_updates = 1
    let tight_policy = AgentPolicy {
        kp_min: 0,
        kp_max: 2_000_000_000_000_000_000,
        ki_min: 0,
        ki_max: 1_000_000_000_000_000_000,
        max_kp_delta: 500_000_000_000_000_000,
        max_ki_delta: 500_000_000_000_000_000,
        cooldown_seconds: 1,
        emergency_cooldown_seconds: 0,
        max_updates: 1,
    };

    let (guard_addr, guard) = deploy_parameter_guard(admin_addr, agent_addr, pid_addr, tight_policy);

    // Transfer PID admin
    let pid_transfer = IPIDTransferAdminDispatcher { contract_address: pid_addr };
    cheat_caller_address(pid_addr, admin_addr, CheatSpan::TargetCalls(1));
    pid_transfer.transfer_admin(guard_addr);

    // First update — OK
    start_cheat_block_timestamp_global(1000);
    cheat_caller_address(guard_addr, agent_addr, CheatSpan::TargetCalls(1));
    guard.propose_parameters(1_100_000_000_000_000_000, 400_000_000_000_000_000, false);

    // Second update — budget exhausted
    start_cheat_block_timestamp_global(1002);
    cheat_caller_address(guard_addr, agent_addr, CheatSpan::TargetCalls(1));
    guard.propose_parameters(1_200_000_000_000_000_000, 300_000_000_000_000_000, false);
}

// ============================================================================
// Test 8: Stopped — reverts
// ============================================================================
#[test]
#[should_panic(expected: 'GUARD: stopped')]
fn test_propose_when_stopped() {
    let (_, _, guard_addr, guard) = setup();
    let admin_addr = admin();

    // Admin stops the guard
    cheat_caller_address(guard_addr, admin_addr, CheatSpan::TargetCalls(1));
    guard.emergency_stop();
    assert(guard.is_stopped(), 'should be stopped');

    // Agent tries to propose
    start_cheat_block_timestamp_global(1000);
    cheat_caller_address(guard_addr, agent1(), CheatSpan::TargetCalls(1));
    guard.propose_parameters(1_100_000_000_000_000_000, 400_000_000_000_000_000, false);
}

// ============================================================================
// Test 9: Not agent — reverts
// ============================================================================
#[test]
#[should_panic(expected: 'GUARD: not agent')]
fn test_propose_not_agent() {
    let (_, _, guard_addr, guard) = setup();

    start_cheat_block_timestamp_global(1000);
    cheat_caller_address(guard_addr, user1(), CheatSpan::TargetCalls(1));
    guard.propose_parameters(1_100_000_000_000_000_000, 400_000_000_000_000_000, false);
}

// ============================================================================
// Test 10: Emergency stop and resume
// ============================================================================
#[test]
fn test_emergency_stop_and_resume() {
    let (_, _, guard_addr, guard) = setup();
    let admin_addr = admin();

    assert(!guard.is_stopped(), 'should not be stopped');

    cheat_caller_address(guard_addr, admin_addr, CheatSpan::TargetCalls(1));
    guard.emergency_stop();
    assert(guard.is_stopped(), 'should be stopped');

    cheat_caller_address(guard_addr, admin_addr, CheatSpan::TargetCalls(1));
    guard.resume();
    assert(!guard.is_stopped(), 'should be resumed');
}

// ============================================================================
// Test 11: Revoke agent
// ============================================================================
#[test]
fn test_revoke_agent() {
    let (_, _, guard_addr, guard) = setup();
    let admin_addr = admin();

    assert(guard.get_agent() == agent1(), 'wrong agent');

    cheat_caller_address(guard_addr, admin_addr, CheatSpan::TargetCalls(1));
    guard.revoke_agent();

    let zero: ContractAddress = 0.try_into().unwrap();
    assert(guard.get_agent() == zero, 'agent not revoked');
}

// ============================================================================
// Test 12: Proxy functions — admin can call PID admin via Guard
// ============================================================================
#[test]
fn test_proxy_set_noise_barrier() {
    let (_, pid, guard_addr, guard) = setup();
    let admin_addr = admin();

    let new_barrier: u256 = 900_000_000_000_000_000; // 0.9 WAD
    cheat_caller_address(guard_addr, admin_addr, CheatSpan::TargetCalls(1));
    guard.proxy_set_noise_barrier(new_barrier);

    let params = pid.get_params();
    assert(params.noise_barrier == new_barrier, 'barrier not updated');
}

// ============================================================================
// Test 13: Only admin can set policy
// ============================================================================
#[test]
#[should_panic(expected: 'GUARD: not admin')]
fn test_only_admin_can_set_policy() {
    let (_, _, guard_addr, guard) = setup();

    cheat_caller_address(guard_addr, user1(), CheatSpan::TargetCalls(1));
    guard.set_policy(default_policy());
}

// ============================================================================
// Test 14: Transfer PID admin back to human
// ============================================================================
#[test]
fn test_transfer_pid_admin_back() {
    let (pid_addr, _, guard_addr, guard) = setup();
    let admin_addr = admin();

    // Admin reclaims PID admin via proxy
    cheat_caller_address(guard_addr, admin_addr, CheatSpan::TargetCalls(1));
    guard.proxy_transfer_pid_admin(admin_addr);

    // Now admin can directly call PID (verify by setting noise barrier directly)
    let pid_set_noise = super::test_common::IPIDSetNoiseDispatcher { contract_address: pid_addr };
    cheat_caller_address(pid_addr, admin_addr, CheatSpan::TargetCalls(1));
    pid_set_noise.set_noise_barrier(800_000_000_000_000_000);

    let pid = IPIDControllerDispatcher { contract_address: pid_addr };
    let params = pid.get_params();
    assert(params.noise_barrier == 800_000_000_000_000_000, 'admin should be back');
}

// ============================================================================
// Two-tier cooldown tests
// ============================================================================

/// Constants for two-tier cooldown tests
const NORMAL_COOLDOWN: u64 = 3600;   // 1 hour
const EMERGENCY_COOLDOWN: u64 = 60;  // 1 minute

/// Policy with two-tier cooldown enabled
fn emergency_policy() -> AgentPolicy {
    AgentPolicy {
        kp_min: 0,
        kp_max: 2_000_000_000_000_000_000,
        ki_min: 0,
        ki_max: 1_000_000_000_000_000_000,
        max_kp_delta: 500_000_000_000_000_000,
        max_ki_delta: 500_000_000_000_000_000,
        cooldown_seconds: NORMAL_COOLDOWN,                // 1 hour normal
        emergency_cooldown_seconds: EMERGENCY_COOLDOWN,   // 1 minute emergency
        max_updates: 20,
    }
}

/// Simple setup with emergency policy (no need to trigger PID crash anymore).
fn setup_with_emergency_policy() -> (
    ContractAddress, IPIDControllerDispatcher,
    ContractAddress, IParameterGuardDispatcher,
) {
    let admin_addr = admin();
    let agent_addr = agent1();

    let (pid_addr, pid) = deploy_pid_controller(admin_addr, admin_addr);
    let (guard_addr, guard) = deploy_parameter_guard(admin_addr, agent_addr, pid_addr, emergency_policy());

    let pid_transfer = IPIDTransferAdminDispatcher { contract_address: pid_addr };
    cheat_caller_address(pid_addr, admin_addr, CheatSpan::TargetCalls(1));
    pid_transfer.transfer_admin(guard_addr);

    (pid_addr, pid, guard_addr, guard)
}

// ============================================================================
// Test 15: Emergency cooldown — agent declares emergency, can update faster
// ============================================================================
#[test]
fn test_emergency_cooldown_agent_declares() {
    let (_, _, guard_addr, guard) = setup_with_emergency_policy();
    let agent_addr = agent1();

    let t_first: u64 = 1000;
    let t_second: u64 = t_first + EMERGENCY_COOLDOWN + 1; // 1061 (61s later)

    // First agent update (emergency)
    start_cheat_block_timestamp_global(t_first);
    cheat_caller_address(guard_addr, agent_addr, CheatSpan::TargetCalls(1));
    guard.propose_parameters(1_200_000_000_000_000_000, 400_000_000_000_000_000, true);
    assert(guard.get_update_count() == 1, 'count should be 1');

    // Second update — only 61s later (< normal 3600s, but > emergency 60s)
    // Should SUCCEED because agent declares is_emergency = true
    start_cheat_block_timestamp_global(t_second);
    cheat_caller_address(guard_addr, agent_addr, CheatSpan::TargetCalls(1));
    guard.propose_parameters(1_300_000_000_000_000_000, 350_000_000_000_000_000, true);
    assert(guard.get_update_count() == 2, 'count should be 2');
}

// ============================================================================
// Test 16: Normal cooldown — agent does NOT declare emergency, must wait full cooldown
// ============================================================================
#[test]
#[should_panic(expected: 'GUARD: cooldown active')]
fn test_normal_cooldown_when_not_emergency() {
    let (_, _, guard_addr, guard) = setup_with_emergency_policy();
    let agent_addr = agent1();

    // First agent update (normal mode)
    let t_first: u64 = 1000;
    start_cheat_block_timestamp_global(t_first);
    cheat_caller_address(guard_addr, agent_addr, CheatSpan::TargetCalls(1));
    guard.propose_parameters(1_100_000_000_000_000_000, 400_000_000_000_000_000, false);

    // Second update 61s later — SHOULD FAIL because is_emergency = false → normal cooldown (3600s)
    start_cheat_block_timestamp_global(t_first + EMERGENCY_COOLDOWN + 1);
    cheat_caller_address(guard_addr, agent_addr, CheatSpan::TargetCalls(1));
    guard.propose_parameters(1_200_000_000_000_000_000, 350_000_000_000_000_000, false); // panics!
}

// ============================================================================
// Test 17: Emergency cooldown validation — emg_cd must be <= normal_cd
// ============================================================================
#[test]
#[should_panic(expected: 'GUARD: emg_cd > normal_cd')]
fn test_emergency_cooldown_exceeds_normal_rejected() {
    let (_, _, guard_addr, guard) = setup();
    let admin_addr = admin();

    // Try to set invalid policy: emergency_cooldown (120) > cooldown (60)
    let bad_policy = AgentPolicy {
        kp_min: 0,
        kp_max: 2_000_000_000_000_000_000,
        ki_min: 0,
        ki_max: 1_000_000_000_000_000_000,
        max_kp_delta: 500_000_000_000_000_000,
        max_ki_delta: 500_000_000_000_000_000,
        cooldown_seconds: 60,
        emergency_cooldown_seconds: 120,   // INVALID: > normal
        max_updates: 10,
    };

    cheat_caller_address(guard_addr, admin_addr, CheatSpan::TargetCalls(1));
    guard.set_policy(bad_policy); // Should panic
}
