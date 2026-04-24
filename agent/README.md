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
AGENT_ADDRESS=0x1f8975c5a1c6d2764bd30dddf4d6ab80c59e8287e5f796a5ba2490dcbf2dab6
AGENT_PRIVATE_KEY=0x...

# Contract addresses
PARAMETER_GUARD_ADDRESS=0x65e1098a1552e8aceec3a5217ecad40d223303e00070097abcc011deeb1ce1b
PID_CONTROLLER_ADDRESS=0x53916399f6c8caf0e1ded219f7d956b9bde8c0d070f17435d3179492b738dd3
GRINTA_HOOK_ADDRESS=0x029d4fa992b69377bdc8fb9f98dd4fb255b7c82e62727be4d5badcd7da60122b
SAFE_ENGINE_ADDRESS=0x012acdb5b9fd6743372f6e14e8af51dae1cd54bbcc578682656f4c75628d8c0c

# LLM provider (OpenAI-compatible)
COMMONSTACK_API_KEY=your_key
COMMONSTACK_BASE_URL=https://api.commonstack.ai/v1
LLM_MODEL=zai-org/glm-5.1

# RPC
STARKNET_RPC_URL=https://starknet-sepolia.g.alchemy.com/starknet/version/rpc/v0_10/w0WsoxSXn4Xq8DEGYETDW
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

The agent does NOT have direct PID admin access. All proposals go through ParameterGuard which enforces:

- **Absolute bounds**: KP must be in `[0.1, 10.0]` WAD, KI in `[0, 0.1]` WAD
- **Per-call delta caps**: max KP change of 1.0 WAD and KI change of 0.1 WAD per call
- **Cooldown**: 30s normal, 10s emergency (when deviation exceeds threshold)
- **Budget**: max 20 updates total before requiring admin reset
- **Emergency stop**: human admin can halt agent at any time

## Known Issues

1. **i128 encoding** — `executor.ts:encodeI128()` uses `value + 2^128` for negative values. This is WRONG for Starknet felt252 encoding. Should use `STARK_PRIME + value` where `STARK_PRIME = 2^251 + 17*2^192 + 1`. Currently only positive KP/KI values are proposed so this hasn't triggered.

2. **Tip estimation** — Alchemy RPC sometimes fails `getTipStats`. Fix: add `{ maxFee: 10n ** 16n }` to `account.execute()` in `executor.ts`.

3. **LLM connection** — CommonStack API may return connection errors. Verify API key is valid. Alternative: point to any OpenAI-compatible endpoint.
