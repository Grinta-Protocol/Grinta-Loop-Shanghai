/**
 * Proportional Gain Panel - Shows KP (Agent adapts during crisis)
 */

import React from 'react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
  ReferenceArea,
} from 'recharts';
import { normalizeKP, formatWad } from '../utils/normalize';

interface ProportionalGainPanelProps {
  data: any[];
  crashZone?: { start: number; end: number };
}

const COLORS = {
  agent: '#60a5fa',
  baseline: '#6b7280',
  grid: '#1f2937',
  text: '#e5e7eb',
  crashFill: 'rgba(239, 68, 68, 0.08)',
  annotation: '#fbbf24',
};

export function ProportionalGainPanel({ data, crashZone }: ProportionalGainPanelProps) {
  return (
    <div className="proportional-gain-panel">
      <div className="panel-title">Proportional Gain (KP) — Agent Adapts During Crisis</div>
      <ResponsiveContainer width="100%" height={180}>
        <LineChart data={data} syncId="grinta-dashboard">
          <CartesianGrid strokeDasharray="3 3" stroke={COLORS.grid} />
          
          <XAxis 
            dataKey="time" 
            tick={{ fill: COLORS.text, fontSize: 10 }} 
            tickFormatter={(v) => `${v}m`}
            axisLine={{ stroke: COLORS.grid }}
          />
          
          <YAxis 
            tick={{ fill: COLORS.text, fontSize: 10 }}
            domain={[0.8, 3.0]}
            tickFormatter={(v) => v.toFixed(1)}
            axisLine={{ stroke: COLORS.grid }}
            label={{ 
              value: 'KP', 
              angle: -90, 
              position: 'insideLeft',
              fill: COLORS.text,
              fontSize: 11,
            }}
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
              if (name === 'kpNormalized') {
                return [`${value.toFixed(2)}x (${formatWad(value * 1e-6)})`, 'Agent KP'];
              }
              if (name === 'kpBaseline') {
                return ['1.0x (1e-6 WAD)', 'Baseline KP'];
              }
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
          
          {/* Baseline KP (fixed) */}
          <Line
            type="monotone"
            dataKey="kpBaseline"
            stroke={COLORS.baseline}
            strokeDasharray="5 5"
            strokeWidth={2}
            dot={false}
            name="kpBaseline"
          />
          
          {/* Agent KP (dynamic) */}
          <Line
            type="monotone"
            dataKey="kpNormalized"
            stroke={COLORS.agent}
            strokeWidth={2}
            dot={false}
            name="kpNormalized"
          />
          
          {/* Annotations for KP raises */}
          {data.filter(d => d.kpNormalized > 1.3 && d.time >= 13 && d.time <= 15).length > 0 && (
            <ReferenceLine
              x={14}
              stroke={COLORS.annotation}
              strokeDasharray="3 3"
              label={{
                value: '⚡ Agent raises KP → 2.5',
                fill: COLORS.annotation,
                fontSize: 10,
                position: 'insideTopLeft',
              }}
            />
          )}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

export default ProportionalGainPanel;