---
name: spec-issue
description: Turn a placeholder GitHub issue into an implementable spec with requirements and acceptance criteria. Use when asked to elaborate, flesh out or add acceptance criteria to an issue. Requires probing the real API and codebase first — the grounding is what makes the spec worth having.
---

# Specify an issue

A template full of headings is not a spec. What makes one useful is discovering,
before writing a single requirement, that the obvious implementation cannot
work. Do the investigation first.

## 1. Read it, then distrust the framing

```bash
gh issue view <n> --json number,title,state,labels,body,comments
```

A one-line issue usually carries an assumption. Issue #31 asked for "custom
distances for the Pace Curve" — two assumptions turned out to be false: there
was no pace curve in the app at all, and the upstream endpoint that would supply
one is unusable at the distances the issue cares about. Neither is visible from
the issue text.

## 2. Ground it

**Does the thing it builds on exist?**

```bash
grep -rni "pace.curve\|paceCurve\|mean.maximal" src/ tests/ README.md | grep -v node_modules
```

An empty result changes the scope of the issue and must be stated outright.

**Can the API actually do it?** Probe the real endpoint — see the `live-check`
skill. For #31 this was decisive:

| Distance | Reported best | Implied speed | |
|---|---|---|---|
| 100.0 m | 1 s | 100 m/s | impossible |
| 200.0 m | 5 s | 40 m/s | impossible |
| 250.0 m | 25 s | 10 m/s | plausible |

That single table turned "pass custom distances upstream" into "compute locally
with outlier rejection", which is a different piece of work.

**What conventions must it follow?** Layering from `agents.md`, the storage
pattern in `lib/race-results-storage.ts`, the fixture idiom, Zod-on-read for
anything from `localStorage`.

## 3. Write it

Preserve the original text as a blockquote at the top — never overwrite what the
author wrote.

Sections that earn their place:

- **Context** — including anything the issue presupposes that does not exist
- **Investigation findings** — the evidence, with real numbers. This is the part
  that could not have been written without doing the work.
- **Scope** — in and out, explicitly
- **Functional requirements** — numbered `FR-n`, each independently testable.
  "Reject candidates implying speed above 12.5 m/s" is testable; "handle bad GPS
  data gracefully" is not.
- **Architecture** — a table of layer → file → responsibility, honouring the
  hexagonal boundaries
- **Acceptance criteria** — numbered `AC-n` in Given/When/Then. At least one
  must be a regression test for a defect you actually observed.
- **Test plan** — which suite, which fixtures. TDD is mandatory here.
- **Edge cases** — drawn from real account data, not imagined
- **Out of scope** — name the adjacent work so it does not creep in
- **Definition of done** — checklist including CI, README, and live verification
- **Open questions** — decisions that are the maintainer's, with your
  recommendation. Do not silently resolve a design question inside a spec.

## 4. Post it

```bash
gh issue edit <n> --body-file <path> --title "<clearer title>" --add-label enhancement
```

Write the body to the scratchpad, not the repo. Scan it for credentials before
posting — issues are public. Retitle when the original says "placeholder", and
say that you did.

## Quality bar

The spec should let someone implement without re-deriving the investigation.
Concretely:

- Every requirement is falsifiable, with numbers where numbers apply
- At least one acceptance criterion encodes a real observed failure
- Anything that cannot work is stated as a finding, not buried as a caveat
- Design decisions that are the maintainer's are listed as open questions with a
  recommendation, not decided unilaterally
