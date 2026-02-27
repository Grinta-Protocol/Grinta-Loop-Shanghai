use grinta::types::{ControllerGains, DeviationObservation, PIDControllerParams};

#[starknet::interface]
pub trait IPIDController<TContractState> {
    fn compute_rate(
        ref self: TContractState, market_price: u256, redemption_price: u256,
    ) -> u256;

    fn get_next_redemption_rate(
        self: @TContractState, market_price: u256, redemption_price: u256, accumulated_leak: u256,
    ) -> (u256, i128, i128);

    fn get_bounded_redemption_rate(self: @TContractState, pi_output: i128) -> u256;

    fn get_gain_adjusted_pi_output(
        self: @TContractState, proportional_term: i128, integral_term: i128,
    ) -> i128;

    fn breaks_noise_barrier(self: @TContractState, pi_sum: u256, redemption_price: u256) -> bool;

    fn get_deviation_observation(self: @TContractState) -> DeviationObservation;
    fn get_controller_gains(self: @TContractState) -> ControllerGains;
    fn get_params(self: @TContractState) -> PIDControllerParams;
    fn time_since_last_update(self: @TContractState) -> u256;
}
