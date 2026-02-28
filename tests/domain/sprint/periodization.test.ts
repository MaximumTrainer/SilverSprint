import { describe, it, expect } from 'vitest';
import { StrengthPeriodization } from '../../../src/domain/sprint/periodization';

/**
 * Tests for README §3.3 — Strength Training Periodization Logic
 *
 * TSB-based auto-regulation:
 *   TSB > 0 (Fresh): High Intensity, Low Volume — Max Strength focus
 *   TSB -10 to -20 (Tired): Moderate Intensity — Stiffened Plyometrics
 *   TSB < -20 (Fatigued): Rest or Active Mobility only
 */
describe('StrengthPeriodization.getPrescription (§3.3)', () => {
  it('prescribes max strength exercises when fresh (TSB > 0)', () => {
    const rx = StrengthPeriodization.getPrescription(10);
    expect(rx.zone).toBe('fresh');
    expect(rx.exercises.length).toBeGreaterThan(0);
    expect(rx.exercises.some(e => e.type === 'strength')).toBe(true);
  });

  it('prescribes plyometric exercises when tired (TSB -10 to -20)', () => {
    const rx = StrengthPeriodization.getPrescription(-15);
    expect(rx.zone).toBe('tired');
    expect(rx.exercises.some(e => e.type === 'plyometric')).toBe(true);
  });

  it('prescribes rest/mobility when fatigued (TSB < -20)', () => {
    const rx = StrengthPeriodization.getPrescription(-25);
    expect(rx.zone).toBe('fatigued');
    expect(rx.exercises.some(e => e.type === 'mobility' || e.type === 'rest')).toBe(true);
  });
});

describe('StrengthPeriodization.estimateWeightKg — body weight auto-calculation', () => {
  it('calculates estimated load from bwMultiplier × bodyWeightKg', () => {
    const exercise = { name: 'Trap Bar Deadlift', type: 'strength' as const, sets: 3, reps: 3, intensity: '85%', bwMultiplier: 1.7 };
    expect(StrengthPeriodization.estimateWeightKg(exercise, 80)).toBe(136); // 1.7 × 80 = 136
  });

  it('returns null when exercise has no bwMultiplier (e.g. bodyweight plyos)', () => {
    const exercise = { name: 'Pogo Jumps', type: 'plyometric' as const, sets: 3, reps: 10, intensity: 'Max Stiffness' };
    expect(StrengthPeriodization.estimateWeightKg(exercise, 80)).toBeNull();
  });

  it('rounds to the nearest kg', () => {
    const exercise = { name: 'Weighted Step-Up', type: 'strength' as const, sets: 3, reps: 5, intensity: '80%', bwMultiplier: 0.5 };
    // 0.5 × 75 = 37.5 → 38
    expect(StrengthPeriodization.estimateWeightKg(exercise, 75)).toBe(38);
  });

  it('scales correctly across all fresh-zone exercises with body weight from Intervals.icu', () => {
    const rx = StrengthPeriodization.getPrescription(10); // fresh zone
    const bw = 82; // kg from Intervals.icu wellness
    const estimates = rx.exercises.map(ex => ({
      name: ex.name,
      kg: StrengthPeriodization.estimateWeightKg(ex, bw),
    }));
    // All fresh exercises have bwMultiplier — every estimate should be a positive number
    for (const est of estimates) {
      expect(est.kg).not.toBeNull();
      expect(est.kg).toBeGreaterThan(0);
    }
  });

  it('returns null for all fatigued-zone exercises (mobility/rest)', () => {
    const rx = StrengthPeriodization.getPrescription(-30); // fatigued
    const estimates = rx.exercises.map(ex => StrengthPeriodization.estimateWeightKg(ex, 80));
    expect(estimates.every(e => e === null)).toBe(true);
  });
});
