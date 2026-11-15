/**
 * text-extraction-key.test.ts – which `WLO_TEXT_EXTRACTION_API_KEY` is usable
 * (review 2026-11-13).
 *
 * A key with a control or non-ASCII character makes `fetch` throw an error
 * whose MESSAGE quotes the header value — and that message was logged. And a
 * key sent to an `http:` address travels in cleartext. Both are decided once,
 * at load, by a pure function; neither warning may contain the key.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { resolveExtractionKey } from '../src/wlo-config.js';
import { extractTextFromUrl } from '../src/text-extraction-api.js';
import { installFetchMock } from './fetchMock.js';

const HTTPS = 'https://b-api.example.test/api/v1/proxy/text-extraction';

function withLog<T>(fn: () => T): { value: T; lines: string[] } {
  const lines: string[] = [];
  const realWrite = process.stderr.write.bind(process.stderr);
  process.stderr.write = ((chunk: unknown) => { lines.push(String(chunk)); return true; }) as never;
  try { return { value: fn(), lines }; } finally { process.stderr.write = realWrite; }
}

test('a printable ASCII key without spaces is used as it is', () => {
  const { value, lines } = withLog(() => resolveExtractionKey('  sk-Abc_123.~!+/=  ', HTTPS));
  assert.equal(value, 'sk-Abc_123.~!+/=');
  assert.deepEqual(lines, []);
});

test('no key: none, and nothing to warn about', () => {
  for (const raw of [undefined, '', '   ']) {
    const { value, lines } = withLog(() => resolveExtractionKey(raw, HTTPS));
    assert.equal(value, '');
    assert.deepEqual(lines, []);
  }
});

test('a key with a control, non-ASCII or space character counts as unset — ONE warning, naming the variable, never the value', () => {
  for (const raw of ['geheim\nX-Evil: 1', 'geheim\u0000', 'schlüssel-geheim', 'geheim wert', 'geheim\tzwei', 'geheim x', 'geheim\x7f']) {
    const { value, lines } = withLog(() => resolveExtractionKey(raw, HTTPS));
    assert.equal(value, '', JSON.stringify(raw));
    assert.equal(lines.length, 1, JSON.stringify(raw));
    assert.match(lines[0]!, /WLO_TEXT_EXTRACTION_API_KEY/);
    assert.doesNotMatch(lines[0]!, /geheim/, 'the value is not in the log line');
  }
});

test('a key for an http: address is not sent — it would travel in cleartext', () => {
  const { value, lines } = withLog(() => resolveExtractionKey('sk-geheim', 'http://extract.intern.example'));
  assert.equal(value, '');
  assert.equal(lines.length, 1);
  assert.match(lines[0]!, /WLO_TEXT_EXTRACTION_API_KEY/);
  assert.doesNotMatch(lines[0]!, /geheim/);
  // No service configured at all: the key is simply unused, nothing to say.
  assert.deepEqual(withLog(() => resolveExtractionKey('sk-geheim', '')).lines, []);
});

test('a refused key: the service is still called, without it, and no log line carries it', async () => {
  const mock = installFetchMock(() => ({ json: { text: 'Inhalt' } }));
  try {
    const key = resolveExtractionKey('geheim\nX-Evil: 1', HTTPS);
    const { value, lines } = await (async () => {
      const captured: string[] = [];
      const realWrite = process.stderr.write.bind(process.stderr);
      process.stderr.write = ((chunk: unknown) => { captured.push(String(chunk)); return true; }) as never;
      try { return { value: await extractTextFromUrl('https://material.example/seite', 'browser', HTTPS, key), lines: captured }; }
      finally { process.stderr.write = realWrite; }
    })();
    assert.equal(value, 'Inhalt', 'the service is still called — without a key');
    assert.equal(new Headers(mock.calls[0]!.init?.headers).get('x-api-key'), null);
    assert.ok(lines.every(l => !l.includes('geheim')));
  } finally { mock.restore(); }
});
