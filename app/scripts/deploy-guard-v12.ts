/**
 * deploy-guard-v12.ts
 *
 * Declare + deploy ParameterGuard V12 (ERC-8004 native auth) and transfer
 * PIDController admin from V11 Guard to V12. Idempotent — re-running checks
 * for existing class hash and skips declare if already declared.
 *
 * Constructor args (V12):
 *   admin              = deployer
 *   pid_controller     = V11 PID (unchanged from deployed_v11.json)
 *   identity_registry  = ERC-8004 Sepolia (0x7856876f...)
 *   proposer_agent_id  = 36 (from agent-identity.json)
 *   policy             = TIGHT conservative (matches current live V11 policy)
 *
 * After deploy:
 *   1. V11 Guard's proxy_transfer_pid_admin(V12) re-points PID's admin to V12.
 *   2. agent-identity.json + deployed_v12.json get the new addresses.
 *   3. PARAMETER_GUARD_ADDRESS in .env should be updated manually before
 *      restarting the agent server.
 *
 * Usage:
 *   npx tsx scripts/deploy-guard-v12.ts
 */

import { Account, RpcProvider, hash } from "starknet";
import dotenv from "dotenv";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { readFileSync, writeFileSync, existsSync } from "fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, "..", ".env") });

function req(key: string): string {
  const v = process.env[key];
  if (!v) throw new Error(`Missing env: ${key}`);
  return v;
}

const STARK_PRIME = 0x800000000000011000000000000000000000000000000000000000000000001n;
function encodeI128(value: bigint): string {
  if (value >= 0n) return "0x" + value.toString(16);
  return "0x" + (STARK_PRIME + value).toString(16);
}

const REPO_ROOT = join(__dirname, "..", "..");
const ARTIFACT_DIR = join(REPO_ROOT, "target", "dev");
const SIERRA_PATH = join(ARTIFACT_DIR, "grinta_ParameterGuard.contract_class.json");
const CASM_PATH = join(ARTIFACT_DIR, "grinta_ParameterGuard.compiled_contract_class.json");

const CFG = {
  RPC_URL: req("STARKNET_RPC_URL"),
  DEPLOYER_ADDRESS: req("DEPLOYER_ADDRESS"),
  DEPLOYER_PRIVATE_KEY: req("DEPLOYER_PRIVATE_KEY"),
  IDENTITY_REGISTRY_ADDRESS: req("IDENTITY_REGISTRY_ADDRESS"),
  PID_CONTROLLER_ADDRESS: req("PID_CONTROLLER_ADDRESS"),
  V11_GUARD_ADDRESS: req("PARAMETER_GUARD_ADDRESS"),
  AGENT_ID: process.env.AGENT_ID || "0x24",
  OUT_FILE: join(REPO_ROOT, "deployed_v12.json"),
};

const provider = new RpcProvider({ nodeUrl: CFG.RPC_URL });
const deployer = new Account({
  provider,
  address: CFG.DEPLOYER_ADDRESS,
  signer: CFG.DEPLOYER_PRIVATE_KEY,
});

// TIGHT policy — matches current V11 live values. PID gains are already in this
// envelope (kp=6.667e-7, ki=6.667e-13), so deploying with this policy needs no
// loose→tight dance. Future param changes via the agent are delta-capped.
const POLICY = {
  kp_min: 333_333_333_333n,        // 3.333e-7 WAD
  kp_max: 1_000_000_000_000n,      // 1e-6 WAD
  ki_min: 333_333n,                // 3.333e-13 WAD
  ki_max: 1_000_000n,              // 1e-12 WAD
  max_kp_delta: 66_666_666_667n,   // 6.667e-8 WAD (10% baseline)
  max_ki_delta: 66_667n,           // 6.667e-14 WAD
  cooldown_seconds: 5n,
  emergency_cooldown_seconds: 3n,
  max_updates: 1000n,
};

// Generous bounds — declare is heavy (~10M+ l2_gas), deploy ~3M, transfer-admin ~2M.
// Balance has headroom now so we don't need to micro-cap.
// Declare for a Cairo contract this size needs ~580M l2_gas on Sepolia.
// Cap at 1B with 12 gwei → ~12 STRK ceiling (actual much less since price is ~4 gwei).
const BOUNDS_DECLARE = {
  l1_gas: { max_amount: 0n, max_price_per_unit: 0x5af3107a4000n },
  l2_gas: { max_amount: 1_000_000_000n, max_price_per_unit: 12_000_000_000n },
  l1_data_gas: { max_amount: 0x2000n, max_price_per_unit: 0x100000000n },
};
// Deploy with full constructor (including AgentPolicy struct) costs ~7.8M l2_gas.
// Cap at 20M with margin.
const BOUNDS_DEPLOY = {
  l1_gas: { max_amount: 0n, max_price_per_unit: 0x5af3107a4000n },
  l2_gas: { max_amount: 20_000_000n, max_price_per_unit: 12_000_000_000n },
  l1_data_gas: { max_amount: 0x600n, max_price_per_unit: 0x100000000n },
};
const BOUNDS_INVOKE = {
  l1_gas: { max_amount: 0n, max_price_per_unit: 0x5af3107a4000n },
  l2_gas: { max_amount: 5_000_000n, max_price_per_unit: 12_000_000_000n },
  l1_data_gas: { max_amount: 0x300n, max_price_per_unit: 0x100000000n },
};

async function main() {
  console.log("=== Deploy ParameterGuard V12 (ERC-8004 native) ===\n");
  console.log("Deployer:           ", CFG.DEPLOYER_ADDRESS);
  console.log("V11 Guard (current):", CFG.V11_GUARD_ADDRESS);
  console.log("PID Controller:     ", CFG.PID_CONTROLLER_ADDRESS);
  console.log("ERC-8004 Registry:  ", CFG.IDENTITY_REGISTRY_ADDRESS);
  console.log("Agent ID:           ", CFG.AGENT_ID, "\n");

  // --- Step 1: Load artifacts ---
  if (!existsSync(SIERRA_PATH)) throw new Error(`Sierra not found: ${SIERRA_PATH}`);
  if (!existsSync(CASM_PATH)) throw new Error(`Casm not found: ${CASM_PATH}`);
  const sierra = JSON.parse(readFileSync(SIERRA_PATH, "utf-8"));
  const casm = JSON.parse(readFileSync(CASM_PATH, "utf-8"));

  // --- Step 2: Declare (skip if already declared) ---
  console.log("[1/4] Declaring ParameterGuard V12...");
  let classHash: string;
  try {
    const decRes = await deployer.declareIfNot(
      { contract: sierra, casm },
      { resourceBounds: BOUNDS_DECLARE as any }
    );
    classHash = decRes.class_hash;
    if (decRes.transaction_hash) {
      console.log("  declare tx:", decRes.transaction_hash);
      await provider.waitForTransaction(decRes.transaction_hash);
    } else {
      console.log("  (already declared on this network)");
    }
    console.log("  class_hash: ", classHash, "\n");
  } catch (e: any) {
    console.error("Declare failed:", e?.message || e);
    throw e;
  }

  // --- Step 3: Deploy with constructor calldata ---
  console.log("[2/4] Deploying ParameterGuard V12...");
  const agentIdBig = BigInt(CFG.AGENT_ID);
  const constructorCalldata = [
    CFG.DEPLOYER_ADDRESS,                                          // admin
    CFG.PID_CONTROLLER_ADDRESS,                                    // pid_controller
    CFG.IDENTITY_REGISTRY_ADDRESS,                                 // identity_registry
    "0x" + (agentIdBig & ((1n << 128n) - 1n)).toString(16),        // agent_id.low
    "0x" + (agentIdBig >> 128n).toString(16),                      // agent_id.high
    encodeI128(POLICY.kp_min),                                     // policy.kp_min
    encodeI128(POLICY.kp_max),                                     // policy.kp_max
    encodeI128(POLICY.ki_min),                                     // policy.ki_min
    encodeI128(POLICY.ki_max),                                     // policy.ki_max
    "0x" + POLICY.max_kp_delta.toString(16),                       // policy.max_kp_delta
    "0x" + POLICY.max_ki_delta.toString(16),                       // policy.max_ki_delta
    "0x" + POLICY.cooldown_seconds.toString(16),                   // policy.cooldown_seconds
    "0x" + POLICY.emergency_cooldown_seconds.toString(16),         // policy.emergency_cooldown_seconds
    "0x" + POLICY.max_updates.toString(16),                        // policy.max_updates
  ];

  const deployRes = await deployer.deployContract(
    { classHash, constructorCalldata, salt: "0x" + Date.now().toString(16) },
    { resourceBounds: BOUNDS_DEPLOY as any }
  );
  console.log("  deploy tx:        ", deployRes.transaction_hash);
  const deployReceipt: any = await provider.waitForTransaction(deployRes.transaction_hash);
  if (deployReceipt.execution_status === "REVERTED") {
    throw new Error(`Deploy reverted: ${deployReceipt.revert_reason}`);
  }
  const v12Address = deployRes.contract_address;
  if (!v12Address) {
    throw new Error("Deploy succeeded but no contract_address returned");
  }
  console.log("  V12 address:      ", v12Address, "\n");

  // --- Step 4: Verify V12 reads ---
  console.log("[3/4] Verifying V12 storage...");
  const polRead = await provider.callContract({
    contractAddress: v12Address,
    entrypoint: "get_policy",
    calldata: [],
  });
  console.log("  policy.kp bounds: [%s, %s]", polRead[0], polRead[1]);
  const idRegRead = await provider.callContract({
    contractAddress: v12Address,
    entrypoint: "get_identity_registry",
    calldata: [],
  });
  console.log("  identity_registry:", idRegRead[0]);
  const idRead = await provider.callContract({
    contractAddress: v12Address,
    entrypoint: "get_proposer_agent_id",
    calldata: [],
  });
  const agentIdReadBig = (BigInt(idRead[1]) << 128n) | BigInt(idRead[0]);
  console.log("  proposer_agent_id:", agentIdReadBig);
  if (agentIdReadBig !== agentIdBig) {
    throw new Error(`agent_id mismatch — expected ${agentIdBig}, got ${agentIdReadBig}`);
  }
  console.log("");

  // --- Step 5: Transfer PID admin from V11 Guard to V12 ---
  console.log("[4/4] Transferring PID admin V11 → V12...");
  const transferRes = await deployer.execute(
    {
      contractAddress: CFG.V11_GUARD_ADDRESS,
      entrypoint: "proxy_transfer_pid_admin",
      calldata: [v12Address],
    },
    { resourceBounds: BOUNDS_INVOKE as any }
  );
  console.log("  transfer tx:      ", transferRes.transaction_hash);
  const transferReceipt: any = await provider.waitForTransaction(transferRes.transaction_hash);
  if (transferReceipt.execution_status === "REVERTED") {
    console.error("  REVERTED:", transferReceipt.revert_reason);
    throw new Error("PID admin transfer reverted");
  }
  console.log("  confirmed.\n");

  // --- Persist ---
  const out = {
    version: "V12",
    network: "sepolia",
    parent: "V11",
    deployed_at: new Date().toISOString(),
    notes: "ERC-8004 native auth — replaces V11 Guard's _assert_agent with IdentityRegistry wallet binding.",
    deployer: CFG.DEPLOYER_ADDRESS,
    contracts: {
      ParameterGuard_V12: v12Address,
      ParameterGuard_V11_orphaned: CFG.V11_GUARD_ADDRESS,
      PIDController: CFG.PID_CONTROLLER_ADDRESS,
      IdentityRegistry: CFG.IDENTITY_REGISTRY_ADDRESS,
    },
    class_hashes: { ParameterGuard_V12: classHash },
    erc8004: {
      agent_id: CFG.AGENT_ID,
      registry: CFG.IDENTITY_REGISTRY_ADDRESS,
    },
    constructor_policy: {
      kp_range_wad: ["3.333e-7", "1e-6"],
      ki_range_wad: ["3.333e-13", "1e-12"],
      max_kp_delta_wad: "6.667e-8",
      max_ki_delta_wad: "6.667e-14",
      cooldown_seconds: 5,
      emergency_cooldown_seconds: 3,
      max_updates: 1000,
    },
    txs: {
      declare: classHash,
      deploy: deployRes.transaction_hash,
      transferPidAdmin: transferRes.transaction_hash,
    },
  };
  writeFileSync(CFG.OUT_FILE, JSON.stringify(out, null, 2));
  console.log("Saved:", CFG.OUT_FILE);
  console.log("\n=== Done ===");
  console.log("\nNEXT: update app/.env with PARAMETER_GUARD_ADDRESS=" + v12Address);
  console.log("      then restart the agent server.");
}

main().catch((e) => {
  console.error("\nFAILED:", e?.message || e);
  if (e?.stack) console.error(e.stack);
  process.exit(1);
});
