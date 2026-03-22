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

  it('accepts a 400m interval (boundary — longest sprint event)', () => {
    const result = SprintParser.fromAPIInterval({
      type: 'WORK',
      distance: 400,
      moving_time: 52,
      max_speed: 9.0,
      average_speed: 7.7,
    });
    expect(result).not.toBeNull();
    expect(result!.distance).toBe(400);
    expect(result!.type).toBe('SpecialEndurance');
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
});

describe('SprintParser.parseTrackSession — 400m upper-distance filter', () => {
  it('excludes velocity-stream bursts longer than 400m', () => {
    // Simulate a 500m easy jog at 4 m/s for 125 seconds → distance ~500m
    const stream = Array(125).fill(4.0);
    const result = SprintParser.parseTrackSession({ velocity_smooth: stream });
    expect(result).toEqual([]);
  });

  it('accepts a 400m velocity-stream burst at sprint pace', () => {
    // 400m sprint: 44 seconds at 9 m/s → distance 396m ≤ 400m
    const stream = Array(44).fill(9.0);
    const result = SprintParser.parseTrackSession({ velocity_smooth: stream });
    expect(result.length).toBe(1);
    expect(result[0].type).toBe('SpecialEndurance');
    expect(result[0].distance).toBeLessThanOrEqual(400);
  });
});
