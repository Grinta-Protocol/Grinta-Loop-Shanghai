import { RpcProvider } from "starknet";
import * as dotenv from "dotenv";
import * as path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, "../.env") });

const provider = new RpcProvider({ nodeUrl: process.env.STARKNET_RPC_URL! });
const PID = process.env.PID_CONTROLLER_ADDRESS!;
const GUARD = process.env.PARAMETER_GUARD_ADDRESS!;

function toSigned(hex: string): bigint {
  const n = BigInt(hex);
  const I128_MAX = (1n << 127n) - 1n;
  return n > I128_MAX ? n - (1n << 128n) : n;
}

async function main() {
  const gains = await provider.callContract({
    contractAddress: PID,
    entrypoint: "get_controller_gains",
    calldata: [],
  });
  const policy = await provider.callContract({
    contractAddress: GUARD,
    entrypoint: "get_policy",
    calldata: [],
  });
  const stopped = await provider.callContract({
    contractAddress: GUARD,
    entrypoint: "is_stopped",
    calldata: [],
  });
  const agent = await provider.callContract({
    contractAddress: GUARD,
    entrypoint: "get_agent",
    calldata: [],
  });
  const count = await provider.callContract({
    contractAddress: GUARD,
    entrypoint: "get_update_count",
    calldata: [],
  });
  const lastTs = await provider.callContract({
    contractAddress: GUARD,
    entrypoint: "get_last_update_timestamp",
    calldata: [],
  });

  const kp = toSigned(gains[0]);
  const ki = toSigned(gains[1]);
  const kpHuman = Number(kp) / 1e18;
  const kiHuman = Number(ki) / 1e18;

  console.log("PID gains");
  console.log("  KP raw:", kp.toString(), "->", kpHuman.toExponential(3), "WAD");
  console.log("  KI raw:", ki.toString(), "->", kiHuman.toExponential(3), "WAD");

  console.log("\nGuard policy");
  console.log("  kp_min:", BigInt(policy[0]).toString(), "=", (Number(BigInt(policy[0]))/1e18).toExponential(2));
  console.log("  kp_max:", BigInt(policy[1]).toString(), "=", (Number(BigInt(policy[1]))/1e18).toExponential(2));
  console.log("  ki_min:", BigInt(policy[2]).toString(), "=", (Number(BigInt(policy[2]))/1e18).toExponential(2));
  console.log("  ki_max:", BigInt(policy[3]).toString(), "=", (Number(BigInt(policy[3]))/1e18).toExponential(2));
  console.log("  max_kp_delta:", BigInt(policy[4]).toString(), "=", (Number(BigInt(policy[4]))/1e18).toExponential(2));
  console.log("  max_ki_delta:", BigInt(policy[5]).toString(), "=", (Number(BigInt(policy[5]))/1e18).toExponential(2));
  console.log("  cooldown:", BigInt(policy[6]).toString(), "s");
  console.log("  emergency_cooldown:", BigInt(policy[7]).toString(), "s");
  console.log("  max_updates:", BigInt(policy[8]).toString());

  console.log("\nGuard state");
  console.log("  stopped:", BigInt(stopped[0]) === 1n);
  console.log("  agent:", agent[0]);
  console.log("  update_count:", BigInt(count[0]).toString());
  console.log("  last_update_timestamp:", BigInt(lastTs[0]).toString(), "(", new Date(Number(BigInt(lastTs[0])) * 1000).toISOString(), ")");

  const now = Math.floor(Date.now() / 1000);
  const elapsed = now - Number(BigInt(lastTs[0]));
  console.log("  seconds since last update:", elapsed);
}

main().catch((e) => { console.error(e); process.exit(1); });
