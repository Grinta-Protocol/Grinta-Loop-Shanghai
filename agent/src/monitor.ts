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
import { OffchainFeed, type OffchainReading } from "./offchain-feed.js";

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
  // Off-chain feed (DEMO MODE only — null in production)
  offchain: OffchainReading | null;
}

// ---- Monitor ----

export class Monitor {
  private provider: RpcProvider;
  private hookContract: Contract;
  private safeEngineContract: Contract;
  private pidContract: Contract;
  private guardContract: Contract;
  private offchainFeed: OffchainFeed;

  constructor() {
    this.provider = new RpcProvider({ nodeUrl: CONFIG.RPC_URL });
    this.offchainFeed = new OffchainFeed();

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
   * Fetch full protocol state in parallel
   */
  async getState(): Promise<ProtocolState> {
    const [marketPrice, redemptionPrice, collateralPrice, gains, deviation, stopped, updateCount, lastUpdate] =
      await Promise.all([
        this.hookContract.get_market_price(),
        this.safeEngineContract.get_redemption_price(),
        this.hookContract.get_collateral_price(),
        this.pidContract.get_controller_gains(),
        this.pidContract.get_deviation_observation(),
        this.guardContract.is_stopped(),
        this.guardContract.get_update_count(),
        this.guardContract.get_last_update_timestamp(),
      ]);

    const mp = toBigInt(marketPrice);
    const rp = toBigInt(redemptionPrice);
    const cp = toBigInt(collateralPrice);

    // Gains come as struct {kp, ki} or tuple
    const kp = toSignedBigInt(Array.isArray(gains) ? gains[0] : gains.kp);
    const ki = toSignedBigInt(Array.isArray(gains) ? gains[1] : gains.ki);

    // Deviation comes as struct {timestamp, proportional, integral}
    const lastDeviationTimestamp = toBigInt(
      Array.isArray(deviation) ? deviation[0] : deviation.timestamp
    );
    const lastProportional = toSignedBigInt(
      Array.isArray(deviation) ? deviation[1] : deviation.proportional
    );
    const lastIntegral = toSignedBigInt(
      Array.isArray(deviation) ? deviation[2] : deviation.integral
    );

    // Derived values
    const mpUsd = Number(mp) / Number(WAD);
    const rpUsd = Number(rp) / Number(WAD);
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
      offchain: this.offchainFeed.read(),
    };
  }
}

// ---- Helpers ----

function toBigInt(val: unknown): bigint {
  if (typeof val === "bigint") return val;
  return BigInt(String(val));
}

function toSignedBigInt(val: unknown): bigint {
  const n = toBigInt(val);
  // Cairo i128 is stored as felt252. If > 2^127-1, it's negative
  const I128_MAX = (1n << 127n) - 1n;
  if (n > I128_MAX) {
    // Two's complement: value = n - 2^128
    return n - (1n << 128n);
  }
  return n;
}
