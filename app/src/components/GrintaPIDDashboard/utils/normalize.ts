/**
 * WAD normalization helpers for Grinta PID Dashboard
 */

const WAD = 1e18;

/**
 * Normalize KP/KI from WAD to human-readable ratio
 * Divides by baseline and clamps to reasonable display range
 */
export function normalizeKP(kp: number, baseline: number = 1e-6): number {
  if (!kp || !baseline) return 1;
  const normalized = kp / baseline;
  // Clamp for chart display: show as ratio to baseline (1.0 = baseline)
  return Math.min(5, Math.max(0.1, normalized));
}

/**
 * Normalize KI similarly
 */
export function normalizeKI(ki: number, baseline: number = 1e-12): number {
  if (!ki || !baseline) return 1;
  const normalized = ki / baseline;
  return Math.min(5, Math.max(0.1, normalized));
}

/**
 * Format raw WAD value for display
 */
export function formatWad(value: number): string {
  if (value === 0) return '0';
  const human = value / WAD;
  if (Math.abs(human) < 0.01) {
    return human.toExponential(2);
  }
  return human.toFixed(4);
}

/**
 * Format percentage for display
 */
export function formatPercent(value: number): string {
  return `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`;
}

/**
 * Format price for display
 */
export function formatPrice(value: number, decimals: number = 4): string {
  return value.toFixed(decimals);
}