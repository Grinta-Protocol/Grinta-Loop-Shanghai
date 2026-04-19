/**
 * Create a new Starknet wallet for the agent.
 *
 * Steps:
 *   1. Generate a random private key + derive public key
 *   2. Compute the counterfactual OZ Account address
 *   3. Print instructions to fund it on Sepolia faucet
 *   4. Deploy the OZ Account contract
 *
 * Usage:
 *   npx tsx scripts/create-agent-wallet.ts generate   # step 1-3
 *   npx tsx scripts/create-agent-wallet.ts deploy      # step 4 (after funding)
 */

import {
  Account,
  RpcProvider,
  stark,
  ec,
  hash,
  CallData,
  type DeployAccountContractPayload,
} from "starknet";

// OZ Account class hash on Sepolia (OpenZeppelin Account v0.14.0)
const OZ_ACCOUNT_CLASS_HASH =
  "0x061dac032f228abef9c6f3bc9c47b343aa4fefb221e4537e3764a253e2674e24";

const RPC_URL =
  process.env.STARKNET_RPC_URL ||
  "https://starknet-sepolia.public.blastapi.io";

async function generate() {
  // 1. Random private key
  const privateKey = stark.randomAddress();
  const publicKey = ec.starkCurve.getStarkKey(privateKey);

  // 2. Compute counterfactual address
  const constructorCalldata = CallData.compile({ public_key: publicKey });
  const address = hash.calculateContractAddressFromHash(
    publicKey, // salt
    OZ_ACCOUNT_CLASS_HASH,
    constructorCalldata,
    0 // deployer address (0 = counterfactual)
  );

  console.log("\n=== NEW AGENT WALLET ===");
  console.log(`Private Key : ${privateKey}`);
  console.log(`Public Key  : ${publicKey}`);
  console.log(`Address     : ${address}`);
  console.log(`\nNext steps:`);
  console.log(`  1. Fund this address on Sepolia faucet: https://faucet.starknet.io`);
  console.log(`  2. Run: npx tsx scripts/create-agent-wallet.ts deploy`);
  console.log(`     with env vars:`);
  console.log(`       NEW_AGENT_PRIVATE_KEY=${privateKey}`);
  console.log(`       NEW_AGENT_PUBLIC_KEY=${publicKey}`);
  console.log(`       NEW_AGENT_ADDRESS=${address}`);
  console.log(`\n  3. Then update agent/.env and demo/.env with the new address + key\n`);
}

async function deploy() {
  const privateKey = process.env.NEW_AGENT_PRIVATE_KEY;
  const publicKey = process.env.NEW_AGENT_PUBLIC_KEY;
  const address = process.env.NEW_AGENT_ADDRESS;

  if (!privateKey || !publicKey || !address) {
    console.error("Missing env vars: NEW_AGENT_PRIVATE_KEY, NEW_AGENT_PUBLIC_KEY, NEW_AGENT_ADDRESS");
    console.error("Run 'generate' first and set them.");
    process.exit(1);
  }

  const provider = new RpcProvider({ nodeUrl: RPC_URL });

  // Check balance first
  try {
    // ETH on Sepolia
    const ethAddress = "0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7";
    const balance = await provider.callContract({
      contractAddress: ethAddress,
      entrypoint: "balanceOf",
      calldata: [address],
    });
    const bal = BigInt(balance[0]);
    if (bal === 0n) {
      console.error(`Address ${address} has 0 ETH. Fund it first!`);
      process.exit(1);
    }
    console.log(`Balance: ${Number(bal) / 1e18} ETH — OK`);
  } catch (e) {
    console.log("Could not check balance, proceeding anyway...");
  }

  const constructorCalldata = CallData.compile({ public_key: publicKey });

  const account = new Account(provider, address, privateKey);

  console.log("Deploying OZ Account...");
  const { transaction_hash, contract_address } =
    await account.deployAccount({
      classHash: OZ_ACCOUNT_CLASS_HASH,
      constructorCalldata,
      addressSalt: publicKey,
    });

  console.log(`TX: ${transaction_hash}`);
  console.log("Waiting for confirmation...");
  await provider.waitForTransaction(transaction_hash);
  console.log(`✅ Account deployed at: ${contract_address}`);
  console.log(`\nAdd to agent/.env:`);
  console.log(`  AGENT_PRIVATE_KEY=${privateKey}`);
  console.log(`  AGENT_ADDRESS=${contract_address}`);
}

const cmd = process.argv[2];
if (cmd === "deploy") {
  deploy().catch(console.error);
} else {
  generate().catch(console.error);
}
