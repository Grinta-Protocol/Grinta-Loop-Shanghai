use starknet::ContractAddress;

#[starknet::interface]
pub trait ILiquidationEngine<TContractState> {
    /// Liquidate an unhealthy safe. Anyone can call. Returns auction_id.
    fn liquidate(ref self: TContractState, safe_id: u64) -> u64;

    /// Preview a potential liquidation. Returns (debt_to_cover, collateral_to_seize) or panics if healthy.
    fn preview_liquidation(self: @TContractState, safe_id: u64) -> (u256, u256);

    /// Check if a safe can be liquidated
    fn is_liquidatable(self: @TContractState, safe_id: u64) -> bool;

    /// Called by CollateralAuctionHouse when auction settles — reduces on-auction debt tracking
    fn remove_coins_from_auction(ref self: TContractState, amount: u256);

    // ---- Getters ----
    fn get_liquidation_penalty(self: @TContractState) -> u256;
    fn get_max_liquidation_quantity(self: @TContractState) -> u256;
    fn get_on_auction_system_debt_limit(self: @TContractState) -> u256;
    fn get_current_on_auction_system_debt(self: @TContractState) -> u256;

    // ---- Admin ----
    fn set_auction_house(ref self: TContractState, auction_house: ContractAddress);
    fn set_liquidation_penalty(ref self: TContractState, penalty: u256);
    fn set_max_liquidation_quantity(ref self: TContractState, quantity: u256);
    fn set_on_auction_system_debt_limit(ref self: TContractState, limit: u256);
}
