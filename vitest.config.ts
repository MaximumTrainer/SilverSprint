import { defineConfig } from 'vitest/config';

/**
 * V8 coverage instrumentation roughly doubles execution time, which breaks any
 * test asserting a wall-clock budget — the pace curve's 500 ms ceiling for a
 * 90-day recomputation is about what an athlete's laptop does, not about what
 * an instrumented run does. The flag is surfaced to the tests so those
 * assertions can stand down rather than be loosened for everyone.
 */
const coverageEnabled = process.argv.includes('--coverage') || process.env.COVERAGE === '1';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    env: { COVERAGE: coverageEnabled ? '1' : '' },
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{ts,tsx}'],
      exclude: [
        // Presentation is not exercised by the node-environment suite; there is
        // no DOM test runner in this repo, so counting it would report a
        // coverage figure that means nothing.
        'src/components/**',
        'src/hooks/**',
        'src/index.tsx',
        'src/App.tsx',
        // Demo fixtures for the marketing dashboard, not app logic.
        'src/data/**',
      ],
      reporter: ['text-summary', 'json-summary'],
      reportsDirectory: './coverage',
      /**
       * Thresholds are a ratchet, not an aspiration: they sit just under the
       * measured figure at the time of writing so the hook fails on a
       * regression rather than on the status quo. Raise them when coverage
       * rises; never lower them to make a commit pass.
       */
      thresholds: {
        lines: 89,
        functions: 92,
        branches: 80,
        statements: 88,
      },
    },
  },
});
