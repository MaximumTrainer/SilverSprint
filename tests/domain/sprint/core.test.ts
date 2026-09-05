import { describe, it, expect } from 'vitest';
import { SilverSprintLogic, STRENGTH_ZONE_BANDS, getStrengthZoneBand } from '../../../src/domain/sprint/core';

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

/**
 * Interval-adjusted TSB — accounts for all other training load from intervals.
 *
 * When interval-level icu_training_load is available for all interval types
 * (including WARMUP, COOLDOWN, REST), the interval-derived ATL may exceed the
 * activity-level ATL.  In that case the higher value is used so that non-sprint
 * training load is not underestimated in recovery.
 */
describe('SilverSprintLogic.computeIntervalAdjustedTSB', () => {
  it('returns standard TSB when no interval data is available (totalIntervalLoad = 0)', () => {
    // TSB = 42 - 55 = -13
    expect(SilverSprintLogic.computeIntervalAdjustedTSB(42, 55, 0, 10)).toBe(-13);
  });

  it('returns standard TSB when sessionCount is zero', () => {
    expect(SilverSprintLogic.computeIntervalAdjustedTSB(42, 55, 1400, 0)).toBe(-13);
  });

  it('returns standard TSB when interval-derived ATL is lower than activity ATL', () => {
    // avgIntervalLoad = 200 / 10 = 20, which is less than atl = 55 → no adjustment
    expect(SilverSprintLogic.computeIntervalAdjustedTSB(42, 55, 200, 10)).toBe(-13);
  });

  it('returns a lower (more conservative) TSB when interval-derived ATL exceeds activity ATL', () => {
    // avgIntervalLoad = 2000 / 20 = 100, which exceeds atl = 55
    // effectiveATL = 100 → TSB = 42 - 100 = -58
    expect(SilverSprintLogic.computeIntervalAdjustedTSB(42, 55, 2000, 20)).toBe(-58);
  });

  it('uses the interval-derived ATL directly when it exceeds the activity ATL', () => {
    // avgIntervalLoad = 1200 / 20 = 60; atl = 42
    // effectiveATL = max(42, 60) = 60 → TSB = 80 - 60 = 20
    expect(SilverSprintLogic.computeIntervalAdjustedTSB(80, 42, 1200, 20)).toBe(20);
  });

  it('produces a more conservative recovery when interval load is high', () => {
    const standardTSB = SilverSprintLogic.computeIntervalAdjustedTSB(42, 55, 0, 10);
    const adjustedTSB = SilverSprintLogic.computeIntervalAdjustedTSB(42, 55, 2000, 10);
    // High interval load should yield lower TSB (more conservative / more recovery needed)
    expect(adjustedTSB).toBeLessThan(standardTSB);
  });

  it('result is identical to standard TSB when session interval loads equal activity ATL', () => {
    // avgIntervalLoad = 55*10 / 10 = 55 = atl → no adjustment
    expect(SilverSprintLogic.computeIntervalAdjustedTSB(42, 55, 550, 10)).toBe(-13);
  });
});

/**
 * §3.2 — Rolling Vmax baseline selection.
 *
 * The baseline must track the velocity the athlete reaches *when sprinting*.
 * Averaging every logged run lets easy volume drag the baseline below true top
 * speed, which pushes NFI permanently above 1.0 and disables the traffic light.
 */
describe('SilverSprintLogic.calculateVmaxBaseline', () => {
  it('averages only sessions within 85% of the window best', () => {
    // Best 9.0 → threshold 7.65. The 5.0 and 6.2 sessions are excluded.
    const baseline = SilverSprintLogic.calculateVmaxBaseline([8.0, 5.0, 9.0, 6.2, 8.6], 9.0);
    expect(baseline).toBeCloseTo((8.0 + 9.0 + 8.6) / 3, 5);
  });

  it('ignores easy runs that would otherwise deflate the baseline', () => {
    const sprintOnly = [8.9, 8.7, 8.3];
    const withEasyRuns = [8.9, 3.3, 8.7, 3.6, 4.9, 8.3];

    expect(SilverSprintLogic.calculateVmaxBaseline(withEasyRuns, 8.9))
      .toBeCloseTo(SilverSprintLogic.calculateVmaxBaseline(sprintOnly, 8.9)!, 5);
  });

  it('keeps NFI near 1.0 for a normal sprint session in a mixed training block', () => {
    // A masters sprinter logging mostly easy volume: today matches recent
    // sprint days, so the neural status should read green-but-not-inflated.
    const todayVmax = 8.31;
    const priorVmaxes = [8.01, 8.31, 7.88, 3.29, 6.40, 7.75, 8.92, 4.94, 3.59];
    const windowBest = 8.92;

    const baseline = SilverSprintLogic.calculateVmaxBaseline(priorVmaxes, windowBest)!;
    const nfi = SilverSprintLogic.calculateNFI(todayVmax, baseline);

    expect(nfi).toBeGreaterThan(0.93);
    expect(nfi).toBeLessThan(1.06);
  });

  it('drops to amber when a sprint session comes in below the sprint baseline', () => {
    const baseline = SilverSprintLogic.calculateVmaxBaseline([8.9, 8.7, 8.3, 8.5], 8.9)!;
    const nfi = SilverSprintLogic.calculateNFI(8.25, baseline);
    expect(SilverSprintLogic.getNFIStatus(nfi)).toBe('amber');
  });

  it('drops to red on a clear neural-fatigue day', () => {
    const baseline = SilverSprintLogic.calculateVmaxBaseline([8.9, 8.7, 8.3, 8.5], 8.9)!;
    const nfi = SilverSprintLogic.calculateNFI(7.9, baseline);
    expect(SilverSprintLogic.getNFIStatus(nfi)).toBe('red');
  });

  it('skips sessions with no velocity data rather than treating them as slow', () => {
    const withNulls = SilverSprintLogic.calculateVmaxBaseline([8.9, null, 8.7, undefined, 8.3], 8.9);
    const withoutNulls = SilverSprintLogic.calculateVmaxBaseline([8.9, 8.7, 8.3], 8.9);
    expect(withNulls).toBe(withoutNulls);
  });

  it('returns null when no earlier session reached sprint speed', () => {
    // Today is a breakthrough session; everything before it was easy running.
    expect(SilverSprintLogic.calculateVmaxBaseline([3.3, 4.1, 3.9], 8.9)).toBeNull();
  });

  it('returns null when there is no velocity data at all', () => {
    expect(SilverSprintLogic.calculateVmaxBaseline([], 0)).toBeNull();
    expect(SilverSprintLogic.calculateVmaxBaseline([null, null], 0)).toBeNull();
  });

  it('uses the documented 85% threshold', () => {
    expect(SilverSprintLogic.SPRINT_SESSION_VMAX_FRACTION).toBe(0.85);

    // Exactly on the threshold qualifies; a hair below does not.
    expect(SilverSprintLogic.calculateVmaxBaseline([8.5], 10)).toBe(8.5);
    expect(SilverSprintLogic.calculateVmaxBaseline([8.49], 10)).toBeNull();
  });
});

/**
 * §3.3 — Strength zone bands.
 *
 * The thresholds were previously duplicated in the tooltip and the README,
 * where they drifted: both advertised a "Tired" band of −10 to −20 while the
 * code used 0 to −20, so an athlete at TSB −1 saw "Tired" alongside a tooltip
 * saying they should be Fresh. These tests pin the labels to the logic.
 */
describe('STRENGTH_ZONE_BANDS', () => {
  it('covers the whole TSB number line with no gaps or overlaps', () => {
    const sorted = [...STRENGTH_ZONE_BANDS].sort((a, b) => a.min - b.min);
    expect(sorted[0].min).toBe(-Infinity);
    expect(sorted.at(-1)!.max).toBe(Infinity);
    for (let i = 1; i < sorted.length; i++) {
      expect(sorted[i].min).toBe(sorted[i - 1].max);
    }
  });

  it('agrees with the prescription at every boundary and either side of it', () => {
    const probes = [-100, -40, -20.01, -20, -19.99, -10, -1, -0.01, 0, 0.01, 5, 50];
    for (const tsb of probes) {
      const band = getStrengthZoneBand(tsb);
      const rx = SilverSprintLogic.getStrengthPrescription(tsb);
      expect(band.zone, `zone at TSB ${tsb}`).toBe(rx.zone);
      expect(band.intensity).toBe(rx.intensity);
      expect(band.focus).toBe(rx.focus);
    }
  });

  it('places the boundaries where the prescription does', () => {
    expect(getStrengthZoneBand(0).zone).toBe('fresh');
    expect(getStrengthZoneBand(-0.01).zone).toBe('tired');
    expect(getStrengthZoneBand(-20).zone).toBe('tired');
    expect(getStrengthZoneBand(-20.01).zone).toBe('fatigued');
  });

  it('puts a marginally negative TSB in Tired, as the logic does', () => {
    // The reading that prompted this: TSB −1.05 is Tired, not Fresh. The old
    // tooltip claimed Tired started at −10, making this look like a bug.
    const band = getStrengthZoneBand(-1.05);
    expect(band.zone).toBe('tired');
    expect(band.range).toContain('0 to');
  });

  it('gives every band a label, a readable range and guidance', () => {
    for (const band of STRENGTH_ZONE_BANDS) {
      expect(band.label.length).toBeGreaterThan(0);
      expect(band.range.length).toBeGreaterThan(0);
      expect(band.guidance.length).toBeGreaterThan(0);
      // Ranges are for humans: no raw Infinity leaking into the UI.
      expect(band.range).not.toContain('Infinity');
    }
  });

  it('describes each band\'s range consistently with its own bounds', () => {
    const fresh = STRENGTH_ZONE_BANDS.find((b) => b.zone === 'fresh')!;
    const tired = STRENGTH_ZONE_BANDS.find((b) => b.zone === 'tired')!;
    const fatigued = STRENGTH_ZONE_BANDS.find((b) => b.zone === 'fatigued')!;

    expect(fresh.range).toContain(String(fresh.min));
    expect(tired.range).toContain(String(tired.max));
    expect(tired.range).toContain(String(Math.abs(tired.min)));
    expect(fatigued.range).toContain(String(Math.abs(fatigued.max)));
  });
});
