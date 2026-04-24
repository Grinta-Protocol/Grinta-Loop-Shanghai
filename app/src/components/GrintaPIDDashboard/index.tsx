/**
 * Grinta PID Dashboard - Charts Only (no sidebar)
 * 
 * Visualizes the GRINTA stablecoin PID controller behavior.
 * No sidebar - only the 3 charts.
 */

import React, { useMemo } from 'react';
import { Brush, ResponsiveContainer } from 'recharts';
import {
  ComposedChart,
  Line,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
} from 'recharts';
import './dashboard.css';

interface DashboardProps {
  state?: any;
  history?: any[];
  height?: number;
}

const COLORS = {
  grit: '#c084fc',
  btc: '#f97316',
  peg: '#22c55e',
  agent: '#60a5fa',
  baseline: '#6b7280',
  grid: '#1f2937',
  text: '#e5e7eb',
};

export function GrintaPIDDashboard({ state, history = [], height = 400 }: DashboardProps) {
  // Transform history to chart data
  const chartData = useMemo(() => {
    const demoData = [];
    const baseBtc = state?.collateralPrice || 60000;
    const baseGrit = state?.marketPrice || 1.0;
    
    for (let i = 0; i < 60; i++) {
      const t = 60 - i;
      let btcPrice = baseBtc;
      let gritPrice = baseGrit;
      let kpNorm = 1.0;
      let deviation = state?.deviationPct || 0;
      
      // Simulate crash at t=13-37
      if (t <= 37 && t >= 13) {
        const crashProgress = (37 - t) / 24;
        btcPrice = baseBtc * (1 - 0.2 * crashProgress);
        gritPrice = baseGrit * (1 - 0.15 * crashProgress);
        kpNorm = 1 + 1.5 * crashProgress;
        deviation = deviation - (5 * crashProgress);
      } else if (t < 13) {
        const recoverProgress = (13 - t) / 10;
        btcPrice = baseBtc * (0.8 + 0.2 * recoverProgress * 0.3);
        gritPrice = baseGrit * (0.85 + 0.15 * recoverProgress * 0.3);
        kpNorm = 2.5 - 1.5 * recoverProgress;
        deviation = deviation + 5 * recoverProgress * 0.3;
      }
      
      demoData.push({
        time: t,
        btcPrice,
        gritPrice,
        kpNormalized: kpNorm,
        kpBaseline: 1.0,
        rate: 1.0 + (Math.max(0, deviation) * kpNorm * 0.01),
        rateBaseline: 1.0 + (Math.max(0, deviation) * 0.01),
        rateDiff: Math.abs(deviation) * 0.005,
        deviation,
      });
    }
    return demoData;
  }, [state, history]);

  return (
    <div className="grinta-dashboard-charts" style={{ minHeight: height }}>
      {/* Market Shock Panel */}
      <div className="chart-panel">
        <div className="panel-title">Market Shock: BTC Crash Scenario</div>
        <ResponsiveContainer width="100%" height={140}>
          <ComposedChart data={chartData} syncId="grinta">
            <CartesianGrid strokeDasharray="3 3" stroke={COLORS.grid} />
            <XAxis dataKey="time" tick={{ fill: COLORS.text, fontSize: 9 }} tickFormatter={(v) => `${v}m`} />
            <YAxis yAxisId="grit" orientation="left" domain={[0.9, 1.05]} tick={{ fill: COLORS.grit, fontSize: 9 }} tickFormatter={(v) => `$${v.toFixed(2)}`} />
            <YAxis yAxisId="btc" orientation="right" domain={[40000, 70000]} tick={{ fill: COLORS.btc, fontSize: 9 }} tickFormatter={(v) => `$${(v/1000).toFixed(0)}k`} />
            <Tooltip contentStyle={{ background: '#111827', border: '1px solid #1f2937', borderRadius: 6, fontSize: 10 }} labelStyle={{ color: COLORS.text }} formatter={(v: number) => v.toFixed(2)} />
            <ReferenceLine y={1} stroke={COLORS.peg} strokeDasharray="4 4" />
            <Area yAxisId="grit" type="monotone" dataKey="gritPrice" stroke={COLORS.grit} fill={COLORS.grit} fillOpacity={0.15} strokeWidth={2} />
            <Line yAxisId="btc" type="monotone" dataKey="btcPrice" stroke={COLORS.btc} strokeWidth={2} dot={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      {/* KP Panel */}
      <div className="chart-panel">
        <div className="panel-title">Proportional Gain (KP) — Agent Adapts</div>
        <ResponsiveContainer width="100%" height={120}>
          <ComposedChart data={chartData} syncId="grinta">
            <CartesianGrid strokeDasharray="3 3" stroke={COLORS.grid} />
            <XAxis dataKey="time" tick={{ fill: COLORS.text, fontSize: 9 }} tickFormatter={(v) => `${v}m`} />
            <YAxis domain={[0.8, 3]} tick={{ fill: COLORS.text, fontSize: 9 }} tickFormatter={(v) => v.toFixed(1)} />
            <Tooltip contentStyle={{ background: '#111827', border: '1px solid #1f2937', borderRadius: 6, fontSize: 10 }} labelStyle={{ color: COLORS.text }} />
            <Line type="monotone" dataKey="kpBaseline" stroke={COLORS.baseline} strokeDasharray="4 4" strokeWidth={1.5} dot={false} />
            <Line type="monotone" dataKey="kpNormalized" stroke={COLORS.agent} strokeWidth={2} dot={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      {/* Rate Panel */}
      <div className="chart-panel">
        <div className="panel-title">Redemption Rate — Stronger Response</div>
        <ResponsiveContainer width="100%" height={120}>
          <ComposedChart data={chartData} syncId="grinta">
            <CartesianGrid strokeDasharray="3 3" stroke={COLORS.grid} />
            <XAxis dataKey="time" tick={{ fill: COLORS.text, fontSize: 9 }} tickFormatter={(v) => `${v}m`} />
            <YAxis domain={[0.98, 1.1]} tick={{ fill: COLORS.text, fontSize: 9 }} tickFormatter={(v) => v.toFixed(2)} />
            <Tooltip contentStyle={{ background: '#111827', border: '1px solid #1f2937', borderRadius: 6, fontSize: 10 }} labelStyle={{ color: COLORS.text }} />
            <ReferenceLine y={1} stroke={COLORS.baseline} strokeDasharray="4 4" />
            <Area type="monotone" dataKey="rateBaseline" stroke={COLORS.baseline} fill="none" strokeDasharray="4 4" strokeWidth={1.5} />
            <Area type="monotone" dataKey="rate" stroke={COLORS.agent} fill={COLORS.agent} fillOpacity={0.2} strokeWidth={2} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      {/* Brush */}
      <div className="brush-container">
        <Brush data={chartData} x="time" height={25} stroke={COLORS.agent} fill="#111827" tickFormatter={(v) => `${v}m`} />
      </div>
    </div>
  );
}

export default GrintaPIDDashboard;