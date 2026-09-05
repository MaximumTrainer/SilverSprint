import { useCallback, useEffect, useState } from 'react';
import { RaceResult, RaceResultSchema, sortResultsByDateDesc } from '../domain/sprint/race-results';
import { loadRaceResults, saveRaceResults, newRaceResultId } from '../lib/race-results-storage';

export interface UseRaceResults {
  /** The athlete's known race times, newest first. */
  results: RaceResult[];
  /**
   * Add a result. Returns the new result, or null when it fails validation —
   * the caller should surface the rejection rather than assume success.
   */
  addResult: (draft: Omit<RaceResult, 'id'>) => RaceResult | null;
  /** Replace a result by id. Returns false when the update fails validation. */
  updateResult: (id: string, draft: Omit<RaceResult, 'id'>) => boolean;
  /** Remove a result by id. */
  removeResult: (id: string) => void;
}

/**
 * Owns the athlete's known race times and their persistence.
 *
 * Results are keyed by athlete and reloaded when the athlete changes, so
 * switching logins never shows the previous athlete's times. They are written
 * back on every change and survive reloads; only logout removes them (see
 * `clearRaceResults`).
 */
export function useRaceResults(athleteId: string): UseRaceResults {
  const [results, setResults] = useState<RaceResult[]>(() => sortResultsByDateDesc(loadRaceResults(athleteId)));

  // Reload when the signed-in athlete changes.
  useEffect(() => {
    setResults(sortResultsByDateDesc(loadRaceResults(athleteId)));
  }, [athleteId]);

  /** Apply a change and persist it in one step, keeping storage and state in sync. */
  const commit = useCallback((next: RaceResult[]) => {
    const sorted = sortResultsByDateDesc(next);
    setResults(sorted);
    saveRaceResults(athleteId, sorted);
  }, [athleteId]);

  const addResult = useCallback((draft: Omit<RaceResult, 'id'>): RaceResult | null => {
    const candidate = { ...draft, id: newRaceResultId() };
    const parsed = RaceResultSchema.safeParse(candidate);
    if (!parsed.success) return null;

    commit([...results, parsed.data]);
    return parsed.data;
  }, [commit, results]);

  const updateResult = useCallback((id: string, draft: Omit<RaceResult, 'id'>): boolean => {
    const parsed = RaceResultSchema.safeParse({ ...draft, id });
    if (!parsed.success) return false;

    commit(results.map((r) => (r.id === id ? parsed.data : r)));
    return true;
  }, [commit, results]);

  const removeResult = useCallback((id: string) => {
    commit(results.filter((r) => r.id !== id));
  }, [commit, results]);

  return { results, addResult, updateResult, removeResult };
}
