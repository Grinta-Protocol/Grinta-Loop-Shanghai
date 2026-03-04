use grinta_scripts::{addresses, constants};
use sncast_std::{FeeSettingsTrait, invoke};
use starknet::{ContractAddress, selector, Serde};

/// Ekubo PoolKey struct - identifies a unique pool
#[derive(Drop, Serde, Copy)]
struct PoolKey {
    token0: ContractAddress,      // Must be numerically smaller than token1
    token1: ContractAddress,      // Must be numerically larger than token0
    fee: u128,                     // Fee tier
    tick_spacing: u128,           // Tick spacing
    extension: ContractAddress,   // Hook contract (GrintaHook in our case)
}

/// Signed 129-bit integer for Ekubo positions and ticks
#[derive(Drop, Serde, Copy)]
struct i129 {
    mag: u128,  // Magnitude
    sign: bool, // false = positive, true = negative
}

/// Bounds for liquidity position (lower and upper ticks)
#[derive(Drop, Serde, Copy)]
struct Bounds {
    lower: i129,   // Lower tick bound
    upper: i129,   // Upper tick bound
}

/// Position update parameters for Ekubo
#[derive(Drop, Serde, Copy)]
struct UpdatePositionParameters {
    salt: u128,              // Unique salt for position identification
    bounds: Bounds,          // Tick bounds for liquidity range
    liquidity_delta: i129,   // Liquidity to add (positive) or remove (negative)
}

/// Main entry point for adding liquidity to GRIT/USDC pool on Sepolia
fn main() {
    // =========================================================================
    // 1. Setup constants
    // =========================================================================
    let deployer: ContractAddress = addresses::DEPLOYER;
    
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
    
    println!("-------------------------------------------------");
    println!("Adding Liquidity to GRIT/USDC Pool");
    println!("-------------------------------------------------");
    println!("Deployer: {}", deployer);
    println!("GRIT amount: {}", grit_amount);
    println!("USDC amount: {}", usdc_amount);
    println!("-------------------------------------------------");
    
    // =========================================================================
    // 2. Approve tokens to Ekubo Core (required before position updates)
    // =========================================================================
    println!("1. Approving GRIT to Ekubo Core...");
    let mut grit_approve_calldata: Array<felt252> = array![];
    Serde::serialize(@ekubo_core, ref grit_approve_calldata);
    Serde::serialize(@grit_amount, ref grit_approve_calldata);
    invoke(
        grit,
        selector!("approve"),
        grit_approve_calldata,
        FeeSettingsTrait::estimate(),
        Option::None,
    )
        .expect('GRIT approval failed');
    println!("   ✓ GRIT approved");
    
    println!("2. Approving USDC to Ekubo Core...");
    let mut usdc_approve_calldata: Array<felt252> = array![];
    Serde::serialize(@ekubo_core, ref usdc_approve_calldata);
    Serde::serialize(@usdc_amount, ref usdc_approve_calldata);
    invoke(
        usdc,
        selector!("approve"),
        usdc_approve_calldata,
        FeeSettingsTrait::estimate(),
        Option::None,
    )
        .expect('USDC approval failed');
    println!("   ✓ USDC approved");
    
    // =========================================================================
    // 3. Construct PoolKey
    // =========================================================================
    // IMPORTANT: token0 must be numerically smaller than token1
    // GRIT (0x02f...) < USDC (0x04e...), so GRIT is token0
    println!("3. Constructing pool key...");
    
    let pool_key = PoolKey {
        token0: grit,
        token1: usdc,
        fee: 123_456_789_012_345_678_901_234_567_890_123_u128, // 0.3% fee (typical Ekubo)
        tick_spacing: 5000_u128, // Typical tick spacing for standard pools
        extension: grinta_hook, // GrintaHook handles after_swap callbacks
    };
    println!("   Pool: GRIT(token0) -> USDC(token1)");
    println!("   Extension: GrintaHook");
    
    // =========================================================================
    // 4. Construct position bounds and liquidity delta
    // =========================================================================
    println!("4. Setting position parameters...");
    
    // Use full-range liquidity (wide bounds close to i129 limits)
    // Lower tick: -8355711 (near minimum)
    // Upper tick: +8355711 (near maximum)
    let lower_bound = i129 { mag: 8_355_711_u128, sign: true };  // -8355711
    let upper_bound = i129 { mag: 8_355_711_u128, sign: false }; // +8355711
    
    let bounds = Bounds { lower: lower_bound, upper: upper_bound };
    
    // Liquidity delta to add (positive magnitude, sign=false for adding)
    // This is the core position size
    let liquidity_delta = i129 {
        mag: 1_000_000_000_000_000_000_u128, // 1e18 liquidity units
        sign: false, // false = positive (adding), true = negative (removing)
    };
    
    // Create unique salt for this position
    let salt: u128 = 1_u128;
    
    let position_params = UpdatePositionParameters {
        salt,
        bounds,
        liquidity_delta,
    };
    
    println!("   Position range: FULL (min to max ticks)");
    println!("   Liquidity delta: {}", liquidity_delta.mag);
    
    // =========================================================================
    // 5. Call Ekubo Core's update_position to add liquidity
    // =========================================================================
    println!("5. Adding liquidity via Ekubo Core...");
    
    let mut liquidity_calldata: Array<felt252> = array![];
    Serde::serialize(@pool_key, ref liquidity_calldata);
    Serde::serialize(@position_params, ref liquidity_calldata);
    
    invoke(
        ekubo_core,
        selector!("update_position"),
        liquidity_calldata,
        FeeSettingsTrait::estimate(),
        Option::None,
    )
        .expect('Liquidity provision failed');
    
    println!("   ✓ Liquidity added successfully!");
    
    // =========================================================================
    // 6. Summary and next steps
    // =========================================================================
    println!("-------------------------------------------------");
    println!("Liquidity Provision Complete!");
    println!("-------------------------------------------------");
    println!("Summary:");
    println!("  Pool: GRIT/USDC on Ekubo Sepolia");
    println!("  GRIT provided: 10,000");
    println!("  USDC provided: 10,000");
    println!("  Range: Full (min to max ticks)");
    println!("  Hook: GrintaHook (after_swap enabled)");
    println!("-------------------------------------------------");
    println!("Next steps:");
    println!("  1. Verify liquidity was added on Ekubo");
    println!("  2. Trigger a test swap (1,000 USDC → GRIT)");
    println!("  3. Check GrintaHook events (MarketPriceUpdated, etc)");
    println!("  4. Monitor SAFEEngine state changes");
    println!("  5. Verify PID controller rate updates");
    println!("-------------------------------------------------");
}
