import { useCallback, useEffect, useRef, useState } from 'react';
import { loadPaceCurve, StreamCachePort } from '../application/pace-curve-sync';
import type { HttpGet } from '../application/dashboard-sync';
import type { IntervalsActivity } from '../domain/schema';
import type { PaceCurveActivityStream } from '../domain/sprint/pace-curve';
import type { PaceCurveCoverage } from '../application/dashboard-sync';
import { buildAuthorizationHeader } from '../lib/auth-storage';
import { loadStreamCache, saveStreamCache } from '../lib/stream-cache';
import { clientLogger } from '../logger';

export interface UsePaceCurve {
  streams: PaceCurveActivityStream[];
  coverage: PaceCurveCoverage | undefined;
  status: 'idle' | 'loading' | 'ready' | 'error';
  errorMessage: string | null;
  /** True when Intervals.icu refused at least one request for this load. */
  rateLimited: boolean;
  /** Discard what was loaded and fetch again. */
  retry: () => void;
}

/** The browser adapter for the use case's cache port. */
const browserStreamCache: StreamCachePort = {
  load: loadStreamCache,
  save: saveStreamCache,
};

/**
 * Owns the pace curve's streams and the one fetch that pays for them.
 *
 * Two properties matter and are the reason this is a hook rather than a call
 * inside the screen:
 *
 *  - **It does nothing until `enabled`.** That is what makes a dashboard load
 *    cost zero `/streams` requests; the fetch starts when the athlete opens
 *    the pace curve screen and not a moment earlier.
 *  - **It survives navigation.** The state lives here, in a component that is
 *    mounted for the whole session, so moving to the dashboard and back does
 *    not re-fetch. Across reloads the persistent cache does the same job.
 *
 * Changing distances or the date range touches none of this: the screen
 * recomputes the curve from `streams` locally.
 */
export function usePaceCurve(
  athleteId: string,
  accessToken: string,
  authType: 'basic' | 'bearer',
  activities: IntervalsActivity[],
  eligibleCount: number,
  bestVmax60d: number,
  enabled: boolean,
): UsePaceCurve {
  const [state, setState] = useState<Omit<UsePaceCurve, 'retry'>>({
    streams: [],
    coverage: undefined,
    status: 'idle',
    errorMessage: null,
    rateLimited: false,
  });
  const [attempt, setAttempt] = useState(0);

  // The candidate list is a fresh array on every dashboard render, so it
  // cannot be an effect dependency without re-fetching on every render. What
  // identifies the work is the athlete and the ids.
  const activitiesRef = useRef(activities);
  activitiesRef.current = activities;
  const eligibleRef = useRef(eligibleCount);
  eligibleRef.current = eligibleCount;
  const bestVmaxRef = useRef(bestVmax60d);
  bestVmaxRef.current = bestVmax60d;

  const candidateKey = activities.map((a) => a.id).join(',');

  /**
   * The load that is current — started or finished — as `athlete|ids|attempt`.
   *
   * It does two jobs, and both are about navigation. Leaving the screen flips
   * `enabled`, which re-runs this effect on the way back; matching the key is
   * what stops that becoming a second load, so returning shows the curve
   * instead of a loading state for data already in memory. And because a
   * superseded load is recognised by its key no longer being current, a fetch
   * in flight when the athlete navigates away is left to finish and land —
   * cancelling it on the way out would strand the screen on "loading" when
   * they came back.
   */
  const activeKeyRef = useRef<string | null>(null);

  useEffect(() => {
    if (!enabled || !athleteId || !accessToken || candidateKey === '') return;

    const workKey = `${athleteId}|${candidateKey}|${attempt}`;
    if (activeKeyRef.current === workKey) return;
    activeKeyRef.current = workKey;

    setState((prev) => ({ ...prev, status: 'loading', errorMessage: null }));

    const headers = { Authorization: buildAuthorizationHeader({ athleteId, accessToken, authType }) };
    const httpGet: HttpGet = (url) => fetch(url, { headers });

    loadPaceCurve({
      athleteId,
      httpGet,
      activities: activitiesRef.current,
      eligibleCount: eligibleRef.current,
      bestVmax60d: bestVmaxRef.current,
      logger: clientLogger,
      cache: browserStreamCache,
    })
      .then((result) => {
        if (activeKeyRef.current !== workKey) return;
        setState({
          streams: result.streams,
          coverage: result.coverage,
          status: 'ready',
          errorMessage: null,
          rateLimited: result.rateLimited,
        });
      })
      .catch((err: unknown) => {
        if (activeKeyRef.current !== workKey) return;
        // A failure is not a completed load: release the key so the next visit
        // tries again rather than showing a stale error for ever.
        activeKeyRef.current = null;
        const message = err instanceof Error ? err.message : 'Failed to load your velocity streams';
        clientLogger.error(`Pace curve load failed: ${message}`, athleteId, err);
        setState((prev) => ({ ...prev, status: 'error', errorMessage: message }));
      });
    // `attempt` is what a retry increments; the rest identifies the work.
  }, [enabled, athleteId, accessToken, authType, candidateKey, attempt]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  return { ...state, retry };
}
