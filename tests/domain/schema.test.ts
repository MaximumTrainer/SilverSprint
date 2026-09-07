import { describe, it, expect } from 'vitest';
import {
  ACTIVITY_LIST_FIELDS,
  CachedActivityStreamSchema,
  IntervalsActivitySchema,
  IntervalsBulkActivitySchema,
  IntervalsIntervalSchema,
  IntervalsWellnessSchema,
  RUN_ACTIVITY_TYPES,
  StreamCacheEntrySchema,
  StreamCacheSchema,
} from '../../src/domain/schema';

/**
 * Tests for README §2.2 — Data Ingestion Schema (Zod)
 *
 * The spec requires:
 *   id: z.string()
 *   type: z.enum(RUN_ACTIVITY_TYPES)  — accepted run sub-types
 *   velocity_smooth: z.array(z.number())  — optional, defaults to []
 *   max_speed: z.number()                 — required
 *   icu_training_load: z.number()
 *   icu_atl: z.number()                   — Fatigue
 *   icu_ctl: z.number()                   — Fitness
 */
describe('IntervalsActivitySchema (§2.2)', () => {
  const validActivity = {
    id: 'i12345_abc',
    type: 'Run',
    velocity_smooth: [0, 2.1, 5.5, 8.3, 9.1, 8.8, 6.0, 1.2],
    max_speed: 9.1,
    icu_training_load: 74,
    icu_atl: 55,
    icu_ctl: 42,
  };

  it('accepts a fully valid activity', () => {
    const result = IntervalsActivitySchema.safeParse(validActivity);
    expect(result.success).toBe(true);
  });

  it('rejects activity with non-run type (e.g. Ride)', () => {
    const result = IntervalsActivitySchema.safeParse({ ...validActivity, type: 'Ride' });
    expect(result.success).toBe(false);
  });

  it('accepts all RUN_ACTIVITY_TYPES', () => {
    for (const runType of RUN_ACTIVITY_TYPES) {
      const result = IntervalsActivitySchema.safeParse({ ...validActivity, type: runType });
      expect(result.success).toBe(true);
    }
  });

  it('defaults velocity_smooth to empty array when not provided', () => {
    const { velocity_smooth, ...rest } = validActivity;
    const result = IntervalsActivitySchema.safeParse(rest);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.velocity_smooth).toEqual([]);
    }
  });

  it('strips null velocity samples left by GPS dropouts', () => {
    const result = IntervalsActivitySchema.safeParse({
      ...validActivity,
      velocity_smooth: [0, 4.2, null, 8.1, null],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.velocity_smooth).toEqual([0, 4.2, 8.1]);
    }
  });

  it('accepts a null max_speed from a manually-entered activity', () => {
    // Intervals.icu returns max_speed: null for sessions with no GPS trace.
    // Rejecting them would erase those activities from the athlete's history.
    const result = IntervalsActivitySchema.safeParse({ ...validActivity, max_speed: null });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.max_speed).toBeNull();
    }
  });

  it('represents an absent max_speed as null rather than zero', () => {
    const { max_speed, ...rest } = validActivity;
    const result = IntervalsActivitySchema.safeParse(rest);
    expect(result.success).toBe(true);
    if (result.success) {
      // null means "no velocity data"; 0 would mean "stationary".
      expect(result.data.max_speed).toBeNull();
    }
  });

  it('defaults absent training-load fields to zero', () => {
    const { icu_training_load, icu_atl, icu_ctl, ...rest } = validActivity;
    const result = IntervalsActivitySchema.safeParse(rest);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.icu_training_load).toBe(0);
      expect(result.data.icu_atl).toBe(0);
      expect(result.data.icu_ctl).toBe(0);
    }
  });

  it('coerces null training-load fields to zero', () => {
    const result = IntervalsActivitySchema.safeParse({
      ...validActivity,
      icu_training_load: null,
      icu_atl: null,
      icu_ctl: null,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.icu_atl).toBe(0);
      expect(result.data.icu_ctl).toBe(0);
    }
  });

  it('still rejects a payload with no id or type', () => {
    const { id, type, ...rest } = validActivity;
    expect(IntervalsActivitySchema.safeParse(rest).success).toBe(false);
  });
});

/**
 * IntervalsWellnessSchema must exist and contain HRV-related fields
 * so the HRV modifier (§3.2) can be applied.
 */
describe('IntervalsWellnessSchema', () => {
  it('is exported and validates wellness data', () => {
    expect(IntervalsWellnessSchema).toBeDefined();
    const result = IntervalsWellnessSchema.safeParse({
      id: 'w1',
      hrv: 62,
      restingHR: 54,
      readiness: 85,
    });
    expect(result.success).toBe(true);
  });

  it('accepts rmssd field for backward compatibility', () => {
    const result = IntervalsWellnessSchema.safeParse({
      id: '2024-03-01',
      rmssd: 46.5,
      restingHR: 52,
      weight: 82.0,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.rmssd).toBe(46.5);
    }
  });

  it('accepts both hrv and rmssd together', () => {
    const result = IntervalsWellnessSchema.safeParse({
      id: '2024-03-01',
      hrv: 62,
      rmssd: 46.5,
      restingHR: 52,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.hrv).toBe(62);
      expect(result.data.rmssd).toBe(46.5);
    }
  });

  it('succeeds when neither hrv nor rmssd are present (both optional)', () => {
    const result = IntervalsWellnessSchema.safeParse({
      id: '2024-03-01',
      restingHR: 52,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.hrv).toBeUndefined();
      expect(result.data.rmssd).toBeUndefined();
    }
  });

  it('accepts null hrv and rmssd (API returns null for missing values)', () => {
    const result = IntervalsWellnessSchema.safeParse({
      id: '2024-03-01',
      hrv: null,
      rmssd: null,
      restingHR: 52,
      readiness: null,
      weight: null,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.hrv).toBeNull();
      expect(result.data.rmssd).toBeNull();
    }
  });

  it('accepts valid hrv even when other optional fields are null', () => {
    // Intervals.icu returns null for unset fields; this must not reject valid HRV entries
    const result = IntervalsWellnessSchema.safeParse({
      id: '2024-03-15',
      hrv: 58,
      rmssd: null,
      restingHR: null,
      readiness: null,
      weight: null,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.hrv).toBe(58);
      expect(result.data.rmssd).toBeNull();
    }
  });

  it('carries the CTL and ATL for that day', () => {
    // Every calendar day has a wellness row, trained or not, which makes this
    // the only source of fitness/fatigue that stays current through a rest
    // block. The copies on an activity are frozen at the training day.
    const result = IntervalsWellnessSchema.safeParse({
      id: '2026-09-06',
      hrv: 24,
      ctl: 36.69,
      atl: 34.38,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.ctl).toBe(36.69);
      expect(result.data.atl).toBe(34.38);
    }
  });

  it('accepts a wellness row from an account with no load data', () => {
    const result = IntervalsWellnessSchema.safeParse({ id: '2026-09-06', hrv: 24, ctl: null, atl: null });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.ctl).toBeNull();
    }
    expect(IntervalsWellnessSchema.safeParse({ id: '2026-09-06', hrv: 24 }).success).toBe(true);
  });
});

/**
 * IntervalsIntervalSchema — interval-level training load field.
 *
 * icu_training_load is optional because not all versions of the
 * Intervals.icu API include it, but when present it is used to
 * account for all other (non-sprint) training load in recovery.
 */
describe('IntervalsIntervalSchema — icu_training_load', () => {
  it('accepts an interval with icu_training_load', () => {
    const result = IntervalsIntervalSchema.safeParse({
      type: 'WARMUP',
      distance: 800,
      elapsed_time: 240,
      moving_time: 240,
      average_speed: 3.3,
      max_speed: 4.0,
      icu_training_load: 12,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.icu_training_load).toBe(12);
    }
  });

  it('accepts an interval without icu_training_load (field is optional)', () => {
    const result = IntervalsIntervalSchema.safeParse({
      type: 'WORK',
      distance: 60,
      moving_time: 7,
      max_speed: 9.8,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.icu_training_load).toBeUndefined();
    }
  });

  it('icu_training_load defaults to undefined when absent (no default)', () => {
    const result = IntervalsIntervalSchema.safeParse({ type: 'REST' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.icu_training_load).toBeUndefined();
    }
  });

  it('accepts an auto-detected lap, which always has label: null', () => {
    // Intervals.icu labels laps only for structured workouts. Every lap of an
    // auto-detected session carries label: null — rejecting those discards the
    // entire rep-level analysis for that session.
    const result = IntervalsIntervalSchema.safeParse({
      label: null,
      type: 'WORK',
      distance: 62.0,
      moving_time: 8,
      elapsed_time: 8,
      average_speed: 7.777,
      max_speed: 8.155,
      training_load: 0.4,
      start_index: 1120,
      end_index: 1128,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.max_speed).toBe(8.155);
    }
  });

  it('accepts a lap whose distance or training_load is null', () => {
    const result = IntervalsIntervalSchema.safeParse({
      label: null,
      type: 'RECOVERY',
      distance: null,
      moving_time: 60,
      training_load: null,
    });
    expect(result.success).toBe(true);
  });
});

describe('ACTIVITY_LIST_FIELDS — the `fields=` list (AC-9)', () => {
  it('is every field the schema reads, except the one the endpoint never returns', () => {
    const schemaFields = Object.keys(IntervalsActivitySchema.shape);
    expect([...ACTIVITY_LIST_FIELDS].sort())
      .toEqual(schemaFields.filter((f) => f !== 'velocity_smooth').sort());
  });

  it('covers the four fields a hand-written list omitted', () => {
    // The previous draft of the field list named only
    // id,type,start_date_local,max_speed,stream_types — which would have
    // silently zeroed the training-load and fitness/fatigue charts.
    for (const field of ['name', 'icu_training_load', 'icu_atl', 'icu_ctl']) {
      expect(ACTIVITY_LIST_FIELDS).toContain(field);
    }
  });

  it('never asks the list endpoint for velocity_smooth', () => {
    // It is in the schema because the /streams response is merged onto an
    // activity downstream; the list endpoint has no such series.
    expect(ACTIVITY_LIST_FIELDS).not.toContain('velocity_smooth');
  });
});

describe('IntervalsActivitySchema — stream_types and `fields=` null elision (AC-10, AC-11)', () => {
  const base = { id: 'a1', type: 'Run' as const, start_date_local: '2026-09-01T07:00:00' };

  it('accepts the series list the live API returns', () => {
    const result = IntervalsActivitySchema.safeParse({
      ...base,
      stream_types: ['time', 'distance', 'velocity_smooth', 'heartrate'],
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.stream_types).toContain('velocity_smooth');
  });

  it('accepts stream_types: null — the shape of a session with no GPS trace', () => {
    const result = IntervalsActivitySchema.safeParse({ ...base, stream_types: null });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.stream_types).toBeNull();
  });

  it('accepts the key being absent, which is what `fields=` produces', () => {
    // Intervals.icu documents that `fields=` "also excludes null values", and
    // it is observable: 5 live runs came back with neither `stream_types` nor
    // `max_speed`. A schema that tolerates null but not absence drops them.
    const result = IntervalsActivitySchema.safeParse(base);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.stream_types).toBeUndefined();
      expect(result.data.max_speed).toBeNull();
      // The load fields default rather than failing, so the charts still draw.
      expect(result.data.icu_ctl).toBe(0);
      expect(result.data.icu_atl).toBe(0);
      expect(result.data.icu_training_load).toBe(0);
    }
  });

  it('accepts an empty stream_types array without treating it as "no streams"', () => {
    // The distinction is enforced in `pace-curve-sync`; the schema's job is
    // only to let the value through intact.
    const result = IntervalsActivitySchema.safeParse({ ...base, stream_types: [] });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.stream_types).toEqual([]);
  });
});

describe('IntervalsBulkActivitySchema — the bulk lap response (FR-16, FR-17)', () => {
  it('parses an activity with laps', () => {
    const result = IntervalsBulkActivitySchema.safeParse({
      id: 'act_track_session',
      name: 'Track session',
      icu_intervals: [{ type: 'WORK', distance: 62 }],
      icu_groups: [],
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.icu_intervals).toHaveLength(1);
  });

  it('parses an activity Intervals.icu has not analysed', () => {
    for (const laps of [null, undefined]) {
      const result = IntervalsBulkActivitySchema.safeParse({ id: 'i1', icu_intervals: laps });
      expect(result.success).toBe(true);
    }
  });

  it('rejects an entry with no usable id, so it can be skipped rather than misfiled', () => {
    // The response drops unknown ids and reorders the rest, so the id is the
    // only thing tying laps to an activity. An entry without one is unusable.
    expect(IntervalsBulkActivitySchema.safeParse({ id: 42, icu_intervals: [] }).success).toBe(false);
    expect(IntervalsBulkActivitySchema.safeParse({ icu_intervals: [] }).success).toBe(false);
  });
});

describe('CachedActivityStreamSchema — untrusted cache entries (FR-27)', () => {
  it('round-trips a stream with its GPS dropouts intact', () => {
    const result = CachedActivityStreamSchema.safeParse({
      velocitySmooth: [0, 7.6, null, 8.1],
      distance: [0, 7.6, null, 23.4],
      time: [0, 1, 2, 3],
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.velocitySmooth[2]).toBeNull();
  });

  it('accepts an empty velocity series as a cached negative', () => {
    // "Intervals.icu answered, and this activity has no velocity trace."
    // Streams are immutable, so that answer is as cacheable as a positive.
    expect(CachedActivityStreamSchema.safeParse({ velocitySmooth: [] }).success).toBe(true);
  });

  it('rejects a series carrying anything but finite numbers and nulls', () => {
    for (const bad of ['banana', [{}], ['7.6'], [Number.NaN], [Number.POSITIVE_INFINITY]]) {
      expect(CachedActivityStreamSchema.safeParse({ velocitySmooth: bad }).success, String(bad)).toBe(false);
    }
  });
});

describe('StreamCacheSchema — the stored envelope', () => {
  it('accepts the version it writes', () => {
    expect(StreamCacheSchema.safeParse({ version: 1, entries: [] }).success).toBe(true);
  });

  it('rejects a record written by a future version', () => {
    expect(StreamCacheSchema.safeParse({ version: 2, entries: [] }).success).toBe(false);
  });

  it('leaves entries unvalidated so one bad stream costs one re-fetch', () => {
    // Validating the array element-wise here would fail the whole cache on a
    // single corrupt entry. Each is checked on its own by StreamCacheEntrySchema.
    const record = StreamCacheSchema.safeParse({ version: 1, entries: ['nonsense'] });
    expect(record.success).toBe(true);
    expect(StreamCacheEntrySchema.safeParse('nonsense').success).toBe(false);
    expect(StreamCacheEntrySchema.safeParse({ id: 'a', stream: { velocitySmooth: [1] } }).success).toBe(true);
  });

  it('rejects an entry with an empty id, which could not be matched to an activity', () => {
    expect(StreamCacheEntrySchema.safeParse({ id: '', stream: { velocitySmooth: [1] } }).success).toBe(false);
  });
});
