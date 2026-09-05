import type { HRVData, StrengthPrescription, NFIStatus } from '../types';

export type { HRVData, StrengthPrescription, NFIStatus };

/** Base recovery period in hours before age adjustments */
const RECOVERY_BASE_HOURS = 48;
/** Additional recovery hours per year of age past 40 */
const RECOVERY_AGE_HOURS_PER_YEAR = 6;
/** Maximum additional recovery hours imposed by a zero SRS */
const RECOVERY_SRS_MAX_PENALTY_HOURS = 48;

/**
 * Fraction of the window's best Vmax a session must reach before it counts as
 * a sprint session for baseline purposes.
 */
const SPRINT_SESSION_VMAX_FRACTION = 0.85;

/**
 * TSB is fitness minus fatigue across **all** training — sprints, easy runs,
 * rides and walks all move it. It is not a measure of strength-specific load,
 * so the zone can read "Tired" in a week containing no lifting at all.
 */
export interface StrengthZoneBand {
  zone: StrengthPrescription['zone'];
  intensity: StrengthPrescription['intensity'];
  /** Title-case name shown to the athlete. */
  label: string;
  /** Prescription summary. */
  focus: string;
  /** Inclusive lower bound of the band's TSB range. */
  min: number;
  /** Exclusive upper bound. */
  max: number;
  /** Human-readable range, e.g. "0 to −20". */
  range: string;
  /** One-line explanation of what the athlete should do. */
  guidance: string;
}

/**
 * The three TSB bands, ordered freshest first.
 *
 * Single source of truth: the prescription, the dashboard scale and the README
 * all read these, so a threshold can only be changed in one place.
 */
export const STRENGTH_ZONE_BANDS: readonly StrengthZoneBand[] = [
  {
    zone: 'fresh',
    intensity: 'high',
    label: 'Fresh',
    focus: 'Max Strength — High Intensity, Low Volume',
    min: 0,
    max: Infinity,
    range: '0 or above',
    guidance: 'Heavy lifting is on the table — high intensity, low volume.',
  },
  {
    zone: 'tired',
    intensity: 'moderate',
    label: 'Tired',
    focus: 'Stiffened Plyometrics — Moderate Intensity',
    min: -20,
    max: 0,
    range: '0 to −20',
    guidance: 'Carrying fatigue — bodyweight plyometrics rather than heavy lifts.',
  },
  {
    zone: 'fatigued',
    intensity: 'none',
    label: 'Fatigued',
    focus: 'Rest or Active Mobility only',
    min: -Infinity,
    max: -20,
    range: 'below −20',
    guidance: 'Deeply fatigued — rest or active mobility only.',
  },
];

/** The band a given TSB falls in. */
export function getStrengthZoneBand(tsb: number): StrengthZoneBand {
  return STRENGTH_ZONE_BANDS.find((b) => tsb >= b.min && tsb < b.max) ?? STRENGTH_ZONE_BANDS[1];
}

export class SilverSprintLogic {
  /** @see SPRINT_SESSION_VMAX_FRACTION */
  static readonly SPRINT_SESSION_VMAX_FRACTION = SPRINT_SESSION_VMAX_FRACTION;

  /**
   * §3.2 — Neural Fatigue Index
   * NFI = currentVmax / avgVmax (30-day rolling baseline)
   */
  static calculateNFI(currentVmax: number, avgVmax: number): number {
    return avgVmax > 0 ? parseFloat((currentVmax / avgVmax).toFixed(3)) : 1.0;
  }

  /**
   * §3.2 — Rolling Vmax baseline for the Neural Fatigue Index.
   *
   * The baseline must represent the velocity the athlete *reaches when
   * sprinting*, not the mean peak speed of everything they logged. A masters
   * sprinter's easy runs, warm-up jogs and trail runs peak 3–5 m/s below their
   * sprint Vmax, so averaging every run pulls the baseline far under true top
   * speed and leaves NFI permanently above 1.0 — which silently disables the
   * traffic light the whole recovery model depends on.
   *
   * Only sessions that reached at least {@link SPRINT_SESSION_VMAX_FRACTION}
   * of the window's best Vmax are counted, which keeps the baseline anchored to
   * genuine sprint days regardless of how much easy volume surrounds them.
   *
   * @param priorVmaxes    Vmax of each earlier session in the window; null/0 entries
   *                       (no GPS trace) are ignored rather than counted as slow.
   * @param windowBestVmax Best Vmax across the window, including today's session.
   * @returns The baseline Vmax, or null when no earlier session reached sprint speed.
   */
  static calculateVmaxBaseline(
    priorVmaxes: Array<number | null | undefined>,
    windowBestVmax: number,
  ): number | null {
    if (!(windowBestVmax > 0)) return null;

    const threshold = windowBestVmax * SPRINT_SESSION_VMAX_FRACTION;
    const sprintVmaxes = priorVmaxes.filter(
      (v): v is number => typeof v === 'number' && v > 0 && v >= threshold,
    );

    if (sprintVmaxes.length === 0) return null;
    return sprintVmaxes.reduce((a, b) => a + b, 0) / sprintVmaxes.length;
  }

  /**
   * Sprint Recovery Score (SRS) — composite 0–100 sprint readiness score.
   *
   * Weights:
   *   HRV ratio  45% — autonomic/CNS readiness (primary for masters sprinters)
   *   TSB        30% — accumulated neuromuscular load
   *   NFI        25% — actual sprint output vs 30-day baseline
   *
   * Scoring ranges:
   *   HRV_score = clamp((HRV_today/HRV_7dAvg − 0.75) / 0.30 × 100, 0, 100)
   *   TSB_score = clamp((TSB + 20) / 40 × 100, 0, 100)
   *   NFI_score = clamp((NFI − 0.90) / 0.10 × 100, 0, 100)
   */
  static calculateSRS(hrv: HRVData, tsb: number, nfi: number): number {
    const hrvRatio = hrv.avgHRV7d > 0 ? hrv.currentHRV / hrv.avgHRV7d : 1.0;
    const hrvScore = Math.min(100, Math.max(0, (hrvRatio - 0.75) / 0.30 * 100));
    const tsbScore = Math.min(100, Math.max(0, (tsb + 20) / 40 * 100));
    const nfiScore = Math.min(100, Math.max(0, (nfi - 0.90) / 0.10 * 100));
    return Math.round(hrvScore * 0.45 + tsbScore * 0.30 + nfiScore * 0.25);
  }

  /**
   * §3.2 — Age Tax Recovery Window driven by Sprint Recovery Score.
   *
   * ageTaxBase = 48h + max(0, (age − 40) × 6h)
   * extra      = round((1 − SRS/100) × 48h)   ← continuous 0–48h penalty
   *
   * Example ranges (age 45): SRS 100 → 78h · SRS 50 → 102h · SRS 0 → 126h
   */
  static getRecoveryWindow(age: number, srs: number): number {
    const ageTaxBase = RECOVERY_BASE_HOURS + Math.max(0, (age - 40) * RECOVERY_AGE_HOURS_PER_YEAR);
    return ageTaxBase + Math.round((1 - srs / 100) * RECOVERY_SRS_MAX_PENALTY_HOURS);
  }

  /**
   * Freshness-adjusted SRS that neutralises the NFI penalty when stale-Vmax
   * is detected (low NFI + positive TSB = detraining, not fatigue).
   *
   * When the athlete is objectively fresh (TSB ≥ 0) but NFI is below green,
   * the low Vmax reading is from inactivity rather than CNS overload. In this
   * case the NFI component is replaced with a neutral baseline (NFI = 1.0)
   * so the recovery score reflects actual physiological state.
   *
   * Falls back to standard SRS when the scenario doesn't apply.
   */
  static calculateFreshnessAdjustedSRS(hrv: HRVData, tsb: number, nfi: number): number {
    const nfiStatus = SilverSprintLogic.getNFIStatus(nfi);
    const isStale = (nfiStatus === 'red' || nfiStatus === 'amber') && tsb >= 0;
    return SilverSprintLogic.calculateSRS(hrv, tsb, isStale ? 1.0 : nfi);
  }

  /**
   * Context-aware recovery window that accounts for stale Vmax.
   *
   * Uses freshness-adjusted SRS so the recovery window reflects actual
   * physiological recovery needs rather than being inflated by detraining.
   *
   * Example (age 49, HRV normal, TSB +2, NFI 0.92):
   *   Standard:  SRS 59 → 122h
   *   Adjusted:  SRS 79 → 112h  (NFI penalty neutralised)
   */
  static getSmartRecoveryWindow(age: number, hrv: HRVData, tsb: number, nfi: number): { hours: number; srs: number; staleVmax: boolean } {
    const nfiStatus = SilverSprintLogic.getNFIStatus(nfi);
    const staleVmax = (nfiStatus === 'red' || nfiStatus === 'amber') && tsb >= 0;
    const srs = SilverSprintLogic.calculateFreshnessAdjustedSRS(hrv, tsb, nfi);
    const hours = SilverSprintLogic.getRecoveryWindow(age, srs);
    return { hours, srs, staleVmax };
  }

  /**
   * §3.3 — Strength Training Auto-Regulation.
   *
   * Derived from {@link STRENGTH_ZONE_BANDS} rather than repeating the
   * thresholds, so the prescription, the UI scale and the docs cannot drift
   * apart — they previously did, with the tooltip advertising a "tired" band of
   * −10 to −20 while the code used 0 to −20.
   */
  static getStrengthPrescription(tsb: number): StrengthPrescription {
    const band = getStrengthZoneBand(tsb);
    return { zone: band.zone, intensity: band.intensity, focus: band.focus };
  }

  /**
   * §4 — Traffic Light System
   * Green: NFI > 0.97
   * Amber: NFI 0.94–0.97
   * Red:   NFI < 0.94
   */
  static getNFIStatus(nfi: number): NFIStatus {
    if (nfi > 0.97) return 'green';
    if (nfi >= 0.94) return 'amber';
    return 'red';
  }

  /**
   * Compute a TSB that accounts for total training load across all interval types.
   *
   * The standard `tsb = ctl − atl` uses Intervals.icu's rolling ATL, which is a
   * 7-day EMA of session training load. When interval-level data is available for
   * recent sessions, summing `icu_training_load` across **all** interval types
   * (including WARMUP, COOLDOWN, REST, ACTIVE_REST) provides an independent
   * measure of recent load. If this interval-derived average exceeds the
   * activity-level ATL, we use the higher value so that non-sprint training load
   * is not underestimated.
   *
   * @param ctl  Chronic Training Load from the latest activity
   * @param atl  Acute Training Load from the latest activity
   * @param totalIntervalLoad  Sum of `icu_training_load` across ALL interval types
   *                           from recent sessions (not filtered to WORK only)
   * @param sessionCount  Number of sessions whose intervals were aggregated
   */
  static computeIntervalAdjustedTSB(
    ctl: number,
    atl: number,
    totalIntervalLoad: number,
    sessionCount: number,
  ): number {
    if (sessionCount <= 0) return ctl - atl;
    if (totalIntervalLoad <= 0) return ctl - atl;
    const intervalDerivedATL = totalIntervalLoad / sessionCount;
    const effectiveATL = Math.max(atl, intervalDerivedATL);
    return ctl - effectiveATL;
  }
}