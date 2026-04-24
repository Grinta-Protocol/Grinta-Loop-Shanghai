// Step 1: widen Guard policy so kp can drop to production-scale (~2.25e-7 WAD)
// Step 2: propose production gains (Kp=2.25e-7, Ki=2.4e-14) via agent
// Step 3: swap USDC → GRIT to halve the peg error
import { Account, RpcProvider, CallData, cairo, Call } from "starknet";
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
const ROUTER = process.env.EKUBO_ROUTER_ADDRESS!;
const GRIT = process.env.SAFE_ENGINE_ADDRESS!;
const USDC = process.env.USDC_ADDRESS!;
const HOOK = process.env.GRINTA_HOOK_ADDRESS!;
const POOL_FEE = BigInt(process.env.POOL_FEE || "0");
const POOL_TICK_SPACING = BigInt(process.env.POOL_TICK_SPACING || "1000");

async function step1_widenPolicy() {
  console.log("=== Step 1: widen Guard policy ===");
  // Policy fields: kp_min, kp_max, ki_min, ki_max (i128 WAD),
  //                max_kp_delta, max_ki_delta (u128 WAD),
  //                cooldown_seconds, emergency_cooldown_seconds (u64),
  //                max_updates (u32)
  const calldata = [
    encodeI128(1n),                  // kp_min = 1 wei (~0)
    encodeI128(10n * WAD),           // kp_max = 10 WAD
    encodeI128(0n),                  // ki_min = 0
    encodeI128(WAD / 10n),           // ki_max = 0.1 WAD
    "0x" + (2n * WAD).toString(16),  // max_kp_delta = 2.0 WAD
    "0x" + (WAD / 5n).toString(16),  // max_ki_delta = 0.2 WAD
    "0x5",                           // cooldown_seconds = 5
    "0x3",                           // emergency_cooldown_seconds = 3
    "0x3e8",                         // max_updates = 1000
  ];
  const { transaction_hash } = await deployer.execute(
    { contractAddress: GUARD, entrypoint: "set_policy", calldata },
    { maxFee: 10n ** 16n },
  );
  console.log(`  tx: ${transaction_hash}`);
  await provider.waitForTransaction(transaction_hash);
  console.log("  policy updated");
}

async function step2_proposeProductionGains() {
  console.log("=== Step 2: propose production gains (Kp=2.25e-7, Ki=2.4e-14) ===");
  // Kp = 2.25e-7 → 2.25e-7 * 1e18 = 225_000_000_000
  // Ki = 2.4e-14 → 2.4e-14 * 1e18 = 24_000
  const newKp = 225_000_000_000n;
  const newKi = 24_000n;
  const calldata = [encodeI128(newKp), encodeI128(newKi), "0"];
  const { transaction_hash } = await agent.execute(
    { contractAddress: GUARD, entrypoint: "propose_parameters", calldata },
    { maxFee: 10n ** 16n },
  );
  console.log(`  tx: ${transaction_hash}`);
  await provider.waitForTransaction(transaction_hash);
  console.log("  production gains applied");
}

async function step3_buyGritWithUsdc(usdcAmount6dec: bigint) {
  console.log(`=== Step 3: swap ${Number(usdcAmount6dec) / 1e6} USDC → GRIT ===`);
  const calls: Call[] = [
    {
      contractAddress: USDC,
      entrypoint: "approve",
      calldata: CallData.compile({ spender: ROUTER, amount: cairo.uint256(usdcAmount6dec) }),
    },
    {
      contractAddress: USDC,
      entrypoint: "transfer",
      calldata: CallData.compile({ recipient: ROUTER, amount: cairo.uint256(usdcAmount6dec) }),
    },
    {
      contractAddress: ROUTER,
      entrypoint: "swap",
      calldata: CallData.compile({
        node: {
          pool_key: {
            token0: USDC,
            token1: GRIT,
            fee: POOL_FEE,
            tick_spacing: POOL_TICK_SPACING,
            extension: HOOK,
          },
          sqrt_ratio_limit: cairo.uint256(0n),
          skip_ahead: 0n,
        },
        token_amount: {
          token: USDC,
          amount: { mag: usdcAmount6dec, sign: 0 },
        },
      }),
    },
    { contractAddress: ROUTER, entrypoint: "clear", calldata: CallData.compile({ token: USDC }) },
    { contractAddress: ROUTER, entrypoint: "clear", calldata: CallData.compile({ token: GRIT }) },
  ];
  const { transaction_hash } = await deployer.execute(calls, { maxFee: 10n ** 16n });
  console.log(`  tx: ${transaction_hash}`);
  await provider.waitForTransaction(transaction_hash);
  console.log("  swap confirmed");
}

async function printState() {
  const mp = await provider.callContract({ contractAddress: HOOK, entrypoint: "get_market_price" });
  const gains = await provider.callContract({ contractAddress: PID, entrypoint: "get_controller_gains" });
  const mpNum = Number(BigInt(mp[0])) / 1e18;
  const kp = Number(BigInt(gains[0])) / 1e18;
  const ki = Number(BigInt(gains[1])) / 1e18;
  console.log(`  state → market=$${mpNum.toFixed(4)}, kp=${kp.toExponential(2)}, ki=${ki.toExponential(2)}`);
}

async function main() {
  const amountArg = process.argv[2];
  const usdcAmount = amountArg ? BigInt(Math.round(parseFloat(amountArg) * 1e6)) : 2000n * 1_000_000n;

  console.log("--- Initial state ---");
  await printState();

  await step1_widenPolicy();
  await new Promise((r) => setTimeout(r, 4000));

  await step2_proposeProductionGains();
  await new Promise((r) => setTimeout(r, 4000));

  console.log("--- After gains update ---");
  await printState();

  await step3_buyGritWithUsdc(usdcAmount);

  console.log("--- Final state ---");
  await printState();
}

main().catch((e) => { console.error(e); process.exit(1); });
