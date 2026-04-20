import { useState, useEffect, useRef, useCallback } from 'react'
import philosopherImg from '../assets/philosopher.png'
import columnImg from '../assets/column.png'
import './Governance.css'

const API = import.meta.env.VITE_API_URL || '/api'
const VOYAGER_BASE = 'https://sepolia.voyager.online/tx/'

/* ── Metric Card ── */
function MetricCard({ label, sublabel, value, tone, icon, trend }) {
  const [pulse, setPulse] = useState(false)
  useEffect(() => {
    setPulse(true)
    const t = setTimeout(() => setPulse(false), 1200)
    return () => clearTimeout(t)
  }, [value])

  const toneClass = tone === 'success' ? 'tone-success'
    : tone === 'warning' ? 'tone-warning'
    : tone === 'danger' ? 'tone-danger'
    : ''

  return (
    <div className={`metric-card marble-card ${pulse ? 'pulse-update' : ''}`}>
      <div className="metric-header">
        <div>
          <p className="metric-label">{label}</p>
          {sublabel && <p className="metric-sublabel">{sublabel}</p>}
        </div>
        {icon && <span className="metric-icon">{icon}</span>}
      </div>
      <div className="metric-value-row">
        <span className={`metric-value mono ${toneClass}`}>{value}</span>
        {trend && <span className="metric-trend">{trend}</span>}
      </div>
    </div>
  )
}

/* ── Log Line ── */
const LOG_ICONS = {
  monitor: '🔍',
  reason: '🧠',
  submit: '📝',
  confirm: '✅',
  rotate: '🔄',
  error: '❌',
  info: '💡',
}

function LogLine({ entry }) {
  const icon = entry.kind ? LOG_ICONS[entry.kind] || '•' : '•'
  const isReason = entry.kind === 'reason'
  const time = entry.ts ? new Date(entry.ts).toLocaleTimeString() : entry.time || ''

  return (
    <div className={`log-line animate-fade-in-up ${isReason ? 'log-reason' : ''}`}>
      <span className="log-time mono">{time}</span>
      <span className="log-icon">{icon}</span>
      <div className="log-content">
        {isReason ? (
          <p className="agent-quote">"{entry.msg || entry.text}"</p>
        ) : (
          <p className="log-text">
            {entry.msg || entry.text}
            {(entry.hash || entry.txHash) && (
              <>
                {' '}
                <a
                  href={`${VOYAGER_BASE}${entry.hash || entry.txHash}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="tx-link mono"
                >
                  {(entry.hash || entry.txHash).slice(0, 8)}…{(entry.hash || entry.txHash).slice(-4)} ↗
                </a>
              </>
            )}
          </p>
        )}
      </div>
    </div>
  )
}

/* ── Parameter History Row ── */
function HistoryTable({ rows }) {
  return (
    <section className="section">
      <div className="section-header">
        <h2>Parameter History</h2>
        <span className="section-tag">Session ledger</span>
      </div>
      <div className="marble-card table-wrap">
        <table className="history-table">
          <thead>
            <tr>
              <th>Time</th>
              <th>Action</th>
              <th>KP</th>
              <th>KI</th>
              <th>Tx</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={5} className="table-empty">
                  No parameter changes yet — the governor has not spoken.
                </td>
              </tr>
            ) : (
              rows.map((r, i) => (
                <tr key={i}>
                  <td className="mono">{r.time}</td>
                  <td className="history-action">{r.action}</td>
                  <td className="mono">{r.kpChange}</td>
                  <td className="mono">{r.ki}</td>
                  <td>
                    <a href={`${VOYAGER_BASE}${r.txHash}`} target="_blank" rel="noopener noreferrer" className="tx-link mono">
                      {r.txHash.slice(0, 8)}… ↗
                    </a>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  )
}

/* ── Main ── */
export default function Governance() {
  const [state, setState] = useState(null)
  const [logs, setLogs] = useState([])
  const [history, setHistory] = useState([])
  const [loading, setLoading] = useState({})
  const [decision, setDecision] = useState(null)
  const logRef = useRef(null)

  const addLog = useCallback((entry) => {
    setLogs((prev) => [...prev.slice(-100), { ...entry, id: `${Date.now()}-${Math.random()}` }])
  }, [])

  // SSE
  useEffect(() => {
    const es = new EventSource(`${API}/stream`)
    es.addEventListener('log', (e) => {
      const data = JSON.parse(e.data)
      addLog(data)
    })
    es.addEventListener('state', (e) => setState(JSON.parse(e.data)))
    es.addEventListener('decision', (e) => {
      const d = JSON.parse(e.data)
      setDecision(d)
      if (d.action && d.action !== 'hold' && d.new_kp != null) {
        setHistory((prev) => [...prev, {
          time: new Date().toLocaleTimeString(),
          action: `Governor: ${d.action}`,
          kpChange: `${state?.kp?.toFixed(2) ?? '?'} → ${d.new_kp}`,
          ki: `${d.new_ki ?? state?.ki?.toFixed(4) ?? '?'}`,
          txHash: d.txHash || '—',
        }])
      }
    })
    es.addEventListener('tx', (e) => {
      const tx = JSON.parse(e.data)
      addLog({ ts: new Date().toISOString(), kind: 'confirm', msg: `Tx confirmed: ${tx.type}`, hash: tx.hash })
      if (tx.hash) {
        setHistory((prev) => {
          const last = prev[prev.length - 1]
          if (last && last.txHash === '—') {
            return [...prev.slice(0, -1), { ...last, txHash: tx.hash }]
          }
          return prev
        })
      }
    })
    es.onerror = () => addLog({ ts: new Date().toISOString(), kind: 'error', msg: 'SSE connection lost — reconnecting...' })
    return () => es.close()
  }, [addLog])

  // Initial state
  useEffect(() => {
    fetch(`${API}/state`).then(r => r.json()).then(setState).catch(() => {})
  }, [])

  // Auto-scroll
  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight
  }, [logs])

  // Polling
  useEffect(() => {
    const iv = setInterval(() => {
      fetch(`${API}/state`).then(r => r.json()).then(setState).catch(() => {})
    }, 10000)
    return () => clearInterval(iv)
  }, [])

  async function apiCall(endpoint, body = {}, key) {
    setLoading(p => ({ ...p, [key]: true }))
    try {
      const res = await fetch(`${API}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Request failed')
      const freshState = await fetch(`${API}/state`).then(r => r.json())
      setState(freshState)
      return data
    } catch (e) {
      addLog({ ts: new Date().toISOString(), kind: 'error', msg: `ERROR: ${e.message}` })
    } finally {
      setLoading(p => ({ ...p, [key]: false }))
    }
  }

  const dev = state ? Math.abs(state.deviationPct) : 0
  const devTone = dev < 2 ? 'success' : dev < 5 ? 'warning' : 'danger'

  return (
    <div className="governance-app">
      {/* Decorative columns */}
      <img src={columnImg} alt="" className="deco-column deco-left" />
      <img src={columnImg} alt="" className="deco-column deco-right" />

      <main className="gov-main">
        {/* ── Header ── */}
        <header className="gov-header">
          <div className="header-left">
            <img src={philosopherImg} alt="Governor" className="philosopher-avatar animate-glow-pulse" />
            <div>
              <h1 className="header-title">
                Grinta <span className="text-gradient-teal">Governance</span>
              </h1>
              <p className="header-subtitle">Agent-as-Governor — AI-Driven Parameter Control</p>
            </div>
          </div>
          <div className="header-right">
            <div className="network-badge marble-card">
              <span className="pulse-dot">
                <span className="pulse-dot-ping" />
                <span className="pulse-dot-core" />
              </span>
              <span>Starknet Sepolia</span>
            </div>
            <p className="powered-by">Powered by Reflecter Labs</p>
          </div>
        </header>

        {/* ── Protocol State ── */}
        <section className="section">
          <div className="section-header">
            <h2>Protocol State</h2>
            <span className="section-tag">Live · On-chain</span>
          </div>
          <div className="metrics-grid">
            <MetricCard
              label="BTC Price" sublabel="Oracle"
              value={state ? `$${state.collateralPrice.toLocaleString(undefined, { maximumFractionDigits: 0 })}` : '—'}
              icon="₿"
            />
            <MetricCard
              label="GRIT Price" sublabel="Market"
              value={state ? `$${state.marketPrice.toFixed(3)}` : '—'}
              icon="◎"
            />
            <MetricCard
              label="Redemption Price" sublabel="target peg"
              value={state ? `$${state.redemptionPrice.toFixed(4)}` : '—'}
              icon="◎"
            />
            <MetricCard
              label="Deviation" sublabel="from peg"
              value={state ? `${state.deviationPct >= 0 ? '+' : ''}${state.deviationPct.toFixed(2)}%` : '—'}
              tone={devTone}
              icon="⚖"
            />
            <MetricCard
              label="KP" sublabel="Proportional"
              value={state ? state.kp.toFixed(3) : '—'}
              icon="⚙"
            />
            <MetricCard
              label="KI" sublabel="Integral"
              value={state ? state.ki.toFixed(6) : '—'}
              icon="∑"
            />
            <MetricCard
              label="Redemption Rate" sublabel="annualized"
              value={state ? (() => {
                const rps = state.redemptionRate;
                if (!rps || rps === 0) return '0%';
                const annualRate = Math.exp(Math.log(rps) * 31536000) - 1;
                const pct = annualRate * 100;
                const sign = pct >= 0 ? '+' : '';
                return Math.abs(pct) > 1000 ? `${sign}${pct.toFixed(0)}%` : `${sign}${pct.toFixed(2)}%`;
              })() : '—'}
              icon="↗"
              trend={
                state?.rateDirection === 'up' ? <span className="tone-success">▲</span>
                : state?.rateDirection === 'down' ? <span className="tone-danger">▼</span>
                : null
              }
            />
          </div>
        </section>

        {/* ── Market Simulation ── */}
        <section className="section">
          <div className="marble-card sim-card">
            <div className="sim-glow sim-glow-tl" />
            <div className="sim-glow sim-glow-br" />

            <div className="sim-header">
              <h2>Market Simulation</h2>
              <p className="sim-subtitle">Manipulate the oracle to summon the AI Governor</p>
            </div>

            <div className="sim-buttons-grid">
              <button
                className="sim-btn sim-crash"
                onClick={() => apiCall('/cheat/crash', { percent: 10 }, 'crash10')}
                disabled={loading.crash10}
              >
                {loading.crash10 ? '⏳' : '📉'} Crash BTC −10%
              </button>
              <button
                className="sim-btn sim-crash"
                onClick={() => apiCall('/cheat/crash', { percent: 20 }, 'crash20')}
                disabled={loading.crash20}
              >
                {loading.crash20 ? '⏳' : '📉'} Crash BTC −20%
              </button>
              <button
                className="sim-btn sim-pump"
                onClick={() => apiCall('/cheat/pump', { percent: 10 }, 'pump10')}
                disabled={loading.pump10}
              >
                {loading.pump10 ? '⏳' : '📈'} Pump BTC +10%
              </button>
              <button
                className="sim-btn sim-pump"
                onClick={() => apiCall('/cheat/pump', { percent: 20 }, 'pump20')}
                disabled={loading.pump20}
              >
                {loading.pump20 ? '⏳' : '📈'} Pump BTC +20%
              </button>
              <button
                className="sim-btn sim-reset"
                onClick={() => apiCall('/cheat/reset', {}, 'reset')}
                disabled={loading.reset}
              >
                {loading.reset ? '⏳' : '🔄'} Reset $60k
              </button>
            </div>

            <div className="sim-divider" />

            <div className="sim-agent-row">
              <button
                className="sim-btn sim-agent"
                onClick={() => apiCall('/agent/trigger', {}, 'agent')}
                disabled={loading.agent}
              >
                {loading.agent ? '🧠 Agent thinking...' : '🧠 Run Agent Cycle'}
              </button>
              <button
                className="sim-btn sim-swap"
                onClick={() => apiCall('/swap/trigger', {}, 'swap')}
                disabled={loading.swap}
              >
                {loading.swap ? '⏳ Swapping...' : '🔄 Trigger Swap'}
              </button>
            </div>

            <button
              className="sim-btn sim-demo"
              onClick={() => apiCall('/demo/crash', { percent: 20 }, 'demo')}
              disabled={loading.demo}
            >
              {loading.demo ? '⚡ Running full demo...' : '⚡ CRASH + AGENT + SWAP — Full Demo'}
            </button>
          </div>
        </section>

        {/* ── Latest Decision ── */}
        {decision && (
          <section className="section">
            <div className="section-header">
              <h2>Latest Decision</h2>
              <span className="section-tag">Agent verdict</span>
            </div>
            <div className="marble-card decision-card">
              <span className={`decision-badge decision-${decision.action}`}>
                {decision.action?.toUpperCase()}
              </span>
              <p className="agent-quote">"{decision.reasoning}"</p>
              {decision.new_kp != null && (
                <p className="decision-params mono">
                  KP: {state?.kp?.toFixed(3)} → {decision.new_kp} &nbsp;|&nbsp;
                  KI: {state?.ki?.toFixed(6)} → {decision.new_ki}
                </p>
              )}
            </div>
          </section>
        )}

        {/* ── Agent Log ── */}
        <section className="section">
          <div className="section-header">
            <h2>Agent Reasoning</h2>
            <span className="section-tag">Live deliberation</span>
          </div>
          <div className="marble-card log-card">
            <div className="log-titlebar">
              <div className="titlebar-dots">
                <span className="dot dot-red" />
                <span className="dot dot-yellow" />
                <span className="dot dot-green" />
              </div>
              <span className="titlebar-text mono">agent.governor.starknet</span>
            </div>
            <div className="log-scroll" ref={logRef}>
              {logs.length === 0 && (
                <p className="log-empty">The governor watches in silence…</p>
              )}
              {logs.map((entry) => (
                <LogLine key={entry.id} entry={entry} />
              ))}
            </div>
          </div>
        </section>

        {/* ── Parameter History ── */}
        <HistoryTable rows={history} />

        {/* ── Footer ── */}
        <footer className="gov-footer">
          "The unexamined protocol is not worth governing." — The Governor
        </footer>
      </main>
    </div>
  )
}
