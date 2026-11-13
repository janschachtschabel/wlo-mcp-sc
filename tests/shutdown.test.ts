/**
 * tests/shutdown.test.ts – what a stop signal does to a server with work in hand.
 *
 * Audit 2026-11-12, B-1: the process had no signal handler. As PID 1 in a
 * container Node then IGNORES SIGTERM, so every `docker stop` — every deploy —
 * waited out the grace period and ended in SIGKILL, cutting whatever was in
 * flight. For a confirmed write that is the worst moment: the repository does
 * the work, the caller never hears of it.
 *
 * A real `http.Server` on a random port, a stand-in for `process` (an emitter
 * and a recorded `exit`) — nothing here signals the test runner itself.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import { readFileSync } from 'node:fs';
import { EventEmitter } from 'node:events';
import type { AddressInfo } from 'node:net';

import { installGracefulShutdown, trackRequests } from '../src/shutdown.js';
import { detachedFromRequest } from '../src/request-scope.js';

interface Harness {
  server: http.Server;
  port: number;
  base: string;
  proc: EventEmitter;
  exits: number[];
  exited: Promise<number>;
}

async function harness(handler: http.RequestListener, graceMs: number, opts: { listen?: boolean } = {}): Promise<Harness> {
  const requests = trackRequests(handler);
  const server = http.createServer(requests.listener);
  if (opts.listen !== false) await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const proc = new EventEmitter();
  const exits: number[] = [];
  let resolveExit!: (code: number) => void;
  const exited = new Promise<number>(resolve => { resolveExit = resolve; });
  installGracefulShutdown({
    server, requests, graceMs, proc,
    exit: (code) => { exits.push(code); resolveExit(code); },
  });
  const port = opts.listen === false ? 0 : (server.address() as AddressInfo).port;
  return { server, port, base: `http://127.0.0.1:${port}`, proc, exits, exited };
}

/** A handler that holds its request until `release` is called, and says when one arrived. */
function held() {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let started!: () => void;
  const arrived = new Promise<void>(resolve => { started = resolve; });
  const handler: http.RequestListener = async (_req, res) => { started(); await gate; res.end('done'); };
  return { handler, release, arrived };
}

const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

test('a request in flight is answered before the process ends — and the exit is clean', async () => {
  const work = held();
  const h = await harness(work.handler, 5_000);

  const inFlight = fetch(`${h.base}/`).then(r => r.text());
  await work.arrived;
  h.proc.emit('SIGTERM');
  await sleep(250);
  assert.deepEqual(h.exits, [], 'not while a request is still being worked on');

  const released = Date.now();
  work.release();
  assert.equal(await inFlight, 'done', 'the caller gets its answer — whole');
  assert.equal(await h.exited, 0);
  // The client's connection is kept alive (fetch does that): once its request
  // is answered it must not be waited on for the keep-alive timeout (~5 s).
  assert.ok(Date.now() - released < 2_000, `exit came ${Date.now() - released} ms after the last answer`);
});

test('after the signal no new connection is accepted', async () => {
  const work = held();
  const h = await harness(work.handler, 5_000);

  const inFlight = fetch(`${h.base}/`).then(r => r.text());
  await work.arrived;
  h.proc.emit('SIGTERM');
  await assert.rejects(fetch(`${h.base}/`), 'a draining server takes no new work');
  work.release();
  await inFlight;
  assert.equal(await h.exited, 0);
});

test('work that outlasts the grace period is cut, and the exit says so', async () => {
  let started!: () => void;
  const arrived = new Promise<void>(resolve => { started = resolve; });
  // Never answers.
  const h = await harness(() => { started(); }, 150);

  const hanging = fetch(`${h.base}/`).then(() => 'answered', () => 'cut');
  await arrived;
  const before = Date.now();
  h.proc.emit('SIGTERM');
  assert.equal(await h.exited, 1, 'a forced end is not reported as a clean one');
  assert.ok(Date.now() - before >= 140, 'the grace period was granted first');
  assert.equal(await hanging, 'cut');
});

for (const second of ['SIGINT', 'SIGTERM'] as const) {
  test(`a second signal (${second}) ends the wait at once`, async () => {
    let started!: () => void;
    const arrived = new Promise<void>(resolve => { started = resolve; });
    const h = await harness(() => { started(); }, 60_000);

    const hanging = fetch(`${h.base}/`).then(() => 'answered', () => 'cut');
    await arrived;
    h.proc.emit('SIGTERM');
    h.proc.emit(second);
    assert.equal(await h.exited, 1);
    assert.equal(await hanging, 'cut');
    assert.equal(h.exits.length, 1, 'exit is called once');
  });
}

// ── review of this package: the drain counts WORK, not connections ───────────

test('a connection that carries no request does not hold the exit, and is not reported as cut work', async () => {
  const h = await harness((_req, res) => { res.end('ok'); }, 5_000);
  // One socket that never sends a byte, one that sends half a header. Neither is
  // "idle" to closeIdleConnections; measured, both held a connection-counting
  // drain for the whole grace period and turned it into a forced exit.
  const silent = net.connect(h.port, '127.0.0.1');
  const half = net.connect(h.port, '127.0.0.1');
  await Promise.all([new Promise(r => silent.once('connect', r)), new Promise(r => half.once('connect', r))]);
  half.write('GET / HTTP/1.1\r\nHost: x\r\n');
  await sleep(50);

  const before = Date.now();
  h.proc.emit('SIGTERM');
  assert.equal(await h.exited, 0, 'nothing was in hand, so nothing was cut');
  assert.ok(Date.now() - before < 1_000);
  silent.destroy(); half.destroy();
});

test('a client that hung up does not end the wait — its handler is still working', async () => {
  const work = held();
  const h = await harness(work.handler, 5_000);

  const socket = net.connect(h.port, '127.0.0.1');
  await new Promise(r => socket.once('connect', r));
  socket.write('GET / HTTP/1.1\r\nHost: x\r\n\r\n');
  await work.arrived;
  socket.destroy();          // the client gives up; no connection is left
  await sleep(100);

  h.proc.emit('SIGTERM');
  await sleep(300);
  assert.deepEqual(h.exits, [], 'no connection, but work — a write would be cut mid-way');
  work.release();
  assert.equal(await h.exited, 0);
});

test('work detached from its request is waited for, although no handler holds it', async () => {
  const h = await harness((_req, res) => { res.end('ok'); }, 5_000);
  let finishWrite!: () => void;
  const write = detachedFromRequest(() => new Promise<void>(resolve => { finishWrite = resolve; }));

  h.proc.emit('SIGTERM');
  await sleep(300);
  assert.deepEqual(h.exits, [], 'a write and its read-back run to their end');
  finishWrite();
  await write;
  assert.equal(await h.exited, 0);
});

test('a signal before the server listens ends at once, cleanly', async () => {
  const h = await harness((_req, res) => { res.end('ok'); }, 5_000, { listen: false });
  const before = Date.now();
  h.proc.emit('SIGTERM');
  assert.equal(await h.exited, 0);
  assert.ok(Date.now() - before < 1_000);
});

test('SIGINT is handled like SIGTERM — with work in hand', async () => {
  const work = held();
  const h = await harness(work.handler, 5_000);
  const inFlight = fetch(`${h.base}/`).then(r => r.text());
  await work.arrived;
  h.proc.emit('SIGINT');
  work.release();
  assert.equal(await inFlight, 'done');
  assert.equal(await h.exited, 0);
});

test('the HTTP entry point installs it, around the handler it serves', () => {
  // http.ts listens on import and cannot be loaded in a test; its source is read instead.
  const source = readFileSync(new URL('../src/http.ts', import.meta.url), 'utf8');
  assert.match(source, /const requests = trackRequests\(createHttpRequestHandler\(/);
  assert.match(source, /http\.createServer\(requests\.listener\)/);
  assert.match(source, /installGracefulShutdown\(\{ server: httpServer, requests \}\)/);
});

test('exit is called once, however many signals follow a finished drain', async () => {
  const h = await harness((_req, res) => { res.end('ok'); }, 5_000);
  h.proc.emit('SIGTERM');
  assert.equal(await h.exited, 0);
  h.proc.emit('SIGTERM');
  h.proc.emit('SIGINT');
  assert.deepEqual(h.exits, [0]);
});

test('detached work that FAILS is no longer counted — a failed write must not hold every later stop', async () => {
  const { detachedWorkInFlight } = await import('../src/request-scope.js');
  const before = detachedWorkInFlight();
  await assert.rejects(detachedFromRequest(() => Promise.reject(new Error('upstream 500'))));
  assert.throws(() => detachedFromRequest(() => { throw new Error('sync'); }));
  assert.equal(detachedFromRequest(() => 7), 7);
  await new Promise<void>(resolve => setImmediate(resolve));
  assert.equal(detachedWorkInFlight(), before);
});
