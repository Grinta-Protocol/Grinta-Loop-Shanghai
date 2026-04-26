/**
 * Identity Module — ERC-8004 Integration for Grinta PID Agent
 *
 * Wraps the official ERC-8004 IdentityRegistry deployed by
 * keep-starknet-strange/starknet-agentic. Provides:
 *   - registerIdentity(): multicall set_metadata for {agentName, agentType, version}
 *   - getIdentity(): read structured metadata
 *   - getMetadata() / setMetadata(): single key-value access
 *
 * Sepolia: 0x7856876f4c8e1880bc0a2e4c15f4de3085bc2bad5c7b0ae472740f8f558e417
 * Mainnet: 0x33653298d42aca87f9c004c834c6830a08e8f1c0bd694faaa1412ec8fe77595
 *
 * Migrated from opus-agentic/src/identity.ts (2026-04-26).
 */

import { byteArray, type RpcProvider, type Account } from "starknet";

export interface AgentIdentity {
  tokenId: bigint;
  name: string;
  agentType: string;
  version: string;
}

/**
 * Encode (u256, ByteArray key) as raw felts for get_metadata calldata.
 * Layout: tokenId.low, tokenId.high, key.data_len, ...key.data, key.pending_word, key.pending_word_len.
 */
function encodeTokenIdAndByteArray(tokenId: bigint, str: string): string[] {
  const ba = byteArray.byteArrayFromString(str);
  return [
    tokenId & BigInt("0xffffffffffffffffffffffffffffffff"),
    tokenId >> 128n,
    ba.data.length,
    ...ba.data,
    ba.pending_word,
    ba.pending_word_len,
  ].map((v) => "0x" + BigInt(v).toString(16));
}

/**
 * Decode the felt array returned by get_metadata back into a UTF-8 string.
 * Inverse of byteArrayFromString.
 */
function decodeByteArrayResult(result: string[]): string {
  const dataLen = Number(BigInt(result[0]));
  const chunks: string[] = [];

  for (let i = 0; i < dataLen; i++) {
    const felt = BigInt(result[1 + i]);
    const hex = felt.toString(16).padStart(62, "0");
    chunks.push(Buffer.from(hex, "hex").toString("utf8"));
  }

  const pendingWord = BigInt(result[1 + dataLen]);
  const pendingWordLen = Number(BigInt(result[2 + dataLen]));

  if (pendingWordLen > 0) {
    const hex = pendingWord.toString(16).padStart(pendingWordLen * 2, "0");
    chunks.push(Buffer.from(hex, "hex").toString("utf8"));
  }

  return chunks.join("");
}

export class IdentityClient {
  private registryAddress: string;
  private provider: RpcProvider;
  private account: Account | null = null;

  constructor(registryAddress: string, provider: RpcProvider) {
    this.registryAddress = registryAddress;
    this.provider = provider;
  }

  /** Attach an account so write methods (setMetadata, registerIdentity) can sign. */
  connect(account: Account): IdentityClient {
    this.account = account;
    return this;
  }

  async getMetadata(tokenId: bigint, key: string): Promise<string> {
    try {
      const calldata = encodeTokenIdAndByteArray(tokenId, key);

      const result = await this.provider.callContract({
        contractAddress: this.registryAddress,
        entrypoint: "get_metadata",
        calldata,
      });

      return decodeByteArrayResult(result);
    } catch {
      return "";
    }
  }

  async setMetadata(tokenId: bigint, key: string, value: string): Promise<string> {
    if (!this.account) {
      throw new Error("No account connected — call connect(account) first");
    }

    const calldata = this.buildSetMetadataCalldata(tokenId, key, value);

    const result = await this.account.execute({
      contractAddress: this.registryAddress,
      entrypoint: "set_metadata",
      calldata,
    });

    return result.transaction_hash;
  }

  private buildSetMetadataCalldata(
    tokenId: bigint,
    key: string,
    value: string
  ): string[] {
    const keyBA = byteArray.byteArrayFromString(key);
    const valueBA = byteArray.byteArrayFromString(value);

    return [
      tokenId & BigInt("0xffffffffffffffffffffffffffffffff"),
      tokenId >> 128n,
      keyBA.data.length,
      ...keyBA.data,
      keyBA.pending_word,
      keyBA.pending_word_len,
      valueBA.data.length,
      ...valueBA.data,
      valueBA.pending_word,
      valueBA.pending_word_len,
    ].map((v) => "0x" + BigInt(v).toString(16));
  }

  /**
   * One-shot registration — multicall set_metadata for the three canonical
   * keys in a single tx. The NFT must already be minted via
   * register_with_token_uri (handled by the mint script).
   */
  async registerIdentity(
    tokenId: bigint,
    metadata: { name: string; agentType: string; version: string }
  ): Promise<string> {
    if (!this.account) {
      throw new Error("No account connected — call connect(account) first");
    }

    const entries: [string, string][] = [
      ["agentName", metadata.name],
      ["agentType", metadata.agentType],
      ["version", metadata.version],
    ];

    const calls = entries.map(([key, value]) => ({
      contractAddress: this.registryAddress,
      entrypoint: "set_metadata",
      calldata: this.buildSetMetadataCalldata(tokenId, key, value),
    }));

    const result = await this.account.execute(calls);
    return result.transaction_hash;
  }

  async getIdentity(tokenId: bigint): Promise<AgentIdentity | null> {
    try {
      const [name, agentType, version] = await Promise.all([
        this.getMetadata(tokenId, "agentName"),
        this.getMetadata(tokenId, "agentType"),
        this.getMetadata(tokenId, "version"),
      ]);

      return { tokenId, name, agentType, version };
    } catch {
      return null;
    }
  }

  /**
   * Update the token_uri of an existing NFT. Only the NFT owner (or an
   * approved address) can call this. Used to point the registry at a
   * fresh registration JSON after the initial mint.
   */
  async setAgentUri(tokenId: bigint, newUri: string): Promise<string> {
    if (!this.account) {
      throw new Error("No account connected — call connect(account) first");
    }

    const uriBA = byteArray.byteArrayFromString(newUri);
    const calldata = [
      tokenId & BigInt("0xffffffffffffffffffffffffffffffff"),
      tokenId >> 128n,
      uriBA.data.length,
      ...uriBA.data,
      uriBA.pending_word,
      uriBA.pending_word_len,
    ].map((v) => "0x" + BigInt(v).toString(16));

    const result = await this.account.execute({
      contractAddress: this.registryAddress,
      entrypoint: "set_agent_uri",
      calldata,
    });

    return result.transaction_hash;
  }

  async getAgentWallet(tokenId: bigint): Promise<string> {
    const result = await this.provider.callContract({
      contractAddress: this.registryAddress,
      entrypoint: "get_agent_wallet",
      calldata: [
        "0x" + (tokenId & BigInt("0xffffffffffffffffffffffffffffffff")).toString(16),
        "0x" + (tokenId >> 128n).toString(16),
      ],
    });
    return result[0] || "0x0";
  }

  async agentExists(tokenId: bigint): Promise<boolean> {
    try {
      const result = await this.provider.callContract({
        contractAddress: this.registryAddress,
        entrypoint: "agent_exists",
        calldata: [
          "0x" + (tokenId & BigInt("0xffffffffffffffffffffffffffffffff")).toString(16),
          "0x" + (tokenId >> 128n).toString(16),
        ],
      });
      return BigInt(result[0] || "0x0") === 1n;
    } catch {
      return false;
    }
  }
}
