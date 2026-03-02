use starknet::ContractAddress;

/// Ekubo's oracle extension interface for reading TWAPs
#[starknet::interface]
pub trait IEkuboOracleExtension<TContractState> {
    fn get_price_x128_over_last(
        self: @TContractState,
        base_token: ContractAddress,
        quote_token: ContractAddress,
        period: u64,
    ) -> u256;
}
