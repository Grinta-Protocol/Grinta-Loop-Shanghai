/// Tighten ParameterGuard policy V11 — lower max_kp_delta / max_ki_delta 10x.
///
/// Old policy allowed a single-step jump of up to 5e-6 WAD in KP, which meant
/// the agent could double KP from 1e-6 baseline in one tx. New policy caps
/// per-update delta to 5e-7 KP and 5e-12 KI so the agent has to ramp in steps.
///
/// Admin-only. Calls ParameterGuard.set_policy(AgentPolicy) from the deployer.

import { Account, CallData, RpcProvider } from "starknet";
import * as dotenv from "dotenv";
import * as path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, "../.env") });

const STARK_PRIME = 0x800000000000011000000000000000000000000000000000000000000000001n;

function encodeI128(value: bigint): string {
  if (value >= 0n) return "0x" + value.toString(16);
  return "0x" + (STARK_PRIME + value).toString(16);
}

const RPC = process.env.STARKNET_RPC_URL!;
const ADDRESS = process.env.DEPLOYER_ADDRESS!;
const PK = process.env.DEPLOYER_PRIVATE_KEY!;
const GUARD = process.env.PARAMETER_GUARD_ADDRESS!;

if (!ADDRESS || !PK || !GUARD) {
  throw new Error("Missing DEPLOYER_ADDRESS, DEPLOYER_PRIVATE_KEY, or PARAMETER_GUARD_ADDRESS in env");
}

const provider = new RpcProvider({ nodeUrl: RPC });
const deployer = new Account({ provider, address: ADDRESS, signer: PK });

// AgentPolicy field order (from src/types.cairo):
//   kp_min: i128, kp_max: i128, ki_min: i128, ki_max: i128,
//   max_kp_delta: u128, max_ki_delta: u128,
//   cooldown_seconds: u64, emergency_cooldown_seconds: u64, max_updates: u32
const newPolicy = {
  kp_min: 100_000_000_000n,             // 1e-7 WAD (unchanged)
  kp_max: 10_000_000_000_000n,          // 1e-5 WAD (unchanged)
  ki_min: 100_000n,                     // 1e-13 WAD (unchanged)
  ki_max: 100_000_000n,                 // 1e-10 WAD (unchanged)
  max_kp_delta: 500_000_000_000n,       // 5e-7 WAD — TIGHTENED (was 5e-6)
  max_ki_delta: 5_000_000n,             // 5e-12 WAD — TIGHTENED (was 5e-11)
  cooldown_seconds: 5n,                 // unchanged
  emergency_cooldown_seconds: 3n,       // unchanged
  max_updates: 1000n,                   // unchanged
};

async function main() {
  console.log("=== Read current policy ===");
  const current = await provider.callContract({
    contractAddress: GUARD,
    entrypoint: "get_policy",
    calldata: [],
  });
  console.log("  raw:", current);

  console.log("\n=== New policy ===");
  console.log("  kp_min:                     1e-7   (unchanged)");
  console.log("  kp_max:                     1e-5   (unchanged)");
  console.log("  ki_min:                     1e-13  (unchanged)");
  console.log("  ki_max:                     1e-10  (unchanged)");
  console.log("  max_kp_delta:   5e-7  (was 5e-6 — TIGHTENED 10x)");
  console.log("  max_ki_delta:   5e-12 (was 5e-11 — TIGHTENED 10x)");
  console.log("  cooldown_seconds:           5s     (unchanged)");
  console.log("  emergency_cooldown_seconds: 3s     (unchanged)");
  console.log("  max_updates:                1000   (unchanged)");

  const calldata = [
    encodeI128(newPolicy.kp_min),
    encodeI128(newPolicy.kp_max),
    encodeI128(newPolicy.ki_min),
    encodeI128(newPolicy.ki_max),
    "0x" + newPolicy.max_kp_delta.toString(16),
    "0x" + newPolicy.max_ki_delta.toString(16),
    "0x" + newPolicy.cooldown_seconds.toString(16),
    "0x" + newPolicy.emergency_cooldown_seconds.toString(16),
    "0x" + newPolicy.max_updates.toString(16),
  ];

  console.log("\n=== Invoking set_policy ===");
  console.log("  calldata:", calldata);

  const { transaction_hash } = await deployer.execute(
    { contractAddress: GUARD, entrypoint: "set_policy", calldata },
    { maxFee: 10n ** 16n },
  );
  console.log(`  tx: ${transaction_hash}`);

  await provider.waitForTransaction(transaction_hash);
  console.log("  confirmed.");

  console.log("\n=== Verify ===");
  const after = await provider.callContract({
    contractAddress: GUARD,
    entrypoint: "get_policy",
    calldata: [],
  });
  console.log("  raw:", after);
  console.log("\nDone. Agent now limited to ±5e-7 KP and ±5e-12 KI per update.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
