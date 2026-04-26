# Grinta Protocol — Oracle & Price Feed Design

This document covers how prices enter and flow through Grinta: the two independent price feeds, the current MVP oracle, and production oracle candidates.

---

## The Two Prices

| Price | What it answers | Source | Used for |
|-------|----------------|--------|----------|
| **BTC/USD** | "How much is the collateral worth?" | External (CoinGecko, Pragma, etc.) | Determining if SAFEs are solvent |
| **GRIT/USDC** | "What is GRIT actually trading at?" | On-chain (Ekubo swap deltas) | PID controller input (market price) |

These are independent. BTC/USD tells us if a borrower has enough collateral. GRIT/USDC tells the PID whether GRIT is above or below its target peg.

---

## Price Feed 1: BTC/USD (Collateral Price)

### The Flow

```
CoinGecko API                    OracleRelayer                    GrintaHook                     SAFEEngine
     │                                │                               │                               │
     │  GET /simple/price             │                               │                               │
     │  btc_price = $67,432.15        │                               │                               │
     │                                │                               │                               │
     ├──── update_price() ───────────>│                               │                               │
     │     (wbtc, usdc, 67432.15e18)  │                               │                               │
     │                                │  stores as x128:              │                               │
     │                                │  price_x128 = wad * 2^128     │                               │
     │                                │            / 1e18             │                               │
     │                                │                               │                               │
     │                                │                               │  (on next swap or update())   │
     │                                │                               │                               │
     │                                │  get_price_x128_over_last() <─┤                               │
     │                                │ ─────────────────────────────>│                               │
     │                                │                               │                               │
     │                                │                               │  converts x128 back to WAD    │
     │                                │                               │  wad = x128 * 1e18 / 2^128   │
     │                                │                               │                               │
     │                                │                               ├── update_collateral_price() ─>│
     │                                │                               │   (67432.15e18)               │
     │                                │                               │                               │
```

### What triggers the read?

- **Automatically**: Every swap on the Ekubo pool calls `GrintaHook.after_swap()`, which internally calls `_update_collateral_price()`.
- **Manually**: When a user opens/borrows/repays via SafeManager, it calls `GrintaHook.update()`, which also calls `_update_collateral_price()`.

| Step | Who does it | When |
|------|------------|------|
| Fetch BTC price from API | **Manual** — keeper/agent/frontend | Whenever they want |
| Push price to OracleRelayer | **Manual** — same caller | Same call |
| Read price from OracleRelayer into protocol | **Automatic** — GrintaHook does this | On every swap or SAFE operation (throttled 60s) |

---

## Price Feed 2: GRIT/USDC (Market Price)

### The Flow

```
Ekubo Pool                       GrintaHook                      PIDController                  SAFEEngine
     │                                │                               │                               │
     │  User swaps USDC → GRIT       │                               │                               │
     │  (100 USDC in, 99.84 GRIT out)│                               │                               │
     │                                │                               │                               │
     ├──── after_swap(delta) ────────>│                               │                               │
     │                                │                               │                               │
     │                                │  _price_from_delta():         │                               │
     │                                │  price = usdc_amt * 1e30      │                               │
     │                                │        / grit_amt             │                               │
     │                                │  = 100e6 * 1e30 / 99.84e18   │                               │
     │                                │  = 1.0016e18  ($1.0016)       │                               │
     │                                │                               │                               │
     │                                │  sanity check:                │                               │
     │                                │  $0.001 ≤ $1.0016 ≤ $1000 ✓  │                               │
     │                                │                               │                               │
     │                                │  last_market_price = 1.0016e18│                               │
     │                                │                               │                               │
     │                                │  _try_update_rate():          │                               │
     │                                │  market  = $1.0016            │                               │
     │                                │  target  = $1.0000            │                               │
     │                                │  error   = -0.16%             │                               │
     │                                │                               │                               │
     │                                │  compute_rate() ─────────────>│                               │
     │                                │                               │  Kp × error = tiny            │
     │                                │                               │  < noise_barrier (0.5%)       │
     │                                │                               │  → return RAY (no change)     │
     │                                │  <────────────────────────────│                               │
     │                                │                               │                               │
     │                                │  (rate unchanged, deviation   │                               │
     │                                │   too small to act on)        │                               │
     │                                │                               │                               │
```

The GRIT market price is fully automatic — it comes from real swaps. No one needs to push it. The only thing needed is trading activity on the pool.

---

## Full System Diagram

```
                    ┌─────────────────────────────────────────────────┐
                    │                  EXTERNAL                       │
                    │                                                 │
                    │   Keeper/Agent/Frontend                         │
                    │   fetches BTC/USD from CoinGecko               │
                    │   calls OracleRelayer.update_price()            │
                    │                                                 │
                    │   Traders swap USDC ↔ GRIT on Ekubo            │
                    └────────────┬──────────────────┬─────────────────┘
                                 │                  │
                    ┌────────────▼──────┐    ┌──────▼──────────────┐
                    │  OracleRelayer    │    │  Ekubo Pool         │
                    │                   │    │  (USDC/GRIT)        │
                    │  stores BTC/USD   │    │                     │
                    │  in x128 format   │    │  calls after_swap() │
                    └────────┬──────────┘    └──────┬──────────────┘
                             │                      │
                             │    ┌─────────────────┘
                             │    │
                    ┌────────▼────▼──────────────────────────────────┐
                    │            GrintaHook                          │
                    │                                                │
                    │  1. _update_collateral_price()     [every 60s] │
                    │     reads BTC/USD from OracleRelayer            │
                    │     pushes to SAFEEngine                       │
                    │                                                │
                    │  2. _price_from_delta()           [every swap] │
                    │     computes GRIT price from swap amounts      │
                    │     stores as last_market_price                │
                    │                                                │
                    │  3. _try_update_rate()          [every 3600s]  │
                    │     reads market_price + redemption_price       │
                    │     calls PID → gets new rate                  │
                    │     pushes to SAFEEngine                       │
                    └───────────┬────────────┬──────────────────────┘
                                │            │
                    ┌───────────▼──┐   ┌─────▼───────────┐
                    │ PIDController │   │   SAFEEngine    │
                    │              │   │                  │
                    │ compares     │   │ stores:          │
                    │ market vs    │   │ - collateral     │
                    │ redemption   │   │   price (BTC)    │
                    │ returns rate │   │ - redemption     │
                    │              │   │   price (GRIT    │
                    │              │   │   target)        │
                    │              │   │ - redemption     │
                    │              │   │   rate           │
                    └──────────────┘   └─────────────────┘
```

**Bottom line:** For the protocol to function, exactly two things need to happen externally:
1. **Someone pushes BTC/USD to OracleRelayer** — periodically (throttled to 60s anyway)
2. **People trade on the Ekubo pool** — swaps are the heartbeat of the system

Everything else is automatic.

---

## Oracle Options for BTC/USD

The oracle design determines **where this price comes from**, **who pushes it**, and **how manipulation-resistant it is**.

---

## Option: OracleRelayer (Current — MVP / Testnet)

### Implementation

- **Contract**: `src/oracle_relayer.cairo` (95 lines)
- **Interface**: Implements `IEkuboOracleExtension.get_price_x128_over_last()`
- **Access control**: None — anyone can push a price (MVP)
- **Storage**: Stores prices in both WAD and x128 formats
- **Throttle**: None on the push side; GrintaHook throttles reads to 60s

### Pros
- ✅ Simple, easy to test and debug
- ✅ Full control over price inputs during development
- ✅ Interface matches production oracle candidates (drop-in replacement)
- ✅ No external dependencies

### Cons
- ❌ Trust assumption — anyone can push any price
- ❌ No staleness checks
- ❌ Not suitable for mainnet (no economic security)

### When to Use
- Testnet development and testing
- Integration testing of GrintaHook, PIDController, SAFEEngine
- Demonstrations and PoC

---

## Option A: Ekubo Oracle Extension

### How It Works

Ekubo's oracle is **not a standalone oracle contract**. It is an **Ekubo Extension** that automatically records price snapshots on every swap in a pool. The TWAP (Time-Weighted Average Price) is computed from these accumulated snapshots.

```
Ekubo Pool (WBTC/USDC)              Ekubo Oracle Extension           GrintaHook
       │                                │                               │
       │  Trader swaps WBTC ↔ USDC     │                               │
       │                                │                               │
       ├── before_swap() ──────────────>│                               │
       │                                │  records snapshot:            │
       │                                │  - current tick               │
       │                                │  - tick_cumulative            │
       │                                │  - block_timestamp            │
       │                                │                               │
       │                                │                               │  (on swap or update())
       │                                │  get_price_x128_over_last() <─┤
       │                                │  computes TWAP from snapshots │
       │                                │ ─────────────────────────────>│
       │                                │                               │
```

### Technical Details

**Snapshot Structure** (from `ekubo-contracts/src/types/snapshot.cairo`):
```cairo
pub struct Snapshot {
    pub block_timestamp: u64,       // When the snapshot was taken
    pub tick_cumulative: i129,      // SUM(tick × seconds) since pool init
}
```

**TWAP Calculation**:
```
TWAP_tick = (tick_cumulative_end - tick_cumulative_start) / (time_end - time_start)
price = tick_to_price_x128(TWAP_tick)  // returns 128.128 fixed-point
```

**When Snapshots Are Taken**:
- Before every swap (`before_swap` hook)
- Only once per block (skips if `time_passed == 0`)
- No keeper needed — fully automatic

**Oracle Pool Requirements** (enforced by Ekubo):
- Pool **must** include the oracle token
- Fee must be 0
- Tick spacing must be MAX (354,892)
- Only full-range positions allowed

**Cross-Pair Pricing** (via oracle_token):
If the oracle token is USDC, and you have pools `WBTC/USDC` and `USDC/GRIT`, you can derive `WBTC/GRIT` by chaining through USDC. But you **must have an oracle pool for each token paired with the oracle token**.

### Pros
- ✅ Fully on-chain — no external data sources, no keepers
- ✅ Permissionless — anyone can create a pool and start contributing data
- ✅ Manipulation-resistant — TWAP smooths out flash manipulations
- ✅ Drop-in replacement — same `IEkuboOracleExtension` interface as current mock
- ✅ No ongoing operational cost

### Cons
- ❌ **Requires a WBTC/USDC pool on Ekubo** — if one doesn't exist, no data
- ❌ **Requires sufficient liquidity** — low liquidity = easy to manipulate
- ❌ **Requires organic trading activity** — no swaps = no snapshots = stale TWAP
- ❌ **Doesn't work on testnet** — Sepolia has no meaningful liquidity
- ❌ **Single venue** — price reflects Ekubo's market, not global market
- ❌ **Lagging indicator** — TWAP smooths but also delays price discovery

### Manipulation Resistance

The cost to manipulate a TWAP is proportional to:
- Liquidity in the pool (more liquidity = harder to move)
- TWAP period length (longer period = more capital needed to sustain manipulation)

**Rule of thumb**: For a 10-minute TWAP, an attacker needs to sustain the manipulated price for 10 minutes. The cost scales roughly as `liquidity × (price_move)²`.

### When to Use
- Mainnet, IF Ekubo has a deep WBTC/USDC pool ($500K+ liquidity)
- As a fallback oracle in a hybrid design
- When you want fully on-chain, permissionless price feeds

### Implementation Notes

To switch from OracleRelayer to Ekubo Oracle:
1. Point `GrintaHook.ekubo_oracle` to the real Ekubo Oracle Extension address
2. Ensure a WBTC/USDC oracle pool exists on Ekubo with sufficient liquidity
3. **No code changes needed** — the interface is already compatible

**x128 to WAD conversion** (already in GrintaHook):
```cairo
let two_pow_128: u256 = 0x100000000000000000000000000000000;
let btc_price_wad = (btc_price * WAD) / two_pow_128;
```

### Research Checklist
- [ ] Does Ekubo mainnet have a WBTC/USDC pool?
- [ ] What is the current liquidity depth?
- [ ] What is the typical trading volume?
- [ ] What TWAP period is appropriate for collateral valuation? (Opus uses 60s minimum)
- [ ] Can we use cross-pair chaining if no direct WBTC/USDC pool exists?

---

## Option B: Pragma Oracle

### How It Works

Pragma is an on-chain oracle network on Starknet that aggregates prices from multiple off-chain data publishers (CEXs like Binance, OKX, etc.). Prices are pushed on-chain by Pragma's publishers and aggregated via median.

```
CEX APIs (Binance, OKX, etc.)     Pragma Publishers              Pragma Oracle Contract
       │                                │                               │
       │  BTC/USD = $67,432.15         │                               │
       │                                │                               │
       ├── API calls ──────────────────>│                               │
       │                                │  aggregate via median         │
       │                                │  push on-chain                │
       │                                │                               │
       │                                │── update() ──────────────────>│
       │                                │                               │
       │                                │                               │  (on swap or update())
       │                                │                               │
       │                                │  get_data() <─────────────────┤
       │                                │ ─────────────────────────────>│
       │                                │                               │
```

### Technical Details

**Price Retrieval**:
```cairo
let spot_price = pragma.get_spot_price(pair_id);
let twap_price = pragma.get_twap_price(pair_id, twap_duration);
let pessimistic_price = min(spot_price, twap_price);
```

**Key Parameters** (from Opus's implementation):
- TWAP duration: 7 days (252,000 seconds)
- Freshness threshold: 1 minute to 4 hours (configurable)
- Minimum sources: 3 to 13 data publishers
- Pessimistic pricing: `min(spot, twap)` protects against upward manipulation

**Sepolia Testnet Address**:
```
0x36031daa264c24520b11d93af622c848b2499b66b41d611bac95e13cfca131a
```

### Pros
- ✅ Battle-tested — used by Opus and other major Starknet protocols
- ✅ BTC/USD feed exists with multiple sources
- ✅ Built-in TWAP (7-day by default) — extremely manipulation-resistant
- ✅ Pessimistic pricing protects borrowers
- ✅ Works on Sepolia testnet (dedicated feeds)
- ✅ Freshness and source validation
- ✅ Covers any listed pair, not just Ekubo pools

### Cons
- ❌ Depends on Pragma publishers (off-chain data sources)
- ❌ Centralization risk — Pragma is a single protocol
- ❌ Requires adding `pragma_lib` as a Scarb dependency
- ❌ Different interface than current mock (needs adapter or interface change)
- ❌ If Pragma has an outage, all dependent protocols are affected

### When to Use
- Mainnet production (safest option for collateral valuation)
- Testnet integration testing (Pragma has Sepolia feeds)
- When you need coverage for tokens without Ekubo pools

### Implementation Notes

To integrate Pragma:
1. Add `pragma_lib` as a Scarb dependency
2. Create a `PragmaAdapter` contract that implements `IEkuboOracleExtension`
3. The adapter converts Pragma's price format to x128 for GrintaHook
4. Point `GrintaHook.ekubo_oracle` to the adapter

**Or** change `GrintaHook` to call Pragma directly (breaks interface compatibility with Ekubo oracle).

---

## Option C: Hybrid (Pragma + Ekubo)

### How It Works

Use **Pragma as the primary oracle** for collateral valuation, with **Ekubo as a fallback** if Pragma is stale or unavailable. This is the approach Opus uses.

```
                    ┌─────────────────────────────────────┐
                    │         Oracle Router               │
                    │                                     │
                    │  1. Try Pragma                      │
                    │     - if fresh → use it             │
                    │     - if stale → fallback           │
                    │                                     │
                    │  2. Fallback to Ekubo Oracle        │
                    │     - if TWAP available → use it    │
                    │     - if not → revert               │
                    │                                     │
                    └──────────────┬──────────────────────┘
                                   │
                                   ▼
                            GrintaHook
```

### Pros
- ✅ Best of both worlds — Pragma's reliability + Ekubo's on-chain fallback
- ✅ Resilient to single-point failures
- ✅ Used in production by Opus
- ✅ Can follow Opus's proven implementation patterns

### Cons
- ❌ More complex — two oracle integrations to maintain
- ❌ Higher gas cost (checking both oracles)
- ❌ Need to define clear fallback conditions

### When to Use
- Mainnet production (recommended for maximum resilience)
- When you want to minimize trust assumptions while maintaining reliability

---

## Comparison Matrix

| Criterion | OracleRelayer (MVP) | Ekubo Oracle | Pragma Oracle | Hybrid |
|---|---|---|---|---|
| **Keeper needed?** | YES (manual push) | NO | NO | NO |
| **On-chain data?** | Partially (pushed) | Fully on-chain | Off-chain sources | Both |
| **Testnet viable?** | YES | NO (no liquidity) | YES (Sepolia feeds) | Partial |
| **Mainnet viable?** | NO | YES (if liquidity) | YES (battle-tested) | YES |
| **Manipulation risk** | HIGH (anyone pushes) | MEDIUM (depends on liquidity) | LOW (multi-source) | LOWEST |
| **Integration effort** | Done | LOW (drop-in) | MEDIUM (adapter) | HIGH |
| **Operational cost** | Keeper time | None | Pragma fees (if any) | Pragma fees |
| **Covers BTC/USD?** | YES | Only if pool exists | YES (native) | YES |
| **Trust model** | Trust the pusher | Trust the AMM | Trust publishers | Trust both |

---

## Decision: What to Use When

| Phase | Oracle | Rationale |
|---|---|---|
| **Testnet / Development** | OracleRelayer (current) | Full control, easy to test, no dependencies |
| **Testnet / Integration** | Pragma Sepolia | Real oracle behavior, dedicated testnet feeds |
| **Mainnet (MVP)** | Pragma | Safest, battle-tested, immediate BTC/USD coverage |
| **Mainnet (Mature)** | Hybrid (Pragma + Ekubo) | Maximum resilience, follows Opus pattern |

---

## Key Invariants for Any Oracle

1. **Price must be > 0** — zero price breaks all downstream math
2. **Price must be fresh** — stale prices can lead to incorrect liquidations
3. **Price must be manipulation-resistant** — attackers shouldn't profit from oracle manipulation
4. **Price format must be consistent** — GrintaHook expects x128 format from `get_price_x128_over_last()`

---

## Open Questions

1. Does Ekubo mainnet have a WBTC/USDC pool with sufficient liquidity for oracle purposes?
2. What is the minimum TWAP period for collateral valuation? (Opus uses 60s for Ekubo, 7 days for Pragma)
3. Should we implement staleness checks in the oracle adapter?
4. What happens if both oracles fail in the hybrid design? (Circuit breaker? Last known price?)
5. Should we add a noise barrier for collateral price updates (similar to PID noise barrier)?

---

## References

- **Ekubo Oracle Extension**: `ekubo-contracts/src/extensions/oracle.cairo`
- **Ekubo Snapshot Type**: `ekubo-contracts/src/types/snapshot.cairo`
- **Opus Ekubo Oracle Adapter**: [opus_contracts/src/external/ekubo.cairo](https://github.com/lindy-labs/opus_contracts/blob/main/src/external/ekubo.cairo)
- **Opus Pragma Oracle**: [opus_contracts/src/external/pragma.cairo](https://github.com/lindy-labs/opus_contracts/blob/main/src/external/pragma.cairo)
- **Current Mock**: `src/oracle_relayer.cairo`
- **GrintaHook Integration**: `src/grinta_hook.cairo` (lines 144-169)
- **Price Feeds**: See "The Two Prices" section at the top of this document
