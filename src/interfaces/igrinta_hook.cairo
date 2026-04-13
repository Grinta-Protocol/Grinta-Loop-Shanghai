use starknet::ContractAddress;
use grinta::types_ekubo::{PoolKey, SwapParameters, UpdatePositionParameters, Delta, Bounds, i129};

/// Ekubo extension interface — must match Ekubo Core's IExtension exactly
#[starknet::interface]
pub trait IExtension<TContractState> {
    fn before_initialize_pool(
        ref self: TContractState,
        caller: ContractAddress,
        pool_key: PoolKey,
        initial_tick: i129,
    );

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

    fn before_update_position(
        ref self: TContractState,
        caller: ContractAddress,
        pool_key: PoolKey,
        params: UpdatePositionParameters,
    );

    fn after_update_position(
        ref self: TContractState,
        caller: ContractAddress,
        pool_key: PoolKey,
        params: UpdatePositionParameters,
        delta: Delta,
    );

    fn before_collect_fees(
        ref self: TContractState,
        caller: ContractAddress,
        pool_key: PoolKey,
        salt: felt252,
        bounds: Bounds,
    );

    fn after_collect_fees(
        ref self: TContractState,
        caller: ContractAddress,
        pool_key: PoolKey,
        salt: felt252,
        bounds: Bounds,
        delta: Delta,
    );
}

/// Our hook's own interface for manual updates and reads
#[starknet::interface]
pub trait IGrintaHook<TContractState> {
    fn update(ref self: TContractState);
    fn set_market_price(ref self: TContractState, price: u256);
    fn get_market_price(self: @TContractState) -> u256;
    fn get_collateral_price(self: @TContractState) -> u256;
    fn get_last_update_time(self: @TContractState) -> u64;
}
