/**
 * publish-agent-registration.ts
 *
 * Generate the ERC-8004 registration JSON for the Grinta PID Agent,
 * upload to Filecoin via Lighthouse, then point the IdentityRegistry's
 * token_uri at the new CID. Three modes via flags:
 *
 *   --dry-run        Print JSON to stdout, exit. No uploads, no tx.
 *   --upload-only    Print JSON, upload to Lighthouse, print CID, exit.
 *   (default)        Print JSON, upload, call set_agent_uri on chain.
 *
 * Usage:
 *   npx tsx app/scripts/publish-agent-registration.ts --dry-run
 *   npx tsx app/scripts/publish-agent-registration.ts --upload-only
 *   npx tsx app/scripts/publish-agent-registration.ts
 *
 * Required env (.env):
 *   STARKNET_RPC_URL
 *   DEPLOYER_ADDRESS, DEPLOYER_PRIVATE_KEY  (NFT owner — calls set_agent_uri)
 *   IDENTITY_REGISTRY_ADDRESS
 *   LIGHTHOUSE_API_KEY                       (skipped in --dry-run)
 *
 * Optional env (override defaults from agent-identity.json / sensible fallbacks):
 *   AGENT_ID                  (default: read from agent-identity.json)
 *   PUBLIC_API_URL            (default: "https://grinta.example.com")
 *   DECISIONS_IPNS            (default: read from app/server/lighthouse-ipns.json if present)
 *   PARAMETER_GUARD_ADDRESS   (default: read from .env or deployed_v11.json)
 *
 * Reads:
 *   - agent-identity.json (output of mint-agent-identity.ts) for agentId + chainId
 *
 * Writes (default mode only):
 *   - Updates agent-identity.json with `tokenUri` and `setAgentUriTx` fields
 */

import { Account, RpcProvider, byteArray } from "starknet";
// lighthouse imported lazily inside main() so --dry-run works without the SDK installed
import dotenv from "dotenv";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { writeFileSync, readFileSync, existsSync } from "fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, "..", ".env") });

const FLAGS = {
  dryRun: process.argv.includes("--dry-run"),
  uploadOnly: process.argv.includes("--upload-only"),
};

function req(key: string): string {
  const v = process.env[key];
  if (!v) throw new Error(`Missing env: ${key}`);
  return v;
}

const IDENTITY_FILE = join(__dirname, "..", "..", "agent-identity.json");
const IPNS_FILE = join(__dirname, "..", "server", "lighthouse-ipns.json");

function readIdentityFile(): {
  agentId: string;
  agentIdDecimal: string;
  identityRegistry: string;
  chainId: string;
  metadata: { agentName: string; agentType: string; version: string };
} {
  if (!existsSync(IDENTITY_FILE)) {
    throw new Error(
      `agent-identity.json not found at ${IDENTITY_FILE}. Run mint-agent-identity.ts first.`
    );
  }
  return JSON.parse(readFileSync(IDENTITY_FILE, "utf-8"));
}

function readDecisionsIpns(): string {
  if (process.env.DECISIONS_IPNS) return process.env.DECISIONS_IPNS;
  if (existsSync(IPNS_FILE)) {
    const cache = JSON.parse(readFileSync(IPNS_FILE, "utf-8"));
    return `ipfs://${cache.ipnsName}`;
  }
  return "ipfs://<decisions-ipns-not-yet-published>";
}

// ----------------------------------------------------------------------------
// Build the ERC-8004 registration JSON
// ----------------------------------------------------------------------------

function buildRegistrationJson(args: {
  agentId: string;
  agentIdDecimal: string;
  identityRegistry: string;
  chainId: string;
  metadata: { agentName: string; agentType: string; version: string };
}) {
  const chainCaip = chainIdToCaip(args.chainId);
  const apiUrl = process.env.PUBLIC_API_URL || "https://grinta.example.com";
  const decisionsUri = readDecisionsIpns();

  const guard = process.env.PARAMETER_GUARD_ADDRESS || "<GUARD_V12_TBD>";
  const pid =
    process.env.PID_CONTROLLER_ADDRESS ||
    "0x077ce1bdf9671da93542730a7f20825b8edabd2a5dfedaab23a2ac1c47791125";
  const safe =
    process.env.SAFE_ENGINE_ADDRESS ||
    "0x07417b07b7ac71dd816c8d880f4dc1f74c10911aa174305a9146e1b56ef60272";

  return {
    type: "ERC-8004:AgentRegistration:v1",
    name: args.metadata.agentName,
    description:
      "Autonomous PID controller agent for the Grinta CDP protocol on Starknet Sepolia. " +
      "Tunes redemption-rate gains (Kp, Ki) within bounded parameters to defend the GRIT " +
      "stablecoin peg during BTC volatility events. Decisions are bounded on-chain by " +
      "ParameterGuard and reasoning is published as a Filecoin/IPNS feed.",
    agentType: args.metadata.agentType,
    version: args.metadata.version,
    model: "zai-org/glm-5.1",
    framework: "node + starknet.js + commonstack-llm",
    services: [
      {
        type: "decision-feed",
        uri: decisionsUri,
        description:
          "JSONL stream of every PID adjustment with full LLM reasoning, archived on Filecoin",
      },
      {
        type: "rest-api",
        uri: apiUrl,
        description: "Live protocol state + agent trigger endpoint",
      },
      {
        type: "sse-stream",
        uri: `${apiUrl}/api/stream`,
        description: "Server-Sent Events stream of agent cycles",
      },
    ],
    registrations: [
      {
        agentId: Number(args.agentIdDecimal),
        agentRegistry: `${chainCaip}:${args.identityRegistry}`,
      },
    ],
    supportedTrust: ["validation"],
    extensions: {
      "grinta:controlledBy": {
        parameterGuard: `${chainCaip}:${guard}`,
        pidController: `${chainCaip}:${pid}`,
        safeEngine: `${chainCaip}:${safe}`,
      },
      "grinta:policy": {
        kp_range_wad: ["3.333e-7", "1e-6"],
        ki_range_wad: ["3.333e-13", "1e-12"],
        max_kp_delta_wad: "6.667e-8",
        max_ki_delta_wad: "6.667e-14",
        cooldown_seconds: 5,
        emergency_cooldown_seconds: 3,
        max_updates: 1000,
      },
    },
  };
}

function chainIdToCaip(chainId: string): string {
  // chainId is the felt-encoded ASCII string. Decode to recover "SN_SEPOLIA" / "SN_MAIN".
  const hex = chainId.startsWith("0x") ? chainId.slice(2) : chainId;
  const bytes = Buffer.from(hex.padStart(hex.length + (hex.length % 2), "0"), "hex");
  const ascii = bytes.toString("utf-8").replace(/\0+/g, "");
  return `starknet:${ascii}`;
}

// ----------------------------------------------------------------------------
// Main
// ----------------------------------------------------------------------------

async function main() {
  const identity = readIdentityFile();
  const json = buildRegistrationJson(identity);

  console.log("=== ERC-8004 Registration JSON ===\n");
  console.log(JSON.stringify(json, null, 2));
  console.log("");

  if (FLAGS.dryRun) {
    console.log("--dry-run: exiting without upload or tx.");
    return;
  }

  // -------- Upload to Lighthouse --------
  const apiKey = req("LIGHTHOUSE_API_KEY");
  console.log("Uploading to Filecoin via Lighthouse...");

  const { default: lighthouse } = await import("@lighthouse-web3/sdk");
  const buf = Buffer.from(JSON.stringify(json, null, 2), "utf-8");
  const upload: any = await lighthouse.uploadBuffer(buf, apiKey);
  const cid: string = upload?.data?.Hash || upload?.data?.cid || upload?.cid;
  if (!cid) {
    console.error("Upload result:", upload);
    throw new Error("Lighthouse did not return a CID");
  }
  const newUri = `ipfs://${cid}`;
  console.log(`  Uploaded: ${cid}`);
  console.log(`  Gateway:  https://gateway.lighthouse.storage/ipfs/${cid}`);
  console.log(`  URI:      ${newUri}\n`);

  if (FLAGS.uploadOnly) {
    console.log(
      "--upload-only: stopping before set_agent_uri. To finish, re-run without --upload-only,"
    );
    console.log(`or call set_agent_uri(${identity.agentIdDecimal}, "${newUri}") manually.`);
    return;
  }

  // -------- Call set_agent_uri --------
  console.log("Calling set_agent_uri on IdentityRegistry...");

  const provider = new RpcProvider({ nodeUrl: req("STARKNET_RPC_URL") });
  const deployer = new Account({
    provider,
    address: req("DEPLOYER_ADDRESS"),
    signer: req("DEPLOYER_PRIVATE_KEY"),
  });

  const agentIdBig = BigInt(identity.agentId);
  const uriBA = byteArray.byteArrayFromString(newUri);
  const calldata = [
    "0x" + (agentIdBig & ((1n << 128n) - 1n)).toString(16),
    "0x" + (agentIdBig >> 128n).toString(16),
    uriBA.data.length.toString(),
    ...uriBA.data.map((d: any) => "0x" + BigInt(d).toString(16)),
    "0x" + BigInt(uriBA.pending_word).toString(16),
    uriBA.pending_word_len.toString(),
  ];

  const { transaction_hash } = await deployer.execute({
    contractAddress: identity.identityRegistry,
    entrypoint: "set_agent_uri",
    calldata,
  });
  console.log(`  Tx: ${transaction_hash}`);
  await provider.waitForTransaction(transaction_hash);
  console.log(`  Confirmed.\n`);

  // -------- Persist back to agent-identity.json --------
  const updated = {
    ...identity,
    tokenUri: newUri,
    tokenUriCid: cid,
    setAgentUriTx: transaction_hash,
    registrationPublishedAt: new Date().toISOString(),
  };
  writeFileSync(IDENTITY_FILE, JSON.stringify(updated, null, 2));
  console.log(`Updated ${IDENTITY_FILE} with tokenUri.`);
  console.log("\n=== Done ===");
}

main().catch((e) => {
  console.error("\nFAILED:", e?.message || e);
  if (e?.stack) console.error(e.stack);
  process.exit(1);
});
