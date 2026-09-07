import {
  DEFAULT_PACE_CURVE_DISTANCES,
  DEFAULT_PACE_CURVE_RANGE,
  PaceCurve,
  PaceCurveActivityStream,
  PaceCurveRange,
  computePaceCurve,
  paceCurveWindowStart,
} from '../domain/sprint/pace-curve';
import type { IntervalsActivity } from '../domain/schema';
import type { PaceCurveCoverage } from './dashboard-sync';
import {
  ActivityStreams,
  HttpGet,
  NOOP_LOGGER,
  RATE_LIMIT_BACKOFF_MS,
  REQUEST_CONCURRENCY,
  SyncLogger,
  countingHttpGet,
  fetchActivityStreams,
  forEachWithConcurrency,
  newRateLimitBudget,
} from './intervals-http';

/**
 * pace-curve-sync — the deferred half of the dashboard sync.
 *
 * The pace curve is the densest analysis in the app and the most expensive to
 * feed: one `/streams` request per session, up to the cap. It used to be paid
 * for on every dashboard load whether or not the athlete ever scrolled to it —
 * 54 requests on a live account, 8 of them refused. Moving the curve to its own
 * screen is what makes it possible to *not* pay: this use case runs when that
 * screen is opened, and only then.
 *
 * It depends on the `HttpGet` port and an optional cache port, never on
 * `fetch`, `localStorage` or React.
 */

/**
 * Persistent stream storage.
 *
 * A port rather than a direct `localStorage` call so the use case stays
 * testable and the browser adapter stays swappable. Omitting it disables
 * caching entirely, which is what a test or a server-side render wants.
 */
export interface StreamCachePort {
  /** Cached streams for this athlete, most-recently-used first. */
  load(athleteId: string): Map<string, ActivityStreams>;
  /** Persist, keeping the given order as the LRU order. */
  save(athleteId: string, streams: Map<string, ActivityStreams>): boolean;
}

export interface PaceCurveSyncDeps {
  athleteId: string;
  httpGet: HttpGet;
  /**
   * The candidate sessions, already ranked and capped by the dashboard sync.
   *
   * Passing them in rather than re-deriving them keeps the cap in one place:
   * the number of activities here *is* the request bound.
   */
  activities: readonly IntervalsActivity[];
  /** The athlete's 60-day peak velocity, for the account-specific outlier bound. */
  bestVmax60d: number;
  /**
   * Dated runs in the curve's window **before** the cap, from
   * `DashboardState.paceCurveEligible`.
   *
   * Reported as-is so the screen can say "the 40 fastest of 118 were
   * analysed". Defaults to the candidate count, which is right only for an
   * athlete whose history fits inside the cap.
   */
  eligibleCount?: number;
  /** Reference "now" for the range window. Defaults to the current time. */
  now?: Date;
  logger?: SyncLogger;
  /** Distances for the first render, in metres. */
  distances?: number[];
  /** Date range for the first render. */
  range?: PaceCurveRange;
  /** First backoff step after a `429`, in ms. Exposed so tests need not sleep. */
  retryBackoffMs?: number;
  cache?: StreamCachePort;
}

export interface PaceCurveSyncResult {
  /**
   * Every stream the curve was built from.
   *
   * Held so that changing distances or the date range is pure local
   * arithmetic — the screen re-runs `computePaceCurve` over these and issues
   * no Intervals.icu request at all.
   */
  streams: PaceCurveActivityStream[];
  /** The curve for the requested distance set and range, ready for first render. */
  curve: PaceCurve;
  /**
   * How much of the athlete's history the curve actually saw.
   *
   * A curve built from a fraction of the eligible sessions is not a
   * mean-maximal curve, it is a lower bound — and it fails in the most
   * misleading direction, quietly promoting a warm-up jog to "your best
   * 400 m". Coverage is carried out to the UI so a short read is stated
   * rather than implied.
   */
  coverage: PaceCurveCoverage;
  /** Intervals.icu requests this load issued. Zero on a full cache hit. */
  requestCount: number;
  /** Activities served from the persistent cache rather than the network. */
  cacheHits: number;
  /**
   * True when Intervals.icu refused at least one request.
   *
   * Distinguishes "we were throttled, some sessions are missing, try again"
   * from "you have not sprinted in this window" — two states that look
   * identical on a chart and mean opposite things.
   */
  rateLimited: boolean;
}

/**
 * Fetch the streams the pace curve needs and compute the first curve.
 *
 * Cache first, network second. A completed activity's stream never changes, so
 * a hit is authoritative and is never re-fetched; on a repeat visit this
 * issues zero requests.
 */
export async function loadPaceCurve(deps: PaceCurveSyncDeps): Promise<PaceCurveSyncResult> {
  const { athleteId, activities } = deps;
  const logger = deps.logger ?? NOOP_LOGGER;
  const now = deps.now ?? new Date();
  const { httpGet, count: requestCount } = countingHttpGet(deps.httpGet);
  const budget = newRateLimitBudget(deps.retryBackoffMs ?? RATE_LIMIT_BACKOFF_MS);

  const cached = deps.cache?.load(athleteId) ?? new Map<string, ActivityStreams>();

  // `stream_types` is read as a *positive* signal only: an array that is
  // present and does not list `velocity_smooth` proves the activity has no
  // velocity trace, so the request would be wasted. Null, absent (which is
  // what `fields=` turns null into) or empty all mean **unknown** — 5 of 118
  // live runs are in that state and do have streams.
  const requestable = activities.filter((a) => !provablyHasNoVelocityStream(a));
  const skipped = activities.length - requestable.length;
  if (skipped > 0) {
    logger.info(`Skipping ${skipped} activity(ies) with no velocity_smooth in stream_types`, athleteId);
  }

  const streamsById = new Map<string, ActivityStreams>();
  const misses: IntervalsActivity[] = [];
  for (const activity of requestable) {
    const hit = cached.get(activity.id);
    if (hit) streamsById.set(activity.id, hit);
    else misses.push(activity);
  }

  logger.info(
    `Pace curve — ${streamsById.size} stream(s) from cache, fetching ${misses.length}`,
    athleteId,
  );

  await forEachWithConcurrency(misses, REQUEST_CONCURRENCY, async (activity) => {
    const fetched = await fetchActivityStreams(httpGet, activity.id, athleteId, logger, budget);
    // A `none` is recorded as an empty series rather than dropped. The
    // activity answered 200 and has no velocity trace, and streams are
    // immutable — so remembering that is what stops a treadmill session
    // costing a request on every visit. A `failed` is not recorded: nothing
    // was learned, and it must be retried.
    if (fetched.status === 'ok') streamsById.set(activity.id, fetched.stream);
    else if (fetched.status === 'none') streamsById.set(activity.id, { velocitySmooth: [] });
  });

  // Write back with everything used on this load at the front, so the LRU
  // eviction keeps the sessions the curve is actually built from.
  if (deps.cache && streamsById.size > 0) {
    const ordered = new Map<string, ActivityStreams>();
    for (const activity of requestable) {
      const stream = streamsById.get(activity.id);
      if (stream) ordered.set(activity.id, stream);
    }
    for (const [id, stream] of cached) if (!ordered.has(id)) ordered.set(id, stream);
    deps.cache.save(athleteId, ordered);
  }

  const streams: PaceCurveActivityStream[] = requestable
    .map((a): PaceCurveActivityStream | null => {
      const stream = streamsById.get(a.id);
      const date = activityDate(a);
      if (!stream || date === null || stream.velocitySmooth.length === 0) return null;
      return {
        activityId: a.id,
        name: a.name || `${a.type} on ${date}`,
        date,
        velocitySmooth: stream.velocitySmooth,
        distance: stream.distance,
        time: stream.time,
      };
    })
    .filter((s): s is PaceCurveActivityStream => s !== null);

  const coverage: PaceCurveCoverage = {
    eligible: deps.eligibleCount ?? activities.length,
    requested: requestable.length,
    fetched: streams.length,
  };

  const curve = computePaceCurve({
    streams,
    distances: deps.distances ?? [...DEFAULT_PACE_CURVE_DISTANCES],
    since: paceCurveWindowStart(deps.range ?? DEFAULT_PACE_CURVE_RANGE, now),
    bestVmax60d: deps.bestVmax60d,
  });

  logger.info(
    `Pace curve — ${coverage.fetched}/${coverage.requested} stream(s), `
    + `${curve.excludedEfforts} implausible effort(s) and ${curve.excludedActivities} activity(ies) excluded, `
    + `${requestCount()} request(s)`,
    athleteId,
  );
  if (coverage.fetched < coverage.requested) {
    logger.warn(
      `Pace curve is incomplete — ${coverage.requested - coverage.fetched} stream(s) could not be fetched, `
      + 'so a distance whose real best was in one of them will read slower than it should',
      athleteId,
    );
  }

  return {
    streams,
    curve,
    coverage,
    requestCount: requestCount(),
    cacheHits: requestable.length - misses.length,
    rateLimited: budget.refused,
  };
}

/**
 * True when Intervals.icu has told us this activity has no velocity trace.
 *
 * Only a **non-empty array that omits `velocity_smooth`** counts as proof.
 * Anything else — `null`, an absent key, an empty array — is unknown, and
 * unknown means fetch. Treating unknown as "no streams" would have lost 5 of
 * 118 live runs for a saving of zero requests.
 */
function provablyHasNoVelocityStream(activity: IntervalsActivity): boolean {
  const types = activity.stream_types;
  return Array.isArray(types) && types.length > 0 && !types.includes('velocity_smooth');
}

/** The `YYYY-MM-DD` an activity happened on, or null when it carries no date. */
function activityDate(a: IntervalsActivity): string | null {
  const raw = a.start_date_local;
  if (typeof raw !== 'string' || raw.length < 10) return null;
  return raw.slice(0, 10);
}

/* ── what the screen says about a load ──────────────────────────────────── */

export type PaceCurveNoticeKind =
  /** Streams are on their way. Distinct from "empty" so a slow fetch is not read as "no data". */
  | 'loading'
  /** The fetch failed outright. */
  | 'error'
  /** Intervals.icu refused requests; what is charted is a lower bound. */
  | 'rate-limited'
  /** Some streams could not be read for another reason. */
  | 'incomplete'
  /** Everything was read, and the athlete simply has no qualifying effort. */
  | 'empty'
  /** Nothing to say. */
  | 'none';

export interface PaceCurveNotice {
  kind: PaceCurveNoticeKind;
  message: string;
  /** True when offering a retry is honest — the data might be there next time. */
  retryable: boolean;
}

export interface PaceCurveNoticeInput {
  status: 'loading' | 'ready' | 'error';
  /** The failure text, when `status` is `error`. */
  errorMessage?: string | null;
  rateLimited?: boolean;
  coverage?: PaceCurveCoverage;
  /** Points on the current curve that carry a time. */
  measuredPoints?: number;
}

/**
 * What the pace curve screen should tell the athlete about this load.
 *
 * Kept here, as a pure function over the sync result, because the distinction
 * it draws is a correctness one rather than a cosmetic one: an empty chart
 * because Intervals.icu refused the requests and an empty chart because the
 * athlete has not sprinted look identical, and mean opposite things. One
 * warrants a retry; the other warrants a session on the track.
 */
export function paceCurveNotice(input: PaceCurveNoticeInput): PaceCurveNotice {
  if (input.status === 'loading') {
    return {
      kind: 'loading',
      message: 'Reading your velocity traces from Intervals.icu…',
      retryable: false,
    };
  }

  if (input.status === 'error') {
    return {
      kind: 'error',
      message: input.errorMessage?.trim()
        ? `Could not load your streams: ${input.errorMessage.trim()}`
        : 'Could not load your streams from Intervals.icu.',
      retryable: true,
    };
  }

  const coverage = input.coverage;
  const missing = coverage ? Math.max(0, coverage.requested - coverage.fetched) : 0;

  if (coverage && missing > 0) {
    const read = `${coverage.fetched} of ${coverage.requested} sessions`;
    const consequence =
      'A distance whose real best is in a missing session will read slower than it should.';

    if (input.rateLimited) {
      return {
        kind: 'rate-limited',
        message: `Intervals.icu rate-limited this load — ${read} were read. ${consequence} Try again in a moment.`,
        retryable: true,
      };
    }
    return {
      kind: 'incomplete',
      message: `${read} could be read. ${consequence}`,
      retryable: true,
    };
  }

  if ((input.measuredPoints ?? 0) === 0) {
    return {
      kind: 'empty',
      message:
        'No sprint efforts found in this window. The curve is built from GPS velocity traces — '
        + 'sessions recorded without one, or shorter than the smallest selected distance, cannot appear.',
      retryable: false,
    };
  }

  return { kind: 'none', message: '', retryable: false };
}
