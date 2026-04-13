# Grinta — Nivel 2: Capa de Riesgo Agéntica (Agent-as-Governor)

**Propuesta para el hackathon.** Grinta como el primer CDP donde un agente de IA no solo USA el protocolo — lo GOBIERNA.

---

## Resumen Ejecutivo

Agregar una **capa de inteligencia artificial que gobierne los parámetros de riesgo del protocolo en tiempo real**, sin depender de votaciones de gobernanza lentas. En vez de que un humano o una DAO decida cada cuánto ajustar el ratio de colateral, las tasas de estabilidad, los gains del PID, o los umbrales de liquidación, un **agente RL (Reinforcement Learning) off-chain** observa el estado on-chain y propone ajustes dentro de límites predefinidos (guardrails).

---

## ¿Por qué esto es diferenciador?

Hoy, **ningún protocolo CDP hace esto**. MakerDAO todavía usa gobernanza manual para parámetros de riesgo — un proceso que puede tardar días. Gauntlet y Chaos Labs hacen simulaciones off-chain y RECOMIENDAN parámetros, pero la ejecución sigue dependiendo de votos humanos. Grinta sería el primero donde **el agente propone Y ejecuta** (dentro de bounds seguros que el humano define).

| Protocolo | Decisión de riesgo | Ejecución | Latencia |
|-----------|-------------------|-----------|----------|
| MakerDAO | Governance vote | Manual | Días |
| Aave (Gauntlet) | AI off-chain | Governance vote | Horas-días |
| **Grinta** | **AI on-chain proposal** | **Contract auto-apply (bounded)** | **Bloques** |

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

## Plan de Ejecución Hackathon

### Priority 1 — Must Have (la demo)
1. **ParameterGuard contract** (Cairo) — nuevo contrato con bounds por parámetro, timelock, función `propose_update()` y `execute_update()`
2. **Agente RL off-chain** (Python, stable-baselines3) — PPO entrenado en simulación del protocolo Grinta
3. **Oracle de observación** — bot que lee estado on-chain (Grinta + Ekubo) y lo pasa al agente
4. **Integración con PIDController existente** — permitir que ParameterGuard actualice Kp/Ki del PID
5. **Demo en Sepolia**: escenario de estrés → agente detecta → propone update → contrato lo aplica → peg se restaura más rápido que con params estáticos

### Priority 2 — Should Have (fortalece submission)
6. Simulación adversarial estilo MVF-Composer para entrenar el agente
7. Dashboard frontend mostrando: parámetros actuales, propuesta del agente, estado del timelock
8. Auditoría: cada decisión del agente queda on-chain con razón (PDR pattern)
9. Comparación A/B: 1,200 escenarios con vs sin agente (peg deviation, liquidation events)

### Priority 3 — Nice to Have
10. LLM feedforward signal: agente LLM que predice de-pegs analizando sentimiento + on-chain
11. Multi-agente: un agente para PID, otro para liquidaciones, otro para stability fees
12. Documento de arquitectura con path a producción

---

## Narrativa para Jueces

> "Los stablecoins reflexivos como RAI resolvieron el problema de minimizar gobernanza pero crearon uno nuevo: los parámetros de riesgo siguen siendo estáticos o dependen de votos lentos. Cuando el mercado colapsa, para cuando la DAO vota, ya hubo liquidaciones masivas. Nos preguntamos: ¿qué pasaría si el protocolo pudiera gobernarse a sí mismo dentro de límites seguros? En Starknet, construimos el primer CDP donde un agente RL propone ajustes de parámetros de riesgo en tiempo real, y un contrato ParameterGuard los aplica automáticamente dentro de bounds que el humano define. Literatura reciente muestra **38.4% menos liquidaciones** bajo estrés con este approach. Nosotros lo hacemos nativo en Cairo, sobre Ekubo, con costos de gas subcent. El humano define los límites. La AI optimiza dentro de ellos."

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

> Gauntlet y Chaos Labs cobran MILLONES por hacer off-chain lo que nosotros proponemos hacer on-chain con guardrails. La diferencia: ellos recomiendan, una DAO vota, tarda días. Nosotros: el agente propone, el contrato valida bounds, se aplica en bloques. El humano define los límites. La AI optimiza dentro de ellos.

---

## Próximos Pasos

1. Definir los bounds iniciales para cada parámetro (min/max seguros)
2. Definir el espacio de observación del agente (qué variables on-chain lee)
3. Diseñar la función de reward (peg deviation + liquidation count + protocol revenue)
4. Armar el entorno de simulación basado en los contratos actuales (V9)
5. Entrenar baseline PPO
6. Escribir `ParameterGuard.cairo`
7. Integrarlo con los contratos existentes (agregar `authorize_updater()` en cada uno)
