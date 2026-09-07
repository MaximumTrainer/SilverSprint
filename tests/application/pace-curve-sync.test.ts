import { describe, it, expect } from 'vitest';
import { buildDashboardState, DashboardState } from '../../src/application/dashboard-sync';
import {
  PaceCurveSyncResult,
  StreamCachePort,
  loadPaceCurve,
  paceCurveNotice,
} from '../../src/application/pace-curve-sync';
import type { ActivityStreams } from '../../src/application/intervals-http';
import {
  DEFAULT_PACE_CURVE_DISTANCES,
  MAX_PLAUSIBLE_SPEED,
  PACE_CURVE_PRESET_DISTANCES,
  computePaceCurve,
  paceCurveMonotonicityViolations,
} from '../../src/domain/sprint/pace-curve';
import { PACE_CURVE_MAX_STREAM_ACTIVITIES } from '../../src/application/dashboard-sync';
import {
  createIntervalsApiStub,
  IntervalsApiStub,
  StubOverrides,
  buildActivityList,
  buildLargeRunAccount,
  buildStreamTypesScenario,
  STREAM_TYPES_SKIPPED_ID,
  FIXTURE_ATHLETE_ID,
  FIXTURE_NOW,
  FIXTURE_TODAY,
  FIXTURE_AGE,
  FIXTURE_BEST_RUN_VMAX,
  FIXTURE_GPS_SPIKE_SPEED,
  FIXTURE_TRACK_200M_PEAK,
} from '../fixtures/intervals-api';

/**
 * The deferred pace-curve load.
 *
 * These are the tests that used to live in `dashboard-sync.test.ts`, because
 * the curve used to be built during the sync. It is now built when — and only
 * when — the pace curve screen is opened, so the assertions moved with it.
 * Nothing about the numbers moved: {@link PREREWORK_CURVE} below is the exact
 * output of the pre-rework code on the same fixture.
 */

interface Loaded {
  state: DashboardState;
  curve: PaceCurveSyncResult;
  api: IntervalsApiStub;
}

/** A dashboard sync followed by the pace curve load the screen performs. */
async function load(
  overrides: StubOverrides = {},
  curveDeps: Partial<Parameters<typeof loadPaceCurve>[0]> = {},
): Promise<Loaded> {
  const api = createIntervalsApiStub(overrides);
  const state = await buildDashboardState({
    athleteId: FIXTURE_ATHLETE_ID,
    httpGet: api.httpGet,
    now: FIXTURE_NOW,
  });
  const curve = await loadPaceCurve({
    athleteId: FIXTURE_ATHLETE_ID,
    httpGet: api.httpGet,
    activities: state.paceCurveCandidates,
    eligibleCount: state.paceCurveEligible,
    bestVmax60d: state.raceEstimatorInput.bestVmax60d,
    now: FIXTURE_NOW,
    ...curveDeps,
  });
  return { state, curve, api };
}

/** An in-memory {@link StreamCachePort}, standing in for `src/lib/stream-cache`. */
function memoryCache(): StreamCachePort & { store: Map<string, Map<string, ActivityStreams>>; writes: number } {
  const store = new Map<string, Map<string, ActivityStreams>>();
  const cache = {
    store,
    writes: 0,
    load: (athleteId: string) => new Map(store.get(athleteId) ?? []),
    save: (athleteId: string, streams: Map<string, ActivityStreams>) => {
      cache.writes++;
      store.set(athleteId, new Map(streams));
      return true;
    },
  };
  return cache;
}

describe('loadPaceCurve — the streams the dashboard no longer fetches (AC-2)', () => {
  it('fetches the candidate streams when the screen is opened, and not before', async () => {
    const api = createIntervalsApiStub();
    const state = await buildDashboardState({ athleteId: FIXTURE_ATHLETE_ID, httpGet: api.httpGet, now: FIXTURE_NOW });
    expect(api.streamRequests()).toEqual([]);

    const curve = await loadPaceCurve({
      athleteId: FIXTURE_ATHLETE_ID,
      httpGet: api.httpGet,
      activities: state.paceCurveCandidates,
      bestVmax60d: state.raceEstimatorInput.bestVmax60d,
      now: FIXTURE_NOW,
    });

    expect(api.streamRequests().length).toBe(state.paceCurveCandidates.length);
    expect(curve.streams.length).toBeGreaterThan(0);
    expect(curve.requestCount).toBe(api.streamRequests().length);
  });

  it('requests each activity stream exactly once', async () => {
    const { api } = await load();
    const requested = api.streamRequests();
    expect(new Set(requested).size).toBe(requested.length);
  });

  it('charts the default distances for an athlete who has configured none', async () => {
    const { curve } = await load();
    expect(curve.curve.points.map((p) => p.distance)).toEqual([...DEFAULT_PACE_CURVE_DISTANCES]);
  });

  it('charts whatever distances the athlete has configured, ascending', async () => {
    const { curve } = await load({}, { distances: [100, 10, 45].sort((a, b) => a - b) });
    expect(curve.curve.points.map((p) => p.distance)).toEqual([10, 45, 100]);
  });

  it('leaves non-run activities out of the curve entirely', async () => {
    const { curve } = await load();
    const nonRunIds = new Set(
      buildActivityList()
        .filter((a) => a.type !== 'Run' && a.type !== 'TrailRun')
        .map((a) => a.id as string),
    );
    for (const stream of curve.streams) expect(nonRunIds.has(stream.activityId)).toBe(false);
  });

  it('carries the streams the curve was built from, so nothing has to be refetched', async () => {
    const { curve } = await load();
    expect(curve.streams.length).toBeGreaterThan(0);
    for (const stream of curve.streams) {
      expect(stream.velocitySmooth.length).toBeGreaterThan(0);
      expect(stream.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(stream.name.length).toBeGreaterThan(0);
    }
  });

  it('traces every point back to a dated activity inside the window', async () => {
    const { curve } = await load();
    const known = new Map(curve.streams.map((s) => [s.activityId, s]));
    const measured = curve.curve.points.filter((p) => p.timeSeconds !== null);
    expect(measured.length).toBeGreaterThan(0);

    for (const point of measured) {
      const source = known.get(point.activityId!);
      expect(source).toBeDefined();
      expect(point.activityName).toBe(source!.name);
      expect(point.date).toBe(source!.date);
      expect(point.date! <= FIXTURE_TODAY).toBe(true);
    }
  });

  it('re-charts a different distance set without issuing a single new request (FR-11)', async () => {
    const { curve, api } = await load();
    const before = api.calls.length;

    // This is what the screen does when a chip is toggled or the range changes.
    const recharted = computePaceCurve({
      streams: curve.streams,
      distances: [10, 20, 45, 300],
      since: '2026-06-07',
      bestVmax60d: FIXTURE_BEST_RUN_VMAX,
    });

    expect(recharted.points.map((p) => p.distance)).toEqual([10, 20, 45, 300]);
    expect(api.calls.length).toBe(before);
  });
});

/**
 * The curve the pre-rework code produced on this fixture, over the full preset
 * ladder and the default 90-day range.
 *
 * Captured by running `buildDashboardState` at the commit before this rework
 * and printing `state.paceCurve`. This rework is plumbing: moving the fetch to
 * another screen, batching the lap requests and caching the streams must not
 * move a single number.
 *
 * **This asserts that nothing changed, not that the values are right.** They
 * are not: against the one activity on the live account with an official time
 * — a 200 m race in 29.1 s — the curve reads 24.66 s, 18% fast, because the
 * device recorded 225.16 m for a 200 m race. Calibrating against known race
 * distances is a separate, real problem, tracked in issue #33; freezing the
 * numbers here must not be read as blessing them.
 */
const PREREWORK_CURVE = [
  { distance: 10, timeSeconds: 1.12, speed: 8.9, activityId: 'act_race_200', activityName: '200m relay leg 1', date: '2026-07-20', submaximal: false },
  { distance: 20, timeSeconds: 2.25, speed: 8.89, activityId: 'act_race_200', activityName: '200m relay leg 1', date: '2026-07-20', submaximal: false },
  { distance: 30, timeSeconds: 3.39, speed: 8.85, activityId: 'act_race_200', activityName: '200m relay leg 1', date: '2026-07-20', submaximal: false },
  { distance: 40, timeSeconds: 4.54, speed: 8.81, activityId: 'act_race_200', activityName: '200m relay leg 1', date: '2026-07-20', submaximal: false },
  { distance: 60, timeSeconds: 6.87, speed: 8.73, activityId: 'act_race_200', activityName: '200m relay leg 1', date: '2026-07-20', submaximal: false },
  { distance: 80, timeSeconds: 9.27, speed: 8.63, activityId: 'act_race_200', activityName: '200m relay leg 1', date: '2026-07-20', submaximal: false },
  { distance: 100, timeSeconds: 11.78, speed: 8.49, activityId: 'act_race_200', activityName: '200m relay leg 1', date: '2026-07-20', submaximal: false },
  { distance: 150, timeSeconds: 18.7, speed: 8.02, activityId: 'act_race_200', activityName: '200m relay leg 1', date: '2026-07-20', submaximal: false },
  { distance: 200, timeSeconds: 45.68, speed: 4.38, activityId: 'act_run_accel', activityName: 'Race prep — acceleration drills', date: '2026-08-31', submaximal: true },
  { distance: 300, timeSeconds: 85.68, speed: 3.5, activityId: 'act_run_accel', activityName: 'Race prep — acceleration drills', date: '2026-08-31', submaximal: true },
  { distance: 400, timeSeconds: 126.91, speed: 3.15, activityId: 'act_run_accel', activityName: 'Race prep — acceleration drills', date: '2026-08-31', submaximal: true },
];

describe('loadPaceCurve — the rework moved no numbers (AC-20)', () => {
  it('reproduces the pre-rework curve point for point', async () => {
    const { curve } = await load({}, { distances: [...PACE_CURVE_PRESET_DISTANCES] });
    expect(curve.curve.points).toEqual(PREREWORK_CURVE);
    expect(curve.curve.excludedEfforts).toBe(1);
    expect(curve.curve.excludedActivities).toBe(0);
    expect(curve.curve.activitiesUsed).toBe(4);
  });

  it('reproduces the pre-rework coverage', async () => {
    const { curve } = await load();
    expect(curve.coverage).toEqual({ eligible: 17, requested: 17, fetched: 4 });
  });

  it('reproduces it identically from the cache, not only from the network (AC-12)', async () => {
    const cache = memoryCache();
    const first = await load({}, { cache, distances: [...PACE_CURVE_PRESET_DISTANCES] });
    const second = await load({}, { cache, distances: [...PACE_CURVE_PRESET_DISTANCES] });

    expect(second.curve.requestCount).toBe(0);
    expect(second.curve.curve.points).toEqual(PREREWORK_CURVE);
    expect(second.curve.curve).toEqual(first.curve.curve);
  });
});

describe('loadPaceCurve — physics bounds survive (AC-21)', () => {
  it('never publishes a best implying more than the physiological ceiling', async () => {
    const { curve } = await load();
    for (const point of curve.curve.points) {
      if (point.speed === null) continue;
      expect(point.speed).toBeLessThan(MAX_PLAUSIBLE_SPEED);
    }
  });

  it('excludes the GPS spike that would otherwise report 100 m in a second', async () => {
    const { curve } = await load();
    // The fixture stream carries one sample at 102 m/s — the artifact that
    // makes the upstream pace-curve endpoint unusable below ~250 m.
    expect(FIXTURE_GPS_SPIKE_SPEED).toBeGreaterThan(MAX_PLAUSIBLE_SPEED);
    const hundred = curve.curve.points.find((p) => p.distance === 100)!;
    expect(hundred.timeSeconds).toBeGreaterThan(100 / MAX_PLAUSIBLE_SPEED);
    expect(hundred.speed).toBeLessThanOrEqual(FIXTURE_BEST_RUN_VMAX);
    expect(curve.curve.excludedEfforts).toBe(1);

    // And the spiked session's own best is drawn from the clean stretches.
    const spiked = curve.streams.find((x) => x.activityId === 'act_run_accel')!;
    const isolated = computePaceCurve({ streams: [spiked], distances: [100], bestVmax60d: FIXTURE_BEST_RUN_VMAX });
    expect(isolated.excludedEfforts).toBe(1);
    if (isolated.points[0].speed !== null) {
      expect(isolated.points[0].speed).toBeLessThanOrEqual(FIXTURE_BEST_RUN_VMAX);
    }
  });

  it('reports how many efforts it threw away rather than dropping them silently', async () => {
    const { curve } = await load();
    expect(curve.curve.excludedEfforts).toBeGreaterThanOrEqual(1);
  });

  it('produces a monotonic curve', async () => {
    const { curve } = await load({}, { distances: [10, 20, 30, 40, 60, 80, 100, 150, 200] });
    expect(paceCurveMonotonicityViolations(curve.curve)).toEqual([]);
  });

  it('never reports an average speed above the fastest instant the device recorded', async () => {
    const { curve } = await load({}, { distances: [10, 20, 30, 40, 60, 80, 100, 150, 200, 300, 400] });
    const peak = Math.max(
      ...curve.streams.flatMap((s) => s.velocitySmooth.filter((v): v is number => typeof v === 'number')),
    );
    for (const point of curve.curve.points) {
      if (point.speed === null) continue;
      expect(point.speed, `${point.distance} m`).toBeLessThanOrEqual(peak);
    }
  });

  it('is not inflated by a distance stream that disagrees with its own velocity trace', async () => {
    // act_race_200's distance stream runs 12% ahead of what its velocities
    // integrate to — the live quirk. Believing it put every point from 10 to
    // 60 m above the athlete's season peak.
    const { curve } = await load({}, { distances: [10, 20, 30, 60, 100] });
    for (const point of curve.curve.points) {
      if (point.speed === null) continue;
      expect(point.speed, `${point.distance} m`).toBeLessThanOrEqual(FIXTURE_TRACK_200M_PEAK);
    }
  });
});

describe('loadPaceCurve — the stream_types skip rule (AC-11)', () => {
  async function loadStreamTypes() {
    return load({ activities: buildStreamTypesScenario() });
  }

  it('fetches when stream_types is null, absent or empty — unknown means fetch', async () => {
    const { api } = await loadStreamTypes();
    const requested = api.streamRequests();
    for (const id of ['st_listed', 'st_null', 'st_empty', 'st_absent']) {
      expect(requested, id).toContain(id);
    }
  });

  it('skips only an array that is present and omits velocity_smooth', async () => {
    const { api, curve } = await loadStreamTypes();
    expect(api.streamRequests()).not.toContain(STREAM_TYPES_SKIPPED_ID);
    // …and the skip is not reported as a failed read: coverage counts what was
    // asked for, so a provably-streamless session must not read as "missing".
    expect(curve.coverage.requested).toBe(4);
  });

  it('saves nothing on the live account shape, and is a correctness guard only', async () => {
    // Every run in the base fixture that has a velocity trace lists it, and the
    // one that does not carries `stream_types: null` — so the guard fires zero
    // times here, exactly as it does on the live account.
    const { api, state } = await load();
    expect(api.streamRequests().length).toBe(state.paceCurveCandidates.length);
  });
});

describe('loadPaceCurve — the persistent stream cache (AC-12, AC-18)', () => {
  it('costs no request at all on a second visit', async () => {
    const cache = memoryCache();
    const first = await load({}, { cache });
    expect(first.curve.requestCount).toBeGreaterThan(0);
    expect(first.curve.cacheHits).toBe(0);

    const second = await load({}, { cache });
    expect(second.curve.requestCount).toBe(0);
    expect(second.curve.cacheHits).toBe(second.curve.coverage.requested);
    expect(second.curve.streams).toEqual(first.curve.streams);
  });

  it('never re-fetches a cached stream, whatever else changes', async () => {
    const cache = memoryCache();
    await load({}, { cache });
    const again = await load({}, { cache, distances: [15, 45, 250] });
    expect(again.curve.requestCount).toBe(0);
    expect(again.curve.curve.points.map((p) => p.distance)).toEqual([15, 45, 250]);
  });

  it('moving between screens twice costs nothing beyond the first fetch (AC-18)', async () => {
    const cache = memoryCache();
    const api = createIntervalsApiStub();
    const state = await buildDashboardState({ athleteId: FIXTURE_ATHLETE_ID, httpGet: api.httpGet, now: FIXTURE_NOW });

    const deps = {
      athleteId: FIXTURE_ATHLETE_ID,
      httpGet: api.httpGet,
      activities: state.paceCurveCandidates,
      bestVmax60d: state.raceEstimatorInput.bestVmax60d,
      now: FIXTURE_NOW,
      cache,
    };
    await loadPaceCurve(deps);
    const afterFirst = api.calls.length;
    await loadPaceCurve(deps);
    await loadPaceCurve(deps);
    expect(api.calls.length).toBe(afterFirst);
  });

  it('writes the sessions it used to the front, so the LRU keeps them', async () => {
    const cache = memoryCache();
    const { curve, state } = await load({}, { cache });
    const stored = cache.store.get(FIXTURE_ATHLETE_ID)!;

    // Every candidate that got an answer is stored, in candidate order — the
    // fastest sessions first, which is the order the cap itself uses.
    expect([...stored.keys()]).toEqual(state.paceCurveCandidates.map((a) => a.id));
    expect([...stored.keys()][0]).toBe(state.paceCurveCandidates[0].id);

    // The four with a usable trace carry samples; the rest are the cached
    // negatives, and both kinds must survive the round trip.
    const withSamples = [...stored.entries()].filter(([, v]) => v.velocitySmooth.length > 0);
    expect(withSamples.map(([id]) => id).sort())
      .toEqual(curve.streams.map((s) => s.activityId).sort());
  });

  it('keeps a previously cached activity that is not a candidate this time', async () => {
    const cache = memoryCache();
    cache.save(FIXTURE_ATHLETE_ID, new Map([['old_activity', { velocitySmooth: [1, 2, 3] }]]));
    await load({}, { cache });
    expect(cache.store.get(FIXTURE_ATHLETE_ID)!.has('old_activity')).toBe(true);
  });

  it('works with no cache at all', async () => {
    const { curve } = await load();
    expect(curve.cacheHits).toBe(0);
    expect(curve.streams.length).toBeGreaterThan(0);
  });
});

describe('loadPaceCurve — the cap holds across a load and a sync (AC-4)', () => {
  it('requests at most the capped number of distinct activities', async () => {
    // 80 runs, 60 of which have no lap data at all — the shape that leaked 6
    // stream requests past the cap on the live account, because the lap merge
    // fetched for activities outside the top 40.
    const api = createIntervalsApiStub({ activities: buildLargeRunAccount(80, 20) });
    const state = await buildDashboardState({ athleteId: FIXTURE_ATHLETE_ID, httpGet: api.httpGet, now: FIXTURE_NOW });
    await loadPaceCurve({
      athleteId: FIXTURE_ATHLETE_ID,
      httpGet: api.httpGet,
      activities: state.paceCurveCandidates,
      eligibleCount: state.paceCurveEligible,
      bestVmax60d: state.raceEstimatorInput.bestVmax60d,
      now: FIXTURE_NOW,
    });
    // Then a second sync, as a reload would do.
    await buildDashboardState({ athleteId: FIXTURE_ATHLETE_ID, httpGet: api.httpGet, now: FIXTURE_NOW });

    expect(api.distinctStreamRequests().length).toBeLessThanOrEqual(PACE_CURVE_MAX_STREAM_ACTIVITIES);
    expect(api.distinctStreamRequests()).toHaveLength(PACE_CURVE_MAX_STREAM_ACTIVITIES);
  });

  it('a 429 retry does not consume the cap, because the cap counts activities', async () => {
    const api = createIntervalsApiStub({
      activities: buildLargeRunAccount(80, 20),
      rateLimit: { afterRequests: 3, failures: 4 },
    });
    const state = await buildDashboardState({
      athleteId: FIXTURE_ATHLETE_ID, httpGet: api.httpGet, now: FIXTURE_NOW, retryBackoffMs: 1,
    });
    await loadPaceCurve({
      athleteId: FIXTURE_ATHLETE_ID,
      httpGet: api.httpGet,
      activities: state.paceCurveCandidates,
      bestVmax60d: state.raceEstimatorInput.bestVmax60d,
      now: FIXTURE_NOW,
      retryBackoffMs: 1,
    });

    expect(api.rateLimitedCount()).toBeGreaterThan(0);
    // Retries make the raw request count exceed the cap; distinct activities
    // must not.
    expect(api.distinctStreamRequests().length).toBeLessThanOrEqual(PACE_CURVE_MAX_STREAM_ACTIVITIES);
  });

  it('bounds concurrency at four while fetching streams', async () => {
    const api = createIntervalsApiStub({ activities: buildLargeRunAccount(80) });
    const state = await buildDashboardState({ athleteId: FIXTURE_ATHLETE_ID, httpGet: api.httpGet, now: FIXTURE_NOW });
    await loadPaceCurve({
      athleteId: FIXTURE_ATHLETE_ID,
      httpGet: api.httpGet,
      activities: state.paceCurveCandidates,
      bestVmax60d: state.raceEstimatorInput.bestVmax60d,
      now: FIXTURE_NOW,
    });
    expect(api.peakInFlight()).toBeLessThanOrEqual(4);
  });
});

describe('loadPaceCurve — under a rate limiter', () => {
  it('retries a rate-limited stream instead of silently dropping the session', async () => {
    const clean = await load();
    const limited = await load(
      { rateLimit: { afterRequests: 2, failures: 6 } },
      { retryBackoffMs: 1 },
    );

    expect(limited.api.rateLimitedCount()).toBe(6);
    expect(limited.curve.coverage.fetched).toBe(clean.curve.coverage.fetched);
    expect(limited.curve.curve.points).toEqual(clean.curve.curve.points);
    // …and it says so, rather than presenting a full read.
    expect(limited.curve.rateLimited).toBe(true);
  });

  it('gives up quickly and reports zero coverage when the limiter is saturated', async () => {
    const started = Date.now();
    const { curve } = await load({ failing: { '/streams': 429 } }, { retryBackoffMs: 1 });
    const elapsed = Date.now() - started;

    expect(curve.coverage.fetched).toBe(0);
    expect(curve.coverage.requested).toBeGreaterThan(0);
    expect(curve.rateLimited).toBe(true);
    for (const point of curve.curve.points) expect(point.timeSeconds).toBeNull();
    expect(elapsed).toBeLessThan(5_000);
  }, 20_000);

  it('leaves every distance as no-data, not zero, when no stream can be read', async () => {
    const { curve } = await load({ failing: { '/streams': 404 } });
    expect(curve.streams).toEqual([]);
    for (const point of curve.curve.points) {
      expect(point.timeSeconds).toBeNull();
      expect(point.speed).toBeNull();
      expect(point.activityId).toBeNull();
      expect(point.date).toBeNull();
    }
  });

  it('still derives the rest of the dashboard when the streams endpoint is down', async () => {
    const { state } = await load({ failing: { '/streams': 500 } });
    expect(state.age).toBe(FIXTURE_AGE);
    expect(state.raceEstimates.length).toBeGreaterThan(0);
  });

  it('reports coverage so a short read is stated rather than implied', async () => {
    const { curve } = await load();
    expect(curve.coverage.eligible).toBeGreaterThan(0);
    expect(curve.coverage.fetched).toBeLessThanOrEqual(curve.coverage.requested);
    expect(curve.coverage.requested).toBeLessThanOrEqual(curve.coverage.eligible);
  });
});

describe('paceCurveNotice — rate limiting is stated, not implied (AC-19, FR-32)', () => {
  const full = { eligible: 40, requested: 40, fetched: 40 };
  const short = { eligible: 40, requested: 40, fetched: 12 };

  it('says a slow fetch is a fetch, not an empty curve (FR-10)', () => {
    const notice = paceCurveNotice({ status: 'loading' });
    expect(notice.kind).toBe('loading');
    expect(notice.retryable).toBe(false);
  });

  it('names rate limiting as the cause and offers a retry', () => {
    const notice = paceCurveNotice({ status: 'ready', rateLimited: true, coverage: short, measuredPoints: 3 });
    expect(notice.kind).toBe('rate-limited');
    expect(notice.message).toContain('rate-limited');
    expect(notice.message).toContain('12 of 40');
    expect(notice.retryable).toBe(true);
  });

  it('distinguishes a rate-limited curve from an empty one', () => {
    const limited = paceCurveNotice({ status: 'ready', rateLimited: true, coverage: short, measuredPoints: 0 });
    const empty = paceCurveNotice({ status: 'ready', coverage: full, measuredPoints: 0 });

    expect(limited.kind).toBe('rate-limited');
    expect(empty.kind).toBe('empty');
    expect(limited.message).not.toBe(empty.message);
    // Only one of them is worth retrying — the other means "go and sprint".
    expect(limited.retryable).toBe(true);
    expect(empty.retryable).toBe(false);
  });

  it('reports an incomplete read even when the limiter was not the cause', () => {
    const notice = paceCurveNotice({ status: 'ready', coverage: short, measuredPoints: 5 });
    expect(notice.kind).toBe('incomplete');
    expect(notice.retryable).toBe(true);
  });

  it('states a failure with its reason, and offers a retry', () => {
    const notice = paceCurveNotice({ status: 'error', errorMessage: 'network down' });
    expect(notice.kind).toBe('error');
    expect(notice.message).toContain('network down');
    expect(notice.retryable).toBe(true);
  });

  it('still states a failure with no reason to give', () => {
    const notice = paceCurveNotice({ status: 'error', errorMessage: '   ' });
    expect(notice.kind).toBe('error');
    expect(notice.message.length).toBeGreaterThan(0);
    expect(notice.retryable).toBe(true);
  });

  it('says nothing when the curve is complete and populated', () => {
    const notice = paceCurveNotice({ status: 'ready', coverage: full, measuredPoints: 5 });
    expect(notice.kind).toBe('none');
    expect(notice.message).toBe('');
  });

  it('does not report a rate limit that cost nothing', () => {
    // Every refused request was retried and served, so coverage is complete —
    // saying "rate-limited" here would be alarming and untrue.
    const notice = paceCurveNotice({ status: 'ready', rateLimited: true, coverage: full, measuredPoints: 5 });
    expect(notice.kind).toBe('none');
  });
});
