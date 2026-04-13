use starknet::ContractAddress;
use snforge_std::{declare, DeclareResultTrait, ContractClassTrait, cheat_caller_address, CheatSpan};

use grinta::interfaces::isafe_engine::{ISAFEEngineDispatcher, ISAFEEngineDispatcherTrait};
use grinta::interfaces::iaccounting_engine::{IAccountingEngineDispatcher, IAccountingEngineDispatcherTrait};
use grinta::interfaces::ierc20::{IERC20Dispatcher, IERC20DispatcherTrait};

use super::test_common::{WAD, admin, user1, deploy_safe_engine};

// ============================================================================
// Deploy helper
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

fn setup() -> (ContractAddress, ISAFEEngineDispatcher, ContractAddress, IAccountingEngineDispatcher) {
    let admin_addr = admin();
    let (se_addr, se) = deploy_safe_engine(admin_addr);
    let (ae_addr, ae) = deploy_accounting_engine(admin_addr, se_addr);

    // Wire: SAFEEngine recognizes AccountingEngine
    cheat_caller_address(se_addr, admin_addr, CheatSpan::TargetCalls(1));
    se.set_accounting_engine(ae_addr);

    (se_addr, se, ae_addr, ae)
}

// ============================================================================
// Unit Tests
// ============================================================================

#[test]
fn test_accounting_engine_deploy() {
    let (_se_addr, _se, _ae_addr, ae) = setup();
    assert(ae.get_total_queued_debt() == 0, 'debt should be 0');
    assert(ae.get_surplus_balance() == 0, 'surplus should be 0');
    assert(ae.get_total_settled_debt() == 0, 'settled should be 0');
    assert(ae.get_unresolved_deficit() == 0, 'deficit should be 0');
}

#[test]
fn test_push_debt() {
    let (_se_addr, _se, ae_addr, ae) = setup();
    let debt_amount = 1000 * WAD;

    // Only authorized (liquidation_engine) can push debt.
    // For tests, we set the caller as authorized via admin.
    let liq_engine: ContractAddress = 'liq_engine'.try_into().unwrap();
    cheat_caller_address(ae_addr, admin(), CheatSpan::TargetCalls(1));
    ae.set_liquidation_engine(liq_engine);

    cheat_caller_address(ae_addr, liq_engine, CheatSpan::TargetCalls(1));
    ae.push_debt(debt_amount);

    assert(ae.get_total_queued_debt() == debt_amount, 'queued debt wrong');
}

#[test]
#[should_panic(expected: 'ACC: not liq engine')]
fn test_push_debt_unauthorized() {
    let (_se_addr, _se, ae_addr, ae) = setup();
    cheat_caller_address(ae_addr, user1(), CheatSpan::TargetCalls(1));
    ae.push_debt(1000 * WAD);
}

#[test]
fn test_receive_surplus() {
    let (_se_addr, _se, ae_addr, ae) = setup();
    let surplus = 500 * WAD;

    let auction_house: ContractAddress = 'auction'.try_into().unwrap();
    cheat_caller_address(ae_addr, admin(), CheatSpan::TargetCalls(1));
    ae.set_auction_house(auction_house);

    cheat_caller_address(ae_addr, auction_house, CheatSpan::TargetCalls(1));
    ae.receive_surplus(surplus);

    assert(ae.get_surplus_balance() == surplus, 'surplus wrong');
}

#[test]
#[should_panic(expected: 'ACC: not auction house')]
fn test_receive_surplus_unauthorized() {
    let (_se_addr, _se, ae_addr, ae) = setup();
    cheat_caller_address(ae_addr, user1(), CheatSpan::TargetCalls(1));
    ae.receive_surplus(500 * WAD);
}

#[test]
fn test_settle_debt_burns_grit() {
    let (se_addr, se, ae_addr, ae) = setup();
    let debt_amount = 1000 * WAD;
    let surplus_amount = 1130 * WAD; // More than debt (includes penalty)

    // Setup authorized callers
    let liq_engine: ContractAddress = 'liq_engine'.try_into().unwrap();
    let auction_house: ContractAddress = 'auction'.try_into().unwrap();
    cheat_caller_address(ae_addr, admin(), CheatSpan::TargetCalls(1));
    ae.set_liquidation_engine(liq_engine);
    cheat_caller_address(ae_addr, admin(), CheatSpan::TargetCalls(1));
    ae.set_auction_house(auction_house);

    // Push debt
    cheat_caller_address(ae_addr, liq_engine, CheatSpan::TargetCalls(1));
    ae.push_debt(debt_amount);

    // Mint GRIT to accounting engine (simulates auction recovery sending GRIT)
    cheat_caller_address(se_addr, admin(), CheatSpan::TargetCalls(1));
    se.mint_grit(ae_addr, surplus_amount);

    // Record surplus
    cheat_caller_address(ae_addr, auction_house, CheatSpan::TargetCalls(1));
    ae.receive_surplus(surplus_amount);

    // Settle
    let settled = ae.settle_debt();

    assert(settled == debt_amount, 'should settle full debt');
    assert(ae.get_total_queued_debt() == 0, 'debt should be 0');
    assert(ae.get_surplus_balance() == 130 * WAD, 'surplus should be 130');
    assert(ae.get_total_settled_debt() == debt_amount, 'settled total wrong');

    // Verify GRIT was burned — AE should have 130 left, not 1130
    let grit = IERC20Dispatcher { contract_address: se_addr };
    assert(grit.balance_of(ae_addr) == 130 * WAD, 'ae grit balance wrong');
}

#[test]
fn test_settle_debt_partial() {
    let (se_addr, se, ae_addr, ae) = setup();
    let debt_amount = 1000 * WAD;
    let surplus_amount = 400 * WAD; // Less than debt

    let liq_engine: ContractAddress = 'liq_engine'.try_into().unwrap();
    let auction_house: ContractAddress = 'auction'.try_into().unwrap();
    cheat_caller_address(ae_addr, admin(), CheatSpan::TargetCalls(1));
    ae.set_liquidation_engine(liq_engine);
    cheat_caller_address(ae_addr, admin(), CheatSpan::TargetCalls(1));
    ae.set_auction_house(auction_house);

    cheat_caller_address(ae_addr, liq_engine, CheatSpan::TargetCalls(1));
    ae.push_debt(debt_amount);

    cheat_caller_address(se_addr, admin(), CheatSpan::TargetCalls(1));
    se.mint_grit(ae_addr, surplus_amount);

    cheat_caller_address(ae_addr, auction_house, CheatSpan::TargetCalls(1));
    ae.receive_surplus(surplus_amount);

    let settled = ae.settle_debt();

    assert(settled == surplus_amount, 'should settle 400');
    assert(ae.get_total_queued_debt() == 600 * WAD, 'remaining debt wrong');
    assert(ae.get_surplus_balance() == 0, 'surplus should be 0');
}

#[test]
fn test_settle_debt_nothing_to_settle() {
    let (_se_addr, _se, _ae_addr, ae) = setup();
    let settled = ae.settle_debt();
    assert(settled == 0, 'nothing to settle');
}

#[test]
fn test_mark_deficit() {
    let (_se_addr, _se, ae_addr, ae) = setup();
    let debt_amount = 1000 * WAD;
    let deficit_amount = 300 * WAD;

    let liq_engine: ContractAddress = 'liq_engine'.try_into().unwrap();
    cheat_caller_address(ae_addr, admin(), CheatSpan::TargetCalls(1));
    ae.set_liquidation_engine(liq_engine);

    cheat_caller_address(ae_addr, liq_engine, CheatSpan::TargetCalls(1));
    ae.push_debt(debt_amount);

    cheat_caller_address(ae_addr, admin(), CheatSpan::TargetCalls(1));
    ae.mark_deficit(deficit_amount);

    assert(ae.get_total_queued_debt() == 700 * WAD, 'queued should be 700');
    assert(ae.get_unresolved_deficit() == deficit_amount, 'deficit wrong');
}

#[test]
#[should_panic(expected: 'ACC: deficit exceeds debt')]
fn test_mark_deficit_exceeds_debt() {
    let (_se_addr, _se, ae_addr, ae) = setup();
    cheat_caller_address(ae_addr, admin(), CheatSpan::TargetCalls(1));
    ae.mark_deficit(100 * WAD); // No debt to mark as deficit
}
