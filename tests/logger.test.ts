import { test } from 'node:test';
import assert from 'node:assert/strict';

import { log, logLevelFrom, logToStdout, resetLoggerForTest, setLogLevel } from '../src/logger.js';

test('log.warn emits one JSON line to stderr with timestamp/level/service/message and its fields', () => {
  const real = process.stderr.write.bind(process.stderr);
  const captured: string[] = [];
  process.stderr.write = ((chunk: any) => { captured.push(String(chunk)); return true; }) as any;
  try {
    log.warn('something failed', { itemId: 42 });
  } finally {
    process.stderr.write = real;
  }
  assert.equal(captured.length, 1);
  const line = captured[0];
  assert.ok(line.endsWith('\n'), 'should be newline-terminated');
  const obj = JSON.parse(line);
  assert.equal(obj.level, 'warn');
  // The field names of the service guide (Team 6): one spelling across services.
  assert.equal(obj.service, 'wlo-mcp');
  assert.equal(obj.message, 'something failed');
  assert.equal(obj.itemId, 42);
  assert.match(obj.timestamp, /^\d{4}-\d\d-\d\dT/);
  assert.equal('ts' in obj || 'msg' in obj || 'name' in obj, false, 'the old names are gone, not doubled');
});

/**
 * `emit` runs in failure paths — a `log.error` inside a catch block is the last
 * thing standing between a bug and a silent process. A field that cannot be
 * serialised (a circular object, a BigInt) would make the logging call itself
 * throw and replace the real error with a TypeError, so the line degrades
 * instead of exploding.
 */
test('an unserialisable field degrades the line instead of throwing', () => {
  const circular: Record<string, unknown> = { name: 'node' };
  circular['self'] = circular;

  const real = process.stderr.write.bind(process.stderr);
  const captured: string[] = [];
  process.stderr.write = ((chunk: any) => { captured.push(String(chunk)); return true; }) as any;
  try {
    assert.doesNotThrow(() => log.error('write failed', { detail: circular }));
  } finally {
    process.stderr.write = real;
  }
  assert.equal(captured.length, 1);
  const obj = JSON.parse(captured[0]);
  assert.equal(obj.level, 'error');
  assert.equal(obj.message, 'write failed');
  assert.equal(typeof obj.timestamp, 'string');
  assert.match(String(obj.logError), /circular/i);
});

test('by default the logger writes only to stderr, never stdout (reserved for MCP stdio framing)', () => {
  const realOut = process.stdout.write.bind(process.stdout);
  const realErr = process.stderr.write.bind(process.stderr);
  let stdoutCalls = 0;
  const errLines: string[] = [];
  process.stdout.write = (() => { stdoutCalls++; return true; }) as any;
  process.stderr.write = ((c: any) => { errLines.push(String(c)); return true; }) as any;
  try {
    log.info('listening');
    log.error('boom', { code: 'E1' });
  } finally {
    process.stdout.write = realOut;
    process.stderr.write = realErr;
  }
  assert.equal(stdoutCalls, 0, 'logger must not write to stdout');
  assert.equal(errLines.length, 2);
  assert.equal(JSON.parse(errLines[0]).level, 'info');
  assert.equal(JSON.parse(errLines[1]).level, 'error');
  assert.equal(JSON.parse(errLines[1]).code, 'E1');
});

/** Run `fn` with both streams captured. */
function captured(fn: () => void): { out: string[]; err: string[] } {
  const realOut = process.stdout.write.bind(process.stdout);
  const realErr = process.stderr.write.bind(process.stderr);
  const out: string[] = [];
  const err: string[] = [];
  process.stdout.write = ((c: any) => { out.push(String(c)); return true; }) as any;
  process.stderr.write = ((c: any) => { err.push(String(c)); return true; }) as any;
  try { fn(); } finally { process.stdout.write = realOut; process.stderr.write = realErr; }
  return { out, err };
}

test('logToStdout moves every line to stdout — what the HTTP entry point asks for', () => {
  try {
    logToStdout();
    const { out, err } = captured(() => { log.info('listening'); log.error('boom'); });
    assert.equal(err.length, 0);
    assert.deepEqual(out.map(l => JSON.parse(l).level), ['info', 'error']);
  } finally { resetLoggerForTest(); }
  assert.equal(captured(() => log.info('back')).err.length, 1, 'the default is stderr again');
});

test('LOG_LEVEL: lines below the threshold are not written', () => {
  try {
    setLogLevel('warn');
    const { err } = captured(() => { log.info('quiet'); log.warn('loud'); log.error('louder'); });
    assert.deepEqual(err.map(l => JSON.parse(l).message), ['loud', 'louder']);
    setLogLevel('error');
    assert.deepEqual(captured(() => { log.warn('no'); log.error('yes'); }).err.map(l => JSON.parse(l).message), ['yes']);
  } finally { resetLoggerForTest(); }
});

test('logLevelFrom reads the four names in any case — and nothing else', () => {
  assert.equal(logLevelFrom('WARN'), 'warn');
  assert.equal(logLevelFrom(' error '), 'error');
  assert.equal(logLevelFrom('info'), 'info');
  // No line is written at debug today; the name is accepted so a deployment template need not special-case this service.
  assert.equal(logLevelFrom('debug'), 'debug');
  assert.equal(logLevelFrom(undefined), null);
  assert.equal(logLevelFrom(''), null);
  assert.equal(logLevelFrom('verbose'), null, 'an unknown name is reported by the caller, not guessed');
});

test('only the HTTP entry point sends the log to stdout — under stdio that is the protocol channel', async () => {
  const { readFileSync } = await import('node:fs');
  const src = (name: string) => readFileSync(new URL(`../src/${name}`, import.meta.url), 'utf8');
  const firstImport = src('http.ts').split(/\r?\n/).find(l => l.startsWith('import '));
  // FIRST, so the lines other modules write while they load go there too.
  assert.equal(firstImport, "import './logger-stdout.js';");
  assert.doesNotMatch(src('stdio.ts'), /logger-stdout|logToStdout/);
});
