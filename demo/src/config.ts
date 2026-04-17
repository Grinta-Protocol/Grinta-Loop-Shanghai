import dotenv from "dotenv";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, "..", ".env") });

function req(key: string): string {
  const v = process.env[key];
  if (!v) throw new Error(`Missing env var: ${key}`);
  return v;
}

export const CONFIG = {
  RPC_URL: process.env.STARKNET_RPC_URL || "https://starknet-sepolia.public.blastapi.io",

  DEPLOYER_ADDRESS: req("DEPLOYER_ADDRESS"),
  DEPLOYER_PRIVATE_KEY: req("DEPLOYER_PRIVATE_KEY"),

  ORACLE_RELAYER_ADDRESS: req("ORACLE_RELAYER_ADDRESS"),
  GRINTA_HOOK_ADDRESS: req("GRINTA_HOOK_ADDRESS"),
  SAFE_ENGINE_ADDRESS: req("SAFE_ENGINE_ADDRESS"),
  SAFE_MANAGER_ADDRESS: req("SAFE_MANAGER_ADDRESS"),
  PID_CONTROLLER_ADDRESS: req("PID_CONTROLLER_ADDRESS"),
  WBTC_ADDRESS: req("WBTC_ADDRESS"),
  USDC_ADDRESS: req("USDC_ADDRESS"),
  GRIT_ADDRESS: req("GRIT_ADDRESS"),
  PARAMETER_GUARD_ADDRESS: process.env.PARAMETER_GUARD_ADDRESS || "",

  EKUBO_ROUTER_ADDRESS: req("EKUBO_ROUTER_ADDRESS"),
  EKUBO_CORE_ADDRESS: req("EKUBO_CORE_ADDRESS"),

  POOL_FEE: BigInt(process.env.POOL_FEE || "0"),
  POOL_TICK_SPACING: BigInt(process.env.POOL_TICK_SPACING || "1000"),

  SETUP_USDC_MINT: BigInt(process.env.SETUP_USDC_MINT || "10000000000"),
  SETUP_WBTC_MINT: BigInt(process.env.SETUP_WBTC_MINT || "1000000000"),
  SETUP_WBTC_DEPOSIT: BigInt(process.env.SETUP_WBTC_DEPOSIT || "500000000"),
  SETUP_GRIT_BORROW: BigInt(process.env.SETUP_GRIT_BORROW || "30000000000000000000000"),

  DEMO_PRICE_INTERVAL: BigInt(process.env.DEMO_PRICE_INTERVAL || "5"),
  DEMO_RATE_INTERVAL: BigInt(process.env.DEMO_RATE_INTERVAL || "30"),

  AGENT_ADDRESS_TO_REGISTER: process.env.AGENT_ADDRESS_TO_REGISTER || "",

  FEEDER_INTERVAL_SEC: Number(process.env.FEEDER_INTERVAL_SEC || "10"),
  TRADER_INTERVAL_SEC: Number(process.env.TRADER_INTERVAL_SEC || "8"),
  CSV_PATH: process.env.CSV_PATH || "data/btc_crash.csv",
  DEMO_DURATION_SEC: Number(process.env.DEMO_DURATION_SEC || "240"),

  /** When launched by launcher.ts this is set so feeder/trader/agent share a clock.
   *  If 0/unset, each process uses its own Date.now() as t=0 (standalone mode). */
  DEMO_START_TIMESTAMP_MS: Number(process.env.DEMO_START_TIMESTAMP_MS || "0"),
} as const;

export const WAD = 10n ** 18n;
export const RAY = 10n ** 27n;

/** Convert a USD price (number) to WAD bigint, e.g. 60000 → 60000 * 1e18 */
export function usdToWad(usd: number): bigint {
  // Multiply via integer math to avoid float precision loss
  const cents = Math.round(usd * 100);
  return (BigInt(cents) * WAD) / 100n;
}
