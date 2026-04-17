// ============================================================================
// Demo Replay Tests — BTC Crash Simulation via Mock Oracle
//
// Simulates a ~20% BTC crash over 15 minutes, feeding historical prices to
// the mock oracle. Compares fixed-param PID (Scenario A) vs agent-adjusted
// PID (Scenario B) to show reduced peg deviation.
//
// Key insight: PID rate is throttled to 3600s. The agent's value is in
// pre-positioning KP BEFORE the next rate computation fires.
// ============================================================================

use snforge_std::{cheat_caller_address, CheatSpan, start_cheat_block_timestamp_global};

use grinta::interfaces::ipid_controller::{IPIDControllerDispatcherTrait};
use grinta::interfaces::igrinta_hook::{IGrintaHookDispatcherTrait};
use grinta::interfaces::isafe_engine::{ISAFEEngineDispatcherTrait};
use grinta::interfaces::iparameter_guard::{IParameterGuardDispatcherTrait};
use grinta::types::AgentPolicy;

use super::test_common::{
    WAD, RAY,
    admin, agent1,
    deploy_full_system_with_pid, deploy_parameter_guard,
    IOracleUpdateDispatcher, IOracleUpdateDispatcherTrait,
    IPIDTransferAdminDispatcher, IPIDTransferAdminDispatcherTrait,
};

// ============================================================================
// Demo constants (same as test_agent_integration)
// ============================================================================

const KP_DEMO: i128 = 2_000_000_000_000_000_000;  // 2.0 WAD
const KI_DEMO: i128 = 2_000_000_000_000_000;       // 0.002 WAD

fn demo_policy() -> AgentPolicy {
    AgentPolicy {
        kp_min: 1_400_000_000_000_000_000,    // 1.4 WAD
        kp_max: 2_600_000_000_000_000_000,    // 2.6 WAD
        ki_min: 1_000_000_000_000_000,         // 0.001 WAD
        ki_max: 10_000_000_000_000_000,        // 0.01 WAD
        max_kp_delta: 500_000_000_000_000_000, // 0.5 WAD per call
        max_ki_delta: 2_000_000_000_000_000,   // 0.002 WAD per call
        cooldown_seconds: 300,
        emergency_cooldown_seconds: 60,
        max_updates: 20,
    }
}

// ============================================================================
// BTC crash price data: $60k → ~$48k → partial recovery to $51k
// 15 samples, 1 per minute. Prices in WAD.
// ============================================================================

fn btc_crash_prices() -> Array<u256> {
    array![
        60_000_000_000_000_000_000_000, // t+0:   $60,000 (baseline)
        59_000_000_000_000_000_000_000, // t+60:  $59,000 (-1.7%)
        57_500_000_000_000_000_000_000, // t+120: $57,500 (-4.2%)
        55_000_000_000_000_000_000_000, // t+180: $55,000 (-8.3%)
        52_000_000_000_000_000_000_000, // t+240: $52,000 (-13.3%)
        49_500_000_000_000_000_000_000, // t+300: $49,500 (-17.5%)
        48_000_000_000_000_000_000_000, // t+360: $48,000 (-20.0%) ← bottom
        48_200_000_000_000_000_000_000, // t+420: $48,200
        48_500_000_000_000_000_000_000, // t+480: $48,500
        49_000_000_000_000_000_000_000, // t+540: $49,000
        49_800_000_000_000_000_000_000, // t+600: $49,800
        50_500_000_000_000_000_000_000, // t+660: $50,500
        51_000_000_000_000_000_000_000, // t+720: $51,000
        51_500_000_000_000_000_000_000, // t+780: $51,500
        52_000_000_000_000_000_000_000, // t+840: $52,000 (partial recovery)
    ]
}

// GRIT depeg model: BTC drops X% → GRIT depegs X/2% from $1.00
// Returns GRIT market price in WAD (1.0 WAD = $1.00 = peg)
fn grit_prices_from_btc(btc_prices: @Array<u256>) -> Array<u256> {
    let baseline = *btc_prices[0]; // $60k
    let mut grit_prices: Array<u256> = array![];
    let mut i: u32 = 0;
    loop {
        if i >= btc_prices.len() {
            break;
        }
        let btc_price = *btc_prices[i];
        // btc_drop_pct = (baseline - btc_price) / baseline (as WAD fraction)
        // grit_depeg = btc_drop_pct / 2
        // grit_price = WAD - grit_depeg
        if btc_price >= baseline {
            grit_prices.append(WAD); // no drop, no depeg
        } else {
            let drop = baseline - btc_price;
            // drop_fraction = drop * WAD / baseline
            let drop_fraction = (drop * WAD) / baseline;
            // grit depegs half as much
            let depeg = drop_fraction / 2;
            if depeg >= WAD {
                grit_prices.append(1); // floor at near-zero
            } else {
                grit_prices.append(WAD - depeg);
            }
        }
        i += 1;
    };
    grit_prices
}

// ============================================================================
// Helper: feed one price sample to oracle + set market price + call update
// ============================================================================

fn feed_price_sample(
    sys: @super::test_common::GrintaSystem,
    timestamp: u64,
    btc_price: u256,
    grit_price: u256,
) {
    let usdc_mock: starknet::ContractAddress = 'usdc'.try_into().unwrap();
    let oracle_updater = IOracleUpdateDispatcher { contract_address: *sys.oracle_addr };

    start_cheat_block_timestamp_global(timestamp);

    // Feed BTC price to oracle → hook.update() reads it
    oracle_updater.update_price(*sys.wbtc_addr, usdc_mock, btc_price);

    // Set GRIT market price (what PID reads for deviation)
    sys.hook.set_market_price(grit_price);

    // Trigger hook.update() — propagates collateral price and tries rate update
    sys.hook.update();
}

// ============================================================================
// Test 1: Scenario A — Fixed params, full crash replay
// Verifies the system processes all price samples without agent intervention.
// ============================================================================
#[test]
fn test_demo_replay_fixed_params() {
    let sys = deploy_full_system_with_pid(KP_DEMO, KI_DEMO);

    let btc_prices = btc_crash_prices();
    let grit_prices = grit_prices_from_btc(@btc_prices);

    // System was initialized at t=100 with hook.update().
    // Rate update fires at t=100, next one won't fire until t=3700.
    let t_start: u64 = 200; // Start crash at t=200

    // Feed 15 price samples, 1 per minute
    let mut i: u32 = 0;
    loop {
        if i >= btc_prices.len() {
            break;
        }
        let t = t_start + (i.into() * 60);
        feed_price_sample(@sys, t, *btc_prices[i], *grit_prices[i]);
        i += 1;
    };

    // After crash (t=200+840=1040), PID rate hasn't recomputed (throttled until t=3700)
    // The redemption_rate is still the initial one from t=100
    let rate_during_crash = sys.safe_engine.get_redemption_rate();

    // Now advance to t=3700 to trigger rate update with crash data
    let grit_at_bottom: u256 = *grit_prices[6]; // bottom GRIT price
    start_cheat_block_timestamp_global(3700);
    sys.hook.set_market_price(grit_at_bottom);
    sys.hook.update();

    let rate_after = sys.safe_engine.get_redemption_rate();

    // Rate should have changed after PID fires
    assert(rate_after > rate_during_crash, 'rate should change after PID');
    // Rate should be above RAY (upward correction for depeg below peg)
    assert(rate_after > RAY, 'rate should correct upward');
}

// ============================================================================
// Test 2: Scenario B — Agent intervenes during crash
// Agent detects crash off-chain, bumps KP from 2.0→2.5 using emergency cooldown.
// When PID fires at t=3700, it uses boosted KP for stronger correction.
// ============================================================================
#[test]
fn test_demo_replay_agent_intervenes() {
    let sys = deploy_full_system_with_pid(KP_DEMO, KI_DEMO);

    // Wire ParameterGuard as PID admin
    let (guard_addr, guard) = deploy_parameter_guard(
        admin(), agent1(), sys.pid_addr, demo_policy(),
    );
    let pid_transfer = IPIDTransferAdminDispatcher { contract_address: sys.pid_addr };
    cheat_caller_address(sys.pid_addr, admin(), CheatSpan::TargetCalls(1));
    pid_transfer.transfer_admin(guard_addr);

    let btc_prices = btc_crash_prices();
    let grit_prices = grit_prices_from_btc(@btc_prices);
    let t_start: u64 = 200;

    // Feed first 3 samples (t=200, 260, 320) — crash is starting
    let mut i: u32 = 0;
    loop {
        if i >= 3 {
            break;
        }
        let t = t_start + (i.into() * 60);
        feed_price_sample(@sys, t, *btc_prices[i], *grit_prices[i]);
        i += 1;
    };

    // === Agent detects crash off-chain at t=320 (BTC already down 4.2%) ===
    // Agent bumps KP: 2.0 → 2.5 (emergency mode)
    start_cheat_block_timestamp_global(320);
    cheat_caller_address(guard_addr, agent1(), CheatSpan::TargetCalls(1));
    guard.propose_parameters(2_500_000_000_000_000_000, KI_DEMO, true);

    // Verify KP was updated
    let gains = sys.pid.get_controller_gains();
    assert(gains.kp == 2_500_000_000_000_000_000, 'kp should be 2.5');

    // Continue feeding remaining samples
    loop {
        if i >= btc_prices.len() {
            break;
        }
        let t = t_start + (i.into() * 60);
        feed_price_sample(@sys, t, *btc_prices[i], *grit_prices[i]);
        i += 1;
    };

    // Advance to t=3700 — PID rate update fires with boosted KP
    let grit_at_bottom: u256 = *grit_prices[6];
    start_cheat_block_timestamp_global(3700);
    sys.hook.set_market_price(grit_at_bottom);
    sys.hook.update();

    let rate = sys.safe_engine.get_redemption_rate();
    assert(rate > RAY, 'agent rate should correct up');
}

// ============================================================================
// Test 3: A/B Comparison — Quantify agent advantage
// Same crash, same timing. Agent's boosted KP produces stronger rate correction.
// The metric: rate_correction_agent > rate_correction_fixed
// ============================================================================
#[test]
fn test_demo_replay_ab_comparison() {
    // ========== Scenario A: Fixed params ==========
    let sys_a = deploy_full_system_with_pid(KP_DEMO, KI_DEMO);

    let btc_prices = btc_crash_prices();
    let grit_prices = grit_prices_from_btc(@btc_prices);
    let t_start: u64 = 200;

    // Feed all samples
    let mut i: u32 = 0;
    loop {
        if i >= btc_prices.len() {
            break;
        }
        let t = t_start + (i.into() * 60);
        feed_price_sample(@sys_a, t, *btc_prices[i], *grit_prices[i]);
        i += 1;
    };

    // PID fires at t=3700
    let grit_at_bottom: u256 = *grit_prices[6];
    start_cheat_block_timestamp_global(3700);
    sys_a.hook.set_market_price(grit_at_bottom);
    sys_a.hook.update();

    let rate_fixed = sys_a.safe_engine.get_redemption_rate();

    // ========== Scenario B: Agent bumps KP early ==========
    let sys_b = deploy_full_system_with_pid(KP_DEMO, KI_DEMO);

    let (guard_addr, guard) = deploy_parameter_guard(
        admin(), agent1(), sys_b.pid_addr, demo_policy(),
    );
    let pid_transfer = IPIDTransferAdminDispatcher { contract_address: sys_b.pid_addr };
    cheat_caller_address(sys_b.pid_addr, admin(), CheatSpan::TargetCalls(1));
    pid_transfer.transfer_admin(guard_addr);

    // Feed first 2 samples, then agent acts
    i = 0;
    loop {
        if i >= 2 {
            break;
        }
        let t = t_start + (i.into() * 60);
        feed_price_sample(@sys_b, t, *btc_prices[i], *grit_prices[i]);
        i += 1;
    };

    // Agent boosts KP: 2.0 → 2.5 at t=320
    start_cheat_block_timestamp_global(320);
    cheat_caller_address(guard_addr, agent1(), CheatSpan::TargetCalls(1));
    guard.propose_parameters(2_500_000_000_000_000_000, KI_DEMO, true);

    // Feed remaining samples
    loop {
        if i >= btc_prices.len() {
            break;
        }
        let t = t_start + (i.into() * 60);
        feed_price_sample(@sys_b, t, *btc_prices[i], *grit_prices[i]);
        i += 1;
    };

    // PID fires at t=3700 with boosted KP
    start_cheat_block_timestamp_global(3700);
    sys_b.hook.set_market_price(grit_at_bottom);
    sys_b.hook.update();

    let rate_agent = sys_b.safe_engine.get_redemption_rate();

    // ========== Compare ==========
    // Both rates should be above RAY (upward correction)
    assert(rate_fixed > RAY, 'A: rate should be above RAY');
    assert(rate_agent > RAY, 'B: rate should be above RAY');

    // Agent rate should produce STRONGER correction (higher rate)
    let correction_fixed = rate_fixed - RAY;
    let correction_agent = rate_agent - RAY;
    assert(correction_agent > correction_fixed, 'agent should beat fixed');

    // Quantify: agent correction should be ~25% higher (KP 2.5 vs 2.0)
    // correction_agent / correction_fixed ≈ 2.5 / 2.0 = 1.25
    // Check it's at least 20% higher (allow margin for integral contribution)
    let min_improvement = correction_fixed / 5; // 20%
    assert(correction_agent - correction_fixed >= min_improvement, 'agent improvement >= 20%');
}
