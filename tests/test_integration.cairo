use snforge_std::{cheat_caller_address, CheatSpan, start_cheat_block_timestamp_global};

use grinta::interfaces::isafe_engine::{ISAFEEngineDispatcherTrait};
use grinta::interfaces::isafe_manager::{ISafeManagerDispatcherTrait};
use grinta::interfaces::ipid_controller::{IPIDControllerDispatcherTrait};
use grinta::interfaces::ierc20::{IERC20Dispatcher, IERC20DispatcherTrait};

use super::test_common::{
    WAD, RAY, BTC_PRICE_WAD, user1,
    deploy_full_system, fund_user_wbtc, approve_join,
};

// ============================================================================
// Test 1: Full borrow flow
// ============================================================================
#[test]
fn test_full_borrow_flow() {
    let sys = deploy_full_system();
    let one_wbtc: u256 = 100_000_000;
    let borrow_amount: u256 = 30_000_000_000_000_000_000_000; // 30,000e18

    fund_user_wbtc(sys.wbtc_addr, user1(), one_wbtc);
    approve_join(sys.wbtc_addr, user1(), sys.join_addr, one_wbtc);

    cheat_caller_address(sys.manager_addr, user1(), CheatSpan::TargetCalls(1));
    let safe_id = sys.manager.open_safe();
    cheat_caller_address(sys.manager_addr, user1(), CheatSpan::TargetCalls(1));
    sys.manager.deposit(safe_id, one_wbtc);
    cheat_caller_address(sys.manager_addr, user1(), CheatSpan::TargetCalls(1));
    sys.manager.borrow(safe_id, borrow_amount);

    // Verify WBTC left user
    let wbtc = IERC20Dispatcher { contract_address: sys.wbtc_addr };
    assert(wbtc.balance_of(user1()) == 0, 'user should have 0 WBTC');

    // Verify Grit received
    let grit = IERC20Dispatcher { contract_address: sys.safe_engine_addr };
    assert(grit.balance_of(user1()) == borrow_amount, 'wrong grit balance');

    // Verify safe state
    let safe = sys.safe_engine.get_safe(safe_id);
    assert(safe.collateral == WAD, 'should have 1e18 col');
    assert(safe.debt == borrow_amount, 'should have 30k debt');

    // Verify system totals
    assert(sys.safe_engine.get_total_collateral() == WAD, 'total col wrong');
    assert(sys.safe_engine.get_total_debt() == borrow_amount, 'total debt wrong');

    // Verify health
    let health = sys.safe_engine.get_safe_health(safe_id);
    assert(health.collateral_value == BTC_PRICE_WAD, 'col value should be 60k');
    assert(health.debt == borrow_amount, 'health debt wrong');
    assert(health.ltv > 0, 'ltv should be positive');
}

// ============================================================================
// Test 2: PID adjusts redemption price
// ============================================================================
#[test]
fn test_pid_adjusts_redemption_price() {
    let sys = deploy_full_system();

    assert(sys.safe_engine.get_redemption_rate() == RAY, 'rate should start at RAY');
    assert(sys.safe_engine.get_redemption_price() == RAY, 'price should start at RAY');

    // Simulate: market below peg
    let market_below: u256 = 900_000_000_000_000_000; // 0.9 WAD
    let redemption: u256 = RAY;

    start_cheat_block_timestamp_global(1000);

    // Call PID as hook
    cheat_caller_address(sys.pid_addr, sys.hook_addr, CheatSpan::TargetCalls(1));
    let new_rate = sys.pid.compute_rate(market_below, redemption);

    assert(new_rate > RAY, 'rate should be > RAY');

    // Push to SAFEEngine
    cheat_caller_address(sys.safe_engine_addr, sys.hook_addr, CheatSpan::TargetCalls(1));
    sys.safe_engine.update_redemption_rate(new_rate);

    assert(sys.safe_engine.get_redemption_rate() == new_rate, 'rate not stored');

    // Advance 1 hour
    start_cheat_block_timestamp_global(1000 + 3600);

    let new_price = sys.safe_engine.get_redemption_price();
    assert(new_price > RAY, 'price should have increased');
}
