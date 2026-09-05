import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  loadRaceResults,
  saveRaceResults,
  clearRaceResults,
  clearAllRaceResults,
  raceResultsKey,
  newRaceResultId,
} from '../../src/lib/race-results-storage';
import type { RaceResult } from '../../src/domain/sprint/race-results';

/**
 * Persistence tests for known race times.
 *
 * Lifecycle contract: results live as long as the login does, and are removed
 * only by logout. localStorage content is untrusted on read.
 */

/** Minimal in-memory localStorage, since the test environment is node. */
function installStorage(): Storage {
  const map = new Map<string, string>();
  const storage: Storage = {
    get length() { return map.size; },
    key: (i: number) => [...map.keys()][i] ?? null,
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => { map.set(k, String(v)); },
    removeItem: (k: string) => { map.delete(k); },
    clear: () => { map.clear(); },
  };
  vi.stubGlobal('localStorage', storage);
  return storage;
}

const ATHLETE = 'i90210';

function result(overrides: Partial<RaceResult> = {}): RaceResult {
  return { id: 'r1', distance: 100, timeSeconds: 14.2, date: '2026-08-01', ...overrides };
}

describe('race-results-storage', () => {
  beforeEach(() => {
    installStorage();
  });

  it('round-trips results for an athlete', () => {
    const results = [result({ id: 'a' }), result({ id: 'b', distance: 200, timeSeconds: 29.4 })];
    expect(saveRaceResults(ATHLETE, results)).toBe(true);
    expect(loadRaceResults(ATHLETE)).toEqual(results);
  });

  it('returns an empty list when nothing is stored', () => {
    expect(loadRaceResults(ATHLETE)).toEqual([]);
  });

  it('keeps each athlete\'s results separate', () => {
    saveRaceResults('athlete-a', [result({ id: 'a' })]);
    saveRaceResults('athlete-b', [result({ id: 'b', distance: 400, timeSeconds: 70 })]);

    expect(loadRaceResults('athlete-a').map((r) => r.id)).toEqual(['a']);
    expect(loadRaceResults('athlete-b').map((r) => r.id)).toEqual(['b']);
  });

  it('encodes the athlete id so one athlete cannot read another\'s key', () => {
    // An id containing the separator must not resolve to another athlete's slot.
    expect(raceResultsKey('a:b')).not.toBe(raceResultsKey('a') + ':b');
    saveRaceResults('a:b', [result({ id: 'x' })]);
    expect(loadRaceResults('a')).toEqual([]);
  });

  it('discards corrupt JSON rather than throwing', () => {
    localStorage.setItem(raceResultsKey(ATHLETE), '{not json');
    expect(loadRaceResults(ATHLETE)).toEqual([]);
  });

  it('discards entries that fail domain validation on read', () => {
    // localStorage is writable by any script on the origin, so a stored value
    // is untrusted input even though this app wrote the key.
    localStorage.setItem(
      raceResultsKey(ATHLETE),
      JSON.stringify([result({ id: 'good' }), { id: 'bad', distance: 100, timeSeconds: 9999, date: '2026-08-01' }]),
    );
    expect(loadRaceResults(ATHLETE).map((r) => r.id)).toEqual(['good']);
  });

  it('does not persist an invalid result', () => {
    saveRaceResults(ATHLETE, [result({ id: 'ok' }), { ...result({ id: 'bad' }), timeSeconds: -5 }]);
    expect(loadRaceResults(ATHLETE).map((r) => r.id)).toEqual(['ok']);
  });

  it('clears results for one athlete on logout', () => {
    saveRaceResults(ATHLETE, [result()]);
    saveRaceResults('other', [result({ id: 'z' })]);

    clearRaceResults(ATHLETE);

    expect(loadRaceResults(ATHLETE)).toEqual([]);
    expect(loadRaceResults('other')).toHaveLength(1);
  });

  it('clears every athlete\'s results when no id is known', () => {
    saveRaceResults('a', [result({ id: 'a' })]);
    saveRaceResults('b', [result({ id: 'b' })]);
    localStorage.setItem('ss_fascia_current_week', '3');

    clearAllRaceResults();

    expect(loadRaceResults('a')).toEqual([]);
    expect(loadRaceResults('b')).toEqual([]);
    // Unrelated app state is left alone.
    expect(localStorage.getItem('ss_fascia_current_week')).toBe('3');
  });

  it('survives a reload — the data outlives the page, not just the tab', () => {
    saveRaceResults(ATHLETE, [result()]);
    // A reload keeps localStorage but resets module state; loading again is
    // the only thing a fresh page does.
    expect(loadRaceResults(ATHLETE)).toHaveLength(1);
  });

  it('is a no-op without an athlete id', () => {
    expect(saveRaceResults('', [result()])).toBe(false);
    expect(loadRaceResults('')).toEqual([]);
    expect(() => clearRaceResults('')).not.toThrow();
  });

  it('degrades gracefully when storage is unavailable', () => {
    vi.stubGlobal('localStorage', {
      get length(): number { throw new Error('blocked'); },
      key: () => { throw new Error('blocked'); },
      getItem: () => { throw new Error('blocked'); },
      setItem: () => { throw new Error('blocked'); },
      removeItem: () => { throw new Error('blocked'); },
      clear: () => { throw new Error('blocked'); },
    } as unknown as Storage);

    expect(loadRaceResults(ATHLETE)).toEqual([]);
    expect(saveRaceResults(ATHLETE, [result()])).toBe(false);
    expect(() => clearRaceResults(ATHLETE)).not.toThrow();
    expect(() => clearAllRaceResults()).not.toThrow();
  });

  it('generates unique ids', () => {
    const ids = new Set(Array.from({ length: 200 }, () => newRaceResultId()));
    expect(ids.size).toBe(200);
  });
});
