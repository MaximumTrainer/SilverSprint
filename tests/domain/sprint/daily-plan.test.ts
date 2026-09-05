import { describe, it, expect } from 'vitest';
import {
  buildTwoDayPlan,
  assessRecovery,
  projectNfiStatus,
  decayTsbOneRestDay,
  findLastMaxEffort,
  DailyPlanInput,
} from '../../../src/domain/sprint/daily-plan';
import { SilverSprintLogic } from '../../../src/domain/sprint/core';

/**
 * Tests for README §3.5 — the two-day training recommendation.
 *
 * The contract that matters: today is built from measurements, tomorrow is
 * built from a forecast and says so, and nothing about tomorrow's neural state
 * is invented.
 */

const NOW = new Date('2026-09-05T09:00:00Z');

function input(overrides: Partial<DailyPlanInput> = {}): DailyPlanInput {
  return {
    now: NOW,
    nfi: 0.96,
    nfiStatus: 'amber',
    todayTsb: -6.8,
    projectedTomorrowTsb: -2.1,
    ctl: 37.4,
    atl: 44.2,
    recoveryHours: 132,
    lastMaxEffortAt: '2026-09-04T18:00:00Z',
    ...overrides,
  };
}

describe('decayTsbOneRestDay', () => {
  it('improves TSB when fatigue exceeds fitness', () => {
    // ATL relaxes faster than CTL (7-day vs 42-day), so a rest day always
    // moves a fatigued athlete toward fresh.
    expect(decayTsbOneRestDay(37.4, 44.2)).toBeGreaterThan(37.4 - 44.2);
  });

  it('uses the standard 7-day and 42-day time constants', () => {
    const ctl = 40, atl = 60;
    const expected = (ctl - ctl / 42) - (atl - atl / 7);
    expect(decayTsbOneRestDay(ctl, atl)).toBeCloseTo(expected, 10);
  });

  it('turns downward only once fatigue is far below fitness', () => {
    // dTSB = atl/7 - ctl/42, so a rest day *raises* TSB until ATL drops under
    // CTL/6. Past that the athlete is detraining: fitness now decays faster
    // than the little remaining fatigue.
    expect(decayTsbOneRestDay(40, 10)).toBeGreaterThan(40 - 10); // still recovering
    expect(decayTsbOneRestDay(40, 5)).toBeLessThan(40 - 5);      // now detraining
  });
});

describe('assessRecovery', () => {
  it('reports the window as clear when nothing has been run', () => {
    const status = assessRecovery(NOW, null, 132);
    expect(status.cleared).toBe(true);
    expect(status.hoursSinceMaxEffort).toBeNull();
    expect(status.hoursRemaining).toBe(0);
  });

  it('counts the hours elapsed since the last max effort', () => {
    const status = assessRecovery(NOW, '2026-09-04T09:00:00Z', 132);
    expect(status.hoursSinceMaxEffort).toBeCloseTo(24, 1);
    expect(status.hoursRemaining).toBeCloseTo(108, 1);
    expect(status.cleared).toBe(false);
  });

  it('clears once the window has elapsed', () => {
    const status = assessRecovery(NOW, '2026-08-25T09:00:00Z', 132);
    expect(status.cleared).toBe(true);
    expect(status.hoursRemaining).toBe(0);
  });

  it('tolerates an unparseable timestamp rather than producing NaN hours', () => {
    const status = assessRecovery(NOW, 'not a date', 132);
    expect(status.cleared).toBe(true);
    expect(status.hoursSinceMaxEffort).toBeNull();
  });

  it('never reports negative elapsed time for a future-dated session', () => {
    const status = assessRecovery(NOW, '2026-09-09T09:00:00Z', 132);
    expect(status.hoursSinceMaxEffort).toBeGreaterThanOrEqual(0);
  });
});

describe('projectNfiStatus', () => {
  const insideWindow = { hoursSinceMaxEffort: 24, windowHours: 132, hoursRemaining: 108, cleared: false };
  const clearedWindow = { hoursSinceMaxEffort: 200, windowHours: 132, hoursRemaining: 0, cleared: true };

  it('withholds a green day while the recovery window is still running', () => {
    // Whatever today's NFI says, a max effort is not on offer until the
    // age-adjusted window has elapsed.
    expect(projectNfiStatus('green', insideWindow, -5)).not.toBe('green');
  });

  it('allows technical work inside the window once fatigue has dissipated', () => {
    expect(projectNfiStatus('green', insideWindow, 2)).toBe('amber');
  });

  it('keeps a fatigued athlete inside the window on recovery', () => {
    expect(projectNfiStatus('green', insideWindow, -12)).toBe('red');
  });

  it('carries today\'s status forward once the window has cleared', () => {
    expect(projectNfiStatus('green', clearedWindow, 5)).toBe('green');
    expect(projectNfiStatus('amber', clearedWindow, 5)).toBe('amber');
    expect(projectNfiStatus('red', clearedWindow, -5)).toBe('red');
  });
});

describe('findLastMaxEffort', () => {
  const fraction = SilverSprintLogic.SPRINT_SESSION_VMAX_FRACTION;

  it('picks the most recent sprint-quality session', () => {
    const found = findLastMaxEffort([
      { start_date_local: '2026-09-01T18:00:00', max_speed: 8.8 },
      { start_date_local: '2026-09-04T18:00:00', max_speed: 8.6 },
      { start_date_local: '2026-09-03T18:00:00', max_speed: 8.7 },
    ], 8.9, fraction);
    expect(found).toBe('2026-09-04T18:00:00');
  });

  it('does not let an easy run start a recovery window', () => {
    // 3.3 m/s is a jog. It costs nothing neurally and must not reset the clock.
    const found = findLastMaxEffort([
      { start_date_local: '2026-09-05T07:00:00', max_speed: 3.3 },
      { start_date_local: '2026-09-01T18:00:00', max_speed: 8.8 },
    ], 8.9, fraction);
    expect(found).toBe('2026-09-01T18:00:00');
  });

  it('ignores sessions with no velocity data', () => {
    const found = findLastMaxEffort([
      { start_date_local: '2026-09-05T07:00:00', max_speed: null },
      { start_date_local: '2026-09-01T18:00:00', max_speed: 8.8 },
    ], 8.9, fraction);
    expect(found).toBe('2026-09-01T18:00:00');
  });

  it('returns null when nothing qualifies', () => {
    expect(findLastMaxEffort([{ start_date_local: '2026-09-01T18:00:00', max_speed: 4.0 }], 8.9, fraction)).toBeNull();
    expect(findLastMaxEffort([], 0, fraction)).toBeNull();
  });
});

describe('buildTwoDayPlan', () => {
  it('labels today as measured and tomorrow as provisional', () => {
    const plan = buildTwoDayPlan(input());
    expect(plan.today.tsbSource).toBe('recorded');
    expect(plan.today.provisional).toBe(false);
    expect(plan.tomorrow.provisional).toBe(true);
  });

  it('dates the two days consecutively', () => {
    const plan = buildTwoDayPlan(input());
    expect(plan.today.date).toBe('2026-09-05');
    expect(plan.tomorrow.date).toBe('2026-09-06');
  });

  it('uses the Intervals.icu forecast for tomorrow when there is one', () => {
    const plan = buildTwoDayPlan(input({ projectedTomorrowTsb: -2.1 }));
    expect(plan.tomorrow.tsbSource).toBe('projected');
    expect(plan.tomorrow.tsb).toBeCloseTo(-2.1, 2);
    expect(plan.tomorrowBasis).toContain('Intervals.icu');
  });

  it('falls back to an explicit rest-day model when no forecast exists', () => {
    const plan = buildTwoDayPlan(input({ projectedTomorrowTsb: null, ctl: 37.4, atl: 44.2 }));
    expect(plan.tomorrow.tsbSource).toBe('modelled');
    expect(plan.tomorrow.tsb).toBeCloseTo(decayTsbOneRestDay(37.4, 44.2), 2);
    expect(plan.tomorrowBasis).toContain('not train');
  });

  it('derives each day\'s strength band from that day\'s own TSB', () => {
    // Today tired, tomorrow recovered into fresh.
    const plan = buildTwoDayPlan(input({ todayTsb: -6.8, projectedTomorrowTsb: 3.2 }));
    expect(plan.today.strengthBand.zone).toBe('tired');
    expect(plan.tomorrow.strengthBand.zone).toBe('fresh');
    expect(plan.today.strength.zone).toBe('tired');
    expect(plan.tomorrow.strength.zone).toBe('fresh');
  });

  it('agrees with the strength prescription used elsewhere', () => {
    const plan = buildTwoDayPlan(input());
    expect(plan.today.strengthBand.zone).toBe(SilverSprintLogic.getStrengthPrescription(plan.today.tsb).zone);
    expect(plan.tomorrow.strengthBand.zone).toBe(SilverSprintLogic.getStrengthPrescription(plan.tomorrow.tsb).zone);
  });

  it('does not offer a max-effort session while the window is still running', () => {
    // Max effort last night, 132h window: tomorrow is still deep inside it.
    const plan = buildTwoDayPlan(input({
      nfiStatus: 'green',
      nfi: 1.01,
      lastMaxEffortAt: '2026-09-04T18:00:00Z',
      recoveryHours: 132,
    }));
    expect(plan.tomorrow.recovery.cleared).toBe(false);
    expect(plan.tomorrow.sprint.status).not.toBe('green');
  });

  it('offers a full session tomorrow once the window has cleared', () => {
    const plan = buildTwoDayPlan(input({
      nfiStatus: 'green',
      nfi: 1.01,
      todayTsb: 4,
      projectedTomorrowTsb: 6,
      lastMaxEffortAt: '2026-08-20T18:00:00Z',
      recoveryHours: 132,
    }));
    expect(plan.tomorrow.recovery.cleared).toBe(true);
    expect(plan.tomorrow.sprint.status).toBe('green');
  });

  it('advances the recovery clock by exactly one day between the two', () => {
    const plan = buildTwoDayPlan(input({ lastMaxEffortAt: '2026-09-04T09:00:00Z' }));
    expect(plan.today.recovery.hoursSinceMaxEffort).toBeCloseTo(24, 1);
    expect(plan.tomorrow.recovery.hoursSinceMaxEffort).toBeCloseTo(48, 1);
  });

  it('tells the athlete when a max effort becomes available', () => {
    const plan = buildTwoDayPlan(input({ lastMaxEffortAt: '2026-09-04T09:00:00Z', recoveryHours: 132 }));
    expect(plan.today.headline).toMatch(/max effort available in/);
  });

  it('summarises each day with its session and strength band', () => {
    const plan = buildTwoDayPlan(input());
    expect(plan.today.headline).toContain(plan.today.sprint.name);
    expect(plan.today.headline).toContain(plan.today.strengthBand.label);
    expect(plan.tomorrow.headline).toContain(plan.tomorrow.strengthBand.label);
  });

  it('routes a fresh-but-slow athlete to re-activation rather than rest', () => {
    // Stale Vmax: NFI is down but TSB is positive, so the answer is to sprint,
    // not to rest. This must survive into the two-day view.
    const plan = buildTwoDayPlan(input({
      nfiStatus: 'red',
      nfi: 0.91,
      todayTsb: 6,
      projectedTomorrowTsb: 7,
      lastMaxEffortAt: null,
    }));
    expect(plan.today.sprint.name).toMatch(/Re-Activation/i);
    expect(plan.today.recovery.cleared).toBe(true);
  });

  it('prescribes mobility only when deeply fatigued on both days', () => {
    const plan = buildTwoDayPlan(input({
      nfiStatus: 'red',
      nfi: 0.90,
      todayTsb: -28,
      projectedTomorrowTsb: -24,
    }));
    expect(plan.today.strength.zone).toBe('fatigued');
    expect(plan.tomorrow.strength.zone).toBe('fatigued');
    expect(plan.today.sprint.totalSprintVolume).toMatch(/^0m/);
  });

  it('produces a complete, renderable workout for both days', () => {
    const plan = buildTwoDayPlan(input());
    for (const day of [plan.today, plan.tomorrow]) {
      expect(day.sprint.name.length).toBeGreaterThan(0);
      expect(day.sprint.warmup.length).toBeGreaterThan(0);
      expect(day.sprint.cooldown.length).toBeGreaterThan(0);
      expect(day.strength.exercises.length).toBeGreaterThan(0);
    }
  });
});

describe('buildTwoDayPlan — conflicting signals', () => {
  it('flags a max-effort prescription issued inside the recovery window', () => {
    // NFI is measured and the model is neural-first, so it decides. But the
    // recovery window dissenting is information the athlete should see, not
    // something to drop silently.
    const plan = buildTwoDayPlan(input({
      nfiStatus: 'green',
      nfi: 1.03,
      todayTsb: -1,
      lastMaxEffortAt: '2026-09-04T21:00:00Z',
      recoveryHours: 120,
    }));

    expect(plan.today.sprint.status).toBe('green');
    expect(plan.today.recovery.cleared).toBe(false);
    expect(plan.today.caveat).toMatch(/recovery window/i);
  });

  it('adds no caveat when the window has cleared', () => {
    const plan = buildTwoDayPlan(input({
      nfiStatus: 'green',
      nfi: 1.03,
      todayTsb: 4,
      lastMaxEffortAt: '2026-08-01T09:00:00Z',
      recoveryHours: 120,
    }));
    expect(plan.today.recovery.cleared).toBe(true);
    expect(plan.today.caveat).toBeNull();
  });

  it('adds no caveat when no max effort is being prescribed', () => {
    const plan = buildTwoDayPlan(input({
      nfiStatus: 'red',
      nfi: 0.90,
      todayTsb: -25,
      lastMaxEffortAt: '2026-09-04T21:00:00Z',
    }));
    expect(plan.today.sprint.status).not.toBe('green');
    expect(plan.today.caveat).toBeNull();
  });
});
