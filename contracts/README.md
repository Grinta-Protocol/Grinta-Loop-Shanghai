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

## Sepolia Deployment

| Contract | Address |
|---|---|
| MockWBTC | [`0x07c7d91d...f605c9`](https://sepolia.starkscan.co/contract/0x07c7d91d5cc1f88b40f8632c8b1bf96bdc69e22dabff8114ac6c13f5cbf605c9) |
| SAFEEngine | [`0x041649a2...038c15`](https://sepolia.starkscan.co/contract/0x041649a23c3bc0d960b0de649fe96d1380199153c2b9fbb2c2b3b81792038c15) |
| CollateralJoin | [`0x008657c5...24284f`](https://sepolia.starkscan.co/contract/0x008657c5bb4611a581adb20c7de2008f830df4c757dab169a3ee931aed24284f) |
| PIDController | [`0x01cae0b0...6eec5`](https://sepolia.starkscan.co/contract/0x01cae0b0de880d26d09a52a4c6e33dcd189fa1bcf40986103d3c3eb46a66eec5) |
| GrintaHook | [`0x07a17830...d9b14`](https://sepolia.starkscan.co/contract/0x07a17830f3aecf5a22ecfea9f3f88cb6eafd9abc425505b167755e21246d9b14) |
| SafeManager | [`0x002a36bb...11b9d`](https://sepolia.starkscan.co/contract/0x002a36bbb5d7f8694f2f6ab9b376a691fe277f00d5977cae989452ca84011b9d) |

External dependencies on Sepolia:
- Ekubo Oracle Extension: `0x003ccf3ee24638dd5f1a51ceb783e120695f53893f6fd947cc2dcabb3f86dc65`
- USDC (bridged): `0x053b40a647cedfca6ca84f542a0fe36736031905a9639a7f19a3c1e66bfd5080`

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

## Deploying

1. Set your deployer address in `scripts/src/addresses.cairo`
2. Configure sncast account: `sncast account create`
3. Run:
```bash
cd scripts
sncast --profile sepolia script run deploy_sepolia --package grinta_scripts
```

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
