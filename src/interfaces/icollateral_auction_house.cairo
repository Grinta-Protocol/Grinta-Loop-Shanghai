use starknet::ContractAddress;
use grinta::types::Auction;

#[starknet::interface]
pub trait ICollateralAuctionHouse<TContractState> {
    /// Start a new auction. Only callable by LiquidationEngine. Returns auction_id.
    fn start_auction(
        ref self: TContractState,
        collateral_amount: u256,
        debt_to_raise: u256,
        safe_owner: ContractAddress,
    ) -> u64;

    /// Buy collateral from an active auction. Returns collateral amount received.
    fn buy_collateral(ref self: TContractState, auction_id: u64, grit_amount: u256) -> u256;

    // ---- Views ----
    fn get_auction(self: @TContractState, auction_id: u64) -> Auction;
    fn get_auction_count(self: @TContractState) -> u64;
    fn get_current_discount(self: @TContractState, auction_id: u64) -> u256;
    fn get_collateral_price_in_grit(self: @TContractState, auction_id: u64) -> u256;

    // ---- Parameters ----
    fn get_min_discount(self: @TContractState) -> u256;
    fn get_max_discount(self: @TContractState) -> u256;
    fn get_minimum_bid(self: @TContractState) -> u256;

    // ---- Admin ----
    fn set_min_discount(ref self: TContractState, discount: u256);
    fn set_max_discount(ref self: TContractState, discount: u256);
    fn set_minimum_bid(ref self: TContractState, bid: u256);
}
