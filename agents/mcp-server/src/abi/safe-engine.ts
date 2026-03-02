// ABI for SAFEEngine contract — transcribed from ISAFEEngine interface
// Core ledger + GRIT ERC20 + redemption price mechanism

export const SAFE_ENGINE_ABI = [
  // ---- View functions ----
  {
    type: "function",
    name: "get_safe",
    inputs: [{ name: "safe_id", type: "core::integer::u64" }],
    outputs: [{ type: "grinta::types::Safe" }],
    state_mutability: "view",
  },
  {
    type: "function",
    name: "get_safe_count",
    inputs: [],
    outputs: [{ type: "core::integer::u64" }],
    state_mutability: "view",
  },
  {
    type: "function",
    name: "get_safe_owner",
    inputs: [{ name: "safe_id", type: "core::integer::u64" }],
    outputs: [{ type: "core::starknet::contract_address::ContractAddress" }],
    state_mutability: "view",
  },
  {
    type: "function",
    name: "get_safe_health",
    inputs: [{ name: "safe_id", type: "core::integer::u64" }],
    outputs: [{ type: "grinta::types::Health" }],
    state_mutability: "view",
  },
  {
    type: "function",
    name: "get_system_health",
    inputs: [],
    outputs: [{ type: "grinta::types::Health" }],
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
    name: "get_redemption_price",
    inputs: [],
    outputs: [{ type: "core::integer::u256" }],
    state_mutability: "view",
  },
  {
    type: "function",
    name: "get_redemption_rate",
    inputs: [],
    outputs: [{ type: "core::integer::u256" }],
    state_mutability: "view",
  },
  {
    type: "function",
    name: "get_total_debt",
    inputs: [],
    outputs: [{ type: "core::integer::u256" }],
    state_mutability: "view",
  },
  {
    type: "function",
    name: "get_total_collateral",
    inputs: [],
    outputs: [{ type: "core::integer::u256" }],
    state_mutability: "view",
  },
  {
    type: "function",
    name: "get_debt_ceiling",
    inputs: [],
    outputs: [{ type: "core::integer::u256" }],
    state_mutability: "view",
  },
  {
    type: "function",
    name: "get_liquidation_ratio",
    inputs: [],
    outputs: [{ type: "core::integer::u256" }],
    state_mutability: "view",
  },
  {
    type: "function",
    name: "get_grit_balance",
    inputs: [{ name: "account", type: "core::starknet::contract_address::ContractAddress" }],
    outputs: [{ type: "core::integer::u256" }],
    state_mutability: "view",
  },
  // ---- ERC20 functions ----
  {
    type: "function",
    name: "name",
    inputs: [],
    outputs: [{ type: "core::byte_array::ByteArray" }],
    state_mutability: "view",
  },
  {
    type: "function",
    name: "symbol",
    inputs: [],
    outputs: [{ type: "core::byte_array::ByteArray" }],
    state_mutability: "view",
  },
  {
    type: "function",
    name: "decimals",
    inputs: [],
    outputs: [{ type: "core::integer::u8" }],
    state_mutability: "view",
  },
  {
    type: "function",
    name: "total_supply",
    inputs: [],
    outputs: [{ type: "core::integer::u256" }],
    state_mutability: "view",
  },
  {
    type: "function",
    name: "balance_of",
    inputs: [{ name: "account", type: "core::starknet::contract_address::ContractAddress" }],
    outputs: [{ type: "core::integer::u256" }],
    state_mutability: "view",
  },
  {
    type: "function",
    name: "approve",
    inputs: [
      { name: "spender", type: "core::starknet::contract_address::ContractAddress" },
      { name: "amount", type: "core::integer::u256" },
    ],
    outputs: [{ type: "core::bool" }],
    state_mutability: "external",
  },
  // ---- Struct definitions ----
  {
    type: "struct",
    name: "grinta::types::Safe",
    members: [
      { name: "collateral", type: "core::integer::u256" },
      { name: "debt", type: "core::integer::u256" },
    ],
  },
  {
    type: "struct",
    name: "grinta::types::Health",
    members: [
      { name: "collateral_value", type: "core::integer::u256" },
      { name: "debt", type: "core::integer::u256" },
      { name: "ltv", type: "core::integer::u256" },
      { name: "liquidation_price", type: "core::integer::u256" },
    ],
  },
  {
    type: "struct",
    name: "core::integer::u256",
    members: [
      { name: "low", type: "core::integer::u128" },
      { name: "high", type: "core::integer::u128" },
    ],
  },
] as const;
