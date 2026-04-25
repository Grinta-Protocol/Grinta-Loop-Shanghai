import express from "express";
import cors from "cors";
import { Account, RpcProvider, CallData, cairo, type Call } from "starknet";
import OpenAI from "openai";
import lighthouse from "@lighthouse-web3/sdk";
import dotenv from "dotenv";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { existsSync, readFileSync, writeFileSync } from "fs";

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
  RPC_URL: process.env.STARKNET_RPC_URL || "https://starknet-sepolia.g.alchemy.com/starknet/version/rpc/v0_10/w0WsoxSXn4Xq8DEGYETDW",
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
  LIGHTHOUSE_API_KEY: process.env.LIGHTHOUSE_API_KEY || "",
};

const provider = new RpcProvider({ nodeUrl: CFG.RPC_URL });
const deployer = new Account({ provider, address: CFG.DEPLOYER_ADDRESS, signer: CFG.DEPLOYER_PRIVATE_KEY });
const agent = new Account({ provider, address: CFG.AGENT_ADDRESS, signer: CFG.AGENT_PRIVATE_KEY });
const llm = new OpenAI({ apiKey: CFG.LLM_API_KEY, baseURL: CFG.LLM_BASE_URL });

// ---- Lighthouse Filecoin Archive ----
// Cache for IPNS name (reuse across sessions)
const IPNS_CACHE_FILE = join(__dirname, "..", "lighthouse-ipns.json");

function getIpnsName(): string | null {
  try {
    if (existsSync(IPNS_CACHE_FILE)) {
      return JSON.parse(readFileSync(IPNS_CACHE_FILE, "utf-8")).ipnsName;
    }
  } catch {}
  return null;
}

function saveIpnsName(ipnsName: string) {
  writeFileSync(IPNS_CACHE_FILE, JSON.stringify({ ipnsName, updated: new Date().toISOString() }));
}

async function archiveToFilecoin(): Promise<{ cid: string; ipns: string; url: string } | null> {
  if (!CFG.LIGHTHOUSE_API_KEY) {
    log("LIGHTHOUSE_API_KEY not set — skipping Filecoin archive");
    return null;
  }

  try {
    // Read decisions.jsonl
    const jsonlPath = join(__dirname, "..", "..", "agent", "decisions.jsonl");
    if (!existsSync(jsonlPath)) {
      log("No decisions.jsonl found — skipping archive");
      return null;
    }

    const content = readFileSync(jsonlPath, "utf-8");
    const lines = content.trim().split("\n").filter(Boolean);
    if (lines.length === 0) {
      log("No decisions to archive");
      return null;
    }

    // Parse to JSON array for cleaner IPFS storage
    const records = lines.map((line) => JSON.parse(line));

    // Upload to IPFS
    const blob = new Blob([JSON.stringify(records, null, 2)], { type: "application/json" });
    const cid = await lighthouse.uploadBuffer(
      Buffer.from(await blob.arrayBuffer()),
      CFG.LIGHTHOUSE_API_KEY
    ) as any;
    const cidStr = (cid as any).data?. cid || (cid as any).cid || String(cid);
    log(`Uploaded to IPFS: ${cidStr}`);

    // Get or create IPNS key
    let ipnsKey = getIpnsName() || "";
    if (!ipnsKey) {
      const keyResponse: any = await lighthouse.generateKey(CFG.LIGHTHOUSE_API_KEY);
      ipnsKey = keyResponse.data.ipnsName;
      saveIpnsName(ipnsKey);
      log(`Created new IPNS: ${ipnsKey}`);
    }

    // Publish record
    await lighthouse.publishRecord(cidStr, ipnsKey, CFG.LIGHTHOUSE_API_KEY) as any;
    const ipnsUrl = `https://ipfs.io/ipns/${ipnsKey}`;
    log(`Archived to Filecoin: ${ipnsUrl}`);

    return { cid: cidStr, ipns: ipnsKey, url: ipnsUrl };
  } catch (e: any) {
    log(`Filecoin archive error: ${e.message}`);
    return null;
  }
}

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

// Alchemy Starknet RPC intermittently fails `starknet_call` with -32001
// when "latest" points at a block the node is still finalizing. Retry with
// backoff, then fall back to the last successful response for this label
// so the dashboard never flickers to zero mid-demo.
const RETRY_DELAYS_MS = [150, 300, 500, 800, 1200];
const lastGood = new Map<string, string[]>();

async function callWithRetry(
  label: string,
  call: { contractAddress: string; entrypoint: string; calldata?: string[] },
  fallback: string[] | undefined,
): Promise<string[] | undefined> {
  let lastErr: unknown;
  for (let i = 0; i <= RETRY_DELAYS_MS.length; i++) {
    try {
      const res = (await provider.callContract(call)) as unknown as string[];
      lastGood.set(label, res);
      return res;
    } catch (e) {
      lastErr = e;
      if (i < RETRY_DELAYS_MS.length) await new Promise((r) => setTimeout(r, RETRY_DELAYS_MS[i]));
    }
  }
  const msg = lastErr instanceof Error ? lastErr.message.split("\n")[0] : String(lastErr);
  const cached = lastGood.get(label);
  log(`RPC call failed: ${label}${cached ? " — using cached value" : ""} — ${msg.slice(0, 140)}`);
  return cached ?? fallback;
}

async function readState() {
  const [marketPrice, collateralPrice, redemptionPrice, redemptionRate, gains, deviation] =
    await Promise.all([
      callWithRetry("get_market_price", { contractAddress: CFG.GRINTA_HOOK, entrypoint: "get_market_price" }, ["0"]),
      callWithRetry("oracle.get_price_wad", { contractAddress: CFG.ORACLE_RELAYER, entrypoint: "get_price_wad", calldata: [CFG.WBTC, CFG.USDC] }, ["0"]),
      callWithRetry("get_redemption_price", { contractAddress: CFG.SAFE_ENGINE, entrypoint: "get_redemption_price" }, ["0"]),
      callWithRetry("get_redemption_rate", { contractAddress: CFG.SAFE_ENGINE, entrypoint: "get_redemption_rate" }, ["0"]),
      callWithRetry("get_controller_gains", { contractAddress: CFG.PID_CONTROLLER, entrypoint: "get_controller_gains" }, undefined),
      callWithRetry("get_deviation_observation", { contractAddress: CFG.PID_CONTROLLER, entrypoint: "get_deviation_observation" }, undefined),
    ]);

  const mp = toBigInt(marketPrice?.[0]);
  const cp = toBigInt(collateralPrice?.[0]);
  const rp = toBigInt(redemptionPrice?.[0]);
  const rr = toBigInt(redemptionRate?.[0]);
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

Your role: monitor BTC collateral price AND the GRIT stablecoin peg, then adjust PID controller gains (KP, KI) to maintain the peg during market crashes AND pumps.

## How the system works
- GRIT is a stablecoin backed by BTC (WBTC) collateral.
- When BTC crashes, GRIT tends to depeg DOWN. When BTC pumps, GRIT tends to depeg UP. The PID controller computes a redemption rate to correct either direction.
- **KP** (proportional gain): Controls immediate response to current deviation.
- **KI** (integral gain): Controls accumulated error. Conservative — overshooting causes oscillation.
- Gains are tiny on purpose (HAI-style): internal RAY scaling means KP ~6.67e-7 already gives ~20% annualized rate for 1% deviation. The per-call delta cap is 10% of baseline — meaningful adjustments are built across MULTIPLE cycles, not in one shot.

## Your bounds (enforced on-chain by ParameterGuard — conservative policy)
- KP range: [3.33e-7, 1e-6] WAD (baseline 6.67e-7, ±50% headroom)
- KI range: [3.33e-13, 1e-12] WAD (baseline 6.67e-13)
- Max KP delta per update: 6.67e-8 WAD (10% of baseline — needs ~5 cycles to reach either bound)
- Max KI delta per update: 6.67e-14 WAD (10% of baseline)
- Normal cooldown: 5s. Emergency cooldown: 3s.

## Decision framework — SYMMETRIC, scaled by severity
BTC direction and peg deviation are SEPARATE signals. The MAGNITUDE of your adjustment scales with severity; the SIGN follows the move. Each call moves at most ±10% of baseline, so multi-step positions take multiple cycles.

Tier 1 — HOLD:
- |BTC change| < 3% AND |peg deviation| < 1%

Tier 2 — PROACTIVE (small move, peg still OK):
- 3% ≤ |BTC change| < 5% → step KP one delta (~10% of baseline)
- Example: current KP 6.67e-7, BTC −4% → new KP ~7.33e-7
- KI: scale proportionally, or leave unchanged

Tier 3 — ACTIVE (medium move OR peg slipping):
- 5% ≤ |BTC change| < 10%, OR 1% ≤ |deviation| < 3% → walk KP toward ~8-9e-7 across multiple cycles
- Example: current KP 7.33e-7, BTC −7% → new KP ~8e-7 (one more delta step)

Tier 4 — EMERGENCY (severe crash/pump OR serious depeg):
- |BTC change| ≥ 10% OR |deviation| ≥ 3% → "adjust_emergency", bigger urgency but same delta cap
- Example: current KP 8e-7, BTC −15% → emergency KP ~8.67e-7 (still delta-capped at 6.67e-8 per call, ceiling is 1e-6)

Rules:
- BTC DROPPING ⇒ INCREASE KP magnitude. BTC PUMPING ⇒ DECREASE KP magnitude. Behavior is SYMMETRIC for crashes and pumps.
- **NEGATIVE DEVIATION means GRIT is ABOVE peg and the rate is already pushing DOWN** — if KP is already elevated (> 8.33e-7) when deviation is negative, the system is OVER-CORRECTING. REDUCE KP regardless of BTC direction. This rule OVERRIDES the BTC-based tier.
- **NEVER call the CURRENT value "at max"**. The user prompt shows explicit headroom (how much you can raise/lower). Read those fields — if headroom-up > 0, you are NOT at max.
- ALWAYS propose values relative to the CURRENT KP/KI shown in the user prompt. Do NOT jump to round hardcoded values.
- Keep |new − current| ≤ 6.67e-8 for KP and ≤ 6.67e-14 for KI, or the guard rejects the tx.
- KI changes are especially conservative — the integrator accumulates, overshoot causes oscillation.
- During RECOVERY (BTC stabilizing, deviation shrinking) step KP back DOWN toward the 6.67e-7 baseline.

## Response format
Respond ONLY with valid JSON.
Values for new_kp and new_ki are human-readable floats in scientific notation (e.g. 1.2e-6, 1.3e-12).

Example HOLD: {"action":"hold","reasoning":"BTC −1.8%, deviation 0.04% — within tolerance."}
Example PROACTIVE drop (KP 6.67e-7 → 7.33e-7): {"action":"adjust","new_kp":7.33e-7,"new_ki":7.33e-13,"reasoning":"BTC −4%, pre-positioning KP +10% before depeg materializes."}
Example PROACTIVE pump (KP 7.33e-7 → 6.67e-7): {"action":"adjust","new_kp":6.67e-7,"new_ki":6.67e-13,"reasoning":"BTC +4%, stepping KP back to baseline to avoid over-correction on upside."}
Example EMERGENCY (KP 8e-7 → 8.67e-7): {"action":"adjust_emergency","new_kp":8.67e-7,"new_ki":8.67e-13,"reasoning":"BTC −12%, emergency step toward ceiling."}`;

// ---- LLM Wrapper with Rate Limiting & Retry ----

interface LLMResponse {
  choices: Array<{
    message: {
      content: string;
    };
  }>;
}

// Token bucket for rate limiting
const rateLimit = {
  tokens: 5,        // max concurrent requests
  refillRate: 2000,  // ms between refills
  lastRefill: Date.now(),
};

function waitForToken(): Promise<void> {
  return new Promise((resolve) => {
    if (rateLimit.tokens > 0) {
      rateLimit.tokens--;
      resolve();
    } else {
      setTimeout(() => resolve(), rateLimit.refillRate);
    }
  });
}

function refillTokens() {
  const now = Date.now();
  const elapsed = now - rateLimit.lastRefill;
  if (elapsed >= rateLimit.refillRate) {
    rateLimit.tokens = Math.min(5, rateLimit.tokens + 1);
    rateLimit.lastRefill = now;
  }
}

// Retry with exponential backoff
async function callLLMWithRetry(
  prompt: { role: "system" | "user"; content: string }[]
): Promise<LLMResponse> {
  const maxRetries = 4;
  const baseDelay = 1000; // 1s base
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      // Rate limiting
      await waitForToken();
      refillTokens();

      const response = await llm.chat.completions.create({
        model: CFG.LLM_MODEL,
        messages: prompt,
        temperature: 0.1,
        max_tokens: 4000,
      });

      return response as unknown as LLMResponse;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      // Check for 429
      if (lastError.message.includes("429") || lastError.message.includes("rate")) {
        const delay = baseDelay * Math.pow(2, attempt);
        log(`LLM rate limited, retrying in ${delay}ms...`, { attempt: attempt + 1 });
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }

      // Other error - maybe retry once
      if (attempt < maxRetries - 1) {
        log(`LLM error: ${lastError.message}, retrying...`, { attempt: attempt + 1 });
        await new Promise((r) => setTimeout(r, baseDelay));
        continue;
      }

      throw lastError;
    }
  }

  throw lastError || new Error("LLM call failed after retries");
}

async function runAgentCycle() {
  log("Reading on-chain state...");
  const state = await readState();
  broadcast("state", state);

  log("State read complete", {
    btc: `$${state.collateralPrice.toFixed(0)}`,
    grit: `$${state.marketPrice.toFixed(4)}`,
    kp: state.kp.toExponential(2),
    deviation: `${state.deviationPct}%`,
  });

  log("Asking LLM for decision...");

  const btcDirection = state.btcDropPct > 0 ? 'DROPPING' : state.btcDropPct < -1 ? 'PUMPING' : 'STABLE';

  // Compute explicit headroom so the LLM cannot hallucinate "at max" when the
  // current value sits mid-range. Ceiling / floor are the policy bounds.
  const KP_CEIL = 1e-6, KP_FLOOR = 3.333e-7;
  const KI_CEIL = 1e-12, KI_FLOOR = 3.333e-13;
  const kpHeadroomUp = Math.max(0, KP_CEIL - state.kp);
  const kpHeadroomDown = Math.max(0, state.kp - KP_FLOOR);
  const kiHeadroomUp = Math.max(0, KI_CEIL - state.ki);
  const kiHeadroomDown = Math.max(0, state.ki - KI_FLOOR);

  // Over-correction signal: negative deviation means GRIT is trading ABOVE
  // redemption, so the rate is already pushing it back down. If gains are
  // elevated and deviation is negative, the system is overshooting.
  const overCorrecting = state.deviationPct < 0 && state.kp > 8.33e-7;

  const userPrompt = `## Current Protocol State
- BTC Price (on-chain oracle): $${state.collateralPrice.toFixed(2)}
- BTC Change from $60k baseline: ${state.btcDropPct > 0 ? 'DOWN' : 'UP'} ${Math.abs(state.btcDropPct).toFixed(2)}%
- BTC Direction: **${btcDirection}**
- GRIT Market Price: $${state.marketPrice.toFixed(6)}
- GRIT Redemption Price (target): $${state.redemptionPrice.toFixed(6)}
- Peg Deviation: ${state.deviationPct}% ${state.deviationPct < 0 ? '(GRIT ABOVE peg — rate pushing DOWN — system may be OVER-CORRECTING)' : state.deviationPct > 0 ? '(GRIT BELOW peg — rate pushing UP)' : '(on peg)'}
- Current KP: ${state.kp.toExponential(3)} WAD
- Current KI: ${state.ki.toExponential(3)} WAD
- KP headroom: can raise by up to ${kpHeadroomUp.toExponential(2)}, can lower by up to ${kpHeadroomDown.toExponential(2)} (ceiling 1e-6, floor 3.33e-7)
- KI headroom: can raise by up to ${kiHeadroomUp.toExponential(2)}, can lower by up to ${kiHeadroomDown.toExponential(2)} (ceiling 1e-12, floor 3.33e-13)
- Last Proportional Term: ${state.lastProportional.toExponential(3)}
${overCorrecting ? '\n## ALERT: OVER-CORRECTION DETECTED\nDeviation is NEGATIVE and KP is elevated. Rate is over-pushing GRIT DOWN. YOU MUST REDUCE KP (and KI if also elevated), regardless of BTC direction. Pull gains back toward baseline 6.67e-7 / 6.67e-13.\n' : ''}
## DECISION RULE
- If deviation is NEGATIVE (GRIT above peg) AND current KP > 8.33e-7 → REDUCE KP. This overrides BTC direction. The rate is already over-correcting.
- Otherwise apply the tiered framework from the system prompt:
  - DROPPING (BTC going down) AND peg slipping DOWN → raise KP magnitude
  - PUMPING (BTC going up) → lower KP magnitude
  - STABLE and deviation small → hold
- NEVER propose a value at the absolute ceiling / floor unless you ARE already one delta step away. Consult KP/KI headroom above — they show how much room is left in each direction.
- Propose values RELATIVE to current (current ± small step) and within the per-update cap (6.67e-8 for KP, 6.67e-14 for KI).

What is your decision? (Respond ONLY with valid JSON)`;

  const response = await callLLMWithRetry([
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: userPrompt },
  ]);

  const content = response.choices[0]?.message?.content || "";
  const finishReason = (response as any).choices?.[0]?.finish_reason;
  const jsonMatch = content.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    console.log("[server] LLM raw response (no JSON found):", content);
    log("LLM returned no valid JSON", {
      finishReason,
      contentLength: content.length,
      rawTail: content.slice(-300),
    });
    return { action: "hold", reasoning: "LLM parse failure" };
  }

  const decision = JSON.parse(jsonMatch[0]);
  log(`LLM decision: ${decision.action.toUpperCase()}`, { reasoning: decision.reasoning });
  broadcast("decision", decision);

  if (decision.action === "hold") return decision;

  let newKp = BigInt(Math.round((decision.new_kp ?? 6.667e-7) * 1e18));
  let newKi = BigInt(Math.round((decision.new_ki ?? 6.667e-13) * 1e18));
  const isEmergency = decision.action === "adjust_emergency";

  // Clamp against on-chain policy. LLM can round float→int slightly past the
  // delta cap (e.g. 7.334e-13 vs 7.33e-13), busting the guard's _abs_diff check.
  // Mirror the deployed policy here.
  const POLICY = {
    KP_MIN: 333_333_333_333n,        // 3.333e-7 WAD
    KP_MAX: 1_000_000_000_000n,      // 1e-6 WAD
    KI_MIN: 333_333n,                // 3.333e-13 WAD
    KI_MAX: 1_000_000n,              // 1e-12 WAD
    MAX_KP_DELTA: 66_666_666_667n,   // 6.667e-8 WAD
    MAX_KI_DELTA: 66_667n,           // 6.667e-14 WAD
  };
  const currentKp = BigInt(state.kpRaw);
  const currentKi = BigInt(state.kiRaw);

  function clampDelta(proposed: bigint, current: bigint, maxDelta: bigint): bigint {
    const delta = proposed > current ? proposed - current : current - proposed;
    if (delta <= maxDelta) return proposed;
    return proposed > current ? current + maxDelta : current - maxDelta;
  }
  function clampBounds(v: bigint, lo: bigint, hi: bigint): bigint {
    if (v < lo) return lo;
    if (v > hi) return hi;
    return v;
  }
  const kpClamped = clampBounds(clampDelta(newKp, currentKp, POLICY.MAX_KP_DELTA), POLICY.KP_MIN, POLICY.KP_MAX);
  const kiClamped = clampBounds(clampDelta(newKi, currentKi, POLICY.MAX_KI_DELTA), POLICY.KI_MIN, POLICY.KI_MAX);
  if (kpClamped !== newKp) {
    log(`Clamped new_kp: ${newKp} → ${kpClamped} (LLM proposed ${decision.new_kp}, exceeded delta or bounds)`);
    newKp = kpClamped;
  }
  if (kiClamped !== newKi) {
    log(`Clamped new_ki: ${newKi} → ${kiClamped} (LLM proposed ${decision.new_ki}, exceeded delta or bounds)`);
    newKi = kiClamped;
  }

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

// Incremental oracle nudge: reads the CURRENT on-chain BTC price and applies
// a ±pct delta. Previous version always nudged off the $60k baseline, so
// repeated clicks clamped to the same target (e.g. +10% always = $66k).
async function nudgeOracle(pctSigned: number): Promise<{ txHash: string; newPrice: number; oldPrice: number }> {
  const priceCall = await callWithRetry(
    "oracle.get_price_wad",
    { contractAddress: CFG.ORACLE_RELAYER, entrypoint: "get_price_wad", calldata: [CFG.WBTC, CFG.USDC] },
    ["0"],
  );
  const currentWad = toBigInt(priceCall?.[0]);
  if (currentWad === 0n) throw new Error("oracle returned 0 price — cannot nudge");

  // BigInt basis-points math to preserve precision at $60k+ * 1e18 scale
  const bp = BigInt(Math.round(pctSigned * 100));
  const newWad = (currentWad * (10000n + bp)) / 10000n;

  const oldUsd = Number(currentWad / WAD);
  const newUsd = Number(newWad / WAD);
  log(`CHEAT: BTC ${pctSigned >= 0 ? "+" : ""}${pctSigned}% → $${oldUsd} → $${newUsd}`);

  const { transaction_hash } = await deployer.execute(
    {
      contractAddress: CFG.ORACLE_RELAYER,
      entrypoint: "update_price",
      calldata: CallData.compile({
        base_token: CFG.WBTC,
        quote_token: CFG.USDC,
        price_usd_wad: cairo.uint256(newWad),
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
  return { txHash: transaction_hash, newPrice: newUsd, oldPrice: oldUsd };
}

app.post("/api/cheat/crash", async (req, res) => {
  try {
    const pct = Number(req.body.percent || 10);
    const result = await nudgeOracle(-pct);
    res.json(result);
  } catch (e: any) {
    log(`CHEAT ERROR: ${e.message}`);
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/cheat/pump", async (req, res) => {
  try {
    const pct = Number(req.body.percent || 10);
    const result = await nudgeOracle(pct);
    res.json(result);
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

// Full demo sequence: cheat → agent → swap → read → archive
app.post("/api/demo/crash", async (req, res) => {
  try {
    const pct = Number(req.body.percent || 10);
    log(`DEMO: Full crash sequence — BTC -${pct}% (incremental)`);

    // 1. Crash oracle (incremental from current on-chain price)
    const { txHash: oracleTx } = await nudgeOracle(-pct);
    log("Step 1/3: Oracle updated");

    // 2. Agent cycle
    const decision = await runAgentCycle();
    log("Step 2/3: Agent decision complete");

    // 3. Tiny swap to trigger rate recalc
    const swapTx = await triggerSwap();
    log("Step 3/3: Rate recalculated");

    // 4. Auto-archive to Filecoin (Lighthouse)
    const archiveResult = await archiveToFilecoin();
    if (archiveResult) {
      log(`Archived: ${archiveResult.url}`);
      broadcast("archive", archiveResult);
    }

    const finalState = await readState();
    broadcast("state", finalState);

    res.json({
      oracleTx,
      decision,
      swapTx,
      finalState,
      archive: archiveResult,
    });
  } catch (e: any) {
    log(`DEMO ERROR: ${e.message}`);
    res.status(500).json({ error: e.message });
  }
});

// GET /api/history — load persisted decisions from JSONL
app.get("/api/history", async (_req, res) => {
  try {
    const jsonlPath = join(__dirname, "..", "..", "agent", "decisions.jsonl");
    if (!existsSync(jsonlPath)) {
      res.json({ rows: [], archiveUrl: null });
      return;
    }

    const content = readFileSync(jsonlPath, "utf-8");
    const lines = content.trim().split("\n").filter(Boolean);
    const decisions = lines.map((line) => JSON.parse(line)).reverse(); // newest first

    // Get stored archive URL
    let archiveUrl = null;
    try {
      if (existsSync(IPNS_CACHE_FILE)) {
        const cache = JSON.parse(readFileSync(IPNS_CACHE_FILE, "utf-8"));
        archiveUrl = `https://ipfs.io/ipns/${cache.ipnsName}`;
      }
    } catch {}

    res.json({ rows: decisions, archiveUrl });
  } catch (e: any) {
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
