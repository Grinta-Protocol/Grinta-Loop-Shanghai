/// Mock Ekubo oracle extension — returns settable prices for testing
#[starknet::contract]
pub mod MockEkuboOracle {
    use starknet::storage::{Map, StorageMapReadAccess, StorageMapWriteAccess};
    use starknet::ContractAddress;

    #[storage]
    struct Storage {
        // (base, quote) -> x128 price
        prices: Map<(ContractAddress, ContractAddress), u256>,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    pub enum Event {}

    #[constructor]
    fn constructor(ref self: ContractState) {}

    /// Set a mock price (in x128 format) for a base/quote pair
    #[external(v0)]
    fn set_price_x128(
        ref self: ContractState,
        base_token: ContractAddress,
        quote_token: ContractAddress,
        price_x128: u256,
    ) {
        self.prices.write((base_token, quote_token), price_x128);
    }

    #[abi(embed_v0)]
    impl MockOracleImpl of grinta::interfaces::iekubo::IEkuboOracleExtension<ContractState> {
        fn get_price_x128_over_last(
            self: @ContractState,
            base_token: ContractAddress,
            quote_token: ContractAddress,
            period: u64,
        ) -> u256 {
            self.prices.read((base_token, quote_token))
        }
    }
}
