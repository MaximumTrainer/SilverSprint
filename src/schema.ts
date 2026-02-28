import { z } from 'zod';

export const IntervalsActivitySchema = z.object({
  id: z.string(),
  type: z.literal('Run'),
  start_date_local: z.string().optional(),
  velocity_smooth: z.array(z.number()).default([]),
  max_speed: z.number(),
  icu_training_load: z.number(),
  icu_atl: z.number(), // Fatigue
  icu_ctl: z.number(), // Fitness
});

export type IntervalsActivity = z.infer<typeof IntervalsActivitySchema>;

export const IntervalsWellnessSchema = z.object({
  id: z.string(),
  date: z.string().optional(),
  hrv: z.number().optional(),
  restingHR: z.number().optional(),
  readiness: z.number().optional(),
  weight: z.number().optional(),
});

export type IntervalsWellness = z.infer<typeof IntervalsWellnessSchema>;

export const IntervalsEventSchema = z.object({
  id: z.union([z.string(), z.number()]).transform(String),
  category: z.string(),
  start_date_local: z.string(),
  name: z.string().nullish(),
  type: z.string().nullish(),
  /** Distance in metres (planned distance on the event) */
  distance: z.number().nullish(),
  /** Distance target in metres (alternative field for planned races) */
  distance_target: z.number().nullish(),
});

export type IntervalsEvent = z.infer<typeof IntervalsEventSchema>;

export const IntervalsAthleteSchema = z.object({
  id: z.union([z.string(), z.number()]).transform(String),
  name: z.string().optional(),
  /** Date of birth, ISO format e.g. "1980-06-15" */
  dob: z.string().optional(),
  /** Body weight in kg */
  weight: z.number().optional(),
  /** Sex: "M" | "F" | "X" */
  sex: z.string().optional(),
});

export type IntervalsAthlete = z.infer<typeof IntervalsAthleteSchema>;