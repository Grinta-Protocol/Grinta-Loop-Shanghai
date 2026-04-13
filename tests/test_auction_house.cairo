use starknet::ContractAddress;
use snforge_std::{declare, DeclareResultTrait, ContractClassTrait, cheat_caller_address, CheatSpan, start_cheat_block_timestamp_global};

use grinta::interfaces::isafe_engine::{ISAFEEngineDispatcher, ISAFEEngineDispatcherTrait};
use grinta::interfaces::icollateral_auction_house::{ICollateralAuctionHouseDispatcher, ICollateralAuctionHouseDispatcherTrait};
use grinta::interfaces::iliquidation_engine::{ILiquidationEngineDispatcher, ILiquidationEngineDispatcherTrait};
use grinta::interfaces::iaccounting_engine::{IAccountingEngineDispatcher, IAccountingEngineDispatcherTrait};
use grinta::interfaces::ierc20::{IERC20Dispatcher, IERC20DispatcherTrait};

use super::test_common::{
    WAD, RAY, BTC_PRICE_WAD, admin, user1, user2,
    deploy_safe_engine, deploy_mock_wbtc,
    IMintableDispatcher, IMintableDispatcherTrait,
};

// ============================================================================
// Constants
// ============================================================================

// min_discount = 0.95 WAD (buyer pays 95% → 5% off)
const MIN_DISCOUNT: u256 = 950_000_000_000_000_000;
// max_discount = 0.80 WAD (buyer pays 80% → 20% off)
const MAX_DISCOUNT: u256 = 800_000_000_000_000_000;
// per_second_discount_update_rate: ~0.999999833 RAY
// This makes discount go from 0.95 to 0.80 in ~30 minutes
const DISCOUNT_RATE: u256 = 999_999_833_000_000_000_000_000_000;
// minimum bid: 10 GRIT
const MINIMUM_BID: u256 = 10_000_000_000_000_000_000;

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

#[derive(Drop)]
struct AuctionTestSetup {
    wbtc_addr: ContractAddress,
    se_addr: ContractAddress,
    se: ISAFEEngineDispatcher,
    ae_addr: ContractAddress,
    ae: IAccountingEngineDispatcher,
    ah_addr: ContractAddress,
    ah: ICollateralAuctionHouseDispatcher,
    liq_engine: ContractAddress,
    safe_owner: ContractAddress,
}

fn setup() -> AuctionTestSetup {
    let admin_addr = admin();
    let liq_engine: ContractAddress = 'liq_engine'.try_into().unwrap();
    let safe_owner = user1();

    start_cheat_block_timestamp_global(1000);

    // Deploy
    let (wbtc_addr, _wbtc) = deploy_mock_wbtc();
    let (se_addr, se) = deploy_safe_engine(admin_addr);
    let (ae_addr, ae) = deploy_accounting_engine(admin_addr, se_addr);
    let (ah_addr, ah) = deploy_auction_house(admin_addr, se_addr, liq_engine, ae_addr, wbtc_addr);

    // Wire SAFEEngine
    cheat_caller_address(se_addr, admin_addr, CheatSpan::TargetCalls(1));
    se.set_accounting_engine(ae_addr);

    // Wire AccountingEngine
    cheat_caller_address(ae_addr, admin_addr, CheatSpan::TargetCalls(1));
    ae.set_liquidation_engine(liq_engine);
    cheat_caller_address(ae_addr, admin_addr, CheatSpan::TargetCalls(1));
    ae.set_auction_house(ah_addr);

    // Set BTC price in SAFEEngine (needed for price computation)
    // We cheat hook role to push price
    cheat_caller_address(se_addr, admin_addr, CheatSpan::TargetCalls(1));
    se.set_hook(admin_addr); // temp: admin as hook for testing
    cheat_caller_address(se_addr, admin_addr, CheatSpan::TargetCalls(1));
    se.update_collateral_price(BTC_PRICE_WAD);

    AuctionTestSetup { wbtc_addr, se_addr, se, ae_addr, ae, ah_addr, ah, liq_engine, safe_owner }
}

// ============================================================================
// Tests
// ============================================================================

#[test]
fn test_auction_house_deploy() {
    let s = setup();
    assert(s.ah.get_auction_count() == 0, 'count should be 0');
    assert(s.ah.get_min_discount() == MIN_DISCOUNT, 'wrong min_discount');
    assert(s.ah.get_max_discount() == MAX_DISCOUNT, 'wrong max_discount');
    assert(s.ah.get_minimum_bid() == MINIMUM_BID, 'wrong min_bid');
}

#[test]
fn test_start_auction() {
    let s = setup();
    let collateral = WAD; // 1 BTC in WAD
    let debt = 40_000 * WAD; // 40k GRIT (debt + penalty)

    cheat_caller_address(s.ah_addr, s.liq_engine, CheatSpan::TargetCalls(1));
    let auction_id = s.ah.start_auction(collateral, debt, s.safe_owner);

    assert(auction_id == 1, 'first auction should be 1');
    assert(s.ah.get_auction_count() == 1, 'count should be 1');

    let auction = s.ah.get_auction(1);
    assert(auction.collateral_amount == collateral, 'wrong collateral');
    assert(auction.debt_to_raise == debt, 'wrong debt');
    assert(auction.safe_owner == s.safe_owner, 'wrong owner');
    assert(!auction.settled, 'should not be settled');
}

#[test]
#[should_panic(expected: 'AH: not liq engine')]
fn test_start_auction_unauthorized() {
    let s = setup();
    cheat_caller_address(s.ah_addr, user2(), CheatSpan::TargetCalls(1));
    s.ah.start_auction(WAD, 40_000 * WAD, s.safe_owner);
}

#[test]
fn test_discount_at_start() {
    let s = setup();
    cheat_caller_address(s.ah_addr, s.liq_engine, CheatSpan::TargetCalls(1));
    s.ah.start_auction(WAD, 40_000 * WAD, s.safe_owner);

    let discount = s.ah.get_current_discount(1);
    assert(discount == MIN_DISCOUNT, 'discount should be min at start');
}

#[test]
fn test_discount_increases_over_time() {
    let s = setup();
    cheat_caller_address(s.ah_addr, s.liq_engine, CheatSpan::TargetCalls(1));
    s.ah.start_auction(WAD, 40_000 * WAD, s.safe_owner);

    // Advance 10 minutes
    start_cheat_block_timestamp_global(1000 + 600);
    let discount_10m = s.ah.get_current_discount(1);

    // Discount should be lower than min (buyer pays less = bigger discount)
    assert(discount_10m < MIN_DISCOUNT, 'discount should decrease');
    assert(discount_10m > MAX_DISCOUNT, 'not at max yet');
}

#[test]
fn test_collateral_price_in_grit() {
    let s = setup();
    cheat_caller_address(s.ah_addr, s.liq_engine, CheatSpan::TargetCalls(1));
    s.ah.start_auction(WAD, 40_000 * WAD, s.safe_owner);

    // At start: discount = 0.95, BTC = $60k, redemption_price = $1
    // fair_price = 60k / 1 = 60k GRIT per BTC
    // discounted = 60k * 0.95 = 57k
    let price = s.ah.get_collateral_price_in_grit(1);
    // Should be approximately 57,000 WAD
    let expected_approx = 57_000 * WAD;
    let tolerance = 100 * WAD; // 100 GRIT tolerance for rounding
    assert(price > expected_approx - tolerance, 'price too low');
    assert(price < expected_approx + tolerance, 'price too high');
}

#[test]
fn test_buy_collateral_partial() {
    let s = setup();

    // Start an auction: 1 BTC, need to raise 57k GRIT (at 95% of 60k)
    let collateral = WAD; // 1 BTC in WAD
    let debt_to_raise = 57_000 * WAD;

    cheat_caller_address(s.ah_addr, s.liq_engine, CheatSpan::TargetCalls(1));
    s.ah.start_auction(collateral, debt_to_raise, s.safe_owner);

    // Fund auction house with WBTC
    let mintable = IMintableDispatcher { contract_address: s.wbtc_addr };
    mintable.mint(s.ah_addr, 100_000_000); // 1 WBTC

    // Buyer buys a SMALL amount — won't settle the auction
    let buyer = user2();
    let buy_amount = 1_000 * WAD; // 1000 GRIT — won't settle
    cheat_caller_address(s.se_addr, admin(), CheatSpan::TargetCalls(1));
    s.se.mint_grit(buyer, buy_amount);

    let grit = IERC20Dispatcher { contract_address: s.se_addr };
    cheat_caller_address(s.se_addr, buyer, CheatSpan::TargetCalls(1));
    grit.approve(s.ah_addr, buy_amount);

    cheat_caller_address(s.ah_addr, buyer, CheatSpan::TargetCalls(1));
    let col_received = s.ah.buy_collateral(1, buy_amount);

    // Should have received some collateral
    assert(col_received > 0, 'should get collateral');

    // Auction should NOT be settled (partial buy)
    let auction = s.ah.get_auction(1);
    assert(!auction.settled, 'should not be settled yet');
    assert(auction.collateral_amount < collateral, 'collateral should decrease');
    assert(auction.debt_to_raise < debt_to_raise, 'debt should decrease');

    // Buyer should have WBTC
    let wbtc = IERC20Dispatcher { contract_address: s.wbtc_addr };
    assert(wbtc.balance_of(buyer) > 0, 'buyer should have wbtc');

    // Buyer's GRIT should have decreased
    assert(grit.balance_of(buyer) < buy_amount, 'grit should decrease');
}

#[test]
#[should_panic(expected: 'AH: below minimum bid')]
fn test_buy_below_minimum() {
    let s = setup();

    cheat_caller_address(s.ah_addr, s.liq_engine, CheatSpan::TargetCalls(1));
    s.ah.start_auction(WAD, 40_000 * WAD, s.safe_owner);

    // Try to buy with less than minimum bid
    cheat_caller_address(s.ah_addr, user2(), CheatSpan::TargetCalls(1));
    s.ah.buy_collateral(1, WAD); // 1 GRIT < 10 GRIT minimum
}

// NOTE: test_buy_settled_auction moved to integration tests (test_liquidation_integration)
// because settlement triggers cross-contract calls to LiquidationEngine + AccountingEngine
