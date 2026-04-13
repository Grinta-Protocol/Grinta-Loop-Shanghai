# Grinta Protocol — Invariants & Failure Modes

This document captures the critical invariants that must hold for the Grinta CDP system to function correctly, and the failure modes we discovered (and fixed) during testnet deployment.

---

## 1. The Pool Price Invariant

**Invariant:** The Ekubo pool must be initialized at the correct tick such that the on-chain swap ratio matches the real-world dollar parity between GRIT and USDC.

### What went wrong

GRIT has 18 decimals. USDC has 6 decimals. For $1 parity:

```
1 USDC (1e6 wei)  =  1 GRIT (1e18 wei)
→ price ratio = 1e18 / 1e6 = 1e12 GRIT-wei per USDC-wei
```

An AMM stores this ratio as a **tick**: `price = base^tick`.

**Ekubo uses base 1.000001. Uniswap V3 uses base 1.0001.**

We computed the tick using the wrong base:

| | Base | tick for 1e12 | Actual price at tick 276,000 |
|---|---|---|---|
| Uniswap V3 | 1.0001 | 276,325 | 1,000,000,000,000 (1e12) ✓ |
| Ekubo | 1.000001 | 27,631,035 | 1,000,000,000,000 (1e12) ✓ |
| **What we did** | 1.000001 | **276,000** | **1.32** ✗ |

The pool was initialized at tick 276,000 in Ekubo, which gives a price of **1.32** — as if both tokens had the same number of decimals.

### The cascade

```
Wrong tick (276,000 instead of 27,631,000)
  → Pool price: 1.32 GRIT-wei per USDC-wei (should be 1e12)
  → 100 USDC swap returns 0.000000000132 GRIT (should return ~100 GRIT)
  → Hook computes price: $758,847,113,934 per GRIT
  → Sanity bounds reject it (MAX = $1000)
  → market_price stays at 0
  → PID skips: "no market price yet"
  → System frozen — no swap can ever produce a valid price
  → market_price = 0 forever (death spiral)
```

### The fixes

**V7→V8 fix (tick magnitude):** Deployed at tick **27,631,000** instead of 276,000.

**V8→V9 fix (tick sign):** The tick must be **-27,631,000** (NEGATIVE), not +27,631,000. When GRIT (18 dec) is token0 and USDC (6 dec) is token1 (because GRIT address < USDC address), the raw price at $1 parity is `1e6 / 1e18 = 1e-12`, which is less than 1. In Ekubo, raw price < 1 requires a negative tick. The V9 deploy script computes tick sign dynamically based on token address ordering.

### Invariant enforcement

```
REQUIRED: tick = log(target_price_ratio) / log(1.000001)

For GRIT(18 dec, token0) / USDC(6 dec, token1) at $1 parity:
  raw_price = 1e6 / 1e18 = 1e-12  (less than 1)
  tick = log(1e-12) / log(1.000001) = -27,631,035
  rounded to tick_spacing 1000 → -27,631,000  (NEGATIVE)
```

**Rules:**
1. Never assume Uniswap V3 tick math applies to Ekubo. Always verify the tick base from the protocol source (`ekubo-contracts/src/math/ticks.cairo`).
2. If token0 has MORE decimals than token1 and human price ≈ $1, the tick is **NEGATIVE**.

---

## 2. The Market Price Liveness Invariant

**Invariant:** `market_price` in GrintaHook must be non-zero before the PID controller can function.

### Why this matters

The PID controller needs two inputs: `market_price` (what GRIT trades at) and `redemption_price` (what GRIT should target). If `market_price = 0`, the PID has no signal and skips:

```cairo
// grinta_hook.cairo, _try_update_rate()
let market_price = self.last_market_price.read();
if market_price == 0 {
    return; // No market price yet, skip
}
```

This is safe (prevents division by zero), but it means the system is **inert** until the first valid market price is established.

### How market_price becomes zero and stays zero

1. **Pool initialized at wrong tick** → every swap produces a price outside sanity bounds → rejected → stays 0
2. **Pool has zero liquidity in active range** → swap amounts are zero → `_price_from_delta` returns 0
3. **No swaps have occurred** → market_price was never set (initial state)

### Safeguards

- **`set_market_price()`** — Public function that allows anyone (keeper, agent, frontend) to manually bootstrap the market price. This breaks the chicken-and-egg problem.
- **Sanity bounds** `[MIN_MARKET_PRICE, MAX_MARKET_PRICE]` = `[$0.001, $1000]` — prevent garbage prices from entering the system while still accepting a wide range.

---

## 3. The PID Gain Magnitude Invariant

**Invariant:** PID gains (Kp, Ki) must be calibrated to produce rate adjustments proportional to the deviation magnitude. Gains that are too large cause violent oscillations; gains that are too small make the system unresponsive.

### What went wrong

| Parameter | Our initial value | RAI/HAI mainnet | Factor off |
|---|---|---|---|
| Kp | 1.0 WAD (1e18) | 1.547e-7 WAD (154,712,579,997) | 6.5 billion× |
| Ki | 0.5 WAD (5e17) | 1.378e-14 WAD (13,785) | 36 trillion× |

With Kp = 1.0, a tiny 0.05% price deviation ($1.0005 vs $1.0000) produced a **-2.49%/year** rate change. For a stablecoin, this is catastrophically aggressive — the system would oscillate wildly around the peg instead of smoothly converging.

### Why RAI/HAI gains are so small

The proportional term computes: `P = (redemption - market) / redemption` → a WAD-scaled percentage.

A 1% deviation gives `P = 0.01 WAD = 1e16`.

With `Kp = 1.547e-7 WAD`:
```
PI_output = Kp × P = 1.547e-7 × 1e16 = 1.547e9
rate = RAY + 1.547e9 = 1.000000000000000001547... RAY/s
annualized ≈ +0.0049%/year
```

This tiny nudge, compounded over hours and days, slowly steers the price. That's the design — a stablecoin PID should be a gentle hand on the tiller, not a sledgehammer.

### Correct values (from HAI mainnet)

```
Kp = 154,712,579,997          (~1.547e-7 WAD)
Ki = 13,785                   (~1.378e-14 WAD)
noise_barrier = 0.995 WAD     (ignore deviations < 0.5%)
integral_leak = 30-day half-life
integral_period = 3600s (1 hour cooldown)
```

---

## 4. The Noise Barrier Invariant

**Invariant:** The PID should not react to deviations smaller than the noise barrier threshold. Small price movements are noise, not signal.

### How it works

```
noise_barrier = 0.995 WAD
threshold = 0.5% of redemption_price

if |PI_output| < threshold:
    return RAY  (no rate change)
```

With HAI-calibrated gains, a 0.05% price deviation produces `|PI| = 243,411,235`, while the threshold is `4,999,985,105,929,344`. The output is **20 million times smaller** than the barrier — correctly filtered as noise.

### Why this matters

Without a noise barrier, every tiny swap would nudge the redemption rate. On a DEX with low volume, this creates:
- Rate flickering (changing direction every swap)
- Unnecessary gas costs for rate storage updates
- Integral term pollution (accumulating noise as if it were signal)

---

## 5. The Rate Floor and Price Floor Invariants

**Invariant:** The redemption rate must never go so low that the redemption price crashes to zero. There are **two separate safeguards** in different contracts.

### Safeguard A: Rate Floor (in PIDController)

```cairo
const MIN_RATE_FLOOR: u256 = 999_999_930_000_000_000_000_000_000; // ~0.99999993 RAY
```

This prevents the PID controller from outputting a rate so low that the price compounds toward zero too fast:

- At this floor rate, price halves every **~115 days**
- Even under sustained downward pressure, the system degrades slowly enough for governance intervention

### Safeguard B: Redemption Price Floor (in SAFEEngine)

```cairo
// In _update_redemption_price():
let min_price: u256 = RAY / 100; // 0.01 RAY = $0.01
if new_price < min_price {
    new_price = min_price;
}
```

This is a **hard clamp** on the redemption price itself. Even if the rate floor somehow fails or is bypassed, the redemption price can never drop below 0.01 RAY ($0.01). Applied in both `_update_redemption_price()` (state-modifying) and `get_redemption_price()` (view function).

### Why both exist

If `rate = 0`, then `redemption_price = price × 0^elapsed = 0`. Once the redemption price hits zero:
- All SAFEs become infinitely overcollateralized (debt = 0)
- The PID error term becomes undefined (division by zero)
- The system is irrecoverably broken

The rate floor (A) prevents the PID from driving the rate dangerously low. The price floor (B) is a last-resort safety net that catches any edge case where the price would hit zero regardless.

---

## 6. The Liquidation Health Invariant

**Invariant:** A safe can only be liquidated if its collateral value is strictly below the required collateral ratio: `col_value × WAD < debt_usd × liquidation_ratio`.

### Why this matters

Liquidating a healthy safe would:
- Unfairly penalize a user who is properly collateralized
- Seize their collateral and sell it at a discount
- Create a systemic incentive to liquidate everyone, not just underwater positions

### Enforcement

```cairo
// In LiquidationEngine.liquidate():
let col_value = wmul(safe.collateral, collateral_price);
let debt_usd = (debt_ray * redemption_price / RAY) / 1e9;

assert(col_value * WAD < debt_usd * liq_ratio, 'LIQ: safe is healthy');
```

The same computation is duplicated in `is_liquidatable()` for off-chain monitoring. Both must stay in sync.

### Edge case: exactly at the boundary

If `col_value × WAD == debt_usd × liq_ratio`, the safe is NOT liquidatable (strict inequality). This is intentional — the boundary belongs to the user.

---

## 7. The Auction Debt Recovery Invariant

**Invariant:** The total GRIT recovered from a liquidation auction must be sufficient to cover the confiscated debt, accounting for the liquidation penalty.

### How it works

```
confiscated_debt = 1,000 GRIT
auction_debt = confiscated_debt × 1.13 = 1,130 GRIT  (13% penalty)
```

The auction tries to recover 1,130 GRIT. The extra 130 GRIT is the liquidation incentive. If the auction only recovers 1,000 GRIT (full debt but no penalty), the protocol breaks even. If it recovers less, there's a deficit.

### What happens if auction doesn't fully recover

1. **Partial recovery:** AccountingEngine receives less GRIT than `push_debt()` registered
2. **`settle_debt()`** burns whatever surplus exists, leaving residual queued debt
3. **`mark_deficit()`** — admin can acknowledge the shortfall, moving it to `unresolved_deficit`
4. **Future mechanism:** DebtAuctionHouse would mint governance tokens to cover the gap (not yet built)

### Safeguard: `on_auction_system_debt_limit`

This global cap limits how much debt can be simultaneously under auction. If auctions fail to recover, this prevents a cascade of new liquidations from overwhelming the system.

---

## 8. The Confiscation-Burn Separation Invariant

**Invariant:** `confiscate()` in SAFEEngine does NOT burn GRIT. The GRIT supply only contracts when AccountingEngine receives recovered GRIT and calls `burn_system_coins()`.

### Why this separation exists

If confiscation burned GRIT immediately:
- The protocol would create GRIT out of thin air (since the GRIT is still circulating with the borrower)
- Total supply would be inconsistent with actual token balances

Instead:
1. `confiscate()` reduces safe's debt accounting (the debt record)
2. The actual GRIT tokens are still in circulation (held by the borrower or traders)
3. Auction bidders bring GRIT from the market to buy collateral
4. That GRIT is burned, contracting supply to match the reduced debt

### The flow

```
Before liquidation:
  SAFEEngine.total_debt = 10,000
  GRIT.total_supply = 10,000

After confiscate(1,000 debt):
  SAFEEngine.total_debt = 9,000    ← debt record reduced
  GRIT.total_supply = 10,000       ← supply unchanged (GRIT still circulating)

After auction recovers 1,130 GRIT and AccountingEngine.settle_debt():
  SAFEEngine.total_debt = 9,000    ← unchanged (already confiscated)
  GRIT.total_supply = 8,870        ← 1,130 burned
  AccountingEngine.surplus = 0     ← all used to settle
```

Note: if the auction recovers MORE than the confiscated debt (due to the penalty), the excess becomes AccountingEngine surplus, available for future debt settlement or (eventually) surplus auctions.

---

## 9. The Decimal Conversion Invariant (Auction House)

**Invariant:** CollateralAuctionHouse must correctly convert between internal WAD accounting (18 decimals) and asset token decimals (8 for WBTC) when transferring seized collateral.

### The conversion

```cairo
// In buy_collateral():
let asset_amount = collateral_to_buy / 10_000_000_000; // WAD → 8 decimals
```

This is `1e18 / 1e8 = 1e10`. The AuctionHouse receives WBTC from CollateralJoin.seize() in asset units (8 decimals), but tracks collateral amounts internally in WAD (18 decimals) for consistency with the rest of the protocol.

### V9 status

The `_price_from_delta()` formula was always correct. The V8 issue was the pool tick sign (see Invariant #1), not the decimal conversion. After the V9 tick sign fix, swap delta prices consistently produce ~$0.9985-$1.0016 WAD at $1 parity.

---

## Summary: Critical Invariants Checklist

| # | Invariant | Violation consequence | Safeguard |
|---|---|---|---|
| 1 | Pool tick uses Ekubo base (1.000001) + correct sign | Swap ratios off by 1e12 or inverted, market_price = 0 forever | Verify tick = log(price)/log(1.000001), negative if raw_price < 1 |
| 2 | market_price > 0 before PID fires | System frozen, no rate updates | `set_market_price()` bootstrap, sanity bounds |
| 3 | PID gains ≈ RAI/HAI magnitude | Kp too large → violent oscillation; too small → no response | Use battle-tested values (Kp ≈ 1.5e-7) |
| 4 | Small deviations filtered as noise | Rate flickers on every swap, integral pollution | noise_barrier = 0.995 (0.5% threshold) |
| 5a | Redemption rate ≥ MIN_RATE_FLOOR | Price compounds toward zero | Hardcoded floor at 0.99999993 RAY/s in PIDController |
| 5b | Redemption price ≥ 0.01 RAY | System irrecoverable (debt = 0) | Hard clamp in SAFEEngine `_update_redemption_price()` |
| 6 | Liquidation only on unhealthy safes | Unfair seizure of properly collateralized positions | Strict inequality: `col_value × WAD < debt_usd × liq_ratio` |
| 7 | Auction recovers debt + penalty | Protocol deficit if auction underperforms | `on_auction_system_debt_limit`, `mark_deficit()` for tracking |
| 8 | Confiscation ≠ burning | Supply/debt mismatch if GRIT burned prematurely | Separate `confiscate()` and `burn_system_coins()` |
| 9 | Correct WAD ↔ asset decimal conversion | Wrong collateral amounts transferred | Hardcoded `/1e10` for WBTC (8 dec → 18 dec internal) |
