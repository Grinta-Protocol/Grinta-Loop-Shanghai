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
    pub skip_ahead: u32,
}

/// Delta returned after swaps/updates
#[derive(Copy, Drop, Serde)]
pub struct Delta {
    pub amount0: i129,
    pub amount1: i129,
}

/// Call points bitflags — returned by before_initialize_pool to tell Ekubo which hooks to call
pub const CALL_POINTS_AFTER_SWAP: u16 = 0x08; // bit 3
