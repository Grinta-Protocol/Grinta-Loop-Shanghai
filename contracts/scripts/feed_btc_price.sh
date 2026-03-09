#!/bin/bash
# feed_btc_price.sh — Fetch BTC/USD from CoinGecko and push to OracleRelayer on Sepolia
#
# Usage:
#   ./feed_btc_price.sh                  # one-shot
#   ./feed_btc_price.sh --loop 300       # repeat every 300 seconds
#
# Requirements: curl, jq, sncast, python3 (for WAD math)

set -euo pipefail

# Contract addresses (update after deployment)
ORACLE_RELAYER="0x06ed1049ac5d4bccd34eb476a28a62816747c4bb8a90d71f713d21938d5f633d"
WBTC_TOKEN="0x04ab76b407a4967de3683d387c598188d436d22d51416e8c8783156625874e20"
USDC_TOKEN="0x0728f54606297716e46af72251733521e2c2a374abbc3dce4bcee8df4744dd30"

PROFILE="sepolia"

fetch_and_push() {
    # 1. Fetch BTC/USD from CoinGecko (free, no API key)
    RESPONSE=$(curl -s 'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd')
    BTC_USD=$(echo "$RESPONSE" | jq -r '.bitcoin.usd')

    if [ -z "$BTC_USD" ] || [ "$BTC_USD" = "null" ]; then
        echo "[ERROR] Failed to fetch BTC price"
        return 1
    fi

    echo "[INFO] BTC/USD = \$$BTC_USD"

    # 2. Convert to WAD (18 decimals): multiply by 1e18
    #    Use python3 for arbitrary precision integer math
    PRICE_WAD=$(python3 -c "
import math
price = float('$BTC_USD')
# Round to nearest integer, then multiply by 1e18
wad = int(round(price)) * 10**18
print(wad)
")

    echo "[INFO] Price WAD = $PRICE_WAD"

    # 3. Call OracleRelayer.update_price(base_token, quote_token, price_usd_wad)
    #    price_usd_wad is u256 which serializes as (low: felt252, high: felt252)
    #    For prices < 2^128, high = 0
    echo "[INFO] Pushing to OracleRelayer..."

    sncast --profile "$PROFILE" invoke \
        --contract-address "$ORACLE_RELAYER" \
        --function "update_price" \
        --arguments "$WBTC_TOKEN, $USDC_TOKEN, $PRICE_WAD, 0" \
        --max-fee 0.001

    echo "[OK] Price updated: BTC = \$$BTC_USD"
}

# Main
if [ "${1:-}" = "--loop" ]; then
    INTERVAL="${2:-300}"
    echo "[INFO] Looping every ${INTERVAL}s. Ctrl+C to stop."
    while true; do
        fetch_and_push || echo "[WARN] Push failed, retrying next cycle"
        sleep "$INTERVAL"
    done
else
    fetch_and_push
fi
