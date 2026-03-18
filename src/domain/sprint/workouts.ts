import type { NFIStatus } from '../types';

export interface SprintBlock {
  name: string;
  reps: number;
  distance: string;
  rest: string;
  intensity: string;
  cue: string;
}

export interface SprintWorkout {
  name: string;
  status: NFIStatus;
  rationale: string;
  warmup: string[];
  mainSet: SprintBlock[];
  cooldown: string[];
  totalSprintVolume: string;
  workoutDescription: string;
}

/** Optional context for smarter workout selection (TSB, days since last sprint) */
export interface SprintContext {
  /** Training Stress Balance — positive = fresh, negative = fatigued */
  tsb: number;
}

/**
 * Detects "stale Vmax" — NFI is depressed not because of fatigue but because
 * the athlete hasn't sprinted recently while overall training load is low.
 *
 * Condition: NFI is amber/red AND TSB ≥ 0 (athlete is objectively fresh).
 */
export function isStaleVmax(nfiStatus: NFIStatus, context?: SprintContext): boolean {
  if (!context) return false;
  return (nfiStatus === 'red' || nfiStatus === 'amber') && context.tsb >= 0;
}

/**
 * Sprint workout generator based on Neural Fatigue Index status.
 *
 * Green (NFI > 97%): Full max velocity session — block starts, flying sprints, full 60m reps
 * Amber (NFI 94–97%): Technical focus — drill-based, shorter accelerations, reduced volume
 * Red (NFI < 94%) + fatigued TSB: Active recovery only — no sprinting
 * Red/Amber (NFI < 97%) + fresh TSB: Neural Re-Activation — progressive sprints to restore Vmax
 */
export class SprintWorkoutGenerator {
  static generate(nfiStatus: NFIStatus, nfi: number, context?: SprintContext): SprintWorkout {
    // Stale Vmax pathway: NFI is low but athlete is fresh — re-activate, don't rest
    if (isStaleVmax(nfiStatus, context)) {
      return this.reactivationWorkout(nfi, context!.tsb);
    }

    switch (nfiStatus) {
      case 'green':
        return this.greenWorkout(nfi);
      case 'amber':
        return this.amberWorkout(nfi);
      case 'red':
        return this.redWorkout(nfi);
    }
  }

  private static greenWorkout(nfi: number): SprintWorkout {
    const warmup = [
      '10 min easy jog',
      'Dynamic stretching circuit (leg swings, walking lunges, high knees)',
      '3 × 60m progressive build-ups (60%, 75%, 90%)',
    ];
    const mainSet: SprintBlock[] = [
      {
        name: 'Block Starts',
        reps: 3,
        distance: '30m',
        rest: '3–4 min walk',
        intensity: '100%',
        cue: 'Explosive first step, drive for 15m then transition to upright.',
      },
      {
        name: 'Flying 30s',
        reps: 3,
        distance: '30m (20m run-in)',
        rest: '4 min walk-back',
        intensity: '100%',
        cue: 'Hit top speed in the run-in zone, maintain mechanics through the timing gates.',
      },
      {
        name: 'Full 60m',
        reps: 2,
        distance: '60m from blocks',
        rest: '5–6 min full recovery',
        intensity: '95–100%',
        cue: 'Aggressive drive phase, upright by 30m, hold form to the line.',
      },
    ];
    const cooldown = [
      '10 min easy jog',
      'Static stretching — hamstrings, hip flexors, calves (30s holds)',
    ];

    return {
      name: 'Max Velocity — Neural Priming Session',
      status: 'green',
      rationale: `NFI at ${(nfi * 100).toFixed(1)}% — CNS is fully primed. Today is a day for maximal speed work with full recovery between reps.`,
      warmup,
      mainSet,
      cooldown,
      totalSprintVolume: '~300m total sprint distance',
      workoutDescription: this.formatDescription('green', nfi, warmup, mainSet, cooldown, '~300m'),
    };
  }

  private static amberWorkout(nfi: number): SprintWorkout {
    const warmup = [
      '10 min easy jog',
      'Dynamic stretching circuit',
      '2 × 60m build-ups (60%, 80%)',
    ];
    const mainSet: SprintBlock[] = [
      {
        name: 'Wicket Runs',
        reps: 4,
        distance: '20m (mini-hurdle spacing)',
        rest: '2 min walk-back',
        intensity: 'Controlled',
        cue: 'Focus on cadence and front-side mechanics. Smooth, not forced.',
      },
      {
        name: 'Short Accelerations',
        reps: 3,
        distance: '20m from 3-point stance',
        rest: '3 min walk',
        intensity: '90%',
        cue: 'Clean lines — shin angle, arm drive, no over-striding.',
      },
      {
        name: 'A-Skip + B-Skip Complex',
        reps: 3,
        distance: '30m each drill',
        rest: '90s walk-back',
        intensity: 'Technical',
        cue: 'Tall posture, active ground contact, rhythmic tempo.',
      },
    ];
    const cooldown = [
      '10 min easy jog',
      'Light stretching + foam roll',
    ];

    return {
      name: 'Technical Sprint — CNS Management Session',
      status: 'amber',
      rationale: `NFI at ${(nfi * 100).toFixed(1)}% — moderate CNS suppression. Focus on technical quality with reduced intensity. Keep total volume low.`,
      warmup,
      mainSet,
      cooldown,
      totalSprintVolume: '~150m sprint equivalent',
      workoutDescription: this.formatDescription('amber', nfi, warmup, mainSet, cooldown, '~150m'),
    };
  }

  private static redWorkout(nfi: number): SprintWorkout {
    const warmup = ['5 min easy walk'];
    const mainSet: SprintBlock[] = [
      {
        name: 'Active Recovery Walk',
        reps: 1,
        distance: '15–20 min',
        rest: 'N/A',
        intensity: 'Very Low',
        cue: 'Easy pace, focus on breathing and relaxation.',
      },
      {
        name: 'Dynamic Mobility Circuit',
        reps: 2,
        distance: '10 min total',
        rest: 'Continuous',
        intensity: 'Low',
        cue: 'Leg swings, hip circles, ankle mobilization. No ballistic movements.',
      },
    ];
    const cooldown = [
      'Foam rolling — quads, hamstrings, glutes (10 min)',
      'Gentle static stretching (optional)',
    ];

    return {
      name: 'Recovery — Neural Restoration',
      status: 'red',
      rationale: `NFI at ${(nfi * 100).toFixed(1)}% — significant neural fatigue detected. No sprinting today. Focus on recovery to restore CNS readiness.`,
      warmup,
      mainSet,
      cooldown,
      totalSprintVolume: '0m sprint distance',
      workoutDescription: this.formatDescription('red', nfi, warmup, mainSet, cooldown, '0m'),
    };
  }

  /**
   * Neural Re-Activation session for stale Vmax.
   *
   * Prescribed when NFI is depressed but TSB is positive — the athlete is fresh
   * but hasn't performed quality sprint work recently, causing Vmax to drift
   * below baseline. A controlled re-activation session restores neuromuscular
   * coordination without the overload risk of a full max-velocity day.
   */
  private static reactivationWorkout(nfi: number, tsb: number): SprintWorkout {
    const warmup = [
      '10 min easy jog',
      'Dynamic stretching circuit (leg swings, walking lunges, high knees)',
      '4 × 60m progressive build-ups (50%, 65%, 80%, 90%)',
    ];
    const mainSet: SprintBlock[] = [
      {
        name: 'Standing Accelerations',
        reps: 3,
        distance: '30m',
        rest: '3 min walk-back',
        intensity: '90–95%',
        cue: 'Smooth acceleration. Focus on shin angles and arm drive — no straining.',
      },
      {
        name: 'Flying 20s',
        reps: 3,
        distance: '20m (15m run-in)',
        rest: '3 min walk-back',
        intensity: '93–97%',
        cue: 'Re-engage top-speed neural pathways. Relaxed face, fast feet, tall hips.',
      },
      {
        name: 'Wicket Runs',
        reps: 3,
        distance: '20m (mini-hurdle spacing)',
        rest: '2 min walk-back',
        intensity: 'Controlled',
        cue: 'Cadence and front-side mechanics. Reinforce stride pattern.',
      },
    ];
    const cooldown = [
      '10 min easy jog',
      'Static stretching — hamstrings, hip flexors, calves (30s holds)',
    ];

    return {
      name: 'Neural Re-Activation — Restore Sprint Speed',
      status: 'red',
      rationale: `NFI at ${(nfi * 100).toFixed(1)}% but TSB is ${tsb > 0 ? '+' : ''}${tsb.toFixed(1)} (fresh). Low Vmax is likely from detraining, not fatigue. This controlled re-activation session will restore neuromuscular coordination.`,
      warmup,
      mainSet,
      cooldown,
      totalSprintVolume: '~150m sprint distance',
      workoutDescription: this.formatDescription('red', nfi, warmup, mainSet, cooldown, '~150m'),
    };
  }

  private static formatDescription(
    status: NFIStatus,
    nfi: number,
    warmup: string[],
    mainSet: SprintBlock[],
    cooldown: string[],
    volume: string,
  ): string {
    const statusLabel = status === 'green' ? '🟢 GREEN' : status === 'amber' ? '🟡 AMBER' : '🔴 RED';
    const lines: string[] = [];

    lines.push(`🏃 SilverSprint — ${statusLabel} (NFI: ${(nfi * 100).toFixed(1)}%)`);
    lines.push('');

    lines.push('Warmup');
    lines.push('');
    for (const item of warmup) {
      lines.push(item);
    }
    lines.push('');

    lines.push('Main Set');
    lines.push('');
    for (const block of mainSet) {
      const stepLine = this.toIcuStep(block.distance, block.intensity);
      const restLine = this.toIcuRest(block.rest);
      lines.push(block.name);
      if (block.reps > 1) {
        lines.push(`${block.reps}x`);
      }
      lines.push(`- ${stepLine}`);
      if (restLine) {
        lines.push(`- ${restLine}`);
      }
      lines.push('');
    }

    lines.push('Cooldown');
    lines.push('');
    for (const item of cooldown) {
      lines.push(item);
    }
    lines.push('');
    lines.push(`Total sprint volume: ${volume}`);

    return lines.join('\n');
  }

  /** Convert a sprint block distance string to an intervals.icu pace-based step segment.
   *  Examples: "30m" → "30mtr 100% Pace intensity=active", "10 min total" → "10m Z2 Pace intensity=active"
   */
  private static toIcuStep(distanceStr: string, intensityStr: string): string {
    const intensity = this.toIcuIntensity(intensityStr);

    // Time-range: "15–20 min" → take upper bound → "20m"
    const rangeMinMatch = distanceStr.match(/(\d+)[–\-](\d+)\s*min/i);
    if (rangeMinMatch) return `${rangeMinMatch[2]}m ${intensity} Pace intensity=active`;

    // Plain time: "10 min total", "10 min" → "10m"
    const minMatch = distanceStr.match(/(\d+)\s*min/i);
    if (minMatch) return `${minMatch[1]}m ${intensity} Pace intensity=active`;

    // Distance in meters: use mtr notation for pace-based target
    const meterMatch = distanceStr.match(/^(\d+(?:\.\d+)?)\s*m\b/i);
    if (meterMatch) {
      return `${Math.round(parseFloat(meterMatch[1]))}mtr ${intensity} Pace intensity=active`;
    }

    return `${distanceStr} ${intensity} Pace intensity=active`;
  }

  /** Convert intensity string to intervals.icu notation. */
  private static toIcuIntensity(intensityStr: string): string {
    // Range with en-dash or hyphen: "90–95%", "95–100%", "90-95%"
    const rangeMatch = intensityStr.match(/^(\d+)[–\-](\d+)%$/);
    if (rangeMatch) return `${rangeMatch[1]}-${rangeMatch[2]}%`;

    // Single percentage: "100%", "90%"
    const pctMatch = intensityStr.match(/^(\d+)%$/);
    if (pctMatch) return `${pctMatch[1]}%`;

    if (/^(controlled|technical)$/i.test(intensityStr)) return 'Z3';
    if (/^very low$/i.test(intensityStr)) return 'Z1';
    if (/^low$/i.test(intensityStr)) return 'Z2';

    // Unrecognised intensity — default to moderate aerobic effort
    return 'Z2';
  }

  /** Convert a rest string to an intervals.icu recovery step, or '' if no rest. */
  private static toIcuRest(restStr: string): string {
    if (!restStr || restStr === 'N/A' || /^continuous$/i.test(restStr)) return '';

    // "3–4 min walk" → "4m Z1 Pace intensity=rest" (use upper bound)
    const rangeMinMatch = restStr.match(/(\d+)[–\-](\d+)\s*min/i);
    if (rangeMinMatch) return `${rangeMinMatch[2]}m Z1 Pace intensity=rest`;

    // "4 min walk-back", "3 min walk" → "4m Z1 Pace intensity=rest"
    const minMatch = restStr.match(/(\d+)\s*min/i);
    if (minMatch) return `${minMatch[1]}m Z1 Pace intensity=rest`;

    // "90s walk-back" → "90s Z1 Pace intensity=rest"
    const secMatch = restStr.match(/(\d+)s\b/i);
    if (secMatch) return `${secMatch[1]}s Z1 Pace intensity=rest`;

    return '';
  }
}
