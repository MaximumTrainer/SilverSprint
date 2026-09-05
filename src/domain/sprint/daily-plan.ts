import type { NFIStatus } from '../types';
import { StrengthZoneBand, getStrengthZoneBand } from './core';
import { StrengthPeriodization, PeriodizationPrescription } from './periodization';
import { SprintWorkout, SprintWorkoutGenerator, isStaleVmax } from './workouts';

/**
 * §3.5 — Two-day training recommendation.
 *
 * The dashboard prescribes today. An athlete planning a week needs to know
 * what today's session costs them tomorrow — whether the recovery window will
 * have cleared, and what fatigue they will be carrying into the next session.
 *
 * Every figure here comes from the revised scoring:
 *   - TSB is today's wellness row, not the last training day's
 *   - the strength band comes from STRENGTH_ZONE_BANDS
 *   - tomorrow's TSB is Intervals.icu's own forecast where it exists, and an
 *     explicit rest-day decay model where it does not
 *
 * Nothing about tomorrow's *neural* state is invented. NFI is a measurement of
 * sprint velocity, and tomorrow's velocity is unknown, so tomorrow's sprint
 * guidance is expressed through the age-adjusted recovery window — which is a
 * real, already-computed quantity — rather than a fabricated NFI.
 */

/** Where a day's TSB figure came from. */
export type TsbSource =
  /** Measured: the athlete's wellness row for that date. */
  | 'recorded'
  /** Intervals.icu's forecast, which accounts for workouts already on the calendar. */
  | 'projected'
  /** Our own decay model, assuming no training. Used when no forecast exists. */
  | 'modelled';

export interface RecoveryStatus {
  /** Hours since the last max-effort sprint, or null when there was none in the window. */
  hoursSinceMaxEffort: number | null;
  /** The athlete's age- and readiness-adjusted window between max-effort sessions. */
  windowHours: number;
  /** Hours still to run before the window clears. Zero once cleared. */
  hoursRemaining: number;
  /** True when a max-effort session is available again. */
  cleared: boolean;
}

export interface DayRecommendation {
  /** 'today' or 'tomorrow'. */
  day: 'today' | 'tomorrow';
  /** ISO date, YYYY-MM-DD. */
  date: string;
  tsb: number;
  tsbSource: TsbSource;
  strengthBand: StrengthZoneBand;
  strength: PeriodizationPrescription;
  sprint: SprintWorkout;
  recovery: RecoveryStatus;
  /** One-line summary of the day's prescription. */
  headline: string;
  /**
   * True when the day's sprint prescription rests on an assumption rather than
   * a measurement — always the case for tomorrow, whose NFI cannot be known
   * until the athlete actually sprints.
   */
  provisional: boolean;
  /**
   * Set when the two signals disagree: NFI clears a max-effort session while
   * the age-adjusted recovery window has not yet elapsed.
   *
   * The app is neural-first by design, so NFI decides the prescription — but
   * the athlete deserves to see that the other signal dissents rather than
   * having it quietly dropped.
   */
  caveat: string | null;
}

export interface TwoDayPlan {
  today: DayRecommendation;
  tomorrow: DayRecommendation;
  /** Plain-language statement of what tomorrow's figures assume. */
  tomorrowBasis: string;
}

export interface DailyPlanInput {
  /** Reference time; "tomorrow" is the following calendar day. */
  now: Date;
  nfi: number;
  nfiStatus: NFIStatus;
  /** Today's TSB, from the wellness record. */
  todayTsb: number;
  /**
   * Tomorrow's TSB as forecast by Intervals.icu, or null when the account has
   * no forward projection. A null falls back to the rest-day decay model.
   */
  projectedTomorrowTsb: number | null;
  /** Today's CTL and ATL, needed for the fallback decay model. */
  ctl: number;
  atl: number;
  /** Age- and readiness-adjusted recovery window, in hours. */
  recoveryHours: number;
  /** ISO timestamp of the most recent max-effort sprint session. */
  lastMaxEffortAt: string | null;
}

/** ATL is a 7-day exponential moving average; CTL is 42-day. */
const ATL_TIME_CONSTANT = 7;
const CTL_TIME_CONSTANT = 42;

const HOURS_PER_DAY = 24;

/**
 * TSB after one further day carrying no training load.
 *
 * This is the standard impulse-response decay, not an estimate: with a load of
 * zero, both averages simply relax toward zero by their own time constants.
 */
export function decayTsbOneRestDay(ctl: number, atl: number): number {
  const nextCtl = ctl + (0 - ctl) / CTL_TIME_CONSTANT;
  const nextAtl = atl + (0 - atl) / ATL_TIME_CONSTANT;
  return nextCtl - nextAtl;
}

/** ISO date for `now` offset by whole days, in the same timezone basis as the app's windows. */
function isoDateOffset(now: Date, days: number): string {
  const d = new Date(now);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Position within the recovery window at a given moment. */
export function assessRecovery(
  now: Date,
  lastMaxEffortAt: string | null,
  windowHours: number,
): RecoveryStatus {
  if (!lastMaxEffortAt) {
    // No max-effort session on record: nothing to recover from.
    return { hoursSinceMaxEffort: null, windowHours, hoursRemaining: 0, cleared: true };
  }

  const last = new Date(lastMaxEffortAt);
  if (Number.isNaN(last.getTime())) {
    return { hoursSinceMaxEffort: null, windowHours, hoursRemaining: 0, cleared: true };
  }

  const hoursSince = Math.max(0, (now.getTime() - last.getTime()) / 3_600_000);
  const hoursRemaining = Math.max(0, windowHours - hoursSince);

  return {
    hoursSinceMaxEffort: parseFloat(hoursSince.toFixed(1)),
    windowHours,
    hoursRemaining: parseFloat(hoursRemaining.toFixed(1)),
    cleared: hoursRemaining <= 0,
  };
}

/**
 * The neural status to plan tomorrow around.
 *
 * Tomorrow's real NFI is unknowable — it is a measurement of a sprint that has
 * not happened. What *is* known is whether the recovery window will have
 * cleared. Until it has, a max-effort session is not on offer whatever today's
 * NFI says; once it has, today's status is the best available estimate and is
 * marked provisional.
 */
export function projectNfiStatus(
  todayStatus: NFIStatus,
  recoveryTomorrow: RecoveryStatus,
  tomorrowTsb: number,
): NFIStatus {
  if (!recoveryTomorrow.cleared) {
    // Inside the window. Amber (technical work) when fatigue has largely
    // dissipated, red while it has not.
    return tomorrowTsb >= 0 ? 'amber' : 'red';
  }
  return todayStatus;
}


/**
 * Note when the sprint verdict and the recovery window disagree.
 *
 * NFI is a measurement of today's actual velocity and the model treats it as
 * primary; the recovery window is a population-derived guideline. Where they
 * conflict, the prescription follows NFI and this explains the dissent.
 */
function buildCaveat(sprint: SprintWorkout, recovery: RecoveryStatus): string | null {
  const offersMaxEffort = sprint.status === 'green';
  if (!offersMaxEffort || recovery.cleared || recovery.hoursRemaining <= 0) return null;

  const remaining = recovery.hoursRemaining;
  const readable = remaining >= HOURS_PER_DAY
    ? `${Math.round(remaining / HOURS_PER_DAY)} more day${Math.round(remaining / HOURS_PER_DAY) === 1 ? '' : 's'}`
    : `${Math.round(remaining)}h`;

  return `Velocity says you are ready, but your ${Math.round(recovery.windowHours)}h recovery window has ${readable} left. Cut volume if the session feels flat.`;
}

function buildHeadline(
  day: 'today' | 'tomorrow',
  sprint: SprintWorkout,
  band: StrengthZoneBand,
  recovery: RecoveryStatus,
): string {
  const parts = [sprint.name, `${band.label} for strength`];

  if (!recovery.cleared && recovery.hoursRemaining > 0) {
    const hours = Math.round(recovery.hoursRemaining);
    parts.push(
      hours >= HOURS_PER_DAY
        ? `max effort available in ~${Math.round(hours / HOURS_PER_DAY)}d`
        : `max effort available in ~${hours}h`,
    );
  } else if (day === 'today') {
    parts.push('recovery window clear');
  }

  return parts.join(' · ');
}

/**
 * Build today's and tomorrow's recommendations.
 */
export function buildTwoDayPlan(input: DailyPlanInput): TwoDayPlan {
  const {
    now, nfi, nfiStatus, todayTsb, projectedTomorrowTsb,
    ctl, atl, recoveryHours, lastMaxEffortAt,
  } = input;

  // ── Today ────────────────────────────────────────────────────────────────
  const todayRecovery = assessRecovery(now, lastMaxEffortAt, recoveryHours);
  const todayBand = getStrengthZoneBand(todayTsb);
  const todaySprint = SprintWorkoutGenerator.generate(nfiStatus, nfi, { tsb: todayTsb });
  const todayStrength = StrengthPeriodization.getPrescription(todayTsb);

  const today: DayRecommendation = {
    day: 'today',
    date: isoDateOffset(now, 0),
    tsb: parseFloat(todayTsb.toFixed(2)),
    tsbSource: 'recorded',
    strengthBand: todayBand,
    strength: todayStrength,
    sprint: todaySprint,
    recovery: todayRecovery,
    headline: buildHeadline('today', todaySprint, todayBand, todayRecovery),
    provisional: false,
    caveat: buildCaveat(todaySprint, todayRecovery),
  };

  // ── Tomorrow ─────────────────────────────────────────────────────────────
  const hasProjection = typeof projectedTomorrowTsb === 'number' && Number.isFinite(projectedTomorrowTsb);
  const tomorrowTsb = hasProjection ? (projectedTomorrowTsb as number) : decayTsbOneRestDay(ctl, atl);
  const tomorrowSource: TsbSource = hasProjection ? 'projected' : 'modelled';

  const tomorrowNow = new Date(now.getTime() + HOURS_PER_DAY * 3_600_000);
  const tomorrowRecovery = assessRecovery(tomorrowNow, lastMaxEffortAt, recoveryHours);
  const tomorrowStatus = projectNfiStatus(nfiStatus, tomorrowRecovery, tomorrowTsb);
  const tomorrowBand = getStrengthZoneBand(tomorrowTsb);
  const tomorrowSprint = SprintWorkoutGenerator.generate(tomorrowStatus, nfi, { tsb: tomorrowTsb });
  const tomorrowStrength = StrengthPeriodization.getPrescription(tomorrowTsb);

  const tomorrow: DayRecommendation = {
    day: 'tomorrow',
    date: isoDateOffset(now, 1),
    tsb: parseFloat(tomorrowTsb.toFixed(2)),
    tsbSource: tomorrowSource,
    strengthBand: tomorrowBand,
    strength: tomorrowStrength,
    sprint: tomorrowSprint,
    recovery: tomorrowRecovery,
    headline: buildHeadline('tomorrow', tomorrowSprint, tomorrowBand, tomorrowRecovery),
    provisional: true,
    caveat: buildCaveat(tomorrowSprint, tomorrowRecovery),
  };

  const tomorrowBasis = hasProjection
    ? 'Fatigue projected by Intervals.icu from the workouts already on your calendar. Sprint status is provisional until you actually sprint.'
    : 'Fatigue modelled assuming you do not train today. Sprint status is provisional until you actually sprint.';

  return { today, tomorrow, tomorrowBasis };
}

/**
 * Pick the most recent session that counts as a max effort.
 *
 * Uses the same sprint-session rule as the NFI baseline: a session whose peak
 * velocity reached {@link SPRINT_SESSION_VMAX_FRACTION} of the window's best.
 * An easy run does not start a recovery window.
 */
export function findLastMaxEffort<T extends { start_date_local?: string; max_speed?: number | null }>(
  activities: T[],
  windowBestVmax: number,
  sprintFraction: number,
): string | null {
  if (!(windowBestVmax > 0)) return null;
  const threshold = windowBestVmax * sprintFraction;

  const candidates = activities
    .filter((a) => typeof a.max_speed === 'number' && a.max_speed >= threshold && a.start_date_local)
    .map((a) => a.start_date_local as string)
    .sort((a, b) => b.localeCompare(a));

  return candidates[0] ?? null;
}

export { isStaleVmax };
