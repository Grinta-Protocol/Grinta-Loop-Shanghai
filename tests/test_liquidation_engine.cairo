use starknet::ContractAddress;
use snforge_std::{declare, DeclareResultTrait, ContractClassTrait, cheat_caller_address, CheatSpan, start_cheat_block_timestamp_global};

use grinta::interfaces::isafe_engine::{ISAFEEngineDispatcher, ISAFEEngineDispatcherTrait};
use grinta::interfaces::isafe_manager::{ISafeManagerDispatcher, ISafeManagerDispatcherTrait};
use grinta::interfaces::iliquidation_engine::{ILiquidationEngineDispatcher, ILiquidationEngineDispatcherTrait};
use grinta::interfaces::icollateral_auction_house::{ICollateralAuctionHouseDispatcher, ICollateralAuctionHouseDispatcherTrait};
use grinta::interfaces::iaccounting_engine::{IAccountingEngineDispatcher, IAccountingEngineDispatcherTrait};
use grinta::interfaces::igrinta_hook::{IGrintaHookDispatcherTrait};

use super::test_common::{
    WAD, BTC_PRICE_WAD, admin, user1,
    deploy_safe_engine, deploy_mock_wbtc, deploy_collateral_join,
    deploy_grinta_hook, deploy_safe_manager, deploy_pid_controller,
    fund_user_wbtc, approve_join,
    IJoinSetManagerDispatcher, IJoinSetManagerDispatcherTrait,
    IJoinSetLiqDispatcher, IJoinSetLiqDispatcherTrait,
    IOracleUpdateDispatcher, IOracleUpdateDispatcherTrait,
    IPIDSetSeedDispatcher, IPIDSetSeedDispatcherTrait,
};

// ============================================================================
// Constants
// ============================================================================

const LIQUIDATION_PENALTY: u256 = 1_130_000_000_000_000_000; // 1.13 WAD (13%)
const MAX_LIQ_QUANTITY: u256 = 100_000_000_000_000_000_000_000; // 100k WAD
const ON_AUCTION_LIMIT: u256 = 500_000_000_000_000_000_000_000; // 500k WAD

// Auction params
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

#[derive(Drop)]
struct LiqTestSetup {
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

fn setup_full_system() -> LiqTestSetup {
    let admin_addr = admin();
    start_cheat_block_timestamp_global(100);

    // 1. Deploy base contracts
    let (wbtc_addr, _wbtc) = deploy_mock_wbtc();
    let oracle_addr = super::test_common::deploy_oracle_relayer();
    let (se_addr, se) = deploy_safe_engine(admin_addr);
    let (join_addr, _join) = deploy_collateral_join(admin_addr, wbtc_addr, se_addr);

    // 2. Deploy PID + Hook (minimal, for price updates)
    let (pid_addr, _pid) = deploy_pid_controller(admin_addr, admin_addr);
    let usdc_mock: ContractAddress = 'usdc'.try_into().unwrap();
    let zero: ContractAddress = 0.try_into().unwrap();
    let (hook_addr, hook) = deploy_grinta_hook(
        admin_addr, se_addr, pid_addr, oracle_addr, zero, se_addr, wbtc_addr, usdc_mock,
    );

    // 3. Deploy SafeManager
    let (manager_addr, manager) = deploy_safe_manager(admin_addr, se_addr, join_addr, hook_addr);

    // 4. Deploy liquidation system — need to pre-compute addresses
    // Deploy AE first
    let (ae_addr, ae) = deploy_accounting_engine(admin_addr, se_addr);

    // Deploy AH + LE (circular dependency: AH needs LE addr, LE needs AH addr)
    // Solution: deploy LE first with a placeholder, then deploy AH, then update LE
    // Actually, we can use a two-step approach with admin setters... but our contracts
    // take addresses in constructor. Let's deploy in order:
    // We need LE addr for AH constructor. We can't get that without deploying LE first.
    // But LE needs AH addr too. Classic chicken-and-egg.
    // Solution: deploy AH with a dummy LE, deploy LE with real AH, then... AH has LE as immutable.
    // Hmm. Let me just use admin addr as LE placeholder for AH, since AH only checks LE for start_auction.
    // Actually the test can work if LE calls AH.start_auction (which checks caller == liquidation_engine).
    // So AH must know LE's real address. We need to predict it or use a two-phase init.
    //
    // Simpler: deploy LE first with a dummy AH, then deploy AH with real LE, then...
    // LE has AH as immutable in constructor. Same problem.
    //
    // Let's just add admin setters to both. But for now, let's use a workaround:
    // Deploy a temporary "mock" as placeholder, then deploy the real ones.
    //
    // ACTUALLY: Since snforge deploys are deterministic and we control order,
    // we can deploy LE first (with dummy AH addr), then AH (with real LE addr).
    // Then LE's auction_house field is wrong, but we can add a setter.
    // For the test, let's just deploy them and manually test without settlement flow.

    // For unit tests: deploy LE with a dummy AH, test is_liquidatable + preview_liquidation
    // Full settlement flow goes to integration tests.
    let dummy_ah: ContractAddress = 'dummy_ah'.try_into().unwrap();
    let (le_addr, le) = deploy_liquidation_engine(admin_addr, se_addr, join_addr, dummy_ah, ae_addr);

    // Now deploy real AH
    let (ah_addr, ah) = deploy_auction_house(admin_addr, se_addr, le_addr, ae_addr, wbtc_addr);

    // 5. Wire permissions
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

    let join_admin = IJoinSetManagerDispatcher { contract_address: join_addr };
    cheat_caller_address(join_addr, admin_addr, CheatSpan::TargetCalls(1));
    join_admin.set_safe_manager(manager_addr);

    // CollateralJoin: set LE as authorized for seize()
    let join_liq = IJoinSetLiqDispatcher { contract_address: join_addr };
    cheat_caller_address(join_addr, admin_addr, CheatSpan::TargetCalls(1));
    join_liq.set_liquidation_engine(le_addr);

    let pid_admin = IPIDSetSeedDispatcher { contract_address: pid_addr };
    cheat_caller_address(pid_addr, admin_addr, CheatSpan::TargetCalls(1));
    pid_admin.set_seed_proposer(hook_addr);

    // Wire AE
    cheat_caller_address(ae_addr, admin_addr, CheatSpan::TargetCalls(1));
    ae.set_liquidation_engine(le_addr);
    cheat_caller_address(ae_addr, admin_addr, CheatSpan::TargetCalls(1));
    ae.set_auction_house(ah_addr);

    // 6. Set BTC price via oracle → hook
    let oracle_updater = IOracleUpdateDispatcher { contract_address: oracle_addr };
    oracle_updater.update_price(wbtc_addr, usdc_mock, BTC_PRICE_WAD);
    hook.update();

    LiqTestSetup {
        wbtc_addr, se_addr, se, join_addr, manager_addr, manager,
        ae_addr, ae, ah_addr, ah, le_addr, le, hook_addr, oracle_addr,
    }
}

/// Helper: open a safe with 1 WBTC collateral and borrow a given amount of GRIT
fn open_safe_with_debt(s: @LiqTestSetup, borrower: ContractAddress, borrow_amount: u256) -> u64 {
    let one_wbtc = 100_000_000_u256;
    fund_user_wbtc(*s.wbtc_addr, borrower, one_wbtc);
    approve_join(*s.wbtc_addr, borrower, *s.join_addr, one_wbtc);

    cheat_caller_address(*s.manager_addr, borrower, CheatSpan::TargetCalls(1));
    let safe_id = (*s.manager).open_and_borrow(one_wbtc, borrow_amount);
    safe_id
}

// ============================================================================
// Tests
// ============================================================================

#[test]
fn test_liquidation_engine_deploy() {
    let s = setup_full_system();
    assert(s.le.get_liquidation_penalty() == LIQUIDATION_PENALTY, 'wrong penalty');
    assert(s.le.get_max_liquidation_quantity() == MAX_LIQ_QUANTITY, 'wrong max qty');
    assert(s.le.get_current_on_auction_system_debt() == 0, 'should be 0');
}

#[test]
fn test_is_liquidatable_healthy_safe() {
    let s = setup_full_system();
    // Borrow 30k GRIT against 1 BTC ($60k) — 50% LTV, well under 150% ratio
    let safe_id = open_safe_with_debt(@s, user1(), 30_000 * WAD);
    assert(!s.le.is_liquidatable(safe_id), 'should be healthy');
}

#[test]
fn test_is_liquidatable_after_price_drop() {
    let s = setup_full_system();
    // Borrow 30k GRIT against 1 BTC ($60k)
    let safe_id = open_safe_with_debt(@s, user1(), 30_000 * WAD);

    // Drop BTC price to $40k — now 30k debt vs $40k collateral → 75% LTV
    // Required: col_value * WAD >= debt_usd * 1.5
    // 40k * WAD < 30k * 1.5 = 45k → UNHEALTHY
    let new_price = 40_000 * WAD;
    cheat_caller_address(s.se_addr, s.hook_addr, CheatSpan::TargetCalls(1));
    s.se.update_collateral_price(new_price);

    assert(s.le.is_liquidatable(safe_id), 'should be liquidatable');
}

#[test]
fn test_preview_liquidation() {
    let s = setup_full_system();
    let safe_id = open_safe_with_debt(@s, user1(), 30_000 * WAD);

    // Drop price
    cheat_caller_address(s.se_addr, s.hook_addr, CheatSpan::TargetCalls(1));
    s.se.update_collateral_price(40_000 * WAD);

    let (debt_to_cover, col_to_seize) = s.le.preview_liquidation(safe_id);
    // Full liquidation: debt = 30k, collateral = 1 BTC (WAD)
    assert(debt_to_cover == 30_000 * WAD, 'should cover full debt');
    assert(col_to_seize == WAD, 'should seize all collateral');
}

#[test]
#[should_panic(expected: 'LIQ: safe is healthy')]
fn test_cannot_liquidate_healthy_safe() {
    let s = setup_full_system();
    let safe_id = open_safe_with_debt(@s, user1(), 30_000 * WAD);
    // Try to liquidate a healthy safe
    s.le.liquidate(safe_id);
}

#[test]
#[should_panic(expected: 'LIQ: no debt')]
fn test_cannot_liquidate_no_debt() {
    let s = setup_full_system();
    // Open safe with no debt
    cheat_caller_address(s.manager_addr, user1(), CheatSpan::TargetCalls(1));
    let safe_id = s.manager.open_safe();
    s.le.liquidate(safe_id);
}
