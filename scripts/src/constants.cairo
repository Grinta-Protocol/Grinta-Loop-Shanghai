// =============================================================================
// Deployment constants for Grinta on Sepolia
// =============================================================================

/// Max fee for sncast transactions (~0.005 ETH, sufficient for Sepolia)
pub const MAX_FEE: felt252 = 5000000000000000; // 5e15 wei = 0.005 ETH

// -- SAFEEngine params --

/// Debt ceiling: 1,000,000 GRIT (WAD = 1e18)
pub fn debt_ceiling() -> u256 {
    1_000_000_000_000_000_000_000_000 // 1e24 = 1_000_000 * 1e18
}

/// Liquidation ratio: 150% (WAD)
pub fn liquidation_ratio() -> u256 {
    1_500_000_000_000_000_000 // 1.5e18
}

// -- PID Controller params --

/// Kp: proportional gain = 1.0 (WAD)
pub const KP: i128 = 1_000_000_000_000_000_000; // 1e18

/// Ki: integral gain = 0.5 (WAD)
pub const KI: i128 = 500_000_000_000_000_000; // 5e17

/// Noise barrier: 0.95 (WAD) — minimum deviation before PID acts
pub fn noise_barrier() -> u256 {
    950_000_000_000_000_000 // 0.95e18
}

/// Integral period: 3600 seconds (1 hour)
pub const INTEGRAL_PERIOD: u64 = 3600;

/// Feedback output upper bound: RAY (1e27) — max positive rate adjustment
pub fn feedback_upper_bound() -> u256 {
    1_000_000_000_000_000_000_000_000_000 // 1e27 = RAY
}

/// Feedback output lower bound: -RAY (-1e27) — max negative rate adjustment
pub const FEEDBACK_LOWER_BOUND: i128 = -1_000_000_000_000_000_000_000_000_000; // -1e27

/// Per-second cumulative leak: ~99.9997% per second (from HAI)
pub fn per_second_leak() -> u256 {
    999_997_208_243_937_652_252_849_536
}

// -- Collateral params --

/// WBTC has 8 decimals
pub const WBTC_DECIMALS: u8 = 8;

/// Initial BTC/USD price: $60,000 (WAD)
pub fn btc_initial_price() -> u256 {
    60_000_000_000_000_000_000_000 // 60_000 * 1e18
}

/// Mint 10 WBTC to deployer for testing: 10 * 10^8 satoshis
pub fn wbtc_mint_amount() -> u256 {
    1_000_000_000 // 10 * 1e8
}
