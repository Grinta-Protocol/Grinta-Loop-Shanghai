// Contract addresses on Starknet Sepolia — V10
export const ADDRESSES = {
  safeManager: '0x07bdd82db8cb9a201c624190225cb62559a36034456824abe82de26e8fdb8798',
  safeEngine: '0x07417b07b7ac71dd816c8d880f4dc1f74c10911aa174305a9146e1b56ef60272',
  collateralJoin: '0x067c114f46dc4ba518fac3ef5fd081a26870870ca6d3b5637175e67dbfae1e2d',
  wbtc: '0x051ef402b04791e28e95b09498a148a6b81499597d313f0e49afcee5a13267b4',
  usdc: '0x016aff59b63314502da266d4347b2c1220c97e7865fce3afcf92fdd3ace93906',
  pidController: '0x53916399f6c8caf0e1ded219f7d956b9bde8c0d070f17435d3179492b738dd3',
  grintaHook: '0x04560e84979e5bae575c65f9b0be443d91d9333a8f2f50884ebd5aaf89fb6147',
  oracleRelayer: '0x013f7f3661d81b29c3a55b1022231161c68282537049738dd1676a855063f851',
  accountingEngine: '0x04b3ef19a873e744c2f7f5304dda2cdb21a320c5ba39c215acf1e83187d9c516',
  liquidationEngine: '0x07c28c1b2fc1ce34875476647da36ac198cab66aaf6a22630b88105bba725635',
  collateralAuctionHouse: '0x05baca01ea18efd5463879220fad31ecb286a148110a6d8bf5a0ac614e450f85',
  parameterGuard: '0x65e1098a1552e8aceec3a5217ecad40d223303e00070097abcc011deeb1ce1b',
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
