/**
 * On-Chain Monitor — reads protocol state from Starknet
 *
 * Reads:
 * - Market price (GRIT/USD) from GrintaHook
 * - Redemption price from SAFEEngine
 * - Current KP/KI from PIDController
 * - Last deviation observation from PIDController
 * - Guard state (stopped, update count, last update)
 */

import { RpcProvider, Contract } from "starknet";
import { CONFIG, WAD } from "./config.js";

// ---- Minimal ABIs (only the view functions we need) ----

const HOOK_ABI = [
  {
    type: "interface",
    name: "IGrintaHook",
    items: [
      {
        type: "function",
        name: "get_market_price",
        inputs: [],
        outputs: [{ type: "core::integer::u256" }],
        state_mutability: "view",
      },
      {
        type: "function",
        name: "get_collateral_price",
        inputs: [],
        outputs: [{ type: "core::integer::u256" }],
        state_mutability: "view",
      },
    ],
  },
];

const SAFE_ENGINE_ABI = [
  {
    type: "interface",
    name: "ISAFEEngine",
    items: [
      {
        type: "function",
        name: "get_redemption_price",
        inputs: [],
        outputs: [{ type: "core::integer::u256" }],
        state_mutability: "view",
      },
    ],
  },
];

const PID_ABI = [
  {
    type: "interface",
    name: "IPIDController",
    items: [
      {
        type: "function",
        name: "get_controller_gains",
        inputs: [],
        outputs: [
          {
            type: "(core::integer::i128, core::integer::i128)",
          },
        ],
        state_mutability: "view",
      },
      {
        type: "function",
        name: "get_deviation_observation",
        inputs: [],
        outputs: [
          {
            type: "(core::integer::u64, core::integer::i128, core::integer::i128)",
          },
        ],
        state_mutability: "view",
      },
    ],
  },
];

const GUARD_ABI = [
  {
    type: "interface",
    name: "IParameterGuard",
    items: [
      {
        type: "function",
        name: "is_stopped",
        inputs: [],
        outputs: [{ type: "core::bool" }],
        state_mutability: "view",
      },
      {
        type: "function",
        name: "get_update_count",
        inputs: [],
        outputs: [{ type: "core::integer::u32" }],
        state_mutability: "view",
      },
      {
        type: "function",
        name: "get_last_update_timestamp",
        inputs: [],
        outputs: [{ type: "core::integer::u64" }],
        state_mutability: "view",
      },
    ],
  },
];

// ---- Types ----

export interface ProtocolState {
  marketPrice: bigint; // WAD — GRIT/USD
  redemptionPrice: bigint; // WAD — target GRIT/USD
  collateralPrice: bigint; // WAD — BTC/USD
  kp: bigint; // WAD — current proportional gain (signed)
  ki: bigint; // WAD — current integral gain (signed)
  lastProportional: bigint; // WAD — last deviation proportional term (signed)
  lastIntegral: bigint; // WAD — last deviation integral term (signed)
  lastDeviationTimestamp: bigint;
  guardStopped: boolean;
  guardUpdateCount: number;
  guardLastUpdate: bigint;
  // Derived
  deviationPct: number; // Human-readable % deviation (peg)
  collateralDropPct: number; // % drop from $60k baseline
  marketPriceUsd: number;
  redemptionPriceUsd: number;
  collateralPriceUsd: number;
}

// ---- Monitor ----

export class Monitor {
  private provider: RpcProvider;
  private hookContract: Contract;
  private safeEngineContract: Contract;
  private pidContract: Contract;
  private guardContract: Contract;

  constructor() {
    this.provider = new RpcProvider({ nodeUrl: CONFIG.RPC_URL });

    this.hookContract = new Contract({
      abi: HOOK_ABI,
      address: CONFIG.GRINTA_HOOK_ADDRESS,
      providerOrAccount: this.provider,
    });

    this.safeEngineContract = new Contract({
      abi: SAFE_ENGINE_ABI,
      address: CONFIG.SAFE_ENGINE_ADDRESS,
      providerOrAccount: this.provider,
    });

    this.pidContract = new Contract({
      abi: PID_ABI,
      address: CONFIG.PID_CONTROLLER_ADDRESS,
      providerOrAccount: this.provider,
    });

    this.guardContract = new Contract({
      abi: GUARD_ABI,
      address: CONFIG.PARAMETER_GUARD_ADDRESS,
      providerOrAccount: this.provider,
    });
  }

  /**
   * Fetch full protocol state in parallel.
   * If knownGains is provided (from a just-confirmed tx), use those
   * instead of the RPC read to avoid stale cache on Alchemy.
   */
  async getState(knownGains?: { kp: bigint; ki: bigint }): Promise<ProtocolState> {
    // Sequential calls to avoid rate limiting on public RPC
    // and better error reporting
    let marketPrice, redemptionPrice, collateralPrice, gains, deviation, stopped, updateCount, lastUpdate;

    try {
      marketPrice = await this.hookContract.get_market_price();
    } catch (e) {
      console.error("[Monitor] get_market_price failed:", e);
      throw e;
    }

    try {
      redemptionPrice = await this.safeEngineContract.get_redemption_price();
    } catch (e) {
      console.error("[Monitor] get_redemption_price failed:", e);
    }

    try {
      collateralPrice = await this.hookContract.get_collateral_price();
    } catch (e) {
      console.error("[Monitor] get_collateral_price failed:", e);
    }

    try {
      gains = await this.pidContract.get_controller_gains();
    } catch (e) {
      console.error("[Monitor] get_controller_gains failed:", e);
    }

    try {
      deviation = await this.pidContract.get_deviation_observation();
    } catch (e) {
      console.error("[Monitor] get_deviation_observation failed:", e);
    }

    try {
      stopped = await this.guardContract.is_stopped();
    } catch (e) {
      console.error("[Monitor] is_stopped failed:", e);
    }

    try {
      updateCount = await this.guardContract.get_update_count();
    } catch (e) {
      console.error("[Monitor] get_update_count failed:", e);
    }

    try {
      lastUpdate = await this.guardContract.get_last_update_timestamp();
    } catch (e) {
      console.error("[Monitor] get_last_update_timestamp failed:", e);
    }

    const mp = toBigInt(marketPrice);
    const rp = toBigInt(redemptionPrice);
    const cp = toBigInt(collateralPrice);

    const getVal = (obj: unknown, key: string | number) => {
      if (obj === undefined || obj === null) return undefined;
      if (typeof obj !== "object") return undefined;
      const o = obj as Record<string, unknown>;
      return o[key] ?? o[String(key)];
    };

    // Gains: use write-through cache if available (RPC may return stale data)
    let kp: bigint;
    let ki: bigint;
    if (knownGains) {
      kp = knownGains.kp;
      ki = knownGains.ki;
      console.log("[Monitor] Using confirmed gains (write-through) instead of RPC read");
    } else {
      kp = toSignedBigInt(getVal(gains, 0) ?? getVal(gains, "kp") ?? getVal(gains, "k"));
      ki = toSignedBigInt(getVal(gains, 1) ?? getVal(gains, "ki") ?? getVal(gains, "i"));
    }

    // Deviation comes as {timestamp, proportional, integral} or {0, 1, 2}
    const lastDeviationTimestamp = toBigInt(
      getVal(deviation, 0) ?? getVal(deviation, "timestamp")
    );
    const lastProportional = toSignedBigInt(
      getVal(deviation, 1) ?? getVal(deviation, "proportional")
    );
    const lastIntegral = toSignedBigInt(
      getVal(deviation, 2) ?? getVal(deviation, "integral")
    );

    // Derived values
    const mpUsd = Number(mp) / Number(WAD);
    // redemption_price is stored as RAY (1e27), not WAD (1e18)
    const RAY = 10n ** 27n;
    const rpRaw = Number(rp) / Number(RAY);
    const rpUsd = (rpRaw > 0.5 && rpRaw < 2.0) ? rpRaw : 1.0;
    const cpUsd = Number(cp) / Number(WAD);
    const deviationPct = rpUsd > 0 ? ((rpUsd - mpUsd) / rpUsd) * 100 : 0;
    // BTC drop from $60k baseline (initial collateral price in deployed_v9)
    const BTC_BASELINE = 60000;
    const collateralDropPct =
      cpUsd > 0 ? ((BTC_BASELINE - cpUsd) / BTC_BASELINE) * 100 : 0;

    return {
      marketPrice: mp,
      redemptionPrice: rp,
      collateralPrice: cp,
      kp,
      ki,
      lastProportional,
      lastIntegral,
      lastDeviationTimestamp,
      guardStopped: Boolean(stopped),
      guardUpdateCount: Number(toBigInt(updateCount)),
      guardLastUpdate: toBigInt(lastUpdate),
      deviationPct,
      collateralDropPct,
      marketPriceUsd: mpUsd,
      redemptionPriceUsd: rpUsd,
      collateralPriceUsd: cpUsd,
    };
  }
}

// ---- Helpers ----

function toBigInt(val: unknown): bigint {
  if (val === undefined || val === null) {
    throw new Error(`Cannot convert undefined/null to BigInt`);
  }
  if (typeof val === "bigint") return val;
  return BigInt(String(val));
}

function toSignedBigInt(val: unknown, context: string = ""): bigint {
  if (val === undefined || val === null) {
    throw new Error(`Cannot convert undefined/null to BigInt at ${context}`);
  }
  const n = toBigInt(val);
  // Cairo i128 is stored as felt252. If > 2^127-1, it's negative
  const I128_MAX = (1n << 127n) - 1n;
  if (n > I128_MAX) {
    // Two's complement: value = n - 2^128
    return n - (1n << 128n);
  }
  return n;
}
