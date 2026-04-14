import { describe, it, expect } from 'vitest';
import { SprintParser, TrackInterval } from '../../../src/domain/sprint/parser';

/**
 * Tests for README §3.1 — Velocity Metric Extraction
 *
 * The system must identify from the velocity_smooth (1Hz) stream:
 *   - Acceleration (0–30m): Slope of velocity increase from V < 1m/s to V_peak
 *   - Flying 10s/30s: Peak velocity maintained over a 10m–30m window
 *   - Speed Endurance: Velocity maintenance in intervals > 80m
 */

// Helper: generate a simulated 1Hz velocity stream for a sprint rep.
// At 1Hz, each sample ≈ velocity in m/s, and distance ≈ cumulative sum.
function buildSprintStream(phases: { velocity: number; seconds: number }[]): number[] {
  const stream: number[] = [];
  for (const phase of phases) {
    for (let i = 0; i < phase.seconds; i++) {
      stream.push(phase.velocity);
    }
  }
  return stream;
}

describe('SprintParser.parseTrackSession (§3.1)', () => {
  it('returns empty array for empty velocity stream', () => {
    const result = SprintParser.parseTrackSession({ velocity_smooth: [] });
    expect(result).toEqual([]);
  });

  it('returns empty array when activity has no velocity_smooth', () => {
    const result = SprintParser.parseTrackSession({});
    expect(result).toEqual([]);
  });

  it('identifies an Acceleration interval from a short sprint burst', () => {
    // Simulate: 2s standing still, ramp up to ~9 m/s over ~4s, then stop
    const stream = [0, 0.5, 2.0, 5.0, 7.5, 9.0, 9.2, 3.0, 0.5, 0];
    const result = SprintParser.parseTrackSession({ velocity_smooth: stream });

    const accelIntervals = result.filter(i => i.type === 'Acceleration');
    expect(accelIntervals.length).toBeGreaterThanOrEqual(1);
  });

  it('identifies MaxVelocity interval from a flying sprint', () => {
    // Simulate a ~52m effort (burst distance 40-80m → MaxVelocity)
    const stream = [
      0, 0.5,
      3.0, 7.0, 9.5, 9.8, 9.7, 9.5, 3.0, // burst = 51.5m
      0.5, 0,
    ];
    const result = SprintParser.parseTrackSession({ velocity_smooth: stream });
    const types = result.map(i => i.type);
    // Should contain a MaxVelocity or at least detect the sustained high-speed segment
    expect(types).toContain('MaxVelocity');
  });

  it('identifies SpeedEndurance interval from a long rep (>80m)', () => {
    // ~100m effort: held around 9 m/s for ~11 seconds ≈ 99m
    const stream = [
      0, 0.5, 2.0, 5.0, 8.0, 9.0,
      9.0, 9.0, 9.0, 9.0, 9.0, 9.0, 9.0, 9.0, 9.0, 9.0, 9.0,
      4.0, 1.0, 0,
    ];
    const result = SprintParser.parseTrackSession({ velocity_smooth: stream });
    const types = result.map(i => i.type);
    expect(types).toContain('SpeedEndurance');
  });

  it('extracts vMax (peak velocity) from each interval', () => {
    const stream = [0, 0.5, 5.0, 8.0, 10.2, 10.5, 10.3, 3.0, 0];
    const result = SprintParser.parseTrackSession({ velocity_smooth: stream });
    expect(result.length).toBeGreaterThanOrEqual(1);
    // vMax should be the peak value from the burst
    expect(result[0].vMax).toBeCloseTo(10.5, 1);
  });

  it('extracts flying velocity (peak sustained) metric', () => {
    // The parser should expose a flyingVelocity or similar field
    const stream = [0, 0.5, 5.0, 8.0, 10.2, 10.5, 10.4, 10.3, 10.2, 3.0, 0];
    const result = SprintParser.parseTrackSession({ velocity_smooth: stream });
    expect(result.length).toBeGreaterThanOrEqual(1);
    // flyingVelocity should exist and be the average of the top sustained window
    if (result[0].flyingVelocity !== undefined) {
      expect(result[0].flyingVelocity).toBeGreaterThan(0);
    }
  });

  it('handles multiple reps in a single session', () => {
    // Two reps separated by rest
    const stream = [
      0, 0.5, 5.0, 8.0, 9.5, 9.0, 3.0, 0, 0, 0, // Rep 1
      0, 0.5, 5.0, 8.5, 10.0, 9.5, 3.0, 0,        // Rep 2
    ];
    const result = SprintParser.parseTrackSession({ velocity_smooth: stream });
    expect(result.length).toBeGreaterThanOrEqual(2);
  });
});

describe('SprintParser — Acceleration detection per spec (§3.1)', () => {
  it('detects acceleration as the phase from V < 1m/s to V_peak', () => {
    // Spec: "Slope of velocity increase from V < 1m/s to V_peak"
    // Burst must be ≤ 40m to classify as Acceleration
    const stream = [0, 0.3, 0.8, 2.5, 5.0, 7.5, 9.2, 9.5, 0.5, 0]; // burst = 33.7m
    const result = SprintParser.parseTrackSession({ velocity_smooth: stream });
    const accel = result.find(i => i.type === 'Acceleration');
    expect(accel).toBeDefined();
    if (accel) {
      // Acceleration segment distance should be roughly 0-30m zone
      expect(accel.distance).toBeLessThanOrEqual(40);
    }
  });
});

describe('SprintParser.fromAPIInterval — Intervals.icu /activity/{id}/intervals', () => {
  it('converts a WORK interval with full data to a TrackInterval', () => {
    const result = SprintParser.fromAPIInterval({
      type: 'WORK',
      distance: 80.0,
      moving_time: 9,
      max_speed: 9.8,
      average_speed: 8.5,
    });
    expect(result).not.toBeNull();
    expect(result!.type).toBe('MaxVelocity');
    expect(result!.distance).toBe(80);
    expect(result!.vMax).toBe(9.8);
    expect(result!.duration).toBe(9);
    expect(result!.flyingVelocity).toBe(8.5);
  });

  it('classifies distances correctly from API data', () => {
    const accel = SprintParser.fromAPIInterval({ type: 'WORK', distance: 30, moving_time: 4, max_speed: 9 });
    expect(accel!.type).toBe('Acceleration');

    const maxVel = SprintParser.fromAPIInterval({ type: 'WORK', distance: 60, moving_time: 7, max_speed: 9 });
    expect(maxVel!.type).toBe('MaxVelocity');

    const se = SprintParser.fromAPIInterval({ type: 'WORK', distance: 100, moving_time: 12, max_speed: 9 });
    expect(se!.type).toBe('SpeedEndurance');

    const specialEnd = SprintParser.fromAPIInterval({ type: 'WORK', distance: 200, moving_time: 24, max_speed: 9 });
    expect(specialEnd!.type).toBe('SpecialEndurance');
  });

  it('uses elapsed_time as fallback when moving_time is absent', () => {
    const result = SprintParser.fromAPIInterval({
      type: 'WORK',
      distance: 30,
      elapsed_time: 4,
      max_speed: 9.0,
    });
    expect(result).not.toBeNull();
    expect(result!.duration).toBe(4);
  });

  it('excludes REST intervals', () => {
    const result = SprintParser.fromAPIInterval({
      type: 'REST',
      distance: 50,
      moving_time: 60,
      max_speed: 1.5,
    });
    expect(result).toBeNull();
  });

  it('excludes WARMUP intervals', () => {
    const result = SprintParser.fromAPIInterval({
      type: 'WARMUP',
      distance: 200,
      moving_time: 120,
      max_speed: 4.0,
    });
    expect(result).toBeNull();
  });

  it('excludes COOLDOWN intervals', () => {
    const result = SprintParser.fromAPIInterval({
      type: 'COOLDOWN',
      distance: 200,
      moving_time: 120,
      max_speed: 3.5,
    });
    expect(result).toBeNull();
  });

  it('includes intervals with no type (unstructured activity)', () => {
    const result = SprintParser.fromAPIInterval({
      distance: 60,
      moving_time: 7,
      max_speed: 9.2,
      average_speed: 8.6,
    });
    expect(result).not.toBeNull();
  });

  it('includes ACTIVE intervals', () => {
    const result = SprintParser.fromAPIInterval({
      type: 'ACTIVE',
      distance: 50,
      moving_time: 6,
      max_speed: 8.5,
    });
    expect(result).not.toBeNull();
  });

  it('returns null when distance is below minimum rep distance', () => {
    const result = SprintParser.fromAPIInterval({
      type: 'WORK',
      distance: 5,
      moving_time: 1,
      max_speed: 9.0,
    });
    expect(result).toBeNull();
  });

  it('returns null when max_speed is zero', () => {
    const result = SprintParser.fromAPIInterval({
      type: 'WORK',
      distance: 40,
      moving_time: 5,
      max_speed: 0,
    });
    expect(result).toBeNull();
  });

  it('uses average_speed as vMax fallback when max_speed is zero', () => {
    const result = SprintParser.fromAPIInterval({
      type: 'WORK',
      distance: 60,
      moving_time: 7,
      max_speed: 0,
      average_speed: 8.7,
    });
    expect(result).not.toBeNull();
    expect(result!.vMax).toBe(8.7);
    expect(result!.type).toBe('MaxVelocity');
  });

  it('returns null when duration is zero', () => {
    const result = SprintParser.fromAPIInterval({
      type: 'WORK',
      distance: 30,
      moving_time: 0,
      max_speed: 9.0,
    });
    expect(result).toBeNull();
  });

  it('returns null for empty interval object', () => {
    const result = SprintParser.fromAPIInterval({});
    expect(result).toBeNull();
  });

  it('flyingVelocity defaults to 0 when average_speed is absent', () => {
    const result = SprintParser.fromAPIInterval({
      type: 'WORK',
      distance: 30,
      moving_time: 4,
      max_speed: 9.0,
    });
    expect(result).not.toBeNull();
    expect(result!.flyingVelocity).toBe(0);
  });

  it('uses average_speed as vMax fallback when max_speed is absent', () => {
    // Flying 60 with no max_speed in API response — average_speed should be used
    const result = SprintParser.fromAPIInterval({
      type: 'WORK',
      distance: 60,
      moving_time: 7,
      average_speed: 8.5,
    });
    expect(result).not.toBeNull();
    expect(result!.vMax).toBe(8.5);
    expect(result!.flyingVelocity).toBe(8.5);
    expect(result!.type).toBe('MaxVelocity');
  });

  it('rejects a 400m interval (52 s duration exceeds 25 s sprint cap)', () => {
    // 400m sprint at 52 s is well above the 25 s maximum sprint duration
    const result = SprintParser.fromAPIInterval({
      type: 'WORK',
      distance: 400,
      moving_time: 52,
      max_speed: 9.0,
      average_speed: 7.7,
    });
    expect(result).toBeNull();
  });

  it('excludes intervals longer than 400m', () => {
    // 500m warm-up jog typed WORK — not a sprint interval
    const result = SprintParser.fromAPIInterval({
      type: 'WORK',
      distance: 500,
      moving_time: 120,
      max_speed: 5.0,
      average_speed: 4.2,
    });
    expect(result).toBeNull();
  });

  it('excludes RECOVERY intervals', () => {
    // Intervals.icu marks short bounce-back jogs as RECOVERY
    const result = SprintParser.fromAPIInterval({
      type: 'RECOVERY',
      distance: 7.5,
      moving_time: 1,
      max_speed: 7.5,
      average_speed: 7.5,
    });
    expect(result).toBeNull();
  });

  it('accepts INTERVAL-typed intervals (Intervals.icu auto-detected efforts)', () => {
    // Auto-detected sprint segments have type 'INTERVAL', not 'WORK'
    const result = SprintParser.fromAPIInterval({
      type: 'INTERVAL',
      distance: 60,
      moving_time: 8,
      max_speed: 8.2,
      average_speed: 7.5,
    });
    expect(result).not.toBeNull();
    expect(result!.type).toBe('MaxVelocity');
  });

  it('accepts LAP-typed intervals', () => {
    const result = SprintParser.fromAPIInterval({
      type: 'LAP',
      distance: 100,
      moving_time: 12,
      max_speed: 9.0,
      average_speed: 8.3,
    });
    expect(result).not.toBeNull();
    expect(result!.type).toBe('SpeedEndurance');
  });

  it('rejects a WORK-labeled rest period with low average speed', () => {
    // Intervals.icu sometimes labels the walk-back recovery as WORK.
    // 63m over 300 seconds (0.21 m/s average) — clearly not a sprint.
    const result = SprintParser.fromAPIInterval({
      type: 'WORK',
      distance: 63,
      moving_time: 300,
      max_speed: 6.1,       // residual max_speed from preceding sprint
      average_speed: 0.21,  // but average is walking pace
    });
    expect(result).toBeNull();
  });

  it('accepts a WORK interval without average_speed (computed pace used)', () => {
    // average_speed absent → pace check uses computed distance/time = 8.0 m/s
    const result = SprintParser.fromAPIInterval({
      type: 'WORK',
      distance: 40,
      moving_time: 5,
      max_speed: 8.0,
    });
    expect(result).not.toBeNull();
  });

  it('rejects a short interval with computed pace slower than 3:00/km', () => {
    // 15m in 5s → computed avg speed = 3.0 m/s (5:33/km) — below 3:00/km threshold
    const result = SprintParser.fromAPIInterval({
      type: 'WORK',
      distance: 15,
      moving_time: 5,
      max_speed: 8.5,
      average_speed: 2.95,
    });
    expect(result).toBeNull();
  });

  it('rejects an interval with computed pace slower than 3:00/km', () => {
    // 15m in 10s → computed avg speed = 1.5 m/s — well below pace threshold
    const result = SprintParser.fromAPIInterval({
      type: 'WORK',
      distance: 15,
      moving_time: 10,
      max_speed: 5.0,
      average_speed: 1.5,
    });
    expect(result).toBeNull();
  });

  it('rejects intervals exceeding 25 s (sprint duration cap)', () => {
    // 100m in 35 s — duration exceeds max sprint duration even though pace is fast enough
    const result = SprintParser.fromAPIInterval({
      type: 'WORK',
      distance: 100,
      moving_time: 35,
      max_speed: 6.0,
      average_speed: 2.86,
    });
    expect(result).toBeNull();
  });
});

/**
 * Common sprint distances — ensure 30m, 60m, 90m, 100m, 120m, 150m are all detected
 * from both API intervals and velocity streams with realistic time & pace data.
 *
 * Criteria: pace faster than 3:00/km (>5.56 m/s) and duration ≤ 25 s.
 *
 * Reference paces (recreational → competitive):
 *   30m:  4.2–5.3s  (avg 5.7–7.1 m/s)
 *   60m:  7.5–9.5s  (avg 6.3–8.0 m/s)
 *   90m: 11–14s     (avg 6.4–8.2 m/s)
 *  100m: 12–16s     (avg 6.3–8.3 m/s)
 *  120m: 15–20s     (avg 6.0–8.0 m/s)
 *  150m: 19–25s     (avg 6.0–7.9 m/s)
 */
describe('SprintParser — common sprint distance detection (30m, 60m, 90m, 100m, 120m, 150m)', () => {
  // ----- 30m -----
  it('detects a 30m sprint from API interval (competitive: 4.2s)', () => {
    const result = SprintParser.fromAPIInterval({
      type: 'WORK',
      distance: 30,
      moving_time: 4.2,
      max_speed: 9.5,
      average_speed: 7.14,  // 30 / 4.2
    });
    expect(result).not.toBeNull();
    expect(result!.distance).toBe(30);
    expect(result!.type).toBe('Acceleration');
    expect(result!.vMax).toBe(9.5);
    expect(result!.duration).toBe(4.2);
    expect(result!.flyingVelocity).toBe(7.14);
  });

  it('detects a 30m sprint from API interval (recreational: 5.0s)', () => {
    const result = SprintParser.fromAPIInterval({
      type: 'WORK',
      distance: 30,
      moving_time: 5.0,
      max_speed: 7.5,
      average_speed: 6.0,  // 30 / 5.0 = 6.0 m/s — above 3:00/km threshold
    });
    expect(result).not.toBeNull();
    expect(result!.distance).toBe(30);
    expect(result!.type).toBe('Acceleration');
  });

  it('detects a 30m sprint from velocity stream', () => {
    // ~30m: 4s acceleration phase then stop
    const stream = [0, 0, 3.0, 6.0, 8.5, 9.5, 3.0, 0];
    const result = SprintParser.parseTrackSession({ velocity_smooth: stream });
    expect(result.length).toBeGreaterThanOrEqual(1);
    expect(result[0].type).toBe('Acceleration');
    expect(result[0].distance).toBeGreaterThanOrEqual(10);
    expect(result[0].distance).toBeLessThanOrEqual(40);
  });

  // ----- 60m -----
  it('detects a 60m sprint from API interval (competitive: 7.5s)', () => {
    const result = SprintParser.fromAPIInterval({
      type: 'WORK',
      distance: 60,
      moving_time: 7.5,
      max_speed: 10.2,
      average_speed: 8.0,  // 60 / 7.5
    });
    expect(result).not.toBeNull();
    expect(result!.distance).toBe(60);
    expect(result!.type).toBe('MaxVelocity');
    expect(result!.vMax).toBe(10.2);
    expect(result!.duration).toBe(7.5);
    expect(result!.flyingVelocity).toBe(8.0);
  });

  it('detects a 60m sprint from API interval (recreational: 9.5s)', () => {
    const result = SprintParser.fromAPIInterval({
      type: 'WORK',
      distance: 60,
      moving_time: 9.5,
      max_speed: 7.8,
      average_speed: 6.32,  // 60 / 9.5
    });
    expect(result).not.toBeNull();
    expect(result!.distance).toBe(60);
    expect(result!.type).toBe('MaxVelocity');
  });

  it('detects a 60m sprint from velocity stream', () => {
    // ~60m burst: accel then maintain speed
    const stream = [0, 0, 3.0, 6.0, 9.0, 10.0, 10.0, 10.0, 9.5, 3.0, 0];
    const result = SprintParser.parseTrackSession({ velocity_smooth: stream });
    expect(result.length).toBeGreaterThanOrEqual(1);
    expect(result[0].type).toBe('MaxVelocity');
    expect(result[0].distance).toBeGreaterThanOrEqual(40);
    expect(result[0].distance).toBeLessThanOrEqual(80);
  });

  // ----- 90m -----
  it('detects a 90m sprint from API interval (competitive: 11s)', () => {
    const result = SprintParser.fromAPIInterval({
      type: 'WORK',
      distance: 90,
      moving_time: 11,
      max_speed: 10.5,
      average_speed: 8.18,  // 90 / 11
    });
    expect(result).not.toBeNull();
    expect(result!.distance).toBe(90);
    expect(result!.type).toBe('SpeedEndurance');
    expect(result!.vMax).toBe(10.5);
  });

  it('detects a 90m sprint from API interval (recreational: 14s)', () => {
    const result = SprintParser.fromAPIInterval({
      type: 'WORK',
      distance: 90,
      moving_time: 14,
      max_speed: 8.0,
      average_speed: 6.43,  // 90 / 14
    });
    expect(result).not.toBeNull();
    expect(result!.distance).toBe(90);
    expect(result!.type).toBe('SpeedEndurance');
  });

  it('detects a 90m sprint from velocity stream', () => {
    // ~90m burst: accel then 10s at ~8-9 m/s
    const stream = [0, 0, 3.0, 6.0, 8.0, 9.0, 9.0, 9.0, 9.0, 9.0, 9.0, 9.0, 9.0, 3.0, 0];
    const result = SprintParser.parseTrackSession({ velocity_smooth: stream });
    expect(result.length).toBeGreaterThanOrEqual(1);
    expect(result[0].type).toBe('SpeedEndurance');
    expect(result[0].distance).toBeGreaterThanOrEqual(80);
    expect(result[0].distance).toBeLessThanOrEqual(150);
  });

  // ----- 100m -----
  it('detects a 100m sprint from API interval (competitive: 12s)', () => {
    const result = SprintParser.fromAPIInterval({
      type: 'WORK',
      distance: 100,
      moving_time: 12,
      max_speed: 10.8,
      average_speed: 8.33,  // 100 / 12
    });
    expect(result).not.toBeNull();
    expect(result!.distance).toBe(100);
    expect(result!.type).toBe('SpeedEndurance');
    expect(result!.vMax).toBe(10.8);
    expect(result!.duration).toBe(12);
    expect(result!.flyingVelocity).toBe(8.33);
  });

  it('detects a 100m sprint from API interval (recreational: 16s)', () => {
    const result = SprintParser.fromAPIInterval({
      type: 'WORK',
      distance: 100,
      moving_time: 16,
      max_speed: 8.0,
      average_speed: 6.25,  // 100 / 16
    });
    expect(result).not.toBeNull();
    expect(result!.distance).toBe(100);
    expect(result!.type).toBe('SpeedEndurance');
  });

  it('detects a 100m sprint from velocity stream', () => {
    // ~100m burst: accel then sustain at ~9 m/s
    const stream = [
      0, 0,
      3.0, 6.0, 8.0, 9.0, 9.0, 9.0, 9.0, 9.0, 9.0, 9.0, 9.0, 9.0, 9.0,
      3.0, 0,
    ];
    const result = SprintParser.parseTrackSession({ velocity_smooth: stream });
    expect(result.length).toBeGreaterThanOrEqual(1);
    expect(result[0].type).toBe('SpeedEndurance');
    expect(result[0].distance).toBeGreaterThanOrEqual(80);
    expect(result[0].distance).toBeLessThanOrEqual(150);
  });

  // ----- 120m -----
  it('detects a 120m sprint from API interval (competitive: 15s)', () => {
    const result = SprintParser.fromAPIInterval({
      type: 'WORK',
      distance: 120,
      moving_time: 15,
      max_speed: 10.5,
      average_speed: 8.0,  // 120 / 15
    });
    expect(result).not.toBeNull();
    expect(result!.distance).toBe(120);
    expect(result!.type).toBe('SpeedEndurance');
    expect(result!.vMax).toBe(10.5);
    expect(result!.duration).toBe(15);
    expect(result!.flyingVelocity).toBe(8.0);
  });

  it('detects a 120m sprint from API interval (recreational: 20s)', () => {
    const result = SprintParser.fromAPIInterval({
      type: 'WORK',
      distance: 120,
      moving_time: 20,
      max_speed: 8.0,
      average_speed: 6.0,  // 120 / 20
    });
    expect(result).not.toBeNull();
    expect(result!.distance).toBe(120);
    expect(result!.type).toBe('SpeedEndurance');
  });

  it('detects a 120m sprint from velocity stream', () => {
    // ~120m burst: accel phase + sustained ~9 m/s
    const stream = [
      0, 0,
      3.0, 6.0, 8.0, 9.0, 9.0, 9.0, 9.0, 9.0, 9.0, 9.0, 9.0, 9.0, 9.0, 9.0,
      3.0, 0,
    ];
    const result = SprintParser.parseTrackSession({ velocity_smooth: stream });
    expect(result.length).toBeGreaterThanOrEqual(1);
    expect(result[0].type).toBe('SpeedEndurance');
    expect(result[0].distance).toBeGreaterThanOrEqual(80);
    expect(result[0].distance).toBeLessThanOrEqual(150);
  });

  // ----- 150m -----
  it('detects a 150m sprint from API interval (competitive: 19s)', () => {
    const result = SprintParser.fromAPIInterval({
      type: 'WORK',
      distance: 150,
      moving_time: 19,
      max_speed: 10.5,
      average_speed: 7.89,  // 150 / 19
    });
    expect(result).not.toBeNull();
    expect(result!.distance).toBe(150);
    expect(result!.type).toBe('SpeedEndurance');
    expect(result!.vMax).toBe(10.5);
  });

  it('detects a 150m sprint from API interval (recreational: 25s)', () => {
    const result = SprintParser.fromAPIInterval({
      type: 'WORK',
      distance: 150,
      moving_time: 25,
      max_speed: 8.0,
      average_speed: 6.0,  // 150 / 25
    });
    expect(result).not.toBeNull();
    expect(result!.distance).toBe(150);
    expect(result!.type).toBe('SpeedEndurance');
  });

  it('detects a 150m sprint from velocity stream', () => {
    // ~150m burst: accel phase + sustained running at ~9 m/s
    const stream = [
      0, 0,
      3.0, 6.0, 8.0, 9.0, 9.0, 9.0, 9.0, 9.0, 9.0, 9.0, 9.0, 9.0, 9.0, 9.0, 9.0, 9.0, 9.0,
      3.0, 0,
    ];
    const result = SprintParser.parseTrackSession({ velocity_smooth: stream });
    expect(result.length).toBeGreaterThanOrEqual(1);
    expect(result[0].type).toBe('SpeedEndurance');
    expect(result[0].distance).toBeGreaterThanOrEqual(80);
    expect(result[0].distance).toBeLessThanOrEqual(160);
  });

  // ----- Multi-rep session: typical sprint workout with varied distances -----
  it('detects multiple sprint distances in a single API interval set', () => {
    const intervals = [
      { type: 'WORK', distance: 30, moving_time: 4.5, max_speed: 9.0, average_speed: 6.67 },
      { type: 'REST', distance: 30, moving_time: 120, max_speed: 1.5, average_speed: 0.25 },
      { type: 'WORK', distance: 60, moving_time: 8, max_speed: 9.5, average_speed: 7.5 },
      { type: 'REST', distance: 60, moving_time: 180, max_speed: 1.2, average_speed: 0.33 },
      { type: 'WORK', distance: 100, moving_time: 13, max_speed: 10.0, average_speed: 7.69 },
      { type: 'REST', distance: 100, moving_time: 240, max_speed: 1.0, average_speed: 0.42 },
      { type: 'WORK', distance: 120, moving_time: 17, max_speed: 10.0, average_speed: 7.06 },
      { type: 'REST', distance: 100, moving_time: 240, max_speed: 1.0, average_speed: 0.42 },
      { type: 'WORK', distance: 150, moving_time: 20, max_speed: 10.2, average_speed: 7.5 },
    ];
    const detected = intervals
      .map(i => SprintParser.fromAPIInterval(i))
      .filter((i): i is TrackInterval => i !== null);

    expect(detected.length).toBe(5); // 5 WORK intervals, 4 REST excluded
    expect(detected[0].distance).toBe(30);
    expect(detected[0].type).toBe('Acceleration');
    expect(detected[1].distance).toBe(60);
    expect(detected[1].type).toBe('MaxVelocity');
    expect(detected[2].distance).toBe(100);
    expect(detected[2].type).toBe('SpeedEndurance');
    expect(detected[3].distance).toBe(120);
    expect(detected[3].type).toBe('SpeedEndurance');
    expect(detected[4].distance).toBe(150);
    expect(detected[4].type).toBe('SpeedEndurance');
  });
});

describe('SprintParser.parseTrackSession — 400m distance and 25s duration filters', () => {
  it('excludes velocity-stream bursts longer than 400m', () => {
    // Simulate a 500m easy jog at 4 m/s for 125 seconds → distance ~500m
    const stream = Array(125).fill(4.0);
    const result = SprintParser.parseTrackSession({ velocity_smooth: stream });
    expect(result).toEqual([]);
  });

  it('excludes velocity-stream bursts exceeding 25 s (sprint duration cap)', () => {
    // 400m sprint: 44 seconds at 9 m/s → fast pace but duration > 25 s
    const stream = Array(44).fill(9.0);
    const result = SprintParser.parseTrackSession({ velocity_smooth: stream });
    expect(result).toEqual([]);
  });

  it('excludes velocity-stream bursts with pace slower than 3:00/km', () => {
    // 20 seconds at 4 m/s → 80m, avg speed 4.0 m/s (4:10/km) — below 3:00/km
    const stream = Array(20).fill(4.0);
    const result = SprintParser.parseTrackSession({ velocity_smooth: stream });
    expect(result).toEqual([]);
  });

  it('accepts a sprint-range burst within duration and pace limits', () => {
    // 15 seconds at 9 m/s → 135m, avg 9.0 m/s (1:51/km), duration 15 s ≤ 25
    const stream = Array(15).fill(9.0);
    const result = SprintParser.parseTrackSession({ velocity_smooth: stream });
    expect(result.length).toBe(1);
    expect(result[0].type).toBe('SpeedEndurance');
    expect(result[0].distance).toBeLessThanOrEqual(150);
  });
});
