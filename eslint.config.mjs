import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';

/**
 * Lint configuration.
 *
 * Deliberately narrow. `tsc --noEmit` already runs in CI and in the pre-commit
 * hook, so every rule that duplicates the type checker is off; what is left is
 * the class of mistake a type checker cannot see — an unused import, a React
 * hook with a stale dependency, an `any` that erases a domain type, a `console`
 * left behind in shipped code.
 *
 * Type-aware linting is not enabled: it needs a full program build per run,
 * which would put seconds on every commit for rules `tsc` already covers.
 */
export default tseslint.config(
  {
    ignores: ['dist/**', 'coverage/**', 'node_modules/**', 'logs/**', 'mock_intervals_data.json'],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
    },
    rules: {
      // An unused variable is either dead code or a bug where the wrong thing
      // was referenced. Leading underscore is the escape hatch for a
      // deliberately ignored parameter or destructured remainder.
      '@typescript-eslint/no-unused-vars': ['error', {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        caughtErrors: 'none',
        ignoreRestSiblings: true,
      }],

      // `any` is how a domain type quietly stops being enforced. Untrusted
      // input should arrive as `unknown` and go through a Zod schema, which is
      // the pattern the whole ingestion layer already follows.
      '@typescript-eslint/no-explicit-any': 'error',

      // Non-null assertions are load-bearing in tests, where the shape is
      // known; in src they hide the case the assertion is wrong about.
      '@typescript-eslint/no-non-null-assertion': 'error',

      'eqeqeq': ['error', 'always', { null: 'ignore' }],
      'no-var': 'error',
      'prefer-const': 'error',
    },
  },

  {
    files: ['src/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      // A missing dependency is a stale closure — the class of bug that shows
      // an athlete yesterday's data and looks like a sync failure.
      'react-hooks/exhaustive-deps': 'error',

      // The app has a real logger (`src/logger.ts`) that relays to the server
      // in dev. A bare console call bypasses it and ships to production.
      'no-console': 'error',
    },
  },

  {
    // Node tooling: build scripts and the secret scanner. These run outside the
    // browser, so the Node globals have to be declared or `no-undef` fires on
    // every `console` and `process`. Declared inline rather than pulling in the
    // `globals` package for four names.
    files: ['scripts/**/*.mjs', '*.config.mjs'],
    languageOptions: {
      globals: {
        console: 'readonly',
        process: 'readonly',
        Buffer: 'readonly',
        URL: 'readonly',
        __dirname: 'readonly',
      },
    },
    rules: { 'no-console': 'off' },
  },

  {
    // The logger *is* the sanctioned console boundary — `no-console` exists to
    // stop everything else bypassing it, not to stop it doing its job.
    files: ['src/logger.ts'],
    rules: { 'no-console': 'off' },
  },

  {
    // Tests assert on known shapes, print diagnostics, and stub transport
    // objects that have no useful type. The rules above exist to protect
    // shipped code, not to make a mock of `req`/`res` clumsy to write.
    files: ['tests/**/*.ts', '*.config.ts', 'eslint.config.mjs', 'scripts/**/*.mjs'],
    rules: {
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      'no-console': 'off',
    },
  },
);
