use grinta_scripts::{addresses, constants, deploy_helpers};
use sncast_std::{DisplayContractAddress, FeeSettingsTrait, invoke};
use starknet::ContractAddress;

/// Main deployment orchestrator for Grinta on Sepolia - FRESH DEPLOYMENT
fn main() {
    let admin: ContractAddress = addresses::DEPLOYER;
    println!("Deploying Grinta to Sepolia with admin: {}", admin);

    // =========================================================================
    // 1. Deploy MockWBTC (ERC20Mintable, 8 decimals, anyone can mint)
    // =========================================================================
    println!("1. Deploying MockWBTC...");
    let mock_wbtc: ContractAddress = deploy_helpers::deploy_mock_wbtc();
    println!("   MockWBTC: {}", mock_wbtc);

    // =========================================================================
    // 2. Deploy SAFEEngine (core ledger + Grit ERC20 + redemption price)
    // =========================================================================
    println!("2. Deploying SAFEEngine...");
    let safe_engine: ContractAddress = deploy_helpers::deploy_safe_engine(admin);
    println!("   SAFEEngine: {}", safe_engine);

    // =========================================================================
    // 3. Deploy CollateralJoin (WBTC custody, 8→18 decimal conversion)
    // =========================================================================
    println!("3. Deploying CollateralJoin...");
    let collateral_join: ContractAddress = deploy_helpers::deploy_collateral_join(
        admin, mock_wbtc, safe_engine,
    );
    println!("   CollateralJoin: {}", collateral_join);

    // =========================================================================
    // 4. Deploy PIDController (HAI-style PI with leaky integrator)
    //    seed_proposer = admin temporarily, will be set to hook later
    // =========================================================================
    println!("4. Deploying PIDController...");
    let pid_controller: ContractAddress = deploy_helpers::deploy_pid_controller(admin, admin);
    println!("   PIDController: {}", pid_controller);

    // =========================================================================
    // 5. Deploy MockEkuboOracle (for BTC/USD price)
    // =========================================================================
    println!("5. Deploying MockEkuboOracle...");
    let mock_oracle: ContractAddress = deploy_helpers::deploy_mock_ekubo_oracle();
    println!("   MockEkuboOracle: {}", mock_oracle);

    // =========================================================================
    // 6. Deploy GrintaHook (Ekubo extension for keeper-less price updates)
    // =========================================================================
    println!("6. Deploying GrintaHook...");
    let grinta_hook: ContractAddress = deploy_helpers::deploy_grinta_hook(
        admin,
        safe_engine,
        pid_controller,
        mock_oracle,
        addresses::EKUBO_CORE,
        safe_engine, // grit_token = SAFEEngine (it's the GRIT ERC20)
        mock_wbtc,
        addresses::USDC,
    );
    println!("   GrintaHook: {}", grinta_hook);

    // =========================================================================
    // 7. Deploy SafeManager (user operations)
    // =========================================================================
    println!("7. Deploying SafeManager...");
    let safe_manager: ContractAddress = deploy_helpers::deploy_safe_manager(
        admin, safe_engine, collateral_join, grinta_hook,
    );
    println!("   SafeManager: {}", safe_manager);

    // =========================================================================
    // 8. Wire permissions via invoke
    // =========================================================================
    println!("8. Wiring permissions...");

    // SAFEEngine: set_safe_manager
    let mut calldata: Array<felt252> = array![];
    Serde::serialize(@safe_manager, ref calldata);
    invoke(
        safe_engine, selector!("set_safe_manager"), calldata,
        FeeSettingsTrait::estimate(), Option::None,
    )
        .expect('set_safe_manager fail');
    println!("   safe_engine.set_safe_manager(manager) OK");

    // SAFEEngine: set_collateral_join
    let mut calldata: Array<felt252> = array![];
    Serde::serialize(@collateral_join, ref calldata);
    invoke(
        safe_engine, selector!("set_collateral_join"), calldata,
        FeeSettingsTrait::estimate(), Option::None,
    )
        .expect('set_collateral_join fail');
    println!("   safe_engine.set_collateral_join(join) OK");

    // CollateralJoin: set_safe_manager
    let mut calldata: Array<felt252> = array![];
    Serde::serialize(@safe_manager, ref calldata);
    invoke(
        collateral_join, selector!("set_safe_manager"), calldata,
        FeeSettingsTrait::estimate(), Option::None,
    )
        .expect('join set_safe_manager fail');
    println!("   collateral_join.set_safe_manager(manager) OK");

    // PIDController: set_seed_proposer → hook
    let mut calldata: Array<felt252> = array![];
    Serde::serialize(@grinta_hook, ref calldata);
    invoke(
        pid_controller, selector!("set_seed_proposer"), calldata,
        FeeSettingsTrait::estimate(), Option::None,
    )
        .expect('set_seed_proposer fail');
    println!("   pid_controller.set_seed_proposer(hook) OK");

    // =========================================================================
    // 9. Set initial BTC price
    // =========================================================================
    println!("9. Setting initial BTC price...");

    // Temporarily set hook to admin so we can call update_collateral_price
    let mut calldata: Array<felt252> = array![];
    Serde::serialize(@admin, ref calldata);
    invoke(
        safe_engine, selector!("set_hook"), calldata,
        FeeSettingsTrait::estimate(), Option::None,
    )
        .expect('set_hook(admin) fail');

    // Set initial BTC price
    let mut calldata: Array<felt252> = array![];
    let btc_price: u256 = constants::btc_initial_price();
    Serde::serialize(@btc_price, ref calldata);
    invoke(
        safe_engine, selector!("update_collateral_price"), calldata,
        FeeSettingsTrait::estimate(), Option::None,
    )
        .expect('update_collateral_price fail');
    println!("   BTC price set to $60,000");

    // Now set the real hook
    let mut calldata: Array<felt252> = array![];
    Serde::serialize(@grinta_hook, ref calldata);
    invoke(
        safe_engine, selector!("set_hook"), calldata,
        FeeSettingsTrait::estimate(), Option::None,
    )
        .expect('set_hook(real) fail');
    println!("   safe_engine.set_hook(grinta_hook) OK");

    // =========================================================================
    // 10. Register GrintaHook with Ekubo Core
    // =========================================================================
    println!("10. Registering GrintaHook with Ekubo Core...");
    invoke(
        grinta_hook,
        selector!("register_extension"),
        array![],
        FeeSettingsTrait::estimate(),
        Option::None,
    )
        .expect('register_extension failed');
    println!("   GrintaHook registered for after_swap callbacks");

    // =========================================================================
    // 11. Mint test WBTC to admin (10 WBTC = 1e9 satoshis)
    // =========================================================================
    println!("11. Minting test WBTC to admin...");
    let mut calldata: Array<felt252> = array![];
    Serde::serialize(@admin, ref calldata);
    let mint_amount: u256 = constants::wbtc_mint_amount();
    Serde::serialize(@mint_amount, ref calldata);
    invoke(
        mock_wbtc, selector!("mint"), calldata,
        FeeSettingsTrait::estimate(), Option::None,
    )
        .expect('mint wbtc fail');
    println!("   Minted 10 WBTC to admin");

    // =========================================================================
    // Summary
    // =========================================================================
    println!("-------------------------------------------------");
    println!("Grinta Sepolia Deployment Complete!");
    println!("-------------------------------------------------");
    println!("MockWBTC:         {}", mock_wbtc);
    println!("SAFEEngine:       {}", safe_engine);
    println!("CollateralJoin:   {}", collateral_join);
    println!("PIDController:    {}", pid_controller);
    println!("MockEkuboOracle:  {}", mock_oracle);
    println!("GrintaHook:       {}", grinta_hook);
    println!("SafeManager:      {}", safe_manager);
    println!("-------------------------------------------------");
    println!("Ekubo Core:       {}", addresses::EKUBO_CORE);
    println!("Ekubo Positions:  {}", addresses::EKUBO_POSITIONS);
    println!("Ekubo Oracle:     {}", addresses::EKUBO_ORACLE);
    println!("USDC:             {}", addresses::USDC);
    println!("-------------------------------------------------");
    println!("");
    println!("=== NEW ADDRESSES TO SAVE ===");
    println!("MOCK_WBTC:        {}", mock_wbtc);
    println!("SAFE_ENGINE:      {}", safe_engine);
    println!("COLLATERAL_JOIN:  {}", collateral_join);
    println!("PID_CONTROLLER:   {}", pid_controller);
    println!("MOCK_EKUBO_ORACLE: {}", mock_oracle);
    println!("GRINTA_HOOK:      {}", grinta_hook);
    println!("SAFE_MANAGER:     {}", safe_manager);
}
