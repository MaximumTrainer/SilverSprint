/**
 * 12-Week Sprint Training Plan — 100m to 400m Development
 *
 * Periodization structure:
 *   Weeks  1–4  General Physical Preparation (GPP)
 *             → Acceleration mechanics, tempo conditioning, aerobic base
 *   Weeks  5–8  Special Physical Preparation (SPP)
 *             → Speed endurance, lactate threshold, special endurance (200–300 m)
 *   Weeks  9–10 Pre-Competition
 *             → Race-specific speed, sharpening, controlled volume reduction
 *   Weeks 11–12 Competition / Taper
 *             → Speed maintenance, significant volume reduction, race prep
 *
 * When the athlete has a sprint race event in Intervals.icu within the next
 * 12 weeks, the plan automatically anchors to that date.  The system computes
 * the current plan week, selects today's session type, and generates an
 * NFI-adjusted workout in the same format as SprintWorkoutGenerator.
 */

import type { NFIStatus } from '../types';
import { SprintBlock, SprintWorkout } from './workouts';

/* ── Session types ─────────────────────────────────────────────── */

export type PlanSessionType =
  | 'acceleration'      // Short explosive sprints 10–60 m, block starts
  | 'tempo'             // Aerobic base 100–300 m @ 70–75 %
  | 'speed_endurance'   // Near-max 60–150 m, lactate tolerance
  | 'special_endurance' // Race-effort 150–300 m, 400 m specific
  | 'race_specific'     // 40–80 m at race pace + race simulation
  | 'rest';             // Recovery / off

export interface PlanDaySpec {
  sessionType: PlanSessionType;
  label: string;
  /** Indicative total run volume (informational) */
  volume: string;
  /** Coaching emphasis for the day */
  notes: string;
}

export type WeekDay = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun';

export interface PlanWeekSpec {
  week: number;
  /** 1-based plan week */
  phase: 'gpp' | 'spp' | 'pre_comp' | 'competition';
  phaseName: string;
  theme: string;
  schedule: Record<WeekDay, PlanDaySpec>;
}

/* ── Context passed at runtime ─────────────────────────────────── */

export interface TrainingPlanContext {
  /** Which plan week (1–12) the athlete is currently in */
  planWeek: number;
  /** Days remaining until the target race */
  daysUntilRace: number;
  /** Name of the target race */
  raceName: string;
  /** Distance of the target race in metres */
  raceDistanceM: number;
  phase: PlanWeekSpec['phase'];
  phaseName: string;
  weekTheme: string;
  /** Today's scheduled session */
  todaySpec: PlanDaySpec;
  /** Today's generated workout, adjusted for current NFI/TSB */
  todayWorkout: SprintWorkout;
  /** The full 12-week plan for display purposes */
  plan: PlanWeekSpec[];
  /** Whether the session was scaled down due to fatigue */
  nfiAdjusted: boolean;
  /** Human-readable note explaining any NFI adjustment */
  nfiAdjustmentNote: string;
}

/* ─────────────────────────────────────────────────────────────────
   12-WEEK PLAN DEFINITION
   ───────────────────────────────────────────────────────────────── */

const rest: PlanDaySpec = { sessionType: 'rest', label: 'Rest', volume: '—', notes: 'Full rest or light walking.' };

const PLAN_WEEKS: PlanWeekSpec[] = [
  /* ── GPP — Week 1: Foundation ─────────────────────────────────── */
  {
    week: 1, phase: 'gpp', phaseName: 'General Physical Preparation',
    theme: 'Foundation — establish acceleration mechanics and aerobic base',
    schedule: {
      mon: { sessionType: 'acceleration', label: 'Acceleration — Introductory', volume: '200 m', notes: 'Standing starts only; focus on shin angle and first 10 m drive.' },
      tue: { sessionType: 'tempo',        label: 'Tempo — Aerobic Base',        volume: '1200 m', notes: '4 × 300 m @ 70 %; long recoveries. Conversational pace.' },
      wed: rest,
      thu: { sessionType: 'acceleration', label: 'Acceleration — Technical',    volume: '180 m', notes: 'Falling starts and 3-point stance. Emphasise front-side mechanics.' },
      fri: { sessionType: 'tempo',        label: 'Tempo — Steady State',        volume: '1000 m', notes: '5 × 200 m @ 72 %; 90 s walk recovery. Build aerobic base for 400 m.' },
      sat: rest,
      sun: rest,
    },
  },
  /* ── GPP — Week 2: Building Acceleration ─────────────────────── */
  {
    week: 2, phase: 'gpp', phaseName: 'General Physical Preparation',
    theme: 'Building — extend acceleration distance and tempo volume',
    schedule: {
      mon: { sessionType: 'acceleration', label: 'Acceleration — 30 m Sets',   volume: '240 m', notes: 'Blocks or 3-point; 6 × 30 m. Aggressive drive phase.' },
      tue: { sessionType: 'tempo',        label: 'Tempo — Volume Build',        volume: '1400 m', notes: '7 × 200 m @ 73 %; 90 s recoveries.' },
      wed: rest,
      thu: { sessionType: 'acceleration', label: 'Flying Sprints — 20 m',       volume: '200 m', notes: '8 × 20 m fly with 20 m run-in; focus on top-speed mechanics.' },
      fri: { sessionType: 'tempo',        label: 'Tempo — Lactate Steady',      volume: '1200 m', notes: '4 × 300 m @ 75 %; 2 min recoveries.' },
      sat: rest,
      sun: rest,
    },
  },
  /* ── GPP — Week 3: Acceleration + Speed Intro ────────────────── */
  {
    week: 3, phase: 'gpp', phaseName: 'General Physical Preparation',
    theme: 'Speed Introduction — first full 60 m efforts alongside tempo',
    schedule: {
      mon: { sessionType: 'acceleration', label: 'Acceleration — 40 m Sets',   volume: '280 m', notes: '7 × 40 m from blocks; full recovery between reps.' },
      tue: { sessionType: 'tempo',        label: 'Tempo — Extended',            volume: '1600 m', notes: '4 × 400 m @ 73 %; 3 min recoveries. Core 400 m aerobic conditioning.' },
      wed: rest,
      thu: { sessionType: 'speed_endurance', label: 'Speed Endurance — Intro', volume: '300 m', notes: '3 × 80 m @ 90 %; 5 min full recovery. Introduce lactate stress.' },
      fri: { sessionType: 'tempo',        label: 'Tempo — Race Shape',         volume: '1000 m', notes: '5 × 200 m @ 75 %; 90 s recoveries.' },
      sat: rest,
      sun: rest,
    },
  },
  /* ── GPP — Week 4: GPP Peak + Mini-Test ─────────────────────── */
  {
    week: 4, phase: 'gpp', phaseName: 'General Physical Preparation',
    theme: 'GPP Peak — consolidate gains; time trial or max-effort run',
    schedule: {
      mon: { sessionType: 'acceleration', label: 'Acceleration — Block Starts', volume: '300 m', notes: '6 × 40 m + 2 × 60 m from blocks; full 5 min recovery.' },
      tue: { sessionType: 'tempo',        label: 'Tempo — Volume Peak',         volume: '1600 m', notes: '8 × 200 m @ 75 %; 90 s recoveries.' },
      wed: rest,
      thu: { sessionType: 'speed_endurance', label: 'Speed Endurance — 100 m', volume: '400 m', notes: '4 × 100 m @ 93 %; 6 min recovery. First true lactate session.' },
      fri: rest,
      sat: { sessionType: 'race_specific', label: 'Time Trial — Race Distance', volume: '400 m', notes: 'Single maximal effort at race distance. Gauge baseline fitness.' },
      sun: rest,
    },
  },

  /* ── SPP — Week 5: Speed Endurance Base ─────────────────────── */
  {
    week: 5, phase: 'spp', phaseName: 'Special Physical Preparation',
    theme: 'Speed Endurance Base — develop lactate buffering capacity',
    schedule: {
      mon: { sessionType: 'acceleration', label: 'Acceleration — Speed Priming', volume: '240 m', notes: '6 × 40 m blocks + 2 × 30 m fly. CNS activation before midweek volume.' },
      tue: { sessionType: 'speed_endurance', label: 'Speed Endurance — 100–120 m', volume: '500 m', notes: '5 × 100 m @ 93–95 %; 7 min recovery. Controlled aggression.' },
      wed: rest,
      thu: { sessionType: 'special_endurance', label: 'Special Endurance — 200 m', volume: '600 m', notes: '3 × 200 m @ 90 %; 10 min recovery. Race-effort conditioning.' },
      fri: { sessionType: 'tempo',        label: 'Tempo — Active Recovery Run',  volume: '800 m', notes: '4 × 200 m @ 70 %; flush lactate from Thursday.' },
      sat: rest,
      sun: rest,
    },
  },
  /* ── SPP — Week 6: Speed Endurance Build ─────────────────────── */
  {
    week: 6, phase: 'spp', phaseName: 'Special Physical Preparation',
    theme: 'Speed Endurance Build — extend distance, maintain intensity',
    schedule: {
      mon: { sessionType: 'acceleration', label: 'Acceleration — Max Velocity', volume: '300 m', notes: '4 × 40 m + 4 × 30 m fly; peak acceleration session.' },
      tue: { sessionType: 'speed_endurance', label: 'Speed Endurance — 120–150 m', volume: '600 m', notes: '4 × 120 m @ 93 % + 1 × 150 m @ 90 %; 8 min recovery.' },
      wed: rest,
      thu: { sessionType: 'special_endurance', label: 'Special Endurance — 200–300 m', volume: '700 m', notes: '2 × 200 m + 1 × 300 m @ 88 %; 12 min recovery. Build 400 m capacity.' },
      fri: { sessionType: 'tempo',        label: 'Tempo — Flush',               volume: '1000 m', notes: '5 × 200 m @ 70 %; easy recovery pace.' },
      sat: rest,
      sun: rest,
    },
  },
  /* ── SPP — Week 7: Lactate Peak ──────────────────────────────── */
  {
    week: 7, phase: 'spp', phaseName: 'Special Physical Preparation',
    theme: 'Lactate Peak — highest intensity week of the plan',
    schedule: {
      mon: { sessionType: 'acceleration', label: 'Acceleration — Race Pace Starts', volume: '240 m', notes: '4 × 40 m hard + 2 × 60 m near-race pace from blocks.' },
      tue: { sessionType: 'speed_endurance', label: 'Speed Endurance — 150 m Sets', volume: '600 m', notes: '4 × 150 m @ 92–95 %; 10 min recovery. Peak lactate session.' },
      wed: rest,
      thu: { sessionType: 'special_endurance', label: 'Special Endurance — 300 m', volume: '900 m', notes: '3 × 300 m @ 88–90 %; 15 min recovery. Brutal but essential for 400 m.' },
      fri: rest,
      sat: { sessionType: 'tempo',        label: 'Tempo — Recovery',             volume: '800 m', notes: '4 × 200 m @ 68 %; absolute flush, no fatigue accumulation.' },
      sun: rest,
    },
  },
  /* ── SPP — Week 8: Transition / Deload ───────────────────────── */
  {
    week: 8, phase: 'spp', phaseName: 'Special Physical Preparation',
    theme: 'SPP Deload — reduce volume 20 %, maintain intensity; absorb adaptations',
    schedule: {
      mon: { sessionType: 'acceleration', label: 'Acceleration — Technical Refresh', volume: '200 m', notes: '5 × 30 m from blocks; sharp and controlled, not maximal.' },
      tue: { sessionType: 'speed_endurance', label: 'Speed Endurance — Reduced', volume: '400 m', notes: '3 × 120 m @ 92 %; 8 min recovery. Quality over quantity.' },
      wed: rest,
      thu: { sessionType: 'special_endurance', label: 'Special Endurance — 200 m', volume: '400 m', notes: '2 × 200 m @ 90 %; 12 min recovery. Consolidation.' },
      fri: rest,
      sat: rest,
      sun: rest,
    },
  },

  /* ── Pre-Comp — Week 9: Race-Specific Speed ───────────────────── */
  {
    week: 9, phase: 'pre_comp', phaseName: 'Pre-Competition',
    theme: 'Race-Specific Speed — sharpen pace feel at target race intensity',
    schedule: {
      mon: { sessionType: 'race_specific', label: 'Race-Specific — Flying 60 m', volume: '300 m', notes: '5 × 60 m @ race pace; full 6 min recovery. Tune neuromuscular readiness.' },
      tue: { sessionType: 'tempo',         label: 'Tempo — Controlled',          volume: '800 m', notes: '4 × 200 m @ 72 %; light, non-fatiguing.' },
      wed: rest,
      thu: { sessionType: 'speed_endurance', label: 'Speed Endurance — Sharpening', volume: '400 m', notes: '3 × 120 m @ 95 %; full recovery. Maintain lactate tolerance without peak fatigue.' },
      fri: rest,
      sat: { sessionType: 'race_specific', label: 'Race Simulation — Split 200 m', volume: '400 m', notes: '2 × 200 m at race split target pace; 15 min recovery.' },
      sun: rest,
    },
  },
  /* ── Pre-Comp — Week 10: Final Sharpening ────────────────────── */
  {
    week: 10, phase: 'pre_comp', phaseName: 'Pre-Competition',
    theme: 'Final Sharpening — peak speed, reduce volume further',
    schedule: {
      mon: { sessionType: 'acceleration', label: 'Acceleration — Block Sharpener', volume: '180 m', notes: '6 × 30 m blocks at 100 %; perfect execution focus.' },
      tue: { sessionType: 'tempo',        label: 'Tempo — Light',                 volume: '600 m', notes: '3 × 200 m @ 70 %; easy flush.' },
      wed: rest,
      thu: { sessionType: 'race_specific', label: 'Race Simulation — 300 m',     volume: '300 m', notes: '1 × 300 m at 97 % effort; 20 min recovery, then home.' },
      fri: rest,
      sat: rest,
      sun: rest,
    },
  },

  /* ── Competition — Week 11: Taper ────────────────────────────── */
  {
    week: 11, phase: 'competition', phaseName: 'Competition',
    theme: 'Taper — volume drops 40 %, intensity maintained; feel the pop',
    schedule: {
      mon: { sessionType: 'acceleration', label: 'Acceleration — Speed Freshen', volume: '150 m', notes: '5 × 30 m from blocks; light, fast, and controlled.' },
      tue: rest,
      wed: { sessionType: 'race_specific', label: 'Race Pace — Flying 40 m',    volume: '200 m', notes: '5 × 40 m fly at race pace; 6 min recovery. Feel the speed.' },
      thu: rest,
      fri: { sessionType: 'tempo',        label: 'Tempo — Activation',          volume: '400 m', notes: '2 × 200 m @ 70 %; legs awake, not taxed.' },
      sat: rest,
      sun: rest,
    },
  },
  /* ── Competition — Week 12: Race Week ────────────────────────── */
  {
    week: 12, phase: 'competition', phaseName: 'Competition',
    theme: 'Race Week — minimal training, maximum freshness',
    schedule: {
      mon: { sessionType: 'acceleration', label: 'Acceleration — Pop Session',  volume: '120 m', notes: '4 × 30 m at race pace; sharp starts, stop there.' },
      tue: rest,
      wed: { sessionType: 'race_specific', label: 'Race Prep — 2 × 60 m',      volume: '120 m', notes: '2 × 60 m at race pace; 10 min recovery. Race-day neural priming.' },
      thu: rest,
      fri: rest,
      sat: { sessionType: 'race_specific', label: '🏁 RACE DAY',               volume: 'Race', notes: 'Execute your race plan. Trust your preparation.' },
      sun: rest,
    },
  },
];

/* ─────────────────────────────────────────────────────────────────
   WORKOUT GENERATORS — one per PlanSessionType
   ───────────────────────────────────────────────────────────────── */

function formatPlanDescription(
  sessionLabel: string,
  phaseLabel: string,
  planWeek: number,
  warmup: string[],
  mainSet: SprintBlock[],
  cooldown: string[],
  volume: string,
): string {
  const lines: string[] = [];
  lines.push(`🏃 SilverSprint — Week ${planWeek} / ${phaseLabel}`);
  lines.push(`📋 ${sessionLabel}`);
  lines.push('');
  lines.push('Warmup');
  lines.push('');
  for (const w of warmup) lines.push(w);
  lines.push('');
  lines.push('Main Set');
  lines.push('');
  for (const b of mainSet) {
    lines.push(b.name);
    if (b.reps > 1) lines.push(`${b.reps}x`);
    lines.push(`  ${b.distance} @ ${b.intensity}  — rest: ${b.rest}`);
    if (b.cue) lines.push(`  ↳ ${b.cue}`);
    lines.push('');
  }
  lines.push('Cooldown');
  lines.push('');
  for (const c of cooldown) lines.push(c);
  lines.push('');
  lines.push(`Total volume: ${volume}`);
  return lines.join('\n');
}

function makeWorkout(
  name: string,
  status: NFIStatus,
  rationale: string,
  warmup: string[],
  mainSet: SprintBlock[],
  cooldown: string[],
  volume: string,
  planWeek: number,
  phaseName: string,
  label: string,
): SprintWorkout {
  return {
    name,
    status,
    rationale,
    warmup,
    mainSet,
    cooldown,
    totalSprintVolume: volume,
    workoutDescription: formatPlanDescription(label, phaseName, planWeek, warmup, mainSet, cooldown, volume),
  };
}

/** Scale a reps count down for NFI-adjusted (amber/red) sessions */
function scaleReps(reps: number, factor: number): number {
  return Math.max(1, Math.round(reps * factor));
}

class PlanSessionGenerators {
  static acceleration(week: number, phaseName: string, label: string, nfiStatus: NFIStatus): SprintWorkout {
    const isGPP = week <= 4;
    const isComp = week >= 11;

    const warmup = [
      '10 min easy jog',
      'Dynamic stretching — leg swings, walking lunges, high knees',
      '3 × 60 m progressive build-ups (60 %, 75 %, 90 %)',
    ];
    const cooldown = ['10 min easy jog', 'Static stretching — hamstrings, hip flexors, calves (30 s holds)'];

    let mainSet: SprintBlock[] = isComp
      ? [
          { name: 'Pop Starts', reps: 4, distance: '30 m', rest: '4 min walk-back', intensity: '100 %', cue: 'Maximum first-step explosion. Stop at 30 m — quality not quantity.' },
          { name: 'Flying 20 m', reps: 3, distance: '20 m (15 m run-in)', rest: '4 min walk-back', intensity: '100 %', cue: 'Race-pace feel through the fly zone. Relaxed face, fast feet.' },
        ]
      : isGPP
      ? [
          { name: 'Standing Starts', reps: 5, distance: '30 m', rest: '3 min walk-back', intensity: '90–95 %', cue: 'Aggressive shin angle on first step. Drive for 20 m then relax.' },
          { name: 'Block / 3-Point Starts', reps: 4, distance: '40 m', rest: '4 min walk-back', intensity: '95 %', cue: 'Front-side mechanics — high knee, active foot contact, tall hips.' },
          { name: 'Flying 20 m', reps: 3, distance: '20 m (15 m run-in)', rest: '3 min walk-back', intensity: '97 %', cue: 'Transition to top-speed mechanics — relaxed, tall, long strides.' },
        ]
      : [
          { name: 'Block Starts', reps: 4, distance: '40 m', rest: '4 min walk-back', intensity: '100 %', cue: 'Explosive drive phase; transition upright by 30 m.' },
          { name: 'Flying 30 m', reps: 4, distance: '30 m (20 m run-in)', rest: '4 min walk-back', intensity: '100 %', cue: 'Hit peak speed in the run-in; hold mechanics through the gate.' },
        ];

    // NFI adjustment
    if (nfiStatus !== 'green') {
      const factor = nfiStatus === 'amber' ? 0.75 : 0.6;
      mainSet = mainSet.map(b => ({ ...b, reps: scaleReps(b.reps, factor) }));
    }

    const totalDist = mainSet.reduce((sum, b) => sum + b.reps * parseInt(b.distance), 0);
    const volume = `~${totalDist} m`;

    return makeWorkout('Acceleration Session', 'green', `Week ${week} — ${phaseName}. Acceleration development.`, warmup, mainSet, cooldown, volume, week, phaseName, label);
  }

  static tempo(week: number, phaseName: string, label: string, nfiStatus: NFIStatus): SprintWorkout {
    const warmup = ['8 min easy jog', 'Dynamic stretching circuit'];
    const cooldown = ['5 min easy jog', 'Light static stretching'];

    const baseReps = week <= 4 ? 4 : week <= 8 ? 5 : 3;
    const pct = week <= 4 ? '70–73 %' : '72–75 %';
    const dist = week <= 4 ? '200 m' : week <= 8 ? '200 m' : '200 m';
    const reps = nfiStatus === 'green' ? baseReps : nfiStatus === 'amber' ? Math.max(2, baseReps - 1) : 2;

    const mainSet: SprintBlock[] = [
      {
        name: 'Tempo Runs', reps,
        distance: dist, rest: '90 s walk recovery',
        intensity: pct,
        cue: 'Conversational pace — you should be able to speak. Consistent rhythm throughout.',
      },
    ];

    const totalM = reps * parseInt(dist);
    return makeWorkout('Tempo Run Session', 'green', `Week ${week} — aerobic base for 400 m conditioning.`, warmup, mainSet, cooldown, `~${totalM} m`, week, phaseName, label);
  }

  static speedEndurance(week: number, phaseName: string, label: string, nfiStatus: NFIStatus): SprintWorkout {
    const warmup = [
      '10 min easy jog',
      'Dynamic stretching circuit',
      '3 × 60 m progressive build-ups (65 %, 80 %, 90 %)',
      '2 min rest before main set',
    ];
    const cooldown = ['10 min easy jog', 'Static stretching + foam roll'];

    const distM = week <= 6 ? 100 : week <= 8 ? 120 : 150;
    const pct = week <= 5 ? '90–93 %' : week <= 7 ? '93–95 %' : '92–95 %';
    const baseReps = week <= 5 ? 4 : week <= 7 ? 5 : 4;
    const rest = `${week <= 6 ? 6 : 8} min full recovery`;
    const reps = nfiStatus === 'green' ? baseReps : nfiStatus === 'amber' ? Math.max(2, baseReps - 1) : 2;

    const mainSet: SprintBlock[] = [
      {
        name: 'Speed Endurance Runs', reps,
        distance: `${distM} m`, rest,
        intensity: pct,
        cue: 'Start controlled — don\'t die in the last 20 m. Maintain form throughout. Shake out between reps.',
      },
    ];

    const totalM = reps * distM;
    return makeWorkout('Speed Endurance Session', nfiStatus === 'red' ? 'amber' : nfiStatus, `Week ${week} — lactate tolerance development.`, warmup, mainSet, cooldown, `~${totalM} m`, week, phaseName, label);
  }

  static specialEndurance(week: number, phaseName: string, label: string, nfiStatus: NFIStatus): SprintWorkout {
    const warmup = [
      '12 min easy jog',
      'Dynamic stretching circuit',
      '4 × 80 m progressive build-ups (60 %, 70 %, 80 %, 85 %)',
      '3 min rest before main set',
    ];
    const cooldown = ['10 min easy jog', 'Extended static stretching (40 s holds)', 'Foam roll — quads, hamstrings, glutes'];

    const distM = week <= 6 ? 200 : week <= 7 ? 300 : 200;
    const pct = week <= 6 ? '88–90 %' : '90 %';
    const baseReps = week <= 6 ? 3 : week === 7 ? 3 : 2;
    const recoveryMin = week <= 6 ? 10 : 15;
    const reps = nfiStatus === 'green' ? baseReps : nfiStatus === 'amber' ? Math.max(1, baseReps - 1) : 1;

    const mainSet: SprintBlock[] = [
      {
        name: 'Special Endurance Runs', reps,
        distance: `${distM} m`, rest: `${recoveryMin} min full recovery`,
        intensity: pct,
        cue: `Controlled aggression from the gun. For ${distM} m: go out in 47–48 s per 100 m, hold your form in the final ${Math.round(distM * 0.35)} m.`,
      },
    ];

    const totalM = reps * distM;
    return makeWorkout('Special Endurance Session', nfiStatus === 'green' ? 'amber' : 'red', `Week ${week} — 400 m specific race conditioning.`, warmup, mainSet, cooldown, `~${totalM} m`, week, phaseName, label);
  }

  static raceSpecific(week: number, phaseName: string, label: string, nfiStatus: NFIStatus, raceDistanceM: number): SprintWorkout {
    const warmup = [
      '12 min easy jog',
      'Dynamic stretching circuit — emphasise hip flexors and hamstrings',
      '4 × 60 m progressive build-ups (65 %, 78 %, 88 %, 95 %)',
      '5 min rest — shake out, stay loose',
    ];
    const cooldown = ['10 min easy jog', 'Static stretching (30 s holds)', 'Mental debrief — what felt right?'];

    const is400 = raceDistanceM >= 300;
    const is200 = raceDistanceM >= 150 && raceDistanceM < 300;

    const baseReps = week >= 12 ? 2 : week >= 11 ? 4 : 5;
    const reps = nfiStatus === 'green' ? baseReps : nfiStatus === 'amber' ? Math.max(1, baseReps - 1) : 1;

    const mainSet: SprintBlock[] = is400
      ? [
          {
            name: `Race-Pace 60 m Fly (${raceDistanceM} m prep)`, reps,
            distance: '60 m (20 m run-in)', rest: '6 min full recovery',
            intensity: '100 %',
            cue: 'Run at your target race pace. Feel the rhythm — you\'ll run this speed in competition. Execute, don\'t strain.',
          },
          {
            name: 'Simulated 200 m Split', reps: Math.max(1, Math.round(reps / 2)),
            distance: '200 m', rest: '15 min recovery',
            intensity: '95–97 %',
            cue: `Target first 200 m split for your ${raceDistanceM} m goal. Even pace — don't sprint the first 100 m.`,
          },
        ]
      : is200
      ? [
          {
            name: 'Race-Pace Flying 40 m', reps,
            distance: '40 m fly (20 m run-in)', rest: '6 min recovery',
            intensity: '100 %',
            cue: 'Absolute race pace. Feel what 200 m speed is like in your legs.',
          },
        ]
      : [
          {
            name: 'Race-Pace Flying 30 m', reps,
            distance: '30 m fly (20 m run-in)', rest: '5 min recovery',
            intensity: '100 %',
            cue: 'Max velocity. This is faster than race pace — sharpen the CNS.',
          },
        ];

    const totalM = mainSet.reduce((sum, b) => sum + b.reps * parseInt(b.distance), 0);
    return makeWorkout(`Race-Specific Session — ${raceDistanceM} m Prep`, 'green', `Week ${week} — race-specific sharpening at competition pace.`, warmup, mainSet, cooldown, `~${totalM} m`, week, phaseName, label);
  }

  static recovery(planWeek: number, phaseName: string, label: string): SprintWorkout {
    return makeWorkout(
      'Plan Recovery Day',
      'red',
      `Week ${planWeek} — scheduled rest day. Prioritise sleep, nutrition, and mobility.`,
      ['5 min easy walk'],
      [
        { name: 'Active Recovery Walk', reps: 1, distance: '20 min', rest: 'N/A', intensity: 'Very Low', cue: 'Easy pace. No effort. Focus on breathing.' },
        { name: 'Mobility Circuit', reps: 2, distance: '10 min', rest: 'Continuous', intensity: 'Low', cue: 'Hip flexors, hamstrings, ankles. Gentle, not ballistic.' },
      ],
      ['Foam rolling — quads, hamstrings, glutes (10 min)'],
      '0 m sprint',
      planWeek,
      phaseName,
      label,
    );
  }
}

/* ─────────────────────────────────────────────────────────────────
   MAIN EXPORT — Training Plan Engine
   ───────────────────────────────────────────────────────────────── */

export class SprintTrainingPlan {
  /** Full 12-week plan definition */
  static readonly PLAN = PLAN_WEEKS;

  /**
   * Determine which week of the 12-week plan the athlete is in.
   * The plan is anchored so that Week 12 ends on race day.
   *
   * @returns 1–12, or null if race is outside the plan window (>84 days away)
   */
  static getPlanWeek(daysUntilRace: number): number | null {
    if (daysUntilRace < 0 || daysUntilRace > 84) return null;
    // Week 12 = final 7 days before race; Week 1 = days 78–84
    return Math.max(1, Math.min(12, 12 - Math.floor(daysUntilRace / 7)));
  }

  /** Map a JS Date day-of-week to a WeekDay key (0=Sun) */
  static getTodayWeekDay(): WeekDay {
    const days: WeekDay[] = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
    return days[new Date().getDay()];
  }

  /**
   * Generate a full TrainingPlanContext for display on the Dashboard.
   * Returns null when no event is within the plan window.
   */
  static buildContext(
    daysUntilRace: number,
    raceName: string,
    raceDistanceM: number,
    nfiStatus: NFIStatus,
    nfi: number,
    tsb: number,
  ): TrainingPlanContext | null {
    const planWeek = this.getPlanWeek(daysUntilRace);
    if (planWeek === null) return null;

    const weekSpec = PLAN_WEEKS[planWeek - 1];
    const todayKey = this.getTodayWeekDay();
    const todaySpec = weekSpec.schedule[todayKey];

    // NFI adjustment logic
    const stale = (nfiStatus === 'red' || nfiStatus === 'amber') && tsb >= 0;
    let nfiAdjusted = false;
    let nfiAdjustmentNote = '';

    // For rest days, no adjustment needed
    if (todaySpec.sessionType !== 'rest') {
      if (nfiStatus === 'red' && !stale) {
        nfiAdjusted = true;
        nfiAdjustmentNote = `NFI at ${(nfi * 100).toFixed(1)} % — significant neural fatigue. Today's ${todaySpec.label} has been converted to a recovery session. Return to plan tomorrow.`;
      } else if (nfiStatus === 'amber' && !stale) {
        nfiAdjusted = true;
        nfiAdjustmentNote = `NFI at ${(nfi * 100).toFixed(1)} % — mild CNS suppression. Volume reduced by ~25 % for today's session.`;
      } else if (stale) {
        nfiAdjusted = true;
        nfiAdjustmentNote = `NFI at ${(nfi * 100).toFixed(1)} % but TSB is positive — detraining detected. Today's session is kept but scaled for re-activation.`;
      }
    }

    // Generate the workout
    const todayWorkout = this.generateWorkout(todaySpec, planWeek, weekSpec.phaseName, nfiStatus, nfi, tsb, raceDistanceM);

    return {
      planWeek,
      daysUntilRace,
      raceName,
      raceDistanceM,
      phase: weekSpec.phase,
      phaseName: weekSpec.phaseName,
      weekTheme: weekSpec.theme,
      todaySpec,
      todayWorkout,
      plan: PLAN_WEEKS,
      nfiAdjusted,
      nfiAdjustmentNote,
    };
  }

  private static generateWorkout(
    spec: PlanDaySpec,
    planWeek: number,
    phaseName: string,
    nfiStatus: NFIStatus,
    _nfi: number,
    tsb: number,
    raceDistanceM: number,
  ): SprintWorkout {
    const stale = (nfiStatus === 'red' || nfiStatus === 'amber') && tsb >= 0;
    // For truly fatigued (not stale), convert quality sessions to recovery
    const effectiveStatus: NFIStatus = (nfiStatus === 'red' && !stale) ? 'red' : nfiStatus;

    switch (spec.sessionType) {
      case 'acceleration':
        if (nfiStatus === 'red' && !stale) return PlanSessionGenerators.recovery(planWeek, phaseName, spec.label);
        return PlanSessionGenerators.acceleration(planWeek, phaseName, spec.label, effectiveStatus);

      case 'tempo':
        return PlanSessionGenerators.tempo(planWeek, phaseName, spec.label, effectiveStatus);

      case 'speed_endurance':
        if (nfiStatus === 'red' && !stale) return PlanSessionGenerators.recovery(planWeek, phaseName, spec.label);
        return PlanSessionGenerators.speedEndurance(planWeek, phaseName, spec.label, effectiveStatus);

      case 'special_endurance':
        if (nfiStatus === 'red' && !stale) return PlanSessionGenerators.recovery(planWeek, phaseName, spec.label);
        return PlanSessionGenerators.specialEndurance(planWeek, phaseName, spec.label, effectiveStatus);

      case 'race_specific':
        if (nfiStatus === 'red' && !stale) return PlanSessionGenerators.recovery(planWeek, phaseName, spec.label);
        return PlanSessionGenerators.raceSpecific(planWeek, phaseName, spec.label, effectiveStatus, raceDistanceM);

      case 'rest':
      default:
        return PlanSessionGenerators.recovery(planWeek, phaseName, spec.label);
    }
  }
}

/** Human-readable phase badge label */
export function phaseBadgeLabel(phase: PlanWeekSpec['phase']): string {
  switch (phase) {
    case 'gpp': return 'GPP';
    case 'spp': return 'SPP';
    case 'pre_comp': return 'Pre-Comp';
    case 'competition': return 'Competition';
  }
}

/** Session type short label for weekly calendar display */
export function sessionTypeLabel(type: PlanSessionType): string {
  switch (type) {
    case 'acceleration':      return 'Accel';
    case 'tempo':             return 'Tempo';
    case 'speed_endurance':   return 'SpEnd';
    case 'special_endurance': return 'SpecEnd';
    case 'race_specific':     return 'Race';
    case 'rest':              return 'Rest';
  }
}
