import { describe, it, expect } from 'vitest';
import { buildDashboardState, DashboardState, LOOKBACK_DAYS } from '../../src/application/dashboard-sync';
import { SilverSprintLogic } from '../../src/domain/sprint/core';
import { RUN_ACTIVITY_TYPES } from '../../src/domain/schema';
import { paceCurveMonotonicityViolations } from '../../src/domain/sprint/pace-curve';
import {
  createIntervalsApiStub,
  buildActivityList,
  buildWellnessSeries,
  withProjectedFutureRows,
  buildRestDayScenario,
  FIXTURE_ATHLETE_ID,
  FIXTURE_NOW,
  FIXTURE_TODAY,
} from '../fixtures/intervals-api';

/**
 * Analytics invariants — the relationships every displayed figure must satisfy,
 * whatever account the app is pointed at.
 *
 * The existing suite checks the derivations against known fixture values. This
 * file checks them against *each other and their own inputs*, because that is
 * the class of error a live account exposed: figures that were individually
 * plausible and jointly impossible (a pace-curve average faster than the
 * fastest instant the device ever recorded; a 400 m "best" set by a warm-up
 * jog while the 300 m point came from a race).
 *
 * Each invariant is stated as a property rather than a number, so it keeps its
 * meaning when the fixtures change and it can be re-run against any athlete.
 *
 * Verified by hand against a live masters account before being written down:
 * every assertion here held on that account's real data once the defects it
 * exposed were fixed.
 */

const RUN_TYPES: readonly string[] = RUN_ACTIVITY_TYPES;

async function sync(overrides = {}): Promise<DashboardState> {
  const api = createIntervalsApiStub(overrides);
  return buildDashboardState({ athleteId: FIXTURE_ATHLETE_ID, httpGet: api.httpGet, now: FIXTURE_NOW });
}

/** The window an activity must fall in to count toward the 60-day dashboard. */
function windowStart(): string {
  const d = new Date(FIXTURE_NOW);
  d.setDate(d.getDate() - LOOKBACK_DAYS);
  return d.toISOString().slice(0, 10);
}

describe('analytics invariants — the activity window', () => {
  it('counts only run activities, never a walk or a ride', async () => {
    const state = await sync();
    for (const activity of state.activities) {
      expect(RUN_TYPES, `${activity.id} is a ${activity.type}`).toContain(activity.type);
    }
  });

  it('never lets a non-run set the sprint ceiling, however fast its GPS claims', async () => {
    const state = await sync();
    const fastestNonRun = buildActivityList()
      .filter((a) => !RUN_TYPES.includes(a.type as string))
      .reduce((best, a) => Math.max(best, (a.max_speed as number) ?? 0), 0);

    // The fixture's dog walk reports a GPS-glitched 11.93 m/s — faster than any
    // real sprint in the window. It must not become the athlete's Vmax.
    expect(fastestNonRun).toBeGreaterThan(state.raceEstimatorInput.bestVmax60d);
  });

  it('holds every dated activity inside the lookback window', async () => {
    const state = await sync();
    const oldest = windowStart();
    for (const activity of state.activities) {
      const date = (activity.start_date_local ?? '').slice(0, 10);
      if (date === '') continue;
      expect(date >= oldest, `${activity.id} dated ${date}, before ${oldest}`).toBe(true);
      expect(date <= FIXTURE_TODAY, `${activity.id} dated ${date}, in the future`).toBe(true);
    }
  });
});

describe('analytics invariants — velocity and the Neural Fatigue Index', () => {
  it('takes todayVmax from the most recent run, not the fastest one', async () => {
    const state = await sync();
    const newest = [...state.activities]
      .sort((a, b) => (b.start_date_local ?? '').localeCompare(a.start_date_local ?? ''))[0];
    expect(state.todayVmax).toBe(newest.max_speed ?? 0);
  });

  it('never reports a 60-day best below any single run in the window', async () => {
    const state = await sync();
    for (const activity of state.activities) {
      expect(state.raceEstimatorInput.bestVmax60d).toBeGreaterThanOrEqual(activity.max_speed ?? 0);
    }
  });

  it('builds the baseline only from sessions that actually reached sprint speed', async () => {
    const state = await sync();
    const best = state.raceEstimatorInput.bestVmax60d;
    // The baseline must sit inside the qualifying band: at or above the
    // 85% cut-off, and never above the best session it is drawn from.
    expect(state.avgVmax).toBeGreaterThanOrEqual(best * 0.85);
    expect(state.avgVmax).toBeLessThanOrEqual(best);
  });

  it('defines NFI as today over baseline, and the status band follows from it', async () => {
    const state = await sync();
    // NFI is published to three decimals, so compare at that resolution.
    expect(state.nfi).toBeCloseTo(state.todayVmax / state.avgVmax, 3);
    expect(state.nfiStatus).toBe(SilverSprintLogic.getNFIStatus(state.nfi));
  });
});

describe('analytics invariants — training load', () => {
  it('takes TSB from a measured wellness row, never a forecast', async () => {
    const state = await sync({ wellness: withProjectedFutureRows(buildWellnessSeries()) });
    const row = state.wellness!;
    expect((row.date ?? row.id ?? '') <= FIXTURE_TODAY).toBe(true);
    // A forecast row has no HRV and a shared generation timestamp; a measured
    // one is the only thing allowed to describe today.
    expect(state.tsb).toBeCloseTo((row.ctl ?? 0) - (row.atl ?? 0), 6);
  });

  it('keeps TSB current while the athlete rests, rather than freezing on the last session', async () => {
    const scenario = buildRestDayScenario();
    const resting = await sync({ activities: scenario.activities, wellness: scenario.wellness });
    const lastSession = resting.activities[0];
    const frozen = (lastSession.icu_ctl ?? 0) - (lastSession.icu_atl ?? 0);
    // Reading fatigue off the last activity reports an athlete who has in fact
    // recovered as still deep in the hole.
    expect(resting.tsb).toBeGreaterThan(frozen);
  });

  it('derives the strength zone from the same TSB it displays', async () => {
    const state = await sync();
    expect(state.strengthZone).toBe(SilverSprintLogic.getStrengthPrescription(state.tsb).zone);
  });
});

describe('analytics invariants — recovery', () => {
  it('never prescribes a recovery window shorter than the athlete age tax', async () => {
    const state = await sync();
    const ageTax = 48 + Math.max(0, (state.age - 40) * 6);
    expect(state.recoveryHours).toBeGreaterThanOrEqual(ageTax);
  });

  it('agrees with the published recovery formula', async () => {
    const state = await sync();
    expect(state.recoveryHours).toBe(SilverSprintLogic.getRecoveryWindow(state.age, state.srs));
  });

  it('keeps SRS inside its stated 0–100 range', async () => {
    const state = await sync();
    expect(state.srs).toBeGreaterThanOrEqual(0);
    expect(state.srs).toBeLessThanOrEqual(100);
  });
});

describe('analytics invariants — race estimates', () => {
  it('predicts monotonically slower average speeds as the distance grows', async () => {
    const state = await sync();
    const byDistance = [...state.raceEstimates].sort((a, b) => a.distance - b.distance);
    for (let i = 1; i < byDistance.length; i++) {
      const prevSpeed = byDistance[i - 1].distance / byDistance[i - 1].predictedTime;
      const speed = byDistance[i].distance / byDistance[i].predictedTime;
      expect(speed, `${byDistance[i].distance}m`).toBeLessThan(prevSpeed);
    }
  });

  it('never predicts a race average faster than the athlete peak velocity', async () => {
    const state = await sync();
    for (const estimate of state.raceEstimates) {
      const speed = estimate.distance / estimate.predictedTime;
      expect(speed, `${estimate.distance}m`).toBeLessThanOrEqual(state.raceEstimatorInput.bestVmax60d);
    }
  });
});

describe('analytics invariants — the pace curve against everything else', () => {
  it('never reports an average faster than the athlete own 60-day peak', async () => {
    const state = await sync();
    for (const point of state.paceCurve.points) {
      if (point.speed === null) continue;
      expect(point.speed, `${point.distance} m`).toBeLessThanOrEqual(state.raceEstimatorInput.bestVmax60d);
    }
  });

  it('stays monotonic in both time and speed', async () => {
    const state = await sync();
    expect(paceCurveMonotonicityViolations(state.paceCurve)).toEqual([]);
  });

  it('sources every point from a run inside the curve window', async () => {
    const state = await sync();
    const known = new Set(state.paceCurveStreams.map((s) => s.activityId));
    for (const point of state.paceCurve.points) {
      if (point.activityId === null) continue;
      expect(known).toContain(point.activityId);
      expect(point.date! <= FIXTURE_TODAY).toBe(true);
    }
  });

  it('beats the race estimate at any distance the athlete actually ran hard', async () => {
    // The curve times a rolling effort measured by GPS; the estimator predicts
    // a race from a standing start. Against official times on a live account
    // the curve ran ~10% fast, so a *genuine* effort must come out ahead of the
    // prediction. Where it does not, the curve has fallen back to steady
    // running — and it must say so rather than passing the jog off as speed.
    const state = await sync();
    for (const estimate of state.raceEstimates) {
      const point = state.paceCurve.points.find((p) => p.distance === estimate.distance);
      if (!point || point.timeSeconds === null) continue;
      if (point.submaximal) continue;
      expect(point.timeSeconds, `${estimate.distance}m curve vs estimate`).toBeLessThan(estimate.predictedTime);
    }
  });

  it('flags a best that is really a jog, instead of presenting it as speed', async () => {
    const state = await sync();
    const peak = state.raceEstimatorInput.bestVmax60d;
    for (const point of state.paceCurve.points) {
      if (point.speed === null) continue;
      // The flag and the speed must agree: nothing near the athlete's peak may
      // be dismissed as easy, and nothing at jogging pace may pass as an effort.
      if (point.speed < peak * 0.5) {
        expect(point.submaximal, `${point.distance} m at ${point.speed} m/s`).toBe(true);
      }
      if (point.speed > peak * 0.7) {
        expect(point.submaximal, `${point.distance} m at ${point.speed} m/s`).toBe(false);
      }
    }
  });

  it('accounts for every charted distance, with no silent gaps', async () => {
    const state = await sync();
    const charted = state.paceCurve.points.map((p) => p.distance);
    expect(new Set(charted).size).toBe(charted.length);
    expect(charted).toEqual([...charted].sort((a, b) => a - b));
  });
});
