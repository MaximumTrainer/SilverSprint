---
name: live-check
description: Run the real ingestion pipeline against a live Intervals.icu account and print the derived state. Use to confirm a domain or sync change behaves on real data, to diagnose "why does my dashboard show X", or to discover an API quirk the fixtures do not yet reproduce. Covers credential handling and the rate limiter.
---

# Check against a live Intervals.icu account

Fixtures prove the code does what we believe; only a live run proves we believed
the right thing. Most of the real defects in this repo were found this way —
lap data silently discarded, HRV read from the wrong end of the window, the
`/streams` payload shape — none of which any unit test would have caught.

## Credentials

Environment variables only. Never write them to a file, never commit them,
never paste them into a test that stays on disk.

```bash
ICU_ID=<athlete id> ICU_KEY=<api key> npx vitest run tests/__live.test.ts
```

Auth is HTTP Basic with the literal username `API_KEY`:

```js
'Basic ' + Buffer.from(`API_KEY:${process.env.ICU_KEY}`).toString('base64')
```

If the user pastes credentials in chat, use them for the run and let them stay
in the transcript — do not persist them. Grep the repo before committing:

```bash
git diff | grep -nEi "i[0-9]{5,}|apikey|api_key\s*[:=]" 
```

## The harness

Write to `tests/__live.test.ts`, run it, **delete it**. The `__` prefix keeps it
recognisable as scratch. The only trick is rewriting the dev-proxy base
(`INTERVALS_BASE` is `/intervals` outside PROD) to the real host:

```ts
import { describe, it } from 'vitest';
import { buildDashboardState, HttpGet } from '../src/application/dashboard-sync';

describe('live', () => {
  it('dumps derived state', async () => {
    const auth = 'Basic ' + Buffer.from(`API_KEY:${process.env.ICU_KEY}`).toString('base64');
    const httpGet: HttpGet = (url) =>
      fetch(url.replace('/intervals/api', 'https://intervals.icu/api'),
            { headers: { Authorization: auth } }) as any;

    const s = await buildDashboardState({ athleteId: process.env.ICU_ID!, httpGet });

    console.log('age', s.age, 'weight', s.bodyWeightKg);
    console.log('runs', s.activities.length, '| reps', s.intervals.length);
    console.log('NFI', s.nfi, s.nfiStatus, '| todayVmax', s.todayVmax, '| avgVmax', s.avgVmax?.toFixed(2));
    console.log('TSB', s.tsb?.toFixed(2), '| zone', s.strengthZone, '| SRS', s.srs, '| recovery', s.recoveryHours + 'h');
    console.log('wellness row', s.wellness?.id, 'hrv', s.wellness?.hrv);
    console.log('races', s.raceEstimates.map(e => `${e.distance}m ${e.display}`).join('  '));
    console.log('plans', s.sprintRacePlans.map(p => `${p.race.name} in ${p.race.daysUntil}d`).join(', '));
  }, 120000);
});
```

Pass `now`, `raceResults` etc. to exercise specific paths. To test a domain
change without a second sync, call the domain directly on `s.raceEstimatorInput`
— that is what the UI does.

## Rate limiting — one sync per run

A full sync issues one request per activity for lap data, plus a `/streams`
fallback for activities without laps. **Two `buildDashboardState` calls
back-to-back reliably trip a `429`**, and the symptom is misleading: the events
request is late in the sequence, so *race planning silently disappears* while
everything else looks fine.

- Do one sync per run. To compare two variants, sync once and recompute the
  second variant locally from the returned inputs.
- A `429` on `/events` means rate limiting, not a bug in the planner.
- Probe a single endpoint with `curl` rather than a whole sync when you only
  need one payload.

## Probing a single endpoint

```bash
curl -s -u "API_KEY:$ICU_KEY" \
  "https://intervals.icu/api/v1/athlete/$ICU_ID/wellness?oldest=2026-08-25&newest=2026-09-06" \
  -o "$SP/w.json" -w "%{http_code}\n"
```

Endpoints in use: `/athlete/{id}`, `/activities`, `/wellness`, `/events.json`,
`/activity/{id}/intervals`, `/activity/{id}/streams`, `/pace-curves`.

## Interpreting what you get back

- **Future-dated wellness rows are forecasts**, not measurements: no HRV, and
  every future row shares one `updated` timestamp. Reading one as "today" will
  tell you an athlete has recovered when they have not. This has already caused
  one wrong diagnosis — check dates before concluding anything.
- **Short-distance pace-curve values are corrupt** (100 m in 1 second) from GPS
  spikes. Sanity-check implied speeds against ~12.5 m/s before trusting any
  velocity-derived figure.
- Anything surprising and reproducible belongs in the fixtures — see the
  `api-quirk` skill.

## After the run

Delete `tests/__live.test.ts`. Confirm with `ls tests/__*`, and never let one
reach a commit.
