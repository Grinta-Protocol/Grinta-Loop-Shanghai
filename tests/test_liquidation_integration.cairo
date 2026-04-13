use starknet::ContractAddress;
use snforge_std::{
    declare, DeclareResultTrait, ContractClassTrait,
    cheat_caller_address, CheatSpan, start_cheat_block_timestamp_global,
};

use grinta::interfaces::isafe_engine::{ISAFEEngineDispatcher, ISAFEEngineDispatcherTrait};
use grinta::interfaces::isafe_manager::{ISafeManagerDispatcher, ISafeManagerDispatcherTrait};
use grinta::interfaces::iliquidation_engine::{ILiquidationEngineDispatcher, ILiquidationEngineDispatcherTrait};
use grinta::interfaces::icollateral_auction_house::{ICollateralAuctionHouseDispatcher, ICollateralAuctionHouseDispatcherTrait};
use grinta::interfaces::iaccounting_engine::{IAccountingEngineDispatcher, IAccountingEngineDispatcherTrait};
use grinta::interfaces::igrinta_hook::{IGrintaHookDispatcherTrait};
use grinta::interfaces::ierc20::{IERC20Dispatcher, IERC20DispatcherTrait};

use super::test_common::{
    WAD, BTC_PRICE_WAD, admin, user1, user2,
    deploy_safe_engine, deploy_mock_wbtc, deploy_collateral_join,
    deploy_grinta_hook, deploy_safe_manager, deploy_pid_controller,
    fund_user_wbtc, approve_join,
    IJoinSetManagerDispatcher, IJoinSetManagerDispatcherTrait,
    IJoinSetLiqDispatcher, IJoinSetLiqDispatcherTrait,
    IOracleUpdateDispatcher, IOracleUpdateDispatcherTrait,
    IPIDSetSeedDispatcher, IPIDSetSeedDispatcherTrait,
    IMintableDispatcher, IMintableDispatcherTrait,
};

// ============================================================================
// Constants
// ============================================================================

const LIQUIDATION_PENALTY: u256 = 1_130_000_000_000_000_000; // 1.13 WAD (13%)
const MAX_LIQ_QUANTITY: u256 = 100_000_000_000_000_000_000_000; // 100k WAD
const ON_AUCTION_LIMIT: u256 = 500_000_000_000_000_000_000_000; // 500k WAD

const MIN_DISCOUNT: u256 = 950_000_000_000_000_000; // 0.95 WAD
const MAX_DISCOUNT: u256 = 800_000_000_000_000_000; // 0.80 WAD
const DISCOUNT_RATE: u256 = 999_999_833_000_000_000_000_000_000;
const MINIMUM_BID: u256 = 10_000_000_000_000_000_000; // 10 WAD

// ============================================================================
// Deploy helpers
// ============================================================================

fn deploy_accounting_engine(
    admin_addr: ContractAddress, safe_engine_addr: ContractAddress,
) -> (ContractAddress, IAccountingEngineDispatcher) {
    let contract = declare("AccountingEngine").unwrap().contract_class();
    let mut calldata: Array<felt252> = array![];
    calldata.append(admin_addr.into());
    calldata.append(safe_engine_addr.into());
    let (addr, _) = contract.deploy(@calldata).unwrap();
    (addr, IAccountingEngineDispatcher { contract_address: addr })
}

fn deploy_auction_house(
    admin_addr: ContractAddress,
    safe_engine_addr: ContractAddress,
    liq_engine_addr: ContractAddress,
    ae_addr: ContractAddress,
    collateral_token: ContractAddress,
) -> (ContractAddress, ICollateralAuctionHouseDispatcher) {
    let contract = declare("CollateralAuctionHouse").unwrap().contract_class();
    let mut calldata: Array<felt252> = array![];
    calldata.append(admin_addr.into());
    calldata.append(safe_engine_addr.into());
    calldata.append(liq_engine_addr.into());
    calldata.append(ae_addr.into());
    calldata.append(collateral_token.into());
    calldata.append(MIN_DISCOUNT.low.into());
    calldata.append(MIN_DISCOUNT.high.into());
    calldata.append(MAX_DISCOUNT.low.into());
    calldata.append(MAX_DISCOUNT.high.into());
    calldata.append(DISCOUNT_RATE.low.into());
    calldata.append(DISCOUNT_RATE.high.into());
    calldata.append(MINIMUM_BID.low.into());
    calldata.append(MINIMUM_BID.high.into());
    let (addr, _) = contract.deploy(@calldata).unwrap();
    (addr, ICollateralAuctionHouseDispatcher { contract_address: addr })
}

fn deploy_liquidation_engine(
    admin_addr: ContractAddress,
    safe_engine_addr: ContractAddress,
    join_addr: ContractAddress,
    auction_house_addr: ContractAddress,
    ae_addr: ContractAddress,
) -> (ContractAddress, ILiquidationEngineDispatcher) {
    let contract = declare("LiquidationEngine").unwrap().contract_class();
    let mut calldata: Array<felt252> = array![];
    calldata.append(admin_addr.into());
    calldata.append(safe_engine_addr.into());
    calldata.append(join_addr.into());
    calldata.append(auction_house_addr.into());
    calldata.append(ae_addr.into());
    calldata.append(LIQUIDATION_PENALTY.low.into());
    calldata.append(LIQUIDATION_PENALTY.high.into());
    calldata.append(MAX_LIQ_QUANTITY.low.into());
    calldata.append(MAX_LIQ_QUANTITY.high.into());
    calldata.append(ON_AUCTION_LIMIT.low.into());
    calldata.append(ON_AUCTION_LIMIT.high.into());
    let (addr, _) = contract.deploy(@calldata).unwrap();
    (addr, ILiquidationEngineDispatcher { contract_address: addr })
}

// ============================================================================
// Full system with REAL wiring (no dummies)
// ============================================================================

#[derive(Drop)]
struct FullSystem {
    wbtc_addr: ContractAddress,
    se_addr: ContractAddress,
    se: ISAFEEngineDispatcher,
    join_addr: ContractAddress,
    manager_addr: ContractAddress,
    manager: ISafeManagerDispatcher,
    ae_addr: ContractAddress,
    ae: IAccountingEngineDispatcher,
    ah_addr: ContractAddress,
    ah: ICollateralAuctionHouseDispatcher,
    le_addr: ContractAddress,
    le: ILiquidationEngineDispatcher,
    hook_addr: ContractAddress,
    oracle_addr: ContractAddress,
}

fn setup_full_system() -> FullSystem {
    let admin_addr = admin();
    start_cheat_block_timestamp_global(100);

    // 1. Deploy base contracts
    let (wbtc_addr, _wbtc) = deploy_mock_wbtc();
    let oracle_addr = super::test_common::deploy_oracle_relayer();
    let (se_addr, se) = deploy_safe_engine(admin_addr);
    let (join_addr, _join) = deploy_collateral_join(admin_addr, wbtc_addr, se_addr);

    // 2. Deploy PID + Hook
    let (pid_addr, _pid) = deploy_pid_controller(admin_addr, admin_addr);
    let usdc_mock: ContractAddress = 'usdc'.try_into().unwrap();
    let zero: ContractAddress = 0.try_into().unwrap();
    let (hook_addr, hook) = deploy_grinta_hook(
        admin_addr, se_addr, pid_addr, oracle_addr, zero, se_addr, wbtc_addr, usdc_mock,
    );

    // 3. Deploy SafeManager
    let (manager_addr, manager) = deploy_safe_manager(admin_addr, se_addr, join_addr, hook_addr);

    // 4. Deploy liquidation system — solve chicken-and-egg with set_auction_house
    let (ae_addr, ae) = deploy_accounting_engine(admin_addr, se_addr);

    // Deploy LE first with a dummy AH address
    let dummy_ah: ContractAddress = 'dummy_ah'.try_into().unwrap();
    let (le_addr, le) = deploy_liquidation_engine(admin_addr, se_addr, join_addr, dummy_ah, ae_addr);

    // Deploy real AH with real LE address
    let (ah_addr, ah) = deploy_auction_house(admin_addr, se_addr, le_addr, ae_addr, wbtc_addr);

    // Now update LE with the real AH address
    cheat_caller_address(le_addr, admin_addr, CheatSpan::TargetCalls(1));
    le.set_auction_house(ah_addr);

    // 5. Wire SAFEEngine permissions
    cheat_caller_address(se_addr, admin_addr, CheatSpan::TargetCalls(1));
    se.set_safe_manager(manager_addr);
    cheat_caller_address(se_addr, admin_addr, CheatSpan::TargetCalls(1));
    se.set_hook(hook_addr);
    cheat_caller_address(se_addr, admin_addr, CheatSpan::TargetCalls(1));
    se.set_collateral_join(join_addr);
    cheat_caller_address(se_addr, admin_addr, CheatSpan::TargetCalls(1));
    se.set_liquidation_engine(le_addr);
    cheat_caller_address(se_addr, admin_addr, CheatSpan::TargetCalls(1));
    se.set_accounting_engine(ae_addr);

    // Wire CollateralJoin
    let join_admin = IJoinSetManagerDispatcher { contract_address: join_addr };
    cheat_caller_address(join_addr, admin_addr, CheatSpan::TargetCalls(1));
    join_admin.set_safe_manager(manager_addr);

    let join_liq = IJoinSetLiqDispatcher { contract_address: join_addr };
    cheat_caller_address(join_addr, admin_addr, CheatSpan::TargetCalls(1));
    join_liq.set_liquidation_engine(le_addr);

    // Wire PID
    let pid_admin = IPIDSetSeedDispatcher { contract_address: pid_addr };
    cheat_caller_address(pid_addr, admin_addr, CheatSpan::TargetCalls(1));
    pid_admin.set_seed_proposer(hook_addr);

    // Wire AccountingEngine
    cheat_caller_address(ae_addr, admin_addr, CheatSpan::TargetCalls(1));
    ae.set_liquidation_engine(le_addr);
    cheat_caller_address(ae_addr, admin_addr, CheatSpan::TargetCalls(1));
    ae.set_auction_house(ah_addr);

    // 6. Set BTC price via oracle → hook
    let oracle_updater = IOracleUpdateDispatcher { contract_address: oracle_addr };
    oracle_updater.update_price(wbtc_addr, usdc_mock, BTC_PRICE_WAD);
    hook.update();

    FullSystem {
        wbtc_addr, se_addr, se, join_addr, manager_addr, manager,
        ae_addr, ae, ah_addr, ah, le_addr, le, hook_addr, oracle_addr,
    }
}

/// Open a safe with 1 WBTC and borrow a given amount of GRIT
fn open_safe_with_debt(s: @FullSystem, borrower: ContractAddress, borrow_amount: u256) -> u64 {
    let one_wbtc = 100_000_000_u256;
    fund_user_wbtc(*s.wbtc_addr, borrower, one_wbtc);
    approve_join(*s.wbtc_addr, borrower, *s.join_addr, one_wbtc);

    cheat_caller_address(*s.manager_addr, borrower, CheatSpan::TargetCalls(1));
    let safe_id = (*s.manager).open_and_borrow(one_wbtc, borrow_amount);
    safe_id
}

// ============================================================================
// Integration Tests
// ============================================================================

/// Full lifecycle: borrow → price drop → liquidate → auction buy → settle debt
#[test]
fn test_full_liquidation_cycle() {
    let s = setup_full_system();
    let borrower = user1();
    let liquidator = user2();

    // 1. Borrower opens a safe: 1 BTC ($60k), borrows 30k GRIT
    let borrow_amount = 30_000 * WAD;
    let safe_id = open_safe_with_debt(@s, borrower, borrow_amount);

    // Verify initial state
    let safe = s.se.get_safe(safe_id);
    assert(safe.collateral == WAD, 'initial col should be 1 BTC');
    assert(safe.debt == borrow_amount, 'initial debt should be 30k');
    assert(!s.le.is_liquidatable(safe_id), 'should be healthy initially');

    // 2. BTC price drops to $40k → safe becomes unhealthy
    // col_value = 1 BTC * $40k = $40k
    // Required: col_value >= debt * 1.5 → $40k < $45k → UNHEALTHY
    let crashed_price = 40_000 * WAD;
    cheat_caller_address(s.se_addr, s.hook_addr, CheatSpan::TargetCalls(1));
    s.se.update_collateral_price(crashed_price);

    assert(s.le.is_liquidatable(safe_id), 'should be liquidatable');

    // Record pre-liquidation WBTC balance of CollateralJoin
    let wbtc = IERC20Dispatcher { contract_address: s.wbtc_addr };
    let join_wbtc_before = wbtc.balance_of(s.join_addr);

    // 3. Anyone can call liquidate() — it's permissionless
    let auction_id = s.le.liquidate(safe_id);
    assert(auction_id == 1, 'first auction');

    // Verify safe was confiscated
    let safe_after = s.se.get_safe(safe_id);
    assert(safe_after.collateral == 0, 'col should be 0');
    assert(safe_after.debt == 0, 'debt should be 0');

    // Verify AuctionHouse received WBTC
    let ah_wbtc = wbtc.balance_of(s.ah_addr);
    assert(ah_wbtc > 0, 'AH should hold WBTC');

    // Verify CollateralJoin lost WBTC
    let join_wbtc_after = wbtc.balance_of(s.join_addr);
    assert(join_wbtc_after < join_wbtc_before, 'join should lose WBTC');

    // Verify on-auction debt tracking
    assert(s.le.get_current_on_auction_system_debt() == borrow_amount, 'on-auction tracking');

    // Verify AccountingEngine received queued debt
    assert(s.ae.get_total_queued_debt() == borrow_amount, 'queued debt should match');

    // Verify auction was created with penalty
    let auction = s.ah.get_auction(1);
    assert(!auction.settled, 'not settled yet');
    // debt_to_raise = 30k * 1.13 = 33,900 GRIT
    let expected_auction_debt = 33_900 * WAD;
    // Allow small rounding tolerance
    let diff = if auction.debt_to_raise > expected_auction_debt {
        auction.debt_to_raise - expected_auction_debt
    } else {
        expected_auction_debt - auction.debt_to_raise
    };
    assert(diff < WAD, 'auction debt ~33.9k');

    // 4. Liquidator buys collateral from auction
    // At discount=0.95, price=$40k: discounted price = 40k * 0.95 = 38k GRIT per BTC
    // Need enough GRIT to cover auction debt (~33.9k)
    // Mint GRIT for the liquidator
    let liquidator_grit = 40_000 * WAD;
    cheat_caller_address(s.se_addr, admin(), CheatSpan::TargetCalls(1));
    s.se.mint_grit(liquidator, liquidator_grit);

    // Approve AuctionHouse to spend liquidator's GRIT
    let grit = IERC20Dispatcher { contract_address: s.se_addr };
    cheat_caller_address(s.se_addr, liquidator, CheatSpan::TargetCalls(1));
    grit.approve(s.ah_addr, liquidator_grit);

    // Buy all collateral
    cheat_caller_address(s.ah_addr, liquidator, CheatSpan::TargetCalls(1));
    let col_received = s.ah.buy_collateral(1, liquidator_grit);
    assert(col_received > 0, 'should receive collateral');

    // Verify auction settled
    let auction_after = s.ah.get_auction(1);
    assert(auction_after.settled, 'should be settled');

    // Verify liquidator received WBTC
    assert(wbtc.balance_of(liquidator) > 0, 'liquidator should have WBTC');

    // Verify liquidator spent GRIT
    assert(grit.balance_of(liquidator) < liquidator_grit, 'liquidator spent GRIT');

    // Verify AccountingEngine received surplus from auction
    assert(s.ae.get_surplus_balance() > 0, 'AE should have surplus');

    // Verify on-auction debt was reduced
    // (remove_coins_from_auction was called by AH on settlement)
    assert(s.le.get_current_on_auction_system_debt() < borrow_amount, 'on-auction should decrease');

    // 5. Settle debt: burn GRIT to cancel out queued debt
    // AccountingEngine holds GRIT (from auction buyer's payment)
    let ae_grit_balance = grit.balance_of(s.ae_addr);
    assert(ae_grit_balance > 0, 'AE should hold GRIT');

    let settled = s.ae.settle_debt();
    assert(settled > 0, 'should settle some debt');

    // After settlement, either surplus or debt (but not both) should remain
    let remaining_surplus = s.ae.get_surplus_balance();
    let remaining_debt = s.ae.get_total_queued_debt();
    // One of them should be 0 (or close to it)
    assert(remaining_surplus == 0 || remaining_debt == 0, 'one should be zero');

    // System totals should reflect the liquidation
    assert(s.se.get_total_debt() == 0, 'system debt should be 0');
    assert(s.se.get_total_collateral() == 0, 'system col should be 0');
}

/// Test that leftover collateral is returned to the safe owner after auction settles
#[test]
fn test_liquidation_leftover_collateral_returned() {
    let s = setup_full_system();
    let borrower = user1();
    let liquidator = user2();

    // Borrow only 20k against 1 BTC ($60k) — lower debt
    let borrow_amount = 20_000 * WAD;
    let safe_id = open_safe_with_debt(@s, borrower, borrow_amount);

    // Drop price to $28k → col_value ($28k) < debt ($20k) * 1.5 ($30k) → unhealthy
    cheat_caller_address(s.se_addr, s.hook_addr, CheatSpan::TargetCalls(1));
    s.se.update_collateral_price(28_000 * WAD);

    assert(s.le.is_liquidatable(safe_id), 'should be liquidatable');

    let wbtc = IERC20Dispatcher { contract_address: s.wbtc_addr };
    let borrower_wbtc_before = wbtc.balance_of(borrower);

    // Liquidate
    s.le.liquidate(safe_id);

    // Auction debt = 20k * 1.13 = 22,600 GRIT
    // At price=$28k, discount=0.95: discounted = $26,600 per BTC
    // Collateral needed for 22.6k GRIT: 22600/26600 ≈ 0.85 BTC
    // So ~0.15 BTC should be returned to the borrower

    // Fund liquidator
    let liquidator_grit = 30_000 * WAD;
    cheat_caller_address(s.se_addr, admin(), CheatSpan::TargetCalls(1));
    s.se.mint_grit(liquidator, liquidator_grit);

    let grit = IERC20Dispatcher { contract_address: s.se_addr };
    cheat_caller_address(s.se_addr, liquidator, CheatSpan::TargetCalls(1));
    grit.approve(s.ah_addr, liquidator_grit);

    cheat_caller_address(s.ah_addr, liquidator, CheatSpan::TargetCalls(1));
    s.ah.buy_collateral(1, liquidator_grit);

    // Verify auction settled
    let auction = s.ah.get_auction(1);
    assert(auction.settled, 'should be settled');

    // Borrower should have gotten some WBTC back (leftover)
    let borrower_wbtc_after = wbtc.balance_of(borrower);
    assert(borrower_wbtc_after > borrower_wbtc_before, 'borrower should get leftover');
}

/// Test partial auction buy (buy some, auction remains open)
#[test]
fn test_partial_auction_buy_then_complete() {
    let s = setup_full_system();
    let borrower = user1();
    let liquidator = user2();

    let borrow_amount = 30_000 * WAD;
    let safe_id = open_safe_with_debt(@s, borrower, borrow_amount);

    // Drop price
    cheat_caller_address(s.se_addr, s.hook_addr, CheatSpan::TargetCalls(1));
    s.se.update_collateral_price(40_000 * WAD);

    s.le.liquidate(safe_id);

    // Fund liquidator with enough for a partial buy
    let partial_amount = 5_000 * WAD;
    cheat_caller_address(s.se_addr, admin(), CheatSpan::TargetCalls(1));
    s.se.mint_grit(liquidator, partial_amount);

    let grit = IERC20Dispatcher { contract_address: s.se_addr };
    cheat_caller_address(s.se_addr, liquidator, CheatSpan::TargetCalls(1));
    grit.approve(s.ah_addr, partial_amount);

    // Partial buy
    cheat_caller_address(s.ah_addr, liquidator, CheatSpan::TargetCalls(1));
    let col1 = s.ah.buy_collateral(1, partial_amount);
    assert(col1 > 0, 'should get some collateral');

    // Auction should NOT be settled
    let auction_mid = s.ah.get_auction(1);
    assert(!auction_mid.settled, 'should not be settled yet');
    assert(auction_mid.collateral_amount > 0, 'col remaining');
    assert(auction_mid.debt_to_raise > 0, 'debt remaining');

    // Second buy: complete the auction
    let remaining_grit = 35_000 * WAD;
    cheat_caller_address(s.se_addr, admin(), CheatSpan::TargetCalls(1));
    s.se.mint_grit(liquidator, remaining_grit);

    cheat_caller_address(s.se_addr, liquidator, CheatSpan::TargetCalls(1));
    grit.approve(s.ah_addr, remaining_grit);

    cheat_caller_address(s.ah_addr, liquidator, CheatSpan::TargetCalls(1));
    s.ah.buy_collateral(1, remaining_grit);

    // Now should be settled
    let auction_final = s.ah.get_auction(1);
    assert(auction_final.settled, 'should be settled now');
}

/// Test buying from a settled auction panics
#[test]
#[should_panic(expected: 'AH: auction settled')]
fn test_cannot_buy_settled_auction() {
    let s = setup_full_system();

    let borrow_amount = 30_000 * WAD;
    let safe_id = open_safe_with_debt(@s, user1(), borrow_amount);

    cheat_caller_address(s.se_addr, s.hook_addr, CheatSpan::TargetCalls(1));
    s.se.update_collateral_price(40_000 * WAD);

    s.le.liquidate(safe_id);

    // Buy everything
    let buyer = user2();
    let buy_grit = 40_000 * WAD;
    cheat_caller_address(s.se_addr, admin(), CheatSpan::TargetCalls(1));
    s.se.mint_grit(buyer, buy_grit);

    let grit = IERC20Dispatcher { contract_address: s.se_addr };
    cheat_caller_address(s.se_addr, buyer, CheatSpan::TargetCalls(1));
    grit.approve(s.ah_addr, buy_grit);

    cheat_caller_address(s.ah_addr, buyer, CheatSpan::TargetCalls(1));
    s.ah.buy_collateral(1, buy_grit);

    // Try to buy again — should panic
    cheat_caller_address(s.se_addr, admin(), CheatSpan::TargetCalls(1));
    s.se.mint_grit(buyer, buy_grit);
    cheat_caller_address(s.se_addr, buyer, CheatSpan::TargetCalls(1));
    grit.approve(s.ah_addr, buy_grit);
    cheat_caller_address(s.ah_addr, buyer, CheatSpan::TargetCalls(1));
    s.ah.buy_collateral(1, buy_grit);
}

/// Test multiple safes liquidated in sequence
#[test]
fn test_multiple_safes_liquidated() {
    let s = setup_full_system();

    let user_a = user1();
    let user_b = user2();

    // Both borrow 25k GRIT
    let borrow = 25_000 * WAD;
    let safe_a = open_safe_with_debt(@s, user_a, borrow);
    let safe_b = open_safe_with_debt(@s, user_b, borrow);

    // Drop price → both unhealthy
    cheat_caller_address(s.se_addr, s.hook_addr, CheatSpan::TargetCalls(1));
    s.se.update_collateral_price(35_000 * WAD);

    assert(s.le.is_liquidatable(safe_a), 'A should be liquidatable');
    assert(s.le.is_liquidatable(safe_b), 'B should be liquidatable');

    // Liquidate both
    let auction_a = s.le.liquidate(safe_a);
    let auction_b = s.le.liquidate(safe_b);

    assert(auction_a == 1, 'first auction');
    assert(auction_b == 2, 'second auction');

    // On-auction should track cumulative debt
    assert(s.le.get_current_on_auction_system_debt() == borrow * 2, 'cumulative on-auction');

    // AccountingEngine queued debt should be cumulative
    assert(s.ae.get_total_queued_debt() == borrow * 2, 'cumulative queued debt');

    // System totals: both safes zeroed out
    assert(s.se.get_total_debt() == 0, 'total debt zero');
    assert(s.se.get_total_collateral() == 0, 'total col zero');
}
