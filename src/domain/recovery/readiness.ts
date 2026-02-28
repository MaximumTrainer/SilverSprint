export interface MorningCheckIn {
  date: string;                             // YYYY-MM-DD
  gripScore: 'ok' | 'reduced';
  /** Ratio of today's tap-test speed vs 7-day rolling average: 1.0 = baseline, 0.85 = 15% drop */
  tapTestRatio: number;
  hrv?: number;                             // optional waking HRV (ms) from wearable
  muscleFeeling: 'twitchy' | 'normal' | 'heavy';
  /** true = stiffness cleared within ~10 minutes of wake (healthy fascial hydration) */
  morningStiffnessCleared: boolean;
}

export interface ReadinessResult {
  overallStatus: 'ready' | 'caution' | 'reduce-volume';
  redFlags: string[];
  recommendations: string[];
  /** 0–100 composite score: 25pts each for grip, tap-test, muscle tone, stiffness */
  neuralScore: number;
}

/**
 * §5.3 — Daily Readiness Assessment ("Morning Check-In")
 *
 * Evaluates four fascia-indicator metrics before unlocking the day's workout:
 *   1. Grip Strength   — proxy for neural drive to distal motor units
 *   2. Tap Test Ratio  — >15% drop signals suppressed CNS firing rate
 *   3. Muscle Feeling  — subjective contractile tissue fatigue
 *   4. Morning Stiffness — healthy if clears in < 10–15 min; persistent = overtraining risk
 *
 * Outcomes:
 *   0 red flags  → 'ready'
 *   1 red flag   → 'caution'
 *   2+ red flags → 'reduce-volume'
 */
export class ReadinessAssessment {
  /**
   * Master assessment. Evaluates all check-in fields and returns a ReadinessResult.
   * @param checkIn  Morning check-in data
   * @param _baselineTapRate  Reserved for future wearable integration; not used in scoring
   */
  static assess(checkIn: MorningCheckIn, _baselineTapRate?: number): ReadinessResult {
    const redFlags: string[] = [];
    const recommendations: string[] = [];

    if (ReadinessAssessment.scoreGrip(checkIn.gripScore)) {
      redFlags.push('Grip strength reduced — neural drive to hand/forearm compromised');
      recommendations.push('Avoid max-effort sprints. Replace with OI catch-and-hold protocol.');
    }

    if (ReadinessAssessment.scoreTapTest(checkIn.tapTestRatio)) {
      const dropPct = Math.round((1 - checkIn.tapTestRatio) * 100);
      redFlags.push(`Tap test ${dropPct}% below baseline — CNS firing rate suppressed`);
      recommendations.push('Cut sprint volume by 50%. Prioritise breathing and tempo only.');
    }

    if (ReadinessAssessment.assessStiffness(checkIn.morningStiffnessCleared) === 'overtrained-risk') {
      redFlags.push('Morning stiffness has not cleared — fascial dehydration or inflammation present');
      recommendations.push('Add 15 min hot shower before training. Delay session by 90 minutes if possible.');
    }

    if (checkIn.muscleFeeling === 'heavy') {
      redFlags.push('Muscle tone heavy — accumulated fatigue in contractile tissue');
      recommendations.push('Downgrade to recovery modalities: extensive tempo or hydrotherapy only.');
    }

    if (redFlags.length === 0) {
      recommendations.push('All systems ready. Proceed with planned session at full intensity.');
    }

    let overallStatus: ReadinessResult['overallStatus'];
    if (redFlags.length === 0) overallStatus = 'ready';
    else if (redFlags.length === 1) overallStatus = 'caution';
    else overallStatus = 'reduce-volume';

    // neuralScore: 25pts each dimension
    const gripOk   = !ReadinessAssessment.scoreGrip(checkIn.gripScore);
    const tapOk    = !ReadinessAssessment.scoreTapTest(checkIn.tapTestRatio);
    const muscleOk = checkIn.muscleFeeling !== 'heavy';
    const stiffOk  = checkIn.morningStiffnessCleared;
    const neuralScore = (gripOk ? 25 : 0) + (tapOk ? 25 : 0) + (muscleOk ? 25 : 0) + (stiffOk ? 25 : 0);

    return { overallStatus, redFlags, recommendations, neuralScore };
  }

  /**
   * Returns true (red flag) when grip is reported as 'reduced'.
   * A >10% drop from dynamometer baseline is the clinical threshold.
   */
  static scoreGrip(score: 'ok' | 'reduced'): boolean {
    return score === 'reduced';
  }

  /**
   * Returns true (red flag) when tap-test ratio falls below 0.85
   * (i.e. >15% performance decrease vs 7-day rolling average).
   */
  static scoreTapTest(ratio: number): boolean {
    return ratio < 0.85;
  }

  /**
   * Returns 'overtrained-risk' when stiffness has NOT cleared at check-in time.
   * Healthy fascia-driven athletes feel morning stiffness that disperses within minutes.
   * Persistent stiffness beyond 15 minutes signals neural inflammation.
   */
  static assessStiffness(cleared: boolean): 'healthy' | 'overtrained-risk' {
    return cleared ? 'healthy' : 'overtrained-risk';
  }

  /**
   * Returns true when RSI has dropped to <90% of the athlete's baseline RSI,
   * indicating accumulated neural fatigue affecting reactive strength.
   * A dropping RSI on Monday Depth Jumps is the primary CNS overreach indicator.
   */
  static isRSIDropping(currentRSI: number, baselineRSI: number): boolean {
    return currentRSI < baselineRSI * 0.90;
  }
}
