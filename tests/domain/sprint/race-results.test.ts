import { describe, it, expect } from 'vitest';
import {
  RaceResult,
  RaceResultSchema,
  parseRaceTime,
  formatRaceTime,
  buildRaceCalibration,
  calibrationFactorFor,
  parseRaceResults,
  sortResultsByDateDesc,
  recencyWeight,
  agePenaltyFactor,
  ageEquivalentTime,
  NEUTRAL_CALIBRATION,
  CALIBRATION_FACTOR_MIN,
  CALIBRATION_FACTOR_MAX,
  CALIBRATION_HALF_LIFE_MONTHS,
  CALIBRATION_MAX_AGE_MONTHS,
  RACE_TIME_BOUNDS,
} from '../../../src/domain/sprint/race-results';

/**
 * Tests for README §3.4 — Known Race Results and Model Calibration.
 *
 * Race results are user-entered and read back from localStorage, so they are
 * untrusted input: validation is part of the behaviour under test, not a
 * detail.
 */

const NOW = new Date('2026-09-05T12:00:00Z');

function result(overrides: Partial<RaceResult> = {}): RaceResult {
  return {
    id: 'r1',
    distance: 100,
    timeSeconds: 14.2,
    date: '2026-08-01',
    ...overrides,
  };
}

describe('parseRaceTime', () => {
  it('parses plain seconds', () => {
    expect(parseRaceTime('12.34')).toBe(12.34);
    expect(parseRaceTime('62')).toBe(62);
    expect(parseRaceTime('  14.2  ')).toBe(14.2);
  });

  it('parses minutes:seconds', () => {
    expect(parseRaceTime('1:02.45')).toBeCloseTo(62.45, 5);
    expect(parseRaceTime('1:02')).toBe(62);
    expect(parseRaceTime('2:05.9')).toBeCloseTo(125.9, 5);
  });

  it('rejects malformed input rather than returning NaN', () => {
    for (const bad of ['', '   ', 'abc', '12.34.56', '1:75', '-12', '1:2:3', '12s', '1e3']) {
      expect(parseRaceTime(bad)).toBeNull();
    }
  });

  it('round-trips through formatRaceTime', () => {
    expect(formatRaceTime(parseRaceTime('1:02.45')!)).toBe('1:02.45');
    expect(formatRaceTime(parseRaceTime('12.34')!)).toBe('12.34');
  });

  it('formats an unusable value as a dash', () => {
    expect(formatRaceTime(0)).toBe('--');
    expect(formatRaceTime(Number.NaN)).toBe('--');
  });
});

describe('RaceResultSchema', () => {
  it('accepts a plausible result', () => {
    expect(RaceResultSchema.safeParse(result()).success).toBe(true);
  });

  it('rejects a time outside the plausible range for the distance', () => {
    // A mistyped "1234" must not become a permanent 87x correction factor.
    expect(RaceResultSchema.safeParse(result({ timeSeconds: 1234 })).success).toBe(false);
    expect(RaceResultSchema.safeParse(result({ timeSeconds: 3 })).success).toBe(false);
  });

  it('applies per-distance bounds', () => {
    // 62s is nonsense over 100 m but ordinary over 400 m.
    expect(RaceResultSchema.safeParse(result({ distance: 100, timeSeconds: 62 })).success).toBe(false);
    expect(RaceResultSchema.safeParse(result({ distance: 400, timeSeconds: 62 })).success).toBe(true);
    expect(RACE_TIME_BOUNDS[400].min).toBeLessThan(62);
  });

  it('rejects distances the estimator does not model', () => {
    expect(RaceResultSchema.safeParse({ ...result(), distance: 60 }).success).toBe(false);
    expect(RaceResultSchema.safeParse({ ...result(), distance: 800 }).success).toBe(false);
  });

  it('rejects malformed and impossible dates', () => {
    for (const date of ['01-08-2026', '2026/08/01', '2026-13-01', '0202-05-01', 'yesterday']) {
      expect(RaceResultSchema.safeParse(result({ date })).success).toBe(false);
    }
  });

  it('rejects an over-long note', () => {
    expect(RaceResultSchema.safeParse(result({ note: 'x'.repeat(500) })).success).toBe(false);
  });
});

describe('parseRaceResults', () => {
  it('keeps valid entries and discards corrupt ones', () => {
    const parsed = parseRaceResults([
      result({ id: 'a' }),
      { id: 'b', distance: 100, timeSeconds: 'fast', date: '2026-08-01' },
      result({ id: 'c', distance: 200, timeSeconds: 29.4 }),
      null,
      'not an object',
    ]);
    expect(parsed.map((r) => r.id)).toEqual(['a', 'c']);
  });

  it('returns an empty list for a non-array payload', () => {
    expect(parseRaceResults(null)).toEqual([]);
    expect(parseRaceResults({ results: [] })).toEqual([]);
    expect(parseRaceResults('[]')).toEqual([]);
  });

  it('drops duplicate ids so React keys stay unique', () => {
    const parsed = parseRaceResults([result({ id: 'dup' }), result({ id: 'dup', timeSeconds: 13.9 })]);
    expect(parsed).toHaveLength(1);
  });

  it('caps the list length', () => {
    const many = Array.from({ length: 80 }, (_, i) => result({ id: `r${i}` }));
    expect(parseRaceResults(many)).toHaveLength(50);
  });
});

describe('sortResultsByDateDesc', () => {
  it('orders newest first without mutating the input', () => {
    const input = [result({ id: 'old', date: '2024-05-01' }), result({ id: 'new', date: '2026-08-01' })];
    const sorted = sortResultsByDateDesc(input);
    expect(sorted.map((r) => r.id)).toEqual(['new', 'old']);
    expect(input[0].id).toBe('old');
  });
});

describe('recencyWeight', () => {
  it('gives full weight to a result from today', () => {
    expect(recencyWeight(0)).toBe(1);
  });

  it('halves at the documented half-life', () => {
    expect(recencyWeight(CALIBRATION_HALF_LIFE_MONTHS)).toBeCloseTo(0.5, 6);
    expect(recencyWeight(CALIBRATION_HALF_LIFE_MONTHS * 2)).toBeCloseTo(0.25, 6);
  });

  it('drops results past the maximum age entirely', () => {
    expect(recencyWeight(CALIBRATION_MAX_AGE_MONTHS)).toBe(0);
    expect(recencyWeight(CALIBRATION_MAX_AGE_MONTHS + 12)).toBe(0);
  });
});

describe('ageEquivalentTime', () => {
  it('treats an older clock time as implying a slower time today', () => {
    // 15.0 at ~46 is a better performance than 15.0 at 49, so the time it
    // implies for today is slower.
    const equivalent = ageEquivalentTime(15.0, 36, 49);
    expect(equivalent).toBeGreaterThan(15.0);
  });

  it('leaves a result from today untouched', () => {
    expect(ageEquivalentTime(15.0, 0, 49)).toBeCloseTo(15.0, 10);
  });

  it('scales with the same age model the estimator uses', () => {
    // 36 months back from 49 is age 46.
    const expected = 15.0 * (agePenaltyFactor(46) / agePenaltyFactor(49));
    expect(ageEquivalentTime(15.0, 36, 49)).toBeCloseTo(expected, 10);
  });

  it('does not adjust an athlete still under the masters age curve', () => {
    expect(ageEquivalentTime(11.0, 36, 30)).toBeCloseTo(11.0, 10);
  });
});

describe('buildRaceCalibration', () => {
  const baselineTimes = { 100: 14.0, 200: 29.0, 400: 68.0 } as const;

  it('is neutral when there are no results', () => {
    const cal = buildRaceCalibration({ results: [], baselineTimes, age: 49, now: NOW });
    expect(cal).toBe(NEUTRAL_CALIBRATION);
    expect(calibrationFactorFor(cal, 100)).toBe(1);
  });

  it('scales the model up when the athlete is slower than predicted', () => {
    // Ran 14.7 last month against a 14.0 model prediction → model is optimistic.
    const cal = buildRaceCalibration({
      results: [result({ distance: 100, timeSeconds: 14.7, date: '2026-08-15' })],
      baselineTimes,
      age: 49,
      now: NOW,
    });
    expect(cal.factors[100]).toBeGreaterThan(1);
    expect(cal.factors[100]).toBeCloseTo(14.7 / 14.0, 2);
    expect(cal.calibratedDistances).toEqual([100]);
  });

  it('scales the model down when the athlete is faster than predicted', () => {
    const cal = buildRaceCalibration({
      results: [result({ distance: 200, timeSeconds: 27.5, date: '2026-08-15' })],
      baselineTimes,
      age: 49,
      now: NOW,
    });
    expect(cal.factors[200]).toBeLessThan(1);
    expect(cal.factors[200]).toBeCloseTo(27.5 / 29.0, 2);
  });

  it('lets a lone stale result steer the model less than a recent one', () => {
    const recent = buildRaceCalibration({
      results: [result({ distance: 100, timeSeconds: 15.0, date: '2026-08-01' })],
      baselineTimes, age: 49, now: NOW,
    });
    const stale = buildRaceCalibration({
      results: [result({ distance: 100, timeSeconds: 15.0, date: '2023-09-01' })],
      baselineTimes, age: 49, now: NOW,
    });

    // Both say the model is optimistic, but thin, old evidence is shrunk
    // toward neutral rather than applied in full.
    expect(recent.factors[100]).toBeGreaterThan(1);
    expect(stale.factors[100]).toBeGreaterThan(1);
    expect(stale.factors[100]).toBeLessThan(recent.factors[100]);
  });

  it('weights a recent result above an older, conflicting one', () => {
    const cal = buildRaceCalibration({
      results: [
        result({ id: 'old', distance: 100, timeSeconds: 13.0, date: '2023-09-01' }),
        result({ id: 'new', distance: 100, timeSeconds: 15.0, date: '2026-08-15' }),
      ],
      baselineTimes, age: 49, now: NOW,
    });
    const midpoint = (13.0 / 14.0 + 15.0 / 14.0) / 2;
    expect(cal.factors[100]).toBeGreaterThan(midpoint);
    expect(cal.resultCount).toBe(2);
  });

  it('ignores results beyond the maximum age', () => {
    const cal = buildRaceCalibration({
      results: [result({ distance: 100, timeSeconds: 15.0, date: '2018-05-01' })],
      baselineTimes, age: 49, now: NOW,
    });
    expect(cal).toBe(NEUTRAL_CALIBRATION);
  });

  it('applies the correction in full once the evidence is current and plentiful', () => {
    // Two recent results at the same distance carry enough combined weight
    // that no shrinkage is applied.
    const cal = buildRaceCalibration({
      results: [
        result({ id: 'a', distance: 100, timeSeconds: 15.0, date: '2026-08-01' }),
        result({ id: 'b', distance: 100, timeSeconds: 15.0, date: '2026-07-01' }),
      ],
      baselineTimes, age: 49, now: NOW,
    });
    expect(cal.factors[100]).toBeGreaterThan(15.0 / 14.0 - 0.02);
  });

  it('transfers a damped correction to distances with no result', () => {
    const cal = buildRaceCalibration({
      results: [result({ distance: 200, timeSeconds: 31.9, date: '2026-08-15' })],
      baselineTimes, age: 49, now: NOW,
    });
    const directDelta = cal.factors[200] - 1;

    expect(cal.calibratedDistances).toEqual([200]);
    // 100 m and 400 m move the same way, but only half as far.
    expect(cal.factors[100] - 1).toBeCloseTo(directDelta * 0.5, 2);
    expect(cal.factors[400] - 1).toBeCloseTo(directDelta * 0.5, 2);
  });

  it('calibrates each distance from its own result when several exist', () => {
    const cal = buildRaceCalibration({
      results: [
        result({ id: 'a', distance: 100, timeSeconds: 14.7, date: '2026-08-15' }),
        result({ id: 'b', distance: 400, timeSeconds: 66.0, date: '2026-08-15' }),
      ],
      baselineTimes, age: 49, now: NOW,
    });
    expect(cal.factors[100]).toBeGreaterThan(1);
    expect(cal.factors[400]).toBeLessThan(1);
    expect(cal.calibratedDistances).toEqual([100, 400]);
  });

  it('clamps an implausible correction rather than trusting it', () => {
    // A time at the very edge of the accepted range against a fast model.
    const cal = buildRaceCalibration({
      results: [result({ distance: 100, timeSeconds: 44, date: '2026-08-15' })],
      baselineTimes, age: 49, now: NOW,
    });
    expect(cal.factors[100]).toBe(CALIBRATION_FACTOR_MAX);
  });

  it('clamps in the fast direction too', () => {
    const cal = buildRaceCalibration({
      results: [result({ distance: 100, timeSeconds: 10.0, date: '2026-08-15' })],
      baselineTimes, age: 49, now: NOW,
    });
    expect(cal.factors[100]).toBe(CALIBRATION_FACTOR_MIN);
  });

  it('skips distances the model could not predict', () => {
    const cal = buildRaceCalibration({
      results: [result({ distance: 100, timeSeconds: 14.7, date: '2026-08-15' })],
      baselineTimes: { 200: 29.0 },
      age: 49,
      now: NOW,
    });
    expect(cal).toBe(NEUTRAL_CALIBRATION);
  });

  it('reports the most recent contributing result', () => {
    const cal = buildRaceCalibration({
      results: [
        result({ id: 'a', distance: 100, timeSeconds: 14.7, date: '2025-06-01' }),
        result({ id: 'b', distance: 200, timeSeconds: 30.0, date: '2026-08-15' }),
      ],
      baselineTimes, age: 49, now: NOW,
    });
    expect(cal.mostRecentDate).toBe('2026-08-15');
  });
});

describe('calibrationFactorFor', () => {
  it('falls back to 1 for missing or nonsensical calibration', () => {
    expect(calibrationFactorFor(null, 100)).toBe(1);
    expect(calibrationFactorFor(undefined, 200)).toBe(1);
    expect(calibrationFactorFor({ ...NEUTRAL_CALIBRATION, factors: { 100: 0, 200: -1, 400: Number.NaN } }, 100)).toBe(1);
    expect(calibrationFactorFor({ ...NEUTRAL_CALIBRATION, factors: { 100: 0, 200: -1, 400: Number.NaN } }, 400)).toBe(1);
  });
});
