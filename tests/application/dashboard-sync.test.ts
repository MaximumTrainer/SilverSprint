import { describe, it, expect } from 'vitest';
import { buildDashboardState, DashboardState } from '../../src/application/dashboard-sync';
import { RaceEstimator } from '../../src/domain/sprint/race-estimator';
import { RaceResult, parseRaceResults } from '../../src/domain/sprint/race-results';
import { ACTIVITY_LIST_FIELDS, IntervalsActivitySchema } from '../../src/domain/schema';
import {
  createIntervalsApiStub,
  buildActivityList,
  buildWellnessSeries,
  FIXTURE_ATHLETE_ID,
  FIXTURE_NOW,
  FIXTURE_AGE,
  FIXTURE_WEIGHT_KG,
  FIXTURE_TODAY_HRV,
  FIXTURE_OLDEST_HRV,
  FIXTURE_RECENT_HRV_MEAN,
  FIXTURE_OLDEST_HRV_MEAN,
  FIXTURE_BEST_RUN_VMAX,
  FIXTURE_BEST_ANY_VMAX,
  FIXTURE_FLYS_STREAM_VMAX,
  RUN_ACTIVITY_IDS,
  buildRestDayScenario,
  REST_DAY_TODAY,
  REST_DAY_LAST_RUN,
  withProjectedFutureRows,
  PROJECTED_TOMORROW,
  FIXTURE_TODAY,
  buildActivityStreams,
  buildFieldsElidedActivityList,
  buildLargeRunAccount,
} from '../fixtures/intervals-api';
import {
  BULK_INTERVALS_BATCH_SIZE,
  PACE_CURVE_MAX_STREAM_ACTIVITIES,
} from '../../src/application/dashboard-sync';
import { extractStream, toNullableNumbers } from '../../src/application/intervals-http';

/**
 * End-to-end tests for the Intervals.icu ingestion use case, driven by mock
 * API payloads that reproduce the shapes and quirks of the live API
 * (see tests/fixtures/intervals-api.ts for the catalogue of reproduced traits).
 *
 * These cover the boundary between adapter and domain: schema validation,
 * response ordering, endpoint payload shapes, and the derived dashboard state.
 */

async function sync(overrides = {}): Promise<DashboardState> {
  const api = createIntervalsApiStub(overrides);
  return buildDashboardState({
    athleteId: FIXTURE_ATHLETE_ID,
    httpGet: api.httpGet,
    now: FIXTURE_NOW,
  });
}

describe('buildDashboardState — athlete profile', () => {
  it('derives age from icu_date_of_birth', async () => {
    const state = await sync();
    expect(state.age).toBe(FIXTURE_AGE);
  });

  it('falls back to icu_weight when the Strava weight field is null', async () => {
    const state = await sync();
    expect(state.bodyWeightKg).toBe(FIXTURE_WEIGHT_KG);
  });

  it('falls back to the most recent logged wellness weight when the profile has none', async () => {
    const state = await sync({ profile: { id: FIXTURE_ATHLETE_ID, icu_date_of_birth: '1977-01-05', weight: null, icu_weight: null } });
    expect(state.bodyWeightKg).toBe(FIXTURE_WEIGHT_KG);
  });
});

describe('buildDashboardState — activity filtering', () => {
  it('keeps only run-type activities', async () => {
    const state = await sync();
    const kept = state.activities.map((a) => a.id);
    expect(kept).toEqual(RUN_ACTIVITY_IDS);
  });

  it('excludes rides, walks, swims, yoga and weight training from the sprint model', async () => {
    const state = await sync();
    const keptTypes = new Set(state.activities.map((a) => a.type));
    expect([...keptTypes].sort()).toEqual(['Run', 'TrailRun']);
  });

  it('never lets a GPS-glitched walk or a bike ride set the 60-day velocity ceiling', async () => {
    const state = await sync();
    const bestVmax = state.activities.reduce((best, a) => Math.max(best, a.max_speed ?? 0), 0);
    expect(bestVmax).toBe(FIXTURE_BEST_RUN_VMAX);
    expect(bestVmax).toBeLessThan(FIXTURE_BEST_ANY_VMAX);
  });

  it('retains a manually-entered run that has no max_speed', async () => {
    // Manual/indoor entries carry no GPS trace, so Intervals.icu returns
    // max_speed: null. The session still contributes training load and must
    // not disappear from the athlete's history.
    const state = await sync();
    expect(state.activities.map((a) => a.id)).toContain('act_run_manual');
  });

  it('treats a null max_speed as "no velocity data", not as zero velocity', async () => {
    const state = await sync();
    const manual = state.activities.find((a) => a.id === 'act_run_manual');
    expect(manual?.max_speed ?? 0).toBe(0);
    // ...and it must not drag the rolling baseline toward zero.
    expect(state.avgVmax).toBeGreaterThan(5);
  });

  it('reports zero-value state instead of throwing when no activities exist', async () => {
    const state = await sync({ activities: [] });
    expect(state.activities).toEqual([]);
    expect(state.nfi).toBe(1.0);
    expect(state.todayVmax).toBe(0);
    expect(state.raceEstimates.every((e) => e.display === '--')).toBe(true);
  });

  it('throws a descriptive error when the activities endpoint fails', async () => {
    const api = createIntervalsApiStub({ failing: { '/activities': 500 } });
    await expect(
      buildDashboardState({ athleteId: FIXTURE_ATHLETE_ID, httpGet: api.httpGet, now: FIXTURE_NOW })
    ).rejects.toThrow(/Activities fetch failed \(HTTP 500\)/);
  });
});

describe('buildDashboardState — wellness ordering', () => {
  it('reads HRV from the most recent wellness day, not the oldest', async () => {
    // The wellness endpoint returns entries oldest-first, the opposite of
    // /activities. Taking entry[0] silently reads a 60-day-old measurement.
    const state = await sync();
    expect(state.wellness?.hrv).toBe(FIXTURE_TODAY_HRV);
    expect(state.wellness?.hrv).not.toBe(FIXTURE_OLDEST_HRV);
  });

  it('exposes the newest wellness entry as `wellness`', async () => {
    const state = await sync();
    const newestDate = buildWellnessSeries().at(-1) as { id: string };
    expect(state.wellness?.id).toBe(newestDate.id);
  });

  it('averages HRV over the seven most recent days', async () => {
    // Verified indirectly: an HRV ratio of today/7d-average near 1.0 means the
    // correct window was used. The oldest-first window would give 30/20.57.
    const state = await sync();
    const impliedRatio = FIXTURE_TODAY_HRV / FIXTURE_RECENT_HRV_MEAN;
    const wrongRatio = FIXTURE_TODAY_HRV / FIXTURE_OLDEST_HRV_MEAN;
    expect(impliedRatio).toBeCloseTo(1.014, 2);
    expect(wrongRatio).toBeGreaterThan(1.4);
    // A ratio of 1.46 saturates the HRV term of the SRS at 100, so the bug is
    // observable as an implausibly high recovery score.
    expect(state.srs).toBeLessThan(90);
  });

  it('tolerates wellness days where the wearable was not worn', async () => {
    const state = await sync();
    const daysWithoutHrv = state.dailyTimeSeries.filter((d) => d.hrv === null);
    expect(daysWithoutHrv.length).toBeGreaterThan(0);
    expect(state.dailyTimeSeries.every((d) => d.recoveryHours !== null)).toBe(true);
  });

  it('falls back to the default HRV when the wellness endpoint fails', async () => {
    const state = await sync({ failing: { '/wellness': 503 } });
    expect(state.wellness).toBeNull();
    expect(Number.isFinite(state.srs)).toBe(true);
  });

  it('is unaffected when the API returns wellness newest-first instead', async () => {
    // Ordering must be derived from the dates, not assumed from the payload.
    const ascending = await sync();
    const descending = await sync({ wellness: [...buildWellnessSeries()].reverse() });
    expect(descending.wellness?.id).toBe(ascending.wellness?.id);
    expect(descending.srs).toBe(ascending.srs);
  });
});

describe('buildDashboardState — velocity stream fallback', () => {
  /**
   * The sync no longer fetches a stream for anything (AC-1). A session with no
   * lap data still yields rep-level detail, but only from a stream the pace
   * curve screen has already cached — a miss costs that session's reps on this
   * load, never a request.
   */

  /** The cache port, populated from the fixture's own stream payloads. */
  function cachedStreams(...activityIds: string[]) {
    const byId = new Map(activityIds.map((id) => {
      const raw = buildActivityStreams(id);
      return [id, raw && {
        velocitySmooth: toNullableNumbers(extractStream(raw, 'velocity_smooth')),
        distance: toNullableNumbers(extractStream(raw, 'distance')),
        time: toNullableNumbers(extractStream(raw, 'time')),
      }] as const;
    }));
    return (id: string) => byId.get(id) ?? null;
  }

  it('parses sprint reps from a cached stream for sessions with no lap data', async () => {
    // act_run_flys has no /intervals data, so a velocity trace is the only
    // source of rep-level detail for that session.
    const api = createIntervalsApiStub();
    const state = await buildDashboardState({
      athleteId: FIXTURE_ATHLETE_ID,
      httpGet: api.httpGet,
      now: FIXTURE_NOW,
      cachedStreams: cachedStreams('act_run_flys'),
    });
    expect(state.intervals.map((i) => i.vMax)).toContain(FIXTURE_FLYS_STREAM_VMAX);
    // …and reading the cache cost nothing.
    expect(api.streamRequests()).toEqual([]);
  });

  it('drops null samples from a GPS dropout without truncating the rep', async () => {
    const api = createIntervalsApiStub();
    const state = await buildDashboardState({
      athleteId: FIXTURE_ATHLETE_ID,
      httpGet: api.httpGet,
      now: FIXTURE_NOW,
      cachedStreams: cachedStreams('act_run_flys'),
    });
    // The flys stream holds three reps; a null mid-rep must not split rep 2
    // into two undersized bursts or discard the session.
    const flyReps = state.intervals.filter((i) => i.vMax >= 7.4 && i.vMax <= 8.0 && i.duration <= 12);
    expect(flyReps.length).toBeGreaterThanOrEqual(3);
  });

  it('still builds the dashboard when nothing is cached', async () => {
    const state = await sync();
    expect(state.activities.length).toBeGreaterThan(0);
    expect(state.intervals.length).toBeGreaterThan(0);
  });
});

describe('buildDashboardState — sprint rep classification', () => {
  it('never reports a flying velocity faster than the rep max velocity', async () => {
    // Devices compute average_speed and max_speed over different windows, so a
    // short lap can report average_speed > max_speed. A rep whose sustained
    // 3-second speed exceeds its own peak is physically impossible and inflates
    // the race model's "best flying velocity" input.
    const state = await sync();
    const impossible = state.intervals.filter((i) => i.flyingVelocity > i.vMax);
    expect(impossible).toEqual([]);
  });

  it('excludes warm-up jogs that Intervals.icu mislabels as WORK laps', async () => {
    const state = await sync();
    // The 1005 m / 356 s warm-up jog appears as type WORK in the lap data.
    expect(state.intervals.some((i) => i.distance > 400)).toBe(false);
    expect(state.intervals.some((i) => i.distance / i.duration < 5.5)).toBe(false);
  });

  it('excludes RECOVERY laps even when they carry the session peak speed', async () => {
    const state = await sync();
    // act_run_primer's recovery laps report max_speed up to 8.31 because the
    // lap boundary lands inside the preceding sprint.
    const longSlowReps = state.intervals.filter((i) => i.duration > 100);
    expect(longSlowReps).toEqual([]);
  });

  it('classifies the primer session into acceleration and max-velocity reps', async () => {
    const state = await sync();
    const types = new Set(state.intervals.map((i) => i.type));
    expect(types.has('Acceleration')).toBe(true);
    expect(types.has('MaxVelocity')).toBe(true);
  });

  it('excludes the 400 m race rep, which exceeds the 25 s sprint ceiling', async () => {
    const state = await sync();
    expect(state.intervals.some((i) => i.duration > 25)).toBe(false);
  });
});

describe('buildDashboardState — race planning', () => {
  it('builds plans for both sprint races scheduled tomorrow', async () => {
    const state = await sync();
    const names = state.sprintRacePlans.map((p) => p.race.name);
    expect(names).toContain('100m sprint');
    expect(names).toContain('200m sprint');
  });

  it('excludes a 5 km road race and a bike time trial from the sprint planner', async () => {
    const state = await sync();
    const names = state.sprintRacePlans.map((p) => p.race.name);
    expect(names).not.toContain('Autumn 5k');
    expect(names).not.toContain('Club time trial');
  });

  it('treats the nearest race as the master constraint', async () => {
    const state = await sync();
    expect(state.sprintRacePlans[0].race.daysUntil).toBe(1);
  });

  it('builds a training plan context from the nearest race', async () => {
    const state = await sync();
    expect(state.trainingPlan).not.toBeNull();
    expect(state.trainingPlan?.raceName).toBe('100m sprint');
  });

  it('degrades gracefully when the events endpoint fails', async () => {
    const state = await sync({ failing: { '/events': 500 } });
    expect(state.sprintRacePlans).toEqual([]);
    expect(state.trainingPlan).toBeNull();
    // The rest of the dashboard must still be populated.
    expect(state.activities.length).toBeGreaterThan(0);
  });
});

describe('buildDashboardState — neural fatigue index', () => {
  it('anchors the rolling baseline to sprint sessions, not to easy running', async () => {
    // The fixture window mixes sprint sessions (7.7–8.9 m/s) with easy runs
    // (3.3–4.9 m/s). Averaging everything would give a ~6.8 m/s baseline.
    const state = await sync();
    expect(state.avgVmax).toBeGreaterThan(7.8);
    expect(state.avgVmax).toBeLessThan(8.95);
  });

  it('reports a plausible NFI for a normal sprint session', async () => {
    // Today's primer (8.31 m/s) is in line with recent sprint days, so the
    // index should sit close to 1.0 — not inflated by easy-run dilution.
    const state = await sync();
    expect(state.nfi).toBeGreaterThan(0.93);
    expect(state.nfi).toBeLessThan(1.06);
    expect(state.nfiStatus).toBe('green');
  });

  it('turns the traffic light amber when today is below the sprint baseline', async () => {
    const activities = buildActivityList();
    const today = activities.find((a) => a.id === 'act_run_primer') as Record<string, unknown>;
    const state = await sync({
      activities: activities.map((a) => (a === today ? { ...a, max_speed: 7.85 } : a)),
    });
    expect(state.nfiStatus).toBe('amber');
  });

  it('turns the traffic light red on a clear neural-fatigue day', async () => {
    const activities = buildActivityList();
    const today = activities.find((a) => a.id === 'act_run_primer') as Record<string, unknown>;
    const state = await sync({
      activities: activities.map((a) => (a === today ? { ...a, max_speed: 7.4 } : a)),
    });
    expect(state.nfiStatus).toBe('red');
  });

  it('does not let an easy run be mistaken for a lost sprint session', async () => {
    // A 3.3 m/s recovery jog logged today must not read as a 60% velocity
    // collapse — there is simply no sprint data for the day.
    const activities = buildActivityList();
    const easyToday = { ...(activities.find((a) => a.id === 'act_run_easy') as Record<string, unknown>) };
    easyToday.id = 'act_run_easy_today';
    easyToday.start_date_local = `${FIXTURE_NOW.toISOString().slice(0, 10)}T06:00:00`;
    const state = await sync({ activities: [easyToday, ...activities] });
    // Documented behaviour: NFI is driven by the most recent activity, so an
    // easy day reads red. The baseline itself must stay anchored to sprints.
    expect(state.avgVmax).toBeGreaterThan(7.8);
  });
});

describe('buildDashboardState — race estimates', () => {
  it('predicts monotonically increasing times over 100 m, 200 m and 400 m', async () => {
    const state = await sync();
    const [r100, r200, r400] = state.raceEstimates;
    expect(r100.predictedTime).toBeLessThan(r200.predictedTime);
    expect(r200.predictedTime).toBeLessThan(r400.predictedTime);
  });

  it('predicts times in a plausible masters range for an 8.9 m/s athlete', async () => {
    const state = await sync();
    const [r100, r200, r400] = state.raceEstimates;
    expect(r100.predictedTime).toBeGreaterThan(11);
    expect(r100.predictedTime).toBeLessThan(18);
    expect(r200.predictedTime).toBeGreaterThan(23);
    expect(r200.predictedTime).toBeLessThan(38);
    expect(r400.predictedTime).toBeGreaterThan(55);
    expect(r400.predictedTime).toBeLessThan(90);
  });

  it('lands within a second of the athlete profile the fixtures are modelled on', async () => {
    // The fixture athlete's observed competition efforts, from the GPS traces
    // the mock data reproduces: 200 m in ~31 s and 400 m in ~71 s.
    const state = await sync();
    const [, r200, r400] = state.raceEstimates;
    expect(Math.abs(r200.predictedTime - 31)).toBeLessThan(1.5);
    expect(Math.abs(r400.predictedTime - 71)).toBeLessThan(2.5);
  });

  it('reports high confidence when 10+ activities and interval history exist', async () => {
    const state = await sync();
    expect(state.raceEstimates[0].confidence).toBe('high');
  });

  it('reports low confidence and no time when there is no velocity data', async () => {
    const state = await sync({ activities: [] });
    expect(state.raceEstimates[0].confidence).toBe('low');
    expect(state.raceEstimates[0].display).toBe('--');
  });
});

describe('buildDashboardState — derived readiness', () => {
  it('produces an SRS within the documented 0–100 range', async () => {
    const state = await sync();
    expect(state.srs).toBeGreaterThanOrEqual(0);
    expect(state.srs).toBeLessThanOrEqual(100);
  });

  it('produces a recovery window at or above the age-tax floor for a 49-year-old', async () => {
    // 48h base + (49 − 40) × 6h = 102h before any SRS penalty.
    const state = await sync();
    expect(state.recoveryHours).toBeGreaterThanOrEqual(102);
    expect(state.recoveryHours).toBeLessThanOrEqual(150);
  });

  it('builds a 60-day time series ending today', async () => {
    const state = await sync();
    expect(state.dailyTimeSeries).toHaveLength(60);
    expect(state.dailyTimeSeries.at(-1)?.date).toBe(FIXTURE_NOW.toISOString().slice(0, 10));
  });

  it('reports no NFI on days with no run, rather than an implicit zero', async () => {
    const state = await sync();
    const yoga = state.dailyTimeSeries.find((d) => d.date === '2026-08-27');
    expect(yoga?.nfi).toBeNull();
  });

  it('does not report a zero NFI for a run that has no velocity data', async () => {
    const state = await sync();
    const manualDay = state.dailyTimeSeries.find((d) => d.date === '2026-08-22');
    expect(manualDay?.nfi).toBeNull();
  });
});

describe('buildDashboardState — request windows', () => {
  it('requests enough activity history for the pace curve, and 60 inclusive days of wellness', async () => {
    const api = createIntervalsApiStub();
    const state = await buildDashboardState({ athleteId: FIXTURE_ATHLETE_ID, httpGet: api.httpGet, now: FIXTURE_NOW });
    const activities = api.callsMatching('/activities?')[0].path;
    const wellness = api.callsMatching('/wellness')[0].path;
    // Activities cost one request whatever the window, and the curve's
    // season-to-date range reaches back to January — so the request covers the
    // wider window and the 60-day dashboard view is partitioned out of it.
    expect(api.callsMatching('/activities?')).toHaveLength(1);
    expect(activities).toContain('oldest=2025-12-31');
    expect(activities).toContain('newest=2026-09-05');
    expect(state.activities.every((a) => (a.start_date_local ?? '').slice(0, 10) >= '2026-07-07')).toBe(true);
    expect(wellness).toContain('oldest=2026-07-08');
    // The wellness window runs two days past today: Intervals.icu answers
    // future dates with a CTL/ATL forecast, which is what the next-day
    // recommendation reads. Those rows are partitioned off from the measured
    // ones before anything describing today's state is derived.
    expect(wellness).toContain('newest=2026-09-07');
  });

  it('requests race events before the per-activity request burst', async () => {
    // Intervals.icu rate-limits bursts. Issuing the events request after one
    // call per activity puts it behind the limiter, and race planning is the
    // feature that silently disappears with a 429.
    const api = createIntervalsApiStub();
    await buildDashboardState({ athleteId: FIXTURE_ATHLETE_ID, httpGet: api.httpGet, now: FIXTURE_NOW });

    const eventsIndex = api.calls.findIndex((c) => c.path.includes('/events'));
    const firstActivityIndex = api.calls.findIndex((c) => c.path.includes('intervals=true'));

    expect(eventsIndex).toBeGreaterThanOrEqual(0);
    expect(eventsIndex).toBeLessThan(firstActivityIndex);
  });

  it('still builds the dashboard when the events request rejects outright', async () => {
    const api = createIntervalsApiStub();
    const httpGet = (url: string) =>
      url.includes('/events') ? Promise.reject(new Error('network down')) : api.httpGet(url);

    const state = await buildDashboardState({ athleteId: FIXTURE_ATHLETE_ID, httpGet, now: FIXTURE_NOW });
    expect(state.sprintRacePlans).toEqual([]);
    expect(state.activities.length).toBeGreaterThan(0);
  });

  it('looks 90 days ahead for races', async () => {
    const api = createIntervalsApiStub();
    await buildDashboardState({ athleteId: FIXTURE_ATHLETE_ID, httpGet: api.httpGet, now: FIXTURE_NOW });
    const events = api.callsMatching('/events')[0].path;
    expect(events).toContain('oldest=2026-09-05');
    expect(events).toContain('newest=2026-12-04');
  });

  it('asks for lap data once per run activity, in one bulk request', async () => {
    const api = createIntervalsApiStub();
    const state = await buildDashboardState({ athleteId: FIXTURE_ATHLETE_ID, httpGet: api.httpGet, now: FIXTURE_NOW });
    expect(api.bulkIntervalRequests().flat()).toEqual(state.activities.map((a) => a.id));
    // The per-activity endpoint is not touched while the bulk one works.
    expect(api.lapDataRequests()).toEqual([]);
  });

  it('does not request lap or stream data for non-run activities', async () => {
    const api = createIntervalsApiStub();
    await buildDashboardState({ athleteId: FIXTURE_ATHLETE_ID, httpGet: api.httpGet, now: FIXTURE_NOW });
    const nonRunIds = buildActivityList()
      .filter((a) => a.type !== 'Run' && a.type !== 'TrailRun')
      .map((a) => a.id as string);
    const requested = api.bulkIntervalRequests().flat();
    for (const id of nonRunIds) {
      expect(requested).not.toContain(id);
      expect(api.lapDataRequests()).not.toContain(id);
      expect(api.streamRequests()).not.toContain(id);
    }
  });
});

describe('buildDashboardState — calibration from known race times', () => {
  const raceDay = '2026-07-20'; // the fixture athlete's competition day

  async function syncWithResults(raceResults: RaceResult[]) {
    const api = createIntervalsApiStub();
    return buildDashboardState({
      athleteId: FIXTURE_ATHLETE_ID,
      httpGet: api.httpGet,
      now: FIXTURE_NOW,
      raceResults,
    });
  }

  it('leaves estimates uncalibrated when the athlete has entered nothing', async () => {
    const state = await sync();
    expect(state.raceCalibration.resultCount).toBe(0);
    expect(state.raceEstimates.every((e) => e.calibration === 'none')).toBe(true);
  });

  it('applies an entered result to the matching distance', async () => {
    const baseline = await sync();
    const base200 = baseline.raceEstimates.find((e) => e.distance === 200)!.predictedTime;

    const state = await syncWithResults([
      { id: 'a', distance: 200, timeSeconds: base200 + 1.5, date: raceDay },
    ]);
    const calibrated200 = state.raceEstimates.find((e) => e.distance === 200)!;

    expect(calibrated200.calibration).toBe('direct');
    expect(calibrated200.predictedTime).toBeGreaterThan(base200);
    expect(state.raceCalibration.resultCount).toBe(1);
  });

  it('does not fetch anything extra to apply a calibration', async () => {
    const plain = createIntervalsApiStub();
    await buildDashboardState({ athleteId: FIXTURE_ATHLETE_ID, httpGet: plain.httpGet, now: FIXTURE_NOW });

    const withResults = createIntervalsApiStub();
    await buildDashboardState({
      athleteId: FIXTURE_ATHLETE_ID,
      httpGet: withResults.httpGet,
      now: FIXTURE_NOW,
      raceResults: [{ id: 'a', distance: 100, timeSeconds: 14.5, date: raceDay }],
    });

    // Race times are local data; they must not cost an Intervals.icu request.
    expect(withResults.calls).toHaveLength(plain.calls.length);
  });

  it('exposes the estimator inputs so the UI can recalibrate without re-syncing', async () => {
    const state = await sync();
    expect(state.raceEstimatorInput.age).toBe(FIXTURE_AGE);
    expect(state.raceEstimatorInput.bestVmax60d).toBe(FIXTURE_BEST_RUN_VMAX);
    expect(state.raceEstimatorInput.trainingIntervals?.length).toBeGreaterThan(0);

    // Recomputing from the exposed inputs reproduces the same estimates.
    const recomputed = RaceEstimator.estimate({
      ...state.raceEstimatorInput,
      calibration: state.raceCalibration,
    });
    expect(recomputed.map((e) => e.predictedTime)).toEqual(state.raceEstimates.map((e) => e.predictedTime));
  });

  it('applies the calibration to the fully-recovered estimates too', async () => {
    const activities = buildActivityList();
    const today = activities.find((a) => a.id === 'act_run_primer') as Record<string, unknown>;
    const fatigued = activities.map((a) => (a === today ? { ...a, max_speed: 7.4 } : a));

    const api = createIntervalsApiStub({ activities: fatigued });
    const state = await buildDashboardState({
      athleteId: FIXTURE_ATHLETE_ID,
      httpGet: api.httpGet,
      now: FIXTURE_NOW,
      raceResults: [{ id: 'a', distance: 100, timeSeconds: 16.0, date: raceDay }],
    });

    expect(state.nfiStatus).toBe('red');
    expect(state.recoveredEstimates.length).toBeGreaterThan(0);
    expect(state.recoveredEstimates.every((e) => e.calibration !== 'none')).toBe(true);
  });

  it('ignores a result the schema would reject rather than corrupting the model', async () => {
    const baseline = await sync();
    // A mistyped 100 m time. It never reaches the model, so estimates stand.
    const state = await syncWithResults(
      parseRaceResults([{ id: 'bad', distance: 100, timeSeconds: 1234, date: raceDay }]),
    );

    expect(state.raceCalibration.resultCount).toBe(0);
    expect(state.raceEstimates.map((e) => e.predictedTime))
      .toEqual(baseline.raceEstimates.map((e) => e.predictedTime));
  });

  it('brings the 200m prediction onto the athlete\'s real race time', async () => {
    // The fixture reproduces a 200 m run in ~31 s. Entering it should pull the
    // estimate onto that mark rather than leaving the model's own guess.
    const state = await syncWithResults([
      { id: 'a', distance: 200, timeSeconds: 31.0, date: raceDay, note: 'Relay leg 1' },
    ]);
    const est200 = state.raceEstimates.find((e) => e.distance === 200)!;

    expect(Math.abs(est200.predictedTime - 31.0)).toBeLessThan(1.0);
    expect(est200.confidence).toBe('high');
  });
});

describe('buildDashboardState — training stress balance currency', () => {
  /**
   * TSB gates the strength prescription, the readiness card, the race-estimate
   * readiness modifier and the stale-Vmax check. Reading it off the last
   * *activity* freezes it on the training day, so an athlete who has since
   * rested is still told they are tired — precisely when ATL is decaying
   * fastest and the reading matters most.
   */
  async function syncRestDay(wellnessCarriesLoad = true) {
    const { activities, wellness } = buildRestDayScenario(wellnessCarriesLoad);
    const api = createIntervalsApiStub({ activities, wellness });
    return buildDashboardState({ athleteId: FIXTURE_ATHLETE_ID, httpGet: api.httpGet, now: FIXTURE_NOW });
  }

  it('reports today\'s TSB, not the TSB of the last training day', async () => {
    const state = await syncRestDay();
    expect(state.tsb).toBeCloseTo(REST_DAY_TODAY.tsb, 2);
    expect(state.tsb).not.toBeCloseTo(REST_DAY_LAST_RUN.tsb, 1);
  });

  it('calls a recovered athlete fresh rather than tired', async () => {
    // The whole complaint: three rest days later, TSB has crossed back above
    // zero, but the strength card still prescribed plyometrics.
    const state = await syncRestDay();
    expect(state.strengthZone).toBe('fresh');
  });

  it('lets the recovery window reflect today\'s fatigue', async () => {
    const state = await syncRestDay();
    // Age 49 → 102h age tax. A fresh athlete should sit near the floor, not be
    // penalised for fatigue that has already dissipated.
    expect(state.recoveryHours).toBeLessThan(130);
  });

  it('falls back to the last activity when wellness carries no load data', async () => {
    const state = await syncRestDay(false);
    expect(state.tsb).toBeCloseTo(REST_DAY_LAST_RUN.tsb, 2);
    expect(state.strengthZone).toBe('tired');
  });

  it('charts TSB decaying across rest days instead of holding the last value', async () => {
    const { activities, wellness } = buildRestDayScenario();
    const api = createIntervalsApiStub({ activities, wellness });
    const state = await buildDashboardState({ athleteId: FIXTURE_ATHLETE_ID, httpGet: api.httpGet, now: FIXTURE_NOW });

    const lastFour = state.dailyTimeSeries.slice(-4).map((d) => d.tsb);
    expect(lastFour.every((v) => v != null)).toBe(true);
    // Strictly rising as fatigue dissipates, rather than four identical points.
    for (let i = 1; i < lastFour.length; i++) {
      expect(lastFour[i]!).toBeGreaterThan(lastFour[i - 1]!);
    }
    expect(lastFour.at(-1)!).toBeCloseTo(REST_DAY_TODAY.tsb, 1);
  });

  it('still agrees with the activity record on a day that was trained', async () => {
    // The base fixture has a run today, so both sources describe the same day
    // and the displayed TSB must not move.
    const state = await sync();
    expect(state.tsb).toBeCloseTo(-1.0, 1);
  });
});

describe('buildDashboardState — projected wellness rows', () => {
  /**
   * Intervals.icu serves forecast rows for future dates, derived from planned
   * calendar workouts. Treating one as the current state would report an
   * athlete as recovered on the strength of a rest day they have not had yet.
   */
  it('ignores a forecast row when reading today\'s training load', async () => {
    const api = createIntervalsApiStub({ wellness: withProjectedFutureRows(buildWellnessSeries()) });
    const state = await buildDashboardState({ athleteId: FIXTURE_ATHLETE_ID, httpGet: api.httpGet, now: FIXTURE_NOW });

    const baseline = await sync();
    expect(state.tsb).toBeCloseTo(baseline.tsb, 5);
    expect(state.tsb).not.toBeCloseTo(PROJECTED_TOMORROW.tsb, 1);
    expect(state.strengthZone).toBe(baseline.strengthZone);
  });

  it('does not chart forecast rows', async () => {
    const api = createIntervalsApiStub({ wellness: withProjectedFutureRows(buildWellnessSeries()) });
    const state = await buildDashboardState({ athleteId: FIXTURE_ATHLETE_ID, httpGet: api.httpGet, now: FIXTURE_NOW });

    expect(state.dailyTimeSeries).toHaveLength(60);
    expect(state.dailyTimeSeries.at(-1)!.date).toBe(FIXTURE_TODAY);
    expect(state.dailyTimeSeries.at(-1)!.tsb).not.toBeCloseTo(PROJECTED_TOMORROW.tsb, 1);
  });
});

describe('buildDashboardState — two-day training recommendation', () => {
  it('recommends today from measurements and tomorrow from the forecast', async () => {
    const api = createIntervalsApiStub({ wellness: withProjectedFutureRows(buildWellnessSeries()) });
    const state = await buildDashboardState({ athleteId: FIXTURE_ATHLETE_ID, httpGet: api.httpGet, now: FIXTURE_NOW });

    expect(state.dailyPlan.today.date).toBe(FIXTURE_TODAY);
    expect(state.dailyPlan.today.tsbSource).toBe('recorded');
    expect(state.dailyPlan.tomorrow.tsbSource).toBe('projected');
    expect(state.dailyPlan.tomorrow.tsb).toBeCloseTo(PROJECTED_TOMORROW.tsb, 1);
  });

  it('falls back to the rest-day model when the account has no forecast', async () => {
    const state = await sync();
    expect(state.dailyPlan.tomorrow.tsbSource).toBe('modelled');
    expect(state.dailyPlan.tomorrowBasis).toContain('not train');
  });

  it('keeps today\'s plan consistent with the headline figures', async () => {
    const state = await sync();
    expect(state.dailyPlan.today.tsb).toBeCloseTo(state.tsb, 2);
    expect(state.dailyPlan.today.strengthBand.zone).toBe(state.strengthZone);
    expect(state.dailyPlan.today.sprint.status).toBe(state.nfiStatus);
    expect(state.dailyPlan.today.recovery.windowHours).toBe(state.recoveryHours);
  });

  it('starts the recovery clock from a sprint session, not an easy run', async () => {
    const state = await sync();
    // The fixture's most recent run is the sprint primer (8.31 m/s), today.
    // The easy 3.29 m/s run eight days ago must not be what the clock reads.
    expect(state.dailyPlan.today.recovery.hoursSinceMaxEffort).not.toBeNull();
    expect(state.dailyPlan.today.recovery.hoursSinceMaxEffort!).toBeLessThan(48);
  });

  it('does not offer a max-effort session the day after a hard sprint', async () => {
    const state = await sync();
    // 102h+ recovery window for a 49-year-old, sprinted today: tomorrow is
    // still well inside it whatever today's NFI says.
    expect(state.dailyPlan.tomorrow.recovery.cleared).toBe(false);
    expect(state.dailyPlan.tomorrow.sprint.status).not.toBe('green');
  });

  it('marks tomorrow provisional and today measured', async () => {
    const state = await sync();
    expect(state.dailyPlan.today.provisional).toBe(false);
    expect(state.dailyPlan.tomorrow.provisional).toBe(true);
  });

  it('never lets a forecast row set today\'s plan', async () => {
    const withForecast = createIntervalsApiStub({ wellness: withProjectedFutureRows(buildWellnessSeries()) });
    const forecastState = await buildDashboardState({ athleteId: FIXTURE_ATHLETE_ID, httpGet: withForecast.httpGet, now: FIXTURE_NOW });
    const baseline = await sync();

    expect(forecastState.dailyPlan.today.tsb).toBeCloseTo(baseline.dailyPlan.today.tsb, 5);
    expect(forecastState.dailyPlan.today.strengthBand.zone).toBe(baseline.dailyPlan.today.strengthBand.zone);
  });

  it('still derives HRV from measured rows once forecasts are in the window', async () => {
    // Forecast rows carry no HRV. Reading them as "latest" would blank the
    // readiness card and skew the 7-day average.
    const api = createIntervalsApiStub({ wellness: withProjectedFutureRows(buildWellnessSeries()) });
    const state = await buildDashboardState({ athleteId: FIXTURE_ATHLETE_ID, httpGet: api.httpGet, now: FIXTURE_NOW });

    expect(state.wellness?.id).toBe(FIXTURE_TODAY);
    expect(state.wellness?.hrv).toBe(FIXTURE_TODAY_HRV);
  });
});

describe('buildDashboardState — the request budget', () => {
  /**
   * Measured against the live account before this issue: **80 requests, 3205 ms,
   * 8 × 429, 2.83 MB on `/activities`**. Of those 80, 54 were `/streams` for a
   * panel most loads never scrolled to, and 22 were an unbounded
   * `Promise.allSettled` over `/intervals` — measured peak 22 in flight.
   *
   * The limiter admits 30 requests per short window whatever the concurrency,
   * so a sync that stays below 30 is refusal-free by construction. These tests
   * are what keeps it there.
   */

  /** The budget the sync is allowed: 4 account-level requests + one per batch. */
  function budgetFor(runCount: number): number {
    return 4 + Math.ceil(runCount / BULK_INTERVALS_BATCH_SIZE);
  }

  it('issues no /streams request at all (AC-1)', async () => {
    // 60 runs, none of them with lap data — the shape that used to fetch a
    // stream for every one of them.
    const api = createIntervalsApiStub({ activities: buildLargeRunAccount(60) });
    const state = await buildDashboardState({ athleteId: FIXTURE_ATHLETE_ID, httpGet: api.httpGet, now: FIXTURE_NOW });

    expect(api.streamRequests()).toEqual([]);
    expect(state.paceCurveCandidates.length).toBeGreaterThan(0);
  });

  it('never puts more than four requests in flight at once (AC-3)', async () => {
    // Asserted on peak in flight, not on a call count: counting cannot tell 60
    // sequential requests from 60 simultaneous ones, and it was the
    // simultaneity that drew the 429.
    const api = createIntervalsApiStub({ activities: buildLargeRunAccount(60) });
    await buildDashboardState({ athleteId: FIXTURE_ATHLETE_ID, httpGet: api.httpGet, now: FIXTURE_NOW });
    expect(api.peakInFlight()).toBeLessThanOrEqual(4);
  });

  it('keeps peak concurrency at four even when every batch falls back (AC-3, AC-8)', async () => {
    // The fallback fans out per activity. It must not overlap the bulk pass,
    // or the two bounds multiply.
    const api = createIntervalsApiStub({ activities: buildLargeRunAccount(60), bulkIntervals: 'error' });
    await buildDashboardState({ athleteId: FIXTURE_ATHLETE_ID, httpGet: api.httpGet, now: FIXTURE_NOW });
    expect(api.peakInFlight()).toBeLessThanOrEqual(4);
  });

  it('stays inside 4 + ceil(R / 25) requests at R = 22 and R = 60 (AC-5)', async () => {
    for (const runs of [22, 60]) {
      const api = createIntervalsApiStub({ activities: buildLargeRunAccount(runs) });
      const state = await buildDashboardState({ athleteId: FIXTURE_ATHLETE_ID, httpGet: api.httpGet, now: FIXTURE_NOW });

      expect(state.activities).toHaveLength(runs);
      expect(api.calls.length, `R=${runs}`).toBeLessThanOrEqual(budgetFor(runs));
      expect(state.requestCount, `R=${runs}`).toBe(api.calls.length);
    }
    // Stated absolutely as well, so the arithmetic itself cannot drift.
    expect(budgetFor(22)).toBe(5);
    expect(budgetFor(60)).toBe(7);
  });

  it('reports the request count it actually issued (FR-31)', async () => {
    const api = createIntervalsApiStub();
    const state = await buildDashboardState({ athleteId: FIXTURE_ATHLETE_ID, httpGet: api.httpGet, now: FIXTURE_NOW });
    expect(state.requestCount).toBe(api.calls.length);
    // Far below the 30-per-window the limiter admits.
    expect(state.requestCount).toBeLessThan(30);
  });

  it('spends nothing on lap data when the athlete has no runs', async () => {
    const api = createIntervalsApiStub({ activities: [] });
    const state = await buildDashboardState({ athleteId: FIXTURE_ATHLETE_ID, httpGet: api.httpGet, now: FIXTURE_NOW });
    expect(api.bulkIntervalRequests()).toEqual([]);
    expect(state.requestCount).toBe(4);
  });

  it('hands the pace curve at most the capped set of candidates (AC-4)', async () => {
    // 80 runs, 60 of them with no lap data at all — the case that leaked 6
    // stream requests past the cap on the live account, because the lap merge
    // fetched streams for activities outside the top 40.
    const api = createIntervalsApiStub({ activities: buildLargeRunAccount(80, 20) });
    const state = await buildDashboardState({ athleteId: FIXTURE_ATHLETE_ID, httpGet: api.httpGet, now: FIXTURE_NOW });

    expect(state.paceCurveEligible).toBe(80);
    expect(state.paceCurveCandidates).toHaveLength(PACE_CURVE_MAX_STREAM_ACTIVITIES);
    expect(new Set(state.paceCurveCandidates.map((a) => a.id)).size).toBe(PACE_CURVE_MAX_STREAM_ACTIVITIES);
    expect(api.streamRequests()).toEqual([]);
  });

  it('ranks the candidates by peak speed, so the cap spends its budget on sprints', async () => {
    const api = createIntervalsApiStub();
    const state = await buildDashboardState({ athleteId: FIXTURE_ATHLETE_ID, httpGet: api.httpGet, now: FIXTURE_NOW });
    const fastest = buildActivityList()
      .filter((a) => a.type === 'Run' || a.type === 'TrailRun')
      .sort((a, b) => ((b.max_speed as number) ?? 0) - ((a.max_speed as number) ?? 0))
      .slice(0, 5)
      .map((a) => a.id as string);
    const candidates = state.paceCurveCandidates.map((a) => a.id);
    for (const id of fastest) expect(candidates).toContain(id);
  });
});

describe('buildDashboardState — bulk interval data', () => {
  it('batches ids 25 at a time, against payload rather than URL length (FR-19)', async () => {
    const api = createIntervalsApiStub({ activities: buildLargeRunAccount(60) });
    await buildDashboardState({ athleteId: FIXTURE_ATHLETE_ID, httpGet: api.httpGet, now: FIXTURE_NOW });

    const batches = api.bulkIntervalRequests();
    expect(batches.map((b) => b.length).sort((a, b) => b - a)).toEqual([25, 25, 10]);
    // `fields=` is ignored on this path, so sending it would be noise.
    for (const call of api.callsMatching('intervals=true')) {
      expect(call.path).not.toContain('fields=');
    }
  });

  it('handles a final batch of exactly one', async () => {
    const api = createIntervalsApiStub({ activities: buildLargeRunAccount(26) });
    await buildDashboardState({ athleteId: FIXTURE_ATHLETE_ID, httpGet: api.httpGet, now: FIXTURE_NOW });
    expect(api.bulkIntervalRequests().map((b) => b.length).sort((a, b) => b - a)).toEqual([25, 1]);
  });

  it('produces exactly the intervals the per-activity endpoint would (AC-6)', async () => {
    // Verified live: the two `icu_intervals` payloads are deep-equal, which is
    // what makes the substitution safe. Here the same claim is made of the
    // parsed result.
    const viaBulk = await sync();
    const viaPerActivity = await sync({ bulkIntervals: 'error' });
    expect(viaBulk.intervals).toEqual(viaPerActivity.intervals);
    expect(viaBulk.raceEstimates.map((e) => e.predictedTime))
      .toEqual(viaPerActivity.raceEstimates.map((e) => e.predictedTime));
  });

  it('keys the response by id when activities are dropped and reordered (AC-7)', async () => {
    // The live endpoint returned two activities, reordered, when one of three
    // requested ids was unknown. Parsing by position would attribute the 100 m
    // race's laps to the 400 m race.
    const races = buildActivityList().filter((a) =>
      a.id === 'act_race_100' || a.id === 'act_race_400');
    const ghost = { ...races[0], id: 'act_deleted', max_speed: null };
    const api = createIntervalsApiStub({ activities: [races[0], ghost, races[1]] });
    const state = await buildDashboardState({ athleteId: FIXTURE_ATHLETE_ID, httpGet: api.httpGet, now: FIXTURE_NOW });

    // The stub reverses what it returns and drops the unknown id, exactly as
    // the live endpoint did.
    expect(api.bulkIntervalRequests()[0]).toEqual(['act_race_100', 'act_deleted', 'act_race_400']);

    // The 100 m race's single sprint rep survives, attributed to the 100 m
    // race. The 400 m rep is past the parser's 25 s sprint ceiling, and the
    // ghost has no laps at all.
    expect(state.intervals).toHaveLength(1);
    expect(state.intervals[0].distance).toBe(100);
  });

  it('falls back to per-activity requests when the bulk endpoint fails (AC-8)', async () => {
    const api = createIntervalsApiStub({ bulkIntervals: 'error' });
    const state = await buildDashboardState({ athleteId: FIXTURE_ATHLETE_ID, httpGet: api.httpGet, now: FIXTURE_NOW });

    expect(api.lapDataRequests().length).toBeGreaterThan(0);
    expect(state.intervals.length).toBeGreaterThan(0);
  });

  it('falls back when the response carries no icu_intervals at all (AC-8)', async () => {
    const api = createIntervalsApiStub({ bulkIntervals: 'no-intervals' });
    const state = await buildDashboardState({ athleteId: FIXTURE_ATHLETE_ID, httpGet: api.httpGet, now: FIXTURE_NOW });

    expect(api.lapDataRequests().length).toBeGreaterThan(0);
    expect(state.intervals).toEqual((await sync()).intervals);
  });

  it('logs the fallback rather than degrading silently (FR-18)', async () => {
    const warnings: string[] = [];
    const api = createIntervalsApiStub({ bulkIntervals: 'error' });
    await buildDashboardState({
      athleteId: FIXTURE_ATHLETE_ID,
      httpGet: api.httpGet,
      now: FIXTURE_NOW,
      logger: { info: () => {}, warn: (m: string) => { warnings.push(m); }, error: () => {} },
    });
    expect(warnings.some((w) => w.includes('per-activity'))).toBe(true);
  });

  it('skips one malformed entry without failing the batch (FR-17)', async () => {
    const api = createIntervalsApiStub();
    const httpGet = async (url: string) => {
      const res = await api.httpGet(url);
      if (!url.includes('intervals=true')) return res;
      const body = (await res.json()) as unknown[];
      // One entry with a numeric id — the schema rejects it; the rest stand.
      return { ...res, json: async () => [{ id: 42, icu_intervals: [] }, ...body] };
    };
    const state = await buildDashboardState({ athleteId: FIXTURE_ATHLETE_ID, httpGet, now: FIXTURE_NOW });
    expect(state.intervals).toEqual((await sync()).intervals);
    // A malformed entry is not a failed batch, so nothing falls back.
    expect(api.lapDataRequests()).toEqual([]);
  });

  it('consumes bulk lap distances as metres, converting nothing (AC-22)', async () => {
    // The bulk laps carry a 100 m race rep and a 400 m one, in metres. The
    // parser's own 25 s sprint ceiling is what excludes the second — proof the
    // numbers arrived on the scale it expects.
    const state = await sync();
    const hundred = state.intervals.find((i) => Math.round(i.distance) === 100);
    expect(hundred).toBeDefined();
    expect(hundred!.distance).toBe(100);
    expect(state.intervals.every((i) => i.distance <= 400)).toBe(true);
  });
});

describe('buildDashboardState — the activities request', () => {
  /** Every request path a plain sync issues. */
  async function requestPaths(): Promise<string[]> {
    const api = createIntervalsApiStub();
    await buildDashboardState({ athleteId: FIXTURE_ATHLETE_ID, httpGet: api.httpGet, now: FIXTURE_NOW });
    return api.calls.map((c) => c.path);
  }

  it('names its fields, and the list cannot drift from the schema (AC-9)', async () => {
    const api = createIntervalsApiStub();
    await buildDashboardState({ athleteId: FIXTURE_ATHLETE_ID, httpGet: api.httpGet, now: FIXTURE_NOW });

    const requested = new URL(`https://x${api.callsMatching('/activities?')[0].path}`)
      .searchParams.get('fields')!
      .split(',');

    // Derived from the schema, so a field added there without being added to
    // the request fails here rather than silently zeroing a chart.
    const schemaFields = Object.keys(IntervalsActivitySchema.shape)
      .filter((f) => f !== 'velocity_smooth');
    expect([...requested].sort()).toEqual([...schemaFields].sort());
    expect(requested).toEqual([...ACTIVITY_LIST_FIELDS]);

    // The five a hand-written list omitted, each of which drives a chart.
    for (const field of ['name', 'icu_training_load', 'icu_atl', 'icu_ctl', 'stream_types']) {
      expect(requested).toContain(field);
    }
    // The list endpoint never returns velocity_smooth; asking for it is wrong.
    expect(requested).not.toContain('velocity_smooth');
  });

  it('parses a response whose nulls have been elided to absent keys (AC-10)', async () => {
    // `fields=` "also excludes null values", so max_speed and stream_types are
    // simply not there on the 5 live runs that have neither.
    const elided = buildFieldsElidedActivityList();
    const manual = elided.find((a) => a.id === 'act_run_manual')!;
    expect('max_speed' in manual).toBe(false);
    expect('stream_types' in manual).toBe(false);

    const state = await sync({ activities: elided });
    const parsed = state.activities.find((a) => a.id === 'act_run_manual')!;
    expect(parsed).toBeDefined();
    // Absent must mean "no velocity data", exactly as null does.
    expect(parsed.max_speed).toBeNull();
    expect(parsed.stream_types ?? null).toBeNull();

    // …and the rest of the dashboard is identical to the un-elided response.
    const baseline = await sync();
    expect(state.activities.map((a) => a.id)).toEqual(baseline.activities.map((a) => a.id));
    expect(state.nfi).toBeCloseTo(baseline.nfi, 10);
  });

  it('keeps every request metric, with no unit parameter anywhere (AC-22)', async () => {
    for (const path of await requestPaths()) {
      expect(path).not.toMatch(/units?=|imperial|miles|feet/i);
    }
  });
});
