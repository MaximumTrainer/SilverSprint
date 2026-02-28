# Open Spec: SilverSprint Application Ecosystem

**Version:** 1.0.0  
**Target Population:** Masters Track & Field Athletes (35+)  
**Primary Data Source:** Intervals.icu API (REST/Webhook)  
**Language:** TypeScript (React/Node)

## 1. System Philosophy

SilverSprint is a "Neural-First" training platform. It operates on the principle that for aging sprinters, Central Nervous System (CNS) recovery is the primary bottleneck for performance. The application must automate the detection of neural fatigue and provide actionable "Go/No-Go" training recommendations.

## 2. Technical Requirements

### 2.1 Core Components

- **Authentication Hub:** Secure OAuth2/API Key binding to Intervals.icu.
- **Sprint Parser Engine:** A 1Hz velocity stream analyzer that identifies Acceleration, Max Velocity ($V_{max}$), and Speed Endurance segments.
- **Neural Fatigue Processor:** A calculation engine that compares session performance against a 30-day rolling baseline.
- **Strength Auto-Regulator:** A module that converts Training Stress Balance (TSB) into specific gym prescriptions.

### 2.2 Data Ingestion Schema (Zod)

```TypeScript
const ActivitySchema = z.object({
  id: z.string(),
  type: z.literal('Run'),
  velocity_smooth: z.array(z.number()), // m/s
  max_speed: z.number(),
  icu_training_load: z.number(),
  icu_atl: z.number(), // Fatigue
  icu_ctl: z.number(), // Fitness
});
```

## 3. Functional Specifications

### 3.1 Velocity Metric Extraction

The system must identify the following from the velocity_smooth stream:

- **Acceleration (0–30m):** Slope of velocity increase from $V < 1m/s$ to $V_{peak}$.
- **Flying 10s/30s:** Peak velocity maintained over a 10m-30m window.
- **Speed Endurance:** Velocity maintenance in intervals $> 80m$.

### 3.2 The "Age Tax" Recovery Algorithm

Calculated recovery must be adjusted for chronological age to prevent overuse injuries (Achilles/Hamstring):

- **Formula:** $Recovery_{hours} = 48 + \max(0, (Age - 40) \times 6)$
- **HRV Modifier:** If $HRV < (HRV_{7dayAvg} \times 0.9)$, add 24 hours to the recovery window.

### 3.3 Strength Training Logic

Gym sessions must be auto-regulated based on the TSB (Training Stress Balance) fetched from Intervals.icu:

- **TSB > 0 (Fresh):** High Intensity, Low Volume (Max Strength focus).
- **TSB -10 to -20 (Tired):** Moderate Intensity, focus on Stiffened Plyometrics.
- **TSB < -20 (Fatigued):** Rest or Active Mobility only.

## 4. UI/UX Requirements

- **Visual Priority:** The Neural Fatigue Index (NFI) must be the primary metric on the dashboard.
- **The "Traffic Light" System:**
  - **Green:** NFI > 97%
  - **Amber:** NFI 94-97% (Warning)
  - **Red:** NFI < 94% (Danger Zone)
- **Responsive:** Mobile-first design for use on track-side tablets.

## 5. API & Webhook Specifications

- **Endpoint:** /api/webhook
- **Payload Type:** JSON
- **Action:** On receipt of an Activity ID, the server fetches the velocity stream, parses metrics, and pushes an "NFI" custom stream back to Intervals.icu using a PUT request.

## 6. Directory Structure for Copilot Context

```Plaintext
/src
  /logic     # Math, Parsers, Algorithms
  /hooks     # Intervals.icu API Data Fetching
  /components # Dashboard & Auth UI
  /schema    # Zod Validation Models
/api         # Serverless Webhook Handlers
```

## 7. Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) v18+ (or [Bun](https://bun.sh/) for faster dev)
- npm (bundled with Node.js)

### Install

```bash
npm install
```

### Build

Compile TypeScript to JavaScript:

```bash
npm run build
```

### Run (Development)

Start the dev server with hot-reload (requires Bun):

```bash
npm run dev
```

### Test

Run the full test suite:

```bash
npm test
```

Run tests once (CI mode):

```bash
npx vitest run
```

### Deploy

The project includes a `vercel.json` for deployment on [Vercel](https://vercel.com/). Push to your connected repo or run:

```bash
npx vercel
```
