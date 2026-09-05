---
name: constant-drift
description: Find and fix thresholds that are duplicated between domain logic, UI copy and documentation, and have drifted apart. Use when a displayed value contradicts what the app does, when adding a threshold, or when a user asks "why does it say X when Y". Two user-visible bugs in this repo came from exactly this.
---

# Constant drift

A threshold written down twice is a threshold that will eventually disagree with
itself. Both instances found in this repo were user-visible and both looked like
calculation bugs when they were really documentation bugs:

- The strength-zone tooltip and the README both advertised the Tired band as
  **−10 to −20**. The code used **0 to −20**. An athlete at TSB −1.05 saw
  "Tired" beside a tooltip saying they should be Fresh, and reported it as
  broken scoring.
- `AGE_DEGRADATION_PER_YEAR` lived in the race estimator while `race-plan.ts`
  imported it — fine — but the same 0.7%/year curve was also restated in prose
  in three places.

## The pattern to apply

**One definition in the domain; everything else derived from it.**

```ts
// src/domain/sprint/core.ts
export const STRENGTH_ZONE_BANDS: readonly StrengthZoneBand[] = [
  { zone: 'fresh', min: 0, max: Infinity, label: 'Fresh',
    range: '0 or above', focus: '…', guidance: '…' },
  …
];

export function getStrengthZoneBand(tsb: number): StrengthZoneBand { … }
```

Then:

- the prescription reads the bands rather than re-testing the numbers
- the UI scale renders `label` and `range` from the same array
- tooltip copy is **generated**, not typed:

```ts
const STRENGTH_ZONE_TOOLTIP = [
  '…preamble…',
  ...STRENGTH_ZONE_BANDS.map(b => `${b.label} (TSB ${b.range}): ${b.focus}.`),
].join(' ');
```

- the README describes the *shape* and points at the constant, rather than
  restating the numbers

Include human-readable text (`label`, `range`, `guidance`) **in the domain
object**. That is what stops UI copy being retyped, which is where drift starts.

## Tests that make drift impossible

```ts
it('covers the whole number line with no gaps or overlaps', () => {
  const sorted = [...BANDS].sort((a, b) => a.min - b.min);
  expect(sorted[0].min).toBe(-Infinity);
  expect(sorted.at(-1)!.max).toBe(Infinity);
  for (let i = 1; i < sorted.length; i++) expect(sorted[i].min).toBe(sorted[i - 1].max);
});

it('agrees with the prescription at every boundary and either side', () => {
  for (const tsb of [-100, -20.01, -20, -19.99, -1, -0.01, 0, 0.01, 50]) {
    expect(getBand(tsb).zone).toBe(getPrescription(tsb).zone);
  }
});

it('describes each range consistently with its own bounds', () => {
  expect(tired.range).toContain(String(Math.abs(tired.min)));
});
```

Probe **either side of each boundary**, not just inside the bands. `−20` versus
`−20.01` is where inclusive/exclusive errors live.

## Auditing for existing drift

Look for a number appearing in more than one kind of file:

```bash
grep -rn "\-20\b" src/ README.md --include=*.ts --include=*.tsx --include=*.md | grep -v node_modules
grep -rniE "TSB (−|-)?[0-9]+ to" src/ README.md
grep -rnE "0\.007|0\.85|5\.556|12\.5" src/ README.md
```

Known thresholds worth checking after any model change:

| Constant | Home |
|---|---|
| Strength bands (0, −20) | `STRENGTH_ZONE_BANDS` in `domain/sprint/core.ts` |
| Sprint-session fraction (0.85) | `SPRINT_SESSION_VMAX_FRACTION`, same file |
| Age degradation (0.007) | `AGE_DEGRADATION_PER_YEAR` in `domain/sprint/race-results.ts` |
| Recovery window (48h, 6h/yr) | `RECOVERY_*` in `domain/sprint/core.ts` |
| Sprint pace floor (5.556 m/s), 25 s, 10–400 m | `SprintParser` in `domain/sprint/parser.ts` |
| Calibration half-life, clamp, transfer | `domain/sprint/race-results.ts` |

## When the code and the docs disagree

Do not assume the docs are wrong. Establish which is intended, and say so
explicitly — the gap between them is often a real design question rather than a
typo. The 0-to-−10 span, for instance, is undocumented and the code lumps it
into Tired, so TSB −1 gets the same prescription as TSB −19. That is worth
asking about, not silently "fixing" in either direction.

Correct the documentation to match the code first, so the user-visible
contradiction stops immediately, then raise the design question separately.
