/**
 * text-extraction-api.test.ts – the openeduhub text-extraction client.
 *
 * The module had no test file of its own before R2. Its central property is
 * what it is ALLOWED to ask the service to fetch: the URL comes from a
 * repository record's `ccm:wwwurl`, which anyone with WLO write rights can set,
 * so a private-network address must never be forwarded.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { extractTextFromUrl } from '../src/text-extraction-api.js';
import { installFetchMock } from './fetchMock.js';

const SERVICE = 'https://extract.example.test';

test('extractTextFromUrl: posts the URL and returns the extracted text', async () => {
  const mock = installFetchMock(() => ({ json: { text: '# Titel\n\nInhalt.' } }));
  try {
    const out = await extractTextFromUrl('https://material.example/seite', 'browser', SERVICE);
    assert.equal(out, '# Titel\n\nInhalt.');
    assert.equal(mock.calls[0].url, `${SERVICE}/from-url`);
    const body = JSON.parse(String(mock.calls[0].init?.body));
    assert.equal(body.url, 'https://material.example/seite');
    assert.equal(body.method, 'browser');
  } finally { mock.restore(); }
});

test('extractTextFromUrl: disabled service (empty base URL) returns null without a call', async () => {
  const mock = installFetchMock(() => ({ json: { text: 'x' } }));
  try {
    assert.equal(await extractTextFromUrl('https://material.example/', 'browser', ''), null);
    assert.equal(mock.calls.length, 0);
  } finally { mock.restore(); }
});

test('extractTextFromUrl: rejects a non-http(s) scheme', async () => {
  const mock = installFetchMock(() => ({ json: { text: 'x' } }));
  try {
    assert.equal(await extractTextFromUrl('file:///etc/passwd', 'browser', SERVICE), null);
    assert.equal(await extractTextFromUrl('ftp://host/x', 'browser', SERVICE), null);
    assert.equal(mock.calls.length, 0);
  } finally { mock.restore(); }
});

test('extractTextFromUrl: never forwards a private or loopback address', async () => {
  // `ccm:wwwurl` is repository content — settable by any curator, including
  // through this server's own write tools. Handing such a URL to the extraction
  // service would make that service probe a network it was never asked to see.
  const blocked = [
    'http://127.0.0.1:8080/admin',
    'http://localhost/admin',
    'https://[::1]/admin',
    'http://169.254.169.254/latest/meta-data/',
    'http://10.0.0.5/internal',
    'http://192.168.1.1/router',
    'http://172.16.0.9/internal',
    'http://0.0.0.0/',
  ];
  const mock = installFetchMock(() => ({ json: { text: 'secret' } }));
  try {
    for (const url of blocked) {
      assert.equal(await extractTextFromUrl(url, 'browser', SERVICE), null, `blocked: ${url}`);
    }
    assert.equal(mock.calls.length, 0, 'no request left the process');
  } finally { mock.restore(); }
});

test('extractTextFromUrl: a public host that merely looks private is allowed', async () => {
  // The guard must key on the resolved host shape, not on a substring: a real
  // article at `https://10.0.0.5.example.com/` is public material.
  const mock = installFetchMock(() => ({ json: { text: 'ok' } }));
  try {
    assert.equal(await extractTextFromUrl('https://10.0.0.5.example.com/a', 'browser', SERVICE), 'ok');
    assert.equal(await extractTextFromUrl('https://localhost.example.org/a', 'browser', SERVICE), 'ok');
  } finally { mock.restore(); }
});

test('extractTextFromUrl: a non-OK service response degrades to null', async () => {
  const mock = installFetchMock(() => ({ status: 424, json: {} }));
  try {
    assert.equal(await extractTextFromUrl('https://material.example/', 'browser', SERVICE), null);
  } finally { mock.restore(); }
});

test('extractTextFromUrl: a 200 that is not JSON degrades to null', async () => {
  const mock = installFetchMock(() => ({ text: '<html>gateway</html>' }));
  try {
    assert.equal(await extractTextFromUrl('https://material.example/', 'browser', SERVICE), null);
  } finally { mock.restore(); }
});
