import React, { useMemo, useState } from 'react';
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from 'recharts';
import { Activity, Plus, X } from 'lucide-react';
import {
  DEFAULT_PACE_CURVE_RANGE,
  DistanceEdit,
  MAX_ACTIVE_DISTANCES,
  MAX_CURVE_DISTANCE,
  MIN_CURVE_DISTANCE,
  PACE_CURVE_PRESET_DISTANCES,
  PACE_CURVE_RANGES,
  PACE_CURVE_RANGE_LABELS,
  PaceCurveActivityStream,
  PaceCurvePoint,
  PaceCurveRange,
  computePaceCurve,
  formatCurveTime,
  formatPacePerKm,
  paceCurveWindowStart,
} from '../domain/sprint/pace-curve';

interface PaceCurvePanelProps {
  /** The streams the sync already fetched. Re-charting reads only these. */
  streams: PaceCurveActivityStream[];
  /** Distances the athlete has chosen, ascending. */
  distances: number[];
  /** The athlete's 60-day peak velocity, for the account-specific outlier bound. */
  bestVmax60d: number;
  /** How much of the eligible history the streams cover. Omitted in demo mode. */
  coverage?: { eligible: number; requested: number; fetched: number };
  /** Toggle a preset chip. Omitted in demo mode, where there is nothing to store against. */
  onToggleDistance?: (distance: number) => DistanceEdit;
  /** Add a custom distance. Omitted in demo mode. */
  onAddDistance?: (distance: number) => DistanceEdit;
  /** Reference "now" for the range windows. Defaults to the current time. */
  now?: Date;
}

/**
 * §3.5 — Sprint pace curve.
 *
 * The athlete's best time at each of the distances they care about, computed
 * from their own 1 Hz streams. Intervals.icu's own pace-curve endpoint is not
 * used: its ladder stops at 45.72 m and everything it reports below ~250 m is
 * GPS noise (see `domain/sprint/pace-curve.ts`).
 *
 * Changing distances or the date range is pure local arithmetic over the
 * streams already in memory — no Intervals.icu request is issued.
 */
export const PaceCurvePanel: React.FC<PaceCurvePanelProps> = ({
  streams,
  distances,
  bestVmax60d,
  coverage,
  onToggleDistance,
  onAddDistance,
  now,
}) => {
  const [range, setRange] = useState<PaceCurveRange>(DEFAULT_PACE_CURVE_RANGE);
  const [customInput, setCustomInput] = useState('');
  const [isAdding, setIsAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Without handlers there is no signed-in athlete to store a selection
  // against, so the panel charts the defaults and explains itself instead of
  // offering controls that cannot persist.
  const isReadOnly = !onToggleDistance || !onAddDistance;

  const curve = useMemo(() => {
    const reference = now ?? new Date();
    return computePaceCurve({
      streams,
      distances,
      since: paceCurveWindowStart(range, reference),
      bestVmax60d,
    });
  }, [streams, distances, range, bestVmax60d, now]);

  const measured = curve.points.filter((p) => p.timeSeconds !== null);
  const excluded = curve.excludedEfforts + curve.excludedActivities;

  const handleAdd = (event: React.FormEvent) => {
    event.preventDefault();
    const trimmed = customInput.trim();
    if (trimmed === '') {
      setError('Enter a distance in metres');
      return;
    }
    // Parsed strictly: "45m" and "4.5e1" are typos, not distances.
    const parsed = /^\d+$/.test(trimmed) ? Number(trimmed) : Number.NaN;
    if (!Number.isFinite(parsed)) {
      setError('Enter a whole number of metres');
      return;
    }
    const result = onAddDistance?.(parsed);
    if (!result || !result.ok) {
      setError(result ? result.message : 'That distance could not be added');
      return;
    }
    setCustomInput('');
    setIsAdding(false);
    setError(null);
  };

  const handleToggle = (distance: number) => {
    const result = onToggleDistance?.(distance);
    setError(result && !result.ok ? result.message : null);
  };

  // The chip row is the preset ladder with the athlete's own distances slotted
  // in by value, so 45 m sits between 40 and 60 rather than being appended
  // wherever it happened to be added.
  const chips = useMemo(() => {
    const presets = PACE_CURVE_PRESET_DISTANCES as readonly number[];
    const merged = [...new Set([...presets, ...distances])].sort((a, b) => a - b);
    return merged.map((distance) => ({ distance, isPreset: presets.includes(distance) }));
  }, [distances]);

  return (
    <div className="icu-card" style={{ marginTop: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 4 }}>
        <Activity size={14} style={{ color: 'var(--icu-primary)' }} />
        <span className="icu-section-title" style={{ marginBottom: 0 }}>Pace Curve</span>
        <div style={{ display: 'flex', gap: 4, marginLeft: 'auto' }}>
          {PACE_CURVE_RANGES.map((r) => (
            <button
              key={String(r)}
              type="button"
              onClick={() => setRange(r)}
              aria-pressed={range === r}
              style={rangeButtonStyle(range === r)}
            >
              {PACE_CURVE_RANGE_LABELS[String(r)]}
            </button>
          ))}
        </div>
      </div>

      <div style={{ fontSize: 10, color: 'var(--icu-text-disabled)', lineHeight: 1.5, marginBottom: 10 }}>
        Your fastest <em>rolling</em> effort at each distance, measured from your own
        GPS traces — not from Intervals.icu&rsquo;s pace curve, which has no data below
        45 m and reports impossible times below 250 m.
        <br />
        <strong style={{ color: 'var(--icu-orange)' }}>These are not race times.</strong>{' '}
        The clock starts once you are already moving, and GPS over-measures distance
        on a bend — against official times on a live masters account these read
        roughly 10% fast. Use them to track change over time, not to predict a race;
        the Outdoor Track Estimates above are the race prediction.
      </div>

      {/* ── distance chips ─────────────────────────────────────── */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 10 }}>
        {chips.map(({ distance, isPreset }) => {
          const selected = distances.includes(distance);
          return (
            <button
              key={distance}
              type="button"
              onClick={() => handleToggle(distance)}
              disabled={isReadOnly}
              aria-pressed={selected}
              aria-label={isPreset ? `${distance} metres` : `${distance} metres, custom — remove`}
              style={{ ...chipStyle(selected, isReadOnly), display: 'flex', alignItems: 'center', gap: 3 }}
            >
              {distance}
              {/* Only a custom distance disappears entirely when removed, so
                  only it carries the affordance saying so. */}
              {!isPreset && !isReadOnly && <X size={9} />}
            </button>
          );
        })}

        {!isReadOnly && !isAdding && (
          <button
            type="button"
            onClick={() => { setIsAdding(true); setError(null); }}
            style={{ ...chipStyle(false, false), display: 'flex', alignItems: 'center', gap: 3 }}
            aria-label="Add a custom distance"
          >
            <Plus size={10} /> Custom
          </button>
        )}

        {isAdding && !isReadOnly && (
          <form onSubmit={handleAdd} style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
            <input
              type="text"
              inputMode="numeric"
              value={customInput}
              onChange={(e) => { setCustomInput(e.target.value); setError(null); }}
              placeholder="45"
              aria-label="Custom distance in metres"
              autoFocus
              style={{
                background: 'var(--icu-bg)',
                border: '1px solid var(--icu-border)',
                borderRadius: 6,
                color: 'var(--icu-text)',
                fontSize: 11,
                padding: '4px 6px',
                width: 56,
              }}
            />
            <button type="submit" className="icu-btn" style={{ fontSize: 10, padding: '4px 10px' }}>
              Add
            </button>
            <button
              type="button"
              onClick={() => { setIsAdding(false); setCustomInput(''); setError(null); }}
              className="icu-btn-ghost"
              style={{ fontSize: 10, padding: '4px 6px' }}
              aria-label="Cancel adding a distance"
            >
              <X size={10} />
            </button>
          </form>
        )}
      </div>

      {error && (
        <div role="alert" style={{ fontSize: 11, color: 'var(--icu-red)', marginBottom: 8 }}>
          {error}
        </div>
      )}

      {/* ── chart ──────────────────────────────────────────────── */}
      {measured.length === 0 ? (
        <div
          style={{
            padding: '24px 12px',
            textAlign: 'center',
            fontSize: 12,
            color: 'var(--icu-text-disabled)',
            lineHeight: 1.6,
          }}
        >
          No sprint efforts found in the {PACE_CURVE_RANGE_LABELS[String(range)].toLowerCase()} window.
          <div style={{ fontSize: 10, marginTop: 4 }}>
            The curve is built from GPS velocity traces — sessions recorded without
            one, or shorter than the smallest selected distance, cannot appear.
          </div>
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={190}>
          <LineChart data={curve.points} margin={{ top: 8, right: 14, bottom: 4, left: -10 }}>
            <CartesianGrid stroke="#2a2a2a" strokeDasharray="3 3" vertical={false} />
            <XAxis
              dataKey="distance"
              type="number"
              // Log scale: on a linear axis every sprint distance below 100 m
              // collapses into the left margin.
              scale="log"
              domain={['dataMin', 'dataMax']}
              ticks={distances}
              tick={{ fontSize: 9, fill: 'rgba(255,255,255,0.5)' }}
              tickLine={false}
              axisLine={{ stroke: '#333' }}
              tickFormatter={(v: number) => `${v}m`}
              height={24}
              allowDataOverflow={false}
            />
            <YAxis
              tick={{ fontSize: 10, fill: 'rgba(255,255,255,0.38)' }}
              tickLine={false}
              axisLine={false}
              domain={speedDomain(measured)}
              tickFormatter={(v: number) => v.toFixed(1)}
              width={40}
            />
            <Tooltip content={(props) => <CurveTooltip {...(props as CurveTooltipProps)} />} />
            <Line
              type="monotone"
              dataKey="speed"
              stroke="var(--icu-primary)"
              strokeWidth={2}
              dot={{ r: 3, fill: 'var(--icu-primary)', strokeWidth: 0 }}
              activeDot={{ r: 5, strokeWidth: 2, stroke: '#1e1e1e' }}
              // A distance with no qualifying effort is a gap, not a value to
              // bridge: joining across it would invent a time.
              connectNulls={false}
            />
          </LineChart>
        </ResponsiveContainer>
      )}

      {/* ── per-distance readout ───────────────────────────────── */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 8 }}>
        {curve.points.map((p) => (
          <div key={p.distance} style={readoutStyle}>
            <span style={{ fontSize: 9, color: 'var(--icu-text-disabled)' }}>
              {p.distance}m{p.submaximal && <span title="No hard effort at this distance in the window"> ·&nbsp;easy</span>}
            </span>
            <span
              style={{
                fontSize: 13,
                fontWeight: 700,
                fontVariantNumeric: 'tabular-nums',
                color: p.timeSeconds === null ? 'var(--icu-text-disabled)' : 'var(--icu-text)',
              }}
            >
              {p.timeSeconds === null ? 'no data' : formatCurveTime(p.timeSeconds)}
            </span>
            {p.speed !== null && (
              <span style={{ fontSize: 9, color: p.submaximal ? 'var(--icu-orange)' : 'var(--icu-text-disabled)' }}>
                {p.speed.toFixed(2)} m/s
              </span>
            )}
          </div>
        ))}
      </div>

      {coverage && coverage.fetched < coverage.requested && (
        <div
          role="status"
          style={{ marginTop: 8, fontSize: 10, color: 'var(--icu-orange)', lineHeight: 1.5 }}
        >
          Incomplete — {coverage.fetched} of {coverage.requested} sessions could be read
          (Intervals.icu rate-limited the rest). A distance whose real best is in a
          missing session will read slower than it should.
        </div>
      )}

      <div style={{ marginTop: 8, fontSize: 10, color: 'var(--icu-text-disabled)', lineHeight: 1.5 }}>
        {curve.activitiesUsed} session{curve.activitiesUsed === 1 ? '' : 's'} in range
        {coverage && coverage.eligible > coverage.requested &&
          ` of ${coverage.eligible} · the ${coverage.requested} fastest were analysed`}
        {excluded > 0 && (
          <>
            {' · '}
            <span style={{ color: 'var(--icu-orange)' }}>
              {excluded} effort{excluded === 1 ? '' : 's'} excluded as implausible
            </span>
          </>
        )}
        {isReadOnly && ' · connect your Intervals.icu account to choose your own distances'}
        {!isReadOnly && ` · up to ${MAX_ACTIVE_DISTANCES} distances, ${MIN_CURVE_DISTANCE}–${MAX_CURVE_DISTANCE} m`}
      </div>
    </div>
  );
};

/* ── tooltip ─────────────────────────────────────────────────── */

interface CurveTooltipProps {
  active?: boolean;
  payload?: Array<{ payload: PaceCurvePoint }>;
}

const CurveTooltip = ({ active, payload }: CurveTooltipProps) => {
  if (!active || !payload?.length) return null;
  const point = payload[0].payload;
  if (point.timeSeconds === null || point.speed === null) return null;

  return (
    <div
      style={{
        background: '#282828',
        border: '1px solid #444',
        borderRadius: 6,
        padding: '8px 12px',
        fontSize: 12,
        color: 'rgba(255,255,255,0.87)',
        maxWidth: 220,
      }}
    >
      <div style={{ color: 'rgba(255,255,255,0.6)', marginBottom: 2 }}>{point.distance} m</div>
      <div style={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
        {formatCurveTime(point.timeSeconds)}s · {point.speed.toFixed(2)} m/s
      </div>
      <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.6)' }}>{formatPacePerKm(point.speed)}</div>
      {point.submaximal && (
        <div style={{ fontSize: 10, color: '#f59e0b', marginTop: 4 }}>
          No hard effort at this distance — this is your steadiest running, not your speed.
        </div>
      )}
      <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.6)', marginTop: 4 }}>
        {point.activityName}
      </div>
      <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.45)' }}>{point.date}</div>
    </div>
  );
};

/* ── styles ──────────────────────────────────────────────────── */

/** Pad the speed axis so the fastest and slowest points are not on the frame. */
function speedDomain(measured: PaceCurvePoint[]): [number, number] {
  const speeds = measured.map((p) => p.speed as number);
  const min = Math.min(...speeds);
  const max = Math.max(...speeds);
  const padding = (max - min) * 0.15 || 0.5;
  return [Math.max(0, min - padding), max + padding];
}

function chipStyle(selected: boolean, disabled: boolean): React.CSSProperties {
  return {
    fontSize: 11,
    fontWeight: selected ? 700 : 400,
    padding: '4px 9px',
    borderRadius: 12,
    cursor: disabled ? 'default' : 'pointer',
    border: `1px solid ${selected ? 'var(--icu-primary)' : 'var(--icu-border)'}`,
    background: selected ? 'rgba(33,150,243,0.14)' : 'transparent',
    color: selected ? 'var(--icu-primary)' : 'var(--icu-text-secondary)',
    opacity: disabled && !selected ? 0.5 : 1,
  };
}

function rangeButtonStyle(active: boolean): React.CSSProperties {
  return {
    fontSize: 10,
    padding: '3px 8px',
    borderRadius: 6,
    cursor: 'pointer',
    border: `1px solid ${active ? 'var(--icu-primary)' : 'var(--icu-border)'}`,
    background: active ? 'rgba(33,150,243,0.14)' : 'transparent',
    color: active ? 'var(--icu-primary)' : 'var(--icu-text-secondary)',
  };
}

const readoutStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 1,
  // Narrow enough that eight of these still wrap cleanly at a 360 px viewport.
  minWidth: 62,
  flex: '1 1 62px',
  padding: '5px 8px',
  borderRadius: 6,
  background: 'var(--icu-bg-elevated, rgba(255,255,255,0.02))',
};

export default PaceCurvePanel;
