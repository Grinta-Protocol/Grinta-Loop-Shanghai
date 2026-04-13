# Grinta Design Document

## Why Grinta Exists

RAI proved that PID-controlled stablecoins survive major market crashes without death spirals. HAI brought this model to Optimism with multi-collateral support. But both rely on off-chain keepers to push price updates and rate changes — a fragile dependency that adds operational cost and latency.

Grinta rebuilds this mechanism natively on Starknet with one key innovation: **the rate updater is an Ekubo DEX hook**. Every swap on the Grit/USDC pool automatically computes the GRIT market price from the swap amounts, runs the PID controller, and updates the redemption rate. No keepers for the internal pipeline, no cron jobs.

**One remaining manual input:** Someone must push BTC/USD to the OracleRelayer contract (from CoinGecko, Pragma, etc.). After that, the hook handles everything automatically — reading the collateral price, computing the GRIT market price from real swaps, running the PID, and pushing the new rate.

### The BTC Yield Thesis

Grinta targets BTC-denominated collateral (WBTC, LBTC, tBTC, SolvBTC). Unlike ETH-based CDPs where depositing collateral means forgoing staking yield (~3-4%), BTC yield assets like LBTC earn ~1% APY via Babylon staking. This eliminates the opportunity cost that historically suppressed demand for reflex-index stablecoins like RAI.

Starknet has $130M+ in bridged BTC assets and no GEB-style CDP protocol. Grinta fills that gap.

---

## Mechanism Design

### Redemption Price: A Floating Target

Grit does not maintain a hard $1 peg. Instead, it tracks a **redemption price** that starts at $1 and drifts continuously:

```
redemption_price(t) = redemption_rate ^ elapsed_seconds * redemption_price(t-1)
```

All computation is in RAY precision (27 decimals) using binary exponentiation (`rpow`). The rate compounds every second — if the rate is 1.000000001e27 (slightly above 1.0 RAY), the redemption price grows exponentially.

When a user borrows Grit, their debt is denominated in Grit units. The USD value of that debt is:

```
debt_usd = debt_grit * redemption_price / RAY
```

This means the redemption price directly affects the real cost of debt and the collateral ratio.

### PID Controller: How the Rate is Computed

The PID controller observes the deviation between the market price (from swap delta amounts on the Ekubo pool) and the redemption price, then outputs a rate adjustment.

#### Proportional Term

```
P = (redemption_price - scaled_market_price) / redemption_price
```

- Market below target (Grit cheap) → positive P → rate increases → redemption price rises → debt becomes more expensive → borrowers repay → supply contracts → price recovers
- Market above target (Grit expensive) → negative P → rate decreases → redemption price falls → debt becomes cheaper → borrowers mint more → supply expands → price falls

#### Integral Term with Leaky Integrator

```
I_new = leak^elapsed * I_old + (P_current + P_last) / 2 * elapsed
```

The integral accumulates deviations over time using trapezoidal approximation. The **leak** (exponential decay, ~99.9997%/s from HAI) prevents unbounded integral growth from sustained price manipulation ("Moby Dick" resistance). Old deviations gradually lose influence.

#### Gain-Adjusted Output

```
PI_output = Kp * P + Ki * I
```

Where Kp (proportional gain) controls responsiveness to current deviation, and Ki (integral gain) controls responsiveness to accumulated past deviation. Both are WAD-scaled signed values.

#### Noise Barrier

Small deviations are ignored to prevent rate oscillation:

```
act only if |PI_output| >= redemption_price * (2 - noise_barrier) / WAD - redemption_price
```

With noise_barrier = 0.995 WAD, the controller ignores deviations smaller than ~0.5%.

#### Rate Bounding

The final output is clamped to safety bounds and converted to a redemption rate:

```
bounded = clamp(PI_output, lower_bound, upper_bound)
rate = RAY + bounded    // clamped to [1, 2^127 - 1]
```

If the bounded output would make the rate negative, it's floored at 1 (minimum rate = essentially zero redemption price growth).

---

## The Ekubo Hook: Keeper-Minimized Architecture

This is Grinta's core architectural innovation.

### How HAI Does It (3+ separate transactions, keeper-dependent)

```
1. Keeper calls OracleRelayer.updateCollateralPrice()  → reads Chainlink
2. Keeper calls PIDRateSetter.updateRate()              → reads TWAP, runs PID
3. OracleRelayer writes new rate to SAFEEngine
```

Each step is a separate transaction, requires a funded keeper bot, and has latency between steps.

### How Grinta Does It (1 keeper tx + 1 atomic swap tx)

```
Keeper (off-chain):
  - Fetches BTC/USD from CoinGecko/Pragma
  - Calls OracleRelayer.update_price(wbtc, usdc, price_wad)

Any trader (on-chain, on every swap):
  after_swap() triggers atomically:
    1. Compute GRIT price from swap delta amounts     → market_price
    2. Read BTC/USD from OracleRelayer (x128)         → collateral_price
    3. Push collateral price to SAFEEngine
    4. Call PIDController.compute_rate()               → new rate
    5. Push new rate to SAFEEngine
```

The keeper only pushes BTC/USD — everything else (GRIT price discovery, PID computation, rate update) happens automatically inside swap transactions. Compared to HAI's 3+ keeper transactions, Grinta needs only 1 keeper call for the collateral price.

---

## Contract Architecture

### SAFEEngine (~565 lines)

The core ledger. Unlike HAI which separates SAFEEngine, SystemCoin, CoinJoin into 4+ contracts, Grinta's SAFEEngine handles all of these:

- **Safe accounting:** collateral deposits, debt tracking, ownership
- **Grit ERC20:** token minting/burning is embedded (no separate CoinJoin)
- **Redemption price:** continuous compounding via `rpow(rate, elapsed)`
- **Access control:** admin sets hook, manager, and join addresses

The redemption price updates lazily — it's recomputed on every borrow/repay rather than continuously. View functions compute the current price without modifying state.

The redemption price has a hard floor of 0.01 RAY ($0.01) — see INVARIANTS.md for details on this and the separate rate floor mechanism.

### CollateralJoin (158 lines)

Handles WBTC custody and decimal conversion. WBTC has 8 decimals; internal accounting uses 18 (WAD). The join converts on deposit/withdrawal:

```
internal_amount = asset_amount * 10^(18 - token_decimals)
```

### PIDController (382 lines)

A faithful port of HAI's PIDController.sol to Cairo. All the same math — proportional term, leaky integral, noise barrier, gain adjustment, rate bounding — but using Cairo's native i128 for signed arithmetic instead of Solidity's int256.

Key difference from Opus: Opus uses a **multiplier** (0.2x–2.0x) applied to collateral value. Grinta uses a **redemption rate** that continuously adjusts a floating redemption price. The PID approach is mathematically richer — it naturally handles both inflationary and deflationary pressure through a single mechanism.

### GrintaHook (376 lines)

Implements Ekubo's `IExtension` interface. Requests only `after_swap` callbacks (via `CALL_POINTS_AFTER_SWAP`). Computes GRIT market price from swap delta amounts (`_price_from_delta()`), reads BTC/USD from OracleRelayer (converts x128 to WAD), and orchestrates the full update cycle with dual throttles (60s for collateral, 3600s for PID rate).

### OracleRelayer (95 lines)

Accepts BTC/USD prices from anyone (no access control on testnet), converts from WAD to x128 format, and serves them to GrintaHook via the `IEkuboOracleExtension` interface. This is the **only off-chain dependency** — someone must push BTC/USD periodically. On mainnet, this would be replaced by a real oracle (Pragma, Chainlink, etc.).

### SafeManager (220 lines)

The user and agent-facing entry point. Provides:

- **Single-call operations:** `open_and_borrow(collateral, debt)` opens a safe, deposits, and borrows in one transaction
- **Agent delegation:** safe owners can authorize other addresses (bots, smart contracts) to operate their safes
- **Rich views:** `get_position_health()` returns collateral value, debt, LTV, and liquidation price in one call

#### Agent Delegation

```cairo
// Owner authorizes an AI agent
safe_manager.authorize_agent(safe_id, agent_address);

// Agent can now manage the position
safe_manager.deposit(safe_id, amount);
safe_manager.borrow(safe_id, amount);
safe_manager.repay(safe_id, amount);

// Owner revokes when done
safe_manager.revoke_agent(safe_id, agent_address);
```

This enables autonomous portfolio management — an AI agent can monitor health ratios and rebalance positions without the owner signing every transaction.

---

## Math Precision

Grinta uses two fixed-point scales throughout:

| Scale | Decimals | Used For |
|---|---|---|
| **WAD** | 18 (1e18) | Prices, collateral amounts, debt, ratios |
| **RAY** | 27 (1e27) | Redemption price, redemption rate, compounding |

RAY's extra precision is critical for rate compounding. A per-second rate adjustment of 0.0000001% would be invisible at WAD precision but is captured at RAY.

Conversion between scales:
```
WAD → RAY: multiply by 1e9
RAY → WAD: divide by 1e9
```

All math operations include half-unit rounding (`+ WAD/2` or `+ RAY/2`) for banker's rounding behavior.

---

## Comparison Table

| | RAI | HAI | Opus | **Grinta** |
|---|---|---|---|---|
| **Chain** | Ethereum L1 | Optimism | Starknet | **Starknet** |
| **Language** | Solidity | Solidity | Cairo | **Cairo** |
| **Collateral** | ETH only | Multi (ETH-based) | Multi (ETH, STRK, WBTC) | **BTC yield (WBTC, LBTC)** |
| **Rate mechanism** | PID → redemption rate | PID → redemption rate | Multiplier (0.2–2.0x) | **PID → redemption rate** |
| **Oracle updates** | Keepers | Keepers | Keepers / manual | **Hook + 1 keeper (BTC only)** |
| **Contracts** | ~60 | ~80+ | ~16 | **~9 core** |
| **Lines of code** | ~15k | ~18.6k | ~11.3k | **~2.6k** |
| **ERC20 location** | Separate SystemCoin | Separate SystemCoin | Embedded in Shrine | **Embedded in SAFEEngine** |

---

## Liquidation System Design

The liquidation system resolves bad debt from underwater positions through a three-contract pipeline: LiquidationEngine → CollateralAuctionHouse → AccountingEngine. Without it, underwater safes accumulate bad debt and the protocol is structurally insolvent.

### How Other Protocols Do It

**HAI (Solidity, 3 contracts):** `LiquidationEngine.liquidateSAFE()` → `SAFEEngine.confiscateSAFECollateralAndDebt()` → `CollateralAuctionHouse.startAuction()` → `AccountingEngine.pushDebtToQueue()`. Key parameters: `liquidationPenalty` (13%), `liquidationQuantity` (max debt per liquidation), `onAuctionSystemCoinLimit` (global cap), Dutch auction with increasing discount.

**Opus (Cairo, 1 contract: Purger):** Combines liquidation into one contract with TWO modes: searcher liquidation (caller pays debt, gets collateral at penalty discount) and stability pool absorption (for deeply underwater positions). Dynamic penalty based on LTV.

### Grinta's Approach

1. **Permissionless liquidation** — anyone calls `liquidate(safe_id)`, incentivized by penalty spread
2. **Fixed 13% penalty** — HAI's value (simpler than Opus's dynamic penalty)
3. **Dutch auction** — increasing discount over time, battle-tested
4. **Lightweight accounting** — track surplus/deficit without governance token auctions (yet)

### Liquidation Flow

```
Searcher/Bot/Agent
  │
  ▼
LiquidationEngine.liquidate(safe_id)
  ├── SAFEEngine.get_safe_health(safe_id)     → confirm underwater
  ├── SAFEEngine.confiscate(safe_id, col, debt) → seize from safe
  ├── CollateralJoin.seize(auction_house, col)  → move WBTC to auction house
  ├── AccountingEngine.push_debt(debt)          → record bad debt
  └── CollateralAuctionHouse.start_auction(col, debt*penalty, owner) → start Dutch auction
        │
        ▼ (time passes, discount increases)
Bidder (searcher, bot, user)
  │
  ▼
CollateralAuctionHouse.buy_collateral(auction_id, grit_amount)
  ├── SAFEEngine.transfer_from(bidder, accounting_engine, grit) → bidder pays GRIT
  ├── IERC20(wbtc).transfer(bidder, collateral)                 → bidder receives WBTC
  ├── LiquidationEngine.remove_coins_from_auction(debt)          → update global cap
  └── AccountingEngine.receive_surplus(grit_recovered)           → record recovery
        │
        ▼
AccountingEngine.settle_debt()
  ├── SAFEEngine.burn_system_coins(accounting_engine, min(surplus, debt))
  └── Updates surplus_balance and total_queued_debt
```

### Liquidation Math

**Health check:**
```
col_value = safe.collateral × collateral_price
debt_usd = (safe.debt × redemption_price) / RAY  [WAD result]

Unhealthy if: col_value × WAD < debt_usd × liquidation_ratio
```

**Penalty application:**
```
auction_debt = debt_to_cover × liquidation_penalty
// e.g. 1000 GRIT debt × 1.13 = 1130 GRIT to recover
```

**Proportional seizure (partial liquidation):**
```
collateral_to_seize = (debt_to_cover / safe.debt) × safe.collateral
```

### Dutch Auction Mechanism

```
Time 0 (auction starts):
  discount = 5% (min_discount) → collateral sells at 95% of oracle price

Time T:
  discount = min_discount * per_second_rate^elapsed → discount grows

Time T_max:
  discount = 20% (max_discount) → collateral sells at 80% of oracle price
```

Price computation: `fair_price_in_grit = btc_price / redemption_price_wad`, then `discounted_price = fair_price_in_grit * discount`.

### Confiscation vs Burning

`confiscate()` in SAFEEngine reduces the safe's collateral and debt but does NOT burn GRIT. The GRIT supply only contracts when:

1. A bidder sends GRIT to buy auction collateral
2. AuctionHouse transfers GRIT to AccountingEngine
3. AccountingEngine calls `burn_system_coins()` to destroy it

### Debt Lifecycle

```
1. User borrows 1000 GRIT → SAFEEngine mints, GRIT enters circulation
2. BTC drops → liquidate() → confiscate() reduces debt record, push_debt(1000)
3. Searcher buys collateral for 1130 GRIT → AccountingEngine surplus += 1130
4. settle_debt() → burns 1000 GRIT, surplus = 130 (penalty = protocol revenue)
```

### Cascade Protection

1. **`max_liquidation_quantity`** — caps debt per single liquidation call
2. **`on_auction_system_debt_limit`** — global cap on total debt under auction

### Security Considerations

- **Reentrancy:** `buy_collateral()` uses checks-effects-interactions — state updated before external transfers
- **Oracle manipulation:** Collateral price throttled to 60s; mainnet would use delayed oracles
- **Flash loan liquidators:** Intentionally allowed — increases market efficiency, penalty is protocol revenue
- **Cascade liquidation:** Global debt cap prevents auction market flooding
- **Dust safes:** `minimum_bid` and `max_liquidation_quantity` mitigate; consider minimum safe debt for production

---

## Deployment Parameters

These values are set at deployment and can be adjusted by the admin:

| Parameter | Value | Rationale |
|---|---|---|
| **Kp** | 154,712,579,997 (~1.547e-7 WAD) | HAI mainnet value — gentle response to deviation |
| **Ki** | 13,785 (~1.378e-14 WAD) | HAI mainnet value — corrects persistent deviation over time |
| **Noise barrier** | 0.995 WAD (0.5%) | Ignore deviations < 0.5% to prevent rate noise |
| **Integral period** | 3600s (1 hour) | Cooldown between PID updates — prevents over-correction |
| **Per-second leak** | 999,999,732,582,142,021,614,955,959 | 30-day half-life — HAI's battle-tested value |
| **Debt ceiling** | 1,000,000 Grit | Conservative for testnet |
| **Liquidation ratio** | 150% | Standard over-collateralization requirement |
| **Liquidation penalty** | 13% | Incentive for liquidators, covers protocol risk |
| **Update throttle** | 60s (collateral), 3600s (rate) | Dual throttle — see above |
| **Min auction discount** | 5% off | Starting point for Dutch auctions |
| **Max auction discount** | 20% off | Maximum buyer savings (price floor) |

---

## Resolved: Swap-Based Price Discovery (V8 → V9)

The `after_swap` hook fires on every swap and `_price_from_delta()` correctly computes the GRIT/USDC price from swap deltas. The formula is:

```
price_wad = |usdc_amount| * 1e30 / |grit_amount|
```

This produces ~1e18 (1 WAD = $1.00) at parity when the pool is initialized at the correct tick.

### Root Cause of V8 Failure

The V8 pool was initialized with **tick = +27,631,000** when it should have been **tick = -27,631,000** (negative). The tick sign depends on token ordering:

- **GRIT (18 dec) is token0, USDC (6 dec) is token1** (because GRIT address < USDC)
- Raw price at $1 parity = `1e6 / 1e18 = 1e-12` (less than 1)
- `tick = log_{1.000001}(1e-12) ≈ -27,631,000` → **negative**

With the wrong positive tick, the pool was at a price of ~1e12 raw USDC per raw GRIT (≈$10^24 per GRIT). Any swap produced deltas at this extreme ratio, and `_price_from_delta()` computed prices far above the $1000 sanity bound → rejected → `market_price` stayed 0.

### Rule for Tick Sign

**If token0 has MORE decimals than token1 and the human price is ~$1, the tick is NEGATIVE.** The magnitude (27,631,000) is always `|log_{1.000001}(10^(dec0 - dec1))|`.

The V9 deploy script (`deploy_sepolia.sh`) now computes the tick sign dynamically based on token address ordering.

## What's Not Built Yet

See [PROTOCOL_STATUS.md](./PROTOCOL_STATUS.md) for the full tracker. The next critical pieces are:

1. **Fix swap-based price discovery** — highest priority, core to the keeper-less thesis
2. **Revenue mechanisms** — TaxCollector for stability fees
3. **Last-resort safety** — DebtAuctionHouse, GlobalSettlement, governance
