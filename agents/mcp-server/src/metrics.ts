// Grinta protocol metrics snapshot — used by MoltX posting script
// These are the default/genesis parameters. Once deployed, read live from chain.

export const GENESIS_METRICS = {
  // Protocol identity
  name: "Grinta",
  chain: "Starknet",
  stablecoin: "GRIT",
  collateral: "WBTC",

  // Core parameters
  liquidation_ratio: "150%",
  liquidation_ltv: "66.67%",
  redemption_price_initial: "$1.00",
  redemption_rate_initial: "0% (1.0 RAY — neutral)",
  debt_ceiling: "TBD",

  // Collateral
  collateral_decimals: 8,
  internal_precision: 18, // WAD
  rate_precision: 27, // RAY

  // PID Controller
  pid_type: "PI (proportional-integral)",
  noise_barrier: "5% (0.95 WAD — ignores deviations < 5%)",
  integral_leak: "per-second decay toward zero",
  update_trigger: "every Ekubo swap (no keepers)",
  min_update_interval: "60 seconds",
  twap_period: "30 minutes",

  // Agent features
  delegation: true,
  multicall: true,
  single_call_open_and_borrow: true,
};
