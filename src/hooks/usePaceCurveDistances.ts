import { useCallback, useEffect, useState } from 'react';
import {
  DEFAULT_PACE_CURVE_DISTANCES,
  DistanceEdit,
  addPaceCurveDistance,
  removePaceCurveDistance,
  togglePaceCurveDistance,
} from '../domain/sprint/pace-curve';
import { loadPaceCurveDistances, savePaceCurveDistances } from '../lib/pace-curve-storage';

export interface UsePaceCurveDistances {
  /** The charted distances, ascending. Never empty. */
  distances: number[];
  /**
   * Add a custom distance. Returns the domain's verdict so the caller can
   * surface the specific refusal rather than a generic failure.
   */
  addDistance: (distance: number) => DistanceEdit;
  /** Remove a distance. Refused when it is the last one left. */
  removeDistance: (distance: number) => DistanceEdit;
  /** Chip behaviour: remove when selected, add when not. */
  toggleDistance: (distance: number) => DistanceEdit;
  /** Restore the defaults. */
  resetDistances: () => void;
}

/**
 * Owns the athlete's charted pace-curve distances and their persistence.
 *
 * Keyed by athlete and reloaded when the athlete changes, so switching logins
 * never shows the previous athlete's configuration. Changes are written back
 * immediately — there is no save step — and survive reloads; only logout
 * removes them (see `clearPaceCurveDistances`).
 *
 * Every mutation goes through the domain rules, so the bounds are enforced in
 * one place and this hook stays a thin persistence shell.
 */
export function usePaceCurveDistances(athleteId: string): UsePaceCurveDistances {
  const [distances, setDistances] = useState<number[]>(() => loadPaceCurveDistances(athleteId));

  // Reload when the signed-in athlete changes.
  useEffect(() => {
    setDistances(loadPaceCurveDistances(athleteId));
  }, [athleteId]);

  /** Apply a successful edit and persist it in one step. */
  const commit = useCallback((edit: DistanceEdit): DistanceEdit => {
    if (edit.ok) {
      setDistances(edit.distances);
      savePaceCurveDistances(athleteId, edit.distances);
    }
    return edit;
  }, [athleteId]);

  const addDistance = useCallback(
    (distance: number) => commit(addPaceCurveDistance(distances, distance)),
    [commit, distances],
  );

  const removeDistance = useCallback(
    (distance: number) => commit(removePaceCurveDistance(distances, distance)),
    [commit, distances],
  );

  const toggleDistance = useCallback(
    (distance: number) => commit(togglePaceCurveDistance(distances, distance)),
    [commit, distances],
  );

  const resetDistances = useCallback(() => {
    const defaults = [...DEFAULT_PACE_CURVE_DISTANCES];
    setDistances(defaults);
    savePaceCurveDistances(athleteId, defaults);
  }, [athleteId]);

  return { distances, addDistance, removeDistance, toggleDistance, resetDistances };
}
