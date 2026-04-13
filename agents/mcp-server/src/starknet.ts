import { RpcProvider, Contract, num, type Abi } from "starknet";
import { SAFE_MANAGER_ABI } from "./abi/safe-manager.js";
import { SAFE_ENGINE_ABI } from "./abi/safe-engine.js";
import { GRINTA_HOOK_ABI } from "./abi/grinta-hook.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const WAD = 10n ** 18n;
const RAY = 10n ** 27n;
const WAD_DECIMALS = 18;
const RAY_DECIMALS = 27;
const WBTC_DECIMALS = 8;

// ---------------------------------------------------------------------------
// Environment config
// ---------------------------------------------------------------------------

export interface GrintaConfig {
  rpcUrl: string;
  safeManagerAddress: string;
  safeEngineAddress: string;
  collateralJoinAddress: string;
  hookAddress: string;
  wbtcAddress: string;
}

export function loadConfig(): GrintaConfig {
  const required = (key: string): string => {
    const val = process.env[key];
    if (!val) throw new Error(`Missing required env var: ${key}`);
    return val;
  };

  return {
    rpcUrl: required("STARKNET_RPC_URL"),
    safeManagerAddress: required("GRINTA_SAFE_MANAGER_ADDRESS"),
    safeEngineAddress: required("GRINTA_SAFE_ENGINE_ADDRESS"),
    collateralJoinAddress: required("GRINTA_COLLATERAL_JOIN_ADDRESS"),
    hookAddress: required("GRINTA_HOOK_ADDRESS"),
    wbtcAddress: required("GRINTA_WBTC_ADDRESS"),
  };
}

// ---------------------------------------------------------------------------
// Provider (read-only — no account/key needed)
// ---------------------------------------------------------------------------

let _provider: RpcProvider | undefined;
let _config: GrintaConfig | undefined;

export function getConfig(): GrintaConfig {
  if (!_config) _config = loadConfig();
  return _config;
}

export function getProvider(): RpcProvider {
  if (!_provider) {
    _provider = new RpcProvider({ nodeUrl: getConfig().rpcUrl });
  }
  return _provider;
}

// ---------------------------------------------------------------------------
// Contract instances (read-only)
// ---------------------------------------------------------------------------

let _safeManager: Contract | undefined;
let _safeEngine: Contract | undefined;
let _grintaHook: Contract | undefined;

export function getSafeManager(): Contract {
  if (!_safeManager) {
    _safeManager = new Contract(
      SAFE_MANAGER_ABI as unknown as Abi,
      getConfig().safeManagerAddress,
      getProvider(),
    );
  }
  return _safeManager;
}

export function getSafeEngine(): Contract {
  if (!_safeEngine) {
    _safeEngine = new Contract(
      SAFE_ENGINE_ABI as unknown as Abi,
      getConfig().safeEngineAddress,
      getProvider(),
    );
  }
  return _safeEngine;
}

export function getGrintaHook(): Contract {
  if (!_grintaHook) {
    _grintaHook = new Contract(
      GRINTA_HOOK_ABI as unknown as Abi,
      getConfig().hookAddress,
      getProvider(),
    );
  }
  return _grintaHook;
}

// ---------------------------------------------------------------------------
// Calldata types (for write tools — user signs externally)
// ---------------------------------------------------------------------------

export interface StarknetCall {
  contractAddress: string;
  entrypoint: string;
  calldata: string[];
}

// ---------------------------------------------------------------------------
// Formatting utilities
// ---------------------------------------------------------------------------

/** Format a bigint WAD (1e18) value to a human-readable decimal string */
export function formatWad(value: bigint, symbol?: string): string {
  const whole = value / WAD;
  const frac = value % WAD;
  const fracStr = frac.toString().padStart(WAD_DECIMALS, "0").replace(/0+$/, "");
  const numStr = fracStr ? `${whole}.${fracStr}` : `${whole}`;
  return symbol ? `${numStr} ${symbol}` : numStr;
}

/** Format a bigint RAY (1e27) value to a human-readable decimal string */
export function formatRay(value: bigint, symbol?: string): string {
  const whole = value / RAY;
  const frac = value % RAY;
  const fracStr = frac.toString().padStart(RAY_DECIMALS, "0").replace(/0+$/, "");
  const numStr = fracStr ? `${whole}.${fracStr}` : `${whole}`;
  return symbol ? `${numStr} ${symbol}` : numStr;
}

/** Format a WAD value as a percentage (0.5e18 → "50.00%") */
export function formatWadPercent(value: bigint): string {
  const pct = (value * 10000n) / WAD;
  const whole = pct / 100n;
  const frac = pct % 100n;
  return `${whole}.${frac.toString().padStart(2, "0")}%`;
}

/** Format a WAD value as USD */
export function formatUsd(value: bigint): string {
  return "$" + formatWad(value);
}

/** Convert a user-friendly BTC string ("0.5") to WBTC 8-decimal bigint */
export function parseBtcAmount(amount: string): bigint {
  const parts = amount.split(".");
  const whole = BigInt(parts[0] || "0");
  const fracStr = (parts[1] || "").padEnd(WBTC_DECIMALS, "0").slice(0, WBTC_DECIMALS);
  return whole * 10n ** BigInt(WBTC_DECIMALS) + BigInt(fracStr);
}

/** Convert a user-friendly GRIT string ("1000") to WAD bigint */
export function parseGritAmount(amount: string): bigint {
  const parts = amount.split(".");
  const whole = BigInt(parts[0] || "0");
  const fracStr = (parts[1] || "").padEnd(WAD_DECIMALS, "0").slice(0, WAD_DECIMALS);
  return whole * WAD + BigInt(fracStr);
}

/** Format a WBTC internal WAD amount back to BTC string */
export function formatBtcFromWad(wadAmount: bigint): string {
  return formatWad(wadAmount, "BTC");
}

/** Convert a RAY redemption rate to an annualized percentage */
export function formatAnnualRate(rayRate: bigint): string {
  const diff = rayRate - RAY;
  const annualBps = (diff * 31536000n * 10000n) / RAY;
  const whole = annualBps / 100n;
  const frac = (annualBps < 0n ? -annualBps : annualBps) % 100n;
  return `${whole}.${frac.toString().padStart(2, "0")}%`;
}

/** Extract a bigint from a starknet.js result (handles u256 struct) */
export function toBigInt(val: unknown): bigint {
  if (typeof val === "bigint") return val;
  if (typeof val === "number") return BigInt(val);
  if (typeof val === "string") return num.toBigInt(val);
  if (val && typeof val === "object" && "low" in val && "high" in val) {
    const obj = val as { low: bigint | string; high: bigint | string };
    const low = typeof obj.low === "bigint" ? obj.low : BigInt(obj.low);
    const high = typeof obj.high === "bigint" ? obj.high : BigInt(obj.high);
    return low + (high << 128n);
  }
  return BigInt(String(val));
}

/** Serialize a u256 bigint into Starknet calldata [low, high] as hex strings */
export function u256Calldata(value: bigint): string[] {
  const low = value & ((1n << 128n) - 1n);
  const high = value >> 128n;
  return ["0x" + low.toString(16), "0x" + high.toString(16)];
}
