/**
 * run-tests.mjs – Portable entry point for `npm test`.
 *
 * The npm script used to pass a glob (`--test "tests/*.test.ts"`). Glob support
 * in the test runner only arrived AFTER Node 20: Node 20 takes the pattern as a
 * literal path (and auto-discovers only .js/.cjs/.mjs, never .ts), so it runs
 * nothing and exits non-zero. The project supports Node >= 20 (package.json
 * `engines`) and ships `node:20-alpine`, so CI runs that very runtime — the glob
 * passed on the Node 22 dev machine and failed in CI.
 *
 * Expanding the file list here makes `npm test` behave identically on every
 * supported Node and in both shells (cmd.exe does not expand globs either).
 */

import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const testsDir = fileURLToPath(new URL('../tests/', import.meta.url));
const files = readdirSync(testsDir)
  .filter(f => f.endsWith('.test.ts'))
  .sort()
  .map(f => join(testsDir, f));

// Never report success on an empty run: a discovery that silently matches
// nothing is exactly the failure mode this script exists to prevent.
if (files.length === 0) {
  console.error('run-tests: no tests/*.test.ts found');
  process.exit(1);
}

const { status } = spawnSync(
  process.execPath,
  ['--import', 'tsx', '--test', ...files],
  { stdio: 'inherit' },
);
process.exit(status ?? 1);
