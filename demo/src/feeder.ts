/**
 * Oracle Feeder — pushes synthetic BTC crash prices to OracleRelayer.
 *
 * Cadence: every FEEDER_INTERVAL_SEC (default 10s). Reads the CSV's
 * most-recent sample for the elapsed demo time and calls
 * OracleRelayer.update_price(wbtc, usdc, price_wad).
 *
 * On Sepolia this simulates a "slow" oracle (industry standard: every ~1h).
 * The agent reads the same CSV at higher frequency, giving it an edge over
 * the on-chain price.
 */
import { Account, RpcProvider, CallData } from "starknet";
import { CONFIG, usdToWad } from "./config.js";
import { loadCrashSamples, sampleAt, type PriceSample } from "./csv-loader.js";

function fmtTime(d: Date) {
  return d.toISOString().split("T")[1].slice(0, 8);
}

async function pushPrice(account: Account, sample: PriceSample): Promise<string | null> {
  const priceWad = usdToWad(sample.btcUsd);
  const calldata = CallData.compile({
    base_token: CONFIG.WBTC_ADDRESS,
    quote_token: CONFIG.USDC_ADDRESS,
    price_usd_wad: priceWad,
  });
  try {
    const { transaction_hash } = await account.execute({
      contractAddress: CONFIG.ORACLE_RELAYER_ADDRESS,
      entrypoint: "update_price",
      calldata,
    });
    return transaction_hash;
  } catch (err) {
    console.error(`  ✗ feed failed:`, err instanceof Error ? err.message : err);
    return null;
  }
}

async function main() {
  const provider = new RpcProvider({ nodeUrl: CONFIG.RPC_URL });
  const account = new Account({
    provider,
    address: CONFIG.DEPLOYER_ADDRESS,
    signer: CONFIG.DEPLOYER_PRIVATE_KEY,
  });
  const samples = loadCrashSamples();

  console.log("=".repeat(60));
  console.log("  Grinta Oracle Feeder");
  console.log("=".repeat(60));
  console.log(`  Wallet         : ${CONFIG.DEPLOYER_ADDRESS}`);
  console.log(`  Oracle relayer : ${CONFIG.ORACLE_RELAYER_ADDRESS}`);
  console.log(`  CSV samples    : ${samples.length} (covers ${samples[samples.length - 1].tSeconds}s)`);
  console.log(`  Push cadence   : every ${CONFIG.FEEDER_INTERVAL_SEC}s`);
  console.log(`  Demo duration  : ${CONFIG.DEMO_DURATION_SEC}s`);
  console.log("=".repeat(60));
  console.log("");

  // If the launcher set a shared t=0, honor it so all three processes
  // (feeder, trader, agent) sample the CSV at the same demo-time.
  const startMs = CONFIG.DEMO_START_TIMESTAMP_MS > 0
    ? CONFIG.DEMO_START_TIMESTAMP_MS
    : Date.now();
  const waitUntilStart = startMs - Date.now();
  if (waitUntilStart > 0) {
    console.log(`Waiting ${(waitUntilStart / 1000).toFixed(1)}s for shared demo start…`);
    await sleep(waitUntilStart);
  }
  let pushCount = 0;

  // Push initial sample immediately (t=0)
  const first = sampleAt(samples, 0);
  console.log(`[${fmtTime(new Date())}] t=0s phase=${first.phase} btc=$${first.btcUsd}`);
  const hash = await pushPrice(account, first);
  if (hash) {
    pushCount++;
    console.log(`  ✓ tx ${hash.slice(0, 16)}...`);
  }

  while (true) {
    const elapsedSec = (Date.now() - startMs) / 1000;
    if (elapsedSec >= CONFIG.DEMO_DURATION_SEC) {
      console.log(`\nDemo duration reached (${CONFIG.DEMO_DURATION_SEC}s). Pushed ${pushCount} prices. Bye.`);
      break;
    }

    // Sleep until the next push slot
    const nextSlot = pushCount * CONFIG.FEEDER_INTERVAL_SEC;
    const waitMs = Math.max(0, nextSlot * 1000 - (Date.now() - startMs));
    if (waitMs > 0) await sleep(waitMs);

    const tNow = (Date.now() - startMs) / 1000;
    const sample = sampleAt(samples, tNow);
    console.log(`[${fmtTime(new Date())}] t=${tNow.toFixed(0)}s phase=${sample.phase} btc=$${sample.btcUsd}`);
    const txh = await pushPrice(account, sample);
    if (txh) {
      pushCount++;
      console.log(`  ✓ tx ${txh.slice(0, 16)}...`);
    }
  }
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

main().catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});
