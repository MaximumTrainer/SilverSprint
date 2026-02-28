import type { AthleteType } from './fascia-periodization';

export type RecoveryModality = 'tempo' | 'breathing' | 'hydrotherapy';

export interface TempoProtocol {
  name: string;
  description: string;
  distance: string;
  intensity: string;
  restInterval: string;
  cues: string[];
  contraindications: string[];
}

export interface BreathingStep {
  phase: 'inhale' | 'hold' | 'exhale' | 'pause';
  durationSeconds: number;
  instruction: string;
}

export interface BreathingGuide {
  name: '90/90' | 'box';
  totalMinutes: number;
  cycles: number;
  steps: BreathingStep[];
  benefit: string;
}

export interface HydrotherapyStep {
  temperature: 'hot' | 'cold';
  durationSeconds: number;
  notes: string;
}

export interface HydrotherapyGuide {
  name: string;
  totalCycles: number;
  steps: HydrotherapyStep[];
  totalDurationMinutes: number;
  contraindications: string;
  /** Non-null only when the session type warrants a postural safety warning */
  warning: string | null;
}

/**
 * §5.2 — Recovery & Regeneration Modalities ("The Big Three")
 *
 * I.  Extensive Tempo    — "Flushing mechanism" for fascia-driven athletes
 * II. Parasympathetic Breathing — 90/90 post-workout down-regulation
 * III.Hydrotherapy       — Speed Strength contrast bath protocol
 */
export class RecoveryModalities {
  private static readonly TEMPO_FASCIA: TempoProtocol = {
    name: 'Fascia Tempo Run',
    description: 'Primary recovery tool for fascia-dominant athletes. Increases blood flow and rinses metabolic waste without CNS fatigue. Focus on elastic recoil, NOT muscular drive.',
    distance: '5–8 × 100m',
    intensity: '65–70% max speed',
    restInterval: 'Walk 100m between reps — do not jog',
    cues: [
      'Land with dorsiflexed ankle — feel the ground spring back',
      'Relax jaw and shoulders throughout',
      'Focus on elastic recoil, not muscular drive',
      'Keep thorax tall — no forward lean',
      'Count your steps: 44–48 per 100m is the target rhythm',
    ],
    contraindications: ['Active hamstring pain', 'RSI below 0.8', 'Red NFI status'],
  };

  private static readonly TEMPO_MUSCLE: TempoProtocol = {
    name: 'Muscle Flush Tempo',
    description: 'Lactate-clearing tempo for muscle-dominant athletes. Slightly higher intensity with an emphasis on deliberate quad activation and arm drive.',
    distance: '3–5 × 150m',
    intensity: '70–75% max speed',
    restInterval: 'Walk 150m between reps',
    cues: [
      'Drive the knee through — think quad activation',
      'Pump the arms — chest-height to hip-pocket',
      'Controlled breathing: inhale for 2 strides, exhale for 2',
      'Maintain proper shin angle throughout each rep',
    ],
    contraindications: ['TSB below −20', 'Red NFI status', 'Active knee pain'],
  };

  private static readonly HYDROTHERAPY_MAX_VELOCITY: HydrotherapyGuide = {
    name: 'Post-Sprint Contrast Bath',
    totalCycles: 4,
    steps: [
      {
        temperature: 'hot',
        durationSeconds: 180,
        notes: 'Full body immersion 38–40°C (100–104°F). Focus on relaxing quadriceps and calves.',
      },
      {
        temperature: 'cold',
        durationSeconds: 60,
        notes: 'Cold immersion 10–15°C (50–59°F). Breathe steadily — do not hold breath.',
      },
    ],
    totalDurationMinutes: 16,
    contraindications: "Do not use with open wounds, acute inflammation, cardiovascular conditions, Raynaud's syndrome, or pregnancy.",
    warning: 'After cold immersion, rise slowly. Sit on the edge for 30 seconds before standing — rapid position change after cold can cause postural hypotension.',
  };

  private static readonly HYDROTHERAPY_HYPERTROPHY: HydrotherapyGuide = {
    name: 'Post-Strength Contrast',
    totalCycles: 3,
    steps: [
      {
        temperature: 'hot',
        durationSeconds: 240,
        notes: 'Hot shower 38–40°C over worked muscle groups. Do NOT use ice bath after hypertrophy work — it blunts mTOR signalling and growth adaptation.',
      },
      {
        temperature: 'cold',
        durationSeconds: 90,
        notes: 'Cool-to-cold shower 15–18°C. Controlled breathing throughout.',
      },
    ],
    totalDurationMinutes: 16.5,
    contraindications: "Same general contraindications apply: cardiovascular conditions, Raynaud's syndrome, open wounds.",
    warning: null,
  };

  private static readonly BREATHING_90_90: BreathingGuide = {
    name: '90/90',
    totalMinutes: 5,
    cycles: 6,
    steps: [
      { phase: 'inhale', durationSeconds: 4, instruction: 'Breathe in through nose — feel ribcage expand laterally, not upward' },
      { phase: 'hold',   durationSeconds: 4, instruction: 'Hold gently at top — do not Valsalva or strain' },
      { phase: 'exhale', durationSeconds: 8, instruction: 'Exhale fully through pursed lips — feel abs gently brace at end of breath' },
      { phase: 'pause',  durationSeconds: 2, instruction: 'Natural pause before next inhale — let the body breathe you' },
    ],
    benefit: 'Restores parasympathetic tone post-effort; reduces cortisol and prepares fascial tissue for the next loading cycle. Long exhales activate the vagal brake.',
  };

  /**
   * Returns the appropriate tempo protocol for the athlete's dominance type.
   */
  static getTempoProtocol(athleteType: AthleteType): TempoProtocol {
    return athleteType === 'fascia'
      ? RecoveryModalities.TEMPO_FASCIA
      : RecoveryModalities.TEMPO_MUSCLE;
  }

  /**
   * Returns the contrast hydrotherapy protocol for the given session type.
   * max-velocity: aggressive 4-cycle protocol (recommended after neural-heavy days)
   * hypertrophy:  gentler 3-cycle protocol (avoids blunting growth signalling)
   */
  static getHydrotherapyProtocol(sessionType: 'max-velocity' | 'hypertrophy'): HydrotherapyGuide {
    return sessionType === 'max-velocity'
      ? RecoveryModalities.HYDROTHERAPY_MAX_VELOCITY
      : RecoveryModalities.HYDROTHERAPY_HYPERTROPHY;
  }

  /**
   * Returns the 5-minute 90/90 diaphragmatic breathing protocol.
   * Should be run immediately following the final set of the day.
   */
  static getBreathingProtocol(): BreathingGuide {
    return RecoveryModalities.BREATHING_90_90;
  }

  /**
   * Returns a safety warning string for session types that warrant caution
   * with contrast baths. Non-null only for 'max-velocity' sessions.
   */
  static getContrastBathWarning(sessionType: string): string | null {
    return sessionType === 'max-velocity'
      ? RecoveryModalities.HYDROTHERAPY_MAX_VELOCITY.warning
      : null;
  }
}
