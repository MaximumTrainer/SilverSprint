import { describe, it, expect } from 'vitest';
import { OscillatoryIsometric } from '../../../src/domain/recovery/oscillatory-isometric';

describe('OscillatoryIsometric.getPhase', () => {
  it('week 1 → catch-and-hold', () => expect(OscillatoryIsometric.getPhase(1)).toBe('catch-and-hold'));
  it('week 2 → catch-and-hold', () => expect(OscillatoryIsometric.getPhase(2)).toBe('catch-and-hold'));
  it('week 3 → rapid-pulses',   () => expect(OscillatoryIsometric.getPhase(3)).toBe('rapid-pulses'));
  it('week 4 → reactive-switch', () => expect(OscillatoryIsometric.getPhase(4)).toBe('reactive-switch'));
  it('week 5 → reactive-switch', () => expect(OscillatoryIsometric.getPhase(5)).toBe('reactive-switch'));
  it('week 0 → catch-and-hold (below threshold)', () => expect(OscillatoryIsometric.getPhase(0)).toBe('catch-and-hold'));
});

describe('OscillatoryIsometric.getExercises — counts', () => {
  it('catch-and-hold has at least 2 exercises', () => {
    expect(OscillatoryIsometric.getExercises('catch-and-hold').length).toBeGreaterThanOrEqual(2);
  });
  it('rapid-pulses has at least 2 exercises', () => {
    expect(OscillatoryIsometric.getExercises('rapid-pulses').length).toBeGreaterThanOrEqual(2);
  });
  it('reactive-switch has at least 2 exercises', () => {
    expect(OscillatoryIsometric.getExercises('reactive-switch').length).toBeGreaterThanOrEqual(2);
  });
});

describe('OscillatoryIsometric.getExercises — content', () => {
  it('catch-and-hold exercises carry phase number 1', () => {
    for (const ex of OscillatoryIsometric.getExercises('catch-and-hold')) {
      expect(ex.phase).toBe(1);
    }
  });
  it('rapid-pulses exercises carry phase number 2', () => {
    for (const ex of OscillatoryIsometric.getExercises('rapid-pulses')) {
      expect(ex.phase).toBe(2);
    }
  });
  it('reactive-switch exercises carry phase number 3', () => {
    for (const ex of OscillatoryIsometric.getExercises('reactive-switch')) {
      expect(ex.phase).toBe(3);
    }
  });
  it('all exercises have a non-empty name', () => {
    for (const phase of ['catch-and-hold', 'rapid-pulses', 'reactive-switch'] as const) {
      for (const ex of OscillatoryIsometric.getExercises(phase)) {
        expect(ex.name.length).toBeGreaterThan(0);
      }
    }
  });
  it('all exercises have a non-empty cue', () => {
    for (const phase of ['catch-and-hold', 'rapid-pulses', 'reactive-switch'] as const) {
      for (const ex of OscillatoryIsometric.getExercises(phase)) {
        expect(ex.cue.length).toBeGreaterThan(0);
      }
    }
  });
  it('all exercises have at least 1 set', () => {
    for (const phase of ['catch-and-hold', 'rapid-pulses', 'reactive-switch'] as const) {
      for (const ex of OscillatoryIsometric.getExercises(phase)) {
        expect(ex.sets).toBeGreaterThanOrEqual(1);
      }
    }
  });
  it('getExercises returns a new array (not mutating internal state)', () => {
    const a = OscillatoryIsometric.getExercises('rapid-pulses');
    const b = OscillatoryIsometric.getExercises('rapid-pulses');
    expect(a).not.toBe(b);
    expect(a).toEqual(b);
  });
});

describe('OscillatoryIsometric.calculateRelaxationScore', () => {
  it('score 1 is not adequate', () => expect(OscillatoryIsometric.calculateRelaxationScore(1).isAdequate).toBe(false));
  it('score 2 is not adequate', () => expect(OscillatoryIsometric.calculateRelaxationScore(2).isAdequate).toBe(false));
  it('score 3 is not adequate', () => expect(OscillatoryIsometric.calculateRelaxationScore(3).isAdequate).toBe(false));
  it('score 4 is not adequate', () => expect(OscillatoryIsometric.calculateRelaxationScore(4).isAdequate).toBe(false));
  it('score 5 is adequate',     () => expect(OscillatoryIsometric.calculateRelaxationScore(5).isAdequate).toBe(true));
  it('score 6 is adequate',     () => expect(OscillatoryIsometric.calculateRelaxationScore(6).isAdequate).toBe(true));
  it('score 7 is adequate',     () => expect(OscillatoryIsometric.calculateRelaxationScore(7).isAdequate).toBe(true));
  it('score 9 has label Excellent', () => expect(OscillatoryIsometric.calculateRelaxationScore(9).label).toBe('Excellent'));
  it('score 10 has label Excellent', () => expect(OscillatoryIsometric.calculateRelaxationScore(10).label).toBe('Excellent'));
  it('score 1 has label Poor', () => expect(OscillatoryIsometric.calculateRelaxationScore(1).label).toBe('Poor'));
  it('all scores have a non-empty assessment', () => {
    for (let s = 1; s <= 10; s++) {
      expect(OscillatoryIsometric.calculateRelaxationScore(s as any).assessment.length).toBeGreaterThan(0);
    }
  });
});

describe('OscillatoryIsometric.isVelocityLossFatigue', () => {
  it('2.5 Hz is fatigue',       () => expect(OscillatoryIsometric.isVelocityLossFatigue(2.5)).toBe(true));
  it('2.9 Hz is fatigue',       () => expect(OscillatoryIsometric.isVelocityLossFatigue(2.9)).toBe(true));
  it('2.99 Hz is fatigue',      () => expect(OscillatoryIsometric.isVelocityLossFatigue(2.99)).toBe(true));
  it('3.0 Hz is not fatigue (boundary)', () => expect(OscillatoryIsometric.isVelocityLossFatigue(3.0)).toBe(false));
  it('3.1 Hz is not fatigue',   () => expect(OscillatoryIsometric.isVelocityLossFatigue(3.1)).toBe(false));
  it('4.0 Hz is not fatigue',   () => expect(OscillatoryIsometric.isVelocityLossFatigue(4.0)).toBe(false));
  it('0 Hz is fatigue',         () => expect(OscillatoryIsometric.isVelocityLossFatigue(0)).toBe(true));
});
