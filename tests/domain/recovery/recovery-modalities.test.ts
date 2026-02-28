import { describe, it, expect } from 'vitest';
import { RecoveryModalities } from '../../../src/domain/recovery/recovery-modalities';

describe('RecoveryModalities.getTempoProtocol — fascia', () => {
  const protocol = RecoveryModalities.getTempoProtocol('fascia');

  it('has a non-empty name',        () => expect(protocol.name.length).toBeGreaterThan(0));
  it('has a defined distance',      () => expect(protocol.distance.length).toBeGreaterThan(0));
  it('has a defined intensity',     () => expect(protocol.intensity.length).toBeGreaterThan(0));
  it('has a rest interval',         () => expect(protocol.restInterval.length).toBeGreaterThan(0));
  it('has at least 2 cues',         () => expect(protocol.cues.length).toBeGreaterThanOrEqual(2));
  it('has at least 1 contraindication', () => expect(protocol.contraindications.length).toBeGreaterThanOrEqual(1));
  it('intensity includes 65–70%',   () => expect(protocol.intensity).toContain('65'));
});

describe('RecoveryModalities.getTempoProtocol — muscle', () => {
  const protocol = RecoveryModalities.getTempoProtocol('muscle');

  it('has a non-empty name',        () => expect(protocol.name.length).toBeGreaterThan(0));
  it('has at least 2 cues',         () => expect(protocol.cues.length).toBeGreaterThanOrEqual(2));
  it('has at least 1 contraindication', () => expect(protocol.contraindications.length).toBeGreaterThanOrEqual(1));
  it('intensity includes 70–75%',   () => expect(protocol.intensity).toContain('70'));
});

describe('RecoveryModalities.getTempoProtocol — fascia vs muscle differ', () => {
  const fascia = RecoveryModalities.getTempoProtocol('fascia');
  const muscle = RecoveryModalities.getTempoProtocol('muscle');

  it('names differ',                () => expect(fascia.name).not.toBe(muscle.name));
  it('intensities differ',          () => expect(fascia.intensity).not.toBe(muscle.intensity));
  it('distances differ',            () => expect(fascia.distance).not.toBe(muscle.distance));
});

describe('RecoveryModalities.getHydrotherapyProtocol — max-velocity', () => {
  const guide = RecoveryModalities.getHydrotherapyProtocol('max-velocity');

  it('has 4 cycles',                () => expect(guide.totalCycles).toBe(4));
  it('first step is hot',           () => expect(guide.steps[0].temperature).toBe('hot'));
  it('second step is cold',         () => expect(guide.steps[1].temperature).toBe('cold'));
  it('all steps have duration > 0', () => {
    for (const step of guide.steps) {
      expect(step.durationSeconds).toBeGreaterThan(0);
    }
  });
  it('has a non-null warning',      () => expect(guide.warning).not.toBeNull());
  it('has contraindications text',  () => expect(guide.contraindications.length).toBeGreaterThan(0));
  it('total duration > 0',          () => expect(guide.totalDurationMinutes).toBeGreaterThan(0));
});

describe('RecoveryModalities.getHydrotherapyProtocol — hypertrophy', () => {
  const guide = RecoveryModalities.getHydrotherapyProtocol('hypertrophy');

  it('has 3 cycles',                () => expect(guide.totalCycles).toBe(3));
  it('warning is null',             () => expect(guide.warning).toBeNull());
  it('first step is hot',           () => expect(guide.steps[0].temperature).toBe('hot'));
  it('second step is cold',         () => expect(guide.steps[1].temperature).toBe('cold'));
});

describe('RecoveryModalities.getBreathingProtocol', () => {
  const guide = RecoveryModalities.getBreathingProtocol();

  it('is 5 minutes total',          () => expect(guide.totalMinutes).toBe(5));
  it('has 4 phases per cycle',      () => expect(guide.steps.length).toBe(4));
  it('first phase is inhale',       () => expect(guide.steps[0].phase).toBe('inhale'));
  it('third phase is exhale',       () => expect(guide.steps[2].phase).toBe('exhale'));
  it('has non-empty benefit text',  () => expect(guide.benefit.length).toBeGreaterThan(0));
  it('all steps have instructions', () => {
    for (const step of guide.steps) {
      expect(step.instruction.length).toBeGreaterThan(0);
    }
  });
  it('all steps have duration > 0', () => {
    for (const step of guide.steps) {
      expect(step.durationSeconds).toBeGreaterThan(0);
    }
  });
  it('name is 90/90',               () => expect(guide.name).toBe('90/90'));
});

describe('RecoveryModalities.getContrastBathWarning', () => {
  it('max-velocity → returns non-null warning string', () => {
    const w = RecoveryModalities.getContrastBathWarning('max-velocity');
    expect(w).not.toBeNull();
    expect((w as string).length).toBeGreaterThan(0);
  });
  it('hypertrophy → returns null', () => {
    expect(RecoveryModalities.getContrastBathWarning('hypertrophy')).toBeNull();
  });
  it('mobility → returns null',    () => {
    expect(RecoveryModalities.getContrastBathWarning('mobility')).toBeNull();
  });
  it('unknown type → returns null', () => {
    expect(RecoveryModalities.getContrastBathWarning('rest')).toBeNull();
  });
});
