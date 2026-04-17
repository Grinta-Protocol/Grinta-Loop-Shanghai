// ============================================================================
// Agent Integration Tests — Demo-Realistic Parameters
//
// These tests use KP/KI values with production-like RATIOS (Ki ≈ Kp/1000)
// while keeping magnitudes that produce visible effects for the demo.
//
// Key differences from test_pid_controller.cairo (pedagogical 1.0/0.5 WAD):
//   KP = 2.0 WAD, KI = 0.002 WAD → Ki/Kp ratio = 1:1000 (like RAI production)
//   Agent bounds are tight: ±30% around defaults
//   Per-call delta caps force gradual adjustment (2-3 calls to reach max)
// ============================================================================

use snforge_std::{cheat_caller_address, CheatSpan, start_cheat_block_timestamp_global};

use grinta::interfaces::ipid_controller::{IPIDControllerDispatcherTrait};
use grinta::interfaces::iparameter_guard::{IParameterGuardDispatcherTrait};
use grinta::types::AgentPolicy;

use super::test_common::{
    WAD, RAY,
    admin, agent1,
    deploy_full_system_with_pid, deploy_parameter_guard,
    IPIDTransferAdminDispatcher, IPIDTransferAdminDispatcherTrait,
};

// ============================================================================
// Demo-realistic constants
// ============================================================================

// PID gains: production-like ratio, demo-visible magnitude
const KP_DEMO: i128 = 2_000_000_000_000_000_000;  // 2.0 WAD
const KI_DEMO: i128 = 2_000_000_000_000_000;       // 0.002 WAD (1:1000 ratio)

// Agent policy bounds
const KP_MIN: i128 = 1_400_000_000_000_000_000;    // 1.4 WAD  (-30% of 2.0)
const KP_MAX: i128 = 2_600_000_000_000_000_000;    // 2.6 WAD  (+30% of 2.0)
const KI_MIN: i128 = 1_000_000_000_000_000;         // 0.001 WAD
const KI_MAX: i128 = 10_000_000_000_000_000;        // 0.01 WAD
const MAX_KP_DELTA: u128 = 500_000_000_000_000_000; // 0.5 WAD per call
const MAX_KI_DELTA: u128 = 2_000_000_000_000_000;   // 0.002 WAD per call
const COOLDOWN: u64 = 300;          // 5 min normal
const EMERGENCY_COOLDOWN: u64 = 60; // 1 min emergency
const MAX_UPDATES: u32 = 20;

fn demo_policy() -> AgentPolicy {
    AgentPolicy {
        kp_min: KP_MIN,
        kp_max: KP_MAX,
        ki_min: KI_MIN,
        ki_max: KI_MAX,
        max_kp_delta: MAX_KP_DELTA,
        max_ki_delta: MAX_KI_DELTA,
        cooldown_seconds: COOLDOWN,
        emergency_cooldown_seconds: EMERGENCY_COOLDOWN,
        max_updates: MAX_UPDATES,
    }
}

/// Deploy full system with demo KP/KI + ParameterGuard wired as PID admin
fn deploy_demo_system() -> (super::test_common::GrintaSystem, starknet::ContractAddress, grinta::interfaces::iparameter_guard::IParameterGuardDispatcher) {
    let sys = deploy_full_system_with_pid(KP_DEMO, KI_DEMO);

    // Deploy ParameterGuard
    let (guard_addr, guard) = deploy_parameter_guard(
        admin(), agent1(), sys.pid_addr, demo_policy(),
    );

    // Transfer PID admin to ParameterGuard
    let pid_transfer = IPIDTransferAdminDispatcher { contract_address: sys.pid_addr };
    cheat_caller_address(sys.pid_addr, admin(), CheatSpan::TargetCalls(1));
    pid_transfer.transfer_admin(guard_addr);

    (sys, guard_addr, guard)
}

// ============================================================================
// Test 1: Demo system deploys with correct gains
// ============================================================================
#[test]
fn test_demo_deploys_with_realistic_gains() {
    let (sys, _, guard) = deploy_demo_system();

    let gains = sys.pid.get_controller_gains();
    assert(gains.kp == KP_DEMO, 'kp should be 2.0 WAD');
    assert(gains.ki == KI_DEMO, 'ki should be 0.002 WAD');

    // Verify Ki/Kp ratio: ki * 1000 == kp
    assert(gains.ki * 1000 == gains.kp, 'ratio should be 1:1000');

    // Guard policy is set
    let policy = guard.get_policy();
    assert(policy.kp_min == KP_MIN, 'policy kp_min wrong');
    assert(policy.kp_max == KP_MAX, 'policy kp_max wrong');
    assert(policy.cooldown_seconds == COOLDOWN, 'cooldown wrong');
}

// ============================================================================
// Test 2: PID responds to 10% crash with demo gains
// ============================================================================
#[test]
fn test_demo_pid_crash_response() {
    let (sys, _, _) = deploy_demo_system();

    // Market drops 10%: 0.9 WAD
    let market_crash: u256 = 900_000_000_000_000_000;
    let redemption: u256 = RAY;

    // Need to advance past cooldown (integral_period_size = 3600)
    start_cheat_block_timestamp_global(5000);

    cheat_caller_address(sys.pid_addr, sys.hook_addr, CheatSpan::TargetCalls(1));
    let rate = sys.pid.compute_rate(market_crash, redemption);

    // With KP=2.0 and 10% crash:
    // proportional = 0.1 WAD = 1e17
    // pi_output = swmul(2e18, 1e17) = 2e17
    // rate = RAY + 2e17
    assert(rate > RAY, 'rate should increase on crash');

    let expected_approx: u256 = RAY + 200_000_000_000_000_000; // RAY + 2e17
    // Allow some tolerance for integral contribution
    assert(rate >= expected_approx - WAD / 100, 'rate too low');
    assert(rate <= expected_approx + WAD, 'rate too high');
}

// ============================================================================
// Test 3: Agent gradually increases KP during crash (2 calls needed)
// ============================================================================
#[test]
fn test_agent_gradual_kp_increase() {
    let (sys, guard_addr, guard) = deploy_demo_system();

    let initial_gains = sys.pid.get_controller_gains();
    assert(initial_gains.kp == KP_DEMO, 'initial kp wrong');

    // Agent bumps KP by 0.5 WAD (max delta per call): 2.0 → 2.5
    let new_kp_1: i128 = 2_500_000_000_000_000_000; // 2.5 WAD
    start_cheat_block_timestamp_global(1000);
    cheat_caller_address(guard_addr, agent1(), CheatSpan::TargetCalls(1));
    guard.propose_parameters(new_kp_1, KI_DEMO, true); // emergency for fast cooldown

    let gains_after_1 = sys.pid.get_controller_gains();
    assert(gains_after_1.kp == new_kp_1, 'kp should be 2.5 after call 1');

    // Agent bumps again after emergency cooldown (60s): 2.5 → 2.6 (delta = 0.1, within 0.5 cap)
    let new_kp_2: i128 = KP_MAX; // 2.6 WAD
    start_cheat_block_timestamp_global(1000 + 61);
    cheat_caller_address(guard_addr, agent1(), CheatSpan::TargetCalls(1));
    guard.propose_parameters(new_kp_2, KI_DEMO, true);

    let gains_after_2 = sys.pid.get_controller_gains();
    assert(gains_after_2.kp == KP_MAX, 'kp should be at max 2.6');

    // Verify: took 2 calls to go from 2.0 → 2.6 (0.5 + 0.1 delta)
    assert(guard.get_update_count() == 2, 'should have 2 updates');
}

// ============================================================================
// Test 4: A/B comparison — fixed vs agent-adjusted rates
// ============================================================================
#[test]
fn test_ab_comparison_fixed_vs_agent() {
    // === Scenario A: Fixed params (no agent intervention) ===
    let sys_a = deploy_full_system_with_pid(KP_DEMO, KI_DEMO);

    let market_crash: u256 = 900_000_000_000_000_000; // 0.9 WAD (10% crash)
    let redemption: u256 = RAY;

    start_cheat_block_timestamp_global(5000);
    cheat_caller_address(sys_a.pid_addr, sys_a.hook_addr, CheatSpan::TargetCalls(1));
    let rate_fixed = sys_a.pid.compute_rate(market_crash, redemption);

    // === Scenario B: Agent bumps KP to 2.5 before crash ===
    let sys_b = deploy_full_system_with_pid(KP_DEMO, KI_DEMO);

    // Deploy guard and wire it
    let (guard_addr, guard) = deploy_parameter_guard(
        admin(), agent1(), sys_b.pid_addr, demo_policy(),
    );
    let pid_transfer = IPIDTransferAdminDispatcher { contract_address: sys_b.pid_addr };
    cheat_caller_address(sys_b.pid_addr, admin(), CheatSpan::TargetCalls(1));
    pid_transfer.transfer_admin(guard_addr);

    // Agent increases KP: 2.0 → 2.5
    start_cheat_block_timestamp_global(1000);
    cheat_caller_address(guard_addr, agent1(), CheatSpan::TargetCalls(1));
    guard.propose_parameters(2_500_000_000_000_000_000, KI_DEMO, true);

    // Now compute rate with boosted KP
    start_cheat_block_timestamp_global(5000);
    cheat_caller_address(sys_b.pid_addr, sys_b.hook_addr, CheatSpan::TargetCalls(1));
    let rate_agent = sys_b.pid.compute_rate(market_crash, redemption);

    // Agent-adjusted rate should be HIGHER (stronger correction)
    assert(rate_agent > rate_fixed, 'agent rate should beat fixed');

    // Quantify: agent rate should be ~25% higher correction
    // Fixed: pi = swmul(2.0, 0.1) = 0.2 WAD → rate = RAY + 2e17
    // Agent: pi = swmul(2.5, 0.1) = 0.25 WAD → rate = RAY + 2.5e17
    let correction_fixed = rate_fixed - RAY;
    let correction_agent = rate_agent - RAY;
    assert(correction_agent > correction_fixed, 'agent correction stronger');
}

// ============================================================================
// Test 5: Emergency cooldown allows faster response than normal
// ============================================================================
#[test]
fn test_emergency_vs_normal_cooldown() {
    let (_, guard_addr, guard) = deploy_demo_system();

    // First call at t=1000
    start_cheat_block_timestamp_global(1000);
    cheat_caller_address(guard_addr, agent1(), CheatSpan::TargetCalls(1));
    guard.propose_parameters(2_200_000_000_000_000_000, KI_DEMO, true); // emergency

    // Second call at t=1000+61 (after emergency cooldown of 60s) — should work
    start_cheat_block_timestamp_global(1061);
    cheat_caller_address(guard_addr, agent1(), CheatSpan::TargetCalls(1));
    guard.propose_parameters(2_400_000_000_000_000_000, KI_DEMO, true);

    assert(guard.get_update_count() == 2, 'emergency allows 2 fast calls');
}

#[test]
#[should_panic(expected: 'GUARD: cooldown active')]
fn test_normal_cooldown_blocks_fast_calls() {
    let (_, guard_addr, guard) = deploy_demo_system();

    // First call at t=1000 (normal, not emergency)
    start_cheat_block_timestamp_global(1000);
    cheat_caller_address(guard_addr, agent1(), CheatSpan::TargetCalls(1));
    guard.propose_parameters(2_200_000_000_000_000_000, KI_DEMO, false); // normal

    // Second call at t=1061 — within normal cooldown (300s), should FAIL
    start_cheat_block_timestamp_global(1061);
    cheat_caller_address(guard_addr, agent1(), CheatSpan::TargetCalls(1));
    guard.propose_parameters(2_400_000_000_000_000_000, KI_DEMO, false);
}

// ============================================================================
// Test 7: Agent respects delta cap — can't jump full range in one call
// ============================================================================
#[test]
#[should_panic(expected: 'GUARD: kp delta too large')]
fn test_agent_cannot_exceed_delta_cap() {
    let (_, guard_addr, guard) = deploy_demo_system();

    start_cheat_block_timestamp_global(1000);
    cheat_caller_address(guard_addr, agent1(), CheatSpan::TargetCalls(1));
    // Try to jump from 2.0 → 2.6 in one call (delta = 0.6, max = 0.5)
    guard.propose_parameters(KP_MAX, KI_DEMO, true);
}

// ============================================================================
// Test 8: Agent can adjust Ki with production-like ratio maintained
// ============================================================================
#[test]
fn test_agent_adjusts_ki_maintaining_ratio() {
    let (sys, guard_addr, guard) = deploy_demo_system();

    // Agent increases both: KP 2.0→2.5, KI 0.002→0.004
    let new_kp: i128 = 2_500_000_000_000_000_000; // 2.5 WAD
    let new_ki: i128 = 4_000_000_000_000_000;      // 0.004 WAD

    start_cheat_block_timestamp_global(1000);
    cheat_caller_address(guard_addr, agent1(), CheatSpan::TargetCalls(1));
    guard.propose_parameters(new_kp, new_ki, true);

    let gains = sys.pid.get_controller_gains();
    assert(gains.kp == new_kp, 'kp should be 2.5');
    assert(gains.ki == new_ki, 'ki should be 0.004');

    // Ki/Kp ratio is now 1:625 (still reasonable, moved from 1:1000 toward tighter)
}
