/**
 * Trader Bot — creates GRIT depeg pressure via real Ekubo swaps.
 *
 * Each cycle (every TRADER_INTERVAL_SEC):
 *  1. Reads the current CSV phase.
 *  2. Chooses swap direction + size:
 *      - During decline/capitulation → sell GRIT for USDC (depegs GRIT down).
 *      - During stabilization → buy GRIT with USDC (mild relief).
 *      - During calm → skip.
 *  3. Executes a multicall: transfer → swap → clear.
 *
 * The real swap updates the hook's market_price via `after_swap`, which is
 * what the agent + PID controller react to.
 */
import { Account, RpcProvider, CallData, type Call } from "starknet";
import { CONFIG } from "./config.js";
import { loadCrashSamples, sampleAt, type PriceSample } from "./csv-loader.js";

// ---- Swap strategy: phase → {direction, GRIT/USDC amount, base unit} ----
//
// amount is in human units; we scale by 10^decimals below.
// GRIT = 18 decimals, USDC = 6 decimals.
interface SwapPlan {
  direction: "SELL_GRIT" | "BUY_GRIT" | "SKIP";
  humanAmount: number;
  note: string;
}

function planFor(sample: PriceSample): SwapPlan {
  switch (sample.phase) {
    case "calm":
      return { direction: "SKIP", humanAmount: 0, note: "calm — no swap" };
    case "early_decline":
      return { direction: "SELL_GRIT", humanAmount: 200, note: "early decline" };
    case "acceleration":
      return { direction: "SELL_GRIT", humanAmount: 500, note: "selloff accelerating" };
    case "bottom":
      return { direction: "SELL_GRIT", humanAmount: 600, note: "at bottom" };
    case "capitulation":
      return { direction: "SELL_GRIT", humanAmount: 800, note: "capitulation" };
    case "recovery":
      return { direction: "SELL_GRIT", humanAmount: 200, note: "recovery — residual pressure" };
    case "stabilization":
      return { direction: "BUY_GRIT", humanAmount: 50, note: "stabilizing — buy GRIT with USDC" };
    default:
      return { direction: "SKIP", humanAmount: 0, note: `unknown phase ${sample.phase}` };
  }
}

const GRIT_DECIMALS = 18n;
const USDC_DECIMALS = 6n;

function toUnits(human: number, decimals: bigint): bigint {
  // Integer math to avoid float precision loss.
  const cents = BigInt(Math.round(human * 1e6)); // 6 decimals of sub-unit precision
  return (cents * 10n ** decimals) / 10n ** 6n;
}

function fmtTime(d: Date) {
  return d.toISOString().split("T")[1].slice(0, 8);
}

/** Build the transfer → swap → clear multicall for one trade */
function buildSwapCalls(
  tokenIn: string,
  tokenOut: string,
  amountIn: bigint,
): Call[] {
  // 1. Send tokens to the router (router swaps from its own balance)
  const transferCall: Call = {
    contractAddress: tokenIn,
    entrypoint: "transfer",
    calldata: CallData.compile({
      recipient: CONFIG.EKUBO_ROUTER_ADDRESS,
      amount: amountIn,
    }),
  };

  // 2. Swap: exact input (positive i129 = pay this much in)
  const swapCall: Call = {
    contractAddress: CONFIG.EKUBO_ROUTER_ADDRESS,
    entrypoint: "swap",
    calldata: CallData.compile({
      node: {
        pool_key: {
          token0: CONFIG.GRIT_ADDRESS,
          token1: CONFIG.USDC_ADDRESS,
          fee: CONFIG.POOL_FEE,
          tick_spacing: CONFIG.POOL_TICK_SPACING,
          extension: CONFIG.GRINTA_HOOK_ADDRESS,
        },
        // sqrt_ratio_limit = 0 → Router auto-picks MIN/MAX for this direction
        sqrt_ratio_limit: 0n,
        skip_ahead: 0n,
      },
      token_amount: {
        token: tokenIn,
        amount: { mag: amountIn, sign: 0 }, // positive = exact input
      },
    }),
  };

  // 3. Clear output token from the router back to us.
  //    Also clear any dust in the input token (e.g. on rounding).
  const clearOut: Call = {
    contractAddress: CONFIG.EKUBO_ROUTER_ADDRESS,
    entrypoint: "clear",
    calldata: CallData.compile({ token: tokenOut }),
  };
  const clearIn: Call = {
    contractAddress: CONFIG.EKUBO_ROUTER_ADDRESS,
    entrypoint: "clear",
    calldata: CallData.compile({ token: tokenIn }),
  };

  return [transferCall, swapCall, clearOut, clearIn];
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
  console.log("  Grinta Trader Bot");
  console.log("=".repeat(60));
  console.log(`  Wallet        : ${CONFIG.DEPLOYER_ADDRESS}`);
  console.log(`  Router        : ${CONFIG.EKUBO_ROUTER_ADDRESS}`);
  console.log(`  Pool          : GRIT ${CONFIG.GRIT_ADDRESS.slice(0, 10)}... / USDC ${CONFIG.USDC_ADDRESS.slice(0, 10)}...`);
  console.log(`  Trade cadence : every ${CONFIG.TRADER_INTERVAL_SEC}s`);
  console.log(`  Demo duration : ${CONFIG.DEMO_DURATION_SEC}s`);
  console.log("=".repeat(60));
  console.log("");

  // NOTE: we assume setup.ts has already minted USDC + opened a SAFE so the
  // trader wallet holds GRIT. If not, swaps will fail with a balance error
  // and the error message will point the user back to `npm run setup`.
  console.log("Make sure `npm run setup` has run: this bot needs GRIT + USDC balances.\n");

  // Honor the launcher's shared clock if set (so feeder/trader/agent align).
  const startMs = CONFIG.DEMO_START_TIMESTAMP_MS > 0
    ? CONFIG.DEMO_START_TIMESTAMP_MS
    : Date.now();
  const waitUntilStart = startMs - Date.now();
  if (waitUntilStart > 0) {
    console.log(`Waiting ${(waitUntilStart / 1000).toFixed(1)}s for shared demo start…`);
    await sleep(waitUntilStart);
  }
  let tradeCount = 0;
  let skipCount = 0;

  while (true) {
    const elapsedSec = (Date.now() - startMs) / 1000;
    if (elapsedSec >= CONFIG.DEMO_DURATION_SEC) {
      console.log(
        `\nDemo duration reached (${CONFIG.DEMO_DURATION_SEC}s). ` +
        `Trades: ${tradeCount}, skips: ${skipCount}. Bye.`,
      );
      break;
    }

    const sample = sampleAt(samples, elapsedSec);
    const plan = planFor(sample);

    if (plan.direction === "SKIP") {
      console.log(
        `[${fmtTime(new Date())}] t=${elapsedSec.toFixed(0)}s phase=${sample.phase} → skip (${plan.note})`,
      );
      skipCount++;
    } else {
      const isGritOut = plan.direction === "BUY_GRIT";
      const tokenIn = isGritOut ? CONFIG.USDC_ADDRESS : CONFIG.GRIT_ADDRESS;
      const tokenOut = isGritOut ? CONFIG.GRIT_ADDRESS : CONFIG.USDC_ADDRESS;
      const decimalsIn = isGritOut ? USDC_DECIMALS : GRIT_DECIMALS;
      const amountIn = toUnits(plan.humanAmount, decimalsIn);

      console.log(
        `[${fmtTime(new Date())}] t=${elapsedSec.toFixed(0)}s phase=${sample.phase} ` +
        `→ ${plan.direction} ${plan.humanAmount} (${plan.note})`,
      );

      const calls = buildSwapCalls(tokenIn, tokenOut, amountIn);
      try {
        const { transaction_hash } = await account.execute(calls);
        console.log(`  ✓ tx ${transaction_hash.slice(0, 16)}...`);
        await account.waitForTransaction(transaction_hash);
        tradeCount++;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`  ✗ swap failed: ${msg.slice(0, 240)}`);
      }
    }

    // Sleep to the next trade slot (absolute, not drift-prone)
    const nextSlot = (tradeCount + skipCount) * CONFIG.TRADER_INTERVAL_SEC;
    const waitMs = Math.max(0, nextSlot * 1000 - (Date.now() - startMs));
    if (waitMs > 0) await sleep(waitMs);
  }
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

main().catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});
