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

Your role: monitor BTC collateral price AND the GRIT stablecoin peg, then adjust PID controller gains (KP, KI) to maintain the peg during BOTH crashes AND pumps.

## How the system works
- GRIT is a stablecoin backed by BTC (WBTC) collateral.
- When BTC crashes, GRIT tends to depeg DOWN. When BTC pumps, GRIT tends to depeg UP. The PID controller's redemption rate corrects either direction.
- **KP** (proportional gain): immediate response to current deviation.
- **KI** (integral gain): accumulated error — conservative, overshoot causes oscillation.
- The PID rate recomputes on each swap. Your role is PRE-POSITIONING gains BEFORE the next computation.

## CRITICAL INSIGHT
BTC price is a LEADING indicator. Peg deviation is LAGGING.
React to BTC moves BEFORE the depeg fully materializes — but scale your reaction to severity. Gains are NOT linear knobs: KP ~1e-6 already produces ~30% annualized rate for 1% deviation, so DOUBLING KP doubles that rate. Small moves deserve small bumps.

## Your bounds (enforced on-chain by ParameterGuard — V11 tight policy)
- KP range: [1e-7, 1e-5] WAD
- KI range: [1e-13, 1e-10] WAD
- Max KP delta per update: 5e-7 WAD (tight — caps one-step jumps to ~±50% of baseline)
- Max KI delta per update: 5e-12 WAD
- Normal cooldown: 5s. Emergency cooldown: 3s.
- Budget: 1000 total updates

## Decision framework — SYMMETRIC, scaled by severity
BTC direction and peg deviation are SEPARATE signals. The MAGNITUDE of your adjustment scales with severity; the SIGN follows the move.

Tier 1 — HOLD:
- |BTC change| < 3% AND |deviation| < 1%

Tier 2 — PROACTIVE (small move, peg OK):
- 3% ≤ |BTC change| < 5% → adjust KP by ±10-20% of CURRENT KP
- Example: current KP 1e-6, BTC −4% → new KP ~1.2e-6 (NOT 2e-6)

Tier 3 — ACTIVE (medium move OR peg slipping):
- 5% ≤ |BTC change| < 10%, OR 1% ≤ |deviation| < 3% → adjust KP by ±30-50%
- Example: current KP 1e-6, BTC −7% → new KP ~1.4e-6

Tier 4 — EMERGENCY:
- |BTC change| ≥ 10% OR |deviation| ≥ 3% → ADJUST_EMERGENCY, shorter cooldown
- Still delta-capped at 5e-7 KP per call — step aggressively but in RANGE
- Example: current KP 1.4e-6, BTC −15% → emergency KP ~1.9e-6

## Rules
- SYMMETRIC behavior: BTC DROP ⇒ raise KP magnitude; BTC PUMP ⇒ lower KP magnitude. Both sides must react.
- **NEGATIVE DEVIATION means GRIT is ABOVE peg — the rate is already pushing DOWN. If KP > 1.5e-6 while deviation is negative, the system is OVER-CORRECTING — REDUCE KP regardless of BTC direction. This OVERRIDES the BTC-based tier.**
- **NEVER describe the CURRENT value as "at maximum bound"**. The user prompt shows explicit headroom. If headroom-up > 0, you are NOT at max.
- ALWAYS base new_kp / new_ki on the CURRENT values shown in the user prompt. Never jump to round hardcoded values like 2e-6 or 5e-6.
- Respect delta cap: |new_kp − current_kp| ≤ 5e-7, |new_ki − current_ki| ≤ 5e-12 — larger proposals are REJECTED on-chain.
- KI is especially conservative — integrator accumulates, overshoot oscillates.
- RECOVERY (BTC stabilizing, deviation shrinking) → step KP back DOWN toward 1e-6 baseline.

## Response format — CRITICAL
Respond ONLY with valid JSON. No markdown, no extra prose.

Values for new_kp and new_ki MUST be human-readable FLOATS in scientific notation (e.g. 1.2e-6, 1.3e-12).
Do NOT multiply by 1e18 — the server converts for you.

Example HOLD:
{"action":"hold","is_emergency":false,"reasoning":"BTC stable at $59.8k, deviation 0.03% — within tolerance."}

Example PROACTIVE drop (KP 1e-6 → 1.2e-6):
{"action":"adjust","new_kp":1.2e-6,"new_ki":1.1e-12,"is_emergency":false,"reasoning":"BTC −4%, pre-positioning KP +20% before depeg materializes."}

Example PROACTIVE pump (KP 1.5e-6 → 1.2e-6):
{"action":"adjust","new_kp":1.2e-6,"new_ki":1e-12,"is_emergency":false,"reasoning":"BTC +4%, reducing KP −20% to avoid over-correction on upside."}

Example EMERGENCY (KP 1.4e-6 → 1.9e-6):
{"action":"adjust_emergency","new_kp":1.9e-6,"new_ki":1.5e-12,"is_emergency":true,"reasoning":"BTC −12%, emergency step toward aggressive range."}`;

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
    const maxRetries = 4;
    const baseDelay = 1000;
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
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
        lastError = error instanceof Error ? error : new Error(String(error));
        const msg = lastError.message;

        // Check for 429 rate limit
        if (msg.includes("429") || msg.toLowerCase().includes("rate")) {
          const delay = baseDelay * Math.pow(2, attempt);
          console.warn(`[Reasoning] Rate limited, retry ${attempt + 1}/${maxRetries} in ${delay}ms...`);
          await new Promise(r => setTimeout(r, delay));
          continue;
        }

        // Other error - only retry once
        if (attempt < maxRetries - 1) {
          console.error(`[Reasoning] LLM error: ${msg}, retrying...`);
          await new Promise(r => setTimeout(r, baseDelay));
          continue;
        }

        console.error("[Reasoning] LLM call failed after retries:", msg);
        return this.fallbackDecision(`LLM call failed: ${msg}`);
      }
    }

    return this.fallbackDecision(`LLM call failed after ${maxRetries} attempts: ${lastError?.message}`);
  }

  private buildPrompt(state: ProtocolState): string {
    const kpHuman = Number(state.kp) / 1e18;
    const kiHuman = Number(state.ki) / 1e18;
    const proportionalHuman = Number(state.lastProportional) / 1e18;
    const integralHuman = Number(state.lastIntegral) / 1e18;

    // Explicit headroom — the LLM cannot hallucinate "at max" when the
    // current value is mid-range if we hand it the computed room.
    const KP_CEIL = 1e-5, KP_FLOOR = 1e-7;
    const KI_CEIL = 1e-10, KI_FLOOR = 1e-13;
    const kpHeadroomUp = Math.max(0, KP_CEIL - kpHuman);
    const kpHeadroomDown = Math.max(0, kpHuman - KP_FLOOR);
    const kiHeadroomUp = Math.max(0, KI_CEIL - kiHuman);
    const kiHeadroomDown = Math.max(0, kiHuman - KI_FLOOR);

    const overCorrecting = state.deviationPct < 0 && kpHuman > 1.5e-6;

    const devNote = state.deviationPct < 0
      ? ' (GRIT ABOVE peg — rate pushing DOWN — system may be OVER-CORRECTING)'
      : state.deviationPct > 0
        ? ' (GRIT BELOW peg — rate pushing UP)'
        : ' (on peg)';

    return `## Current Protocol State

- **On-chain BTC (oracle)**: $${state.collateralPriceUsd.toFixed(2)}
- **BTC Drop from Baseline ($60k)**: ${state.collateralDropPct.toFixed(2)}%
- **GRIT Market Price**: $${state.marketPriceUsd.toFixed(6)}
- **GRIT Redemption Price (target)**: $${state.redemptionPriceUsd.toFixed(6)}
- **Peg Deviation**: ${state.deviationPct.toFixed(4)}%${devNote}
- **Current KP**: ${kpHuman.toExponential(3)} WAD (raw: ${state.kp})
- **Current KI**: ${kiHuman.toExponential(3)} WAD (raw: ${state.ki})
- **KP headroom**: can raise by ${kpHeadroomUp.toExponential(2)}, can lower by ${kpHeadroomDown.toExponential(2)} (ceiling 1e-5, floor 1e-7)
- **KI headroom**: can raise by ${kiHeadroomUp.toExponential(2)}, can lower by ${kiHeadroomDown.toExponential(2)} (ceiling 1e-10, floor 1e-13)
- **Last Proportional Term**: ${proportionalHuman.toExponential(3)}
- **Last Integral Term**: ${integralHuman.toExponential(3)}
- **Guard Update Count**: ${state.guardUpdateCount} / 1000
- **Guard Stopped**: ${state.guardStopped}
${overCorrecting ? '\n## ALERT: OVER-CORRECTION DETECTED\nDeviation is NEGATIVE and KP is elevated. The rate is over-pushing GRIT DOWN. YOU MUST REDUCE KP (and KI if also elevated), regardless of BTC direction. Pull gains back toward baseline 1e-6 / 1e-12.\n' : ''}
## DECISION RULE
- If deviation is NEGATIVE (GRIT above peg) AND current KP > 1.5e-6 → REDUCE KP. This overrides BTC direction — the rate is already over-correcting.
- NEVER describe the CURRENT value as "at max" — consult the KP/KI headroom above to see actual remaining range.
- Respect per-update caps: |new_kp − current_kp| ≤ 5e-7, |new_ki − current_ki| ≤ 5e-12.

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
