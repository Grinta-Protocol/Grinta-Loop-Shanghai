use grinta_scripts::constants;
use sncast_std::{DeclareResultTrait, FeeSettingsTrait, declare, deploy};
use starknet::ContractAddress;

fn fee() -> sncast_std::FeeSettings {
    FeeSettingsTrait::estimate()
}

// =============================================================================
// Per-contract declare + deploy helpers
// =============================================================================

/// Deploy MockWBTC (ERC20Mintable) — anyone can mint, 8 decimals
pub fn deploy_mock_wbtc() -> ContractAddress {
    let decl = declare("ERC20Mintable", fee(), Option::None)
        .expect('ERC20Mintable declare fail');

    let mut calldata: Array<felt252> = array![];
    let name: ByteArray = "Mock WBTC";
    let symbol: ByteArray = "mWBTC";
    let decimals: u8 = constants::WBTC_DECIMALS;
    Serde::serialize(@name, ref calldata);
    Serde::serialize(@symbol, ref calldata);
    Serde::serialize(@decimals, ref calldata);

    let result = deploy(
        *decl.class_hash(), calldata, Option::None, true, fee(), Option::None,
    )
        .expect('MockWBTC deploy fail');

    result.contract_address
}

/// Deploy SAFEEngine — core ledger + Grit ERC20 + redemption price
pub fn deploy_safe_engine(admin: ContractAddress) -> ContractAddress {
    let decl = declare("SAFEEngine", fee(), Option::None)
        .expect('SAFEEngine declare fail');

    let mut calldata: Array<felt252> = array![];
    Serde::serialize(@admin, ref calldata);
    let ceiling: u256 = constants::debt_ceiling();
    Serde::serialize(@ceiling, ref calldata);
    let ratio: u256 = constants::liquidation_ratio();
    Serde::serialize(@ratio, ref calldata);

    let result = deploy(
        *decl.class_hash(), calldata, Option::None, true, fee(), Option::None,
    )
        .expect('SAFEEngine deploy fail');

    result.contract_address
}

/// Deploy CollateralJoin — WBTC custody with decimal conversion
pub fn deploy_collateral_join(
    admin: ContractAddress,
    collateral_token: ContractAddress,
    safe_engine: ContractAddress,
) -> ContractAddress {
    let decl = declare("CollateralJoin", fee(), Option::None)
        .expect('CollateralJoin declare fail');

    let mut calldata: Array<felt252> = array![];
    Serde::serialize(@admin, ref calldata);
    Serde::serialize(@collateral_token, ref calldata);
    let decimals: u8 = constants::WBTC_DECIMALS;
    Serde::serialize(@decimals, ref calldata);
    Serde::serialize(@safe_engine, ref calldata);

    let result = deploy(
        *decl.class_hash(), calldata, Option::None, true, fee(), Option::None,
    )
        .expect('CollateralJoin deploy fail');

    result.contract_address
}

/// Deploy PIDController — HAI-style PI with leaky integrator
pub fn deploy_pid_controller(
    admin: ContractAddress,
    seed_proposer: ContractAddress,
) -> ContractAddress {
    let decl = declare("PIDController", fee(), Option::None)
        .expect('PIDController declare fail');

    let mut calldata: Array<felt252> = array![];
    Serde::serialize(@admin, ref calldata);
    Serde::serialize(@seed_proposer, ref calldata);
    let kp: i128 = constants::KP;
    Serde::serialize(@kp, ref calldata);
    let ki: i128 = constants::KI;
    Serde::serialize(@ki, ref calldata);
    let noise: u256 = constants::noise_barrier();
    Serde::serialize(@noise, ref calldata);
    let period: u64 = constants::INTEGRAL_PERIOD;
    Serde::serialize(@period, ref calldata);
    let upper: u256 = constants::feedback_upper_bound();
    Serde::serialize(@upper, ref calldata);
    let lower: i128 = constants::FEEDBACK_LOWER_BOUND;
    Serde::serialize(@lower, ref calldata);
    let leak: u256 = constants::per_second_leak();
    Serde::serialize(@leak, ref calldata);

    let result = deploy(
        *decl.class_hash(), calldata, Option::None, true, fee(), Option::None,
    )
        .expect('PIDController deploy fail');

    result.contract_address
}

/// Deploy GrintaHook — Ekubo extension that acts as OracleRelayer
pub fn deploy_grinta_hook(
    admin: ContractAddress,
    safe_engine: ContractAddress,
    pid_controller: ContractAddress,
    ekubo_oracle: ContractAddress,
    grit_token: ContractAddress,
    wbtc_token: ContractAddress,
    usdc_token: ContractAddress,
) -> ContractAddress {
    let decl = declare("GrintaHook", fee(), Option::None)
        .expect('GrintaHook declare fail');

    let mut calldata: Array<felt252> = array![];
    Serde::serialize(@admin, ref calldata);
    Serde::serialize(@safe_engine, ref calldata);
    Serde::serialize(@pid_controller, ref calldata);
    Serde::serialize(@ekubo_oracle, ref calldata);
    Serde::serialize(@grit_token, ref calldata);
    Serde::serialize(@wbtc_token, ref calldata);
    Serde::serialize(@usdc_token, ref calldata);

    let result = deploy(
        *decl.class_hash(), calldata, Option::None, true, fee(), Option::None,
    )
        .expect('GrintaHook deploy fail');

    result.contract_address
}

/// Deploy SafeManager — user/agent facing safe operations
pub fn deploy_safe_manager(
    admin: ContractAddress,
    safe_engine: ContractAddress,
    collateral_join: ContractAddress,
) -> ContractAddress {
    let decl = declare("SafeManager", fee(), Option::None)
        .expect('SafeManager declare fail');

    let mut calldata: Array<felt252> = array![];
    Serde::serialize(@admin, ref calldata);
    Serde::serialize(@safe_engine, ref calldata);
    Serde::serialize(@collateral_join, ref calldata);

    let result = deploy(
        *decl.class_hash(), calldata, Option::None, true, fee(), Option::None,
    )
        .expect('SafeManager deploy fail');

    result.contract_address
}
