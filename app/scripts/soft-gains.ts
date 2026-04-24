// Soften gains: Kp=1.0 WAD, Ki=0.001 WAD (Option A from the dashboard review).
// Single propose_parameters call — fits under max_kp_delta=150, max_ki_delta=0.1.
import { Account, RpcProvider } from "starknet";
import * as dotenv from "dotenv";
import * as path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, "../.env") });

const STARK_PRIME = 0x800000000000011000000000000000000000000000000000000000000000001n;
const WAD = 10n ** 18n;

function encodeI128(value: bigint): string {
  if (value >= 0n) return "0x" + value.toString(16);
  return "0x" + (STARK_PRIME + value).toString(16);
}

const provider = new RpcProvider({ nodeUrl: process.env.STARKNET_RPC_URL! });
const deployer = new Account({
  provider,
  address: process.env.DEPLOYER_ADDRESS!,
  signer: process.env.DEPLOYER_PRIVATE_KEY!,
});
const agent = new Account({
  provider,
  address: process.env.AGENT_ADDRESS!,
  signer: process.env.AGENT_PRIVATE_KEY!,
});

const GUARD = process.env.PARAMETER_GUARD_ADDRESS!;
const PID = process.env.PID_CONTROLLER_ADDRESS!;
const HOOK = process.env.GRINTA_HOOK_ADDRESS!;
const SAFE_ENGINE = process.env.SAFE_ENGINE_ADDRESS!;

async function propose() {
  console.log("=== Propose Kp=1.0 WAD, Ki=0.001 WAD ===");
  const newKp = WAD;                       // 1.0 WAD
  const newKi = WAD / 1000n;               // 0.001 WAD
  const calldata = [encodeI128(newKp), encodeI128(newKi), "0"];
  const { transaction_hash } = await agent.execute(
    { contractAddress: GUARD, entrypoint: "propose_parameters", calldata },
    { maxFee: 10n ** 16n },
  );
  console.log(`  tx: ${transaction_hash}`);
  await provider.waitForTransaction(transaction_hash);
}

async function forceUpdate() {
  console.log("=== hook.update() to commit new rate ===");
  const { transaction_hash } = await deployer.execute(
    { contractAddress: HOOK, entrypoint: "update", calldata: [] },
    { maxFee: 10n ** 16n },
  );
  console.log(`  tx: ${transaction_hash}`);
  await provider.waitForTransaction(transaction_hash);
}

async function printFinalState() {
  const [gains, rr, mp] = await Promise.all([
    provider.callContract({ contractAddress: PID, entrypoint: "get_controller_gains" }),
    provider.callContract({ contractAddress: SAFE_ENGINE, entrypoint: "get_redemption_rate" }),
    provider.callContract({ contractAddress: HOOK, entrypoint: "get_market_price" }),
  ]);
  const kp = Number(BigInt(gains[0])) / 1e18;
  const ki = Number(BigInt(gains[1])) / 1e18;
  const rrRaw = BigInt(rr[0]);
  const mpNum = Number(BigInt(mp[0])) / 1e18;
  console.log("---");
  console.log(`  kp = ${kp}`);
  console.log(`  ki = ${ki}`);
  console.log(`  market = $${mpNum.toFixed(4)}`);
  console.log(`  rate RAY = ${rrRaw}`);
  const RAY = 10n ** 27n;
  const offsetBig = rrRaw - RAY;
  const offsetDec = Number(offsetBig) / Number(RAY);
  const annualLog = offsetDec * 31536000;
  const annualPct = Math.expm1(annualLog) * 100;
  console.log(`  offset/RAY = ${offsetDec.toExponential(3)}`);
  console.log(`  annualized = ${annualPct >= 0 ? "+" : ""}${annualPct.toFixed(4)}%`);
}

async function main() {
  await propose();
  await new Promise((r) => setTimeout(r, 4000));
  await forceUpdate();
  await printFinalState();
}

main().catch((e) => { console.error(e); process.exit(1); });
