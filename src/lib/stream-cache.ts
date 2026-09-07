import {
  CachedActivityStream,
  StreamCacheEntrySchema,
  StreamCacheSchema,
} from '../domain/schema';

/**
 * stream-cache — per-athlete persistence for fetched activity streams.
 *
 * ── Why this is safe ────────────────────────────────────────────────────────
 * A completed activity's `velocity_smooth`, `distance` and `time` series never
 * change. There is no staleness to reason about here, only capacity — which is
 * why entries never expire on age and a hit is never re-fetched. Before this
 * existed, every reload, login and new tab re-paid the full stream cost for
 * data that was already correct: 40 requests, every time, for an answer that
 * could not have moved.
 *
 * ── Why localStorage, and how big ───────────────────────────────────────────
 * `localStorage` is what every other adapter in `src/lib/` uses, it is
 * synchronous (so a cache hit costs nothing on the render path), and it
 * survives a browser restart, which is precisely the case that was paying
 * twice. A 1 Hz stream for a 40-minute run is ~2400 samples across three
 * series and serialises to roughly 48 KB of JSON — the worst case here, since
 * sprint sessions are far shorter.
 *
 * The bound is {@link STREAM_CACHE_MAX_ACTIVITIES} entries per athlete, LRU
 * evicted, chosen to equal the pace curve's own request cap: a cache that
 * holds the cap holds an entire curve, so a repeat visit is a complete hit
 * rather than a partial one. At the 48 KB worst case that is ~1.9 MB against a
 * ~5 MB origin quota, leaving room for the race times and distance selections
 * stored beside it. A write that still does not fit sheds its oldest entries
 * and retries rather than failing.
 *
 * Streams are performance data, not secrets, so they are stored in plain JSON.
 * Nothing here is trusted on read — any script on the origin can write to
 * `localStorage`, so every entry goes back through the domain schema, and a
 * corrupt one is discarded and re-fetched rather than thrown.
 *
 * Lifecycle mirrors `race-results-storage`: written under a key scoped to the
 * athlete id, and removed only by logout.
 */

const STORAGE_PREFIX = 'ss_streams';

/**
 * How many activities are cached per athlete.
 *
 * Equal to `PACE_CURVE_MAX_STREAM_ACTIVITIES`, so one full pace-curve load
 * fits exactly and the visit after it costs no requests at all.
 */
export const STREAM_CACHE_MAX_ACTIVITIES = 40;

/**
 * Storage key for an athlete. The id is encoded so that an id containing a
 * separator cannot collide with, or read, another athlete's entry.
 */
export function streamCacheKey(athleteId: string): string {
  return `${STORAGE_PREFIX}:${encodeURIComponent(athleteId)}`;
}

/** True when a usable localStorage is present (absent in SSR and some privacy modes). */
function hasStorage(): boolean {
  try {
    return typeof localStorage !== 'undefined' && localStorage !== null;
  } catch {
    return false;
  }
}

/**
 * Read the athlete's cached streams, most-recently-used first.
 *
 * A `Map` because iteration order *is* the LRU order: callers pass the same
 * map back to {@link saveStreamCache} with the entries they just used moved to
 * the front. Returns an empty map when nothing is stored, storage is
 * unavailable, or the payload cannot be validated.
 */
export function loadStreamCache(athleteId: string): Map<string, CachedActivityStream> {
  const cache = new Map<string, CachedActivityStream>();
  if (!athleteId || !hasStorage()) return cache;
  try {
    const raw = localStorage.getItem(streamCacheKey(athleteId));
    if (!raw) return cache;
    const parsed = StreamCacheSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) {
      // The envelope itself is unusable — discard it rather than leave a
      // payload behind that will fail again on every load.
      clearStreamCache(athleteId);
      return cache;
    }
    // Entries are validated one at a time so a single corrupt stream costs one
    // re-fetch instead of emptying the cache.
    for (const candidate of parsed.data.entries) {
      const entry = StreamCacheEntrySchema.safeParse(candidate);
      if (entry.success && !cache.has(entry.data.id)) cache.set(entry.data.id, entry.data.stream);
    }
    return cache;
  } catch {
    // Corrupt JSON, a quota error, or storage blocked by the browser.
    return cache;
  }
}

/**
 * Persist the athlete's streams, keeping at most
 * {@link STREAM_CACHE_MAX_ACTIVITIES} of them in the order given.
 *
 * The caller decides the order; everything past the bound is evicted, so
 * passing the just-used activities first is what makes this an LRU.
 *
 * A write that exceeds the storage quota is retried with progressively fewer
 * entries and, failing that, abandoned: a cache is an optimisation, and losing
 * it must never cost the athlete a screen.
 *
 * @returns true when something was written.
 */
export function saveStreamCache(
  athleteId: string,
  streams: Map<string, CachedActivityStream>,
): boolean {
  if (!athleteId || !hasStorage()) return false;

  let entries = [...streams.entries()]
    .slice(0, STREAM_CACHE_MAX_ACTIVITIES)
    .map(([id, stream]) => ({ id, stream }));

  while (entries.length > 0) {
    try {
      localStorage.setItem(
        streamCacheKey(athleteId),
        JSON.stringify({ version: 1, entries }),
      );
      return true;
    } catch {
      // Over quota: shed the least recently used half and try again, so a
      // full disk degrades to a smaller cache rather than to none.
      entries = entries.slice(0, Math.floor(entries.length / 2));
    }
  }
  return false;
}

/** Remove the athlete's cached streams. Called on logout. */
export function clearStreamCache(athleteId: string): void {
  if (!athleteId || !hasStorage()) return;
  try {
    localStorage.removeItem(streamCacheKey(athleteId));
  } catch {
    // Nothing to do — storage is unavailable, so there is nothing stored.
  }
}

/**
 * Remove cached streams for every athlete on this device.
 *
 * Used when logging out without a known athlete id, so that one athlete's
 * training data cannot linger on a shared browser.
 */
export function clearAllStreamCaches(): void {
  if (!hasStorage()) return;
  try {
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith(`${STORAGE_PREFIX}:`)) keys.push(key);
    }
    for (const key of keys) localStorage.removeItem(key);
  } catch {
    // Storage unavailable — nothing persisted, nothing to clear.
  }
}
