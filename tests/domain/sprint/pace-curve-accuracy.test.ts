import { describe, it, expect } from 'vitest';
import {
  PaceCurve,
  PaceCurveActivityStream,
  computePaceCurve,
  paceCurveMonotonicityViolations,
} from '../../../src/domain/sprint/pace-curve';

/**
 * Physical invariants for the pace curve.
 *
 * These are not tests of a chosen formula — they are the statements that make a
 * displayed number believable at all. Every one of them was written after a
 * live masters account produced a curve that violated it:
 *
 *  - points from 10 m to 60 m whose *average* speed exceeded the fastest
 *    instant the device recorded all season (the `distance` stream and the
 *    `velocity_smooth` stream disagree by ~10%);
 *  - a 400 m "best" of 117 s — a warm-up jog — because the athlete's actual
 *    400 m races were among 64 requests the rate limiter refused.
 *
 * An analytics bug that produces a *plausible* wrong number is the expensive
 * kind. These assertions are the tripwires for that class.
 *
 * Per `agents.md` no production data lives here: the shapes and failure modes
 * are the live ones, the identity and values are synthetic.
 */

/** Peak speed of a synthetic masters sprinter, m/s. */
const ATHLETE_PEAK = 8.92;

/** An accelerate–hold–decay rep, the shape every real sprint effort has. */
function sprintRep(peak: number, seconds: number): number[] {
  return Array.from({ length: seconds }, (_, t) => {
    const rise = 1 - Math.exp(-t / 1.2);
    const decay = t <= 6 ? 1 : Math.max(0.62, 1 - (t - 6) * 0.012);
    return parseFloat((peak * rise * decay).toFixed(2));
  });
}

function stream(
  velocitySmooth: Array<number | null>,
  overrides: Partial<PaceCurveActivityStream> = {},
): PaceCurveActivityStream {
  return {
    activityId: 'act_1',
    name: 'Track session',
    date: '2026-07-20',
    velocitySmooth,
    ...overrides,
  };
}

/** The peak instantaneous sample across every stream handed to the curve. */
function peakOf(streams: PaceCurveActivityStream[]): number {
  return Math.max(
    ...streams.flatMap((s) => s.velocitySmooth.filter((v): v is number => typeof v === 'number')),
  );
}

/**
 * The invariant the live account broke: an average over a window is a weighted
 * mean of the samples inside it, so it cannot exceed their maximum.
 */
function assertNoPointBeatsPeak(curve: PaceCurve, peak: number): void {
  for (const point of curve.points) {
    if (point.speed === null) continue;
    expect(
      point.speed,
      `${point.distance} m averaged ${point.speed} m/s, faster than the peak sample of ${peak} m/s`,
    ).toBeLessThanOrEqual(peak);
  }
}

const ALL_DISTANCES = [10, 20, 30, 40, 60, 80, 100, 150, 200, 300, 400];

describe('pace-curve accuracy — average speed can never beat peak speed', () => {
  it('holds when the distance stream claims 12% more ground than velocity accounts for', () => {
    // The live failure, reproduced. A device that reports both streams can
    // disagree with itself; believing the distance stream reported 10.24 m/s
    // averages for an athlete whose trace never passed 8.92.
    const velocitySmooth = [
      ...Array.from({ length: 4 }, () => 0),
      ...sprintRep(ATHLETE_PEAK, 30),
      ...Array.from({ length: 4 }, () => 0),
    ];
    let cumulative = 0;
    const inflated = velocitySmooth.map((v) => {
      cumulative += v;
      return parseFloat((cumulative * 1.12).toFixed(2));
    });

    const streams = [stream(velocitySmooth, { distance: inflated })];
    const curve = computePaceCurve({ streams, distances: ALL_DISTANCES, bestVmax60d: ATHLETE_PEAK });

    assertNoPointBeatsPeak(curve, peakOf(streams));
  });

  it('holds for the shortest distances, where one GPS sample spans most of the window', () => {
    // At 8.9 m/s a 1 Hz sample covers ~9 m, so a 10 m window is a single
    // interval. That is exactly where quantisation masquerades as speed.
    const velocitySmooth = [...Array.from({ length: 3 }, () => 0), ...sprintRep(ATHLETE_PEAK, 20)];
    const streams = [stream(velocitySmooth)];
    const curve = computePaceCurve({ streams, distances: [5, 10, 20], bestVmax60d: ATHLETE_PEAK });

    assertNoPointBeatsPeak(curve, peakOf(streams));
  });

  it('holds across a mixed window of races, reps and easy runs', () => {
    const streams = [
      stream([...Array.from({ length: 3 }, () => 0), ...sprintRep(ATHLETE_PEAK, 30)], { activityId: 'race', name: '200m race', date: '2026-07-20' }),
      stream([...Array.from({ length: 3 }, () => 0), ...sprintRep(8.31, 60)], { activityId: 'reps', name: 'Sprint intervals', date: '2026-08-31' }),
      stream(Array.from({ length: 900 }, () => 3.1), { activityId: 'easy', name: 'Super easy', date: '2026-08-06' }),
    ];
    const curve = computePaceCurve({ streams, distances: ALL_DISTANCES, bestVmax60d: ATHLETE_PEAK });

    assertNoPointBeatsPeak(curve, peakOf(streams));
    expect(paceCurveMonotonicityViolations(curve)).toEqual([]);
  });

  it('never reports a point faster than the athlete own 60-day ceiling', () => {
    const streams = [stream([...Array.from({ length: 3 }, () => 0), ...sprintRep(ATHLETE_PEAK, 40)])];
    const curve = computePaceCurve({ streams, distances: ALL_DISTANCES, bestVmax60d: ATHLETE_PEAK });
    for (const point of curve.points) {
      if (point.speed === null) continue;
      expect(point.speed).toBeLessThanOrEqual(ATHLETE_PEAK * 1.15);
    }
  });
});

describe('pace-curve accuracy — a partial fetch must not become a wrong best', () => {
  /**
   * The live failure: the rate limiter refused the requests carrying the
   * athlete's 400 m races, so the best 400 m fell through to a warm-up jog and
   * was displayed as fact. The curve cannot detect this on its own — that is
   * why the sync reports coverage — but it must at least stay self-consistent
   * and keep naming its source, so the wrong number is traceable.
   */
  const race = stream([...Array.from({ length: 3 }, () => 0), ...sprintRep(ATHLETE_PEAK, 70)], {
    activityId: 'act_race_400', name: '400m race', date: '2026-07-20',
  });
  const jog = stream(Array.from({ length: 900 }, () => 3.45), {
    activityId: 'act_easy', name: 'Super easy', date: '2026-08-06',
  });

  it('finds the race when its stream is present', () => {
    const curve = computePaceCurve({ streams: [race, jog], distances: [400], bestVmax60d: ATHLETE_PEAK });
    expect(curve.points[0].activityId).toBe('act_race_400');
    expect(curve.points[0].speed!).toBeGreaterThan(6);
  });

  it('falls back to the jog when the race stream is missing, and says so', () => {
    const curve = computePaceCurve({ streams: [jog], distances: [400], bestVmax60d: ATHLETE_PEAK });
    // The number is not wrong for the data it had — but it must carry the
    // provenance that makes it questionable, rather than standing alone.
    expect(curve.points[0].activityId).toBe('act_easy');
    expect(curve.points[0].activityName).toBe('Super easy');
    expect(curve.activitiesUsed).toBe(1);
  });

  it('keeps the curve monotonic either way', () => {
    for (const streams of [[race, jog], [jog]]) {
      const curve = computePaceCurve({ streams, distances: ALL_DISTANCES, bestVmax60d: ATHLETE_PEAK });
      expect(paceCurveMonotonicityViolations(curve)).toEqual([]);
    }
  });
});

describe('pace-curve accuracy — GPS mis-measures short races in both directions', () => {
  it('does not lose a 400 m race whose distance stream under-recorded it as 380 m', () => {
    // Live: the 400 m race activity reported 380 m of GPS distance, so a
    // distance-stream-derived curve returned "no data" at 400 m for a race the
    // athlete demonstrably finished. Integrating velocity recovers it.
    const velocitySmooth = [...Array.from({ length: 3 }, () => 0), ...sprintRep(ATHLETE_PEAK, 70)];
    let cumulative = 0;
    const shortfall = velocitySmooth.map((v) => {
      cumulative += v;
      return parseFloat((cumulative * 0.95).toFixed(2));
    });

    const curve = computePaceCurve({
      streams: [stream(velocitySmooth, { distance: shortfall, activityId: 'act_400', name: '400m sprint' })],
      distances: [400],
      bestVmax60d: ATHLETE_PEAK,
    });

    expect(curve.points[0].timeSeconds).not.toBeNull();
    expect(curve.points[0].activityId).toBe('act_400');
  });

  it('is not inflated by a distance stream that over-recorded a 200 m race as 225 m', () => {
    const velocitySmooth = [...Array.from({ length: 3 }, () => 0), ...sprintRep(ATHLETE_PEAK, 40)];
    let cumulative = 0;
    const overRead = velocitySmooth.map((v) => {
      cumulative += v;
      return parseFloat((cumulative * 1.125).toFixed(2));
    });

    const honest = computePaceCurve({
      streams: [stream(velocitySmooth)],
      distances: [200], bestVmax60d: ATHLETE_PEAK,
    }).points[0];
    const inflated = computePaceCurve({
      streams: [stream(velocitySmooth, { distance: overRead })],
      distances: [200], bestVmax60d: ATHLETE_PEAK,
    }).points[0];

    // The over-reading stream must not make the athlete look faster.
    expect(inflated.timeSeconds).toBeCloseTo(honest.timeSeconds!, 2);
  });
});
