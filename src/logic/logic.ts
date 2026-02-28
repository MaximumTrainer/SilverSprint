export interface HRVData {
  currentHRV: number;
  avgHRV7d: number;
}

export interface StrengthPrescription {
  zone: 'fresh' | 'tired' | 'fatigued';
  intensity: 'high' | 'moderate' | 'none';
  focus: string;
}

export type NFIStatus = 'green' | 'amber' | 'red';

/** Base recovery period in hours before age adjustments */
const RECOVERY_BASE_HOURS = 48;
/** Additional recovery hours per year of age past 40 */
const RECOVERY_AGE_HOURS_PER_YEAR = 6;
/** Maximum additional recovery hours imposed by a zero SRS */
const RECOVERY_SRS_MAX_PENALTY_HOURS = 48;

export class SilverSprintLogic {
  /**
   * §3.2 — Neural Fatigue Index
   * NFI = currentVmax / avgVmax (30-day rolling baseline)
   */
  static calculateNFI(currentVmax: number, avgVmax: number): number {
    return avgVmax > 0 ? parseFloat((currentVmax / avgVmax).toFixed(3)) : 1.0;
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
   * §3.3 — Strength Training Auto-Regulation
   * TSB > 0 → Fresh: High Intensity, Low Volume (Max Strength)
   * TSB -10 to -20 → Tired: Moderate Intensity (Stiffened Plyometrics)
   * TSB < -20 → Fatigued: Rest or Active Mobility only
   */
  static getStrengthPrescription(tsb: number): StrengthPrescription {
    if (tsb >= 0) {
      return {
        zone: 'fresh',
        intensity: 'high',
        focus: 'Max Strength — High Intensity, Low Volume',
      };
    }
    if (tsb >= -20) {
      return {
        zone: 'tired',
        intensity: 'moderate',
        focus: 'Stiffened Plyometrics — Moderate Intensity',
      };
    }
    return {
      zone: 'fatigued',
      intensity: 'none',
      focus: 'Rest or Active Mobility only',
    };
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
}