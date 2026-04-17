import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join, isAbsolute } from "path";
import { CONFIG } from "./config.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

export interface PriceSample {
  /** Demo-time seconds since start (column t_seconds in the CSV) */
  tSeconds: number;
  /** BTC/USD price (number, e.g. 60000) */
  btcUsd: number;
  /** Phase label (calm, early_decline, acceleration, bottom, capitulation, recovery, stabilization) */
  phase: string;
}

/** Resolve CSV_PATH relative to demo/ root if not absolute */
function resolveCsv(): string {
  if (isAbsolute(CONFIG.CSV_PATH)) return CONFIG.CSV_PATH;
  return join(__dirname, "..", CONFIG.CSV_PATH);
}

let cached: PriceSample[] | null = null;

export function loadCrashSamples(): PriceSample[] {
  if (cached) return cached;
  const path = resolveCsv();
  const raw = readFileSync(path, "utf-8");
  const lines = raw.trim().split("\n");
  const header = lines[0].split(",").map((s) => s.trim());
  const idxT = header.indexOf("t_seconds");
  const idxBtc = header.indexOf("btc_price_usd");
  const idxPhase = header.indexOf("phase");
  if (idxT < 0 || idxBtc < 0 || idxPhase < 0) {
    throw new Error(`Bad CSV header: ${header.join(",")}`);
  }
  const samples: PriceSample[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(",");
    samples.push({
      tSeconds: Number(cols[idxT]),
      btcUsd: Number(cols[idxBtc]),
      phase: cols[idxPhase].trim(),
    });
  }
  // Defensive: ensure samples are sorted by tSeconds
  samples.sort((a, b) => a.tSeconds - b.tSeconds);
  cached = samples;
  return samples;
}

/** Find the most recent sample at or before elapsedSec (linear scan; CSV is small) */
export function sampleAt(samples: PriceSample[], elapsedSec: number): PriceSample {
  let chosen = samples[0];
  for (const s of samples) {
    if (s.tSeconds <= elapsedSec) chosen = s;
    else break;
  }
  return chosen;
}

// CLI usage: `npm run dump-csv` to verify parsing
const isMain = process.argv[1] && process.argv[1].endsWith("csv-loader.ts");
if (isMain) {
  const samples = loadCrashSamples();
  console.log(`Loaded ${samples.length} samples from ${resolveCsv()}`);
  console.log("First 3:", samples.slice(0, 3));
  console.log("Last 3:", samples.slice(-3));
  const phases = new Set(samples.map((s) => s.phase));
  console.log("Phases:", Array.from(phases).join(", "));
}
