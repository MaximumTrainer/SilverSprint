/**
 * Legacy schema re-export — all types live in src/domain/schema.ts.
 * This file exists for backward compatibility with older import paths.
 */
export {
  RUN_ACTIVITY_TYPES,
  IntervalsActivitySchema,
  IntervalsWellnessSchema,
  IntervalsEventSchema,
  IntervalsAthleteSchema,
} from './domain/schema';

export type {
  IntervalsActivity,
  IntervalsWellness,
  IntervalsEvent,
  IntervalsAthlete,
} from './domain/schema';