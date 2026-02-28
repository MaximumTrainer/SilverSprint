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

| TSB Zone | Prescription | Example Exercises |
|---|---|---|
| ≥ 0 (Fresh) | Max Strength — 3×3 @ 85% | Trap Bar Deadlift, Weighted Step-Up, Hang Power Clean |
| −10 to −20 (Tired) | Stiffened Plyometrics — bodyweight | Pogo Jumps, Hurdle Hops, Single-Leg Bounds |
| < −20 (Fatigued) | Active Mobility only | Foam Rolling, Hip Flexor Stretch, Walking |

Loads are auto-estimated from your body weight (pulled from your Intervals.icu profile).

### Race Time Estimator

Predicts 100 m, 200 m, and 400 m race times with a multi-layer model:

1. **Base sustain fractions** of Vmax as average race speed (100 m → 0.91, 200 m → 0.88, 400 m → 0.78)
2. **Training profile** adjustments (SE index, flying velocity, acceleration quality)
3. **Age penalty:** $\max(1 - (age - 35) \times 0.007,\; 0.65)$ — derived from WMA masters data
4. **Readiness modifier** from NFI & TSB (±3%)
5. **Phase breakdown** visualization: reaction → acceleration → max velocity → deceleration

When NFI is amber/red, a "fully recovered" comparison estimate is shown.

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
   │ Webhook    │  │ (React hook)     │  │ /intervals → icu│
   │ Handler    │  └──────┬───────────┘  └─────────────────┘
   └────────────┘         │
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
│   │   │   ├── race-plan.ts       # Multi-race training planner
│   │   │   └── workouts.ts       # NFI-adaptive sprint workout generator
│   │   └── recovery/
│   │       ├── fascia-periodization.ts  # 4-week fascia mesocycle
│   │       ├── neural-budget.ts         # Daily neural budget tracker
│   │       ├── oscillatory-isometric.ts # 3-phase OI protocol
│   │       ├── readiness.ts             # Morning check-in assessment
│   │       └── recovery-modalities.ts   # Tempo, breathing, hydrotherapy
│   └── hooks/
│       └── useIntervalsData.ts  # Central data-fetching hook
├── tests/                       # Mirrors src/ structure with *.test.ts files
├── logs/                        # Server log output (dev)
├── index.html                   # SPA entry
├── package.json
├── tsconfig.json
├── vite.config.ts               # Vite + Tailwind + dev proxy + client log plugin
├── vitest.config.ts             # Test runner config
└── vercel.json                  # Vercel deployment rewrites
```

---

## Key Formulas

| Metric | Formula |
|---|---|
| NFI | $\frac{V_{max,today}}{V_{max,30d\;avg}}$ |
| SRS | $0.45 \cdot HRV_{score} + 0.30 \cdot TSB_{score} + 0.25 \cdot NFI_{score}$ |
| Recovery Window | $48 + \max(0, (age-40) \times 6) + \text{round}((1 - SRS/100) \times 48)$ hrs |
| Age Degradation | $\max(1 - (age-35) \times 0.007,\; 0.65)$ |
| Race Time | $\frac{distance}{V_{max} \times sustainFrac \times agePenalty \times readinessMod} + 0.15\text{s}$ |
| Neural Budget | $50 + \sum(\text{event costs})$, clamped $[0, 100]$ |
| RSI | $\frac{jumpHeight_m}{contactTime_s}$ |

---

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
