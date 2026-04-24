/**
 * Metrics Sidebar - Compact Live display
 */

import React from 'react';

interface MetricsSidebarProps {
  current: {
    kp: number;
    kpBaseline: number;
    ki: number;
    kiBaseline: number;
    deviation: number;
    pTerm: number;
    iTerm: number;
    dTerm: number;
    agentDecision: 'hold' | 'adjust' | 'adjust_emergency';
  };
  cooldown?: number;
}

const COLORS = {
  green: '#10b981',
  red: '#ef4444',
  blue: '#60a5fa',
  muted: '#6b7280',
};

const DECISION_COLORS = {
  hold: COLORS.muted,
  adjust: COLORS.blue,
  adjust_emergency: COLORS.red,
};

function formatWad(value: number): string {
  if (!value) return '0';
  const human = value / 1e18;
  if (Math.abs(human) < 0.01) return human.toExponential(2);
  return human.toFixed(4);
}

export function MetricsSidebar({ current, cooldown = 0 }: MetricsSidebarProps) {
  const kpNorm = current.kp / current.kpBaseline;
  const kiNorm = current.ki / current.kiBaseline;
  const kpDelta = ((kpNorm - 1) * 100).toFixed(0);
  
  const kpColor = kpNorm > 1 ? COLORS.red : COLORS.green;
  const devColor = Math.abs(current.deviation) < 0.5 ? COLORS.green : COLORS.red;
  
  return (
    <div className="metrics-sidebar-compact">
      <div className="metric-item">
        <div className="metric-label">KP</div>
        <div className="metric-value" style={{ color: kpColor }}>{kpNorm.toFixed(2)}x</div>
        <div className="metric-detail">{formatWad(current.kp)}</div>
        <div className="metric-delta" style={{ color: kpColor }}>{kpDelta > 0 ? '+' : ''}{kpDelta}%</div>
      </div>
      
      <div className="metric-item">
        <div className="metric-label">Deviation</div>
        <div className="metric-value" style={{ color: devColor }}>
          {current.deviation >= 0 ? '+' : ''}{current.deviation.toFixed(2)}%
        </div>
      </div>
      
      <div className="metric-item">
        <div className="metric-label">PID Terms</div>
        <div className="pid-terms">
          <div><span>P</span><span>{current.pTerm.toFixed(3)}</span></div>
          <div><span>I</span><span>{current.iTerm.toFixed(3)}</span></div>
        </div>
      </div>
      
      <div className="metric-item">
        <div className="metric-label">Decision</div>
        <div className="decision-badge" style={{ background: DECISION_COLORS[current.agentDecision] }}>
          {current.agentDecision.toUpperCase()}
        </div>
      </div>
      
      {cooldown > 0 && (
        <div className="metric-item">
          <div className="metric-label">Cooldown</div>
          <div className="cooldown">{cooldown}s</div>
        </div>
      )}
    </div>
  );
}

export default MetricsSidebar;