# Liquidity Provision - Current Status

## ✅ Completed

### Token Approvals (Both Successful)
Both required ERC20 approvals have been executed on Starknet Sepolia:

**GRIT Approval**
- Token: `0x02f4f6c374c20ddf3ea5e59cc70f2ad4c2bfb5786ca6c146266f89f7da575421` (SAFEEngine)
- Amount: `10,000,000,000,000,000,000,000` (10,000 GRIT with 18 decimals)
- Spender: `0x0444a09d96389aa7148f1aada508e30b71299ffe650d9c97fdaae38cb9a23384` (Ekubo Core)
- Transaction: `0x0140e71e6766b5fa0cf9fea452f3171fc95e12c4752b636c03eaf642042c79d9`
- Status: ✓ Accepted

**USDC Approval**
- Token: `0x04e5d8c61fc059bb689169b217c37016e593a894042909e2b71b6c4f7b30fcdf` (Mock USDC)
- Amount: `10,000,000,000` (10,000 USDC with 6 decimals)
- Spender: `0x0444a09d96389aa7148f1aada508e30b71299ffe650d9c97fdaae38cb9a23384` (Ekubo Core)
- Transaction: `0x06f50f7e26198559f6384b68dd98b6bdf1a557bfbb0131fdffb80be6015b4d84`
- Status: ✓ Accepted

### Script Status
- Cairo script: `contracts/scripts/src/add_liquidity_sepolia.cairo` - compiles successfully
- Script execution: Approvals work, pool position update needs investigation

---

## ⏳ Next Steps

### 1. Verify Allowances on-chain
```bash
# Check GRIT allowance
starkli call 0x02f4f6c374c20ddf3ea5e59cc70f2ad4c2bfb5786ca6c146266f89f7da575421 \
  allowance \
  0x72f0d2391f7ce9103d31a64b6a36e0fe8d32f908d2e183a02d9d46403b21ce2 \
  0x0444a09d96389aa7148f1aada508e30b71299ffe650d9c97fdaae38cb9a23384 \
  --network=alpha-sepolia

# Check USDC allowance
starkli call 0x04e5d8c61fc059bb689169b217c37016e593a894042909e2b71b6c4f7b30fcdf \
  allowance \
  0x72f0d2391f7ce9103d31a64b6a36e0fe8d32f908d2e183a02d9d46403b21ce2 \
  0x0444a09d96389aa7148f1aada508e30b71299ffe650d9c97fdaae38cb9a23384 \
  --network=alpha-sepolia
```

Both should return values matching the approved amounts.

### 2. Research Ekubo Core API

The `update_position` call needs the correct entry point and parameters. Key questions:

- **Pool Initialization**: Does Ekubo require explicit pool initialization, or does it auto-initialize on first liquidity add?
- **Function Name**: Is it `update_position` or a different name like `add_liquidity`, `mint`, etc.?
- **Fee Format**: What is the correct fee encoding? (3000 bps for 0.3% or something else?)
- **Call Format**: Does it require a specific encoding or struct layout?

**Sources to check**:
- Ekubo documentation: https://ekubo.org/
- Ekubo contracts on Starknet: https://starkscan.co/
- Ekubo examples or SDK

### 3. Try Alternative Approaches

If `update_position` doesn't exist or needs different params:

**Option A: Check actual Ekubo function names**
```bash
# Use starkscan or similar to inspect 0x0444a09d96389aa7148f1aada508e30b71299ffe650d9c97fdaae38cb9a23384
# Look for external functions like: mint, deposit, add_liquidity, create_position, etc.
```

**Option B: Try with different parameters**
- Adjust fee to different values (0, 500, 1000, 3000, 10000, etc.)
- Try minimal tick spacing
- Try different liquidity amounts
- Try without extension (GrintaHook)

**Option C: Manual transaction via Block Explorer**
- Go to Starknet Sepolia block explorer (Starkscan)
- Interact directly with Ekubo Core contract
- Execute the liquidity function with GUI guidance

### 4. Pool Parameters for Reference

Once update_position works, use these parameters:

```
PoolKey {
  token0: 0x02f4f6c374c20ddf3ea5e59cc70f2ad4c2bfb5786ca6c146266f89f7da575421  // GRIT (smaller address)
  token1: 0x04e5d8c61fc059bb689169b217c37016e593a894042909e2b71b6c4f7b30fcdf  // USDC (larger address)
  fee: 3000  // 0.3% in basis points (adjust if needed)
  tick_spacing: 5000
  extension: 0x06a78d63d252cbb3192c64f9fdd85598a716992edaf693437fe466d9861c7ca5  // GrintaHook
}

Position Parameters {
  salt: 1
  bounds: {
    lower: { mag: 8355711, sign: true }   // -8355711
    upper: { mag: 8355711, sign: false }  // +8355711
  }
  liquidity_delta: { mag: 1e18, sign: false }  // 1e18 liquidity units to add
}
```

### 5. Verify Keeper-less Mechanism

After liquidity is added:

```bash
# Trigger a test swap to verify GrintaHook fires
# Swap 1,000 USDC for GRIT

starkli invoke 0x0444a09d96389aa7148f1aada508e30b71299ffe650d9c97fdaae38cb9a23384 \
  swap \
  <pool_key> \
  <swap_params> \
  --network=alpha-sepolia
```

Expected events after swap:
- `MarketPriceUpdated` from GrintaHook
- `PricesUpdated` from SAFEEngine
- `RateUpdated` from PIDController

---

## Architecture Summary

The Grinta V2 system is **keeper-less** because:

1. **Liquidity Pool**: GRIT/USDC pool on Ekubo with GrintaHook registered as extension
2. **Hook Mechanism**: Every swap on the pool triggers `after_swap` callback in GrintaHook
3. **Automatic Updates**:
   - Hook reads Ekubo Oracle TWAP price
   - Updates SAFEEngine with market price
   - Triggers PIDController to compute new rate
   - System state is persisted

**No external keeper needed** - the pool's trading activity itself maintains system health.

---

## Files

| File | Status | Purpose |
|------|--------|---------|
| `contracts/scripts/src/add_liquidity_sepolia.cairo` | ✓ Works (partial) | Liquidity script - approvals functional |
| `contracts/deployed.json` | ✓ Complete | Contract addresses and parameters |
| `LIQUIDITY_PROVISION_STATUS.md` | ✓ Complete | Previous status document |
| `add_liquidity_manual.md` | ✓ Complete | Manual execution guide |

---

## Contact Points

If you have access to Ekubo documentation or sample code, the following would help:
- Example of calling `update_position` or equivalent function
- Pool parameter specification (fee encoding, tick spacing, etc.)
- Any pool initialization requirements
- Hook registration verification
