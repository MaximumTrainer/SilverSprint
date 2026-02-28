export type NeuralBudgetEntryType = 'high-intensity' | 'oscillatory' | 'sleep' | 'tempo';

export interface NeuralBudgetEntry {
  date: string;       // ISO YYYY-MM-DD
  type: NeuralBudgetEntryType;
  /** For sleep: hours slept. For all other types: number of session occurrences (usually 1). */
  value: number;
}

export interface DailyBudgetSummary {
  budget: number;          // 0–100, clamped
  color: 'green' | 'amber' | 'red';
  requiresReset: boolean;
  breakdown: {
    sleepContribution: number;
    sessionCost: number;
    baseline: number;
  };
}

/** Baseline budget each athlete starts each day with */
const BASELINE = 50;

/**
 * §5.1 — The "Training Bank" Neural Budget
 *
 * Treats the athlete as having a Daily Neural Budget (0–100%).
 *
 * Costs and gains per event:
 *   High-Intensity session (sprints/plyos): −30
 *   Oscillatory / Heavy Lifting:            −20
 *   Sleep (per hour):                       +5  (8h → +40, 6h → +30)
 *   Low-HR Recovery Tempo:                  +10
 *
 * If budget drops below 20% for two consecutive days → Neural Reset Day required.
 */
export class NeuralBudget {
  /**
   * Cost or gain per unit, by entry type.
   * For 'sleep' this is per hour (multiply by entry.value).
   * For all others, multiply by entry.value (number of session occurrences).
   */
  static readonly BUDGET_COSTS: Readonly<Record<NeuralBudgetEntryType, number>> = {
    'high-intensity': -30,
    'oscillatory': -20,
    'sleep': 5,    // per hour
    'tempo': 10,
  };

  /**
   * Calculates the total neural budget for a collection of entries.
   * Starts at a baseline of 50. Result clamped to [0, 100].
   */
  static calculateDailyBudget(entries: NeuralBudgetEntry[]): number {
    let total = BASELINE;

    for (const entry of entries) {
      total += NeuralBudget.BUDGET_COSTS[entry.type] * entry.value;
    }

    return Math.max(0, Math.min(100, Math.round(total)));
  }

  /**
   * Returns true if a Neural Reset Day is required.
   * Condition: both days in the pair have a budget strictly below 20.
   */
  static requiresNeuralResetDay(last2DayBudgets: [number, number]): boolean {
    return last2DayBudgets[0] < 20 && last2DayBudgets[1] < 20;
  }

  /**
   * Maps a budget value to a traffic-light colour.
   *  ≥ 60 → 'green'
   * 30–59 → 'amber'
   *  < 30 → 'red'
   */
  static getBudgetColor(budget: number): 'green' | 'amber' | 'red' {
    if (budget >= 60) return 'green';
    if (budget >= 30) return 'amber';
    return 'red';
  }
}
