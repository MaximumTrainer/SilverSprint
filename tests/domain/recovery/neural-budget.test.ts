import { describe, it, expect } from 'vitest';
import { NeuralBudget, NeuralBudgetEntry } from '../../../src/domain/recovery/neural-budget';

const TODAY = '2026-02-28';

describe('NeuralBudget.BUDGET_COSTS', () => {
  it('high-intensity cost is -30', () => expect(NeuralBudget.BUDGET_COSTS['high-intensity']).toBe(-30));
  it('oscillatory cost is -20',    () => expect(NeuralBudget.BUDGET_COSTS['oscillatory']).toBe(-20));
  it('sleep cost is +5 per hour',  () => expect(NeuralBudget.BUDGET_COSTS['sleep']).toBe(5));
  it('tempo cost is +10',          () => expect(NeuralBudget.BUDGET_COSTS['tempo']).toBe(10));
});

describe('NeuralBudget.calculateDailyBudget', () => {
  it('returns baseline 50 for empty entries', () => {
    expect(NeuralBudget.calculateDailyBudget([])).toBe(50);
  });

  it('8h sleep adds +40 → 90', () => {
    const entries: NeuralBudgetEntry[] = [{ date: TODAY, type: 'sleep', value: 8 }];
    expect(NeuralBudget.calculateDailyBudget(entries)).toBe(90);
  });

  it('6h sleep adds +30 → 80', () => {
    const entries: NeuralBudgetEntry[] = [{ date: TODAY, type: 'sleep', value: 6 }];
    expect(NeuralBudget.calculateDailyBudget(entries)).toBe(80);
  });

  it('one sprint session subtracts 30 → 20', () => {
    const entries: NeuralBudgetEntry[] = [{ date: TODAY, type: 'high-intensity', value: 1 }];
    expect(NeuralBudget.calculateDailyBudget(entries)).toBe(20);
  });

  it('one oscillatory session subtracts 20 → 30', () => {
    const entries: NeuralBudgetEntry[] = [{ date: TODAY, type: 'oscillatory', value: 1 }];
    expect(NeuralBudget.calculateDailyBudget(entries)).toBe(30);
  });

  it('tempo adds +10 → 60', () => {
    const entries: NeuralBudgetEntry[] = [{ date: TODAY, type: 'tempo', value: 1 }];
    expect(NeuralBudget.calculateDailyBudget(entries)).toBe(60);
  });

  it('8h sleep + 1 sprint session → 60', () => {
    const entries: NeuralBudgetEntry[] = [
      { date: TODAY, type: 'sleep', value: 8 },
      { date: TODAY, type: 'high-intensity', value: 1 },
    ];
    expect(NeuralBudget.calculateDailyBudget(entries)).toBe(60);
  });

  it('two sprint sessions + 1 OI, no sleep → clamped to 0', () => {
    const entries: NeuralBudgetEntry[] = [
      { date: TODAY, type: 'high-intensity', value: 1 },
      { date: TODAY, type: 'high-intensity', value: 1 },
      { date: TODAY, type: 'oscillatory', value: 1 },
    ];
    // 50 - 30 - 30 - 20 = -30 → clamped to 0
    expect(NeuralBudget.calculateDailyBudget(entries)).toBe(0);
  });

  it('does not exceed 100 (clamped at ceiling)', () => {
    const entries: NeuralBudgetEntry[] = [
      { date: TODAY, type: 'sleep', value: 10 },
      { date: TODAY, type: 'tempo', value: 1 },
    ];
    // 50 + 50 + 10 = 110 → clamped to 100
    expect(NeuralBudget.calculateDailyBudget(entries)).toBe(100);
  });

  it('sleep value is treated as hours (pro-rated)', () => {
    const entries: NeuralBudgetEntry[] = [{ date: TODAY, type: 'sleep', value: 4 }];
    // 50 + (4 * 5) = 70
    expect(NeuralBudget.calculateDailyBudget(entries)).toBe(70);
  });
});

describe('NeuralBudget.requiresNeuralResetDay', () => {
  it('both below 20 → requires reset', () => expect(NeuralBudget.requiresNeuralResetDay([15, 18])).toBe(true));
  it('both at 0 → requires reset',     () => expect(NeuralBudget.requiresNeuralResetDay([0, 0])).toBe(true));
  it('only first below 20 → no reset', () => expect(NeuralBudget.requiresNeuralResetDay([15, 25])).toBe(false));
  it('only second below 20 → no reset', () => expect(NeuralBudget.requiresNeuralResetDay([25, 15])).toBe(false));
  it('both at exactly 20 → no reset (boundary)', () => expect(NeuralBudget.requiresNeuralResetDay([20, 20])).toBe(false));
  it('both well above 20 → no reset', () => expect(NeuralBudget.requiresNeuralResetDay([50, 60])).toBe(false));
});

describe('NeuralBudget.getBudgetColor', () => {
  it('100 → green', () => expect(NeuralBudget.getBudgetColor(100)).toBe('green'));
  it('75 → green',  () => expect(NeuralBudget.getBudgetColor(75)).toBe('green'));
  it('60 → green',  () => expect(NeuralBudget.getBudgetColor(60)).toBe('green'));
  it('59 → amber',  () => expect(NeuralBudget.getBudgetColor(59)).toBe('amber'));
  it('50 → amber',  () => expect(NeuralBudget.getBudgetColor(50)).toBe('amber'));
  it('30 → amber',  () => expect(NeuralBudget.getBudgetColor(30)).toBe('amber'));
  it('29 → red',    () => expect(NeuralBudget.getBudgetColor(29)).toBe('red'));
  it('20 → red',    () => expect(NeuralBudget.getBudgetColor(20)).toBe('red'));
  it('0 → red',     () => expect(NeuralBudget.getBudgetColor(0)).toBe('red'));
});
