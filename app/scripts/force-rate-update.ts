// Force hook to recompute rate: shorten throttles then call update().
import { Account, RpcProvider } from "starknet";
import * as dotenv from "dotenv";
import * as path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, "../.env") });

const provider = new RpcProvider({ nodeUrl: process.env.STARKNET_RPC_URL! });
const deployer = new Account({
  provider,
  address: process.env.DEPLOYER_ADDRESS!,
  signer: process.env.DEPLOYER_PRIVATE_KEY!,
});

const HOOK = process.env.GRINTA_HOOK_ADDRESS!;
const SAFE_ENGINE = process.env.SAFE_ENGINE_ADDRESS!;

async function main() {
  console.log("Shortening hook throttles to 1s...");
  const { transaction_hash: tx1 } = await deployer.execute(
    [
      { contractAddress: HOOK, entrypoint: "set_price_update_interval", calldata: ["0x1"] },
      { contractAddress: HOOK, entrypoint: "set_rate_update_interval", calldata: ["0x1"] },
    ],
    { maxFee: 10n ** 16n },
  );
  console.log(`  tx: ${tx1}`);
  await provider.waitForTransaction(tx1);

  await new Promise((r) => setTimeout(r, 3000));

  console.log("Calling hook.update()...");
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
  console.log(`Redemption rate now: ${rrRaw} RAY (${rrNum})`);
  if (rrNum > 0) {
    const annual = Math.exp(Math.log(rrNum) * 31536000) - 1;
    const pct = annual * 100;
    console.log(`Annualized: ${pct >= 0 ? "+" : ""}${pct.toFixed(2)}%`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
