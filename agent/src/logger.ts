/**
 * Decision Logger — PDR (Policy Decision Record) for demo visualization
 *
 * Outputs JSON lines to stdout and optionally to a file.
 * Each line is a structured decision record the demo UI can consume.
 */

import { appendFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const LOG_FILE = join(__dirname, "..", "decisions.jsonl");

export type AgentAction = "hold" | "adjust" | "adjust_emergency";

export interface DecisionRecord {
  timestamp: string;
  cycle: number;
  action: AgentAction;
  reasoning: string;
  btc_price_usd: string;
  btc_drop_pct: string;
  market_price_usd: string;
  redemption_price_usd: string;
  deviation_pct: string;
  current_kp: string;
  current_ki: string;
  proposed_kp?: string;
  proposed_ki?: string;
  is_emergency: boolean;
  tx_hash?: string;
  error?: string;
}

let cycleCounter = 0;

export function nextCycle(): number {
  return ++cycleCounter;
}

export function logDecision(record: DecisionRecord): void {
  const line = JSON.stringify(record);

  // Console — colorized summary
  const icon =
    record.action === "hold"
      ? "\u{1F7E2}"
      : record.action === "adjust_emergency"
        ? "\u{1F534}"
        : "\u{1F7E1}";
  const summary = `${icon} [Cycle ${record.cycle}] ${record.action.toUpperCase()} | BTC=$${record.btc_price_usd} (${record.btc_drop_pct}%) | peg=${record.deviation_pct}% | ${record.reasoning.slice(0, 100)}`;
  console.log(summary);

  if (record.tx_hash) {
    console.log(`   tx: ${record.tx_hash}`);
  }
  if (record.error) {
    console.log(`   error: ${record.error}`);
  }

  // File — structured JSONL for demo UI
  try {
    appendFileSync(LOG_FILE, line + "\n");
  } catch {
    // Non-critical — don't crash agent if log file fails
  }
}
