# Grinta

A PID-controlled stablecoin protocol on Starknet. Grinta uses a HAI-style redemption price mechanism with an Ekubo DEX hook that automatically updates rates on every swap — no keepers needed.

## Architecture

```
                    ┌─────────────┐
                    │  Ekubo DEX  │
                    │  (Grit/USDC │
                    │    pool)    │
                    └──────┬──────┘
                           │ after_swap
                    ┌──────▼──────┐
                    │ GrintaHook  │──── reads TWAP from ────► Ekubo Oracle
                    │ (Extension) │
                    └──┬───────┬──┘
           market price│       │collateral price
                    ┌──▼───┐   │
                    │ PID  │   │
                    │Ctrl  │   │
                    └──┬───┘   │
            new rate   │       │
                    ┌──▼───────▼──┐
                    │  SAFEEngine  │ ◄── core ledger + Grit ERC20
                    │              │     + redemption price/rate
                    └──────┬──────┘
                           │
              ┌────────────┼────────────┐
              │            │            │
       ┌──────▼──┐  ┌──────▼──┐  ┌─────▼─────┐
       │Collateral│  │  Safe   │  │   Grit    │
       │  Join    │  │ Manager │  │  (ERC20)  │
       │ (WBTC)  │  │         │  │           │
       └─────────┘  └─────────┘  └───────────┘
```

**Key insight:** GrintaHook *is* the Ekubo extension. Every Grit/USDC swap automatically triggers a TWAP read, PID computation, and rate update. No off-chain keepers, no cron jobs — the protocol self-corrects through trading activity.

## Contracts

| Contract | Lines | Description |
|---|---|---|
| **SAFEEngine** | 461 | Core ledger, Grit ERC20 token, HAI-style redemption price/rate mechanism |
| **CollateralJoin** | 158 | WBTC custody, converts between 8-decimal assets and 18-decimal internal units |
| **PIDController** | 374 | HAI-style proportional-integral controller with leaky integrator and noise barrier |
| **GrintaHook** | 245 | Ekubo `after_swap` extension — reads TWAPs, computes PID rate, pushes to SAFEEngine |
| **SafeManager** | 190 | User/agent-facing: open, deposit, borrow, repay, delegate — single-call `open_and_borrow` |

Total: ~1,812 lines (excluding tests and interfaces)

## Sepolia Deployment (V2 — Keeper-less with Ekubo Hook)

**Status**: Live and operational | **Deployed**: March 3, 2025

### Core Protocol Contracts

| Contract | Address | Role |
|---|---|---|
| **GrintaHook** | `0x06a78d63d252cbb3192c64f9fdd85598a716992edaf693437fe466d9861c7ca5` | Ekubo extension — keeper-less price/rate updates on every swap |
| **SafeManager** | `0x07aec9c3d46853af2a2c924b1cdd839ffe38ffdc5d174c44d34c537d24d8aae8` | User-facing SAFE management interface |
| **SAFEEngine** | `0x02f4f6c374c20ddf3ea5e59cc70f2ad4c2bfb5786ca6c146266f89f7da575421` | Core ledger + Grit ERC20 + redemption price mechanism |
| **CollateralJoin** | `0x0362bd21cf4fd2ada59945e27c0fe10802dde0061e6aeeae0dd81b80669b4687` | WBTC custody (8→18 decimal conversion) |
| **PIDController** | `0x0694c76e4817aea5ae3858e99048ceb844679ed479d075ab9e0cd083fc9aee6a` | HAI-style PI controller for redemption rate |

### Test/Mock Contracts

| Contract | Address | Decimals |
|---|---|---|
| MockWBTC | `0x04ab76b407a4967de3683d387c598188d436d22d51416e8c8783156625874e20` | 8 |
| MockUSDC | `0x04e5d8c61fc059bb689169b217c37016e593a894042909e2b71b6c4f7b30fcdf` | 6 |
| MockEkuboOracle | `0x066822a5e3ebd7f15b9b279b1dfabfe5c1f808010167cda027a22316b1999071` | — |

### External Dependencies

| Service | Address | Purpose |
|---|---|---|
| Ekubo Core | `0x0444a09d96389aa7148f1aada508e30b71299ffe650d9c97fdaae38cb9a23384` | DEX protocol + hook execution |
| Ekubo Oracle Extension | `0x003ccf3ee24638dd5f1a51ceb783e120695f53893f6fd947cc2dcabb3f86dc65` | TWAP price feeds |

### Pool Configuration (GRIT/USDC)

- **Token0**: GRIT (SAFEEngine) — 18 decimals
- **Token1**: MockUSDC — 6 decimals
- **Hook**: GrintaHook (registered for `after_swap` callbacks)
- **Initial Liquidity**: 10,000 GRIT + 10,000 MockUSDC (pending sncast execution)
- **Status**: Pool initialized, liquidity provision in progress

## How It Works

### Redemption Price Mechanism

Grinta's stablecoin (Grit) targets $1 through a floating redemption price, not a hard peg:

1. **Redemption price** starts at $1 and drifts over time based on the **redemption rate**
2. The **PID controller** observes the market price vs redemption price deviation
3. If Grit trades below target → rate increases → redemption price rises → incentivizes repaying debt → supply contracts
4. If Grit trades above target → rate decreases → redemption price falls → incentivizes borrowing → supply expands

### The Ekubo Hook

Instead of relying on keepers to call `updateRate()`, GrintaHook registers as an Ekubo extension on the Grit/USDC pool. Every swap triggers:

1. Read BTC/USDC TWAP from Ekubo Oracle → update collateral price
2. Read Grit/USDC TWAP from Ekubo Oracle → get market price
3. Feed market price + redemption price into PID controller → get new rate
4. Push new collateral price and redemption rate to SAFEEngine

A manual `update()` function is also available as a fallback when there's no trading activity.

### Agent Delegation

SafeManager supports delegating safe operations to agent addresses:

```cairo
// Owner delegates to an agent
safe_manager.authorize_agent(safe_id, agent_address);

// Agent can now deposit, borrow, repay on behalf of owner
safe_manager.deposit(safe_id, amount);  // called by agent
```

## Building

```bash
# Build contracts
scarb build

# Run tests (20/20 passing)
snforge test

# Build deployment scripts
cd scripts && scarb build
```

## Deploying & Liquidity Provision

### Initial Deployment

```bash
cd scripts
sncast --profile sepolia script run deploy_sepolia --package grinta_scripts
```

This deploys all core contracts, sets permissions, and initializes the GRIT/USDC pool on Ekubo with GrintaHook as extension.

### Adding Liquidity (Post-Deployment)

After deployment, add liquidity to the GRIT/USDC pool:

```bash
cd scripts
sncast --profile sepolia script run add_liquidity_sepolia --package grinta_scripts
```

This script:
1. Approves 10,000 GRIT to Ekubo Core
2. Approves 10,000 MockUSDC to Ekubo Core
3. Calls Ekubo's `update_position` to mint liquidity with 1:1 ratio

Once liquidity is added, the pool becomes active and every swap triggers the GrintaHook, enabling keeper-less protocol operation.

## PID Controller Parameters

| Parameter | Value | Description |
|---|---|---|
| Kp | 1.0 (WAD) | Proportional gain |
| Ki | 0.5 (WAD) | Integral gain |
| Noise barrier | 0.95 (WAD) | Min deviation before PID acts (5%) |
| Integral period | 3600s | Cooldown between rate updates |
| Leak | ~99.9997%/s | Integral decay rate (from HAI) |
| Debt ceiling | 1,000,000 Grit | Max system-wide debt |
| Liquidation ratio | 150% | Min collateral ratio |
| Initial BTC price | $60,000 | Set at deployment |

## Dependencies

- Cairo 2.14.0 / Starknet
- OpenZeppelin Contracts (token, access) 1.0.0
- snforge 0.53.0 (testing)
- sncast 0.53.0 (deployment)

## License

MIT
