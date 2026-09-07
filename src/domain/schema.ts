import { z } from 'zod';

/**
 * Activity types from Intervals.icu that represent running.
 * The API uses Strava sport-type strings; we accept all run sub-types
 * so that trail runs, virtual runs, and track sessions are not silently dropped.
 */
export const RUN_ACTIVITY_TYPES = [
  'Run',
  'TrailRun',
  'VirtualRun',
  'Track',
  'TrackAndField',
  'Treadmill',
] as const;

export const IntervalsActivitySchema = z.object({
  id: z.string(),
  type: z.enum(RUN_ACTIVITY_TYPES),
  /**
   * Session title. Shown against a pace-curve point so a surprising best can
   * be traced back to the session it came from and, if need be, disbelieved.
   */
  name: z.string().nullish(),
  start_date_local: z.string().optional(),
  /**
   * Velocity samples, when the caller has merged a stream onto the activity.
   * GPS dropouts appear as nulls, which are stripped so downstream maths
   * (Math.max, running sums) never sees a non-number.
   */
  velocity_smooth: z
    .array(z.number().nullable())
    .default([])
    .transform((samples) => samples.filter((v): v is number => typeof v === 'number' && Number.isFinite(v))),
  /**
   * Peak speed in m/s, or `null` when the activity carries no GPS trace
   * (manual entries, treadmill sessions). `null` means "no velocity data" and
   * must not be conflated with a genuine 0 m/s reading.
   */
  max_speed: z.number().nullable().default(null),
  icu_training_load: z.number().nullable().default(0).transform((v) => v ?? 0),
  icu_atl: z.number().nullable().default(0).transform((v) => v ?? 0), // Fatigue
  icu_ctl: z.number().nullable().default(0).transform((v) => v ?? 0), // Fitness
  /**
   * Which sample series the device recorded for this activity, e.g.
   * `["time","distance","velocity_smooth","heartrate"]`.
   *
   * Read as a *positive* signal only. An array that is present and does not
   * contain `velocity_smooth` means the activity provably has no velocity
   * trace, so requesting its stream would be a wasted request. `null`, an
   * absent key, or an empty array all mean **unknown** — on a live account 5
   * of 118 runs carry `stream_types: null` and do have streams, and `fields=`
   * turns any null into an absent key (see {@link ACTIVITY_LIST_FIELDS}).
   * Treating unknown as "no streams" loses those sessions for no saving.
   */
  stream_types: z.array(z.string()).nullish(),
});

export type IntervalsActivity = z.infer<typeof IntervalsActivitySchema>;

/**
 * The `fields=` list for `GET /athlete/{id}/activities`.
 *
 * Derived from the schema rather than hand-written, so a field added to
 * {@link IntervalsActivitySchema} cannot be silently missing from the request:
 * an earlier hand-written list omitted `icu_ctl`/`icu_atl` and would have
 * zeroed the fitness/fatigue charts.
 *
 * `velocity_smooth` is excluded deliberately. It is in the schema because the
 * *stream* response is merged onto an activity downstream; the list endpoint
 * never returns it, and naming it there would ask for a series that does not
 * exist on that path.
 *
 * Measured on a live account, this takes the season-to-date response from
 * 2,830,042 bytes to 175,985 — a 93.8% cut. Two consequences of the parameter
 * matter downstream: Intervals.icu also **omits null values** when `fields=`
 * is present (so a field the schema expects may be absent rather than `null`),
 * and `/activities` has **no server-side sport filter**, so this is the only
 * lever available on that request.
 */
export const ACTIVITY_LIST_FIELDS: readonly string[] = Object.keys(IntervalsActivitySchema.shape)
  .filter((field) => field !== 'velocity_smooth');

/**
 * One activity from the bulk endpoint
 * `GET /athlete/{id}/activities/{ids}?intervals=true`.
 *
 * Only the two fields that path is used for are described. The response
 * carries all ~189 activity properties whatever is asked of it — `fields=` is
 * accepted and ignored there — but the activity list has already supplied
 * everything else, so the rest is deliberately not re-parsed.
 *
 * `icu_intervals` is `nullish`: Intervals.icu returns activities it has not
 * analysed with no lap data at all, which is "this activity has no intervals",
 * not a malformed response.
 */
export const IntervalsBulkActivitySchema = z.object({
  id: z.string(),
  icu_intervals: z.array(z.unknown()).nullish(),
});

export type IntervalsBulkActivity = z.infer<typeof IntervalsBulkActivitySchema>;

/**
 * One sample series from `GET /activity/{id}/streams`, as it is cached.
 *
 * `null` marks a GPS dropout and is preserved: the pace curve must not
 * integrate distance across a gap, so the gaps have to survive the round trip.
 */
const StreamSamplesSchema = z.array(z.number().finite().nullable());

/**
 * A cached activity stream.
 *
 * Streams of completed activities are immutable, which is what makes caching
 * them across page loads safe: there is no staleness to reason about, only
 * capacity. Validated on read because any script on the origin can write to
 * `localStorage`.
 *
 * An **empty** `velocitySmooth` is meaningful, not malformed: it records that
 * Intervals.icu answered for this activity and it has no velocity trace at
 * all. That answer cannot change either, so remembering it is what stops a
 * treadmill session costing a request on every visit.
 */
export const CachedActivityStreamSchema = z.object({
  velocitySmooth: StreamSamplesSchema,
  distance: StreamSamplesSchema.optional(),
  time: StreamSamplesSchema.optional(),
});

export type CachedActivityStream = z.infer<typeof CachedActivityStreamSchema>;

/** One cached activity, keyed by activity id. */
export const StreamCacheEntrySchema = z.object({
  id: z.string().min(1),
  stream: CachedActivityStreamSchema,
});

export type StreamCacheEntry = z.infer<typeof StreamCacheEntrySchema>;

/**
 * The stored shape of one athlete's stream cache, newest-used first.
 *
 * `entries` is deliberately left unvalidated here so that each one can be
 * checked on its own: a single corrupt entry must cost one re-fetch, not the
 * whole cache.
 */
export const StreamCacheSchema = z.object({
  version: z.literal(1),
  entries: z.array(z.unknown()),
});

export type StreamCacheRecord = z.infer<typeof StreamCacheSchema>;

export const IntervalsWellnessSchema = z.object({
  id: z.string(),
  date: z.string().optional(),
  /** HRV value in ms (standard wellness endpoint field) */
  hrv: z.number().nullable().optional(),
  /** RMSSD in ms — legacy field from the wellness-ext endpoint; kept for backward compatibility */
  rmssd: z.number().nullable().optional(),
  restingHR: z.number().nullable().optional(),
  readiness: z.number().nullable().optional(),
  weight: z.number().nullable().optional(),
  /**
   * Chronic Training Load (Fitness) for this calendar day.
   *
   * The wellness endpoint has a row for **every** day, trained or not, so this
   * is the only source that stays current while an athlete rests. The copies
   * carried on an activity are frozen at the moment that activity was recorded.
   */
  ctl: z.number().nullable().optional(),
  /** Acute Training Load (Fatigue) for this calendar day. @see ctl */
  atl: z.number().nullable().optional(),
});

export type IntervalsWellness = z.infer<typeof IntervalsWellnessSchema>;

export const IntervalsEventSchema = z.object({
  id: z.union([z.string(), z.number()]).transform(String),
  category: z.string(),
  start_date_local: z.string(),
  name: z.string().nullish(),
  type: z.string().nullish(),
  /** Distance in metres (planned distance on the event) */
  distance: z.number().nullish(),
  /** Distance target in metres (alternative field for planned races) */
  distance_target: z.number().nullish(),
});

export type IntervalsEvent = z.infer<typeof IntervalsEventSchema>;

/**
 * Schema for a single interval entry from the Intervals.icu
 * GET /api/v1/activity/{id}/intervals endpoint.
 */
/**
 * Every field is `nullish` rather than `optional`: Intervals.icu emits explicit
 * `null`s for fields it has no value for. Auto-detected laps — which is what
 * the API returns for any session not built from a structured workout — always
 * carry `label: null`, so an `optional()` schema rejects the entire lap set and
 * the app silently loses all rep-level analysis.
 */
export const IntervalsIntervalSchema = z.object({
  label: z.string().nullish(),
  start_index: z.number().nullish(),
  end_index: z.number().nullish(),
  /** Distance in metres */
  distance: z.number().nullish(),
  /** Total elapsed time in seconds */
  elapsed_time: z.number().nullish(),
  /** Active moving time in seconds */
  moving_time: z.number().nullish(),
  /** Average speed in m/s */
  average_speed: z.number().nullish(),
  /** Peak speed in m/s */
  max_speed: z.number().nullish(),
  /** Interval type e.g. "WORK", "REST", "ACTIVE_REST", "WARMUP", "COOLDOWN" */
  type: z.string().nullish(),
  /** Training load contribution of this interval (from Intervals.icu, field name: training_load) */
  training_load: z.number().nullish(),
  /** Legacy alias — kept for backward compatibility with older API responses */
  icu_training_load: z.number().nullish(),
});

export type IntervalsInterval = z.infer<typeof IntervalsIntervalSchema>;

export const IntervalsAthleteSchema = z.object({
  id: z.union([z.string(), z.number()]).transform(String),
  name: z.string().nullable().optional(),
  /** Date of birth, ISO format e.g. "1980-06-15" */
  icu_date_of_birth: z.string().nullable().optional(),
  /** Body weight in kg (from Strava sync) */
  weight: z.number().nullable().optional(),
  /** Body weight in kg (Intervals.icu setting) */
  icu_weight: z.number().nullable().optional(),
  /** Sex: "M" | "F" | "X" */
  sex: z.string().nullable().optional(),
});

export type IntervalsAthlete = z.infer<typeof IntervalsAthleteSchema>;