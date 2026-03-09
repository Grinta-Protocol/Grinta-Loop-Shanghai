/// OracleRelayer — accepts USD prices from anyone, converts to x128, serves to GrintaHook
/// MVP: no access control, no staleness checks — anyone can push a price
#[starknet::contract]
pub mod OracleRelayer {
    use starknet::storage::{
        Map, StorageMapReadAccess, StorageMapWriteAccess,
        StoragePointerReadAccess, StoragePointerWriteAccess,
    };
    use starknet::{ContractAddress, get_block_timestamp};
    use grinta::types::WAD;

    // 2^128 for WAD → x128 conversion
    const TWO_POW_128: u256 = 0x100000000000000000000000000000000;

    #[storage]
    struct Storage {
        // (base, quote) → price in x128 format (for IEkuboOracleExtension compatibility)
        prices_x128: Map<(ContractAddress, ContractAddress), u256>,
        // (base, quote) → price in WAD format (human-readable, for convenience)
        prices_wad: Map<(ContractAddress, ContractAddress), u256>,
        last_update_time: u64,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    pub enum Event {
        PriceUpdated: PriceUpdated,
    }

    #[derive(Drop, starknet::Event)]
    pub struct PriceUpdated {
        #[key]
        pub base_token: ContractAddress,
        #[key]
        pub quote_token: ContractAddress,
        pub price_wad: u256,
        pub timestamp: u64,
    }

    #[constructor]
    fn constructor(ref self: ContractState) {}

    /// Push a price update — anyone can call (MVP, no access control)
    /// price_usd_wad: price with 18 decimals (e.g., 60000 * 1e18 for $60,000)
    #[external(v0)]
    fn update_price(
        ref self: ContractState,
        base_token: ContractAddress,
        quote_token: ContractAddress,
        price_usd_wad: u256,
    ) {
        assert(price_usd_wad > 0, 'ORACLE: price must be > 0');

        // Convert WAD → x128: price_x128 = price_wad * 2^128 / 1e18
        let price_x128 = (price_usd_wad * TWO_POW_128) / WAD;

        self.prices_x128.write((base_token, quote_token), price_x128);
        self.prices_wad.write((base_token, quote_token), price_usd_wad);

        let now = get_block_timestamp();
        self.last_update_time.write(now);

        self.emit(PriceUpdated {
            base_token, quote_token, price_wad: price_usd_wad, timestamp: now,
        });
    }

    /// Read price in WAD format (human-readable)
    #[external(v0)]
    fn get_price_wad(
        self: @ContractState,
        base_token: ContractAddress,
        quote_token: ContractAddress,
    ) -> u256 {
        self.prices_wad.read((base_token, quote_token))
    }

    #[external(v0)]
    fn get_last_update_time(self: @ContractState) -> u64 {
        self.last_update_time.read()
    }

    /// IEkuboOracleExtension — same interface GrintaHook already calls
    #[abi(embed_v0)]
    impl OracleImpl of grinta::interfaces::iekubo::IEkuboOracleExtension<ContractState> {
        fn get_price_x128_over_last(
            self: @ContractState,
            base_token: ContractAddress,
            quote_token: ContractAddress,
            period: u64,
        ) -> u256 {
            self.prices_x128.read((base_token, quote_token))
        }
    }
}
