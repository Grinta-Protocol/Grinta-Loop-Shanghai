/**
 * LLM Reasoning Engine — CommonStack GLM-5.1
 *
 * Takes protocol state, analyzes it, and returns a structured decision:
 * - hold: do nothing
 * - adjust: propose new KP/KI (normal mode)
 * - adjust_emergency: propose new KP/KI (emergency mode, shorter cooldown)
 */

import OpenAI from "openai";
import { CONFIG, WAD } from "./config.js";
import type { ProtocolState } from "./monitor.js";
import type { AgentAction } from "./logger.js";

// ---- Types ----

export interface AgentDecision {
  action: AgentAction;
  new_kp?: bigint; // WAD — only if action != "hold"
  new_ki?: bigint; // WAD — only if action != "hold"
  is_emergency: boolean;
  reasoning: string;
}

// ---- System Prompt ----

const SYSTEM_PROMPT = `You are the Grinta PID Agent — an AI governor for a CDP stablecoin protocol.

Your role: monitor BTC collateral price AND the GRIT stablecoin peg, then adjust PID controller gains (KP, KI) to maintain the peg during market crashes.

## How the system works
- GRIT is a stablecoin backed by BTC (WBTC) collateral.
- When BTC crashes, GRIT tends to depeg (lose its $1 target). The BTC crash CAUSES the depeg.
- The PID controller computes a redemption rate based on GRIT's peg deviation to correct it.
- **KP** (proportional gain): Controls immediate response. Higher KP = stronger correction.
- **KI** (integral gain): Controls accumulated error. Higher KI = faster convergence but risk of oscillation.
- The PID rate recomputes every ~3600 seconds (1 hour). Your value is PRE-POSITIONING gains BEFORE the next rate computation.

## CRITICAL INSIGHT — your edge over the on-chain oracle
The BTC price is a LEADING indicator. The peg deviation is a LAGGING indicator.
You should react to BTC drops BEFORE the depeg fully materializes.

You receive TWO BTC readings:
- **On-chain BTC**: what the contract sees (slow — oracle pushes are throttled).
- **Off-chain BTC**: a high-frequency feed (Pyth/CEX-style). This is FRESHER.

If the off-chain BTC is significantly LOWER than the on-chain BTC, the on-chain
oracle is stale and the protocol is about to absorb a price drop it doesn't
know about yet. THAT is the moment to pre-position KP — before the depeg
materializes via swap pressure. Without this off-chain edge you would just be
reacting to the same data the contract already saw.

## Your bounds (enforced on-chain by ParameterGuard)
- KP range: [1.4, 2.6] WAD (1 WAD = 1e18)
- KI range: [0.001, 0.01] WAD
- Max KP change per update: 0.5 WAD
- Max KI change per update: 0.005 WAD
- Normal cooldown: 300 seconds between updates
- Emergency cooldown: 60 seconds (when you declare emergency)
- Budget: 20 total updates

## Decision framework
1. **BTC stable, peg stable (BTC drop < 3%, deviation < 1%)**: HOLD — no action needed.
2. **BTC dropping (3-10%), peg still OK**: ADJUST — proactively increase KP to prepare for incoming depeg. This is the PREVENTIVE action.
3. **BTC crashing (>10%) OR peg deviation >= 5%**: ADJUST_EMERGENCY — aggressively boost KP toward upper bound. Declare emergency for shorter cooldown.
4. **Recovery phase (BTC stabilizing, deviation decreasing)**: ADJUST — start reducing KP back toward baseline (2.0 WAD).
5. KI adjustments should be conservative — small increases during sustained deviations, never aggressive.

## Rules
- ALWAYS respect the bounds. Out-of-bounds values are rejected on-chain.
- Be CONSERVATIVE with KI — it accumulates and overshooting causes oscillation.
- React to BTC drops EARLY — don't wait for the depeg to show up.
- Consider the INTEGRAL term — if it's already large, be careful with KI increases.

## Response format — CRITICAL
Respond ONLY with valid JSON. No markdown, no explanation outside the JSON.

Values for new_kp and new_ki MUST be RAW INTEGER STRINGS — the on-chain representation.
Multiply your human value by 1e18 (1000000000000000000).

Conversion table:
  KP 1.4 = 1400000000000000000
  KP 1.8 = 1800000000000000000
  KP 2.0 = 2000000000000000000
  KP 2.3 = 2300000000000000000
  KP 2.5 = 2500000000000000000
  KP 2.6 = 2600000000000000000
  KI 0.001 = 1000000000000000
  KI 0.002 = 2000000000000000
  KI 0.005 = 5000000000000000
  KI 0.01  = 10000000000000000

WRONG: "new_kp": 2.5
CORRECT: "new_kp": 2500000000000000000

Example HOLD response:
{"action":"hold","is_emergency":false,"reasoning":"BTC stable at $59.8k, deviation 0.03% — no action needed."}

Example ADJUST response:
{"action":"adjust","new_kp":2300000000000000000,"new_ki":2000000000000000,"is_emergency":false,"reasoning":"BTC down 5%, pre-positioning KP from 2.0 to 2.3 before depeg materializes."}

Example EMERGENCY response:
{"action":"adjust_emergency","new_kp":2500000000000000000,"new_ki":3000000000000000,"is_emergency":true,"reasoning":"BTC crashed 15%, off-chain shows further decline. Boosting KP to 2.5 with emergency cooldown."}`;

// ---- Reasoning Engine ----

export class ReasoningEngine {
  private client: OpenAI;

  constructor() {
    this.client = new OpenAI({
      apiKey: CONFIG.COMMONSTACK_API_KEY,
      baseURL: CONFIG.COMMONSTACK_BASE_URL,
    });
  }

  /**
   * Analyze protocol state and return a decision
   */
  async analyze(state: ProtocolState): Promise<AgentDecision> {
    const userPrompt = this.buildPrompt(state);

    try {
      const response = await this.client.chat.completions.create({
        model: CONFIG.COMMONSTACK_MODEL,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: userPrompt },
        ],
        temperature: 0.1,
        max_tokens: 2000, // GLM-5.1 uses reasoning tokens internally — needs headroom
      });

      const content = response.choices[0]?.message?.content;
      if (!content) {
        return this.fallbackDecision("LLM returned empty response");
      }

      return this.parseResponse(content);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error("LLM error:", msg);
      return this.fallbackDecision(`LLM call failed: ${msg}`);
    }
  }

  private buildPrompt(state: ProtocolState): string {
    const kpHuman = Number(state.kp) / 1e18;
    const kiHuman = Number(state.ki) / 1e18;
    const proportionalHuman = Number(state.lastProportional) / 1e18;
    const integralHuman = Number(state.lastIntegral) / 1e18;

    let offchainBlock = "";
    if (state.offchain) {
      const lagUsd = state.offchain.btcUsd - state.collateralPriceUsd;
      const lagSign = lagUsd >= 0 ? "+" : "";
      offchainBlock = `
## Off-chain BTC feed (high frequency — your edge)
- **Off-chain BTC**: $${state.offchain.btcUsd.toFixed(2)} (drop ${state.offchain.dropPct.toFixed(2)}% from $60k)
- **Phase**: ${state.offchain.phase}
- **Demo elapsed**: ${state.offchain.elapsedSec.toFixed(0)}s
- **Lag vs on-chain**: ${lagSign}$${lagUsd.toFixed(2)} (off-chain minus on-chain — negative means off-chain is LOWER, oracle is stale)
`;
    }

    return `## Current Protocol State

- **On-chain BTC (oracle)**: $${state.collateralPriceUsd.toFixed(2)}
- **BTC Drop from Baseline ($60k)**: ${state.collateralDropPct.toFixed(2)}%
- **GRIT Market Price**: $${state.marketPriceUsd.toFixed(6)}
- **GRIT Redemption Price (target)**: $${state.redemptionPriceUsd.toFixed(6)}
- **Peg Deviation**: ${state.deviationPct.toFixed(4)}%
- **Current KP**: ${kpHuman.toFixed(6)} WAD (raw: ${state.kp})
- **Current KI**: ${kiHuman.toFixed(6)} WAD (raw: ${state.ki})
- **Last Proportional Term**: ${proportionalHuman.toFixed(6)}
- **Last Integral Term**: ${integralHuman.toFixed(6)}
- **Guard Update Count**: ${state.guardUpdateCount} / 20
- **Guard Stopped**: ${state.guardStopped}
${offchainBlock}
What is your decision?`;
  }

  private parseResponse(content: string): AgentDecision {
    // Extract JSON from response (LLM might wrap in markdown code blocks)
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return this.fallbackDecision(`Could not extract JSON from LLM response: ${content.slice(0, 200)}`);
    }

    try {
      const parsed = JSON.parse(jsonMatch[0]);

      const action: AgentAction = parsed.action || "hold";

      if (action === "hold") {
        return {
          action: "hold",
          is_emergency: false,
          reasoning: parsed.reasoning || "No action needed",
        };
      }

      // Parse KP/KI — accept raw WAD integers or float (with auto-conversion)
      const newKp = this.parseWadValue(parsed.new_kp);
      const newKi = this.parseWadValue(parsed.new_ki);

      return {
        action,
        new_kp: newKp,
        new_ki: newKi,
        is_emergency: action === "adjust_emergency",
        reasoning: parsed.reasoning || "Parameter adjustment",
      };
    } catch (error) {
      return this.fallbackDecision(`Failed to parse LLM JSON: ${content.slice(0, 200)}`);
    }
  }

  /**
   * If the LLM returns a float (e.g. 2.5) instead of a WAD integer,
   * detect it and multiply by 1e18. Otherwise parse as BigInt directly.
   */
  private parseWadValue(val: unknown): bigint {
    const num = Number(val);
    // If the value is small enough to be a human-readable float (< 1e15),
    // treat it as a float and convert to WAD. Otherwise it's already WAD.
    if (num < 1e15 && num > 0) {
      const cents = Math.round(num * 1e18);
      return BigInt(cents);
    }
    return BigInt(String(val));
  }

  private fallbackDecision(reason: string): AgentDecision {
    return {
      action: "hold",
      is_emergency: false,
      reasoning: `[FALLBACK] ${reason}`,
    };
  }
}
