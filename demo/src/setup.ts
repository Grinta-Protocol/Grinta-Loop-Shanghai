/**
 * Demo bootstrap — one-time on-chain setup BEFORE running the demo.
 *
 * Steps:
 *  1. Mint MockUSDC + MockWBTC to the trader (deployer wallet acts as trader).
 *  2. Approve SafeManager to spend WBTC.
 *  3. Open a SAFE via `open_and_borrow`: deposit WBTC, mint GRIT.
 *  4. Shorten the hook throttles for demo purposes
 *     (set_price_update_interval / set_rate_update_interval).
 *  5. (Optional) Register the agent in ParameterGuard via `set_agent`.
 *
 * Idempotent-ish: re-running mints more tokens, opens another SAFE.
 * Run once after a fresh deployment.
 */
import { Account, RpcProvider, CallData, type Call } from "starknet";
import { CONFIG } from "./config.js";

function log(...args: unknown[]) {
  console.log(`[setup]`, ...args);
}

async function main() {
  const provider = new RpcProvider({ nodeUrl: CONFIG.RPC_URL });
  const account = new Account({
    provider,
    address: CONFIG.DEPLOYER_ADDRESS,
    signer: CONFIG.DEPLOYER_PRIVATE_KEY,
  });

  log("=".repeat(60));
  log("Grinta Demo Bootstrap");
  log("=".repeat(60));
  log(`Wallet (trader+admin): ${CONFIG.DEPLOYER_ADDRESS}`);
  log(`Hook                 : ${CONFIG.GRINTA_HOOK_ADDRESS}`);
  log(`SafeManager          : ${CONFIG.SAFE_MANAGER_ADDRESS}`);
  log(`ParameterGuard       : ${CONFIG.PARAMETER_GUARD_ADDRESS || "(not deployed yet — skipping agent reg)"}`);
  log("");

  // ---- 1. Mint mock tokens to trader ----
  log(`Step 1 — minting ${CONFIG.SETUP_USDC_MINT} USDC + ${CONFIG.SETUP_WBTC_MINT} WBTC to trader`);
  const mintCalls: Call[] = [
    {
      contractAddress: CONFIG.USDC_ADDRESS,
      entrypoint: "mint",
      calldata: CallData.compile({
        to: CONFIG.DEPLOYER_ADDRESS,
        amount: CONFIG.SETUP_USDC_MINT,
      }),
    },
    {
      contractAddress: CONFIG.WBTC_ADDRESS,
      entrypoint: "mint",
      calldata: CallData.compile({
        to: CONFIG.DEPLOYER_ADDRESS,
        amount: CONFIG.SETUP_WBTC_MINT,
      }),
    },
  ];
  await runAndWait(account, mintCalls, "mint mocks");

  // ---- 2. Approve SafeManager + 3. Open SAFE ----
  log(
    `Step 2+3 — approve SafeManager for WBTC, then open_and_borrow ` +
    `(${CONFIG.SETUP_WBTC_DEPOSIT} WBTC → ${CONFIG.SETUP_GRIT_BORROW} GRIT)`,
  );
  const safeCalls: Call[] = [
    {
      contractAddress: CONFIG.WBTC_ADDRESS,
      entrypoint: "approve",
      calldata: CallData.compile({
        spender: CONFIG.SAFE_MANAGER_ADDRESS,
        amount: CONFIG.SETUP_WBTC_DEPOSIT,
      }),
    },
    {
      contractAddress: CONFIG.SAFE_MANAGER_ADDRESS,
      entrypoint: "open_and_borrow",
      calldata: CallData.compile({
        collateral_amount: CONFIG.SETUP_WBTC_DEPOSIT,
        borrow_amount: CONFIG.SETUP_GRIT_BORROW,
      }),
    },
  ];
  await runAndWait(account, safeCalls, "open SAFE");

  // ---- 4. Shorten hook throttles ----
  log(
    `Step 4 — shorten hook throttles ` +
    `(price=${CONFIG.DEMO_PRICE_INTERVAL}s, rate=${CONFIG.DEMO_RATE_INTERVAL}s)`,
  );
  const throttleCalls: Call[] = [
    {
      contractAddress: CONFIG.GRINTA_HOOK_ADDRESS,
      entrypoint: "set_price_update_interval",
      calldata: CallData.compile({ interval: CONFIG.DEMO_PRICE_INTERVAL }),
    },
    {
      contractAddress: CONFIG.GRINTA_HOOK_ADDRESS,
      entrypoint: "set_rate_update_interval",
      calldata: CallData.compile({ interval: CONFIG.DEMO_RATE_INTERVAL }),
    },
  ];
  await runAndWait(account, throttleCalls, "shorten throttles");

  // ---- 5. Register agent in ParameterGuard (optional) ----
  if (CONFIG.PARAMETER_GUARD_ADDRESS && CONFIG.AGENT_ADDRESS_TO_REGISTER) {
    log(`Step 5 — register agent ${CONFIG.AGENT_ADDRESS_TO_REGISTER} in ParameterGuard`);
    const regCall: Call[] = [
      {
        contractAddress: CONFIG.PARAMETER_GUARD_ADDRESS,
        entrypoint: "set_agent",
        calldata: CallData.compile({ agent: CONFIG.AGENT_ADDRESS_TO_REGISTER }),
      },
    ];
    await runAndWait(account, regCall, "register agent");
  } else {
    log("Step 5 — skipped (PARAMETER_GUARD_ADDRESS or AGENT_ADDRESS_TO_REGISTER not set)");
  }

  log("");
  log("Bootstrap complete. You can now run: npm run launch");
}

async function runAndWait(account: Account, calls: Call[], label: string) {
  try {
    const { transaction_hash } = await account.execute(calls);
    log(`  ✓ ${label} tx ${transaction_hash}`);
    await account.waitForTransaction(transaction_hash);
    log(`  ✓ ${label} confirmed`);
  } catch (err) {
    log(`  ✗ ${label} failed:`, err instanceof Error ? err.message : err);
    throw err;
  }
}

main().catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});
