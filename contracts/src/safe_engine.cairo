/// SAFEEngine — Core ledger + Grit ERC20 + redemption price mechanism
/// Adapted from Opus Shrine with HAI-style redemption price instead of multiplier
#[starknet::contract]
pub mod SAFEEngine {
    use starknet::storage::{Map, StorageMapReadAccess, StorageMapWriteAccess, StoragePointerReadAccess, StoragePointerWriteAccess};
    use starknet::{ContractAddress, get_caller_address, get_block_timestamp};
    use grinta::types::{Safe, Health, WAD, RAY, wmul, wdiv, rmul, rpow};

    #[storage]
    struct Storage {
        // Access control
        admin: ContractAddress,
        safe_manager: ContractAddress,
        hook: ContractAddress,
        collateral_join: ContractAddress,

        // Safe accounting
        safes: Map<u64, Safe>,
        safe_owners: Map<u64, ContractAddress>,
        safe_count: u64,

        // System totals
        total_collateral: u256,
        total_debt: u256,

        // Collateral pricing
        collateral_price: u256,          // BTC/USD price (WAD)

        // Redemption price mechanism (HAI-style)
        redemption_price: u256,          // Target price of Grit in USD (RAY)
        redemption_rate: u256,           // Per-second rate applied to redemption price (RAY)
        redemption_price_update_time: u64,

        // System parameters
        debt_ceiling: u256,              // Max total debt (WAD)
        liquidation_ratio: u256,         // Min collateral ratio (WAD, e.g. 1.5e18 = 150%)

        // Grit ERC20
        grit_balances: Map<ContractAddress, u256>,
        grit_allowances: Map<(ContractAddress, ContractAddress), u256>,
        grit_total_supply: u256,
    }

    // ========================================================================
    // Events
    // ========================================================================

    #[event]
    #[derive(Drop, starknet::Event)]
    pub enum Event {
        SafeCreated: SafeCreated,
        CollateralDeposited: CollateralDeposited,
        CollateralWithdrawn: CollateralWithdrawn,
        GritBorrowed: GritBorrowed,
        GritRepaid: GritRepaid,
        CollateralPriceUpdated: CollateralPriceUpdated,
        RedemptionRateUpdated: RedemptionRateUpdated,
        RedemptionPriceUpdated: RedemptionPriceUpdated,
        Transfer: Transfer,
        Approval: Approval,
    }

    #[derive(Drop, starknet::Event)]
    pub struct SafeCreated { #[key] pub safe_id: u64, pub owner: ContractAddress }
    #[derive(Drop, starknet::Event)]
    pub struct CollateralDeposited { #[key] pub safe_id: u64, pub amount: u256 }
    #[derive(Drop, starknet::Event)]
    pub struct CollateralWithdrawn { #[key] pub safe_id: u64, pub amount: u256 }
    #[derive(Drop, starknet::Event)]
    pub struct GritBorrowed { #[key] pub safe_id: u64, pub amount: u256 }
    #[derive(Drop, starknet::Event)]
    pub struct GritRepaid { #[key] pub safe_id: u64, pub amount: u256 }
    #[derive(Drop, starknet::Event)]
    pub struct CollateralPriceUpdated { pub price: u256 }
    #[derive(Drop, starknet::Event)]
    pub struct RedemptionRateUpdated { pub rate: u256 }
    #[derive(Drop, starknet::Event)]
    pub struct RedemptionPriceUpdated { pub price: u256 }
    #[derive(Drop, starknet::Event)]
    pub struct Transfer { #[key] pub from: ContractAddress, #[key] pub to: ContractAddress, pub value: u256 }
    #[derive(Drop, starknet::Event)]
    pub struct Approval { #[key] pub owner: ContractAddress, #[key] pub spender: ContractAddress, pub value: u256 }

    // ========================================================================
    // Constructor
    // ========================================================================

    #[constructor]
    fn constructor(
        ref self: ContractState,
        admin: ContractAddress,
        debt_ceiling: u256,
        liquidation_ratio: u256,
    ) {
        self.admin.write(admin);
        self.debt_ceiling.write(debt_ceiling);
        self.liquidation_ratio.write(liquidation_ratio);
        // Initialize redemption price at $1 (RAY) and rate at 1.0 (RAY = no change)
        self.redemption_price.write(RAY);
        self.redemption_rate.write(RAY);
        self.redemption_price_update_time.write(get_block_timestamp());
    }

    // ========================================================================
    // Internal: redemption price update
    // ========================================================================

    #[generate_trait]
    impl InternalImpl of InternalTrait {
        /// Updates redemption price based on elapsed time and current rate
        /// redemptionPrice = redemptionRate^timeDelta * oldPrice (all in RAY)
        fn _update_redemption_price(ref self: ContractState) -> u256 {
            let now = get_block_timestamp();
            let last_update = self.redemption_price_update_time.read();
            if now <= last_update {
                return self.redemption_price.read();
            }
            let time_delta: u256 = (now - last_update).into();
            let rate = self.redemption_rate.read();
            let rate_pow = rpow(rate, time_delta);
            let old_price = self.redemption_price.read();
            let mut new_price = rmul(rate_pow, old_price);
            if new_price == 0 {
                new_price = 1; // never let it hit zero
            }
            self.redemption_price.write(new_price);
            self.redemption_price_update_time.write(now);
            self.emit(RedemptionPriceUpdated { price: new_price });
            new_price
        }

        fn _assert_admin(self: @ContractState) {
            assert(get_caller_address() == self.admin.read(), 'SAFE: not admin');
        }

        fn _assert_safe_manager(self: @ContractState) {
            assert(get_caller_address() == self.safe_manager.read(), 'SAFE: not manager');
        }

        fn _assert_hook(self: @ContractState) {
            assert(get_caller_address() == self.hook.read(), 'SAFE: not hook');
        }

        /// Check that a safe is healthy: collateral_value / debt >= liquidation_ratio
        /// Uses redemption price: effective_debt = debt * redemption_price / RAY
        fn _is_safe_healthy(self: @ContractState, safe_id: u64) -> bool {
            let safe = self.safes.read(safe_id);
            if safe.debt == 0 {
                return true;
            }
            let col_value = wmul(safe.collateral, self.collateral_price.read());
            // Debt in USD = debt * (redemption_price / RAY)
            // Since redemption_price is RAY-scaled, debt_usd = rmul(debt_wad_as_ray, redemption_price)
            // But debt is in WAD and redemption_price in RAY. Convert debt to RAY first.
            let debt_ray = safe.debt * 1_000_000_000; // WAD -> RAY (multiply by 1e9)
            let debt_usd_ray = rmul(debt_ray, self.redemption_price.read());
            let debt_usd = debt_usd_ray / 1_000_000_000; // RAY -> WAD
            // col_value / debt_usd >= liquidation_ratio
            // Rearranged: col_value * WAD >= debt_usd * liquidation_ratio
            col_value * WAD >= debt_usd * self.liquidation_ratio.read()
        }

        fn _compute_health(self: @ContractState, safe_id: u64) -> Health {
            let safe = self.safes.read(safe_id);
            let col_price = self.collateral_price.read();
            let col_value = wmul(safe.collateral, col_price);

            let debt_ray = safe.debt * 1_000_000_000;
            let r_price = self.redemption_price.read();
            let debt_usd_ray = rmul(debt_ray, r_price);
            let debt_usd = debt_usd_ray / 1_000_000_000;

            let ltv = if col_value > 0 { wdiv(debt_usd, col_value) } else { 0 };

            // liquidation_price = (debt * redemption_price * liquidation_ratio) / collateral
            let liq_price = if safe.collateral > 0 {
                wdiv(wmul(debt_usd, self.liquidation_ratio.read()), safe.collateral)
            } else {
                0
            };

            Health { collateral_value: col_value, debt: safe.debt, ltv, liquidation_price: liq_price }
        }

        // Grit ERC20 internal
        fn _mint(ref self: ContractState, to: ContractAddress, amount: u256) {
            let bal = self.grit_balances.read(to);
            self.grit_balances.write(to, bal + amount);
            let supply = self.grit_total_supply.read();
            self.grit_total_supply.write(supply + amount);
            self.emit(Transfer { from: 0.try_into().unwrap(), to, value: amount });
        }

        fn _burn(ref self: ContractState, from: ContractAddress, amount: u256) {
            let bal = self.grit_balances.read(from);
            assert(bal >= amount, 'SAFE: insufficient grit');
            self.grit_balances.write(from, bal - amount);
            let supply = self.grit_total_supply.read();
            self.grit_total_supply.write(supply - amount);
            self.emit(Transfer { from, to: 0.try_into().unwrap(), value: amount });
        }
    }

    // ========================================================================
    // ISAFEEngine implementation
    // ========================================================================

    #[abi(embed_v0)]
    impl SAFEEngineImpl of grinta::interfaces::isafe_engine::ISAFEEngine<ContractState> {
        // ---- Getters ----
        fn get_safe(self: @ContractState, safe_id: u64) -> Safe {
            self.safes.read(safe_id)
        }

        fn get_safe_count(self: @ContractState) -> u64 {
            self.safe_count.read()
        }

        fn get_safe_owner(self: @ContractState, safe_id: u64) -> ContractAddress {
            self.safe_owners.read(safe_id)
        }

        fn get_safe_health(self: @ContractState, safe_id: u64) -> Health {
            self._compute_health(safe_id)
        }

        fn get_system_health(self: @ContractState) -> Health {
            let col_price = self.collateral_price.read();
            let total_col = self.total_collateral.read();
            let col_value = wmul(total_col, col_price);
            let total_d = self.total_debt.read();

            let debt_ray = total_d * 1_000_000_000;
            let debt_usd_ray = rmul(debt_ray, self.redemption_price.read());
            let debt_usd = debt_usd_ray / 1_000_000_000;

            let ltv = if col_value > 0 { wdiv(debt_usd, col_value) } else { 0 };
            Health { collateral_value: col_value, debt: total_d, ltv, liquidation_price: 0 }
        }

        fn get_collateral_price(self: @ContractState) -> u256 {
            self.collateral_price.read()
        }

        fn get_redemption_price(self: @ContractState) -> u256 {
            // View function: compute current price without updating state
            let now = get_block_timestamp();
            let last_update = self.redemption_price_update_time.read();
            if now <= last_update {
                return self.redemption_price.read();
            }
            let time_delta: u256 = (now - last_update).into();
            let rate_pow = rpow(self.redemption_rate.read(), time_delta);
            rmul(rate_pow, self.redemption_price.read())
        }

        fn get_redemption_rate(self: @ContractState) -> u256 {
            self.redemption_rate.read()
        }

        fn get_total_debt(self: @ContractState) -> u256 {
            self.total_debt.read()
        }

        fn get_total_collateral(self: @ContractState) -> u256 {
            self.total_collateral.read()
        }

        fn get_debt_ceiling(self: @ContractState) -> u256 {
            self.debt_ceiling.read()
        }

        fn get_liquidation_ratio(self: @ContractState) -> u256 {
            self.liquidation_ratio.read()
        }

        fn get_grit_balance(self: @ContractState, account: ContractAddress) -> u256 {
            self.grit_balances.read(account)
        }

        // ---- Safe operations (called by SafeManager) ----

        fn create_safe(ref self: ContractState, owner: ContractAddress) -> u64 {
            self._assert_safe_manager();
            let id = self.safe_count.read() + 1;
            self.safe_count.write(id);
            self.safe_owners.write(id, owner);
            self.safes.write(id, Safe { collateral: 0, debt: 0 });
            self.emit(SafeCreated { safe_id: id, owner });
            id
        }

        fn deposit_collateral(ref self: ContractState, safe_id: u64, amount: u256) {
            self._assert_safe_manager();
            let mut safe = self.safes.read(safe_id);
            safe.collateral += amount;
            self.safes.write(safe_id, safe);
            let total = self.total_collateral.read();
            self.total_collateral.write(total + amount);
            self.emit(CollateralDeposited { safe_id, amount });
        }

        fn withdraw_collateral(ref self: ContractState, safe_id: u64, amount: u256) {
            self._assert_safe_manager();
            let mut safe = self.safes.read(safe_id);
            assert(safe.collateral >= amount, 'SAFE: insufficient collateral');
            safe.collateral -= amount;
            self.safes.write(safe_id, safe);
            // Check health after withdrawal
            assert(self._is_safe_healthy(safe_id), 'SAFE: would be undercollateral');
            let total = self.total_collateral.read();
            self.total_collateral.write(total - amount);
            self.emit(CollateralWithdrawn { safe_id, amount });
        }

        fn borrow(ref self: ContractState, safe_id: u64, amount: u256) {
            self._assert_safe_manager();
            // Update redemption price before any borrow
            self._update_redemption_price();

            let mut safe = self.safes.read(safe_id);
            safe.debt += amount;
            self.safes.write(safe_id, safe);
            let total = self.total_debt.read();
            self.total_debt.write(total + amount);
            // Check debt ceiling
            assert(total + amount <= self.debt_ceiling.read(), 'SAFE: debt ceiling exceeded');
            // Check health
            assert(self._is_safe_healthy(safe_id), 'SAFE: undercollateralized');
            // Mint Grit to the safe owner
            let owner = self.safe_owners.read(safe_id);
            self._mint(owner, amount);
            self.emit(GritBorrowed { safe_id, amount });
        }

        fn repay(ref self: ContractState, safe_id: u64, amount: u256) {
            self._assert_safe_manager();
            self._update_redemption_price();

            let mut safe = self.safes.read(safe_id);
            let repay_amount = if amount > safe.debt { safe.debt } else { amount };
            safe.debt -= repay_amount;
            self.safes.write(safe_id, safe);
            let total = self.total_debt.read();
            self.total_debt.write(total - repay_amount);
            // Burn Grit from caller (the safe manager will have transferred from user)
            let owner = self.safe_owners.read(safe_id);
            self._burn(owner, repay_amount);
            self.emit(GritRepaid { safe_id, amount: repay_amount });
        }

        // ---- Oracle/Hook updates ----

        fn update_collateral_price(ref self: ContractState, price: u256) {
            self._assert_hook();
            self.collateral_price.write(price);
            self.emit(CollateralPriceUpdated { price });
        }

        fn update_redemption_rate(ref self: ContractState, rate: u256) {
            self._assert_hook();
            // First update the redemption price to current time with the old rate
            self._update_redemption_price();
            // Then set the new rate
            self.redemption_rate.write(rate);
            self.emit(RedemptionRateUpdated { rate });
        }

        // ---- Admin ----

        fn set_debt_ceiling(ref self: ContractState, ceiling: u256) {
            self._assert_admin();
            self.debt_ceiling.write(ceiling);
        }

        fn set_liquidation_ratio(ref self: ContractState, ratio: u256) {
            self._assert_admin();
            self.liquidation_ratio.write(ratio);
        }

        fn set_collateral_join(ref self: ContractState, join: ContractAddress) {
            self._assert_admin();
            self.collateral_join.write(join);
        }

        fn set_safe_manager(ref self: ContractState, manager: ContractAddress) {
            self._assert_admin();
            self.safe_manager.write(manager);
        }

        fn set_hook(ref self: ContractState, hook: ContractAddress) {
            self._assert_admin();
            self.hook.write(hook);
        }
    }

    // ========================================================================
    // ERC20 Implementation for Grit
    // ========================================================================

    #[abi(embed_v0)]
    impl GritERC20Impl of grinta::interfaces::ierc20::IERC20<ContractState> {
        fn name(self: @ContractState) -> ByteArray {
            "Grit"
        }

        fn symbol(self: @ContractState) -> ByteArray {
            "GRIT"
        }

        fn decimals(self: @ContractState) -> u8 {
            18
        }

        fn total_supply(self: @ContractState) -> u256 {
            self.grit_total_supply.read()
        }

        fn balance_of(self: @ContractState, account: ContractAddress) -> u256 {
            self.grit_balances.read(account)
        }

        fn allowance(self: @ContractState, owner: ContractAddress, spender: ContractAddress) -> u256 {
            self.grit_allowances.read((owner, spender))
        }

        fn transfer(ref self: ContractState, recipient: ContractAddress, amount: u256) -> bool {
            let sender = get_caller_address();
            let sender_bal = self.grit_balances.read(sender);
            assert(sender_bal >= amount, 'GRIT: insufficient balance');
            self.grit_balances.write(sender, sender_bal - amount);
            let recipient_bal = self.grit_balances.read(recipient);
            self.grit_balances.write(recipient, recipient_bal + amount);
            self.emit(Transfer { from: sender, to: recipient, value: amount });
            true
        }

        fn transfer_from(
            ref self: ContractState, sender: ContractAddress, recipient: ContractAddress, amount: u256,
        ) -> bool {
            let caller = get_caller_address();
            let allowed = self.grit_allowances.read((sender, caller));
            assert(allowed >= amount, 'GRIT: insufficient allowance');
            self.grit_allowances.write((sender, caller), allowed - amount);
            let sender_bal = self.grit_balances.read(sender);
            assert(sender_bal >= amount, 'GRIT: insufficient balance');
            self.grit_balances.write(sender, sender_bal - amount);
            let recipient_bal = self.grit_balances.read(recipient);
            self.grit_balances.write(recipient, recipient_bal + amount);
            self.emit(Transfer { from: sender, to: recipient, value: amount });
            true
        }

        fn approve(ref self: ContractState, spender: ContractAddress, amount: u256) -> bool {
            let owner = get_caller_address();
            self.grit_allowances.write((owner, spender), amount);
            self.emit(Approval { owner, spender, value: amount });
            true
        }
    }
}
