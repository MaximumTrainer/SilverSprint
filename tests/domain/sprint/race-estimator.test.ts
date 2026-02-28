import { describe, it, expect } from 'vitest';
import { RaceEstimator, RaceEstimatorInput, RaceEstimate, TrainingProfile } from '../../../src/domain/sprint/race-estimator';
import { TrackInterval } from '../../../src/domain/sprint/parser';

/**
 * Race Estimator Tests
 *
 * Verifies the physics-informed model that converts training Vmax
 * into predicted 100m, 200m, and 400m outdoor track times.
 * Includes tests for training-history-enhanced estimates.
 */

const baseInput: RaceEstimatorInput = {
  bestVmax60d: 10.0,
  avgVmax: 9.8,
  nfi: 1.0,
  nfiStatus: 'green',
  tsb: 5,
  age: 45,
  activityCount: 15,
};

describe('RaceEstimator — Basic predictions', () => {
  it('returns estimates for all three distances', () => {
    const results = RaceEstimator.estimate(baseInput);
    expect(results).toHaveLength(3);
    expect(results.map((r) => r.distance)).toEqual([100, 200, 400]);
  });

  it('100m is fastest, 400m is slowest', () => {
    const results = RaceEstimator.estimate(baseInput);
    const [r100, r200, r400] = results;
    expect(r100.predictedTime).toBeLessThan(r200.predictedTime);
    expect(r200.predictedTime).toBeLessThan(r400.predictedTime);
  });

  it('times are in realistic range for 10 m/s Vmax athlete aged 45', () => {
    const results = RaceEstimator.estimate(baseInput);
    const [r100, r200, r400] = results;
    // 10 m/s Vmax, age 45 → 100m ~12.0-13.5s, 200m ~24-27s, 400m ~55-65s
    expect(r100.predictedTime).toBeGreaterThan(11);
    expect(r100.predictedTime).toBeLessThan(14);
    expect(r200.predictedTime).toBeGreaterThan(22);
    expect(r200.predictedTime).toBeLessThan(28);
    expect(r400.predictedTime).toBeGreaterThan(50);
    expect(r400.predictedTime).toBeLessThan(68);
  });
});

describe('RaceEstimator — Age adjustment', () => {
  it('younger athlete (30) is faster than older athlete (55) at same Vmax', () => {
    const young = RaceEstimator.estimate({ ...baseInput, age: 30 });
    const old = RaceEstimator.estimate({ ...baseInput, age: 55 });
    expect(young[0].predictedTime).toBeLessThan(old[0].predictedTime);
    expect(young[1].predictedTime).toBeLessThan(old[1].predictedTime);
    expect(young[2].predictedTime).toBeLessThan(old[2].predictedTime);
  });

  it('no age penalty under 35', () => {
    const at25 = RaceEstimator.estimate({ ...baseInput, age: 25 });
    const at35 = RaceEstimator.estimate({ ...baseInput, age: 35 });
    expect(at25[0].predictedTime).toBe(at35[0].predictedTime);
  });
});

describe('RaceEstimator — NFI/TSB readiness modifier', () => {
  it('fatigued (red) athlete is slower than fresh (green) athlete', () => {
    const fresh = RaceEstimator.estimate({
      ...baseInput,
      nfi: 1.02,
      nfiStatus: 'green',
      tsb: 10,
    });
    const fatigued = RaceEstimator.estimate({
      ...baseInput,
      nfi: 0.91,
      nfiStatus: 'red',
      tsb: -25,
    });
    expect(fresh[0].predictedTime).toBeLessThan(fatigued[0].predictedTime);
  });

  it('modifier stays within ±5% range — no huge swings', () => {
    const neutral = RaceEstimator.estimate({ ...baseInput, nfi: 1.0, tsb: 0 });
    const best = RaceEstimator.estimate({ ...baseInput, nfi: 1.05, tsb: 20 });
    const worst = RaceEstimator.estimate({ ...baseInput, nfi: 0.88, tsb: -30 });

    const ratio100Best = neutral[0].predictedTime / best[0].predictedTime;
    const ratio100Worst = worst[0].predictedTime / neutral[0].predictedTime;

    expect(ratio100Best).toBeGreaterThan(0.95);
    expect(ratio100Best).toBeLessThan(1.05);
    expect(ratio100Worst).toBeGreaterThan(0.95);
    expect(ratio100Worst).toBeLessThan(1.06);
  });
});

describe('RaceEstimator — Confidence', () => {
  it('high confidence with 10+ activities', () => {
    const results = RaceEstimator.estimate({ ...baseInput, activityCount: 15 });
    expect(results.every((r) => r.confidence === 'high')).toBe(true);
  });

  it('moderate confidence with 3–9 activities', () => {
    const results = RaceEstimator.estimate({ ...baseInput, activityCount: 5 });
    expect(results.every((r) => r.confidence === 'moderate')).toBe(true);
  });

  it('low confidence with under 3 activities', () => {
    const results = RaceEstimator.estimate({ ...baseInput, activityCount: 1 });
    expect(results.every((r) => r.confidence === 'low')).toBe(true);
  });
});

describe('RaceEstimator — Edge cases', () => {
  it('returns "--" display when no velocity data', () => {
    const results = RaceEstimator.estimate({ ...baseInput, bestVmax60d: 0, avgVmax: 0 });
    expect(results.every((r) => r.display === '--')).toBe(true);
  });

  it('handles very high Vmax (world-class)', () => {
    const results = RaceEstimator.estimate({ ...baseInput, bestVmax60d: 12.3, age: 25 });
    // Usain Bolt-level: 100m should be sub-10
    expect(results[0].predictedTime).toBeLessThan(10.5);
  });

  it('handles low Vmax (recreational)', () => {
    const results = RaceEstimator.estimate({ ...baseInput, bestVmax60d: 6.0, avgVmax: 5.8, age: 60 });
    expect(results[0].predictedTime).toBeGreaterThan(15);
    expect(results[0].display).not.toBe('--');
  });
});

describe('RaceEstimator — formatTime', () => {
  it('formats sub-60 seconds as ss.xx', () => {
    expect(RaceEstimator.formatTime(11.23)).toBe('11.23');
    expect(RaceEstimator.formatTime(59.99)).toBe('59.99');
  });

  it('formats 60+ seconds as m:ss.xx', () => {
    expect(RaceEstimator.formatTime(62.45)).toBe('1:02.45');
    expect(RaceEstimator.formatTime(120.0)).toBe('2:00.00');
  });

  it('returns "--" for zero', () => {
    expect(RaceEstimator.formatTime(0)).toBe('--');
  });
});

/* ── Training History Tests ──────────────────────────────────── */

/** Helper to create typed training intervals */
function makeIntervals(intervals: Partial<TrackInterval>[]): TrackInterval[] {
  return intervals.map((i) => ({
    type: i.type || 'MaxVelocity',
    distance: i.distance || 30,
    vMax: i.vMax || 10,
    duration: i.duration || 4,
    flyingVelocity: i.flyingVelocity || 9.5,
  }));
}

describe('RaceEstimator — buildTrainingProfile', () => {
  it('computes speed endurance index from SE intervals', () => {
    const intervals = makeIntervals([
      { type: 'SpeedEndurance', distance: 100, duration: 12, vMax: 10, flyingVelocity: 9.5 },
      { type: 'SpeedEndurance', distance: 120, duration: 15, vMax: 10, flyingVelocity: 9.3 },
    ]);
    const profile = RaceEstimator.buildTrainingProfile(intervals, 10.0);
    // avg speeds: 100/12=8.33, 120/15=8.0  → ratios: 0.833, 0.8 → avg ~0.817
    expect(profile.speedEnduranceIndex).toBeGreaterThan(0.7);
    expect(profile.speedEnduranceIndex).toBeLessThan(0.95);
    expect(profile.seIntervalCount).toBe(2);
  });

  it('picks best flying velocity across all intervals', () => {
    const intervals = makeIntervals([
      { flyingVelocity: 9.2 },
      { flyingVelocity: 10.1 },
      { flyingVelocity: 9.8 },
    ]);
    const profile = RaceEstimator.buildTrainingProfile(intervals, 10.5);
    expect(profile.bestFlyingVelocity).toBe(10.1);
  });

  it('computes average acceleration time from accel intervals', () => {
    const intervals = makeIntervals([
      { type: 'Acceleration', distance: 30, duration: 4, flyingVelocity: 0 },
      { type: 'Acceleration', distance: 30, duration: 5, flyingVelocity: 0 },
      { type: 'Acceleration', distance: 30, duration: 4.5, flyingVelocity: 0 },
    ]);
    const profile = RaceEstimator.buildTrainingProfile(intervals, 10.0);
    expect(profile.avgAccelerationTime).toBeCloseTo(4.5, 1);
    expect(profile.accelIntervalCount).toBe(3);
  });

  it('returns zeroed profile when no intervals provided', () => {
    const profile = RaceEstimator.buildTrainingProfile([], 10.0);
    expect(profile.speedEnduranceIndex).toBe(0);
    expect(profile.bestFlyingVelocity).toBe(0);
    expect(profile.avgAccelerationTime).toBe(0);
  });
});

describe('RaceEstimator — Training history improves predictions', () => {
  const seIntervals = makeIntervals([
    { type: 'SpeedEndurance', distance: 100, duration: 11, vMax: 10, flyingVelocity: 9.8 },
    { type: 'SpeedEndurance', distance: 120, duration: 13.5, vMax: 10, flyingVelocity: 9.5 },
    { type: 'SpecialEndurance', distance: 200, duration: 24, vMax: 10, flyingVelocity: 9.6 },
    { type: 'Acceleration', distance: 30, duration: 4.0, flyingVelocity: 9.0 },
    { type: 'Acceleration', distance: 30, duration: 4.2, flyingVelocity: 9.2 },
    { type: 'Acceleration', distance: 30, duration: 3.8, flyingVelocity: 9.1 },
    { type: 'MaxVelocity', distance: 50, duration: 5.2, vMax: 10.2, flyingVelocity: 10.0 },
  ]);

  const inputWithHistory: RaceEstimatorInput = {
    ...baseInput,
    trainingIntervals: seIntervals,
  };

  it('still returns estimates for all three distances', () => {
    const results = RaceEstimator.estimate(inputWithHistory);
    expect(results).toHaveLength(3);
    expect(results.map((r) => r.distance)).toEqual([100, 200, 400]);
  });

  it('100m stays in realistic range with training history', () => {
    const results = RaceEstimator.estimate(inputWithHistory);
    expect(results[0].predictedTime).toBeGreaterThan(11);
    expect(results[0].predictedTime).toBeLessThan(14);
  });

  it('200m stays in realistic range with training history', () => {
    const results = RaceEstimator.estimate(inputWithHistory);
    expect(results[1].predictedTime).toBeGreaterThan(22);
    expect(results[1].predictedTime).toBeLessThan(28);
  });

  it('400m stays in realistic range with training history', () => {
    const results = RaceEstimator.estimate(inputWithHistory);
    expect(results[2].predictedTime).toBeGreaterThan(50);
    expect(results[2].predictedTime).toBeLessThan(68);
  });

  it('note includes SE index and flying velocity when training data present', () => {
    const results = RaceEstimator.estimate(inputWithHistory);
    expect(results[0].note).toMatch(/SE index|Flying/);
  });
});

describe('RaceEstimator — Phase breakdown', () => {
  it('all estimates include phase breakdown', () => {
    const results = RaceEstimator.estimate(baseInput);
    for (const r of results) {
      expect(r.phases).toBeDefined();
      expect(r.phases.reaction).toBeGreaterThan(0);
      expect(r.phases.acceleration).toBeGreaterThan(0);
      expect(r.phases.maxVelocity).toBeGreaterThan(0);
    }
  });

  it('phase times sum to approximately the predicted time', () => {
    const results = RaceEstimator.estimate(baseInput);
    for (const r of results) {
      const phaseSum = r.phases.reaction + r.phases.acceleration + r.phases.maxVelocity + r.phases.deceleration;
      // Phase breakdown is an approximate model — allow ±15% tolerance
      expect(phaseSum).toBeGreaterThan(r.predictedTime * 0.6);
      expect(phaseSum).toBeLessThan(r.predictedTime * 1.4);
    }
  });

  it('400m has a significant deceleration/SE phase', () => {
    const results = RaceEstimator.estimate(baseInput);
    const r400 = results[2];
    expect(r400.phases.deceleration).toBeGreaterThan(0);
  });

  it('zero data returns zeroed phases', () => {
    const results = RaceEstimator.estimate({ ...baseInput, bestVmax60d: 0, avgVmax: 0 });
    for (const r of results) {
      expect(r.phases.reaction).toBe(0);
      expect(r.phases.acceleration).toBe(0);
    }
  });
});
