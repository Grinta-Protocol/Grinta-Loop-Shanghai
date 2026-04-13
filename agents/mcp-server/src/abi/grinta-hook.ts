// ABI for GrintaHook contract — Ekubo extension + oracle + PID trigger
// Provides market price, collateral price, and manual update/set functions

export const GRINTA_HOOK_ABI = [
  // ---- Write functions ----
  {
    type: "function",
    name: "update",
    inputs: [],
    outputs: [],
    state_mutability: "external",
  },
  {
    type: "function",
    name: "set_market_price",
    inputs: [
      { name: "price", type: "core::integer::u256" },
    ],
    outputs: [],
    state_mutability: "external",
  },
  // ---- Read functions ----
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
  {
    type: "function",
    name: "get_last_update_time",
    inputs: [],
    outputs: [{ type: "core::integer::u64" }],
    state_mutability: "view",
  },
  // ---- Struct definitions ----
  {
    type: "struct",
    name: "core::integer::u256",
    members: [
      { name: "low", type: "core::integer::u128" },
      { name: "high", type: "core::integer::u128" },
    ],
  },
] as const;
