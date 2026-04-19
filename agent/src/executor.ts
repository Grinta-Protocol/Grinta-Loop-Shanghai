/**
 * On-Chain Executor — submits parameter changes via ParameterGuard
 *
 * Uses starknet.js v8 Account to call propose_parameters(new_kp, new_ki, is_emergency).
 */

import { Account, RpcProvider, CallData } from "starknet";
import { CONFIG } from "./config.js";

export interface ExecutionResult {
  txHash: string;
  confirmedKp: bigint;
  confirmedKi: bigint;
}

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
  /**
   * Submit propose_parameters tx with retry logic to handle nonce collisions.
   */
  async proposeParameters(
    newKp: bigint,
    newKi: bigint,
    isEmergency: boolean
  ): Promise<ExecutionResult> {
    const MAX_RETRIES = 3;
    const BASE_DELAY_MS = 2000;

    const calldata = [
      encodeI128(newKp),
      encodeI128(newKi),
      isEmergency ? "1" : "0",
    ];

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        const result = await this.account.execute({
          contractAddress: CONFIG.PARAMETER_GUARD_ADDRESS,
          entrypoint: "propose_parameters",
          calldata,
        });

        await this.provider.waitForTransaction(result.transaction_hash, {
          successStates: ["ACCEPTED_ON_L2", "ACCEPTED_ON_L1"],
        });

        return {
          txHash: result.transaction_hash,
          confirmedKp: newKp,
          confirmedKi: newKi,
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        const isNonceError = /nonce/i.test(msg) || /invalid transaction nonce/i.test(msg);

        if (isNonceError && attempt < MAX_RETRIES) {
          const delay = BASE_DELAY_MS * 2 ** attempt;
          console.warn(
            `[Executor] Nonce collision (attempt ${attempt + 1}/${MAX_RETRIES + 1}), retrying in ${delay}ms...`
          );
          await new Promise((r) => setTimeout(r, delay));
          continue;
        }
        throw err;
      }
    }

    throw new Error("proposeParameters: exhausted retries");
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
