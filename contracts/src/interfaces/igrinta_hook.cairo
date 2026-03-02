use starknet::ContractAddress;
use grinta::types_ekubo::{PoolKey, SwapParameters, Delta, i129};

/// Ekubo extension interface — the hook must implement this
#[starknet::interface]
pub trait IExtension<TContractState> {
    fn before_initialize_pool(
        ref self: TContractState,
        caller: ContractAddress,
        pool_key: PoolKey,
        initial_tick: i129,
    ) -> u16;

    fn after_initialize_pool(
        ref self: TContractState,
        caller: ContractAddress,
        pool_key: PoolKey,
        initial_tick: i129,
    );

    fn before_swap(
        ref self: TContractState,
        caller: ContractAddress,
        pool_key: PoolKey,
        params: SwapParameters,
    );

    fn after_swap(
        ref self: TContractState,
        caller: ContractAddress,
        pool_key: PoolKey,
        params: SwapParameters,
        delta: Delta,
    );
}

/// Our hook's own interface for manual updates and reads
#[starknet::interface]
pub trait IGrintaHook<TContractState> {
    fn update(ref self: TContractState);
    fn get_market_price(self: @TContractState) -> u256;
    fn get_collateral_price(self: @TContractState) -> u256;
    fn get_last_update_time(self: @TContractState) -> u64;
}
