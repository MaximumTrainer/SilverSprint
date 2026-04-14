import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { IntervalsActivitySchema, IntervalsWellnessSchema, IntervalsIntervalSchema, RUN_ACTIVITY_TYPES } from '../../src/domain/schema';

/**
 * Tests for README §2.2 — Data Ingestion Schema (Zod)
 *
 * The spec requires:
 *   id: z.string()
 *   type: z.enum(RUN_ACTIVITY_TYPES)  — accepted run sub-types
 *   velocity_smooth: z.array(z.number())  — required
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

  it('requires max_speed', () => {
    const { max_speed, ...rest } = validActivity;
    const result = IntervalsActivitySchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it('requires icu_training_load', () => {
    const { icu_training_load, ...rest } = validActivity;
    const result = IntervalsActivitySchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it('requires icu_atl (Fatigue)', () => {
    const { icu_atl, ...rest } = validActivity;
    const result = IntervalsActivitySchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it('requires icu_ctl (Fitness)', () => {
    const { icu_ctl, ...rest } = validActivity;
    const result = IntervalsActivitySchema.safeParse(rest);
    expect(result.success).toBe(false);
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
});
