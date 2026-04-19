# Grinta PID Agent — LLM Governor

Off-chain AI agent that monitors on-chain PID controller state, reasons about market conditions using an LLM, and proposes parameter changes (KP/KI) via the ParameterGuard contract.

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
STARKNET_RPC_URL=https://starknet-sepolia.g.alchemy.com/starknet/version/rpc/v0_7/YOUR_KEY
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
