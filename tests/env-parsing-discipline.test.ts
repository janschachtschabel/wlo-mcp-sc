/**
 * env-parsing-discipline.test.ts – every environment number goes through the
 * shared parser.
 *
 * `resolvePositiveInt` exists because `parseInt` stops at the first non-digit:
 * `WLO_FETCH_TIMEOUT_MS=20s` resolved to a 20 ms timeout, a deployment where
 * every upstream call fails with nothing in the log pointing at the cause. The
 * helper was written, and five other variables kept using raw `parseInt` anyway
 * — `MAX_BODY_BYTES=1MB` became a one-byte cap that answered every request with
 * `413`.
 *
 * Those five live in `http.ts` and `reranker.ts`. `http.ts` starts listening on
 * import and therefore cannot be imported by a test, so the *behaviour* is not
 * reachable from here — which is exactly how the raw `parseInt` survived the
 * addition of the helper and its unit tests. This checks the SOURCE instead: a
 * blunt instrument, but it fires on the one thing that matters, and it is the
 * same approach `deploy-env-passthrough.test.ts` takes for a gap of the same
 * shape.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const srcDir = fileURLToPath(new URL('../src/', import.meta.url));

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full));
    else if (entry.endsWith('.ts')) out.push(full);
  }
  return out;
}

/**
 * `parseInt` / `Number(...)` applied to something read out of `process.env`,
 * on one line. Both spellings shipped: `parseInt(process.env['X'] ?? '', 10)`
 * for the four in `http.ts` and `Number(process.env['PORT'] ?? 3000)` for the
 * port. Neither reports a value it could not fully read.
 */
const RAW_ENV_NUMBER = /(?:parseInt|parseFloat|Number)\s*\(\s*process\.env\b/;

test('no environment number is parsed without the shared, warning parser', () => {
  const offenders: string[] = [];
  for (const file of sourceFiles(srcDir)) {
    const lines = readFileSync(file, 'utf8').split('\n');
    lines.forEach((line, i) => {
      if (RAW_ENV_NUMBER.test(line)) {
        offenders.push(`${file.slice(srcDir.length).replace(/\\/g, '/')}:${i + 1}  ${line.trim()}`);
      }
    });
  }
  assert.deepEqual(
    offenders,
    [],
    'use resolvePositiveInt / resolveNonNegativeInt from wlo-config.ts — a raw parse ' +
      'accepts "1MB" as 1 and says nothing:\n' + offenders.join('\n'),
  );
});
