#!/usr/bin/env bash
# =============================================================================
# Grinta Protocol — V11 PID/Guard Redeploy (RAY-scale migration + demo defaults)
# =============================================================================
# What this script does:
#   1. Declare + deploy NEW PIDController (RAY-scaled proportional + reset_deviation)
#   2. Declare + deploy NEW ParameterGuard (with set_pid_controller)
#   3. Wire refs: PID.set_seed_proposer(Hook), PID.transfer_admin(Guard)
#   4. Repoint Hook: Hook.set_pid_controller(NewPID)
#   5. Reset SAFEEngine.redemption_price back to RAY (re-peg to $1, drop drift)
#   6. Reset PID deviation state (fresh integrator)
#   7. Write deployed_v11.json and print next steps
#
# Old V10.1 PID (0x0539...dd3) and Guard (0x065e...ce1b) are left orphaned.
# No other V10 contracts are touched (SAFEEngine, Hook, Join, AE, LE, AH, etc.).
# =============================================================================

set -euo pipefail

# --- Config ---
RPC_URL="https://starknet-sepolia.g.alchemy.com/starknet/version/rpc/v0_10/_zuaFihvvIkJ2dwMdRZ0_"
ACCOUNT="account_ready"
DEPLOYER="0x072f0d2391f7ce9103d31a64b6a36e0fe8d32f908d2e183a02d9d46403b21ce2"
AGENT_ADDRESS="0x01f8975c5a1c6d2764bd30dddf4d6ab80c59e8287e5f796a5ba2490dcbf2dab6"

# Existing V10 contracts that stay live
HOOK="0x04560e84979e5bae575c65f9b0be443d91d9333a8f2f50884ebd5aaf89fb6147"
SAFE_ENGINE="0x07417b07b7ac71dd816c8d880f4dc1f74c10911aa174305a9146e1b56ef60272"

# --- V11 Constructor params (demo-friendly RAY-scale) ---
# See V11_PROD_CHECKLIST.md for prod values.
KP="1000000000000"                              # 1e-6 WAD (demo visibility)
KI="1000000"                                    # 1e-12 WAD
NOISE_BARRIER="1000000000000000000"             # 1.0 WAD (DISABLED for demo)
INTEGRAL_PERIOD="5"                             # 5 seconds (DEMO — prod=3600)
FEEDBACK_UPPER="1000000000000000000000000000"   # 1e27 RAY
FEEDBACK_LOWER="-1000000000000000000000000000"  # -1e27 RAY (i128)
PER_SECOND_LEAK="999999732582142021614955959"   # ~30-day half-life (OK for both)

# --- Guard demo policy ---
GUARD_KP_MIN="100000000000"                     # 1e-7 WAD
GUARD_KP_MAX="10000000000000"                   # 1e-5 WAD
GUARD_KI_MIN="100000"                           # 1e-13 WAD
GUARD_KI_MAX="100000000"                        # 1e-10 WAD
GUARD_MAX_KP_DELTA="5000000000000"              # 5e-6 WAD per call
GUARD_MAX_KI_DELTA="50000000"
GUARD_COOLDOWN="5"
GUARD_EMERGENCY_COOLDOWN="3"
GUARD_MAX_UPDATES="1000"

OUTPUT_FILE="deployed_v11.json"

# --- Helpers ---
extract_address() {
    echo "$1" | grep -oiP 'Contract Address:\s*\K0x[0-9a-fA-F]+' | head -1
}

extract_class_hash() {
    echo "$1" | grep -oiP 'Class Hash:\s*\K0x[0-9a-fA-F]+' | head -1
}

deploy_contract() {
    local name=$1
    local args=$2
    local label=$3
    echo "  Deploying $label..." >&2
    local result
    result=$(sncast --account "$ACCOUNT" deploy \
        --url "$RPC_URL" \
        --contract-name "$name" \
        --arguments "$args" 2>&1)
    local addr
    addr=$(extract_address "$result")
    if [ -z "$addr" ]; then
        echo "    FAILED: $result" >&2
        exit 1
    fi
    echo "    $label: $addr" >&2
    echo "$addr"
    sleep 12
}

deploy_with_calldata() {
    local name=$1
    local calldata=$2
    local label=$3
    echo "  Deploying $label..." >&2
    local result
    result=$(sncast --account "$ACCOUNT" deploy \
        --url "$RPC_URL" \
        --contract-name "$name" \
        -c $calldata 2>&1)
    local addr
    addr=$(extract_address "$result")
    if [ -z "$addr" ]; then
        echo "    FAILED: $result" >&2
        exit 1
    fi
    echo "    $label: $addr" >&2
    echo "$addr"
    sleep 12
}

invoke_fn() {
    local target=$1
    local fn=$2
    local args=$3
    local label=$4
    echo "  $label"
    if [ -z "$args" ]; then
        sncast --account "$ACCOUNT" invoke \
            --url "$RPC_URL" \
            --contract-address "$target" \
            --function "$fn" 2>&1 | grep -iE "transaction_hash|Transaction Hash" || true
    else
        sncast --account "$ACCOUNT" invoke \
            --url "$RPC_URL" \
            --contract-address "$target" \
            --function "$fn" \
            --arguments "$args" 2>&1 | grep -iE "transaction_hash|Transaction Hash" || true
    fi
    sleep 8
}

# =============================================================================
# PHASE 1: BUILD
# =============================================================================
echo ">>> PHASE 1: Building contracts..."
scarb build
echo ""

# =============================================================================
# PHASE 2: DECLARE
# =============================================================================
echo ">>> PHASE 2: Declaring updated contracts..."
echo ""
for contract in PIDController ParameterGuard; do
    echo "  Declaring $contract..."
    sncast --account "$ACCOUNT" declare \
        --url "$RPC_URL" \
        --contract-name "$contract" 2>&1 | grep -iE "Class Hash|already declared" || true
    sleep 8
done
echo ""

# =============================================================================
# PHASE 3: DEPLOY NEW PID
# =============================================================================
echo ">>> PHASE 3: Deploying V11 PIDController..."
PID_NEW=$(deploy_contract "PIDController" \
    "$DEPLOYER, $DEPLOYER, $KP, $KI, $NOISE_BARRIER, $INTEGRAL_PERIOD, $FEEDBACK_UPPER, $FEEDBACK_LOWER, $PER_SECOND_LEAK" \
    "PIDController V11")
echo ""

# =============================================================================
# PHASE 4: DEPLOY NEW GUARD
# =============================================================================
echo ">>> PHASE 4: Deploying V11 ParameterGuard..."
GUARD_NEW=$(deploy_with_calldata "ParameterGuard" \
    "$DEPLOYER $AGENT_ADDRESS $PID_NEW $GUARD_KP_MIN $GUARD_KP_MAX $GUARD_KI_MIN $GUARD_KI_MAX $GUARD_MAX_KP_DELTA $GUARD_MAX_KI_DELTA $GUARD_COOLDOWN $GUARD_EMERGENCY_COOLDOWN $GUARD_MAX_UPDATES" \
    "ParameterGuard V11")
echo ""

# =============================================================================
# PHASE 5: WIRE REFERENCES
# =============================================================================
echo ">>> PHASE 5: Wiring references..."
echo ""

invoke_fn "$PID_NEW"     "set_seed_proposer"    "$HOOK"     "PID.set_seed_proposer → Hook"
invoke_fn "$PID_NEW"     "transfer_admin"       "$GUARD_NEW" "PID.transfer_admin → GuardV11"
invoke_fn "$HOOK"        "set_pid_controller"   "$PID_NEW"  "Hook.set_pid_controller → PIDV11"

# Re-peg: reset SAFEEngine redemption_price to RAY (=$1) and rate to RAY (=1.0 no drift)
invoke_fn "$SAFE_ENGINE" "reset_redemption_price" \
    "1000000000000000000000000000 1000000000000000000000000000" \
    "SAFEEngine.reset_redemption_price → 1.0 / 1.0"

echo ""

# =============================================================================
# PHASE 6: WRITE OUTPUT FILE
# =============================================================================
echo ">>> PHASE 6: Writing $OUTPUT_FILE..."
cat > "$OUTPUT_FILE" <<EOF
{
  "version": "V11",
  "network": "sepolia",
  "parent": "V10.1",
  "notes": "RAY-scale PID migration. Demo-friendly constructor defaults. See V11_PROD_CHECKLIST.md for prod transition.",
  "deployer": "$DEPLOYER",
  "agent": "$AGENT_ADDRESS",
  "contracts": {
    "PIDController":   "$PID_NEW",
    "ParameterGuard":  "$GUARD_NEW",
    "GrintaHook":      "$HOOK",
    "SAFEEngine":      "$SAFE_ENGINE"
  },
  "redeployed_vs_v10_1": ["PIDController", "ParameterGuard"],
  "unchanged_from_v10_1": [
    "MockWBTC", "MockUSDC", "OracleRelayer", "SAFEEngine", "CollateralJoin",
    "GrintaHook", "SafeManager", "AccountingEngine", "LiquidationEngine",
    "CollateralAuctionHouse"
  ],
  "constructor_params": {
    "kp_wad_decimal": "1e-6",
    "ki_wad_decimal": "1e-12",
    "noise_barrier_wad": "1.0 (disabled for demo)",
    "integral_period_size_s": 5,
    "feedback_upper_ray": "1e27",
    "feedback_lower_ray": "-1e27",
    "per_second_cumulative_leak_ray": "999999732582142021614955959 (30d half-life)"
  },
  "guard_policy": {
    "kp_min_wad": "1e-7",
    "kp_max_wad": "1e-5",
    "ki_min_wad": "1e-13",
    "ki_max_wad": "1e-10",
    "max_kp_delta_wad": "5e-6",
    "max_ki_delta_wad": "5e-11",
    "cooldown_seconds": 5,
    "emergency_cooldown_seconds": 3,
    "max_updates": 1000
  }
}
EOF

echo ""
echo "============================================"
echo "V11 deployment complete."
echo "============================================"
echo ""
echo "New PID:    $PID_NEW"
echo "New Guard:  $GUARD_NEW"
echo ""
echo "Next steps:"
echo "  1. Update app/.env: PID_CONTROLLER_ADDRESS=$PID_NEW"
echo "  2. Update app/.env: PARAMETER_GUARD_ADDRESS=$GUARD_NEW"
echo "  3. Update agent/.env with same values"
echo "  4. Verify on-chain: sncast call --url <RPC> --contract-address $PID_NEW --function get_params"
echo "  5. Trigger hook.update() to prime the new PID with current market state"
echo ""
