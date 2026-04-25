/// Apply conservative PID policy: 20% annualized at 1% deviation,
/// 10% delta per call, 50% headroom on bounds.
///
/// New baseline:    KP=6.667e-7 WAD, KI=6.667e-13 WAD
/// New bounds:      kp [3.333e-7, 1e-6], ki [3.333e-13, 1e-12]
/// New delta caps:  max_kp_delta=6.667e-8 (10%), max_ki_delta=6.667e-14 (10%)
///
/// IMPORTANT: stop the live agent/server BEFORE running this.

import { Account, RpcProvider } from "starknet";
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
const DEPLOYER_ADDRESS = process.env.DEPLOYER_ADDRESS!;
const DEPLOYER_PK = process.env.DEPLOYER_PRIVATE_KEY!;
const AGENT_ADDRESS = process.env.AGENT_ADDRESS!;
const AGENT_PK = process.env.AGENT_PRIVATE_KEY!;
const GUARD = process.env.PARAMETER_GUARD_ADDRESS!;

const provider = new RpcProvider({ nodeUrl: RPC });
const deployer = new Account({ provider, address: DEPLOYER_ADDRESS, signer: DEPLOYER_PK });
const agent = new Account({ provider, address: AGENT_ADDRESS, signer: AGENT_PK });

const NEW_BASELINE = {
  kp: 666_666_666_667n,            // 6.667e-7 WAD (~20% annualized at 1% dev)
  ki: 666_667n,                    // 6.667e-13 WAD
};

// Step 1: loose policy — wide bounds + full-range deltas so we can
// jump from current state (~1.5e-6 / ~2.5e-12) to the new baseline in one tx.
const LOOSE = {
  kp_min: 100_000_000_000n,        // 1e-7 WAD (old wide floor)
  kp_max: 10_000_000_000_000n,     // 1e-5 WAD (old wide ceiling)
  ki_min: 100_000n,                // 1e-13 WAD
  ki_max: 100_000_000n,            // 1e-10 WAD
  max_kp_delta: 10_000_000_000_000n, // 1e-5 WAD (full range)
  max_ki_delta: 100_000_000n,        // 1e-10 WAD (full range)
  cooldown_seconds: 5n,
  emergency_cooldown_seconds: 3n,
  max_updates: 1000n,
};

// Step 3: tight conservative policy.
const TIGHT = {
  kp_min: 333_333_333_333n,        // 3.333e-7 WAD (50% of new baseline)
  kp_max: 1_000_000_000_000n,      // 1e-6 WAD     (150% of new baseline)
  ki_min: 333_333n,                // 3.333e-13 WAD
  ki_max: 1_000_000n,              // 1e-12 WAD
  max_kp_delta: 66_666_666_667n,   // 6.667e-8 WAD (10% of new baseline)
  max_ki_delta: 66_667n,           // 6.667e-14 WAD
  cooldown_seconds: 5n,
  emergency_cooldown_seconds: 3n,
  max_updates: 1000n,
};

type PolicyParams = typeof LOOSE;

function buildPolicyCalldata(p: PolicyParams) {
  return [
    encodeI128(p.kp_min),
    encodeI128(p.kp_max),
    encodeI128(p.ki_min),
    encodeI128(p.ki_max),
    "0x" + p.max_kp_delta.toString(16),
    "0x" + p.max_ki_delta.toString(16),
    "0x" + p.cooldown_seconds.toString(16),
    "0x" + p.emergency_cooldown_seconds.toString(16),
    "0x" + p.max_updates.toString(16),
  ];
}

async function main() {
  console.log("=== Apply conservative PID policy ===\n");

  const before = await provider.callContract({
    contractAddress: GUARD,
    entrypoint: "get_policy",
    calldata: [],
  });
  console.log("Before:");
  console.log("  kp bounds:  [%s, %s]", before[0], before[1]);
  console.log("  ki bounds:  [%s, %s]", before[2], before[3]);
  console.log("  deltas:     kp=%s ki=%s", before[4], before[5]);

  console.log("\n[1/3] Loosening policy (wide bounds + full-range deltas)...");
  const loose = await deployer.execute(
    { contractAddress: GUARD, entrypoint: "set_policy", calldata: buildPolicyCalldata(LOOSE) },
    { maxFee: 10n ** 16n },
  );
  console.log("  tx:", loose.transaction_hash);
  await provider.waitForTransaction(loose.transaction_hash);
  console.log("  confirmed.");

  console.log("\n[2/3] Proposing new baseline KP=6.667e-7, KI=6.667e-13...");
  const calldata = [encodeI128(NEW_BASELINE.kp), encodeI128(NEW_BASELINE.ki), "0"];
  const reset = await agent.execute(
    { contractAddress: GUARD, entrypoint: "propose_parameters", calldata },
    { maxFee: 10n ** 16n },
  );
  console.log("  tx:", reset.transaction_hash);
  await provider.waitForTransaction(reset.transaction_hash);
  console.log("  confirmed.");

  console.log("\n[3/3] Applying tight conservative policy...");
  const tight = await deployer.execute(
    { contractAddress: GUARD, entrypoint: "set_policy", calldata: buildPolicyCalldata(TIGHT) },
    { maxFee: 10n ** 16n },
  );
  console.log("  tx:", tight.transaction_hash);
  await provider.waitForTransaction(tight.transaction_hash);
  console.log("  confirmed.");

  console.log("\n=== Verify ===");
  const after = await provider.callContract({
    contractAddress: GUARD,
    entrypoint: "get_policy",
    calldata: [],
  });
  console.log("After:");
  console.log("  kp bounds:  [%s, %s]", after[0], after[1]);
  console.log("  ki bounds:  [%s, %s]", after[2], after[3]);
  console.log("  deltas:     kp=%s ki=%s", after[4], after[5]);
  console.log("\nDone. KP=6.667e-7, KI=6.667e-13. Tight policy active.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
