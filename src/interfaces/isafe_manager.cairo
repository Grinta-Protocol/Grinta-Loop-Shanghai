use starknet::ContractAddress;
use grinta::types::Health;

#[starknet::interface]
pub trait ISafeManager<TContractState> {
    // ---- Core operations ----
    fn open_safe(ref self: TContractState) -> u64;
    fn close_safe(ref self: TContractState, safe_id: u64);
    fn deposit(ref self: TContractState, safe_id: u64, amount: u256);
    fn withdraw(ref self: TContractState, safe_id: u64, amount: u256);
    fn borrow(ref self: TContractState, safe_id: u64, amount: u256);
    fn repay(ref self: TContractState, safe_id: u64, amount: u256);

    // ---- Agent-friendly: single-call operations ----
    fn open_and_borrow(ref self: TContractState, collateral_amount: u256, borrow_amount: u256) -> u64;

    // ---- Agent-friendly: rich view functions ----
    fn get_position_health(self: @TContractState, safe_id: u64) -> Health;
    fn get_max_borrow(self: @TContractState, safe_id: u64) -> u256;
    fn get_safe_owner(self: @TContractState, safe_id: u64) -> ContractAddress;

    // ---- Delegation (agent permissions) ----
    fn authorize_agent(ref self: TContractState, safe_id: u64, agent: ContractAddress);
    fn revoke_agent(ref self: TContractState, safe_id: u64, agent: ContractAddress);
    fn is_authorized(self: @TContractState, safe_id: u64, agent: ContractAddress) -> bool;
}
