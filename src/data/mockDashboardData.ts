/**
 * Demo-mode data for unauthenticated visitors.
 *
 * Rather than drawing plausible-looking curves, this module simulates a
 * masters sprinter's **training calendar** and then runs it through the same
 * domain functions the live app uses. Every number on the demo dashboard is
 * therefore produced the way a real athlete's would be: CTL and ATL are real
 * exponential moving averages of daily training load, TSB is their difference,
 * the Vmax baseline uses the real sprint-session selection rule, and recovery,
 * SRS, race times and race plans all come from the real domain modules.
 *
 * The alternative — hand-written constants and sine waves — drifts out of
 * agreement with the model as soon as the model changes, and produces figures
 * the app itself could never generate (a 36-hour recovery window for a
 * 52-year-old, for instance, when the age tax alone floors it at 120).
 *
 * Everything here is deterministic: a seeded PRNG, never `Math.random`, so the
 * demo looks identical on every load and in every screenshot.
 */

import type { AthleteData } from '../components/Dashboard';
import type { DailyDataPoint } from '../domain/types';
import type { IntervalsActivity } from '../domain/schema';
import type { TrackInterval } from '../domain/sprint/parser';
import { buildDailyTimeSeries } from '../application/dashboard-sync';
import { SilverSprintLogic } from '../domain/sprint/core';
import { RaceEstimator, RaceEstimate, RaceEstimatorInput } from '../domain/sprint/race-estimator';
import { SprintRacePlanner, SprintRacePlan, SprintRaceEvent } from '../domain/sprint/race-plan';
import { SprintTrainingPlan, TrainingPlanContext } from '../domain/sprint/training-plan';

// ── Athlete profile ─────────────────────────────────────────────────────────

const DEMO_NAME = 'Alex Runner';
const DEMO_AGE = 52;
const DEMO_WEIGHT_KG = 74.5;

/** The athlete's Vmax when fresh, in m/s — a competitive M50 sprinter. */
const PEAK_VMAX = 9.15;

/** Days of history the live app charts. */
const WINDOW_DAYS = 60;
/** Extra days simulated before the window so the CTL/ATL averages are settled. */
const BURN_IN_DAYS = 60;

/** Days until the demo's target race. */
const RACE_DAYS_AHEAD = 42;

// ── Deterministic noise ─────────────────────────────────────────────────────

/**
 * mulberry32 — a small, fast, well-distributed PRNG.
 *
 * Seeded so the demo is byte-identical on every load. Real day-to-day
 * variation is noisy and aperiodic; a sine wave is neither, and reads as
 * obviously synthetic on a chart.
 */
function createRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const random = createRandom(0x5119e5);

/** Symmetric noise in [-spread, +spread]. */
function jitter(spread: number): number {
  return (random() * 2 - 1) * spread;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

// ── Training calendar ───────────────────────────────────────────────────────

type SessionKind = 'sprint-max' | 'sprint-se' | 'tempo' | 'gym' | 'walk' | 'rest';

/** Typical training load for each session type, before block modulation. */
const SESSION_LOAD: Record<SessionKind, number> = {
  'sprint-max': 62,
  'sprint-se': 78,
  tempo: 34,
  gym: 46,
  walk: 6,
  rest: 0,
};

/**
 * The athlete's default week. A masters sprinter's easy volume is mostly
 * walking and gym work rather than running, so run-days are few and nearly all
 * of them are quality — which is why the neural-readiness chart is dominated by
 * genuine sprint efforts rather than jogging noise.
 *
 * Index 0 is Sunday, matching `Date.getDay()`.
 */
const WEEK_TEMPLATE: SessionKind[] = [
  'walk',        // Sun — long walk
  'gym',         // Mon — max strength
  'sprint-max',  // Tue — max velocity
  'walk',        // Wed — recovery walk
  'gym',         // Thu — strength + drills
  'rest',        // Fri — full rest
  'sprint-se',   // Sat — speed endurance
];

/** A tempo run replaces the Thursday gym session every third week. */
const TEMPO_WEEK_INTERVAL = 3;

interface SimulatedDay {
  /** Days before today; 0 is today. */
  daysAgo: number;
  date: string;
  kind: SessionKind;
  load: number;
  ctl: number;
  atl: number;
  /** Peak speed in m/s, or null when the day involved no running. */
  vmax: number | null;
  /** Waking HRV in ms, or null on days the strap was not worn. */
  hrv: number | null;
}

function isoDate(daysAgo: number, today: Date): string {
  const d = new Date(today);
  d.setDate(d.getDate() - daysAgo);
  return d.toISOString().slice(0, 10);
}

/**
 * Simulate the athlete's last few months of training.
 *
 * Load drives CTL and ATL through the standard 42-day and 7-day exponential
 * moving averages, exactly as Intervals.icu computes them, so TSB rises during
 * easy weeks and falls through hard ones instead of tracing a smooth curve.
 * Sprint Vmax then responds to that accumulated fatigue, which is what makes
 * the Neural Fatigue Index move at all.
 */
function simulateTraining(today: Date): SimulatedDay[] {
  const days: SimulatedDay[] = [];

  // Seed the averages near a plausible mid-season fitness level.
  let ctl = 34;
  let atl = 34;
  let hrv = 52;

  for (let daysAgo = WINDOW_DAYS + BURN_IN_DAYS; daysAgo >= 0; daysAgo--) {
    const date = isoDate(daysAgo, today);
    const weekday = new Date(`${date}T12:00:00`).getDay();
    const weekIndex = Math.floor((WINDOW_DAYS + BURN_IN_DAYS - daysAgo) / 7);

    let kind = WEEK_TEMPLATE[weekday];
    if (kind === 'gym' && weekday === 4 && weekIndex % TEMPO_WEEK_INTERVAL === 0) {
      kind = 'tempo';
    }

    // Every fourth week is a deload; the block leading into the race ramps up.
    const isDeload = weekIndex % 4 === 3;
    // A four-day work trip 24–27 days ago: walking only.
    const isTravel = daysAgo >= 24 && daysAgo <= 27;
    // The current Special Physical Preparation block: the heaviest of the year.
    // This is what pulls the athlete into the amber neural band today, which is
    // the state worth demonstrating — it exercises the traffic-light messaging,
    // the technical-sprint workout path and the "if fully recovered" estimates.
    const inBuildBlock = daysAgo <= 13;

    if (isTravel && kind !== 'rest') kind = 'walk';

    let load = SESSION_LOAD[kind];
    if (isDeload) load *= 0.45;
    if (inBuildBlock) load *= 1.65;
    load = Math.round(load * (1 + jitter(0.1)));

    // Standard training-load impulse response: 42-day fitness, 7-day fatigue.
    ctl += (load - ctl) / 42;
    atl += (load - atl) / 7;

    const tsb = ctl - atl;

    // Sprint output tracks freshness: deeply negative TSB costs top speed.
    let vmax: number | null = null;
    if (kind === 'sprint-max' || kind === 'sprint-se') {
      const freshness = 1 + clamp(tsb, -30, 10) * 0.0032;
      // Speed-endurance days are run just below true top speed.
      const sessionCeiling = kind === 'sprint-se' ? PEAK_VMAX * 0.975 : PEAK_VMAX;
      vmax = parseFloat((sessionCeiling * freshness * (1 + jitter(0.008))).toFixed(3));
    } else if (kind === 'tempo') {
      // Tempo runs finish with strides, so peak speed lands well short of a sprint.
      vmax = parseFloat((6.85 * (1 + jitter(0.03))).toFixed(3));
    }

    // HRV: mean-reverting toward a personal baseline, knocked down by fatigue.
    const hrvTarget = 53 + clamp(tsb, -30, 10) * 0.34;
    hrv += (hrvTarget - hrv) * 0.35 + jitter(2.6);
    hrv = clamp(hrv, 34, 68);

    // Two nights the strap was not worn — real wellness histories have gaps.
    const wornTonight = !(daysAgo === 31 || daysAgo === 32);

    days.push({
      daysAgo,
      date,
      kind,
      load,
      ctl,
      atl,
      vmax,
      hrv: wornTonight ? parseFloat(hrv.toFixed(1)) : null,
    });
  }

  return days;
}

const TODAY = (() => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
})();

const SIMULATED_DAYS = simulateTraining(TODAY);

/** Only the charted window; the burn-in exists purely to settle the averages. */
const WINDOW = SIMULATED_DAYS.filter((d) => d.daysAgo <= WINDOW_DAYS);

// ── Shape the simulation into the API types the domain expects ──────────────

/** Run activities, newest-first — the ordering the live API uses. */
const demoActivities: IntervalsActivity[] = WINDOW
  .filter((d) => d.vmax != null)
  .map((d) => ({
    id: `demo_${d.date}`,
    type: 'Run' as const,
    start_date_local: `${d.date}T18:15:00`,
    velocity_smooth: [],
    max_speed: d.vmax,
    icu_training_load: d.load,
    icu_atl: parseFloat(d.atl.toFixed(3)),
    icu_ctl: parseFloat(d.ctl.toFixed(3)),
  }))
  .sort((a, b) => (b.start_date_local ?? '').localeCompare(a.start_date_local ?? ''));

/**
 * Wellness entries, oldest-first — again matching the live API's ordering.
 *
 * These carry CTL and ATL for every day, including rest days, which is what
 * lets fitness and fatigue stay current between sessions. Sourcing them from
 * activities instead would freeze the demo's TSB on each training day.
 */
const demoWellness = WINDOW.map((d) => ({
  id: d.date,
  date: d.date,
  hrv: d.hrv,
  ctl: parseFloat(d.ctl.toFixed(3)),
  atl: parseFloat(d.atl.toFixed(3)),
}));

/**
 * Rep-level data for the recent sprint sessions.
 *
 * The race model reads speed-endurance and acceleration quality from these, so
 * the demo's predicted times reflect a real training profile rather than raw
 * Vmax alone.
 */
const demoTrainingIntervals: TrackInterval[] = WINDOW
  .filter((d) => d.vmax != null && (d.kind === 'sprint-max' || d.kind === 'sprint-se'))
  .slice(0, 10)
  .flatMap((d): TrackInterval[] => {
    const vmax = d.vmax as number;
    if (d.kind === 'sprint-max') {
      // Block starts and flying runs: short, fast, fully recovered.
      return [
        { type: 'Acceleration', distance: 30, vMax: vmax * 0.93, duration: 4, flyingVelocity: parseFloat((vmax * 0.82).toFixed(2)) },
        { type: 'Acceleration', distance: 30, vMax: vmax * 0.95, duration: 4, flyingVelocity: parseFloat((vmax * 0.84).toFixed(2)) },
        { type: 'MaxVelocity', distance: 60, vMax: vmax, duration: 7, flyingVelocity: parseFloat((vmax * 0.94).toFixed(2)) },
        { type: 'MaxVelocity', distance: 60, vMax: vmax * 0.99, duration: 7, flyingVelocity: parseFloat((vmax * 0.93).toFixed(2)) },
      ];
    }
    // Speed endurance: longer reps at a sustained fraction of top speed.
    return [
      { type: 'SpeedEndurance', distance: 120, vMax: vmax, duration: 15, flyingVelocity: parseFloat((vmax * 0.9).toFixed(2)) },
      { type: 'SpeedEndurance', distance: 120, vMax: vmax * 0.97, duration: 15, flyingVelocity: parseFloat((vmax * 0.88).toFixed(2)) },
      { type: 'SpecialEndurance', distance: 150, vMax: vmax * 0.96, duration: 19, flyingVelocity: parseFloat((vmax * 0.85).toFixed(2)) },
    ];
  });

// ── Derive every displayed value through the real domain modules ────────────

const latestRun = demoActivities[0];
const todayVmax = latestRun?.max_speed ?? 0;
const priorVmaxes = demoActivities.slice(1, 31).map((a) => a.max_speed);
const windowBestVmax = priorVmaxes.reduce<number>((best, v) => Math.max(best, v ?? 0), todayVmax);

const avgVmax = SilverSprintLogic.calculateVmaxBaseline(priorVmaxes, windowBestVmax) ?? todayVmax;
const nfi = SilverSprintLogic.calculateNFI(todayVmax, avgVmax);
const nfiStatus = SilverSprintLogic.getNFIStatus(nfi);

// Today's fitness and fatigue, as the live app now reads them — from the
// current wellness row rather than the last training day.
const todayLoad = WINDOW[WINDOW.length - 1];
const tsb = parseFloat((todayLoad.ctl - todayLoad.atl).toFixed(1));

const recentHRVs = [...WINDOW].reverse().slice(0, 7).map((d) => d.hrv).filter((h): h is number => h != null);
const avgHRV7d = recentHRVs.reduce((a, b) => a + b, 0) / recentHRVs.length;
const currentHRV = [...WINDOW].reverse().find((d) => d.hrv != null)?.hrv ?? avgHRV7d;

const smartRecovery = SilverSprintLogic.getSmartRecoveryWindow(
  DEMO_AGE,
  { currentHRV, avgHRV7d },
  tsb,
  nfi,
);

export const mockAthleteData: AthleteData = {
  name: DEMO_NAME,
  age: DEMO_AGE,
  nfi,
  nfiStatus,
  todayVmax,
  avgVmax: parseFloat(avgVmax.toFixed(2)),
  recoveryHours: smartRecovery.hours,
  srs: smartRecovery.srs,
  tsb,
  staleVmax: smartRecovery.staleVmax,
  bodyWeightKg: DEMO_WEIGHT_KG,
};

/**
 * The 60-day chart series, built by the same function the live app uses — so
 * the demo shows genuine gaps on non-running days and a TSB that steps on
 * training days rather than gliding between them.
 */
export const mockDailyTimeSeries: DailyDataPoint[] = buildDailyTimeSeries(
  demoActivities,
  demoWellness,
  avgVmax,
  avgHRV7d,
  DEMO_AGE,
  TODAY,
);

// ── Race estimates ──────────────────────────────────────────────────────────

const raceInput: RaceEstimatorInput = {
  bestVmax60d: demoActivities.reduce((best, a) => Math.max(best, a.max_speed ?? 0), 0),
  avgVmax,
  nfi,
  nfiStatus,
  tsb,
  age: DEMO_AGE,
  activityCount: demoActivities.length,
  trainingIntervals: demoTrainingIntervals,
};

export const mockRaceEstimates: RaceEstimate[] = RaceEstimator.estimate(raceInput);

/** Shown alongside the current estimates whenever neural readiness is not green. */
export const mockRecoveredEstimates: RaceEstimate[] =
  nfiStatus !== 'green'
    ? RaceEstimator.estimate({ ...raceInput, nfi: 1.0, nfiStatus: 'green', tsb: 5 })
    : [];

// ── Upcoming race ───────────────────────────────────────────────────────────

const demoRace: SprintRaceEvent = {
  id: 'demo-race-1',
  name: 'County Masters Track Championships',
  date: (() => {
    const d = new Date(TODAY);
    d.setDate(d.getDate() + RACE_DAYS_AHEAD);
    return d.toISOString().slice(0, 10);
  })(),
  distanceM: 200,
  daysUntil: RACE_DAYS_AHEAD,
};

export const mockSprintRacePlans: SprintRacePlan[] = SprintRacePlanner.buildMultiRacePlans(
  [demoRace],
  raceInput.bestVmax60d,
  DEMO_AGE,
);

export const mockTrainingPlan: TrainingPlanContext | null = SprintTrainingPlan.buildContext(
  demoRace.daysUntil,
  demoRace.name,
  demoRace.distanceM,
  nfiStatus,
  nfi,
  tsb,
);
