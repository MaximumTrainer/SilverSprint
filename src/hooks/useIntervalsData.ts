import { useState, useEffect } from 'react';
import { SprintParser, TrackInterval } from '../logic/sprint-parser';
import { SilverSprintLogic, HRVData, NFIStatus } from '../logic/logic';
import { RaceEstimator, RaceEstimate, RaceEstimatorInput } from '../logic/race-estimator';
import { SprintRacePlanner, SprintRacePlan, SprintRaceEvent } from '../logic/race-plan';
import { IntervalsActivitySchema, IntervalsWellnessSchema, IntervalsEventSchema, IntervalsAthleteSchema, IntervalsActivity, IntervalsWellness, IntervalsEvent } from '../schema';
import { clientLogger } from '../logger';
import type { DailyDataPoint } from '../components/TimeSeriesChart';

export interface IntervalsDataState {
  activities: IntervalsActivity[];
  intervals: TrackInterval[];
  wellness: { hrv?: number; restingHR?: number; readiness?: number } | null;
  nfi: number;
  nfiStatus: NFIStatus;
  avgVmax: number;
  todayVmax: number;
  recoveryHours: number;
  tsb: number;
  strengthZone: 'fresh' | 'tired' | 'fatigued';
  /** Sprint Recovery Score 0–100 (composite of HRV ratio, TSB, NFI) */
  srs: number;
  age: number;
  bodyWeightKg: number | null;
  dailyTimeSeries: DailyDataPoint[];
  raceEstimates: RaceEstimate[];
  /** Predicted times if athlete were fully recovered (green NFI). Only populated when nfiStatus is amber/red. */
  recoveredEstimates: RaceEstimate[];
  sprintRacePlans: SprintRacePlan[];
  loading: boolean;
  error: string | null;
}

const DAYS_LABEL = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** Number of days of historical activity/wellness data to fetch */
const LOOKBACK_DAYS = 60;
/** Number of days ahead to look for upcoming race events */
const RACE_LOOKAHEAD_DAYS = 90;
/** Default HRV value when no wellness data is available */
const DEFAULT_HRV = 60;

export const useIntervalsData = (athleteId: string, apiKey: string) => {
  const [data, setData] = useState<IntervalsDataState>({
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
    age: 0,
    bodyWeightKg: null,
    dailyTimeSeries: [],
    raceEstimates: [],
    recoveredEstimates: [],
    sprintRacePlans: [],
    loading: true,
    error: null,
  });

  useEffect(() => {
    const fetchAllData = async () => {
      try {
        clientLogger.info('Starting data sync', athleteId);
        const authHeader = btoa(`API_KEY:${apiKey}`);
        const headers = { Authorization: `Basic ${authHeader}` };

        // Fetch profile, activities, and wellness in parallel (they are independent)
        const oldest = getDateDaysAgo(LOOKBACK_DAYS);
        const newest = getDateDaysAgo(0);
        clientLogger.info('Fetching profile, activities, and wellness in parallel', athleteId);

        const [profileRes, activitiesRes, wellnessRes] = await Promise.all([
          fetch(`/intervals/api/v1/athlete/${athleteId}`, { headers }),
          fetch(`/intervals/api/v1/athlete/${athleteId}/activities?oldest=${oldest}&newest=${newest}`, { headers }),
          fetch(`/intervals/api/v1/athlete/${athleteId}/wellness?oldest=${oldest}&newest=${newest}`, { headers }),
        ]);

        // 0. Process athlete profile for age & weight
        const rawProfile = profileRes.ok ? await profileRes.json() : {};
        const profile = IntervalsAthleteSchema.safeParse(rawProfile).success
          ? IntervalsAthleteSchema.parse(rawProfile)
          : null;

        /** Derive age from date-of-birth field */
        function ageFromDob(dob?: string): number {
          if (!dob) return 0;
          const birth = new Date(dob);
          const today = new Date();
          let age = today.getFullYear() - birth.getFullYear();
          const m = today.getMonth() - birth.getMonth();
          if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) age--;
          return age;
        }

        const athleteAge = ageFromDob(profile?.dob) || 0;
        const profileWeightKg = typeof profile?.weight === 'number' && profile.weight > 0
          ? profile.weight
          : null;
        clientLogger.info(`Athlete profile — age=${athleteAge}, weight=${profileWeightKg}`, athleteId);

        // 1. Process activities
        if (!activitiesRes.ok) {
          const errorText = await activitiesRes.text();
          clientLogger.error(`Activities fetch failed — HTTP ${activitiesRes.status}: ${errorText}`, athleteId);
          throw new Error(`Activities fetch failed (HTTP ${activitiesRes.status})`);
        }
        const rawActivities = await activitiesRes.json();

        // Validate each activity with Zod, keep only valid Runs
        const activities: IntervalsActivity[] = rawActivities
          .map((a: unknown) => IntervalsActivitySchema.safeParse(a))
          .filter((r: { success: boolean }) => r.success)
          .map((r: { success: true; data: IntervalsActivity }) => r.data);

        // 2. Process Wellness (HRV/Readiness)
        if (!wellnessRes.ok) {
          clientLogger.warn(`Wellness fetch failed — HTTP ${wellnessRes.status}`, athleteId);
        }
        const rawWellness = wellnessRes.ok ? await wellnessRes.json() : [];
        const wellnessEntries: IntervalsWellness[] = Array.isArray(rawWellness)
          ? rawWellness
              .map((w: unknown) => IntervalsWellnessSchema.safeParse(w))
              .filter((r): r is { success: true; data: IntervalsWellness } => r.success)
              .map((r) => r.data)
          : [];

        const latestWellness = wellnessEntries[0] || null;

        // Extract body weight: prefer profile, fall back to most recent wellness entry
        const bodyWeightKg = profileWeightKg
          ?? wellnessEntries.find((w) => typeof w.weight === 'number' && w.weight > 0)?.weight
          ?? null;

        // 3. Parse Latest Session for Sprint Metrics
        const latestSession = activities[0];
        const parsedIntervals = latestSession
          ? SprintParser.parseTrackSession(latestSession)
          : [];

        // 4. Calculate Neural Fatigue Index (NFI)
        const todayVmax = latestSession?.max_speed || 0;
        const validVmaxes = activities
          .slice(1, 31)
          .map((a) => a.max_speed)
          .filter((v) => v > 0);

        const avgVmax = validVmaxes.length > 0
          ? validVmaxes.reduce((a, b) => a + b, 0) / validVmaxes.length
          : todayVmax;

        const currentNFI = SilverSprintLogic.calculateNFI(todayVmax, avgVmax);
        const nfiStatus = SilverSprintLogic.getNFIStatus(currentNFI);

        // 5. Calculate HRV-based recovery (§3.2)
        const currentHRV = latestWellness?.hrv || DEFAULT_HRV;
        const recentHRVs = wellnessEntries
          .slice(0, 7)
          .map((w) => w.hrv)
          .filter((h): h is number => typeof h === 'number' && h > 0);
        const avgHRV7d = recentHRVs.length > 0
          ? recentHRVs.reduce((a, b) => a + b, 0) / recentHRVs.length
          : currentHRV;

        const hrvData: HRVData = { currentHRV, avgHRV7d };

        // 6. Calculate TSB and Strength Zone (§3.3) — must come before SRS
        const latestATL = latestSession?.icu_atl || 0;
        const latestCTL = latestSession?.icu_ctl || 0;
        const tsb = latestCTL - latestATL;
        const strengthRx = SilverSprintLogic.getStrengthPrescription(tsb);

        const currentSRS = SilverSprintLogic.calculateSRS(hrvData, tsb, currentNFI);
        const recoveryHours = SilverSprintLogic.getRecoveryWindow(athleteAge, currentSRS);

        // 7. Build 60-day time series for charts
        const dailyTimeSeries = buildDailyTimeSeries(activities, wellnessEntries, avgVmax, avgHRV7d, athleteAge);

        // 8. Race estimates based on best Vmax + training interval history
        const bestVmax60d = activities.reduce((best, a) => Math.max(best, a.max_speed), 0);

        // Parse intervals from ALL activities for training profile
        const allTrainingIntervals = activities.flatMap((a) => SprintParser.parseTrackSession(a));
        clientLogger.info(`Parsed ${allTrainingIntervals.length} training intervals from ${activities.length} activities`, athleteId);

        const raceInput: RaceEstimatorInput = {
          bestVmax60d,
          avgVmax,
          nfi: currentNFI,
          nfiStatus,
          tsb,
          age: athleteAge,
          activityCount: activities.length,
          trainingIntervals: allTrainingIntervals,
        };
        const raceEstimates = RaceEstimator.estimate(raceInput);

        // 8b. "Fully recovered" estimates — only computed when fatigued
        const recoveredEstimates: RaceEstimate[] = nfiStatus !== 'green'
          ? RaceEstimator.estimate({
              ...raceInput,
              nfi: 1.0,
              nfiStatus: 'green',
              tsb: 5,
            })
          : [];

        // 9. Fetch upcoming race events (next 90 days) and build sprint race plans
        const futureDate = getDateDaysAhead(RACE_LOOKAHEAD_DAYS);
        const todayDate = getDateDaysAgo(0);
        let sprintRacePlans: SprintRacePlan[] = [];
        try {
          clientLogger.info('Fetching upcoming race events', athleteId);
          // Race categories are RACE_A, RACE_B, RACE_C in Intervals.icu
          // The list endpoint requires a format suffix (.json) in the path
          const eventsRes = await fetch(
            `/intervals/api/v1/athlete/${athleteId}/events.json?oldest=${todayDate}&newest=${futureDate}&category=RACE_A&category=RACE_B&category=RACE_C`,
            { headers }
          );
          if (eventsRes.ok) {
            const rawEvents = await eventsRes.json();
            clientLogger.info(`Events API returned ${Array.isArray(rawEvents) ? rawEvents.length : 0} event(s)`, athleteId);
            const events: IntervalsEvent[] = (Array.isArray(rawEvents) ? rawEvents : [])
              .map((e: unknown) => IntervalsEventSchema.safeParse(e))
              .filter((r): r is { success: true; data: IntervalsEvent } => r.success)
              .map((r) => r.data)
              .filter((e) => {
                // Filter to sprint races: type Run, distance < 800m
                const distM = e.distance ?? e.distance_target ?? 0;
                const pass = e.type === 'Run' && distM > 0 && distM < 800;
                if (!pass) {
                  clientLogger.info(`Skipping event "${e.name}" — type=${e.type}, dist=${distM}, cat=${e.category}`, athleteId);
                }
                return pass;
              });

            const today = new Date(todayDate);
            const raceEvents: SprintRaceEvent[] = events
              .map((e) => {
                const raceDate = new Date(e.start_date_local.split('T')[0]);
                const daysUntil = Math.max(
                  0,
                  Math.round((raceDate.getTime() - today.getTime()) / 86_400_000)
                );
                const distM = e.distance ?? e.distance_target ?? 0;
                return {
                  id: e.id,
                  name: e.name || `${distM}m Race`,
                  date: e.start_date_local.split('T')[0],
                  distanceM: distM,
                  daysUntil,
                };
              })
              .sort((a, b) => a.daysUntil - b.daysUntil);

            sprintRacePlans = SprintRacePlanner.buildMultiRacePlans(raceEvents, bestVmax60d, 45);

            clientLogger.info(`Found ${sprintRacePlans.length} upcoming sprint race(s)`, athleteId);
          } else {
            clientLogger.warn(`Events fetch failed — HTTP ${eventsRes.status}`, athleteId);
          }
        } catch (eventsErr) {
          clientLogger.warn('Could not fetch race events', athleteId, eventsErr);
        }

        setData({
          activities,
          intervals: parsedIntervals,
          wellness: latestWellness,
          nfi: currentNFI,
          nfiStatus,
          avgVmax,
          todayVmax,
          recoveryHours,
          tsb,
          strengthZone: strengthRx.zone,
          srs: currentSRS,
          age: athleteAge,
          bodyWeightKg,
          dailyTimeSeries,
          raceEstimates,
          recoveredEstimates,
          sprintRacePlans,
          loading: false,
          error: null,
        });
        clientLogger.info(`Data sync complete — NFI=${currentNFI.toFixed(3)}, activities=${activities.length}`, athleteId);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to sync with Intervals.icu';
        clientLogger.error(`Data sync failed: ${message}`, athleteId, err);
        setData(prev => ({ ...prev, loading: false, error: message }));
      }
    };

    if (athleteId && apiKey) {
      fetchAllData();
    }
  }, [athleteId, apiKey]);

  return data;
};

/**
 * Build a 60-day array of daily data points for the time-series charts.
 * Recovery hours are computed per-day using a rolling 7d HRV baseline
 * and the Sprint Recovery Score (SRS) composite model.
 */
function buildDailyTimeSeries(
  activities: IntervalsActivity[],
  wellnessEntries: Array<{ id: string; date?: string; hrv?: number }>,
  avgVmax: number,
  avgHRV7d: number,
  age: number,
): DailyDataPoint[] {
  // Index activities by date
  const actByDate = new Map<string, IntervalsActivity>();
  for (const act of activities) {
    const dateStr = act.start_date_local?.split('T')[0];
    if (dateStr && !actByDate.has(dateStr)) actByDate.set(dateStr, act);
  }

  // Build HRV map and a date-sorted array for per-day rolling window
  const wellByDate = new Map<string, number>();
  const hrvTimeline: Array<{ date: string; hrv: number }> = [];
  for (const w of wellnessEntries) {
    const dateStr = w.date || w.id;
    if (dateStr && w.hrv && w.hrv > 0 && !wellByDate.has(dateStr)) {
      wellByDate.set(dateStr, w.hrv);
      hrvTimeline.push({ date: dateStr, hrv: w.hrv });
    }
  }
  hrvTimeline.sort((a, b) => a.date.localeCompare(b.date));

  const series: DailyDataPoint[] = [];
  let lastTsb: number | null = null;
  for (let i = 59; i >= 0; i--) {
    const dateStr = getDateDaysAgo(i);
    const d = new Date(dateStr + 'T12:00:00');
    const dayLabel = `${d.getDate()} ${['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][d.getMonth()]}`;

    const act = actByDate.get(dateStr);
    const hrv = wellByDate.get(dateStr);

    const nfi = act && avgVmax > 0 ? act.max_speed / avgVmax : null;
    const tsb: number | null = act ? (act.icu_ctl - act.icu_atl) : lastTsb;
    if (tsb != null) lastTsb = tsb;

    // Per-day rolling 7d HRV avg using only entries up to and including this day
    const weekStartStr = getDateDaysAgo(i + 7);
    const weekHRVs = hrvTimeline
      .filter(e => e.date > weekStartStr && e.date <= dateStr)
      .map(e => e.hrv);
    const rollingAvg7d = weekHRVs.length > 0
      ? weekHRVs.reduce((a, b) => a + b, 0) / weekHRVs.length
      : avgHRV7d;

    // SRS: neutral fallbacks for days without activity or HRV data
    const srs = SilverSprintLogic.calculateSRS(
      { currentHRV: hrv ?? rollingAvg7d, avgHRV7d: rollingAvg7d },
      tsb ?? 0,
      nfi ?? 1.0,
    );
    const recoveryHours = SilverSprintLogic.getRecoveryWindow(age, srs);

    series.push({ date: dateStr, dayLabel, nfi, tsb, recoveryHours });
  }

  return series;
}

function getDateDaysAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().split('T')[0];
}

function getDateDaysAhead(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().split('T')[0];
}