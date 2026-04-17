/**
 * Agent Configuration
 *
 * Loads env vars and contract addresses for the Grinta PID Agent.
 */

import dotenv from "dotenv";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, "..", ".env") });

function requireEnv(key: string): string {
  const val = process.env[key];
  if (!val) throw new Error(`Missing required env var: ${key}`);
  return val;
}

export const CONFIG = {
  // Starknet
  RPC_URL: process.env.STARKNET_RPC_URL || "https://starknet-sepolia.public.blastapi.io",
  AGENT_PRIVATE_KEY: requireEnv("AGENT_PRIVATE_KEY"),
  AGENT_ADDRESS: requireEnv("AGENT_ADDRESS"),

  // CommonStack LLM
  COMMONSTACK_API_KEY: requireEnv("COMMONSTACK_API_KEY"),
  COMMONSTACK_BASE_URL: "https://api.commonstack.ai/v1",
  COMMONSTACK_MODEL: process.env.COMMONSTACK_MODEL || "zai-org/glm-5.1",

  // Contracts (deployed_v9.json defaults)
  PARAMETER_GUARD_ADDRESS: requireEnv("PARAMETER_GUARD_ADDRESS"),
  PID_CONTROLLER_ADDRESS:
    process.env.PID_CONTROLLER_ADDRESS ||
    "0x05b4901f396b2d3062b38a594a8c61d513a3c32cf9f37be9f391e7dda998441d",
  GRINTA_HOOK_ADDRESS:
    process.env.GRINTA_HOOK_ADDRESS ||
    "0x029d4fa992b69377bdc8fb9f98dd4fb255b7c82e62727be4d5badcd7da60122b",
  SAFE_ENGINE_ADDRESS:
    process.env.SAFE_ENGINE_ADDRESS ||
    "0x012acdb5b9fd6743372f6e14e8af51dae1cd54bbcc578682656f4c75628d8c0c",

  // Agent behavior
  CHECK_INTERVAL_MS: Number(process.env.CHECK_INTERVAL_MS || "15000"),
  EMERGENCY_DEVIATION_THRESHOLD: Number(
    process.env.EMERGENCY_DEVIATION_THRESHOLD || "0.05"
  ),

  // Demo mode (off-chain price feed). If unset, agent runs in production mode
  // and reads only on-chain BTC. If set, agent reads the same synthetic CSV
  // the demo feeder pushes to the oracle, but at higher frequency, simulating
  // a real off-chain feed (Pyth/CEX) ahead of the on-chain price.
  DEMO_CSV_PATH: process.env.DEMO_CSV_PATH || "",
  // Unix epoch ms when the demo started. Defaults to "now" if unset, but the
  // launcher should set this so feeder + agent share the same t=0.
  DEMO_START_TIMESTAMP_MS: process.env.DEMO_START_TIMESTAMP_MS
    ? Number(process.env.DEMO_START_TIMESTAMP_MS)
    : 0,
} as const;

/** WAD = 1e18 — Starknet fixed-point representation */
export const WAD = 10n ** 18n;
/** RAY = 1e27 */
export const RAY = 10n ** 27n;
