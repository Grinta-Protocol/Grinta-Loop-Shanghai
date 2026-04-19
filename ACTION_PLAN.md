# ParameterGuard — Action Plan

> Context file for cross-terminal continuity (opencode / claude code).
> Updated as tasks are completed. Check status markers: `[ ]` pending, `[>]` in progress, `[x]` done.

---

## Decision Log

| # | Decision | Rationale |
|---|----------|-----------|
| 1 | **ParameterGuard becomes PIDController admin** | Simplest for POC. No new role system needed. Guard proxies admin calls. |
| 2 | **Add `transfer_admin()` to PIDController** | PIDController has no admin transfer. Need 1 function (3 lines) to hand over admin to ParameterGuard. |
| 3 | **LLM agent, NOT RL** | Hackathon scope. 1 replay bot + 1 LLM agent. No multi-agent. |
| 4 | **Patterns from starknet-agentic inform design** | SessionPolicy/SpendingPolicy concepts mapped to parameter bounds, per-call caps, rolling windows, call budgets, emergency revoke, PDR events. |
| 5 | **Two-tier cooldown for crash response** | Guard reads PID's DeviationObservation. If |proportional| >= threshold → emergency cooldown (shorter). Guardrails ADAPT to market conditions on-chain. |

---

## Architecture Overview

```
                    Human Admin (deployer)
                         │
                         │ owns
                         ▼
              ┌─────────────────────┐
              │   ParameterGuard    │
              │                     │
              │ - agent: address    │  ◄── LLM agent (off-chain)
              │ - policy: bounds    │      calls propose_parameters()
              │ - cooldown/budget   │
              │ - emergency_stop    │
              │ - PDR events        │
              └────────┬────────────┘
                       │ is admin of
                       ▼
              ┌─────────────────────┐
              │   PIDController     │
              │                     │
              │ - set_kp(kp)        │
              │ - set_ki(ki)        │
              └─────────────────────┘
```

### Flow

1. Deploy PIDController with `admin = deployer`
2. Setup PIDController (set_seed_proposer, etc.) while deployer is admin
3. Deploy ParameterGuard with `admin = deployer`, `agent = agent_address`, `pid_controller = pid_addr`
4. Call `PIDController.transfer_admin(parameter_guard_addr)` — now Guard is admin of PID
5. Agent calls `ParameterGuard.propose_parameters(new_kp, new_ki)` — Guard validates bounds and forwards to PID

### Why ParameterGuard as admin works without breaking anything

- **Tests**: Only admin call in tests is `set_seed_proposer(hook_addr)` — done BEFORE admin transfer. Existing 70 tests untouched.
- **Deployment**: Same pattern — setup first, transfer last.
- **No other contract calls PID admin functions** — verified via grep.
- **ParameterGuard proxies admin**: includes `proxy_set_seed_proposer()` for human admin to retain control via Guard.

---

## Implementation Steps

### Step 1: Add `transfer_admin()` to PIDController
**Status**: `[x]` DONE
**Files**: `src/pid_controller.cairo`
**Change**: Add 1 function (~3 lines) at the end of the Admin section:
```cairo
#[external(v0)]
fn transfer_admin(ref self: ContractState, new_admin: ContractAddress) {
    self._assert_admin();
    self.admin.write(new_admin);
}
```
**Risk**: Zero — additive change, no existing logic touched.

### Step 2: Create IParameterGuard interface
**Status**: `[x]` DONE
**Files**: `src/interfaces/iparameter_guard.cairo`, `src/interfaces.cairo`

Interface:
```cairo
#[starknet::interface]
pub trait IParameterGuard<TContractState> {
    // === Agent functions ===
    fn propose_parameters(ref self: TContractState, new_kp: i128, new_ki: i128);

    // === Admin functions ===
    fn set_agent(ref self: TContractState, agent: ContractAddress);
    fn set_policy(ref self: TContractState, policy: AgentPolicy);
    fn emergency_stop(ref self: TContractState);
    fn resume(ref self: TContractState);
    fn revoke_agent(ref self: TContractState);

    // === Proxy admin (human admin retains control via Guard) ===
    fn proxy_set_seed_proposer(ref self: TContractState, proposer: ContractAddress);
    fn proxy_set_noise_barrier(ref self: TContractState, barrier: u256);
    fn proxy_set_per_second_cumulative_leak(ref self: TContractState, leak: u256);
    fn proxy_transfer_pid_admin(ref self: TContractState, new_admin: ContractAddress);

    // === View functions ===
    fn get_policy(self: @TContractState) -> AgentPolicy;
    fn get_agent(self: @TContractState) -> ContractAddress;
    fn is_stopped(self: @TContractState) -> bool;
    fn get_update_count(self: @TContractState) -> u32;
    fn get_last_update_timestamp(self: @TContractState) -> u64;
}
```

### Step 3: Define AgentPolicy struct
**Status**: `[x]` DONE
**Files**: `src/types.cairo`

```cairo
#[derive(Copy, Drop, Serde, starknet::Store)]
pub struct AgentPolicy {
    // Absolute bounds for Kp (WAD)
    pub kp_min: i128,
    pub kp_max: i128,
    // Absolute bounds for Ki (WAD)
    pub ki_min: i128,
    pub ki_max: i128,
    // Max change per single update (WAD) — equivalent to SpendingPolicy.max_per_call
    pub max_kp_delta: u128,
    pub max_ki_delta: u128,
    // Two-tier cooldown — guardrails adapt to market conditions
    pub cooldown_seconds: u64,           // Normal cooldown between agent updates
    pub emergency_cooldown_seconds: u64, // Shorter cooldown when |deviation| >= threshold
    pub deviation_threshold: u128,       // |proportional| threshold for emergency tier (WAD, 0 = disabled)
    // Call budget — equivalent to SessionData.max_calls
    pub max_updates: u32,
}
```

### Step 4: Implement ParameterGuard contract
**Status**: `[x]` DONE
**Files**: `src/parameter_guard.cairo`, `src/lib.cairo`

**Storage**:
- `admin: ContractAddress` — human admin (deployer)
- `agent: ContractAddress` — LLM agent address
- `pid_controller: ContractAddress` — target PIDController
- `policy: AgentPolicy` — bounds and limits
- `stopped: bool` — emergency stop flag
- `update_count: u32` — total updates applied (tracks against max_updates)
- `last_update_timestamp: u64` — for cooldown enforcement

**Events** (PDR — Policy Decision Record pattern from paper #5):
```cairo
ParameterUpdate { agent, old_kp, new_kp, old_ki, new_ki, timestamp }
EmergencyStop { admin, timestamp }
Resumed { admin, timestamp }
AgentRevoked { admin, old_agent, timestamp }
PolicyUpdated { admin, policy, timestamp }
```

**Core logic of `propose_parameters()`**:
1. Assert caller == agent
2. Assert !stopped
3. Assert update_count < policy.max_updates (call budget)
4. Read PID's DeviationObservation — if |proportional| >= threshold → emergency cooldown, else → normal cooldown
5. Assert now - last_update >= selected_cooldown (two-tier rate limit)
6. Assert kp_min <= new_kp <= kp_max (absolute bounds)
7. Assert ki_min <= new_ki <= ki_max (absolute bounds)
8. Read current kp/ki from PIDController
9. Assert |new_kp - current_kp| <= max_kp_delta (per-call cap)
10. Assert |new_ki - current_ki| <= max_ki_delta (per-call cap)
11. Call pid.set_kp(new_kp) and pid.set_ki(new_ki)
12. Update state: update_count++, last_update_timestamp = now
13. Emit ParameterUpdate event (PDR) with emergency_mode flag

### Step 5: Write tests
**Status**: `[x]` DONE — 17 tests, all passing (14 original + 3 two-tier cooldown)
**Files**: `tests/test_parameter_guard.cairo`, `tests/lib.cairo`, `tests/test_common.cairo`

Test cases:
1. `test_propose_within_bounds` — happy path, Kp/Ki updated
2. `test_propose_exceeds_kp_bounds` — reverts
3. `test_propose_exceeds_ki_bounds` — reverts
4. `test_propose_exceeds_kp_delta` — reverts (per-call cap)
5. `test_propose_exceeds_ki_delta` — reverts (per-call cap)
6. `test_propose_during_cooldown` — reverts
7. `test_propose_after_budget_exhausted` — reverts (max_updates)
8. `test_propose_when_stopped` — reverts
9. `test_propose_not_agent` — reverts
10. `test_emergency_stop_and_resume` — admin can stop/resume
11. `test_revoke_agent` — admin can remove agent
12. `test_proxy_functions` — admin can call PID admin functions via Guard
13. `test_only_admin_can_set_policy` — non-admin reverts
14. `test_transfer_pid_admin_back` — admin can reclaim PID admin
15. `test_emergency_cooldown_on_high_deviation` — agent updates faster during crash (10% > 5% threshold)
16. `test_normal_cooldown_when_deviation_below_threshold` — normal cooldown enforced when no crisis
17. `test_emergency_cooldown_exceeds_normal_rejected` — invalid policy rejected

### Step 6: Wire into test helpers
**Status**: `[x]` DONE
**Files**: `tests/test_common.cairo`

Add `deploy_parameter_guard()` helper. Optionally add to `GrintaSystem` struct for integration tests.

### Step 7: Run full test suite
**Status**: `[x]` DONE — 87/87 passing (70 existing + 17 ParameterGuard)
**Command**: `snforge test`
**Expected**: 70 existing tests pass + 17 ParameterGuard tests

---

---

## Task 6: Demo Replay via Mock Oracle

### Goal
Simulate a BTC crash using historical price data fed to the mock oracle. Compare two scenarios:
- **Scenario A (Fixed)**: No agent, PID runs with default KP=2.0, KI=0.002
- **Scenario B (Agent)**: Agent detects crash off-chain, uses emergency cooldown to boost KP mid-crash

### Demo Replay Flow

```
CSV (historical BTC prices)
    │
    ▼ (off-chain: 1 sample per minute)
OracleRelayer.update_price(wbtc, usdc, price_wad)
    │
    ▼ (on-chain)
hook.update()
    ├─► _update_collateral_price()    [throttled: 60s]
    │     └─► SAFEEngine.update_collateral_price()
    └─► _try_update_rate()            [throttled: 3600s]
          └─► PID.compute_rate(market_price, redemption_price)
                └─► SAFEEngine.update_redemption_rate()
```

### Key Throttles

| Component | Throttle | Implication |
|-----------|----------|-------------|
| `_update_collateral_price()` | `PRICE_UPDATE_INTERVAL = 60s` | Oracle prices propagate every minute |
| `_try_update_rate()` | `RATE_UPDATE_INTERVAL = 3600s` | PID rate computed only once per hour |
| PID `integral_period_size` | `3600s` | PID `compute_rate` rejects calls within this window |
| Agent normal cooldown | `300s` | Agent can adjust params every 5 min |
| Agent emergency cooldown | `60s` | Agent can adjust params every 1 min (declares emergency) |

### The 3600s Bottleneck Problem

The PID rate update is throttled to 1 hour. In a fast crash:
- **Scenario A**: PID computed rate at t=0 with KP=2.0. Can't recompute until t=3600. Stuck with stale rate.
- **Scenario B**: Agent detects crash at t=120 (off-chain). Uses emergency cooldown to bump KP→2.5 by t=180. When PID finally fires at t=3600, it uses the boosted KP → stronger correction.

### Market Price vs Collateral Price

- **Collateral price** (BTC/USD): Fed via `OracleRelayer.update_price()` → `hook.update()` → `SAFEEngine.update_collateral_price()`. Affects liquidation ratios.
- **Market price** (GRIT/USD): Set via `hook.set_market_price()`. This is what the PID reads to compute rate.
- For the demo: crash BTC collateral price AND depeg GRIT market price simultaneously (crash causes depeg).

### Test Structure: `test_demo_replay.cairo`

```
test_demo_replay_fixed_params()     — Scenario A: 10 price samples, no agent
test_demo_replay_agent_intervenes() — Scenario B: same 10 samples, agent boosts KP mid-crash
test_demo_replay_ab_comparison()    — Compare integrated peg error (area under deviation curve)
```

**Price data**: Hardcoded array of 10-15 BTC prices simulating a ~20% crash over 15 minutes.
Example: $60k → $58k → $55k → $52k → $49k → $48k → $48.5k → $49k → $50k → $51k

**GRIT depeg model**: GRIT depegs proportionally to BTC crash magnitude.
If BTC drops X%, GRIT market price drops ~X/2% (simplified model).

### Implementation Steps

- `[x]` Step 6a: Update ACTION_PLAN.md with this documentation
- `[x]` Step 6b: Create `test_demo_replay.cairo` with crash price data and helper functions
- `[x]` Step 6c: Implement Scenario A test (fixed params)
- `[x]` Step 6d: Implement Scenario B test (agent intervenes)
- `[x]` Step 6e: Implement A/B comparison test with rate correction metric
- `[x]` Step 6f: Run full suite — 98/98 passing

---

## Parameter Bounds (TBD — Step 4 in original plan)

To be derived from production values in `/mnt/c/Users/henry/desktop/grinta`:
- HAI mainnet: Kp ~ 1.547e-7 WAD, Ki ~ 1.378e-14 WAD
- Bounds: TBD after exploring production contract calibration
- For POC/demo: use +-50% of HAI values as initial bounds

---

## Patterns from starknet-agentic Applied

| Pattern | starknet-agentic | ParameterGuard |
|---------|-----------------|----------------|
| Time bounds | `valid_after/valid_until` | Two-tier cooldown: `cooldown_seconds` (normal) / `emergency_cooldown_seconds` (crisis) |
| Per-call cap | `SpendingPolicy.max_per_call` | `max_kp_delta / max_ki_delta` |
| Rolling window | `SpendingPolicy.window_seconds` | `cooldown_seconds` + `deviation_threshold` for tier selection |
| Call budget | `SessionData.max_calls` | `max_updates` |
| Allowed contract | `allowed_contract` | Hardcoded: only PIDController |
| Allowed selectors | `allowed_entrypoints` | Hardcoded: only `set_kp` / `set_ki` |
| Admin blocklist | Can't call `set_spending_policy` | Agent can't call `set_policy`, `emergency_stop`, etc. |
| Emergency revoke | `emergency_revoke_all()` | `emergency_stop()` + `revoke_agent()` |
| Audit trail | ERC-8004 identity | PDR events (ParameterUpdate, etc.) |

---

## Files That Will Be Modified

| File | Change |
|------|--------|
| `src/pid_controller.cairo` | Add `transfer_admin()` (~3 lines) |
| `src/types.cairo` | Add `AgentPolicy` struct |
| `src/interfaces.cairo` | Add `iparameter_guard` module |
| `src/lib.cairo` | Add `parameter_guard` module |

## Files That Will Be Created

| File | Purpose |
|------|---------|
| `src/interfaces/iparameter_guard.cairo` | IParameterGuard trait |
| `src/parameter_guard.cairo` | ParameterGuard contract |
| `tests/test_parameter_guard.cairo` | All ParameterGuard tests |

---

## Task 7: LLM Agent Off-Chain Component

### Goal
Build a TypeScript agent in `pid/agent/` that monitors on-chain state, uses an LLM (GLM-5.1 via CommonStack) to reason about market conditions, and executes parameter changes via ParameterGuard.

### Status: `[x]` DONE

### Architecture

```
┌─────────────────────────────────────────────────┐
│                  PID Agent                       │
│                                                  │
│  Monitor ──► Reasoning (GLM-5.1) ──► Executor   │
│     │              │                     │       │
│  read state    LLM decision        propose_parameters()
│  (RPC calls)   (CommonStack)       (starknet.js v8)
│     │              │                     │       │
│     └──────────────┴─────────────────────┘       │
│                    │                             │
│               Logger (JSONL)                     │
└─────────────────────────────────────────────────┘
```

### Key Discoveries During Implementation

1. **PIDController `integral_period_size` was hardcoded to 3600s** with an ASSERT (not graceful return). Added `set_integral_period_size()` admin setter. Redeployed PID with period=5s for demo.
2. **starknet.js v8 returns contract structs as objects with numeric keys** (`{ '0': ..., '1': ... }`) not named keys (`.kp`, `.ki`). Fixed with `getVal()` helper in monitor.ts.
3. **V10 pool token ordering is OPPOSITE of V9**: USDC(token0) < GRIT(token1).
4. **Nonce collision when trader + agent share wallet**: Mitigated with exponential backoff retry in executor.ts. Ideally agent should have its own wallet.
5. **New PID address**: `0x069bd5d8cda116f142f9fb56fdd55310bce06274e0c5461166ce32c27ac91e0f`

### Loop: Monitor → Reason → Execute

1. **Monitor** (`monitor.ts`): Read market price, redemption price, KP/KI, deviation, guard state — all in parallel via `Promise.all`
2. **Reason** (`reasoning.ts`): Send state to GLM-5.1 with system prompt that explains PID mechanics and bounds. LLM returns structured JSON decision: hold/adjust/adjust_emergency
3. **Execute** (`executor.ts`): If action != hold, call `ParameterGuard.propose_parameters(new_kp, new_ki, is_emergency)` via starknet.js v8
4. **Log** (`logger.ts`): Every decision logged as JSONL for demo split-screen visualization

### LLM Configuration

- **Provider**: CommonStack (OpenAI-compatible)
- **Model**: `zai-org/glm-5.1` (Zhipu GLM 5.1 — top tier)
- **Base URL**: `https://api.commonstack.ai/v1`
- **Temperature**: 0.1 (low for consistent decisions)
- **System prompt**: Full PID context, bounds from AgentPolicy, decision framework

### Decision Framework (in system prompt)

| Deviation | Action | Description |
|-----------|--------|-------------|
| < 1% | HOLD | Market stable, no action |
| 1% - 5% | ADJUST | Mild stress, increase KP slightly |
| >= 5% | ADJUST_EMERGENCY | Crash — aggressively boost KP, use emergency cooldown |

### Files Created

| File | Purpose |
|------|---------|
| `agent/package.json` | Dependencies: starknet@8.9.1, openai, dotenv, tsx |
| `agent/tsconfig.json` | TypeScript config (ES2022, NodeNext) |
| `agent/.env.example` | Template for env vars |
| `agent/src/config.ts` | Env loading, contract addresses, constants |
| `agent/src/monitor.ts` | On-chain state reader (minimal ABIs, parallel reads) |
| `agent/src/reasoning.ts` | LLM reasoning engine (CommonStack GLM-5.1) |
| `agent/src/executor.ts` | On-chain tx executor (starknet.js v8, i128 encoding) |
| `agent/src/logger.ts` | JSONL decision logger for demo UI |
| `agent/src/index.ts` | Main loop: Monitor → Reason → Execute |

---

## Task 8: V10 Redeploy + Demo Pipeline Integration

### Status: `[x]` DONE (pipeline functional, agent blocked)

### Problem

V10 ParameterGuard was deployed with `pid_controller` pointing to the wrong PID address (`0x58fafc...` instead of the actual V10 PID). Since `pid_controller` is set at construction and has no setter, all `propose_parameters` and `proxy_transfer_pid_admin` calls targeted the wrong contract — locking us out of the PID.

### Solution: Full Redeploy

Created `demo/src/redeploy-pid.ts` to:
1. Declare + deploy fresh PIDController (with `integral_period_size=5s`)
2. Declare + deploy fresh ParameterGuard (wired to the new PID)
3. Multicall: `Hook.set_pid_controller(newPID)` + `PID.transfer_admin(newGuard)` + `Oracle.update_price($60k)`

### Key Discovery: i128 Felt252 Encoding

Negative `i128` values on Starknet must be encoded as `STARK_PRIME + value`, NOT two's complement (`value + 2^128`). The Stark prime is `2^251 + 17*2^192 + 1`.

This was the root cause of `"Failed to deserialize param #8"` on PID deployment (param 8 = `feedback_output_lower_bound: i128`).

### Fixes Applied After Redeploy

| Fix | Script | Issue |
|-----|--------|-------|
| Wrong agent address on Guard | `_fix_agent.ts` | Guard had `0x27c0da...`, actual agent wallet is `0x1f8975...` |
| seed_proposer not set to Hook | `_fix_proposer.ts` | GrintaHook calls `compute_rate` during `after_swap` |
| integral_period_size too long | `_fix_period.ts` | Was 3600s (1 swap/hour), set to 5s |
| Tip estimation failure | Various | Alchemy fails `getTipStats` — bypass with `{ maxFee: 10n^16 }` |

### New Deployed Addresses (V10 — redeployed, 2026-04-17)

- **PIDController**: `0x53916399f6c8caf0e1ded219f7d956b9bde8c0d070f17435d3179492b738dd3`
- **ParameterGuard**: `0x65e1098a1552e8aceec3a5217ecad40d223303e00070097abcc011deeb1ce1b`
- All other V9 contracts unchanged (SAFEEngine, Hook, Oracle, etc.)

### Demo Pipeline — Files Created

| File | Purpose |
|------|---------|
| `demo/src/launcher.ts` | Orchestrates feeder/trader/collector/agent as child processes |
| `demo/src/feeder.ts` | Pushes CSV BTC prices to OracleRelayer at intervals |
| `demo/src/trader.ts` | Executes Ekubo swaps to create depeg pressure |
| `demo/src/collector.ts` | Samples on-chain state every 5s, writes JSONL |
| `demo/src/visualize.ts` | Generates HTML chart comparing Run A vs Run B |
| `demo/src/reset.ts` | Resets KP/KI/oracle between runs (proxy dance fallback) |
| `demo/src/config.ts` | Shared configuration, env loading |
| `demo/src/redeploy-pid.ts` | Full PID+Guard redeployment script |

### Current Status

- Swaps execute and prices move dynamically
- Reset script works (direct + proxy dance fallback)
- Collector captures time-series data
- Visualization generates HTML chart with Chart.js
- Run A (baseline) works end-to-end
- Run B (agent) is blocked — see remaining issues below

---

## ~~Task 9: A/B Demo~~ CANCELLED

A/B simulation cancelled — too many moving parts (state pollution between runs,
nonce collisions, collector timing gaps) for marginal demo value.

---

## Task 10: Interactive Governance Demo (Live Dashboard)

### Status: `[ ]` PENDING

### Concept

Single-page web app that demonstrates **Agent-as-Governor** interactively.
The jury clicks buttons, the agent reacts, txs land on-chain. No simulation,
no synthetic data — real governance happening live on Sepolia.

### UX Flow

```
┌──────────────────────────────────────────────────┐
│  🤖 Agent-as-Governor — Live Dashboard           │
│                                                  │
│  Protocol State (live from chain):               │
│    BTC Price: $60,000      GRIT: $0.99           │
│    KP: 2.0    KI: 0.002   Redemption Rate: 0.02 │
│                                                  │
│  Cheat Controls:                                 │
│  ┌──────────────┐  ┌──────────────┐              │
│  │ 🔴 CRASH -20%│  │ 🟢 PUMP +20% │              │
│  └──────────────┘  └──────────────┘              │
│                                                  │
│  Agent Log (streamed):                           │
│  > Reading on-chain state...                     │
│  > "BTC crashed to $48k, raising KP 2.0→2.5"    │
│  > tx: 0xabc123... ✅ (link to Voyager)          │
│  > Triggering small swap to update rate...       │
│  > Rate before: 0.14 → after: 0.175 (+25%)      │
│  > "25% stronger correction applied"             │
└──────────────────────────────────────────────────┘
```

### Step-by-step

1. **Dashboard loads** → reads live protocol state from Sepolia (market price, BTC, KP, KI, rate)
2. **Jury clicks 🔴 CRASH -20%** → backend calls OracleRelayer to set BTC price -20%
3. **Agent cycle triggers** → Monitor reads new state, LLM reasons, calls `propose_parameters` (raise KP)
4. **Tx confirmed** → dashboard shows tx hash with Voyager link
5. **Small swap fires automatically** → triggers `after_swap` → PID recalculates rate with new KP
6. **Dashboard updates** → shows new rate vs what it would have been with old KP
7. **Jury clicks 🟢 PUMP +20%** → same flow but agent LOWERS KP
8. **Dashboard shows the full cycle** — governance in both directions

### Key Design Decisions

- **Swaps are tiny** — just enough to trigger `after_swap()` and rate recalculation, not to move market price significantly
- **Cheat buttons update the oracle directly** — no real BTC feed, we control the narrative
- **Agent reasoning is streamed** to the log — jury sees the LLM thinking
- **Single run, no A/B** — the before/after is within the same session (before agent acts vs after)
- **Pitch deck charts use synthetic data** — clean diagrams showing rate(error) with slope KP=2.0 vs KP=2.5

### Tech Stack (TBD)

- Frontend: simple HTML + JS (or React if time permits)
- Backend: Node/TS server that wraps agent + oracle + swap execution
- On-chain: existing V10 deployment on Sepolia (ParameterGuard, PIDController, OracleRelayer, GrintaHook)

### Files to Create

| File | Purpose |
|------|---------|
| `app/server.ts` | Express/Hono backend — API for cheat buttons + agent trigger |
| `app/public/index.html` | Dashboard UI |
| `app/public/app.js` | Frontend logic — poll state, handle buttons, stream log |

### Existing Infrastructure to Reuse

- `agent/src/monitor.ts` — on-chain state reader (RAY fix applied)
- `agent/src/executor.ts` — `propose_parameters` tx submission with retry
- `agent/src/reasoning.ts` — LLM prompt + CommonStack integration
- `demo/src/trader.ts` — swap logic (adapt for tiny swaps)
- `demo/src/feeder.ts` — oracle update logic (adapt for cheat buttons)
