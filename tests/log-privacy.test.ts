/**
 * log-privacy.test.ts – what the log says about a person (user decision
 * 2026-11-13: no combination of address, user name and search term).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { logAccount, logAddress, logTerm } from '../src/log-privacy.js';
import { fetchWikipediaSummaryResult } from '../src/wikipedia-api.js';
import { installFetchMock } from './fetchMock.js';

function withMode<T>(mode: string | undefined, fn: () => T): T {
  const before = process.env['LOG_PERSONAL_DATA'];
  if (mode === undefined) delete process.env['LOG_PERSONAL_DATA']; else process.env['LOG_PERSONAL_DATA'] = mode;
  try { return fn(); } finally {
    if (before === undefined) delete process.env['LOG_PERSONAL_DATA']; else process.env['LOG_PERSONAL_DATA'] = before;
  }
}

test('by default an address, an account and a search term are pseudonyms — never the value', () => {
  withMode(undefined, () => {
    for (const [fn, value] of [[logAddress, '203.0.113.7'], [logAccount, 'maria.muster'], [logTerm, 'Depression Hilfe']] as const) {
      const out = fn(value);
      assert.match(out, /^~[0-9a-f]{12}$/);
      assert.ok(!out.includes(value));
    }
  });
});

test('a pseudonym is stable within the process, so "the same again" stays visible', () => {
  withMode(undefined, () => {
    assert.equal(logAddress('203.0.113.7'), logAddress('203.0.113.7'));
    assert.notEqual(logAddress('203.0.113.7'), logAddress('203.0.113.8'));
    // One search is one pseudonym however it was typed.
    assert.equal(logTerm('Optik'), logTerm('  optik '));
    // One account is one pseudonym: the repository accepts a login in several spellings.
    assert.equal(logAccount('Maria.Muster'), logAccount('maria.muster '));
  });
});

test('the three kinds do not share pseudonyms — a name that equals a search term is not linked to it', () => {
  withMode(undefined, () => {
    assert.notEqual(logAccount('optik'), logTerm('optik'));
    assert.notEqual(logAddress('optik'), logTerm('optik'));
  });
});

test('LOG_PERSONAL_DATA=plain writes the values — sanitized where they are foreign text', () => {
  withMode('plain', () => {
    assert.equal(logAddress('203.0.113.7'), '203.0.113.7');
    assert.equal(logAccount('maria.muster'), 'maria.muster');
    assert.equal(logTerm('Optik'), 'Optik');
    assert.ok(!logAccount('a\nb').includes('\n'), 'a newline in a name must not start a second log line');
  });
  // Anything that is not exactly "plain" keeps the default: a typo must not unmask the log.
  withMode('plian', () => assert.match(logAddress('203.0.113.7'), /^~/));
  withMode('1', () => assert.match(logAddress('203.0.113.7'), /^~/));
});

test('a real log line: the Wikipedia miss names no search term', async () => {
  const mock = installFetchMock(() => ({ status: 500, json: {} }));
  const real = process.stderr.write.bind(process.stderr);
  const lines: string[] = [];
  process.stderr.write = ((c: unknown) => { lines.push(String(c)); return true; }) as typeof process.stderr.write;
  try {
    await withMode(undefined, () => fetchWikipediaSummaryResult('Schwangerschaftsabbruch', 'de', 1));
  } finally { process.stderr.write = real; mock.restore(); }
  assert.ok(!lines.join('').includes('Schwangerschaftsabbruch'), lines.join(''));
});

test('a failing /api/search/<term> logs the route, not the path that ends in the term', async () => {
  const { routeRestRequest } = await import('../src/rest/routes.js');
  const mock = installFetchMock(() => ({ status: 500, json: {} }));
  const real = process.stderr.write.bind(process.stderr);
  const lines: string[] = [];
  process.stderr.write = ((c: unknown) => { lines.push(String(c)); return true; }) as typeof process.stderr.write;
  try {
    const out = await routeRestRequest('GET', '/api/search/Schwangerschaftsabbruch');
    assert.equal(out?.status, 500, JSON.stringify(out));
  } finally { process.stderr.write = real; mock.restore(); }
  const logged = lines.join('');
  assert.match(logged, /rest handler error/);
  assert.ok(!logged.includes('Schwangerschaftsabbruch'), logged);
});
