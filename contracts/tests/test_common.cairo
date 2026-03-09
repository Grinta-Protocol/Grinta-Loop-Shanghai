use starknet::ContractAddress;
use snforge_std::{declare, DeclareResultTrait, ContractClassTrait, cheat_caller_address, CheatSpan, start_cheat_block_timestamp_global};

use grinta::interfaces::isafe_engine::{ISAFEEngineDispatcher, ISAFEEngineDispatcherTrait};
use grinta::interfaces::icollateral_join::{ICollateralJoinDispatcher};
use grinta::interfaces::ipid_controller::{IPIDControllerDispatcher};
use grinta::interfaces::igrinta_hook::{IGrintaHookDispatcher, IGrintaHookDispatcherTrait};
use grinta::interfaces::isafe_manager::{ISafeManagerDispatcher};
use grinta::interfaces::ierc20::{IERC20Dispatcher, IERC20DispatcherTrait};

// ============================================================================
// Constants
// ============================================================================

pub const WAD: u256 = 1_000_000_000_000_000_000; // 1e18
pub const RAY: u256 = 1_000_000_000_000_000_000_000_000_000; // 1e27

// BTC price: $60,000 in WAD
pub const BTC_PRICE_WAD: u256 = 60_000_000_000_000_000_000_000; // 60_000e18

// Debt ceiling: 1,000,000 Grit (WAD)
pub const DEBT_CEILING: u256 = 1_000_000_000_000_000_000_000_000; // 1_000_000e18

// Liquidation ratio: 150% in WAD
pub const LIQUIDATION_RATIO: u256 = 1_500_000_000_000_000_000; // 1.5e18

// WBTC decimals
pub const WBTC_DECIMALS: u8 = 8;

// 1 WBTC in asset units (8 decimals)
pub const ONE_WBTC: u256 = 100_000_000; // 1e8

// PID Controller defaults
pub const KP: i128 = 1_000_000_000_000_000_000; // 1.0 WAD
pub const KI: i128 = 500_000_000_000_000_000; // 0.5 WAD
pub const NOISE_BARRIER: u256 = 950_000_000_000_000_000; // 0.95 WAD (5% threshold)
pub const INTEGRAL_PERIOD_SIZE: u64 = 3600; // 1 hour
pub const FEEDBACK_UPPER_BOUND: u256 = 1_000_000_000_000_000_000_000_000_000; // 1e27 (RAY)
pub const FEEDBACK_LOWER_BOUND: i128 = -999_999_999_999_999_999_999_999_999; // -(RAY-1)
pub const PER_SECOND_LEAK: u256 = 999_999_711_200_000_000_000_000_000; // ~0.999999711 RAY

// ============================================================================
// Test addresses
// ============================================================================

pub fn admin() -> ContractAddress {
    'admin'.try_into().unwrap()
}

pub fn user1() -> ContractAddress {
    'user1'.try_into().unwrap()
}

pub fn user2() -> ContractAddress {
    'user2'.try_into().unwrap()
}

pub fn agent1() -> ContractAddress {
    'agent1'.try_into().unwrap()
}

// ============================================================================
// Dispatchers for admin functions not in main interfaces
// ============================================================================

#[starknet::interface]
pub trait IPIDSetSeed<T> {
    fn set_seed_proposer(ref self: T, proposer: ContractAddress);
}

#[starknet::interface]
pub trait IJoinSetManager<T> {
    fn set_safe_manager(ref self: T, manager: ContractAddress);
}

#[starknet::interface]
pub trait IMintable<T> {
    fn mint(ref self: T, to: ContractAddress, amount: u256);
}

#[starknet::interface]
pub trait IOracleUpdate<T> {
    fn update_price(
        ref self: T,
        base_token: ContractAddress,
        quote_token: ContractAddress,
        price_usd_wad: u256,
    );
}

// ============================================================================
// Deploy helpers
// ============================================================================

pub fn deploy_mock_wbtc() -> (ContractAddress, IERC20Dispatcher) {
    let contract = declare("ERC20Mintable").unwrap().contract_class();
    let mut calldata: Array<felt252> = array![];
    let name: ByteArray = "Wrapped BTC";
    name.serialize(ref calldata);
    let symbol: ByteArray = "WBTC";
    symbol.serialize(ref calldata);
    calldata.append(WBTC_DECIMALS.into());
    let (addr, _) = contract.deploy(@calldata).unwrap();
    (addr, IERC20Dispatcher { contract_address: addr })
}

pub fn deploy_oracle_relayer() -> ContractAddress {
    let contract = declare("OracleRelayer").unwrap().contract_class();
    let (addr, _) = contract.deploy(@array![]).unwrap();
    addr
}

pub fn deploy_safe_engine(admin_addr: ContractAddress) -> (ContractAddress, ISAFEEngineDispatcher) {
    let contract = declare("SAFEEngine").unwrap().contract_class();
    let mut calldata: Array<felt252> = array![];
    calldata.append(admin_addr.into());
    calldata.append(DEBT_CEILING.low.into());
    calldata.append(DEBT_CEILING.high.into());
    calldata.append(LIQUIDATION_RATIO.low.into());
    calldata.append(LIQUIDATION_RATIO.high.into());
    let (addr, _) = contract.deploy(@calldata).unwrap();
    (addr, ISAFEEngineDispatcher { contract_address: addr })
}

pub fn deploy_collateral_join(
    admin_addr: ContractAddress,
    token_addr: ContractAddress,
    safe_engine_addr: ContractAddress,
) -> (ContractAddress, ICollateralJoinDispatcher) {
    let contract = declare("CollateralJoin").unwrap().contract_class();
    let mut calldata: Array<felt252> = array![];
    calldata.append(admin_addr.into());
    calldata.append(token_addr.into());
    calldata.append(WBTC_DECIMALS.into());
    calldata.append(safe_engine_addr.into());
    let (addr, _) = contract.deploy(@calldata).unwrap();
    (addr, ICollateralJoinDispatcher { contract_address: addr })
}

pub fn deploy_pid_controller(
    admin_addr: ContractAddress, seed_proposer: ContractAddress,
) -> (ContractAddress, IPIDControllerDispatcher) {
    let contract = declare("PIDController").unwrap().contract_class();
    let mut calldata: Array<felt252> = array![];
    calldata.append(admin_addr.into());
    calldata.append(seed_proposer.into());
    calldata.append(KP.into());
    calldata.append(KI.into());
    calldata.append(NOISE_BARRIER.low.into());
    calldata.append(NOISE_BARRIER.high.into());
    calldata.append(INTEGRAL_PERIOD_SIZE.into());
    calldata.append(FEEDBACK_UPPER_BOUND.low.into());
    calldata.append(FEEDBACK_UPPER_BOUND.high.into());
    calldata.append(FEEDBACK_LOWER_BOUND.into());
    calldata.append(PER_SECOND_LEAK.low.into());
    calldata.append(PER_SECOND_LEAK.high.into());
    let (addr, _) = contract.deploy(@calldata).unwrap();
    (addr, IPIDControllerDispatcher { contract_address: addr })
}

pub fn deploy_grinta_hook(
    admin_addr: ContractAddress,
    safe_engine_addr: ContractAddress,
    pid_addr: ContractAddress,
    oracle_addr: ContractAddress,
    ekubo_core_addr: ContractAddress,
    grit_token: ContractAddress,
    wbtc_token: ContractAddress,
    usdc_token: ContractAddress,
) -> (ContractAddress, IGrintaHookDispatcher) {
    let contract = declare("GrintaHook").unwrap().contract_class();
    let mut calldata: Array<felt252> = array![];
    calldata.append(admin_addr.into());
    calldata.append(safe_engine_addr.into());
    calldata.append(pid_addr.into());
    calldata.append(oracle_addr.into());
    calldata.append(ekubo_core_addr.into());
    calldata.append(grit_token.into());
    calldata.append(wbtc_token.into());
    calldata.append(usdc_token.into());
    let (addr, _) = contract.deploy(@calldata).unwrap();
    (addr, IGrintaHookDispatcher { contract_address: addr })
}

pub fn deploy_safe_manager(
    admin_addr: ContractAddress,
    safe_engine_addr: ContractAddress,
    join_addr: ContractAddress,
    hook_addr: ContractAddress,
) -> (ContractAddress, ISafeManagerDispatcher) {
    let contract = declare("SafeManager").unwrap().contract_class();
    let mut calldata: Array<felt252> = array![];
    calldata.append(admin_addr.into());
    calldata.append(safe_engine_addr.into());
    calldata.append(join_addr.into());
    calldata.append(hook_addr.into());
    let (addr, _) = contract.deploy(@calldata).unwrap();
    (addr, ISafeManagerDispatcher { contract_address: addr })
}

// ============================================================================
// Full system deployment
// ============================================================================

#[derive(Drop)]
pub struct GrintaSystem {
    pub wbtc_addr: ContractAddress,
    pub wbtc: IERC20Dispatcher,
    pub oracle_addr: ContractAddress,
    pub safe_engine_addr: ContractAddress,
    pub safe_engine: ISAFEEngineDispatcher,
    pub join_addr: ContractAddress,
    pub join: ICollateralJoinDispatcher,
    pub pid_addr: ContractAddress,
    pub pid: IPIDControllerDispatcher,
    pub hook_addr: ContractAddress,
    pub hook: IGrintaHookDispatcher,
    pub manager_addr: ContractAddress,
    pub manager: ISafeManagerDispatcher,
}

pub fn deploy_full_system() -> GrintaSystem {
    let admin_addr = admin();

    // 1. Deploy mock WBTC
    let (wbtc_addr, wbtc) = deploy_mock_wbtc();

    // 2. Deploy OracleRelayer
    let oracle_addr = deploy_oracle_relayer();

    // 3. Deploy SAFEEngine
    let (safe_engine_addr, safe_engine) = deploy_safe_engine(admin_addr);

    // 4. Deploy CollateralJoin
    let (join_addr, join) = deploy_collateral_join(admin_addr, wbtc_addr, safe_engine_addr);

    // 5. Deploy PIDController (seed_proposer set later to hook)
    let (pid_addr, pid) = deploy_pid_controller(admin_addr, admin_addr);

    // 6. Deploy GrintaHook (ekubo_core = 0 in tests, skips set_call_points)
    let usdc_mock: ContractAddress = 'usdc'.try_into().unwrap();
    let zero_core: ContractAddress = 0.try_into().unwrap();
    let (hook_addr, hook) = deploy_grinta_hook(
        admin_addr, safe_engine_addr, pid_addr, oracle_addr, zero_core,
        safe_engine_addr, wbtc_addr, usdc_mock,
    );

    // 7. Deploy SafeManager (with hook for keeper-less price updates)
    let (manager_addr, manager) = deploy_safe_manager(admin_addr, safe_engine_addr, join_addr, hook_addr);

    // 8. Wire up permissions
    // SAFEEngine: set safe_manager, hook, collateral_join
    cheat_caller_address(safe_engine_addr, admin_addr, CheatSpan::TargetCalls(1));
    safe_engine.set_safe_manager(manager_addr);
    cheat_caller_address(safe_engine_addr, admin_addr, CheatSpan::TargetCalls(1));
    safe_engine.set_hook(hook_addr);
    cheat_caller_address(safe_engine_addr, admin_addr, CheatSpan::TargetCalls(1));
    safe_engine.set_collateral_join(join_addr);

    // CollateralJoin: set safe_manager
    let join_admin = IJoinSetManagerDispatcher { contract_address: join_addr };
    cheat_caller_address(join_addr, admin_addr, CheatSpan::TargetCalls(1));
    join_admin.set_safe_manager(manager_addr);

    // PIDController: set seed_proposer to hook
    let pid_admin = IPIDSetSeedDispatcher { contract_address: pid_addr };
    cheat_caller_address(pid_addr, admin_addr, CheatSpan::TargetCalls(1));
    pid_admin.set_seed_proposer(hook_addr);

    // Push BTC price to OracleRelayer → hook.update() will read it and push to SAFEEngine
    let oracle_updater = IOracleUpdateDispatcher { contract_address: oracle_addr };
    oracle_updater.update_price(wbtc_addr, usdc_mock, BTC_PRICE_WAD);

    // Set timestamp > 0 so hook's throttle allows the first update (throttle checks now - last >= 60)
    start_cheat_block_timestamp_global(100);

    // Trigger hook.update() to read oracle and push collateral price to SAFEEngine
    hook.update();

    GrintaSystem {
        wbtc_addr, wbtc, oracle_addr,
        safe_engine_addr, safe_engine,
        join_addr, join,
        pid_addr, pid,
        hook_addr, hook,
        manager_addr, manager,
    }
}

// ============================================================================
// Utility functions
// ============================================================================

pub fn fund_user_wbtc(wbtc_addr: ContractAddress, user: ContractAddress, amount: u256) {
    let mintable = IMintableDispatcher { contract_address: wbtc_addr };
    mintable.mint(user, amount);
}

pub fn approve_join(wbtc_addr: ContractAddress, user: ContractAddress, join_addr: ContractAddress, amount: u256) {
    let wbtc = IERC20Dispatcher { contract_address: wbtc_addr };
    cheat_caller_address(wbtc_addr, user, CheatSpan::TargetCalls(1));
    wbtc.approve(join_addr, amount);
}
