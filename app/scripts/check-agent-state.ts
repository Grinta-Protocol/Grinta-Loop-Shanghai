/**
 * Read-only sanity check of an ERC-8004 agent's on-chain state + deployer STRK balance.
 * Usage: npx tsx scripts/check-agent-state.ts [agent_id_hex]   (default: 0x24 = 36)
 */
import { RpcProvider, byteArray } from "starknet";
import dotenv from "dotenv";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, "..", ".env") });

const provider = new RpcProvider({ nodeUrl: process.env.STARKNET_RPC_URL! });
const REG = process.env.IDENTITY_REGISTRY_ADDRESS!;

async function readMetadata(id: string, key: string): Promise<string> {
  const ba = byteArray.byteArrayFromString(key);
  const calldata = [
    id,
    "0x0",
    ba.data.length.toString(),
    ...ba.data.map((d: any) => "0x" + BigInt(d).toString(16)),
    "0x" + BigInt(ba.pending_word).toString(16),
    ba.pending_word_len.toString(),
  ];
  const r = await provider.callContract({
    contractAddress: REG,
    entrypoint: "get_metadata",
    calldata,
  });
  const dataLen = Number(BigInt(r[0]));
  const chunks: string[] = [];
  for (let i = 0; i < dataLen; i++) {
    const felt = BigInt(r[1 + i]);
    const hex = felt.toString(16).padStart(62, "0");
    chunks.push(Buffer.from(hex, "hex").toString("utf8"));
  }
  const pendingWord = BigInt(r[1 + dataLen]);
  const pendingWordLen = Number(BigInt(r[2 + dataLen]));
  if (pendingWordLen > 0) {
    chunks.push(
      Buffer.from(
        pendingWord.toString(16).padStart(pendingWordLen * 2, "0"),
        "hex"
      ).toString("utf8")
    );
  }
  return chunks.join("");
}

(async () => {
  const id = process.argv[2] || "0x24";
  console.log(`Checking agent_id ${id} on registry ${REG}\n`);

  const exists = await provider.callContract({
    contractAddress: REG,
    entrypoint: "agent_exists",
    calldata: [id, "0x0"],
  });
  console.log(`agent_exists:        ${BigInt(exists[0]) === 1n}`);

  const wallet = await provider.callContract({
    contractAddress: REG,
    entrypoint: "get_agent_wallet",
    calldata: [id, "0x0"],
  });
  console.log(`bound wallet:        ${wallet[0]}`);

  const nonce = await provider.callContract({
    contractAddress: REG,
    entrypoint: "get_wallet_set_nonce",
    calldata: [id, "0x0"],
  });
  console.log(`wallet_set_nonce:    ${BigInt(nonce[0])}`);

  const total = await provider.callContract({
    contractAddress: REG,
    entrypoint: "total_agents",
    calldata: [],
  });
  console.log(`total_agents:        ${(BigInt(total[1]) << 128n) | BigInt(total[0])}`);

  console.log("\nMetadata:");
  for (const k of ["agentName", "agentType", "version"]) {
    console.log(`  ${k}: "${await readMetadata(id, k)}"`);
  }

  const STRK = "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d";
  const dep = process.env.DEPLOYER_ADDRESS!;
  const bal = await provider.callContract({
    contractAddress: STRK,
    entrypoint: "balanceOf",
    calldata: [dep],
  });
  const balWei = (BigInt(bal[1]) << 128n) | BigInt(bal[0]);
  console.log(`\nDeployer STRK:       ${(Number(balWei) / 1e18).toFixed(6)} STRK`);
})();
