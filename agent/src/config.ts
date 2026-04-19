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
  // Starknet RPC (prefer Alchemy/Infura over public node to avoid rate limits)
  RPC_URL: process.env.STARKNET_RPC_URL || "https://starknet-sepolia.public.blastapi.io",

  // Starknet — agent wallet
  AGENT_PRIVATE_KEY: requireEnv("AGENT_PRIVATE_KEY"),
  AGENT_ADDRESS: requireEnv("AGENT_ADDRESS"),

  // CommonStack LLM
  COMMONSTACK_API_KEY: requireEnv("COMMONSTACK_API_KEY"),
  COMMONSTACK_BASE_URL: "https://api.commonstack.ai/v1",
  COMMONSTACK_MODEL: process.env.COMMONSTACK_MODEL || "zai-org/glm-5.1",

  // Contracts (deployed_v10.json defaults)
  PARAMETER_GUARD_ADDRESS: requireEnv("PARAMETER_GUARD_ADDRESS"),
  PID_CONTROLLER_ADDRESS:
    process.env.PID_CONTROLLER_ADDRESS ||
    "0x069bd5d8cda116f142f9fb56fdd55310bce06274e0c5461166ce32c27ac91e0f",
  GRINTA_HOOK_ADDRESS:
    process.env.GRINTA_HOOK_ADDRESS ||
    "0x04560e84979e5bae575c65f9b0be443d91d9333a8f2f50884ebd5aaf89fb6147",
  SAFE_ENGINE_ADDRESS:
    process.env.SAFE_ENGINE_ADDRESS ||
    "0x07417b07b7ac71dd816c8d880f4dc1f74c10911aa174305a9146e1b56ef60272",

  // Agent behavior
  CHECK_INTERVAL_MS: Number(process.env.CHECK_INTERVAL_MS || "15000"),
  EMERGENCY_DEVIATION_THRESHOLD: Number(
    process.env.EMERGENCY_DEVIATION_THRESHOLD || "0.05"
  ),
} as const;

/** WAD = 1e18 — Starknet fixed-point representation */
export const WAD = 10n ** 18n;
/** RAY = 1e27 */
export const RAY = 10n ** 27n;
