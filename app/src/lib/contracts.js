// Contract addresses on Starknet Sepolia
export const ADDRESSES = {
  safeManager: '0x0276ac98c87bddacc6d0afe2d4482ee57e9d6902753e895b94f7265b4c0d91b1',
  safeEngine: '0x02f4f6c374c20ddf3ea5e59cc70f2ad4c2bfb5786ca6c146266f89f7da575421',
  collateralJoin: '0x0362bd21cf4fd2ada59945e27c0fe10802dde0061e6aeeae0dd81b80669b4687',
  wbtc: '0x04ab76b407a4967de3683d387c598188d436d22d51416e8c8783156625874e20',
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
