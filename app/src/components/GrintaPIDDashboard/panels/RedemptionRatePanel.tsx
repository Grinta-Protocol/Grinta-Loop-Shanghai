/**
 * Redemption Rate Panel - Shows stronger response with Agent
 */

import React from 'react';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
  ReferenceArea,
} from 'recharts';
import { formatPercent } from '../utils/normalize';

interface RedemptionRatePanelProps {
  data: any[];
  crashZone?: { start: number; end: number };
}

const COLORS = {
  agent: '#60a5fa',
  baseline: '#6b7280',
  grid: '#1f2937',
  text: '#e5e7eb',
  crashFill: 'rgba(239, 68, 68, 0.08)',
  correctionArea: 'rgba(96, 165, 250, 0.15)',
};

export function RedemptionRatePanel({ data, crashZone }: RedemptionRatePanelProps) {
  return (
    <div className="redemption-rate-panel">
      <div className="panel-title">Redemption Rate — Same Error, Stronger Response With Agent</div>
      <ResponsiveContainer width="100%" height={180}>
        <AreaChart data={data} syncId="grinta-dashboard">
          <CartesianGrid strokeDasharray="3 3" stroke={COLORS.grid} />
          
          <XAxis 
            dataKey="time" 
            tick={{ fill: COLORS.text, fontSize: 10 }} 
            tickFormatter={(v) => `${v}m`}
            axisLine={{ stroke: COLORS.grid }}
          />
          
          <YAxis 
            tick={{ fill: COLORS.text, fontSize: 10 }}
            domain={[0.95, 1.15]}
            tickFormatter={(v) => v.toFixed(2)}
            axisLine={{ stroke: COLORS.grid }}
            label={{ 
              value: 'Rate', 
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
              if (name === 'rate') return [value.toFixed(4), 'Agent Rate'];
              if (name === 'rateBaseline') return [value.toFixed(4), 'Baseline Rate'];
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
          
          {/* Reference line at 1.0 */}
          <ReferenceLine
            y={1}
            stroke={COLORS.baseline}
            strokeDasharray="5 5"
            strokeWidth={1}
          />
          
          {/* Correction area between baseline and agent */}
          <Area
            type="monotone"
            dataKey="rateDiff"
            stroke="none"
            fill={COLORS.correctionArea}
            name="rateDiff"
          />
          
          {/* Baseline Rate */}
          <Area
            type="monotone"
            dataKey="rateBaseline"
            stroke={COLORS.baseline}
            fill="none"
            strokeDasharray="5 5"
            strokeWidth={2}
            name="rateBaseline"
          />
          
          {/* Agent Rate */}
          <Area
            type="monotone"
            dataKey="rate"
            stroke={COLORS.agent}
            fill={COLORS.agent}
            fillOpacity={0.2}
            strokeWidth={2}
            name="rate"
          />
          
          {/* +25% correction label */}
          {crashZone && (
            <ReferenceLine
              x={25}
              stroke="none"
              label={{
                value: '+25% stronger correction',
                fill: COLORS.agent,
                fontSize: 10,
                position: 'insideTopRight',
              }}
            />
          )}
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

export default RedemptionRatePanel;