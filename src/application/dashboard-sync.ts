import { SprintParser, TrackInterval } from '../domain/sprint/parser';
import { SilverSprintLogic, HRVData, NFIStatus } from '../domain/sprint/core';
import { RaceEstimator, RaceEstimate, RaceEstimatorInput } from '../domain/sprint/race-estimator';
import { SprintRacePlanner, SprintRacePlan, SprintRaceEvent } from '../domain/sprint/race-plan';
import { SprintTrainingPlan, TrainingPlanContext } from '../domain/sprint/training-plan';
import { RaceCalibration, RaceResult } from '../domain/sprint/race-results';
import { TwoDayPlan, buildTwoDayPlan, findLastMaxEffort } from '../domain/sprint/daily-plan';
import { paceCurveWindowDays } from '../domain/sprint/pace-curve';
import {
  ACTIVITY_LIST_FIELDS,
  IntervalsActivitySchema,
  IntervalsBulkActivitySchema,
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
import {
  ActivityStreams,
  HttpGet,
  NOOP_LOGGER,
  RATE_LIMIT_BACKOFF_MS,
  REQUEST_CONCURRENCY,
  RateLimitBudget,
  SyncLogger,
  countingHttpGet,
  forEachWithConcurrency,
  httpGetWithBackoff,
  newRateLimitBudget,
} from './intervals-http';

export type { ActivityStreams, HttpGet, HttpResponse, SyncLogger } from './intervals-http';
export { RATE_LIMIT_BACKOFF_MS } from './intervals-http';

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
  /**
   * First backoff step after a `429`, in ms; doubled on each further attempt.
   *
   * Exposed so the retry path can be exercised without the test suite actually
   * sleeping through it — a hard-coded schedule made one test 6 seconds long,
   * more than half the whole suite, which is a real cost now that hooks run it.
   */
  retryBackoffMs?: number;
  /**
   * Read-only access to streams already cached on this device.
   *
   * The sync itself never requests a stream any more — that cost moved to the
   * pace curve screen, which is the only thing that needs one. But the lap
   * merge below still *prefers* a velocity trace when an activity has no
   * parseable lap data, so it takes one when the pace curve screen has already
   * paid for it. A miss simply means that session contributes no rep-level
   * detail on this load; it never means a request.
   */
  cachedStreams?: (activityId: string) => ActivityStreams | null | undefined;
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
  /**
   * Today's and tomorrow's training recommendation.
   *
   * Today is built from measurements; tomorrow from Intervals.icu's own CTL/ATL
   * forecast, falling back to an explicit rest-day decay model.
   */
  dailyPlan: TwoDayPlan;
  /**
   * The activities the pace curve would be built from, ranked and capped —
   * but with **no streams fetched**.
   *
   * The curve used to be computed here, which meant every dashboard load paid
   * for up to 40 `/streams` requests whether or not the athlete ever scrolled
   * to the panel. The curve now lives on its own screen, so this is the
   * hand-off: the sync decides *which* sessions a curve would come from (it
   * already holds the window arithmetic and the ranking), and
   * `pace-curve-sync.ts` fetches their streams when — and only when — that
   * screen is opened.
   */
  paceCurveCandidates: IntervalsActivity[];
  /**
   * Dated runs inside the curve's date window, before the request cap.
   *
   * Carried so the screen can say "the 40 fastest of 118 were analysed". A
   * curve built from a fraction of the eligible sessions is not a mean-maximal
   * curve, it is a lower bound — and it fails in the most misleading direction,
   * quietly promoting a warm-up jog to "your best 400 m".
   */
  paceCurveEligible: number;
  /**
   * Intervals.icu requests this sync issued.
   *
   * A request budget that is not measured is a wish. Exposed so a regression
   * fails a test (see `AC-5`: at most `4 + ceil(R / 25)`) rather than being
   * discovered at the rate limiter by an athlete whose 400 m best silently
   * became a warm-up jog.
   */
  requestCount: number;
}

export interface PaceCurveCoverage {
  /** Run activities inside the curve's date window. */
  eligible: number;
  /** Activities whose stream was asked for, after the request cap. */
  requested: number;
  /** Activities whose stream came back usable. */
  fetched: number;
}

/** Number of days of historical activity/wellness data to fetch */
export const LOOKBACK_DAYS = 60;
/** Number of days ahead to look for upcoming race events */
export const RACE_LOOKAHEAD_DAYS = 90;
/** Default HRV value when no wellness data is available */
export const DEFAULT_HRV = 60;
/** Days of forward CTL/ATL projection to request for the next-day recommendation */
export const WELLNESS_LOOKAHEAD_DAYS = 2;
/**
 * Ceiling on how many activities the pace curve will pull streams for.
 *
 * Measured against a live account: 118 runs in a season-to-date window issued
 * 144 requests in 4 seconds, of which **64 came back 429**. The curve was then
 * built from 4 activities and reported a 400 m "best" of 117 s — a warm-up jog
 * — because the athlete's actual 400 m races were among the requests that were
 * refused. A silently wrong number is worse than a coarser one, so the request
 * count is bounded here rather than discovered at the rate limiter.
 *
 * 40 is chosen from that same account: ranked by `max_speed`, every genuine
 * race fell in the top 30 of 118.
 */
export const PACE_CURVE_MAX_STREAM_ACTIVITIES = 40;

/**
 * Activity ids per bulk interval request.
 *
 * The bound is **payload**, not URL length: 400 ids is a 4469-character path
 * that Intervals.icu answers happily, but a bulk activity with
 * `intervals=true` is ~42 KB, so 25 keeps a response near 1 MB. `fields=` is
 * no help — it is accepted and ignored on this path, and the response carries
 * all ~189 properties whatever is asked for.
 */
export const BULK_INTERVALS_BATCH_SIZE = 25;

/**
 * Fetches every Intervals.icu resource the dashboard needs and derives the
 * full dashboard state from it.
 *
 * This is the application-layer use case: it depends only on the `HttpGet`
 * port and the domain modules, never on React or `fetch` directly.
 */
export async function buildDashboardState(deps: DashboardSyncDeps): Promise<DashboardState> {
  const { athleteId } = deps;
  // Every request goes through the counter, so the budget in `requestCount`
  // is the number actually issued rather than the number intended.
  const { httpGet, count: requestCount } = countingHttpGet(deps.httpGet);
  const logger = deps.logger ?? NOOP_LOGGER;
  // Capture "now" once to ensure a consistent request window, even across midnight/DST.
  const now = deps.now ?? new Date();

  logger.info('Starting data sync', athleteId);

  const oldest = formatDateDaysAgo(now, LOOKBACK_DAYS);
  const newest = formatDateDaysAgo(now, 0);
  // The pace curve reaches further back than the rest of the dashboard — up to
  // season-to-date. Activities are a single request whatever the window, so
  // one wider request is cheaper than a second one, and everything downstream
  // of `activities` is partitioned back to the 60-day window below.
  const paceCurveOldest = formatDateDaysAgo(now, paceCurveWindowDays(now));
  // Wellness endpoint uses an inclusive date range: today − 59 days → today = 60 days
  const wellnessOldest = formatDateDaysAgo(now, LOOKBACK_DAYS - 1);
  // Ask for a few days past today as well. Intervals.icu answers future dates
  // with a CTL/ATL forecast derived from the workouts already on the calendar,
  // which is what the next-day recommendation is built from. Rows dated after
  // today are partitioned off below so they can never be mistaken for
  // measurements.
  const wellnessNewest = formatDateDaysAhead(now, WELLNESS_LOOKAHEAD_DAYS);
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
    // `fields=` is the only lever available on this request: /activities has no
    // server-side sport filter (passing `type=Run` is accepted and ignored), so
    // 608 activities come back to yield 118 runs. Naming the fields the schema
    // reads took the season-to-date response from 2.83 MB to 176 KB.
    httpGet(
      `${INTERVALS_BASE}/api/v1/athlete/${athleteId}/activities`
      + `?oldest=${paceCurveOldest}&newest=${newest}&fields=${ACTIVITY_LIST_FIELDS.join(',')}`
    ),
    httpGet(`${INTERVALS_BASE}/api/v1/athlete/${athleteId}/wellness?oldest=${wellnessOldest}&newest=${wellnessNewest}`),
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
  const runActivities: IntervalsActivity[] = (Array.isArray(rawActivities) ? rawActivities : [])
    .map((a: unknown) => IntervalsActivitySchema.safeParse(a))
    .filter((r): r is { success: true; data: IntervalsActivity } => r.success)
    .map((r) => r.data);

  // Everything except the pace curve is a 60-day view of the athlete. Activities
  // with no `start_date_local` cannot be placed in either window; they are kept
  // here — the previous behaviour — and left out of the curve, which has to be
  // able to date every point it plots.
  const activities: IntervalsActivity[] = runActivities.filter((a) => {
    const date = activityDate(a);
    return date === null || date >= oldest;
  });

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

  // Split measurements from forecasts. Everything describing the athlete's
  // *current* state must come from the measured side; only the next-day
  // recommendation may read the forecast.
  const isMeasured = (w: IntervalsWellness) => (w.date || w.id || '') <= todayDate;
  const measuredWellness = wellnessEntries.filter(isMeasured);
  const projectedWellness = wellnessEntries.filter((w) => !isMeasured(w));

  const latestWellness = measuredWellness[0] || null;

  // Extract body weight: prefer profile, fall back to most recent wellness entry
  const bodyWeightKg = profileWeightKg
    ?? measuredWellness.find((w) => typeof w.weight === 'number' && w.weight > 0)?.weight
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
  const recentHRVs = measuredWellness
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
  const load = selectCurrentTrainingLoad(measuredWellness, latestSession, todayDate);
  const latestATL = load.atl;
  const latestCTL = load.ctl;
  const tsb = latestCTL - latestATL;
  const strengthRx = SilverSprintLogic.getStrengthPrescription(tsb);

  // 7. Build 60-day time series for charts
  const dailyTimeSeries = buildDailyTimeSeries(activities, measuredWellness, avgVmax, avgHRV7d, athleteAge, now);

  // 8. Race estimates based on best Vmax + training interval history
  const bestVmax60d = activities.reduce((best, a) => Math.max(best, a.max_speed ?? 0), 0);

  // Fetch structured interval data from the Intervals.icu API for every activity
  // in the 60-day window. Only sprint-range efforts (<= 400m) are included by the
  // parser. Lap data provides accurate rep-level detail (distance, max_speed,
  // moving_time) that is not present in the activity list response.
  const activitiesForIntervals = activities;
  // One budget for the whole sync, so the whole run backs off - or gives up -
  // together rather than each request discovering the limiter for itself.
  const rateLimitBudget = newRateLimitBudget(deps.retryBackoffMs ?? RATE_LIMIT_BACKOFF_MS);

  const intervalsByActivity = await fetchIntervalsInBulk(
    httpGet,
    athleteId,
    activitiesForIntervals.map((a) => a.id),
    logger,
    rateLimitBudget,
  );

  // -- the pace curve's candidates, ranked but not fetched -------------------
  // Ranked by peak speed, not recency. A sprint best lives in the sessions
  // where the athlete actually sprinted, and `max_speed` already tells us
  // which those are without spending a request to find out. On the live
  // account this put every real race inside the top 30 of 118 runs, so the
  // cap costs nothing that would have changed the curve.
  //
  // No stream is requested here. That is the point of the separate screen:
  // a dashboard load used to issue 54 `/streams` requests for a panel most
  // visits never scrolled to.
  const paceCurveEligible = runActivities.filter((a) => {
    const date = activityDate(a);
    return date !== null && date >= paceCurveOldest;
  });
  const paceCurveCandidates = [...paceCurveEligible]
    .sort((a, b) => (b.max_speed ?? 0) - (a.max_speed ?? 0))
    .slice(0, PACE_CURVE_MAX_STREAM_ACTIVITIES);

  // Merge: for each activity use API intervals when available, else fall back
  // to the activity's velocity_smooth stream and parse that. The activity list
  // endpoint omits velocity_smooth, so the fallback reads whatever the pace
  // curve screen has already cached - and issues no request of its own.
  const allTrainingIntervals: TrackInterval[] = [];
  for (const a of activitiesForIntervals) {
    const result = intervalsByActivity.get(a.id);
    if (result && result.intervals.length > 0) {
      allTrainingIntervals.push(...result.intervals);
      continue;
    }

    // Attempt to parse from the activity's velocity_smooth (may be populated
    // by the list endpoint on some accounts).
    const streamIntervals = SprintParser.parseTrackSession(a);
    if (streamIntervals.length > 0) {
      allTrainingIntervals.push(...streamIntervals);
      continue;
    }

    const streams = deps.cachedStreams?.(a.id);
    if (!streams) continue;
    // The parser has no notion of a dropout, so nulls are stripped for it.
    // The pace curve reads the same samples with the nulls intact, because
    // there it is precisely the gaps that must not be integrated across.
    const velocitySmooth = streams.velocitySmooth.filter(
      (value): value is number => typeof value === 'number' && Number.isFinite(value)
    );
    if (velocitySmooth.length === 0) {
      if (streams.velocitySmooth.length > 0) {
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
  }

  // Aggregate total training load from ALL interval types across recent sessions.
  // This captures non-sprint load (warmup, cooldown, rest) that would otherwise
  // be ignored by the WORK/ACTIVE-only filter used for race estimation.
  const totalIntervalLoad = [...intervalsByActivity.values()]
    .reduce((sum, r) => sum + r.totalLoad, 0);

  logger.info(`Parsed ${allTrainingIntervals.length} training intervals from ${activitiesForIntervals.length} activities (of ${activities.length} total), totalIntervalLoad=${totalIntervalLoad}`, athleteId);

  logger.info(
    `Pace curve deferred - ${paceCurveCandidates.length} candidate session(s) of ${paceCurveEligible.length} eligible, `
    + 'streams fetched only when the pace curve screen is opened',
    athleteId,
  );

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

  // 8c. Today's and tomorrow's recommendation.
  // Only a genuine sprint session starts a recovery window — an easy run costs
  // nothing neurally, so it must not reset the clock.
  const lastMaxEffortAt = findLastMaxEffort(
    activities,
    windowBestVmax,
    SilverSprintLogic.SPRINT_SESSION_VMAX_FRACTION,
  );

  const tomorrowDate = formatDateDaysAhead(now, 1);
  const tomorrowRow = projectedWellness.find((w) => (w.date || w.id) === tomorrowDate);
  const projectedTomorrowTsb =
    tomorrowRow && typeof tomorrowRow.ctl === 'number' && typeof tomorrowRow.atl === 'number'
      ? tomorrowRow.ctl - tomorrowRow.atl
      : null;

  const dailyPlan = buildTwoDayPlan({
    now,
    nfi: currentNFI,
    nfiStatus,
    todayTsb: tsb,
    projectedTomorrowTsb,
    ctl: latestCTL,
    atl: latestATL,
    recoveryHours,
    lastMaxEffortAt,
  });

  logger.info(
    `Plan — today: ${dailyPlan.today.headline} | tomorrow (${dailyPlan.tomorrow.tsbSource}): ${dailyPlan.tomorrow.headline}`,
    athleteId,
  );

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
    dailyPlan,
    paceCurveCandidates,
    paceCurveEligible: paceCurveEligible.length,
    requestCount: requestCount(),
  };
}

/** What one activity's lap data contributes. */
interface ActivityIntervals {
  intervals: TrackInterval[];
  totalLoad: number;
}

/**
 * Fetch lap data for many activities, keyed by activity id.
 *
 * Uses the bulk endpoint
 * `GET /athlete/{id}/activities/{ids}?intervals=true`, which returns
 * byte-identical `icu_intervals` to the per-activity path and replaces 22
 * requests with 1 on a live account. That trade costs 14% more bytes (929 KB
 * against 814 KB) and is still clearly right: the limiter counts requests, not
 * bytes, and five requests sit far under the 30-per-window it admits.
 *
 * Two documented behaviours of that endpoint shape this code:
 *
 *  - **Missing activities are dropped, and the order changes.** Asking for
 *    three ids where the middle one was unknown returned two, reordered. So
 *    results are keyed by `id` and never by position; an id that does not come
 *    back has no lap data, which is not an error.
 *  - **The response cannot be slimmed.** `fields=` is undocumented on this
 *    path and has no effect (928,986 bytes with and without), so it is not
 *    sent; the chunk size is what bounds the payload instead.
 *
 * A batch that fails outright falls back to the per-activity endpoint for
 * exactly its own ids, so one bad response costs a slower sync rather than a
 * dashboard with no rep-level analysis. The fallback runs after every batch
 * has been attempted, so the two phases never overlap and the concurrency
 * bound holds across both.
 */
async function fetchIntervalsInBulk(
  httpGet: HttpGet,
  athleteId: string,
  activityIds: readonly string[],
  logger: SyncLogger,
  budget: RateLimitBudget,
): Promise<Map<string, ActivityIntervals>> {
  const results = new Map<string, ActivityIntervals>();
  if (activityIds.length === 0) return results;

  const batches: string[][] = [];
  for (let i = 0; i < activityIds.length; i += BULK_INTERVALS_BATCH_SIZE) {
    batches.push(activityIds.slice(i, i + BULK_INTERVALS_BATCH_SIZE));
  }

  const needsFallback: string[] = [];

  await forEachWithConcurrency(batches, REQUEST_CONCURRENCY, async (ids) => {
    const requested = new Set(ids);
    const url = `${INTERVALS_BASE}/api/v1/athlete/${athleteId}/activities/${ids.join(',')}?intervals=true`;
    try {
      const res = await httpGetWithBackoff(httpGet, url, athleteId, logger, budget);
      if (!res.ok) {
        logger.warn(`Bulk interval fetch failed - HTTP ${res.status} for ${ids.length} activity(ies)`, athleteId);
        needsFallback.push(...ids);
        return;
      }
      const body = await res.json();
      // A body carrying no lap data at all is indistinguishable from a shape
      // change, so it is treated as a failure rather than as "no intervals".
      if (!Array.isArray(body) || !body.some(hasIntervalArray)) {
        logger.warn('Bulk interval response carried no icu_intervals - falling back to per-activity requests', athleteId);
        needsFallback.push(...ids);
        return;
      }
      for (const raw of body) {
        // One malformed entry is skipped; it must not fail the batch.
        const parsed = IntervalsBulkActivitySchema.safeParse(raw);
        if (!parsed.success || !requested.has(parsed.data.id)) continue;
        results.set(parsed.data.id, parseIntervalSet(parsed.data.icu_intervals ?? []));
      }
    } catch (error) {
      logger.warn(`Bulk interval fetch threw for ${ids.length} activity(ies)`, athleteId, error);
      needsFallback.push(...ids);
    }
  });

  if (needsFallback.length > 0) {
    logger.warn(
      `Falling back to per-activity interval requests for ${needsFallback.length} activity(ies)`,
      athleteId,
    );
    await forEachWithConcurrency(needsFallback, REQUEST_CONCURRENCY, async (id) => {
      results.set(id, await fetchActivityIntervals(httpGet, athleteId, id, logger, budget));
    });
  }

  return results;
}

/** True when a bulk response entry carries a lap array at all. */
function hasIntervalArray(entry: unknown): boolean {
  return typeof entry === 'object'
    && entry !== null
    && Array.isArray((entry as { icu_intervals?: unknown }).icu_intervals);
}

/**
 * The per-activity lap endpoint, used only when a bulk batch could not be read.
 *
 * `GET /activity/{id}/intervals` returns `{ icu_intervals: [...], icu_groups:
 * [...] }`, not a bare array; the root is still accepted in case the shape
 * changes back.
 */
async function fetchActivityIntervals(
  httpGet: HttpGet,
  athleteId: string,
  activityId: string,
  logger: SyncLogger,
  budget: RateLimitBudget,
): Promise<ActivityIntervals> {
  const empty: ActivityIntervals = { intervals: [], totalLoad: 0 };
  try {
    const res = await httpGetWithBackoff(
      httpGet,
      `${INTERVALS_BASE}/api/v1/activity/${activityId}/intervals`,
      athleteId,
      logger,
      budget,
    );
    if (!res.ok) return empty;
    const raw = (await res.json()) as { icu_intervals?: unknown[] } | unknown[];
    const rawIntervals: unknown[] = Array.isArray((raw as { icu_intervals?: unknown[] })?.icu_intervals)
      ? (raw as { icu_intervals: unknown[] }).icu_intervals
      : Array.isArray(raw) ? raw : [];
    return parseIntervalSet(rawIntervals);
  } catch (error) {
    logger.warn(`Failed to fetch intervals for activity ${activityId}`, athleteId, error);
    return empty;
  }
}

/**
 * Turn one activity's raw laps into sprint reps and a load total.
 *
 * Shared by both paths so the bulk and per-activity responses can never be
 * parsed differently - the lap payloads are byte-identical, and this is what
 * keeps their interpretation identical too.
 *
 * Every distance here is metres and every speed m/s, exactly as the API
 * returns them. No unit conversion happens anywhere in this file.
 */
function parseIntervalSet(rawIntervals: readonly unknown[]): ActivityIntervals {
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

/** The `YYYY-MM-DD` an activity happened on, or null when it carries no date. */
function activityDate(a: IntervalsActivity): string | null {
  const raw = a.start_date_local;
  if (typeof raw !== 'string' || raw.length < 10) return null;
  return raw.slice(0, 10);
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
