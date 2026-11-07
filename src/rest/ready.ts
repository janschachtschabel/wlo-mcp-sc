/**
 * rest/ready.ts – `GET /ready`: is the repository reachable? (plan 2026-11-07, S5)
 *
 * `/health` answers "the process runs"; this answers "it can do its job".
 * 200 `{status: "ready", upstream: "ok", …}` or 503 `{status: "not_ready",
 * upstream: "unreachable" | "slow", …}`. No budget: the answer comes from
 * `services/upstream-readiness.ts`, which asks the repository at most once per
 * 30 s however often this is called.
 */

import type { ServerResponse } from 'node:http';

import { readiness } from '../services/upstream-readiness.js';

export const READY_PATH = '/ready';

export async function handleReady(res: ServerResponse): Promise<void> {
  const r = await readiness();
  res.writeHead(r.ok ? 200 : 503, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify({ status: r.ok ? 'ready' : 'not_ready', ...r }));
}
