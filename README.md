# SilverSprint — Neural-First Sprint Intelligence for Masters Athletes

**Version:** 1.0.0
**License:** MIT
**Target Population:** Masters Track & Field Sprinters (35+)
**Data Source:** [Intervals.icu](https://intervals.icu) API
**Stack:** Vite · React · TypeScript · Tailwind CSS · Recharts · Zod · Vercel

---

## Philosophy

For aging sprinters, the Central Nervous System is the primary performance bottleneck — not VO₂max or lactate threshold. SilverSprint automates neural fatigue detection, recovery prescription, and training auto-regulation so you spend your limited CNS budget on the sessions that matter most.

---

## Features

### Neural Fatigue Index (NFI)

Compares today's max velocity against a rolling 30-day baseline:

$$NFI = \frac{V_{max,today}}{V_{max,30d\;avg}}$$

The baseline counts **only sessions that actually reached sprint speed** — those
whose Vmax is at least 85% of the best Vmax in the window. Easy runs, warm-up
jogs and trail runs peak several m/s below sprint Vmax, so averaging every
logged run pulls the baseline far under true top speed and leaves NFI
permanently above 1.0, which disables the traffic light entirely. Activities
with no GPS trace (`max_speed: null`) carry no velocity signal and are skipped
rather than counted as 0 m/s.

Traffic-light system: **Green** (>97%) · **Amber** (94–97%) · **Red** (<94%)

Stale-Vmax detection: when NFI is low but TSB is positive, the system recognises detraining rather than fatigue and recommends a neural re-activation session instead of rest.

### Sprint Recovery Score (SRS)

Composite 0–100 readiness metric blending three signals:

$$SRS = 0.45 \times HRV_{score} + 0.30 \times TSB_{score} + 0.25 \times NFI_{score}$$

### Age-Adjusted Recovery Windows

$$Recovery_{hours} = 48 + \max(0, (Age - 40) \times 6) + \text{round}\!\left((1 - \tfrac{SRS}{100}) \times 48\right)$$

### 1 Hz Velocity Stream Parser

Walks the `velocity_smooth` array from Intervals.icu and classifies every sprint rep:

| Classification | Distance |
|---|---|
| Acceleration | ≤ 40 m |
| Max Velocity | 41–80 m |
| Speed Endurance | 81–150 m |
| Special Endurance | > 150 m |

Flying velocity is the best 3-second sliding-window average within each burst.

### NFI-Adaptive Sprint Workouts

Four auto-selected workout pathways based on neural status:

| Condition | Workout | Sprint Volume |
|---|---|---|
| Green (NFI > 97%) | Max Velocity — block starts, flying 30s, full 60 m | ~300 m |
| Amber (94–97%) | Technical Sprint — wickets, short accels, drill complex | ~150 m |
| Red + fatigued TSB | Recovery — walking, mobility, foam roll | 0 m |
| Red/Amber + fresh TSB | Neural Re-Activation — standing accels, flying 20s, wickets | ~150 m |

Workouts include warmup, main set with coaching cues, and cooldown. Each can be **pushed directly to your Intervals.icu calendar**.

### TSB-Driven Strength Periodization

TSB is **fitness minus fatigue across all training**, not strength-specific
load — sprints, easy runs, rides and walks all move it, so the zone can read
"Tired" in a week containing no lifting at all. It is read from the day's
wellness record rather than from the last activity, so it keeps improving
through a rest block instead of freezing on the last training day.

The dashboard shows the full band scale with the athlete's position marked, so
the verdict comes with its boundaries rather than on its own. Bands, labels and
ranges all come from `STRENGTH_ZONE_BANDS` in `domain/sprint/core.ts` — the same
definition the prescription uses, so the UI and the docs cannot drift from the
thresholds again.

| TSB Zone | Prescription | Example Exercises |
|---|---|---|
| ≥ 0 (Fresh) | Max Strength — 3×3 @ 85% | Trap Bar Deadlift, Weighted Step-Up, Hang Power Clean |
| 0 to −20 (Tired) | Stiffened Plyometrics — bodyweight | Pogo Jumps, Hurdle Hops, Single-Leg Bounds |
| < −20 (Fatigued) | Active Mobility only | Foam Rolling, Hip Flexor Stretch, Walking |

Loads are auto-estimated from your body weight (pulled from your Intervals.icu profile).

### Race Time Estimator

Predicts 100 m, 200 m, and 400 m race times with a multi-layer model:

1. **Base sustain fractions** of Vmax as average race speed (100 m → 0.91, 200 m → 0.88, 400 m → 0.78)
2. **Training profile** adjustments (SE index, flying velocity, acceleration quality)
3. **Age penalty:** $\max(1 - (age - 35) \times 0.007,\; 0.65)$ — derived from WMA masters data
4. **Readiness modifier** from NFI & TSB (±3%)
5. **Calibration** against races you have actually run (see below)
6. **Phase breakdown** visualization: reaction → acceleration → max velocity → deceleration

When NFI is amber/red, a "fully recovered" comparison estimate is shown.

### Calibration From Your Own Race Times

The velocity model cannot know your start technique or race-day mechanics — an
actual result can. Enter times you have really run and each prediction is
corrected against them.

| Step | What happens |
|---|---|
| Age equivalence | A time run at 46 is converted to the time it implies at your current age, using the same 0.7%/year curve the estimator applies. Without this, every older result would look like proof the model is pessimistic. |
| Comparison | The age-equivalent time is compared with the model's prediction **at neutral readiness** (NFI 1.0, TSB 0), so today's fatigue is never baked into a permanent correction. |
| Recency weighting | Exponential, 18-month half-life. Results older than five years are ignored entirely. |
| Confidence shrinkage | Thin or old evidence is damped toward no correction, so one three-year-old time cannot steer the model as hard as last week's race. |
| Cross-distance transfer | A distance with no result of its own inherits half the average correction, and is labelled **Inferred** rather than **Calibrated**. |
| Clamp | Corrections are bounded to ±20%. Entries outside plausible per-distance time ranges are rejected outright. |

A distance backed by your own result is marked **Calibrated** and reported at
high confidence.

**Persistence:** race times are stored per athlete in `localStorage`, so they
survive reloads and browser restarts for exactly as long as your login does.
Logging out is the only thing that clears them. They never leave the browser —
entering a result costs no Intervals.icu request.

### Multi-Race Planner

Fetches upcoming RACE_A / RACE_B / RACE_C events (<800 m) from Intervals.icu and generates phase-appropriate training plans:

| Phase | Days Out | Focus |
|---|---|---|
| Race Prep | ≤ 3 | CNS rest, activation strides |
| Final Taper | 4–7 | Volume drop, sharpening |
| Race-Specific | 8–14 | Race-pace efforts, taper begins |
| Sharpen | 15–28 | Speed specificity |
| Build | > 28 | Max velocity + full strength |

When multiple races overlap, the nearest race is the master constraint — later races defer with no conflicting high-intensity work. Key sessions can be **pushed to Intervals.icu**.

### Spring Training — Fascia Module

A collapsible 7-tab panel for Joel Smith–inspired fascia-driven periodization:

| Tab | Purpose |
|---|---|
| **Profile** | Select athlete dominance type (fascia / muscle), current training week |
| **4-Week Plan** | Full weekly grid: high/low CNS days, exercises, volume modifiers, deload week |
| **Neural Budget** | Daily 0–100% training bank with quick-add buttons, 7-day heatmap, reset warnings |
| **Morning Check-In** | Grip strength, tap test, muscle feeling, stiffness → readiness verdict |
| **OI Guide** | Three-phase Oscillatory Isometric progression with relaxation scoring |
| **RSI Log** | Depth-jump logging (height + contact time → RSI), trend chart, drop warnings |
| **Recovery** | Hydrotherapy timer, 90/90 breathing guide, extensive tempo protocols |

All state is persisted to `localStorage`. Timers include haptic feedback via `navigator.vibrate()`.

### 60-Day Trend Charts

Interactive Recharts line graphs for NFI, TSB, and Recovery Hours with reference lines and dark-themed tooltips.

### Authentication

Credentials (Athlete ID + API Key) are validated against the Intervals.icu profile endpoint, then stored in `sessionStorage`. In dev mode, env vars `INTERVALS_ATHLETE_ID` and `INTERVALS_API_KEY` are used automatically.

### Webhook (Serverless)

`POST /api/webhook` with `{ id, athleteId, apiKey }`:

1. Fetches activity + velocity stream from Intervals.icu
2. Parses sprint intervals
3. Computes NFI against 30-day baseline
4. Pushes NFI as a custom data stream back to the activity via `PUT`

---

## Architecture

```
┌───────────────────────────────────────────────────────────────┐
│                      Intervals.icu API                        │
│  Activities · Wellness · Events · Profile · Custom Streams    │
└──────────────────────────┬────────────────────────────────────┘
                           │  HTTP (Basic Auth)
         ┌─────────────────┼──────────────────────┐
         │                 │                      │
   ┌─────▼──────┐  ┌──────▼───────────┐  ┌──────▼──────────┐
   │ api/       │  │ useIntervalsData │  │ Vite Dev Proxy  │
   │ Webhook    │  │ (React adapter)  │  │ /intervals → icu│
   │ Handler    │  └──────┬───────────┘  └─────────────────┘
   └────────────┘         │  HttpGet port
               ┌──────────▼──────────────────────────────┐
               │          Application Layer               │
               │  dashboard-sync.ts                       │
               │    buildDashboardState() fetches every    │
               │    Intervals.icu resource through the     │
               │    HttpGet port and derives dashboard     │
               │    state. No React, no fetch: testable.   │
               └──────────┬──────────────────────────────┘
                          │
               ┌──────────▼──────────────────────────────┐
               │            Domain Layer                  │
               │                                          │
               │  sprint/                                 │
               │    core.ts          NFI, SRS, Recovery   │
               │    parser.ts        Velocity stream      │
               │    workouts.ts      Adaptive sprint Rx   │
               │    periodization.ts Strength Rx          │
               │    race-estimator.ts Race predictions    │
               │    race-plan.ts     Multi-race planner   │
               │    custom-streams.ts NFI stream payload  │
               │                                          │
               │  recovery/                               │
               │    fascia-periodization.ts  4-wk meso    │
               │    neural-budget.ts    Training bank     │
               │    oscillatory-isometric.ts  OI protocol │
               │    readiness.ts        Morning check-in  │
               │    recovery-modalities.ts  Big Three     │
               └──────────┬──────────────────────────────┘
                          │
               ┌──────────▼──────────────────────────────┐
               │         Presentation Layer               │
               │  App.tsx          Auth + push handlers   │
               │  AuthGate.tsx     Login UI               │
               │  Dashboard.tsx    Main dashboard         │
               │  SpringTrainingPanel.tsx  Fascia module  │
               │  TimeSeriesChart.tsx  Recharts wrapper   │
               └─────────────────────────────────────────┘
```

---

## Directory Structure

```
├── api/
│   ├── index.ts              # Vercel serverless webhook handler
│   └── logger.ts             # Server-side file + stdout logger
├── src/
│   ├── App.tsx               # Root component, auth state, push handlers
│   ├── index.tsx              # React entry point
│   ├── index.css              # Tailwind imports
│   ├── logger.ts              # Client-side logger (dev relay to server)
│   ├── schema.ts              # Zod schemas (Intervals.icu API types)
│   ├── components/
│   │   ├── AuthGate.tsx       # Login screen with API validation
│   │   ├── Dashboard.tsx      # Main dashboard UI
│   │   ├── RaceResultsPanel.tsx    # Enter known race times
│   │   ├── SpringTrainingPanel.tsx  # 7-tab fascia training module
│   │   └── TimeSeriesChart.tsx     # Reusable 60-day trend chart
│   ├── domain/
│   │   ├── schema.ts          # Shared Zod schemas
│   │   ├── types.ts           # Shared domain types (NFIStatus, HRVData, etc.)
│   │   ├── sprint/
│   │   │   ├── core.ts        # NFI, SRS, recovery, strength logic
│   │   │   ├── parser.ts      # 1 Hz velocity stream parser
│   │   │   ├── custom-streams.ts  # NFI custom stream payloads
│   │   │   ├── periodization.ts   # TSB-driven strength periodization
│   │   │   ├── race-estimator.ts  # Multi-factor race time predictions
│   │   │   ├── race-results.ts    # Known race times + model calibration
│   │   │   ├── race-plan.ts       # Multi-race training planner
│   │   │   └── workouts.ts       # NFI-adaptive sprint workout generator
│   │   └── recovery/
│   │       ├── fascia-periodization.ts  # 4-week fascia mesocycle
│   │       ├── neural-budget.ts         # Daily neural budget tracker
│   │       ├── oscillatory-isometric.ts # 3-phase OI protocol
│   │       ├── readiness.ts             # Morning check-in assessment
│   │       └── recovery-modalities.ts   # Tempo, breathing, hydrotherapy
│   ├── application/
│   │   └── dashboard-sync.ts    # buildDashboardState use case (HttpGet port)
│   ├── data/
│   │   └── mockDashboardData.ts # Simulated athlete powering demo mode
│   └── hooks/
│       ├── useIntervalsData.ts  # React adapter over buildDashboardState
│       └── useRaceResults.ts    # Known race times + per-athlete persistence
├── tests/                       # Mirrors src/ structure with *.test.ts files
│   ├── application/             # End-to-end ingestion tests
│   └── fixtures/
│       └── intervals-api.ts     # Mock Intervals.icu API (real response shapes)
├── logs/                        # Server log output (dev)
├── index.html                   # SPA entry
├── package.json
├── tsconfig.json
├── vite.config.ts               # Vite + Tailwind + dev proxy + client log plugin
├── vitest.config.ts             # Test runner config
└── vercel.json                  # Vercel deployment rewrites
```

---

## Demo Mode

Unauthenticated visitors see a full dashboard built from a simulated athlete
(`src/data/mockDashboardData.ts`). The simulation produces a **training
calendar** — sessions, loads, rest days, a deload week, a travel gap, a build
block — and then feeds it through the same domain modules the live app uses:

- CTL and ATL are genuine 42-day and 7-day exponential moving averages of daily
  load, so TSB steps on training days and drifts up through easy weeks.
- Sprint Vmax responds to accumulated fatigue, which is what moves the NFI.
- Recovery hours, SRS, race estimates and the race plan all come from the real
  domain functions, so no figure appears that the model could not produce.
- Days without a run carry no NFI, and two nights have no HRV — the same gaps a
  real wellness history has.

Values are deterministic (a seeded PRNG, never `Math.random`), so the demo is
identical on every load and screenshots are reproducible. `tests/data/` pins the
consistency properties, including that the demo can never show a recovery window
below the athlete's own age tax.

---

## Intervals.icu API Quirks

`tests/fixtures/intervals-api.ts` is a mock Intervals.icu that reproduces the
live API's real response shapes. Each trait below was observed on a live masters
account and is covered by a test; the fixture identity and values are synthetic,
so no athlete data lives in the repo.

| Trait | Why it matters |
|---|---|
| `/activities` is **newest-first**, `/wellness` is **oldest-first** | Assuming one ordering for both makes `entries[0]` a 60-day-old HRV reading. Sort by date; never trust payload order. |
| `max_speed` is `null` on manual / no-GPS activities | A required-number schema drops those sessions from the athlete's history entirely. `null` means "no velocity data", not 0 m/s. |
| Auto-detected laps always carry `label: null` | `z.string().optional()` rejects `null`, so every lap of every unstructured session fails validation and all rep-level analysis is silently lost. |
| `/streams` returns a **bare array** of `{ type, data }` | It is not a map keyed by stream name. Reading `streams.velocity_smooth.data` yields nothing, disabling the stream-parsing fallback. |
| Velocity streams contain `null` samples | GPS dropouts. They must be stripped before `Math.max` and running sums. |
| Warm-up jogs are typed `WORK` | Lap `type` does not identify sprint efforts; distance, duration and pace filters do. |
| `RECOVERY` laps often hold the session's highest `max_speed` | The lap boundary lands inside the preceding sprint. |
| `average_speed` can exceed `max_speed` on short laps | The two are computed over different windows. Taking `max_speed` alone yields a flying velocity faster than the rep's own peak. |
| Athlete weight lives in `icu_weight`; Strava `weight` is `null` | Body-weight-derived strength loads come out empty otherwise. |
| Bursts of per-activity requests draw `429` | The events request is issued up front, not after one call per activity, so race planning is not the feature that disappears under the rate limiter. |

---

## Key Formulas

| Metric | Formula |
|---|---|
| NFI | $\frac{V_{max,today}}{V_{max,30d\;avg}}$, baseline over sessions with $V_{max} \ge 0.85 \cdot V_{max,best}$ |
| SRS | $0.45 \cdot HRV_{score} + 0.30 \cdot TSB_{score} + 0.25 \cdot NFI_{score}$ |
| Recovery Window | $48 + \max(0, (age-40) \times 6) + \text{round}((1 - SRS/100) \times 48)$ hrs |
| Age Degradation | $\max(1 - (age-35) \times 0.007,\; 0.65)$ |
| Race Time | $\frac{distance}{V_{max} \times sustainFrac \times agePenalty \times readinessMod \;/\; calibration} + 0.15\text{s}$ |
| Calibration factor | weighted mean of $\frac{t_{ageEquivalent}}{t_{model,neutral}}$, shrunk by evidence weight, clamped to $[0.85, 1.2]$ |
| Neural Budget | $50 + \sum(\text{event costs})$, clamped $[0, 100]$ |
| RSI | $\frac{jumpHeight_m}{contactTime_s}$ |

---

### Test It Out
If you want to try this online, go to https://maximumtrainer.github.io/SilverSprint/ you will need your intervals.icu id and api key


## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) v18+ or [Bun](https://bun.sh/)
- An [Intervals.icu](https://intervals.icu) account with an API key

### Install

```bash
npm install
```

### Environment Variables (optional, for dev auto-login)

Create a `.env` file in the project root:

```env
INTERVALS_ATHLETE_ID=i12345
INTERVALS_API_KEY=your-api-key
```

### Development

```bash
npm run dev
```

The Vite dev server starts with a proxy that routes `/intervals/*` to `https://intervals.icu` (CORS bypass) and `/api/*` to `localhost:3000`.

### Build

```bash
npm run build
```

### Test

```bash
npm test            # watch mode
npx vitest run      # single run (CI)
```

### Deploy

The project includes a `vercel.json` for deployment on [Vercel](https://vercel.com/):

```bash
npx vercel
```

Rewrites:
- `/api/*` → serverless function (`api/index.ts`)
- `/*` → SPA fallback (`index.html`)
