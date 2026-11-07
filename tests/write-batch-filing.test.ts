/**
 * write-batch-filing.test.ts – MA-4: filing a batch into the person's personal area.
 *
 *  - Layout from ONE `validateSession`: with `TOOLPERMISSION_CREATE_ELEMENTS_FOLDERS` the batch gets
 *    its own folder (`folder`), otherwise the files go flat into the home (`flat`); unreadable → flat.
 *  - The folder is created once (`cm:folder`, `renameIfExists`); a 403 is `denied` — the caller
 *    continues flat and says so once, never falls back to a service account.
 *  - Each file becomes a `ccm:io` in that parent: `cm:name` from the title + the DETECTED extension,
 *    the bytes uploaded and read back (`stored` / `dropped` / `unverified` / `failed`).
 *  - A checksum that does not match the approved entry files nothing.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { installFetchMock } from './fetchMock.js';
import { createBatchFolder, fileBatchEntry, folderLayout } from '../src/services/write/batch-filing.js';

const ENTRY = { index: 0, title: 'Mechanik Übung', sha256: 'a'.repeat(64), size: 5, ext: 'pdf',
  fileName: 'mechanik-uebung.pdf' };
const SLOT = { data: Buffer.from('%PDF-'), sha256: 'a'.repeat(64), type: { mimeType: 'application/pdf', ext: 'pdf' } };

test('the layout follows the folder permission, unreadable means flat', async () => {
  for (const [antwort, erwartet] of [
    [{ status: 200, json: { toolPermissions: ['TOOLPERMISSION_CREATE_ELEMENTS_FOLDERS', 'X'] } }, 'folder'],
    [{ status: 200, json: { toolPermissions: ['X'] } }, 'flat'],
    [{ status: 500, json: {} }, 'flat'],
  ] as const) {
    const mock = installFetchMock(() => antwort);
    try {
      assert.equal(await folderLayout(), erwartet);
      assert.equal(mock.calls.length, 1);
      assert.match(mock.calls[0]!.url, /\/authentication\/v1\/validateSession/);
    } finally {
      mock.restore();
    }
  }
});

test('the folder is created in the home; a 403 is denied', async () => {
  let mock = installFetchMock(() => ({ status: 200, json: { node: { ref: { id: 'ordner-1' } } } }));
  try {
    assert.deepEqual(await createBatchFolder('Physik 7'), { status: 'created', nodeId: 'ordner-1' });
    const call = mock.calls[0]!;
    assert.match(call.url, /\/nodes\/-home-\/-userhome-\/children\?/);
    assert.match(call.url, /type=cm%3Afolder/);
    assert.match(call.url, /renameIfExists=true/);
    assert.deepEqual(JSON.parse(String(call.init?.body)), { 'cm:name': ['Physik 7'] });
  } finally {
    mock.restore();
  }
  mock = installFetchMock(() => ({ status: 403, json: { error: 'denied' } }));
  try {
    assert.equal((await createBatchFolder('Physik 7')).status, 'denied');
  } finally {
    mock.restore();
  }
});

test('a file becomes a ccm:io in the parent and is read back', async () => {
  const mock = installFetchMock((url) => {
    if (url.includes('/children?')) return { status: 200, json: { node: { ref: { id: 'n-1' } } } };
    if (url.includes('/content?')) return { status: 200, json: {} };
    return { status: 200, json: { node: { ref: { id: 'n-1' }, size: 5, downloadUrl: 'x' } } };
  });
  try {
    const r = await fileBatchEntry('ordner-1', ENTRY, SLOT);
    assert.equal(r.status, 'stored');
    assert.equal(r.nodeId, 'n-1');
    const create = mock.calls.find((c) => c.url.includes('/children?'))!;
    assert.match(create.url, /\/nodes\/-home-\/ordner-1\/children\?/);
    assert.match(create.url, /type=ccm%3Aio/);
    const body = JSON.parse(String(create.init?.body)) as Record<string, string[]>;
    assert.deepEqual(body['cm:name'], ['mechanik-uebung.pdf']);
  } finally {
    mock.restore();
  }
});

test('a checksum that does not match files nothing', async () => {
  const mock = installFetchMock(() => ({ status: 200, json: {} }));
  try {
    const r = await fileBatchEntry('ordner-1', ENTRY, { ...SLOT, sha256: 'b'.repeat(64) });
    assert.equal(r.status, 'failed');
    assert.equal(mock.calls.length, 0);
  } finally {
    mock.restore();
  }
});

test('a refused create is failed, with no node', async () => {
  const mock = installFetchMock(() => ({ status: 403, json: { error: 'nein' } }));
  try {
    const r = await fileBatchEntry('-userhome-', ENTRY, SLOT);
    assert.equal(r.status, 'failed');
    assert.equal(r.nodeId, undefined);
  } finally {
    mock.restore();
  }
});


// ── Review MA-3/MA-4 ───────────────────────────────────────────────────────────────────────

test('a title the repository drops is unverified, not stored (finding 2)', async () => {
  const mock = installFetchMock((url, init) => {
    if (url.includes('/children?')) return { status: 200, json: { node: { ref: { id: 'n-1' } } } };
    if (url.includes('/content?')) return { status: 200, json: {} };
    if (url.includes('/metadata') && (init?.method === 'PUT' || init?.method === 'POST')) {
      return { status: 500, json: { error: 'nein' } };
    }
    return { status: 200, json: { node: { ref: { id: 'n-1' }, size: 5, downloadUrl: 'x' } } };
  });
  try {
    const r = await fileBatchEntry('ordner-1', ENTRY, SLOT);
    assert.equal(r.status, 'unverified');
    assert.equal(r.nodeId, 'n-1');
  } finally {
    mock.restore();
  }
});

test('an error after the node exists keeps its id (finding 5)', async () => {
  const mock = installFetchMock((url) => {
    if (url.includes('/children?')) return { status: 200, json: { node: { ref: { id: 'n-7' } } } };
    if (url.includes('/content?')) throw new Error('timeout');
    return { status: 200, json: {} };
  });
  try {
    const r = await fileBatchEntry('ordner-1', ENTRY, SLOT);
    assert.equal(r.status, 'unverified');
    assert.equal(r.nodeId, 'n-7');
  } finally {
    mock.restore();
  }
});

test('the upload deadline grows with the size', async () => {
  const { uploadTimeoutMs } = await import('../src/services/write/batch-filing.js');
  assert.equal(uploadTimeoutMs(1), 22_000);
  assert.equal(uploadTimeoutMs(50 * 1024 * 1024), 120_000);
  assert.equal(uploadTimeoutMs(10 ** 12), 300_000);
});
