/**
 * tests/start.test.ts – the two entry points, actually started.
 *
 * `src/http.ts` and `src/stdio.ts` are the only files that read most of the
 * environment and wire the server together, and neither can be imported by a
 * test: one listens on import, the other takes over stdin. So no test ever ran
 * them (audit 2026-11-12, T-1) — a typo in the wiring showed up on the server.
 *
 * Each is started here as a child process, the way `npm run dev` starts it,
 * with an environment that cannot reach anything: the repository address is a
 * closed local port, and the background probes are off.
 */

import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import net from 'node:net';
import { fileURLToPath } from 'node:url';

import { addressForLog, repositoryUrlProblem, sanitizeRepositoryUrl } from '../src/wlo-config.js';

const root = fileURLToPath(new URL('../', import.meta.url));

/** Only what a child needs to run — never the developer's own WLO_* settings. */
function childEnv(extra: Record<string, string>): NodeJS.ProcessEnv {
  const keep = ['PATH', 'Path', 'SystemRoot', 'SYSTEMROOT', 'TEMP', 'TMP', 'HOME', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'ComSpec', 'PATHEXT'];
  const env: NodeJS.ProcessEnv = {};
  for (const k of keep) if (process.env[k] !== undefined) env[k] = process.env[k];
  return {
    ...env,
    // A closed local port: nothing leaves the machine, and a call fails at once.
    WLO_REPOSITORY_URL: 'http://127.0.0.1:9/edu-sharing',
    WLO_SKILL_CACHE: '0',
    WLO_READY_PROBE_MS: '0',
    WLO_AUTH_REGISTRY_PATH: '',
    ...extra,
  };
}

const netguard = new URL('./netguard.mjs', import.meta.url).href;

/**
 * Start an entry point. The child runs under the suite's network guard: "an
 * environment that cannot reach anything" is then enforced, not hoped — a
 * future startup call to another host fails the child instead of leaving the
 * machine (loopback stays allowed). It is killed when the test ends, however
 * the test ends.
 */
function start(t: TestContext, entry: string, env: Record<string, string>): { child: ChildProcess; stderr: () => string; stdout: () => string; logged: () => string } {
  const child = spawn(process.execPath, ['--import', 'tsx', '--import', netguard, entry],
    { cwd: root, env: childEnv(env), stdio: ['pipe', 'pipe', 'pipe'] });
  child.on('error', () => { /* reported through `exited` */ });
  t.after(async () => { child.kill('SIGKILL'); await exited(child); });
  let err = ''; let out = '';
  child.stderr!.on('data', (d: Buffer) => { err += d.toString(); });
  child.stdout!.on('data', (d: Buffer) => { out += d.toString(); });
  // Where the LOG goes: stdout over HTTP, stderr under stdio — there stdout is the protocol (D8).
  return { child, stderr: () => err, stdout: () => out, logged: () => (entry.endsWith('http.ts') ? out : err) };
}

const freePort = () => new Promise<number>((resolve, reject) => {
  const s = net.createServer();
  s.once('error', reject);
  s.listen(0, '127.0.0.1', () => { const { port } = s.address() as net.AddressInfo; s.close(() => resolve(port)); });
});

async function until<T>(probe: () => Promise<T | null> | T | null, ms: number, what: string, context: () => string): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const got = await probe();
    if (got !== null) return got;
    if (Date.now() > end) assert.fail(`${what} — not within ${ms} ms.\n${context()}`);
    await new Promise(r => setTimeout(r, 100));
  }
}

/** The promise, or 'still running' after `ms` — with a timer that does not keep the test process alive. */
const within = <T>(promise: Promise<T>, ms: number) => Promise.race([
  promise,
  new Promise<'still running'>(resolve => { setTimeout(() => resolve('still running'), ms).unref(); }),
]);

const exited = (child: ChildProcess) => new Promise<number | null>(resolve => {
  if (child.exitCode !== null || child.signalCode !== null) { resolve(child.exitCode); return; }
  child.once('exit', code => resolve(code));
  child.once('error', () => resolve(null));
});

test('the HTTP entry point starts, answers /health and lists its tools', { timeout: 60_000 }, async (t) => {
  const port = await freePort();
  const internalPort = await freePort();
  const { child, stderr, logged } = start(t, 'src/http.ts', { PORT: String(port), INTERNAL_PORT: String(internalPort), RATE_LIMIT_RPM: '0' });
  {
    const base = `http://127.0.0.1:${port}`;
    const health = await until(async () => {
      if (child.exitCode !== null) assert.fail(`the server exited with ${child.exitCode}:\n${logged()}${stderr()}`);
      try { const r = await fetch(`${base}/health`, { signal: AbortSignal.timeout(5_000) }); return r.ok ? r : null; } catch { return null; }
    }, 40_000, 'GET /health answers 200', () => logged() + stderr());
    assert.equal(((await health.json()) as { status?: string }).status, 'ok');

    // The second listener (D10): the operator's paths, and no MCP.
    const internal = `http://127.0.0.1:${internalPort}`;
    assert.equal((await fetch(`${internal}/health`, { signal: AbortSignal.timeout(5_000) })).status, 200);
    assert.equal((await fetch(`${internal}/metrics`, { signal: AbortSignal.timeout(5_000) })).status, 200);
    assert.equal((await fetch(`${internal}/mcp`, { method: 'POST', signal: AbortSignal.timeout(5_000) })).status, 404);

    const listed = await fetch(`${base}/mcp`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
      signal: AbortSignal.timeout(15_000),
    });
    assert.equal(listed.status, 200);
    const body = await listed.text();
    // JSON or one SSE frame, depending on MCP_SSE — the tool names are in both.
    assert.match(body, /"search_wlo_all"/);
    assert.match(body, /"wlo_update_content"/, 'the curation tools are listed for everyone');

    assert.match(logged(), /WLO MCP Server listening/);
    assert.doesNotMatch(logged(), /"level":"error"/, `no error at startup:\n${logged()}`);
    // Over HTTP the log is on STDOUT, every line of it — also what modules wrote while they loaded.
    assert.doesNotMatch(stderr(), /"service":"wlo-mcp"/, `a log line on stderr:\n${stderr()}`);
    // Complete lines only: background work still logs, and a chunk can end mid-line.
    for (const line of logged().split('\n').slice(0, -1).filter(l => l.trim())) {
      const entry = JSON.parse(line) as Record<string, unknown>;
      assert.equal(entry['service'], 'wlo-mcp');
      assert.equal(typeof entry['timestamp'], 'string');
      assert.equal(typeof entry['message'], 'string');
    }
  }
});

/** Whether a COMPLETE line of stdout is the answer to request `id` — a frame cut mid-way does not count. */
const answered = (out: string, id: number): boolean => out.split('\n').slice(0, -1).some(line => {
  try { return (JSON.parse(line) as { id?: number }).id === id; } catch { return false; }
});

test('the stdio entry point answers initialize and tools/list on stdout — and nothing else is written there', { timeout: 60_000 }, async (t) => {
  const { child, stdout, stderr } = start(t, 'src/stdio.ts', {});
  {
    const send = (msg: unknown) => child.stdin!.write(JSON.stringify(msg) + '\n');
    send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'start-test', version: '0' } } });
    await until(() => (answered(stdout(), 1) ? true : null), 40_000, 'initialize is answered', stderr);
    send({ jsonrpc: '2.0', method: 'notifications/initialized' });
    send({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
    await until(() => (answered(stdout(), 2) ? true : null), 20_000, 'tools/list is answered', stderr);

    const lines = stdout().split('\n').filter(l => l.trim());
    for (const line of lines) {
      const msg = JSON.parse(line) as { jsonrpc?: string };
      assert.equal(msg.jsonrpc, '2.0', 'stdout carries JSON-RPC frames only — a log line there breaks the client');
    }
    assert.match(stdout(), /"search_wlo_all"/);

    // It ends when its input closes — there is no signal handler to rely on.
    child.stdin!.end();
    assert.equal(await within(exited(child), 15_000), 0);
  }
});

// ── audit B-6: an address that cannot work is refused at startup ─────────────

for (const entry of ['src/http.ts', 'src/stdio.ts']) {
  test(`a repository address that cannot work stops ${entry} at startup, naming the variable`, { timeout: 60_000 }, async (t) => {
    const { child, logged } = start(t, entry, { PORT: '1', WLO_REPOSITORY_URL: 'htps://repository.example.org/edu-sharing' });
    const code = await within(exited(child), 40_000);
    assert.equal(code, 1, `a typo in the address must not start a server that fails every request:\n${logged()}`);
    assert.match(logged(), /WLO_REPOSITORY_URL cannot be used/);
    assert.doesNotMatch(logged(), /listening/);
  });
}

test('an address with a password in it is refused — and the password is in NO log line of the start', { timeout: 60_000 }, async (t) => {
  // Not a WLO host, so the "root collection" warning fires too: it used to print the address in full.
  const { child, stderr, logged } = start(t, 'src/http.ts', { PORT: '1', WLO_REPOSITORY_URL: 'https://admin:hunter2secret@repo.example.org/edu-sharing' });
  assert.equal(await within(exited(child), 40_000), 1, logged());
  assert.match(logged(), /WLO_REPOSITORY_URL cannot be used/);
  // Neither stream: the log moved to stdout, and whatever is left on stderr must not carry it either.
  assert.doesNotMatch(logged() + stderr(), /hunter2secret/);
  assert.doesNotMatch(logged() + stderr(), /admin:/);
});

test('repositoryUrlProblem: what is refused, and what is not', () => {
  const problem = (raw: string) => repositoryUrlProblem(sanitizeRepositoryUrl(raw));
  // Usable — a dotless host (a compose service name), a port, IPv6, a path prefix, any case,
  // and a colon or a doubled slash further down the path: all of these are working addresses.
  for (const ok of [
    'https://repository.staging.openeduhub.net/edu-sharing', 'repository.staging.openeduhub.net',
    'http://edu-sharing:8080/edu-sharing', 'http://127.0.0.1:9/edu-sharing', 'https://redaktion.openeduhub.net/edu-sharing/rest/',
    'http://[::1]:8080/edu-sharing', 'https://host.example/prefix/edu-sharing', 'HTTPS://Host.Example/edu-sharing',
    'https://host.example/a:b/edu-sharing', 'https://host.example/x//y/edu-sharing', 'localhost:8080',
  ]) assert.equal(problem(ok), null, ok);

  // A mistyped scheme, in the shapes sanitising gives it.
  for (const typo of ['htps://repository.example.org/edu-sharing', 'https//repository.example.org', 'https:/repository.example.org/edu-sharing', 'http://', 'https://']) {
    assert.match(problem(typo) ?? '', /scheme looks mistyped/, typo);
  }
  assert.ok(problem('https://my repo.example.org/edu-sharing'), 'a space');
  assert.ok(problem('https://user:secret@repository.example.org/edu-sharing'), 'credentials in the address');
  for (const q of ['https://repository.example.org/edu-sharing?x=1', 'https://repository.example.org/edu-sharing/?', 'https://repository.example.org/edu-sharing/#/']) {
    assert.match(problem(q) ?? '', /query or a fragment/, q);
  }
  // Sanitising always prepends https://, so the protocol rule is reachable only without it.
  assert.match(repositoryUrlProblem('ftp://repository.example.org/edu-sharing') ?? '', /http:\/\/ or https:\/\//);
  // The message never repeats the value: it may hold a password.
  assert.doesNotMatch(problem('https://user:secret@repository.example.org/edu-sharing') ?? '', /secret/);
});

test('addressForLog keeps origin and path — never credentials, never a query', () => {
  assert.equal(addressForLog('https://admin:pw@repo.example.org/edu-sharing?token=x#y'), 'https://repo.example.org/edu-sharing');
  assert.equal(addressForLog('https://repo.example.org:8443/edu-sharing'), 'https://repo.example.org:8443/edu-sharing');
  assert.equal(addressForLog('https://my repo/edu-sharing'), '(not a parseable address)');
});
