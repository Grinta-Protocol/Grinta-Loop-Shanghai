import { formatWad, formatBtc, formatPercent, getHealthColor, getHealthLabel } from '../lib/format.js'

export default function SafeList({ safes, isLoading, selectedSafe, onSelect, onOpenNew }) {
  return (
    <div className="safe-list">
      <div className="safe-list-header">
        <h3>Your SAFEs</h3>
        <button className="btn-open-safe" onClick={onOpenNew}>
          + New SAFE
        </button>
      </div>

      {isLoading && <div className="safe-list-empty">Loading SAFEs...</div>}

      {!isLoading && safes.length === 0 && (
        <div className="safe-list-empty">
          <p>No SAFEs found</p>
          <p className="safe-list-hint">Open a new SAFE to deposit WBTC and borrow GRIT</p>
        </div>
      )}

      {safes.map((safe) => (
        <button
          key={safe.id}
          className={`safe-card ${selectedSafe === safe.id ? 'selected' : ''}`}
          onClick={() => onSelect(safe.id)}
        >
          <div className="safe-card-header">
            <span className="safe-id">SAFE #{safe.id}</span>
            <span
              className="safe-health-badge"
              style={{ color: getHealthColor(safe.ltv) }}
            >
              {getHealthLabel(safe.ltv)}
            </span>
          </div>
          <div className="safe-card-row">
            <span className="safe-card-label">Collateral</span>
            <span>{formatBtc(safe.collateral)} WBTC</span>
          </div>
          <div className="safe-card-row">
            <span className="safe-card-label">Debt</span>
            <span>{formatWad(safe.debt)} GRIT</span>
          </div>
          <div className="safe-card-row">
            <span className="safe-card-label">LTV</span>
            <span style={{ color: getHealthColor(safe.ltv) }}>
              {formatPercent(safe.ltv)}
            </span>
          </div>
        </button>
      ))}
    </div>
  )
}
