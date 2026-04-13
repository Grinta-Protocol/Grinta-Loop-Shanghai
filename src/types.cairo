use starknet::ContractAddress;

// ============================================================================
// Fixed-point math constants (WAD = 18 decimals, RAY = 27 decimals)
// ============================================================================

pub const WAD: u256 = 1_000_000_000_000_000_000; // 1e18
pub const RAY: u256 = 1_000_000_000_000_000_000_000_000_000; // 1e27
pub const WAD_u128: u128 = 1_000_000_000_000_000_000;
pub const RAY_u128: u128 = 1_000_000_000_000_000_000_000_000_000;
pub const WAD_i128: i128 = 1_000_000_000_000_000_000;
pub const RAY_i128: i128 = 1_000_000_000_000_000_000_000_000_000;

// ============================================================================
// Unsigned fixed-point math
// ============================================================================

pub fn wmul(a: u256, b: u256) -> u256 {
    (a * b + WAD / 2) / WAD
}

pub fn wdiv(a: u256, b: u256) -> u256 {
    (a * WAD + b / 2) / b
}

pub fn rmul(a: u256, b: u256) -> u256 {
    (a * b + RAY / 2) / RAY
}

pub fn rdiv(a: u256, b: u256) -> u256 {
    (a * RAY + b / 2) / b
}

/// rpow: base^exp in RAY precision (unsigned)
pub fn rpow(base: u256, exp: u256) -> u256 {
    if exp == 0 {
        return RAY;
    }
    if base == 0 {
        return 0;
    }
    let mut result: u256 = RAY;
    let mut b = base;
    let mut e = exp;
    loop {
        if e == 0 {
            break;
        }
        if e % 2 == 1 {
            result = rmul(result, b);
        }
        b = rmul(b, b);
        e = e / 2;
    };
    result
}

// ============================================================================
// Signed fixed-point math (i128 — sufficient for WAD precision)
// ============================================================================

pub fn abs_i128(x: i128) -> u128 {
    if x < 0 {
        let neg: u128 = (-x).try_into().unwrap();
        neg
    } else {
        x.try_into().unwrap()
    }
}

/// Signed wmul: (a * b) / WAD
pub fn swmul(a: i128, b: i128) -> i128 {
    let a_u: u256 = abs_i128(a).into();
    let b_u: u256 = abs_i128(b).into();
    let product: u256 = a_u * b_u;
    let result_u: u256 = (product + WAD / 2) / WAD;
    let result_u128: u128 = result_u.try_into().unwrap();
    let neg = (a < 0) != (b < 0);
    if neg {
        -(result_u128.try_into().unwrap())
    } else {
        result_u128.try_into().unwrap()
    }
}

/// Signed rdiv: (a * RAY) / b
pub fn srdiv(a: i128, b: i128) -> i128 {
    let a_u: u256 = abs_i128(a).into();
    let b_u: u256 = abs_i128(b).into();
    let result_u: u256 = (a_u * RAY + b_u / 2) / b_u;
    let result_u128: u128 = result_u.try_into().unwrap();
    let neg = (a < 0) != (b < 0);
    if neg {
        -(result_u128.try_into().unwrap())
    } else {
        result_u128.try_into().unwrap()
    }
}

/// Signed rmul: (a * b) / RAY
pub fn srmul(a: i128, b: u256) -> i128 {
    let a_u: u256 = abs_i128(a).into();
    let result_u: u256 = (a_u * b + RAY / 2) / RAY;
    let result_u128: u128 = result_u.try_into().unwrap();
    if a < 0 {
        -(result_u128.try_into().unwrap())
    } else {
        result_u128.try_into().unwrap()
    }
}

/// Riemann sum (trapezoidal): (a + b) / 2
pub fn riemann_sum(a: i128, b: i128) -> i128 {
    (a + b) / 2
}


// ============================================================================
// Core data structures
// ============================================================================

/// A safe (vault/trove) holding collateral and debt
#[derive(Copy, Drop, Serde, starknet::Store)]
pub struct Safe {
    pub collateral: u256,    // WBTC collateral in internal units (WAD)
    pub debt: u256,          // Outstanding Grit debt (WAD)
}

/// Health metrics for a safe or the system
#[derive(Copy, Drop, Serde)]
pub struct Health {
    pub collateral_value: u256,  // USD value of collateral (WAD)
    pub debt: u256,              // Outstanding debt (WAD)
    pub ltv: u256,               // Loan-to-value ratio (WAD, 0.5e18 = 50%)
    pub liquidation_price: u256, // BTC price at which position is liquidatable (WAD)
}

/// PID controller state observation
#[derive(Copy, Drop, Serde, starknet::Store)]
pub struct DeviationObservation {
    pub timestamp: u64,
    pub proportional: i128,   // Current proportional term (WAD-scaled)
    pub integral: i128,       // Accumulated integral term (WAD-scaled)
}

/// PID controller parameters
#[derive(Copy, Drop, Serde, starknet::Store)]
pub struct PIDControllerParams {
    pub noise_barrier: u256,               // Min deviation to trigger (WAD, e.g. 0.95e18)
    pub integral_period_size: u64,         // Min seconds between updates
    pub feedback_output_upper_bound: u256, // Max positive rate adjustment (RAY)
    pub feedback_output_lower_bound: i128, // Max negative rate adjustment (RAY, signed)
    pub per_second_cumulative_leak: u256,  // Integral decay per second (RAY, < 1e27)
}

/// PID controller gains
#[derive(Copy, Drop, Serde, starknet::Store)]
pub struct ControllerGains {
    pub kp: i128,  // Proportional gain (WAD)
    pub ki: i128,  // Integral gain (WAD)
}

/// Collateral auction state
#[derive(Copy, Drop, Serde, starknet::Store)]
pub struct Auction {
    pub collateral_amount: u256,     // Remaining collateral to sell (WAD)
    pub debt_to_raise: u256,         // Remaining debt to cover with penalty (WAD)
    pub start_time: u64,             // Auction start timestamp
    pub safe_owner: ContractAddress, // Receives leftover collateral
    pub settled: bool,               // Whether auction is complete
}
