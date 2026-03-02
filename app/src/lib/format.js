const WAD = 10n ** 18n
const RAY = 10n ** 27n
const BTC_DECIMALS = 8n
const BTC_TO_WAD = 10n ** (18n - BTC_DECIMALS) // 10^10

export function formatWad(value) {
  if (value == null) return '—'
  const big = BigInt(value)
  const whole = big / WAD
  const frac = big % WAD
  const fracStr = frac.toString().padStart(18, '0').slice(0, 2)
  return `${whole.toLocaleString()}.${fracStr}`
}

export function formatRay(value) {
  if (value == null) return '—'
  const big = BigInt(value)
  const whole = big / RAY
  const frac = big % RAY
  const fracStr = frac.toString().padStart(27, '0').slice(0, 6)
  return `${whole}.${fracStr}`
}

export function formatPercent(ratio) {
  if (ratio == null) return '—'
  const big = BigInt(ratio)
  const pct = (big * 10000n) / WAD
  const whole = pct / 100n
  const frac = pct % 100n
  return `${whole}.${frac.toString().padStart(2, '0')}%`
}

export function formatUsd(wad) {
  if (wad == null) return '—'
  const big = BigInt(wad)
  const whole = big / WAD
  const frac = big % WAD
  const fracStr = frac.toString().padStart(18, '0').slice(0, 2)
  return `$${whole.toLocaleString()}.${fracStr}`
}

// Format a RAY value as USD (27 decimals → "$1.00")
export function formatRayUsd(ray) {
  if (ray == null) return '—'
  const big = BigInt(ray)
  const whole = big / RAY
  const frac = big % RAY
  const fracStr = frac.toString().padStart(27, '0').slice(0, 2)
  return `$${whole.toLocaleString()}.${fracStr}`
}

// Format redemption rate: RAY where 1e27 = 0%, show deviation per second
export function formatRedemptionRate(rate) {
  if (rate == null) return '—'
  const big = BigInt(rate)
  if (big === RAY) return '0%/s'
  if (big > RAY) {
    const diff = ((big - RAY) * 10000000000n) / RAY  // 10 decimal places of precision
    const pct = Number(diff) / 100000000  // to percentage
    return `+${pct.toFixed(8)}%/s`
  } else {
    const diff = ((RAY - big) * 10000000000n) / RAY
    const pct = Number(diff) / 100000000
    return `-${pct.toFixed(8)}%/s`
  }
}

export function formatBtc(wad) {
  if (wad == null) return '—'
  const big = BigInt(wad)
  const whole = big / WAD
  const frac = big % WAD
  const fracStr = frac.toString().padStart(18, '0').slice(0, 8)
  return `${whole}.${fracStr}`
}

// Parse user input "0.5" BTC → bigint in native 8 decimals
// Used for approve + deposit/open_and_borrow (CollateralJoin expects native decimals)
export function parseBtcInput(str) {
  if (!str || str === '') return 0n
  const [whole = '0', frac = ''] = str.split('.')
  const paddedFrac = frac.padEnd(8, '0').slice(0, 8)
  return BigInt(whole) * 10n ** BTC_DECIMALS + BigInt(paddedFrac)
}

// Parse user input "0.5" BTC → bigint in WAD (18 decimals)
// Used for withdraw (SAFEEngine stores collateral in WAD)
export function parseBtcInputWad(str) {
  if (!str || str === '') return 0n
  const [whole = '0', frac = ''] = str.split('.')
  const paddedFrac = frac.padEnd(8, '0').slice(0, 8)
  const btcUnits = BigInt(whole) * 10n ** BTC_DECIMALS + BigInt(paddedFrac)
  return btcUnits * BTC_TO_WAD
}

// Parse user input "100.5" GRIT → bigint in WAD (18 decimals)
export function parseGritInput(str) {
  if (!str || str === '') return 0n
  const [whole = '0', frac = ''] = str.split('.')
  const paddedFrac = frac.padEnd(18, '0').slice(0, 18)
  return BigInt(whole) * WAD + BigInt(paddedFrac)
}

// Health status based on LTV
export function getHealthColor(ltv) {
  if (ltv == null) return '#666'
  const big = BigInt(ltv)
  const pct = (big * 100n) / WAD
  if (pct < 50n) return '#00d4aa' // healthy
  if (pct < 70n) return '#f0c000' // warning
  return '#ff4444' // danger
}

export function getHealthLabel(ltv) {
  if (ltv == null) return 'Unknown'
  const big = BigInt(ltv)
  const pct = (big * 100n) / WAD
  if (pct < 50n) return 'Healthy'
  if (pct < 70n) return 'Warning'
  return 'Danger'
}
