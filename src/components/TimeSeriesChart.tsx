import React from 'react';
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  ReferenceLine,
} from 'recharts';
import type { DailyDataPoint } from '../domain/types';

export type { DailyDataPoint };

interface TimeSeriesChartProps {
  data: DailyDataPoint[];
  dataKey: 'nfi' | 'tsb' | 'recoveryHours';
  title: string;
  color: string;
  /** Optional reference line value */
  referenceLine?: { value: number; label: string; color: string };
  /** Format the Y value for display */
  formatValue?: (value: number) => string;
}

const defaultFormatters: Record<string, (v: number) => string> = {
  nfi: (v) => `${(v * 100).toFixed(1)}%`,
  tsb: (v) => v.toFixed(0),
  recoveryHours: (v) => `${v}h`,
};

interface CustomTooltipProps {
  active?: boolean;
  payload?: Array<{ value: number | null; color: string }>;
  label?: string;
  dataKey: string;
  formatValue?: (v: number) => string;
}

const CustomTooltip = ({
  active,
  payload,
  label,
  dataKey,
  formatValue,
}: CustomTooltipProps) => {
  if (!active || !payload?.length) return null;
  const point = payload[0];
  if (point.value == null) return null;
  const fmt = formatValue || defaultFormatters[dataKey] || ((v: number) => v.toFixed(1));
  return (
    <div
      style={{
        background: '#282828',
        border: '1px solid #444',
        borderRadius: 6,
        padding: '8px 12px',
        fontSize: 12,
        color: 'rgba(255,255,255,0.87)',
      }}
    >
      <div style={{ color: 'rgba(255,255,255,0.6)', marginBottom: 2 }}>{label}</div>
      <div style={{ fontWeight: 700, color: point.color }}>{fmt(point.value)}</div>
    </div>
  );
};

export const TimeSeriesChart: React.FC<TimeSeriesChartProps> = ({
  data,
  dataKey,
  title,
  color,
  referenceLine,
  formatValue,
}) => {
  const fmt = formatValue || defaultFormatters[dataKey] || ((v: number) => v.toFixed(1));

  // Show ~8 evenly-spaced tick labels across the data range
  const step = Math.max(1, Math.ceil(data.length / 8));
  const tickFormatter = (_: string, index: number) => {
    if (index % step !== 0) return '';
    return data[index]?.dayLabel || '';
  };

  // Compute Y domain from non-null values
  const values = data.map((d) => d[dataKey]).filter((v): v is number => v != null);
  const minVal = values.length > 0 ? Math.min(...values) : 0;
  const maxVal = values.length > 0 ? Math.max(...values) : 1;
  const padding = (maxVal - minVal) * 0.15 || 1;

  return (
    <div className="icu-card" style={{ padding: '12px 8px 8px' }}>
      <div className="icu-section-title" style={{ paddingLeft: 8 }}>
        {title}
      </div>
      <ResponsiveContainer width="100%" height={160}>
        <LineChart data={data} margin={{ top: 8, right: 12, bottom: 4, left: -8 }}>
          <CartesianGrid stroke="#2a2a2a" strokeDasharray="3 3" vertical={false} />
          <XAxis
            dataKey="dayLabel"
            tick={{ fontSize: 10, fill: 'rgba(255,255,255,0.5)' }}
            tickLine={false}
            axisLine={{ stroke: '#333' }}
            tickFormatter={tickFormatter}
            interval={0}
            angle={-30}
            textAnchor="end"
            height={36}
          />
          <YAxis
            tick={{ fontSize: 10, fill: 'rgba(255,255,255,0.38)' }}
            tickLine={false}
            axisLine={false}
            domain={[minVal - padding, maxVal + padding]}
            tickFormatter={(v) => fmt(v)}
            width={48}
          />
          <Tooltip
            content={(props) => (
              <CustomTooltip {...(props as CustomTooltipProps)} dataKey={dataKey} formatValue={formatValue} />
            )}
          />
          {referenceLine && (
            <ReferenceLine
              y={referenceLine.value}
              stroke={referenceLine.color}
              strokeDasharray="4 4"
              strokeOpacity={0.6}
              label={{
                value: referenceLine.label,
                fill: referenceLine.color,
                fontSize: 10,
                position: 'right',
              }}
            />
          )}
          <Line
            type="monotone"
            dataKey={dataKey}
            stroke={color}
            strokeWidth={2}
            dot={{ r: 2, fill: color, strokeWidth: 0 }}
            activeDot={{ r: 4, fill: color, strokeWidth: 2, stroke: '#1e1e1e' }}
            connectNulls={true}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
};
