import React, { useState } from 'react';
import { Plus, Trash2, Trophy, X } from 'lucide-react';
import {
  CALIBRATABLE_DISTANCES,
  RACE_TIME_BOUNDS,
  RaceCalibration,
  RaceDistance,
  RaceResult,
  formatRaceTime,
  parseRaceTime,
} from '../domain/sprint/race-results';

interface RaceResultsPanelProps {
  results: RaceResult[];
  calibration: RaceCalibration;
  /** Omitted in demo mode, where there is no athlete to store results against. */
  onAdd?: (draft: Omit<RaceResult, 'id'>) => RaceResult | null;
  /** Omitted in demo mode. */
  onRemove?: (id: string) => void;
}

const DISTANCE_PLACEHOLDER: Record<RaceDistance, string> = {
  100: '14.20',
  200: '29.40',
  400: '1:10.50',
};

/** Today in the local timezone, as the `YYYY-MM-DD` an `<input type="date">` expects. */
function todayISO(): string {
  const now = new Date();
  const offsetMs = now.getTimezoneOffset() * 60_000;
  return new Date(now.getTime() - offsetMs).toISOString().slice(0, 10);
}

/**
 * §3.4 — Known race times.
 *
 * Lets the athlete enter races they have actually run so the estimator can be
 * calibrated against reality rather than velocity alone. Entries persist for
 * as long as the login does and are cleared on logout.
 */
export const RaceResultsPanel: React.FC<RaceResultsPanelProps> = ({
  results,
  calibration,
  onAdd,
  onRemove,
}) => {
  const [isAdding, setIsAdding] = useState(false);
  const [distance, setDistance] = useState<RaceDistance>(100);
  const [timeInput, setTimeInput] = useState('');
  const [date, setDate] = useState(todayISO());
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);

  // Without handlers there is no signed-in athlete to store results against,
  // so the panel explains the feature rather than offering a control that
  // cannot work.
  const isReadOnly = !onAdd || !onRemove;

  const resetForm = () => {
    setDistance(100);
    setTimeInput('');
    setDate(todayISO());
    setNote('');
    setError(null);
  };

  const closeForm = () => {
    setIsAdding(false);
    resetForm();
  };

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();

    const timeSeconds = parseRaceTime(timeInput);
    if (timeSeconds === null) {
      setError('Enter a time like 14.20 or 1:10.50');
      return;
    }

    const bounds = RACE_TIME_BOUNDS[distance];
    if (timeSeconds < bounds.min || timeSeconds > bounds.max) {
      setError(`A ${distance}m time should be between ${formatRaceTime(bounds.min)} and ${formatRaceTime(bounds.max)}`);
      return;
    }

    if (date > todayISO()) {
      setError('Race date cannot be in the future');
      return;
    }

    const added = onAdd?.({
      distance,
      timeSeconds,
      date,
      note: note.trim() === '' ? undefined : note.trim(),
    });

    if (!added) {
      setError('That result could not be saved — check the time and date');
      return;
    }

    closeForm();
  };

  const factorSummary = (d: RaceDistance): string | null => {
    if (calibration.resultCount === 0) return null;
    const deltaPct = Math.round((calibration.factors[d] - 1) * 100);
    if (deltaPct === 0) return 'model matches';
    return deltaPct > 0 ? `+${deltaPct}% slower` : `${deltaPct}% faster`;
  };

  return (
    <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--icu-border)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <Trophy size={14} style={{ color: 'var(--icu-primary)' }} />
        <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--icu-text)' }}>
          Your race times
        </span>
        <span style={{ fontSize: 10, color: 'var(--icu-text-disabled)' }}>
          {isReadOnly
            ? 'Connect your Intervals.icu account to calibrate these estimates with times you have run'
            : results.length === 0
            ? 'Add a result to calibrate these estimates'
            : `${results.length} result${results.length === 1 ? '' : 's'} calibrating the model`}
        </span>
        {!isAdding && !isReadOnly && (
          <button
            type="button"
            onClick={() => setIsAdding(true)}
            className="icu-btn-ghost"
            style={{ marginLeft: 'auto', fontSize: 11, padding: '4px 10px', display: 'flex', alignItems: 'center', gap: 4 }}
          >
            <Plus size={12} /> Add result
          </button>
        )}
      </div>

      {isAdding && !isReadOnly && (
        <form
          onSubmit={handleSubmit}
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: 8,
            alignItems: 'flex-end',
            padding: 10,
            marginBottom: 10,
            borderRadius: 8,
            background: 'var(--icu-bg-elevated, rgba(255,255,255,0.03))',
            border: '1px solid var(--icu-border)',
          }}
        >
          <label style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            <span style={fieldLabelStyle}>Distance</span>
            <select
              value={distance}
              onChange={(e) => setDistance(Number(e.target.value) as RaceDistance)}
              style={inputStyle}
            >
              {CALIBRATABLE_DISTANCES.map((d) => (
                <option key={d} value={d}>{d}m</option>
              ))}
            </select>
          </label>

          <label style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            <span style={fieldLabelStyle}>Time</span>
            <input
              type="text"
              inputMode="decimal"
              value={timeInput}
              onChange={(e) => { setTimeInput(e.target.value); setError(null); }}
              placeholder={DISTANCE_PLACEHOLDER[distance]}
              aria-label="Race time"
              style={{ ...inputStyle, width: 100 }}
            />
          </label>

          <label style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            <span style={fieldLabelStyle}>Date</span>
            <input
              type="date"
              value={date}
              max={todayISO()}
              onChange={(e) => { setDate(e.target.value); setError(null); }}
              aria-label="Race date"
              style={inputStyle}
            />
          </label>

          <label style={{ display: 'flex', flexDirection: 'column', gap: 3, flex: 1, minWidth: 140 }}>
            <span style={fieldLabelStyle}>Note (optional)</span>
            <input
              type="text"
              value={note}
              maxLength={120}
              onChange={(e) => setNote(e.target.value)}
              placeholder="County champs, +1.2 wind"
              aria-label="Race note"
              style={inputStyle}
            />
          </label>

          <button type="submit" className="icu-btn" style={{ fontSize: 11, padding: '6px 14px' }}>
            Save
          </button>
          <button
            type="button"
            onClick={closeForm}
            className="icu-btn-ghost"
            style={{ fontSize: 11, padding: '6px 10px' }}
            aria-label="Cancel"
          >
            <X size={12} />
          </button>

          {error && (
            <div role="alert" style={{ flexBasis: '100%', fontSize: 11, color: 'var(--icu-red)' }}>
              {error}
            </div>
          )}
        </form>
      )}

      {results.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {results.map((r) => (
            <div
              key={r.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: '6px 10px',
                borderRadius: 6,
                background: 'var(--icu-bg-elevated, rgba(255,255,255,0.02))',
              }}
            >
              <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--icu-text-secondary)', width: 42 }}>
                {r.distance}m
              </span>
              <span style={{ fontSize: 14, fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: 'var(--icu-text)' }}>
                {formatRaceTime(r.timeSeconds)}
              </span>
              <span style={{ fontSize: 11, color: 'var(--icu-text-disabled)' }}>{r.date}</span>
              {r.note && (
                <span style={{ fontSize: 11, color: 'var(--icu-text-disabled)', fontStyle: 'italic', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {r.note}
                </span>
              )}
              {onRemove && (
              <button
                type="button"
                onClick={() => onRemove(r.id)}
                className="icu-btn-ghost"
                aria-label={`Remove ${r.distance}m result from ${r.date}`}
                style={{ marginLeft: 'auto', padding: 4, color: 'var(--icu-text-disabled)' }}
              >
                <Trash2 size={12} />
              </button>
              )}
            </div>
          ))}
        </div>
      )}

      {calibration.resultCount > 0 && (
        <div style={{ marginTop: 8, fontSize: 10, color: 'var(--icu-text-disabled)', lineHeight: 1.5 }}>
          Correction applied —{' '}
          {CALIBRATABLE_DISTANCES.map((d, i) => (
            <span key={d}>
              {i > 0 && ' · '}
              {d}m {factorSummary(d)}
              {!calibration.calibratedDistances.includes(d) && ' (inferred)'}
            </span>
          ))}
          . Older results count for less; nothing beyond five years is used.
        </div>
      )}
    </div>
  );
};

const fieldLabelStyle: React.CSSProperties = {
  fontSize: 9,
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
  color: 'var(--icu-text-disabled)',
};

const inputStyle: React.CSSProperties = {
  background: 'var(--icu-bg)',
  border: '1px solid var(--icu-border)',
  borderRadius: 6,
  color: 'var(--icu-text)',
  fontSize: 12,
  padding: '5px 8px',
};

export default RaceResultsPanel;
