/**
 * Mock Intervals.icu API fixtures for a masters sprinter.
 *
 * ── Provenance ──────────────────────────────────────────────────────────────
 * The *shapes*, field names, orderings and value ranges here were derived by
 * observing live Intervals.icu API responses for a masters track athlete during
 * a competition build-up. The *identity and values are synthetic*: no real
 * athlete id, name, date of birth, location or measurement is reproduced, in
 * line with the "no production PII in test fixtures" rule in agents.md.
 *
 * ── Real-world traits these fixtures reproduce ──────────────────────────────
 *  1. `/activities` is returned **newest-first**; `/wellness` is returned
 *     **oldest-first**. The two endpoints disagree, and code that assumes one
 *     ordering for both silently reads 60-day-old data.
 *  2. `max_speed` is `null` on manually-entered / indoor activities that carry
 *     no GPS trace.
 *  3. `/streams` returns a bare **array** of `{ type, data }` objects, not a
 *     map keyed by stream name.
 *  4. Velocity streams contain occasional `null` samples (GPS dropout).
 *  5. A single spurious GPS fix can report 100+ m/s mid-session — the artifact
 *     that makes Intervals.icu's own `/pace-curves` report 100 m in 1 second.
 *  6. Auto-detected laps are typed `WORK` even when they are warm-up jogs, and
 *     `RECOVERY` laps often carry the highest `max_speed` in the session
 *     because the lap boundary lands inside the preceding sprint.
 *  7. `average_speed` can exceed `max_speed` on very short laps — the two
 *     fields are computed over different windows by the device.
 *  8. Athlete weight lives in `icu_weight`; the Strava-sourced `weight` is null.
 *  9. Non-run activities (Walk / Ride / WeightTraining / Yoga) dominate the
 *     activity list by count, and a GPS-glitched dog walk can report a
 *     `max_speed` higher than any real sprint.
 * 10. The `distance` and `velocity_smooth` streams for the same activity
 *     disagree: distance deltas imply speeds ~10% above the velocity trace's
 *     own peak. Deriving distance from the former makes a window's *average*
 *     speed exceed the fastest instant inside it, which is impossible.
 * 11. A burst of per-activity requests draws `429` partway through, and the
 *     limiter is about request volume, not concurrency — 12 in parallel is
 *     fine, 140 in four seconds is not.
 * 12. GPS mis-measures short track races in both directions: a 200 m race
 *     recorded 225 m, while a 400 m race recorded 380 m.
 * 13. The bulk endpoint `/athlete/{id}/activities/{ids}?intervals=true` drops
 *     ids it does not recognise **and reorders the ones it returns**. Parsing
 *     by position attributes one activity's laps to another.
 * 14. `stream_types` is `null` on activities with no GPS trace, and `fields=`
 *     turns any null into an **absent key**. Neither means "no streams"; only
 *     a non-empty array that omits `velocity_smooth` does.
 * 15. `fields=` elides nulls entirely, so a schema that tolerates `null` must
 *     also tolerate the key not being there at all.
 */

import type { HttpGet, HttpResponse } from '../../src/application/dashboard-sync';

/** Fixed reference date so every derived date and assertion is deterministic. */
export const FIXTURE_TODAY = '2026-09-05';
export const FIXTURE_NOW = new Date(`${FIXTURE_TODAY}T09:00:00.000Z`);
export const FIXTURE_ATHLETE_ID = 'i90210';

/** Synthetic DOB chosen so the athlete is exactly 49 on FIXTURE_TODAY. */
export const FIXTURE_DOB = '1977-01-05';
export const FIXTURE_AGE = 49;
export const FIXTURE_WEIGHT_KG = 78.4;

// ── date helpers ────────────────────────────────────────────────────────────

function isoDate(daysAgo: number): string {
  const d = new Date(FIXTURE_NOW);
  d.setUTCDate(d.getUTCDate() - daysAgo);
  return d.toISOString().slice(0, 10);
}

function localTimestamp(daysAgo: number, time = '07:48:36'): string {
  return `${isoDate(daysAgo)}T${time}`;
}

// ── athlete profile ─────────────────────────────────────────────────────────

/**
 * `GET /api/v1/athlete/{id}`
 * Mirrors the live payload: Strava `weight` is null, the real value is in `icu_weight`.
 */
export function buildAthleteProfile(): Record<string, unknown> {
  return {
    id: FIXTURE_ATHLETE_ID,
    name: 'Masters Test Sprinter',
    icu_date_of_birth: FIXTURE_DOB,
    weight: null,
    icu_weight: FIXTURE_WEIGHT_KG,
    sex: 'M',
    timezone: 'Europe/London',
  };
}

// ── activities ──────────────────────────────────────────────────────────────

export interface FixtureActivity {
  id: string;
  type: string;
  name: string;
  daysAgo: number;
  distance: number;
  moving_time: number;
  max_speed: number | null;
  icu_training_load: number;
  icu_atl: number;
  icu_ctl: number;
}

/**
 * The activity catalogue, newest-first — the ordering the live API uses.
 *
 * Notable entries, each of which exercises a specific behaviour:
 *   - `act_walk_today`   non-run noise that must never reach the sprint model
 *   - `act_walk_glitch`  GPS spike of 11.93 m/s on a *walk* — faster than any
 *                        real sprint in the window; must not become bestVmax60d
 *   - `act_run_easy`     a genuine Z2 run with a 3.29 m/s max — a real run, but
 *                        not a sprint effort
 *   - `act_run_manual`   manually-entered session with `max_speed: null`
 *   - `act_race_*`       a real competition day: 100 m, 400 m and a 200 m relay
 */
const ACTIVITY_CATALOGUE: FixtureActivity[] = [
  // ── this week: race taper ────────────────────────────────────────────────
  { id: 'act_walk_today',   type: 'Walk',           name: 'Dog walk',                              daysAgo: 0,  distance: 3264, moving_time: 2374, max_speed: 1.73,  icu_training_load: 9,  icu_atl: 38.4, icu_ctl: 37.4 },
  { id: 'act_run_primer',   type: 'Run',            name: 'Pre-race primer — 3x30m + 2x60m',       daysAgo: 0,  distance: 3142, moving_time: 1123, max_speed: 8.31,  icu_training_load: 20, icu_atl: 38.4, icu_ctl: 37.4 },
  { id: 'act_walk_glitch',  type: 'Walk',           name: 'Seafront walk (GPS glitch)',            daysAgo: 1,  distance: 2192, moving_time: 1657, max_speed: 11.93, icu_training_load: 7,  icu_atl: 38.2, icu_ctl: 37.3 },
  { id: 'act_run_activate', type: 'Run',            name: 'Race activation — 2x60m + 1x120m',      daysAgo: 2,  distance: 3213, moving_time: 1210, max_speed: 8.00,  icu_training_load: 21, icu_atl: 43.0, icu_ctl: 38.0 },
  { id: 'act_gym_upper',    type: 'WeightTraining', name: 'Upper body + core',                     daysAgo: 3,  distance: 0,    moving_time: 2700, max_speed: null,  icu_training_load: 25, icu_atl: 45.9, icu_ctl: 38.4 },
  { id: 'act_run_accel',    type: 'Run',            name: 'Race prep — acceleration drills',       daysAgo: 5,  distance: 5005, moving_time: 1900, max_speed: 8.31,  icu_training_load: 30, icu_atl: 58.9, icu_ctl: 39.9 },
  { id: 'act_ride_commute', type: 'Ride',           name: 'Commute',                               daysAgo: 6,  distance: 14200,moving_time: 2400, max_speed: 9.80,  icu_training_load: 35, icu_atl: 61.4, icu_ctl: 39.8 },

  // ── previous week ────────────────────────────────────────────────────────
  { id: 'act_run_rain',     type: 'Run',            name: 'Before the rain',                       daysAgo: 7,  distance: 5151, moving_time: 1980, max_speed: 7.87,  icu_training_load: 32, icu_atl: 43.5, icu_ctl: 36.5 },
  { id: 'act_run_easy',     type: 'Run',            name: 'Easy morning run',                      daysAgo: 8,  distance: 5811, moving_time: 2350, max_speed: 3.29,  icu_training_load: 36, icu_atl: 40.1, icu_ctl: 35.9 },
  { id: 'act_yoga',         type: 'Yoga',           name: 'Hip mobility flow',                     daysAgo: 9,  distance: 0,    moving_time: 1800, max_speed: null,  icu_training_load: 5,  icu_atl: 38.0, icu_ctl: 35.2 },
  { id: 'act_run_z2',       type: 'Run',            name: 'Fasted zone 2 5k',                      daysAgo: 11, distance: 5611, moving_time: 2200, max_speed: 6.40,  icu_training_load: 40, icu_atl: 36.4, icu_ctl: 34.8 },
  { id: 'act_gym_lower',    type: 'WeightTraining', name: 'Trap bar deadlift + step-ups',          daysAgo: 12, distance: 0,    moving_time: 3300, max_speed: null,  icu_training_load: 30, icu_atl: 35.0, icu_ctl: 34.1 },

  // ── manually-entered session: no GPS, so no max_speed ────────────────────
  { id: 'act_run_manual',   type: 'Run',            name: 'AM: Easy Intervals 6x60m (manual)',     daysAgo: 14, distance: 360,  moving_time: 300,  max_speed: null,  icu_training_load: 9,  icu_atl: 33.2, icu_ctl: 33.4 },

  { id: 'act_run_drills',   type: 'Run',            name: 'Sprint drills',                         daysAgo: 21, distance: 5504, moving_time: 2100, max_speed: 7.75,  icu_training_load: 31, icu_atl: 30.9, icu_ctl: 32.0 },
  { id: 'act_trail',        type: 'TrailRun',       name: 'Downland trail loop',                   daysAgo: 24, distance: 8200, moving_time: 3400, max_speed: 5.69,  icu_training_load: 45, icu_atl: 29.5, icu_ctl: 31.4 },
  { id: 'act_run_flys',     type: 'Run',            name: 'Max Velocity — 6x20m flys',             daysAgo: 30, distance: 3331, moving_time: 1500, max_speed: 7.73,  icu_training_load: 19, icu_atl: 27.8, icu_ctl: 30.2 },
  { id: 'act_ride_long',    type: 'Ride',           name: 'Sunday club ride',                      daysAgo: 33, distance: 62000,moving_time: 8100, max_speed: 13.60, icu_training_load: 120,icu_atl: 30.1, icu_ctl: 30.0 },

  // ── competition day, 47 days ago: the ground-truth races ─────────────────
  { id: 'act_race_100',     type: 'Run',            name: '100m sprint, 4th place',                daysAgo: 47, distance: 130,  moving_time: 124,  max_speed: 8.71,  icu_training_load: 1,  icu_atl: 26.0, icu_ctl: 28.8 },
  { id: 'act_race_400',     type: 'Run',            name: '400m sprint',                           daysAgo: 47, distance: 380,  moving_time: 130,  max_speed: 7.54,  icu_training_load: 5,  icu_atl: 26.0, icu_ctl: 28.8 },
  { id: 'act_race_200',     type: 'Run',            name: '200m relay leg 1',                      daysAgo: 47, distance: 190,  moving_time: 60,   max_speed: 8.92,  icu_training_load: 2,  icu_atl: 26.0, icu_ctl: 28.8 },
  { id: 'act_race_warmup',  type: 'Run',            name: 'Track warm-up',                         daysAgo: 47, distance: 1280, moving_time: 900,  max_speed: 4.93,  icu_training_load: 10, icu_atl: 26.0, icu_ctl: 28.8 },

  { id: 'act_run_social',   type: 'Run',            name: 'Social run',                            daysAgo: 49, distance: 7866, moving_time: 3100, max_speed: 3.59,  icu_training_load: 58, icu_atl: 27.2, icu_ctl: 28.6 },
  { id: 'act_swim',         type: 'Swim',           name: 'Recovery swim',                         daysAgo: 52, distance: 1500, moving_time: 2400, max_speed: null,  icu_training_load: 20, icu_atl: 24.9, icu_ctl: 28.1 },
  { id: 'act_run_tempo',    type: 'Run',            name: 'Acceleration drills',                   daysAgo: 55, distance: 3604, moving_time: 1600, max_speed: 7.40,  icu_training_load: 22, icu_atl: 23.0, icu_ctl: 27.6 },
  { id: 'act_run_intervals',type: 'Run',            name: 'Easy intervals',                        daysAgo: 58, distance: 3103, moving_time: 1400, max_speed: 6.29,  icu_training_load: 19, icu_atl: 22.9, icu_ctl: 29.2 },
];

/**
 * The `stream_types` a GPS-recorded session carries.
 *
 * The live API lists every series the device wrote, `velocity_smooth` among
 * them. An activity with no GPS trace carries `stream_types: null` instead —
 * and on the live account those are exactly the activities whose `max_speed`
 * is also null.
 */
export const GPS_STREAM_TYPES = [
  'time', 'distance', 'velocity_smooth', 'heartrate', 'latlng', 'altitude',
] as const;

/** `GET /api/v1/athlete/{id}/activities` — newest-first, exactly like the live API. */
export function buildActivityList(): Record<string, unknown>[] {
  return ACTIVITY_CATALOGUE.map((a) => ({
    id: a.id,
    type: a.type,
    name: a.name,
    start_date_local: localTimestamp(a.daysAgo),
    distance: a.distance,
    moving_time: a.moving_time,
    elapsed_time: a.moving_time,
    max_speed: a.max_speed,
    average_speed: a.distance > 0 ? a.distance / a.moving_time : null,
    icu_training_load: a.icu_training_load,
    icu_atl: a.icu_atl,
    icu_ctl: a.icu_ctl,
    // No GPS trace means no series list at all, not an empty one.
    stream_types: a.max_speed === null ? null : [...GPS_STREAM_TYPES],
  }));
}

/**
 * The same list as Intervals.icu returns it **with `fields=` applied**.
 *
 * The parameter does not only select fields: it "also excludes null values",
 * so a key whose value is null is absent altogether. Observed live on the 5
 * runs whose `stream_types` and `max_speed` are both null — they came back
 * with neither key. A schema that tolerates `null` but not an absent key
 * silently drops those sessions.
 */
export function buildFieldsElidedActivityList(): Record<string, unknown>[] {
  return buildActivityList().map((activity) => {
    const kept: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(activity)) {
      if (value !== null) kept[key] = value;
    }
    return kept;
  });
}

/**
 * Activities covering all four `stream_types` states, for the skip rule.
 *
 * Only the third of these may be skipped: an array that is present, non-empty
 * and does not list `velocity_smooth` is the one case where Intervals.icu has
 * actually told us there is no velocity trace to fetch.
 */
export function buildStreamTypesScenario(): Record<string, unknown>[] {
  const base = {
    type: 'Run',
    distance: 3000,
    moving_time: 900,
    icu_training_load: 20,
    icu_atl: 30,
    icu_ctl: 32,
  };
  return [
    { ...base, id: 'st_listed',   name: 'Listed velocity_smooth', start_date_local: localTimestamp(1), max_speed: 8.5, stream_types: [...GPS_STREAM_TYPES] },
    { ...base, id: 'st_null',     name: 'Null stream_types',      start_date_local: localTimestamp(2), max_speed: 8.4, stream_types: null },
    { ...base, id: 'st_no_vel',   name: 'Treadmill, no velocity', start_date_local: localTimestamp(3), max_speed: 8.3, stream_types: ['time', 'distance', 'heartrate'] },
    { ...base, id: 'st_empty',    name: 'Empty stream_types',     start_date_local: localTimestamp(4), max_speed: 8.2, stream_types: [] },
    // `fields=` elision: the key is simply not there.
    { ...base, id: 'st_absent',   name: 'No stream_types key',    start_date_local: localTimestamp(5), max_speed: 8.1 },
  ];
}

/** The one activity in {@link buildStreamTypesScenario} whose stream must not be requested. */
export const STREAM_TYPES_SKIPPED_ID = 'st_no_vel';

/**
 * A season's worth of runs, for the assertions the 17-run catalogue cannot make.
 *
 * A cap of 40 and a batch size of 25 are invisible to a fixture with 17 runs
 * in it — which is exactly why a live account leaked 6 requests past the cap
 * without any test noticing.
 *
 * @param runs how many run activities to generate, newest first
 * @param withIntervals how many of them have lap data; the rest have none, so
 *   they exercise the path that used to fall back to a `/streams` request
 */
export function buildLargeRunAccount(runs: number, withIntervals = 0): Record<string, unknown>[] {
  return Array.from({ length: runs }, (_, i) => ({
    // The stub reads the id: `_lap_` marks an activity that has lap data.
    id: `bulk_run_${i < withIntervals ? 'lap' : 'nolap'}_${String(i).padStart(3, '0')}`,
    type: 'Run',
    name: `Session ${i}`,
    // Two sessions a day keeps 80 runs inside the 60-day dashboard window.
    start_date_local: localTimestamp(Math.floor(i / 2), i % 2 === 0 ? '07:00:00' : '17:30:00'),
    distance: 4000,
    moving_time: 1200,
    // Descending, so the ranking the cap depends on is unambiguous.
    max_speed: 9 - i * 0.01,
    average_speed: 3.3,
    icu_training_load: 20,
    icu_atl: 30,
    icu_ctl: 32,
    stream_types: [...GPS_STREAM_TYPES],
  }));
}

/** The subset of the catalogue the app is expected to treat as runs. */
export const RUN_ACTIVITY_IDS = ACTIVITY_CATALOGUE
  .filter((a) => a.type === 'Run' || a.type === 'TrailRun')
  .map((a) => a.id);

/** Fastest max_speed across *run* activities — the true 60-day sprint ceiling. */
export const FIXTURE_BEST_RUN_VMAX = 8.92;

/** Fastest max_speed across the whole catalogue, inflated by a walk's GPS spike. */
export const FIXTURE_BEST_ANY_VMAX = 13.60;

// ── wellness ────────────────────────────────────────────────────────────────

/**
 * `GET /api/v1/athlete/{id}/wellness` — **oldest-first**, as the live API returns it.
 *
 * HRV is in the 19–34 ms band typical of a wrist-based RMSSD reading (rather
 * than the 40–100 ms band of a chest strap), which keeps the SRS ratio maths
 * honest about scale-invariance.
 *
 * The window is deliberately shaped so the two ends disagree:
 *   - oldest 7 days  → HRV averages ≈ 20 ms (a run-down block)
 *   - newest 7 days  → HRV averages ≈ 30 ms (freshened up into the race)
 * Code that reads the wrong end of the array is therefore unmistakably wrong.
 */
const LOOKBACK_WELLNESS_DAYS = 60;

export function buildWellnessSeries(): Record<string, unknown>[] {
  const entries: Record<string, unknown>[] = [];

  for (let daysAgo = LOOKBACK_WELLNESS_DAYS - 1; daysAgo >= 0; daysAgo--) {
    const progress = (LOOKBACK_WELLNESS_DAYS - 1 - daysAgo) / (LOOKBACK_WELLNESS_DAYS - 1);
    // Rise from ~20 ms to ~30 ms across the window, with a deterministic wobble.
    const base = 20 + progress * 10;
    const wobble = Math.sin(daysAgo * 0.9) * 1.5;
    const hrv = Math.round(base + wobble);

    // A wearable that was not worn for two nights: HRV missing, not zero.
    const missing = daysAgo === 17 || daysAgo === 18;

    entries.push({
      id: isoDate(daysAgo),
      hrv: missing ? null : hrv,
      hrvSDNN: missing ? null : hrv * 2.1,
      restingHR: missing ? null : 54 + Math.round(Math.cos(daysAgo * 0.7) * 4),
      // Weight is only logged on some days.
      weight: daysAgo % 3 === 0 ? FIXTURE_WEIGHT_KG : null,
      // The live account never populates `readiness` — the app must not depend on it.
      readiness: null,
      sleepSecs: 26000 + (daysAgo % 5) * 900,
      ctl: 28 + progress * 9.4,
      atl: 22 + progress * 16.4,
    });
  }

  return entries;
}

/** HRV on the most recent wellness day. */
export const FIXTURE_TODAY_HRV = 30;
/** HRV on the oldest wellness day in the window. */
export const FIXTURE_OLDEST_HRV = 20;

/** Mean HRV over the 7 most recent wellness days — what a correct 7-day average must produce. */
export const FIXTURE_RECENT_HRV_MEAN = 29.571428571428573;
/** Mean HRV over the 7 *oldest* wellness days — what the ordering bug produces instead. */
export const FIXTURE_OLDEST_HRV_MEAN = 20.571428571428573;

// ── rest-day scenario ───────────────────────────────────────────────────────

/**
 * Three rest days after a hard session — the case where a stale TSB is
 * visible.
 *
 * On a real account the two sources disagree while the athlete recovers:
 *   - the last *activity* keeps the CTL/ATL it had on the day it was recorded
 *   - the *wellness* record has a row for every day, so ATL keeps decaying
 *
 * Here the last run was three days ago at TSB −19.0, while today's wellness
 * row has decayed to TSB +2.3. Reading fatigue off the activity therefore
 * reports a tired athlete who has in fact recovered.
 */
export const REST_DAY_LAST_RUN = { ctl: 39.92, atl: 58.93, tsb: -19.01 };
export const REST_DAY_TODAY = { ctl: 36.69, atl: 34.38, tsb: 2.31 };

/** ATL decaying across the rest days, newest last. */
const REST_DAY_DECAY = [
  { daysAgo: 3, ctl: 39.92, atl: 58.93 },
  { daysAgo: 2, ctl: 39.31, atl: 52.95 },
  { daysAgo: 1, ctl: 38.05, atl: 42.98 },
  { daysAgo: 0, ctl: REST_DAY_TODAY.ctl, atl: REST_DAY_TODAY.atl },
];

export interface RestDayScenario {
  activities: Record<string, unknown>[];
  wellness: Record<string, unknown>[];
}

/**
 * Build the payloads for "hard session three days ago, nothing since".
 *
 * @param wellnessCarriesLoad when false, the wellness rows omit ctl/atl — the
 *   shape returned by accounts where Intervals.icu has no load data, which the
 *   app must fall back from rather than treating as zero fitness.
 */
export function buildRestDayScenario(wellnessCarriesLoad = true): RestDayScenario {
  // Drop everything from the last two days so the newest run is three days old.
  const activities = ACTIVITY_CATALOGUE
    .filter((a) => a.daysAgo >= 3)
    .map((a) => ({
      id: a.id,
      type: a.type,
      name: a.name,
      start_date_local: localTimestamp(a.daysAgo),
      distance: a.distance,
      moving_time: a.moving_time,
      max_speed: a.max_speed,
      icu_training_load: a.icu_training_load,
      // Stamp the newest run with the fatigue it carried on the training day.
      icu_atl: a.daysAgo === 3 || a.daysAgo === 5 ? REST_DAY_LAST_RUN.atl : a.icu_atl,
      icu_ctl: a.daysAgo === 3 || a.daysAgo === 5 ? REST_DAY_LAST_RUN.ctl : a.icu_ctl,
    }));

  const decayByDate = new Map(REST_DAY_DECAY.map((d) => [isoDate(d.daysAgo), d]));
  const wellness = buildWellnessSeries().map((entry) => {
    const decayed = decayByDate.get(entry.id as string);
    const base = decayed ? { ...entry, ctl: decayed.ctl, atl: decayed.atl } : entry;
    if (wellnessCarriesLoad) return base;
    const { ctl, atl, ...withoutLoad } = base as Record<string, unknown>;
    return withoutLoad;
  });

  return { activities, wellness };
}

/**
 * Forward-projected wellness rows, as Intervals.icu serves them.
 *
 * Future dates carry a CTL/ATL forecast derived from planned calendar
 * workouts. They have no HRV and share one generation timestamp — they are
 * predictions, not measurements, and must never be read as today's state.
 */
export const PROJECTED_TOMORROW = { ctl: 40.0, atl: 24.0, tsb: 16.0 };

export function withProjectedFutureRows(wellness: Record<string, unknown>[]): Record<string, unknown>[] {
  return [
    ...wellness,
    { id: isoDate(-1), hrv: null, ctl: PROJECTED_TOMORROW.ctl, atl: PROJECTED_TOMORROW.atl, updated: `${FIXTURE_TODAY}T09:21:08.783+00:00` },
    { id: isoDate(-2), hrv: null, ctl: 39.4, atl: 23.1, updated: `${FIXTURE_TODAY}T09:21:08.783+00:00` },
  ];
}

// ── activity intervals ──────────────────────────────────────────────────────

/**
 * `GET /api/v1/activity/{id}/intervals`
 *
 * Returns `{ id, analyzed, icu_intervals, icu_groups }` — never a bare array.
 * Reproduces the live quirks: warm-up jogs typed `WORK`, `RECOVERY` laps that
 * carry the session's highest `max_speed`, and short laps where
 * `average_speed > max_speed`.
 */
export function buildActivityIntervals(activityId: string): Record<string, unknown> | null {
  // Generated season-length accounts mark lap data in the id itself.
  if (activityId.includes('_lap_')) {
    return { id: activityId, analyzed: true, icu_intervals: GENERIC_SPRINT_LAPS, icu_groups: [] };
  }
  const icu_intervals = INTERVAL_SETS[activityId];
  if (!icu_intervals) return null;
  return { id: activityId, analyzed: true, icu_intervals, icu_groups: [] };
}

/** A plain 2x60 m session, for the generated activities of a season-length account. */
const GENERIC_SPRINT_LAPS: Record<string, unknown>[] = [
  { label: null, type: 'WORK',     distance: 1000.0, moving_time: 350, elapsed_time: 350, average_speed: 2.857, max_speed: 3.30, training_load: 6.10 },
  { label: null, type: 'WORK',     distance: 62.0,   moving_time: 8,   elapsed_time: 8,   average_speed: 7.750, max_speed: 8.10, training_load: 0.41 },
  { label: null, type: 'RECOVERY', distance: 105.0,  moving_time: 120, elapsed_time: 120, average_speed: 0.875, max_speed: 8.20, training_load: 0.54 },
  { label: null, type: 'WORK',     distance: 61.0,   moving_time: 8,   elapsed_time: 8,   average_speed: 7.625, max_speed: 8.05, training_load: 0.40 },
];

const INTERVAL_SETS: Record<string, Record<string, unknown>[]> = {
  // A sprint primer: jog warm-up (mis-typed WORK), 3x30m accels, 2x60m flys.
  act_run_primer: [
    { label: null, type: 'WORK',     distance: 1003.97, moving_time: 321, elapsed_time: 321, average_speed: 3.128, max_speed: 3.63,  training_load: 6.16 },
    { label: null, type: 'WORK',     distance: 467.24,  moving_time: 160, elapsed_time: 160, average_speed: 2.920, max_speed: 2.97,  training_load: 3.78 },
    { label: null, type: 'WORK',     distance: 100.79,  moving_time: 45,  elapsed_time: 45,  average_speed: 2.240, max_speed: 2.90,  training_load: 0.66 },
    { label: null, type: 'WORK',     distance: 6.01,    moving_time: 20,  elapsed_time: 20,  average_speed: 0.301, max_speed: 0.56,  training_load: 0.02 },
    // 3x30m acceleration reps. The middle one has average_speed > max_speed.
    { label: null, type: 'WORK',     distance: 32.0,    moving_time: 7,   elapsed_time: 7,   average_speed: 4.510, max_speed: 4.72,  training_load: 0.20 },
    { label: null, type: 'RECOVERY', distance: 23.0,    moving_time: 152, elapsed_time: 152, average_speed: 0.150, max_speed: 6.61,  training_load: 0.31 },
    { label: null, type: 'WORK',     distance: 36.0,    moving_time: 5,   elapsed_time: 5,   average_speed: 7.212, max_speed: 5.71,  training_load: 0.22 },
    { label: null, type: 'RECOVERY', distance: 30.0,    moving_time: 151, elapsed_time: 151, average_speed: 0.200, max_speed: 7.75,  training_load: 0.30 },
    { label: null, type: 'WORK',     distance: 34.0,    moving_time: 5,   elapsed_time: 5,   average_speed: 6.820, max_speed: 6.26,  training_load: 0.21 },
    { label: null, type: 'RECOVERY', distance: 32.0,    moving_time: 151, elapsed_time: 151, average_speed: 0.210, max_speed: 7.00,  training_load: 0.30 },
    // 2x60m flying reps — the genuine max-velocity work of the session.
    { label: null, type: 'WORK',     distance: 67.0,    moving_time: 9,   elapsed_time: 9,   average_speed: 7.457, max_speed: 8.12,  training_load: 0.42 },
    { label: null, type: 'RECOVERY', distance: 24.0,    moving_time: 241, elapsed_time: 241, average_speed: 0.100, max_speed: 8.31,  training_load: 0.48 },
    { label: null, type: 'WORK',     distance: 62.0,    moving_time: 8,   elapsed_time: 8,   average_speed: 7.777, max_speed: 8.15,  training_load: 0.40 },
    { label: null, type: 'WORK',     distance: 555.0,   moving_time: 211, elapsed_time: 211, average_speed: 2.630, max_speed: 3.08,  training_load: 3.40 },
  ],

  // Race activation: 2x60m + 1x120m speed-endurance rep.
  act_run_activate: [
    { label: null, type: 'WORK',     distance: 1005.0,  moving_time: 356, elapsed_time: 356, average_speed: 2.823, max_speed: 3.35,  training_load: 6.20 },
    { label: null, type: 'WORK',     distance: 62.0,    moving_time: 8,   elapsed_time: 8,   average_speed: 7.770, max_speed: 8.15,  training_load: 0.41 },
    { label: null, type: 'RECOVERY', distance: 106.0,   moving_time: 122, elapsed_time: 122, average_speed: 0.860, max_speed: 8.31,  training_load: 0.55 },
    { label: null, type: 'WORK',     distance: 63.0,    moving_time: 8,   elapsed_time: 8,   average_speed: 7.920, max_speed: 7.86,  training_load: 0.42 },
    { label: null, type: 'RECOVERY', distance: 103.0,   moving_time: 121, elapsed_time: 121, average_speed: 0.850, max_speed: 7.86,  training_load: 0.54 },
    { label: null, type: 'WORK',     distance: 121.0,   moving_time: 17,  elapsed_time: 17,  average_speed: 7.118, max_speed: 7.82,  training_load: 0.95 },
    { label: null, type: 'WORK',     distance: 646.0,   moving_time: 260, elapsed_time: 260, average_speed: 2.485, max_speed: 2.90,  training_load: 3.90 },
  ],

  // Acceleration session — a ladder of 15s reps plus true short sprints.
  act_run_accel: [
    { label: null, type: 'WORK',     distance: 1005.0,  moving_time: 356, elapsed_time: 356, average_speed: 2.823, max_speed: 3.35,  training_load: 6.20 },
    { label: null, type: 'WORK',     distance: 42.0,    moving_time: 15,  elapsed_time: 15,  average_speed: 2.830, max_speed: 5.09,  training_load: 0.30 },
    { label: null, type: 'RECOVERY', distance: 44.0,    moving_time: 60,  elapsed_time: 60,  average_speed: 0.730, max_speed: 2.10,  training_load: 0.25 },
    { label: null, type: 'WORK',     distance: 65.0,    moving_time: 11,  elapsed_time: 11,  average_speed: 5.940, max_speed: 7.22,  training_load: 0.45 },
    { label: null, type: 'RECOVERY', distance: 80.0,    moving_time: 121, elapsed_time: 121, average_speed: 0.660, max_speed: 6.63,  training_load: 0.42 },
    { label: null, type: 'WORK',     distance: 62.0,    moving_time: 8,   elapsed_time: 8,   average_speed: 7.770, max_speed: 8.15,  training_load: 0.41 },
    { label: null, type: 'RECOVERY', distance: 214.0,   moving_time: 161, elapsed_time: 161, average_speed: 1.330, max_speed: 7.91,  training_load: 0.80 },
    { label: null, type: 'WORK',     distance: 59.0,    moving_time: 8,   elapsed_time: 8,   average_speed: 7.410, max_speed: 7.82,  training_load: 0.39 },
    { label: null, type: 'WORK',     distance: 209.0,   moving_time: 76,  elapsed_time: 76,  average_speed: 2.740, max_speed: 2.85,  training_load: 1.30 },
  ],

  // Competition 100 m: a single all-out effort bracketed by a jog.
  act_race_100: [
    { label: null, type: 'WORK',     distance: 30.0,    moving_time: 40,  elapsed_time: 40,  average_speed: 0.750, max_speed: 2.10,  training_load: 0.10 },
    { label: null, type: 'WORK',     distance: 100.0,   moving_time: 14,  elapsed_time: 14,  average_speed: 7.143, max_speed: 8.71,  training_load: 0.90 },
  ],

  // 400 m: one rep well past the 25 s sprint cut-off.
  act_race_400: [
    { label: null, type: 'WORK',     distance: 400.0,   moving_time: 71,  elapsed_time: 71,  average_speed: 5.634, max_speed: 7.54,  training_load: 4.20 },
  ],

  // 200 m relay leg.
  act_race_200: [
    { label: null, type: 'WORK',     distance: 200.0,   moving_time: 31,  elapsed_time: 31,  average_speed: 6.452, max_speed: 8.92,  training_load: 1.90 },
  ],
};

/** Activities the mock `/intervals` endpoint has data for. */
export const ACTIVITIES_WITH_INTERVALS = Object.keys(INTERVAL_SETS);

// ── streams ─────────────────────────────────────────────────────────────────

/**
 * `GET /api/v1/activity/{id}/streams`
 *
 * The live API answers with a **bare array** of `{ type, data }` objects.
 * `null` samples appear where the GPS dropped out.
 */
export function buildActivityStreams(activityId: string): unknown[] | null {
  const velocity = VELOCITY_STREAMS[activityId];
  if (!velocity) return null;
  // The track race carries the live account's stream disagreement: its
  // `distance` series runs 12% ahead of what its own velocities integrate to.
  const inflate = activityId === 'act_race_200' ? INFLATED_DISTANCE_FACTOR : 1;
  return [
    { type: 'time', data: velocity.map((_, i) => i) },
    { type: 'velocity_smooth', data: velocity },
    { type: 'distance', data: cumulativeDistance(velocity).map((d) => parseFloat((d * inflate).toFixed(2))) },
    { type: 'heartrate', data: velocity.map(() => 140) },
  ];
}

function cumulativeDistance(velocity: Array<number | null>): number[] {
  let total = 0;
  return velocity.map((v) => {
    total += v ?? 0;
    return parseFloat(total.toFixed(2));
  });
}

/** Repeat a velocity for `seconds` samples. */
function hold(velocity: number, seconds: number): number[] {
  return Array.from({ length: seconds }, () => velocity);
}

/**
 * A 6x20m flying-sprint session with no lap markers — the case where the app
 * has to fall back to parsing the raw velocity stream.
 *
 * One sample is `null` (GPS dropout mid-rep) and the recovery walk-backs sit
 * below the 1 m/s "standing" threshold so each rep is a distinct burst.
 */
const FLYS_STREAM: Array<number | null> = [
  ...hold(0, 5),
  // Warm-up jog: 400 m of steady running, far too slow to be a sprint.
  ...hold(2.9, 140),
  ...hold(0, 20),
  // Rep 1 — build to 7.6 m/s
  ...[1.5, 3.4, 5.2, 6.6, 7.3, 7.6, 7.6, 7.4, 6.1, 3.2],
  ...hold(0.4, 90),
  // Rep 2 — GPS drops a sample at the top end
  ...[1.6, 3.6, 5.4, 6.8, 7.5, null, 7.7, 7.5, 6.0, 3.0],
  ...hold(0.4, 90),
  // Rep 3 — the fastest rep of the day
  ...[1.7, 3.8, 5.6, 7.0, 7.7, 7.9, 7.9, 7.6, 6.2, 3.1],
  ...hold(0.4, 90),
  // Cool-down jog
  ...hold(2.6, 120),
  ...hold(0, 5),
];

/**
 * A track session whose stream carries the artifact that makes the upstream
 * pace-curve endpoint unusable.
 *
 * Sample 25 reports 102 m/s. Integrated naively that is 100 m covered in one
 * second — which is exactly what `GET /athlete/{id}/pace-curves` returned for
 * a live masters account at 45.7 m, 100 m and 150 m. Anything reading this
 * stream must reject the spike and fall back to the genuine 8 m/s reps either
 * side of it, or report no data; it must never publish the spike as a best.
 */
const GPS_SPIKE_STREAM: Array<number | null> = [
  ...hold(0, 5),
  // Warm-up jog
  ...hold(2.7, 120),
  ...hold(0, 10),
  // A genuine 150 m rep at ~8 m/s — the fastest real running in the session.
  ...[1.6, 3.5, 5.4, 6.9, 7.7, 8.0, 8.1, 8.1, 8.0, 7.9, 7.8, 7.7, 7.6, 7.5, 7.4, 7.3, 7.2, 7.1, 7.0, 6.9],
  // One spurious GPS fix. A single sample, physically impossible.
  102,
  ...hold(0.4, 100),
  // A second genuine rep, marginally slower.
  ...[1.5, 3.3, 5.2, 6.7, 7.5, 7.8, 7.9, 7.9, 7.8, 7.7, 7.6, 7.5, 7.4, 7.3, 7.2, 7.1, 7.0, 6.9, 6.8, 6.7],
  ...hold(2.5, 100),
  ...hold(0, 5),
];

/** The impossible sample in {@link GPS_SPIKE_STREAM}, in m/s. */
export const FIXTURE_GPS_SPIKE_SPEED = 102;
/** Peak *legitimate* velocity in that session. */
export const FIXTURE_GPS_SPIKE_STREAM_VMAX = 8.1;

/**
 * A 200 m rep whose velocity trace peaks at 8.9 m/s.
 *
 * Paired with {@link INFLATED_DISTANCE_FACTOR} below, this reproduces the live
 * account's disagreement between the two streams.
 */
const TRACK_200M_STREAM: Array<number | null> = [
  ...hold(0, 4),
  ...[1.8, 4.0, 5.9, 7.1, 7.9, 8.4, 8.7, 8.9, 8.9, 8.8, 8.7, 8.6, 8.5, 8.3, 8.1,
      7.9, 7.7, 7.5, 7.3, 7.1, 6.9, 6.7, 6.5, 6.3, 6.1, 5.9, 5.7, 5.5],
  ...hold(0, 4),
];

/**
 * How much further the `distance` stream claims the athlete travelled than the
 * velocity trace accounts for. 1.12 is the live figure: a 200 m race recorded
 * as 225 m.
 */
export const INFLATED_DISTANCE_FACTOR = 1.12;

/** Peak of {@link TRACK_200M_STREAM} — no derived average may exceed it. */
export const FIXTURE_TRACK_200M_PEAK = 8.9;

const VELOCITY_STREAMS: Record<string, Array<number | null>> = {
  act_race_200: TRACK_200M_STREAM,
  act_run_flys: FLYS_STREAM,
  act_run_accel: GPS_SPIKE_STREAM,
  act_run_drills: [
    ...hold(0, 5),
    ...hold(2.8, 160),
    ...hold(0, 15),
    ...[1.4, 3.2, 5.0, 6.4, 7.1, 7.5, 7.4, 7.0, 5.5, 2.4],
    ...hold(0.3, 80),
    ...[1.5, 3.3, 5.1, 6.5, 7.2, 7.6, 7.5, 7.1, 5.4, 2.3],
    ...hold(0, 5),
  ],
};

/** Peak velocity in the flys stream, ignoring the null sample. */
export const FIXTURE_FLYS_STREAM_VMAX = 7.9;

// ── events ──────────────────────────────────────────────────────────────────

/**
 * `GET /api/v1/athlete/{id}/events.json`
 *
 * A double-race day tomorrow: 100 m (A) and 200 m (B). Also includes entries
 * the sprint filter must reject — a 5 km road race and a note-category event.
 */
export function buildRaceEvents(): Record<string, unknown>[] {
  return [
    { id: 132150569, category: 'RACE_A', start_date_local: `${isoDate(-1)}T00:00:00`, name: '100m sprint', type: 'Run', distance: 100, distance_target: null },
    { id: 132150639, category: 'RACE_B', start_date_local: `${isoDate(-1)}T00:00:00`, name: '200m sprint', type: 'Run', distance: 200, distance_target: null },
    { id: 132150700, category: 'RACE_C', start_date_local: `${isoDate(-40)}T00:00:00`, name: 'Autumn 5k',  type: 'Run', distance: 5000, distance_target: null },
    { id: 132150800, category: 'RACE_C', start_date_local: `${isoDate(-20)}T00:00:00`, name: 'Club time trial', type: 'Ride', distance: 20000, distance_target: null },
  ];
}

// ── HTTP port stub ──────────────────────────────────────────────────────────

export interface ApiCall {
  url: string;
  path: string;
}

export interface IntervalsApiStub {
  httpGet: HttpGet;
  /** Every request the system under test made, in order. */
  calls: ApiCall[];
  /** Requests whose path contains the given fragment. */
  callsMatching(fragment: string): ApiCall[];
  /**
   * Activity ids whose lap data was requested.
   * A dedicated accessor because `INTERVALS_BASE` is itself `/intervals` in
   * dev/test, so a substring match on the path would hit every request.
   */
  lapDataRequests(): string[];
  /** Activity ids whose velocity stream was requested. */
  streamRequests(): string[];
  /** Distinct activity ids whose velocity stream was requested — a 429 retry counts once. */
  distinctStreamRequests(): string[];
  /** Each bulk interval request, as the list of ids it asked for. */
  bulkIntervalRequests(): string[][];
  /** How many requests the stub refused with a 429. */
  rateLimitedCount(): number;
  /**
   * The most requests that were ever in flight at the same moment.
   *
   * Counting calls cannot tell 22 sequential requests from 22 simultaneous
   * ones, and it was the simultaneity that drew the limiter: on a live account
   * an unbounded `Promise.allSettled` put all 22 `/intervals` requests in the
   * air at once.
   */
  peakInFlight(): number;
}

export interface StubOverrides {
  /** Replace the activity list payload. */
  activities?: unknown;
  /** Replace the wellness payload. */
  wellness?: unknown;
  /** Replace the athlete profile payload. */
  profile?: unknown;
  /** Replace the events payload. */
  events?: unknown;
  /** Force a status code for any request whose path contains the key. */
  failing?: Record<string, number>;
  /**
   * Reproduce Intervals.icu's rate limiter: answer `429` to per-activity
   * requests once `afterRequests` have been served, for the next
   * `failures` of them. Retried requests succeed, as they do live.
   */
  rateLimit?: { afterRequests: number; failures: number };
  /**
   * Break the bulk interval endpoint, to exercise the per-activity fallback.
   *
   * `'error'` answers HTTP 500; `'no-intervals'` answers 200 with a body that
   * carries no `icu_intervals` at all — the shape-change case, which is
   * indistinguishable from "this batch told us nothing" and so must not be
   * read as "these activities have no laps".
   */
  bulkIntervals?: 'error' | 'no-intervals';
  /**
   * Answer the bulk endpoint in request order instead of reordering it.
   *
   * The live endpoint reorders; this exists only to prove a test would notice.
   */
  bulkPreservesOrder?: boolean;
}

function jsonResponse(body: unknown): HttpResponse {
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

function errorResponse(status: number): HttpResponse {
  return {
    ok: false,
    status,
    statusText: status === 404 ? 'Not Found' : status === 429 ? 'Too Many Requests' : 'Error',
    json: async () => ({}),
    text: async () => `HTTP ${status}`,
  };
}

/**
 * An in-memory Intervals.icu that answers the six endpoints the dashboard uses.
 * Routing is by path fragment so it is independent of `INTERVALS_BASE`.
 */
export function createIntervalsApiStub(overrides: StubOverrides = {}): IntervalsApiStub {
  const calls: ApiCall[] = [];
  const bulkBatches: string[][] = [];

  let served = 0;
  let refused = 0;
  let inFlight = 0;
  let peak = 0;

  /** Ids this account knows about, so the bulk endpoint can drop the rest. */
  const knownIds = new Set(
    (Array.isArray(overrides.activities) ? overrides.activities : buildActivityList())
      .map((a) => (a as { id?: unknown }).id)
      .filter((id): id is string => typeof id === 'string'),
  );

  const respond: HttpGet = async (url) => {
    const path = url.replace(/^https?:\/\/[^/]+/, '');
    calls.push({ url, path });

    for (const [fragment, status] of Object.entries(overrides.failing ?? {})) {
      if (path.includes(fragment)) return errorResponse(status);
    }

    const limit = overrides.rateLimit;
    if (limit && /(\/activity\/[^/]+\/(intervals|streams)|activities\/[^?]+\?intervals=true)/.test(path)) {
      served++;
      if (served > limit.afterRequests && refused < limit.failures) {
        refused++;
        return errorResponse(429);
      }
    }

    // Bulk laps: /athlete/{id}/activities/{id1,id2,...}?intervals=true
    const bulkMatch = path.match(/\/athlete\/[^/]+\/activities\/([^/?]+)/);
    if (bulkMatch) {
      const requested = decodeURIComponent(bulkMatch[1]).split(',');
      bulkBatches.push(requested);
      if (overrides.bulkIntervals === 'error') return errorResponse(500);
      if (overrides.bulkIntervals === 'no-intervals') {
        return jsonResponse(requested.map((id) => ({ id, name: 'no laps here' })));
      }
      // The live endpoint drops ids it does not recognise and returns what is
      // left in an order of its own choosing.
      const returned = requested.filter((id) => knownIds.has(id)).map(bulkActivityWithIntervals);
      return jsonResponse(overrides.bulkPreservesOrder ? returned : returned.reverse());
    }

    const activityMatch = path.match(/\/activity\/([^/]+)\/(intervals|streams)/);
    if (activityMatch) {
      const [, activityId, resource] = activityMatch;
      if (resource === 'intervals') {
        const body = buildActivityIntervals(activityId);
        return body ? jsonResponse(body) : jsonResponse({ id: activityId, analyzed: false, icu_intervals: [], icu_groups: [] });
      }
      const streams = buildActivityStreams(activityId);
      return streams ? jsonResponse(streams) : jsonResponse([]);
    }

    if (path.includes('/events')) {
      return jsonResponse(overrides.events ?? buildRaceEvents());
    }
    if (path.includes('/activities')) {
      return jsonResponse(overrides.activities ?? buildActivityList());
    }
    if (path.includes('/wellness')) {
      return jsonResponse(overrides.wellness ?? buildWellnessSeries());
    }
    if (path.match(/\/athlete\/[^/]+$/)) {
      return jsonResponse(overrides.profile ?? buildAthleteProfile());
    }

    return errorResponse(404);
  };

  /**
   * Record how many requests overlap.
   *
   * The await boundary matters: the counter is decremented only after the
   * handler resolves, so a caller that fires N requests without awaiting them
   * shows up as N in flight rather than as N calls.
   */
  const httpGet: HttpGet = async (url) => {
    inFlight++;
    peak = Math.max(peak, inFlight);
    try {
      // Yield once so overlapping callers are genuinely concurrent, the way a
      // network round trip makes them.
      await Promise.resolve();
      return await respond(url);
    } finally {
      inFlight--;
    }
  };

  const activityRequests = (resource: 'intervals' | 'streams'): string[] =>
    calls
      .map((c) => /\/activity\/([^/?]+)\/(intervals|streams)/.exec(c.path))
      .filter((m): m is RegExpExecArray => m !== null && m[2] === resource)
      .map((m) => m[1]);

  return {
    httpGet,
    calls,
    callsMatching: (fragment) => calls.filter((c) => c.path.includes(fragment)),
    lapDataRequests: () => activityRequests('intervals'),
    streamRequests: () => activityRequests('streams'),
    distinctStreamRequests: () => [...new Set(activityRequests('streams'))],
    bulkIntervalRequests: () => bulkBatches,
    rateLimitedCount: () => refused,
    peakInFlight: () => peak,
  };
}

/**
 * One activity as the bulk endpoint returns it.
 *
 * The lap payload is byte-identical to `/activity/{id}/intervals` — verified
 * live, deep-equal across 25 intervals — which is what makes the substitution
 * safe. Ids the fixture has no lap data for come back with an empty array,
 * not a missing key: "analysed, nothing to report".
 */
function bulkActivityWithIntervals(activityId: string): Record<string, unknown> {
  const laps = buildActivityIntervals(activityId);
  return {
    id: activityId,
    // The response carries every activity property whatever `fields=` asks
    // for; a couple stand in for the ~189 the live one has.
    name: `Activity ${activityId}`,
    type: 'Run',
    icu_intervals: laps ? laps.icu_intervals : [],
    icu_groups: [],
  };
}
