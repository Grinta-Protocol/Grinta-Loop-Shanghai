/**
 * Market Shock Panel - Shows GRIT Price, BTC Price, and Peg
 */

import React from 'react';
import {
  ComposedChart,
  Line,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
  ReferenceArea,
} from 'recharts';
import { formatPrice, formatPercent } from '../utils/normalize';

interface MarketShockPanelProps {
  data: any[];
  crashZone?: { start: number; end: number };
}

const COLORS = {
  grit: '#c084fc',
  btc: '#f97316',
  peg: '#22c55e',
  grid: '#1f2937',
  text: '#e5e7eb',
  crashFill: 'rgba(239, 68, 68, 0.08)',
};

export function MarketShockPanel({ data, crashZone }: MarketShockPanelProps) {
  return (
    <div className="market-shock-panel">
      <div className="panel-title">Market Shock: BTC -20% Crash Scenario</div>
      <ResponsiveContainer width="100%" height={200}>
        <ComposedChart data={data} syncId="grinta-dashboard">
          <CartesianGrid strokeDasharray="3 3" stroke={COLORS.grid} />
          
          <XAxis 
            dataKey="time" 
            tick={{ fill: COLORS.text, fontSize: 10 }} 
            tickFormatter={(v) => `${v}m`}
            axisLine={{ stroke: COLORS.grid }}
          />
          
          <YAxis 
            yAxisId="grit"
            orientation="left"
            tick={{ fill: COLORS.grit, fontSize: 10 }}
            domain={[0.85, 1.05]}
            tickFormatter={(v) => `$${v.toFixed(2)}`}
            axisLine={{ stroke: COLORS.grid }}
          />
          
          <YAxis 
            yAxisId="btc"
            orientation="right"
            tick={{ fill: COLORS.btc, fontSize: 10 }}
            domain={[50000, 80000]}
            tickFormatter={(v) => `$${(v/1000).toFixed(0)}k`}
            axisLine={{ stroke: COLORS.grid }}
          />
          
          <Tooltip
            contentStyle={{ 
              background: '#111827', 
              border: '1px solid #1f2937',
              borderRadius: 8,
              fontSize: 11,
            }}
            labelStyle={{ color: COLORS.text }}
            formatter={(value: number, name: string) => {
              if (name === 'gritPrice') return [`$${formatPrice(value)}`, 'GRIT Price'];
              if (name === 'btcPrice') return [`$${formatPrice(value, 0)}`, 'BTC Price'];
              return [value, name];
            }}
            labelFormatter={(label) => `t=${label}min`}
          />
          
          {/* Crash zone highlight */}
          {crashZone && (
            <ReferenceArea
              x1={crashZone.start}
              x2={crashZone.end}
              strokeOpacity={0}
              fill={COLORS.crashFill}
              fillOpacity={1}
            />
          )}
          
          {/* $1.00 Peg Line */}
          <ReferenceLine
            yAxisId="grit"
            y={1}
            stroke={COLORS.peg}
            strokeDasharray="5 5"
            label={{ 
              value: '$1.00 Peg', 
              fill: COLORS.peg, 
              fontSize: 10,
              position: 'insideTopRight'
            }}
          />
          
          {/* GRIT Price */}
          <Area
            yAxisId="grit"
            type="monotone"
            dataKey="gritPrice"
            stroke={COLORS.grit}
            fill={COLORS.grit}
            fillOpacity={0.15}
            strokeWidth={2}
            name="gritPrice"
          />
          
          {/* BTC Price */}
          <Line
            yAxisId="btc"
            type="monotone"
            dataKey="btcPrice"
            stroke={COLORS.btc}
            strokeWidth={2}
            dot={false}
            name="btcPrice"
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

export default MarketShockPanel;