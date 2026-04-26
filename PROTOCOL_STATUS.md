# Grinta Protocol Status

> Living document tracking what's built, what's live, and what's next.
> Last updated: 2026-04-25

---

## What Is Grinta?

A keeper-minimized CDP protocol on Starknet. Users deposit BTC collateral (WBTC, LBTC) and borrow GRIT, a PID-controlled floating stablecoin. The PID rate updater is an Ekubo DEX hook — every swap on the USDC/GRIT pool automatically discovers the market price, runs the PID controller, and updates the redemption rate. No keepers for the internal pipeline.

The only off-chain dependencies:
- Someone pushes BTC/USD to the OracleRelayer.
- An LLM (or RL model) proposes Kp/Ki adjustments through the ParameterGuard.

Full mechanism design: [DESIGN.md](./DESIGN.md). Invariants and failure modes: [INVARIANTS.md](./INVARIANTS.md). Oracle architecture: [ORACLE_DESIGN.md](./ORACLE_DESIGN.md).

---

## Built — 10 Core Contracts + 2 Mocks

All contracts compile clean, **70/70 tests pass**. V11 deployed and live on Sepolia. The Phase 4 agent loop (LLM → ParameterGuard → PIDController) has run continuously through multiple iterations of policy and prompt tuning.

| Phase | Contracts | Status |
|---|---|---|
| Phase 1 — Core | SAFEEngine, CollateralJoin, PIDController, GrintaHook, SafeManager, OracleRelayer | Live (V11) |
| Phase 3 — Liquidation | LiquidationEngine, CollateralAuctionHouse, AccountingEngine | Live (unchanged since V9) |
| Phase 4 — Agent | ParameterGuard | Live (V11) |

### Shared Code

- `src/types.cairo` — WAD/RAY constants, fixed-point math, core structs
- `src/types_ekubo.cairo` — Ekubo-specific types (PoolKey, SwapParameters, Delta, i129, etc.)
- `src/interfaces/` — One per contract + external (iekubo, ierc20)
- `src/mock/` — ERC20Mintable, MockEkuboOracle (testing)

---

## Live Deployment — Sepolia V11

All addresses in [`deployed_v11.json`](./deployed_v11.json).

**Headline change vs V10.1:** PIDController and ParameterGuard redeployed for the RAY-scale proportional migration. Everything else (SAFEEngine, GrintaHook, etc.) reused as-is. V11 also bakes:
- `PID.reset_deviation()` admin function (clears integrator windup)
- `Guard.set_pid_controller()` admin function (re-point Guard without redeploy)
- Re-pegged SAFEEngine `redemption_price = 1e27 RAY` ($1 fresh start)

### Key addresses (V11)

| Component | Address |
|---|---|
| Agent wallet | `0x01f8975c5a1c6d2764bd30dddf4d6ab80c59e8287e5f796a5ba2490dcbf2dab6` |
| PIDController | `0x077ce1bdf9671da93542730a7f20825b8edabd2a5dfedaab23a2ac1c47791125` |
| ParameterGuard | `0x051f52ee6579d2470038e11bb85744bce4f2ebf347478ff925e1c5aa25f616aa` |
| GrintaHook | `0x04560e84979e5bae575c65f9b0be443d91d9333a8f2f50884ebd5aaf89fb6147` |
| SAFEEngine | `0x07417b07b7ac71dd816c8d880f4dc1f74c10911aa174305a9146e1b56ef60272` |

### Pool

USDC(token0) / GRIT(token1), fee=0, tick_spacing=1000, extension=GrintaHook.
External: Ekubo Core, Router V3, Positions, Oracle (see [README.md](./README.md)).

### Live ParameterGuard policy (conservative — applied 2026-04-25)

Migrated from the wide demo policy to a calibrated production-shape policy via the
3-tx loosen→propose→retighten pattern (see [`app/scripts/apply-conservative-policy.ts`](./app/scripts/apply-conservative-policy.ts)).

| Field | Value | Rationale |
|---|---|---|
| `kp` baseline | 6.667e-7 WAD | ~20% annualized rate at 1% deviation |
| `ki` baseline | 6.667e-13 WAD | symmetric with Kp shape |
| `kp_min` / `kp_max` | [3.333e-7, 1e-6] WAD | ±50% headroom around baseline |
| `ki_min` / `ki_max` | [3.333e-13, 1e-12] WAD | ±50% headroom around baseline |
| `max_kp_delta` | 6.667e-8 WAD | 10% of baseline per call (no doubling) |
| `max_ki_delta` | 6.667e-14 WAD | 10% of baseline per call |
| `cooldown_seconds` | 5 | demo cadence |
| `emergency_cooldown_seconds` | 3 | demo cadence |
| `max_updates` | 1000 | demo cadence |

The conservative policy reflects the design philosophy: **the agent nudges at specific market moments**, never makes panic jumps. Doubling Kp in one tx is forbidden by construction.

Migration txs (Sepolia): loose `0x141ae4e9...`, propose `0x3242bdbc...`, tight `0x4da1724c...`.

### Production targets

See [V11_PROD_CHECKLIST.md](./V11_PROD_CHECKLIST.md) for the demo→prod transition (longer cooldowns, smaller bounds, real noise barrier, hour-scale integral period, etc.).

---

## Deployment History

| Version | Highlight |
|---|---|
| V9 | First end-to-end Sepolia deploy. Verified full liquidation cycle (open → crash → liquidate → auction → settle). Pool ordering: GRIT(token0)/USDC(token1). |
| V10 | Added ParameterGuard + agent demo infra. Pool ordering flipped to USDC(token0)/GRIT(token1) — opposite of V9. PID gained `set_integral_period_size()`. |
| V10.1 | Redeployed PID + Guard with wider policy after V10 had Kp clamped to [1.4, 2.6] (too narrow). Other contracts kept. Discovered the prompt-vs-onchain drift problem. |
| **V11** | **Current.** RAY-scale proportional migration in PIDController. Added `pid.reset_deviation()` and `guard.set_pid_controller()`. Re-pegged redemption price. Now running the conservative policy above. |

V9/V10/V10.1 deployment artifacts have been removed from the repo (kept in git history). Only `deployed_v11.json` lives at the root.

---

## Frontend & Tooling

- **React app** (`app/`): wallet connect (starknet-react), SafeActions UI, ParameterGuard dashboard, on-chain history charts (`/api/history`), Filecoin archiving for decision logs.
- **Agent server** (`app/server/`): Express endpoint that runs the LLM reasoning loop on demand. Hosted on Render, auto-deploys from `main`.
- **Standalone agent** (`agent/`): identical reasoning loop as a long-running process (alternative to the server). See [agent/README.md](./agent/README.md).
- **MCP Server** (`agents/mcp-server/`): 16 tools for AI agent interaction — read positions, borrow, repay, deposit, withdraw, check health, etc.

---

## Operational Patterns (lessons from running V11)

These are patterns the codebase actually uses today. Worth knowing before touching the agent loop.

### ParameterGuard reset trick (loosen → propose → retighten)

When gains have walked far from baseline and the per-call `max_kp_delta` would force many sequential proposals, a 3-tx admin sequence resets in one cooldown window:

1. Deployer `set_policy(LOOSE)` — widen deltas to full range.
2. Agent `propose_parameters(target)` — single jump to baseline.
3. Deployer `set_policy(TIGHT)` — re-tighten to production deltas.

Reference: [`app/scripts/apply-conservative-policy.ts`](./app/scripts/apply-conservative-policy.ts) and [`app/scripts/reset-pid-gains.ts`](./app/scripts/reset-pid-gains.ts).
**Always stop the live agent first** — if it fires between steps 1 and 2 it consumes the cooldown under the loose policy.

### Server-side LLM clamping (defense in depth)

The on-chain Guard rejects out-of-bounds proposals with `Result::unwrap failed`, which surfaces to users as opaque RPC errors. To avoid this, the server clamps LLM outputs against the live policy *in code* before signing:

```ts
const kpClamped = clampBounds(
  clampDelta(newKp, currentKp, POLICY.MAX_KP_DELTA),
  POLICY.KP_MIN,
  POLICY.KP_MAX,
);
```

Triggered after a real incident: GLM-5.1 returned `7.334e-13` (extra precision), the rounded raw value was 733_400, delta from 666_667 was 66_733, busting the 66_667 cap by 66 wei. The clamp mirrors the on-chain policy in `app/server/index.ts`. **Update both whenever the policy moves on-chain.**

### LLM JSON output reliability (GLM-5.1 specific)

Reasoning models burn `max_tokens` on internal reasoning before emitting any output. Two non-negotiables for GLM-5.1:

1. `response_format: { type: "json_object" }` — forces JSON-only output, no prose preamble.
2. `max_tokens >= 8000` — anything below 4000 gets truncated mid-reasoning, returning empty string.

Diagnostic logs include `finish_reason` and content length so future failures are debuggable from the dashboard.

### Strict prompt ↔ on-chain alignment

The agent prompt MUST mirror the live ParameterGuard policy (bounds, deltas, cooldowns) exactly. Drift causes the LLM to propose values the chain rejects. Both `agent/src/reasoning.ts` and `app/server/index.ts` share the same prompt structure — update both when policy changes.

---

## Roadmap

### 10. TaxCollector (PLANNED)

Stability fees — interest charged on outstanding debt. Per-collateral rates, accrued continuously, surplus to AccountingEngine. Separate from PID redemption rate (which adjusts peg, not revenue).

### 11. DebtAuctionHouse (PLANNED)

Mints governance token to cover uncovered bad debt. Triggered when AccountingEngine has persistent deficit. Requires governance token contract.

### 12. SurplusAuctionHouse (PLANNED)

Burns governance token using excess surplus from stability fees. Requires governance token + TaxCollector.

### 13. GlobalSettlement (PLANNED)

Emergency shutdown — freezes the protocol, allows orderly redemption of GRIT for collateral share.

### 14. Governor + Delegatee (PLANNED)

On-chain governance for parameter changes and emergency actions. OpenZeppelin Governor pattern adapted for Cairo.

---

## Could Add: Extensions

| Extension | Description |
|---|---|
| Multi-Collateral | Factory for per-collateral CollateralJoin + AuctionHouse |
| Yield-Bearing Collateral | LBTC, SolvBTC — collateral value includes accrued yield |
| Staking & Rewards | Protocol token staking, surplus streaming |
| SAFE Saviours | Auto-deposit or auto-repay to prevent liquidation |
| Hook-Triggered Liquidations | Extend `after_swap()` to auto-liquidate underwater positions |

---

## Architecture Decision Log

| Decision | Choice | Why |
|---|---|---|
| Fork base | Opus (Cairo), not HAI (Solidity) | 40% smaller, already Cairo, more modular |
| PID vs multiplier | HAI-style redemption rate | Mathematically richer, handles inflation + deflation |
| Keeper model | Ekubo hook (after_swap) | Eliminates 2 of 3 keeper txs, atomic with swaps |
| GRIT token | Embedded in SAFEEngine | No separate CoinJoin, simpler, fewer contracts |
| Collateral | BTC-denominated (WBTC primary) | Starknet has $130M+ bridged BTC, yield thesis with LBTC |
| Price discovery | Swap delta amounts | Real market data from every trade, not TWAP oracle |
| Math precision | WAD (18) + RAY (27) | RAY critical for per-second rate compounding |
| Agent governance | Bounded propose-only via Guard | DAO votes policy, AI proposes within bounds — see [GRINTA_AGENTIC_HACKATHON.md](./GRINTA_AGENTIC_HACKATHON.md) |
| Conservative policy | 10% delta caps, ±50% bounds | Agent nudges, doesn't panic-jump. ~20% annualized at 1% deviation |

---

## Reference Material

- HAI Solidity contracts + docs (liquidation engine, accounting engine, auctions): https://github.com/hai-on-op/core
- Opus Cairo CDP (purger = liquidation, absorber = stability pool, shrine = engine): https://github.com/lindy-labs/opus_contracts
- [DESIGN.md](./DESIGN.md) — Full mechanism design with math
- [GRINTA_AGENTIC_HACKATHON.md](./GRINTA_AGENTIC_HACKATHON.md) — Agent-as-Governor thesis and roadmap
