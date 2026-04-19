#!/usr/bin/env bash
# Fetches BTC/USD from CoinGecko and pushes it to OracleRelayer on Starknet Sepolia
set -euo pipefail

# --- Addresses (V10 deployment) ---
ORACLE_RELAYER="0x013f7f3661d81b29c3a55b1022231161c68282537049738dd1676a855063f851"
WBTC="0x051ef402b04791e28e95b09498a148a6b81499597d313f0e49afcee5a13267b4"
USDC="0x016aff59b63314502da266d4347b2c1220c97e7865fce3afcf92fdd3ace93906"

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
