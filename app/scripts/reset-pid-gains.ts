/// Reset PID gains (KP, KI) to baseline in a single-shot script.
///
/// The guard enforces max_kp_delta=5e-7 and max_ki_delta=5e-12 per update.
/// From a walked-up state (e.g. 5e-6 / 5e-11) going back to baseline would
/// normally require ~8 sequential propose_parameters calls (~40s).
///
/// Shortcut: temporarily loosen the policy, do a single reset propose,
/// then re-tighten. Three txs total.
///
/// IMPORTANT: stop the live agent/server BEFORE running this. If the agent
/// fires a propose_parameters between step 1 and step 2 it will consume
/// the cooldown window and may walk gains back up using the loose policy.

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

// AgentPolicy field order: kp_min i128, kp_max i128, ki_min i128, ki_max i128,
// max_kp_delta u128, max_ki_delta u128, cooldown_seconds u64,
// emergency_cooldown_seconds u64, max_updates u32.
const LOOSE = {
  max_kp_delta: 10_000_000_000_000n, // 1e-5 WAD (= full range — enough to jump from any point to any point in one step)
  max_ki_delta: 100_000_000n,        // 1e-10 WAD (= full range)
};
const TIGHT = {
  max_kp_delta: 500_000_000_000n,    // 5e-7 WAD (back to production)
  max_ki_delta: 5_000_000n,          // 5e-12 WAD
};

const FIXED = {
  kp_min: 100_000_000_000n,          // 1e-7 WAD
  kp_max: 10_000_000_000_000n,       // 1e-5 WAD
  ki_min: 100_000n,                  // 1e-13 WAD
  ki_max: 100_000_000n,              // 1e-10 WAD
  cooldown_seconds: 5n,
  emergency_cooldown_seconds: 3n,
  max_updates: 1000n,
};

const BASELINE = {
  kp: 1_000_000_000_000n,            // 1e-6 WAD
  ki: 1_000_000n,                    // 1e-12 WAD
};

function buildPolicyCalldata(p: { max_kp_delta: bigint; max_ki_delta: bigint }) {
  return [
    encodeI128(FIXED.kp_min),
    encodeI128(FIXED.kp_max),
    encodeI128(FIXED.ki_min),
    encodeI128(FIXED.ki_max),
    "0x" + p.max_kp_delta.toString(16),
    "0x" + p.max_ki_delta.toString(16),
    "0x" + FIXED.cooldown_seconds.toString(16),
    "0x" + FIXED.emergency_cooldown_seconds.toString(16),
    "0x" + FIXED.max_updates.toString(16),
  ];
}

async function main() {
  console.log("=== Reset PID gains to baseline ===\n");

  const before = await provider.callContract({
    contractAddress: GUARD,
    entrypoint: "get_policy",
    calldata: [],
  });
  console.log("Current policy deltas: kp=%s ki=%s", before[4], before[5]);

  console.log("\n[1/3] Loosening policy (temporarily)...");
  const loose = await deployer.execute(
    { contractAddress: GUARD, entrypoint: "set_policy", calldata: buildPolicyCalldata(LOOSE) },
    { maxFee: 10n ** 16n },
  );
  console.log("  tx:", loose.transaction_hash);
  await provider.waitForTransaction(loose.transaction_hash);
  console.log("  confirmed.");

  console.log("\n[2/3] Proposing baseline KP=1e-6, KI=1e-12...");
  const calldata = [encodeI128(BASELINE.kp), encodeI128(BASELINE.ki), "0"];
  const reset = await agent.execute(
    { contractAddress: GUARD, entrypoint: "propose_parameters", calldata },
    { maxFee: 10n ** 16n },
  );
  console.log("  tx:", reset.transaction_hash);
  await provider.waitForTransaction(reset.transaction_hash);
  console.log("  confirmed.");

  console.log("\n[3/3] Re-tightening policy...");
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
  console.log("Policy deltas after: kp=%s ki=%s", after[4], after[5]);
  console.log("\nDone. KP=1e-6, KI=1e-12. Guard back to tight deltas.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
