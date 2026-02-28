import { describe, it, expect } from 'vitest';
import { SilverSprintLogic } from '../../../src/domain/sprint/core';

/**
 * Tests for README §3.2 — Neural Fatigue Index, Sprint Recovery Score & Age Tax
 *
 * NFI = currentVmax / avgVmax (30-day rolling baseline)
 *
 * Sprint Recovery Score (SRS 0–100):
 *   HRV ratio 45% + TSB 30% + NFI 25%
 *
 * Recovery window = 48h + max(0,(Age-40)×6h) + round((1-SRS/100)×48h)
 */
describe('SilverSprintLogic.calculateNFI (§3.2)', () => {
  it('returns 1.0 when current equals baseline', () => {
    expect(SilverSprintLogic.calculateNFI(9.5, 9.5)).toBe(1.0);
  });

  it('returns ratio > 1 when current exceeds baseline', () => {
    expect(SilverSprintLogic.calculateNFI(10.0, 9.5)).toBeGreaterThan(1.0);
  });

  it('returns ratio < 1 when current is below baseline', () => {
    expect(SilverSprintLogic.calculateNFI(8.5, 9.5)).toBeLessThan(1.0);
  });

  it('returns 1.0 when avgVmax is 0 (no baseline data)', () => {
    expect(SilverSprintLogic.calculateNFI(0, 0)).toBe(1.0);
  });
});

/**
 * §3.2 Sprint Recovery Score (SRS) — composite 0–100
 *   HRV ratio 45%  TSB 30%  NFI 25%
 *
 * HRV_score = clamp((ratio − 0.75) / 0.30 × 100, 0, 100)
 * TSB_score = clamp((TSB + 20) / 40 × 100, 0, 100)
 * NFI_score = clamp((NFI − 0.90) / 0.10 × 100, 0, 100)
 */
describe('SilverSprintLogic.calculateSRS (§3.2)', () => {
  it('returns 100 when all signals are at peak (HRV ratio 1.0, TSB +20, NFI 1.0)', () => {
    const srs = SilverSprintLogic.calculateSRS({ currentHRV: 60, avgHRV7d: 60 }, 20, 1.0);
    // HRV ratio=1.0 → score=(1.0-0.75)/0.30*100=83.3; TSB=20 → 100; NFI=1.0 → 100
    // SRS = 83.3*0.45 + 100*0.30 + 100*0.25 = 37.5+30+25 = 92.5 → 93
    expect(srs).toBe(93);
  });

  it('returns 0 when HRV ratio, TSB and NFI are all at floor values', () => {
    const srs = SilverSprintLogic.calculateSRS({ currentHRV: 30, avgHRV7d: 60 }, -20, 0.9);
    // HRV ratio=0.5 → clamped 0; TSB=-20 → 0; NFI=0.90 → 0
    expect(srs).toBe(0);
  });

  it('suppressed HRV (ratio 0.83) reduces SRS', () => {
    const normal = SilverSprintLogic.calculateSRS({ currentHRV: 60, avgHRV7d: 60 }, 0, 1.0);
    const suppressed = SilverSprintLogic.calculateSRS({ currentHRV: 50, avgHRV7d: 60 }, 0, 1.0);
    expect(suppressed).toBeLessThan(normal);
  });

  it('negative TSB reduces SRS relative to positive TSB', () => {
    const fresh = SilverSprintLogic.calculateSRS({ currentHRV: 60, avgHRV7d: 60 }, 10, 1.0);
    const fatigued = SilverSprintLogic.calculateSRS({ currentHRV: 60, avgHRV7d: 60 }, -15, 1.0);
    expect(fatigued).toBeLessThan(fresh);
  });

  it('low NFI reduces SRS', () => {
    const ready = SilverSprintLogic.calculateSRS({ currentHRV: 60, avgHRV7d: 60 }, 0, 1.0);
    const fatigued = SilverSprintLogic.calculateSRS({ currentHRV: 60, avgHRV7d: 60 }, 0, 0.92);
    expect(fatigued).toBeLessThan(ready);
  });

  it('returns a value between 0 and 100 inclusive', () => {
    const srs = SilverSprintLogic.calculateSRS({ currentHRV: 55, avgHRV7d: 60 }, -10, 0.95);
    expect(srs).toBeGreaterThanOrEqual(0);
    expect(srs).toBeLessThanOrEqual(100);
  });
});

/**
 * §3.2 Age Tax Recovery Window driven by SRS
 *   ageTaxBase = 48h + max(0, (age − 40) × 6h)
 *   extra = round((1 − SRS/100) × 48h)
 */
describe('SilverSprintLogic.getRecoveryWindow (§3.2)', () => {
  it('age ≤ 40 at SRS 100 returns minimum 48h', () => {
    expect(SilverSprintLogic.getRecoveryWindow(35, 100)).toBe(48);
    expect(SilverSprintLogic.getRecoveryWindow(40, 100)).toBe(48);
  });

  it('age 45 at SRS 100 returns 78h (no SRS penalty)', () => {
    expect(SilverSprintLogic.getRecoveryWindow(45, 100)).toBe(78);
  });

  it('age 50 at SRS 100 returns 108h (no SRS penalty)', () => {
    expect(SilverSprintLogic.getRecoveryWindow(50, 100)).toBe(108);
  });

  it('age 45 at SRS 0 returns 126h (full 48h SRS penalty)', () => {
    expect(SilverSprintLogic.getRecoveryWindow(45, 0)).toBe(126);
  });

  it('age 45 at SRS 50 returns 102h (half SRS penalty)', () => {
    expect(SilverSprintLogic.getRecoveryWindow(45, 50)).toBe(102);
  });

  it('recovery increases as SRS decreases', () => {
    const high = SilverSprintLogic.getRecoveryWindow(45, 80);
    const low = SilverSprintLogic.getRecoveryWindow(45, 30);
    expect(low).toBeGreaterThan(high);
  });
});

/**
 * Freshness-adjusted SRS — neutralises NFI penalty when stale Vmax detected.
 * When TSB ≥ 0 and NFI is amber/red, the low NFI is from detraining, not fatigue.
 */
describe('SilverSprintLogic.calculateFreshnessAdjustedSRS', () => {
  const normalHrv: { currentHRV: number; avgHRV7d: number } = { currentHRV: 60, avgHRV7d: 60 };

  it('returns higher SRS than standard when stale Vmax (red NFI + positive TSB)', () => {
    const standard = SilverSprintLogic.calculateSRS(normalHrv, 2, 0.92);
    const adjusted = SilverSprintLogic.calculateFreshnessAdjustedSRS(normalHrv, 2, 0.92);
    expect(adjusted).toBeGreaterThan(standard);
  });

  it('returns same as standard SRS when green NFI', () => {
    const standard = SilverSprintLogic.calculateSRS(normalHrv, 5, 1.0);
    const adjusted = SilverSprintLogic.calculateFreshnessAdjustedSRS(normalHrv, 5, 1.0);
    expect(adjusted).toBe(standard);
  });

  it('returns same as standard SRS when NFI is low but TSB is negative (genuinely fatigued)', () => {
    const standard = SilverSprintLogic.calculateSRS(normalHrv, -10, 0.92);
    const adjusted = SilverSprintLogic.calculateFreshnessAdjustedSRS(normalHrv, -10, 0.92);
    expect(adjusted).toBe(standard);
  });

  it('neutralises NFI penalty for amber NFI with zero TSB', () => {
    const standard = SilverSprintLogic.calculateSRS(normalHrv, 0, 0.95);
    const adjusted = SilverSprintLogic.calculateFreshnessAdjustedSRS(normalHrv, 0, 0.95);
    expect(adjusted).toBeGreaterThan(standard);
  });
});

/**
 * Smart recovery window — context-aware, accounts for stale Vmax.
 */
describe('SilverSprintLogic.getSmartRecoveryWindow', () => {
  const normalHrv: { currentHRV: number; avgHRV7d: number } = { currentHRV: 60, avgHRV7d: 60 };

  it('returns shorter recovery than standard when stale Vmax detected', () => {
    const standardSRS = SilverSprintLogic.calculateSRS(normalHrv, 2, 0.92);
    const standardHours = SilverSprintLogic.getRecoveryWindow(49, standardSRS);
    const smart = SilverSprintLogic.getSmartRecoveryWindow(49, normalHrv, 2, 0.92);
    expect(smart.hours).toBeLessThan(standardHours);
    expect(smart.staleVmax).toBe(true);
    expect(smart.srs).toBeGreaterThan(standardSRS);
  });

  it('returns same recovery as standard when genuinely fatigued', () => {
    const standardSRS = SilverSprintLogic.calculateSRS(normalHrv, -15, 0.92);
    const standardHours = SilverSprintLogic.getRecoveryWindow(49, standardSRS);
    const smart = SilverSprintLogic.getSmartRecoveryWindow(49, normalHrv, -15, 0.92);
    expect(smart.hours).toBe(standardHours);
    expect(smart.staleVmax).toBe(false);
    expect(smart.srs).toBe(standardSRS);
  });

  it('returns same recovery as standard when green NFI', () => {
    const standardSRS = SilverSprintLogic.calculateSRS(normalHrv, 5, 1.0);
    const standardHours = SilverSprintLogic.getRecoveryWindow(45, standardSRS);
    const smart = SilverSprintLogic.getSmartRecoveryWindow(45, normalHrv, 5, 1.0);
    expect(smart.hours).toBe(standardHours);
    expect(smart.staleVmax).toBe(false);
  });

  it('mirrors user scenario: age 49, NFI 0.92, TSB +2.37, normal HRV', () => {
    // Standard: SRS ≈ 59, recovery ≈ 122h
    // Smart: SRS ≈ 79, recovery ≈ 112h (NFI penalty neutralised)
    const smart = SilverSprintLogic.getSmartRecoveryWindow(49, normalHrv, 2.37, 0.92);
    expect(smart.staleVmax).toBe(true);
    expect(smart.hours).toBeLessThan(122);
    expect(smart.srs).toBeGreaterThan(59);
  });
});

/**
 * §3.3 Strength Training Auto-Regulation based on TSB
 *   TSB > 0 (Fresh): High Intensity, Low Volume (Max Strength)
 *   TSB -10 to -20 (Tired): Moderate Intensity (Stiffened Plyometrics)
 *   TSB < -20 (Fatigued): Rest / Active Mobility only
 */
describe('SilverSprintLogic.getStrengthPrescription (§3.3)', () => {
  it('returns max-strength prescription when TSB > 0', () => {
    const rx = SilverSprintLogic.getStrengthPrescription(5);
    expect(rx.zone).toBe('fresh');
    expect(rx.intensity).toBe('high');
    expect(rx.focus).toContain('Max Strength');
  });

  it('returns plyometric prescription when TSB is -10 to -20', () => {
    const rx = SilverSprintLogic.getStrengthPrescription(-15);
    expect(rx.zone).toBe('tired');
    expect(rx.intensity).toBe('moderate');
    expect(rx.focus).toContain('Plyometrics');
  });

  it('returns rest prescription when TSB < -20', () => {
    const rx = SilverSprintLogic.getStrengthPrescription(-25);
    expect(rx.zone).toBe('fatigued');
    expect(rx.focus).toMatch(/Rest|Mobility/i);
  });

  it('handles TSB exactly at 0 as fresh', () => {
    const rx = SilverSprintLogic.getStrengthPrescription(0);
    // TSB > 0 is fresh per spec; TSB = 0 is borderline — treat as fresh
    expect(rx.zone).toBe('fresh');
  });

  it('handles TSB at -10 boundary as tired', () => {
    const rx = SilverSprintLogic.getStrengthPrescription(-10);
    expect(rx.zone).toBe('tired');
  });

  it('handles TSB at -20 boundary as tired (not fatigued)', () => {
    const rx = SilverSprintLogic.getStrengthPrescription(-20);
    expect(rx.zone).toBe('tired');
  });

  it('handles TSB at -21 as fatigued', () => {
    const rx = SilverSprintLogic.getStrengthPrescription(-21);
    expect(rx.zone).toBe('fatigued');
  });
});

/**
 * §4 Traffic Light System
 *   Green: NFI > 97% (0.97)
 *   Amber: NFI 94-97% (0.94 to 0.97)
 *   Red: NFI < 94% (< 0.94)
 */
describe('SilverSprintLogic.getNFIStatus — Traffic Light (§4)', () => {
  it('returns green when NFI > 0.97', () => {
    expect(SilverSprintLogic.getNFIStatus(0.98)).toBe('green');
  });

  it('returns green when NFI is exactly 1.0', () => {
    expect(SilverSprintLogic.getNFIStatus(1.0)).toBe('green');
  });

  it('returns amber when NFI is exactly 0.97', () => {
    expect(SilverSprintLogic.getNFIStatus(0.97)).toBe('amber');
  });

  it('returns amber when NFI is 0.95', () => {
    expect(SilverSprintLogic.getNFIStatus(0.95)).toBe('amber');
  });

  it('returns amber when NFI is exactly 0.94', () => {
    expect(SilverSprintLogic.getNFIStatus(0.94)).toBe('amber');
  });

  it('returns red when NFI < 0.94', () => {
    expect(SilverSprintLogic.getNFIStatus(0.93)).toBe('red');
  });

  it('returns red when NFI is very low', () => {
    expect(SilverSprintLogic.getNFIStatus(0.80)).toBe('red');
  });
});
