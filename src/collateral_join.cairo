/// CollateralJoin — WBTC custody contract
/// Holds WBTC tokens and converts between asset amounts and internal WAD units
/// Adapted from Opus Gate
#[starknet::contract]
pub mod CollateralJoin {
    use starknet::storage::{StoragePointerReadAccess, StoragePointerWriteAccess};
    use starknet::{ContractAddress, get_caller_address, get_contract_address};
    use grinta::interfaces::ierc20::{IERC20Dispatcher, IERC20DispatcherTrait};

    #[storage]
    struct Storage {
        admin: ContractAddress,
        safe_manager: ContractAddress,
        safe_engine: ContractAddress,
        liquidation_engine: ContractAddress,
        collateral_token: ContractAddress,  // WBTC address
        token_decimals: u8,                 // WBTC = 8 decimals
        total_assets: u256,                 // Total WBTC held
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    pub enum Event {
        Joined: Joined,
        Exited: Exited,
    }

    #[derive(Drop, starknet::Event)]
    pub struct Joined { pub user: ContractAddress, pub asset_amount: u256, pub internal_amount: u256 }
    #[derive(Drop, starknet::Event)]
    pub struct Exited { pub user: ContractAddress, pub asset_amount: u256, pub internal_amount: u256 }

    #[constructor]
    fn constructor(
        ref self: ContractState,
        admin: ContractAddress,
        collateral_token: ContractAddress,
        token_decimals: u8,
        safe_engine: ContractAddress,
    ) {
        self.admin.write(admin);
        self.collateral_token.write(collateral_token);
        self.token_decimals.write(token_decimals);
        self.safe_engine.write(safe_engine);
    }

    #[generate_trait]
    impl InternalImpl of InternalTrait {
        fn _assert_safe_manager(self: @ContractState) {
            assert(get_caller_address() == self.safe_manager.read(), 'JOIN: not manager');
        }

        fn _assert_liquidation_engine(self: @ContractState) {
            assert(get_caller_address() == self.liquidation_engine.read(), 'JOIN: not liq engine');
        }

        fn _assert_admin(self: @ContractState) {
            assert(get_caller_address() == self.admin.read(), 'JOIN: not admin');
        }

        /// Convert asset amount (e.g. 8 decimals for WBTC) to internal WAD (18 decimals)
        fn _to_internal(self: @ContractState, asset_amount: u256) -> u256 {
            let decimals = self.token_decimals.read();
            if decimals < 18 {
                let scale: u256 = self._pow10((18 - decimals).into());
                asset_amount * scale
            } else if decimals > 18 {
                let scale: u256 = self._pow10((decimals - 18).into());
                asset_amount / scale
            } else {
                asset_amount
            }
        }

        /// Convert internal WAD (18 decimals) back to asset amount
        fn _to_assets(self: @ContractState, internal_amount: u256) -> u256 {
            let decimals = self.token_decimals.read();
            if decimals < 18 {
                let scale: u256 = self._pow10((18 - decimals).into());
                internal_amount / scale
            } else if decimals > 18 {
                let scale: u256 = self._pow10((decimals - 18).into());
                internal_amount * scale
            } else {
                internal_amount
            }
        }

        fn _pow10(self: @ContractState, n: u32) -> u256 {
            let mut result: u256 = 1;
            let mut i: u32 = 0;
            loop {
                if i >= n {
                    break;
                }
                result *= 10;
                i += 1;
            };
            result
        }
    }

    #[abi(embed_v0)]
    impl CollateralJoinImpl of grinta::interfaces::icollateral_join::ICollateralJoin<ContractState> {
        /// Transfer WBTC from user into this contract, return internal (WAD) amount
        fn join(ref self: ContractState, user: ContractAddress, amount: u256) -> u256 {
            self._assert_safe_manager();
            let internal_amount = self._to_internal(amount);
            assert(internal_amount > 0, 'JOIN: zero amount');

            let token = IERC20Dispatcher { contract_address: self.collateral_token.read() };
            let success = token.transfer_from(user, get_contract_address(), amount);
            assert(success, 'JOIN: transfer failed');

            let total = self.total_assets.read();
            self.total_assets.write(total + amount);

            self.emit(Joined { user, asset_amount: amount, internal_amount });
            internal_amount
        }

        /// Transfer WBTC from this contract back to user, given internal (WAD) amount
        fn exit(ref self: ContractState, user: ContractAddress, amount: u256) -> u256 {
            self._assert_safe_manager();
            let asset_amount = self._to_assets(amount);
            assert(asset_amount > 0, 'JOIN: zero amount');

            let total = self.total_assets.read();
            assert(total >= asset_amount, 'JOIN: insufficient assets');
            self.total_assets.write(total - asset_amount);

            let token = IERC20Dispatcher { contract_address: self.collateral_token.read() };
            let success = token.transfer(user, asset_amount);
            assert(success, 'JOIN: transfer failed');

            self.emit(Exited { user, asset_amount, internal_amount: amount });
            asset_amount
        }

        /// Transfer seized collateral to a recipient (auction house). Called by LiquidationEngine.
        /// Takes internal (WAD) amount, converts to asset amount, transfers.
        fn seize(ref self: ContractState, to: ContractAddress, amount: u256) -> u256 {
            self._assert_liquidation_engine();
            let asset_amount = self._to_assets(amount);
            assert(asset_amount > 0, 'JOIN: zero seize amount');

            let total = self.total_assets.read();
            assert(total >= asset_amount, 'JOIN: insufficient assets');
            self.total_assets.write(total - asset_amount);

            let token = IERC20Dispatcher { contract_address: self.collateral_token.read() };
            let success = token.transfer(to, asset_amount);
            assert(success, 'JOIN: seize transfer failed');

            self.emit(Exited { user: to, asset_amount, internal_amount: amount });
            asset_amount
        }

        fn get_collateral_token(self: @ContractState) -> ContractAddress {
            self.collateral_token.read()
        }

        fn get_total_assets(self: @ContractState) -> u256 {
            self.total_assets.read()
        }

        fn convert_to_internal(self: @ContractState, asset_amount: u256) -> u256 {
            self._to_internal(asset_amount)
        }

        fn convert_to_assets(self: @ContractState, internal_amount: u256) -> u256 {
            self._to_assets(internal_amount)
        }
    }

    // Admin functions
    #[external(v0)]
    fn set_safe_manager(ref self: ContractState, manager: ContractAddress) {
        self._assert_admin();
        self.safe_manager.write(manager);
    }

    #[external(v0)]
    fn set_liquidation_engine(ref self: ContractState, engine: ContractAddress) {
        self._assert_admin();
        self.liquidation_engine.write(engine);
    }
}
