use starknet::ContractAddress;

// =============================================================================
// Sepolia addresses
// =============================================================================

// Ekubo Oracle Extension on Sepolia
// https://docs.ekubo.org/integration-guides/reference/contract-addresses
pub const EKUBO_ORACLE: ContractAddress =
    0x003ccf3ee24638dd5f1a51ceb783e120695f53893f6fd947cc2dcabb3f86dc65
    .try_into()
    .unwrap();

// WBTC (bridged) on Sepolia
pub const WBTC: ContractAddress =
    0x00452bd5c0512a61df7c7be8cfea5e4f893cb40e126bdc40aee6054db955129e
    .try_into()
    .unwrap();

// USDC (bridged) on Sepolia
pub const USDC: ContractAddress =
    0x04e5d8c61fc059bb689169b217c37016e593a894042909e2b71b6c4f7b30fcdf
    .try_into()
    .unwrap();

// Ekubo Core on Sepolia
// https://docs.ekubo.org/integration-guides/reference/starknet-contracts
pub const EKUBO_CORE: ContractAddress =
    0x0444a09d96389aa7148f1aada508e30b71299ffe650d9c97fdaae38cb9a23384
    .try_into()
    .unwrap();

// Ekubo Positions on Sepolia
// https://docs.ekubo.org/integration-guides/reference/starknet-contracts
pub const EKUBO_POSITIONS: ContractAddress =
    0x06a2aee84bb0ed5dded4384ddd0e40e9c1372b818668375ab8e3ec08807417e5
    .try_into()
    .unwrap();

// =============================================================================
// Deployed contract addresses (V3 — OracleRelayer + Pool)
// =============================================================================

// MockWBTC - ERC20Mintable, 8 decimals
pub const MOCK_WBTC: ContractAddress =
    0x4ab76b407a4967de3683d387c598188d436d22d51416e8c8783156625874e20
    .try_into()
    .unwrap();

// MockUSDC - ERC20Mintable, 6 decimals (V2: with camelCase for Ekubo compat)
pub const MOCK_USDC: ContractAddress =
    0x0728f54606297716e46af72251733521e2c2a374abbc3dce4bcee8df4744dd30
    .try_into()
    .unwrap();

// SAFEEngine - Core ledger + GRIT token
pub const SAFE_ENGINE: ContractAddress =
    0x2f4f6c374c20ddf3ea5e59cc70f2ad4c2bfb5786ca6c146266f89f7da575421
    .try_into()
    .unwrap();

// CollateralJoin - WBTC custody
pub const COLLATERAL_JOIN: ContractAddress =
    0x362bd21cf4fd2ada59945e27c0fe10802dde0061e6aeeae0dd81b80669b4687
    .try_into()
    .unwrap();

// PIDController - Rate controller
pub const PID_CONTROLLER: ContractAddress =
    0x694c76e4817aea5ae3858e99048ceb844679ed479d075ab9e0cd083fc9aee6a
    .try_into()
    .unwrap();

// OracleRelayer - BTC/USD price feed (replaces MockEkuboOracle)
pub const ORACLE_RELAYER: ContractAddress =
    0x06ed1049ac5d4bccd34eb476a28a62816747c4bb8a90d71f713d21938d5f633d
    .try_into()
    .unwrap();

// GrintaHook - Ekubo extension (V4 — set_market_price + dual throttle)
pub const GRINTA_HOOK: ContractAddress =
    0x0064dc1c0264cc91d871b0cc5cda181730ff79978db5934abc4f2830993b10b5
    .try_into()
    .unwrap();

// SafeManager - User operations
pub const SAFE_MANAGER: ContractAddress =
    0x5be8041f47bd935d8ce98e3b5b2ded6540acc6d4e24c64f3822927c5339eac6
    .try_into()
    .unwrap();

// =============================================================================
// Deployer account on Sepolia
// =============================================================================
pub const DEPLOYER: ContractAddress =
    0x72f0d2391f7ce9103d31a64b6a36e0fe8d32f908d2e183a02d9d46403b21ce2
    .try_into()
    .unwrap();
