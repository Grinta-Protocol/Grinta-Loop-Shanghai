/**
 * mint-agent-identity.ts
 *
 * One-time script: mints the Grinta PID Agent's ERC-8004 NFT in the official
 * IdentityRegistry, sets canonical metadata, and binds the agent's wallet
 * via SNIP-6 signature. Output is the agent_id which feeds Guard V12's
 * constructor.
 *
 * Usage:
 *   npx tsx app/scripts/mint-agent-identity.ts
 *
 * Required env (.env):
 *   STARKNET_RPC_URL
 *   DEPLOYER_ADDRESS, DEPLOYER_PRIVATE_KEY  (NFT owner — pays gas; calls register + set_agent_wallet)
 *   AGENT_ADDRESS, AGENT_PRIVATE_KEY        (new_wallet — signs the SNIP-6 hash)
 *   IDENTITY_REGISTRY_ADDRESS               (Sepolia: 0x7856876f...e417)
 *
 * Optional env:
 *   TOKEN_URI       (default: "grinta-pid-v11" — placeholder; replace later via set_agent_uri)
 *   AGENT_NAME      (default: "Grinta-PID-V11")
 *   AGENT_TYPE      (default: "pid-governor")
 *   AGENT_VERSION   (default: "11.0")
 *
 * Output: writes ./agent-identity.json with agentId + tx hashes.
 *
 * Critical timing: the SNIP-6 deadline window is MAX_DEADLINE_DELAY=300s
 * from the contract's block_timestamp. The script signs and submits
 * immediately — do not pause between steps.
 */

import { Account, RpcProvider, CallData, byteArray, hash, ec, cairo } from "starknet";
import dotenv from "dotenv";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { writeFileSync, existsSync, readFileSync } from "fs";

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
  TOKEN_URI: process.env.TOKEN_URI || "grinta-pid-v11",
  AGENT_NAME: process.env.AGENT_NAME || "Grinta-PID-V11",
  AGENT_TYPE: process.env.AGENT_TYPE || "pid-governor",
  AGENT_VERSION: process.env.AGENT_VERSION || "11.0",
  OUT_FILE: join(__dirname, "..", "..", "agent-identity.json"),
};

const provider = new RpcProvider({ nodeUrl: CFG.RPC_URL });
const deployer = new Account({
  provider,
  address: CFG.DEPLOYER_ADDRESS,
  signer: CFG.DEPLOYER_PRIVATE_KEY,
});

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------

function buildByteArrayCalldata(s: string): string[] {
  const ba = byteArray.byteArrayFromString(s);
  return [
    ba.data.length.toString(),
    ...ba.data.map((d) => "0x" + BigInt(d).toString(16)),
    "0x" + BigInt(ba.pending_word).toString(16),
    ba.pending_word_len.toString(),
  ];
}

function buildSetMetadataCalldata(
  agentId: bigint,
  key: string,
  value: string
): string[] {
  return [
    "0x" + (agentId & ((1n << 128n) - 1n)).toString(16),
    "0x" + (agentId >> 128n).toString(16),
    ...buildByteArrayCalldata(key),
    ...buildByteArrayCalldata(value),
  ];
}

async function readU256(entrypoint: string): Promise<bigint> {
  const r = await provider.callContract({
    contractAddress: CFG.IDENTITY_REGISTRY_ADDRESS,
    entrypoint,
    calldata: [],
  });
  // u256 returns as [low, high]
  const low = BigInt(r[0]);
  const high = BigInt(r[1]);
  return (high << 128n) | low;
}

async function getWalletSetNonce(agentId: bigint): Promise<bigint> {
  const r = await provider.callContract({
    contractAddress: CFG.IDENTITY_REGISTRY_ADDRESS,
    entrypoint: "get_wallet_set_nonce",
    calldata: [
      "0x" + (agentId & ((1n << 128n) - 1n)).toString(16),
      "0x" + (agentId >> 128n).toString(16),
    ],
  });
  return BigInt(r[0]);
}

async function getLatestBlockTimestamp(): Promise<bigint> {
  const block = await provider.getBlock("latest");
  return BigInt(block.timestamp);
}

// ----------------------------------------------------------------------------
// Main flow
// ----------------------------------------------------------------------------

async function main() {
  console.log("=== Grinta Agent ERC-8004 Mint ===\n");
  console.log(`Registry:    ${CFG.IDENTITY_REGISTRY_ADDRESS}`);
  console.log(`Deployer:    ${CFG.DEPLOYER_ADDRESS}  (NFT owner)`);
  console.log(`Agent:       ${CFG.AGENT_ADDRESS}  (wallet to bind)`);
  console.log(`Token URI:   ${CFG.TOKEN_URI}`);
  console.log(`Metadata:    ${CFG.AGENT_NAME} / ${CFG.AGENT_TYPE} / v${CFG.AGENT_VERSION}\n`);

  // -------- Step 1: total_agents BEFORE → predicted agent_id --------
  const totalBefore = await readU256("total_agents");
  const predictedId = totalBefore + 1n;
  console.log(`Total agents before: ${totalBefore}`);
  console.log(`Predicted agent_id:  ${predictedId}\n`);

  // -------- Step 2: register_with_token_uri --------
  console.log("[1/3] Mint NFT...");
  const registerCalldata = buildByteArrayCalldata(CFG.TOKEN_URI);
  const { transaction_hash: mintTx } = await deployer.execute({
    contractAddress: CFG.IDENTITY_REGISTRY_ADDRESS,
    entrypoint: "register_with_token_uri",
    calldata: registerCalldata,
  });
  console.log(`  Tx: ${mintTx}`);
  await provider.waitForTransaction(mintTx);

  // Confirm: total_agents incremented
  const totalAfter = await readU256("total_agents");
  if (totalAfter !== predictedId) {
    throw new Error(
      `Mint race: total_agents jumped from ${totalBefore} to ${totalAfter}, expected ${predictedId}`
    );
  }
  const agentId = predictedId;
  console.log(`  agent_id confirmed: ${agentId}\n`);

  // -------- Step 3: set_metadata (multicall x3) --------
  console.log("[2/3] Set metadata (agentName, agentType, version)...");
  const metadataCalls = [
    { key: "agentName", value: CFG.AGENT_NAME },
    { key: "agentType", value: CFG.AGENT_TYPE },
    { key: "version", value: CFG.AGENT_VERSION },
  ].map((m) => ({
    contractAddress: CFG.IDENTITY_REGISTRY_ADDRESS,
    entrypoint: "set_metadata",
    calldata: buildSetMetadataCalldata(agentId, m.key, m.value),
  }));
  const { transaction_hash: metaTx } = await deployer.execute(metadataCalls);
  console.log(`  Tx: ${metaTx}`);
  await provider.waitForTransaction(metaTx);
  console.log(`  Metadata confirmed.\n`);

  // -------- Step 4: SNIP-6 sign + set_agent_wallet --------
  console.log("[3/3] Bind agent wallet via SNIP-6 signature...");

  const blockTs = await getLatestBlockTimestamp();
  // 240s margin under MAX_DEADLINE_DELAY=300s — leaves ~60s for tx inclusion
  const deadline = blockTs + 240n;
  const nonce = await getWalletSetNonce(agentId);
  const chainId = await provider.getChainId(); // hex felt e.g. 0x534e5f5345504f4c4941
  console.log(`  block_timestamp: ${blockTs}`);
  console.log(`  deadline:        ${deadline} (${240}s window)`);
  console.log(`  wallet nonce:    ${nonce}`);
  console.log(`  chain_id:        ${chainId}`);

  // Recreate the exact preimage the contract hashes:
  // poseidon([agent_id.low, agent_id.high, new_wallet, owner, deadline, nonce, chain_id, registry])
  const messageHash = hash.computePoseidonHashOnElements([
    "0x" + (agentId & ((1n << 128n) - 1n)).toString(16),
    "0x" + (agentId >> 128n).toString(16),
    CFG.AGENT_ADDRESS,
    CFG.DEPLOYER_ADDRESS, // owner = whoever holds the NFT (the deployer who minted)
    "0x" + deadline.toString(16),
    "0x" + nonce.toString(16),
    chainId,
    CFG.IDENTITY_REGISTRY_ADDRESS,
  ]);
  console.log(`  message_hash: ${messageHash}`);

  // Sign with the AGENT'S privkey (the new_wallet). The contract calls
  // is_valid_signature on the agent's account, which validates [r, s].
  const sig = ec.starkCurve.sign(messageHash, CFG.AGENT_PRIVATE_KEY);
  const r = "0x" + sig.r.toString(16);
  const s = "0x" + sig.s.toString(16);
  console.log(`  signature: r=${r.slice(0, 12)}... s=${s.slice(0, 12)}...`);

  // Submit set_agent_wallet from the deployer (the NFT owner)
  const bindCalldata = [
    "0x" + (agentId & ((1n << 128n) - 1n)).toString(16),
    "0x" + (agentId >> 128n).toString(16),
    CFG.AGENT_ADDRESS,
    "0x" + deadline.toString(16),
    "2", // signature array length
    r,
    s,
  ];
  const { transaction_hash: bindTx } = await deployer.execute({
    contractAddress: CFG.IDENTITY_REGISTRY_ADDRESS,
    entrypoint: "set_agent_wallet",
    calldata: bindCalldata,
  });
  console.log(`  Tx: ${bindTx}`);
  await provider.waitForTransaction(bindTx);
  console.log(`  Wallet bound.\n`);

  // -------- Persist --------
  const out = {
    agentId: "0x" + agentId.toString(16),
    agentIdDecimal: agentId.toString(),
    identityRegistry: CFG.IDENTITY_REGISTRY_ADDRESS,
    owner: CFG.DEPLOYER_ADDRESS,
    boundWallet: CFG.AGENT_ADDRESS,
    tokenUri: CFG.TOKEN_URI,
    metadata: {
      agentName: CFG.AGENT_NAME,
      agentType: CFG.AGENT_TYPE,
      version: CFG.AGENT_VERSION,
    },
    txs: { mint: mintTx, metadata: metaTx, bindWallet: bindTx },
    chainId,
    timestamp: new Date().toISOString(),
  };
  writeFileSync(CFG.OUT_FILE, JSON.stringify(out, null, 2));
  console.log("=== Done ===");
  console.log(`Saved to: ${CFG.OUT_FILE}`);
  console.log(`\nNext: deploy Guard V12 with proposer_agent_id=${out.agentId}`);
  console.log(`Voyager: https://sepolia.voyager.online/contract/${CFG.IDENTITY_REGISTRY_ADDRESS}`);
}

main().catch((e) => {
  console.error("\nFAILED:", e?.message || e);
  if (e?.stack) console.error(e.stack);
  process.exit(1);
});
