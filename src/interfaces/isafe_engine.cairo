use starknet::ContractAddress;
use grinta::types::{Safe, Health};

#[starknet::interface]
pub trait ISAFEEngine<TContractState> {
    // ---- Getters ----
    fn get_safe(self: @TContractState, safe_id: u64) -> Safe;
    fn get_safe_count(self: @TContractState) -> u64;
    fn get_safe_owner(self: @TContractState, safe_id: u64) -> ContractAddress;
    fn get_safe_health(self: @TContractState, safe_id: u64) -> Health;
    fn get_system_health(self: @TContractState) -> Health;
    fn get_collateral_price(self: @TContractState) -> u256;
    fn get_redemption_price(self: @TContractState) -> u256;
    fn get_redemption_rate(self: @TContractState) -> u256;
    fn get_total_debt(self: @TContractState) -> u256;
    fn get_total_collateral(self: @TContractState) -> u256;
    fn get_debt_ceiling(self: @TContractState) -> u256;
    fn get_liquidation_ratio(self: @TContractState) -> u256;
    fn get_grit_balance(self: @TContractState, account: ContractAddress) -> u256;

    // ---- Safe operations (called by SafeManager) ----
    fn create_safe(ref self: TContractState, owner: ContractAddress) -> u64;
    fn deposit_collateral(ref self: TContractState, safe_id: u64, amount: u256);
    fn withdraw_collateral(ref self: TContractState, safe_id: u64, amount: u256);
    fn borrow(ref self: TContractState, safe_id: u64, amount: u256);
    fn repay(ref self: TContractState, safe_id: u64, amount: u256);

    // ---- Oracle/Hook updates (called by GrintaHook) ----
    fn update_collateral_price(ref self: TContractState, price: u256);
    fn update_redemption_rate(ref self: TContractState, rate: u256);

    // ---- Admin ----
    fn set_debt_ceiling(ref self: TContractState, ceiling: u256);
    fn set_liquidation_ratio(ref self: TContractState, ratio: u256);
    fn set_collateral_join(ref self: TContractState, join: ContractAddress);
    fn set_safe_manager(ref self: TContractState, manager: ContractAddress);
    fn set_hook(ref self: TContractState, hook: ContractAddress);
}
