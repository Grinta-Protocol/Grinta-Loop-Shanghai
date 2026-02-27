use starknet::ContractAddress;

#[starknet::interface]
pub trait ICollateralJoin<TContractState> {
    fn join(ref self: TContractState, user: ContractAddress, amount: u256) -> u256;
    fn exit(ref self: TContractState, user: ContractAddress, amount: u256) -> u256;
    fn get_collateral_token(self: @TContractState) -> ContractAddress;
    fn get_total_assets(self: @TContractState) -> u256;
    fn convert_to_internal(self: @TContractState, asset_amount: u256) -> u256;
    fn convert_to_assets(self: @TContractState, internal_amount: u256) -> u256;
}
