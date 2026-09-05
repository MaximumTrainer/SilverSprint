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
});

export type IntervalsActivity = z.infer<typeof IntervalsActivitySchema>;

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