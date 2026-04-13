/// PIDController — HAI-style PI controller with leaky integrator
/// Ported from HAI's PIDController.sol to Cairo
/// Outputs a redemption rate that adjusts a continuously drifting redemption price
#[starknet::contract]
pub mod PIDController {
    use starknet::storage::{StoragePointerReadAccess, StoragePointerWriteAccess};
    use starknet::{ContractAddress, get_caller_address, get_block_timestamp};
    use grinta::types::{
        WAD, RAY, RAY_i128,
        DeviationObservation, PIDControllerParams, ControllerGains,
        wmul, rpow, abs_i128, swmul, srmul, riemann_sum,
    };

    // Maximum positive rate: type(i128).max equivalent
    const POSITIVE_RATE_LIMIT: u256 = 170141183460469231731687303715884105727; // 2^127 - 1
    // Minimum rate floor: ~0.9999999 RAY per second
    // This prevents the rate from going so low that price crashes to zero
    // At this rate, price halves in ~115 days (slow enough to be manageable)
    const MIN_RATE_FLOOR: u256 = 999_999_930_000_000_000_000_000_000; // ~0.99999993 RAY

    #[storage]
    struct Storage {
        admin: ContractAddress,
        seed_proposer: ContractAddress,  // Only this address can call compute_rate (the hook)

        // Controller gains
        kp: i128,   // Proportional gain (WAD)
        ki: i128,   // Integral gain (WAD)

        // Parameters
        noise_barrier: u256,                // Min deviation to act (WAD, e.g. 0.95e18)
        integral_period_size: u64,          // Min seconds between updates
        feedback_output_upper_bound: u256,  // Max positive adjustment (RAY)
        feedback_output_lower_bound: i128,  // Max negative adjustment (RAY, signed)
        per_second_cumulative_leak: u256,   // Integral decay per second (RAY)

        // State: last deviation observation
        deviation_timestamp: u64,
        deviation_proportional: i128,
        deviation_integral: i128,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    pub enum Event {
        UpdateDeviation: UpdateDeviation,
        RateComputed: RateComputed,
    }

    #[derive(Drop, starknet::Event)]
    pub struct UpdateDeviation {
        pub proportional: i128,
        pub integral: i128,
        pub applied_deviation: i128,
    }

    #[derive(Drop, starknet::Event)]
    pub struct RateComputed {
        pub market_price: u256,
        pub redemption_price: u256,
        pub redemption_rate: u256,
    }

    #[constructor]
    fn constructor(
        ref self: ContractState,
        admin: ContractAddress,
        seed_proposer: ContractAddress,
        kp: i128,
        ki: i128,
        noise_barrier: u256,
        integral_period_size: u64,
        feedback_output_upper_bound: u256,
        feedback_output_lower_bound: i128,
        per_second_cumulative_leak: u256,
    ) {
        self.admin.write(admin);
        self.seed_proposer.write(seed_proposer);
        self.kp.write(kp);
        self.ki.write(ki);
        self.noise_barrier.write(noise_barrier);
        self.integral_period_size.write(integral_period_size);
        self.feedback_output_upper_bound.write(feedback_output_upper_bound);
        self.feedback_output_lower_bound.write(feedback_output_lower_bound);
        self.per_second_cumulative_leak.write(per_second_cumulative_leak);
    }

    // ========================================================================
    // Internal functions
    // ========================================================================

    #[generate_trait]
    impl InternalImpl of InternalTrait {
        fn _assert_admin(self: @ContractState) {
            assert(get_caller_address() == self.admin.read(), 'PID: not admin');
        }

        fn _time_since_last_update(self: @ContractState) -> u64 {
            let ts = self.deviation_timestamp.read();
            if ts == 0 {
                0
            } else {
                get_block_timestamp() - ts
            }
        }

        /// Proportional term = (redemptionPrice - scaledMarketPrice) / redemptionPrice
        /// Result is WAD-scaled (18 decimals)
        fn _get_proportional_term(
            self: @ContractState, market_price: u256, redemption_price: u256,
        ) -> i128 {
            // Market price is WAD (18 dec), redemption price is RAY (27 dec)
            // Scale market price to RAY
            let scaled_market: u256 = market_price * 1_000_000_000; // WAD -> RAY

            // Compute deviation: (redemptionPrice - scaledMarket) / redemptionPrice
            // Result in WAD precision
            if scaled_market <= redemption_price {
                // Positive deviation (market below target)
                let diff: u256 = redemption_price - scaled_market;
                // diff * WAD / redemption_price → WAD-scaled ratio
                let ratio: u256 = (diff * WAD) / redemption_price;
                let result: u128 = ratio.try_into().unwrap();
                result.try_into().unwrap()
            } else {
                // Negative deviation (market above target)
                let diff: u256 = scaled_market - redemption_price;
                let ratio: u256 = (diff * WAD) / redemption_price;
                let result: u128 = ratio.try_into().unwrap();
                let result_i: i128 = result.try_into().unwrap();
                -result_i
            }
        }

        /// Check if |piOutput| breaks the noise barrier
        fn _breaks_noise_barrier(
            self: @ContractState, pi_sum: u256, redemption_price: u256,
        ) -> bool {
            if pi_sum == 0 {
                return false;
            }
            let noise = self.noise_barrier.read();
            let delta_noise: u256 = 2 * WAD - noise;
            // pi_sum >= redemptionPrice * deltaNoise / WAD - redemptionPrice
            // In WAD: piSum >= wmul(redemptionPrice_in_wad, deltaNoise) - redemptionPrice_in_wad
            let r_price_wad = redemption_price / 1_000_000_000; // RAY -> WAD
            let threshold = wmul(r_price_wad, delta_noise);
            if threshold <= r_price_wad {
                return true; // prevent underflow
            }
            pi_sum >= threshold - r_price_wad
        }

        /// Gain adjusted PI output: Kp * P + Ki * I
        fn _get_gain_adjusted_pi_output(
            self: @ContractState, proportional: i128, integral: i128,
        ) -> i128 {
            let kp = self.kp.read();
            let ki = self.ki.read();
            swmul(kp, proportional) + swmul(ki, integral)
        }

        /// Bound the PI output between lower and upper bounds
        fn _get_bounded_pi_output(self: @ContractState, pi_output: i128) -> i128 {
            let lower = self.feedback_output_lower_bound.read();
            // Upper bound is u256, but for i128 comparison we cap at i128 max
            let upper_u: u256 = self.feedback_output_upper_bound.read();
            let upper_u128: u128 = if upper_u > 170141183460469231731687303715884105727 {
                170141183460469231731687303715884105727_u128 // i128 max
            } else {
                upper_u.try_into().unwrap()
            };
            let upper: i128 = upper_u128.try_into().unwrap();

            if pi_output < lower {
                lower
            } else if pi_output > upper {
                upper
            } else {
                pi_output
            }
        }

        /// Convert bounded PI output to a redemption rate
        /// rate = RAY + boundedPIOutput (clamped to [MIN_RATE_FLOOR, POSITIVE_RATE_LIMIT])
        fn _get_bounded_redemption_rate(self: @ContractState, pi_output: i128) -> u256 {
            let bounded = self._get_bounded_pi_output(pi_output);

            let ray_i: i128 = RAY_i128;
            if bounded < -ray_i {
                // Would make rate negative, clamp to floor
                MIN_RATE_FLOOR
            } else {
                let new_rate_i: i128 = ray_i + bounded;
                if new_rate_i <= 0 {
                    MIN_RATE_FLOOR // minimum rate — prevents price crash to zero
                } else {
                    let rate_u128: u128 = new_rate_i.try_into().unwrap();
                    let rate: u256 = rate_u128.into();
                    // Enforce floor
                    if rate < MIN_RATE_FLOOR {
                        MIN_RATE_FLOOR
                    } else {
                        rate
                    }
                }
            }
        }

        /// Compute next integral term with leak
        fn _get_next_deviation_cumulative(
            self: @ContractState, proportional: i128, accumulated_leak: u256,
        ) -> (i128, i128) {
            let last_proportional = self.deviation_proportional.read();
            let time_elapsed: u64 = self._time_since_last_update();

            // Trapezoidal integration: (current + last) / 2 * timeDelta
            let avg_deviation = riemann_sum(proportional, last_proportional);
            let new_time_adjusted: i128 = avg_deviation * time_elapsed.into();

            // Apply leak to existing integral
            let old_integral = self.deviation_integral.read();
            let leaked_integral = srmul(old_integral, accumulated_leak);

            (leaked_integral + new_time_adjusted, new_time_adjusted)
        }

        /// Update deviation state
        fn _update_deviation(
            ref self: ContractState, proportional: i128, accumulated_leak: u256,
        ) -> i128 {
            let (integral, applied_deviation) = self._get_next_deviation_cumulative(
                proportional, accumulated_leak,
            );

            self.deviation_timestamp.write(get_block_timestamp());
            self.deviation_proportional.write(proportional);
            self.deviation_integral.write(integral);

            self.emit(UpdateDeviation { proportional, integral, applied_deviation });
            integral
        }
    }

    // ========================================================================
    // IPIDController implementation
    // ========================================================================

    #[abi(embed_v0)]
    impl PIDControllerImpl of grinta::interfaces::ipid_controller::IPIDController<ContractState> {
        /// Main entry point: compute new redemption rate given market and redemption prices
        /// Only callable by seed_proposer (the GrintaHook)
        fn compute_rate(
            ref self: ContractState, market_price: u256, redemption_price: u256,
        ) -> u256 {
            assert(get_caller_address() == self.seed_proposer.read(), 'PID: only seed proposer');

            let time_since = self._time_since_last_update();
            // Enforce cooldown (except first update)
            if self.deviation_timestamp.read() != 0 {
                assert(
                    time_since >= self.integral_period_size.read(),
                    'PID: cooldown not elapsed',
                );
            }

            // 1. Compute proportional term
            let proportional = self._get_proportional_term(market_price, redemption_price);

            // 2. Compute accumulated leak for the integral
            let leak = self.per_second_cumulative_leak.read();
            let accumulated_leak = rpow(leak, time_since.into());

            // 3. Update integral term
            let integral = self._update_deviation(proportional, accumulated_leak);

            // 4. Apply gains and sum
            let pi_output = self._get_gain_adjusted_pi_output(proportional, integral);

            // 5. Check noise barrier
            let abs_output: u256 = abs_i128(pi_output).into();
            if self._breaks_noise_barrier(abs_output, redemption_price) {
                let rate = self._get_bounded_redemption_rate(pi_output);
                self.emit(RateComputed { market_price, redemption_price, redemption_rate: rate });
                rate
            } else {
                // Below noise barrier: return RAY (no change)
                self.emit(RateComputed { market_price, redemption_price, redemption_rate: RAY });
                RAY
            }
        }

        fn get_next_redemption_rate(
            self: @ContractState, market_price: u256, redemption_price: u256, accumulated_leak: u256,
        ) -> (u256, i128, i128) {
            let proportional = self._get_proportional_term(market_price, redemption_price);
            let (integral, _) = self._get_next_deviation_cumulative(proportional, accumulated_leak);
            let pi_output = self._get_gain_adjusted_pi_output(proportional, integral);
            let abs_output: u256 = abs_i128(pi_output).into();
            if self._breaks_noise_barrier(abs_output, redemption_price) {
                let rate = self._get_bounded_redemption_rate(pi_output);
                (rate, proportional, integral)
            } else {
                (RAY, proportional, integral)
            }
        }

        fn get_bounded_redemption_rate(self: @ContractState, pi_output: i128) -> u256 {
            self._get_bounded_redemption_rate(pi_output)
        }

        fn get_gain_adjusted_pi_output(
            self: @ContractState, proportional_term: i128, integral_term: i128,
        ) -> i128 {
            self._get_gain_adjusted_pi_output(proportional_term, integral_term)
        }

        fn breaks_noise_barrier(self: @ContractState, pi_sum: u256, redemption_price: u256) -> bool {
            self._breaks_noise_barrier(pi_sum, redemption_price)
        }

        fn get_deviation_observation(self: @ContractState) -> DeviationObservation {
            DeviationObservation {
                timestamp: self.deviation_timestamp.read(),
                proportional: self.deviation_proportional.read(),
                integral: self.deviation_integral.read(),
            }
        }

        fn get_controller_gains(self: @ContractState) -> ControllerGains {
            ControllerGains { kp: self.kp.read(), ki: self.ki.read() }
        }

        fn get_params(self: @ContractState) -> PIDControllerParams {
            PIDControllerParams {
                noise_barrier: self.noise_barrier.read(),
                integral_period_size: self.integral_period_size.read(),
                feedback_output_upper_bound: self.feedback_output_upper_bound.read(),
                feedback_output_lower_bound: self.feedback_output_lower_bound.read(),
                per_second_cumulative_leak: self.per_second_cumulative_leak.read(),
            }
        }

        fn time_since_last_update(self: @ContractState) -> u256 {
            self._time_since_last_update().into()
        }
    }

    // ========================================================================
    // Admin
    // ========================================================================

    #[external(v0)]
    fn set_seed_proposer(ref self: ContractState, proposer: ContractAddress) {
        self._assert_admin();
        self.seed_proposer.write(proposer);
    }

    #[external(v0)]
    fn set_kp(ref self: ContractState, kp: i128) {
        self._assert_admin();
        self.kp.write(kp);
    }

    #[external(v0)]
    fn set_ki(ref self: ContractState, ki: i128) {
        self._assert_admin();
        self.ki.write(ki);
    }

    #[external(v0)]
    fn set_noise_barrier(ref self: ContractState, barrier: u256) {
        self._assert_admin();
        self.noise_barrier.write(barrier);
    }

    #[external(v0)]
    fn set_per_second_cumulative_leak(ref self: ContractState, leak: u256) {
        self._assert_admin();
        self.per_second_cumulative_leak.write(leak);
    }
}
