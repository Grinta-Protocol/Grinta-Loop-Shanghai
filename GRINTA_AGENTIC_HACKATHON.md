# Grinta — Agent-as-Governor: Gobernanza Agéntica para CDPs

**Propuesta para el hackathon.** Grinta como el primer CDP donde un agente de IA no solo USA el protocolo — lo GOBIERNA.

---

## Resumen Ejecutivo

La gobernanza en DeFi está rota. Cuando BTC cae 20% en una hora, MakerDAO necesita DÍAS para votar un cambio de parámetros. Para cuando pasa la propuesta, las liquidaciones ya ocurrieron. Gauntlet cobra millones por recomendar parámetros — pero la ejecución sigue atada a votos humanos.

Grinta invierte el modelo: **la DAO no vota parámetros, vota POLÍTICAS**. Un contrato `ParameterGuard` codifica los límites (bounds, cooldowns, budgets) dentro de los cuales un agente AI puede operar. El agente ejecuta en bloques, no en días. El humano define el campo de juego. La AI juega dentro de él.

---

## Unique Value Proposition — Dos Fases

### Fase 1: ParameterGuard — Vote Policies, Not Parameters (Hackathon)

El problema central no es que la AI tome malas decisiones. Es que **no hay infraestructura on-chain para delegar decisiones de forma segura**. ParameterGuard resuelve esto.

**El cambio de paradigma:**

| Gobernanza Tradicional | Grinta |
|------------------------|--------|
| La DAO vota "cambiar KP a 2.5" | La DAO vota "KP puede estar entre 0.1 y 10.0" |
| Cada cambio requiere propuesta + quorum + timelock | El agente ejecuta N cambios dentro de bounds |
| Latencia: días a semanas | Latencia: bloques (segundos) |
| El humano decide el QUÉ | El humano decide los LÍMITES, la AI decide el QUÉ |

**Las políticas on-chain (AgentPolicy) que la DAO vota:**

- **Absolute bounds**: rango permitido para cada parámetro (KP, KI)
- **Per-call delta caps**: máximo cambio por update individual (no puede dar saltos bruscos)
- **Two-tier cooldown**: cooldown normal (30s) y de emergencia (10s cuando |deviation| > threshold)
- **Call budget**: máximo N updates antes de requerir renovación
- **Emergency stop**: el admin humano puede frenar al agente en cualquier momento

Esto es MÁS seguro que la gobernanza tradicional: el agente tiene un espacio de acción acotado y auditable (PDR events on-chain), mientras que una propuesta de gobernanza aprobada puede cambiar CUALQUIER parámetro a CUALQUIER valor sin bounds.

**Comparación con el mercado:**

| Protocolo | Decisión de riesgo | Ejecución | Latencia | Guardrails on-chain |
|-----------|-------------------|-----------|----------|---------------------|
| MakerDAO | Governance vote | Manual | Días | No |
| Aave (Gauntlet) | AI off-chain | Governance vote | Horas-días | No |
| Compound (OpenZeppelin) | Timelock + multisig | Semi-manual | Horas | Parcial |
| **Grinta** | **AI proposal** | **Auto-apply (bounded)** | **Bloques** | **Full (ParameterGuard)** |

### Fase 2: RL-Trained Small Model — Inference Barata y Rápida (Post-hackathon)

La Fase 1 usa un LLM grande (GLM-5.1 / GPT-4 class) para el razonamiento del agente. Funciona, pero tiene dos problemas para producción:

1. **Costo de inferencia**: ~$0.01-0.05 por decisión con modelos grandes
2. **Latencia**: 2-5 segundos por llamada API al LLM

La Fase 2 resuelve esto con **RL fine-tuning de Qwen 2.5 1.5B**:

- **Entrenar con Reinforcement Learning** usando los logs de decisión del agente LLM grande como reward signal
- **Reward function**: minimizar peg deviation + minimizar liquidaciones + penalizar oscillación
- **Modelo target**: Qwen 2.5 1.5B — corre en inferencia local, sin API calls
- **Resultado**: latencia <100ms, costo ~$0, modelo especializado en gobernanza PID

```
Fase 1 (hackathon):     LLM grande → reasoning → ParameterGuard
Fase 2 (producción):    Qwen 1.5B (RL-tuned) → inference local → ParameterGuard
                         ↑
                    Entrenado con reward = f(peg_deviation, liquidations, oscillation)
                    sobre simulaciones adversariales (MVF-Composer)
```

El ParameterGuard NO cambia entre fases. Eso es lo potente del diseño: el contrato es agnóstico al modelo. La DAO vota los bounds una vez, y el modelo se puede mejorar sin tocar la cadena. Podés pasar de GPT-4 a un modelo de 1.5B parámetros y las garantías de seguridad on-chain son EXACTAMENTE las mismas.

---

## Parámetros que Controlaría el Agente

| Parámetro | Contrato Actual | Efecto |
|-----------|----------------|--------|
| Gains del PID (Kp, Ki) | PIDController | Velocidad de respuesta del redemption rate |
| Ratio de colateralización mínimo | SAFEEngine | Cuánto colateral se necesita por GRIT emitido |
| Stability fee | SAFEEngine | Costo de mantener deuda abierta |
| Umbrales de liquidación | LiquidationEngine | Cuándo se activa una liquidación |
| Descuento inicial de subasta | CollateralAuctionHouse | Precio de arranque en subastas holandesas |
| Throttle windows (60s/3600s) | GrintaHook | Frecuencia de actualización de precio |

---

## Arquitectura Propuesta

```
┌─────────────────────────────────────────┐
│  Off-chain: Agente RL                   │
│  - Observa: precios, TVL, health ratios │
│  - Modelo: RL (PPO/SAC) entrenado con   │
│    simulación adversarial (MVF-Composer)│
│  - Output: vector de parámetros óptimos │
└──────────────┬──────────────────────────┘
               │ propuesta (firmada, time-locked)
               ▼
┌─────────────────────────────────────────┐
│  On-chain: ParameterGuard Contract      │
│  - Verifica bounds (min/max por param)  │
│  - Aplica timelock (ej: 1 bloque)       │
│  - Emite evento para auditoría          │
│  - El humano puede vetar en el timelock │
└──────────────┬──────────────────────────┘
               │ actualización
               ▼
┌─────────────────────────────────────────┐
│  Contratos Grinta existentes            │
│  PIDController, SAFEEngine,             │
│  LiquidationEngine, etc.                │
└─────────────────────────────────────────┘
```

---

## Plan de Ejecución

### Fase 1 — Hackathon Deliverables
1. ~~**ParameterGuard contract** (Cairo)~~ Done — bounds, cooldowns, budget, emergency stop, PDR events
2. ~~**LLM Agent off-chain** (TypeScript)~~ Done — Monitor → Reason (GLM-5.1) → Execute via Guard
3. ~~**Integración con PIDController**~~ Done — Guard is PID admin, agent proposes through Guard
4. ~~**Governance Dashboard**~~ Done — React + Express, live state, cheat controls, agent log
5. **Demo en Sepolia**: crash oracle → agent detects → proposes KP boost → swap recalcs rate → dashboard shows diff

### Fase 2 — Post-hackathon (RL Small Model)
6. Simulación adversarial (MVF-Composer) — 1,000+ escenarios de estrés
7. Reward function: `R = -w1*|deviation| - w2*liquidations - w3*oscillation`
8. RL fine-tune Qwen 2.5 1.5B con PPO usando logs del LLM como teacher signal
9. Benchmark latency/cost/quality vs LLM grande
10. Deploy modelo local — zero external API dependency

### Nice to Have
11. Multi-agente: un agente para PID, otro para liquidaciones, otro para stability fees
12. LLM feedforward signal: predecir de-pegs analizando sentimiento + on-chain data
13. Path a producción: ParameterGuard gobernado por DAO vote (Snapshot/Governor)

---

## Narrativa para Jueces

> "La gobernanza de DeFi tiene un problema de latencia que mata usuarios. Cuando BTC cae 20% en una hora, MakerDAO necesita días para votar un ajuste de parámetros. Para cuando llega, ya hubo liquidaciones masivas.
>
> Nuestra pregunta fue: ¿y si la DAO no votara parámetros, sino POLÍTICAS? Un rango de KP permitido, un máximo cambio por update, un cooldown entre decisiones, un presupuesto de N cambios. Codificamos eso en un contrato — ParameterGuard — y dejamos que un agente AI opere dentro de esos bounds en tiempo real.
>
> Resultado: el agente reacciona en bloques, no en días. Pero con las MISMAS garantías de seguridad que una DAO — porque los bounds están on-chain, son auditables, y el admin humano puede frenar al agente con un botón.
>
> Y lo mejor: el contrato es agnóstico al modelo. Hoy usamos un LLM grande para razonar. Mañana lo reemplazamos por un Qwen 1.5B entrenado con RL, sin tocar la cadena. Inference local, sub-100ms, cero costo. Las políticas on-chain no cambian.
>
> Literatura reciente muestra **38.4% menos liquidaciones** bajo estrés con AI-driven parameter tuning. Nosotros lo hacemos nativo en Cairo, sobre Ekubo, con gas subcent. El humano define las reglas. La AI juega dentro de ellas."

---

## Papers que Respaldan Esta Propuesta

### 1. Hyper-Heuristic Driven Smart Contracts for DeFi
- **Fuente**: Frontiers in Blockchain, 2025
- **Link**: https://www.frontiersin.org/journals/blockchain/articles/10.3389/fbloc.2025.1730114/full
- **Resumen**: Arquitectura de dos capas: controlador RL de alto nivel que selecciona heurísticas de bajo nivel para optimizar parámetros DeFi en tiempo real. Evaluado sobre **Aave v3** ajustando LTV dinámicamente. Resultados: **45.6% más éxito en transacciones**, **28.3% menos gas**, **38.4% menos liquidaciones** bajo estrés.
- **Relevancia**: Es el paper más cercano a lo que proponemos. Valida que RL puede ajustar ratios de colateral y umbrales de liquidación mejor que parámetros estáticos.

### 2. Stablecoin Design with Adversarial-Robust Multi-Agent Systems (MVF-Composer)
- **Autores**: Shengwei You, Aditya Joshi, Andrey Kuehlkamp, Jarek Nabrzyski
- **Link**: https://arxiv.org/abs/2601.22168
- **Resumen**: Framework de stress-testing adversarial para stablecoins. Trust scores descartan señales de agentes manipuladores. **57% menos desviación máxima del peg** y **3.1x más rápido en recuperación** vs baselines en 1,200 escenarios con Black Swan shocks.
- **Relevancia**: Es el framework con el que ENTRENAMOS al agente RL. Metodología para validar robustez bajo ataque.

### 3. Who Restores the Peg? A Mean-Field Game Approach
- **Link**: https://arxiv.org/abs/2601.18991
- **Resumen**: Teoría de juegos de campo medio modelando arbitrajistas restaurando peg. Descubrimiento clave: **fricción en el mercado primario (mint/redeem) importa MÁS que liquidez secundaria**. Validado contra USDC marzo 2023, USDT mayo/julio 2023.
- **Relevancia**: Confirma que el diseño keeper-less de Grinta (mint/redeem vía Ekubo) es la variable CRÍTICA. Un agente que minimice fricción primaria dinámicamente tiene el mayor impacto posible.

### 4. Hybrid Stabilization Protocol with AI-Driven Arbitrage
- **Autores**: You, Kuehlkamp, Nabrzyski (Notre Dame)
- **Link**: https://arxiv.org/abs/2506.05708
- **Resumen**: Controlador PID adaptado para crypto-volatilidad + agentes AI optimizando delta hedging. **RL risk-aware con boost/damping adaptativo** que ajusta agresividad cuando el mercado se vuelve caótico.
- **Relevancia**: CASO DIRECTO. Un PID + RL que adapta los gains según volatilidad — exactamente nuestra arquitectura, pero nosotros nativos en Starknet.

### 5. Autonomous Agents on Blockchains
- **Link**: https://arxiv.org/abs/2601.04583
- **Resumen**: Revisión sistemática de 317 papers. Define 5 patrones de integración agente-blockchain. Propone **TIS (Transaction Intent Schema)** y **PDR (Policy Decision Record)**. Incluye threat model: prompt injection, key compromise, MEV, colusión multi-agente.
- **Relevancia**: Estándares para implementar el agente. Nuestro caso es patrón 3 (ejecución delegada) con PDR para auditoría. Guía el threat model del ParameterGuard.

### 6. When AI Meets Stablecoin: Dissecting De-pegging Risk with LLM Agents
- **Autores**: Congcong Bo, Dehua Shen (Nankai University)
- **Link**: https://papers.ssrn.com/sol3/papers.cfm?abstract_id=6121746
- **Resumen**: Agentes LLM multi-agente analizando y PREDICIENDO riesgo de de-pegging procesando señales on-chain + sentimiento.
- **Relevancia**: Feedforward signal. LLM predice de-peg antes → agente RL ajusta parámetros preventivamente.

### 7. Autonomous AI Agents in Decentralized Finance
- **Autores**: Lennart Ante, Technological Forecasting & Social Change, 2026
- **Link**: https://papers.ssrn.com/sol3/papers.cfm?abstract_id=5055677
- **Resumen**: Taxonomía comprensiva de 306 agentes AI en DeFi. Mapea áreas: trading, portfolio, comunidades.
- **Relevancia**: Contexto de mercado. 68% de protocolos DeFi nuevos en Q1 2026 incluyen un agente AI — pero NINGUNO en gobernanza de riesgo de un CDP. Ese es nuestro espacio vacío.

---

## Dato Clave

> Gauntlet y Chaos Labs cobran MILLONES por hacer off-chain lo que nosotros hacemos on-chain con guardrails. La diferencia: ellos recomiendan, una DAO vota, tarda días. Nosotros: el agente propone, el contrato valida bounds, se aplica en bloques. Y cuando el modelo mejora (Fase 2), el contrato NO cambia — las políticas son estables, el cerebro es upgradeable.

---

## Próximos Pasos

### Fase 1 (hackathon)
1. ~~Escribir `ParameterGuard.cairo`~~ Done (17 tests passing)
2. ~~Integrarlo con PIDController~~ Done (V10 deployment)
3. ~~LLM Agent off-chain~~ Done (Monitor → Reason → Execute)
4. ~~Frontend governance dashboard~~ Done (live on Sepolia)
5. Demo pulido para jueces — crash oracle → agent reacts → rate recalculates

### Fase 2 (post-hackathon)
6. Simular 1,000+ escenarios adversariales (MVF-Composer framework)
7. Diseñar reward function: `R = -w1*|peg_deviation| - w2*liquidations - w3*oscillation`
8. Fine-tune Qwen 2.5 1.5B con PPO/DPO usando logs del LLM grande como teacher
9. Benchmark: latencia, costo, y calidad de decisión vs LLM grande
10. Deploy modelo local (ONNX/vLLM) — zero API dependency

---

## Current Status (2026-04-19)

### Fase 1: Done
- **ParameterGuard contract**: Cairo, 17 tests, deployed on Sepolia
- **LLM Agent** (TypeScript): Monitor → Reason (GLM-5.1) → Execute, working end-to-end
- **PIDController enhancement**: `set_integral_period_size()` setter, redeployed with 5s period
- **Governance dashboard**: React + Express, live state polling, cheat controls, agent trigger, SSE log streaming
- **87/87 Cairo tests passing** (70 core + 17 ParameterGuard)
- **Agent proposed parameters on-chain** (updateCount=1)
- **Separate agent wallet**: `0x1f8975...` with dedicated funding

### Fase 2: Pending
- RL training pipeline not started
- Qwen 2.5 1.5B selected as target model (small enough for local inference, large enough for reasoning)
- Reward function designed but not implemented
