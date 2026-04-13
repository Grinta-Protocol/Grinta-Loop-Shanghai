# Grinta

A PID-controlled stablecoin protocol on Starknet. Grinta uses a HAI-style redemption price mechanism with an Ekubo DEX hook that automatically updates rates on every swap — only BTC/USD oracle pushes are manual.

## Architecture

```
                     ┌─────────────┐
                     │  Ekubo DEX  │
                     │  (Grit/USDC │
                     │    pool)    │
                     └──────┬──────┘
                            │ after_swap
                     ┌──────▼──────┐       ┌───────────────┐
                     │ GrintaHook  │◄──────│ OracleRelayer │◄─── keeper pushes
                     │ (Extension) │       │ (BTC/USD x128)│     BTC/USD from
                     └──┬───────┬──┘       └───────────────┘     CoinGecko etc.
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

**Key insight:** GrintaHook *is* the Ekubo extension. Every Grit/USDC swap automatically computes the GRIT price from swap amounts, reads BTC/USD from OracleRelayer, runs the PID, and updates the rate. The only manual input is pushing BTC/USD to OracleRelayer — everything else self-corrects through trading activity.

## Contracts (9 core + 2 mocks)

| Contract | Lines | Role |
|---|---|---|
| SAFEEngine | 565 | Core ledger, Grit ERC20, redemption price/rate, confiscation |
| CollateralJoin | 188 | WBTC custody, decimal conversion, seizure |
| PIDController | 382 | HAI-style PI with leaky integrator and noise barrier |
| GrintaHook | 376 | Ekubo `after_swap` extension — price discovery + PID orchestration |
| SafeManager | 220 | User/agent-facing: open, deposit, borrow, repay, delegate |
| OracleRelayer | 95 | BTC/USD price feed (WAD + x128) |
| LiquidationEngine | 246 | Permissionless liquidation, health check, auction kickoff |
| CollateralAuctionHouse | 316 | Dutch auction for seized collateral |
| AccountingEngine | 152 | Debt/surplus tracking, GRIT burn settlement |

Total: ~2,540 lines. Full mechanism design and parameters in [DESIGN.md](./DESIGN.md).

## Sepolia Deployment (V9 — Current)

All V9 addresses are in [`deployed_v9.json`](./deployed_v9.json).

Pool: GRIT(token0)/USDC(token1), fee=0, tick_spacing=1000, extension=GrintaHook
Init tick: **-27,631,000** (negative — see [INVARIANTS.md](./INVARIANTS.md) for why)
Liquidity bounds: [-27,726,000, -27,526,000] (~$0.90 to ~$1.10)

Verified on-chain: market price ~$0.9995, full liquidation cycle (open → crash → liquidate → auction → settle).

External dependencies (Sepolia):
- Ekubo Core: `0x0444a09d96389aa7148f1aada508e30b71299ffe650d9c97fdaae38cb9a23384`
- Ekubo Router V3: `0x0045f933adf0607292468ad1c1dedaa74d5ad166392590e72676a34d01d7b763`
- Ekubo Positions: `0x06a2aee84bb0ed5dded4384ddd0e40e9c1372b818668375ab8e3ec08807417e5`

## Building

```bash
scarb build          # Build contracts
snforge test         # Run tests (70/70 passing)
```

## Deploying

```bash
chmod +x deploy_sepolia.sh
./deploy_sepolia.sh  # Declares, deploys, wires permissions, registers hook, creates pool
```

## Documentation

| File | Contents |
|---|---|
| [DESIGN.md](./DESIGN.md) | Full mechanism design, math, PID parameters, liquidation system |
| [INVARIANTS.md](./INVARIANTS.md) | Critical invariants and failure modes discovered during deployment |
| [ORACLE_DESIGN.md](./ORACLE_DESIGN.md) | Oracle architecture, price feeds, future Ekubo TWAP research |
| [PROTOCOL_STATUS.md](./PROTOCOL_STATUS.md) | What's built, what's next, roadmap |

## Dependencies

- Cairo 2.14.0 / Starknet
- OpenZeppelin Contracts (token, access) 1.0.0
- snforge 0.53.0 (testing)
- sncast 0.53.0 (deployment)

## License

MIT
