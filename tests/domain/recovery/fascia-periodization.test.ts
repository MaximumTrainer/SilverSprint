import { describe, it, expect } from 'vitest';
import { FasciaPeriodization } from '../../../src/domain/recovery/fascia-periodization';

describe('FasciaPeriodization.getOIPhase', () => {
  it('returns phase 1 for week 1', () => expect(FasciaPeriodization.getOIPhase(1)).toBe(1));
  it('returns phase 1 for week 2', () => expect(FasciaPeriodization.getOIPhase(2)).toBe(1));
  it('returns phase 2 for week 3', () => expect(FasciaPeriodization.getOIPhase(3)).toBe(2));
  it('returns phase 3 for week 4', () => expect(FasciaPeriodization.getOIPhase(4)).toBe(3));
  it('returns phase 3 for week 5+', () => expect(FasciaPeriodization.getOIPhase(5)).toBe(3));
  it('returns phase 3 for week 10', () => expect(FasciaPeriodization.getOIPhase(10)).toBe(3));
});

describe('FasciaPeriodization.generateWeeklyPlan — structure', () => {
  it('returns exactly 5 day plans for week 1 fascia', () => {
    expect(FasciaPeriodization.generateWeeklyPlan(1, 'fascia').length).toBe(5);
  });
  it('returns exactly 5 day plans for week 3 muscle', () => {
    expect(FasciaPeriodization.generateWeeklyPlan(3, 'muscle').length).toBe(5);
  });
  it('all days have at least one primary movement', () => {
    for (const week of [1, 2, 3, 4] as const) {
      for (const day of FasciaPeriodization.generateWeeklyPlan(week, 'fascia')) {
        expect(day.primaryMovements.length).toBeGreaterThan(0);
      }
    }
  });
  it('all days have at least one exercise cue', () => {
    for (const day of FasciaPeriodization.generateWeeklyPlan(1, 'fascia')) {
      expect(day.exercises.length).toBeGreaterThan(0);
    }
  });
  it('day order follows Mon Tue Wed Thu Fri', () => {
    const days = FasciaPeriodization.generateWeeklyPlan(1, 'fascia').map(d => d.day);
    expect(days).toEqual(['Mon', 'Tue', 'Wed', 'Thu', 'Fri']);
  });
});

describe('FasciaPeriodization.generateWeeklyPlan — CNS demand', () => {
  it('Monday is high CNS demand in weeks 1-2', () => {
    expect(FasciaPeriodization.generateWeeklyPlan(1, 'fascia').find(d => d.day === 'Mon')?.cnsDemand).toBe('high');
    expect(FasciaPeriodization.generateWeeklyPlan(2, 'fascia').find(d => d.day === 'Mon')?.cnsDemand).toBe('high');
  });
  it('Wednesday is high CNS demand in accumulation weeks', () => {
    expect(FasciaPeriodization.generateWeeklyPlan(1, 'fascia').find(d => d.day === 'Wed')?.cnsDemand).toBe('high');
  });
  it('Thursday is low CNS in accumulation weeks', () => {
    expect(FasciaPeriodization.generateWeeklyPlan(1, 'fascia').find(d => d.day === 'Thu')?.cnsDemand).toBe('low');
  });
});

describe('FasciaPeriodization.generateWeeklyPlan — phases', () => {
  it('week 1 uses Accumulation phase', () => {
    for (const day of FasciaPeriodization.generateWeeklyPlan(1, 'fascia')) {
      expect(day.phaseName).toBe('Accumulation');
    }
  });
  it('week 2 uses Accumulation phase', () => {
    for (const day of FasciaPeriodization.generateWeeklyPlan(2, 'fascia')) {
      expect(day.phaseName).toBe('Accumulation');
    }
  });
  it('week 3 uses Intensification phase', () => {
    for (const day of FasciaPeriodization.generateWeeklyPlan(3, 'fascia')) {
      expect(day.phaseName).toBe('Intensification');
    }
  });
  it('week 4 uses Deload phase', () => {
    for (const day of FasciaPeriodization.generateWeeklyPlan(4, 'fascia')) {
      expect(day.phaseName).toBe('Deload');
    }
  });
});

describe('FasciaPeriodization.generateWeeklyPlan — volume modifier', () => {
  it('volumeModifier is 1.0 for weeks 1-3', () => {
    for (const week of [1, 2, 3] as const) {
      for (const day of FasciaPeriodization.generateWeeklyPlan(week, 'fascia')) {
        expect(day.volumeModifier).toBe(1.0);
      }
    }
  });
  it('volumeModifier is 0.55 for week 4', () => {
    for (const day of FasciaPeriodization.generateWeeklyPlan(4, 'fascia')) {
      expect(day.volumeModifier).toBe(0.55);
    }
  });
  it('week 4 sets are reduced (deload)', () => {
    const week1Sets = FasciaPeriodization.generateWeeklyPlan(1, 'fascia')
      .reduce((sum, d) => sum + d.primaryMovements.reduce((s, m) => s + m.sets, 0), 0);
    const week4Sets = FasciaPeriodization.generateWeeklyPlan(4, 'fascia')
      .reduce((sum, d) => sum + d.primaryMovements.reduce((s, m) => s + m.sets, 0), 0);
    expect(week4Sets).toBeLessThan(week1Sets);
  });
});

describe('FasciaPeriodization.generateWeeklyPlan — athlete type', () => {
  it('all movements have at least 1 set regardless of athlete type', () => {
    for (const type of ['fascia', 'muscle'] as const) {
      for (const week of [1, 2, 3, 4] as const) {
        for (const day of FasciaPeriodization.generateWeeklyPlan(week, type)) {
          for (const m of day.primaryMovements) {
            expect(m.sets).toBeGreaterThanOrEqual(1);
          }
        }
      }
    }
  });
  it('oiPhase matches week', () => {
    expect(FasciaPeriodization.generateWeeklyPlan(1, 'fascia')[0].oiPhase).toBe(1);
    expect(FasciaPeriodization.generateWeeklyPlan(3, 'fascia')[0].oiPhase).toBe(2);
    expect(FasciaPeriodization.generateWeeklyPlan(4, 'fascia')[0].oiPhase).toBe(3);
  });
});

describe('FasciaPeriodization.getDayPlan', () => {
  it('returns Accumulation phase for week 1 Mon', () => {
    expect(FasciaPeriodization.getDayPlan(1, 'Mon').phaseName).toBe('Accumulation');
  });
  it('returns Intensification phase for week 3 Mon', () => {
    expect(FasciaPeriodization.getDayPlan(3, 'Mon').phaseName).toBe('Intensification');
  });
  it('returns Deload phase for week 4 Mon', () => {
    expect(FasciaPeriodization.getDayPlan(4, 'Mon').phaseName).toBe('Deload');
  });
  it('returned plan contains the correct day', () => {
    expect(FasciaPeriodization.getDayPlan(2, 'Thu').day).toBe('Thu');
  });
  it('cnsDemand is one of the valid values', () => {
    const { cnsDemand } = FasciaPeriodization.getDayPlan(1, 'Thu');
    expect(['high', 'low', 'rest']).toContain(cnsDemand);
  });
});
