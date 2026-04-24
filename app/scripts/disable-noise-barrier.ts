// With production Kp=2.25e-7 and small errors, p_term is ~5e-9 WAD — miles below
// the default noise barrier (5% of redemption_price). Disable the noise barrier
// so the dashboard shows a live annualized rate for any nonzero pi output.
import { Account, RpcProvider } from "starknet";
import * as dotenv from "dotenv";
import * as path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, "../.env") });

const WAD = 10n ** 18n;

const provider = new RpcProvider({ nodeUrl: process.env.STARKNET_RPC_URL! });
const deployer = new Account({
  provider,
  address: process.env.DEPLOYER_ADDRESS!,
  signer: process.env.DEPLOYER_PRIVATE_KEY!,
});

const GUARD = process.env.PARAMETER_GUARD_ADDRESS!;
const HOOK = process.env.GRINTA_HOOK_ADDRESS!;
const SAFE_ENGINE = process.env.SAFE_ENGINE_ADDRESS!;

async function main() {
  // noise = WAD => threshold <= r_price_wad branch returns true => any pi_sum > 0 breaks it
  const barrier = WAD;
  const calldata = ["0x" + barrier.toString(16), "0x0"]; // u256 low, high

  console.log(`Setting noise_barrier = ${barrier} WAD via Guard proxy...`);
  const { transaction_hash: tx1 } = await deployer.execute(
    { contractAddress: GUARD, entrypoint: "proxy_set_noise_barrier", calldata },
    { maxFee: 10n ** 16n },
  );
  console.log(`  tx: ${tx1}`);
  await provider.waitForTransaction(tx1);

  await new Promise((r) => setTimeout(r, 3000));

  console.log("Calling hook.update() to recompute rate...");
  const { transaction_hash: tx2 } = await deployer.execute(
    { contractAddress: HOOK, entrypoint: "update", calldata: [] },
    { maxFee: 10n ** 16n },
  );
  console.log(`  tx: ${tx2}`);
  await provider.waitForTransaction(tx2);

  const rr = await provider.callContract({
    contractAddress: SAFE_ENGINE,
    entrypoint: "get_redemption_rate",
  });
  const rrRaw = BigInt(rr[0]);
  const rrNum = Number(rrRaw) / 1e27;
  console.log(`Redemption rate: ${rrRaw} RAY  (numeric ≈ ${rrNum})`);
  if (rrNum > 0 && rrNum !== 1) {
    const annual = Math.exp(Math.log(rrNum) * 31536000) - 1;
    const pct = annual * 100;
    console.log(`Annualized: ${pct >= 0 ? "+" : ""}${pct.toFixed(2)}%`);
  } else {
    console.log("Rate still 1.0 — something else is blocking (period size, bounds, or zero integral period).");
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
