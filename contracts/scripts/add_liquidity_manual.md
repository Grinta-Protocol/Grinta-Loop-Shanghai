# Manual Liquidity Provision for GRIT/USDC Pool on Ekubo Sepolia

This document provides manual steps to add 10,000 GRIT + 10,000 USDC liquidity to the GRIT/USDC pool on Ekubo.

## Prerequisites

- GRIT token: `0x02f4f6c374c20ddf3ea5e59cc70f2ad4c2bfb5786ca6c146266f89f7da575421`
- USDC token: `0x04e5d8c61fc059bb689169b217c37016e593a894042909e2b71b6c4f7b30fcdf`
- Ekubo Core: `0x0444a09d96389aa7148f1aada508e30b71299ffe650d9c97fdaae38cb9a23384`
- GrintaHook: `0x06a78d63d252cbb3192c64f9fdd85598a716992edaf693437fe466d9861c7ca5`

## Step 1: Approve GRIT to Ekubo Core

**Contract**: GRIT (SAFEEngine)  
**Function**: `approve(spender: ContractAddress, amount: u256)`  
**Parameters**:
- `spender`: `0x0444a09d96389aa7148f1aada508e30b71299ffe650d9c97fdaae38cb9a23384` (Ekubo Core)
- `amount`: `10000000000000000000000` (10,000 GRIT with 18 decimals)

Execute via Starknet.js or any contract interaction tool.

## Step 2: Approve USDC to Ekubo Core

**Contract**: USDC (Mock)  
**Function**: `approve(spender: ContractAddress, amount: u256)`  
**Parameters**:
- `spender`: `0x0444a09d96389aa7148f1aada508e30b71299ffe650d9c97fdaae38cb9a23384` (Ekubo Core)
- `amount`: `10000000000` (10,000 USDC with 6 decimals)

Execute via Starknet.js or any contract interaction tool.

## Step 3: Construct Pool Key

```
PoolKey {
  token0: 0x02f4f6c374c20ddf3ea5e59cc70f2ad4c2bfb5786ca6c146266f89f7da575421 (GRIT - numerically smaller)
  token1: 0x04e5d8c61fc059bb689169b217c37016e593a894042909e2b71b6c4f7b30fcdf (USDC - numerically larger)
  fee: 123456789012345678901234567890123 (0.3% typical fee)
  tick_spacing: 5000
  extension: 0x06a78d63d252cbb3192c64f9fdd85598a716992edaf693437fe466d9861c7ca5 (GrintaHook)
}
```

## Step 4: Construct Position Parameters

```
UpdatePositionParameters {
  salt: 1
  bounds: Bounds {
    lower: i129 { mag: 8355711, sign: true }   // -8355711
    upper: i129 { mag: 8355711, sign: false }  // +8355711
  }
  liquidity_delta: i129 { mag: 1000000000000000000, sign: false }  // 1e18 liquidity units
}
```

## Step 5: Call Ekubo Core's update_position

**Contract**: Ekubo Core (`0x0444a09d96389aa7148f1aada508e30b71299ffe650d9c97fdaae38cb9a23384`)  
**Function**: `update_position(pool_key: PoolKey, params: UpdatePositionParameters)`  
**Parameters**:
- `pool_key`: PoolKey structure (from Step 3)
- `params`: UpdatePositionParameters structure (from Step 4)

This will:
1. Deduct 10,000 GRIT from caller's ERC20 balance
2. Deduct 10,000 USDC from caller's ERC20 balance
3. Create a liquidity position in the pool
4. Trigger GrintaHook's `after_swap` callback if any swaps occur

## Step 6: Verify Liquidity Was Added

Query Ekubo pool state to confirm:
- Liquidity amount matches expectations
- Position was created with correct bounds
- Token amounts were transferred

## Step 7: Test Hook Execution

Execute a test swap to verify the GrintaHook fires correctly:

**Swap Parameters**:
- Input token: USDC
- Output token: GRIT
- Input amount: 1,000 USDC (`1000000000` with 6 decimals)
- Route: Direct swap on GRIT/USDC pool

**Expected Outcomes**:
1. GrintaHook `after_swap` fires
2. Ekubo Oracle price is read and updated
3. SAFEEngine redemption price is updated
4. PIDController computes new interest rate
5. System state is persisted

**Verify**:
- Check GrintaHook events: `MarketPriceUpdated`, `PricesUpdated`, `RateUpdated`
- Query SAFEEngine: redemption price should have changed
- Query PIDController: rate should have been recalculated

## Alternative: Use Starknet.js

If Cairo script execution is problematic, use Starknet.js:

```javascript
import { RpcProvider, Contract } from "starknet";

const provider = new RpcProvider({ nodeUrl: "https://pathfinder-testnet.ekubo.org" });

// 1. Approve GRIT
const gritContract = new Contract(GRIT_ABI, GRIT_ADDRESS, provider);
await gritContract.approve(EKUBO_CORE, uint256.bnToUint256(10000n * 10n**18n));

// 2. Approve USDC
const usdcContract = new Contract(USDC_ABI, USDC_ADDRESS, provider);
await usdcContract.approve(EKUBO_CORE, uint256.bnToUint256(10000n * 10n**6n));

// 3. Call update_position
const ekuboContract = new Contract(EKUBO_ABI, EKUBO_CORE, provider);
await ekuboContract.update_position(poolKey, updatePositionParameters);
```

## Notes

- The GrintaHook is keeper-less: it automatically updates prices and rates on every swap
- No external keeper transaction is needed
- The hook respects throttling: TWAP updates max 1x per 60s, rate updates max 1x per 3600s
- Full-range liquidity ensures the position captures all trading activity
