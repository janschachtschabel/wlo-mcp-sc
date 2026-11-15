/**
 * upload-replacement-verified.test.ts – a file REPLACEMENT is proven, and its
 * outcome is part of the coded result (audit 2026-11-14, W1).
 *
 * The read-back after an upload asked only "does the record have a size". On
 * a replacement that was true BEFORE the upload, so a dropped one read as
 * stored. It now compares with what was sent — the byte count (measured: the
 * record's size is the uploaded byte count, tests/live/reference-write) and,
 * where the record held content before, with that earlier state.
 *
 * And the tool: an upload that failed, was dropped or could not be checked was
 * a line of text in front of an answer that was otherwise a success (and was
 * replayed as one); a file-only call ended "Es gab nichts zu ändern"; an
 * upload that landed beside refused fields read `outcomeOpen: false`.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

import { registerCurationContentTools } from '../src/tools/curation-content.js';
import { applyReadOnlyToolDefaults } from '../src/apps/tool-defaults.js';
import { setServiceCredentialForTest, type WloCredential } from '../src/auth/credential.js';
import { uploadContent } from '../src/services/write/content-upload.js';
import { resolveContentSource } from '../src/services/write/content-source.js';
import { installFetchMock, toolText, type MockResult } from './fetchMock.js';

const MARIA: WloCredential = { header: 'Basic x', label: 'maria', source: 'user' };
const NODE = 'rec-1';
const NEW_TEXT = '# Neue Fassung\n\nMit Umlauten: äöü.\n';
const NEW_BYTES = Buffer.byteLength(NEW_TEXT);

function file(text = NEW_TEXT) {
  const r = resolveContentSource({ title: 'Übung', content: text });
  assert.ok(r.ok && r.source.kind === 'file');
  return r.source.file;
}

// ── the service: what the read-back compares ────────────────────────────────

const after = (size: number | null, hash?: string): MockResult =>
  ({ json: { node: { ref: { id: NODE, repo: '-home-' }, size, ...(hash ? { content: { hash } } : {}) } } });

async function upload(readBack: MockResult, before?: { size: number | null; hash: string }) {
  const mock = installFetchMock((url) => (url.includes('/content?') ? { json: {} } : readBack));
  try {
    return await uploadContent(NODE, file(), undefined, before);
  } finally {
    mock.restore();
  }
}

test('stored: the record shows exactly the bytes that were sent', async () => {
  assert.deepEqual(await upload(after(NEW_BYTES, 'h2'), { size: 500, hash: 'h1' }), { status: 'stored', size: NEW_BYTES });
});

test('a replacement after which the record still shows the OLD file is dropped — it has a size, and it is not ours', async () => {
  const outcome = await upload(after(500, 'h1'), { size: 500, hash: 'h1' });
  assert.deepEqual(outcome, { status: 'dropped', holds: 500 });
});

test('the old file without any hash on the record: the size alone says it was not replaced', async () => {
  assert.equal((await upload(after(500), { size: 500, hash: '' })).status, 'dropped');
});

test('a size that is neither what was sent nor what was there is not called stored', async () => {
  const outcome = await upload(after(777, 'h3'), { size: 500, hash: 'h1' });
  assert.equal(outcome.status, 'unverified');
  assert.match(outcome.status === 'unverified' ? outcome.detail : '', new RegExp(`777.*${NEW_BYTES}`));
});

test('a first upload whose record shows another size is not called stored either', async () => {
  assert.equal((await upload(after(3))).status, 'unverified');
});

test('same size as before AND the same content hash: whether the replacement landed cannot be told', async () => {
  assert.equal((await upload(after(NEW_BYTES, 'h1'), { size: NEW_BYTES, hash: 'h1' })).status, 'unverified');
});

test('same size as before with a NEW content hash is stored', async () => {
  assert.equal((await upload(after(NEW_BYTES, 'h2'), { size: NEW_BYTES, hash: 'h1' })).status, 'stored');
});

// Review 2026-11-14, finding 3: same length and no hash that could show a change is no proof.
for (const [name, nowHash, beforeHash] of [
  ['no hash before and none after', undefined, ''],
  ['a hash before, none after', undefined, 'h1'],
  ['none before, one after', 'h2', ''],
] as const) {
  test(`same size as before, ${name}: unverified — the size cannot tell the new file from the old`, async () => {
    assert.equal((await upload(after(NEW_BYTES, nowHash), { size: NEW_BYTES, hash: beforeHash })).status, 'unverified');
  });
}

test('a FIRST upload (the record held nothing) needs no hash: the size is the proof', async () => {
  assert.equal((await upload(after(NEW_BYTES), { size: null, hash: '' })).status, 'stored');
  assert.equal((await upload(after(NEW_BYTES))).status, 'stored');
});

test('a refused upload hands its status on', async () => {
  const mock = installFetchMock(() => ({ status: 403, json: {} }));
  try {
    const outcome = await uploadContent(NODE, file());
    assert.deepEqual([outcome.status, outcome.status === 'failed' && outcome.httpStatus], ['failed', 403]);
  } finally {
    mock.restore();
  }
});

// ── the tool: the upload is part of the coded result ────────────────────────

interface Scene {
  /** What the content POST answers. */
  uploadStatus?: number;
  /** Does an accepted upload replace the file? */
  lands?: boolean;
  /** Does the metadata write store what it is given? */
  fieldsLand?: boolean;
  /** Status of the metadata write. */
  metadataStatus?: number;
}

async function scene(s: Scene = {}) {
  setServiceCredentialForTest(MARIA);
  const { uploadStatus = 200, lands = true, fieldsLand = true, metadataStatus = 200 } = s;
  const props: Record<string, string[]> = { 'cclom:title': ['Alte Fassung'] };
  let content = { size: 500, hash: 'old' };
  const mock = installFetchMock((url, init): MockResult => {
    const method = init?.method ?? 'GET';
    if (url.includes('/content?')) {
      if (uploadStatus !== 200) return { status: uploadStatus, json: {} };
      if (lands) content = { size: NEW_BYTES, hash: 'new' };
      return { json: {} };
    }
    if (url.includes('/metadata') && method !== 'GET') {
      if (metadataStatus !== 200) return { status: metadataStatus, json: {} };
      if (fieldsLand) Object.assign(props, JSON.parse(String(init?.body ?? '{}')));
      return { json: {} };
    }
    return { json: { node: { ref: { id: NODE, repo: '-home-' }, type: 'ccm:io', aspects: [], properties: props,
      size: content.size, content: { hash: content.hash } } } };
  });
  const server = new McpServer({ name: 'test', version: '0.0.0' });
  applyReadOnlyToolDefaults(server);
  registerCurationContentTools(server, 'Bearer error="invalid_request"');
  const [ct, st] = InMemoryTransport.createLinkedPair();
  const c = new Client({ name: 'test-client', version: '0.0.0' });
  await Promise.all([server.connect(st), c.connect(ct)]);
  const update = async (args: Record<string, unknown>) => {
    const preview = await c.callTool({ name: 'wlo_update_content', arguments: { nodeId: NODE, ...args } });
    const token = (preview.structuredContent as { confirm?: { token: string } }).confirm?.token;
    assert.ok(token, toolText(preview));
    const confirmed = { nodeId: NODE, ...args, confirmToken: token };
    return { done: await c.callTool({ name: 'wlo_update_content', arguments: confirmed }),
      again: () => c.callTool({ name: 'wlo_update_content', arguments: confirmed }) };
  };
  const end = async () => { await c.close(); mock.restore(); setServiceCredentialForTest(null); };
  return { update, end };
}

const errorOf = (r: unknown) => (r as { structuredContent?: { error?: Record<string, unknown> } }).structuredContent?.error;
const allText = (r: unknown) => (r as { content: Array<{ text: string }> }).content.map(c => c.text).join('\n');

test('file only, replaced: a success that says so — and never "Es gab nichts zu ändern"', async () => {
  const s = await scene();
  try {
    const { done } = await s.update({ content: NEW_TEXT });
    assert.notEqual(done.isError, true, allText(done));
    assert.match(allText(done), /hochgeladen/);
    assert.doesNotMatch(allText(done), /nichts zu ändern/);
  } finally { await s.end(); }
});

test('file only, the record still shows the old file: not_stored, nothing was written — and the replay says the same', async () => {
  const s = await scene({ lands: false });
  try {
    const { done, again } = await s.update({ content: NEW_TEXT });
    assert.equal(done.isError, true, allText(done));
    assert.deepEqual([errorOf(done)?.['code'], errorOf(done)?.['outcomeOpen'], errorOf(done)?.['upload']], ['not_stored', false, 'dropped']);
    assert.match(allText(done), /NICHT ersetzt/);
    assert.doesNotMatch(allText(done), /KEINEN Inhalt/, 'the record still carries its old file');
    const replay = await again();
    assert.equal(replay.isError, true, 'a lost replacement is not replayed as a success');
    assert.equal(errorOf(replay)?.['code'], 'not_stored');
  } finally { await s.end(); }
});

test('metadata stored, the upload refused (403): an error with the refusal\'s code — and open, because the fields landed', async () => {
  const s = await scene({ uploadStatus: 403 });
  try {
    const { done } = await s.update({ content: NEW_TEXT, title: 'Neuer Titel' });
    assert.equal(done.isError, true, allText(done));
    assert.deepEqual([errorOf(done)?.['code'], errorOf(done)?.['outcomeOpen'], errorOf(done)?.['upload']], ['forbidden', true, 'failed']);
    assert.match(allText(done), /Gespeichert:/, 'what DID land is still said');
  } finally { await s.end(); }
});

test('file only, the upload refused (403): nothing was written', async () => {
  const s = await scene({ uploadStatus: 403 });
  try {
    const { done } = await s.update({ content: NEW_TEXT });
    assert.deepEqual([errorOf(done)?.['code'], errorOf(done)?.['outcomeOpen']], ['forbidden', false]);
  } finally { await s.end(); }
});

test('file only, the upload answered 502: open — a proxy may answer while the upload lands', async () => {
  const s = await scene({ uploadStatus: 502 });
  try {
    const { done } = await s.update({ content: NEW_TEXT });
    assert.deepEqual([errorOf(done)?.['code'], errorOf(done)?.['outcomeOpen']], ['upstream_error', true]);
  } finally { await s.end(); }
});

test('the upload landed and every field was refused: NOT "nothing written"', async () => {
  const s = await scene({ metadataStatus: 403 });
  try {
    const { done } = await s.update({ content: NEW_TEXT, title: 'Neuer Titel' });
    assert.equal(done.isError, true);
    assert.deepEqual([errorOf(done)?.['code'], errorOf(done)?.['outcomeOpen'], errorOf(done)?.['upload']], ['not_stored', true, 'stored']);
    assert.match(allText(done), /hochgeladen/);
    assert.doesNotMatch(allText(done), /Es wurde nichts geschrieben/);
  } finally { await s.end(); }
});

test('both landed: a success with both parts', async () => {
  const s = await scene();
  try {
    const { done } = await s.update({ content: NEW_TEXT, title: 'Neuer Titel' });
    assert.notEqual(done.isError, true, allText(done));
    assert.match(allText(done), /hochgeladen/);
    assert.match(allText(done), /Gespeichert:/);
  } finally { await s.end(); }
});
