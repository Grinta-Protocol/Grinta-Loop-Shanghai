/// Simple mintable ERC20 for testing — anyone with admin can mint
#[starknet::contract]
pub mod ERC20Mintable {
    use starknet::storage::{Map, StorageMapReadAccess, StorageMapWriteAccess, StoragePointerReadAccess, StoragePointerWriteAccess};
    use starknet::{ContractAddress, get_caller_address};

    #[storage]
    struct Storage {
        name: ByteArray,
        symbol: ByteArray,
        decimals: u8,
        total_supply: u256,
        balances: Map<ContractAddress, u256>,
        allowances: Map<(ContractAddress, ContractAddress), u256>,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    pub enum Event {
        Transfer: Transfer,
        Approval: Approval,
    }

    #[derive(Drop, starknet::Event)]
    pub struct Transfer { #[key] pub from: ContractAddress, #[key] pub to: ContractAddress, pub value: u256 }
    #[derive(Drop, starknet::Event)]
    pub struct Approval { #[key] pub owner: ContractAddress, #[key] pub spender: ContractAddress, pub value: u256 }

    #[constructor]
    fn constructor(
        ref self: ContractState,
        name: ByteArray,
        symbol: ByteArray,
        decimals: u8,
    ) {
        self.name.write(name);
        self.symbol.write(symbol);
        self.decimals.write(decimals);
    }

    #[abi(embed_v0)]
    impl ERC20Impl of grinta::interfaces::ierc20::IERC20<ContractState> {
        fn name(self: @ContractState) -> ByteArray {
            self.name.read()
        }

        fn symbol(self: @ContractState) -> ByteArray {
            self.symbol.read()
        }

        fn decimals(self: @ContractState) -> u8 {
            self.decimals.read()
        }

        fn total_supply(self: @ContractState) -> u256 {
            self.total_supply.read()
        }

        fn balance_of(self: @ContractState, account: ContractAddress) -> u256 {
            self.balances.read(account)
        }

        fn allowance(self: @ContractState, owner: ContractAddress, spender: ContractAddress) -> u256 {
            self.allowances.read((owner, spender))
        }

        fn transfer(ref self: ContractState, recipient: ContractAddress, amount: u256) -> bool {
            let sender = get_caller_address();
            let sender_bal = self.balances.read(sender);
            assert(sender_bal >= amount, 'ERC20: insufficient balance');
            self.balances.write(sender, sender_bal - amount);
            let recipient_bal = self.balances.read(recipient);
            self.balances.write(recipient, recipient_bal + amount);
            self.emit(Transfer { from: sender, to: recipient, value: amount });
            true
        }

        fn transfer_from(
            ref self: ContractState, sender: ContractAddress, recipient: ContractAddress, amount: u256,
        ) -> bool {
            let caller = get_caller_address();
            let allowed = self.allowances.read((sender, caller));
            assert(allowed >= amount, 'ERC20: insufficient allowance');
            self.allowances.write((sender, caller), allowed - amount);
            let sender_bal = self.balances.read(sender);
            assert(sender_bal >= amount, 'ERC20: insufficient balance');
            self.balances.write(sender, sender_bal - amount);
            let recipient_bal = self.balances.read(recipient);
            self.balances.write(recipient, recipient_bal + amount);
            self.emit(Transfer { from: sender, to: recipient, value: amount });
            true
        }

        fn approve(ref self: ContractState, spender: ContractAddress, amount: u256) -> bool {
            let owner = get_caller_address();
            self.allowances.write((owner, spender), amount);
            self.emit(Approval { owner, spender, value: amount });
            true
        }
    }

    // ====================================================================
    // camelCase aliases (required by Ekubo Positions and wallets)
    // ====================================================================

    #[external(v0)]
    fn balanceOf(self: @ContractState, account: ContractAddress) -> u256 {
        self.balances.read(account)
    }

    #[external(v0)]
    fn totalSupply(self: @ContractState) -> u256 {
        self.total_supply.read()
    }

    #[external(v0)]
    fn transferFrom(
        ref self: ContractState, sender: ContractAddress, recipient: ContractAddress, amount: u256,
    ) -> bool {
        let caller = get_caller_address();
        let allowed = self.allowances.read((sender, caller));
        assert(allowed >= amount, 'ERC20: insufficient allowance');
        self.allowances.write((sender, caller), allowed - amount);
        let sender_bal = self.balances.read(sender);
        assert(sender_bal >= amount, 'ERC20: insufficient balance');
        self.balances.write(sender, sender_bal - amount);
        let recipient_bal = self.balances.read(recipient);
        self.balances.write(recipient, recipient_bal + amount);
        self.emit(Transfer { from: sender, to: recipient, value: amount });
        true
    }

    /// Public mint — no access control, for testing only
    #[external(v0)]
    fn mint(ref self: ContractState, to: ContractAddress, amount: u256) {
        let bal = self.balances.read(to);
        self.balances.write(to, bal + amount);
        let supply = self.total_supply.read();
        self.total_supply.write(supply + amount);
        self.emit(Transfer { from: 0.try_into().unwrap(), to, value: amount });
    }
}
