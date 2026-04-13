use starknet::ContractAddress;

/// Signed 129-bit integer (Ekubo convention)
#[derive(Copy, Drop, Serde, starknet::Store)]
pub struct i129 {
    pub mag: u128,
    pub sign: bool,  // true = negative
}

/// Ekubo pool key — identifies a unique pool
#[derive(Copy, Drop, Serde, starknet::Store)]
pub struct PoolKey {
    pub token0: ContractAddress,
    pub token1: ContractAddress,
    pub fee: u128,
    pub tick_spacing: u128,
    pub extension: ContractAddress,
}

/// Ekubo swap parameters
#[derive(Copy, Drop, Serde)]
pub struct SwapParameters {
    pub amount: i129,
    pub is_token1: bool,
    pub sqrt_ratio_limit: u256,
    pub skip_ahead: u128,
}

/// Delta returned after swaps/updates
#[derive(Copy, Drop, Serde)]
pub struct Delta {
    pub amount0: i129,
    pub amount1: i129,
}

/// Tick bounds for a position
#[derive(Copy, Drop, Serde)]
pub struct Bounds {
    pub lower: i129,
    pub upper: i129,
}

/// Parameters for updating a liquidity position
#[derive(Copy, Drop, Serde)]
pub struct UpdatePositionParameters {
    pub salt: felt252,
    pub bounds: Bounds,
    pub liquidity_delta: i129,
}
