---
name: api-quirk
description: Turn a real Intervals.icu API behaviour into a fixture, a failing test, a fix and a documented row. Use when live data disagrees with the code's assumptions, when a schema rejects a real payload, or when adding any handling for how the upstream API actually behaves. This is the repo's core testing idiom.
---

# Capture an API quirk as a regression

Every significant bug in this repo has the same shape: the code assumed
something about the Intervals.icu API that is not true, and no test disagreed
because the fixtures encoded the same assumption. The fix is not just the code
change — it is making the fixture tell the truth, so the assumption can never
quietly return.

## The loop

1. **Observe it live.** Use the `live-check` skill, or `curl` one endpoint.
   Confirm it is real and reproducible, not a one-off.
2. **Reproduce it in the fixture.** Add the trait to
   `tests/fixtures/intervals-api.ts`, and add a line to the "Real-world traits
   these fixtures reproduce" list at the top of that file.
3. **Write the failing test** asserting the *correct* behaviour, in
   `tests/application/dashboard-sync.test.ts` or the relevant domain suite. Run
   it and watch it fail — a test that never failed proves nothing.
4. **Fix the code.**
5. **Document it** in the README's *Intervals.icu API Quirks* table: the trait,
   and why it matters.

## Fixture rules

- **No production PII.** `agents.md` forbids it. Reproduce the *shape, ordering
  and value ranges* of real responses; invent the identity. The fixture athlete
  is `i90210`, "Masters Test Sprinter", with a synthetic DOB.
- **Deterministic.** Fixed reference date (`FIXTURE_NOW`), no `Math.random`, no
  dependence on the real weekday or the local timezone. A fixture that changes
  with the calendar produces a suite that fails on Tuesdays.
- **Export the constants the tests assert on** (`FIXTURE_TODAY_HRV`,
  `REST_DAY_TODAY`, …) so a fixture change cannot silently invalidate an
  assertion.
- Add a **named scenario builder** for a distinct situation rather than
  overloading the base catalogue — see `buildRestDayScenario` and
  `withProjectedFutureRows`.

## The stub

`createIntervalsApiStub(overrides)` serves all six endpoints in memory and
records every request. Use `overrides` for `activities`, `wellness`, `profile`,
`events`, and `failing: { '/wellness': 503 }` to force a status.

Match request paths with `lapDataRequests()` / `streamRequests()`, **not**
`callsMatching('/intervals')` — `INTERVALS_BASE` is itself `/intervals` outside
PROD, so a substring match hits every request.

## Quirks already captured

Check these before assuming a new one; the answer may already be here.

| Trait | Consequence if assumed away |
|---|---|
| `/activities` newest-first, `/wellness` **oldest-first** | `entries[0]` silently reads a 60-day-old HRV |
| `max_speed: null` on manual / no-GPS activities | required-number schema erases the session entirely |
| Auto-detected laps always carry `label: null` | `z.string().optional()` rejects them, so *all* rep analysis is lost |
| `/streams` returns a bare array of `{ type, data }` | reading `streams.velocity_smooth.data` yields nothing |
| `null` samples in velocity streams | `Math.max` and running sums produce `NaN` |
| Warm-up jogs typed `WORK`; `RECOVERY` laps hold the session peak | lap `type` cannot identify sprint efforts |
| `average_speed` can exceed `max_speed` on short laps | flying velocity faster than the rep's own peak |
| Weight in `icu_weight`; Strava `weight` is null | body-weight strength loads come out empty |
| Future-dated wellness rows are **forecasts** | a planned rest day reports the athlete as already recovered |
| Pace-curve values below ~250 m are corrupt (100 m in 1 s) | any velocity derived from them is nonsense |
| Per-activity request bursts draw `429` | whatever is requested last silently disappears |

## Schema conventions

Intervals.icu emits explicit `null` for absent values, not `undefined`. Use
`.nullish()`, not `.optional()`, or real payloads get rejected.

Distinguish "no data" from "zero": `max_speed: null` means no GPS trace and must
not become `0`, which reads as "stationary" and drags averages down. Where a
default genuinely is zero (`icu_atl`), transform explicitly.

## Definition of done

- [ ] Fixture reproduces the trait, listed in the header comment
- [ ] Test failed before the fix, passes after
- [ ] Row added to the README quirks table
- [ ] Verified against the live account, not just the fixture
