import { RaceResult, parseRaceResults } from '../domain/sprint/race-results';

/**
 * race-results-storage — per-athlete persistence for known race times.
 *
 * Lifecycle: results are written under a key scoped to the athlete id and
 * survive page reloads and browser restarts, exactly as long as the login
 * does. {@link clearRaceResults} is called on logout, which is the only thing
 * that removes them.
 *
 * `sessionStorage` is deliberately not used: it is cleared when the tab
 * closes, which would discard results while the athlete is still logged in
 * (the credential cookie outlives the tab).
 *
 * These are personal performance records, not secrets, so they are stored in
 * plain JSON. Nothing here is trusted on read — any script on the origin can
 * write to `localStorage`, so every value goes back through the domain schema
 * in {@link parseRaceResults} before use.
 */

const STORAGE_PREFIX = 'ss_race_results';

/**
 * Storage key for an athlete. The id is encoded so that an id containing a
 * separator cannot collide with, or read, another athlete's entry.
 */
export function raceResultsKey(athleteId: string): string {
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
 * Read and validate the athlete's stored results.
 * Returns an empty list when nothing is stored or the payload is unusable.
 */
export function loadRaceResults(athleteId: string): RaceResult[] {
  if (!athleteId || !hasStorage()) return [];
  try {
    const raw = localStorage.getItem(raceResultsKey(athleteId));
    if (!raw) return [];
    return parseRaceResults(JSON.parse(raw));
  } catch {
    // Corrupt JSON, a quota error, or storage blocked by the browser.
    return [];
  }
}

/**
 * Persist the athlete's results, validating first so a bad entry cannot be
 * written and then fail to load back.
 *
 * @returns true when the write succeeded.
 */
export function saveRaceResults(athleteId: string, results: RaceResult[]): boolean {
  if (!athleteId || !hasStorage()) return false;
  try {
    const valid = parseRaceResults(results);
    localStorage.setItem(raceResultsKey(athleteId), JSON.stringify(valid));
    return true;
  } catch {
    return false;
  }
}

/** Remove the athlete's stored results. Called on logout. */
export function clearRaceResults(athleteId: string): void {
  if (!athleteId || !hasStorage()) return;
  try {
    localStorage.removeItem(raceResultsKey(athleteId));
  } catch {
    // Nothing to do — storage is unavailable, so there is nothing stored.
  }
}

/**
 * Remove stored results for every athlete on this device.
 *
 * Used when logging out without a known athlete id, so that one athlete's
 * times cannot linger on a shared browser.
 */
export function clearAllRaceResults(): void {
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

/** Generate a stable id for a newly entered result. */
export function newRaceResultId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `r_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}
