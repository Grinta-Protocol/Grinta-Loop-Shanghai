import { useState } from 'react'
import { useAccount, useSendTransaction } from '@starknet-react/core'
import { ADDRESSES } from '../lib/contracts.js'
import { parseBtcInput, parseBtcInputWad, parseGritInput, formatWad } from '../lib/format.js'
import { useMaxBorrow } from '../hooks/useGrinta.js'
import './SafeActions.css'

const TABS = ['deposit', 'withdraw', 'borrow', 'repay']

export default function SafeActions({ selectedSafe, onSuccess }) {
  const [tab, setTab] = useState('deposit')
  const [amount, setAmount] = useState('')
  const { address } = useAccount()
  const { sendAsync, isPending } = useSendTransaction({})
  const { maxBorrow } = useMaxBorrow(selectedSafe)

  const isBtcTab = tab === 'deposit' || tab === 'withdraw'
  const placeholder = isBtcTab ? '0.001' : '100.0'
  const unit = isBtcTab ? 'WBTC' : 'GRIT'

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!amount || !address || isPending) return

    try {
      let calls = []

      if (tab === 'deposit') {
        // deposit expects native 8-decimal WBTC amount
        const parsed = parseBtcInput(amount)
        if (parsed <= 0n) return
        calls = [
          {
            contractAddress: ADDRESSES.wbtc,
            entrypoint: 'approve',
            calldata: [ADDRESSES.collateralJoin, `0x${parsed.toString(16)}`, '0x0'],
          },
          {
            contractAddress: ADDRESSES.safeManager,
            entrypoint: 'deposit',
            calldata: [selectedSafe.toString(), `0x${parsed.toString(16)}`, '0x0'],
          },
        ]
      } else if (tab === 'withdraw') {
        // withdraw expects WAD (18 decimals) — internal representation
        const parsed = parseBtcInputWad(amount)
        if (parsed <= 0n) return
        calls = [
          {
            contractAddress: ADDRESSES.safeManager,
            entrypoint: 'withdraw',
            calldata: [selectedSafe.toString(), `0x${parsed.toString(16)}`, '0x0'],
          },
        ]
      } else if (tab === 'borrow') {
        const parsed = parseGritInput(amount)
        if (parsed <= 0n) return
        calls = [
          {
            contractAddress: ADDRESSES.safeManager,
            entrypoint: 'borrow',
            calldata: [selectedSafe.toString(), `0x${parsed.toString(16)}`, '0x0'],
          },
        ]
      } else if (tab === 'repay') {
        const parsed = parseGritInput(amount)
        if (parsed <= 0n) return
        calls = [
          {
            contractAddress: ADDRESSES.safeEngine,
            entrypoint: 'approve',
            calldata: [ADDRESSES.safeManager, `0x${parsed.toString(16)}`, '0x0'],
          },
          {
            contractAddress: ADDRESSES.safeManager,
            entrypoint: 'repay',
            calldata: [selectedSafe.toString(), `0x${parsed.toString(16)}`, '0x0'],
          },
        ]
      }

      await sendAsync(calls)
      setAmount('')
      onSuccess?.()
    } catch (err) {
      console.error(`${tab} failed:`, err)
    }
  }

  if (selectedSafe == null) {
    return (
      <div className="safe-actions">
        <div className="safe-actions-empty">
          Select a SAFE to manage, or open a new one
        </div>
      </div>
    )
  }

  return (
    <div className="safe-actions">
      <div className="safe-actions-header">
        <h3>SAFE #{selectedSafe}</h3>
      </div>

      <div className="tab-bar">
        {TABS.map((t) => (
          <button
            key={t}
            className={`tab ${tab === t ? 'active' : ''}`}
            onClick={() => { setTab(t); setAmount('') }}
          >
            {t.charAt(0).toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>

      <form className="action-form" onSubmit={handleSubmit}>
        <div className="input-group">
          <input
            type="text"
            inputMode="decimal"
            placeholder={placeholder}
            value={amount}
            onChange={(e) => {
              const v = e.target.value
              if (/^\d*\.?\d*$/.test(v)) setAmount(v)
            }}
          />
          <span className="input-unit">{unit}</span>
        </div>

        {tab === 'borrow' && maxBorrow != null && (
          <div className="action-info">
            Max borrow: {formatWad(maxBorrow)} GRIT
          </div>
        )}

        <button
          type="submit"
          className="btn-action"
          disabled={!amount || isPending}
        >
          {isPending ? 'Confirming...' : `${tab.charAt(0).toUpperCase() + tab.slice(1)} ${unit}`}
        </button>
      </form>
    </div>
  )
}

// Separate component for "Open & Borrow" flow
export function OpenSafeForm({ onSuccess }) {
  const [collateral, setCollateral] = useState('')
  const [debt, setDebt] = useState('')
  const { address } = useAccount()
  const { sendAsync, isPending } = useSendTransaction({})

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!collateral || !address || isPending) return

    const collateralParsed = parseBtcInput(collateral)
    const debtParsed = debt ? parseGritInput(debt) : 0n
    if (collateralParsed <= 0n) return

    console.log('[Grinta] open_and_borrow:', {
      collateral_raw: collateral,
      collateral_parsed: collateralParsed.toString(),
      collateral_hex: `0x${collateralParsed.toString(16)}`,
      debt_parsed: debtParsed.toString(),
    })

    try {
      const calls = [
        {
          contractAddress: ADDRESSES.wbtc,
          entrypoint: 'approve',
          calldata: [ADDRESSES.collateralJoin, `0x${collateralParsed.toString(16)}`, '0x0'],
        },
        {
          contractAddress: ADDRESSES.safeManager,
          entrypoint: 'open_and_borrow',
          calldata: [
            `0x${collateralParsed.toString(16)}`, '0x0',
            `0x${debtParsed.toString(16)}`, '0x0',
          ],
        },
      ]

      await sendAsync(calls)
      setCollateral('')
      setDebt('')
      onSuccess?.()
    } catch (err) {
      console.error('open_and_borrow failed:', err)
    }
  }

  return (
    <div className="safe-actions">
      <div className="safe-actions-header">
        <h3>Open New SAFE</h3>
      </div>
      <form className="action-form" onSubmit={handleSubmit}>
        <div className="input-group">
          <input
            type="text"
            inputMode="decimal"
            placeholder="0.001"
            value={collateral}
            onChange={(e) => {
              if (/^\d*\.?\d*$/.test(e.target.value)) setCollateral(e.target.value)
            }}
          />
          <span className="input-unit">WBTC</span>
        </div>
        <div className="input-group">
          <input
            type="text"
            inputMode="decimal"
            placeholder="0 (optional)"
            value={debt}
            onChange={(e) => {
              if (/^\d*\.?\d*$/.test(e.target.value)) setDebt(e.target.value)
            }}
          />
          <span className="input-unit">GRIT</span>
        </div>
        <button
          type="submit"
          className="btn-action"
          disabled={!collateral || isPending}
        >
          {isPending ? 'Confirming...' : 'Open SAFE & Deposit'}
        </button>
      </form>
    </div>
  )
}
