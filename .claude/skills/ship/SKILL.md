---
name: ship
description: Commit, push and verify both GitHub workflows are genuinely green. Use whenever asked to push, ship, or confirm the remote build passes. Runs CI's exact checks locally first — including the timezone sweep that catches the failure mode that has already broken main — and knows the gh command that reports success as an error.
---

# Ship to main and verify green

Push only when asked. The point of this skill is that "tests pass locally" has
already been insufficient once: a suite that was green here failed in CI because
CI runs in UTC and this machine does not.

## 1. Pre-flight

```bash
git fetch origin -q
git rev-list --left-right --count origin/main...HEAD   # expect 0<TAB>0 before committing
git status --short
```

**Secret scan** over everything about to be committed, staged and untracked
alike:

```bash
{ git diff; git diff --cached; cat <each untracked file>; } \
  | grep -nEi "i[0-9]{5,}|apikey|api_key\s*[:=]\s*['\"]|Bearer [A-Za-z0-9]{10}"
```

**No scratch files**: `ls tests/__*` must find nothing. Live-check harnesses and
CDP drivers never get committed.

## 2. Run exactly what CI runs

The workflow (`SilverSprint CI`) runs `bunx tsc --noEmit` then `bun run test`.
The Pages workflow runs `bun run build`. Locally:

```bash
npx tsc --noEmit
TZ=UTC npx vitest run     # CI's timezone — not optional
npx vite build
```

**Always sweep timezones when anything touches dates.** The demo data generator
was keyed on `Date.getDay()` and a local-midnight `toISOString()`, which passed
in BST and failed in UTC on a different weekday:

```bash
TZ=UTC npx vitest run
TZ=Pacific/Auckland npx vitest run     # UTC+13, the other edge
```

Anything date-derived should be phase-locked to "days before today" rather than
the calendar weekday, and anchored at midday UTC rather than local midnight.

## 3. Commit

Prose, not bullets. Explain the *why* — the symptom, what was actually wrong,
and what it means for the reader. Body wrapped at ~78 columns.

```
Short imperative summary under ~70 chars

What the reader would otherwise wonder: what was broken, how it presented,
and why this is the right fix rather than an obvious alternative.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
```

Use a heredoc so the message survives intact:

```bash
git add -A && git commit -q -F - <<'EOF'
...
EOF
```

## 4. Push and verify

```bash
git push origin main
gh run list --branch main --limit 3 \
  --json databaseId,name,status,conclusion,headSha \
  --jq '.[] | "\(.databaseId) \(.name) \(.status)/\(.conclusion // "-") \(.headSha[0:7])"'
```

Two workflows fire on every push — **SilverSprint CI** and **Deploy to GitHub
Pages**. Both must be green; checking only the first misses a broken build.

Wait for them with `run_in_background: true`:

```bash
gh run watch <id> --exit-status
```

> **`gh run watch` exits non-zero when the run has *already finished*,**
> whatever the outcome. A `1` here does **not** mean the build failed. This has
> already nearly caused a green build to be reported as red. The authoritative
> check is always:

```bash
gh run view <id> --json name,status,conclusion,jobs \
  --jq '"\(.name) \(.status)/\(.conclusion)", (.jobs[] | "  \(.name): \(.conclusion)")'
```

Report `conclusion`, per workflow and per job. Never infer from a watch exit
code.

## 5. If CI fails

Get the failing step, not a guess:

```bash
gh run view <id> --log-failed | head -60
```

A test that fails only in CI is almost always environmental — timezone, locale,
or a date-dependent fixture. Reproduce it locally with `TZ=UTC` before changing
any code, and fix the fragility rather than loosening the assertion.

## Notes

- Branch first if not explicitly asked to push to main.
- `main` should end in sync: `git rev-list --left-right --count origin/main...HEAD`
  returns `0 0`.
- CRLF warnings from git on this repo are normal and not a failure.
