# 📦 Grinta V2 Liquidity Provision - Complete Setup

**Status**: ✅ All scripts written, compiled, and ready for execution  
**Date**: March 4, 2026  
**Network**: Starknet Sepolia  

---

## 🎯 What Was Done

### Phase 1: Contract Understanding ✅
- Analyzed GrintaHook keeper-less architecture
- Understood Ekubo integration (after_swap hook pattern)
- Reviewed deployed contract addresses and state
- Mapped protocol flow: Swap → Hook → TWAP → Price Update → PID Rate Update

### Phase 2: Script Development ✅
- **Used cairo-coder MCP** to write liquidity provision script
- Created `/contracts/scripts/src/add_liquidity_sepolia.cairo`
- Implemented proper Ekubo patterns:
  - PoolKey structure with correct token ordering (GRIT < USDC numerically)
  - i129 signed integer handling for position deltas
  - UpdatePositionParameters for Ekubo Core interaction
  - Full-range liquidity (min to max ticks)
  - Proper token approvals and invocation patterns

### Phase 3: Contract Reference Saved ✅
- **Created `/contracts/deployed.json`** — machine-readable deployment reference
  - All contract addresses and roles
  - Parameters and configurations
  - Deployment checklist
  - External dependencies

- **Updated `/contracts/README.md`** with V2 deployment info:
  - New contract addresses (GrintaHook, SafeManager, etc.)
  - Pool configuration details
  - Liquidity provision instructions

- **Updated `/contracts/scripts/src/addresses.cairo`**:
  - Added GRINTA_HOOK, SAFE_MANAGER, MOCK_USDC, MOCK_EKUBO_ORACLE constants
  - Centralized all V2 contract addresses

### Phase 4: Documentation & Helpers ✅
- **Created `/contracts/DEPLOYMENT_NOTES.md`** — comprehensive deployment guide
  - System architecture diagrams
  - Key parameters and security notes
  - Troubleshooting guide
  - Next steps for execution

- **Created `/contracts/scripts/verify_liquidity.sh`** — post-execution verification helper
  - Lists verification commands
  - Provides sncast query templates
  - Guides through hook execution verification

---

## 📋 Files Created/Modified

### New Files
```
✅ contracts/scripts/src/add_liquidity_sepolia.cairo (218 lines)
✅ contracts/deployed.json (186 lines)
✅ contracts/DEPLOYMENT_NOTES.md (297 lines)
✅ contracts/scripts/verify_liquidity.sh (68 lines)
```

### Modified Files
```
✅ contracts/README.md — Updated with V2 addresses and liquidity provision steps
✅ contracts/scripts/src/addresses.cairo — Added all V2 contract addresses
```

---

## 🚀 Ready for Execution

### Script: `add_liquidity_sepolia.cairo`

**What it does:**
1. Approves 10,000 GRIT to Ekubo Core
2. Approves 10,000 MockUSDC to Ekubo Core
3. Constructs PoolKey with GrintaHook as extension
4. Creates full-range liquidity position
5. Calls Ekubo Core's `update_position` to mint liquidity

**Execution:**
```bash
cd /mnt/c/Users/henry/desktop/pid/contracts/scripts
sncast --profile sepolia script run add_liquidity_sepolia --package grinta_scripts
```

**Build Status:** ✅ Compiles successfully
**Syntax:** ✅ Verified with Scarb 
**Patterns:** ✅ Follows Ekubo conventions (token ordering, i129, PoolKey, UpdatePositionParameters)

---

## 📊 Deployed Contracts Reference

| Contract | Address | Status |
|---|---|---|
| **GrintaHook** | 0x06a78...c7ca5 | ✅ Live - Ekubo extension registered |
| **SafeManager** | 0x07ae...8aae8 | ✅ Live - User interface |
| **SAFEEngine** | 0x02f4...75421 | ✅ Live - Core ledger + GRIT ERC20 |
| **CollateralJoin** | 0x0362...b4687 | ✅ Live - WBTC custody |
| **PIDController** | 0x0694...aee6a | ✅ Live - Rate computation |
| **MockWBTC** | 0x04ab...874e20 | ✅ Live - Collateral token |
| **MockUSDC** | 0x04e5...fcdf | ✅ Live - Liquidity pair |
| **MockEkuboOracle** | 0x0668...99071 | ✅ Live - Price feed |

**External:**
- Ekubo Core: 0x0444...23384
- Ekubo Oracle: 0x003c...dc65

---

## ⚡ System Architecture

```
GRIT/USDC Liquidity Pool (Ekubo)
         │
         ├─ Token0: GRIT (18 decimals)
         ├─ Token1: USDC (6 decimals)  
         ├─ Hook: GrintaHook
         └─ Extension registered ✅
         
         ↓ (Every Swap)
         
    GrintaHook.after_swap()
         │
         ├─ Compute market price from swap deltas
         ├─ Read BTC/USDC from Ekubo Oracle
         ├─ Update SAFEEngine.collateral_price
         ├─ Call PIDController.compute_rate
         └─ Update SAFEEngine.redemption_rate
         
         ↓ (Keeper-less = Automatic!)
         
    SAFEEngine State Updated
         │
         ├─ Collateral price: BTC/USD
         ├─ Market price: GRIT/USD
         ├─ Redemption price: Target for GRIT
         └─ Redemption rate: Adjustment multiplier
         
         ↓ (Self-Correcting)
         
    Protocol Stabilizes GRIT at ~$1
```

---

## 📝 Key Parameters

| Parameter | Value | Purpose |
|---|---|---|
| Liquidity to Add | 10,000 GRIT + 10,000 USDC | Initial pool seeding |
| Fee | 0.3% (Ekubo standard) | Trading fee tier |
| Tick Spacing | 5000 | Precision of price ticks |
| Position Range | FULL (min to max) | Accept all price movements |
| Update Interval (Price) | 60 seconds | Throttle collateral price updates |
| Update Interval (Rate) | 3600 seconds | Throttle redemption rate updates |
| Noise Barrier | 5% deviation | Min deviation before PID acts |
| Liquidation Ratio | 150% | Min collateral ratio |

---

## ✅ Verification Checklist

### After Execution
- [ ] Script executes without errors
- [ ] Transaction succeeds on Sepolia
- [ ] 10,000 GRIT transferred to Ekubo
- [ ] 10,000 USDC transferred to Ekubo
- [ ] Liquidity provider position created

### Test Swap Verification
- [ ] Trigger 1,000 USDC → GRIT swap
- [ ] Hook fires (after_swap callback)
- [ ] MarketPriceUpdated event emitted
- [ ] PricesUpdated event emitted
- [ ] GrintaHook state updated with prices

### PID Controller Verification
- [ ] Collateral price read from oracle
- [ ] Market price computed from swap delta
- [ ] Redemption price calculated
- [ ] Rate adjustment computed (if interval passed)
- [ ] SAFEEngine state reflects changes

### Protocol Health Check
- [ ] SAFEEngine.get_redemption_price() returns updated value
- [ ] SAFEEngine.get_redemption_rate() reflects new rate
- [ ] GrintaHook.get_market_price() returns swap price
- [ ] GrintaHook.get_collateral_price() returns BTC price
- [ ] No errors in contract state

---

## 🔍 How to Use the Files

### 1. Liquidity Provision Script
**File**: `contracts/scripts/src/add_liquidity_sepolia.cairo`

Provides 10,000 GRIT + 10,000 USDC to Ekubo pool. Use this to activate the protocol.

```bash
cd contracts/scripts && sncast --profile sepolia script run add_liquidity_sepolia --package grinta_scripts
```

### 2. Deployment Reference
**File**: `contracts/deployed.json`

Machine-readable record of all deployed contracts. Use this for:
- Frontend integration
- Contract address lookup
- ABIs and roles
- System parameters

### 3. Deployment Guide
**File**: `contracts/DEPLOYMENT_NOTES.md`

Complete deployment documentation including:
- Architecture diagrams
- Parameter explanations
- Troubleshooting guide
- Execution steps

### 4. Address Constants
**File**: `contracts/scripts/src/addresses.cairo`

Central location for all contract addresses. Use in future scripts:
```cairo
use grinta_scripts::addresses;
let safe_engine = addresses::SAFE_ENGINE;
let grinta_hook = addresses::GRINTA_HOOK;
```

### 5. Verification Helper
**File**: `contracts/scripts/verify_liquidity.sh`

Post-execution verification guide. Run to see next steps:
```bash
bash contracts/scripts/verify_liquidity.sh
```

---

## 🎓 Technical Highlights

### Keeper-Less Design
The protocol doesn't need external keepers because:
- GrintaHook is an Ekubo extension registered for `after_swap` callbacks
- Every swap automatically triggers price/rate updates
- Updates are throttled (60s for price, 3600s for rate) to prevent spam
- Self-correcting through trading activity

### Cairo + sncast Pattern
The liquidity script demonstrates:
- Proper struct serialization using `Serde`
- Complex nested structures (PoolKey, i129, Bounds, UpdatePositionParameters)
- Token approval pattern before main operation
- Error handling with `.expect()`
- Status printing for user feedback

### Ekubo Integration
Key Ekubo patterns demonstrated:
- Token ordering enforcement (token0 < token1)
- i129 signed integer encoding (mag + sign)
- Full-range liquidity provision (min to max ticks)
- Extension hook registration
- Safe position update semantics

---

## 📞 Next Actions

1. **Execute liquidity provision script**
   ```bash
   cd contracts/scripts
   sncast --profile sepolia script run add_liquidity_sepolia --package grinta_scripts
   ```

2. **Wait for transaction confirmation** on Sepolia

3. **Verify liquidity was added** using verification helper
   ```bash
   bash contracts/scripts/verify_liquidity.sh
   ```

4. **Trigger test swap** on Ekubo to verify hook execution

5. **Monitor PID controller updates** as swaps happen

6. **Protocol is now live** — self-correcting through trading!

---

## 📚 Files for Reference

All files are saved in the repository:

| Path | Purpose |
|---|---|
| `contracts/deployed.json` | Machine-readable contract reference |
| `contracts/DEPLOYMENT_NOTES.md` | Complete deployment guide |
| `contracts/README.md` | Updated with V2 info |
| `contracts/scripts/src/add_liquidity_sepolia.cairo` | Liquidity provision script (ready to execute) |
| `contracts/scripts/src/addresses.cairo` | Central address constants |
| `contracts/scripts/verify_liquidity.sh` | Verification helper script |

---

**Everything is ready! The only remaining step is executing the liquidity provision script on Sepolia.**

✅ Scripts written and compiled  
✅ Contracts saved as reference  
✅ Documentation complete  
⏳ Awaiting execution: `sncast --profile sepolia script run add_liquidity_sepolia --package grinta_scripts`
