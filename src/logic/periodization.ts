import { SilverSprintLogic, StrengthPrescription } from './logic';

export interface Exercise {
  name: string;
  type: 'strength' | 'plyometric' | 'mobility' | 'rest';
  sets: number;
  reps: number | string;
  intensity: string;
  /** Human-readable weight guidance, e.g. "~1.5× BW" */
  weightGuidance?: string;
  /** Multiplier of body weight for estimated load at prescribed intensity */
  bwMultiplier?: number;
}

export interface PeriodizationPrescription {
  zone: 'fresh' | 'tired' | 'fatigued';
  exercises: Exercise[];
}

/**
 * §3.3 — Strength Training Periodization
 *
 * Converts TSB into specific gym prescriptions:
 *   TSB > 0 (Fresh): High Intensity, Low Volume — Max Strength focus
 *   TSB -10 to -20 (Tired): Moderate Intensity — Stiffened Plyometrics
 *   TSB < -20 (Fatigued): Rest or Active Mobility only
 */
export class StrengthPeriodization {
  private static readonly FRESH_EXERCISES: Exercise[] = [
    { name: 'Trap Bar Deadlift', type: 'strength', sets: 3, reps: 3, intensity: '85%', weightGuidance: '~1.7× BW (85% est. 1RM)', bwMultiplier: 1.7 },
    { name: 'Weighted Step-Up', type: 'strength', sets: 3, reps: 5, intensity: '80%', weightGuidance: '~0.5× BW per hand (DB)', bwMultiplier: 0.5 },
    { name: 'Hang Power Clean', type: 'strength', sets: 3, reps: 3, intensity: '80%', weightGuidance: '~0.95× BW (80% est. 1RM)', bwMultiplier: 0.95 },
  ];

  private static readonly TIRED_EXERCISES: Exercise[] = [
    { name: 'Pogo Jumps', type: 'plyometric', sets: 3, reps: 10, intensity: 'Max Stiffness', weightGuidance: 'Bodyweight' },
    { name: 'Hurdle Hops', type: 'plyometric', sets: 3, reps: 6, intensity: 'Reactive', weightGuidance: 'Bodyweight' },
    { name: 'Single-Leg Bounds', type: 'plyometric', sets: 3, reps: 8, intensity: 'Moderate', weightGuidance: 'Bodyweight' },
  ];

  private static readonly FATIGUED_EXERCISES: Exercise[] = [
    { name: 'Foam Rolling', type: 'mobility', sets: 1, reps: '10 min', intensity: 'Low' },
    { name: 'Hip Flexor Stretch', type: 'mobility', sets: 2, reps: '60s hold', intensity: 'Low' },
    { name: 'Active Walking', type: 'rest', sets: 1, reps: '15 min', intensity: 'Very Low' },
  ];

  static getPrescription(tsb: number): PeriodizationPrescription {
    const base = SilverSprintLogic.getStrengthPrescription(tsb);

    switch (base.zone) {
      case 'fresh':
        return { zone: 'fresh', exercises: [...this.FRESH_EXERCISES] };
      case 'tired':
        return { zone: 'tired', exercises: [...this.TIRED_EXERCISES] };
      case 'fatigued':
        return { zone: 'fatigued', exercises: [...this.FATIGUED_EXERCISES] };
    }
  }

  /** Given body weight in kg, compute estimated load for an exercise */
  static estimateWeightKg(exercise: Exercise, bodyWeightKg: number): number | null {
    if (!exercise.bwMultiplier) return null;
    return Math.round(exercise.bwMultiplier * bodyWeightKg);
  }
}
