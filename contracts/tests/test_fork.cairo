use starknet::ContractAddress;

use grinta::interfaces::iekubo::{IEkuboOracleExtensionDispatcher, IEkuboOracleExtensionDispatcherTrait};

// Ekubo oracle extension on Starknet mainnet
const EKUBO_ORACLE_EXTENSION: felt252 = 0x005e470ff654d834983a46b8f29dfa99963d5044b993cb7b9c92243a69dab38f;
// WBTC on Starknet
const WBTC_ADDRESS: felt252 = 0x03fe2b97c1fd336e750087d68b9b867997fd64a2661ff3ca5a7c771641e8e7ac;
// USDC on Starknet
const USDC_ADDRESS: felt252 = 0x053c91253bc9682c04929ca02ed00b3e423f6710d2ee7e0d5ebb06f3ecf368a8;

// ============================================================================
// Fork test: Read real BTC/USDC TWAP from Ekubo oracle extension
// ============================================================================
#[test]
#[fork("mainnet")]
fn test_read_ekubo_oracle() {
    let oracle_addr: ContractAddress = EKUBO_ORACLE_EXTENSION.try_into().unwrap();
    let wbtc: ContractAddress = WBTC_ADDRESS.try_into().unwrap();
    let usdc: ContractAddress = USDC_ADDRESS.try_into().unwrap();

    let oracle = IEkuboOracleExtensionDispatcher { contract_address: oracle_addr };

    // Read 30-minute TWAP for BTC/USDC
    let twap_period: u64 = 1800;
    let price_x128 = oracle.get_price_x128_over_last(wbtc, usdc, twap_period);

    // Price should be non-zero
    assert(price_x128 > 0, 'TWAP should be non-zero');

    // Convert x128 to WAD
    let wad: u256 = 1_000_000_000_000_000_000;
    let two_pow_128: u256 = 0x100000000000000000000000000000000;
    let price_wad = (price_x128 * wad) / two_pow_128;

    assert(price_wad > 0, 'WAD price should be > 0');
}
