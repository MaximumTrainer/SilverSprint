export interface TrackInterval {
  type: 'Acceleration' | 'MaxVelocity' | 'SpeedEndurance' | 'SpecialEndurance';
  distance: number;
  vMax: number;
  duration: number;
  /** Average velocity of the top sustained window (flying speed). */
  flyingVelocity: number;
}

/**
 * §2.1 / §3.1 — Sprint Parser Engine
 *
 * A 1Hz velocity stream analyzer that identifies:
 *   - Acceleration (0–30m): Slope from V < 1m/s to V_peak
 *   - MaxVelocity / Flying 10s/30s: Peak velocity maintained over a 10m–30m window
 *   - Speed Endurance: Velocity maintenance in intervals > 80m
 *   - Special Endurance: Intervals > 150m
 */
export class SprintParser {
  /** Minimum velocity to consider as "moving" within a rep */
  private static readonly MOVING_THRESHOLD = 1.0; // m/s — spec: V < 1 m/s is standing
  /** Minimum distance to count as a valid rep */
  private static readonly MIN_REP_DISTANCE = 10; // metres
  /** Interval types from the Intervals.icu API that represent active sprint work */
  private static readonly WORK_INTERVAL_TYPES = ['WORK', 'ACTIVE'] as const;

  /**
   * Parse a full session's velocity_smooth stream into classified intervals.
   * Each second in the stream is treated as 1 sample at the given velocity (1Hz).
   * Distance per sample ≈ velocity × 1s.
   */
  public static parseTrackSession(activity: { velocity_smooth?: number[] }): TrackInterval[] {
    const stream = activity.velocity_smooth || [];
    const intervals: TrackInterval[] = [];
    let currentBurst: number[] = [];

    for (let i = 0; i <= stream.length; i++) {
      const v = i < stream.length ? stream[i] : 0;

      if (v >= this.MOVING_THRESHOLD) {
        currentBurst.push(v);
      } else if (currentBurst.length > 0) {
        const interval = this.classifyBurst(currentBurst);
        if (interval) {
          intervals.push(interval);
        }
        currentBurst = [];
      }
    }

    return intervals;
  }

  /**
   * Classify a contiguous burst of samples into a TrackInterval.
   */
  private static classifyBurst(burst: number[]): TrackInterval | null {
    // Total distance = sum of all velocities × 1s
    const distance = burst.reduce((sum, v) => sum + v, 0);

    if (distance < this.MIN_REP_DISTANCE) {
      return null;
    }

    const vMax = Math.max(...burst);
    const flyingVelocity = this.computeFlyingVelocity(burst);
    const type = this.classifyType(distance);

    return {
      type,
      distance: Math.round(distance),
      vMax,
      duration: burst.length,
      flyingVelocity,
    };
  }

  /**
   * §3.1 — Distance-based classification:
   *   0–40m  → Acceleration
   *   40–80m → MaxVelocity (flying zone)
   *   80–150m → SpeedEndurance
   *   >150m  → SpecialEndurance
   */
  private static classifyType(distance: number): TrackInterval['type'] {
    if (distance <= 40) return 'Acceleration';
    if (distance <= 80) return 'MaxVelocity';
    if (distance <= 150) return 'SpeedEndurance';
    return 'SpecialEndurance';
  }

  /**
   * Convert a single interval from the Intervals.icu
   * GET /api/v1/activity/{id}/intervals API response into a TrackInterval.
   *
   * Returns null if the interval lacks sufficient data (too short, no speed, etc.).
   * Only WORK-type intervals (or intervals with no type) are included so that
   * rest / warm-up segments are automatically excluded.
   */
  public static fromAPIInterval(interval: {
    distance?: number;
    elapsed_time?: number;
    moving_time?: number;
    average_speed?: number;
    max_speed?: number;
    type?: string;
  }): TrackInterval | null {
    // Exclude explicit non-work segments
    if (interval.type && !(this.WORK_INTERVAL_TYPES as readonly string[]).includes(interval.type)) {
      return null;
    }

    const distance = interval.distance ?? 0;
    const duration = interval.moving_time ?? interval.elapsed_time ?? 0;
    const vMax = interval.max_speed ?? 0;
    const flyingVelocity = interval.average_speed ?? 0;

    if (distance < this.MIN_REP_DISTANCE || duration <= 0 || vMax <= 0) {
      return null;
    }

    return {
      type: this.classifyType(distance),
      distance: Math.round(distance),
      vMax,
      duration,
      flyingVelocity,
    };
  }

  /**
   * §3.1 — Flying velocity: average of the peak sustained window.
   * Uses a sliding window of up to 3 seconds to find the best average.
   */
  private static computeFlyingVelocity(burst: number[]): number {
    if (burst.length === 0) return 0;
    if (burst.length <= 3) {
      return burst.reduce((a, b) => a + b, 0) / burst.length;
    }

    let bestAvg = 0;
    const windowSize = Math.min(3, burst.length);
    for (let i = 0; i <= burst.length - windowSize; i++) {
      const windowAvg =
        burst.slice(i, i + windowSize).reduce((a, b) => a + b, 0) / windowSize;
      if (windowAvg > bestAvg) {
        bestAvg = windowAvg;
      }
    }
    return parseFloat(bestAvg.toFixed(2));
  }
}