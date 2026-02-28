/**
 * Shared domain types used across sprint and recovery modules.
 *
 * Extracted from individual modules to eliminate circular imports
 * and provide a single source of truth for core type definitions.
 */

/** Neural Fatigue Index traffic-light status */
export type NFIStatus = 'green' | 'amber' | 'red';

/** Heart Rate Variability data for SRS calculation */
export interface HRVData {
  currentHRV: number;
  avgHRV7d: number;
}

/** Strength training zone prescription */
export interface StrengthPrescription {
  zone: 'fresh' | 'tired' | 'fatigued';
  intensity: 'high' | 'moderate' | 'none';
  focus: string;
}

/** Daily data point for time-series charting */
export interface DailyDataPoint {
  date: string;
  dayLabel: string;
  nfi: number | null;
  tsb: number | null;
  recoveryHours: number | null;
}
