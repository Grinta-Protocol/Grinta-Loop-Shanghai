/**
 * Off-chain price feed (DEMO MODE).
 *
 * In production this would be a Pyth/Chainlink/CEX API call. For the hackathon
 * demo we read the same synthetic CSV the feeder pushes to the oracle, but at
 * higher frequency — that's the agent's edge: it sees BTC dropping BEFORE the
 * on-chain oracle catches up.
 *
 * Activated via env vars DEMO_CSV_PATH + DEMO_START_TIMESTAMP_MS. If either is
 * unset, this returns null and the agent falls back to on-chain BTC only.
 */
import { readFileSync, existsSync } from "fs";
import { CONFIG } from "./config.js";

export interface OffchainSample {
  tSeconds: number;
  btcUsd: number;
  phase: string;
}

let cachedSamples: OffchainSample[] | null = null;

function loadSamples(path: string): OffchainSample[] {
  if (cachedSamples) return cachedSamples;
  const raw = readFileSync(path, "utf-8");
  const lines = raw.trim().split("\n");
  const header = lines[0].split(",").map((s) => s.trim());
  const idxT = header.indexOf("t_seconds");
  const idxBtc = header.indexOf("btc_price_usd");
  const idxPhase = header.indexOf("phase");
  if (idxT < 0 || idxBtc < 0 || idxPhase < 0) {
    throw new Error(`Bad off-chain CSV header: ${header.join(",")}`);
  }
  const out: OffchainSample[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(",");
    out.push({
      tSeconds: Number(cols[idxT]),
      btcUsd: Number(cols[idxBtc]),
      phase: cols[idxPhase].trim(),
    });
  }
  out.sort((a, b) => a.tSeconds - b.tSeconds);
  cachedSamples = out;
  return out;
}

export interface OffchainReading {
  btcUsd: number;
  phase: string;
  elapsedSec: number;
  /** $60k baseline drop in % (positive = price down) */
  dropPct: number;
}

export class OffchainFeed {
  private readonly enabled: boolean;
  private readonly samples: OffchainSample[] | null;
  private readonly startMs: number;

  constructor() {
    if (!CONFIG.DEMO_CSV_PATH || !existsSync(CONFIG.DEMO_CSV_PATH)) {
      this.enabled = false;
      this.samples = null;
      this.startMs = 0;
      return;
    }
    this.samples = loadSamples(CONFIG.DEMO_CSV_PATH);
    this.startMs = CONFIG.DEMO_START_TIMESTAMP_MS || Date.now();
    this.enabled = true;
    console.log(
      `[OffchainFeed] DEMO MODE — ${this.samples.length} samples from ${CONFIG.DEMO_CSV_PATH}, ` +
      `start=${new Date(this.startMs).toISOString()}`,
    );
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  /** Read the most-recent CSV sample for the current demo elapsed time */
  read(): OffchainReading | null {
    if (!this.enabled || !this.samples) return null;
    const elapsedSec = (Date.now() - this.startMs) / 1000;
    let chosen = this.samples[0];
    for (const s of this.samples) {
      if (s.tSeconds <= elapsedSec) chosen = s;
      else break;
    }
    const baseline = this.samples[0].btcUsd;
    const dropPct = baseline > 0 ? ((baseline - chosen.btcUsd) / baseline) * 100 : 0;
    return {
      btcUsd: chosen.btcUsd,
      phase: chosen.phase,
      elapsedSec,
      dropPct,
    };
  }
}
