/**
 * write-content-upload.test.ts – attaching bytes to a record, and proving they arrived.
 *
 * **What these tests can and cannot show.** A test against `fetchMock` proves we
 * send what we decided to send — never that the repository accepts it (lesson of
 * 2026-08-02, where `wlo_create_collection` was green against a faked upstream
 * and had never worked). The request SHAPE below comes from a measurement, not
 * from this file: `wlo-content-files`, validated 2026-05-08 against production
 * and staging, and staging's own `openapi.json`, read 2026-08-06 —
 * `POST …/{id}/content?mimetype=…`, multipart field `file`, and `mimetype` a
 * required query parameter.
 *
 * What these tests DO prove is the half that has bitten this project repeatedly:
 * that a `200` is not taken as proof. edu-sharing discards writes and answers
 * `200` — three separate mechanisms do — so the record is read back, and a node
 * that still reports no bytes is reported as NOT stored rather than as success.
 * `size` and `downloadUrl` are null until content arrives; that is the signal.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { installFetchMock } from './fetchMock.js';
import { uploadContent } from '../src/services/write/content-upload.js';
import { resolveContentSource } from '../src/services/write/content-source.js';

const NODE = 'abc-123';

function file() {
  const r = resolveContentSource({ title: 'Übung', content: '# Aufgabe\n' });
  assert.ok(r.ok && r.source.kind === 'file');
  return r.source.file;
}

/** A read-back answer: `stored` decides whether the node reports bytes. */
const metadata = (stored: boolean) => ({
  node: {
    ref: { id: NODE, repo: '-home-' },
    size: stored ? 10 : null,
    downloadUrl: stored ? 'https://repo.example/dl' : null,
  },
});

test('the upload goes to the content endpoint with the mimetype and a file part', async () => {
  const f = file();
  const mock = installFetchMock((url) =>
    url.includes('/content?') ? { status: 200, json: {} } : { status: 200, json: metadata(true) });
  try {
    const outcome = await uploadContent(NODE, f);
    assert.equal(outcome.status, 'stored');

    const post = mock.calls.find((c) => c.url.includes('/content?'));
    assert.ok(post, 'the content endpoint must be called');
    assert.match(post.url, new RegExp(`/nodes/-home-/${NODE}/content\\?`));
    assert.match(post.url, /mimetype=text%2Fmarkdown/, 'mimetype is a required query parameter');
    assert.equal(post.init?.method, 'POST');

    const body = post.init?.body;
    assert.ok(body instanceof FormData, 'the body must be multipart, not JSON');
    const part = body.get('file');
    assert.ok(part instanceof Blob, 'the part is named "file"');
    assert.equal(await (part as Blob).text(), '# Aufgabe\n', 'and carries the bytes unchanged');

    // fetch derives the multipart boundary itself; setting Content-Type by hand
    // produces a body no server can parse.
    const headers = new Headers((post.init?.headers ?? {}) as HeadersInit);
    assert.equal(headers.get('content-type'), null, 'Content-Type must be left to fetch');
  } finally {
    mock.restore();
  }
});

/**
 * The measured failure this read-back exists for. Reporting "stored" on the
 * strength of a 200 would leave a record that looks finished and is empty —
 * and the person would find out when someone opens it.
 */
test('a 200 with no bytes on the record is reported as not stored', async () => {
  const mock = installFetchMock((url) =>
    url.includes('/content?') ? { status: 200, json: {} } : { status: 200, json: metadata(false) });
  try {
    const outcome = await uploadContent(NODE, file());
    assert.equal(outcome.status, 'dropped');
  } finally {
    mock.restore();
  }
});

test('an upload the repository refuses is a failure, with its detail', async () => {
  const mock = installFetchMock((url) =>
    url.includes('/content?')
      ? { status: 403, json: { error: 'AccessDeniedException' } }
      : { status: 200, json: metadata(false) });
  try {
    const outcome = await uploadContent(NODE, file());
    assert.equal(outcome.status, 'failed');
    assert.match(outcome.status === 'failed' ? outcome.detail : '', /403|Access/i);
  } finally {
    mock.restore();
  }
});

/**
 * Unreadable AFTER a successful write is not the same as a failed write: the
 * bytes may well be there. Saying "unverified" keeps the difference, where
 * "failed" would invite a retry that creates a second version.
 */
test('a record that cannot be read back afterwards is unverified, not failed', async () => {
  const mock = installFetchMock((url) =>
    url.includes('/content?') ? { status: 200, json: {} } : { status: 500, json: {} });
  try {
    const outcome = await uploadContent(NODE, file());
    assert.equal(outcome.status, 'unverified');
  } finally {
    mock.restore();
  }
});

/**
 * The live API serialises `size` as a STRING (documented on `WloNode`, and the
 * formatter already coerces). A strict `typeof === 'number'` check would call
 * every successful upload dropped.
 */
test('a size the API sends as a string still counts as stored', async () => {
  const mock = installFetchMock((url) =>
    url.includes('/content?')
      ? { status: 200, json: {} }
      : { status: 200, json: { node: { ref: { id: NODE }, size: '10', downloadUrl: null } } });
  try {
    assert.equal((await uploadContent(NODE, file())).status, 'stored');
  } finally {
    mock.restore();
  }
});

// ── the create body for a record that has no URL ───────────────────────────

/**
 * The only MEASURED create of a `ccm:io` without `ccm:wwwurl` (the Child-IO
 * path in `wlo-content-files`, validated 2026-05-08 against production and
 * staging) sends `cm:name`. We were sending neither a URL nor a name, leaving
 * the repository nothing to name the node from — and no test could notice,
 * because a faked upstream accepts whatever we compose.
 *
 * That is the exact shape of the 2026-08-02 defect, where two collection tools
 * were green against `fetchMock` and had never worked. Following the measured
 * body is the cheapest way not to repeat it.
 */
test('a record that carries a file is created with a name', async () => {
  const { createContentNode } = await import('../src/services/write/nodes-lifecycle.js');
  const r = resolveContentSource({ title: 'Brüche kürzen', content: '# x\n' });
  assert.ok(r.ok && r.source.kind === 'file');

  const mock = installFetchMock((url, init) => {
    if (url.includes('/children') && (init?.method ?? 'GET') === 'POST') {
      return { json: { node: { ref: { id: NODE, repo: '-home-' } } } };
    }
    if (url.includes('/content?')) return { json: {} };
    return { json: { node: { ref: { id: NODE }, size: 4, downloadUrl: 'x', properties: {} } } };
  });
  try {
    await createContentNode({ 'cclom:title': ['Brüche kürzen'] }, {
      mode: 'user', file: r.source.file,
    });
    const post = mock.calls.find((c) => c.url.includes('/children') && c.init?.method === 'POST');
    assert.ok(post, 'the create must happen');
    const body = JSON.parse(String(post.init?.body ?? '{}')) as Record<string, string[]>;
    assert.deepEqual(body['cm:name'], ['brueche-kuerzen.md'],
      'the derived file name is what names the node');
    assert.equal(body['ccm:wwwurl'], undefined, 'and no source URL is invented');
  } finally {
    mock.restore();
  }
});

/**
 * The URL path must NOT gain a name: measured, the repository derives both the
 * name and the title from the URL there, and sending one would change the
 * behaviour of the path this change is not about.
 */
test('a record that points at a URL is still created without a name', async () => {
  const { createContentNode } = await import('../src/services/write/nodes-lifecycle.js');
  const mock = installFetchMock((url, init) => {
    if (url.includes('/search/v1/')) return { json: { nodes: [], pagination: { total: 0, from: 0, count: 0 } } };
    if (url.includes('/children') && (init?.method ?? 'GET') === 'POST') {
      return { json: { node: { ref: { id: NODE, repo: '-home-' } } } };
    }
    return { json: { node: { ref: { id: NODE }, properties: {} } } };
  });
  try {
    await createContentNode({ 'ccm:wwwurl': ['https://example.org/a'] }, { mode: 'user' });
    const post = mock.calls.find((c) => c.url.includes('/children') && c.init?.method === 'POST');
    const body = JSON.parse(String(post?.init?.body ?? '{}')) as Record<string, string[]>;
    assert.equal(body['cm:name'], undefined);
    assert.deepEqual(body['ccm:wwwurl'], ['https://example.org/a']);
  } finally {
    mock.restore();
  }
});
