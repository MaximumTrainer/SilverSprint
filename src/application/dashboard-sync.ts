import { SprintParser, TrackInterval } from '../domain/sprint/parser';
import { SilverSprintLogic, HRVData, NFIStatus } from '../domain/sprint/core';
import { RaceEstimator, RaceEstimate, RaceEstimatorInput } from '../domain/sprint/race-estimator';
import { SprintRacePlanner, SprintRacePlan, SprintRaceEvent } from '../domain/sprint/race-plan';
import { SprintTrainingPlan, TrainingPlanContext } from '../domain/sprint/training-plan';
import { RaceCalibration, RaceResult } from '../domain/sprint/race-results';
import {
  IntervalsActivitySchema,
  IntervalsWellnessSchema,
  IntervalsEventSchema,
  IntervalsAthleteSchema,
  IntervalsIntervalSchema,
  IntervalsActivity,
  IntervalsWellness,
  IntervalsEvent,
} from '../domain/schema';
import type { DailyDataPoint } from '../domain/types';
import { INTERVALS_BASE } from '../config/api';

/**
 * Minimal response contract required from the HTTP port.
 * Structurally compatible with the DOM `Response` so a `fetch` adapter is trivial.
 */
export interface HttpResponse {
  ok: boolean;
  status: number;
  statusText: string;
  json(): Promise<unknown>;
  text(): Promise<string>;
}

/** Outbound port: performs an authenticated GET against a fully-qualified Intervals.icu URL. */
export type HttpGet = (url: string) => Promise<HttpResponse>;

/** Logging port — mirrors the shape of `clientLogger` without depending on it. */
export interface SyncLogger {
  info(message: string, athleteId?: string, detail?: unknown): void;
  warn(message: string, athleteId?: string, detail?: unknown): void;
  error(message: string, athleteId?: string, detail?: unknown): void;
}

const NOOP_LOGGER: SyncLogger = { info: () => {}, warn: () => {}, error: () => {} };

export interface DashboardSyncDeps {
  athleteId: string;
  httpGet: HttpGet;
  /** Reference "now" for all date-window arithmetic. Defaults to the current time. */
  now?: Date;
  logger?: SyncLogger;
  /**
   * Race times the athlete has entered. Used to calibrate the race estimates.
   * These come from local persistence, not from Intervals.icu.
   */
  raceResults?: RaceResult[];
}

/**
 * Derived dashboard state. Mirrors `IntervalsDataState` minus the
 * `loading` / `error` transport flags owned by the React adapter.
 */
export interface DashboardState {
  activities: IntervalsActivity[];
  intervals: TrackInterval[];
  wellness: IntervalsWellness | null;
  nfi: number;
  nfiStatus: NFIStatus;
  avgVmax: number;
  todayVmax: number;
  recoveryHours: number;
  tsb: number;
  strengthZone: 'fresh' | 'tired' | 'fatigued';
  /** Sprint Recovery Score 0–100 (composite of HRV ratio, TSB, NFI) */
  srs: number;
  /** true when NFI is depressed from detraining, not genuine fatigue */
  staleVmax: boolean;
  age: number;
  bodyWeightKg: number | null;
  dailyTimeSeries: DailyDataPoint[];
  raceEstimates: RaceEstimate[];
  /** Predicted times if athlete were fully recovered (green NFI). Only populated when nfiStatus is amber/red. */
  recoveredEstimates: RaceEstimate[];
  sprintRacePlans: SprintRacePlan[];
  /** 12-week training plan context, present when a race event is within 84 days */
  trainingPlan: TrainingPlanContext | null;
  /**
   * The inputs the race estimates were derived from.
   *
   * Exposed so the UI can recompute estimates when the athlete edits their
   * known race times, without re-fetching everything from Intervals.icu.
   */
  raceEstimatorInput: RaceEstimatorInput;
  /** The correction derived from the athlete's known race times. */
  raceCalibration: RaceCalibration;
}

/** Number of days of historical activity/wellness data to fetch */
export const LOOKBACK_DAYS = 60;
/** Number of days ahead to look for upcoming race events */
export const RACE_LOOKAHEAD_DAYS = 90;
/** Default HRV value when no wellness data is available */
export const DEFAULT_HRV = 60;

/**
 * Fetches every Intervals.icu resource the dashboard needs and derives the
 * full dashboard state from it.
 *
 * This is the application-layer use case: it depends only on the `HttpGet`
 * port and the domain modules, never on React or `fetch` directly.
 */
export async function buildDashboardState(deps: DashboardSyncDeps): Promise<DashboardState> {
  const { athleteId, httpGet } = deps;
  const logger = deps.logger ?? NOOP_LOGGER;
  // Capture "now" once to ensure a consistent request window, even across midnight/DST.
  const now = deps.now ?? new Date();

  logger.info('Starting data sync', athleteId);

  const oldest = formatDateDaysAgo(now, LOOKBACK_DAYS);
  const newest = formatDateDaysAgo(now, 0);
  // Wellness endpoint uses an inclusive date range: today − 59 days → today = 60 days
  const wellnessOldest = formatDateDaysAgo(now, LOOKBACK_DAYS - 1);
  logger.info('Fetching profile, activities, and wellness in parallel', athleteId);

  const futureDate = formatDateDaysAhead(now, RACE_LOOKAHEAD_DAYS);
  const todayDate = newest;

  // Race events are requested up front, alongside the other account-level
  // resources, even though they are not processed until step 9. Issuing it
  // last would put it behind the per-activity request burst, where
  // Intervals.icu's rate limiter answers 429 and race planning silently
  // disappears from the dashboard.
  // Race categories are RACE_A, RACE_B, RACE_C in Intervals.icu.
  // The list endpoint requires a format suffix (.json) in the path.
  const eventsPromise = httpGet(
    `${INTERVALS_BASE}/api/v1/athlete/${athleteId}/events.json?oldest=${todayDate}&newest=${futureDate}&category=RACE_A&category=RACE_B&category=RACE_C`
  ).catch((err: unknown) => {
    logger.warn('Could not fetch race events', athleteId, err);
    return null;
  });

  const [profileRes, activitiesRes, wellnessRes] = await Promise.all([
    httpGet(`${INTERVALS_BASE}/api/v1/athlete/${athleteId}`),
    httpGet(`${INTERVALS_BASE}/api/v1/athlete/${athleteId}/activities?oldest=${oldest}&newest=${newest}`),
    httpGet(`${INTERVALS_BASE}/api/v1/athlete/${athleteId}/wellness?oldest=${wellnessOldest}&newest=${newest}`),
  ]);

  // 0. Process athlete profile for age & weight
  const rawProfile = profileRes.ok ? await profileRes.json() : {};
  const parseResult = IntervalsAthleteSchema.safeParse(rawProfile);
  const profile = parseResult.success ? parseResult.data : null;

  const athleteAge = ageFromDob(profile?.icu_date_of_birth, now) || 0;
  const profileWeightKg =
    (typeof profile?.weight === 'number' && profile.weight > 0 ? profile.weight : null)
    ?? (typeof profile?.icu_weight === 'number' && profile.icu_weight > 0 ? profile.icu_weight : null);
  logger.info(`Athlete profile — age=${athleteAge}, weight=${profileWeightKg}`, athleteId);

  // 1. Process activities
  if (!activitiesRes.ok) {
    const errorText = await activitiesRes.text();
    logger.error(`Activities fetch failed — HTTP ${activitiesRes.status}: ${errorText}`, athleteId);
    throw new Error(`Activities fetch failed (HTTP ${activitiesRes.status})`);
  }
  const rawActivities = await activitiesRes.json();

  // Validate each activity with Zod, keep only valid Runs
  const activities: IntervalsActivity[] = (Array.isArray(rawActivities) ? rawActivities : [])
    .map((a: unknown) => IntervalsActivitySchema.safeParse(a))
    .filter((r): r is { success: true; data: IntervalsActivity } => r.success)
    .map((r) => r.data);

  // 2. Process Wellness (HRV/Readiness) from wellness endpoint
  if (!wellnessRes.ok) {
    logger.warn(`Wellness fetch failed — HTTP ${wellnessRes.status}`, athleteId);
  }
  const rawWellness = wellnessRes.ok ? await wellnessRes.json() : [];
  // The wellness endpoint returns entries **oldest-first**, the opposite of
  // /activities. Sort by date descending rather than trusting either ordering,
  // so `wellnessEntries[0]` is today and the 7-day window is the recent week.
  const wellnessEntries: IntervalsWellness[] = (Array.isArray(rawWellness) ? rawWellness : [])
    .map((w: unknown) => IntervalsWellnessSchema.safeParse(w))
    .filter((r): r is { success: true; data: IntervalsWellness } => r.success)
    .map((r) => r.data)
    .sort((a, b) => wellnessDate(b).localeCompare(wellnessDate(a)));

  const latestWellness = wellnessEntries[0] || null;

  // Extract body weight: prefer profile, fall back to most recent wellness entry
  const bodyWeightKg = profileWeightKg
    ?? wellnessEntries.find((w) => typeof w.weight === 'number' && w.weight > 0)?.weight
    ?? null;

  // 3. Select latest session/activity for sprint metrics
  const latestSession = activities[0];

  // 4. Calculate Neural Fatigue Index (NFI).
  // `max_speed` is null on activities with no GPS trace; those carry no
  // velocity signal and are skipped rather than counted as 0 m/s.
  const todayVmax = latestSession?.max_speed ?? 0;
  const priorVmaxes = activities.slice(1, 31).map((a) => a.max_speed);
  const windowBestVmax = priorVmaxes.reduce<number>(
    (best, v) => Math.max(best, v ?? 0),
    todayVmax,
  );

  // The baseline counts only sessions that actually reached sprint speed —
  // see SilverSprintLogic.calculateVmaxBaseline. With no qualifying session
  // there is nothing to compare against, so today becomes its own baseline
  // and NFI reads a neutral 1.0.
  const avgVmax = SilverSprintLogic.calculateVmaxBaseline(priorVmaxes, windowBestVmax) ?? todayVmax;

  const currentNFI = SilverSprintLogic.calculateNFI(todayVmax, avgVmax);
  const nfiStatus = SilverSprintLogic.getNFIStatus(currentNFI);

  // 5. Calculate HRV-based recovery (§3.2)
  // wellness endpoint returns hrv as the primary HRV field; fall back to rmssd for compatibility
  const currentHRV = extractHRV(latestWellness ?? {}) || DEFAULT_HRV;
  const recentHRVs = wellnessEntries
    .slice(0, 7)
    .map((w) => extractHRV(w))
    .filter((h): h is number => typeof h === 'number' && h > 0);
  const avgHRV7d = recentHRVs.length > 0
    ? recentHRVs.reduce((a, b) => a + b, 0) / recentHRVs.length
    : currentHRV;

  const hrvData: HRVData = { currentHRV, avgHRV7d };

  // 6. Calculate TSB and Strength Zone (§3.3).
  //
  // Fitness and fatigue are read from **today's wellness row**, not from the
  // most recent activity. An activity carries the CTL/ATL it had on the day it
  // was recorded, so sourcing them from it freezes TSB on the last training
  // day: after two or three rest days the athlete has recovered, ATL has
  // decayed and TSB may have crossed back above zero, yet the dashboard would
  // still report the fatigue they were carrying when they last trained — and
  // prescribe accordingly. The wellness endpoint has a row for every calendar
  // day, so it stays current while an athlete rests.
  //
  // Accounts whose wellness rows carry no load data fall back to the activity
  // values, which is the previous behaviour and still better than zero.
  const load = selectCurrentTrainingLoad(wellnessEntries, latestSession, todayDate);
  const latestATL = load.atl;
  const latestCTL = load.ctl;
  const tsb = latestCTL - latestATL;
  const strengthRx = SilverSprintLogic.getStrengthPrescription(tsb);

  // 7. Build 60-day time series for charts
  const dailyTimeSeries = buildDailyTimeSeries(activities, wellnessEntries, avgVmax, avgHRV7d, athleteAge, now);

  // 8. Race estimates based on best Vmax + training interval history
  const bestVmax60d = activities.reduce((best, a) => Math.max(best, a.max_speed ?? 0), 0);

  // Fetch structured interval data from the Intervals.icu API for each activity
  // in the 60-day window. Only sprint-range efforts (≤ 400m) are included by the parser.
  // The /intervals endpoint provides accurate rep-level data (distance, max_speed,
  // moving_time) that is not present in the activity list response.
  const activitiesForIntervals = activities;
  const intervalFetches = await Promise.allSettled(
    activitiesForIntervals.map(async (a) => {
      const res = await httpGet(`${INTERVALS_BASE}/api/v1/activity/${a.id}/intervals`);
      if (!res.ok) return { intervals: [] as TrackInterval[], totalLoad: 0 };
      const raw = (await res.json()) as { icu_intervals?: unknown[] } | unknown[];
      // The /intervals endpoint returns { icu_intervals: [...], icu_groups: [...] },
      // NOT a bare array. Fall back to the root itself in case the API shape changes.
      const rawIntervals: unknown[] = Array.isArray((raw as { icu_intervals?: unknown[] })?.icu_intervals)
        ? (raw as { icu_intervals: unknown[] }).icu_intervals
        : Array.isArray(raw) ? raw : [];
      if (rawIntervals.length === 0) return { intervals: [] as TrackInterval[], totalLoad: 0 };

      let totalLoad = 0;
      const intervals: TrackInterval[] = [];
      for (const item of rawIntervals) {
        const parsed = IntervalsIntervalSchema.safeParse(item);
        if (!parsed.success) continue;
        // Sum training_load from ALL interval types so that non-sprint load feeds into recovery.
        totalLoad += parsed.data.training_load ?? 0;
        const interval = SprintParser.fromAPIInterval(parsed.data);
        if (interval) intervals.push(interval);
      }

      return { intervals, totalLoad };
    })
  );

  // Merge: for each activity use API intervals when available, else fall back
  // to fetching the activity's /streams endpoint (for its velocity_smooth) and
  // parsing it.  The activity list endpoint omits velocity_smooth, so the
  // parseTrackSession fallback only works when the stream is fetched separately.
  // To avoid an unbounded burst of fallback requests (rate-limit risk), we
  // process activities that need a fallback sequentially.
  const allTrainingIntervals: TrackInterval[] = [];
  for (let idx = 0; idx < activitiesForIntervals.length; idx++) {
    const a = activitiesForIntervals[idx];
    const result = intervalFetches[idx];
    if (result.status === 'fulfilled' && result.value.intervals.length > 0) {
      allTrainingIntervals.push(...result.value.intervals);
      continue;
    }

    // Attempt to parse from the activity's velocity_smooth (may be populated
    // by the list endpoint on some accounts).
    const streamIntervals = SprintParser.parseTrackSession(a);
    if (streamIntervals.length > 0) {
      allTrainingIntervals.push(...streamIntervals);
      continue;
    }

    // Last resort: fetch the activity's /streams endpoint to get velocity_smooth.
    // This is an extra API call per activity that lacked both interval and
    // list-level stream data.  Sequential processing avoids rate-limit bursts.
    try {
      const streamsRes = await httpGet(`${INTERVALS_BASE}/api/v1/activity/${a.id}/streams`);
      if (!streamsRes.ok) {
        logger.warn(
          `Failed to fetch velocity stream for activity ${a.id}: ${streamsRes.status} ${streamsRes.statusText}`,
          athleteId
        );
        continue;
      }
      const streams = await streamsRes.json();
      const rawVelocitySmooth = extractVelocitySmooth(streams);
      const velocitySmooth = rawVelocitySmooth.filter(
        (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)
      );
      if (velocitySmooth.length === 0) {
        if (rawVelocitySmooth.length > 0) {
          logger.warn(
            `Skipping velocity stream for activity ${a.id}: stream contained no valid numeric samples`,
            athleteId
          );
        }
        continue;
      }
      allTrainingIntervals.push(
        ...SprintParser.parseTrackSession({ velocity_smooth: velocitySmooth })
      );
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      logger.warn(
        `Failed to fetch or parse velocity stream for activity ${a.id}: ${reason}`,
        athleteId
      );
    }
  }

  // Aggregate total training load from ALL interval types across recent sessions.
  // This captures non-sprint load (warmup, cooldown, rest) that would otherwise
  // be ignored by the WORK/ACTIVE-only filter used for race estimation.
  const totalIntervalLoad = intervalFetches
    .filter((r): r is PromiseFulfilledResult<{ intervals: TrackInterval[]; totalLoad: number }> => r.status === 'fulfilled')
    .reduce((sum, r) => sum + r.value.totalLoad, 0);

  logger.info(`Parsed ${allTrainingIntervals.length} training intervals from ${activitiesForIntervals.length} activities (of ${activities.length} total), totalIntervalLoad=${totalIntervalLoad}`, athleteId);

  // Compute a TSB that also reflects non-sprint interval training load.
  const recoveryTSB = SilverSprintLogic.computeIntervalAdjustedTSB(
    latestCTL,
    latestATL,
    totalIntervalLoad,
    activitiesForIntervals.length,
  );

  const smartRecovery = SilverSprintLogic.getSmartRecoveryWindow(athleteAge, hrvData, recoveryTSB, currentNFI);
  const recoveryHours = smartRecovery.hours;
  const adjustedSRS = smartRecovery.srs;
  const staleVmax = smartRecovery.staleVmax;

  const raceInput: RaceEstimatorInput = {
    bestVmax60d,
    avgVmax,
    nfi: currentNFI,
    nfiStatus,
    tsb,
    age: athleteAge,
    activityCount: activities.length,
    trainingIntervals: allTrainingIntervals,
  };
  // Calibrate against races the athlete has actually run, when they have
  // entered any. The correction is derived once and applied to both the
  // current and the "fully recovered" estimates.
  const raceCalibration = RaceEstimator.calibrate(raceInput, deps.raceResults ?? [], now);
  const calibratedInput: RaceEstimatorInput = { ...raceInput, calibration: raceCalibration };

  const raceEstimates = RaceEstimator.estimate(calibratedInput);

  // 8b. "Fully recovered" estimates — only computed when fatigued
  const recoveredEstimates: RaceEstimate[] = nfiStatus !== 'green'
    ? RaceEstimator.estimate({
        ...calibratedInput,
        nfi: 1.0,
        nfiStatus: 'green',
        tsb: 5,
      })
    : [];

  // 9. Build sprint race plans from the events requested at the start of the sync
  let sprintRacePlans: SprintRacePlan[] = [];
  let trainingPlan: TrainingPlanContext | null = null;
  try {
    const eventsRes = await eventsPromise;
    if (eventsRes?.ok) {
      const rawEvents = await eventsRes.json();
      logger.info(`Events API returned ${Array.isArray(rawEvents) ? rawEvents.length : 0} event(s)`, athleteId);
      const events: IntervalsEvent[] = (Array.isArray(rawEvents) ? rawEvents : [])
        .map((e: unknown) => IntervalsEventSchema.safeParse(e))
        .filter((r): r is { success: true; data: IntervalsEvent } => r.success)
        .map((r) => r.data)
        .filter((e) => {
          // Filter to sprint races: type Run, distance < 800m
          const distM = e.distance ?? e.distance_target ?? 0;
          const pass = e.type === 'Run' && distM > 0 && distM < 800;
          if (!pass) {
            logger.info(`Skipping event "${e.name}" — type=${e.type}, dist=${distM}, cat=${e.category}`, athleteId);
          }
          return pass;
        });

      const todayMidnight = new Date(todayDate);
      const raceEvents: SprintRaceEvent[] = events
        .map((e) => {
          const raceDate = new Date(e.start_date_local.split('T')[0]);
          const daysUntil = Math.max(
            0,
            Math.round((raceDate.getTime() - todayMidnight.getTime()) / 86_400_000)
          );
          const distM = e.distance ?? e.distance_target ?? 0;
          return {
            id: e.id,
            name: e.name || `${distM}m Race`,
            date: e.start_date_local.split('T')[0],
            distanceM: distM,
            daysUntil,
          };
        })
        .sort((a, b) => a.daysUntil - b.daysUntil);

      sprintRacePlans = SprintRacePlanner.buildMultiRacePlans(raceEvents, bestVmax60d, 45);

      // Build 12-week training plan context from nearest event within the plan window
      if (raceEvents.length > 0) {
        const nearest = raceEvents[0];
        trainingPlan = SprintTrainingPlan.buildContext(
          nearest.daysUntil,
          nearest.name,
          nearest.distanceM,
          nfiStatus,
          currentNFI,
          tsb,
        );
        if (trainingPlan) {
          logger.info(`Training plan: Week ${trainingPlan.planWeek}/12 — ${trainingPlan.phaseName} — ${trainingPlan.todaySpec.label}`, athleteId);
        }
      }

      logger.info(`Found ${sprintRacePlans.length} upcoming sprint race(s)`, athleteId);
    } else if (eventsRes) {
      logger.warn(`Events fetch failed — HTTP ${eventsRes.status}`, athleteId);
    }
  } catch (eventsErr) {
    logger.warn('Could not fetch race events', athleteId, eventsErr);
  }

  logger.info(`Data sync complete — NFI=${currentNFI.toFixed(3)}, activities=${activities.length}`, athleteId);

  return {
    activities,
    intervals: allTrainingIntervals,
    wellness: latestWellness,
    nfi: currentNFI,
    nfiStatus,
    avgVmax,
    todayVmax,
    recoveryHours,
    tsb,
    strengthZone: strengthRx.zone,
    srs: adjustedSRS,
    staleVmax,
    age: athleteAge,
    bodyWeightKg,
    dailyTimeSeries,
    raceEstimates,
    recoveredEstimates,
    sprintRacePlans,
    trainingPlan,
    raceEstimatorInput: raceInput,
    raceCalibration,
  };
}

/** wellness endpoint returns `hrv`; older wellness-ext responses used `rmssd`. */
function extractHRV(w: { rmssd?: number | null; hrv?: number | null }): number | undefined {
  return w.hrv ?? w.rmssd ?? undefined;
}

/**
 * Pick the training-load figures that describe **today**.
 *
 * Prefers the most recent wellness row that carries both CTL and ATL, since
 * those exist for every calendar day. Falls back to the copies stamped on the
 * latest activity when the account has no wellness load data.
 */
function selectCurrentTrainingLoad(
  wellnessEntries: IntervalsWellness[],
  latestSession: IntervalsActivity | undefined,
  today: string,
): { ctl: number; atl: number } {
  // Intervals.icu also serves **forward-projected** wellness rows: future dates
  // carry a CTL/ATL forecast derived from planned calendar workouts, with no
  // HRV and a shared generation timestamp. Those are predictions, not
  // measurements, so anything dated after today is ignored — otherwise a
  // planned rest day tomorrow would report the athlete as already recovered.
  // wellnessEntries is sorted newest-first, so the first eligible row wins.
  const current = wellnessEntries.find(
    (w) => typeof w.ctl === 'number' && typeof w.atl === 'number' && (w.date || w.id || '') <= today,
  );
  if (current) return { ctl: current.ctl as number, atl: current.atl as number };

  return { ctl: latestSession?.icu_ctl || 0, atl: latestSession?.icu_atl || 0 };
}

/** Wellness entries key their date on `date`, falling back to the `id` field. */
function wellnessDate(w: IntervalsWellness): string {
  return w.date || w.id || '';
}

/**
 * Pull the raw `velocity_smooth` samples out of an Intervals.icu `/streams` response.
 *
 * The live API answers with a bare **array** of `{ type, data }` stream objects
 * — not a map keyed by stream name. The keyed shapes are still accepted so that
 * proxies and older responses keep working.
 */
function extractVelocitySmooth(streams: unknown): unknown[] {
  if (Array.isArray(streams)) {
    const entry = streams.find(
      (s): s is { type?: unknown; data?: unknown } =>
        typeof s === 'object' && s !== null && (s as { type?: unknown }).type === 'velocity_smooth'
    );
    return Array.isArray(entry?.data) ? entry.data : [];
  }
  const keyed = (streams as { velocity_smooth?: unknown })?.velocity_smooth;
  if (Array.isArray(keyed)) return keyed;
  const keyedData = (keyed as { data?: unknown })?.data;
  return Array.isArray(keyedData) ? keyedData : [];
}

/** Derive age from date-of-birth field */
export function ageFromDob(dob: string | null | undefined, now: Date): number {
  if (!dob) return 0;
  const birth = new Date(dob);
  let age = now.getFullYear() - birth.getFullYear();
  const m = now.getMonth() - birth.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < birth.getDate())) age--;
  return age;
}

/**
 * Build a 60-day array of daily data points for the time-series charts.
 * Recovery hours are computed per-day using a rolling 7d HRV baseline
 * and the Sprint Recovery Score (SRS) composite model.
 */
export function buildDailyTimeSeries(
  activities: IntervalsActivity[],
  wellnessEntries: Array<{ id: string; date?: string; hrv?: number | null; rmssd?: number | null; ctl?: number | null; atl?: number | null }>,
  avgVmax: number,
  avgHRV7d: number,
  age: number,
  now: Date,
): DailyDataPoint[] {
  // Index activities by date
  const actByDate = new Map<string, IntervalsActivity>();
  for (const act of activities) {
    const dateStr = act.start_date_local?.split('T')[0];
    if (dateStr && !actByDate.has(dateStr)) actByDate.set(dateStr, act);
  }

  // Per-day fitness/fatigue from the wellness rows. These exist for every
  // calendar day, so the TSB line keeps decaying through a rest block instead
  // of holding the last training day's value flat.
  // Projected future rows are excluded here too — the chart plots what
  // happened, not what Intervals.icu forecasts from planned workouts.
  const todayStr = formatDateDaysAgo(now, 0);
  const loadByDate = new Map<string, number>();
  for (const w of wellnessEntries) {
    const dateStr = w.date || w.id;
    if (dateStr && dateStr <= todayStr && typeof w.ctl === 'number' && typeof w.atl === 'number') {
      if (!loadByDate.has(dateStr)) loadByDate.set(dateStr, w.ctl - w.atl);
    }
  }

  // Build HRV map and a date-sorted array for per-day rolling window.
  // Prefer hrv (wellness endpoint field) over rmssd for maximum accuracy.
  const wellByDate = new Map<string, number>();
  const hrvTimeline: Array<{ date: string; hrv: number }> = [];
  for (const w of wellnessEntries) {
    const dateStr = w.date || w.id;
    const hrvValue = w.hrv ?? w.rmssd;
    if (dateStr && hrvValue && hrvValue > 0 && !wellByDate.has(dateStr)) {
      wellByDate.set(dateStr, hrvValue);
      hrvTimeline.push({ date: dateStr, hrv: hrvValue });
    }
  }
  hrvTimeline.sort((a, b) => a.date.localeCompare(b.date));

  const series: DailyDataPoint[] = [];
  let lastTsb: number | null = null;
  for (let i = 59; i >= 0; i--) {
    const dateStr = formatDateDaysAgo(now, i);
    const d = new Date(dateStr + 'T12:00:00');
    const dayLabel = `${d.getDate()} ${['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][d.getMonth()]}`;

    const act = actByDate.get(dateStr);
    const hrv = wellByDate.get(dateStr);

    // A run with no velocity data has no NFI for that day — not an NFI of 0.
    const nfi = act && avgVmax > 0 && act.max_speed != null && act.max_speed > 0
      ? act.max_speed / avgVmax
      : null;
    // Wellness first — it has a row for rest days too. Only when the account
    // carries no load data do we fall back to the activity, and then to
    // carrying the previous day forward.
    const tsb: number | null = loadByDate.get(dateStr)
      ?? (act ? act.icu_ctl - act.icu_atl : lastTsb);
    if (tsb != null) lastTsb = tsb;

    // Per-day rolling 7d HRV avg using only entries up to and including this day
    const weekStartStr = formatDateDaysAgo(now, i + 7);
    const weekHRVs = hrvTimeline
      .filter(e => e.date > weekStartStr && e.date <= dateStr)
      .map(e => e.hrv);
    const rollingAvg7d = weekHRVs.length > 0
      ? weekHRVs.reduce((a, b) => a + b, 0) / weekHRVs.length
      : avgHRV7d;

    // SRS: neutral fallbacks for days without activity or HRV data
    const dayHrvData: HRVData = { currentHRV: hrv ?? rollingAvg7d, avgHRV7d: rollingAvg7d };
    const dayNfi = nfi ?? 1.0;
    const dayTsb = tsb ?? 0;
    const smartRec = SilverSprintLogic.getSmartRecoveryWindow(age, dayHrvData, dayTsb, dayNfi);
    const recoveryHours = smartRec.hours;

    series.push({ date: dateStr, dayLabel, nfi, tsb, recoveryHours, hrv: hrv ?? null });
  }

  return series;
}

/** Format a date `daysAgo` days before `base` as YYYY-MM-DD. */
export function formatDateDaysAgo(base: Date, daysAgo: number): string {
  const d = new Date(base);
  d.setDate(d.getDate() - daysAgo);
  return d.toISOString().slice(0, 10);
}

/** Format a date `daysAhead` days after `base` as YYYY-MM-DD. */
export function formatDateDaysAhead(base: Date, daysAhead: number): string {
  const d = new Date(base);
  d.setDate(d.getDate() + daysAhead);
  return d.toISOString().slice(0, 10);
}
