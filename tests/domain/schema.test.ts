import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { IntervalsActivitySchema, IntervalsWellnessSchema } from '../../src/domain/schema';

/**
 * Tests for README §2.2 — Data Ingestion Schema (Zod)
 *
 * The spec requires:
 *   id: z.string()
 *   type: z.literal('Run')
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

  it('rejects activity with wrong type (must be literal "Run")', () => {
    const result = IntervalsActivitySchema.safeParse({ ...validActivity, type: 'Ride' });
    expect(result.success).toBe(false);
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
});
