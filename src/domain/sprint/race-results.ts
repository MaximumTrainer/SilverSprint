import { z } from 'zod';

/**
 * §3.4 — Known Race Results and Model Calibration
 *
 * A velocity-derived race model cannot know an athlete's individual start
 * technique, race-day mechanics or speed-endurance profile. An actual result
 * does. When the athlete supplies times they have really run, those results
 * are used to calibrate the prediction for each distance.
 *
 * This module owns the result entity, its validation, and the calibration
 * maths. It deliberately does **not** import the race estimator: the caller
 * supplies the model's own baseline predictions, so the dependency runs one
 * way (estimator → results) and the calibration stays independently testable.
 */

/** Race distances the estimator models, and therefore the distances that can be calibrated. */
export const CALIBRATABLE_DISTANCES = [100, 200, 400] as const;
export type RaceDistance = (typeof CALIBRATABLE_DISTANCES)[number];

/**
 * Age degradation rate: ~0.7% per year past age 35, from WMA masters data.
 *
 * Defined here rather than in the estimator so that both the estimator and the
 * calibration maths share one source of truth without a circular import.
 */
export const AGE_DEGRADATION_PER_YEAR = 0.007;

/** Floor on the age penalty — performance is never modelled below 65% of open-age. */
export const AGE_PENALTY_FLOOR = 0.65;

/**
 * Plausibility bounds per distance, in seconds. Times outside these ranges are
 * rejected rather than silently calibrating the model into nonsense — a
 * mistyped "1234" must not become a permanent 12× correction factor.
 *
 * The upper bounds are generous enough for a 90+ age group; the lower bounds
 * sit just inside the current world records.
 */
export const RACE_TIME_BOUNDS: Record<RaceDistance, { min: number; max: number }> = {
  100: { min: 9.5, max: 45 },
  200: { min: 19, max: 95 },
  400: { min: 43, max: 220 },
};

/** Earliest race date accepted — guards against typos like "0202-05-01". */
const EARLIEST_RACE_YEAR = 1950;

/**
 * Half-life for recency weighting, in months. A result 18 months old carries
 * half the weight of one from today; at 3 years it carries a quarter.
 */
export const CALIBRATION_HALF_LIFE_MONTHS = 18;

/** Results older than this contribute nothing — the athlete is a different one by then. */
export const CALIBRATION_MAX_AGE_MONTHS = 60;

/**
 * Bounds on the final calibration factor. A correction beyond ±20% means the
 * inputs disagree with the model so badly that something else is wrong
 * (mistyped time, a wind-aided result, a completely different fitness era),
 * and an unclamped factor would make the estimate worse, not better.
 */
export const CALIBRATION_FACTOR_MIN = 0.85;
export const CALIBRATION_FACTOR_MAX = 1.2;

/**
 * How much of the average correction carries to distances with no result of
 * their own. Model bias is partly systematic, so a 200 m result says something
 * about the 100 m — but only half as much as a 100 m result would.
 */
export const CROSS_DISTANCE_TRANSFER = 0.5;

/** A race the athlete has actually run. */
export interface RaceResult {
  /** Stable client-generated id, used as the React key and for edit/delete. */
  id: string;
  distance: RaceDistance;
  /** Official finish time in seconds. */
  timeSeconds: number;
  /** Race date, ISO `YYYY-MM-DD`. */
  date: string;
  /** Optional free-text label, e.g. "County Champs, +1.2 wind". */
  note?: string;
}

/**
 * Zod schema for a stored/entered race result.
 *
 * Everything here is untrusted input — it arrives from a text field or from
 * `localStorage`, which any script on the origin can write to — so the schema
 * enforces the plausibility bounds rather than only the types.
 */
export const RaceResultSchema = z
  .object({
    id: z.string().min(1).max(64),
    distance: z.union([z.literal(100), z.literal(200), z.literal(400)]),
    timeSeconds: z.number().finite().positive(),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD'),
    note: z.string().max(120).optional(),
  })
  .refine(
    (r) => r.timeSeconds >= RACE_TIME_BOUNDS[r.distance].min && r.timeSeconds <= RACE_TIME_BOUNDS[r.distance].max,
    { message: 'Time is outside the plausible range for that distance', path: ['timeSeconds'] },
  )
  .refine((r) => {
    const year = Number(r.date.slice(0, 4));
    return Number.isFinite(year) && year >= EARLIEST_RACE_YEAR && !Number.isNaN(Date.parse(r.date));
  }, { message: 'Date is not a valid calendar date', path: ['date'] });

export const RaceResultListSchema = z.array(RaceResultSchema).max(50);

/** Per-distance multiplier applied to the model's predicted time. */
export interface RaceCalibration {
  /** Multiplier per distance; 1.0 means the model is used unchanged. */
  factors: Record<RaceDistance, number>;
  /** Distances backed by an actual result rather than cross-distance transfer. */
  calibratedDistances: RaceDistance[];
  /** Number of results that contributed any weight. */
  resultCount: number;
  /** Date of the most recent contributing result, or null when there are none. */
  mostRecentDate: string | null;
}

/** A calibration that leaves every prediction untouched. */
export const NEUTRAL_CALIBRATION: RaceCalibration = {
  factors: { 100: 1, 200: 1, 400: 1 },
  calibratedDistances: [],
  resultCount: 0,
  mostRecentDate: null,
};

/**
 * The age factor the race model applies: average race speed scales with it.
 * Shared by the estimator, the race planner and the calibration maths.
 */
export function agePenaltyFactor(age: number): number {
  if (age <= 35) return 1;
  return Math.max(1 - (age - 35) * AGE_DEGRADATION_PER_YEAR, AGE_PENALTY_FLOOR);
}

/**
 * Parse a user-entered race time into seconds.
 *
 * Accepts `"12.34"`, `"1:02.45"`, `"1:02"`, and plain `"62"`. Returns null for
 * anything else, so a malformed entry is rejected at the boundary rather than
 * becoming `NaN` inside the model.
 */
export function parseRaceTime(input: string): number | null {
  const trimmed = input.trim();
  if (trimmed === '') return null;

  const colonMatch = /^(\d{1,2}):([0-5]?\d)(\.\d{1,3})?$/.exec(trimmed);
  if (colonMatch) {
    const minutes = Number(colonMatch[1]);
    const seconds = Number(colonMatch[2]) + (colonMatch[3] ? Number(colonMatch[3]) : 0);
    return minutes * 60 + seconds;
  }

  const plainMatch = /^\d{1,3}(\.\d{1,3})?$/.exec(trimmed);
  if (plainMatch) return Number(trimmed);

  return null;
}

/** Format seconds as `ss.xx` or `m:ss.xx`, matching the estimator's display style. */
export function formatRaceTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '--';
  if (seconds < 60) return seconds.toFixed(2);
  const mins = Math.floor(seconds / 60);
  const secs = seconds - mins * 60;
  return `${mins}:${secs < 10 ? '0' : ''}${secs.toFixed(2)}`;
}

/** Whole months between two dates, floored at zero. */
function monthsBetween(from: Date, to: Date): number {
  const months = (to.getFullYear() - from.getFullYear()) * 12 + (to.getMonth() - from.getMonth());
  return Math.max(0, months);
}

/** Exponential recency weight — see {@link CALIBRATION_HALF_LIFE_MONTHS}. */
export function recencyWeight(monthsOld: number): number {
  if (monthsOld >= CALIBRATION_MAX_AGE_MONTHS) return 0;
  return Math.pow(0.5, monthsOld / CALIBRATION_HALF_LIFE_MONTHS);
}

/**
 * Convert a time run at an earlier age into the time it implies for the
 * athlete today.
 *
 * A masters athlete is slower at 49 than at 46, so a clock time from three
 * years ago represents a *better* performance than the same clock time today.
 * Race speed scales with {@link agePenaltyFactor}, so time scales with its
 * inverse. Without this step every older result would look like evidence that
 * the model is pessimistic.
 *
 * @param timeSeconds  The time actually recorded.
 * @param monthsOld    How long ago the race was.
 * @param currentAge   The athlete's age today.
 */
export function ageEquivalentTime(timeSeconds: number, monthsOld: number, currentAge: number): number {
  const ageAtRace = currentAge - monthsOld / 12;
  return timeSeconds * (agePenaltyFactor(ageAtRace) / agePenaltyFactor(currentAge));
}

export interface CalibrationInput {
  /** Validated results the athlete has entered. */
  results: RaceResult[];
  /**
   * The model's own predicted time for each distance at neutral readiness,
   * in seconds. Supplied by the caller so this module stays independent of
   * the estimator.
   */
  baselineTimes: Partial<Record<RaceDistance, number>>;
  /** The athlete's current age, used to age-adjust older results. */
  age: number;
  /** Reference "today" for recency weighting. */
  now: Date;
}

/**
 * Build a per-distance calibration from the athlete's known race times.
 *
 * For each result:
 *  1. The observed time is converted to a **current-age equivalent**. A time
 *     run at 44 is not a time you can run at 49, so it is scaled by the ratio
 *     of the age factors — the same age model the estimator itself uses.
 *  2. That equivalent time is compared with what the model predicts for the
 *     same distance today, giving a ratio: >1 means the model is optimistic.
 *  3. Ratios are combined with an exponential recency weight, so a result from
 *     last month dominates one from three years ago.
 *
 * Distances with no result of their own inherit a damped share of the average
 * correction — see {@link CROSS_DISTANCE_TRANSFER}.
 *
 * Caveat, stated plainly: a result is compared against a model driven by the
 * athlete's *current* Vmax. If fitness has moved a long way since the race, the
 * ratio absorbs some of that change as if it were model bias. Recency weighting
 * and the factor clamp bound how far that can go.
 */
export function buildRaceCalibration(input: CalibrationInput): RaceCalibration {
  const { results, baselineTimes, age, now } = input;

  /** Weighted ratio accumulator per distance. */
  const perDistance = new Map<RaceDistance, { weightedSum: number; weight: number }>();
  let contributingCount = 0;
  let mostRecentDate: string | null = null;

  for (const result of results) {
    const baseline = baselineTimes[result.distance];
    if (!baseline || baseline <= 0) continue;

    const raceDate = new Date(`${result.date}T00:00:00Z`);
    if (Number.isNaN(raceDate.getTime())) continue;

    const monthsOld = monthsBetween(raceDate, now);
    const weight = recencyWeight(monthsOld);
    if (weight <= 0) continue;

    const equivalentTimeToday = ageEquivalentTime(result.timeSeconds, monthsOld, age);
    const ratio = equivalentTimeToday / baseline;
    if (!Number.isFinite(ratio) || ratio <= 0) continue;

    const bucket = perDistance.get(result.distance) ?? { weightedSum: 0, weight: 0 };
    bucket.weightedSum += ratio * weight;
    bucket.weight += weight;
    perDistance.set(result.distance, bucket);

    contributingCount++;
    if (mostRecentDate === null || result.date > mostRecentDate) mostRecentDate = result.date;
  }

  if (contributingCount === 0) return NEUTRAL_CALIBRATION;

  const directFactors = new Map<RaceDistance, number>();
  for (const [distance, bucket] of perDistance) {
    if (bucket.weight <= 0) continue;
    const meanRatio = bucket.weightedSum / bucket.weight;
    // Shrink toward neutral when the evidence is thin or old. Total weight of
    // 1.0 (one result from this month, or several older ones) applies the
    // correction in full; a lone three-year-old result applies a quarter of it.
    // Without this a single stale time would steer the model as hard as a
    // result from last week.
    const confidence = Math.min(1, bucket.weight);
    directFactors.set(distance, 1 + (meanRatio - 1) * confidence);
  }

  // Average correction across calibrated distances, damped for the others.
  const directValues = [...directFactors.values()];
  const meanFactor = directValues.reduce((a, b) => a + b, 0) / directValues.length;
  const transferred = 1 + (meanFactor - 1) * CROSS_DISTANCE_TRANSFER;

  const factors = {} as Record<RaceDistance, number>;
  for (const distance of CALIBRATABLE_DISTANCES) {
    const raw = directFactors.get(distance) ?? transferred;
    factors[distance] = clampFactor(raw);
  }

  return {
    factors,
    calibratedDistances: CALIBRATABLE_DISTANCES.filter((d) => directFactors.has(d)),
    resultCount: contributingCount,
    mostRecentDate,
  };
}

function clampFactor(factor: number): number {
  return Math.min(CALIBRATION_FACTOR_MAX, Math.max(CALIBRATION_FACTOR_MIN, factor));
}

/** The multiplier to apply for a distance; 1.0 when there is nothing to apply. */
export function calibrationFactorFor(
  calibration: RaceCalibration | null | undefined,
  distance: RaceDistance,
): number {
  const factor = calibration?.factors?.[distance];
  return typeof factor === 'number' && Number.isFinite(factor) && factor > 0 ? factor : 1;
}

/** Sort newest-first, which is the order the UI lists results in. */
export function sortResultsByDateDesc(results: RaceResult[]): RaceResult[] {
  return [...results].sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id));
}

/**
 * Validate a list of results, discarding any entry that fails.
 * Used when reading from storage, where the payload cannot be trusted.
 */
export function parseRaceResults(raw: unknown): RaceResult[] {
  if (!Array.isArray(raw)) return [];
  const valid: RaceResult[] = [];
  const seenIds = new Set<string>();
  for (const item of raw) {
    const parsed = RaceResultSchema.safeParse(item);
    if (!parsed.success) continue;
    if (seenIds.has(parsed.data.id)) continue;
    seenIds.add(parsed.data.id);
    valid.push(parsed.data);
  }
  return valid.slice(0, 50);
}
