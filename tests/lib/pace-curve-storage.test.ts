import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  loadPaceCurveDistances,
  savePaceCurveDistances,
  clearPaceCurveDistances,
  clearAllPaceCurveDistances,
  paceCurveKey,
} from '../../src/lib/pace-curve-storage';
import { DEFAULT_PACE_CURVE_DISTANCES } from '../../src/domain/sprint/pace-curve';

/**
 * Persistence tests for the charted pace-curve distances.
 *
 * Lifecycle contract: the selection lives as long as the login does, and is
 * removed only by logout. localStorage content is untrusted on read, and an
 * unusable payload must degrade to the defaults rather than throw.
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
const OTHER = 'i11111';
const DEFAULTS = [...DEFAULT_PACE_CURVE_DISTANCES];

describe('pace-curve-storage', () => {
  beforeEach(() => {
    installStorage();
  });

  it('round-trips a selection for an athlete', () => {
    expect(savePaceCurveDistances(ATHLETE, [10, 30, 60])).toBe(true);
    expect(loadPaceCurveDistances(ATHLETE)).toEqual([10, 30, 60]);
  });

  it('returns the defaults when nothing is stored', () => {
    expect(loadPaceCurveDistances(ATHLETE)).toEqual(DEFAULTS);
  });

  it('sorts and de-duplicates on the way back out', () => {
    savePaceCurveDistances(ATHLETE, [100, 30, 100, 60]);
    expect(loadPaceCurveDistances(ATHLETE)).toEqual([30, 60, 100]);
  });

  it('keeps each athlete selection separate', () => {
    savePaceCurveDistances(ATHLETE, [10, 20]);
    savePaceCurveDistances(OTHER, [200, 400]);
    expect(loadPaceCurveDistances(ATHLETE)).toEqual([10, 20]);
    expect(loadPaceCurveDistances(OTHER)).toEqual([200, 400]);
  });

  it('encodes the athlete id so a separator cannot cross athletes', () => {
    expect(paceCurveKey('a:b')).toBe('ss_pace_curve:a%3Ab');
    expect(paceCurveKey('a:b')).not.toBe(paceCurveKey('a').concat(':b'));
  });

  it('falls back to the defaults for a corrupt payload without throwing', () => {
    localStorage.setItem(paceCurveKey(ATHLETE), JSON.stringify({ distances: ['banana'] }));
    expect(() => loadPaceCurveDistances(ATHLETE)).not.toThrow();
    expect(loadPaceCurveDistances(ATHLETE)).toEqual(DEFAULTS);
  });

  it('falls back to the defaults for unparseable JSON', () => {
    localStorage.setItem(paceCurveKey(ATHLETE), '{not json');
    expect(loadPaceCurveDistances(ATHLETE)).toEqual(DEFAULTS);
  });

  it('refuses to write a selection that could not be read back', () => {
    expect(savePaceCurveDistances(ATHLETE, [])).toBe(false);
    expect(savePaceCurveDistances(ATHLETE, [500])).toBe(false);
    expect(savePaceCurveDistances(ATHLETE, [45.5])).toBe(false);
    expect(savePaceCurveDistances(ATHLETE, [5, 10, 15, 20, 25, 30, 40, 60, 80, 100, 150, 200, 300])).toBe(false);
    expect(localStorage.getItem(paceCurveKey(ATHLETE))).toBeNull();
  });

  it('does nothing without an athlete id', () => {
    expect(savePaceCurveDistances('', [30])).toBe(false);
    expect(loadPaceCurveDistances('')).toEqual(DEFAULTS);
  });

  it('reports failure when storage is unavailable instead of throwing', () => {
    vi.stubGlobal('localStorage', undefined);
    expect(savePaceCurveDistances(ATHLETE, [30])).toBe(false);
    expect(loadPaceCurveDistances(ATHLETE)).toEqual(DEFAULTS);
    expect(() => clearPaceCurveDistances(ATHLETE)).not.toThrow();
    expect(() => clearAllPaceCurveDistances()).not.toThrow();
  });

  it('clears one athlete on logout, leaving the others alone', () => {
    savePaceCurveDistances(ATHLETE, [10, 20]);
    savePaceCurveDistances(OTHER, [200, 400]);
    clearPaceCurveDistances(ATHLETE);
    expect(loadPaceCurveDistances(ATHLETE)).toEqual(DEFAULTS);
    expect(loadPaceCurveDistances(OTHER)).toEqual([200, 400]);
  });

  it('clears every athlete when logging out without a known id', () => {
    savePaceCurveDistances(ATHLETE, [10, 20]);
    savePaceCurveDistances(OTHER, [200, 400]);
    localStorage.setItem('unrelated_key', 'keep me');
    clearAllPaceCurveDistances();
    expect(loadPaceCurveDistances(ATHLETE)).toEqual(DEFAULTS);
    expect(loadPaceCurveDistances(OTHER)).toEqual(DEFAULTS);
    expect(localStorage.getItem('unrelated_key')).toBe('keep me');
  });
});
