#[starknet::interface]
pub trait IAccountingEngine<TContractState> {
    /// Record new bad debt from a liquidation. Only callable by LiquidationEngine.
    fn push_debt(ref self: TContractState, amount: u256);

    /// Record GRIT recovered from an auction. Only callable by CollateralAuctionHouse.
    fn receive_surplus(ref self: TContractState, amount: u256);

    /// Settle matched surplus and debt. Anyone can call. Burns GRIT.
    fn settle_debt(ref self: TContractState) -> u256;

    /// Mark unrecoverable debt as deficit. Admin only (future: governance).
    fn mark_deficit(ref self: TContractState, amount: u256);

    // ---- Getters ----
    fn get_total_queued_debt(self: @TContractState) -> u256;
    fn get_surplus_balance(self: @TContractState) -> u256;
    fn get_total_settled_debt(self: @TContractState) -> u256;
    fn get_unresolved_deficit(self: @TContractState) -> u256;

    // ---- Admin ----
    fn set_liquidation_engine(ref self: TContractState, engine: starknet::ContractAddress);
    fn set_auction_house(ref self: TContractState, auction: starknet::ContractAddress);
}
