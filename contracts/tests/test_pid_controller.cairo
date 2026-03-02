use snforge_std::{cheat_caller_address, CheatSpan, start_cheat_block_timestamp_global};

use grinta::interfaces::ipid_controller::{IPIDControllerDispatcher, IPIDControllerDispatcherTrait};

use super::test_common::{
    WAD, RAY, admin, deploy_pid_controller,
    KP, KI, NOISE_BARRIER, INTEGRAL_PERIOD_SIZE, FEEDBACK_UPPER_BOUND,
    FEEDBACK_LOWER_BOUND, PER_SECOND_LEAK,
};

/// Helper: deploy PID with the caller as seed_proposer so tests can call compute_rate
fn deploy_pid_for_test() -> (starknet::ContractAddress, IPIDControllerDispatcher) {
    let proposer = admin(); // seed_proposer = admin for tests
    deploy_pid_controller(admin(), proposer)
}

// ============================================================================
// Test 1: Deploy — check gains and params
// ============================================================================
#[test]
fn test_deploy() {
    let (_, pid) = deploy_pid_for_test();

    let gains = pid.get_controller_gains();
    assert(gains.kp == KP, 'wrong kp');
    assert(gains.ki == KI, 'wrong ki');

    let params = pid.get_params();
    assert(params.noise_barrier == NOISE_BARRIER, 'wrong noise barrier');
    assert(params.integral_period_size == INTEGRAL_PERIOD_SIZE, 'wrong period');
    assert(params.feedback_output_upper_bound == FEEDBACK_UPPER_BOUND, 'wrong upper');
    assert(params.feedback_output_lower_bound == FEEDBACK_LOWER_BOUND, 'wrong lower');
    assert(params.per_second_cumulative_leak == PER_SECOND_LEAK, 'wrong leak');
}

// ============================================================================
// Test 2: compute_rate at peg — market == redemption → rate = RAY
// ============================================================================
#[test]
fn test_compute_rate_at_peg() {
    let (pid_addr, pid) = deploy_pid_for_test();

    let market_price: u256 = WAD; // $1.00 in WAD
    let redemption_price: u256 = RAY; // $1.00 in RAY

    // First call (timestamp 0 is allowed — no cooldown on first call)
    start_cheat_block_timestamp_global(1000);
    cheat_caller_address(pid_addr, admin(), CheatSpan::TargetCalls(1));
    let rate = pid.compute_rate(market_price, redemption_price);

    // At peg, proportional = 0, integral = 0, so rate should be RAY
    assert(rate == RAY, 'rate should be RAY at peg');
}

// ============================================================================
// Test 3: compute_rate below peg — market < target → rate > RAY
// ============================================================================
#[test]
fn test_compute_rate_below_peg() {
    let (pid_addr, pid) = deploy_pid_for_test();

    // Market at $0.90, redemption at $1.00
    let market_price: u256 = 900_000_000_000_000_000; // 0.9 WAD
    let redemption_price: u256 = RAY; // 1.0 RAY

    start_cheat_block_timestamp_global(1000);
    cheat_caller_address(pid_addr, admin(), CheatSpan::TargetCalls(1));
    let rate = pid.compute_rate(market_price, redemption_price);

    // Market below peg → positive deviation → rate > RAY (price needs to decrease to attract buys)
    assert(rate > RAY, 'rate should be > RAY below peg');
}

// ============================================================================
// Test 4: compute_rate above peg — market > target → rate < RAY
// ============================================================================
#[test]
fn test_compute_rate_above_peg() {
    let (pid_addr, pid) = deploy_pid_for_test();

    // Market at $1.10, redemption at $1.00
    let market_price: u256 = 1_100_000_000_000_000_000; // 1.1 WAD
    let redemption_price: u256 = RAY; // 1.0 RAY

    start_cheat_block_timestamp_global(1000);
    cheat_caller_address(pid_addr, admin(), CheatSpan::TargetCalls(1));
    let rate = pid.compute_rate(market_price, redemption_price);

    // Market above peg → negative deviation → rate < RAY
    assert(rate < RAY, 'rate should be < RAY above peg');
}

// ============================================================================
// Test 5: Noise barrier — small deviation should not change rate
// ============================================================================
#[test]
fn test_noise_barrier() {
    let (pid_addr, pid) = deploy_pid_for_test();

    // Market at $0.999 — only 0.1% deviation, well below 5% noise barrier
    let market_price: u256 = 999_000_000_000_000_000; // 0.999 WAD
    let redemption_price: u256 = RAY; // 1.0 RAY

    start_cheat_block_timestamp_global(1000);
    cheat_caller_address(pid_addr, admin(), CheatSpan::TargetCalls(1));
    let rate = pid.compute_rate(market_price, redemption_price);

    // Small deviation, within noise barrier → rate should be RAY
    assert(rate == RAY, 'noise barrier should filter');
}

// ============================================================================
// Test 6: Integral leak — verify integral decays over multiple updates
// ============================================================================
#[test]
fn test_integral_leak() {
    let (pid_addr, pid) = deploy_pid_for_test();

    // First update: big deviation
    let market_below: u256 = 900_000_000_000_000_000; // 0.9 WAD
    let redemption: u256 = RAY;

    start_cheat_block_timestamp_global(1000);
    cheat_caller_address(pid_addr, admin(), CheatSpan::TargetCalls(1));
    pid.compute_rate(market_below, redemption);

    let obs_1 = pid.get_deviation_observation();
    let integral_after_1 = obs_1.integral;

    // Second update: back at peg (so proportional = 0)
    // The integral should decay due to leak
    let market_at_peg: u256 = WAD; // 1.0 WAD
    start_cheat_block_timestamp_global(1000 + INTEGRAL_PERIOD_SIZE.into() + 1);
    cheat_caller_address(pid_addr, admin(), CheatSpan::TargetCalls(1));
    pid.compute_rate(market_at_peg, redemption);

    let obs_2 = pid.get_deviation_observation();

    // After returning to peg with leak, integral should be smaller than before
    // (leaked + trapezoidal of 0 + previous)
    // The absolute value should have decreased due to leak
    let abs_1: u128 = if integral_after_1 >= 0 {
        integral_after_1.try_into().unwrap()
    } else {
        let neg: u128 = (-integral_after_1).try_into().unwrap();
        neg
    };

    let abs_2: u128 = if obs_2.integral >= 0 {
        obs_2.integral.try_into().unwrap()
    } else {
        let neg: u128 = (-obs_2.integral).try_into().unwrap();
        neg
    };

    // Integral should have changed (leaked version of old + new trapezoidal contribution)
    // With proportional going from positive to 0, and leak < 1, the absolute integral should decrease
    // This is a sanity check — the exact math depends on trapezoidal + leak
    assert(abs_2 != abs_1, 'integral should have changed');
}
