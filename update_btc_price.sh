#!/usr/bin/env bash
# Fetches BTC/USD from CoinGecko and pushes it to OracleRelayer on Starknet Sepolia
set -euo pipefail

# --- Addresses (V9 deployment) ---
ORACLE_RELAYER="0x004b92a6899e0aea5adfcdd9713e598d1ec05873e4a272adf94ce57558032c0f"
WBTC="0x0530e00b92e75cc7a5f95ffcacb6835167f23b0f646d34d4163ea9e979482e96"
USDC="0x03e977ae5de6e89dba8f188640f519477fade41cedef7fbbc279d86a44bf4874"

# --- Config ---
RPC_URL="https://starknet-sepolia.g.alchemy.com/starknet/version/rpc/v0_10/w0WsoxSXn4Xq8DEGYETDW"
ACCOUNT="account_ready"

# 1. Fetch BTC price from CoinGecko (free, no API key)
echo "Fetching BTC/USD from CoinGecko..."
RESPONSE=$(curl -s "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd")
BTC_USD=$(echo "$RESPONSE" | jq -r '.bitcoin.usd')

if [ -z "$BTC_USD" ] || [ "$BTC_USD" = "null" ]; then
    echo "ERROR: Failed to fetch BTC price. Response: $RESPONSE"
    exit 1
fi

echo "BTC/USD: \$$BTC_USD"

# 2. Convert to WAD (18 decimals) — multiply by 1e18
#    python3 handles arbitrary precision; bc/awk would lose digits
PRICE_WAD=$(python3 -c "
import decimal
decimal.getcontext().prec = 50
price = decimal.Decimal('$BTC_USD')
wad = int(price * 10**18)
print(wad)
")

echo "Price WAD: $PRICE_WAD"

# 3. Push to OracleRelayer
echo "Calling OracleRelayer.update_price()..."
sncast \
    --account "$ACCOUNT" \
    invoke \
    --url "$RPC_URL" \
    --contract-address "$ORACLE_RELAYER" \
    --function "update_price" \
    --arguments "$WBTC, $USDC, $PRICE_WAD"

echo ""
echo "Done! Verifying on-chain..."

# 4. Verify — read back the stored price
STORED=$(sncast \
    --account "$ACCOUNT" \
    call \
    --url "$RPC_URL" \
    --contract-address "$ORACLE_RELAYER" \
    --function "get_price_wad" \
    --arguments "$WBTC, $USDC")

echo "Stored price (WAD): $STORED"
echo "Update complete."
