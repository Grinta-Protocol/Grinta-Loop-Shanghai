# HAI Protocol on Starknet — Cairo Implementation Plan

## Context

**What:** Port the HAI protocol (a GEB framework fork) from Solidity/Optimism to Cairo/Starknet, using BTC yield-bearing assets (LBTC, WBTC, tBTC, SolvBTC) as collateral instead of ETH-based assets.

**Why:** HAI/RAI proved that PID-controller stablecoins work mechanically — they survived every major ETH crash and never experienced a death spiral. The BTC yield thesis is even stronger on Starknet: LBTC (Lombard's liquid-staked BTC via Babylon) earns ~1% APY, eliminating the opportunity cost problem that killed RAI. Starknet has $130M+ in bridged BTC assets and native oracle support via Pragma. No GEB-style CDP protocol exists on Starknet yet (Opus is the closest reference but uses a different design).

**Outcome:** A fully functional, multi-collateral, PID-controlled floating stablecoin protocol on Starknet with BTC yield-bearing assets as primary collateral.

---

## Part 1: Architecture Overview — HAI Contracts Mapped to Cairo

### Original HAI Core Contracts (Solidity) → Cairo Equivalents

The HAI protocol on Optimism consists of **~80 Solidity contracts** organized into 11 categories. Below is the complete mapping with dependencies.

### 1.1 Core Protocol Contracts (11 contracts — the heart of the system)

| # | Solidity Contract | Cairo Module | Role |
|---|---|---|---|
| 1 | `SAFEEngine.sol` | `core/safe_engine.cairo` | Central accounting ledger. Stores all SAFE states, coin balances, collateral amounts, debt. Zero external dependencies. |
| 2 | `OracleRelayer.sol` | `core/oracle_relayer.cairo` | Bridges oracles → SAFEEngine. Stores `redemption_price` and `redemption_rate`. Computes `safety_price` and `liquidation_price` per collateral. |
| 3 | `TaxCollector.sol` | `core/tax_collector.cairo` | Collects per-collateral stability fees. Distributes to AccountingEngine and StabilityFeeTreasury. |
| 4 | `LiquidationEngine.sol` | `core/liquidation_engine.cairo` | Checks SAFE health, triggers collateral auctions when undercollateralized. |
| 5 | `AccountingEngine.sol` | `core/accounting_engine.cairo` | System surplus/debt manager. Cancels matching surplus and debt. Triggers debt/surplus auctions. |
| 6 | `StabilityFeeTreasury.sol` | `core/stability_fee_treasury.cairo` | Funds keeper operations. Per-address withdrawal allowances. |
| 7 | `PIDController.sol` | `core/pid_controller.cairo` | PI controller with leaky integrator. Computes redemption rate from price error. |
| 8 | `PIDRateSetter.sol` | `core/pid_rate_setter.cairo` | Reads TWAP market price + redemption price, passes error to PIDController, forwards rate to OracleRelayer. |
| 9 | `CollateralAuctionHouse.sol` | `core/collateral_auction_house.cairo` | Fixed-discount collateral auctions for liquidated SAFEs. |
| 10 | `DebtAuctionHouse.sol` | `core/debt_auction_house.cairo` | Mints governance token (KITE equivalent) to cover bad debt. |
| 11 | `SurplusAuctionHouse.sol` | `core/surplus_auction_house.cairo` | Burns governance token using excess stability fees. |

### 1.2 Oracle Contracts (7 contracts)

| # | Solidity Contract | Cairo Module | Role |
|---|---|---|---|
| 12 | `DelayedOracle.sol` | `oracles/delayed_oracle.cairo` | ~1-hour price delay (anti-flash-manipulation). Replaces FSM/OSM. |
| 13 | `DenominatedOracle.sol` | `oracles/denominated_oracle.cairo` | Converts between price denominations (e.g., BTC/USD from BTC/ETH + ETH/USD). |
| 14 | `ChainlinkRelayer.sol` | `oracles/pragma_relayer.cairo` | **Adapted:** Reads from Pragma Oracle instead of Chainlink. |
| 15 | `UniV3Relayer.sol` | `oracles/ekubo_relayer.cairo` | **Adapted:** TWAP from Ekubo DEX instead of Uniswap V3. |
| 16 | `BeefyVeloVaultRelayer.sol` | `oracles/vault_relayer.cairo` | Oracle for yield-bearing vault tokens (for LBTC pricing). |
| 17 | `CurveStableSwapNGRelayer.sol` | *(skip or adapt)* | May not be needed if no Curve-style pool on Starknet. |
| 18 | `PessimisticVeloSingleOracle.sol` | *(skip)* | Velodrome-specific, not applicable. |

### 1.3 Token Contracts (9 contracts)

| # | Solidity Contract | Cairo Module | Role |
|---|---|---|---|
| 19 | `SystemCoin.sol` | `tokens/system_coin.cairo` | The stablecoin itself (HAI equivalent). ERC20. |
| 20 | `ProtocolToken.sol` | `tokens/protocol_token.cairo` | Governance token (KITE equivalent). ERC20Votes. |
| 21 | `StakingToken.sol` | `tokens/staking_token.cairo` | sHAI equivalent — yield-bearing deposit token for Stability Pool. |
| 22 | `StakingManager.sol` | `tokens/staking_manager.cairo` | Manages staking/unstaking and reward distribution. |
| 23 | `RewardPool.sol` | `tokens/reward_pool.cairo` | Distributes rewards to stakers. |
| 24 | `RewardDistributor.sol` | `tokens/reward_distributor.cairo` | Routes rewards from protocol surplus. |
| 25 | `TokenDistributor.sol` | `tokens/token_distributor.cairo` | Initial token distribution (airdrop). |
| 26 | `WrappedToken.sol` | `tokens/wrapped_token.cairo` | Wrapper for yield-bearing BTC assets (like haiVELO but for BTC). |
| 27 | `VeNFTManager.sol` | *(skip)* | veVELO-specific, not applicable for BTC version. |

### 1.4 Proxy & User Interaction Contracts (4 + 7 action contracts)

| # | Solidity Contract | Cairo Module | Role |
|---|---|---|---|
| 28 | `HaiProxy.sol` | `proxies/hai_proxy.cairo` | User proxy for batched operations (open SAFE, deposit, mint). |
| 29 | `HaiProxyFactory.sol` | `proxies/hai_proxy_factory.cairo` | Deploys user proxies. |
| 30 | `HaiSafeManager.sol` | `proxies/safe_manager.cairo` | Manages SAFEs via proxy. Maps SAFE IDs to owners. |
| 31 | `SAFEHandler.sol` | `proxies/safe_handler.cairo` | Minimal contract that owns the actual SAFE in SAFEEngine. |
| 32-38 | `BasicActions.sol`, `CollateralBidActions.sol`, `CommonActions.sol`, `DebtBidActions.sol`, `GlobalSettlementActions.sol`, `RewardedActions.sol`, `SurplusBidActions.sol` | `proxies/actions/*.cairo` | User-facing action libraries for proxy calls. |

### 1.5 Settlement Contracts (3 contracts)

| # | Solidity Contract | Cairo Module | Role |
|---|---|---|---|
| 39 | `GlobalSettlement.sol` | `settlement/global_settlement.cairo` | Emergency shutdown. Freezes oracles, allows redemption at fixed rate. |
| 40 | `PostSettlementSurplusAuctionHouse.sol` | `settlement/post_settlement_auction.cairo` | Handles surplus after shutdown. |
| 41 | `SettlementSurplusAuctioneer.sol` | `settlement/settlement_auctioneer.cairo` | Routes surplus to post-settlement auctions. |

### 1.6 Governance Contracts (2 contracts)

| # | Solidity Contract | Cairo Module | Role |
|---|---|---|---|
| 42 | `HaiGovernor.sol` | `governance/governor.cairo` | OpenZeppelin Governor-based governance. |
| 43 | `HaiDelegatee.sol` | `governance/delegatee.cairo` | Vote delegation. |

### 1.7 Job/Keeper Contracts (4 contracts)

| # | Solidity Contract | Cairo Module | Role |
|---|---|---|---|
| 44 | `Job.sol` | `jobs/job.cairo` | Base contract for keeper-callable functions with reward scaling. |
| 45 | `AccountingJob.sol` | `jobs/accounting_job.cairo` | Keeper job: settle debt, auction surplus. |
| 46 | `LiquidationJob.sol` | `jobs/liquidation_job.cairo` | Keeper job: liquidate undercollateralized SAFEs. |
| 47 | `OracleJob.sol` | `jobs/oracle_job.cairo` | Keeper job: update oracle prices, PID rate. |

### 1.8 Utility Contracts (7 contracts)

| # | Solidity Contract | Cairo Module | Role |
|---|---|---|---|
| 48 | `CoinJoin.sol` | `utils/coin_join.cairo` | Bridge between internal SAFEEngine accounting and ERC20 system coin. |
| 49 | `CollateralJoin.sol` | `utils/collateral_join.cairo` | Bridge between external ERC20 collateral and internal SAFEEngine accounting. |
| 50 | `Authorizable.sol` | `utils/authorizable.cairo` | Access control (auth modifier). |
| 51 | `Disableable.sol` | `utils/disableable.cairo` | Emergency disable pattern. |
| 52 | `Modifiable.sol` | `utils/modifiable.cairo` | Parameter modification pattern. |
| 53 | `ModifiablePerCollateral.sol` | `utils/modifiable_per_collateral.cairo` | Per-collateral parameter modification. |
| 54 | `HaiOwnable2Step.sol` | `utils/ownable.cairo` | Two-step ownership transfer. |

### 1.9 Factory Contracts (12+ contracts)

| # | Solidity Contract | Cairo Module | Role |
|---|---|---|---|
| 55-66 | `*Factory.sol` + `*Child.sol` | `factories/*.cairo` | Factory pattern for deploying per-collateral contracts (auction houses, oracle relayers, collateral joins). |

### 1.10 Library Contracts (4 contracts)

| # | Solidity Contract | Cairo Module | Role |
|---|---|---|---|
| 67 | `Math.sol` | `libraries/math.cairo` | WAD/RAY arithmetic (rpow, wmul, wdiv, rmul, rdiv). |
| 68 | `Assertions.sol` | `libraries/assertions.cairo` | Parameter validation helpers. |
| 69 | `Encoding.sol` | `libraries/encoding.cairo` | Collateral type encoding (bytes32 equivalent). |
| 70 | `FixedPointMathLib.sol` | *(use wadray crate)* | Use existing `lindy-labs/wadray` Cairo library. |

---

## Part 2: Contract Dependency Graph & Deployment Order

### Dependency Layers (deploy bottom-up)

```
Layer 0 (No dependencies — deploy first):
  ├── libraries/math.cairo (use wadray crate)
  ├── utils/authorizable.cairo
  ├── utils/disableable.cairo
  ├── utils/modifiable.cairo
  └── tokens/system_coin.cairo (ERC20)
  └── tokens/protocol_token.cairo (ERC20Votes)

Layer 1 (Depends on Layer 0):
  ├── core/safe_engine.cairo         ← THE foundation
  ├── utils/coin_join.cairo          ← needs SAFEEngine + SystemCoin
  └── utils/collateral_join.cairo    ← needs SAFEEngine

Layer 2 (Depends on SAFEEngine):
  ├── oracles/pragma_relayer.cairo   ← reads Pragma, no protocol deps
  ├── oracles/delayed_oracle.cairo   ← wraps pragma_relayer
  ├── oracles/denominated_oracle.cairo
  ├── oracles/ekubo_relayer.cairo    ← TWAP from Ekubo DEX
  └── oracles/vault_relayer.cairo    ← for LBTC pricing

Layer 3 (Depends on SAFEEngine + Oracles):
  ├── core/oracle_relayer.cairo      ← reads oracles, writes to SAFEEngine
  ├── core/tax_collector.cairo       ← reads/writes SAFEEngine
  └── core/pid_controller.cairo      ← pure math, no storage deps

Layer 4 (Depends on Layer 3):
  ├── core/pid_rate_setter.cairo     ← reads TWAP + oracle_relayer, calls pid_controller
  ├── core/accounting_engine.cairo   ← reads SAFEEngine
  ├── core/stability_fee_treasury.cairo ← reads SAFEEngine
  └── core/collateral_auction_house.cairo ← reads SAFEEngine

Layer 5 (Depends on Layer 4):
  ├── core/liquidation_engine.cairo  ← reads SAFEEngine + oracle_relayer, creates auctions
  ├── core/debt_auction_house.cairo  ← mints protocol_token
  ├── core/surplus_auction_house.cairo ← burns protocol_token
  └── tokens/staking_manager.cairo   ← staking for governance token

Layer 6 (Depends on Layer 5):
  ├── proxies/safe_manager.cairo
  ├── proxies/actions/*.cairo
  ├── jobs/*.cairo (keeper infrastructure)
  └── settlement/global_settlement.cairo

Layer 7 (Optional / Post-launch):
  ├── governance/governor.cairo
  ├── tokens/token_distributor.cairo
  └── factories/*.cairo
```

### Key Inter-Contract Call Graph

```
User → HaiProxy → SafeManager → SAFEEngine
                                    ↑
OracleJob → DelayedOracle → PragmaRelayer → [Pragma Oracle]
         → OracleRelayer → SAFEEngine (writes safety/liquidation prices)
         → PIDRateSetter → PIDController → OracleRelayer (writes redemption rate)
         → TaxCollector → SAFEEngine + AccountingEngine + StabilityFeeTreasury

LiquidationJob → LiquidationEngine → SAFEEngine (reads)
                                    → CollateralAuctionHouse (creates auction)

AccountingJob → AccountingEngine → SAFEEngine (settle debt)
                                  → DebtAuctionHouse (mint gov token)
                                  → SurplusAuctionHouse (burn gov token)
```

---

## Part 3: BTC Collateral Configuration for Starknet

### Available BTC Assets on Starknet (as of 2026)

| Asset | Type | Yield | Bridge | TVL on Starknet | Priority |
|---|---|---|---|---|---|
| **LBTC** (Lombard) | Yield-bearing (Babylon staking) | ~1% APY | LayerSwap | $22.4M | **Primary** |
| **WBTC** | Non-yield | 0% | Atomiq, LayerSwap | $43.3M | **Primary** |
| **tBTC** (Threshold) | Trust-minimized | 0% | Garden Finance | $12.0M | Secondary |
| **SolvBTC** | Yield-bearing | Variable | Solv | $122.4M | Secondary |

### Recommended Collateral Parameters (Initial)

| Collateral | Min CR | Stability Fee | Liquidation Penalty | Debt Ceiling |
|---|---|---|---|---|
| LBTC | 150% | 1.5% | 13% | 500K system coins |
| WBTC | 150% | 2.0% | 13% | 500K system coins |
| tBTC | 160% | 2.5% | 15% | 200K system coins |
| SolvBTC | 165% | 3.0% | 15% | 200K system coins |

### Oracle Strategy

- **Primary:** Pragma Oracle for BTC/USD price feeds (native Starknet oracle)
- **TWAP:** Ekubo DEX for system coin market price (replaces UniV3 TWAP)
- **Delayed Oracle:** 1-hour delay on all collateral price feeds (anti-manipulation)
- **Denominated Oracle:** For LBTC, compose LBTC/BTC ratio + BTC/USD feed

---

## Part 4: Cairo-Specific Technical Considerations

### Key Solidity → Cairo Differences

| Solidity Pattern | Cairo Equivalent |
|---|---|
| `mapping(bytes32 => ...)` | `Map<felt252, ...>` in storage |
| `uint256` WAD/RAY math | `wadray` crate (lindy-labs) — `Wad`/`Ray` types with 18/27 decimals |
| `modifier auth` | OpenZeppelin `AccessControl` component or custom `Authorizable` component |
| `ERC20` | OpenZeppelin Cairo `ERC20Component` |
| `msg.sender` | `get_caller_address()` |
| Proxy/delegate call | Starknet native upgradeable contracts (`replace_class_syscall`) |
| `block.timestamp` | `get_block_timestamp()` |
| `abi.encodePacked` | `poseidon_hash_span` or manual felt252 encoding |
| Factory pattern (CREATE2) | `deploy_syscall` with salt |
| `rpow(base, exp, mod)` | Custom implementation using `wadray` `Ray` type |

### Key Dependencies (Scarb.toml)

```toml
[dependencies]
starknet = "2.11.4"
openzeppelin = { git = "https://github.com/OpenZeppelin/cairo-contracts" }
wadray = { git = "https://github.com/lindy-labs/wadray" }

[dev-dependencies]
snforge_std = "0.44.0"
```

### Reference Implementation: Opus Protocol

Opus (lindy-labs/opus_contracts) is the closest existing Cairo CDP protocol. Key mappings:
- Opus `Shrine` ≈ HAI `SAFEEngine` (central accounting)
- Opus `Seer` ≈ HAI `OracleRelayer` (oracle management)
- Opus `Purger` ≈ HAI `LiquidationEngine`
- Opus `Absorber` ≈ HAI Stability Pool
- Opus `Controller` ≈ HAI `PIDController`
- Opus `Gate` ≈ HAI `CollateralJoin`
- Opus `Caretaker` ≈ HAI `GlobalSettlement`

We should study Opus's patterns for Cairo-idiomatic implementations, especially their `controller.cairo` (PI controller in Cairo) and `shrine.cairo` (CDP accounting).

---

## Part 5: Implementation Phases

### Phase 1: Foundation (Weeks 1-3) — 12 contracts
**Goal:** Core accounting works. Can open SAFEs, deposit collateral, mint/burn system coin.

1. `libraries/math.cairo` — rpow, wmul, wdiv (extend wadray if needed)
2. `utils/authorizable.cairo` — auth modifier component
3. `utils/modifiable.cairo` — parameter modification component
4. `tokens/system_coin.cairo` — ERC20 stablecoin
5. `tokens/protocol_token.cairo` — ERC20 governance token
6. `core/safe_engine.cairo` — **THE critical contract** (~800 lines expected)
7. `utils/coin_join.cairo` — internal ↔ ERC20 bridge for system coin
8. `utils/collateral_join.cairo` — external ERC20 ↔ internal collateral bridge
9. `oracles/pragma_relayer.cairo` — read Pragma BTC/USD
10. `oracles/delayed_oracle.cairo` — 1hr delay wrapper
11. `core/oracle_relayer.cairo` — compute safety/liquidation prices
12. `core/tax_collector.cairo` — stability fee collection

**Tests:** Open SAFE → deposit WBTC → mint system coin → repay → withdraw. Oracle price updates correctly affect safety prices.

### Phase 2: PID Controller & Rate Mechanism (Weeks 4-5) — 5 contracts
**Goal:** Redemption rate adjusts based on market price deviation.

13. `oracles/ekubo_relayer.cairo` — TWAP market price from Ekubo
14. `core/pid_controller.cairo` — PI controller with leaky integrator
15. `core/pid_rate_setter.cairo` — connects TWAP → PID → OracleRelayer
16. `core/accounting_engine.cairo` — surplus/debt management
17. `core/stability_fee_treasury.cairo` — keeper reward funding

**Tests:** Simulate market price above/below redemption → verify rate computation → verify redemption price update over time. Test leaky integrator bounds (Moby Dick attack resistance).

### Phase 3: Liquidation & Auctions (Weeks 6-7) — 4 contracts
**Goal:** Undercollateralized SAFEs get liquidated via auctions.

18. `core/collateral_auction_house.cairo` — fixed-discount auctions
19. `core/liquidation_engine.cairo` — triggers liquidations
20. `core/debt_auction_house.cairo` — last-resort debt coverage
21. `core/surplus_auction_house.cairo` — burn governance token

**Tests:** Create undercollateralized SAFE → liquidation triggers → auction completes → collateral distributed → bad debt handled.

### Phase 4: User Interface Layer (Weeks 8-9) — 10 contracts
**Goal:** Users can interact via proxy pattern with batched operations.

22. `proxies/safe_handler.cairo`
23. `proxies/hai_proxy.cairo`
24. `proxies/hai_proxy_factory.cairo`
25. `proxies/safe_manager.cairo`
26-31. `proxies/actions/*.cairo` (BasicActions, CollateralBidActions, etc.)

**Tests:** Full user flow via proxy: open SAFE, deposit, mint, repay, withdraw. Auction bidding via proxy.

### Phase 5: Keeper Infrastructure (Weeks 10-11) — 4 contracts
**Goal:** Permissionless keeper functions with reward scaling.

32. `jobs/job.cairo` — base reward scaling
33. `jobs/oracle_job.cairo` — update oracles + PID
34. `jobs/liquidation_job.cairo` — batch liquidations
35. `jobs/accounting_job.cairo` — settle debt, trigger auctions

**Tests:** Keeper calls with time-based reward scaling. Multiple keepers competing.

### Phase 6: Settlement & Governance (Weeks 12-13) — 5 contracts
**Goal:** Emergency shutdown and governance.

36. `settlement/global_settlement.cairo`
37. `settlement/post_settlement_auction.cairo`
38. `settlement/settlement_auctioneer.cairo`
39. `governance/governor.cairo`
40. `governance/delegatee.cairo`

**Tests:** Full global settlement flow: freeze → process SAFEs → redeem at fixed rate.

### Phase 7: Multi-Collateral & Yield Integration (Weeks 14-15) — 8 contracts
**Goal:** Add LBTC, tBTC, SolvBTC support with proper oracle compositing.

41. `oracles/denominated_oracle.cairo` — LBTC/BTC + BTC/USD composition
42. `oracles/vault_relayer.cairo` — yield-bearing token price tracking
43. `tokens/wrapped_token.cairo` — BTC wrapper for yield accrual
44-48. `factories/*.cairo` — per-collateral deployment factories

**Tests:** Multi-collateral SAFEs. LBTC yield accrual affecting collateral ratios. Cross-collateral liquidation isolation.

### Phase 8: Staking & Rewards (Week 16) — 4 contracts
**Goal:** Protocol token staking with surplus streaming.

49. `tokens/staking_token.cairo` — sHAI equivalent
50. `tokens/staking_manager.cairo`
51. `tokens/reward_pool.cairo`
52. `tokens/reward_distributor.cairo`

---

## Part 6: Testing Strategy

### Unit Tests (per contract)
- Every public function tested with normal, edge, and revert cases
- WAD/RAY math precision tests (critical for rpow)
- Access control tests (unauthorized callers rejected)

### Integration Tests (per phase)
- Phase 1: Full SAFE lifecycle (open → deposit → mint → repay → withdraw)
- Phase 2: PID rate update cycle (oracle update → PID compute → rate applied)
- Phase 3: Liquidation cascade (price drop → multiple SAFEs liquidated → auctions resolve)
- Phase 4: Proxy-mediated full user flows
- Phase 5: Keeper bot simulation
- Phase 6: Global settlement end-to-end

### Invariant Tests
- Total system coin supply == sum of all SAFE debt
- Total collateral in SAFEEngine == sum of all SAFE collateral + auction collateral
- Redemption price never negative
- No SAFE can have debt without sufficient collateral (post-liquidation)

### Fork Tests (Starknet devnet)
- Real Pragma oracle price feeds
- Real LBTC/WBTC token contracts
- End-to-end with actual Starknet transaction flow

---

## Part 7: Project Structure

```
contracts/
├── Scarb.toml
├── snfoundry.toml
├── src/
│   ├── lib.cairo
│   ├── core/
│   │   ├── safe_engine.cairo
│   │   ├── oracle_relayer.cairo
│   │   ├── tax_collector.cairo
│   │   ├── liquidation_engine.cairo
│   │   ├── accounting_engine.cairo
│   │   ├── stability_fee_treasury.cairo
│   │   ├── pid_controller.cairo
│   │   ├── pid_rate_setter.cairo
│   │   ├── collateral_auction_house.cairo
│   │   ├── debt_auction_house.cairo
│   │   └── surplus_auction_house.cairo
│   ├── oracles/
│   │   ├── pragma_relayer.cairo
│   │   ├── delayed_oracle.cairo
│   │   ├── denominated_oracle.cairo
│   │   ├── ekubo_relayer.cairo
│   │   └── vault_relayer.cairo
│   ├── tokens/
│   │   ├── system_coin.cairo
│   │   ├── protocol_token.cairo
│   │   ├── staking_token.cairo
│   │   ├── staking_manager.cairo
│   │   ├── reward_pool.cairo
│   │   ├── reward_distributor.cairo
│   │   ├── token_distributor.cairo
│   │   └── wrapped_token.cairo
│   ├── proxies/
│   │   ├── hai_proxy.cairo
│   │   ├── hai_proxy_factory.cairo
│   │   ├── safe_manager.cairo
│   │   ├── safe_handler.cairo
│   │   └── actions/
│   │       ├── basic_actions.cairo
│   │       ├── collateral_bid_actions.cairo
│   │       ├── common_actions.cairo
│   │       ├── debt_bid_actions.cairo
│   │       ├── global_settlement_actions.cairo
│   │       ├── rewarded_actions.cairo
│   │       └── surplus_bid_actions.cairo
│   ├── settlement/
│   │   ├── global_settlement.cairo
│   │   ├── post_settlement_auction.cairo
│   │   └── settlement_auctioneer.cairo
│   ├── governance/
│   │   ├── governor.cairo
│   │   └── delegatee.cairo
│   ├── jobs/
│   │   ├── job.cairo
│   │   ├── accounting_job.cairo
│   │   ├── liquidation_job.cairo
│   │   └── oracle_job.cairo
│   ├── factories/
│   │   ├── collateral_auction_house_factory.cairo
│   │   ├── collateral_join_factory.cairo
│   │   ├── delayed_oracle_factory.cairo
│   │   └── denominated_oracle_factory.cairo
│   ├── interfaces/
│   │   ├── (one interface file per contract)
│   │   └── external/
│   │       ├── i_pragma.cairo
│   │       ├── i_ekubo.cairo
│   │       └── i_erc20.cairo
│   ├── libraries/
│   │   ├── math.cairo
│   │   ├── assertions.cairo
│   │   └── encoding.cairo
│   └── utils/
│       ├── authorizable.cairo
│       ├── disableable.cairo
│       ├── modifiable.cairo
│       ├── modifiable_per_collateral.cairo
│       ├── coin_join.cairo
│       ├── collateral_join.cairo
│       └── ownable.cairo
└── tests/
    ├── test_safe_engine.cairo
    ├── test_oracle_relayer.cairo
    ├── test_pid_controller.cairo
    ├── test_liquidation.cairo
    ├── test_auctions.cairo
    ├── test_settlement.cairo
    ├── integration/
    │   ├── test_full_lifecycle.cairo
    │   ├── test_pid_rate_cycle.cairo
    │   ├── test_liquidation_cascade.cairo
    │   └── test_multi_collateral.cairo
    └── utils/
        ├── mock_oracle.cairo
        ├── mock_token.cairo
        └── test_helpers.cairo
```

---

## Part 8: Verification Plan

1. **Compile check:** `scarb build` after every contract
2. **Unit tests:** `snforge test` — target 100% function coverage on core contracts
3. **Integration tests:** Full lifecycle tests on Starknet devnet
4. **Math verification:** Compare rpow/wmul/wdiv outputs against Solidity reference implementation
5. **PID controller verification:** Replay RAI's historical price data through Cairo PID and compare outputs
6. **Security:** Follow OpenZeppelin Cairo patterns for access control, reentrancy guards
7. **Formal verification:** Use wadray's Aegis-verified math library

---

## Summary: Total Contracts

| Category | Count |
|---|---|
| Core Protocol | 11 |
| Oracles | 5 |
| Tokens | 8 |
| Proxies + Actions | 11 |
| Settlement | 3 |
| Governance | 2 |
| Jobs/Keepers | 4 |
| Utilities | 7 |
| Factories | 4+ |
| Libraries | 3 |
| **Total** | **~58 contracts** |

**Estimated timeline:** 16 weeks for complete implementation with tests.
**Start with:** Phase 1 (SAFEEngine + basic collateral operations) — the foundation everything else depends on.

---

## Research Sources

- [HAI Core Contracts (Solidity)](https://github.com/hai-on-op/core)
- [Original GEB Contracts (Reflexer)](https://github.com/reflexer-labs/geb)
- [Opus Protocol - Cairo CDP Reference](https://github.com/lindy-labs/opus_contracts)
- [WadRay Library for Cairo](https://github.com/lindy-labs/wadray)
- [OpenZeppelin Cairo Contracts](https://github.com/OpenZeppelin/cairo-contracts)
- [Pragma Oracle - Starknet Native](https://www.pragma.build)
- [Starknet BTCFi Guide](https://www.starknet.io/blog/bitcoin-yield/)
- [LBTC on Starknet (Lombard)](https://www.lombard.finance/blog/lbtc-is-live-on-starknet-yield-bearing-btc-meets-btc-fi-season/)
- [Starknet BTCFi Domain](https://www.starknet.io/blog/bitcoin-defi-domain/)
- [Cairo Price Feeds Documentation](https://www.starknet.io/cairo-book/ch103-05-01-price-feeds.html)
- [GEB Protocol Audit - OpenZeppelin](https://blog.openzeppelin.com/geb-protocol-audit)
