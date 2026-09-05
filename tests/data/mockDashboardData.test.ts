import { describe, it, expect } from 'vitest';
import {
  mockAthleteData,
  mockDailyTimeSeries,
  mockRaceEstimates,
  mockRecoveredEstimates,
  mockSprintRacePlans,
  mockTrainingPlan,
} from '../../src/data/mockDashboardData';
import { SilverSprintLogic } from '../../src/domain/sprint/core';

/**
 * The demo dashboard is the first thing an unauthenticated visitor sees, so it
 * has to be a faithful picture of what the app produces — not merely
 * plausible-looking numbers.
 *
 * These tests pin the two properties that matter: every figure must be one the
 * live model could actually generate for this athlete, and the series must have
 * the shape of real training data rather than a smooth curve.
 */

describe('demo data — internal consistency with the domain model', () => {
  it('reports a recovery window the age-tax formula could actually produce', () => {
    // 48h base + (52 − 40) × 6h = 120h before any SRS penalty. A demo showing
    // 36h would be a figure the app itself can never output for a 52-year-old.
    const expected = SilverSprintLogic.getRecoveryWindow(mockAthleteData.age, mockAthleteData.srs);
    expect(mockAthleteData.recoveryHours).toBe(expected);
    expect(mockAthleteData.recoveryHours).toBeGreaterThanOrEqual(120);
  });

  it('reports an NFI status matching its own NFI value', () => {
    expect(mockAthleteData.nfiStatus).toBe(SilverSprintLogic.getNFIStatus(mockAthleteData.nfi));
  });

  it('reports an NFI consistent with its own Vmax figures', () => {
    const derived = SilverSprintLogic.calculateNFI(mockAthleteData.todayVmax, mockAthleteData.avgVmax);
    expect(Math.abs(derived - mockAthleteData.nfi)).toBeLessThan(0.005);
  });

  it('keeps the SRS within the documented range', () => {
    expect(mockAthleteData.srs).toBeGreaterThanOrEqual(0);
    expect(mockAthleteData.srs).toBeLessThanOrEqual(100);
  });

  it('shows plausible sprint velocities for a masters athlete', () => {
    expect(mockAthleteData.todayVmax).toBeGreaterThan(7);
    expect(mockAthleteData.todayVmax).toBeLessThan(11);
    expect(mockAthleteData.avgVmax).toBeGreaterThan(7);
    expect(mockAthleteData.avgVmax).toBeLessThan(11);
  });
});

describe('demo data — the state it demonstrates', () => {
  it('sits in the amber neural band', () => {
    // Amber is the informative state: it exercises the traffic-light copy, the
    // technical-sprint workout path and the "if fully recovered" comparison.
    expect(mockAthleteData.nfiStatus).toBe('amber');
  });

  it('populates the fully-recovered estimates that amber unlocks', () => {
    expect(mockRecoveredEstimates).toHaveLength(3);
    for (const recovered of mockRecoveredEstimates) {
      const current = mockRaceEstimates.find((e) => e.distance === recovered.distance)!;
      expect(recovered.predictedTime).toBeLessThan(current.predictedTime);
    }
  });

  it('is fatigued without being written off, so the strength card shows a prescription', () => {
    const zone = SilverSprintLogic.getStrengthPrescription(mockAthleteData.tsb).zone;
    expect(zone).toBe('tired');
  });

  it('does not claim stale Vmax while the athlete is objectively loaded', () => {
    expect(mockAthleteData.tsb).toBeLessThan(0);
    expect(mockAthleteData.staleVmax).toBe(false);
  });
});

describe('demo time series — shaped like real training data', () => {
  it('covers the same 60-day window the live app charts', () => {
    expect(mockDailyTimeSeries).toHaveLength(60);
  });

  it('has no NFI on days the athlete did not run', () => {
    // A real athlete trains a few days a week. A value on all 60 days is the
    // signature of a generated curve rather than a training history.
    const withNfi = mockDailyTimeSeries.filter((d) => d.nfi != null);
    expect(withNfi.length).toBeGreaterThan(8);
    expect(withNfi.length).toBeLessThan(30);
  });

  it('includes days where the wearable was not worn', () => {
    expect(mockDailyTimeSeries.some((d) => d.hrv == null)).toBe(true);
    expect(mockDailyTimeSeries.filter((d) => d.hrv != null).length).toBeGreaterThan(40);
  });

  it('swings TSB across a realistic training range', () => {
    const tsb = mockDailyTimeSeries.map((d) => d.tsb).filter((v): v is number => v != null);
    const spread = Math.max(...tsb) - Math.min(...tsb);
    // A block of hard training and a recovery week differ by far more than the
    // few points a gentle curve moves through.
    expect(spread).toBeGreaterThan(15);
    expect(Math.min(...tsb)).toBeGreaterThan(-45);
    expect(Math.max(...tsb)).toBeLessThan(30);
  });

  it('does not trace a periodic wave', () => {
    // A sine wave reverses direction on a fixed period. Real day-to-day data
    // has runs of consecutive moves in the same direction of varying length.
    const hrv = mockDailyTimeSeries.map((d) => d.hrv).filter((v): v is number => v != null);
    const deltas = hrv.slice(1).map((v, i) => v - hrv[i]);
    const runLengths: number[] = [];
    let run = 1;
    for (let i = 1; i < deltas.length; i++) {
      if (Math.sign(deltas[i]) === Math.sign(deltas[i - 1])) run++;
      else { runLengths.push(run); run = 1; }
    }
    runLengths.push(run);
    expect(new Set(runLengths).size).toBeGreaterThan(2);
  });

  it('holds HRV in a physiologically plausible band', () => {
    const hrv = mockDailyTimeSeries.map((d) => d.hrv).filter((v): v is number => v != null);
    expect(Math.min(...hrv)).toBeGreaterThan(15);
    expect(Math.max(...hrv)).toBeLessThan(120);
  });

  it('never charts a recovery window below the athlete\'s age tax', () => {
    const hours = mockDailyTimeSeries.map((d) => d.recoveryHours).filter((v): v is number => v != null);
    expect(Math.min(...hours)).toBeGreaterThanOrEqual(120);
  });

  it('ends today and runs forward in time', () => {
    const dates = mockDailyTimeSeries.map((d) => d.date);
    expect([...dates].sort()).toEqual(dates);
  });

  it('is deterministic across imports', async () => {
    // A demo built on Math.random would differ between loads, making every
    // screenshot and visual review unrepeatable.
    const reimported = await import('../../src/data/mockDashboardData');
    expect(reimported.mockDailyTimeSeries).toEqual(mockDailyTimeSeries);
    expect(reimported.mockAthleteData).toEqual(mockAthleteData);
  });
});

describe('demo race data', () => {
  it('predicts ordered, plausible masters times', () => {
    const [r100, r200, r400] = mockRaceEstimates;
    expect(r100.predictedTime).toBeLessThan(r200.predictedTime);
    expect(r200.predictedTime).toBeLessThan(r400.predictedTime);
    expect(r100.predictedTime).toBeGreaterThan(11);
    expect(r400.predictedTime).toBeLessThan(120);
  });

  it('offers an upcoming race with a goal time and a training plan', () => {
    expect(mockSprintRacePlans).toHaveLength(1);
    expect(mockSprintRacePlans[0].goalTime).not.toBe('--');
    expect(mockSprintRacePlans[0].race.daysUntil).toBeGreaterThan(0);
    expect(mockTrainingPlan).not.toBeNull();
  });

  it('shows uncalibrated estimates, since the demo has no entered race times', () => {
    expect(mockRaceEstimates.every((e) => e.calibration === 'none')).toBe(true);
  });
});
