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
   * Minimum average speed (m/s) to be considered a sprint effort for longer intervals (> 30s).
   * Filters out rest periods that are labelled WORK by Intervals.icu
   * (e.g. 300-second walk-back recovery intervals with avg 0.2–0.6 m/s).
   * Even a standing-start 10 m sprint has an average speed > 4 m/s.
   */
  private static readonly MIN_SPRINT_AVG_SPEED = 4.0; // m/s ≈ 14.4 km/h

  /**
   * Lower average-speed floor for short intervals (≤ 30s).
   * GPS-measured average speed for sub-10s laps is unreliable because the lap
   * boundary may include approach/deceleration time.  We still reject obvious
   * rest intervals (e.g. standing around at < 2 m/s).
   */
  private static readonly MIN_SHORT_INTERVAL_AVG_SPEED = 2.0; // m/s ≈ 7.2 km/h

  /**
   * Duration threshold (seconds): intervals at or below this duration use the
   * lower average-speed floor ({@link MIN_SHORT_INTERVAL_AVG_SPEED}).
   */
  private static readonly SHORT_INTERVAL_DURATION = 30; // seconds

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
    distance?: number;
    elapsed_time?: number;
    moving_time?: number;
    average_speed?: number;
    max_speed?: number;
    type?: string;
  }): TrackInterval | null {
    // Exclude explicit rest/recovery segments; accept everything else (WORK, ACTIVE, INTERVAL, LAP, etc.)
    if (interval.type && (this.REST_INTERVAL_TYPES as readonly string[]).includes(interval.type)) {
      return null;
    }

    const distance = interval.distance ?? 0;
    const duration = interval.moving_time ?? interval.elapsed_time ?? 0;
    // Prefer max_speed; fall back to average_speed when max_speed is absent or zero
    // (some devices / Intervals.icu workouts omit peak-speed data for intervals)
    const vMax = interval.max_speed || interval.average_speed || 0;
    const flyingVelocity = interval.average_speed ?? 0;

    if (distance < this.MIN_REP_DISTANCE || distance > this.MAX_SPRINT_DISTANCE || duration <= 0 || vMax <= 0) {
      return null;
    }

    // Reject rest periods that Intervals.icu labels as WORK: they have very low
    // average speed (e.g. 0.2–0.6 m/s walk-back) even though max_speed may be
    // non-zero (residual from the preceding sprint). Any real sprint effort —
    // even a short standing-start — produces an average speed above this floor.
    // Short intervals (≤ 30s) use a lower threshold because GPS-measured average
    // speed is unreliable for sub-10s laps (approach/deceleration artefacts).
    const speedFloor = duration <= this.SHORT_INTERVAL_DURATION
      ? this.MIN_SHORT_INTERVAL_AVG_SPEED
      : this.MIN_SPRINT_AVG_SPEED;
    if (flyingVelocity > 0 && flyingVelocity < speedFloor) {
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