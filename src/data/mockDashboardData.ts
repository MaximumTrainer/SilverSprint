/**
 * Realistic mock data for demo mode (unauthenticated users).
 * All values are plausible for a masters sprint athlete aged 52.
 */

import type { AthleteData } from '../components/Dashboard';
import type { DailyDataPoint } from '../domain/types';
import type { RaceEstimate } from '../domain/sprint/race-estimator';
import type { SprintRacePlan } from '../domain/sprint/race-plan';
import type { TrainingPlanContext } from '../domain/sprint/training-plan';
import { SprintTrainingPlan } from '../domain/sprint/training-plan';

// ── Athlete summary ───────────────────────────────────────────────

export const mockAthleteData: AthleteData = {
  name: 'Alex Runner',
  age: 52,
  nfi: 0.955,        // amber — slight CNS fatigue
  nfiStatus: 'amber',
  todayVmax: 8.62,   // m/s
  avgVmax: 9.03,     // m/s (30-day avg)
  recoveryHours: 36,
  srs: 68,
  tsb: -4.2,
  staleVmax: false,
  bodyWeightKg: 74.5,
};

// ── 90-day daily time-series ──────────────────────────────────────

function addDays(base: Date, n: number): string {
  const d = new Date(base);
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

function makeTimeSeries(): DailyDataPoint[] {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const points: DailyDataPoint[] = [];

  for (let i = -89; i <= 0; i++) {
    const date = addDays(today, i);
    const progress = (i + 89) / 89; // 0 → 1 over 90 days

    // Simulate a gradual HRV improvement trend with realistic noise
    const baseHrv = 48 + progress * 14;
    const hrv = parseFloat((baseHrv + (Math.sin(i * 0.7) * 3.5)).toFixed(1));

    // TSB: starts negative, improves toward race taper
    const baseTsb = -18 + progress * 22;
    const tsb = parseFloat((baseTsb + Math.sin(i * 0.4) * 4).toFixed(1));

    // NFI: follows HRV trend, amber range for recent days
    const baseNfi = 0.93 + progress * 0.05;
    const nfi = parseFloat(Math.min(1.03, baseNfi + Math.sin(i * 0.6) * 0.015).toFixed(3));

    const recoveryHours = tsb > 5 ? 24 : tsb > -5 ? 36 : 48;

    points.push({
      date,
      dayLabel: new Date(date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }),
      nfi,
      tsb,
      recoveryHours,
      hrv,
    });
  }

  return points;
}

export const mockDailyTimeSeries: DailyDataPoint[] = makeTimeSeries();

// ── Race estimates ────────────────────────────────────────────────

export const mockRaceEstimates: RaceEstimate[] = [
  {
    distance: 100,
    predictedTime: 13.42,
    display: '13.42',
    confidence: 'moderate',
    note: 'Based on 30-day Vmax avg and acceleration profile.',
    phases: { reaction: 0.18, acceleration: 4.85, maxVelocity: 8.39, deceleration: 0 },
  },
  {
    distance: 200,
    predictedTime: 28.71,
    display: '28.71',
    confidence: 'moderate',
    note: 'Speed endurance index applied to 200 m model.',
    phases: { reaction: 0.18, acceleration: 5.12, maxVelocity: 9.44, deceleration: 13.97 },
  },
  {
    distance: 400,
    predictedTime: 67.8,
    display: '1:07.80',
    confidence: 'low',
    note: 'Extrapolated — limited 400 m training data.',
    phases: { reaction: 0.18, acceleration: 5.22, maxVelocity: 11.2, deceleration: 51.2 },
  },
];

// Slightly faster recovered estimates (shown when nfiStatus is amber/red)
export const mockRecoveredEstimates: RaceEstimate[] = [
  {
    distance: 100,
    predictedTime: 12.98,
    display: '12.98',
    confidence: 'moderate',
    note: 'Predicted at green NFI (fully recovered CNS).',
    phases: { reaction: 0.18, acceleration: 4.72, maxVelocity: 8.08, deceleration: 0 },
  },
  {
    distance: 200,
    predictedTime: 27.85,
    display: '27.85',
    confidence: 'moderate',
    note: 'Predicted at green NFI.',
    phases: { reaction: 0.18, acceleration: 4.95, maxVelocity: 9.12, deceleration: 13.6 },
  },
  {
    distance: 400,
    predictedTime: 65.4,
    display: '1:05.40',
    confidence: 'low',
    note: 'Predicted at green NFI.',
    phases: { reaction: 0.18, acceleration: 5.1, maxVelocity: 10.92, deceleration: 49.2 },
  },
];

// ── Sprint race plans ─────────────────────────────────────────────

function raceDateFromNow(daysAhead: number): string {
  const d = new Date();
  d.setDate(d.getDate() + daysAhead);
  return d.toISOString().slice(0, 10);
}

export const mockSprintRacePlans: SprintRacePlan[] = [
  {
    race: {
      id: 'mock-race-1',
      name: 'County Masters Track Championships',
      date: raceDateFromNow(42),
      distanceM: 200,
      daysUntil: 42,
    },
    goalTime: '28.20',
    currentPhase: {
      label: 'Special Physical Preparation',
      timeframe: 'Weeks 5–8',
      focus: 'Speed endurance and lactate tolerance',
      sessions: [
        '3 × 150 m @ 92% with 8 min recovery',
        '4 × 60 m flying sprints from rolling start',
        'Tempo: 6 × 200 m @ 75% with 90 s rest',
      ],
      strengthNote: 'Plyometric emphasis — bounding, depth jumps 2× per week.',
    },
  },
];

// ── 12-week training plan context ─────────────────────────────────

// Generate a real plan context using the same logic as the live app,
// so the plan[] array is fully populated and the panel won't crash.
export const mockTrainingPlan: TrainingPlanContext | null =
  SprintTrainingPlan.buildContext(
    42,
    'County Masters Track Championships',
    200,
    mockAthleteData.nfiStatus,
    mockAthleteData.nfi,
    mockAthleteData.tsb,
  );
