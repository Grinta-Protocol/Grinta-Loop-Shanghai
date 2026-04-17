/**
 * Grinta PID Agent — Entry Point
 *
 * Monitor → Reason → Execute loop.
 * Reads protocol state, asks GLM-5.1 for a decision, executes on-chain if needed.
 */

import { CONFIG } from "./config.js";
import { Monitor, type ProtocolState } from "./monitor.js";
import { ReasoningEngine, type AgentDecision } from "./reasoning.js";
import { Executor } from "./executor.js";
import { logDecision, nextCycle, type DecisionRecord } from "./logger.js";

class PIDAgent {
  private monitor: Monitor;
  private reasoning: ReasoningEngine;
  private executor: Executor;
  private isRunning = false;

  constructor() {
    this.monitor = new Monitor();
    this.reasoning = new ReasoningEngine();
    this.executor = new Executor();
  }

  async start(): Promise<void> {
    console.log("=".repeat(60));
    console.log("  Grinta PID Agent — Agent-as-Governor");
    console.log("=".repeat(60));
    console.log(`  Agent address : ${this.executor.address}`);
    console.log(`  LLM model     : ${CONFIG.COMMONSTACK_MODEL}`);
    console.log(`  Guard contract: ${CONFIG.PARAMETER_GUARD_ADDRESS}`);
    console.log(`  PID controller: ${CONFIG.PID_CONTROLLER_ADDRESS}`);
    console.log(`  Check interval: ${CONFIG.CHECK_INTERVAL_MS / 1000}s`);
    console.log("=".repeat(60));
    console.log("");

    this.isRunning = true;

    while (this.isRunning) {
      await this.runCycle();
      await sleep(CONFIG.CHECK_INTERVAL_MS);
    }
  }

  stop(): void {
    this.isRunning = false;
    console.log("\nAgent stopped.");
  }

  private async runCycle(): Promise<void> {
    const cycle = nextCycle();
    const timestamp = new Date().toISOString();

    let state: ProtocolState;
    try {
      state = await this.monitor.getState();
    } catch (error) {
      console.error(`[Cycle ${cycle}] Failed to read state:`, error);
      return;
    }

    // Don't act if guard is stopped
    if (state.guardStopped) {
      console.log(`[Cycle ${cycle}] Guard is STOPPED — skipping`);
      return;
    }

    // Ask LLM for decision
    let decision: AgentDecision;
    try {
      decision = await this.reasoning.analyze(state);
    } catch (error) {
      console.error(`[Cycle ${cycle}] Reasoning failed:`, error);
      return;
    }

    // Build decision record
    const record: DecisionRecord = {
      timestamp,
      cycle,
      action: decision.action,
      reasoning: decision.reasoning,
      btc_price_usd: state.collateralPriceUsd.toFixed(2),
      btc_drop_pct: state.collateralDropPct.toFixed(2),
      market_price_usd: state.marketPriceUsd.toFixed(6),
      redemption_price_usd: state.redemptionPriceUsd.toFixed(6),
      deviation_pct: state.deviationPct.toFixed(4),
      current_kp: state.kp.toString(),
      current_ki: state.ki.toString(),
      is_emergency: decision.is_emergency,
    };

    // Execute if action requires on-chain tx
    if (decision.action !== "hold" && decision.new_kp != null && decision.new_ki != null) {
      record.proposed_kp = decision.new_kp.toString();
      record.proposed_ki = decision.new_ki.toString();

      try {
        const txHash = await this.executor.proposeParameters(
          decision.new_kp,
          decision.new_ki,
          decision.is_emergency
        );
        record.tx_hash = txHash;
      } catch (error) {
        record.error = error instanceof Error ? error.message : String(error);
      }
    }

    logDecision(record);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---- Main ----

async function main(): Promise<void> {
  const agent = new PIDAgent();

  process.on("SIGINT", () => {
    console.log("\nShutting down...");
    agent.stop();
    process.exit(0);
  });

  await agent.start();
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
