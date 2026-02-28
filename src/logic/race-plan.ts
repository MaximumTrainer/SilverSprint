import { AGE_DEGRADATION_PER_YEAR } from './race-estimator';

/** A scheduled race event fetched from Intervals.icu */
export interface SprintRaceEvent {
  id: string;
  name: string;
  /** YYYY-MM-DD */
  date: string;
  /** Distance in metres (< 800) */
  distanceM: number;
  daysUntil: number;
}

export interface RacePlanPhase {
  label: string;
  timeframe: string;
  focus: string;
  sessions: string[];
  strengthNote: string;
}

/**
 * Context added to secondary races (i.e. not the nearest) to explain
 * how training for this race is shaped around the priority race.
 */
export interface PriorRaceContext {
  /** The nearest race that currently takes training priority */
  priorityRaceName: string;
  priorityRaceDate: string;
  priorityRaceDaysUntil: number;
  priorityPhaseLabel: string;
  /** Masters recovery days estimated after the priority race */
  recoveryDaysAfter: number;
  /**
   * Training days available between priority race recovery and this race.
   * = daysUntil(this) − daysUntil(priority) − recoveryDays
   */
  effectiveTrainingDays: number;
  /** Phase that will apply once the athlete has recovered from the priority race */
  postRecoveryPhase: RacePlanPhase;
  /**
   * true when priority race is ≤14 days away and its taper conflicts with
   * independent high-intensity work for this race.
   */
  isConstrained: boolean;
}

export interface SprintRacePlan {
  race: SprintRaceEvent;
  /** Formatted predicted finish time */
  goalTime: string;
  /**
   * Current training phase.
   * For secondary races: reflects the priority-race constraint if isConstrained.
   */
  currentPhase: RacePlanPhase;
  /** Populated for every race after the nearest one. */
  priorRaceContext?: PriorRaceContext;
}

/**
 * Generates phase-appropriate, mutually-compatible training plans for all
 * upcoming sprint races.
 *
 * Phase thresholds (days until race):
 *   Build         (> 28d): Max velocity development + full strength block
 *   Sharpen      (14–28d): Speed specificity + moderate strength
 *   Race-Specific (7–14d): Race-pace efforts, taper begins
 *   Final Taper    (3–7d): Volume drop, sharpening
 *   Race Prep       (≤3d): CNS rest, activation strides only
 *
 * Multi-race logic:
 *   The nearest race is the master constraint.  When that race is ≤14d away
 *   (taper), later races must defer — their current phase is replaced by a
 *   "Deferred — supporting [Race 1] taper" note and the post-recovery
 *   phase is shown as the actionable future plan.  When the nearest race is
 *   still in the Build window (>28d), all races share the same build focus
 *   and are flagged as "complementary".
 */
export class SprintRacePlanner {
  private static readonly PHASES: Array<{
    maxDays: number;
    label: string;
    timeframe: string;
    focus: string;
    sessions: string[];
    strengthNote: string;
  }> = [
    {
      maxDays: 3,
      label: 'Race Prep',
      timeframe: '1–3 days out',
      focus: 'Stay sharp — rest CNS, no max efforts',
      sessions: [
        '2–3 × 30m accelerations at 80%',
        'Activation strides only, no near-maximal work',
        'Full race warm-up protocol rehearsal',
      ],
      strengthNote: 'No strength work — full CNS rest',
    },
    {
      maxDays: 7,
      label: 'Final Taper',
      timeframe: '4–7 days out',
      focus: 'Reduce volume, maintain sharpness',
      sessions: [
        '3 × 30m block starts at 95%',
        '2 × 60m build-up runs',
        'Technical drills: A-skips, B-skips, wickets',
      ],
      strengthNote: 'Bodyweight plyometrics only (pogo jumps, hurdle hops)',
    },
    {
      maxDays: 14,
      label: 'Race-Specific',
      timeframe: '1–2 weeks out',
      focus: 'Race-pace efforts + taper begins',
      sessions: [
        '4 × race-distance at 90–95%',
        'Block start practice: 6 × 20m',
        'Speed endurance: 2 × 150m @ 85%',
      ],
      strengthNote: 'Strength maintenance: 2 sets only, reduce volume 40%',
    },
    {
      maxDays: 28,
      label: 'Sharpen',
      timeframe: '2–4 weeks out',
      focus: 'Speed development & event specificity',
      sessions: [
        '5 × 60m flying starts at 95%',
        '3 × race distance at 90%',
        'Speed endurance: 2–3 × 200m at 85%',
      ],
      strengthNote: 'Moderate strength: plyometrics + power lifts at 75%',
    },
    {
      maxDays: Infinity,
      label: 'Build',
      timeframe: '4+ weeks out',
      focus: 'Max velocity development & strength base',
      sessions: [
        '6 × 30m acceleration sprints',
        '3 × 60m max velocity (flying start)',
        'Flying 30s: 4–5 reps at >95%',
      ],
      strengthNote: 'Full strength block: max effort lifts at 85–90%',
    },
  ];

  /** Constrained current phase used while deferring to a nearer race's taper */
  private static readonly DEFERRED_PHASE: RacePlanPhase = {
    label: 'Deferred',
    timeframe: 'Until prior race',
    focus: 'Support primary race taper — no conflicting high-intensity work',
    sessions: [
      'Short acceleration strides only (20–30m)',
      'Technical drills at low intensity',
      'Active recovery: mobility & easy running',
    ],
    strengthNote: 'Bodyweight mobility only — no heavy lifting while in taper for prior race',
  };

  /** Build phase note used when both races are >28d and share the same block */
  private static readonly COMPLEMENTARY_BUILD_NOTE =
    'Build phase serves both races — Vmax development transfers directly.';

  static getPhase(daysUntil: number): RacePlanPhase {
    const phase = this.PHASES.find((p) => daysUntil <= p.maxDays)!;
    return {
      label: phase.label,
      timeframe: phase.timeframe,
      focus: phase.focus,
      sessions: [...phase.sessions],
      strengthNote: phase.strengthNote,
    };
  }

  /** Masters sprint recovery days after a race of a given distance */
  static recoveryDays(distanceM: number): number {
    if (distanceM <= 100) return 4;
    if (distanceM <= 200) return 5;
    if (distanceM <= 400) return 7;
    return 9; // 400–800m
  }

  /**
   * Predict finish time for any sprint distance using Vmax + age adjustment.
   *
   * NOTE: This is a simplified model used for race-plan goal times.
   * It differs from RaceEstimator.estimate() in race-estimator.ts, which uses:
   *   - Dynamic sustain fractions adjusted by training profile (speed endurance index)
   *   - Flying velocity blending
   *   - NFI/TSB readiness modifiers
   *   - Phase breakdowns (reaction, acceleration, max velocity, deceleration)
   *
   * This model covers additional distances (60m, 600m+) and produces a simple
   * formatted string for display in race plan cards, without readiness adjustments
   * — representing the athlete's best-case capability for goal-setting.
   */
  static estimateRaceTime(distanceM: number, bestVmax: number, age: number): string {
    if (bestVmax <= 0) return '--';

    let sustainFraction: number;
    if (distanceM <= 60) sustainFraction = 0.94;
    else if (distanceM <= 100) sustainFraction = 0.91;
    else if (distanceM <= 200) sustainFraction = 0.88;
    else if (distanceM <= 400) sustainFraction = 0.78;
    else if (distanceM <= 600) sustainFraction = 0.70;
    else sustainFraction = 0.65;

    const agePenalty = age > 35 ? Math.max(1 - (age - 35) * AGE_DEGRADATION_PER_YEAR, 0.65) : 1;
    const avgSpeed = bestVmax * sustainFraction * agePenalty;
    const time = distanceM / avgSpeed + 0.15;

    if (time < 60) return `${time.toFixed(2)}s`;
    const mins = Math.floor(time / 60);
    const secs = time - mins * 60;
    return `${mins}:${secs < 10 ? '0' : ''}${secs.toFixed(2)}`;
  }

  /**
   * Build coherent, mutually-compatible plans for all upcoming sprint races.
   * Races must be pre-sorted nearest-first.
   */
  static buildMultiRacePlans(
    races: SprintRaceEvent[],
    bestVmax: number,
    age: number,
  ): SprintRacePlan[] {
    if (races.length === 0) return [];

    return races.map((race, index) => {
      const goalTime = this.estimateRaceTime(race.distanceM, bestVmax, age);

      // Nearest race: independent plan, no prior context
      if (index === 0) {
        return { race, goalTime, currentPhase: this.getPhase(race.daysUntil) };
      }

      // Secondary races: determine how the nearest race constrains prep
      const primary = races[0];
      const primaryPhase = this.getPhase(primary.daysUntil);
      const recovDays = this.recoveryDays(primary.distanceM);
      const effectiveDays = Math.max(0, race.daysUntil - primary.daysUntil - recovDays);
      const postRecoveryPhase = this.getPhase(effectiveDays);

      // Taper constraint: primary is ≤14d away — defer independent work
      const isConstrained = primary.daysUntil <= 14;

      // Shared Build window: both races are >28d — same block, complementary note
      const sharedBuildWindow = primary.daysUntil > 28;

      let currentPhase: RacePlanPhase;
      if (isConstrained) {
        currentPhase = { ...this.DEFERRED_PHASE };
      } else if (sharedBuildWindow) {
        // Independent phase but flag as complementary
        const base = this.getPhase(race.daysUntil);
        currentPhase = {
          ...base,
          strengthNote: `${base.strengthNote} · ${this.COMPLEMENTARY_BUILD_NOTE}`,
        };
      } else {
        // Sharpen window for primary — secondary race can do moderate work that doesn't
        // conflict: reduce volume and avoid race-specific distances for the secondary race
        const base = this.getPhase(race.daysUntil);
        currentPhase = {
          ...base,
          focus: `${base.focus} — volume capped to support ${primary.name} prep`,
          sessions: base.sessions.map((s) => `${s} (reduced volume)`),
          strengthNote: `${base.strengthNote} · Keep intensity moderate while sharpening for ${primary.name}`,
        };
      }

      const priorRaceContext: PriorRaceContext = {
        priorityRaceName: primary.name,
        priorityRaceDate: primary.date,
        priorityRaceDaysUntil: primary.daysUntil,
        priorityPhaseLabel: primaryPhase.label,
        recoveryDaysAfter: recovDays,
        effectiveTrainingDays: effectiveDays,
        postRecoveryPhase,
        isConstrained,
      };

      return { race, goalTime, currentPhase, priorRaceContext };
    });
  }

  /** Single-race convenience wrapper (used in tests) */
  static buildPlan(race: SprintRaceEvent, bestVmax: number, age: number): SprintRacePlan {
    return this.buildMultiRacePlans([race], bestVmax, age)[0];
  }
}

