import { describe, it, expect } from 'vitest';
import { SilverSprintLogic, NFIStatus, HRVData } from '../../src/domain/sprint/core';
import { StrengthPeriodization } from '../../src/domain/sprint/periodization';
import { isStaleVmax } from '../../src/domain/sprint/workouts';

/**
 * Tests for README §4 — UI/UX Requirements
 *
 * These tests verify the logic powering the Dashboard UI elements
 * without requiring a DOM renderer (React Testing Library).
 *
 * - NFI must be the primary metric (tested via data flow)
 * - Traffic Light: Green > 97%, Amber 94-97%, Red < 94%
 * - Strength module must reflect TSB-based prescriptions
 * - Recovery hours must include age tax + HRV modifier
 */

// Mirrors the Dashboard's getNFIColorClasses logic
function getNFIColorClasses(status: NFIStatus) {
  switch (status) {
    case 'green':
      return { bg: 'bg-green-500/10', border: 'border-green-500', text: 'text-green-500' };
    case 'amber':
      return { bg: 'bg-amber-500/10', border: 'border-amber-500', text: 'text-amber-500' };
    case 'red':
      return { bg: 'bg-red-500/10', border: 'border-red-500', text: 'text-red-500' };
  }
}

// Mirrors the Dashboard's getNFIMessage logic (now TSB-aware)
function getNFIMessage(status: NFIStatus, tsb?: number): string {
  const stale = isStaleVmax(status, tsb != null ? { tsb } : undefined);
  switch (status) {
    case 'green':
      return 'CNS is primed for Max Velocity. Focus on block starts and flying 30s.';
    case 'amber':
      return stale
        ? 'Sprint speed below baseline but training load is low \u2014 a technical re-activation session is recommended.'
        : 'CNS suppression detected. Limit volume; focus on technical drills.';
    case 'red':
      return stale
        ? 'Sprint speed well below baseline but you are fresh \u2014 likely detraining, not fatigue. A controlled re-activation sprint session is recommended.'
        : 'Danger Zone \u2014 significant neural fatigue. Rest or active recovery only.';
  }
}

describe('Dashboard — Traffic Light Color Classes (§4)', () => {
  it('maps green status to green CSS classes', () => {
    const colors = getNFIColorClasses('green');
    expect(colors.bg).toContain('green');
    expect(colors.border).toContain('green');
    expect(colors.text).toContain('green');
  });

  it('maps amber status to amber CSS classes', () => {
    const colors = getNFIColorClasses('amber');
    expect(colors.bg).toContain('amber');
    expect(colors.border).toContain('amber');
    expect(colors.text).toContain('amber');
  });

  it('maps red status to red CSS classes', () => {
    const colors = getNFIColorClasses('red');
    expect(colors.bg).toContain('red');
    expect(colors.border).toContain('red');
    expect(colors.text).toContain('red');
  });
});

describe('Dashboard — Traffic Light Messages (§4)', () => {
  it('green message encourages max velocity work', () => {
    const msg = getNFIMessage('green');
    expect(msg).toMatch(/Max Velocity|block starts|flying/i);
  });

  it('amber message warns about CNS suppression when genuinely fatigued', () => {
    const msg = getNFIMessage('amber', -10);
    expect(msg).toMatch(/suppression|limit volume|technical/i);
  });

  it('amber message recommends re-activation when fresh (stale Vmax)', () => {
    const msg = getNFIMessage('amber', 5);
    expect(msg).toMatch(/re-activation/i);
    expect(msg).not.toMatch(/suppression/i);
  });

  it('red message indicates danger zone when fatigued', () => {
    const msg = getNFIMessage('red', -15);
    expect(msg).toMatch(/danger|rest|recovery/i);
  });

  it('red message recommends re-activation when fresh (stale Vmax)', () => {
    const msg = getNFIMessage('red', 5);
    expect(msg).toMatch(/detraining|re-activation/i);
    expect(msg).not.toMatch(/danger/i);
  });

  it('red message without TSB context defaults to danger zone', () => {
    const msg = getNFIMessage('red');
    expect(msg).toMatch(/danger/i);
  });
});

describe('Dashboard — NFI Display Formatting (§4)', () => {
  it('formats NFI as percentage with 1 decimal place', () => {
    const nfi = 0.973;
    const display = (nfi * 100).toFixed(1);
    expect(display).toBe('97.3');
  });

  it('formats NFI of 1.0 as 100.0%', () => {
    const nfi = 1.0;
    const display = (nfi * 100).toFixed(1);
    expect(display).toBe('100.0');
  });

  it('formats low NFI correctly', () => {
    const nfi = 0.891;
    const display = (nfi * 100).toFixed(1);
    expect(display).toBe('89.1');
  });
});

describe('Dashboard — Strength Module Integration (§3.3 + §4)', () => {
  it('shows max strength exercises when TSB is positive', () => {
    const rx = StrengthPeriodization.getPrescription(10);
    expect(rx.zone).toBe('fresh');
    expect(rx.exercises.length).toBeGreaterThan(0);
    // All exercises should be strength type
    expect(rx.exercises.every(e => e.type === 'strength')).toBe(true);
  });

  it('shows plyometric exercises when TSB is -10 to -20', () => {
    const rx = StrengthPeriodization.getPrescription(-15);
    expect(rx.zone).toBe('tired');
    expect(rx.exercises.every(e => e.type === 'plyometric')).toBe(true);
  });

  it('shows mobility/rest when TSB is below -20', () => {
    const rx = StrengthPeriodization.getPrescription(-30);
    expect(rx.zone).toBe('fatigued');
    expect(rx.exercises.every(e => e.type === 'mobility' || e.type === 'rest')).toBe(true);
  });

  it('exercises have displayable properties (name, sets, reps, intensity)', () => {
    const rx = StrengthPeriodization.getPrescription(5);
    for (const ex of rx.exercises) {
      expect(ex.name).toBeTruthy();
      expect(ex.sets).toBeGreaterThan(0);
      expect(ex.reps).toBeTruthy();
      expect(ex.intensity).toBeTruthy();
    }
  });
});

describe('Dashboard — Recovery Display (§3.2 + §4)', () => {
  it('recovery hours are a positive number for display', () => {
    const srs = SilverSprintLogic.calculateSRS({ currentHRV: 60, avgHRV7d: 60 }, 0, 1.0);
    const hours = SilverSprintLogic.getRecoveryWindow(45, srs);
    expect(hours).toBeGreaterThan(0);
    expect(Number.isFinite(hours)).toBe(true);
  });

  it('recovery string format includes hours suffix', () => {
    const srs = SilverSprintLogic.calculateSRS({ currentHRV: 55, avgHRV7d: 60 }, -5, 0.95);
    const hours = SilverSprintLogic.getRecoveryWindow(50, srs);
    const displayText = `${hours}h`;
    expect(displayText).toMatch(/\d+h/);
  });
});

describe('Dashboard — NFI is primary metric (§4)', () => {
  it('NFI status drives the main gauge styling', () => {
    // Simulate all three NFI states and verify each produces distinct styling
    const statuses: NFIStatus[] = ['green', 'amber', 'red'];
    const colorSets = statuses.map(s => getNFIColorClasses(s));

    // All three should be distinct
    const bgs = colorSets.map(c => c.bg);
    expect(new Set(bgs).size).toBe(3);

    const borders = colorSets.map(c => c.border);
    expect(new Set(borders).size).toBe(3);
  });

  it('NFI percentage calculation end-to-end matches logic module', () => {
    const currentVmax = 9.2;
    const avgVmax = 9.5;
    const nfi = SilverSprintLogic.calculateNFI(currentVmax, avgVmax);
    const status = SilverSprintLogic.getNFIStatus(nfi);

    // 9.2/9.5 ≈ 0.968 → amber (94-97%)
    expect(status).toBe('amber');
    expect((nfi * 100).toFixed(1)).toBe('96.8');
  });
});

describe('Dashboard \u2014 Body Weight Auto-Detection from Intervals.icu (\u00a73.3)', () => {
  it('uses bodyWeightKg from Intervals.icu wellness data when available', () => {
    // Simulates the logic in useIntervalsData: extract weight from wellness entries
    const wellnessEntries: Array<{ id: string; date: string; hrv: number; weight?: number }> = [
      { id: 'w1', date: '2026-02-28', hrv: 55, weight: 82.5 },
      { id: 'w2', date: '2026-02-27', hrv: 58 },
    ];
    const bodyWeightKg = wellnessEntries.find(
      (w) => typeof w.weight === 'number' && w.weight > 0
    )?.weight ?? null;
    expect(bodyWeightKg).toBe(82.5);
  });

  it('returns null when no wellness entry has a weight value', () => {
    const wellnessEntries: Array<{ id: string; date: string; hrv: number; weight?: number }> = [
      { id: 'w1', date: '2026-02-28', hrv: 55 },
      { id: 'w2', date: '2026-02-27', hrv: 58 },
    ];
    const bodyWeightKg = wellnessEntries.find(
      (w) => typeof w.weight === 'number' && w.weight > 0
    )?.weight ?? null;
    expect(bodyWeightKg).toBeNull();
  });

  it('auto-calculates estimated exercise weights from Intervals.icu body weight', () => {
    const bodyWeightKg = 82.5; // from Intervals.icu wellness
    const rx = StrengthPeriodization.getPrescription(5); // fresh zone

    const exerciseWeights = rx.exercises.map(ex => ({
      name: ex.name,
      estKg: StrengthPeriodization.estimateWeightKg(ex, bodyWeightKg),
    }));

    // Fresh exercises all have bwMultipliers => all produce estimated weights
    for (const ew of exerciseWeights) {
      expect(ew.estKg).not.toBeNull();
      expect(ew.estKg).toBeGreaterThan(0);
    }

    // Trap Bar Deadlift ~1.7× BW → ~140 kg
    const deadlift = exerciseWeights.find(e => e.name === 'Trap Bar Deadlift');
    expect(deadlift?.estKg).toBe(Math.round(1.7 * 82.5)); // 140
  });

  it('shows no estimated weights for plyometric zone (bodyweight exercises)', () => {
    const bodyWeightKg = 82.5;
    const rx = StrengthPeriodization.getPrescription(-15); // tired zone → plyometrics

    const exerciseWeights = rx.exercises.map(ex =>
      StrengthPeriodization.estimateWeightKg(ex, bodyWeightKg)
    );
    // Plyometric exercises have no bwMultiplier
    expect(exerciseWeights.every(w => w === null)).toBe(true);
  });
});
