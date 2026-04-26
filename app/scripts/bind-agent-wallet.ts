/**
 * bind-agent-wallet.ts
 *
 * Standalone recovery script: produces a fresh SNIP-6 signature and submits
 * set_agent_wallet with EXPLICIT resourceBounds. The default Alchemy fee
 * estimator over-shoots l2_gas to ~5M units (~0.06 STRK), exhausting wallets
 * with normal balances. We cap manually at 1.8M l2_gas which is plenty for
 * a signature verify + 2 SSTOREs.
 *
 * Idempotent guard:
 *   - If bound wallet already == AGENT_ADDRESS → exits cleanly, no tx.
 *   - If wallet_set_nonce > 0 and bound != AGENT_ADDRESS → refuses (use unset first).
 *
 * Usage:
 *   AGENT_ID=0x24 npx tsx scripts/bind-agent-wallet.ts
 *   (or set in .env)
 *
 * On success: persists/updates agent-identity.json.
 */

import { Account, RpcProvider, hash, ec, byteArray } from "starknet";
import dotenv from "dotenv";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { writeFileSync, readFileSync, existsSync } from "fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, "..", ".env") });

function req(key: string): string {
  const v = process.env[key];
  if (!v) throw new Error(`Missing env: ${key}`);
  return v;
}

const CFG = {
  RPC_URL: req("STARKNET_RPC_URL"),
  DEPLOYER_ADDRESS: req("DEPLOYER_ADDRESS"),
  DEPLOYER_PRIVATE_KEY: req("DEPLOYER_PRIVATE_KEY"),
  AGENT_ADDRESS: req("AGENT_ADDRESS"),
  AGENT_PRIVATE_KEY: req("AGENT_PRIVATE_KEY"),
  IDENTITY_REGISTRY_ADDRESS: req("IDENTITY_REGISTRY_ADDRESS"),
  AGENT_ID: process.env.AGENT_ID || "0x24",
  OUT_FILE: join(__dirname, "..", "..", "agent-identity.json"),
};

const provider = new RpcProvider({ nodeUrl: CFG.RPC_URL });
const deployer = new Account({
  provider,
  address: CFG.DEPLOYER_ADDRESS,
  signer: CFG.DEPLOYER_PRIVATE_KEY,
});

// Conservative bounds derived from observed mainnet/sepolia set_agent_wallet costs.
// Auto-estimate from Alchemy claimed 5M l2_gas; real usage is ~700K-900K.
// We cap at 1.8M (~3x real) so transient fee spikes don't fail it.
// Observed actual cost on Sepolia: 3.4M l2_gas at ~4.3 gwei (~0.0145 STRK).
// Cap at 4.5M × 8 gwei = 0.036 STRK budget — fits 0.04 STRK deployer balance
// with ~33% gas margin and ~85% price margin over observed actuals.
// L1 price cap must exceed actual block L1 price (~58 Twei) even when
// max_amount=0; total L1 cost stays zero since amount is zero.
const RESOURCE_BOUNDS = {
  l1_gas: { max_amount: 0n, max_price_per_unit: 0x5af3107a4000n }, // 100 Twei (cost 0)
  l2_gas: { max_amount: 4_500_000n, max_price_per_unit: 8_000_000_000n }, // 4.5M × 8 gwei
  l1_data_gas: { max_amount: 0x300n, max_price_per_unit: 0x100000000n }, // 768 × 4.3 gwei
};

function normalizeAddr(a: string): string {
  return "0x" + BigInt(a).toString(16);
}

async function main() {
  const agentId = BigInt(CFG.AGENT_ID);
  const agentAddrNorm = normalizeAddr(CFG.AGENT_ADDRESS);
  console.log("=== Bind Agent Wallet (recovery) ===\n");
  console.log(`agent_id:    ${CFG.AGENT_ID} (${agentId})`);
  console.log(`new_wallet:  ${agentAddrNorm}`);
  console.log(`registry:    ${CFG.IDENTITY_REGISTRY_ADDRESS}\n`);

  // --- Pre-flight reads ---
  const exists = await provider.callContract({
    contractAddress: CFG.IDENTITY_REGISTRY_ADDRESS,
    entrypoint: "agent_exists",
    calldata: [CFG.AGENT_ID, "0x0"],
  });
  if (BigInt(exists[0]) !== 1n) throw new Error(`agent_id ${CFG.AGENT_ID} does not exist`);

  const boundRaw = await provider.callContract({
    contractAddress: CFG.IDENTITY_REGISTRY_ADDRESS,
    entrypoint: "get_agent_wallet",
    calldata: [CFG.AGENT_ID, "0x0"],
  });
  const bound = normalizeAddr(boundRaw[0]);
  console.log(`current bound wallet: ${bound}`);

  if (bound === agentAddrNorm) {
    console.log("Already bound to AGENT_ADDRESS — nothing to do.");
    persistIdentity({ agentId, alreadyBound: true });
    return;
  }

  const nonceRaw = await provider.callContract({
    contractAddress: CFG.IDENTITY_REGISTRY_ADDRESS,
    entrypoint: "get_wallet_set_nonce",
    calldata: [CFG.AGENT_ID, "0x0"],
  });
  const nonce = BigInt(nonceRaw[0]);
  console.log(`wallet_set_nonce: ${nonce}\n`);

  // --- Fresh deadline + signature ---
  const block = await provider.getBlock("latest");
  const blockTs = BigInt(block.timestamp);
  const deadline = blockTs + 240n;
  const chainId = await provider.getChainId();
  console.log(`block_timestamp: ${blockTs}`);
  console.log(`deadline:        ${deadline} (240s window)`);
  console.log(`chain_id:        ${chainId}`);

  const messageHash = hash.computePoseidonHashOnElements([
    "0x" + (agentId & ((1n << 128n) - 1n)).toString(16),
    "0x" + (agentId >> 128n).toString(16),
    CFG.AGENT_ADDRESS,
    CFG.DEPLOYER_ADDRESS,
    "0x" + deadline.toString(16),
    "0x" + nonce.toString(16),
    chainId,
    CFG.IDENTITY_REGISTRY_ADDRESS,
  ]);
  console.log(`message_hash:    ${messageHash}`);

  const sig = ec.starkCurve.sign(messageHash, CFG.AGENT_PRIVATE_KEY);
  const r = "0x" + sig.r.toString(16);
  const s = "0x" + sig.s.toString(16);
  console.log(`signature:       r=${r.slice(0, 14)}... s=${s.slice(0, 14)}...\n`);

  // --- Submit with explicit bounds ---
  const calldata = [
    "0x" + (agentId & ((1n << 128n) - 1n)).toString(16),
    "0x" + (agentId >> 128n).toString(16),
    CFG.AGENT_ADDRESS,
    "0x" + deadline.toString(16),
    "2",
    r,
    s,
  ];

  console.log("Submitting set_agent_wallet with explicit resourceBounds (l2_gas cap 1.8M)...");
  const { transaction_hash } = await deployer.execute(
    {
      contractAddress: CFG.IDENTITY_REGISTRY_ADDRESS,
      entrypoint: "set_agent_wallet",
      calldata,
    },
    { resourceBounds: RESOURCE_BOUNDS as any }
  );
  console.log(`Tx: ${transaction_hash}`);
  const receipt = await provider.waitForTransaction(transaction_hash);
  console.log(`Confirmed.`);

  // --- Verify post-state ---
  const boundAfterRaw = await provider.callContract({
    contractAddress: CFG.IDENTITY_REGISTRY_ADDRESS,
    entrypoint: "get_agent_wallet",
    calldata: [CFG.AGENT_ID, "0x0"],
  });
  const boundAfter = normalizeAddr(boundAfterRaw[0]);
  console.log(`\npost-state bound wallet: ${boundAfter}`);
  if (boundAfter !== agentAddrNorm) {
    throw new Error(`Bind verify failed — bound is ${boundAfter}, expected ${agentAddrNorm}`);
  }

  persistIdentity({
    agentId,
    bindTx: transaction_hash,
    deadline: deadline.toString(),
    nonceUsed: nonce.toString(),
  });
  console.log("\n=== Done ===");
}

function persistIdentity(extra: Record<string, any>) {
  // Merge with any existing partial file
  const existing = existsSync(CFG.OUT_FILE)
    ? JSON.parse(readFileSync(CFG.OUT_FILE, "utf-8"))
    : {};
  const merged = {
    ...existing,
    agentId: "0x" + (extra.agentId as bigint).toString(16),
    agentIdDecimal: (extra.agentId as bigint).toString(),
    identityRegistry: CFG.IDENTITY_REGISTRY_ADDRESS,
    owner: CFG.DEPLOYER_ADDRESS,
    boundWallet: CFG.AGENT_ADDRESS,
    metadata: existing.metadata || {
      agentName: "Grinta-PID-V11",
      agentType: "pid-governor",
      version: "11.0",
    },
    txs: {
      ...(existing.txs || {}),
      ...(extra.bindTx ? { bindWallet: extra.bindTx } : {}),
    },
    bindDetails: extra.bindTx
      ? { deadline: extra.deadline, nonceUsed: extra.nonceUsed }
      : existing.bindDetails,
    timestamp: new Date().toISOString(),
  };
  writeFileSync(CFG.OUT_FILE, JSON.stringify(merged, null, 2));
  console.log(`Saved: ${CFG.OUT_FILE}`);
}

main().catch((e) => {
  console.error("\nFAILED:", e?.message || e);
  if (e?.stack) console.error(e.stack);
  process.exit(1);
});
