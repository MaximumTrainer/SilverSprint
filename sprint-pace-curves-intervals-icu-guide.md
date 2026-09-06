# Sprint Pace Curves on Intervals.icu

## A user guide for athletes and coaches working at 20 m – 400 m

*Companion to the forum thread [Custom distances for Pace Curve & Native support for manual sprint workouts](https://forum.intervals.icu/t/custom-distances-for-pace-curve-native-support-for-manual-sprint-workouts/130661) and the [SilverSprint](https://forum.intervals.icu/t/track-sprinting-app/123518) project. Last revised 6 September 2026.*

---

## 0. Read this first

Intervals.icu is an endurance-first platform. Its Pace page, best-efforts table and Critical Speed (CS) / D′ estimate are built for efforts of roughly two minutes and longer, and the shortest tracked distance is 400 m. Nothing native exists today for 10–300 m efforts, and as of this writing the thread above has no reply from David (the developer), so treat everything in the "workarounds" section as exactly that.

That said, you can get a sprint-specific pace curve, a CS/D′ model and a duration-based speed model out of Intervals.icu with about an hour of setup, and the numbers you get are good enough to prescribe and monitor training for 20–400 m. This guide shows you how, in four parts:

1. What Intervals.icu does natively, and where it breaks for sprinters.
2. A testing protocol that produces the inputs the models need.
3. The maths: three models, when each applies, and a fully worked example.
4. Setting it up in Intervals.icu (custom fields, scripts, manual entry, custom zones) and in SilverSprint.

The single most important idea: **a "CS/D′ curve built from 10, 30, 60 and 100 m" is not a critical-speed model.** Fit the two-parameter CS model to sprint splits and the "CS" you get is your maximal sprint speed and the "D′" is a small negative number. That is not a bug in the maths — it is the model telling you it does not apply below about two minutes. Sprinters need CS/D′ *plus* two other models, stitched together. Section 3 explains.

---

## 1. What Intervals.icu gives you natively

### 1.1 The Pace page

The top-level **Pace** page shows a best-effort pace-versus-distance curve per sport, built from your recorded activities over a selectable date range. Things worth knowing, all from the announcement threads ([Pace curves and best efforts](https://forum.intervals.icu/t/pace-curves-and-best-efforts-for-running-etc/12929), [Pace curves with submax efforts](https://forum.intervals.icu/t/pace-curves-with-submax-efforts/13209)):

- The curve is distance-based, not duration-based. David chose that deliberately: "I am trying to simplify things by just going with distance."
- The **Options** button has a slider to set the *starting* (smallest) distance shown, per sport. You can pull the start down, but the stored best-effort distances begin at 400 m (then 800 m, 1 km, 1.5 km and so on, with imperial equivalents).
- A **GAP** checkbox switches the chart and best-efforts table to gradient-adjusted pace. Leave it off for track work — there is no gradient, and GAP smoothing does nothing useful at sprint speeds.
- **Sub-maximal efforts** can be enabled to show the six best activities at each point on the curve, which is a nice way to see whether a "best" was a one-off.
- Any activity can be excluded from the curve with the **Ignore pace** checkbox in its settings. You will use this a lot (see 4.4).
- Best efforts require pace zones to be configured for the sport, though David later added best-effort viewing for activities without pace zones.

### 1.2 Critical Speed and D′ on the Pace page

Intervals.icu fits CS and D′ automatically from the pace curve. From the design thread ([Towards Grade Adjusted Best Paces and CS/D′ Computation](https://forum.intervals.icu/t/towards-grade-adjusted-best-paces-and-cs-d-computation/12197)), the fit is a straight line through distance-versus-time points, using the 1, 2, 3, 4 and 5 km best efforts subject to the rule "picking points >= 2 minutes and the last point >= 15 minutes", and only points where "increasing the distance does not reduce speed". CS is the slope, D′ the intercept.

There is no user control over which points go into the fit and no way to feed it a structured test (a forum user asking for a 12/7/3-minute protocol was told the Pace tab lacks the custom-curve tools the Power page has — [Critical speed based on 12/7/3 min run](https://forum.intervals.icu/t/critical-speed-based-on-12-7-and-3-min-run/82053)). There is also no automatic threshold-pace estimate for running the way eFTP exists for cycling ([Automatic threshold pace calculation](https://forum.intervals.icu/t/automatic-threshold-pace-calculation/112254)).

For a sprinter this means three things. The native CS is only meaningful if you actually run some 2–15 minute efforts (tempo runs count). The native D′ is a fit intercept dominated by 1–5 km data and says little about your 400 m. And you cannot get a 60 m or 100 m point on the native curve at all.

### 1.3 Why GPS-based sprint data is unreliable below ~250 m

Even where the platform did show short distances, the data would be poor. Watch GPS at 1 Hz with speed smoothing systematically mis-times 10–100 m efforts, and single-sample spikes produce nonsense (SilverSprint issue #31 documents an Intervals.icu pace-curve point claiming 100 m in 1 s from a GPS glitch). Timing gates, Freelap, a laser/radar gun, or FAT race results are the ground truth for anything under 200 m; GPS is acceptable for 300–400 m and for tempo/extensive work, and gets better with a chest-pod or foot-pod speed source.

### 1.4 The two workaround tools you will use

Intervals.icu has two extension points that make everything below possible:

**Custom activity fields with scripts** (Settings → Custom → *Add Field*). A field can hold a number you type in by hand, or it can run a small JavaScript snippet over the activity's streams when the activity is analysed. R2Tom's best-distance script in [Best distance efforts](https://forum.intervals.icu/t/best-distance-efforts/116817) is the pattern: slide a window over the distance/time stream, find the fastest pass over a target distance, store it. Fields can then be plotted on the Fitness page over time and shown in activity lists.

**Custom zones and athlete fields** (premium). Coaches can define named zones — e.g. a "Multi-Distance Anchored Pacing Model" already exists in the public zone library — and reference them in workouts (`cz` syntax), with each athlete holding their own values ([Custom pace variables per athlete](https://forum.intervals.icu/t/custom-pace-variables-per-athlete/130369)). Note two gotchas raised in that thread: custom zones only load on page refresh, and they cannot be applied to non-premium athletes.

---

## 2. Testing: get the inputs the models need

You need three kinds of data. Collect them across two or three sessions in the same fortnight, in that order, at the start of each block (every 6–8 weeks) and before the competition phase.

### 2.1 Acceleration and max-speed test (gates or Freelap)

Standing or 3-point start, gates at **0, 10, 20, 30, 40, 50, 60 m** (or at minimum 10, 30, 60). First gate triggers on movement, so no reaction time is included. Two or three trials with full recovery (6–10 min), keep the best. Record every split to 0.01 s.

If you have only one gate pair, run a **flying 10 m** (or 20 m) after a 30 m build-up; that gives you maximal sprint speed (MSS) directly, and you fill in the acceleration shape with a 30 m standing time.

### 2.2 Speed-endurance efforts

Best of the season or a time-trial for **100, 200 and 300 or 400 m**. Race results (FAT) are ideal. For training-only athletes a 150 m and a 300 m time-trial, with 20+ min between them, will do. These calibrate the duration-based model in 3.3.

### 2.3 Aerobic anchors (for CS/D′)

At least three efforts between **2 and 15 minutes**, e.g. 600 m (~2 min), 1000–1200 m (~4 min) and a 2000 m or 8–10 minute time-trial. These can be spread over a couple of weeks and can be run at the end of a tempo session. A 12-minute Cooper-style run is a good longest point. Sprinters rarely enjoy this; a 400 m athlete needs it, a 60/100 m athlete can substitute 500 m / 1000 m / 6-minute and accept a rougher CS.

Record everything you cannot measure with a watch as a **manual activity** in Intervals.icu (Calendar → Add → Activity) with the test values typed into custom fields (see 4.3). That keeps every test, instrumented or not, in the same timeline.

---

## 3. The models

You need three because the physiology changes twice across 20–400 m: an acceleration phase limited by force production (0–6 s), a maximal-speed and speed-endurance phase limited by anaerobic power (6–60 s), and an aerobic-dominant zone the CS model describes (2 min+). Each model has two parameters, and every parameter is something you can train and monitor.

### 3.1 Model A — acceleration and maximal speed (0–60 m)

Sprint speed from a standing start follows

    v(t) = Vmax · (1 − e^(−t/τ))
    d(t) = Vmax · ( t − τ · (1 − e^(−t/τ)) )

**Vmax** is maximal sprint speed (MSS) in m/s; **τ** (tau) is the time constant of acceleration in seconds (smaller = punchier start; typical 0.9–1.4 s). Initial acceleration is Vmax/τ. Fit both to your 10–60 m splits by least squares (any spreadsheet solver, Python `curve_fit`, or the calculator in SilverSprint). With a flying 10 m only, set Vmax = 10 / flying time and solve τ from the 30 m standing time.

Use it for: any distance ≤ 60 m, predicting splits for block work, and tracking whether a training block moved Vmax (max-velocity work) or τ (acceleration/strength work).

### 3.2 Model B — Critical Speed and D′ (2–15 min, and the aerobic floor)

The classic two-parameter model:

    d = CS · t + D′          (fit a straight line: distance vs time)
    t(d) = (d − D′) / CS     (predicted time)
    v(t) = CS + D′ / t       (sustainable speed for a duration)

**CS** is the asymptote — the fastest speed that is metabolically steady-state. **D′** is a finite distance you can cover above CS before exhaustion (typically 150–300 m for runners). The model is well behaved for efforts of roughly 2–20 minutes and "systematically fails for very short efforts (under 2 minutes)" ([Running Writings CS guide](https://runningwritings.com/2024/01/critical-speed-guide-for-runners.html)). It is nonetheless essential for sprinters: it sets the aerobic floor that the duration model needs, it tells you how much of a 400 m is being paid for out of D′, and it is what Intervals.icu already computes if you give it the points.

Fit it only to the aerobic anchors from 2.3 (600 m and longer). Including the 400 m usually pulls CS up and D′ down a little; compare both fits and use the one with the better residuals.

### 3.3 Model C — the all-out speed–duration model (3 s – 4 min)

This is the sprint-domain equivalent of CS/D′, from Bundle, Hoyt and Weyand (2003) and Weyand and Bundle (2005): for all-out running of duration t,

    Spd(t) = MAS + (MSS − MAS) · e^(−k·t)

**MSS** is maximal sprint speed (Vmax from Model A). **MAS** is maximal aerobic speed — the speed at VO2max, in practice the average speed of a 5–6 minute all-out run; if you do not have one, your 1500 m speed or CS × 1.10–1.15 are serviceable proxies. **MSS − MAS** is the **anaerobic speed reserve (ASR)**. The exponent k is the rate at which speed decays with duration; the published value for running is about 0.013 s⁻¹ and the model predicted speeds within ~2.5–3.4 % in the original studies ([summary at Freelap USA](https://www.freelapusa.com/anaerobic-speed-reserve/); original paper: [Bundle, Hoyt & Weyand 2003](https://journals.physiology.org/doi/full/10.1152/japplphysiol.00921.2002)). If you have three or more race-distance times, fit k to the athlete instead of assuming 0.013 — sprinters with poor speed endurance sit around 0.016–0.020, 400 m specialists nearer 0.010.

Spd(t) is the *average* speed the athlete can hold for a run of duration t once up to speed. To turn it into a race prediction from a standing start, solve `D / T = Spd(T)` for T iteratively (start with T = D / MSS, repeat T = D / Spd(T)), then **add τ** from Model A to account for the acceleration phase. That single correction takes the 100 m prediction from ~6 % optimistic to within 2 %.

### 3.4 Stitching: the sprint pace curve

The "sprint pace curve" you actually want plots predicted average speed (or time) against distance and uses:

| Distance | Model | Parameters you monitor |
|---|---|---|
| 10–60 m | A | Vmax, τ |
| 80–400 m | C, plus τ from A | MSS, MAS, ASR, k |
| 600 m – 5 km | B | CS, D′ (also what Intervals.icu shows natively) |

Plot measured best efforts as points on the same axes; the gap between a point and the curve tells you where the athlete's profile is strong or weak (e.g. a 200 m well below the curve with a good 100 m says speed endurance, not speed, is the limiter).

### 3.5 Worked example

Masters sprinter, one gate session, two time-trials and three tempo-day anchors:

| Test | Result |
|---|---|
| Standing splits | 10 m 1.95 s · 20 m 3.20 · 30 m 4.35 · 40 m 5.45 · 50 m 6.55 · 60 m 7.65 |
| Races / TTs | 100 m 12.60 · 200 m 26.00 · 300 m 42.5 · 400 m 60.5 |
| Aerobic anchors | 600 m 1:40 · 1000 m 3:10 · 1500 m 5:05 · 2000 m 7:05 |

**Model A** (least-squares on the six splits): Vmax = 9.05 m/s, τ = 1.03 s, initial acceleration 8.8 m/s². Check: the 30–40 m and 50–60 m segments both run at 9.09 m/s, so the athlete reaches top speed by 30 m and holds it — a max-velocity profile, not an acceleration profile.

**Model B** (600–2000 m): CS = 4.31 m/s (3:52 min/km), D′ = 176 m. Adding the 400 m gives CS = 4.37, D′ = 155 m — close enough; keep the 600 m+ fit. Applied to sprint distances the model returns *negative* times for 60 m and 100 m because D′ is bigger than the distance, and 5.5 s for 200 m. That is the failure mode from 3.2 in numbers.

**Naive "CS/D′ from 10/30/60/100 m"** (what the feature request literally asks for): "CS" = 8.49 m/s, "D′" = −6.4 m. That is Vmax and −Vmax·τ in disguise — a fine description of the sprint, but not a critical speed and not something you should feed into pace zones.

**Model C**: MAS from the 1500 m = 4.92 m/s; MSS = 9.05; ASR = 4.13 m/s (a large reserve, typical of a sprinter). With k = 0.013 and the τ correction:

| Distance | Predicted | Actual | Error |
|---|---|---|---|
| 100 m | 12.8 s | 12.60 | +1.6 % |
| 200 m | 26.4 s | 26.00 | +1.5 % |
| 300 m | 41.8 s | 42.5 | −1.6 % |
| 400 m | 59.4 s | 60.5 | −1.8 % |

Fitting k to the four races instead gives k = 0.016, i.e. speed falls off slightly faster than the population value — a speed-endurance flag. Predictions for distances not tested: 20 m 3.2 s (Model A), 120 m 15.4 s, 150 m 19.4 s (Model C + τ).

What to do with it: the 100 m and 200 m are already at the curve, the 300/400 m are slightly under it, and k is high. The profile says the next block should bias toward special endurance (150–300 m reps) and toward raising MAS/CS through extensive tempo, rather than more max-velocity work. Re-test in eight weeks and see which parameter moved.

---

## 4. Setting it up in Intervals.icu

### 4.1 Custom fields for sprint best-efforts (recorded sessions)

Create one custom activity field per distance you care about. Settings → **Custom** → **Add Field** (make sure you are in the *Custom* section, not *Fields* — that was the cause of the "it does nothing" problem in the Best distance efforts thread). Suggested set: `Best10m`, `Best20m`, `Best30m`, `Best60m`, `Best100m`, `Best150m`, `Best200m`, `Best300m`, `Best400m`, stored as seconds, type number, and a companion `SprintVmax` (m/s).

Use a script along these lines (adapt the distance constant; this is the same sliding-window idea as R2Tom's script, with sprint-specific sanity filters):

```js
// Best time over TARGET metres, from the activity's distance & time streams.
// Rejects GPS spikes: any window implying > 12.5 m/s is ignored.
const TARGET = 60;                     // metres — one field per distance
const MAX_SPEED = 12.5;                // m/s, faster than the 100 m WR average
const dist = icu.streams.get("distance").data;   // cumulative metres
const time = icu.streams.get("time").data;       // seconds
let best = null;
let j = 0;
for (let i = 0; i < dist.length; i++) {
  while (j < dist.length && dist[j] - dist[i] < TARGET) j++;
  if (j >= dist.length) break;
  // interpolate the exact crossing of TARGET between j-1 and j
  const over = dist[j] - dist[i] - TARGET;
  const seg = dist[j] - dist[j - 1];
  const tCross = time[j] - (seg > 0 ? over / seg * (time[j] - time[j - 1]) : 0);
  const t = tCross - time[i];
  if (t > 0 && TARGET / t <= MAX_SPEED && (best === null || t < best)) best = t;
}
best;   // last expression is stored in the field (null = no valid effort)
```

Check the stream names against the script editor's autocomplete — the exact accessors vary a little between field types, and the editor shows what is available. Then run **Actions → Analyze** on one sprint session to check the numbers against your gate times, and bulk re-analyse the season once they agree. Expect GPS values at 10–30 m to be noticeably off; those fields are for trend, and the gate values in 4.3 are the truth.

Once the fields exist you can plot them on the **Fitness** page (add a chart, pick the custom field) to get a season-long best-effort trend per distance — which is, in effect, a sprint pace curve over time.

### 4.2 The pace curve itself (in Intervals.icu)

There is no way to add a 60 m point to the native Pace page chart. Your options, best to worst: SilverSprint's pace-curve panel (section 5); a Fitness-page chart of the custom fields; or a custom activity-list tab (Activities → add a tab, filter to Run + Track, sort by `Best100m`) as MedTechCD suggested in the best-efforts thread.

### 4.3 Manual sessions and test days

When a session was timed by gates, Freelap or hand and there is no watch file:

1. Calendar → **Add → Activity**, sport Run, type the duration and total distance, name it (e.g. `Gates 10-60 m`).
2. Fill in the custom fields by hand: the split fields above, plus the model parameters (create `SprintVmax`, `SprintTau`, `CS`, `Dprime`, `MAS`, `ASR`, `k_sprint` as number fields).
3. Tick **Ignore pace** so a synthetic average pace does not pollute the Pace page.
4. In the description, paste the raw splits so they are searchable later.

Because the per-distance fields are the same ones the script writes for recorded sessions, manual and GPS-timed sessions land in the same trend charts. You lose stream-level analysis for manual sessions (no D′-balance or intensity distribution), which is exactly the gap the forum thread asks David to close.

If you generate FIT files from gate/Freelap data (the approach K3IRON_Lab and Dan are both working toward), upload them like any watch file; the scripts in 4.1 then run automatically, and the values will be accurate because the "distance" stream is gate-defined, not GPS-defined.

### 4.4 Data hygiene for the native curve and CS

- Tick **Ignore pace** on: warm-ups recorded as separate activities, sled/hill sessions, anything with a GPS dropout, and treadmill runs unless a foot-pod is calibrated.
- Keep the aerobic anchors from 2.3 as their own activities (or as named intervals with clean laps) so the native CS fit has ≥2-minute points to use.
- Leave GAP off for track sessions.
- Once a season, sanity-check the native CS/D′ on the Pace page against your Model B fit; if the platform value is wildly different, a bad activity is in the fit — find it with sub-maximal efforts enabled and ignore it.

### 4.5 Turning the model into zones and workouts

Create custom pace zones (premium) or, for free athletes, ordinary pace zones anchored on the model:

| Zone / anchor | How to set it | Use |
|---|---|---|
| Threshold pace | = CS | Settings → pace zones; this is what Intervals.icu's pace load uses |
| Extensive tempo | 65–75 % of MSS | 100–300 m reps, short rest |
| Intensive tempo | 75–85 % of MSS | 150–300 m, longer rest |
| Special endurance | ≥ 90 % of Spd(t) for the rep duration (Model C) | 150–400 m race-modelling |
| Max velocity | ≥ 95 % of MSS (flying 10–30 m from Model A) | Fly-ins, wickets |
| Acceleration | Model A split targets | 10–30 m from blocks |

With custom zones you can write a shared workout as `4x 150m cz-SpecEnd 8'` and each athlete's values resolve individually; remember to refresh the page after editing zone values. The workout builder also accepts explicit pace/speed for running ([Support for running pace or speed in workout builder syntax](https://forum.intervals.icu/t/support-for-running-pace-or-speed-in-workout-builder-syntax-done/91362)).

---

## 5. SilverSprint: where this lands in the app

SilverSprint (open source, [MaximumTrainer/SilverSprint](https://github.com/MaximumTrainer/SilverSprint)) reads your Intervals.icu data with your athlete id and API key and adds the sprint-specific layer the platform lacks. Issue #31 specifies the pace-curve panel: user-selectable distances from 10 to 400 m (default 30/60/100/200/400), best times computed from 1 Hz `velocity_smooth` streams by sliding window, outlier rules (reject > 12.5 m/s, streams with > 10 % nulls, efforts > 115 % of the 60-day best Vmax), a log-x distance axis, and a 30/60/90-day or season-to-date window. Critical-speed and D′ modelling is explicitly out of scope for that issue.

The natural follow-on, and the reason this guide separates the three models, is a **profile panel** that consumes the same points plus manually entered gate/race results:

- Read `Best10m … Best400m` and the manual parameter fields from Intervals.icu custom fields via the API, so the app never becomes a second source of truth.
- Fit Model A to ≤ 60 m points, Model B to ≥ 600 m points (or take Intervals.icu's native CS/D′), and Model C to the race-distance points, with k fitted when there are three or more.
- Draw the stitched curve of 3.4 over the measured points, and show the six parameters (Vmax, τ, MSS, MAS/ASR, k, CS/D′) with their change since the last test block.
- Write the fitted parameters back to the athlete's custom fields so zones and workouts in Intervals.icu stay in sync.

Manual sessions remain the open problem: until Intervals.icu analyses activities without streams, the app can only chart what the custom fields contain. Generating gate-defined FIT files (Freelap/Queling) is the cleanest bridge, because it makes a manual session indistinguishable from a recorded one for every downstream tool.

---

## 6. Quick reference

**Formulas**

- Acceleration: `d(t) = Vmax·(t − τ·(1 − e^(−t/τ)))`; initial acceleration `a0 = Vmax/τ`
- Critical speed: `d = CS·t + D′`; `t(d) = (d − D′)/CS`; `v(t) = CS + D′/t`
- All-out duration model: `Spd(t) = MAS + (MSS − MAS)·e^(−k·t)`, k ≈ 0.013 s⁻¹ (fit per athlete if ≥ 3 races); race time: solve `D/T = Spd(T)`, then add τ

**Minimum viable test battery**: 10/30/60 m gates (or flying 10 m + 30 m standing), a 150 m and a 300 m time-trial, and three 2–12 minute efforts.

**Sanity ranges** (adult trained sprinters; masters scale down ~1 % per year past 35): Vmax 8–11.5 m/s, τ 0.9–1.4 s, ASR 3–5 m/s, k 0.010–0.020, CS 3.8–5.5 m/s, D′ 120–300 m.

**Things Intervals.icu cannot do today**: custom distances under 400 m on the Pace page; user-selected points for the CS fit; analysis of manual activities without streams. These are the three asks in the forum thread; add a like to it if you want them.

---

## Sources

- [Custom distances for Pace Curve & Native support for manual sprint workouts — Intervals.icu Forum](https://forum.intervals.icu/t/custom-distances-for-pace-curve-native-support-for-manual-sprint-workouts/130661)
- [Pace curves and best efforts for running etc — Intervals.icu Forum](https://forum.intervals.icu/t/pace-curves-and-best-efforts-for-running-etc/12929)
- [Pace curves with submax efforts — Intervals.icu Forum](https://forum.intervals.icu/t/pace-curves-with-submax-efforts/13209)
- [Towards Grade Adjusted Best Paces and CS/D′ Computation — Intervals.icu Forum](https://forum.intervals.icu/t/towards-grade-adjusted-best-paces-and-cs-d-computation/12197)
- [Critical speed based on 12 / 7 and 3 min run — Intervals.icu Forum](https://forum.intervals.icu/t/critical-speed-based-on-12-7-and-3-min-run/82053)
- [Automatic Threshold Pace calculation — Intervals.icu Forum](https://forum.intervals.icu/t/automatic-threshold-pace-calculation/112254)
- [Best distance efforts (custom field script) — Intervals.icu Forum](https://forum.intervals.icu/t/best-distance-efforts/116817)
- [Custom pace variables per athlete — Intervals.icu Forum](https://forum.intervals.icu/t/custom-pace-variables-per-athlete/130369)
- [Support for running pace or speed in workout builder syntax — Intervals.icu Forum](https://forum.intervals.icu/t/support-for-running-pace-or-speed-in-workout-builder-syntax-done/91362)
- [Track sprinting app (SilverSprint) — Intervals.icu Forum](https://forum.intervals.icu/t/track-sprinting-app/123518)
- [SilverSprint issue #31: Sprint pace curve with configurable distances — GitHub](https://github.com/MaximumTrainer/SilverSprint/issues/31)
- [The science of critical speed for runners — Running Writings](https://runningwritings.com/2024/01/critical-speed-guide-for-runners.html)
- [Bundle, Hoyt & Weyand (2003), High-speed running performance: a new approach to assessment and prediction — J Appl Physiol](https://journals.physiology.org/doi/full/10.1152/japplphysiol.00921.2002)
- [Anaerobic Speed Reserve — Freelap USA](https://www.freelapusa.com/anaerobic-speed-reserve/)
