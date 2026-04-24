/**
 * Mock Grinta Metrics Hook - Simulates BTC crash scenario
 * 
 * Creates 60-minute rolling window with:
 * - BTC stable at $72k, then crashes -20% between t=13min and t=37min
 * - GRIT follows BTC with some lag
 * - KP adapts dynamically during crash
 * - Redemption rate strengthens with agent
 */

import { useState, useEffect, useCallback } from 'react';
import type { GrintaMetrics } from '../types';

// Constants
const GRIT_BASELINE = 1.0;
const BTC_BASELINE = 72000;
const KP_BASELINE = 1e-6;
const KI_BASELINE = 1e-12;
const DURATION_MS = 60 * 60 * 1000; // 60 minutes
const UPDATE_INTERVAL = 5000; // 5 seconds
const CRASH_START = 13 * 60 * 1000; // t=13min
const CRASH_END = 37 * 60 * 1000; // t=37min

// Generate mock data
function generateMockData(): GrintaMetrics[] {
  const now = Date.now();
  const data: GrintaMetrics[] = [];
  
  let btcPrice = BTC_BASELINE;
  let gritPrice = GRIT_BASELINE;
  let kp = KP_BASELINE;
  let ki = KI_BASELINE;
  let pTerm = 0;
  let iTerm = 0;
  let dTerm = 0;
  let redemptionRate = 1.0;
  let redemptionRateBaseline = 1.0;
  
  for (let t = DURATION_MS; t >= 0; t -= UPDATE_INTERVAL) {
    const timestamp = now - t;
    const elapsed = DURATION_MS - t;
    
    // BTC crash phase
    if (elapsed >= CRASH_START && elapsed <= CRASH_END) {
      // Linear crash: -20% over 24 minutes
      const crashProgress = (elapsed - CRASH_START) / (CRASH_END - CRASH_START);
      btcPrice = BTC_BASELINE * (1 - 0.2 * crashProgress);
    } else if (elapsed > CRASH_END) {
      // Recovery: gradual price stabilization
      const recoveryProgress = (elapsed - CRASH_END) / (10 * 60 * 1000);
      btcPrice = BTC_BASELINE * (0.8 + 0.2 * Math.min(1, recoveryProgress * 0.5));
    }
    
    // GRIT follows BTC with lag and amplification
    const gritDeviation = ((btcPrice / BTC_BASELINE) - 1) * 0.8;
    gritPrice = GRIT_BASELINE + gritDeviation;
    
    // KP adapts during crash
    if (elapsed >= CRASH_START && elapsed <= CRASH_END) {
      // Agent raises KP during crash
      const crashProgress = (elapsed - CRASH_START) / (CRASH_END - CRASH_START);
      kp = KP_BASELINE * (1 + 1.5 * crashProgress); // up to 2.5x baseline
    } else if (elapsed > CRASH_END && elapsed < CRASH_END + 10 * 60 * 1000) {
      // Agent reduces KP during recovery
      const recoveryProgress = (elapsed - CRASH_END) / (10 * 60 * 1000);
      kp = KP_BASELINE * (2.5 - 1.5 * Math.min(1, recoveryProgress));
    } else {
      kp = KP_BASELINE;
    }
    
    // KI slightly increases during crash (more aggressive integral)
    ki = elapsed >= CRASH_START && elapsed <= CRASH_END + 5 * 60 * 1000
      ? KI_BASELINE * 1.2
      : KI_BASELINE;
    
    // Calculate PID terms
    const deviation = (gritPrice - GRIT_BASELINE) / GRIT_BASELINE * 100;
    pTerm = deviation * kp / KP_BASELINE * 0.1;
    iTerm = deviation * ki / KI_BASELINE * 0.05;
    dTerm = -0.01 * (btcPrice - BTC_BASELINE) / BTC_BASELINE;
    
    // Redemption rate responds to deviation
    const rateDeviation = Math.max(0, Math.abs(deviation) - 0.5);
    redemptionRate = 1.0 + (rateDeviation * kp / KP_BASELINE * 0.15);
    redemptionRateBaseline = 1.0 + (rateDeviation * 0.1);
    
    // Agent decision
    let agentDecision: 'hold' | 'adjust' | 'adjust_emergency' = 'hold';
    if (Math.abs(deviation) > 2) {
      agentDecision = 'adjust_emergency';
    } else if (Math.abs(deviation) > 0.5 || Math.abs(btcPrice - BTC_BASELINE) / BTC_BASELINE > 0.1) {
      agentDecision = 'adjust';
    }
    
    data.push({
      timestamp,
      gritPrice,
      btcPrice,
      kp,
      kpBaseline: KP_BASELINE,
      ki,
      redemptionRate,
      redemptionRateBaseline,
      deviation,
      agentDecision,
      pTerm,
      iTerm,
      dTerm,
    });
  }
  
  return data;
}

export function useGrintaMetrics(): () => GrintaMetrics[] {
  const [getMetrics, setGetMetrics] = useState<() => GrintaMetrics[]>(() => generateMockData);
  
  const refreshData = useCallback(() => {
    setGetMetrics(() => generateMockData());
  }, []);
  
  return getMetrics;
}

// Export the full hook with mock data
export function useMockGrintaMetrics() {
  const [metrics, setMetrics] = useState<GrintaMetrics[]>([]);
  
  useEffect(() => {
    // Initial load
    setMetrics(generateMockData());
    
    // Auto-refresh every 5 seconds
    const interval = setInterval(() => {
      setMetrics(generateMockData());
    }, UPDATE_INTERVAL);
    
    return () => clearInterval(interval);
  }, []);
  
  return metrics;
}

export { DURATION_MS, UPDATE_INTERVAL };