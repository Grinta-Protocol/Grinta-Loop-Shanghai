/**
 * Demo Launcher — orchestrates the full agentic demo.
 *
 * Spawns (as child processes):
 *   1. feeder  — pushes CSV BTC prices to OracleRelayer every FEEDER_INTERVAL_SEC
 *   2. trader  — executes Ekubo swaps to create depeg pressure
 *   3. agent   — (optional, if LAUNCH_AGENT=true) reads CSV + on-chain state,
 *                proposes KP/KI to ParameterGuard
 *
 * All three share the same wall-clock reference via DEMO_START_TIMESTAMP_MS
 * so their CSV sampling stays aligned.
 *
 * Stdout/stderr from each child is prefixed with its role and color for
 * readability. Ctrl-C (SIGINT) kills all children cleanly.
 *
 * Prerequisites: run `npm run setup` ONCE before launching the demo.
 */
import { spawn, type ChildProcess } from "child_process";
import { fileURLToPath } from "url";
import { dirname, join, resolve } from "path";
import { CONFIG } from "./config.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEMO_ROOT = resolve(__dirname, "..");              // .../pid/demo
const REPO_ROOT = resolve(DEMO_ROOT, "..");              // .../pid
const AGENT_ROOT = join(REPO_ROOT, "agent");

const LAUNCH_AGENT = (process.env.LAUNCH_AGENT || "true").toLowerCase() === "true";
const AGENT_CSV_PATH = process.env.AGENT_CSV_PATH || join(DEMO_ROOT, CONFIG.CSV_PATH);

// ANSI colors for log prefixes
const COLORS = {
  feeder: "\x1b[36m",   // cyan
  trader: "\x1b[33m",   // yellow
  agent:  "\x1b[35m",   // magenta
  system: "\x1b[32m",   // green
  reset:  "\x1b[0m",
};

function stamp(role: keyof typeof COLORS): string {
  const pad = role.padEnd(6);
  return `${COLORS[role]}[${pad}]${COLORS.reset}`;
}

function pipeWithPrefix(
  child: ChildProcess,
  role: "feeder" | "trader" | "agent",
) {
  const prefix = stamp(role);
  const lineHandler = (data: Buffer) => {
    const lines = data.toString().split(/\r?\n/);
    for (const line of lines) {
      if (line.length === 0) continue;
      console.log(`${prefix} ${line}`);
    }
  };
  child.stdout?.on("data", lineHandler);
  child.stderr?.on("data", lineHandler);
}

function spawnChild(
  role: "feeder" | "trader" | "agent",
  cwd: string,
  cmd: string,
  args: string[],
  extraEnv: Record<string, string>,
): ChildProcess {
  const child = spawn(cmd, args, {
    cwd,
    env: { ...process.env, ...extraEnv },
    stdio: ["ignore", "pipe", "pipe"],
    shell: true,
  });
  pipeWithPrefix(child, role);
  child.on("exit", (code, signal) => {
    console.log(
      `${stamp("system")} ${role} exited (code=${code}, signal=${signal ?? "—"})`,
    );
  });
  return child;
}

async function main() {
  // Give the children a small grace period so they don't miss t=0.
  const GRACE_MS = 3000;
  const demoStartMs = Date.now() + GRACE_MS;

  console.log("=".repeat(60));
  console.log(`${stamp("system")} Grinta Agentic Demo — Launcher`);
  console.log("=".repeat(60));
  console.log(`${stamp("system")} Demo starts in ${GRACE_MS / 1000}s (DEMO_START_TIMESTAMP_MS=${demoStartMs})`);
  console.log(`${stamp("system")} Duration: ${CONFIG.DEMO_DURATION_SEC}s`);
  console.log(`${stamp("system")} Feeder : every ${CONFIG.FEEDER_INTERVAL_SEC}s`);
  console.log(`${stamp("system")} Trader : every ${CONFIG.TRADER_INTERVAL_SEC}s`);
  console.log(`${stamp("system")} Agent  : ${LAUNCH_AGENT ? "enabled (LAUNCH_AGENT=true)" : "skipped"}`);
  console.log(`${stamp("system")} CSV    : ${AGENT_CSV_PATH}`);
  console.log("=".repeat(60));

  const children: ChildProcess[] = [];

  // Feeder + trader share the demo .env; we just nudge the shared clock.
  const sharedEnv = { DEMO_START_TIMESTAMP_MS: String(demoStartMs) };

  children.push(
    spawnChild("feeder", DEMO_ROOT, "npm", ["run", "feeder"], sharedEnv),
  );
  children.push(
    spawnChild("trader", DEMO_ROOT, "npm", ["run", "trader"], sharedEnv),
  );

  if (LAUNCH_AGENT) {
    const agentEnv = {
      DEMO_START_TIMESTAMP_MS: String(demoStartMs),
      DEMO_CSV_PATH: AGENT_CSV_PATH,
    };
    children.push(
      spawnChild("agent", AGENT_ROOT, "npm", ["run", "start"], agentEnv),
    );
  }

  // Graceful shutdown on Ctrl-C
  let shuttingDown = false;
  const shutdown = (sig: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`\n${stamp("system")} Received ${sig} — killing children…`);
    for (const c of children) {
      try {
        c.kill("SIGINT");
      } catch {}
    }
    setTimeout(() => process.exit(0), 2000);
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));

  // Wait for all children to exit, then bail.
  await Promise.all(
    children.map(
      (c) => new Promise<void>((r) => c.on("exit", () => r())),
    ),
  );
  console.log(`${stamp("system")} All children exited. Demo complete.`);
}

main().catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});
