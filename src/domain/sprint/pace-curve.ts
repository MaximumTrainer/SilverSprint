import { z } from 'zod';

/**
 * §3.5 — Sprint pace curve (mean-maximal speed over short distances).
 *
 * A pace curve is the athlete's best time over every distance in a window. The
 * endurance-running version spans 1 km to marathon; a sprinter's entire event
 * lives between 10 m and 400 m, so this module builds the curve at those
 * distances instead.
 *
 * ── Why this is computed locally ────────────────────────────────────────────
 * Intervals.icu exposes `GET /athlete/{id}/pace-curves?type=Run`, and it is
 * unusable here. Its distance ladder bottoms out at 45.72 m (50 yards), so
 * 10/20/30/60 m are simply absent, and every value it reports below ~250 m is
 * corrupted by GPS spikes — a live masters account returned a "best" of 1 s for
 * both 45.7 m and 100 m, and 5 s for 200 m. The endpoint takes no distance
 * parameter, so neither problem can be worked around by asking differently.
 * The curve is therefore derived from the athlete's own 1 Hz streams, with the
 * outlier rejection below, and the upstream endpoint is not used at all.
 *
 * This module is pure: no I/O, no React, no knowledge of Intervals.icu's
 * transport shapes. Callers hand it already-parsed streams.
 */

/** The preset ladder offered in the UI. Whole metres, ascending. */
export const PACE_CURVE_PRESET_DISTANCES = [10, 20, 30, 40, 60, 80, 100, 150, 200, 300, 400] as const;

/**
 * Selection for an athlete who has never configured the curve: the standard
 * masters sprint distances (100/200/400) plus the two most common training
 * reps (30/60).
 */
export const DEFAULT_PACE_CURVE_DISTANCES: readonly number[] = [30, 60, 100, 200, 400];

/** Shortest distance that can be charted. Below this, 1 Hz sampling resolves nothing. */
export const MIN_CURVE_DISTANCE = 5;
/** Longest distance that can be charted — 400 m is the longest sprint event. */
export const MAX_CURVE_DISTANCE = 400;
/** Ceiling on simultaneously-charted distances, to keep the chart legible and bound the work. */
export const MAX_ACTIVE_DISTANCES = 12;

/**
 * Absolute physiological speed ceiling, m/s.
 *
 * The current 100 m world record averages 10.44 m/s and peaks near 12.3 m/s,
 * so nothing a masters athlete records can legitimately average more than this
 * over any distance. Anything above it is a GPS artifact — the same class of
 * error as the dog walk reporting `max_speed` 11.93 m/s in the fixtures.
 */
export const MAX_PLAUSIBLE_SPEED = 12.5;

/**
 * Headroom over the athlete's own 60-day peak velocity.
 *
 * The absolute ceiling only catches gross corruption. An athlete whose real
 * best is 8.9 m/s cannot average 11 m/s over 60 m either, so the account's own
 * Vmax provides a second, much tighter bound.
 */
export const VMAX_HEADROOM = 1.15;

/**
 * Maximum share of `null` samples tolerated in a stream. Above this the device
 * lost GPS often enough that integrating distance from it is meaningless, and
 * the whole activity is discarded rather than contributing a fabricated best.
 */
export const MAX_NULL_SAMPLE_RATE = 0.1;

/**
 * ── Why distance is integrated from velocity, not read from `distance` ──────
 *
 * Intervals.icu serves both a `distance` stream and a `velocity_smooth` stream
 * for the same run, and **they do not agree**. Measured on a live masters
 * account, the per-sample deltas of the distance stream implied 9.4–9.9 m/s in
 * sessions whose own `velocity_smooth` peaked at 8.92 m/s. Reading distance
 * from that stream therefore produced curve points from 10 m to 60 m whose
 * *average* speed was higher than the fastest instant the device ever recorded
 * — which cannot happen: an average over a window is a weighted mean of the
 * samples inside it, so it is bounded by their maximum.
 *
 * The disagreement is systematic, not a handful of spikes, so it cannot be cut
 * out as an artifact. Integrating `velocity_smooth` instead makes that bound
 * hold by construction, and it is what {@link SprintParser} already does, so
 * the whole app derives distance one way. Against three official race times
 * the two sources were within 2% of each other (0.88 vs 0.90 of official), so
 * self-consistency costs essentially nothing in accuracy.
 *
 * The `distance` stream is still used when there is no usable velocity trace.
 */
export const VELOCITY_STREAM_TOLERANCE = 1.02;

/**
 * Fraction of the athlete's peak velocity below which a "best" is not an effort.
 *
 * A mean-maximal curve reports the fastest window it can find, and when the
 * athlete never ran hard at a distance in the window it dutifully returns
 * their steadiest jog. On a live account that produced a 400 m "best" of 116 s
 * at 3.45 m/s sitting directly beside a 300 m point of 41.7 s at 7.20 m/s
 * taken from a race — arithmetically consistent, and readable as a collapse in
 * speed endurance that had not happened.
 *
 * Real sprint efforts up to 400 m stay well above this fraction of peak (the
 * live 400 m race averaged 78%); jogs and warm-ups sit far below it (39%).
 * Points under the line are flagged rather than hidden: the number is still
 * the athlete's best, it just is not evidence about their speed.
 */
export const EFFORT_FRACTION_OF_PEAK = 0.55;

// ── distance selection ──────────────────────────────────────────────────────

/**
 * A selected distance set.
 *
 * Everything here is untrusted: it arrives from a text field or from
 * `localStorage`, which any script on the origin can write to. Values are
 * de-duplicated and sorted ascending on parse (FR-6), so downstream code never
 * has to re-sort and the chart's x-order is fixed at the boundary.
 */
export const PaceCurveDistancesSchema = z
  .array(z.number().int().gte(MIN_CURVE_DISTANCE).lte(MAX_CURVE_DISTANCE))
  .transform((distances) => [...new Set(distances)].sort((a, b) => a - b))
  .refine((distances) => distances.length >= 1 && distances.length <= MAX_ACTIVE_DISTANCES, {
    message: `Select between 1 and ${MAX_ACTIVE_DISTANCES} distances`,
  });

/** The persisted payload. Wrapped in an object so the shape can grow without a migration. */
export const PaceCurveSelectionSchema = z.object({
  distances: PaceCurveDistancesSchema,
});

export type PaceCurveSelection = z.infer<typeof PaceCurveSelectionSchema>;

/**
 * Validate a stored selection, falling back to the defaults.
 *
 * A corrupt payload is a storage bug or a hostile write, not a reason to blank
 * the panel — the athlete gets the default ladder and nothing throws.
 */
export function parsePaceCurveDistances(raw: unknown): number[] {
  const parsed = PaceCurveSelectionSchema.safeParse(raw);
  if (parsed.success) return parsed.data.distances;
  return [...DEFAULT_PACE_CURVE_DISTANCES];
}

/** The outcome of an edit: either the new set, or why it was refused. */
export type DistanceEdit =
  | { ok: true; distances: number[] }
  | { ok: false; message: string };

/**
 * Add a distance to the selection.
 *
 * Every refusal names the specific rule that was broken, so the athlete is
 * never left guessing which of the four bounds they hit.
 */
export function addPaceCurveDistance(current: readonly number[], distance: number): DistanceEdit {
  if (!Number.isFinite(distance) || !Number.isInteger(distance)) {
    return { ok: false, message: 'Enter a whole number of metres' };
  }
  if (distance < MIN_CURVE_DISTANCE || distance > MAX_CURVE_DISTANCE) {
    return { ok: false, message: `Distances must be between ${MIN_CURVE_DISTANCE} m and ${MAX_CURVE_DISTANCE} m` };
  }
  if (current.includes(distance)) {
    // Deliberately not a silent merge: the athlete asked for something that is
    // already there, and quietly succeeding hides a mis-typed entry.
    return { ok: false, message: `${distance} m is already on the curve` };
  }
  if (current.length >= MAX_ACTIVE_DISTANCES) {
    return { ok: false, message: `The curve holds at most ${MAX_ACTIVE_DISTANCES} distances — remove one first` };
  }
  return { ok: true, distances: [...current, distance].sort((a, b) => a - b) };
}

/** Remove a distance. The last one cannot be removed — an empty curve shows nothing. */
export function removePaceCurveDistance(current: readonly number[], distance: number): DistanceEdit {
  if (!current.includes(distance)) {
    return { ok: false, message: `${distance} m is not on the curve` };
  }
  if (current.length <= 1) {
    return { ok: false, message: 'Keep at least one distance on the curve' };
  }
  return { ok: true, distances: current.filter((d) => d !== distance) };
}

/** Toggle a preset chip: remove it when selected, add it when not. */
export function togglePaceCurveDistance(current: readonly number[], distance: number): DistanceEdit {
  return current.includes(distance)
    ? removePaceCurveDistance(current, distance)
    : addPaceCurveDistance(current, distance);
}

// ── date range ──────────────────────────────────────────────────────────────

/** Rolling windows, plus season-to-date for athletes whose year has a shape. */
export type PaceCurveRange = 30 | 60 | 90 | 'season';

export const PACE_CURVE_RANGES: readonly PaceCurveRange[] = [30, 60, 90, 'season'];

/** 90 days spans a full training block without reaching back into last season. */
export const DEFAULT_PACE_CURVE_RANGE: PaceCurveRange = 90;

export const PACE_CURVE_RANGE_LABELS: Record<string, string> = {
  30: '30 days',
  60: '60 days',
  90: '90 days',
  season: 'Season',
};

/**
 * The inclusive `YYYY-MM-DD` an activity must fall on or after to be in range.
 *
 * Uses the same UTC-normalised formatting as the rest of the sync layer, so a
 * window start and an activity date are always comparable as plain strings.
 */
export function paceCurveWindowStart(range: PaceCurveRange, now: Date): string {
  if (range === 'season') {
    // "Season to date" is the calendar year: a masters outdoor season and its
    // indoor lead-in both sit inside one year, and January is the only
    // boundary every athlete shares.
    return `${now.toISOString().slice(0, 4)}-01-01`;
  }
  const start = new Date(now);
  start.setDate(start.getDate() - range);
  return start.toISOString().slice(0, 10);
}

/** Longest window the curve can ask for, in days — bounds what the sync must fetch. */
export function paceCurveWindowDays(now: Date): number {
  const seasonStart = Date.parse(`${now.toISOString().slice(0, 4)}-01-01T00:00:00.000Z`);
  const sinceSeasonStart = Math.ceil((now.getTime() - seasonStart) / 86_400_000);
  return Math.max(90, sinceSeasonStart);
}

// ── curve computation ───────────────────────────────────────────────────────

/** One activity's stream data, already parsed out of the API's transport shape. */
export interface PaceCurveActivityStream {
  activityId: string;
  /** Activity title, shown so a surprising result can be traced and disbelieved. */
  name: string;
  /** Local activity date, `YYYY-MM-DD`. */
  date: string;
  /** 1 Hz velocity samples in m/s. `null` marks a GPS dropout. */
  velocitySmooth: Array<number | null>;
  /**
   * Cumulative distance in metres, when the device supplied one. Preferred
   * over integrating velocity: it is device-corrected, and integration
   * compounds every sampling error along the rep.
   */
  distance?: Array<number | null>;
  /** Elapsed seconds per sample. Defaults to the sample index (1 Hz). */
  time?: Array<number | null>;
}

/** One charted distance. `timeSeconds` is null when nothing qualified (FR-11). */
export interface PaceCurvePoint {
  distance: number;
  timeSeconds: number | null;
  /** Average speed over the effort, m/s. */
  speed: number | null;
  activityId: string | null;
  activityName: string | null;
  /** Local date of the source activity, `YYYY-MM-DD`. */
  date: string | null;
  /**
   * True when the best effort found was not a hard one — the athlete has no
   * genuine effort at this distance in the window, so the point measures their
   * steadiest running rather than their speed.
   *
   * @see EFFORT_FRACTION_OF_PEAK
   */
  submaximal: boolean;
}

export interface PaceCurve {
  /** One entry per selected distance, ascending. Distances with no effort are included. */
  points: PaceCurvePoint[];
  /**
   * Contiguous stretches of stream discarded for implying an impossible speed.
   * Surfaced rather than swallowed: a systematically bad device shows up here
   * as a number that keeps climbing.
   */
  excludedEfforts: number;
  /** Activities discarded whole because their stream was mostly GPS dropout. */
  excludedActivities: number;
  /** Activities that fell in the window and carried a usable stream. */
  activitiesUsed: number;
}

export interface PaceCurveInput {
  streams: readonly PaceCurveActivityStream[];
  distances: readonly number[];
  /** Inclusive `YYYY-MM-DD`; activities before it are ignored. */
  since?: string;
  /**
   * The athlete's 60-day peak velocity in m/s, used for the account-specific
   * ceiling. Zero or omitted falls back to the absolute ceiling alone.
   */
  bestVmax60d?: number;
}

/** A stretch of stream with no dropouts and no impossible samples. */
interface CleanSegment {
  /** Elapsed seconds, strictly increasing. */
  t: number[];
  /** Cumulative metres, non-decreasing. */
  d: number[];
}

/**
 * Compute the mean-maximal curve.
 *
 * For each distance, the best time is the shortest elapsed time to cover that
 * many metres anywhere in any qualifying activity, found with a sliding window
 * over cumulative distance. The end of the window is interpolated within its
 * final sample interval: at 8 m/s a 1 Hz sample is 8 m wide, so without
 * interpolation a 10 m point would be quantised beyond usefulness.
 */
export function computePaceCurve(input: PaceCurveInput): PaceCurve {
  const distances = [...new Set(input.distances)].sort((a, b) => a - b);
  const ceiling = speedCeiling(input.bestVmax60d);

  const best = new Map<number, { timeSeconds: number; stream: PaceCurveActivityStream }>();
  let excludedEfforts = 0;
  let excludedActivities = 0;
  let activitiesUsed = 0;

  for (const stream of input.streams) {
    if (input.since && stream.date < input.since) continue;

    const prepared = buildCleanSegments(stream, ceiling);
    if (prepared.dropped) {
      excludedActivities++;
      continue;
    }
    excludedEfforts += prepared.excludedEfforts;
    if (prepared.segments.length === 0) continue;
    activitiesUsed++;

    for (const distance of distances) {
      let bestForActivity: number | null = null;
      for (const segment of prepared.segments) {
        const time = bestTimeOverSegment(segment, distance);
        if (time !== null && (bestForActivity === null || time < bestForActivity)) {
          bestForActivity = time;
        }
      }
      if (bestForActivity === null) continue;

      const incumbent = best.get(distance);
      if (!incumbent || bestForActivity < incumbent.timeSeconds) {
        best.set(distance, { timeSeconds: bestForActivity, stream });
      }
    }
  }

  // The athlete's peak across the streams actually used — the yardstick for
  // deciding whether a "best" represents an effort at all.
  //
  // Samples above the ceiling are excluded: the GPS spikes this module exists
  // to reject would otherwise set the yardstick themselves, and one 102 m/s
  // artifact would mark every genuine sprint on the curve as "easy".
  // Accumulated rather than spread — a season of 1 Hz streams is hundreds of
  // thousands of samples, well past the argument limit of `Math.max`.
  let peak = input.bestVmax60d && Number.isFinite(input.bestVmax60d) ? input.bestVmax60d : 0;
  for (const s of input.streams) {
    for (const v of s.velocitySmooth) {
      if (isSample(v) && v > peak && v <= ceiling) peak = v;
    }
  }

  const points: PaceCurvePoint[] = distances.map((distance) => {
    const hit = best.get(distance);
    if (!hit) {
      return {
        distance, timeSeconds: null, speed: null,
        activityId: null, activityName: null, date: null, submaximal: false,
      };
    }
    const speed = round(distance / hit.timeSeconds, 2);
    return {
      distance,
      timeSeconds: round(hit.timeSeconds, 2),
      speed,
      activityId: hit.stream.activityId,
      activityName: hit.stream.name,
      date: hit.stream.date,
      submaximal: peak > 0 && speed < peak * EFFORT_FRACTION_OF_PEAK,
    };
  });

  return { points, excludedEfforts, excludedActivities, activitiesUsed };
}

/**
 * The effective speed ceiling for one athlete: the tighter of the absolute
 * physiological limit and their own 60-day peak plus headroom.
 */
export function speedCeiling(bestVmax60d?: number): number {
  if (typeof bestVmax60d !== 'number' || !Number.isFinite(bestVmax60d) || bestVmax60d <= 0) {
    return MAX_PLAUSIBLE_SPEED;
  }
  return Math.min(MAX_PLAUSIBLE_SPEED, bestVmax60d * VMAX_HEADROOM);
}

interface PreparedStream {
  segments: CleanSegment[];
  /** Stretches cut out for implying an impossible speed. */
  excludedEfforts: number;
  /** True when the whole activity was discarded for GPS dropout. */
  dropped: boolean;
}

/**
 * Split one stream into stretches that can be safely integrated.
 *
 * Two things break a stretch, and both must break it rather than merely
 * shifting a value:
 *
 *  - a `null` sample — the device recorded nothing, so the distance either
 *    side of the gap is not connected by a known amount of running;
 *  - a sample interval implying a speed above the ceiling — a single spurious
 *    GPS fix is what produced the upstream endpoint's "100 m in 1 second".
 *
 * Cutting at the sample level rather than filtering finished candidates is
 * what makes the curve internally consistent: no surviving window can contain
 * an impossible sub-interval, so a rejected 60 m spike cannot leave the 60 m
 * point slower than the 100 m point that swallowed the same spike.
 */
function buildCleanSegments(stream: PaceCurveActivityStream, ceiling: number): PreparedStream {
  const velocity = stream.velocitySmooth ?? [];
  const n = velocity.length;
  if (n === 0) return { segments: [], excludedEfforts: 0, dropped: false };

  const nulls = velocity.reduce<number>((count, v) => (isSample(v) ? count : count + 1), 0);
  if (nulls / n > MAX_NULL_SAMPLE_RATE) {
    return { segments: [], excludedEfforts: 0, dropped: true };
  }

  // Velocity is integrated in preference to the device's distance stream — see
  // the note on VELOCITY_STREAM_TOLERANCE. The distance stream is the fallback
  // for runs that carry no usable velocity trace at all.
  const streamPeak = velocity.reduce<number>((peak, v) => (isSample(v) && v > peak ? v : peak), 0);
  const distanceStream = streamPeak > 0 ? null : usableDistanceStream(stream, n);
  const effectiveCeiling = ceiling;

  const segments: CleanSegment[] = [];
  let excludedEfforts = 0;
  let current: CleanSegment | null = null;
  // A run of consecutive bad intervals is one artifact, not several, so the
  // count answers "how many bad efforts" rather than "how many bad samples".
  let inBadRun = false;

  const flush = () => {
    if (current && current.t.length >= 2) segments.push(current);
    current = null;
  };

  for (let i = 0; i < n; i++) {
    const rawTime = stream.time?.[i];
    const t = rawTime === undefined ? i : isSample(rawTime) ? rawTime : null;
    const v = velocity[i];
    const dRaw = distanceStream ? distanceStream[i] : null;

    const sampleOk = t !== null && isSample(v) && (!distanceStream || dRaw !== null);
    if (!sampleOk) {
      flush();
      inBadRun = false;
      continue;
    }

    if (current === null) {
      current = { t: [t], d: [distanceStream ? (dRaw as number) : 0] };
      inBadRun = false;
      continue;
    }

    const prevT = current.t[current.t.length - 1];
    const prevD = current.d[current.d.length - 1];
    const dt = t - prevT;
    // Distance either comes from the device or is integrated from velocity over
    // the sample interval; the latter is the fallback the SprintParser already
    // relies on when no distance stream exists.
    const step = distanceStream ? (dRaw as number) - prevD : v * dt;

    const impossible = dt <= 0 || step < 0 || step / dt > effectiveCeiling;
    if (impossible) {
      flush();
      if (!inBadRun) excludedEfforts++;
      inBadRun = true;
      // The sample itself is fine; only the interval leading to it is not, so
      // it becomes the first sample of the next stretch.
      current = { t: [t], d: [distanceStream ? (dRaw as number) : 0] };
      continue;
    }

    inBadRun = false;
    current.t.push(t);
    current.d.push(prevD + step);
  }
  flush();

  return { segments, excludedEfforts, dropped: false };
}

/**
 * The device's cumulative distance stream, when it is present, the right
 * length and actually cumulative. A stream that runs backwards is a device
 * fault; falling back to velocity integration is better than trusting it.
 */
function usableDistanceStream(
  stream: PaceCurveActivityStream,
  n: number,
): Array<number | null> | null {
  const raw = stream.distance;
  if (!raw || raw.length !== n) return null;

  let last: number | null = null;
  let seen = 0;
  const normalised: Array<number | null> = raw.map((value) => {
    if (!isSample(value)) return null;
    if (last !== null && value < last) return null;
    seen++;
    last = value;
    return value;
  });

  return seen > 0 ? normalised : null;
}

/**
 * Shortest time to cover `target` metres within one clean stretch.
 *
 * Two pointers: for every start sample, advance the end until the target is
 * covered. Both indices only move forwards, so this is linear in the stretch
 * length regardless of how many distances are charted.
 */
function bestTimeOverSegment(segment: CleanSegment, target: number): number | null {
  const { t, d } = segment;
  const n = t.length;
  if (n < 2 || target <= 0) return null;
  if (d[n - 1] - d[0] < target) return null;

  let best: number | null = null;
  let end = 1;

  for (let start = 0; start < n - 1; start++) {
    if (end <= start) end = start + 1;
    while (end < n && d[end] - d[start] < target) end++;
    if (end >= n) break;

    let elapsed = t[end] - t[start];
    // Trim the overshoot: the target distance was reached somewhere inside the
    // final sample interval, and at sprint speed that interval is several
    // metres wide.
    const overshoot = d[end] - d[start] - target;
    const stepDistance = d[end] - d[end - 1];
    if (overshoot > 0 && stepDistance > 0) {
      elapsed -= (overshoot / stepDistance) * (t[end] - t[end - 1]);
    }

    if (elapsed > 0 && (best === null || elapsed < best)) best = elapsed;
  }

  return best;
}

// ── invariants ──────────────────────────────────────────────────────────────

/**
 * Monotonicity violations in a computed curve.
 *
 * Best time must be non-decreasing with distance: any window covering 100 m
 * contains a window covering 60 m in no more time, so a curve where 60 m is
 * slower than 100 m is a computation bug, not an athlete.
 *
 * Average speed is checked too, but is a weaker claim. Over *distance* windows
 * — unlike time windows — it is not a theorem: a stream that is fast, then
 * slow, then fast can genuinely hold a 100 m faster than any 60 m inside it.
 * Real sprint efforts do not have that shape, so a violation on running data
 * still points at the computation.
 */
export function paceCurveMonotonicityViolations(curve: PaceCurve): string[] {
  const violations: string[] = [];
  const measured = curve.points.filter(
    (p): p is PaceCurvePoint & { timeSeconds: number; speed: number } =>
      p.timeSeconds !== null && p.speed !== null,
  );

  for (let i = 1; i < measured.length; i++) {
    const prev = measured[i - 1];
    const point = measured[i];
    if (point.timeSeconds < prev.timeSeconds) {
      violations.push(
        `${point.distance} m (${point.timeSeconds}s) is faster than ${prev.distance} m (${prev.timeSeconds}s)`,
      );
    }
    if (point.speed > prev.speed) {
      violations.push(
        `${point.distance} m (${point.speed} m/s) is faster than ${prev.distance} m (${prev.speed} m/s)`,
      );
    }
  }

  return violations;
}

// ── formatting ──────────────────────────────────────────────────────────────

/** `12.34` for sprint times, `1:05.2` once a minute is involved. */
export function formatCurveTime(seconds: number): string {
  if (seconds < 60) return seconds.toFixed(2);
  const minutes = Math.floor(seconds / 60);
  const rest = seconds - minutes * 60;
  return `${minutes}:${rest.toFixed(1).padStart(4, '0')}`;
}

/** Pace as `m:ss /km`, the unit tooltips carry alongside speed. */
export function formatPacePerKm(speed: number): string {
  if (!Number.isFinite(speed) || speed <= 0) return '—';
  const secondsPerKm = 1000 / speed;
  const minutes = Math.floor(secondsPerKm / 60);
  const seconds = Math.round(secondsPerKm - minutes * 60);
  const carried = seconds === 60 ? { m: minutes + 1, s: 0 } : { m: minutes, s: seconds };
  return `${carried.m}:${String(carried.s).padStart(2, '0')} /km`;
}

function isSample(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function round(value: number, places: number): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}
