import { useState } from 'react'
import { useSystemRates } from '../hooks/useGrinta.js'
import { formatUsd, formatRayUsd, formatRedemptionRate, formatPercent } from '../lib/format.js'
import { ADDRESSES } from '../lib/contracts.js'

const GRIT_ADDRESS = ADDRESSES.safeEngine

function CopyableAddress({ address }) {
  const [copied, setCopied] = useState(false)
  const short = `${address.slice(0, 6)}...${address.slice(-4)}`

  const handleCopy = async () => {
    await navigator.clipboard.writeText(address)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <span
      className="stat-value copyable-address"
      onClick={handleCopy}
      title={`Click to copy: ${address}`}
      style={{ cursor: 'pointer' }}
    >
      {copied ? 'Copied!' : short}
    </span>
  )
}

export default function SystemStats() {
  const { redemptionPrice, redemptionRate, collateralPrice, liquidationRatio, isLoading, errors } = useSystemRates()

  if (errors && errors.length > 0) {
    return (
      <div className="stats-bar">
        <div className="stats-bar-inner">
          <div className="stat-item" style={{ color: '#ff4444' }}>
            RPC Error: {errors[0]?.message?.slice(0, 80) || 'Failed to load'}
          </div>
        </div>
      </div>
    )
  }

  if (isLoading) {
    return (
      <div className="stats-bar">
        <div className="stats-bar-inner">
          <div className="stat-item">Loading protocol data...</div>
        </div>
      </div>
    )
  }

  return (
    <div className="stats-bar">
      <div className="stats-bar-inner">
        <div className="stat-item">
          <span className="stat-label">Redemption Price</span>
          <span className="stat-value">{formatRayUsd(redemptionPrice)}</span>
        </div>
        <div className="stat-item">
          <span className="stat-label">Redemption Rate</span>
          <span className="stat-value">{formatRedemptionRate(redemptionRate)}</span>
        </div>
        <div className="stat-item">
          <span className="stat-label">BTC Price</span>
          <span className="stat-value">{formatUsd(collateralPrice)}</span>
        </div>
        <div className="stat-item">
          <span className="stat-label">Liquidation Ratio</span>
          <span className="stat-value">{formatPercent(liquidationRatio)}</span>
        </div>
        <div className="stat-item">
          <span className="stat-label">GRIT Token</span>
          <CopyableAddress address={GRIT_ADDRESS} />
        </div>
      </div>
    </div>
  )
}
