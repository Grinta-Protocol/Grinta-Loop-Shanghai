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
    0x053b40a647cedfca6ca84f542a0fe36736031905a9639a7f19a3c1e66bfd5080
    .try_into()
    .unwrap();

// =============================================================================
// Deployer account on Sepolia
// =============================================================================
pub const DEPLOYER: ContractAddress =
    0x72f0d2391f7ce9103d31a64b6a36e0fe8d32f908d2e183a02d9d46403b21ce2
    .try_into()
    .unwrap();
