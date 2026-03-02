---
skill: grinta-cdp
version: 0.1.0
description: Manage Grinta CDP positions — open SAFEs, borrow GRIT stablecoin, monitor health
author: Grinta Protocol
tags: [starknet, cdp, stablecoin, defi, pid-controller]
tools: [grinta-mcp-server]
---

# Grinta CDP — Agent Skill

## What is Grinta?

Grinta is a PID-controller CDP (Collateralized Debt Position) stablecoin on Starknet. Users deposit WBTC collateral into SAFEs and borrow GRIT, a USD-pegged stablecoin whose peg is maintained by a PI controller — not by governance or fixed interest rates.

Key differentiators:
- **Floating peg**: GRIT's target price (redemption price) drifts over time based on market conditions
- **No keepers**: Price and rate updates happen automatically via an Ekubo DEX hook on every swap
- **Agent-native**: Built-in delegation system lets AI agents manage SAFEs on behalf of owners
- **PI controller**: A proportional-integral controller adjusts the redemption rate to push the market price toward the redemption price

## Core Concepts

### SAFE
A vault that holds WBTC collateral and tracks GRIT debt. Each SAFE has a unique numeric ID (u64). The owner can authorize agents to operate on their SAFE.

### GRIT
The stablecoin token (ERC-20, 18 decimals). Minted when borrowing, burned when repaying. Target price starts at $1.00 and drifts based on the PI controller.

### Redemption Price
The protocol's internal target price for GRIT, denominated in USD. Stored in RAY precision (27 decimals). Starts at 1e27 ($1.00) and compounds continuously based on the redemption rate. Updated lazily — the stored value may be stale, but `get_redemption_price()` computes the current value.

### Redemption Rate
A per-second multiplier applied to the redemption price. Stored in RAY precision. When rate > 1e27 (RAY), the target price increases (incentivizes holding GRIT). When rate < 1e27, the target price decreases (incentivizes selling GRIT). Set by the PID controller.

### Health Ratio & Liquidation
Each SAFE must maintain collateral value >= debt value * liquidation_ratio. The `Health` struct provides:
- `collateral_value`: USD value of collateral (WAD)
- `debt`: Outstanding GRIT debt (WAD)
- `ltv`: Loan-to-value ratio (WAD, where 0.5e18 = 50%)
- `liquidation_price`: BTC price at which the SAFE becomes liquidatable (WAD)

### WAD and RAY Math
- **WAD** = 1e18 (18 decimals) — used for token amounts, prices, ratios
- **RAY** = 1e27 (27 decimals) — used for redemption price and rate (higher precision for compounding)
- `wmul(a, b)` = a * b / WAD (multiply two WAD values)
- `wdiv(a, b)` = a * WAD / b (divide two WAD values)
- `rmul(a, b)` = a * b / RAY (multiply two RAY values)

### WBTC Decimal Conversion
WBTC has 8 decimals on-chain. The CollateralJoin contract converts between 8-decimal WBTC amounts and 18-decimal internal (WAD) amounts. When depositing via the SafeManager, pass the raw WBTC amount (8 decimals). The `open_and_borrow` function accepts `collateral_amount` in WBTC's native 8 decimals.

### Agent Delegation
SAFE owners can authorize agent addresses to perform operations (deposit, withdraw, borrow, repay, close) on their SAFEs. Only the owner can authorize/revoke agents. Agents cannot authorize other agents.

## Contract Addresses

> **Network**: Starknet Sepolia

```
SAFE_MANAGER:     0x002a36bbb5d7f8694f2f6ab9b376a691fe277f00d5977cae989452ca84011b9d
SAFE_ENGINE:      0x041649a23c3bc0d960b0de649fe96d1380199153c2b9fbb2c2b3b81792038c15
COLLATERAL_JOIN:  0x008657c5bb4611a581adb20c7de2008f830df4c757dab169a3ee931aed24284f
PID_CONTROLLER:   0x01cae0b0de880d26d09a52a4c6e33dcd189fa1bcf40986103d3c3eb46a66eec5
GRINTA_HOOK:      0x07a17830f3aecf5a22ecfea9f3f88cb6eafd9abc425505b167755e21246d9b14
WBTC (Mock):      0x07c7d91d5cc1f88b40f8632c8b1bf96bdc69e22dabff8114ac6c13f5cbf605c9
```

## SafeManager Functions (User/Agent Entry Point)

All write operations go through SafeManager. It handles authorization, calls SAFEEngine and CollateralJoin internally.

### Write Functions

```
open_safe() -> u64
```
Opens a new empty SAFE. Returns the safe_id. Caller becomes the owner.

```
open_and_borrow(collateral_amount: u256, borrow_amount: u256) -> u64
```
Opens a SAFE, deposits WBTC collateral, and borrows GRIT in one transaction.
- `collateral_amount`: WBTC in 8 decimals (e.g., 50000000 = 0.5 BTC)
- `borrow_amount`: GRIT in WAD (e.g., 10000e18 = 10,000 GRIT)
- Requires prior ERC20 approval of WBTC to CollateralJoin
- Returns the new safe_id

```
deposit(safe_id: u64, amount: u256)
```
Deposits WBTC collateral into an existing SAFE.
- `amount`: WBTC in 8 decimals
- Requires ERC20 approval of WBTC to CollateralJoin

```
withdraw(safe_id: u64, amount: u256)
```
Withdraws WBTC collateral from a SAFE. Reverts if it would make the SAFE unhealthy.
- `amount`: internal WAD amount (not 8 decimals)

```
borrow(safe_id: u64, amount: u256)
```
Borrows additional GRIT against existing collateral. Mints GRIT to the SAFE owner.
- `amount`: GRIT in WAD

```
repay(safe_id: u64, amount: u256)
```
Repays GRIT debt. Burns GRIT from the SAFE owner. If amount > debt, only repays the debt.
- `amount`: GRIT in WAD

```
close_safe(safe_id: u64)
```
Closes a SAFE. Requires zero debt. Returns any remaining collateral to caller.

```
authorize_agent(safe_id: u64, agent: ContractAddress)
```
Grants an agent address permission to operate on the SAFE. Only the owner can call this.

```
revoke_agent(safe_id: u64, agent: ContractAddress)
```
Revokes an agent's permission. Only the owner can call this.

### Read Functions

```
get_position_health(safe_id: u64) -> Health
```
Returns the SAFE's health metrics: collateral_value, debt, ltv, liquidation_price (all WAD).

```
get_max_borrow(safe_id: u64) -> u256
```
Returns the maximum additional GRIT that can be borrowed without breaching the liquidation ratio.

```
get_safe_owner(safe_id: u64) -> ContractAddress
```
Returns the owner address of a SAFE.

```
is_authorized(safe_id: u64, agent: ContractAddress) -> bool
```
Checks if an agent is authorized to operate on a SAFE.

## SAFEEngine View Functions (Direct Reads)

These can be called directly on the SAFEEngine contract for system-level data.

```
get_safe(safe_id: u64) -> Safe { collateral: u256, debt: u256 }
get_safe_count() -> u64
get_safe_owner(safe_id: u64) -> ContractAddress
get_safe_health(safe_id: u64) -> Health
get_system_health() -> Health
get_collateral_price() -> u256          // BTC/USD in WAD
get_redemption_price() -> u256          // Target GRIT price in RAY (computes current)
get_redemption_rate() -> u256           // Per-second rate in RAY
get_total_debt() -> u256                // Total GRIT supply in WAD
get_total_collateral() -> u256          // Total BTC collateral in WAD
get_debt_ceiling() -> u256              // Max total debt in WAD
get_liquidation_ratio() -> u256         // e.g. 1.5e18 = 150%
get_grit_balance(account: ContractAddress) -> u256  // GRIT balance in WAD
```

## Workflows

### 1. Open a Position

```
Step 1: Approve WBTC spending
  → WBTC.approve(COLLATERAL_JOIN, collateral_amount)

Step 2: Open SAFE and borrow
  → SafeManager.open_and_borrow(collateral_amount, borrow_amount)
  → Returns safe_id

Step 3: Verify health
  → SafeManager.get_position_health(safe_id)
  → Ensure ltv is well below liquidation threshold
```

**Example**: Deposit 0.5 BTC, borrow 10,000 GRIT
- collateral_amount = 50_000_000 (0.5 BTC in 8 decimals)
- borrow_amount = 10_000_000_000_000_000_000_000 (10,000 in WAD)
- At BTC=$60,000: collateral_value = $30,000, ltv = 33%, healthy at 150% ratio

### 2. Monitor and Manage Health

```
Step 1: Check current health
  → SafeManager.get_position_health(safe_id)

Step 2: If ltv is rising toward danger zone (approaching 1/liquidation_ratio):
  Option A — Deposit more collateral:
    → WBTC.approve(COLLATERAL_JOIN, amount)
    → SafeManager.deposit(safe_id, amount)
  Option B — Repay some debt:
    → SafeManager.repay(safe_id, amount)

Step 3: If ltv is very low (overcollateralized), optionally:
  → SafeManager.borrow(safe_id, additional_amount)  // borrow more
  → SafeManager.withdraw(safe_id, amount)            // withdraw excess collateral
```

### 3. Close a Position

```
Step 1: Repay all debt
  → SafeManager.repay(safe_id, type(u256).max)  // repays up to full debt

Step 2: Close SAFE (returns collateral)
  → SafeManager.close_safe(safe_id)
```

### 4. Delegate to an Agent

```
Step 1: Owner authorizes agent
  → SafeManager.authorize_agent(safe_id, agent_address)

Step 2: Agent can now call deposit/withdraw/borrow/repay/close on the SAFE

Step 3: Owner revokes when done
  → SafeManager.revoke_agent(safe_id, agent_address)
```

## Agent Strategies

### Health Management Agent

Monitor SAFEs and automatically rebalance to maintain a target LTV:

```
target_ltv = 0.40  (40%)
danger_ltv = 0.60  (60%)
critical_ltv = 0.62 (62%, approaching 66.7% liquidation at 150% ratio)

Loop:
  health = get_position_health(safe_id)
  current_ltv = health.ltv / 1e18

  if current_ltv > critical_ltv:
    // Emergency: repay debt immediately
    repay_amount = calculate_repay_to_target(health, target_ltv)
    repay(safe_id, repay_amount)

  elif current_ltv > danger_ltv:
    // Warning: deposit more collateral or partially repay
    deposit_amount = calculate_deposit_to_target(health, target_ltv)
    deposit(safe_id, deposit_amount)

  elif current_ltv < 0.25:
    // Very overcollateralized: opportunity to borrow more
    max_additional = get_max_borrow(safe_id)
    borrow(safe_id, max_additional * 0.5)  // borrow conservatively
```

### Peg Arbitrage Agent

Profit from deviations between market price and redemption price:

```
market_price = GrintaHook.get_market_price()
redemption_price = SAFEEngine.get_redemption_price() / 1e9  // RAY to WAD

if market_price > redemption_price * 1.02:
  // GRIT is trading above target: mint and sell
  // Borrow GRIT → sell on Ekubo for USDC → profit
  borrow(safe_id, amount)
  // swap GRIT → USDC on Ekubo

elif market_price < redemption_price * 0.98:
  // GRIT is trading below target: buy and repay
  // Buy cheap GRIT on Ekubo → repay debt → profit from rate adjustment
  // swap USDC → GRIT on Ekubo
  repay(safe_id, amount)
```

### Leverage Loop Agent

Create leveraged BTC exposure:

```
// Start: deposit 1 BTC, borrow GRIT, swap for more BTC, repeat
for i in 0..max_loops:
  max_borrow = get_max_borrow(safe_id)
  safe_borrow = max_borrow * 0.7  // stay well within limits
  if safe_borrow < min_threshold:
    break
  borrow(safe_id, safe_borrow)
  // swap GRIT → WBTC on Ekubo
  deposit(safe_id, received_wbtc)

// Result: 2-3x leveraged BTC exposure
// Risk: liquidation if BTC drops significantly
```

## Error Messages

| Error | Contract | Cause | Fix |
|-------|----------|-------|-----|
| `MGR: not authorized` | SafeManager | Caller is not the SAFE owner or authorized agent | Use the owner account or get authorized via `authorize_agent` |
| `MGR: only owner can delegate` | SafeManager | Non-owner tried to authorize/revoke an agent | Only the SAFE owner can manage agent permissions |
| `MGR: only owner can revoke` | SafeManager | Non-owner tried to revoke an agent | Only the SAFE owner can revoke |
| `MGR: safe has debt` | SafeManager | Tried to close a SAFE with outstanding debt | Repay all debt first with `repay(safe_id, u256_max)` |
| `SAFE: not manager` | SAFEEngine | Direct call to a manager-only function | Call through SafeManager, not SAFEEngine directly |
| `SAFE: not admin` | SAFEEngine | Caller is not the admin | Admin-only function |
| `SAFE: not hook` | SAFEEngine | Caller is not the GrintaHook | Only GrintaHook can update prices/rates |
| `SAFE: insufficient collateral` | SAFEEngine | Withdrawing more collateral than available | Check `get_safe().collateral` first |
| `SAFE: would be undercollateral` | SAFEEngine | Withdrawal would breach liquidation ratio | Withdraw less or repay debt first |
| `SAFE: undercollateralized` | SAFEEngine | Borrow would breach liquidation ratio | Borrow less or deposit more collateral first |
| `SAFE: debt ceiling exceeded` | SAFEEngine | System-wide debt limit reached | Wait for capacity or repay existing debt |
| `SAFE: insufficient grit` | SAFEEngine | Trying to burn more GRIT than the account holds | Ensure sufficient GRIT balance before repaying |
| `GRIT: insufficient balance` | SAFEEngine | ERC20 transfer with insufficient balance | Check balance with `get_grit_balance()` |
| `GRIT: insufficient allowance` | SAFEEngine | ERC20 transferFrom without approval | Call `approve()` first |
| `JOIN: not manager` | CollateralJoin | Direct call to a manager-only function | Call through SafeManager |
| `JOIN: zero amount` | CollateralJoin | Deposit/withdraw of zero or dust amount | Use a meaningful amount |
| `JOIN: transfer failed` | CollateralJoin | WBTC transfer failed | Check WBTC balance and approval to CollateralJoin |
| `JOIN: insufficient assets` | CollateralJoin | Contract doesn't hold enough WBTC | Indicates a system error |

## Important Notes

### Decimal Handling
- **WBTC amounts for deposit**: Always in 8 decimals (native WBTC). Example: 0.5 BTC = 50_000_000
- **GRIT amounts (borrow/repay)**: Always in WAD (18 decimals). Example: 100 GRIT = 100_000_000_000_000_000_000
- **Internal collateral**: Stored in WAD (18 decimals) after conversion by CollateralJoin
- **Redemption price**: RAY (27 decimals). To convert to USD: divide by 1e27
- **Redemption rate**: RAY (27 decimals). A rate of 1e27 means no change. Rate > 1e27 means target price increasing
- **LTV and ratios**: WAD (18 decimals). An LTV of 0.5e18 means 50%

### Lazy Redemption Price Updates
The redemption price stored on-chain may be stale. The `get_redemption_price()` view function computes the current value by applying `rate^elapsed_time` to the stored price. The price is updated on-chain only during `borrow()`, `repay()`, and `update_redemption_rate()` calls. For accurate calculations, always use `get_redemption_price()` rather than reading storage directly.

### Transaction Ordering for Deposits
When depositing WBTC, you must approve the CollateralJoin contract (not SafeManager) to spend your WBTC. The flow is:
1. `WBTC.approve(COLLATERAL_JOIN_ADDRESS, amount)`
2. `SafeManager.deposit(safe_id, amount)` or `SafeManager.open_and_borrow(amount, borrow_amount)`

These can be batched in a single multicall transaction on Starknet.

### PoC Caveats
This is a proof-of-concept. The following features are not yet implemented:
- **Liquidation mechanism**: No liquidator role or auction system yet
- **Stability fee**: No interest accrual on debt positions
- **Multi-collateral**: Only WBTC is supported
- **Governance**: Admin is a single address, not a multisig or DAO
- **Formal verification**: Contracts have not been audited
- **Mainnet deployment**: Only targeting Sepolia testnet initially
