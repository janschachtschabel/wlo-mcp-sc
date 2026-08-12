/**
 * eslint.config.mjs – the correctness gate `npm run lint` and CI run.
 *
 * Deliberately WITHOUT a formatter and without style rules: the codebase
 * predates the linter, so a formatting sweep would rewrite thousands of lines
 * and bury every real change in the diff (audit 2026-08-12, finding 3 chose
 * ESLint-only for exactly that reason). What runs here are the recommended
 * correctness rules; the project-specific invariants stay where they always
 * were — tests/shared-rule-discipline.test.ts and its siblings — because a
 * generic linter cannot check "this rule has exactly one copy".
 */

import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';

export default tseslint.config(
  // Build artifacts, dependencies, and agent-tooling worktrees (which hold a
  // full COPY of this repo) are not ours to lint.
  { ignores: ['dist/', 'dist-widgets/', 'node_modules/', '.claude/'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // The codebase's existing convention for a value that exists to be dropped
    // (`_dropped` in a rest destructuring, an unused `_arg`): the underscore
    // already says "deliberately unused", so the rule must not re-flag it.
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        caughtErrorsIgnorePattern: '^_',
      }],
    },
  },
  {
    // Plain-JS Node tooling (test runner, netguard, probes, widget build).
    // `no-undef` does real work here — in TS files the compiler owns that
    // check and typescript-eslint switches the rule off — so the runtime's
    // globals must be declared for it.
    files: ['**/*.mjs'],
    languageOptions: { globals: globals.node },
  },
  {
    // The access-block pages run in the BROWSER: DOM, fetch, WebCrypto.
    files: ['public/**/*.js'],
    languageOptions: { globals: globals.browser },
  },
  {
    // Test fixtures cast partial shapes at mock boundaries (`as any`, ~170
    // sites) — the idiom the suite is built on. Rewriting those casts would be
    // a sweeping change for zero behavioural value, so the rule is off HERE
    // and stays on for src/, where a new `any` is a real finding.
    files: ['tests/**'],
    rules: { '@typescript-eslint/no-explicit-any': 'off' },
  },
);
