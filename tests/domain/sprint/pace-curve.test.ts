import { describe, it, expect } from 'vitest';
import {
  DEFAULT_PACE_CURVE_DISTANCES,
  MAX_ACTIVE_DISTANCES,
  MAX_NULL_SAMPLE_RATE,
  MAX_PLAUSIBLE_SPEED,
  PACE_CURVE_PRESET_DISTANCES,
  PaceCurveActivityStream,
  addPaceCurveDistance,
  computePaceCurve,
  formatCurveTime,
  formatPacePerKm,
  paceCurveMonotonicityViolations,
  paceCurveWindowStart,
  paceCurveWindowDays,
  parsePaceCurveDistances,
  removePaceCurveDistance,
  speedCeiling,
  togglePaceCurveDistance,
  VMAX_HEADROOM,
} from '../../../src/domain/sprint/pace-curve';

/**
 * Unit tests for the sprint pace curve.
 *
 * The computation is deliberately exercised against hand-built streams whose
 * correct answer can be worked out on paper, so a failure points at the
 * sliding window rather than at fixture drift.
 */

/** A stream running at a constant speed for `seconds`, 1 Hz, distance integrated. */
function constantStream(
  speed: number,
  seconds: number,
  overrides: Partial<PaceCurveActivityStream> = {},
): PaceCurveActivityStream {
  const velocitySmooth = Array.from({ length: seconds }, () => speed);
  return {
    activityId: 'act_test',
    name: 'Test session',
    date: '2026-09-01',
    velocitySmooth,
    ...overrides,
  };
}

/** Cumulative distance for a velocity stream sampled at 1 Hz. */
function integrate(velocity: Array<number | null>): Array<number | null> {
  let total = 0;
  return velocity.map((v) => {
    if (v === null) return null;
    total += v;
    return total;
  });
}

describe('pace-curve — distance selection', () => {
  it('defaults to the standard masters sprint distances', () => {
    expect(DEFAULT_PACE_CURVE_DISTANCES).toEqual([30, 60, 100, 200, 400]);
  });

  it('offers the sprint preset ladder in ascending order', () => {
    const ladder = [...PACE_CURVE_PRESET_DISTANCES];
    expect(ladder).toEqual([...ladder].sort((a, b) => a - b));
    expect(ladder).toContain(10);
    expect(ladder).toContain(400);
  });

  it('inserts a custom distance in ascending order regardless of when it was added', () => {
    const result = addPaceCurveDistance([40, 60, 100], 45);
    expect(result).toEqual({ ok: true, distances: [40, 45, 60, 100] });
  });

  it('rejects a duplicate rather than silently merging it', () => {
    const result = addPaceCurveDistance([30, 60], 60);
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.message).toContain('already on the curve');
  });

  it('rejects distances outside 5–400 m with a specific message', () => {
    for (const bad of [3, 4, 401, 500]) {
      const result = addPaceCurveDistance([100], bad);
      expect(result.ok).toBe(false);
      expect(result.ok === false && result.message).toContain('between 5 m and 400 m');
    }
  });

  it('accepts the exact bounds', () => {
    expect(addPaceCurveDistance([100], 5).ok).toBe(true);
    expect(addPaceCurveDistance([100], 400).ok).toBe(true);
  });

  it('rejects a non-integer distance', () => {
    const result = addPaceCurveDistance([100], 45.5);
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.message).toContain('whole number');
  });

  it('refuses a thirteenth distance', () => {
    const twelve = [5, 10, 20, 30, 40, 60, 80, 100, 150, 200, 300, 400];
    expect(twelve).toHaveLength(MAX_ACTIVE_DISTANCES);
    const result = addPaceCurveDistance(twelve, 250);
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.message).toContain('at most 12 distances');
  });

  it('refuses to remove the last remaining distance', () => {
    const result = removePaceCurveDistance([100], 100);
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.message).toContain('at least one distance');
  });

  it('removes a distance when others remain', () => {
    expect(removePaceCurveDistance([30, 60, 100], 60)).toEqual({ ok: true, distances: [30, 100] });
  });

  it('toggles a preset off when selected and on when not', () => {
    expect(togglePaceCurveDistance([30, 60], 60)).toEqual({ ok: true, distances: [30] });
    expect(togglePaceCurveDistance([30, 60], 100)).toEqual({ ok: true, distances: [30, 60, 100] });
  });
});

describe('pace-curve — stored selection is untrusted', () => {
  it('round-trips a valid payload, sorted and de-duplicated', () => {
    expect(parsePaceCurveDistances({ distances: [100, 30, 100, 60] })).toEqual([30, 60, 100]);
  });

  it('falls back to defaults for a corrupt payload rather than throwing', () => {
    for (const corrupt of [
      { distances: ['banana'] },
      { distances: [] },
      { distances: [1000] },
      { distances: [2] },
      { distances: 100 },
      null,
      'nope',
      42,
      {},
    ]) {
      expect(parsePaceCurveDistances(corrupt)).toEqual([...DEFAULT_PACE_CURVE_DISTANCES]);
    }
  });

  it('falls back to defaults when a stored payload exceeds the active limit', () => {
    const thirteen = [5, 10, 15, 20, 30, 40, 60, 80, 100, 150, 200, 300, 400];
    expect(parsePaceCurveDistances({ distances: thirteen })).toEqual([...DEFAULT_PACE_CURVE_DISTANCES]);
  });
});

describe('pace-curve — date ranges', () => {
  const now = new Date('2026-09-05T09:00:00.000Z');

  it('offers rolling windows counted back from today', () => {
    expect(paceCurveWindowStart(30, now)).toBe('2026-08-06');
    expect(paceCurveWindowStart(60, now)).toBe('2026-07-07');
    expect(paceCurveWindowStart(90, now)).toBe('2026-06-07');
  });

  it('treats season-to-date as the calendar year', () => {
    expect(paceCurveWindowStart('season', now)).toBe('2026-01-01');
  });

  it('reports a fetch window wide enough for the longest selectable range', () => {
    expect(paceCurveWindowDays(now)).toBe(248);
    // In January the season is shorter than the 90-day rolling window.
    expect(paceCurveWindowDays(new Date('2026-01-10T09:00:00.000Z'))).toBe(90);
  });
});

describe('pace-curve — sliding window', () => {
  it('finds the best time over a constant-speed stream', () => {
    const curve = computePaceCurve({
      streams: [constantStream(8, 30)],
      distances: [100],
    });
    // 100 m at 8 m/s is 12.5 s, and interpolation must recover the half second
    // that 1 Hz sampling would otherwise round away.
    expect(curve.points[0].timeSeconds).toBeCloseTo(12.5, 2);
    expect(curve.points[0].speed).toBeCloseTo(8, 2);
  });

  it('integrates velocity rather than trusting a disagreeing distance stream', () => {
    // The two streams disagree: velocity says 5 m/s, the distance stream
    // claims twice the ground covered. Believing the distance stream would
    // report an average of 10 m/s over a run whose own velocity trace never
    // exceeded 5 — an average cannot beat the peak it is drawn from.
    const velocitySmooth = Array.from({ length: 40 }, () => 5);
    const distance = velocitySmooth.map((_, i) => (i + 1) * 10);
    const curve = computePaceCurve({
      streams: [constantStream(5, 40, { distance })],
      distances: [100],
    });
    expect(curve.points[0].timeSeconds).toBeCloseTo(20, 1);
    expect(curve.points[0].speed!).toBeLessThanOrEqual(5);
  });

  it('falls back to the distance stream when there is no usable velocity trace', () => {
    // Manual or indoor entries carry distance but no velocity samples.
    const velocitySmooth = Array.from({ length: 40 }, () => 0);
    const distance = velocitySmooth.map((_, i) => i * 10);
    const curve = computePaceCurve({
      streams: [constantStream(0, 0, { velocitySmooth, distance })],
      distances: [100],
    });
    expect(curve.points[0].timeSeconds).toBeCloseTo(10, 1);
  });

  it('honours a non-uniform time stream instead of assuming 1 Hz', () => {
    const velocitySmooth = Array.from({ length: 20 }, () => 5);
    // Samples every 2 seconds — 5 m/s integrated over 2 s is 10 m per sample.
    const time = velocitySmooth.map((_, i) => i * 2);
    const curve = computePaceCurve({
      streams: [constantStream(5, 20, { time })],
      distances: [100],
    });
    expect(curve.points[0].timeSeconds).toBeCloseTo(20, 1);
  });

  it('picks the fastest window, not the first', () => {
    // Slow 100 m, then a fast one. The fast one must win.
    const velocitySmooth = [...Array.from({ length: 25 }, () => 4), ...Array.from({ length: 15 }, () => 8)];
    const curve = computePaceCurve({
      streams: [constantStream(0, 0, { velocitySmooth, distance: integrate(velocitySmooth) })],
      distances: [100],
    });
    expect(curve.points[0].timeSeconds).toBeCloseTo(12.5, 1);
  });

  it('reports the source activity, its date, time and speed for each point', () => {
    const curve = computePaceCurve({
      streams: [
        constantStream(6, 40, { activityId: 'act_slow', name: 'Easy run', date: '2026-08-01' }),
        constantStream(9, 40, { activityId: 'act_fast', name: 'Track session', date: '2026-08-20' }),
      ],
      distances: [100],
    });
    expect(curve.points[0]).toMatchObject({
      distance: 100,
      activityId: 'act_fast',
      activityName: 'Track session',
      date: '2026-08-20',
    });
    expect(curve.points[0].timeSeconds).toBeCloseTo(100 / 9, 1);
  });

  it('returns no data rather than zero when nothing covers the distance', () => {
    const curve = computePaceCurve({
      streams: [constantStream(8, 20)],
      distances: [100, 300],
    });
    expect(curve.points[0].timeSeconds).not.toBeNull();
    expect(curve.points[1]).toMatchObject({
      distance: 300,
      timeSeconds: null,
      speed: null,
      activityId: null,
      activityName: null,
      date: null,
    });
  });

  it('handles empty and single-sample streams without throwing', () => {
    const empty = computePaceCurve({
      streams: [constantStream(0, 0, { velocitySmooth: [] }), constantStream(0, 0, { velocitySmooth: [8] })],
      distances: [30, 100],
    });
    expect(empty.points.map((p) => p.timeSeconds)).toEqual([null, null]);
    expect(empty.excludedActivities).toBe(0);
  });

  it('ignores activities before the window start', () => {
    const curve = computePaceCurve({
      streams: [
        constantStream(9, 40, { activityId: 'act_old', date: '2026-05-01' }),
        constantStream(7, 40, { activityId: 'act_new', date: '2026-08-01' }),
      ],
      distances: [100],
      since: '2026-06-07',
    });
    expect(curve.points[0].activityId).toBe('act_new');
    expect(curve.activitiesUsed).toBe(1);
  });

  it('returns points in ascending distance order however they were supplied', () => {
    const curve = computePaceCurve({
      streams: [constantStream(8, 60)],
      distances: [200, 30, 100, 30],
    });
    expect(curve.points.map((p) => p.distance)).toEqual([30, 100, 200]);
  });
});

describe('pace-curve — outlier rejection', () => {
  it('applies the absolute physiological ceiling when no athlete Vmax is known', () => {
    expect(speedCeiling(undefined)).toBe(MAX_PLAUSIBLE_SPEED);
    expect(speedCeiling(0)).toBe(MAX_PLAUSIBLE_SPEED);
    expect(speedCeiling(-1)).toBe(MAX_PLAUSIBLE_SPEED);
  });

  it('tightens the ceiling to 115% of the athlete 60-day Vmax', () => {
    expect(speedCeiling(8.92)).toBeCloseTo(8.92 * VMAX_HEADROOM, 5);
    // Never looser than the absolute limit, however fast the account claims.
    expect(speedCeiling(50)).toBe(MAX_PLAUSIBLE_SPEED);
  });

  it('excludes a GPS spike that implies 100 m in one second', () => {
    // 30 s of genuine 6 m/s running, then one sample that jumps 100 m.
    const velocitySmooth = [...Array.from({ length: 30 }, () => 6), 100, ...Array.from({ length: 30 }, () => 6)];
    const distance = integrate(velocitySmooth);
    const curve = computePaceCurve({
      streams: [constantStream(0, 0, { velocitySmooth, distance })],
      distances: [100],
    });
    expect(curve.excludedEfforts).toBe(1);
    // The surviving best comes from the legitimate 6 m/s running either side.
    expect(curve.points[0].timeSeconds).toBeCloseTo(100 / 6, 1);
    expect(curve.points[0].speed! * 1).toBeLessThan(MAX_PLAUSIBLE_SPEED);
  });

  it('reports no data rather than an implausible time when the spike is all there is', () => {
    const velocitySmooth = [6, 6, 100, 6, 6];
    const curve = computePaceCurve({
      streams: [constantStream(0, 0, { velocitySmooth, distance: integrate(velocitySmooth) })],
      distances: [100],
    });
    expect(curve.points[0].timeSeconds).toBeNull();
    expect(curve.excludedEfforts).toBe(1);
  });

  it('counts one exclusion per contiguous artifact, not per corrupt sample', () => {
    const clean = Array.from({ length: 20 }, () => 6);
    const velocitySmooth = [...clean, 60, 60, 60, ...clean, 80, ...clean];
    const curve = computePaceCurve({
      streams: [constantStream(0, 0, { velocitySmooth, distance: integrate(velocitySmooth) })],
      distances: [60],
    });
    expect(curve.excludedEfforts).toBe(2);
  });

  it('rejects a candidate faster than 115% of the athlete own Vmax', () => {
    // 11 m/s is under the absolute ceiling but far past an 8 m/s athlete.
    const velocitySmooth = Array.from({ length: 30 }, () => 11);
    const curve = computePaceCurve({
      streams: [constantStream(0, 0, { velocitySmooth, distance: integrate(velocitySmooth) })],
      distances: [100],
      bestVmax60d: 8,
    });
    expect(curve.points[0].timeSeconds).toBeNull();
    expect(curve.excludedEfforts).toBeGreaterThan(0);
  });

  it('keeps the same effort when the athlete Vmax makes it plausible', () => {
    const velocitySmooth = Array.from({ length: 30 }, () => 11);
    const curve = computePaceCurve({
      streams: [constantStream(0, 0, { velocitySmooth, distance: integrate(velocitySmooth) })],
      distances: [100],
      bestVmax60d: 11,
    });
    expect(curve.points[0].timeSeconds).toBeCloseTo(100 / 11, 1);
    expect(curve.excludedEfforts).toBe(0);
  });

  it('drops an activity whose stream is more than 10% GPS dropout', () => {
    // 20 samples, 3 of them null — 15%, past the threshold.
    const velocitySmooth: Array<number | null> = Array.from({ length: 20 }, (_, i) =>
      i === 4 || i === 9 || i === 14 ? null : 8,
    );
    const curve = computePaceCurve({
      streams: [constantStream(0, 0, { velocitySmooth })],
      distances: [30],
    });
    expect(curve.excludedActivities).toBe(1);
    expect(curve.activitiesUsed).toBe(0);
    expect(curve.points[0].timeSeconds).toBeNull();
  });

  it('keeps an activity at exactly the dropout threshold', () => {
    const velocitySmooth: Array<number | null> = Array.from({ length: 20 }, (_, i) =>
      i === 4 || i === 9 ? null : 8,
    );
    expect(2 / 20).toBe(MAX_NULL_SAMPLE_RATE);
    const curve = computePaceCurve({
      streams: [constantStream(0, 0, { velocitySmooth })],
      distances: [30],
    });
    expect(curve.excludedActivities).toBe(0);
    expect(curve.points[0].timeSeconds).not.toBeNull();
  });

  it('does not integrate across a dropout as though it were continuous running', () => {
    // Twelve samples of running, a dropout, then twelve more. Each side spans
    // 88 m, so 60 m is found but 100 m has no data — even though the summed
    // velocity across the whole stream is nearly 200 m.
    const velocitySmooth: Array<number | null> = [...Array.from({ length: 12 }, () => 8), null, ...Array.from({ length: 12 }, () => 8)];
    const curve = computePaceCurve({
      streams: [constantStream(0, 0, { velocitySmooth })],
      distances: [60, 100],
    });
    expect(curve.points[0].timeSeconds).toBeCloseTo(7.5, 1);
    expect(curve.points[1].timeSeconds).toBeNull();
  });

  it('ignores a backwards distance stream even when velocity is unavailable', () => {
    const velocitySmooth = Array.from({ length: 30 }, () => 8);
    const distance = velocitySmooth.map((_, i) => (i < 15 ? i * 8 : 0));
    const curve = computePaceCurve({
      streams: [constantStream(0, 0, { velocitySmooth, distance })],
      distances: [100],
    });
    expect(curve.points[0].timeSeconds).toBeCloseTo(12.5, 1);
    expect(curve.excludedEfforts).toBe(0);
  });
});

describe('pace-curve — monotonicity invariant', () => {
  /** An accelerate–hold–decay rep, the shape every real sprint effort has. */
  const REP = [1.4, 3.2, 5.0, 6.4, 7.1, 7.6, 7.9, 7.9, 7.8, 7.6, 7.3, 7.0, 6.6, 6.2, 5.8];

  it('holds for a curve built from realistic sprint reps', () => {
    const velocitySmooth = [
      ...Array.from({ length: 20 }, () => 0.4),
      ...REP,
      ...Array.from({ length: 30 }, () => 0.4),
      ...REP,
      ...Array.from({ length: 60 }, () => 3.0),
    ];
    const curve = computePaceCurve({
      streams: [constantStream(0, 0, { velocitySmooth, distance: integrate(velocitySmooth) })],
      distances: [10, 20, 30, 40, 60, 80, 100, 150],
    });
    expect(paceCurveMonotonicityViolations(curve)).toEqual([]);
  });

  it('holds when the fastest efforts come from different activities', () => {
    const curve = computePaceCurve({
      streams: [
        constantStream(9, 12, { activityId: 'a', name: 'Flys', date: '2026-08-01' }),
        constantStream(7.5, 60, { activityId: 'b', name: 'Reps', date: '2026-08-05' }),
        constantStream(6, 200, { activityId: 'c', name: 'Tempo', date: '2026-08-09' }),
      ],
      distances: [30, 60, 100, 200, 400],
    });
    expect(paceCurveMonotonicityViolations(curve)).toEqual([]);
  });

  it('holds when a GPS spike is removed from the middle of a session', () => {
    const velocitySmooth = [...Array.from({ length: 40 }, () => 7), 90, ...Array.from({ length: 40 }, () => 6)];
    const curve = computePaceCurve({
      streams: [constantStream(0, 0, { velocitySmooth, distance: integrate(velocitySmooth) })],
      distances: [10, 30, 60, 100, 200],
    });
    expect(paceCurveMonotonicityViolations(curve)).toEqual([]);
  });

  it('names the offending pair when an inconsistent curve is checked', () => {
    const violations = paceCurveMonotonicityViolations({
      points: [
        { distance: 60, timeSeconds: 9, speed: 6.67, activityId: 'a', activityName: 'A', date: '2026-08-01', submaximal: false },
        { distance: 100, timeSeconds: 8, speed: 12.5, activityId: 'a', activityName: 'A', date: '2026-08-01', submaximal: false },
      ],
      excludedEfforts: 0,
      excludedActivities: 0,
      activitiesUsed: 1,
    });
    expect(violations).toHaveLength(2);
    expect(violations[0]).toContain('100 m');
    expect(violations[0]).toContain('60 m');
  });

  it('skips over distances with no data instead of interpolating across them', () => {
    const curve = computePaceCurve({
      streams: [constantStream(8, 30)],
      distances: [60, 300, 400],
    });
    expect(curve.points.map((p) => p.timeSeconds === null)).toEqual([false, true, true]);
    expect(paceCurveMonotonicityViolations(curve)).toEqual([]);
  });
});

describe('pace-curve — performance', () => {
  it('computes 12 distances over 90 days of activity well inside 500 ms', () => {
    // 60 sessions of 45 minutes at 1 Hz — a heavier account than the target.
    const streams: PaceCurveActivityStream[] = Array.from({ length: 60 }, (_, i) => {
      const velocitySmooth = Array.from({ length: 2700 }, (_, s) => 3 + Math.sin(s / 7) * 2.5);
      return {
        activityId: `act_${i}`,
        name: `Session ${i}`,
        date: '2026-08-01',
        velocitySmooth,
        distance: integrate(velocitySmooth),
      };
    });

    const started = Date.now();
    const curve = computePaceCurve({
      streams,
      distances: [5, 10, 20, 30, 40, 60, 80, 100, 150, 200, 300, 400],
    });
    const elapsed = Date.now() - started;

    expect(curve.points).toHaveLength(12);
    expect(elapsed).toBeLessThan(500);
  });
});

describe('pace-curve — formatting', () => {
  it('shows sprint times to hundredths and longer times in minutes', () => {
    expect(formatCurveTime(12.345)).toBe('12.35');
    expect(formatCurveTime(59.99)).toBe('59.99');
    expect(formatCurveTime(65.2)).toBe('1:05.2');
    expect(formatCurveTime(125)).toBe('2:05.0');
  });

  it('converts speed to pace per kilometre', () => {
    expect(formatPacePerKm(8)).toBe('2:05 /km');
    expect(formatPacePerKm(0)).toBe('—');
  });
});
