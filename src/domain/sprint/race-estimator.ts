import type { NFIStatus } from '../types';
import type { TrackInterval } from './parser';

/**
 * Age degradation rate: ~0.7% per year past age 35.
 * Based on WMA masters performance data.
 * Shared conceptually with race-plan.ts (which uses its own simplified model).
 */
export const AGE_DEGRADATION_PER_YEAR = 0.007;

export interface RaceEstimate {
  distance: 100 | 200 | 400;
  /** Predicted finish time in seconds */
  predictedTime: number;
  /** Formatted as mm:ss.xx or ss.xx */
  display: string;
  /** Confidence label based on data quality */
  confidence: 'high' | 'moderate' | 'low';
  /** Brief note on the estimate */
  note: string;
  /** Breakdown of time phases (start, drive, maintain, deceleration) */
  phases: RacePhaseBreakdown;
}

export interface RacePhaseBreakdown {
  /** Reaction + block clearance (s) */
  reaction: number;
  /** Acceleration phase contribution (s) */
  acceleration: number;
  /** Max velocity / maintenance phase (s) */
  maxVelocity: number;
  /** Speed endurance / deceleration phase (s) — 200m/400m only */
  deceleration: number;
}

/** Summary of athlete's training-derived capabilities */
export interface TrainingProfile {
  /** Speed Endurance Index: ratio of avg speed in 80m+ intervals to Vmax (0–1) */
  speedEnduranceIndex: number;
  /** Best flying velocity observed across training (m/s) */
  bestFlyingVelocity: number;
  /** Average acceleration time to peak in short intervals (seconds) */
  avgAccelerationTime: number;
  /** Number of speed endurance intervals analysed */
  seIntervalCount: number;
  /** Number of acceleration intervals analysed */
  accelIntervalCount: number;
}

export interface RaceEstimatorInput {
  /** Best Vmax observed in last 60 days (m/s) */
  bestVmax60d: number;
  /** Rolling 30-day average Vmax (m/s) */
  avgVmax: number;
  /** Current NFI ratio */
  nfi: number;
  /** Current NFI status */
  nfiStatus: NFIStatus;
  /** Training Stress Balance */
  tsb: number;
  /** Athlete age */
  age: number;
  /** Number of valid activities in the dataset */
  activityCount: number;
  /** Parsed training intervals from recent sessions (optional — improves accuracy) */
  trainingIntervals?: TrackInterval[];
}

/**
 * Race time estimator for 100m, 200m, and 400m outdoor track.
 *
 * Model basis:
 * 1. Uses the athlete's max velocity (Vmax) as the primary predictor.
 *    Elite 100m sprinters sustain ~96% of Vmax over 100m.
 *    Masters sprinters sustain a lower % that degrades with distance.
 *
 * 2. Reaction time + acceleration phase modelled as fixed overhead.
 *
 * 3. Speed endurance model (enhanced with training history):
 *    - Base fractions calibrated against WMA masters performance data
 *    - When training intervals are available, the model adjusts based on:
 *      a) Personal speed endurance index (how well the athlete maintains speed)
 *      b) Acceleration profile (actual time-to-peak from training)
 *      c) Best flying velocity (more relevant than raw Vmax for race modeling)
 *
 * 4. Age adjustment: Masters athletes lose ~0.7% per year past 35.
 *
 * 5. Readiness modifier: NFI and TSB fine-tune the estimate for current form.
 */
export class RaceEstimator {
  /** Reaction time in seconds (IAAF average) */
  private static readonly REACTION_TIME = 0.15;

  /**
   * Baseline fraction of Vmax sustained as average speed over each distance.
   * These are the defaults when no training history is available.
   */
  private static readonly BASE_SPEED_SUSTAIN: Record<100 | 200 | 400, number> = {
    100: 0.91,
    200: 0.88,
    400: 0.78,
  };

  /**
   * Analyse all training intervals to build a training profile.
   * This profile captures the athlete's actual capabilities from workout data.
   */
  static buildTrainingProfile(intervals: TrackInterval[], peakVmax: number): TrainingProfile {
    // --- Speed Endurance Index ---
    // Use SpeedEndurance (80–150m) and SpecialEndurance (>150m) intervals
    const seIntervals = intervals.filter(
      (i) => i.type === 'SpeedEndurance' || i.type === 'SpecialEndurance'
    );
    let speedEnduranceIndex = 0;
    if (seIntervals.length > 0 && peakVmax > 0) {
      // For each SE interval, compute avg speed as distance/duration
      const ratios = seIntervals.map((i) => {
        const avgSpeed = i.distance / i.duration;
        return avgSpeed / peakVmax;
      });
      speedEnduranceIndex = ratios.reduce((a, b) => a + b, 0) / ratios.length;
    }

    // --- Best Flying Velocity ---
    const flyingVelocities = intervals
      .filter((i) => i.flyingVelocity > 0)
      .map((i) => i.flyingVelocity);
    const bestFlyingVelocity = flyingVelocities.length > 0
      ? Math.max(...flyingVelocities)
      : 0;

    // --- Acceleration Profile ---
    // Use Acceleration intervals (0–40m) to measure time to peak
    const accelIntervals = intervals.filter((i) => i.type === 'Acceleration');
    let avgAccelerationTime = 0;
    if (accelIntervals.length > 0) {
      const accelTimes = accelIntervals.map((i) => i.duration);
      avgAccelerationTime = accelTimes.reduce((a, b) => a + b, 0) / accelTimes.length;
    }

    return {
      speedEnduranceIndex,
      bestFlyingVelocity,
      avgAccelerationTime,
      seIntervalCount: seIntervals.length,
      accelIntervalCount: accelIntervals.length,
    };
  }

  /**
   * Compute dynamic speed sustain fractions based on training profile.
   * Falls back to baseline fractions when training data is insufficient.
   */
  private static getDynamicSustainFractions(
    profile: TrainingProfile | null,
  ): Record<100 | 200 | 400, number> {
    const base = { ...this.BASE_SPEED_SUSTAIN };

    if (!profile) return base;

    // Adjust 200m and 400m fractions based on speed endurance index
    // SE Index ~0.85 is typical for trained sprinters; adjust relative to that baseline
    if (profile.seIntervalCount >= 2 && profile.speedEnduranceIndex > 0) {
      const seDeviation = profile.speedEnduranceIndex - 0.85;
      // Scale: +0.01 SE index → +0.005 sustain fraction (moderate influence)
      base[200] = Math.max(0.82, Math.min(0.93, base[200] + seDeviation * 0.5));
      base[400] = Math.max(0.70, Math.min(0.85, base[400] + seDeviation * 0.7));
    }

    // Adjust 100m fraction if acceleration data shows strong starts
    if (profile.accelIntervalCount >= 3 && profile.avgAccelerationTime > 0) {
      // Faster average acceleration (lower time) → higher sustain fraction
      // Typical 30m acceleration: ~4–5s. Under 4s = elite-level.
      if (profile.avgAccelerationTime < 4.5) {
        const bonus = (4.5 - profile.avgAccelerationTime) * 0.01;
        base[100] = Math.min(0.95, base[100] + bonus);
      }
    }

    return base;
  }

  /**
   * Generate race estimates for 100m, 200m, 400m.
   */
  static estimate(input: RaceEstimatorInput): RaceEstimate[] {
    const distances: Array<100 | 200 | 400> = [100, 200, 400];
    return distances.map((d) => this.estimateDistance(d, input));
  }

  private static estimateDistance(
    distance: 100 | 200 | 400,
    input: RaceEstimatorInput,
  ): RaceEstimate {
    // Use the best Vmax seen in 60 days as the capability ceiling
    const peakVmax = Math.max(input.bestVmax60d, input.avgVmax);

    if (peakVmax <= 0) {
      return {
        distance,
        predictedTime: 0,
        display: '--',
        confidence: 'low',
        note: 'Insufficient velocity data',
        phases: { reaction: 0, acceleration: 0, maxVelocity: 0, deceleration: 0 },
      };
    }

    // Build training profile if interval data is available
    const profile = input.trainingIntervals && input.trainingIntervals.length > 0
      ? this.buildTrainingProfile(input.trainingIntervals, peakVmax)
      : null;

    // Use dynamic sustain fractions when training history is available
    const sustainFractions = this.getDynamicSustainFractions(profile);
    const sustainFraction = sustainFractions[distance];

    // If we have a best flying velocity from training, blend it with raw Vmax
    // Flying velocity is more representative of race-achievable top speed
    let effectiveVmax = peakVmax;
    if (profile && profile.bestFlyingVelocity > 0) {
      // Blend: 60% flying velocity, 40% raw Vmax (flying is more race-relevant)
      effectiveVmax = profile.bestFlyingVelocity * 0.6 + peakVmax * 0.4;
      // But never exceed the raw peak — flying velocity filters noise
      effectiveVmax = Math.min(effectiveVmax, peakVmax * 1.02);
    }

    let avgSpeed = effectiveVmax * sustainFraction;

    // Age adjustment: degrade by 0.7% per year past 35
    const agePenalty = input.age > 35 ? 1 - (input.age - 35) * AGE_DEGRADATION_PER_YEAR : 1;
    avgSpeed *= Math.max(agePenalty, 0.65); // Floor at 35% degradation

    // Neural readiness modifier: NFI < 1.0 means current form is below baseline
    // Apply a mild modifier (up to ±2%) based on current readiness
    const readinessModifier = this.getReadinessModifier(input.nfi, input.tsb);
    avgSpeed *= readinessModifier;

    // Calculate time = distance / avgSpeed + reaction
    const rawTime = distance / avgSpeed + this.REACTION_TIME;
    const predictedTime = parseFloat(rawTime.toFixed(2));

    const confidence = this.getConfidence(input, profile);
    const note = this.getNote(distance, input, readinessModifier, profile);
    const phases = this.computePhaseBreakdown(distance, effectiveVmax, avgSpeed, profile);

    return {
      distance,
      predictedTime,
      display: this.formatTime(predictedTime),
      confidence,
      note,
      phases,
    };
  }

  /**
   * Readiness modifier — adjusts estimate based on current freshness.
   * NFI > 1.0 and TSB > 0 → slightly faster (up to +2%)
   * NFI < 0.94 or TSB < -20 → slower (up to -3%)
   */
  private static getReadinessModifier(nfi: number, tsb: number): number {
    let mod = 1.0;

    // NFI component: scale linearly from 0.94 → 1.03
    // NFI 1.0 → mod +0% ; NFI 0.94 → mod -2% ; NFI 1.03 → mod +1%
    mod += (nfi - 1.0) * 0.33;

    // TSB component: fresh (TSB > 5) gives a small boost, fatigued (TSB < -20) degrades
    if (tsb > 5) {
      mod += Math.min(tsb * 0.001, 0.01); // up to +1%
    } else if (tsb < -10) {
      mod += Math.max(tsb * 0.0005, -0.015); // down to -1.5%
    }

    // Clamp to reasonable range
    return Math.max(0.95, Math.min(1.03, mod));
  }

  /**
   * Compute a breakdown of predicted time into race phases.
   */
  private static computePhaseBreakdown(
    distance: 100 | 200 | 400,
    effectiveVmax: number,
    avgSpeed: number,
    profile: TrainingProfile | null,
  ): RacePhaseBreakdown {
    const reaction = this.REACTION_TIME;
    const totalRunTime = distance / avgSpeed;

    // Acceleration phase: ~30m for 100m, ~40m for 200m, ~50m for 400m
    const accelDistance = distance <= 100 ? 30 : distance <= 200 ? 40 : 50;
    // Average speed during acceleration ≈ 55% of effective Vmax
    const accelAvgSpeed = effectiveVmax * 0.55;
    let accelerationTime = accelDistance / accelAvgSpeed;

    // Use actual acceleration profile if available
    if (profile && profile.accelIntervalCount >= 2 && profile.avgAccelerationTime > 0) {
      // Scale the training acceleration time to the race acceleration distance
      // Training intervals are typically ~30m
      accelerationTime = profile.avgAccelerationTime * (accelDistance / 30);
    }

    // Max velocity phase distance
    const maxVelDistance = distance <= 100
      ? distance - accelDistance             // 100m: ~70m after acceleration
      : distance <= 200
      ? Math.min(60, distance - accelDistance) // 200m: up to 60m at top speed
      : Math.min(50, distance - accelDistance); // 400m: ~50m at top speed before endurance phase

    const maxVelocityTime = maxVelDistance / effectiveVmax;

    // Deceleration / speed endurance phase = remainder
    const decelTime = Math.max(0, totalRunTime - accelerationTime - maxVelocityTime);

    return {
      reaction: parseFloat(reaction.toFixed(2)),
      acceleration: parseFloat(accelerationTime.toFixed(2)),
      maxVelocity: parseFloat(maxVelocityTime.toFixed(2)),
      deceleration: parseFloat(decelTime.toFixed(2)),
    };
  }

  private static getConfidence(
    input: RaceEstimatorInput,
    profile: TrainingProfile | null,
  ): 'high' | 'moderate' | 'low' {
    // Training history boosts confidence
    const hasGoodHistory = profile !== null
      && profile.seIntervalCount >= 2
      && profile.accelIntervalCount >= 2;

    if (input.activityCount >= 10 && input.bestVmax60d > 0 && hasGoodHistory) return 'high';
    if (input.activityCount >= 10 && input.bestVmax60d > 0) return 'high';
    if (input.activityCount >= 3) return 'moderate';
    return 'low';
  }

  private static getNote(
    distance: 100 | 200 | 400,
    input: RaceEstimatorInput,
    readinessMod: number,
    profile: TrainingProfile | null,
  ): string {
    const parts: string[] = [];

    if (profile && profile.seIntervalCount >= 2) {
      parts.push(`SE index ${(profile.speedEnduranceIndex * 100).toFixed(0)}%`);
    }

    if (profile && profile.bestFlyingVelocity > 0) {
      parts.push(`Flying ${profile.bestFlyingVelocity.toFixed(1)} m/s`);
    }

    if (input.age >= 40) {
      parts.push(`Age-adjusted (${input.age}y)`);
    }

    if (readinessMod < 0.99) {
      parts.push('Fatigue penalty applied');
    } else if (readinessMod > 1.01) {
      parts.push('Peak form bonus');
    }

    if (distance === 400 && input.nfiStatus === 'red') {
      parts.push('Speed endurance likely compromised');
    }

    if (input.activityCount < 5) {
      parts.push('Limited training data');
    }

    if (!profile && input.activityCount >= 5) {
      parts.push('No interval history — using Vmax model only');
    }

    return parts.length > 0 ? parts.join(' · ') : 'Based on recent training Vmax';
  }

  /**
   * Format seconds to display string.
   * < 60s  → "11.23"
   * >= 60s → "1:02.45"
   */
  static formatTime(seconds: number): string {
    if (seconds <= 0) return '--';
    if (seconds < 60) {
      return seconds.toFixed(2);
    }
    const mins = Math.floor(seconds / 60);
    const secs = seconds - mins * 60;
    return `${mins}:${secs < 10 ? '0' : ''}${secs.toFixed(2)}`;
  }
}
