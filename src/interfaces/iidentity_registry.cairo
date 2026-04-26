use starknet::ContractAddress;

/// Minimal subset of ERC-8004 IdentityRegistry needed by ParameterGuard.
/// Full standard lives in keep-starknet-strange/starknet-agentic
/// (contracts/erc8004-cairo). We only consume the two read entrypoints
/// required to attribute and gate proposals: agent existence + wallet binding.
#[starknet::interface]
pub trait IIdentityRegistry<TState> {
    fn agent_exists(self: @TState, agent_id: u256) -> bool;
    fn get_agent_wallet(self: @TState, agent_id: u256) -> ContractAddress;
}
