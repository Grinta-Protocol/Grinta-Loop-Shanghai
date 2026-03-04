use grinta_scripts::addresses;
use sncast_std::{FeeSettingsTrait, invoke};
use starknet::ContractAddress;

/// Main entry point for adding liquidity to GRIT/USDC pool on Sepolia
fn main() {
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
    let _grinta_hook: ContractAddress =
        0x06a78d63d252cbb3192c64f9fdd85598a716992edaf693437fe466d9861c7ca5
        .try_into()
        .unwrap();
    
    // Liquidity amounts
    let grit_amount: u256 = 10_000_000_000_000_000_000_000; // 10,000 GRIT (18 decimals)
    let usdc_amount: u256 = 10_000_000_000; // 10,000 USDC (6 decimals)
    
    // =========================================================================
    // Step 1: Approve GRIT to Ekubo Core
    // =========================================================================
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
    
    // =========================================================================
    // Step 2: Approve USDC to Ekubo Core
    // =========================================================================
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
    
    // =========================================================================
    // Step 3: Construct and use pool key for update_position
    // =========================================================================
    // Note: Full implementation of update_position would require proper
    // Ekubo ABI structures. For now, approvals are the key step that
    // allows the liquidity provision to proceed.
}
