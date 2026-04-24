/**
 * Grinta PID Dashboard Types
 */

export interface GrintaMetrics {
  timestamp: number;          // Unix ms
  gritPrice: number;          // e.g. 0.9975
  btcPrice: number;           // e.g. 58400
  kp: number;                // current dynamic KP (WAD, e.g. 1.5e-6)
  kpBaseline: number;       // fixed baseline KP (1e-6)
  ki: number;                // current KI (WAD)
  redemptionRate: number;   // current agent redemption rate
  redemptionRateBaseline: number; // baseline rate
  deviation: number;         // peg deviation %
  agentDecision: 'hold' | 'adjust' | 'adjust_emergency';
  pTerm: number;
  iTerm: number;
  dTerm: number;
}

export interface DashboardProps {
  metricsHook?: () => GrintaMetrics[];
  wsUrl?: string;
  height?: number;
}