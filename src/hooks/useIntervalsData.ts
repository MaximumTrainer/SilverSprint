import { useState, useEffect, useMemo, useRef } from 'react';
import { buildDashboardState, DashboardState, HttpGet } from '../application/dashboard-sync';
import { RaceEstimator } from '../domain/sprint/race-estimator';
import { NEUTRAL_CALIBRATION, RaceResult } from '../domain/sprint/race-results';
import { buildTwoDayPlan } from '../domain/sprint/daily-plan';
import { buildAuthorizationHeader } from '../lib/auth-storage';
import { clientLogger } from '../logger';

export interface IntervalsDataState extends DashboardState {
  loading: boolean;
  error: string | null;
}

const INITIAL_STATE: IntervalsDataState = {
  activities: [],
  intervals: [],
  wellness: null,
  nfi: 1.0,
  nfiStatus: 'green',
  avgVmax: 0,
  todayVmax: 0,
  recoveryHours: 48,
  tsb: 0,
  strengthZone: 'fresh',
  srs: 50,
  staleVmax: false,
  age: 0,
  bodyWeightKg: null,
  dailyTimeSeries: [],
  raceEstimates: [],
  recoveredEstimates: [],
  sprintRacePlans: [],
  trainingPlan: null,
  raceEstimatorInput: {
    bestVmax60d: 0,
    avgVmax: 0,
    nfi: 1.0,
    nfiStatus: 'green',
    tsb: 0,
    age: 0,
    activityCount: 0,
    trainingIntervals: [],
  },
  raceCalibration: NEUTRAL_CALIBRATION,
  paceCurveStreams: [],
  paceCurve: { points: [], excludedEfforts: 0, excludedActivities: 0, activitiesUsed: 0 },
  paceCurveCoverage: { eligible: 0, requested: 0, fetched: 0 },
  // A neutral placeholder so the dashboard can render before the first sync
  // resolves; replaced wholesale by the real plan on load.
  dailyPlan: buildTwoDayPlan({
    now: new Date(),
    nfi: 1.0,
    nfiStatus: 'green',
    todayTsb: 0,
    projectedTomorrowTsb: null,
    ctl: 0,
    atl: 0,
    recoveryHours: 48,
    lastMaxEffortAt: null,
  }),
  loading: true,
  error: null,
};

/**
 * React adapter over the `buildDashboardState` use case.
 *
 * All derivation logic lives in the application layer; this hook owns only the
 * HTTP adapter (authenticated `fetch`) and React state transitions.
 *
 * Known race times are handled specially. They are held locally, not fetched
 * from Intervals.icu, so editing them must not trigger a full re-sync: the
 * fetch effect reads them through a ref, and the race estimates are recomputed
 * from the already-fetched inputs whenever the results change.
 */
export const useIntervalsData = (
  athleteId: string,
  accessToken: string,
  authType: 'basic' | 'bearer' = 'basic',
  raceResults: RaceResult[] = [],
) => {
  const [data, setData] = useState<IntervalsDataState>(INITIAL_STATE);

  // Seed the first sync with whatever results are already known, without
  // making the results a dependency of the fetch effect.
  const raceResultsRef = useRef(raceResults);
  raceResultsRef.current = raceResults;

  useEffect(() => {
    let cancelled = false;

    const sync = async () => {
      const headers = { Authorization: buildAuthorizationHeader({ athleteId, accessToken, authType }) };
      const httpGet: HttpGet = (url) => fetch(url, { headers });

      try {
        const state = await buildDashboardState({
          athleteId,
          httpGet,
          logger: clientLogger,
          raceResults: raceResultsRef.current,
        });
        if (cancelled) return;
        setData({ ...state, loading: false, error: null });
      } catch (err) {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : 'Failed to sync with Intervals.icu';
        clientLogger.error(`Data sync failed: ${message}`, athleteId, err);
        setData(prev => ({ ...prev, loading: false, error: message }));
      }
    };

    if (athleteId && accessToken) {
      sync();
    }

    return () => { cancelled = true; };
  }, [athleteId, accessToken, authType]);

  // Recompute race estimates locally when the athlete edits their known times.
  // This is pure domain maths over data already in memory — no network call.
  const calibrated = useMemo(() => {
    const input = data.raceEstimatorInput;
    if (data.loading || input.age === 0 && input.activityCount === 0) {
      return {
        raceCalibration: data.raceCalibration,
        raceEstimates: data.raceEstimates,
        recoveredEstimates: data.recoveredEstimates,
      };
    }

    const raceCalibration = RaceEstimator.calibrate(input, raceResults);
    const calibratedInput = { ...input, calibration: raceCalibration };

    return {
      raceCalibration,
      raceEstimates: RaceEstimator.estimate(calibratedInput),
      recoveredEstimates: input.nfiStatus !== 'green'
        ? RaceEstimator.estimate({ ...calibratedInput, nfi: 1.0, nfiStatus: 'green' as const, tsb: 5 })
        : [],
    };
  }, [data, raceResults]);

  return { ...data, ...calibrated };
};
