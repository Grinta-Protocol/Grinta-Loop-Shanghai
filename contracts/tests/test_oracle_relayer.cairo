use starknet::ContractAddress;
use snforge_std::{declare, DeclareResultTrait, ContractClassTrait, cheat_caller_address, CheatSpan, start_cheat_block_timestamp_global};

use grinta::interfaces::iekubo::{IEkuboOracleExtensionDispatcher, IEkuboOracleExtensionDispatcherTrait};
use grinta::interfaces::isafe_engine::{ISAFEEngineDispatcherTrait};
use grinta::interfaces::igrinta_hook::{IGrintaHookDispatcherTrait};
use grinta::interfaces::isafe_manager::{ISafeManagerDispatcherTrait};
use grinta::interfaces::ierc20::{IERC20Dispatcher, IERC20DispatcherTrait};

use super::test_common::{
    WAD, deploy_full_system, fund_user_wbtc, approve_join, user1, IOracleUpdateDispatcher,
    IOracleUpdateDispatcherTrait,
};

// ============================================================================
// Dispatcher for OracleRelayer-specific functions
// ============================================================================

#[starknet::interface]
trait IOracleRelayerTest<T> {
    fn update_price(
        ref self: T,
        base_token: ContractAddress,
        quote_token: ContractAddress,
        price_usd_wad: u256,
    );
    fn get_price_wad(
        self: @T, base_token: ContractAddress, quote_token: ContractAddress,
    ) -> u256;
    fn get_last_update_time(self: @T) -> u64;
}

// ============================================================================
// Helpers
// ============================================================================

fn deploy_oracle_relayer() -> ContractAddress {
    let contract = declare("OracleRelayer").unwrap().contract_class();
    let (addr, _) = contract.deploy(@array![]).unwrap();
    addr
}

fn wbtc() -> ContractAddress {
    'wbtc'.try_into().unwrap()
}

fn usdc() -> ContractAddress {
    'usdc'.try_into().unwrap()
}

const TWO_POW_128: u256 = 0x100000000000000000000000000000000;
const BTC_60K_WAD: u256 = 60_000_000_000_000_000_000_000; // 60,000e18
const BTC_65K_WAD: u256 = 65_000_000_000_000_000_000_000; // 65,000e18
const BTC_97K_WAD: u256 = 97_250_000_000_000_000_000_000; // 97,250e18

// ============================================================================
// Tests
// ============================================================================

/// Test basic price update and WAD storage
#[test]
fn test_update_price_stores_wad() {
    let addr = deploy_oracle_relayer();
    let oracle = IOracleRelayerTestDispatcher { contract_address: addr };

    oracle.update_price(wbtc(), usdc(), BTC_60K_WAD);

    let stored = oracle.get_price_wad(wbtc(), usdc());
    assert(stored == BTC_60K_WAD, 'WAD price should be 60k');
}

/// Test x128 conversion: price_x128 = price_wad * 2^128 / WAD
#[test]
fn test_update_price_converts_to_x128() {
    let addr = deploy_oracle_relayer();
    let oracle = IOracleRelayerTestDispatcher { contract_address: addr };
    let reader = IEkuboOracleExtensionDispatcher { contract_address: addr };

    oracle.update_price(wbtc(), usdc(), BTC_60K_WAD);

    let x128 = reader.get_price_x128_over_last(wbtc(), usdc(), 1800);
    let expected_x128 = (BTC_60K_WAD * TWO_POW_128) / WAD;
    assert(x128 == expected_x128, 'x128 conversion wrong');

    // Verify round-trip: x128 * WAD / 2^128 == original WAD price
    let round_trip = (x128 * WAD) / TWO_POW_128;
    assert(round_trip == BTC_60K_WAD, 'round-trip should match');
}

/// Test price can be updated to a new value
#[test]
fn test_price_update_changes_value() {
    let addr = deploy_oracle_relayer();
    let oracle = IOracleRelayerTestDispatcher { contract_address: addr };
    let reader = IEkuboOracleExtensionDispatcher { contract_address: addr };

    // Set $60k
    oracle.update_price(wbtc(), usdc(), BTC_60K_WAD);
    let wad1 = oracle.get_price_wad(wbtc(), usdc());
    assert(wad1 == BTC_60K_WAD, 'should be 60k');

    // Update to $65k
    oracle.update_price(wbtc(), usdc(), BTC_65K_WAD);
    let wad2 = oracle.get_price_wad(wbtc(), usdc());
    assert(wad2 == BTC_65K_WAD, 'should be 65k');

    // x128 should also reflect new price
    let x128 = reader.get_price_x128_over_last(wbtc(), usdc(), 1800);
    let expected = (BTC_65K_WAD * TWO_POW_128) / WAD;
    assert(x128 == expected, 'x128 should be 65k');
}

/// Test realistic BTC price ($97,250) — simulates a real API push
#[test]
fn test_realistic_btc_price() {
    let addr = deploy_oracle_relayer();
    let oracle = IOracleRelayerTestDispatcher { contract_address: addr };
    let reader = IEkuboOracleExtensionDispatcher { contract_address: addr };

    // Push current-ish BTC price: $97,250
    oracle.update_price(wbtc(), usdc(), BTC_97K_WAD);

    let stored_wad = oracle.get_price_wad(wbtc(), usdc());
    assert(stored_wad == BTC_97K_WAD, 'should be 97250');

    // Verify x128 round-trip
    let x128 = reader.get_price_x128_over_last(wbtc(), usdc(), 1800);
    let round_trip = (x128 * WAD) / TWO_POW_128;
    assert(round_trip == BTC_97K_WAD, 'round-trip 97k');
}

/// Test that different pairs are stored independently
#[test]
fn test_separate_pairs() {
    let addr = deploy_oracle_relayer();
    let oracle = IOracleRelayerTestDispatcher { contract_address: addr };

    let eth: ContractAddress = 'eth'.try_into().unwrap();
    let eth_price_wad: u256 = 3_500_000_000_000_000_000_000; // $3,500

    oracle.update_price(wbtc(), usdc(), BTC_60K_WAD);
    oracle.update_price(eth, usdc(), eth_price_wad);

    assert(oracle.get_price_wad(wbtc(), usdc()) == BTC_60K_WAD, 'btc should be 60k');
    assert(oracle.get_price_wad(eth, usdc()) == eth_price_wad, 'eth should be 3500');
}

/// Test zero price is rejected
#[test]
#[should_panic(expected: 'ORACLE: price must be > 0')]
fn test_zero_price_rejected() {
    let addr = deploy_oracle_relayer();
    let oracle = IOracleRelayerTestDispatcher { contract_address: addr };
    oracle.update_price(wbtc(), usdc(), 0);
}

/// Test unset pair returns zero (no panic)
#[test]
fn test_unset_pair_returns_zero() {
    let addr = deploy_oracle_relayer();
    let reader = IEkuboOracleExtensionDispatcher { contract_address: addr };

    let price = reader.get_price_x128_over_last(wbtc(), usdc(), 1800);
    assert(price == 0, 'unset should be 0');
}

// ============================================================================
// End-to-end: real BTC price → OracleRelayer → GrintaHook → SAFEEngine
// Simulates what an external script/agent would do
// ============================================================================

/// Full pipeline test with live BTC price ($68,345 fetched from CoinGecko API)
/// Flow: script pushes price → hook.update() reads oracle → SAFEEngine collateral price updates
/// Then: user borrows against 1 WBTC and we verify health reflects the real price
#[test]
fn test_e2e_live_btc_price_pipeline() {
    // 1. Deploy full system (starts with default $60k BTC price)
    let sys = deploy_full_system();

    // 2. Simulate external script pushing live BTC price from CoinGecko API
    //    Fetched: {"bitcoin":{"usd":68345}}
    //    Convert to WAD: 68345 * 1e18
    let live_btc_price_wad: u256 = 68_345_000_000_000_000_000_000; // $68,345

    let oracle = IOracleUpdateDispatcher { contract_address: sys.oracle_addr };
    oracle.update_price(sys.wbtc_addr, 'usdc'.try_into().unwrap(), live_btc_price_wad);

    // 3. Advance time so hook throttle allows a new update
    start_cheat_block_timestamp_global(200);

    // 4. Trigger hook.update() — this is what SafeManager does before every operation
    //    Hook reads oracle → converts x128 to WAD → pushes to SAFEEngine
    sys.hook.update();

    // 5. Verify SAFEEngine received the live price
    let stored_price = sys.safe_engine.get_collateral_price();
    assert(stored_price == live_btc_price_wad, 'price should be 68345 WAD');

    // 6. Now borrow against 1 WBTC at the live price
    let one_wbtc: u256 = 100_000_000; // 1e8
    fund_user_wbtc(sys.wbtc_addr, user1(), one_wbtc);
    approve_join(sys.wbtc_addr, user1(), sys.join_addr, one_wbtc);

    cheat_caller_address(sys.manager_addr, user1(), CheatSpan::TargetCalls(1));
    let safe_id = sys.manager.open_safe();
    cheat_caller_address(sys.manager_addr, user1(), CheatSpan::TargetCalls(1));
    sys.manager.deposit(safe_id, one_wbtc);

    // Borrow 40,000 GRIT (safe at 150% ratio: 68345 / 1.5 = 45,563 max)
    let borrow_amount: u256 = 40_000_000_000_000_000_000_000; // 40,000e18
    cheat_caller_address(sys.manager_addr, user1(), CheatSpan::TargetCalls(1));
    sys.manager.borrow(safe_id, borrow_amount);

    // 7. Verify health reflects the real BTC price
    let health = sys.safe_engine.get_safe_health(safe_id);
    assert(health.collateral_value == live_btc_price_wad, 'col value = live price');
    assert(health.debt == borrow_amount, 'debt = 40k');

    // Verify GRIT was minted to user
    let grit = IERC20Dispatcher { contract_address: sys.safe_engine_addr };
    assert(grit.balance_of(user1()) == borrow_amount, 'got 40k GRIT');
}

/// Test price update flow: price changes from $68k → $55k, safe becomes riskier
#[test]
fn test_e2e_price_drop_affects_health() {
    let sys = deploy_full_system();
    let usdc_mock: ContractAddress = 'usdc'.try_into().unwrap();
    let oracle = IOracleUpdateDispatcher { contract_address: sys.oracle_addr };

    // Setup: deposit 1 WBTC, borrow 30,000 GRIT at default $60k price
    let one_wbtc: u256 = 100_000_000;
    fund_user_wbtc(sys.wbtc_addr, user1(), one_wbtc);
    approve_join(sys.wbtc_addr, user1(), sys.join_addr, one_wbtc);

    cheat_caller_address(sys.manager_addr, user1(), CheatSpan::TargetCalls(1));
    let safe_id = sys.manager.open_safe();
    cheat_caller_address(sys.manager_addr, user1(), CheatSpan::TargetCalls(1));
    sys.manager.deposit(safe_id, one_wbtc);
    cheat_caller_address(sys.manager_addr, user1(), CheatSpan::TargetCalls(1));
    sys.manager.borrow(safe_id, 30_000_000_000_000_000_000_000); // 30k GRIT

    // Health at $60k: col_value=60k, debt=30k, ratio=200% — healthy
    let health1 = sys.safe_engine.get_safe_health(safe_id);
    assert(health1.collateral_value == 60_000_000_000_000_000_000_000, 'col 60k');

    // Simulate BTC crash to $55k (script pushes new price)
    let crash_price: u256 = 55_000_000_000_000_000_000_000; // $55,000
    oracle.update_price(sys.wbtc_addr, usdc_mock, crash_price);

    // Advance time past throttle, trigger update
    start_cheat_block_timestamp_global(300);
    sys.hook.update();

    // Health at $55k: col_value=55k, debt=30k, ratio=183% — still above 150% but riskier
    let health2 = sys.safe_engine.get_safe_health(safe_id);
    assert(health2.collateral_value == crash_price, 'col should be 55k now');
    assert(health2.collateral_value < health1.collateral_value, 'col value decreased');
}
