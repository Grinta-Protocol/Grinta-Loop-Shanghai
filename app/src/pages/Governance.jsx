import { useState, useEffect, useRef, useCallback } from 'react'
import philosopherImg from '../assets/philosopher.png'
import columnImg from '../assets/column.png'
import './Governance.css'

const API = import.meta.env.VITE_API_URL || '/api'
const VOYAGER_BASE = 'https://sepolia.voyager.online/tx/'

// Format PID gains: HAI-style scientific notation for small values, fixed otherwise.
function formatGain(n, fractionDigits = 3) {
  if (n == null || !Number.isFinite(n)) return '—'
  if (n === 0) return '0'
  return Math.abs(n) < 0.01 ? n.toExponential(2) : n.toFixed(fractionDigits)
}

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
function HistoryTable({ rows, archiveUrl }) {
  return (
    <section className="section history-section">
      <div className="section-header">
        <h2>Parameter History</h2>
        <span className="section-tag">Session ledger</span>
        {archiveUrl && (
          <a href={archiveUrl} target="_blank" rel="noopener noreferrer" className="section-tag audit-tag">
            📦 Filecoin
          </a>
        )}
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
              <th>Audit</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={6} className="table-empty">
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
                      {r.txHash?.slice(0, 8)}… ↗
                    </a>
                  </td>
                  <td>
                    {i === rows.length - 1 && archiveUrl ? (
                      <a href={archiveUrl} target="_blank" rel="noopener noreferrer" className="tx-link">
                        🔗 ↗
                      </a>
                    ) : "—"}
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
  const [archiveUrl, setArchiveUrl] = useState(null)
  const [loading, setLoading] = useState({})
  const [decision, setDecision] = useState(null)
  const [tweetText, setTweetText] = useState("")
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
          kpChange: `${formatGain(state?.kp, 2)} → ${formatGain(d.new_kp, 2)}`,
          ki: `${formatGain(d.new_ki ?? state?.ki, 4)}`,
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
    es.addEventListener('archive', (e) => {
      const a = JSON.parse(e.data)
      if (a?.url) {
        setArchiveUrl(a.url)
        addLog({ ts: new Date().toISOString(), kind: 'info', msg: `Archived to Filecoin: ${a.url}` })
      }
    })
    es.onerror = () => addLog({ ts: new Date().toISOString(), kind: 'error', msg: 'SSE connection lost — reconnecting...' })
    return () => es.close()
  }, [addLog])

  // Initial state
  useEffect(() => {
    fetch(`${API}/state`).then(r => r.json()).then(setState).catch(() => {})
  }, [])

  // Load persisted history on mount
  useEffect(() => {
    fetch(`${API}/history`)
      .then(r => r.json())
      .then(data => {
        if (data.rows?.length) {
          const formatted = data.rows.map((r) => ({
            time: new Date(r.timestamp).toLocaleTimeString(),
            action: `Governor: ${r.action}`,
            kpChange: `${formatGain(Number(r.current_kp) / 1e18, 2)}`,
            ki: `${formatGain(Number(r.current_ki) / 1e18, 4)}`,
            txHash: r.tx_hash || '—',
          }))
          setHistory(formatted)
        }
        if (data.archiveUrl) {
          setArchiveUrl(data.archiveUrl)
        }
      })
      .catch(() => {})
  }, [])

  // Refresh history after demo completes
  const refreshHistory = useCallback(() => {
    fetch(`${API}/history`)
      .then(r => r.json())
      .then(data => {
        if (data.rows?.length) {
          const formatted = data.rows.map((r) => ({
            time: new Date(r.timestamp).toLocaleTimeString(),
            action: `Governor: ${r.action}`,
            kpChange: `${formatGain(Number(r.current_kp) / 1e18, 2)}`,
            ki: `${formatGain(Number(r.current_ki) / 1e18, 4)}`,
            txHash: r.tx_hash || '—',
          }))
          setHistory(formatted)
        }
        if (data.archiveUrl) {
          setArchiveUrl(data.archiveUrl)
        }
      })
      .catch(() => {})
  }, [])

  // Refresh history when archive is created
  useEffect(() => {
    if (archiveUrl) {
      refreshHistory()
    }
  }, [archiveUrl, refreshHistory])

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

        {/* ── COLUMNA IZQUIERDA: Protocol State / Metrics ── */}
        <section className="section content-left">
          <div className="metrics-grid">
            <MetricCard
              label="BTC Price" sublabel="Oracle"
              value={state ? `$${state.collateralPrice.toLocaleString(undefined, { maximumFractionDigits: 0 })}` : '—'}
            />
            <MetricCard
              label="GRIT Price" sublabel="Market"
              value={state ? `$${state.marketPrice.toFixed(3)}` : '—'}
            />
            <MetricCard
              label="Redemption Price" sublabel="target peg"
              value={state ? `$${state.redemptionPrice.toFixed(4)}` : '—'}
            />
            <MetricCard
              label="Deviation" sublabel="from peg"
              value={state ? `${state.deviationPct >= 0 ? '+' : ''}${state.deviationPct.toFixed(2)}%` : '—'}
              tone={devTone}
            />
            <MetricCard
              label="KP" sublabel="Proportional"
              value={state ? formatGain(state.kp, 3) : '—'}
            />
            <MetricCard
              label="KI" sublabel="Integral"
              value={state ? formatGain(state.ki, 6) : '—'}
            />
            <MetricCard
              label="Redemption Rate" sublabel="annualized"
              value={state ? (() => {
                const rps = state.redemptionRate;
                if (!rps || rps <= 0) return '+0.00%';
                const annualRate = Math.exp(Math.log(rps) * 31536000) - 1;
                const pct = annualRate * 100;
                const sign = pct >= 0 ? '+' : '';
                return `${sign}${pct.toFixed(2)}%`;
              })() : '—'}
              trend={
                state?.rateDirection === 'up' ? <span className="tone-success">▲</span>
                : state?.rateDirection === 'down' ? <span className="tone-danger">▼</span>
                : null
              }
            />
          </div>
        </section>

        {/* ── COLUMNA CENTRO: Agent Reasoning ── */}
        <div className="content-center">
          {/* Agent Reasoning */}
          <section className="section">
            <div className="marble-card log-card">
              <div className="log-titlebar">
                <div className="titlebar-dots">
                  <span className="dot dot-red" />
                  <span className="dot dot-yellow" />
                  <span className="dot dot-green" />
                </div>
                <span className="titlebar-text mono">Agent Reasoning | Live deliberation | On Chain</span>
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
        </div>

        {/* ── COLUMNA DERECHA: Market Simulation ── */}
        <section className="section content-right">
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
                onClick={() => apiCall('/cheat/crash', { percent: 5 }, 'crash5')}
                disabled={loading.crash5}
              >
                {loading.crash5 ? '⏳' : '📉'} Crash BTC −5%
              </button>
              <button
                className="sim-btn sim-crash"
                onClick={() => apiCall('/cheat/crash', { percent: 10 }, 'crash10')}
                disabled={loading.crash10}
              >
                {loading.crash10 ? '⏳' : '📉'} Crash BTC −10%
              </button>
              <button
                className="sim-btn sim-pump"
                onClick={() => apiCall('/cheat/pump', { percent: 5 }, 'pump5')}
                disabled={loading.pump5}
              >
                {loading.pump5 ? '⏳' : '📈'} Pump BTC +5%
              </button>
              <button
                className="sim-btn sim-pump"
                onClick={() => apiCall('/cheat/pump', { percent: 10 }, 'pump10')}
                disabled={loading.pump10}
              >
                {loading.pump10 ? '⏳' : '📈'} Pump BTC +10%
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

            <div className="sim-divider" />

            <button
              className="sim-btn sim-demo"
              onClick={() => apiCall('/demo/crash', { percent: 10 }, 'demo')}
              disabled={loading.demo}
            >
              {loading.demo ? '⚡ Running...' : '⚡ Full Demo'}
            </button>
          </div>
        </section>

        {/* ── Latest Decision (siempre visible, se actualiza con Full Demo) ── */}
        <section className="section history-section">
          <div className="section-header">
            <h2>Latest Decision</h2>
            <span className="section-tag">Agent verdict</span>
          </div>
          <div className="marble-card decision-card">
            {decision ? (
              <>
                <span className={`decision-badge decision-${decision.action}`}>
                  {decision.action?.toUpperCase()}
                </span>
                <p className="agent-quote">"{decision.reasoning}"</p>
                {decision.new_kp != null && (
                  <p className="decision-params mono">
                    KP: {formatGain(state?.kp, 3)} → {formatGain(decision.new_kp, 3)} &nbsp;|&nbsp;
                    KI: {formatGain(state?.ki, 6)} → {formatGain(decision.new_ki, 6)}
                  </p>
                )}
                {decision && (
                  <button
                    className="sim-btn sim-tweet"
                    onClick={() => {
                      const text = `🤖 I just tested Grinta's AI Governance system at @grintaprotocol — ${decision.action?.toUpperCase()}: ${decision.reasoning?.slice(0, 200)}...`
                      const url = `https://x.com/grintaprotocol/status/2047602458969419979?s=20`
                      setTweetText(text)
                      window.open(`${url}&text=${encodeURIComponent(text)}`, '_blank')
                    }}
                  >
                    🐦 Share on X
                  </button>
                )}
              </>
            ) : (
              <p className="agent-quote waiting">Waiting for Full Demo execution...</p>
            )}
          </div>
        </section>

        {/* ── Parameter History ── */}
        <HistoryTable rows={history} archiveUrl={archiveUrl} />

        {/* ── Footer ── */}
        <footer className="gov-footer">
          "The unexamined protocol is not worth governing." — The Governor
        </footer>
      </main>
    </div>
  )
}