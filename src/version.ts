/**
 * version.ts – the one place the server learns its own version.
 *
 * Read from `package.json` at startup rather than written into code: `/health`
 * and the MCP `serverInfo` used to say `1.0.0` literally while releases came
 * and went (audit 2026-11-05), so "which version is live" had no answer except
 * the widget hashes. Now bumping `package.json` is the whole release step.
 *
 * `src/version.ts` and the compiled `dist/version.js` both sit one level below
 * the repository root, and the Docker image copies `package.json` next to
 * `dist/`, so the same relative path holds in every way the server is run.
 */

import { readFileSync } from 'node:fs';

function readVersion(): string {
  try {
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version?: unknown };
    return typeof pkg.version === 'string' && pkg.version ? pkg.version : '0.0.0-unknown';
  } catch {
    // A missing manifest must not stop the server; the odd value makes the
    // packaging mistake visible on /health instead.
    return '0.0.0-unknown';
  }
}

export const SERVER_VERSION: string = readVersion();
