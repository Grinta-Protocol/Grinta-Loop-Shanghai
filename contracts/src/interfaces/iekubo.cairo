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

/// Ekubo CallPoints — which lifecycle hooks the extension wants
#[derive(Copy, Drop, Serde)]
pub struct CallPoints {
    pub before_initialize_pool: bool,
    pub after_initialize_pool: bool,
    pub before_swap: bool,
    pub after_swap: bool,
    pub before_update_position: bool,
    pub after_update_position: bool,
    pub before_collect_fees: bool,
    pub after_collect_fees: bool,
}

/// Ekubo Core interface — just the set_call_points function we need
#[starknet::interface]
pub trait IEkuboCore<TContractState> {
    fn set_call_points(ref self: TContractState, call_points: CallPoints);
}
