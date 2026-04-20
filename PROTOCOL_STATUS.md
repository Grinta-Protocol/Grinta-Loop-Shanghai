# Grinta Protocol Status

> Living document tracking what's built, what's next, and what could be added.
> Last updated: 2026-04-19

---

## What Is Grinta?

A keeper-minimized CDP protocol on Starknet. Users deposit BTC collateral (WBTC, LBTC) and borrow GRIT, a PID-controlled floating stablecoin. The PID rate updater is an Ekubo DEX hook — every swap on the GRIT/USDC pool automatically discovers the market price, runs the PID controller, and updates the redemption rate. No keepers for the internal pipeline.

The only off-chain dependency: someone pushes BTC/USD to the OracleRelayer.

Full mechanism design: [DESIGN.md](./DESIGN.md)

---

## Built — 9 Core Contracts + 2 Mocks

All contracts compile clean, **70/70 tests pass**. Deployed on Sepolia V9 with working e2e including full liquidation cycle. **V10 deployed with ParameterGuard + Agent demo infrastructure.**

Contract details and line counts in [README.md](./README.md). Full mechanism design in [DESIGN.md](./DESIGN.md).

| Phase | Contracts | Status |
|---|---|---|
| Phase 1 — Core | SAFEEngine, CollateralJoin, PIDController, GrintaHook, SafeManager, OracleRelayer | Deployed V9 + V10 |
| Phase 3 — Liquidation | LiquidationEngine, CollateralAuctionHouse, AccountingEngine | Deployed V9 |
| Phase 4 — Agent | ParameterGuard | Deployed V10 |

### Shared Code

- **types.cairo** (~160 lines): WAD/RAY constants, fixed-point math, core structs
- **types_ekubo.cairo**: Ekubo-specific types (PoolKey, SwapParameters, Delta, i129, etc.)
- **interfaces/**: One interface file per contract + external interfaces (iekubo, ierc20)
- **mock/**: ERC20Mintable, MockEkuboOracle (for testing)

---

## Deployed (Sepolia V9)

All addresses in [`deployed_v9.json`](./deployed_v9.json).

Pool: GRIT(token0)/USDC(token1), fee=0, tick_spacing=1000, extension=GrintaHook
Init tick: **-27,631,000** (negative — critical, see [INVARIANTS.md](./INVARIANTS.md))
Liquidity bounds: [-27,726,000, -27,526,000] (~$0.90 to ~$1.10)

Verified on-chain:
- Market price: ~$0.9995 (swap-based price discovery works)
- Full liquidation cycle: open → crash BTC → liquidate → Dutch auction → settle debt
- Post-settlement accounting: surplus = 3,900 GRIT (13% penalty profit), queued debt = 0

---

## Deployed (Sepolia V10) — Agent-as-Governor Demo

All addresses in [`deployed_v10.json`](./deployed_v10.json).

**Key changes from V9:**
- Pool token ordering: USDC(token0) < GRIT(token1) — OPPOSITE of V9
- Added `ParameterGuard` contract for bounded AI agent parameter governance
- Added `set_integral_period_size()` setter to PIDController (was hardcoded 3600s)
- Redeployed PIDController with `integral_period_size=5s` for fast demo cycles
- **PID address**: `0x069bd5d8cda116f142f9fb56fdd55310bce06274e0c5461166ce32c27ac91e0f`

**Demo infrastructure** (`demo/`, `agent/`):
- **Feeder** (`demo/src/feeder.ts`): pushes CSV BTC prices to OracleRelayer
- **Trader** (`demo/src/trader.ts`): executes Ekubo swaps creating depeg pressure per phase
- **Agent** (`agent/`): LLM (GLM-5.1 via CommonStack) monitors state → reasons → proposes KP/KI via ParameterGuard
- **Launcher** (`demo/src/launcher.ts`): orchestrates all three as child processes

**Verified working:**
- ✅ Feeder pushes prices correctly (7/7 in 60s demo)
- ✅ Trader swaps execute (2 swaps in 60s)
- ✅ Agent reads all on-chain state (8 contract calls)
- ✅ Agent called LLM and submitted `propose_parameters` tx (updateCount=1)
- ⚠️ Nonce collision between trader & agent (same wallet) — mitigated with retry logic in executor

---

## Deployed (Sepolia V10.1) — Post-V10 Redeploy of PID + Guard

All addresses in [`deployed_v10_1.json`](./deployed_v10_1.json).

**Why a V10.1 exists:** after the initial V10 deploy, the `PIDController` and `ParameterGuard` were redeployed to widen the Guard's policy for demo purposes (V10 had KP bounded to [1.4, 2.6], too narrow for meaningful LLM movement). All other V10 contracts were reused as-is — the new PID and Guard were wired into the existing V10 infrastructure.

**What changed vs V10:**

| Component | V10 address | V10.1 address |
|---|---|---|
| PIDController | `0x069bd5d8...` | `0x053916399...` |
| ParameterGuard | `0x00341ecbc...` | `0x065e1098a...` |
| Agent wallet | `0x27c0daed...` | `0x01f8975c5...` |

**What stayed:** SAFEEngine, CollateralJoin, GrintaHook, SafeManager, OracleRelayer, AccountingEngine, LiquidationEngine, CollateralAuctionHouse, MockWBTC, MockUSDC — all V10 addresses unchanged.

**Guard policy (on-chain verified 2026-04-19):**
- KP range: [0.1, 10.0] WAD (was [1.4, 2.6])
- KI range: [0.0, 0.1] WAD (was [0.001, 0.01])
- Max KP delta per update: 2.0 WAD (was 0.5)
- Max KI delta per update: 0.2 WAD (was 0.002)
- Cooldown: 5s normal, 3s emergency (was 300/60)
- Max updates: 1000 (was 20)

**On-chain verification (2026-04-19):**
- `Guard.get_agent()` → matches `.env AGENT_ADDRESS` ✓
- `Guard.get_update_count()` → 28 (agent has successfully proposed 28 times)
- `PID.get_controller_gains()` → kp=10.0, ki=0.1 WAD (at Guard ceiling)

**Known issue:** the agent's LLM prompt (in `app/server/index.ts`) states constraints that don't match on-chain reality — it claims `cooldown=30s, emergency=10s, max_kp_delta=1.0`, but on-chain values are `5s, 3s, 2.0`. Prompt needs a second pass to align with actual Guard policy. Also, the LLM was monotonically increasing KP (now at ceiling 10.0) because the old prompt didn't instruct to decrease on BTC pumps. The prompt has been simplified to handle both directions symmetrically.

---

## Frontend & Tooling

- **React app** (`app/`): Wallet connect (starknet-react), SafeActions UI, hooks for contract interaction
- **MCP Server** (`agents/mcp-server/`): 16 tools for AI agent interaction — read positions, borrow, repay, deposit, withdraw, check health, etc.

---

## Next: Revenue & Governance

With swap-based price discovery resolved (V9), the next priorities are:

### 10. TaxCollector (PLANNED)

Stability fees — interest charged on outstanding debt.

- Per-collateral fee rates (e.g. 2% APY on WBTC debt)
- Accrues continuously, collected on any safe operation
- Revenue goes to AccountingEngine as surplus
- Separate from PID redemption rate (which adjusts peg, not revenue)

**Why later**: The PID already adjusts borrowing cost via redemption rate. Stability fees are an additional revenue layer for protocol sustainability.

---

## Later: Last-Resort Mechanisms

These handle edge cases where collateral auctions don't fully cover bad debt.

### 11. DebtAuctionHouse (PLANNED)

Mints governance token to cover uncovered bad debt.

- Triggered when AccountingEngine has persistent deficit
- Mints protocol governance tokens, sells for GRIT
- Requires: governance token contract (not yet built)

### 12. SurplusAuctionHouse (PLANNED)

Burns governance token using excess surplus from stability fees.

- Triggered when AccountingEngine surplus exceeds buffer
- Sells GRIT surplus for governance tokens, burns the gov tokens
- Requires: governance token + TaxCollector (no surplus without fees)

---

## Before Mainnet: Safety & Governance

### 13. GlobalSettlement (PLANNED)

Emergency shutdown — freezes the protocol and allows orderly unwinding.

- Admin (later: governance) can trigger shutdown
- Freezes all oracles and rates
- Allows users to redeem GRIT at a fixed rate for their share of collateral

### 14. Governor + Delegatee (PLANNED)

On-chain governance for parameter changes and emergency actions.

- OpenZeppelin Governor pattern adapted for Cairo
- Replaces admin role for mainnet

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

---

## Reference Material

- `hai_core/` — HAI Solidity contracts + docs (liquidation engine, accounting engine, auctions)
- `opus_contracts/` — Opus Cairo CDP (purger = liquidation, absorber = stability pool, shrine = engine)
- [DESIGN.md](./DESIGN.md) — Full mechanism design with math
