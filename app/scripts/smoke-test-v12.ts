/**
 * smoke-test-v12.ts — Verify Guard V12 end-to-end:
 *   1. Read on-chain state (policy, agent_id, registry).
 *   2. Have the agent submit a hold-equivalent propose_parameters
 *      (current kp/ki, no change) and confirm ProposalAttributed event fires.
 */
import { Account, RpcProvider } from "starknet";
import dotenv from "dotenv";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, "..", ".env") });

const STARK_PRIME = 0x800000000000011000000000000000000000000000000000000000000000001n;
const enc = (v: bigint) => v >= 0n ? "0x" + v.toString(16) : "0x" + (STARK_PRIME + v).toString(16);

const provider = new RpcProvider({ nodeUrl: process.env.STARKNET_RPC_URL! });
const agent = new Account({ provider, address: process.env.AGENT_ADDRESS!, signer: process.env.AGENT_PRIVATE_KEY! });
const GUARD = process.env.PARAMETER_GUARD_ADDRESS!;
const PID = process.env.PID_CONTROLLER_ADDRESS!;

const BOUNDS = {
  l1_gas: { max_amount: 0n, max_price_per_unit: 0x5af3107a4000n },
  l2_gas: { max_amount: 8_000_000n, max_price_per_unit: 12_000_000_000n },
  l1_data_gas: { max_amount: 0x300n, max_price_per_unit: 0x100000000n },
};

(async () => {
  console.log("Guard V12:", GUARD);

  // 1. Read current PID gains
  const gains = await provider.callContract({ contractAddress: PID, entrypoint: "get_controller_gains", calldata: [] });
  const kp = BigInt(gains[0]);
  const ki = BigInt(gains[1]);
  console.log(`Current kp=${kp}, ki=${ki}`);

  // 2. Read V12 identity config
  const reg = await provider.callContract({ contractAddress: GUARD, entrypoint: "get_identity_registry", calldata: [] });
  const id = await provider.callContract({ contractAddress: GUARD, entrypoint: "get_proposer_agent_id", calldata: [] });
  console.log(`V12.identity_registry: ${reg[0]}`);
  console.log(`V12.proposer_agent_id: ${(BigInt(id[1]) << 128n) | BigInt(id[0])}`);

  // 3. Smoke test: propose CURRENT values (delta=0, no policy change). Should succeed if auth works.
  console.log(`\nProposing kp=kp (delta 0), ki=ki — auth-only test...`);
  const tx = await agent.execute(
    { contractAddress: GUARD, entrypoint: "propose_parameters", calldata: [enc(kp), enc(ki), "0"] },
    { resourceBounds: BOUNDS as any }
  );
  console.log(`  tx: ${tx.transaction_hash}`);
  const r: any = await provider.waitForTransaction(tx.transaction_hash);
  if (r.execution_status === "REVERTED") {
    console.error(`  REVERTED: ${r.revert_reason}`);
    process.exit(1);
  }
  console.log(`  confirmed.`);

  // Look for ProposalAttributed event
  const events = r.events || [];
  const guardEvents = events.filter((e: any) => e.from_address.toLowerCase() === GUARD.toLowerCase());
  console.log(`\nGuard emitted ${guardEvents.length} events:`);
  for (const e of guardEvents) {
    console.log(`  selector ${e.keys[0].slice(0, 14)}... keys=[${e.keys.length}] data=[${e.data.length}]`);
  }
})().catch(e => { console.error("FAILED:", e?.message || e); process.exit(1); });
