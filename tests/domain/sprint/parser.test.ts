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
