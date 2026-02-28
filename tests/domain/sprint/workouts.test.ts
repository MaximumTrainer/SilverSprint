import { describe, it, expect } from 'vitest';
import { SprintWorkoutGenerator, SprintWorkout, isStaleVmax } from '../../../src/domain/sprint/workouts';

describe('SprintWorkoutGenerator', () => {
  describe('green NFI — max velocity session', () => {
    const workout = SprintWorkoutGenerator.generate('green', 1.0);

    it('returns a workout with green status', () => {
      expect(workout.status).toBe('green');
    });

    it('has a name containing "Max Velocity"', () => {
      expect(workout.name).toMatch(/Max Velocity/i);
    });

    it('includes warmup, main set, and cooldown', () => {
      expect(workout.warmup.length).toBeGreaterThan(0);
      expect(workout.mainSet.length).toBeGreaterThan(0);
      expect(workout.cooldown.length).toBeGreaterThan(0);
    });

    it('main set includes block starts and flying sprints', () => {
      const names = workout.mainSet.map((b) => b.name.toLowerCase());
      expect(names.some((n) => n.includes('block'))).toBe(true);
      expect(names.some((n) => n.includes('flying'))).toBe(true);
    });

    it('main set blocks have valid structure', () => {
      for (const block of workout.mainSet) {
        expect(block.reps).toBeGreaterThan(0);
        expect(block.distance).toBeTruthy();
        expect(block.rest).toBeTruthy();
        expect(block.intensity).toBeTruthy();
        expect(block.cue).toBeTruthy();
      }
    });

    it('rationale references the NFI percentage', () => {
      expect(workout.rationale).toContain('100.0%');
    });

    it('total sprint volume is non-empty', () => {
      expect(workout.totalSprintVolume).toBeTruthy();
    });

    it('workout description is a formatted multi-line string', () => {
      expect(workout.workoutDescription).toContain('SilverSprint');
      expect(workout.workoutDescription).toContain('GREEN');
      expect(workout.workoutDescription).toContain('WARM-UP');
      expect(workout.workoutDescription).toContain('MAIN SET');
      expect(workout.workoutDescription).toContain('COOL-DOWN');
    });
  });

  describe('amber NFI — technical session', () => {
    const workout = SprintWorkoutGenerator.generate('amber', 0.96);

    it('returns a workout with amber status', () => {
      expect(workout.status).toBe('amber');
    });

    it('has a name referencing technical or CNS management', () => {
      expect(workout.name).toMatch(/Technical|CNS/i);
    });

    it('main set focuses on drills and short accelerations', () => {
      const names = workout.mainSet.map((b) => b.name.toLowerCase());
      expect(names.some((n) => n.includes('wicket') || n.includes('skip') || n.includes('acceleration'))).toBe(true);
    });

    it('does not include 100% intensity efforts', () => {
      const intensities = workout.mainSet.map((b) => b.intensity);
      expect(intensities).not.toContain('100%');
    });

    it('rationale mentions CNS suppression', () => {
      expect(workout.rationale).toMatch(/suppression/i);
    });

    it('workout description contains AMBER status', () => {
      expect(workout.workoutDescription).toContain('AMBER');
    });
  });

  describe('red NFI — recovery session', () => {
    const workout = SprintWorkoutGenerator.generate('red', 0.90);

    it('returns a workout with red status', () => {
      expect(workout.status).toBe('red');
    });

    it('has a name referencing recovery', () => {
      expect(workout.name).toMatch(/Recovery|Restoration/i);
    });

    it('total sprint volume is 0m', () => {
      expect(workout.totalSprintVolume).toContain('0m');
    });

    it('main set includes recovery/mobility work only', () => {
      const names = workout.mainSet.map((b) => b.name.toLowerCase());
      expect(names.some((n) => n.includes('recovery') || n.includes('mobility'))).toBe(true);
    });

    it('rationale mentions neural fatigue', () => {
      expect(workout.rationale).toMatch(/neural fatigue/i);
    });

    it('workout description contains RED status', () => {
      expect(workout.workoutDescription).toContain('RED');
    });
  });

  describe('NFI value affects rationale', () => {
    it('includes correct NFI percentage in green workout', () => {
      const workout = SprintWorkoutGenerator.generate('green', 0.985);
      expect(workout.rationale).toContain('98.5%');
    });

    it('includes correct NFI percentage in amber workout', () => {
      const workout = SprintWorkoutGenerator.generate('amber', 0.955);
      expect(workout.rationale).toContain('95.5%');
    });

    it('includes correct NFI percentage in red workout', () => {
      const workout = SprintWorkoutGenerator.generate('red', 0.920);
      expect(workout.rationale).toContain('92.0%');
    });
  });

  describe('isStaleVmax detection', () => {
    it('returns true for red NFI with positive TSB', () => {
      expect(isStaleVmax('red', { tsb: 5 })).toBe(true);
    });

    it('returns true for amber NFI with zero TSB', () => {
      expect(isStaleVmax('amber', { tsb: 0 })).toBe(true);
    });

    it('returns false for red NFI with negative TSB (genuinely fatigued)', () => {
      expect(isStaleVmax('red', { tsb: -10 })).toBe(false);
    });

    it('returns false for green NFI regardless of TSB', () => {
      expect(isStaleVmax('green', { tsb: 10 })).toBe(false);
    });

    it('returns false when no context is provided', () => {
      expect(isStaleVmax('red')).toBe(false);
    });
  });

  describe('stale Vmax — neural re-activation session', () => {
    const workout = SprintWorkoutGenerator.generate('red', 0.92, { tsb: 5 });

    it('returns a re-activation workout, not a recovery session', () => {
      expect(workout.name).toMatch(/Re-Activation/i);
    });

    it('has sprint volume > 0', () => {
      expect(workout.totalSprintVolume).not.toBe('0m sprint distance');
      expect(workout.totalSprintVolume).toMatch(/\d+m/);
    });

    it('includes accelerations and flying sprints', () => {
      const names = workout.mainSet.map((b) => b.name.toLowerCase());
      expect(names.some((n) => n.includes('acceleration'))).toBe(true);
      expect(names.some((n) => n.includes('flying'))).toBe(true);
    });

    it('rationale mentions detraining not fatigue', () => {
      expect(workout.rationale).toMatch(/detraining/i);
      expect(workout.rationale).not.toMatch(/significant neural fatigue/i);
    });

    it('rationale mentions fresh TSB', () => {
      expect(workout.rationale).toMatch(/fresh/i);
    });

    it('warmup includes progressive build-ups', () => {
      expect(workout.warmup.some((w) => w.includes('build-up'))).toBe(true);
    });
  });

  describe('red NFI with negative TSB — still prescribes recovery', () => {
    const workout = SprintWorkoutGenerator.generate('red', 0.90, { tsb: -15 });

    it('returns a recovery workout when genuinely fatigued', () => {
      expect(workout.name).toMatch(/Recovery|Restoration/i);
    });

    it('total sprint volume is 0m', () => {
      expect(workout.totalSprintVolume).toContain('0m');
    });

    it('rationale mentions neural fatigue', () => {
      expect(workout.rationale).toMatch(/neural fatigue/i);
    });
  });

  describe('red NFI without context — backwards compatible recovery', () => {
    const workout = SprintWorkoutGenerator.generate('red', 0.90);

    it('returns recovery workout when no context provided', () => {
      expect(workout.name).toMatch(/Recovery|Restoration/i);
    });

    it('total sprint volume is 0m', () => {
      expect(workout.totalSprintVolume).toContain('0m');
    });
  });
});
