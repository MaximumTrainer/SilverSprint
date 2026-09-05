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
 *   - Acceleration (0–40m): Slope from V < 1m/s to V_peak
 *   - MaxVelocity / Flying 10s/60s: Peak velocity maintained over a 40m–80m window
 *   - Speed Endurance: Velocity maintenance in intervals 80m–150m
 *   - Special Endurance: Intervals 150m–400m
 *
 * Only sprint-range efforts (≥ 10m and ≤ 400m) are included.
 */
export class SprintParser {
  /** Minimum velocity to consider as "moving" within a rep */
  private static readonly MOVING_THRESHOLD = 1.0; // m/s — spec: V < 1 m/s is standing
  /** Minimum distance to count as a valid rep */
  private static readonly MIN_REP_DISTANCE = 10; // metres
  /** Maximum distance to count as a sprint interval — 400m is the longest sprint event */
  private static readonly MAX_SPRINT_DISTANCE = 400; // metres
  /**
   * Interval types from the Intervals.icu API that represent rest/recovery.
   * All OTHER types (WORK, ACTIVE, INTERVAL, LAP, etc.) are accepted so that
   * both structured workout intervals AND auto-detected efforts are included.
   */
  private static readonly REST_INTERVAL_TYPES = ['REST', 'ACTIVE_REST', 'WARMUP', 'COOLDOWN', 'RECOVERY'] as const;

  /**
   * Minimum average speed (m/s) for a sprint interval, derived from a
   * 3:00 min/km pace: 1000 m / 180 s ≈ 5.556 m/s.
   * Anything slower is not a sprint effort (jog / walk-back / rest).
   */
  private static readonly MIN_SPRINT_PACE_SPEED = 1000 / 180; // ≈ 5.556 m/s — pace < 3:00/km

  /**
   * Maximum duration (seconds) for a sprint interval.
   * Sprint efforts (30–150 m) are completed in under 25 s even at recreational
   * pace.  Longer intervals are recovery jogs or distance-running laps.
   */
  private static readonly MAX_SPRINT_DURATION = 25; // seconds

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

    if (distance < this.MIN_REP_DISTANCE || distance > this.MAX_SPRINT_DISTANCE) {
      return null;
    }

    // Reject bursts longer than the maximum sprint duration
    if (burst.length > this.MAX_SPRINT_DURATION) {
      return null;
    }

    // Reject bursts with average pace slower than 3:00/km
    const avgSpeed = distance / burst.length;
    if (avgSpeed < this.MIN_SPRINT_PACE_SPEED) {
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
   * Returns null if the interval lacks sufficient data (too short, too long, no speed, etc.).
   * Only WORK-type intervals (or intervals with no type) are included so that
   * rest / warm-up segments are automatically excluded.
   * Only sprint-range intervals (≥ 10m and ≤ 400m) are included.
   */
  public static fromAPIInterval(interval: {
    distance?: number | null;
    elapsed_time?: number | null;
    moving_time?: number | null;
    average_speed?: number | null;
    max_speed?: number | null;
    type?: string | null;
  }): TrackInterval | null {
    // Exclude explicit rest/recovery segments; accept everything else (WORK, ACTIVE, INTERVAL, LAP, etc.)
    if (interval.type && (this.REST_INTERVAL_TYPES as readonly string[]).includes(interval.type)) {
      return null;
    }

    const distance = interval.distance ?? 0;
    const duration = interval.moving_time ?? interval.elapsed_time ?? 0;
    const averageSpeed = interval.average_speed ?? 0;
    // Peak speed is the greater of the two reported speeds, not simply max_speed.
    // On short laps the device computes average_speed and max_speed over
    // different windows and can report average_speed > max_speed; taking
    // max_speed alone would then yield a flying velocity faster than the rep's
    // own peak, which is physically impossible and inflates the race model.
    // The fallback also covers workouts where peak speed is omitted entirely.
    const vMax = Math.max(interval.max_speed ?? 0, averageSpeed);
    const flyingVelocity = averageSpeed;

    if (distance < this.MIN_REP_DISTANCE || distance > this.MAX_SPRINT_DISTANCE || duration <= 0 || vMax <= 0) {
      return null;
    }

    // Reject intervals that exceed the maximum sprint duration (25 s).
    if (duration > this.MAX_SPRINT_DURATION) {
      return null;
    }

    // Reject intervals with average pace slower than 3:00/km.
    // Computed from distance/time (not the API's average_speed) so the check
    // is always applied, even when the API omits average_speed.
    const computedAvgSpeed = distance / duration;
    if (computedAvgSpeed < this.MIN_SPRINT_PACE_SPEED) {
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
    // Rounding a near-constant burst up can push the sustained average past the
    // burst's own peak (e.g. 7.995 → 8.00), which is physically impossible.
    return Math.min(parseFloat(bestAvg.toFixed(2)), Math.max(...burst));
  }
}