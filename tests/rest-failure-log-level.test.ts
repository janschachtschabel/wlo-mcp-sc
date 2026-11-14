/**
 * A repository that answers 404 or 403 on the public REST surface is a REFUSAL
 * — the ordinary reply for a record that is not there or not public. Logged at
 * error level it made every mistyped id on an open endpoint look like a defect
 * of this server. An outage (5xx) stays an error.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { routeRestRequest } from '../src/rest/routes.js';
import { installFetchMock } from './fetchMock.js';

async function levelFor(upstreamStatus: number): Promise<{ status?: number; level?: string }> {
  const mock = installFetchMock(() => ({ status: upstreamStatus, json: {} }));
  const real = process.stderr.write.bind(process.stderr);
  const lines: string[] = [];
  process.stderr.write = ((c: unknown) => { lines.push(String(c)); return true; }) as typeof process.stderr.write;
  let status: number | undefined;
  try {
    status = (await routeRestRequest('GET', '/api/search/Optik'))?.status;
  } finally { process.stderr.write = real; mock.restore(); }
  const line = lines.join('').split('\n').find(l => l.includes('rest handler error'));
  return { status, level: line ? (JSON.parse(line) as { level: string }).level : undefined };
}

for (const upstream of [403, 404]) {
  test(`a repository ${upstream} on /api is logged as a warning, not an error`, async () => {
    const { status, level } = await levelFor(upstream);
    assert.equal(status, upstream);
    assert.equal(level, 'warn');
  });
}

for (const upstream of [500, 503]) {
  test(`a repository ${upstream} on /api stays an error`, async () => {
    const { status, level } = await levelFor(upstream);
    assert.ok(status !== undefined && status >= 500);
    assert.equal(level, 'error');
  });
}
