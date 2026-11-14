/**
 * netguard.test.ts – the offline guard cannot be swallowed (audit 2026-11-14, T2).
 *
 * `netguard.mjs` used to THROW and nothing else. Server code catches a failed
 * fetch as an upstream failure, so a test that reached the network through it
 * stayed green — seven such calls were counted. The guard now also records each
 * one and fails the process at exit; this file runs it in a child process and
 * reads the exit code.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

const netguard = new URL('./netguard.mjs', import.meta.url).href;

function run(script: string) {
  return spawnSync(process.execPath, ['--import', netguard, '--input-type=module', '-e', script], { encoding: 'utf8' });
}

test('a swallowed network call still fails the process, and is listed', () => {
  const r = run(`
    try { await fetch('https://repository.invalid/edu-sharing/rest/search', { method: 'POST' }); } catch { /* as server code does */ }
    await fetch('https://other.invalid/x').catch(() => undefined);
    console.log('reached the end');
  `);
  assert.match(r.stdout, /reached the end/, 'the code under test carried on, as it does in a real test');
  assert.equal(r.status, 1, 'and the process failed all the same');
  assert.match(r.stderr, /netguard: 2 unmocked network call/);
  assert.match(r.stderr, /POST https:\/\/repository\.invalid\/edu-sharing\/rest\/search/);
  assert.match(r.stderr, /GET https:\/\/other\.invalid\/x/);
});

test('the call itself still throws, so an unguarded test fails where it stands', () => {
  const r = run(`await fetch('https://repository.invalid/')`);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /must not reach the network/);
});

test('loopback and no fetch at all leave the exit code alone', () => {
  const r = run(`
    import http from 'node:http';
    const server = http.createServer((_, res) => res.end('ok'));
    await new Promise(r => server.listen(0, '127.0.0.1', r));
    const body = await (await fetch('http://127.0.0.1:' + server.address().port + '/')).text();
    server.close();
    console.log(body);
  `);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /ok/);
  assert.doesNotMatch(r.stderr, /netguard/);
});

test('a process that already failed keeps its own exit code', () => {
  const r = run(`await fetch('https://repository.invalid/').catch(() => undefined); process.exit(7);`);
  assert.equal(r.status, 7);
  assert.match(r.stderr, /netguard: 1 unmocked/);
});
