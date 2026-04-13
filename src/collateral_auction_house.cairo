/// CollateralAuctionHouse — Dutch auction for seized collateral
/// Sells collateral at increasing discount to recover debt
#[starknet::contract]
pub mod CollateralAuctionHouse {
    use starknet::storage::{Map, StorageMapReadAccess, StorageMapWriteAccess, StoragePointerReadAccess, StoragePointerWriteAccess};
    use starknet::{ContractAddress, get_caller_address, get_block_timestamp};
    use grinta::types::{Auction, RAY, wmul, wdiv, rpow};
    use grinta::interfaces::isafe_engine::{ISAFEEngineDispatcher, ISAFEEngineDispatcherTrait};
    use grinta::interfaces::ierc20::{IERC20Dispatcher, IERC20DispatcherTrait};
    use grinta::interfaces::iliquidation_engine::{ILiquidationEngineDispatcher, ILiquidationEngineDispatcherTrait};
    use grinta::interfaces::iaccounting_engine::{IAccountingEngineDispatcher, IAccountingEngineDispatcherTrait};

    #[storage]
    struct Storage {
        admin: ContractAddress,
        safe_engine: ContractAddress,
        liquidation_engine: ContractAddress,
        accounting_engine: ContractAddress,
        collateral_token: ContractAddress,

        // Parameters
        min_discount: u256,                    // WAD (e.g. 0.95e18 = 5% off)
        max_discount: u256,                    // WAD (e.g. 0.80e18 = 20% off)
        per_second_discount_update_rate: u256, // RAY per second
        minimum_bid: u256,                     // Min GRIT to participate (WAD)

        // Auction state
        auctions: Map<u64, Auction>,
        auction_count: u64,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    pub enum Event {
        AuctionStarted: AuctionStarted,
        CollateralBought: CollateralBought,
        AuctionSettled: AuctionSettled,
    }

    #[derive(Drop, starknet::Event)]
    pub struct AuctionStarted {
        #[key] pub auction_id: u64,
        pub collateral_amount: u256,
        pub debt_to_raise: u256,
        pub safe_owner: ContractAddress,
    }
    #[derive(Drop, starknet::Event)]
    pub struct CollateralBought {
        #[key] pub auction_id: u64,
        pub buyer: ContractAddress,
        pub collateral_received: u256,
        pub grit_paid: u256,
    }
    #[derive(Drop, starknet::Event)]
    pub struct AuctionSettled {
        #[key] pub auction_id: u64,
        pub leftover_collateral: u256,
    }

    #[constructor]
    fn constructor(
        ref self: ContractState,
        admin: ContractAddress,
        safe_engine: ContractAddress,
        liquidation_engine: ContractAddress,
        accounting_engine: ContractAddress,
        collateral_token: ContractAddress,
        min_discount: u256,
        max_discount: u256,
        per_second_discount_update_rate: u256,
        minimum_bid: u256,
    ) {
        self.admin.write(admin);
        self.safe_engine.write(safe_engine);
        self.liquidation_engine.write(liquidation_engine);
        self.accounting_engine.write(accounting_engine);
        self.collateral_token.write(collateral_token);
        self.min_discount.write(min_discount);
        self.max_discount.write(max_discount);
        self.per_second_discount_update_rate.write(per_second_discount_update_rate);
        self.minimum_bid.write(minimum_bid);
    }

    #[generate_trait]
    impl InternalImpl of InternalTrait {
        fn _assert_admin(self: @ContractState) {
            assert(get_caller_address() == self.admin.read(), 'AH: not admin');
        }

        fn _assert_liquidation_engine(self: @ContractState) {
            assert(get_caller_address() == self.liquidation_engine.read(), 'AH: not liq engine');
        }

        /// Compute current discount for an auction based on elapsed time.
        /// Starts at min_discount, grows toward max_discount.
        /// discount = min(min_discount * rate^elapsed / RAY, max_discount)
        /// BUT: discount means "percentage of price the buyer pays" (0.95 = 5% off)
        /// So it DECREASES over time (buyer pays LESS).
        /// Actually: let's invert. We compute the "multiplier" the buyer pays.
        /// At start: buyer pays min_discount (e.g. 0.95) of oracle price.
        /// Over time: decreases toward max_discount (e.g. 0.80).
        fn _get_current_discount(self: @ContractState, auction_id: u64) -> u256 {
            let auction = self.auctions.read(auction_id);
            let now = get_block_timestamp();
            let elapsed: u256 = (now - auction.start_time).into();

            if elapsed == 0 {
                return self.min_discount.read();
            }

            let rate = self.per_second_discount_update_rate.read();
            // rate < RAY → multiplier decreases over time
            let decay = rpow(rate, elapsed);
            // current_discount = min_discount * decay / RAY
            let min_d = self.min_discount.read();
            let current = (min_d * decay + RAY / 2) / RAY;
            let max_d = self.max_discount.read();

            if current < max_d {
                max_d // Floor at max_discount (lowest price buyer pays)
            } else {
                current
            }
        }

        /// Compute collateral price in GRIT at current discount.
        /// fair_price_in_grit = btc_price_wad / redemption_price_wad
        /// discounted_price = fair_price_in_grit * discount
        fn _get_collateral_price_in_grit(self: @ContractState, discount: u256) -> u256 {
            let engine = ISAFEEngineDispatcher { contract_address: self.safe_engine.read() };
            let btc_price = engine.get_collateral_price();
            let redemption_price_ray = engine.get_redemption_price();
            let redemption_price_wad = redemption_price_ray / 1_000_000_000; // RAY -> WAD

            if redemption_price_wad == 0 {
                return 0;
            }

            // fair_price = btc_price / redemption_price (both WAD → result WAD)
            let fair_price = wdiv(btc_price, redemption_price_wad);
            // discounted = fair_price * discount / WAD
            wmul(fair_price, discount)
        }
    }

    #[abi(embed_v0)]
    impl CollateralAuctionHouseImpl of grinta::interfaces::icollateral_auction_house::ICollateralAuctionHouse<ContractState> {
        fn start_auction(
            ref self: ContractState,
            collateral_amount: u256,
            debt_to_raise: u256,
            safe_owner: ContractAddress,
        ) -> u64 {
            self._assert_liquidation_engine();

            let id = self.auction_count.read() + 1;
            self.auction_count.write(id);

            let auction = Auction {
                collateral_amount,
                debt_to_raise,
                start_time: get_block_timestamp(),
                safe_owner,
                settled: false,
            };
            self.auctions.write(id, auction);

            self.emit(AuctionStarted { auction_id: id, collateral_amount, debt_to_raise, safe_owner });
            id
        }

        fn buy_collateral(ref self: ContractState, auction_id: u64, grit_amount: u256) -> u256 {
            let mut auction = self.auctions.read(auction_id);
            assert(!auction.settled, 'AH: auction settled');
            assert(auction.collateral_amount > 0, 'AH: no collateral left');
            assert(grit_amount >= self.minimum_bid.read(), 'AH: below minimum bid');

            let buyer = get_caller_address();

            // 1. Get current discounted price per unit of collateral (in GRIT, WAD)
            let discount = self._get_current_discount(auction_id);
            let price_per_unit = self._get_collateral_price_in_grit(discount);
            assert(price_per_unit > 0, 'AH: zero price');

            // 2. How much collateral can the buyer get?
            // collateral = grit_amount / price_per_unit (both WAD)
            let mut collateral_to_buy = wdiv(grit_amount, price_per_unit);

            // Cap at available collateral
            if collateral_to_buy > auction.collateral_amount {
                collateral_to_buy = auction.collateral_amount;
            }

            // 3. Compute actual GRIT cost
            let mut actual_grit_cost = wmul(collateral_to_buy, price_per_unit);

            // Cap at what the buyer actually offered (rounding protection)
            if actual_grit_cost > grit_amount {
                actual_grit_cost = grit_amount;
                collateral_to_buy = wdiv(actual_grit_cost, price_per_unit);
            }

            // Cap at remaining debt to raise
            if actual_grit_cost > auction.debt_to_raise {
                actual_grit_cost = auction.debt_to_raise;
                // Recalculate collateral for the capped cost
                collateral_to_buy = wdiv(actual_grit_cost, price_per_unit);
            }

            assert(collateral_to_buy > 0, 'AH: zero collateral');

            // 4. Transfer GRIT from buyer to accounting engine
            let grit = IERC20Dispatcher { contract_address: self.safe_engine.read() };
            let ae_addr = self.accounting_engine.read();
            let success = grit.transfer_from(buyer, ae_addr, actual_grit_cost);
            assert(success, 'AH: grit transfer failed');

            // 5. Transfer collateral (WBTC) from this contract to buyer
            // Collateral is in WAD (internal), convert to asset decimals
            // Actually, the AuctionHouse holds WBTC in asset units (transferred by CollateralJoin.seize)
            // We need to convert WAD → asset units for the transfer
            // For WBTC: asset = internal / 1e10
            let collateral_token = IERC20Dispatcher { contract_address: self.collateral_token.read() };
            let asset_amount = collateral_to_buy / 10_000_000_000; // WAD → 8 decimals
            if asset_amount > 0 {
                let transfer_ok = collateral_token.transfer(buyer, asset_amount);
                assert(transfer_ok, 'AH: col transfer failed');
            }

            // 6. Update auction state
            auction.collateral_amount -= collateral_to_buy;
            auction.debt_to_raise -= actual_grit_cost;

            // 7. Check if auction is complete
            if auction.debt_to_raise == 0 || auction.collateral_amount == 0 {
                auction.settled = true;

                // Return leftover collateral to safe owner
                if auction.collateral_amount > 0 {
                    let leftover_asset = auction.collateral_amount / 10_000_000_000;
                    if leftover_asset > 0 {
                        collateral_token.transfer(auction.safe_owner, leftover_asset);
                    }
                    self.emit(AuctionSettled { auction_id, leftover_collateral: auction.collateral_amount });
                    auction.collateral_amount = 0;
                } else {
                    self.emit(AuctionSettled { auction_id, leftover_collateral: 0 });
                }

                // Notify liquidation engine
                let le = ILiquidationEngineDispatcher { contract_address: self.liquidation_engine.read() };
                le.remove_coins_from_auction(actual_grit_cost);

                // Notify accounting engine of surplus received
                let ae = IAccountingEngineDispatcher { contract_address: ae_addr };
                ae.receive_surplus(actual_grit_cost);
            }

            self.auctions.write(auction_id, auction);

            self.emit(CollateralBought {
                auction_id, buyer, collateral_received: collateral_to_buy, grit_paid: actual_grit_cost,
            });

            collateral_to_buy
        }

        // ---- Views ----

        fn get_auction(self: @ContractState, auction_id: u64) -> Auction {
            self.auctions.read(auction_id)
        }

        fn get_auction_count(self: @ContractState) -> u64 {
            self.auction_count.read()
        }

        fn get_current_discount(self: @ContractState, auction_id: u64) -> u256 {
            self._get_current_discount(auction_id)
        }

        fn get_collateral_price_in_grit(self: @ContractState, auction_id: u64) -> u256 {
            let discount = self._get_current_discount(auction_id);
            self._get_collateral_price_in_grit(discount)
        }

        fn get_min_discount(self: @ContractState) -> u256 {
            self.min_discount.read()
        }

        fn get_max_discount(self: @ContractState) -> u256 {
            self.max_discount.read()
        }

        fn get_minimum_bid(self: @ContractState) -> u256 {
            self.minimum_bid.read()
        }

        // ---- Admin ----

        fn set_min_discount(ref self: ContractState, discount: u256) {
            self._assert_admin();
            self.min_discount.write(discount);
        }

        fn set_max_discount(ref self: ContractState, discount: u256) {
            self._assert_admin();
            self.max_discount.write(discount);
        }

        fn set_minimum_bid(ref self: ContractState, bid: u256) {
            self._assert_admin();
            self.minimum_bid.write(bid);
        }
    }
}
