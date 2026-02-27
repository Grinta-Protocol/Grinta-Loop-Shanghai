# Grinta Design Document

## Why Grinta Exists

RAI proved that PID-controlled stablecoins survive major market crashes without death spirals. HAI brought this model to Optimism with multi-collateral support. But both rely on off-chain keepers to push price updates and rate changes — a fragile dependency that adds operational cost and latency.

Grinta rebuilds this mechanism natively on Starknet with one key innovation: **the oracle and rate updater is an Ekubo DEX hook**. Every swap on the Grit/USDC pool automatically reads TWAPs, runs the PID controller, and updates the redemption rate. No keepers, no cron jobs, no off-chain infrastructure.

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

The PID controller observes the deviation between the market price (from Ekubo TWAP) and the redemption price, then outputs a rate adjustment.

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

With noise_barrier = 0.95 WAD, the controller ignores deviations smaller than ~5%.

#### Rate Bounding

The final output is clamped to safety bounds and converted to a redemption rate:

```
bounded = clamp(PI_output, lower_bound, upper_bound)
rate = RAY + bounded    // clamped to [1, 2^127 - 1]
```

If the bounded output would make the rate negative, it's floored at 1 (minimum rate = essentially zero redemption price growth).

---

## The Ekubo Hook: No Keepers Needed

This is Grinta's core architectural innovation.

### How HAI Does It (3+ separate transactions, keeper-dependent)

```
1. Keeper calls OracleRelayer.updateCollateralPrice()  → reads Chainlink
2. Keeper calls PIDRateSetter.updateRate()              → reads TWAP, runs PID
3. OracleRelayer writes new rate to SAFEEngine
```

Each step is a separate transaction, requires a funded keeper bot, and has latency between steps.

### How Grinta Does It (atomic, on every swap)

GrintaHook registers as an Ekubo pool extension with `after_swap` callback. When anyone swaps on the Grit/USDC pool:

```
after_swap() triggers:
  1. Read BTC/USDC 30-min TWAP from Ekubo Oracle    → collateral price
  2. Read Grit/USDC 30-min TWAP from Ekubo Oracle   → market price
  3. Push collateral price to SAFEEngine
  4. Read current redemption price from SAFEEngine
  5. Call PIDController.compute_rate(market, redemption) → new rate
  6. Push new rate to SAFEEngine
```

All six steps execute atomically in a single transaction, paid for by the swapper. A 60-second throttle prevents redundant updates on rapid trading.

### Fallback: Manual Update

When there's no trading activity, anyone can call `hook.update()` to trigger the same flow. This ensures the system stays current even in low-liquidity periods.

### Anti-Manipulation

- **30-minute TWAP** instead of spot price — resistant to flash loans and single-block manipulation
- **60-second minimum interval** between updates — prevents griefing via rapid small swaps
- **PID noise barrier** — ignores tiny deviations that could be noise

---

## Contract Architecture

### SAFEEngine (461 lines)

The core ledger. Unlike HAI which separates SAFEEngine, SystemCoin, CoinJoin, and OracleRelayer into 4+ contracts, Grinta's SAFEEngine handles all of these:

- **Safe accounting:** collateral deposits, debt tracking, ownership
- **Grit ERC20:** token minting/burning is embedded (no separate CoinJoin)
- **Redemption price:** continuous compounding via `rpow(rate, elapsed)`
- **Access control:** admin sets hook, manager, and join addresses

The redemption price updates lazily — it's recomputed on every borrow/repay rather than continuously. View functions compute the current price without modifying state.

### CollateralJoin (158 lines)

Handles WBTC custody and decimal conversion. WBTC has 8 decimals; internal accounting uses 18 (WAD). The join converts on deposit/withdrawal:

```
internal_amount = asset_amount * 10^(18 - token_decimals)
```

### PIDController (374 lines)

A faithful port of HAI's PIDController.sol to Cairo. All the same math — proportional term, leaky integral, noise barrier, gain adjustment, rate bounding — but using Cairo's native i128 for signed arithmetic instead of Solidity's int256.

Key difference from Opus: Opus uses a **multiplier** (0.2x–2.0x) applied to collateral value. Grinta uses a **redemption rate** that continuously adjusts a floating redemption price. The PID approach is mathematically richer — it naturally handles both inflationary and deflationary pressure through a single mechanism.

### GrintaHook (245 lines)

Implements Ekubo's `IExtension` interface. Requests only `after_swap` callbacks (via `CALL_POINTS_AFTER_SWAP`). Reads TWAPs by calling Ekubo's deployed Oracle Extension contract, converts from x128 fixed-point to WAD, and orchestrates the full update cycle.

### SafeManager (190 lines)

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
| **Oracle updates** | Keepers | Keepers | Keepers / manual | **Ekubo hook (automatic)** |
| **Contracts** | ~60 | ~80+ | ~16 | **~5 core** |
| **Lines of code** | ~15k | ~18.6k | ~11.3k | **~1.8k** |
| **ERC20 location** | Separate SystemCoin | Separate SystemCoin | Embedded in Shrine | **Embedded in SAFEEngine** |

---

## Deployment Parameters

These values are set at deployment and can be adjusted by the admin:

| Parameter | Value | Rationale |
|---|---|---|
| **Kp** | 1.0 WAD | Standard proportional gain — immediate response to deviation |
| **Ki** | 0.5 WAD | Moderate integral gain — corrects persistent deviation over time |
| **Noise barrier** | 0.95 WAD (5%) | Ignore deviations < 5% to prevent rate noise |
| **Integral period** | 3600s (1 hour) | Cooldown between PID updates — prevents over-correction |
| **Per-second leak** | 999997208243937652252849536 | ~99.9997%/s decay — HAI's battle-tested value |
| **Debt ceiling** | 1,000,000 Grit | Conservative for testnet |
| **Liquidation ratio** | 150% | Standard over-collateralization requirement |
| **TWAP period** | 30 minutes | Long enough to resist manipulation |
| **Update throttle** | 60 seconds | Prevent redundant updates |

---

## What's Not Built Yet

This is a PoC. Production would need:

- **Liquidation engine** — auction undercollateralized safes
- **Multi-collateral support** — currently WBTC only, need LBTC/tBTC/SolvBTC gates
- **Global settlement** — emergency shutdown mechanism
- **Surplus/deficit auctions** — handle protocol surplus and bad debt
- **Governance** — parameter adjustment, collateral onboarding
- **Frontend** — web interface for safe management
- **Ekubo pool initialization** — actual Grit/USDC liquidity pool with the hook registered
