/**
 * run-live-tests.mjs – entry point for `npm run test:live`.
 *
 * Runs `tests/live/*.test.ts` against the CONFIGURED repository — deliberately
 * outside `npm test`: these tests talk to a real edu-sharing, so netguard would
 * (rightly) fail them and CI has no credential to run them with. They exist
 * because the offline suite proves only that the code sends what we decided to
 * send, never that the repository accepts it (audit 2026-08-12, finding 1).
 * `run-tests.mjs` reads `tests/` FLAT, so the `live/` subdirectory cannot leak
 * into the offline run.
 *
 * `--env-file-if-exists=.env` mirrors the dev/start scripts: the service
 * credential and the repository URL come from the same file the server reads.
 * The staging-only rule is enforced in the test file itself, not here — it must
 * hold however the file is executed.
 */

import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const liveDir = fileURLToPath(new URL('../tests/live/', import.meta.url));
const files = readdirSync(liveDir)
  .filter(f => f.endsWith('.test.ts'))
  .sort()
  .map(f => join(liveDir, f));

// Same rule as run-tests.mjs: an empty discovery must never report success.
if (files.length === 0) {
  console.error('run-live-tests: no tests/live/*.test.ts found');
  process.exit(1);
}

const { status } = spawnSync(
  process.execPath,
  ['--env-file-if-exists=.env', '--import', 'tsx', '--test', ...files],
  { stdio: 'inherit' },
);
process.exit(status ?? 1);
