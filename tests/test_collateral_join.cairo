use snforge_std::{cheat_caller_address, CheatSpan};

use grinta::interfaces::icollateral_join::{ICollateralJoinDispatcher, ICollateralJoinDispatcherTrait};
use grinta::interfaces::isafe_engine::{ISAFEEngineDispatcherTrait};
use grinta::interfaces::ierc20::{IERC20Dispatcher, IERC20DispatcherTrait};

use super::test_common::{
    WAD, admin, user1,
    deploy_mock_wbtc, deploy_safe_engine, deploy_collateral_join,
    deploy_safe_manager, fund_user_wbtc, approve_join,
    IJoinSetManagerDispatcher, IJoinSetManagerDispatcherTrait,
};

/// Deploy a minimal CollateralJoin system (no full system needed)
fn setup() -> (
    starknet::ContractAddress, // wbtc_addr
    IERC20Dispatcher,          // wbtc
    starknet::ContractAddress, // join_addr
    ICollateralJoinDispatcher, // join
    starknet::ContractAddress, // manager_addr
) {
    let admin_addr = admin();
    let (wbtc_addr, wbtc) = deploy_mock_wbtc();
    let (safe_engine_addr, safe_engine) = deploy_safe_engine(admin_addr);
    let (join_addr, join) = deploy_collateral_join(admin_addr, wbtc_addr, safe_engine_addr);
    let (manager_addr, _manager) = deploy_safe_manager(admin_addr, safe_engine_addr, join_addr);

    // Set safe_manager on CollateralJoin
    let join_admin = IJoinSetManagerDispatcher { contract_address: join_addr };
    cheat_caller_address(join_addr, admin_addr, CheatSpan::TargetCalls(1));
    join_admin.set_safe_manager(manager_addr);

    // Wire up safe_engine
    cheat_caller_address(safe_engine_addr, admin_addr, CheatSpan::TargetCalls(1));
    safe_engine.set_safe_manager(manager_addr);
    cheat_caller_address(safe_engine_addr, admin_addr, CheatSpan::TargetCalls(1));
    safe_engine.set_collateral_join(join_addr);

    (wbtc_addr, wbtc, join_addr, join, manager_addr)
}

// ============================================================================
// Test 1: Join — deposit WBTC, get WAD internal amount
// ============================================================================
#[test]
fn test_join() {
    let (wbtc_addr, _wbtc, join_addr, join, manager_addr) = setup();
    let one_wbtc: u256 = 100_000_000; // 1e8

    fund_user_wbtc(wbtc_addr, user1(), one_wbtc);
    approve_join(wbtc_addr, user1(), join_addr, one_wbtc);

    cheat_caller_address(join_addr, manager_addr, CheatSpan::TargetCalls(1));
    let internal = join.join(user1(), one_wbtc);

    assert(internal == WAD, 'should convert to 1e18');
    assert(join.get_total_assets() == one_wbtc, 'total assets wrong');
}

// ============================================================================
// Test 2: Exit — get WBTC back
// ============================================================================
#[test]
fn test_exit() {
    let (wbtc_addr, wbtc, join_addr, join, manager_addr) = setup();
    let one_wbtc: u256 = 100_000_000;

    fund_user_wbtc(wbtc_addr, user1(), one_wbtc);
    approve_join(wbtc_addr, user1(), join_addr, one_wbtc);

    cheat_caller_address(join_addr, manager_addr, CheatSpan::TargetCalls(1));
    let internal = join.join(user1(), one_wbtc);

    cheat_caller_address(join_addr, manager_addr, CheatSpan::TargetCalls(1));
    let asset_out = join.exit(user1(), internal);

    assert(asset_out == one_wbtc, 'should get 1e8 back');
    assert(wbtc.balance_of(user1()) == one_wbtc, 'user should have WBTC back');
    assert(join.get_total_assets() == 0, 'total should be 0');
}

// ============================================================================
// Test 3: Decimal conversion — verify 1 WBTC (1e8) = 1e18 internal
// ============================================================================
#[test]
fn test_decimal_conversion() {
    let (_wbtc_addr, _wbtc, _join_addr, join, _manager_addr) = setup();

    let internal = join.convert_to_internal(100_000_000);
    assert(internal == WAD, '1e8 should be 1e18 internal');

    let assets = join.convert_to_assets(WAD);
    assert(assets == 100_000_000, '1e18 should be 1e8 assets');

    let small_asset: u256 = 50_000_000; // 0.5 WBTC
    let small_internal = join.convert_to_internal(small_asset);
    assert(small_internal == 500_000_000_000_000_000, '0.5 WBTC wrong internal');

    let roundtrip = join.convert_to_assets(small_internal);
    assert(roundtrip == small_asset, 'roundtrip should match');
}
