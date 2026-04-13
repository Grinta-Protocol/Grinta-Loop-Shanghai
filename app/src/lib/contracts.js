// Contract addresses on Starknet Sepolia
export const ADDRESSES = {
  // V8 — with Liquidation System (2026-04-02)
  safeManager: '0x0338599c15350c06a1c81d86e1ea0e85047edbc1816b605af57d600e4a71dfb1',
  safeEngine: '0x02a83e8f676210b5b62c8b94d0fa5a1d5a1a6fe893520e12035f436c6b2a3539',
  collateralJoin: '0x03a24b3dde1fa5e2f8f4cf2ac525c18b8044890045a2ea79864a4ee7e05c7ba7',
  wbtc: '0x0519dfe7e35cde74c6fbc2b9b6fa33eb00e35992a91e4ec1573fb9298a7e5685',
  usdc: '0x07a713c569b2dab96a35c06c38a9e0304bf28359309ca21c6fa3a1a2988dd6ae',
  pidController: '0x07422bde0f5dce7646e50d57cd65421e034c2ecce3694396a37b81ac20fd89c5',
  grintaHook: '0x0030c357dda980355d051451fcc7d909ff61265fe2a310786815e699538106f6',
  oracleRelayer: '0x0189bff9655517d5bc48422f771ef6c8bbee60a7cd797faaa18947a61666f715',
  accountingEngine: '0x0386c7786bd7563fe0844b21005a74e9465de680a9b1e339d03ec1e3b0aacf43',
  liquidationEngine: '0x07b6bb47ad6b36c7a9f9af346869bfe344f77326122c65734ea24b6f4e593e57',
  collateralAuctionHouse: '0x045fa469b139a8d13fe6fca09375291135f997c5ac6646c218681028d86424fa',
}

// Minimal ABIs — only functions the frontend calls

export const SAFE_ENGINE_ABI = [
  {
    type: 'function',
    name: 'get_redemption_price',
    inputs: [],
    outputs: [{ type: 'core::integer::u256' }],
    state_mutability: 'view',
  },
  {
    type: 'function',
    name: 'get_redemption_rate',
    inputs: [],
    outputs: [{ type: 'core::integer::u256' }],
    state_mutability: 'view',
  },
  {
    type: 'function',
    name: 'get_collateral_price',
    inputs: [],
    outputs: [{ type: 'core::integer::u256' }],
    state_mutability: 'view',
  },
  {
    type: 'function',
    name: 'get_liquidation_ratio',
    inputs: [],
    outputs: [{ type: 'core::integer::u256' }],
    state_mutability: 'view',
  },
  {
    type: 'function',
    name: 'get_total_debt',
    inputs: [],
    outputs: [{ type: 'core::integer::u256' }],
    state_mutability: 'view',
  },
  {
    type: 'function',
    name: 'get_total_collateral',
    inputs: [],
    outputs: [{ type: 'core::integer::u256' }],
    state_mutability: 'view',
  },
  {
    type: 'function',
    name: 'get_safe_count',
    inputs: [],
    outputs: [{ type: 'core::integer::u64' }],
    state_mutability: 'view',
  },
  {
    type: 'function',
    name: 'get_safe_owner',
    inputs: [{ name: 'safe_id', type: 'core::integer::u64' }],
    outputs: [{ type: 'core::starknet::contract_address::ContractAddress' }],
    state_mutability: 'view',
  },
  {
    type: 'function',
    name: 'get_safe',
    inputs: [{ name: 'safe_id', type: 'core::integer::u64' }],
    outputs: [{ type: 'grinta::types::Safe' }],
    state_mutability: 'view',
  },
  {
    type: 'function',
    name: 'get_safe_health',
    inputs: [{ name: 'safe_id', type: 'core::integer::u64' }],
    outputs: [{ type: 'grinta::types::Health' }],
    state_mutability: 'view',
  },
  {
    type: 'function',
    name: 'approve',
    inputs: [
      { name: 'spender', type: 'core::starknet::contract_address::ContractAddress' },
      { name: 'amount', type: 'core::integer::u256' },
    ],
    outputs: [{ type: 'core::bool' }],
    state_mutability: 'external',
  },
  {
    type: 'struct',
    name: 'grinta::types::Safe',
    members: [
      { name: 'collateral', type: 'core::integer::u256' },
      { name: 'debt', type: 'core::integer::u256' },
    ],
  },
  {
    type: 'struct',
    name: 'grinta::types::Health',
    members: [
      { name: 'collateral_value', type: 'core::integer::u256' },
      { name: 'debt', type: 'core::integer::u256' },
      { name: 'ltv', type: 'core::integer::u256' },
      { name: 'liquidation_price', type: 'core::integer::u256' },
    ],
  },
  {
    type: 'struct',
    name: 'core::integer::u256',
    members: [
      { name: 'low', type: 'core::integer::u128' },
      { name: 'high', type: 'core::integer::u128' },
    ],
  },
]

export const SAFE_MANAGER_ABI = [
  {
    type: 'function',
    name: 'open_safe',
    inputs: [],
    outputs: [{ type: 'core::integer::u64' }],
    state_mutability: 'external',
  },
  {
    type: 'function',
    name: 'open_and_borrow',
    inputs: [
      { name: 'collateral_amount', type: 'core::integer::u256' },
      { name: 'borrow_amount', type: 'core::integer::u256' },
    ],
    outputs: [{ type: 'core::integer::u64' }],
    state_mutability: 'external',
  },
  {
    type: 'function',
    name: 'deposit',
    inputs: [
      { name: 'safe_id', type: 'core::integer::u64' },
      { name: 'amount', type: 'core::integer::u256' },
    ],
    outputs: [],
    state_mutability: 'external',
  },
  {
    type: 'function',
    name: 'withdraw',
    inputs: [
      { name: 'safe_id', type: 'core::integer::u64' },
      { name: 'amount', type: 'core::integer::u256' },
    ],
    outputs: [],
    state_mutability: 'external',
  },
  {
    type: 'function',
    name: 'borrow',
    inputs: [
      { name: 'safe_id', type: 'core::integer::u64' },
      { name: 'amount', type: 'core::integer::u256' },
    ],
    outputs: [],
    state_mutability: 'external',
  },
  {
    type: 'function',
    name: 'repay',
    inputs: [
      { name: 'safe_id', type: 'core::integer::u64' },
      { name: 'amount', type: 'core::integer::u256' },
    ],
    outputs: [],
    state_mutability: 'external',
  },
  {
    type: 'function',
    name: 'close_safe',
    inputs: [{ name: 'safe_id', type: 'core::integer::u64' }],
    outputs: [],
    state_mutability: 'external',
  },
  {
    type: 'function',
    name: 'get_position_health',
    inputs: [{ name: 'safe_id', type: 'core::integer::u64' }],
    outputs: [{ type: 'grinta::types::Health' }],
    state_mutability: 'view',
  },
  {
    type: 'function',
    name: 'get_max_borrow',
    inputs: [{ name: 'safe_id', type: 'core::integer::u64' }],
    outputs: [{ type: 'core::integer::u256' }],
    state_mutability: 'view',
  },
  {
    type: 'function',
    name: 'get_safe_owner',
    inputs: [{ name: 'safe_id', type: 'core::integer::u64' }],
    outputs: [{ type: 'core::starknet::contract_address::ContractAddress' }],
    state_mutability: 'view',
  },
  {
    type: 'struct',
    name: 'grinta::types::Health',
    members: [
      { name: 'collateral_value', type: 'core::integer::u256' },
      { name: 'debt', type: 'core::integer::u256' },
      { name: 'ltv', type: 'core::integer::u256' },
      { name: 'liquidation_price', type: 'core::integer::u256' },
    ],
  },
  {
    type: 'struct',
    name: 'core::integer::u256',
    members: [
      { name: 'low', type: 'core::integer::u128' },
      { name: 'high', type: 'core::integer::u128' },
    ],
  },
]

// Standard ERC20 ABI for WBTC approve
export const ERC20_ABI = [
  {
    type: 'function',
    name: 'approve',
    inputs: [
      { name: 'spender', type: 'core::starknet::contract_address::ContractAddress' },
      { name: 'amount', type: 'core::integer::u256' },
    ],
    outputs: [{ type: 'core::bool' }],
    state_mutability: 'external',
  },
  {
    type: 'function',
    name: 'balance_of',
    inputs: [{ name: 'account', type: 'core::starknet::contract_address::ContractAddress' }],
    outputs: [{ type: 'core::integer::u256' }],
    state_mutability: 'view',
  },
  {
    type: 'struct',
    name: 'core::integer::u256',
    members: [
      { name: 'low', type: 'core::integer::u128' },
      { name: 'high', type: 'core::integer::u128' },
    ],
  },
]
