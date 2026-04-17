/**
 * On-Chain Executor — submits parameter changes via ParameterGuard
 *
 * Uses starknet.js v8 Account to call propose_parameters(new_kp, new_ki, is_emergency).
 */

import { Account, RpcProvider, CallData } from "starknet";
import { CONFIG } from "./config.js";

export class Executor {
  private provider: RpcProvider;
  private account: Account;

  constructor() {
    this.provider = new RpcProvider({ nodeUrl: CONFIG.RPC_URL });

    this.account = new Account({
      provider: this.provider,
      address: CONFIG.AGENT_ADDRESS,
      signer: CONFIG.AGENT_PRIVATE_KEY,
    });
  }

  get address(): string {
    return this.account.address;
  }

  /**
   * Call ParameterGuard.propose_parameters(new_kp, new_ki, is_emergency)
   *
   * KP and KI are signed i128 (WAD). On Starknet calldata, i128 is encoded as felt252.
   * Negative values need two's complement: value + 2^128.
   */
  async proposeParameters(
    newKp: bigint,
    newKi: bigint,
    isEmergency: boolean
  ): Promise<string> {
    const calldata = [
      encodeI128(newKp),
      encodeI128(newKi),
      isEmergency ? "1" : "0",
    ];

    const result = await this.account.execute({
      contractAddress: CONFIG.PARAMETER_GUARD_ADDRESS,
      entrypoint: "propose_parameters",
      calldata,
    });

    // Wait for tx acceptance
    await this.provider.waitForTransaction(result.transaction_hash, {
      successStates: ["ACCEPTED_ON_L2", "ACCEPTED_ON_L1"],
    });

    return result.transaction_hash;
  }
}

/**
 * Encode a signed i128 value as a felt252 string for Starknet calldata.
 * Positive: as-is. Negative: two's complement (value + 2^128).
 */
function encodeI128(value: bigint): string {
  if (value >= 0n) {
    return "0x" + value.toString(16);
  }
  // Two's complement for negative
  const encoded = value + (1n << 128n);
  return "0x" + encoded.toString(16);
}
