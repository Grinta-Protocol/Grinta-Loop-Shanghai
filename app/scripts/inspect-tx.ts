/**
 * Inspect a Starknet tx — execution_status, revert reason, fee paid.
 * Usage: npx tsx scripts/inspect-tx.ts <tx_hash>
 */
import { RpcProvider } from "starknet";
import dotenv from "dotenv";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, "..", ".env") });

const provider = new RpcProvider({ nodeUrl: process.env.STARKNET_RPC_URL! });

(async () => {
  const tx = process.argv[2];
  if (!tx) throw new Error("Usage: inspect-tx.ts <tx_hash>");
  const r: any = await provider.getTransactionReceipt(tx);
  console.log("execution_status:", r.execution_status);
  console.log("finality_status: ", r.finality_status);
  if (r.revert_reason) console.log("revert_reason:   ", r.revert_reason);
  if (r.actual_fee) console.log("actual_fee:      ", r.actual_fee);
  console.log("block_number:    ", r.block_number);
  console.log("events:          ", (r.events || []).length);
})();
