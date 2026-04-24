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
- The PID rate recomputes periodically. Your value is PRE-POSITIONING gains BEFORE the next rate computation.

## CRITICAL INSIGHT
The BTC price is a LEADING indicator. The peg deviation is a LAGGING indicator.
You should react to BTC drops BEFORE the depeg fully materializes.

## Your bounds (enforced on-chain by ParameterGuard — V11 demo policy)
- KP range: [1e-7, 1e-5] WAD (about 0.0000001 to 0.00001)
- KI range: [1e-13, 1e-10] WAD
- Max KP change per update: 5e-6 WAD
- Max KI change per update: 5e-11 WAD
- Normal cooldown: 5 seconds between updates
- Emergency cooldown: 3 seconds (when you declare emergency)
- Budget: 1000 total updates

KP is intentionally small — the proportional term is RAY-scaled internally (HAI-style), so KP ~1e-6 already produces ~30% annualized rate for 1% deviation.

## Decision framework
1. **BTC stable, peg stable (BTC drop < 3%, deviation < 1%)**: HOLD — no action needed.
2. **BTC dropping (3-10%), peg still OK**: ADJUST — proactively increase KP to prepare for incoming depeg. This is the PREVENTIVE action.
3. **BTC crashing (>10%) OR peg deviation >= 5%**: ADJUST_EMERGENCY — aggressively boost KP toward upper bound. Declare emergency for shorter cooldown.
4. **Recovery phase (BTC stabilizing, deviation decreasing)**: ADJUST — start reducing KP back toward baseline (~1e-6 WAD).
5. KI adjustments should be conservative — small increases during sustained deviations, never aggressive.

## Rules
- ALWAYS respect the bounds. Out-of-bounds values are rejected on-chain.
- Be CONSERVATIVE with KI — it accumulates and overshooting causes oscillation.
- React to BTC drops EARLY — don't wait for the depeg to show up.
- Consider the INTEGRAL term — if it's already large, be careful with KI increases.

## Response format — CRITICAL
Respond ONLY with valid JSON. No markdown, no explanation outside the JSON.

Values for new_kp and new_ki MUST be human-readable FLOATS in scientific notation (e.g. 1.5e-6, 3e-12).
Do NOT multiply by 1e18 — the server converts for you.

Typical values:
  KP baseline:   1e-6
  KP aggressive: 5e-6  (upper end)
  KP minimum:    1e-7  (lower end)
  KI baseline:   1e-12
  KI aggressive: 5e-11 (upper end)
  KI minimum:    1e-13 (lower end)

Example HOLD response:
{"action":"hold","is_emergency":false,"reasoning":"BTC stable at $59.8k, deviation 0.03% — no action needed."}

Example ADJUST response:
{"action":"adjust","new_kp":3e-6,"new_ki":2e-12,"is_emergency":false,"reasoning":"BTC down 5%, pre-positioning KP from 1e-6 to 3e-6 before depeg materializes."}

Example EMERGENCY response:
{"action":"adjust_emergency","new_kp":5e-6,"new_ki":3e-11,"is_emergency":true,"reasoning":"BTC crashed 15%, off-chain shows further decline. Boosting KP to 5e-6 with emergency cooldown."}`;

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

    return `## Current Protocol State

- **On-chain BTC (oracle)**: $${state.collateralPriceUsd.toFixed(2)}
- **BTC Drop from Baseline ($60k)**: ${state.collateralDropPct.toFixed(2)}%
- **GRIT Market Price**: $${state.marketPriceUsd.toFixed(6)}
- **GRIT Redemption Price (target)**: $${state.redemptionPriceUsd.toFixed(6)}
- **Peg Deviation**: ${state.deviationPct.toFixed(4)}%
- **Current KP**: ${kpHuman.toExponential(3)} WAD (raw: ${state.kp})
- **Current KI**: ${kiHuman.toExponential(3)} WAD (raw: ${state.ki})
- **Last Proportional Term**: ${proportionalHuman.toExponential(3)}
- **Last Integral Term**: ${integralHuman.toExponential(3)}
- **Guard Update Count**: ${state.guardUpdateCount} / 1000
- **Guard Stopped**: ${state.guardStopped}

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
   * V11: LLM is instructed to return human-readable floats (e.g. 1e-6 for KP).
   * Multiply by 1e18 to get WAD integer. If the value is already huge (legacy
   * raw WAD), pass through.
   *
   * Heuristic change vs V10: V11 floats are tiny (1e-13..1e-5), so "< 1e15"
   * no longer separates floats from raw WAD. Use "< 1" instead — floats are
   * always sub-unit, raw WAD integers are always >= 1e11 (min KP=1e-7 WAD).
   */
  private parseWadValue(val: unknown): bigint {
    const num = Number(val);
    if (num <= 0) return 0n;
    if (num < 1) {
      return BigInt(Math.round(num * 1e18));
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
