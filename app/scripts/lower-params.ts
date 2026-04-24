import { Account, RpcProvider } from "starknet";
import * as dotenv from "dotenv";
import * as path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, "../.env") });

const STARK_PRIME = 0x800000000000011000000000000000000000000000000000000000000000001n;

function encodeI128(value: bigint): string {
  if (value >= 0n) return "0x" + value.toString(16);
  return "0x" + (STARK_PRIME + value).toString(16);
}

const RPC = process.env.STARKNET_RPC_URL!;
const ADDRESS = process.env.AGENT_ADDRESS!;
const PK = process.env.AGENT_PRIVATE_KEY!;
const GUARD = process.env.PARAMETER_GUARD_ADDRESS!;

const provider = new RpcProvider({ nodeUrl: RPC });
const agent = new Account({ provider, address: ADDRESS, signer: PK });

const wad = (n: number) => BigInt(Math.round(n * 1e18));

// Steps: [kp, ki] per call. Max kp_delta = 2.0, cooldown = 5s.
const steps: Array<[number, number]> = [
  [6.5, 0.03],
  [4.5, 0.02],
  [2.5, 0.01],
  [2.0, 0.01],
];

async function main() {
  for (let i = 0; i < steps.length; i++) {
    const [kp, ki] = steps[i];
    const calldata = [encodeI128(wad(kp)), encodeI128(wad(ki)), "0"];
    console.log(`[${i + 1}/${steps.length}] Proposing kp=${kp}, ki=${ki}...`);
    const { transaction_hash } = await agent.execute(
      { contractAddress: GUARD, entrypoint: "propose_parameters", calldata },
      { maxFee: 10n ** 16n },
    );
    console.log(`  tx: ${transaction_hash}`);
    await provider.waitForTransaction(transaction_hash);
    console.log(`  confirmed.`);
    if (i < steps.length - 1) {
      console.log(`  sleeping 6s for cooldown...`);
      await new Promise((r) => setTimeout(r, 6000));
    }
  }
  console.log("Done. Final: kp=2.0, ki=0.01");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
