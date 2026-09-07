import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  STREAM_CACHE_MAX_ACTIVITIES,
  clearAllStreamCaches,
  clearStreamCache,
  loadStreamCache,
  saveStreamCache,
  streamCacheKey,
} from '../../src/lib/stream-cache';
import type { CachedActivityStream } from '../../src/domain/schema';

/**
 * Persistence tests for fetched activity streams.
 *
 * The contract this cache trades on is that a completed activity's stream is
 * immutable: a hit is never re-fetched and entries never expire on age. What
 * remains is capacity (an LRU bound), trust (nothing read back is believed),
 * and lifecycle (cleared on logout, never shared between athletes).
 */

/** Minimal in-memory localStorage, since the test environment is node. */
function installStorage(): Map<string, string> {
  const map = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    get length() { return map.size; },
    key: (i: number) => [...map.keys()][i] ?? null,
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => { map.set(k, String(v)); },
    removeItem: (k: string) => { map.delete(k); },
    clear: () => { map.clear(); },
  } as Storage);
  return map;
}

const ATHLETE = 'i90210';

function stream(seed = 1): CachedActivityStream {
  return {
    velocitySmooth: [0, 1.5 * seed, null, 7.62, 8.11],
    distance: [0, 1.5 * seed, null, 9.1, 17.2],
    time: [0, 1, 2, 3, 4],
  };
}

/** `count` entries named a0, a1, … in the order given. */
function cacheOf(count: number): Map<string, CachedActivityStream> {
  const map = new Map<string, CachedActivityStream>();
  for (let i = 0; i < count; i++) map.set(`a${i}`, stream(i + 1));
  return map;
}

describe('stream-cache — round trip', () => {
  beforeEach(() => { installStorage(); });

  it('round-trips a stream, dropouts and all', () => {
    const streams = new Map([['act_1', stream()]]);
    expect(saveStreamCache(ATHLETE, streams)).toBe(true);

    const loaded = loadStreamCache(ATHLETE);
    expect(loaded.get('act_1')).toEqual(stream());
    // A null is a GPS dropout, not a zero: integrating across it would invent
    // distance, so it has to survive serialisation as a null.
    expect(loaded.get('act_1')!.velocitySmooth[2]).toBeNull();
  });

  it('returns an empty cache when nothing is stored', () => {
    expect(loadStreamCache(ATHLETE).size).toBe(0);
  });

  it('preserves the order it was given, so the caller owns the LRU', () => {
    saveStreamCache(ATHLETE, cacheOf(3));
    expect([...loadStreamCache(ATHLETE).keys()]).toEqual(['a0', 'a1', 'a2']);
  });

  it('keeps a stream that has no distance or time series', () => {
    saveStreamCache(ATHLETE, new Map([['act_1', { velocitySmooth: [1, 2, 3] }]]));
    expect(loadStreamCache(ATHLETE).get('act_1')).toEqual({ velocitySmooth: [1, 2, 3] });
  });

  it('keeps each athlete\'s streams separate (AC-15)', () => {
    saveStreamCache('athlete-a', new Map([['a', stream(1)]]));
    saveStreamCache('athlete-b', new Map([['b', stream(2)]]));

    expect([...loadStreamCache('athlete-a').keys()]).toEqual(['a']);
    expect([...loadStreamCache('athlete-b').keys()]).toEqual(['b']);
  });

  it('encodes the athlete id so one athlete cannot read another\'s key', () => {
    expect(streamCacheKey('a:b')).not.toBe(`${streamCacheKey('a')}:b`);
    saveStreamCache('a:b', new Map([['x', stream()]]));
    expect(loadStreamCache('a').size).toBe(0);
  });

  it('refuses to store against an empty athlete id', () => {
    expect(saveStreamCache('', new Map([['x', stream()]]))).toBe(false);
    expect(loadStreamCache('').size).toBe(0);
  });
});

describe('stream-cache — the bound and its eviction (AC-14)', () => {
  beforeEach(() => { installStorage(); });

  it('is bounded to the documented number of activities per athlete', () => {
    saveStreamCache(ATHLETE, cacheOf(STREAM_CACHE_MAX_ACTIVITIES + 5));
    expect(loadStreamCache(ATHLETE).size).toBe(STREAM_CACHE_MAX_ACTIVITIES);
  });

  it('evicts the five least recently used, keeping the front of the list', () => {
    const overflowing = cacheOf(STREAM_CACHE_MAX_ACTIVITIES + 5);
    saveStreamCache(ATHLETE, overflowing);

    const kept = loadStreamCache(ATHLETE);
    const expected = [...overflowing.keys()].slice(0, STREAM_CACHE_MAX_ACTIVITIES);
    expect([...kept.keys()]).toEqual(expected);
    for (let i = STREAM_CACHE_MAX_ACTIVITIES; i < STREAM_CACHE_MAX_ACTIVITIES + 5; i++) {
      expect(kept.has(`a${i}`)).toBe(false);
    }
  });

  it('promotes a re-used activity so it survives the next eviction', () => {
    // What a second pace-curve load does: the activities it used go to the
    // front, everything else keeps its order behind them.
    saveStreamCache(ATHLETE, cacheOf(STREAM_CACHE_MAX_ACTIVITIES));
    const stale = `a${STREAM_CACHE_MAX_ACTIVITIES - 1}`;

    const reordered = new Map<string, CachedActivityStream>([[stale, stream(99)]]);
    for (const [id, s] of loadStreamCache(ATHLETE)) if (id !== stale) reordered.set(id, s);
    reordered.set('a_new', stream(7));
    saveStreamCache(ATHLETE, reordered);

    const kept = loadStreamCache(ATHLETE);
    expect(kept.has(stale)).toBe(true);
    expect(kept.size).toBe(STREAM_CACHE_MAX_ACTIVITIES);
  });
});

describe('stream-cache — untrusted storage (AC-13)', () => {
  beforeEach(() => { installStorage(); });

  it('discards a corrupt payload and re-reads as empty rather than throwing', () => {
    localStorage.setItem(streamCacheKey(ATHLETE), '{"streams":"banana"}');
    expect(() => loadStreamCache(ATHLETE)).not.toThrow();
    expect(loadStreamCache(ATHLETE).size).toBe(0);
    // …and the unusable payload is not left behind to fail again every load.
    expect(localStorage.getItem(streamCacheKey(ATHLETE))).toBeNull();
  });

  it('discards unparseable JSON', () => {
    localStorage.setItem(streamCacheKey(ATHLETE), 'not json at all');
    expect(loadStreamCache(ATHLETE).size).toBe(0);
  });

  it('drops only the corrupt entry, so one bad stream costs one re-fetch', () => {
    localStorage.setItem(streamCacheKey(ATHLETE), JSON.stringify({
      version: 1,
      entries: [
        { id: 'good', stream: stream() },
        { id: 'bad', stream: { velocitySmooth: 'banana' } },
        { id: 'also_good', stream: stream(2) },
      ],
    }));

    const loaded = loadStreamCache(ATHLETE);
    expect([...loaded.keys()]).toEqual(['good', 'also_good']);
  });

  it('keeps an entry whose velocity series is empty — that is a cached negative', () => {
    // Intervals.icu answered for this activity and it has no velocity trace.
    // Streams are immutable, so that answer will not change: remembering it is
    // what stops a treadmill session costing a request on every visit.
    localStorage.setItem(streamCacheKey(ATHLETE), JSON.stringify({
      version: 1,
      entries: [{ id: 'no_gps', stream: { velocitySmooth: [] } }],
    }));
    const loaded = loadStreamCache(ATHLETE);
    expect(loaded.get('no_gps')).toEqual({ velocitySmooth: [] });
  });

  it('rejects a record written by a future version of the app', () => {
    localStorage.setItem(streamCacheKey(ATHLETE), JSON.stringify({ version: 2, entries: [] }));
    expect(loadStreamCache(ATHLETE).size).toBe(0);
  });

  it('rejects a non-finite sample smuggled in as a string', () => {
    localStorage.setItem(streamCacheKey(ATHLETE), JSON.stringify({
      version: 1,
      entries: [{ id: 'x', stream: { velocitySmooth: [1, '2', 3] } }],
    }));
    expect(loadStreamCache(ATHLETE).size).toBe(0);
  });
});

describe('stream-cache — lifecycle (AC-15)', () => {
  beforeEach(() => { installStorage(); });

  it('clears one athlete\'s cache and leaves another\'s untouched', () => {
    saveStreamCache('athlete-a', new Map([['a', stream()]]));
    saveStreamCache('athlete-b', new Map([['b', stream()]]));

    clearStreamCache('athlete-a');

    expect(loadStreamCache('athlete-a').size).toBe(0);
    expect(loadStreamCache('athlete-b').size).toBe(1);
  });

  it('clears every athlete when logging out without an id', () => {
    saveStreamCache('athlete-a', new Map([['a', stream()]]));
    saveStreamCache('athlete-b', new Map([['b', stream()]]));
    localStorage.setItem('ss_race_results:athlete-a', '[]');

    clearAllStreamCaches();

    expect(loadStreamCache('athlete-a').size).toBe(0);
    expect(loadStreamCache('athlete-b').size).toBe(0);
    // Only this cache's keys — race times have their own lifecycle.
    expect(localStorage.getItem('ss_race_results:athlete-a')).toBe('[]');
  });
});

describe('stream-cache — storage that will not cooperate', () => {
  it('degrades silently when localStorage is absent', () => {
    vi.stubGlobal('localStorage', undefined);
    expect(saveStreamCache(ATHLETE, new Map([['a', stream()]]))).toBe(false);
    expect(loadStreamCache(ATHLETE).size).toBe(0);
    expect(() => clearStreamCache(ATHLETE)).not.toThrow();
    expect(() => clearAllStreamCaches()).not.toThrow();
  });

  it('sheds entries and retries when the quota is exceeded', () => {
    const map = new Map<string, string>();
    let allowedEntries = 4;
    vi.stubGlobal('localStorage', {
      get length() { return map.size; },
      key: (i: number) => [...map.keys()][i] ?? null,
      getItem: (k: string) => map.get(k) ?? null,
      setItem: (k: string, v: string) => {
        const parsed = JSON.parse(v) as { entries: unknown[] };
        if (parsed.entries.length > allowedEntries) throw new Error('QuotaExceededError');
        map.set(k, v);
      },
      removeItem: (k: string) => { map.delete(k); },
      clear: () => { map.clear(); },
    } as unknown as Storage);

    expect(saveStreamCache(ATHLETE, cacheOf(20))).toBe(true);
    const kept = loadStreamCache(ATHLETE);
    expect(kept.size).toBeGreaterThan(0);
    expect(kept.size).toBeLessThanOrEqual(allowedEntries);
    // Whatever survived is the most recently used end of the list.
    expect([...kept.keys()][0]).toBe('a0');

    allowedEntries = 0;
    expect(saveStreamCache(ATHLETE, cacheOf(20))).toBe(false);
  });
});
