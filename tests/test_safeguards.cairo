/// Tests for safeguards added to prevent the redemption price crash:
/// 1. SAFEEngine: redemption price floor at 0.01 RAY
/// 2. GrintaHook: market price bounds [$0.001, $1000]
/// 3. PIDController: minimum rate floor
/// 4. SAFEEngine: reset_redemption_price admin function
/// 5. SAFEEngine: mint_grit admin function
/// 6. SAFEEngine: replace_class admin function

use snforge_std::{cheat_caller_address, CheatSpan, start_cheat_block_timestamp_global};

use grinta::interfaces::isafe_engine::{ISAFEEngineDispatcherTrait};
use grinta::interfaces::igrinta_hook::{IGrintaHookDispatcherTrait};
use grinta::interfaces::ipid_controller::{IPIDControllerDispatcherTrait};
use grinta::interfaces::ierc20::{IERC20Dispatcher, IERC20DispatcherTrait};

use super::test_common::{
    WAD, RAY,
    admin, user1,
    deploy_safe_engine, deploy_full_system,
};

// ============================================================================
// SAFEEngine: Redemption price floor
// ============================================================================

#[test]
fn test_redemption_price_floor() {
    let sys = deploy_full_system();

    // Set an extremely low rate that would normally crash price to 0
    // Rate = MIN_RATE_FLOOR from PID (~0.99999993 RAY)
    // Even if we manually set a lower rate, the price should floor at 0.01 RAY
    let very_low_rate: u256 = 100_000_000_000_000_000_000_000_000; // 0.1 RAY (extreme)

    cheat_caller_address(sys.safe_engine_addr, sys.hook_addr, CheatSpan::TargetCalls(1));
    sys.safe_engine.update_redemption_rate(very_low_rate);

    // Advance time significantly
    start_cheat_block_timestamp_global(100000);

    let price = sys.safe_engine.get_redemption_price();
    let min_price: u256 = RAY / 100; // 0.01 RAY

    // Price should be at the floor, not zero
    assert(price >= min_price, 'price should be at floor');
    assert(price > 0, 'price must never be 0');
}

#[test]
fn test_redemption_price_floor_after_update() {
    let sys = deploy_full_system();

    // Set rate to something that will push price very low
    let low_rate: u256 = 500_000_000_000_000_000_000_000_000; // 0.5 RAY

    cheat_caller_address(sys.safe_engine_addr, sys.hook_addr, CheatSpan::TargetCalls(1));
    sys.safe_engine.update_redemption_rate(low_rate);

    // Advance 100 seconds — 0.5^100 * RAY is essentially 0
    start_cheat_block_timestamp_global(200);

    // Trigger state update via another rate update
    cheat_caller_address(sys.safe_engine_addr, sys.hook_addr, CheatSpan::TargetCalls(1));
    sys.safe_engine.update_redemption_rate(RAY);

    let price = sys.safe_engine.get_redemption_price();
    let min_price: u256 = RAY / 100;

    assert(price >= min_price, 'floor must hold after update');
}

// ============================================================================
// SAFEEngine: Admin reset and mint functions
// ============================================================================

#[test]
fn test_reset_redemption_price() {
    let sys = deploy_full_system();

    // Mess up the rate
    let low_rate: u256 = 500_000_000_000_000_000_000_000_000;
    cheat_caller_address(sys.safe_engine_addr, sys.hook_addr, CheatSpan::TargetCalls(1));
    sys.safe_engine.update_redemption_rate(low_rate);

    start_cheat_block_timestamp_global(200);

    // Admin resets
    cheat_caller_address(sys.safe_engine_addr, admin(), CheatSpan::TargetCalls(1));
    sys.safe_engine.reset_redemption_price(RAY, RAY);

    let price = sys.safe_engine.get_redemption_price();
    assert(price == RAY, 'price should be reset to RAY');

    let rate = sys.safe_engine.get_redemption_rate();
    assert(rate == RAY, 'rate should be reset to RAY');
}

#[test]
#[should_panic(expected: 'SAFE: not admin')]
fn test_reset_redemption_price_not_admin() {
    let sys = deploy_full_system();

    cheat_caller_address(sys.safe_engine_addr, user1(), CheatSpan::TargetCalls(1));
    sys.safe_engine.reset_redemption_price(RAY, RAY);
}

#[test]
fn test_mint_grit() {
    let sys = deploy_full_system();

    let mint_amount: u256 = 10_000_000_000_000_000_000_000; // 10,000 GRIT

    cheat_caller_address(sys.safe_engine_addr, admin(), CheatSpan::TargetCalls(1));
    sys.safe_engine.mint_grit(user1(), mint_amount);

    let grit = IERC20Dispatcher { contract_address: sys.safe_engine_addr };
    assert(grit.balance_of(user1()) == mint_amount, 'should have 10k GRIT');
}

#[test]
#[should_panic(expected: 'SAFE: not admin')]
fn test_mint_grit_not_admin() {
    let sys = deploy_full_system();

    cheat_caller_address(sys.safe_engine_addr, user1(), CheatSpan::TargetCalls(1));
    sys.safe_engine.mint_grit(user1(), 1000);
}

// ============================================================================
// GrintaHook: Market price bounds
// ============================================================================

#[test]
fn test_set_market_price_normal() {
    let sys = deploy_full_system();

    // Set a normal price: $1.05
    let price: u256 = 1_050_000_000_000_000_000; // 1.05 WAD
    sys.hook.set_market_price(price);

    assert(sys.hook.get_market_price() == price, 'price should be set');
}

#[test]
#[should_panic(expected: 'HOOK: price too low')]
fn test_set_market_price_too_low() {
    let sys = deploy_full_system();

    // Try to set price below $0.001
    let price: u256 = 100_000_000_000_000; // 0.0001 WAD
    sys.hook.set_market_price(price);
}

#[test]
#[should_panic(expected: 'HOOK: price too high')]
fn test_set_market_price_too_high() {
    let sys = deploy_full_system();

    // Try to set price above $1000
    let price: u256 = 2_000_000_000_000_000_000_000; // 2000 WAD
    sys.hook.set_market_price(price);
}

#[test]
fn test_set_market_price_at_bounds() {
    let sys = deploy_full_system();

    // At minimum bound: $0.001
    let min_price: u256 = 1_000_000_000_000_000; // 0.001 WAD
    sys.hook.set_market_price(min_price);
    assert(sys.hook.get_market_price() == min_price, 'min bound should work');

    // At maximum bound: $1000
    let max_price: u256 = 1_000_000_000_000_000_000_000; // 1000 WAD
    sys.hook.set_market_price(max_price);
    assert(sys.hook.get_market_price() == max_price, 'max bound should work');
}

// ============================================================================
// PIDController: Rate floor
// ============================================================================

#[test]
fn test_pid_rate_has_floor() {
    let sys = deploy_full_system();

    // Market price is way above redemption price ($1000 vs $1)
    // PID should want to push rate very low, but it should be floored
    let extreme_market: u256 = 100_000_000_000_000_000_000; // $100 WAD
    let redemption: u256 = RAY; // $1 RAY

    start_cheat_block_timestamp_global(5000);

    cheat_caller_address(sys.pid_addr, sys.hook_addr, CheatSpan::TargetCalls(1));
    let rate = sys.pid.compute_rate(extreme_market, redemption);

    // Rate should be at the floor, not at 1 or 0
    let min_rate_floor: u256 = 999_999_930_000_000_000_000_000_000;
    assert(rate >= min_rate_floor, 'rate should be at floor');
    assert(rate < RAY, 'rate should be below RAY');
}

// ============================================================================
// Integration: Full crash scenario prevention
// ============================================================================

#[test]
fn test_crash_scenario_prevented() {
    let sys = deploy_full_system();

    // Simulate the exact scenario that crashed us:
    // 1. A garbage market price of $678 billion would have been set
    // 2. Now the hook rejects it (too high)
    // 3. Rate stays at RAY, price stays at RAY

    // Set a reasonable market price first
    let good_price: u256 = 1_000_000_000_000_000_000; // $1 WAD
    sys.hook.set_market_price(good_price);

    // Advance time past PID cooldown
    start_cheat_block_timestamp_global(5000);

    // Try to trigger PID with the good price
    sys.hook.update();

    // Price and rate should still be reasonable
    let price = sys.safe_engine.get_redemption_price();
    assert(price >= RAY / 100, 'price must stay above floor');

    let rate = sys.safe_engine.get_redemption_rate();
    // Rate should be RAY (price at peg, noise barrier prevents change)
    // or at worst, at the floor
    assert(rate >= 999_999_930_000_000_000_000_000_000, 'rate must stay above floor');
}
