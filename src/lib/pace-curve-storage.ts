import {
  DEFAULT_PACE_CURVE_DISTANCES,
  PaceCurveSelectionSchema,
  parsePaceCurveDistances,
} from '../domain/sprint/pace-curve';

/**
 * pace-curve-storage — per-athlete persistence for the charted distance set.
 *
 * Lifecycle mirrors `race-results-storage`: the selection is written under a
 * key scoped to the athlete id, survives page reloads and browser restarts,
 * and is removed only by logout. `sessionStorage` is deliberately not used —
 * it is cleared when the tab closes, which would silently reset the athlete's
 * chosen distances while they are still logged in.
 *
 * Which distances someone charts is a preference, not a secret, so it is
 * stored in plain JSON. Nothing here is trusted on read: any script on the
 * origin can write to `localStorage`, so every value goes back through the
 * domain schema before use, and an unusable payload falls back to the
 * defaults rather than throwing.
 */

const STORAGE_PREFIX = 'ss_pace_curve';

/**
 * Storage key for an athlete. The id is encoded so that an id containing a
 * separator cannot collide with, or read, another athlete's entry.
 */
export function paceCurveKey(athleteId: string): string {
  return `${STORAGE_PREFIX}:${encodeURIComponent(athleteId)}`;
}

/** True when a usable localStorage is present (absent in SSR and some privacy modes). */
function hasStorage(): boolean {
  try {
    return typeof localStorage !== 'undefined';
  } catch {
    return false;
  }
}

/**
 * Read and validate the athlete's charted distances.
 * Returns the defaults when nothing is stored or the payload is unusable.
 */
export function loadPaceCurveDistances(athleteId: string): number[] {
  if (!athleteId || !hasStorage()) return [...DEFAULT_PACE_CURVE_DISTANCES];
  try {
    const raw = localStorage.getItem(paceCurveKey(athleteId));
    if (!raw) return [...DEFAULT_PACE_CURVE_DISTANCES];
    return parsePaceCurveDistances(JSON.parse(raw));
  } catch {
    // Corrupt JSON, a quota error, or storage blocked by the browser.
    return [...DEFAULT_PACE_CURVE_DISTANCES];
  }
}

/**
 * Persist the athlete's charted distances, validating first so an invalid set
 * cannot be written and then fail to load back.
 *
 * @returns true when the write succeeded.
 */
export function savePaceCurveDistances(athleteId: string, distances: number[]): boolean {
  if (!athleteId || !hasStorage()) return false;
  const parsed = PaceCurveSelectionSchema.safeParse({ distances });
  if (!parsed.success) return false;
  try {
    localStorage.setItem(paceCurveKey(athleteId), JSON.stringify(parsed.data));
    return true;
  } catch {
    return false;
  }
}

/** Remove the athlete's charted distances. Called on logout. */
export function clearPaceCurveDistances(athleteId: string): void {
  if (!athleteId || !hasStorage()) return;
  try {
    localStorage.removeItem(paceCurveKey(athleteId));
  } catch {
    // Nothing to do — storage is unavailable, so there is nothing stored.
  }
}

/**
 * Remove stored distances for every athlete on this device.
 *
 * Used when logging out without a known athlete id, so that one athlete's
 * configuration cannot linger on a shared browser.
 */
export function clearAllPaceCurveDistances(): void {
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
