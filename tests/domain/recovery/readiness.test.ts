import { describe, it, expect } from 'vitest';
import { ReadinessAssessment, MorningCheckIn } from '../../../src/domain/recovery/readiness';

const GOOD_CHECKIN: MorningCheckIn = {
  date: '2026-02-28',
  gripScore: 'ok',
  tapTestRatio: 0.95,
  muscleFeeling: 'normal',
  morningStiffnessCleared: true,
};

describe('ReadinessAssessment.assess — fully clear check-in', () => {
  const result = ReadinessAssessment.assess(GOOD_CHECKIN);

  it('returns ready status',         () => expect(result.overallStatus).toBe('ready'));
  it('has no red flags',             () => expect(result.redFlags.length).toBe(0));
  it('has at least one recommendation', () => expect(result.recommendations.length).toBeGreaterThan(0));
  it('neuralScore is 100',           () => expect(result.neuralScore).toBe(100));
});

describe('ReadinessAssessment.assess — grip red flag only', () => {
  const result = ReadinessAssessment.assess({ ...GOOD_CHECKIN, gripScore: 'reduced' });

  it('returns caution status',     () => expect(result.overallStatus).toBe('caution'));
  it('has exactly 1 red flag',     () => expect(result.redFlags.length).toBe(1));
  it('neuralScore is 75',          () => expect(result.neuralScore).toBe(75));
});

describe('ReadinessAssessment.assess — two red flags (grip + tap)', () => {
  const result = ReadinessAssessment.assess({
    ...GOOD_CHECKIN,
    gripScore: 'reduced',
    tapTestRatio: 0.80,
  });

  it('returns reduce-volume',        () => expect(result.overallStatus).toBe('reduce-volume'));
  it('has 2+ red flags',             () => expect(result.redFlags.length).toBeGreaterThanOrEqual(2));
  it('neuralScore is 50',            () => expect(result.neuralScore).toBe(50));
});

describe('ReadinessAssessment.assess — all four red flags', () => {
  const result = ReadinessAssessment.assess({
    date: '2026-02-28',
    gripScore: 'reduced',
    tapTestRatio: 0.70,
    muscleFeeling: 'heavy',
    morningStiffnessCleared: false,
  });

  it('returns reduce-volume',    () => expect(result.overallStatus).toBe('reduce-volume'));
  it('has exactly 4 red flags',  () => expect(result.redFlags.length).toBe(4));
  it('neuralScore is 0',         () => expect(result.neuralScore).toBe(0));
});

describe('ReadinessAssessment.assess — muscle twitchy is not a red flag', () => {
  const result = ReadinessAssessment.assess({ ...GOOD_CHECKIN, muscleFeeling: 'twitchy' });
  it('twitchy is not a red flag', () => expect(result.redFlags.length).toBe(0));
  it('ready status',              () => expect(result.overallStatus).toBe('ready'));
  it('neuralScore is still 100',  () => expect(result.neuralScore).toBe(100));
});

describe('ReadinessAssessment.scoreGrip', () => {
  it('ok → false (not a red flag)',     () => expect(ReadinessAssessment.scoreGrip('ok')).toBe(false));
  it('reduced → true (is a red flag)', () => expect(ReadinessAssessment.scoreGrip('reduced')).toBe(true));
});

describe('ReadinessAssessment.scoreTapTest', () => {
  it('0.84 → red flag (>15% drop)',           () => expect(ReadinessAssessment.scoreTapTest(0.84)).toBe(true));
  it('0.849 → red flag',                      () => expect(ReadinessAssessment.scoreTapTest(0.849)).toBe(true));
  it('0.85 → not a red flag (boundary)',      () => expect(ReadinessAssessment.scoreTapTest(0.85)).toBe(false));
  it('0.90 → not a red flag',                 () => expect(ReadinessAssessment.scoreTapTest(0.90)).toBe(false));
  it('1.00 → not a red flag (baseline)',      () => expect(ReadinessAssessment.scoreTapTest(1.00)).toBe(false));
  it('1.10 → not a red flag (improved)',      () => expect(ReadinessAssessment.scoreTapTest(1.10)).toBe(false));
  it('0.00 → red flag (catastrophic drop)',   () => expect(ReadinessAssessment.scoreTapTest(0.00)).toBe(true));
});

describe('ReadinessAssessment.assessStiffness', () => {
  it('cleared=true → healthy',              () => expect(ReadinessAssessment.assessStiffness(true)).toBe('healthy'));
  it('cleared=false → overtrained-risk',    () => expect(ReadinessAssessment.assessStiffness(false)).toBe('overtrained-risk'));
});

describe('ReadinessAssessment.isRSIDropping', () => {
  it('89 vs 100 = 89% → dropping (below 90%)',    () => expect(ReadinessAssessment.isRSIDropping(89, 100)).toBe(true));
  it('89.9 vs 100 → dropping',                    () => expect(ReadinessAssessment.isRSIDropping(89.9, 100)).toBe(true));
  it('90 vs 100 = 90% → not dropping (boundary)', () => expect(ReadinessAssessment.isRSIDropping(90, 100)).toBe(false));
  it('95 vs 100 = 95% → not dropping',            () => expect(ReadinessAssessment.isRSIDropping(95, 100)).toBe(false));
  it('same value → not dropping',                 () => expect(ReadinessAssessment.isRSIDropping(2.5, 2.5)).toBe(false));
  it('improved RSI → not dropping',               () => expect(ReadinessAssessment.isRSIDropping(110, 100)).toBe(false));
});
