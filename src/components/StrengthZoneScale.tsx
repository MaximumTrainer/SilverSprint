import React from 'react';
import { STRENGTH_ZONE_BANDS, getStrengthZoneBand } from '../domain/sprint/core';

/** TSB values beyond these are clamped to the ends of the scale. */
const SCALE_MIN = -40;
const SCALE_MAX = 20;

/** The two thresholds, as a fraction across the scale. */
const BOUNDARIES = [-20, 0];

interface StrengthZoneScaleProps {
  /** Current Training Stress Balance. */
  tsb: number;
}

function colorForZone(zone: string): string {
  switch (zone) {
    case 'fresh': return 'var(--icu-green)';
    case 'tired': return 'var(--icu-orange)';
    case 'fatigued': return 'var(--icu-red)';
    default: return 'var(--icu-text-disabled)';
  }
}

function positionFor(tsb: number): number {
  const clamped = Math.min(SCALE_MAX, Math.max(SCALE_MIN, tsb));
  return ((clamped - SCALE_MIN) / (SCALE_MAX - SCALE_MIN)) * 100;
}

/**
 * A labelled TSB scale showing all three strength bands and where the athlete
 * currently sits.
 *
 * Without it the card states a verdict — "Tired" — and leaves the athlete to
 * guess what the boundaries are and how close they are to the next band. That
 * is doubly confusing here because the zone responds to *all* training load,
 * so it can read Tired in a week containing no lifting at all.
 *
 * Bands and thresholds are read from `STRENGTH_ZONE_BANDS`, the same
 * definition the prescription uses, so the labels cannot drift from the logic.
 */
export const StrengthZoneScale: React.FC<StrengthZoneScaleProps> = ({ tsb }) => {
  const active = getStrengthZoneBand(tsb);
  // Freshest-first in the domain; the scale runs fatigued → fresh, left to right.
  const bands = [...STRENGTH_ZONE_BANDS].reverse();
  const markerPct = positionFor(tsb);

  return (
    <div style={{ marginTop: 8 }}>
      <div
        role="img"
        aria-label={`Training Stress Balance ${tsb.toFixed(1)}, in the ${active.label} band (${active.range})`}
        style={{ position: 'relative', display: 'flex', height: 6, borderRadius: 3, overflow: 'hidden', gap: 1 }}
      >
        {bands.map((band) => {
          const isActive = band.zone === active.zone;
          return (
            <div
              key={band.zone}
              title={`${band.label}: TSB ${band.range} — ${band.guidance}`}
              style={{
                flex: 1,
                background: colorForZone(band.zone),
                opacity: isActive ? 1 : 0.22,
              }}
            />
          );
        })}
      </div>

      {/* Current position marker */}
      <div style={{ position: 'relative', height: 8 }}>
        <div
          style={{
            position: 'absolute',
            left: `${markerPct}%`,
            transform: 'translateX(-50%)',
            width: 0,
            height: 0,
            borderLeft: '4px solid transparent',
            borderRight: '4px solid transparent',
            borderBottom: `5px solid ${colorForZone(active.zone)}`,
            marginTop: 1,
          }}
        />
      </div>

      <div
        style={{
          display: 'flex',
          fontSize: 9,
          color: 'var(--icu-text-disabled)',
          letterSpacing: '0.02em',
        }}
      >
        {bands.map((band) => (
          <div
            key={band.zone}
            style={{
              flex: 1,
              textAlign: 'center',
              color: band.zone === active.zone ? colorForZone(band.zone) : 'var(--icu-text-disabled)',
              fontWeight: band.zone === active.zone ? 700 : 400,
            }}
          >
            {band.label}
            <div style={{ fontSize: 8, opacity: 0.75 }}>{band.range}</div>
          </div>
        ))}
      </div>
    </div>
  );
};

/** Boundary values, exported so tests can assert the scale matches the domain. */
export const STRENGTH_SCALE_BOUNDARIES = BOUNDARIES;

export default StrengthZoneScale;
