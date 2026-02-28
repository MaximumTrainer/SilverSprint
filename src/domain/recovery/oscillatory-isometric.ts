export type OIProgressionPhase = 'catch-and-hold' | 'rapid-pulses' | 'reactive-switch';

export interface OIExercise {
  name: string;
  benefit: string;
  focusArea: string;
  sets: number;
  duration: string;
  cue: string;
  phase: 1 | 2 | 3;
}

export interface RelaxationScoreResult {
  label: string;
  assessment: string;
  isAdequate: boolean;
}

/**
 * §5 — Oscillatory Isometric (OI) Progression
 *
 * Three-phase protocol following Speed Strength principles:
 *  Phase 1 (weeks 1–2): Catch-and-Hold — build eccentric deceleration "brakes"
 *  Phase 2 (weeks 3–4): Rapid Pulses — train CNS on/off switch at 3+ Hz
 *  Phase 3 (weeks 5+):  Reactive Switch — integrate drop into oscillation
 *
 * High-neural-demand: place after plyometrics but before heavy general strength.
 *
 * Velocity-loss threshold: < 3Hz pulse frequency indicates neural fatigue
 * rather than speed-strength development — terminate set immediately.
 */
export class OscillatoryIsometric {
  private static readonly EXERCISES: Record<OIProgressionPhase, OIExercise[]> = {
    'catch-and-hold': [
      {
        name: 'Isometric Split Squat Hold',
        benefit: 'Tendon stiffness accumulation — builds eccentric "brakes"',
        focusArea: 'Hip flexor / extensor switch',
        sets: 3,
        duration: '3×15s progressive hold at 70% effort',
        cue: 'Drop to full depth, absorb instantly, hold without wavering. Time to stabilisation is the metric.',
        phase: 1,
      },
      {
        name: 'Ankle Bounce + Pause',
        benefit: 'Achilles tendon loading — accumulates connective tissue stress',
        focusArea: 'Achilles / calf complex',
        sets: 3,
        duration: '3×10 bounces then 5s hold',
        cue: 'Land softly, feel the spring load, pause at lowest point. Heel should not fully contact floor.',
        phase: 1,
      },
      {
        name: 'Wall Hip Flexor Press',
        benefit: 'Hip flexor elastic strength — mirrors sprint stance phase',
        focusArea: 'Iliopsoas',
        sets: 2,
        duration: '2×20s pressing knee into wall at full hip flexion',
        cue: 'Press knee into wall, shoulder-width stance, breath out on hold. Never push through sharp pain.',
        phase: 1,
      },
    ],
    'rapid-pulses': [
      {
        name: 'OI Split Squat — Rapid Pulses',
        benefit: 'Rate-of-force development at sprint stance angles',
        focusArea: 'Hip flexor / extensor switch',
        sets: 3,
        duration: '3 sets of 10 seconds of 1–2" pulses per limb',
        cue: 'Think guitar string vibrating. Pulses should be as fast as possible. Set terminates if speed slows.',
        phase: 2,
      },
      {
        name: 'Pogo Pulse Jumps',
        benefit: 'Ground contact stiffness — pure ankle elasticity',
        focusArea: 'Ankle / calf complex',
        sets: 3,
        duration: '3×8 rapid pogos then 4s pause',
        cue: 'Minimal ground time. Pure ankle spring — no knee bend permitted. Rhythm is queen.',
        phase: 2,
      },
      {
        name: 'OI RDL — Single Leg Pulses',
        benefit: 'Hamstring ability to fire-and-relax during high-speed leg turnover',
        focusArea: 'Posterior chain elasticity',
        sets: 3,
        duration: '3×10s pulses in mid-range at 80% effort',
        cue: 'Hold TRX or post at pelvis height. Pulse in the lengthened range only — shoulder stays tall.',
        phase: 2,
      },
    ],
    'reactive-switch': [
      {
        name: 'Drop-Catch Depth Jump',
        benefit: 'Reactive strength index development',
        focusArea: 'Full kinetic chain',
        sets: 3,
        duration: '3×5 — drop from 20cm box, catch and immediately jump',
        cue: 'Zero dwell time on landing — think "hot floor". Measure jump height each rep.',
        phase: 3,
      },
      {
        name: 'Explosive Hip Flexor Switch',
        benefit: 'Sprinting hip drive and antagonist relaxation',
        focusArea: 'Hip flexors and extensors',
        sets: 3,
        duration: '3×6 per side at maximum switch speed',
        cue: 'Drive front knee up aggressively while pushing rear foot down. Each switch < 1 second.',
        phase: 3,
      },
      {
        name: 'OI Push-Up Rapid Pulse',
        benefit: 'Upper body fascial sling — arm-punch and shoulder stability',
        focusArea: 'Upper body fascial sling',
        sets: 3,
        duration: '3×8s rapid pulses at bottom of push-up position',
        cue: 'Hold bottom of push-up. Pulse 1–2" as fast as possible. Elbows stay loaded throughout.',
        phase: 3,
      },
    ],
  };

  /** 1–2 = Poor, 3 = Low, 4 = Borderline, 5–6 = Adequate, 7–8 = Good, 9–10 = Excellent */
  private static readonly SCORE_MAP: Record<number, RelaxationScoreResult> = {
    1: { label: 'Poor',       isAdequate: false, assessment: 'Significant neural inhibition detected. Replace OI today with 90/90 breathing and light mobilisation.' },
    2: { label: 'Poor',       isAdequate: false, assessment: 'Significant neural inhibition detected. Replace OI today with 90/90 breathing and light mobilisation.' },
    3: { label: 'Low',        isAdequate: false, assessment: 'Below optimal. Cut OI sets in half. Monitor pulse quality carefully and stop any set that slows.' },
    4: { label: 'Borderline', isAdequate: false, assessment: 'Proceed cautiously with reduced OI sets. Stop if pulses feel sluggish or sticky.' },
    5: { label: 'Adequate',   isAdequate: true,  assessment: 'Proceed with full protocol at moderate effort. Reserve 1 set in the tank.' },
    6: { label: 'Adequate',   isAdequate: true,  assessment: 'Proceed with full protocol at moderate effort. Reserve 1 set in the tank.' },
    7: { label: 'Good',       isAdequate: true,  assessment: 'Full protocol. Push pulse quality and speed in final sets.' },
    8: { label: 'Good',       isAdequate: true,  assessment: 'Full protocol. Push pulse quality and speed in final sets.' },
    9: { label: 'Excellent',  isAdequate: true,  assessment: 'CNS is primed. Execute full protocol and consider a test effort or block-start today.' },
    10:{ label: 'Excellent',  isAdequate: true,  assessment: 'CNS is primed. Execute full protocol and consider a test effort or block-start today.' },
  };

  /**
   * Maps week number to the named OI progression phase.
   * weeks 1–2 → 'catch-and-hold'
   * week 3    → 'rapid-pulses'
   * week 4+   → 'reactive-switch'
   */
  static getPhase(weekNumber: number): OIProgressionPhase {
    if (weekNumber <= 2) return 'catch-and-hold';
    if (weekNumber === 3) return 'rapid-pulses';
    return 'reactive-switch';
  }

  /** Returns the full exercise list for the given OI phase. */
  static getExercises(phase: OIProgressionPhase): OIExercise[] {
    return [...OscillatoryIsometric.EXERCISES[phase]];
  }

  /**
   * Interprets a self-reported relaxation / fluidity score on a 1–10 scale.
   * "On a scale of 1–10, how fluid vs heavy did those pulses feel?"
   */
  static calculateRelaxationScore(score: 1|2|3|4|5|6|7|8|9|10): RelaxationScoreResult {
    const clamped = Math.max(1, Math.min(10, Math.round(score))) as keyof typeof OscillatoryIsometric.SCORE_MAP;
    return OscillatoryIsometric.SCORE_MAP[clamped];
  }

  /**
   * Returns true when the oscillation pulse rate has dropped below the
   * minimum threshold of 3 Hz (3 pulses per second).
   * A drop below 3 Hz indicates neural fatigue — terminate the set immediately.
   */
  static isVelocityLossFatigue(pulsesPerSecond: number): boolean {
    return pulsesPerSecond < 3;
  }
}
