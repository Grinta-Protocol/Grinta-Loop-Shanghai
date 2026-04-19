import express from "express";
import cors from "cors";
import { Account, RpcProvider, CallData, cairo, type Call } from "starknet";
import OpenAI from "openai";
import dotenv from "dotenv";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { existsSync } from "fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, "..", ".env") });

function req(key: string): string {
  const v = process.env[key];
  if (!v) throw new Error(`Missing env var: ${key}`);
  return v;
}

const WAD = 10n ** 18n;
const RAY = 10n ** 27n;
const STARK_PRIME = 2n ** 251n + 17n * 2n ** 192n + 1n;

const CFG = {
  RPC_URL: process.env.STARKNET_RPC_URL || "https://starknet-sepolia.public.blastapi.io",
  DEPLOYER_ADDRESS: req("DEPLOYER_ADDRESS"),
  DEPLOYER_PRIVATE_KEY: req("DEPLOYER_PRIVATE_KEY"),
  AGENT_ADDRESS: req("AGENT_ADDRESS"),
  AGENT_PRIVATE_KEY: req("AGENT_PRIVATE_KEY"),
  LLM_API_KEY: req("LLM_API_KEY"),
  LLM_BASE_URL: process.env.LLM_BASE_URL || "https://api.commonstack.ai/v1",
  LLM_MODEL: process.env.LLM_MODEL || "zai-org/glm-5.1",
  ORACLE_RELAYER: req("ORACLE_RELAYER_ADDRESS"),
  GRINTA_HOOK: req("GRINTA_HOOK_ADDRESS"),
  SAFE_ENGINE: req("SAFE_ENGINE_ADDRESS"),
  PID_CONTROLLER: req("PID_CONTROLLER_ADDRESS"),
  PARAMETER_GUARD: req("PARAMETER_GUARD_ADDRESS"),
  WBTC: req("WBTC_ADDRESS"),
  USDC: req("USDC_ADDRESS"),
  EKUBO_ROUTER: req("EKUBO_ROUTER_ADDRESS"),
  POOL_FEE: process.env.POOL_FEE || "0",
  POOL_TICK_SPACING: process.env.POOL_TICK_SPACING || "1000",
};

const provider = new RpcProvider({ nodeUrl: CFG.RPC_URL });
const deployer = new Account({ provider, address: CFG.DEPLOYER_ADDRESS, signer: CFG.DEPLOYER_PRIVATE_KEY });
const agent = new Account({ provider, address: CFG.AGENT_ADDRESS, signer: CFG.AGENT_PRIVATE_KEY });
const llm = new OpenAI({ apiKey: CFG.LLM_API_KEY, baseURL: CFG.LLM_BASE_URL });

// ---- SSE log broadcast ----
type SSEClient = { id: number; res: express.Response };
let sseClients: SSEClient[] = [];
let sseId = 0;

function broadcast(event: string, data: unknown) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  sseClients.forEach((c) => c.res.write(payload));
}

function log(msg: string, data?: Record<string, unknown>) {
  const entry = { ts: new Date().toISOString(), msg, ...data };
  console.log(`[server] ${msg}`);
  broadcast("log", entry);
}

// ---- Helpers ----

function encodeI128(value: bigint): string {
  if (value >= 0n) return "0x" + value.toString(16);
  return "0x" + (STARK_PRIME + value).toString(16);
}

function toBigInt(val: unknown): bigint {
  if (val == null) return 0n;
  if (typeof val === "bigint") return val;
  return BigInt(String(val));
}

function toSigned(val: unknown): bigint {
  const n = toBigInt(val);
  const I128_MAX = (1n << 127n) - 1n;
  if (n > I128_MAX) return n - (1n << 128n);
  return n;
}

function getVal(obj: unknown, key: string | number): unknown {
  if (obj == null || typeof obj !== "object") return undefined;
  const o = obj as Record<string, unknown>;
  return o[key] ?? o[String(key)];
}

// ---- Read protocol state ----

async function readState() {
  const [marketPrice, collateralPrice, redemptionPrice, redemptionRate, gains, deviation] =
    await Promise.all([
      provider.callContract({ contractAddress: CFG.GRINTA_HOOK, entrypoint: "get_market_price" }).catch(() => ["0"]),
      provider.callContract({ contractAddress: CFG.GRINTA_HOOK, entrypoint: "get_collateral_price" }).catch(() => ["0"]),
      provider.callContract({ contractAddress: CFG.SAFE_ENGINE, entrypoint: "get_redemption_price" }).catch(() => ["0"]),
      provider.callContract({ contractAddress: CFG.SAFE_ENGINE, entrypoint: "get_redemption_rate" }).catch(() => ["0"]),
      provider.callContract({ contractAddress: CFG.PID_CONTROLLER, entrypoint: "get_controller_gains" }).catch(() => undefined),
      provider.callContract({ contractAddress: CFG.PID_CONTROLLER, entrypoint: "get_deviation_observation" }).catch(() => undefined),
    ]);

  const mp = toBigInt(marketPrice[0]);
  const cp = toBigInt(collateralPrice[0]);
  const rp = toBigInt(redemptionPrice[0]);
  const rr = toBigInt(redemptionRate[0]);
  const kp = gains ? toSigned(gains[0]) : 0n;
  const ki = gains ? toSigned(gains[1]) : 0n;
  const lastProp = deviation ? toSigned(deviation[1]) : 0n;

  const mpUsd = Number(mp) / 1e18;
  const cpUsd = Number(cp) / 1e18;
  const rpRaw = Number(rp) / 1e27;
  const rpUsd = rpRaw > 0.5 && rpRaw < 2.0 ? rpRaw : 1.0;
  const deviationPct = rpUsd > 0 ? ((rpUsd - mpUsd) / rpUsd) * 100 : 0;
  const btcDropPct = cpUsd > 0 ? ((60000 - cpUsd) / 60000) * 100 : 0;

  return {
    marketPrice: mpUsd,
    collateralPrice: cpUsd,
    redemptionPrice: rpUsd,
    redemptionRate: Number(rr) / 1e27,
    kp: Number(kp) / 1e18,
    ki: Number(ki) / 1e18,
    kpRaw: kp.toString(),
    kiRaw: ki.toString(),
    deviationPct: Number(deviationPct.toFixed(4)),
    btcDropPct: Number(btcDropPct.toFixed(2)),
    lastProportional: Number(lastProp) / 1e18,
  };
}

// ---- LLM reasoning ----

const SYSTEM_PROMPT = `You are the Grinta PID Agent — an AI governor for a CDP stablecoin protocol.

Your role: monitor BTC collateral price AND the GRIT stablecoin peg, then adjust PID controller gains (KP, KI) to maintain the peg during market crashes.

## How the system works
- GRIT is a stablecoin backed by BTC (WBTC) collateral.
- When BTC crashes, GRIT tends to depeg. The PID controller computes a redemption rate to correct it.
- **KP** (proportional gain): Controls immediate response. Higher KP = stronger correction.
- **KI** (integral gain): Controls accumulated error. Higher KI = faster convergence but risk of oscillation.

## Your bounds (enforced on-chain by ParameterGuard)
- KP range: [0.1, 10.0] WAD
- KI range: [0.0, 0.1] WAD
- Max KP change per update: 1.0 WAD
- Max KI change per update: 0.1 WAD
- Normal cooldown: 30 seconds
- Emergency cooldown: 10 seconds

## Decision framework
1. **BTC stable, peg stable (drop < 3%, deviation < 1%)**: HOLD
2. **BTC dropping (3-10%), peg drifting**: ADJUST — increase KP proactively
3. **BTC crashing (>10%) OR peg deviation >= 5%**: ADJUST_EMERGENCY — aggressively boost KP
4. **Recovery phase**: ADJUST — start reducing KP back toward baseline (2.0 WAD)
5. KI adjustments should be conservative

## Response format
Respond ONLY with valid JSON.
Values for new_kp and new_ki are human-readable floats (e.g. 2.5, 0.003).

Example HOLD: {"action":"hold","reasoning":"BTC stable, no action needed."}
Example ADJUST: {"action":"adjust","new_kp":2.3,"new_ki":0.003,"reasoning":"BTC down 5%, raising KP proactively."}
Example EMERGENCY: {"action":"adjust_emergency","new_kp":2.8,"new_ki":0.004,"reasoning":"BTC crashed 15%, emergency KP boost."}`;

async function runAgentCycle() {
  log("Reading on-chain state...");
  const state = await readState();
  broadcast("state", state);

  log("State read complete", {
    btc: `$${state.collateralPrice.toFixed(0)}`,
    grit: `$${state.marketPrice.toFixed(4)}`,
    kp: state.kp.toFixed(3),
    deviation: `${state.deviationPct}%`,
  });

  log("Asking LLM for decision...");

  const userPrompt = `## Current Protocol State
- BTC Price (on-chain oracle): $${state.collateralPrice.toFixed(2)}
- BTC Drop from $60k baseline: ${state.btcDropPct}%
- GRIT Market Price: $${state.marketPrice.toFixed(6)}
- GRIT Redemption Price (target): $${state.redemptionPrice.toFixed(6)}
- Peg Deviation: ${state.deviationPct}%
- Current KP: ${state.kp.toFixed(6)} WAD
- Current KI: ${state.ki.toFixed(6)} WAD
- Last Proportional Term: ${state.lastProportional.toFixed(6)}

What is your decision?`;

  const response = await llm.chat.completions.create({
    model: CFG.LLM_MODEL,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: userPrompt },
    ],
    temperature: 0.1,
    max_tokens: 2000,
  });

  const content = response.choices[0]?.message?.content || "";
  const jsonMatch = content.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    log("LLM returned no valid JSON", { raw: content.slice(0, 300) });
    return { action: "hold", reasoning: "LLM parse failure" };
  }

  const decision = JSON.parse(jsonMatch[0]);
  log(`LLM decision: ${decision.action.toUpperCase()}`, { reasoning: decision.reasoning });
  broadcast("decision", decision);

  if (decision.action === "hold") return decision;

  const newKp = BigInt(Math.round((decision.new_kp ?? 2.0) * 1e18));
  const newKi = BigInt(Math.round((decision.new_ki ?? 0.002) * 1e18));
  const isEmergency = decision.action === "adjust_emergency";

  log(`Proposing KP=${decision.new_kp}, KI=${decision.new_ki}, emergency=${isEmergency}`);

  const calldata = [encodeI128(newKp), encodeI128(newKi), isEmergency ? "1" : "0"];

  const { transaction_hash } = await agent.execute(
    { contractAddress: CFG.PARAMETER_GUARD, entrypoint: "propose_parameters", calldata },
    { maxFee: 10n ** 16n },
  );

  log(`Tx submitted: ${transaction_hash}`);
  broadcast("tx", { hash: transaction_hash, type: "propose_parameters" });

  await provider.waitForTransaction(transaction_hash);
  log("Tx confirmed!");

  return { ...decision, txHash: transaction_hash };
}

// ---- Tiny swap to trigger rate recalculation ----

async function triggerSwap() {
  const amountIn = WAD; // 1 GRIT
  const gritAddress = CFG.SAFE_ENGINE;

  const calls: Call[] = [
    {
      contractAddress: gritAddress,
      entrypoint: "approve",
      calldata: CallData.compile({ spender: CFG.EKUBO_ROUTER, amount: cairo.uint256(amountIn) }),
    },
    {
      contractAddress: gritAddress,
      entrypoint: "transfer",
      calldata: CallData.compile({ recipient: CFG.EKUBO_ROUTER, amount: cairo.uint256(amountIn) }),
    },
    {
      contractAddress: CFG.EKUBO_ROUTER,
      entrypoint: "swap",
      calldata: CallData.compile({
        node: {
          pool_key: {
            token0: CFG.USDC,
            token1: gritAddress,
            fee: CFG.POOL_FEE,
            tick_spacing: CFG.POOL_TICK_SPACING,
            extension: CFG.GRINTA_HOOK,
          },
          sqrt_ratio_limit: cairo.uint256(0n),
          skip_ahead: 0n,
        },
        token_amount: {
          token: gritAddress,
          amount: { mag: amountIn, sign: 0 },
        },
      }),
    },
    {
      contractAddress: CFG.EKUBO_ROUTER,
      entrypoint: "clear",
      calldata: CallData.compile({ token: CFG.USDC }),
    },
    {
      contractAddress: CFG.EKUBO_ROUTER,
      entrypoint: "clear",
      calldata: CallData.compile({ token: gritAddress }),
    },
  ];

  log("Triggering tiny swap (1 GRIT) to recalculate rate...");
  const { transaction_hash } = await deployer.execute(calls, { maxFee: 10n ** 16n });
  log(`Swap tx: ${transaction_hash}`);
  broadcast("tx", { hash: transaction_hash, type: "swap" });
  await provider.waitForTransaction(transaction_hash);
  log("Swap confirmed — rate recalculated!");
  return transaction_hash;
}

// ---- Express server ----

const app = express();
app.use(cors());
app.use(express.json());

app.get("/api/state", async (_req, res) => {
  try {
    const state = await readState();
    res.json(state);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/cheat/crash", async (req, res) => {
  try {
    const pct = Number(req.body.percent || 20);
    const newPrice = BigInt(Math.round(60000 * (1 - pct / 100))) * WAD;
    log(`CHEAT: Crashing BTC by ${pct}% → $${Number(newPrice / WAD)}`);

    const { transaction_hash } = await deployer.execute(
      {
        contractAddress: CFG.ORACLE_RELAYER,
        entrypoint: "update_price",
        calldata: CallData.compile({
          base_token: CFG.WBTC,
          quote_token: CFG.USDC,
          price_usd_wad: cairo.uint256(newPrice),
        }),
      },
      { maxFee: 10n ** 16n },
    );

    log(`Oracle tx: ${transaction_hash}`);
    broadcast("tx", { hash: transaction_hash, type: "oracle_update" });
    await provider.waitForTransaction(transaction_hash);
    log("Oracle updated!");

    const state = await readState();
    broadcast("state", state);
    res.json({ txHash: transaction_hash, newPrice: Number(newPrice / WAD) });
  } catch (e: any) {
    log(`CHEAT ERROR: ${e.message}`);
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/cheat/pump", async (req, res) => {
  try {
    const pct = Number(req.body.percent || 20);
    const newPrice = BigInt(Math.round(60000 * (1 + pct / 100))) * WAD;
    log(`CHEAT: Pumping BTC by ${pct}% → $${Number(newPrice / WAD)}`);

    const { transaction_hash } = await deployer.execute(
      {
        contractAddress: CFG.ORACLE_RELAYER,
        entrypoint: "update_price",
        calldata: CallData.compile({
          base_token: CFG.WBTC,
          quote_token: CFG.USDC,
          price_usd_wad: cairo.uint256(newPrice),
        }),
      },
      { maxFee: 10n ** 16n },
    );

    log(`Oracle tx: ${transaction_hash}`);
    broadcast("tx", { hash: transaction_hash, type: "oracle_update" });
    await provider.waitForTransaction(transaction_hash);
    log("Oracle updated!");

    const state = await readState();
    broadcast("state", state);
    res.json({ txHash: transaction_hash, newPrice: Number(newPrice / WAD) });
  } catch (e: any) {
    log(`CHEAT ERROR: ${e.message}`);
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/cheat/reset", async (_req, res) => {
  try {
    const baselinePrice = 60_000n * WAD;
    log("CHEAT: Resetting BTC to $60,000");

    const { transaction_hash } = await deployer.execute(
      {
        contractAddress: CFG.ORACLE_RELAYER,
        entrypoint: "update_price",
        calldata: CallData.compile({
          base_token: CFG.WBTC,
          quote_token: CFG.USDC,
          price_usd_wad: cairo.uint256(baselinePrice),
        }),
      },
      { maxFee: 10n ** 16n },
    );

    broadcast("tx", { hash: transaction_hash, type: "oracle_reset" });
    await provider.waitForTransaction(transaction_hash);
    log("Oracle reset to $60k!");

    const state = await readState();
    broadcast("state", state);
    res.json({ txHash: transaction_hash });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/agent/trigger", async (_req, res) => {
  try {
    const result = await runAgentCycle();
    res.json(result);
  } catch (e: any) {
    log(`AGENT ERROR: ${e.message}`);
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/swap/trigger", async (_req, res) => {
  try {
    const txHash = await triggerSwap();
    const state = await readState();
    broadcast("state", state);
    res.json({ txHash });
  } catch (e: any) {
    log(`SWAP ERROR: ${e.message}`);
    res.status(500).json({ error: e.message });
  }
});

// Full demo sequence: cheat → agent → swap → read
app.post("/api/demo/crash", async (req, res) => {
  try {
    const pct = Number(req.body.percent || 20);

    // 1. Crash oracle
    const newPrice = BigInt(Math.round(60000 * (1 - pct / 100))) * WAD;
    log(`DEMO: Full crash sequence — BTC -${pct}%`);

    const { transaction_hash: oracleTx } = await deployer.execute(
      {
        contractAddress: CFG.ORACLE_RELAYER,
        entrypoint: "update_price",
        calldata: CallData.compile({
          base_token: CFG.WBTC,
          quote_token: CFG.USDC,
          price_usd_wad: cairo.uint256(newPrice),
        }),
      },
      { maxFee: 10n ** 16n },
    );
    await provider.waitForTransaction(oracleTx);
    broadcast("tx", { hash: oracleTx, type: "oracle_update" });
    log("Step 1/3: Oracle updated");

    // 2. Agent cycle
    const decision = await runAgentCycle();
    log("Step 2/3: Agent decision complete");

    // 3. Tiny swap to trigger rate recalc
    const swapTx = await triggerSwap();
    log("Step 3/3: Rate recalculated");

    const finalState = await readState();
    broadcast("state", finalState);

    res.json({
      oracleTx,
      decision,
      swapTx,
      finalState,
    });
  } catch (e: any) {
    log(`DEMO ERROR: ${e.message}`);
    res.status(500).json({ error: e.message });
  }
});

app.get("/api/stream", (req, res) => {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  res.write("event: connected\ndata: {}\n\n");

  const clientId = ++sseId;
  sseClients.push({ id: clientId, res });
  console.log(`[SSE] Client ${clientId} connected (total: ${sseClients.length})`);

  req.on("close", () => {
    sseClients = sseClients.filter((c) => c.id !== clientId);
    console.log(`[SSE] Client ${clientId} disconnected (total: ${sseClients.length})`);
  });
});

// Serve frontend build in production
const distPath = join(__dirname, "..", "dist");
if (existsSync(distPath)) {
  app.use(express.static(distPath));
  app.get("*", (_req, res) => {
    res.sendFile(join(distPath, "index.html"));
  });
  console.log(`  Serving frontend from ${distPath}`);
}

const PORT = Number(process.env.API_PORT || process.env.PORT || 3001);
app.listen(PORT, "0.0.0.0", () => {
  console.log(`\n  Grinta Governance API running on http://0.0.0.0:${PORT}`);
  console.log(`  Deployer: ${CFG.DEPLOYER_ADDRESS}`);
  console.log(`  Agent:    ${CFG.AGENT_ADDRESS}`);
  console.log(`  PID:      ${CFG.PID_CONTROLLER}`);
  console.log(`  Guard:    ${CFG.PARAMETER_GUARD}\n`);
});
