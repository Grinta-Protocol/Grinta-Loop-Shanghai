#[starknet::interface]
pub trait IGrintaMemeNFT<TState> {
    fn mint(ref self: TState, to: starknet::ContractAddress) -> u256;
    fn total_minted(self: @TState) -> u256;
}

#[starknet::contract]
pub mod GrintaMemeNFT {
    use openzeppelin_introspection::src5::SRC5Component;
    use openzeppelin_token::erc721::ERC721Component;
    use openzeppelin_token::erc721::ERC721HooksEmptyImpl;
    use openzeppelin_token::erc721::interface::IERC721Metadata;
    use starknet::ContractAddress;
    use starknet::storage::{StoragePointerReadAccess, StoragePointerWriteAccess};
    use super::IGrintaMemeNFT;

    component!(path: ERC721Component, storage: erc721, event: ERC721Event);
    component!(path: SRC5Component, storage: src5, event: SRC5Event);

    #[abi(embed_v0)]
    impl ERC721Impl = ERC721Component::ERC721Impl<ContractState>;
    #[abi(embed_v0)]
    impl ERC721CamelOnlyImpl = ERC721Component::ERC721CamelOnlyImpl<ContractState>;
    #[abi(embed_v0)]
    impl SRC5Impl = SRC5Component::SRC5Impl<ContractState>;

    impl ERC721InternalImpl = ERC721Component::InternalImpl<ContractState>;

    #[storage]
    struct Storage {
        next_id: u256,
        #[substorage(v0)]
        erc721: ERC721Component::Storage,
        #[substorage(v0)]
        src5: SRC5Component::Storage,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    enum Event {
        #[flat]
        ERC721Event: ERC721Component::Event,
        #[flat]
        SRC5Event: SRC5Component::Event,
    }

    #[constructor]
    fn constructor(ref self: ContractState) {
        self.erc721.initializer("GrintaMeme", "GMEME", "");
        self.next_id.write(1);
    }

    #[abi(embed_v0)]
    impl ERC721MetadataImpl of IERC721Metadata<ContractState> {
        fn name(self: @ContractState) -> ByteArray {
            "GrintaMeme"
        }

        fn symbol(self: @ContractState) -> ByteArray {
            "GMEME"
        }

        fn token_uri(self: @ContractState, token_id: u256) -> ByteArray {
            "data:application/json;utf8,{\"name\":\"GrintaMeme\",\"description\":\"On-chain meme NFT for the Grinta protocol. To the moon.\",\"image\":\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 240 240'><rect width='240' height='240' fill='black'/><circle cx='120' cy='120' r='90' fill='%2300ff88'/><text x='120' y='135' font-family='monospace' font-size='56' font-weight='bold' text-anchor='middle' fill='black'>GRIT</text><text x='120' y='210' font-family='monospace' font-size='16' text-anchor='middle' fill='%2300ff88'>grinta protocol</text></svg>\"}"
        }
    }

    #[abi(embed_v0)]
    impl GrintaMemeNFTImpl of IGrintaMemeNFT<ContractState> {
        fn mint(ref self: ContractState, to: ContractAddress) -> u256 {
            let id = self.next_id.read();
            self.next_id.write(id + 1);
            self.erc721.mint(to, id);
            id
        }

        fn total_minted(self: @ContractState) -> u256 {
            self.next_id.read() - 1
        }
    }
}
