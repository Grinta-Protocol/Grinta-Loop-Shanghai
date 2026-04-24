// Final prod gains (WAD-scaled, matching old Grinta deployment):
//   Kp = 100 WAD decimal (= 1e20 raw)
//   Ki = 0.028 WAD decimal (= 2.8e16 raw)
// These are equivalent to RAI's RAY-scaled Kp=1e-7, Ki=2.8e-11 (or thereabouts).
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

async function step1_widenPolicy() {
  console.log("=== Step 1: widen Guard policy to admit Kp=100 WAD ===");
  const calldata = [
    encodeI128(1n),                   // kp_min = 1 wei
    encodeI128(300n * WAD),           // kp_max = 300 WAD
    encodeI128(0n),                   // ki_min = 0
    encodeI128(WAD / 10n),            // ki_max = 0.1 WAD
    "0x" + (150n * WAD).toString(16), // max_kp_delta = 150 WAD
    "0x" + (WAD / 10n).toString(16),  // max_ki_delta = 0.1 WAD
    "0x5", "0x3", "0x3e8",
  ];
  const { transaction_hash } = await deployer.execute(
    { contractAddress: GUARD, entrypoint: "set_policy", calldata },
    { maxFee: 10n ** 16n },
  );
  console.log(`  tx: ${transaction_hash}`);
  await provider.waitForTransaction(transaction_hash);
}

async function step2_propose() {
  console.log("=== Step 2: propose Kp=100, Ki=0.028 ===");
  const newKp = 100n * WAD;                          // 100 decimal WAD
  const newKi = (WAD * 28n) / 1000n;                 // 0.028 decimal WAD
  const calldata = [encodeI128(newKp), encodeI128(newKi), "0"];
  const { transaction_hash } = await agent.execute(
    { contractAddress: GUARD, entrypoint: "propose_parameters", calldata },
    { maxFee: 10n ** 16n },
  );
  console.log(`  tx: ${transaction_hash}`);
  await provider.waitForTransaction(transaction_hash);
}

async function step3_forceUpdate() {
  console.log("=== Step 3: hook.update() to commit new rate ===");
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
  const rrNum = Number(rrRaw) / 1e27;
  const mpNum = Number(BigInt(mp[0])) / 1e18;
  console.log("---");
  console.log(`  kp = ${kp}`);
  console.log(`  ki = ${ki}`);
  console.log(`  market = $${mpNum.toFixed(4)}`);
  console.log(`  rate RAY = ${rrRaw}`);
  console.log(`  rate per-sec ≈ ${rrNum}`);
  const rrBig = rrRaw;
  const RAY = 10n ** 27n;
  const offsetBig = rrBig - RAY;
  const offsetDec = Number(offsetBig) / Number(RAY);
  const annualLog = offsetDec * 31536000;
  const annualPct = (Math.expm1(annualLog)) * 100;
  console.log(`  offset/RAY = ${offsetDec.toExponential(3)}`);
  console.log(`  annualized = ${annualPct >= 0 ? "+" : ""}${annualPct.toFixed(4)}%`);
}

async function main() {
  await step1_widenPolicy();
  await new Promise((r) => setTimeout(r, 4000));
  await step2_propose();
  await new Promise((r) => setTimeout(r, 4000));
  await step3_forceUpdate();
  await printFinalState();
}

main().catch((e) => { console.error(e); process.exit(1); });
