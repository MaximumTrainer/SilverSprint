import { INTERVALS_BASE } from '../config/api';

/**
 * intervals-http — the outbound port and the request discipline both
 * Intervals.icu use cases share.
 *
 * Nothing here knows about React or `fetch`; the adapter supplies an
 * {@link HttpGet}. It lives in the application layer because it is about
 * *orchestration* of requests — concurrency, backoff, a give-up rule — not
 * about the transport itself.
 *
 * ── The limiter, as measured ────────────────────────────────────────────────
 * Intervals.icu admits **30 requests per short window irrespective of
 * concurrency** and refuses the entire surplus:
 *
 *   | 30 concurrent, cold                | 30 × 200 in 306 ms      |
 *   | 30 at concurrency 4, cold          | 30 × 200 in 491 ms      |
 *   | 40 concurrent, cold                | 30 × 200, 10 × 429      |
 *   | 46 concurrent, cold                | 30 × 200, 16 × 429      |
 *   | a second 30 straight after a first | 30 × 429 at t = 411 ms  |
 *
 * So it is cumulative **volume** in the window that matters, not how many are
 * in flight — bounding concurrency alone does not make a sync safe, and a
 * refusal comes back wholesale rather than as a trickle. A `429` carries
 * `Retry-After: 1` and an empty body; a `200` carries no quota header at all,
 * so the budget has to be self-imposed and the reactive signal is all there is.
 */

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

export const NOOP_LOGGER: SyncLogger = { info: () => {}, warn: () => {}, error: () => {} };

/**
 * Per-activity requests in flight at once.
 *
 * Concurrency is not what the limiter counts (see above), but an unbounded
 * fan-out still lands the whole window's worth of requests in one instant,
 * which is exactly how a burst crosses 30. Four is enough to be quick.
 */
export const REQUEST_CONCURRENCY = 4;

/**
 * Attempts per per-activity request before giving up on it.
 *
 * Two is enough: on a live account 8 of 80 requests drew a 429 and every one
 * of them succeeded on the first retry. A longer schedule only lengthens the
 * sync in the case where the limiter is saturated and retrying is futile.
 */
const RATE_LIMIT_RETRIES = 2;

/** First backoff step after a 429, in ms; doubled on each further attempt. */
export const RATE_LIMIT_BACKOFF_MS = 1000;

/**
 * Requests that may exhaust their retries before the sync stops retrying at all.
 *
 * Backing off is right for a limiter that is nearly satisfied and wrong for one
 * that is saturated: retrying every one of 40 activities through a full backoff
 * schedule turns a 4-second sync into a multi-minute one and still returns
 * nothing. Past this many exhausted requests the caller accepts reduced
 * coverage, reports it, and finishes.
 */
const RATE_LIMIT_GIVE_UP_AFTER = 2;

/** Shared across one load, so the whole run backs off — or gives up — together. */
export interface RateLimitBudget {
  exhausted: number;
  retriesDisabled: boolean;
  /** First backoff step, in ms. */
  backoffMs: number;
  /** True once any request has been refused, even if a retry later succeeded. */
  refused: boolean;
}

export function newRateLimitBudget(backoffMs = RATE_LIMIT_BACKOFF_MS): RateLimitBudget {
  return { exhausted: 0, retriesDisabled: false, backoffMs, refused: false };
}

/** The three sample series the pace curve and the sprint parser read. */
export interface ActivityStreams {
  /** Velocity in m/s. `null` marks a GPS dropout and is preserved. */
  velocitySmooth: Array<number | null>;
  /** Cumulative metres, when the device recorded one. */
  distance?: Array<number | null>;
  /** Elapsed seconds per sample, when the device recorded one. */
  time?: Array<number | null>;
}

/**
 * Wrap an {@link HttpGet} so every request through it is counted.
 *
 * The request budget is the whole point of this module, and a budget that is
 * not measured is a wish. The counter is carried out to `DashboardState` so a
 * regression fails a test rather than being discovered at the rate limiter.
 */
export function countingHttpGet(httpGet: HttpGet): { httpGet: HttpGet; count: () => number } {
  let count = 0;
  return {
    httpGet: (url) => {
      count++;
      return httpGet(url);
    },
    count: () => count,
  };
}

/**
 * GET a URL, waiting out Intervals.icu's rate limiter rather than treating a
 * `429` as a permanent failure.
 *
 * This matters more than it looks. A refused per-activity request does not
 * surface as an error — it silently removes one session from the analysis, and
 * on a live account that turned a 400 m best of 61 s into 117 s because the
 * race was among the requests that were refused. Backing off and retrying is
 * the difference between a slower sync and a wrong number.
 *
 * `Retry-After` is honoured when present, since the server knows better than
 * the doubling schedule does.
 */
export async function httpGetWithBackoff(
  httpGet: HttpGet,
  url: string,
  athleteId: string,
  logger: SyncLogger,
  budget: RateLimitBudget,
): Promise<HttpResponse> {
  let response = await httpGet(url);
  if (response.status !== 429) return response;

  budget.refused = true;
  if (budget.retriesDisabled) return response;

  for (let attempt = 1; attempt <= RATE_LIMIT_RETRIES && response.status === 429; attempt++) {
    const retryAfter = Number(
      (response as { headers?: { get(name: string): string | null } }).headers?.get?.('retry-after'),
    );
    const waitMs = Number.isFinite(retryAfter) && retryAfter > 0
      ? retryAfter * 1000
      : budget.backoffMs * 2 ** (attempt - 1);
    logger.warn(`Rate limited — retrying in ${waitMs}ms (attempt ${attempt}/${RATE_LIMIT_RETRIES})`, athleteId);
    await new Promise((resolve) => setTimeout(resolve, waitMs));
    response = await httpGet(url);
  }

  if (response.status === 429) {
    budget.exhausted++;
    if (budget.exhausted >= RATE_LIMIT_GIVE_UP_AFTER && !budget.retriesDisabled) {
      budget.retriesDisabled = true;
      logger.warn(
        'Rate limiter is saturated — finishing with reduced coverage rather than waiting it out',
        athleteId,
      );
    }
  }
  return response;
}

/**
 * The outcome of asking Intervals.icu for one activity's streams.
 *
 * `none` and `failed` are deliberately not the same thing, because only one of
 * them is worth remembering. A completed activity that answered 200 with no
 * velocity series will answer that way forever — the streams are immutable, so
 * the negative is as cacheable as a positive, and caching it is what stops a
 * treadmill session costing a request on every single visit. A refusal or a
 * network error taught us nothing and must be retried.
 */
export type StreamFetchResult =
  | { status: 'ok'; stream: ActivityStreams }
  | { status: 'none' }
  | { status: 'failed' };

/**
 * Fetch one activity's streams.
 *
 * `?types=` keeps the payload to the three series that are actually read —
 * the unfiltered response also carries heart rate, cadence, altitude and
 * position, which is several times the data for no use here.
 *
 * Never throws: a missing stream costs one activity's contribution to the
 * curve, not the whole load.
 */
export async function fetchActivityStreams(
  httpGet: HttpGet,
  activityId: string,
  athleteId: string,
  logger: SyncLogger,
  budget: RateLimitBudget,
): Promise<StreamFetchResult> {
  try {
    const res = await httpGetWithBackoff(
      httpGet,
      `${INTERVALS_BASE}/api/v1/activity/${activityId}/streams?types=time,distance,velocity_smooth`,
      athleteId,
      logger,
      budget,
    );
    if (!res.ok) {
      logger.warn(
        `Failed to fetch streams for activity ${activityId}: ${res.status} ${res.statusText}`,
        athleteId
      );
      return { status: 'failed' };
    }
    const body = await res.json();
    const velocitySmooth = toNullableNumbers(extractStream(body, 'velocity_smooth'));
    if (velocitySmooth.length === 0) return { status: 'none' };

    const distance = toNullableNumbers(extractStream(body, 'distance'));
    const time = toNullableNumbers(extractStream(body, 'time'));
    return {
      status: 'ok',
      stream: {
        velocitySmooth,
        distance: distance.length === velocitySmooth.length ? distance : undefined,
        time: time.length === velocitySmooth.length ? time : undefined,
      },
    };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    logger.warn(`Failed to fetch or parse streams for activity ${activityId}: ${reason}`, athleteId);
    return { status: 'failed' };
  }
}

/**
 * Run `worker` over `items`, at most `limit` at a time.
 *
 * Kept explicit rather than reaching for `Promise.all`: an unbounded
 * `Promise.allSettled` over every activity is exactly the burst that put 22
 * `/intervals` requests in flight at once on a live account.
 */
export async function forEachWithConcurrency<T>(
  items: readonly T[],
  limit: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  let next = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      await worker(items[index]);
    }
  });
  await Promise.all(runners);
}

/** Coerce raw stream samples to numbers, keeping dropouts as explicit nulls. */
export function toNullableNumbers(raw: unknown[]): Array<number | null> {
  return raw.map((value) => (typeof value === 'number' && Number.isFinite(value) ? value : null));
}

/**
 * Pull one named series out of an Intervals.icu `/streams` response.
 *
 * The live API answers with a bare **array** of `{ type, data }` stream objects
 * — not a map keyed by stream name. The keyed shapes are still accepted so that
 * proxies and older responses keep working.
 */
export function extractStream(streams: unknown, type: string): unknown[] {
  if (Array.isArray(streams)) {
    const entry = streams.find(
      (s): s is { type?: unknown; data?: unknown } =>
        typeof s === 'object' && s !== null && (s as { type?: unknown }).type === type
    );
    return Array.isArray(entry?.data) ? entry.data : [];
  }
  const keyed = (streams as Record<string, unknown>)?.[type];
  if (Array.isArray(keyed)) return keyed;
  const keyedData = (keyed as { data?: unknown })?.data;
  return Array.isArray(keyedData) ? keyedData : [];
}
