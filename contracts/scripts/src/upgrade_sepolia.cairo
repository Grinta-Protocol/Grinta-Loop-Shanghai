use grinta_scripts::{addresses, constants, deploy_helpers};
use sncast_std::{DisplayContractAddress, FeeSettingsTrait, invoke};
use starknet::ContractAddress;

/// Upgrade script: redeploy GrintaHook + SafeManager with keeper-less architecture
/// Reuses existing: SAFEEngine, CollateralJoin, PIDController, MockWBTC
/// Deploys new: MockUSDC, GrintaHook (with price-from-delta), SafeManager (with hook)
/// Wires everything up and mints test tokens
fn main() {
    let admin: ContractAddress = addresses::DEPLOYER;
    println!("Upgrading Grinta on Sepolia with admin: {}", admin);
    println!("Reusing existing contracts:");
    println!("  SAFEEngine:     {}", addresses::SAFE_ENGINE);
    println!("  CollateralJoin: {}", addresses::COLLATERAL_JOIN);
    println!("  PIDController:  {}", addresses::PID_CONTROLLER);
    println!("  MockWBTC:       {}", addresses::MOCK_WBTC);

    let safe_engine = addresses::SAFE_ENGINE;
    let collateral_join = addresses::COLLATERAL_JOIN;
    let pid_controller = addresses::PID_CONTROLLER;
    let mock_wbtc = addresses::MOCK_WBTC;

    // =========================================================================
    // 1. Deploy MockUSDC (ERC20Mintable, 6 decimals)
    // =========================================================================
    println!("1. Deploying MockUSDC...");
    let mock_usdc: ContractAddress = deploy_helpers::deploy_mock_usdc();
    println!("   MockUSDC: {}", mock_usdc);

    // =========================================================================
    // 2. Redeploy GrintaHook (with price-from-delta, dual throttle)
    //    Uses MockEkuboOracle for BTC/USDC, computes GRIT/USDC from swap delta
    // =========================================================================
    println!("2. Deploying new GrintaHook...");
    let grinta_hook: ContractAddress = deploy_helpers::deploy_grinta_hook(
        admin,
        safe_engine,
        pid_controller,
        addresses::EKUBO_ORACLE, // MockEkuboOracle for BTC/USDC reads
        addresses::EKUBO_CORE,   // Ekubo Core (for set_call_points registration)
        safe_engine,             // grit_token = SAFEEngine (it IS the ERC20)
        mock_wbtc,               // wbtc_token
        mock_usdc,               // usdc_token (MockUSDC for pool)
    );
    println!("   GrintaHook: {}", grinta_hook);

    // 2b. Register extension with Ekubo Core (set_call_points)
    println!("2b. Registering extension with Ekubo Core...");
    invoke(
        grinta_hook, selector!("register_extension"), array![],
        FeeSettingsTrait::estimate(), Option::None,
    )
        .expect('register_extension fail');
    println!("   Extension registered with Ekubo Core");

    // =========================================================================
    // 3. Redeploy SafeManager (with hook for keeper-less updates)
    // =========================================================================
    println!("3. Deploying new SafeManager...");
    let safe_manager: ContractAddress = deploy_helpers::deploy_safe_manager(
        admin, safe_engine, collateral_join, grinta_hook,
    );
    println!("   SafeManager: {}", safe_manager);

    // =========================================================================
    // 4. Re-wire permissions
    // =========================================================================
    println!("4. Wiring permissions...");

    // SAFEEngine: set_safe_manager(new_manager)
    let mut calldata: Array<felt252> = array![];
    Serde::serialize(@safe_manager, ref calldata);
    invoke(
        safe_engine, selector!("set_safe_manager"), calldata,
        FeeSettingsTrait::estimate(), Option::None,
    )
        .expect('set_safe_manager fail');
    println!("   safe_engine.set_safe_manager(new) OK");

    // CollateralJoin: set_safe_manager(new_manager)
    let mut calldata: Array<felt252> = array![];
    Serde::serialize(@safe_manager, ref calldata);
    invoke(
        collateral_join, selector!("set_safe_manager"), calldata,
        FeeSettingsTrait::estimate(), Option::None,
    )
        .expect('join set_safe_manager fail');
    println!("   collateral_join.set_safe_manager(new) OK");

    // PIDController: set_seed_proposer(new_hook)
    let mut calldata: Array<felt252> = array![];
    Serde::serialize(@grinta_hook, ref calldata);
    invoke(
        pid_controller, selector!("set_seed_proposer"), calldata,
        FeeSettingsTrait::estimate(), Option::None,
    )
        .expect('set_seed_proposer fail');
    println!("   pid_controller.set_seed_proposer(new_hook) OK");

    // =========================================================================
    // 5. Set initial BTC price ($60k) via temp hook override
    // =========================================================================
    println!("5. Setting initial BTC price...");

    // Temporarily set hook to admin
    let mut calldata: Array<felt252> = array![];
    Serde::serialize(@admin, ref calldata);
    invoke(
        safe_engine, selector!("set_hook"), calldata,
        FeeSettingsTrait::estimate(), Option::None,
    )
        .expect('set_hook(admin) fail');

    // Set BTC price
    let mut calldata: Array<felt252> = array![];
    let btc_price: u256 = constants::btc_initial_price();
    Serde::serialize(@btc_price, ref calldata);
    invoke(
        safe_engine, selector!("update_collateral_price"), calldata,
        FeeSettingsTrait::estimate(), Option::None,
    )
        .expect('update_collateral_price fail');
    println!("   BTC price set to $60,000");

    // Set real hook
    let mut calldata: Array<felt252> = array![];
    Serde::serialize(@grinta_hook, ref calldata);
    invoke(
        safe_engine, selector!("set_hook"), calldata,
        FeeSettingsTrait::estimate(), Option::None,
    )
        .expect('set_hook(real) fail');
    println!("   safe_engine.set_hook(new_hook) OK");

    // =========================================================================
    // 6. Mint test tokens
    // =========================================================================
    println!("6. Minting test tokens...");

    // Mint 20 WBTC to deployer
    let mut calldata: Array<felt252> = array![];
    Serde::serialize(@admin, ref calldata);
    let wbtc_amount: u256 = constants::wbtc_upgrade_mint_amount();
    Serde::serialize(@wbtc_amount, ref calldata);
    invoke(
        mock_wbtc, selector!("mint"), calldata,
        FeeSettingsTrait::estimate(), Option::None,
    )
        .expect('mint wbtc fail');
    println!("   Minted 20 WBTC to deployer");

    // Mint 10,000 MockUSDC to deployer
    let mut calldata: Array<felt252> = array![];
    Serde::serialize(@admin, ref calldata);
    let usdc_amount: u256 = constants::usdc_mint_amount();
    Serde::serialize(@usdc_amount, ref calldata);
    invoke(
        mock_usdc, selector!("mint"), calldata,
        FeeSettingsTrait::estimate(), Option::None,
    )
        .expect('mint usdc fail');
    println!("   Minted 10,000 MockUSDC to deployer");

    // =========================================================================
    // 7. Summary
    // =========================================================================
    println!("-------------------------------------------------");
    println!("Grinta Sepolia Upgrade Complete!");
    println!("-------------------------------------------------");
    println!("NEW CONTRACTS:");
    println!("  MockUSDC:     {}", mock_usdc);
    println!("  GrintaHook:   {}", grinta_hook);
    println!("  SafeManager:  {}", safe_manager);
    println!("-------------------------------------------------");
    println!("REUSED CONTRACTS:");
    println!("  SAFEEngine:     {}", safe_engine);
    println!("  CollateralJoin: {}", collateral_join);
    println!("  PIDController:  {}", pid_controller);
    println!("  MockWBTC:       {}", mock_wbtc);
    println!("-------------------------------------------------");
    println!("NEXT STEPS:");
    println!("  1. Initialize GRIT/MockUSDC pool on Ekubo with GrintaHook as extension");
    println!("  2. Open SAFE + borrow GRIT via SafeManager");
    println!("  3. Add liquidity to GRIT/MockUSDC pool");
    println!("  4. Update frontend addresses in app/src/lib/contracts.js");
    println!("-------------------------------------------------");
}
