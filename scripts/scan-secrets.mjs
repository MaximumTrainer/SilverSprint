#!/usr/bin/env node
/**
 * Secret scanner for staged content.
 *
 * Why this exists rather than a generic off-the-shelf scanner: the two things
 * most likely to leak from this repo are an Intervals.icu API key and an
 * athlete id, and the repo is *full* of athlete ids that are perfectly fine —
 * the fixtures are built around `i90210`. A generic scanner either flags those
 * forever or is tuned so loosely it misses the real one. This knows the
 * difference.
 *
 * The prompt for it was real: a live API key and athlete id were pasted into a
 * working session to validate the pace curve against a real account. Nothing
 * reached a commit, but only because it was checked by hand.
 *
 * Usage:
 *   node scripts/scan-secrets.mjs            # staged content (pre-commit)
 *   node scripts/scan-secrets.mjs --all      # every tracked file (CI)
 *
 * Exit code 1 on any finding. A deliberate, reviewed exception is marked with
 * `allowlist secret` in a comment on the same line.
 */

import { execFileSync } from 'node:child_process';
import path from 'node:path';

const ALL = process.argv.includes('--all');

/**
 * Athlete ids that are known-synthetic and appear throughout the fixtures.
 * Anything matching the athlete-id shape but *not* on this list is treated as
 * real until a human says otherwise.
 */
const ALLOWED_ATHLETE_IDS = new Set([
  'i90210',  // tests/fixtures/intervals-api.ts — the fixture athlete
  'i11111',  // per-athlete storage isolation tests
  'i12345',  // api/ webhook tests
  'i99999',  // tests/lib/auth-storage.test.ts — second athlete for isolation
]);

/** Files whose whole content is exempt (documentation about the patterns). */
const EXEMPT_PATHS = [
  'scripts/scan-secrets.mjs',
];

/** Paths that must never be committed at all, whatever they contain. */
const FORBIDDEN_PATHS = [
  /(^|\/)\.env$/,
  /(^|\/)\.env\.(?!example$)[A-Za-z0-9_.-]+$/,
  /(^|\/)tests\/__.*\.test\.ts$/,   // live-check harnesses, per the live-check skill
  /(^|\/)id_(rsa|dsa|ecdsa|ed25519)$/,
  /\.pem$/,
  /\.p12$/,
  /\.pfx$/,
];

const RULES = [
  {
    name: 'private-key',
    re: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----/,
    hint: 'a private key block',
  },
  {
    name: 'aws-access-key',
    re: /\bAKIA[0-9A-Z]{16}\b/,
    hint: 'an AWS access key id',
  },
  {
    name: 'github-token',
    re: /\bgh[pousr]_[A-Za-z0-9]{30,}\b/,
    hint: 'a GitHub token',
  },
  {
    name: 'credential-in-url',
    re: /\b[a-z][a-z0-9+.-]*:\/\/[^\s/:@]+:[^\s/@]+@/i,
    hint: 'credentials embedded in a URL',
  },
  {
    name: 'intervals-basic-auth',
    // The Intervals.icu auth shape is literally `API_KEY:<key>`.
    re: /API_KEY:(?!\$\{|"\s*\+|'\s*\+)[A-Za-z0-9]{12,}/,
    hint: 'an Intervals.icu API key in a Basic auth string',
  },
  {
    name: 'authorization-header-literal',
    re: /\b(?:Basic|Bearer)\s+[A-Za-z0-9+/_-]{20,}={0,2}/,
    hint: 'a literal Authorization header value',
  },
  {
    name: 'assigned-secret',
    // key = "value" / key: 'value' — the classic hardcoded credential.
    //
    // Matching on the *name* alone is useless here: this repo's auth tests are
    // full of `accessToken: 'oauth-bearer-token'` and `apiKey: 'test_key'`, and
    // a scanner that cries wolf on those gets switched off within a week. The
    // value has to look like an issued credential rather than something a
    // person typed as an example — see {@link looksIssued}.
    re: /\b(?:api[_-]?key|apikey|access[_-]?token|auth[_-]?token|client[_-]?secret|secret[_-]?key|password|passwd)\b\s*[:=]\s*['"`]([^'"`\n]{8,})['"`]/i,
    hint: 'a hardcoded credential assignment',
    valueTest: looksIssued,
  },
  {
    name: 'intervals-api-key',
    // 24+ chars of lowercase alphanumeric with both letters and digits, quoted.
    // That is the shape Intervals.icu issues; requiring both classes keeps it
    // off hex hashes and off ordinary long identifiers.
    re: /['"`](?=[a-z0-9]{24,40}['"`])(?=[a-z0-9]*\d)(?=[a-z0-9]*[a-z])[a-z0-9]{24,40}['"`]/,
    hint: 'a token shaped like an Intervals.icu API key',
  },
];

/** Words that only ever appear in a value someone invented for a test. */
const PLACEHOLDER_WORDS = /\b(?:test|fake|dummy|example|sample|placeholder|legacy|mock|redacted|changeme|xxx+)\b|^(?:abc|foo|bar|xyz)/i;

/**
 * Does this value look like something a provider issued, rather than something
 * a developer typed?
 *
 * Issued credentials are long, mix letters and digits, and contain no words.
 * Hand-written test values are short, all letters, or say "test" somewhere.
 * Requiring a digit is what separates `oauth-bearer-token` from a real key.
 */
function looksIssued(value) {
  if (value.length < 12) return false;
  if (PLACEHOLDER_WORDS.test(value)) return false;
  if (!/\d/.test(value)) return false;
  if (!/[A-Za-z]/.test(value)) return false;
  return true;
}

/** Athlete ids are checked separately so the allowlist can apply per match. */
const ATHLETE_ID_RE = /\bi\d{5,}\b/g;

function git(args) {
  return execFileSync('git', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
}

/** Staged files (added/copied/modified/renamed), or every tracked file. */
function filesToScan() {
  const out = ALL
    ? git(['ls-files'])
    : git(['diff', '--cached', '--name-only', '--diff-filter=ACMR']);
  return out.split('\n').map((f) => f.trim()).filter(Boolean);
}

/** The content that would actually be committed, not what is on disk. */
function contentOf(file) {
  try {
    return ALL ? git(['show', `HEAD:${file}`]) : git(['show', `:${file}`]);
  } catch {
    return null; // deleted, or unreadable as text
  }
}

const findings = [];

for (const file of filesToScan()) {
  const posix = file.split(path.sep).join('/');

  if (FORBIDDEN_PATHS.some((re) => re.test(posix))) {
    findings.push({ file: posix, line: 0, rule: 'forbidden-path', hint: 'this file must never be committed', excerpt: posix });
    continue;
  }
  if (EXEMPT_PATHS.includes(posix)) continue;

  const content = contentOf(file);
  if (content === null) continue;
  // Skip anything that looks binary.
  if (content.includes('\u0000')) continue;

  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.includes('allowlist secret')) continue;
    if (line.length > 2000) continue; // minified or data blob

    for (const rule of RULES) {
      const m = rule.re.exec(line);
      if (!m) continue;
      if (rule.valueTest && !rule.valueTest(m[1] ?? m[0])) continue;
      findings.push({ file: posix, line: i + 1, rule: rule.name, hint: rule.hint, excerpt: m[0] });
    }

    for (const m of line.matchAll(ATHLETE_ID_RE)) {
      if (ALLOWED_ATHLETE_IDS.has(m[0])) continue;
      findings.push({
        file: posix, line: i + 1, rule: 'athlete-id', excerpt: m[0],
        hint: `athlete id not on the synthetic allowlist (add it to ALLOWED_ATHLETE_IDS in ${EXEMPT_PATHS[0]} if it is fake)`,
      });
    }
  }
}

/** Show enough to identify the finding, never enough to be the secret. */
function redact(s) {
  const flat = s.replace(/\s+/g, ' ');
  if (flat.length <= 12) return flat;
  return `${flat.slice(0, 6)}…${flat.slice(-3)} (${flat.length} chars)`;
}

if (findings.length === 0) {
  console.log(`secret scan: clean (${ALL ? 'all tracked files' : 'staged content'})`);
  process.exit(0);
}

console.error(`\nSecret scan found ${findings.length} problem(s):\n`);
for (const f of findings) {
  const where = f.line ? `${f.file}:${f.line}` : f.file;
  console.error(`  ${where}`);
  console.error(`    ${f.rule} — ${f.hint}`);
  console.error(`    ${redact(f.excerpt)}\n`);
}
console.error('Nothing has been committed. Remove the value, or — if it is genuinely not a');
console.error("secret — mark the line with an 'allowlist secret' comment and commit again.\n");
process.exit(1);
