import { describe, it, expect } from 'vitest';
import { SprintRacePlanner, SprintRaceEvent, SprintRacePlan } from '../../../src/domain/sprint/race-plan';

function makeRace(overrides: Partial<SprintRaceEvent> = {}): SprintRaceEvent {
  return {
    id: 'r1',
    name: '100m Sprint',
    date: '2026-04-15',
    distanceM: 100,
    daysUntil: 45,
    ...overrides,
  };
}

describe('SprintRacePlanner — Phase Selection', () => {
  it('returns Race Prep for ≤3 days out', () => {
    expect(SprintRacePlanner.getPhase(2).label).toBe('Race Prep');
    expect(SprintRacePlanner.getPhase(3).label).toBe('Race Prep');
  });

  it('returns Final Taper for 4–7 days out', () => {
    expect(SprintRacePlanner.getPhase(5).label).toBe('Final Taper');
    expect(SprintRacePlanner.getPhase(7).label).toBe('Final Taper');
  });

  it('returns Race-Specific for 8–14 days out', () => {
    expect(SprintRacePlanner.getPhase(10).label).toBe('Race-Specific');
    expect(SprintRacePlanner.getPhase(14).label).toBe('Race-Specific');
  });

  it('returns Sharpen for 15–28 days out', () => {
    expect(SprintRacePlanner.getPhase(20).label).toBe('Sharpen');
    expect(SprintRacePlanner.getPhase(28).label).toBe('Sharpen');
  });

  it('returns Build for >28 days out', () => {
    expect(SprintRacePlanner.getPhase(30).label).toBe('Build');
    expect(SprintRacePlanner.getPhase(60).label).toBe('Build');
  });

  it('phase has required fields', () => {
    const phase = SprintRacePlanner.getPhase(10);
    expect(phase.label).toBeTruthy();
    expect(phase.timeframe).toBeTruthy();
    expect(phase.focus).toBeTruthy();
    expect(phase.sessions.length).toBeGreaterThan(0);
    expect(phase.strengthNote).toBeTruthy();
  });
});

describe('SprintRacePlanner — Recovery Days', () => {
  it('100m race requires 4 recovery days', () => {
    expect(SprintRacePlanner.recoveryDays(100)).toBe(4);
  });

  it('200m race requires 5 recovery days', () => {
    expect(SprintRacePlanner.recoveryDays(200)).toBe(5);
  });

  it('400m race requires 7 recovery days', () => {
    expect(SprintRacePlanner.recoveryDays(400)).toBe(7);
  });

  it('60m race (under 100) requires 4 recovery days', () => {
    expect(SprintRacePlanner.recoveryDays(60)).toBe(4);
  });
});

describe('SprintRacePlanner — estimateRaceTime', () => {
  const bestVmax = 10.0; // m/s
  const age = 45;

  it('returns formatted time string for 100m', () => {
    const time = SprintRacePlanner.estimateRaceTime(100, bestVmax, age);
    expect(time).toMatch(/\d+\.\d{2}s/);
  });

  it('returns formatted time string for 200m', () => {
    const time = SprintRacePlanner.estimateRaceTime(200, bestVmax, age);
    expect(time).toMatch(/\d+\.\d{2}s/);
  });

  it('returns formatted time with minutes for 400m', () => {
    const time = SprintRacePlanner.estimateRaceTime(400, bestVmax, age);
    // 400m should be > 60s for a 45-year-old at 10m/s Vmax
    expect(time).toMatch(/\d+:\d{2}\.\d{2}|\d+\.\d{2}s/);
  });

  it('returns "--" when bestVmax is zero', () => {
    expect(SprintRacePlanner.estimateRaceTime(100, 0, 45)).toBe('--');
  });

  it('produces faster times for younger athletes', () => {
    const timeYoung = SprintRacePlanner.estimateRaceTime(100, bestVmax, 30);
    const timeOld = SprintRacePlanner.estimateRaceTime(100, bestVmax, 55);
    // Parse the numeric part
    const parseTime = (t: string) => parseFloat(t.replace('s', ''));
    expect(parseTime(timeYoung)).toBeLessThan(parseTime(timeOld));
  });
});

describe('SprintRacePlanner — Single Race Plan', () => {
  it('builds a plan for a single race', () => {
    const race = makeRace({ daysUntil: 20 });
    const plan = SprintRacePlanner.buildPlan(race, 10.0, 45);

    expect(plan.race).toEqual(race);
    expect(plan.goalTime).toBeTruthy();
    expect(plan.goalTime).not.toBe('--');
    expect(plan.currentPhase.label).toBe('Sharpen');
    expect(plan.priorRaceContext).toBeUndefined();
  });
});

describe('SprintRacePlanner — Multi-Race Plans', () => {
  it('returns empty array for no races', () => {
    expect(SprintRacePlanner.buildMultiRacePlans([], 10.0, 45)).toEqual([]);
  });

  it('first race has no priorRaceContext', () => {
    const races = [makeRace({ daysUntil: 10 }), makeRace({ id: 'r2', daysUntil: 30 })];
    const plans = SprintRacePlanner.buildMultiRacePlans(races, 10.0, 45);

    expect(plans[0].priorRaceContext).toBeUndefined();
  });

  it('secondary race has priorRaceContext', () => {
    const races = [
      makeRace({ daysUntil: 10, name: 'Meet A' }),
      makeRace({ id: 'r2', daysUntil: 30, name: 'Meet B' }),
    ];
    const plans = SprintRacePlanner.buildMultiRacePlans(races, 10.0, 45);

    expect(plans[1].priorRaceContext).toBeDefined();
    expect(plans[1].priorRaceContext!.priorityRaceName).toBe('Meet A');
  });

  it('defers secondary race when primary is ≤14 days away', () => {
    const races = [
      makeRace({ daysUntil: 7, name: 'Meet A' }),
      makeRace({ id: 'r2', daysUntil: 30, name: 'Meet B' }),
    ];
    const plans = SprintRacePlanner.buildMultiRacePlans(races, 10.0, 45);

    expect(plans[1].priorRaceContext!.isConstrained).toBe(true);
    expect(plans[1].currentPhase.label).toBe('Deferred');
  });

  it('shares Build phase when both races are >28 days away', () => {
    const races = [
      makeRace({ daysUntil: 35, name: 'Meet A' }),
      makeRace({ id: 'r2', daysUntil: 50, name: 'Meet B' }),
    ];
    const plans = SprintRacePlanner.buildMultiRacePlans(races, 10.0, 45);

    expect(plans[1].priorRaceContext!.isConstrained).toBe(false);
    expect(plans[1].currentPhase.strengthNote).toContain('serves both races');
  });

  it('calculates effective training days correctly', () => {
    const races = [
      makeRace({ daysUntil: 10, distanceM: 100, name: 'Meet A' }),
      makeRace({ id: 'r2', daysUntil: 30, name: 'Meet B' }),
    ];
    const plans = SprintRacePlanner.buildMultiRacePlans(races, 10.0, 45);
    const ctx = plans[1].priorRaceContext!;

    // effectiveTrainingDays = 30 - 10 - recoveryDays(100m=4) = 16
    expect(ctx.recoveryDaysAfter).toBe(4);
    expect(ctx.effectiveTrainingDays).toBe(16);
  });

  it('provides post-recovery phase for secondary race', () => {
    const races = [
      makeRace({ daysUntil: 7, name: 'Meet A' }),
      makeRace({ id: 'r2', daysUntil: 30, name: 'Meet B' }),
    ];
    const plans = SprintRacePlanner.buildMultiRacePlans(races, 10.0, 45);
    const ctx = plans[1].priorRaceContext!;

    expect(ctx.postRecoveryPhase).toBeDefined();
    expect(ctx.postRecoveryPhase.label).toBeTruthy();
  });
});
