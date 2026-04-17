use starknet::ContractAddress;
use grinta::types::AgentPolicy;

#[starknet::interface]
pub trait IParameterGuard<TContractState> {
    // === Agent functions ===
    /// Agent proposes new Kp/Ki values. Guard validates bounds and forwards to PIDController.
    fn propose_parameters(ref self: TContractState, new_kp: i128, new_ki: i128, is_emergency: bool);

    // === Admin functions ===
    fn set_agent(ref self: TContractState, agent: ContractAddress);
    fn set_policy(ref self: TContractState, policy: AgentPolicy);
    fn emergency_stop(ref self: TContractState);
    fn resume(ref self: TContractState);
    fn revoke_agent(ref self: TContractState);

    // === Proxy admin (human admin retains PIDController control via Guard) ===
    fn proxy_set_seed_proposer(ref self: TContractState, proposer: ContractAddress);
    fn proxy_set_noise_barrier(ref self: TContractState, barrier: u256);
    fn proxy_set_per_second_cumulative_leak(ref self: TContractState, leak: u256);
    fn proxy_transfer_pid_admin(ref self: TContractState, new_admin: ContractAddress);

    // === View functions ===
    fn get_policy(self: @TContractState) -> AgentPolicy;
    fn get_agent(self: @TContractState) -> ContractAddress;
    fn is_stopped(self: @TContractState) -> bool;
    fn get_update_count(self: @TContractState) -> u32;
    fn get_last_update_timestamp(self: @TContractState) -> u64;
}
