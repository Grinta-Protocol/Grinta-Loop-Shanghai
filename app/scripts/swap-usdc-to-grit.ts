// Swap USDC → GRIT to push GRIT price up toward peg.
import { Account, RpcProvider, CallData, cairo, Call } from "starknet";
import * as dotenv from "dotenv";
import * as path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, "../.env") });

const provider = new RpcProvider({ nodeUrl: process.env.STARKNET_RPC_URL! });
const deployer = new Account({
  provider,
  address: process.env.DEPLOYER_ADDRESS!,
  signer: process.env.DEPLOYER_PRIVATE_KEY!,
});

const ROUTER = process.env.EKUBO_ROUTER_ADDRESS!;
const GRIT = process.env.SAFE_ENGINE_ADDRESS!;
const USDC = process.env.USDC_ADDRESS!;
const HOOK = process.env.GRINTA_HOOK_ADDRESS!;
const POOL_FEE = BigInt(process.env.POOL_FEE || "0");
const POOL_TICK_SPACING = BigInt(process.env.POOL_TICK_SPACING || "1000");

async function getMarket() {
  const mp = await provider.callContract({ contractAddress: HOOK, entrypoint: "get_market_price" });
  return Number(BigInt(mp[0])) / 1e18;
}

async function swap(usdcAmount6dec: bigint) {
  const calls: Call[] = [
    {
      contractAddress: USDC,
      entrypoint: "approve",
      calldata: CallData.compile({ spender: ROUTER, amount: cairo.uint256(usdcAmount6dec) }),
    },
    {
      contractAddress: USDC,
      entrypoint: "transfer",
      calldata: CallData.compile({ recipient: ROUTER, amount: cairo.uint256(usdcAmount6dec) }),
    },
    {
      contractAddress: ROUTER,
      entrypoint: "swap",
      calldata: CallData.compile({
        node: {
          pool_key: {
            token0: USDC,
            token1: GRIT,
            fee: POOL_FEE,
            tick_spacing: POOL_TICK_SPACING,
            extension: HOOK,
          },
          sqrt_ratio_limit: cairo.uint256(0n),
          skip_ahead: 0n,
        },
        token_amount: {
          token: USDC,
          amount: { mag: usdcAmount6dec, sign: 0 },
        },
      }),
    },
    { contractAddress: ROUTER, entrypoint: "clear", calldata: CallData.compile({ token: USDC }) },
    { contractAddress: ROUTER, entrypoint: "clear", calldata: CallData.compile({ token: GRIT }) },
  ];
  const { transaction_hash } = await deployer.execute(calls, { maxFee: 10n ** 16n });
  await provider.waitForTransaction(transaction_hash);
  return transaction_hash;
}

async function main() {
  const amountArg = process.argv[2];
  if (!amountArg) { console.error("usage: tsx swap-usdc-to-grit.ts <usdc_amount>"); process.exit(1); }
  const usdcAmount = BigInt(Math.round(parseFloat(amountArg) * 1e6));
  const before = await getMarket();
  console.log(`before: market=$${before.toFixed(4)}`);
  console.log(`swapping ${amountArg} USDC → GRIT...`);
  const tx = await swap(usdcAmount);
  console.log(`tx: ${tx}`);
  const after = await getMarket();
  console.log(`after:  market=$${after.toFixed(4)}  (Δ=${(after - before).toFixed(4)})`);
}

main().catch((e) => { console.error(e); process.exit(1); });
