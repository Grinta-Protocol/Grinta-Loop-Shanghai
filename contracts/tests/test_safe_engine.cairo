use snforge_std::{cheat_caller_address, CheatSpan, start_cheat_block_timestamp_global};

use grinta::interfaces::isafe_engine::{ISAFEEngineDispatcherTrait};
use grinta::interfaces::isafe_manager::{ISafeManagerDispatcherTrait};
use grinta::interfaces::ierc20::{IERC20Dispatcher, IERC20DispatcherTrait};

use super::test_common::{
    WAD, RAY, DEBT_CEILING, LIQUIDATION_RATIO,
    admin, user1,
    deploy_safe_engine, deploy_full_system, fund_user_wbtc, approve_join,
};

// ============================================================================
// Test 1: Deploy — check initial state
// ============================================================================
#[test]
fn test_deploy() {
    let (_, engine) = deploy_safe_engine(admin());

    assert(engine.get_safe_count() == 0, 'count should be 0');
    assert(engine.get_redemption_price() == RAY, 'rPrice should be RAY');
    assert(engine.get_redemption_rate() == RAY, 'rate should be RAY');
    assert(engine.get_debt_ceiling() == DEBT_CEILING, 'wrong ceiling');
    assert(engine.get_liquidation_ratio() == LIQUIDATION_RATIO, 'wrong liq ratio');
    assert(engine.get_total_debt() == 0, 'total debt should be 0');
    assert(engine.get_total_collateral() == 0, 'total col should be 0');
}

// ============================================================================
// Test 2: Create safe
// ============================================================================
#[test]
fn test_create_safe() {
    let sys = deploy_full_system();

    cheat_caller_address(sys.manager_addr, user1(), CheatSpan::TargetCalls(1));
    let safe_id = sys.manager.open_safe();

    assert(safe_id == 1, 'first safe should be 1');
    assert(sys.safe_engine.get_safe_count() == 1, 'count should be 1');
    assert(sys.safe_engine.get_safe_owner(safe_id) == user1(), 'wrong owner');

    let safe = sys.safe_engine.get_safe(safe_id);
    assert(safe.collateral == 0, 'col should be 0');
    assert(safe.debt == 0, 'debt should be 0');
}

// ============================================================================
// Test 3: Deposit collateral
// ============================================================================
#[test]
fn test_deposit_collateral() {
    let sys = deploy_full_system();
    let one_wbtc: u256 = 100_000_000;
    let one_wbtc_wad: u256 = WAD;

    fund_user_wbtc(sys.wbtc_addr, user1(), one_wbtc);
    approve_join(sys.wbtc_addr, user1(), sys.join_addr, one_wbtc);

    cheat_caller_address(sys.manager_addr, user1(), CheatSpan::TargetCalls(1));
    let safe_id = sys.manager.open_safe();

    cheat_caller_address(sys.manager_addr, user1(), CheatSpan::TargetCalls(1));
    sys.manager.deposit(safe_id, one_wbtc);

    let safe = sys.safe_engine.get_safe(safe_id);
    assert(safe.collateral == one_wbtc_wad, 'should have 1e18 collateral');
    assert(sys.safe_engine.get_total_collateral() == one_wbtc_wad, 'total col wrong');
}

// ============================================================================
// Test 4: Borrow Grit
// ============================================================================
#[test]
fn test_borrow() {
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

    let safe = sys.safe_engine.get_safe(safe_id);
    assert(safe.debt == borrow_amount, 'wrong debt');

    let grit = IERC20Dispatcher { contract_address: sys.safe_engine_addr };
    assert(grit.balance_of(user1()) == borrow_amount, 'wrong grit balance');
    assert(sys.safe_engine.get_total_debt() == borrow_amount, 'wrong total debt');
}

// ============================================================================
// Test 5: Borrow undercollateralized — should panic
// ============================================================================
#[test]
#[should_panic(expected: 'SAFE: undercollateralized')]
fn test_borrow_undercollateralized() {
    let sys = deploy_full_system();
    let one_wbtc: u256 = 100_000_000;
    let too_much: u256 = 50_000_000_000_000_000_000_000; // 50,000e18

    fund_user_wbtc(sys.wbtc_addr, user1(), one_wbtc);
    approve_join(sys.wbtc_addr, user1(), sys.join_addr, one_wbtc);

    cheat_caller_address(sys.manager_addr, user1(), CheatSpan::TargetCalls(1));
    let safe_id = sys.manager.open_safe();
    cheat_caller_address(sys.manager_addr, user1(), CheatSpan::TargetCalls(1));
    sys.manager.deposit(safe_id, one_wbtc);
    cheat_caller_address(sys.manager_addr, user1(), CheatSpan::TargetCalls(1));
    sys.manager.borrow(safe_id, too_much);
}

// ============================================================================
// Test 6: Repay
// ============================================================================
#[test]
fn test_repay() {
    let sys = deploy_full_system();
    let one_wbtc: u256 = 100_000_000;
    let borrow_amount: u256 = 30_000_000_000_000_000_000_000;
    let repay_amount: u256 = 10_000_000_000_000_000_000_000;

    fund_user_wbtc(sys.wbtc_addr, user1(), one_wbtc);
    approve_join(sys.wbtc_addr, user1(), sys.join_addr, one_wbtc);

    cheat_caller_address(sys.manager_addr, user1(), CheatSpan::TargetCalls(1));
    let safe_id = sys.manager.open_safe();
    cheat_caller_address(sys.manager_addr, user1(), CheatSpan::TargetCalls(1));
    sys.manager.deposit(safe_id, one_wbtc);
    cheat_caller_address(sys.manager_addr, user1(), CheatSpan::TargetCalls(1));
    sys.manager.borrow(safe_id, borrow_amount);
    cheat_caller_address(sys.manager_addr, user1(), CheatSpan::TargetCalls(1));
    sys.manager.repay(safe_id, repay_amount);

    let safe = sys.safe_engine.get_safe(safe_id);
    assert(safe.debt == borrow_amount - repay_amount, 'debt should decrease');

    let grit = IERC20Dispatcher { contract_address: sys.safe_engine_addr };
    assert(grit.balance_of(user1()) == borrow_amount - repay_amount, 'grit balance wrong');
}

// ============================================================================
// Test 7: Withdraw collateral
// ============================================================================
#[test]
fn test_withdraw_collateral() {
    let sys = deploy_full_system();
    let two_wbtc: u256 = 200_000_000;
    let borrow_amount: u256 = 30_000_000_000_000_000_000_000;

    fund_user_wbtc(sys.wbtc_addr, user1(), two_wbtc);
    approve_join(sys.wbtc_addr, user1(), sys.join_addr, two_wbtc);

    cheat_caller_address(sys.manager_addr, user1(), CheatSpan::TargetCalls(1));
    let safe_id = sys.manager.open_safe();
    cheat_caller_address(sys.manager_addr, user1(), CheatSpan::TargetCalls(1));
    sys.manager.deposit(safe_id, two_wbtc);
    cheat_caller_address(sys.manager_addr, user1(), CheatSpan::TargetCalls(1));
    sys.manager.borrow(safe_id, borrow_amount);

    // Withdraw 0.5 WBTC (internal WAD)
    let withdraw_internal: u256 = 500_000_000_000_000_000;
    cheat_caller_address(sys.manager_addr, user1(), CheatSpan::TargetCalls(1));
    sys.manager.withdraw(safe_id, withdraw_internal);

    let safe = sys.safe_engine.get_safe(safe_id);
    let expected_col: u256 = 1_500_000_000_000_000_000; // 1.5e18
    assert(safe.collateral == expected_col, 'collateral wrong after withdraw');
}

// ============================================================================
// Test 8: Redemption price update
// ============================================================================
#[test]
fn test_redemption_price_update() {
    let sys = deploy_full_system();

    let new_rate: u256 = 1_000_000_100_000_000_000_000_000_000; // RAY + 1e20

    cheat_caller_address(sys.safe_engine_addr, sys.hook_addr, CheatSpan::TargetCalls(1));
    sys.safe_engine.update_redemption_rate(new_rate);

    start_cheat_block_timestamp_global(3600);

    let new_price = sys.safe_engine.get_redemption_price();
    assert(new_price > RAY, 'price should have increased');
}
