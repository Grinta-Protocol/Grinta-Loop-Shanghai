# Grinta PID Agent — Autonomous Governor

Off-chain AI agent that monitors on-chain PID controller state and proposes parameter changes (KP/KI) via the ParameterGuard contract.

**Two inference modes:**
1. **External LLM** (current) — OpenAI-compatible API (GPT-4, Claude, etc.)
2. **PID-RL local model** (recommended) — finetuned Qwen 2.5 1.5B from [`../pid_rl/`](../pid_rl/)

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                     PID Agent Loop                       │
│                                                          │
│  Monitor ──────► Reasoning (LLM) ──────► Executor        │
│    │                  │                      │           │
│  RPC reads         Decision:              propose_       │
│  - market_price    HOLD / ADJUST /        parameters()   │
│  - redemption_price ADJUST_EMERGENCY     via Guard       │
│  - KP, KI                                               │
│  - deviation                                             │
│    │                  │                      │           │
│    └──────────────────┴──────────────────────┘           │
│                       │                                  │
│                  Logger (JSONL)                           │
│                  decisions.jsonl                          │
└─────────────────────────────────────────────────────────┘
```

## Setup

```bash
cd agent
npm install
cp .env.example .env
# Fill in .env with your values
npm run start
```

## Configuration (`.env`)

```bash
# Agent wallet (MUST match the address registered on ParameterGuard)
AGENT_ADDRESS=0x01f8975c5a1c6d2764bd30dddf4d6ab80c59e8287e5f796a5ba2490dcbf2dab6
AGENT_PRIVATE_KEY=0x...

# Contract addresses (V12 — see deployed_v12.json at repo root)
# Only ParameterGuard changed in V12; PID/Hook/SAFEEngine are V11, unchanged.
PARAMETER_GUARD_ADDRESS=0x7acc10ba0a293c62b3a3bba5c885beac8120a12b33b7f31bdd99a5b9dd92278
PID_CONTROLLER_ADDRESS=0x077ce1bdf9671da93542730a7f20825b8edabd2a5dfedaab23a2ac1c47791125
GRINTA_HOOK_ADDRESS=0x04560e84979e5bae575c65f9b0be443d91d9333a8f2f50884ebd5aaf89fb6147
SAFE_ENGINE_ADDRESS=0x07417b07b7ac71dd816c8d880f4dc1f74c10911aa174305a9146e1b56ef60272

# ERC-8004 IdentityRegistry (Sepolia) — V12 Guard authorizes the agent by
# looking up the bound wallet for agent_id 36 in this registry.
IDENTITY_REGISTRY_ADDRESS=0x7856876f4c8e1880bc0a2e4c15f4de3085bc2bad5c7b0ae472740f8f558e417

# LLM provider (OpenAI-compatible)
COMMONSTACK_API_KEY=your_key
COMMONSTACK_BASE_URL=https://api.commonstack.ai/v1
LLM_MODEL=zai-org/glm-5.1

# RPC
STARKNET_RPC_URL=https://starknet-sepolia.g.alchemy.com/starknet/version/rpc/v0_10/<your_key>
```

## Components

| File | Role |
|------|------|
| `src/index.ts` | Main loop: monitor → reason → execute, repeat |
| `src/monitor.ts` | Reads on-chain state via RPC (market price, KP/KI, deviation) |
| `src/reasoning.ts` | Sends state to LLM, gets structured JSON decision |
| `src/executor.ts` | Submits `propose_parameters()` tx to ParameterGuard |
| `src/logger.ts` | Writes every decision as JSONL for audit trail |
| `src/config.ts` | Environment variable loading and constants |
| `src/create-wallet.ts` | Utility to generate a new Starknet agent wallet |

## Using PID-RL (Local Model)

Instead of an external LLM API, use the trained PID-RL model from [`../pid_rl/`](../pid_rl/):

```python
# ../pid_rl/pid_rl/eval.py (simplified)
from transformers import AutoModelForCausalLM, AutoTokenizer
from peft import PeftModel
import torch

def load_pid_rl(model_path: str = "../pid_rl/pid_rl/pid_rl_lora_v1"):
    base = AutoModelForCausalLM.from_pretrained(
        "unsloth/Qwen2.5-1.5B-Instruct",
        torch_dtype=torch.bfloat16,
        device_map="auto"
    )
    tokenizer = AutoTokenizer.from_pretrained(model_path)
    model = PeftModel.from_pretrained(base, model_path)
    return model, tokenizer

def suggest_gains(scenario: str, model, tokenizer) -> dict:
    """scenario: market snapshot in JSON format"""
    prompt = f"""You are the GRIT protocol governance agent.
Analyze the market scenario and propose PID controller gains.
Scenario:
{scenario}
Output a JSON object with keys: action, new_kp, new_ki, is_emergency, reasoning."""

    inputs = tokenizer(prompt, return_tensors="pt").to(model.device)
    outputs = model.generate(**inputs, max_new_tokens=256, temperature=0.1)
    result = tokenizer.decode(outputs[0], skip_special_tokens=True)
    return json.loads(result.split("```json")[-1].split("```")[0])
```

**Benefits:**
- **$0.001/run** vs $0.05-0.15 for API LLMs
- **<50ms latency** vs 2-5s for API calls
- **100% JSON validity** — trained specifically for this task
- **No rate limits** — runs on your own GPU
- **Privacy** — governance decisions never leave your infrastructure

## Decision Framework

The LLM receives full PID context and current state, then decides:

| Deviation from Peg | Action | Description |
|---------------------|--------|-------------|
| < 1% | `HOLD` | Market stable, no changes |
| 1% – 5% | `ADJUST` | Mild stress, slightly increase KP |
| >= 5% | `ADJUST_EMERGENCY` | Crash detected, aggressively boost KP, use emergency cooldown |

## On-Chain Guardrails (ParameterGuard)

The agent does NOT have direct PID admin access. All proposals go through ParameterGuard which enforces (live policy as of 2026-04-25):

- **Absolute bounds**: KP must be in `[3.33e-7, 1e-6]` WAD around baseline `6.67e-7` (~20% annualized at 1% deviation); KI in `[3.33e-13, 1e-12]` WAD around baseline `6.67e-13`.
- **Per-call delta caps**: max KP change of `6.67e-8` WAD (10% of baseline) and KI change of `6.67e-14` WAD (10% of baseline) per call. Doubling is forbidden by construction.
- **Cooldown**: 5s normal, 3s emergency (demo cadence; prod targets in [V11_PROD_CHECKLIST.md](../V11_PROD_CHECKLIST.md)).
- **Budget**: 1000 updates total (demo); prod target 50.
- **Emergency stop**: human admin can halt agent at any time.

If the policy changes on-chain, both the server prompt (`app/server/index.ts`) and the standalone agent prompt (`src/reasoning.ts`) MUST be updated to mirror the new bounds — drift causes the LLM to propose values the chain rejects with `Result::unwrap failed`.

## LLM Reliability

Two patterns are mandatory when running GLM-5.1 (or any reasoning model that consumes `max_tokens` on internal thoughts):

1. **JSON mode** — pass `response_format: { type: "json_object" }` to the LLM call. Without it, the model may emit prose preamble and the JSON parser fails.
2. **`max_tokens >= 8000`** — reasoning models burn tokens before output. Below 4000, output is truncated to empty string.

Independently, the server applies **defensive clamping** in code before signing the tx:

```ts
const kpClamped = clampBounds(
  clampDelta(newKp, currentKp, POLICY.MAX_KP_DELTA),
  POLICY.KP_MIN,
  POLICY.KP_MAX,
);
```

This catches LLM rounding errors that bust the on-chain delta cap by a few wei (e.g. model returns `7.334e-13` → 733_400 raw; cap is 66_667; clamp brings it to a valid value). Mirror the on-chain policy in the `POLICY` object whenever it moves.
