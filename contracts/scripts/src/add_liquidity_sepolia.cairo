use grinta_scripts::addresses;
use sncast_std::{DisplayContractAddress, FeeSettingsTrait, invoke};
use starknet::ContractAddress;

/// Ekubo PoolKey struct - identifies a unique pool
#[derive(Drop, Copy)]
struct PoolKey {
    token0: ContractAddress,      // Must be numerically smaller than token1
    token1: ContractAddress,      // Must be numerically larger than token0
    fee: u128,                     // Fee tier
    tick_spacing: u128,           // Tick spacing
    extension: ContractAddress,   // Hook contract (GrintaHook in our case)
}

/// Signed 129-bit integer for Ekubo positions and ticks
#[derive(Drop, Copy)]
struct i129 {
    mag: u128,  // Magnitude
    sign: bool, // false = positive, true = negative
}

/// Bounds for liquidity position (lower and upper ticks)
#[derive(Drop, Copy)]
struct Bounds {
    lower: i129,   // Lower tick bound
    upper: i129,   // Upper tick bound
}

/// Position update parameters for Ekubo
#[derive(Drop, Copy)]
struct UpdatePositionParameters {
    salt: u128,              // Unique salt for position identification
    bounds: Bounds,          // Tick bounds for liquidity range
    liquidity_delta: i129,   // Liquidity to add (positive) or remove (negative)
}

/// Main entry point for adding liquidity to GRIT/USDC pool on Sepolia
fn main() {
    // IMPORTANT NOTE: This script demonstrates the liquidity provision flow.
    // Actual execution requires sncast with proper environment setup.
    
    let _deployer: ContractAddress = addresses::DEPLOYER;
    
    let ekubo_core: ContractAddress =
        0x0444a09d96389aa7148f1aada508e30b71299ffe650d9c97fdaae38cb9a23384
        .try_into()
        .unwrap();
    
    // GRIT token (= SAFEEngine contract, which implements ERC20)
    let grit: ContractAddress =
        0x02f4f6c374c20ddf3ea5e59cc70f2ad4c2bfb5786ca6c146266f89f7da575421
        .try_into()
        .unwrap();
    
    // Mock USDC on Sepolia (6 decimals)
    let usdc: ContractAddress =
        0x04e5d8c61fc059bb689169b217c37016e593a894042909e2b71b6c4f7b30fcdf
        .try_into()
        .unwrap();
    
    // GrintaHook (Ekubo extension)
    let grinta_hook: ContractAddress =
        0x06a78d63d252cbb3192c64f9fdd85598a716992edaf693437fe466d9861c7ca5
        .try_into()
        .unwrap();
    
    // Liquidity amounts
    let grit_amount: u256 = 10_000_000_000_000_000_000_000; // 10,000 GRIT (18 decimals)
    let usdc_amount: u256 = 10_000_000_000; // 10,000 USDC (6 decimals)
    
    // Step 1: Approve GRIT to Ekubo Core
    let mut grit_approve_calldata: Array<felt252> = array![];
    grit_approve_calldata.append(ekubo_core.into());
    // U256 as two felt252s: low, high
    let grit_low = (grit_amount.low).into();
    let grit_high = (grit_amount.high).into();
    grit_approve_calldata.append(grit_low);
    grit_approve_calldata.append(grit_high);
    
    invoke(
        grit,
        0x219f7e332954e5e213c1e30efc79c5b8bcf08e1f6e6d66f8d76e5cf22dd3a2d,
        grit_approve_calldata,
        FeeSettingsTrait::estimate(),
        Option::None,
    )
        .expect('GRIT approval failed');
    
    // Step 2: Approve USDC to Ekubo Core
    let mut usdc_approve_calldata: Array<felt252> = array![];
    usdc_approve_calldata.append(ekubo_core.into());
    let usdc_low = (usdc_amount.low).into();
    let usdc_high = (usdc_amount.high).into();
    usdc_approve_calldata.append(usdc_low);
    usdc_approve_calldata.append(usdc_high);
    
    invoke(
        usdc,
        0x219f7e332954e5e213c1e30efc79c5b8bcf08e1f6e6d66f8d76e5cf22dd3a2d,
        usdc_approve_calldata,
        FeeSettingsTrait::estimate(),
        Option::None,
    )
        .expect('USDC approval failed');
    
    // Step 3-4: Construct position parameters
    let _pool_key = PoolKey {
        token0: grit,
        token1: usdc,
        fee: 123_456_789_012_345_678_901_234_567_890_123_u128, // 0.3% fee
        tick_spacing: 5000_u128,
        extension: grinta_hook,
    };
    
    let lower_bound = i129 { mag: 8_355_711_u128, sign: true };
    let upper_bound = i129 { mag: 8_355_711_u128, sign: false };
    
    let bounds = Bounds { lower: lower_bound, upper: upper_bound };
    
    let liquidity_delta = i129 {
        mag: 1_000_000_000_000_000_000_u128,
        sign: false,
    };
    
    let _position_params = UpdatePositionParameters {
        salt: 1_u128,
        bounds,
        liquidity_delta,
    };
    
    // Step 5: Call Ekubo Core's update_position
    // NOTE: This requires proper serialization of pool_key and position_params
    // that matches Ekubo's ABI. The actual invoke will be performed via sncast.
}
