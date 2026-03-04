# Grinta V2 Deployment Notes

**Network**: Starknet Sepolia  
**Date**: March 3, 2025  
**Status**: Core protocol deployed, liquidity provision ready  

---

## 🎯 Executive Summary

Grinta is a **keeper-less** stablecoin protocol that uses Ekubo as its oracle and automation layer. Every swap on the GRIT/USDC pool triggers the GrintaHook extension, which automatically:
1. Reads GRIT/USDC price from the swap deltas
2. Reads BTC/USDC collateral price from Ekubo Oracle
3. Computes a new redemption rate via PID controller
4. Updates the protocol state

**No keepers, no cron jobs — the protocol is self-correcting through trading.**

---

## 📋 Deployed Contracts

### Core Protocol (V2 — Keeper-less)

| Contract | Address | Purpose |
|---|---|---|
| **GrintaHook** | `0x06a78...c7ca5` | Ekubo extension — fires on every GRIT/USDC swap to update prices/rates |
| **SAFEEngine** | `0x02f4f...75421` | Core ledger, GRIT ERC20 token, redemption price/rate storage |
| **SafeManager** | `0x07ae...8aae8` | User-facing interface for opening/managing SAFEs |
| **CollateralJoin** | `0x0362...b4687` | WBTC custody with decimal conversion (8→18) |
| **PIDController** | `0x0694...aee6a` | HAI-style PI controller for rate computation |

### Test Tokens

| Token | Address | Decimals | Purpose |
|---|---|---|---|
| MockWBTC | `0x04ab...874e20` | 8 | Collateral asset for SAFEs |
| MockUSDC | `0x04e5...fcdf` | 6 | Liquidity pair with GRIT on Ekubo |

### External Services (Pre-existing)

| Service | Address | Purpose |
|---|---|---|
| Ekubo Core | `0x0444...23384` | DEX protocol and hook execution |
| Ekubo Oracle | `0x003c...dc65` | TWAP price feeds for BTC/USDC |

---

## ✅ Deployment Checklist

- [x] All contracts deployed
- [x] Permissions wired (SAFEEngine → SafeManager → CollateralJoin)
- [x] GrintaHook registered with Ekubo Core for `after_swap` callbacks
- [x] GRIT/USDC pool initialized on Ekubo with GrintaHook as extension
- [x] Initial BTC price set to $60,000
- [x] Test SAFE created: 1 WBTC collateral → 10,000 GRIT borrowed
- [x] Liquidity provision script ready (`add_liquidity_sepolia.cairo`)
- [ ] **PENDING**: Execute liquidity provision (10,000 GRIT + 10,000 USDC)
- [ ] Verify hook fires on test swap
- [ ] Monitor PID controller rate update

---

## 🚀 Next Steps

### 1. Add Liquidity to GRIT/USDC Pool

```bash
cd /mnt/c/Users/henry/desktop/pid/contracts/scripts
sncast --profile sepolia script run add_liquidity_sepolia --package grinta_scripts
```

This script:
- Approves 10,000 GRIT to Ekubo Core
- Approves 10,000 MockUSDC to Ekubo Core
- Calls `Ekubo Core.update_position()` to mint liquidity
- Prints success/failure status

**Why this matters**: Without liquidity, there are no swaps. Without swaps, the hook doesn't fire. With liquidity, every trade automatically triggers the protocol's self-correction mechanism.

### 2. Verify Liquidity Was Added

After execution, verify:

```bash
# Run verification script
bash /mnt/c/Users/henry/desktop/pid/contracts/scripts/verify_liquidity.sh

# Check pool state (if you have direct Ekubo queries)
# This depends on Ekubo's available query functions
```

### 3. Trigger a Test Swap

Once liquidity is confirmed, trigger a small test swap:

```bash
# Swap 1,000 MockUSDC for GRIT to trigger the hook
sncast invoke $EKUBO_CORE swap \
  --calldata [pool_key, swap_params] \
  --url https://starknet-sepolia.public.blastapi.io/rpc/v0_7
```

**Expected behavior**:
- Swap executes on Ekubo pool
- GrintaHook's `after_swap` fires automatically
- Hook computes GRIT price from swap deltas
- Hook reads BTC/USDC from oracle
- Hook updates SAFEEngine state
- Events emitted: `MarketPriceUpdated`, `PricesUpdated`, possibly `RateUpdated`

### 4. Monitor PID Controller Updates

After the test swap, read protocol state:

```bash
# Read market price (Grit/USDC from last swap)
sncast call $GRINTA_HOOK get_market_price

# Read collateral price (BTC/USDC from oracle)
sncast call $GRINTA_HOOK get_collateral_price

# Read redemption price (target for GRIT)
sncast call $SAFE_ENGINE get_redemption_price

# Read redemption rate (multiplier on redemption price)
sncast call $SAFE_ENGINE get_redemption_rate
```

---

## 🔧 System Architecture

```
User Opens SAFE
      ↓
SafeManager.open_safe()
      ↓
SAFEEngine creates new SAFE (e.g., ID=1)
      ↓
User deposits 1 WBTC via SafeManager
      ↓
CollateralJoin converts 1 WBTC (8 dec) → 100,000,000 internal units (18 dec)
      ↓
User borrows 10,000 GRIT
      ↓
SAFEEngine mints 10,000 GRIT ERC20 tokens
      ↓
User has: 10,000 GRIT in wallet
User owes: 10,000 GRIT debt at current redemption price

---

User swaps GRIT on Ekubo pool
      ↓
Ekubo processes swap: 1,000 USDC → X GRIT
      ↓
GrintaHook.after_swap fires (registered as extension)
      ↓
Hook computes market price from swap deltas:
  - GRIT price = |USDC delta| * 1e30 / |GRIT delta|
      ↓
Hook reads BTC/USDC from Ekubo Oracle
      ↓
Hook calls SAFEEngine.update_collateral_price(btc_price)
      ↓
Hook calls PIDController.compute_rate(market_price, redemption_price)
      ↓
PIDController returns new redemption rate
      ↓
Hook calls SAFEEngine.update_redemption_rate(new_rate)
      ↓
Redemption price drifts over time based on new rate
      ↓
User's SAFE health adjusts automatically (if market moves)
```

**Key insight**: The protocol self-corrects through trading. If GRIT trades below $1:
- Market price < Redemption price (adjusted target)
- PID sees negative deviation
- PID increases redemption rate
- Redemption price rises over time
- Users are incentivized to repay debt (it costs more GRIT to pay off)
- GRIT supply contracts
- GRIT price recovers toward $1

---

## 📊 Key Parameters

| Parameter | Value | Notes |
|---|---|---|
| Debt Ceiling | 1,000,000 GRIT | System-wide max debt |
| Liquidation Ratio | 150% | Min collateral ratio before liquidation |
| BTC Price (initial) | $60,000 | Set at deployment |
| Kp (PID Proportional) | 1.0 | Immediate response to price deviation |
| Ki (PID Integral) | 0.5 | Accumulates deviation over time |
| Noise Barrier | 0.95 (5%) | Min deviation before PID acts |
| Price Update Interval | 60s | Throttle on collateral price updates |
| Rate Update Interval | 3600s (1h) | Cooldown on redemption rate changes |
| GRIT Decimals | 18 | WAD precision |
| WBTC Decimals | 8 | Standard Bitcoin precision |
| USDC Decimals | 6 | Standard stablecoin precision |

---

## 🔐 Security Notes

1. **Keeper-less = Always-on Risk**: Without keepers, there's no manual intervention. The system automatically responds to market conditions. This is an advantage (always available) but also a risk (no "pause" button except through governance).

2. **Hook Throttling**: Price updates throttled to 60s, rate updates to 3600s. This prevents spam and gives time for market adjustments.

3. **Oracle Risk**: Collateral price comes from Ekubo Oracle (reads BTC/USDC TWAP). If oracle is manipulated, collateral value is wrong. For production, use Pragma or trusted oracle.

4. **Test Mode**: MockEkuboOracle is admin-settable. For mainnet, this must be replaced with real oracle.

---

## 📝 Reference Files

- **deployed.json**: Machine-readable contract addresses and ABIs
- **README.md**: Updated with V2 deployment info and liquidity provision steps
- **scripts/src/addresses.cairo**: Central address constants for all scripts
- **scripts/src/add_liquidity_sepolia.cairo**: Liquidity provision script
- **scripts/verify_liquidity.sh**: Post-execution verification guide

---

## 🐛 Troubleshooting

**Q: Script fails with "Approval failed"**
- A: Check deployer account has sufficient balance for gas fees
- A: Verify GRIT and USDC addresses are correct
- A: Ensure Ekubo Core address hasn't changed

**Q: Hook doesn't fire after swap**
- A: Verify liquidity was actually added (check Ekubo pool state)
- A: Check that GrintaHook was registered with Ekubo Core
- A: Verify swap amounts are significant enough (not dust)

**Q: Redemption rate didn't update after swap**
- A: Check if RATE_UPDATE_INTERVAL (3600s) has elapsed since last update
- A: Verify market price deviation exceeded NOISE_BARRIER (5%)
- A: Check PIDController state for errors

**Q: System shows old prices after swap**
- A: Prices are cached on GrintaHook. Call `hook.update()` manually if trading is infrequent
- A: Check if PRICE_UPDATE_INTERVAL (60s) has elapsed

---

## 📞 Support

For questions or issues:
1. Check this document first
2. Review contract source in `src/` folder
3. Check test files for usage examples
4. Inspect deployed contract state on Sepolia explorer

---

**Last Updated**: March 3, 2025  
**Version**: V2 Keeper-less  
**Status**: Ready for liquidity provision
