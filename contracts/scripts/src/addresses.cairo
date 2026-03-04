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

// Ekubo Core on Sepolia
// https://docs.ekubo.org/integration-guides/reference/starknet-contracts
pub const EKUBO_CORE: ContractAddress =
    0x0444a09d96389aa7148f1aada508e30b71299ffe650d9c97fdaae38cb9a23384
    .try_into()
    .unwrap();

// =============================================================================
// Deployed contract addresses (V2 — Keeper-less with Ekubo Hook)
// =============================================================================

pub const SAFE_ENGINE: ContractAddress =
    0x02f4f6c374c20ddf3ea5e59cc70f2ad4c2bfb5786ca6c146266f89f7da575421
    .try_into()
    .unwrap();

pub const COLLATERAL_JOIN: ContractAddress =
    0x0362bd21cf4fd2ada59945e27c0fe10802dde0061e6aeeae0dd81b80669b4687
    .try_into()
    .unwrap();

pub const PID_CONTROLLER: ContractAddress =
    0x0694c76e4817aea5ae3858e99048ceb844679ed479d075ab9e0cd083fc9aee6a
    .try_into()
    .unwrap();

pub const GRINTA_HOOK: ContractAddress =
    0x06a78d63d252cbb3192c64f9fdd85598a716992edaf693437fe466d9861c7ca5
    .try_into()
    .unwrap();

pub const SAFE_MANAGER: ContractAddress =
    0x07aec9c3d46853af2a2c924b1cdd839ffe38ffdc5d174c44d34c537d24d8aae8
    .try_into()
    .unwrap();

pub const MOCK_WBTC: ContractAddress =
    0x04ab76b407a4967de3683d387c598188d436d22d51416e8c8783156625874e20
    .try_into()
    .unwrap();

pub const MOCK_USDC: ContractAddress =
    0x04e5d8c61fc059bb689169b217c37016e593a894042909e2b71b6c4f7b30fcdf
    .try_into()
    .unwrap();

pub const MOCK_EKUBO_ORACLE: ContractAddress =
    0x066822a5e3ebd7f15b9b279b1dfabfe5c1f808010167cda027a22316b1999071
    .try_into()
    .unwrap();

// =============================================================================
// Deployer account on Sepolia
// =============================================================================
pub const DEPLOYER: ContractAddress =
    0x72f0d2391f7ce9103d31a64b6a36e0fe8d32f908d2e183a02d9d46403b21ce2
    .try_into()
    .unwrap();
