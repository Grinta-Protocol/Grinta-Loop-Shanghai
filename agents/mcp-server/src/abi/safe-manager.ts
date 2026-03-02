// ABI for SafeManager contract — transcribed from ISafeManager interface
// All user/agent operations go through this contract

export const SAFE_MANAGER_ABI = [
  // ---- Write functions ----
  {
    type: "function",
    name: "open_safe",
    inputs: [],
    outputs: [{ type: "core::integer::u64" }],
    state_mutability: "external",
  },
  {
    type: "function",
    name: "open_and_borrow",
    inputs: [
      { name: "collateral_amount", type: "core::integer::u256" },
      { name: "borrow_amount", type: "core::integer::u256" },
    ],
    outputs: [{ type: "core::integer::u64" }],
    state_mutability: "external",
  },
  {
    type: "function",
    name: "deposit",
    inputs: [
      { name: "safe_id", type: "core::integer::u64" },
      { name: "amount", type: "core::integer::u256" },
    ],
    outputs: [],
    state_mutability: "external",
  },
  {
    type: "function",
    name: "withdraw",
    inputs: [
      { name: "safe_id", type: "core::integer::u64" },
      { name: "amount", type: "core::integer::u256" },
    ],
    outputs: [],
    state_mutability: "external",
  },
  {
    type: "function",
    name: "borrow",
    inputs: [
      { name: "safe_id", type: "core::integer::u64" },
      { name: "amount", type: "core::integer::u256" },
    ],
    outputs: [],
    state_mutability: "external",
  },
  {
    type: "function",
    name: "repay",
    inputs: [
      { name: "safe_id", type: "core::integer::u64" },
      { name: "amount", type: "core::integer::u256" },
    ],
    outputs: [],
    state_mutability: "external",
  },
  {
    type: "function",
    name: "close_safe",
    inputs: [{ name: "safe_id", type: "core::integer::u64" }],
    outputs: [],
    state_mutability: "external",
  },
  {
    type: "function",
    name: "authorize_agent",
    inputs: [
      { name: "safe_id", type: "core::integer::u64" },
      { name: "agent", type: "core::starknet::contract_address::ContractAddress" },
    ],
    outputs: [],
    state_mutability: "external",
  },
  {
    type: "function",
    name: "revoke_agent",
    inputs: [
      { name: "safe_id", type: "core::integer::u64" },
      { name: "agent", type: "core::starknet::contract_address::ContractAddress" },
    ],
    outputs: [],
    state_mutability: "external",
  },
  // ---- Read functions ----
  {
    type: "function",
    name: "get_position_health",
    inputs: [{ name: "safe_id", type: "core::integer::u64" }],
    outputs: [{ type: "grinta::types::Health" }],
    state_mutability: "view",
  },
  {
    type: "function",
    name: "get_max_borrow",
    inputs: [{ name: "safe_id", type: "core::integer::u64" }],
    outputs: [{ type: "core::integer::u256" }],
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
    name: "is_authorized",
    inputs: [
      { name: "safe_id", type: "core::integer::u64" },
      { name: "agent", type: "core::starknet::contract_address::ContractAddress" },
    ],
    outputs: [{ type: "core::bool" }],
    state_mutability: "view",
  },
  // ---- Struct definitions ----
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
