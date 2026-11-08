/**
 * tools-attach-fulltext.test.ts – a full text in the record's own textContent
 * (plan 2026-11-08, W1; user decision: the file hangs on the node, the full text
 * goes into textContent).
 *
 * What this pins: the preview refuses — before any key — everything that must
 * not or cannot be written: a record WITH a file (`would_replace_file`, the
 * safeguard until a live run shows POST textContent keeps the file), a linked
 * record (`link_record`: the repository reads a link's text from the page,
 * measured 2026-07-31), a text over the bound, an existing text without
 * `replace`, and the same text again. What is written goes as the raw text with
 * `mimetype=text/plain` and is read back; a mismatch is `not_stored`.
 *
 * Offline only: staging answers every content write with 500 since 2026-11-06.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

import { registerCurationFulltextTools } from '../src/tools/curation-fulltext.js';
import { FULLTEXT_MAX_BYTES, planFulltext, setKeepsBinaryForTest, writeFulltext } from '../src/services/write/fulltext.js';
import { applyReadOnlyToolDefaults } from '../src/apps/tool-defaults.js';
import { setServiceCredentialForTest, type WloCredential } from '../src/auth/credential.js';
import { installFetchMock, toolText } from './fetchMock.js';

const MARIA: WloCredential = { header: 'Basic x', label: 'maria', source: 'user' };
const TOOL = 'wlo_attach_fulltext';
const MD = '# Optik\n\nLicht breitet sich geradlinig aus. Äöü „Zitat“.\n';

async function client(): Promise<Client> {
  const server = new McpServer({ name: 'test', version: '0.0.0' });
  applyReadOnlyToolDefaults(server);
  registerCurationFulltextTools(server, 'Bearer error="invalid_request"');
  const [ct, st] = InMemoryTransport.createLinkedPair();
  const c = new Client({ name: 'test-client', version: '0.0.0' });
  await Promise.all([server.connect(st), c.connect(ct)]);
  return c;
}

interface Rec { size?: number; wwwurl?: string; text?: string; originalId?: string; hash?: string; mimetype?: string }

/** Records: plain (no file, no link), withFile, link, hasText, ref (→ plain). POST textContent stores what it gets. */
function repository(opts: {
  store?: (body: string) => string; writeStatus?: number; replacesFile?: boolean; replacesSameType?: boolean;
  originalStatus?: number; status?: Record<string, number>;
  /** With writeStatus: the repository kept the text although it answered an error. */
  storeDespiteStatus?: boolean;
  /** GET textContent answers this after a POST went out (the read-back). */
  readBackStatus?: number;
  /** These reads fail on the network (the fetch rejects): 'meta:<id>' or 'text:<id>'. */
  throwOn?: Set<string>;
  /** GET textContent answers `{text: null}` — a body that names no text at all. */
  nullText?: boolean;
} = {}) {
  const recs: Record<string, Rec> = {
    plain: {}, withFile: { size: 4096, hash: 'h-pdf', mimetype: 'application/pdf' }, link: { wwwurl: 'https://example.org/a' },
    // A text written before has CONTENT: the repository sets the size to the bytes sent (measured 2026-07-31).
    hasText: { text: 'Alter Volltext', size: 14, mimetype: 'text/plain' },
    ref: { originalId: 'plain' }, refFile: { originalId: 'withFile' },
  };
  const posts: Array<{ id: string; url: string; body: string; type: string }> = [];
  const mock = installFetchMock((url, init) => {
    const method = init?.method ?? 'GET';
    const tc = /\/nodes\/-home-\/([^/]+)\/textContent/.exec(url);
    if (tc && method === 'POST') {
      const body = String(init?.body ?? '');
      const type = new Headers((init?.headers ?? {}) as HeadersInit).get('content-type') ?? '';
      posts.push({ id: tc[1]!, url, body, type });
      if (opts.writeStatus) {
        if (opts.storeDespiteStatus) recs[tc[1]!]!.text = body;
        return { status: opts.writeStatus, json: { message: 'InvalidTypeException' } };
      }
      recs[tc[1]!]!.text = opts.store ? opts.store(body) : body;
      if (opts.replacesFile) { recs[tc[1]!]!.hash = 'h-text'; recs[tc[1]!]!.mimetype = 'text/plain'; }
      if (opts.replacesSameType) recs[tc[1]!]!.hash = 'h-other';
      return { json: {} };
    }
    if (tc && opts.throwOn?.has(`text:${tc[1]}`)) throw new Error('socket hang up');
    if (tc && posts.length && opts.readBackStatus) return { status: opts.readBackStatus, json: {} };
    // A record without text answers an EMPTY text; `nullText` a body that names none.
    if (tc) return { json: { text: opts.nullText ? null : recs[tc[1]!]?.text ?? '' } };
    const meta = /\/nodes\/-home-\/([^/]+)\/metadata/.exec(url);
    if (meta) {
      if (opts.throwOn?.has(`meta:${meta[1]}`)) throw new Error('socket hang up');
      const st = opts.status?.[meta[1]!];
      if (st) return { status: st, json: {} };
      const r = recs[meta[1]!];
      if (!r) return { status: 404, json: {} };
      return { json: { node: {
        ref: { id: meta[1], repo: '-home-' }, type: 'ccm:io', ...(r.originalId ? { originalId: r.originalId } : {}),
        ...(r.size ? { size: String(r.size) } : {}), ...(r.mimetype ? { mimetype: r.mimetype } : {}),
        ...(r.hash ? { content: { hash: r.hash } } : {}),
        properties: { 'cclom:title': [`Titel ${meta[1]}`], ...(r.wwwurl ? { 'ccm:wwwurl': [r.wwwurl] } : {}) },
      } } };
    }
    return { json: {} };
  });
  return { mock, posts, recs };
}

const sc = (r: unknown) => (r as { structuredContent?: Record<string, any> }).structuredContent ?? {};

async function previewThenConfirm(c: Client, args: Record<string, unknown>) {
  const preview = await c.callTool({ name: TOOL, arguments: args });
  assert.notEqual(preview.isError, true, toolText(preview));
  return c.callTool({ name: TOOL, arguments: { ...args, confirmToken: sc(preview)['confirm'].token } });
}

test('the preview names target, size and checksum — and sends nothing', async () => {
  setServiceCredentialForTest(MARIA);
  const { mock, posts } = repository();
  const c = await client();
  try {
    const r = await c.callTool({ name: TOOL, arguments: { nodeId: 'plain', markdown: MD, source: 'manual' } });
    const sha = createHash('sha256').update(MD, 'utf8').digest('hex');
    assert.match(toolText(r), /Titel plain/);
    assert.match(toolText(r), new RegExp(sha.slice(0, 16)));
    assert.equal(posts.length, 0);
    assert.ok(sc(r)['confirm']?.token);
  } finally { await c.close(); mock.restore(); setServiceCredentialForTest(null); }
});

for (const [nodeId, code] of [['withFile', 'would_replace_file'], ['link', 'link_record'], ['weg', 'not_found']] as const) {
  test(`${nodeId}: refused in the preview as ${code}, before any key, outcomeOpen false`, async () => {
    setServiceCredentialForTest(MARIA);
    const { mock, posts } = repository();
    const c = await client();
    try {
      const r = await c.callTool({ name: TOOL, arguments: { nodeId, markdown: MD, source: 'binary' } });
      assert.equal(r.isError, true);
      assert.equal(sc(r)['error']?.code, code);
      assert.equal(sc(r)['error']?.outcomeOpen, false);
      assert.equal(sc(r)['confirm'], undefined);
      assert.equal(posts.length, 0);
    } finally { await c.close(); mock.restore(); setServiceCredentialForTest(null); }
  });
}

test('an existing text needs replace; the same text again is nothing_to_change', async () => {
  setServiceCredentialForTest(MARIA);
  const { mock } = repository();
  const c = await client();
  try {
    const exists = await c.callTool({ name: TOOL, arguments: { nodeId: 'hasText', markdown: MD, source: 'manual' } });
    assert.equal(sc(exists)['error']?.code, 'exists');
    // Under the safeguard, replace: true only leads to would_replace_file — do not send the caller there (overall review, 5).
    assert.doesNotMatch(toolText(exists), /replace: true/);
    const same = await c.callTool({ name: TOOL, arguments: { nodeId: 'hasText', markdown: 'Alter Volltext\r\n', source: 'manual', replace: true } });
    // "Already there" is no error — the shape every sibling uses (overall review, 4c).
    assert.notEqual(same.isError, true, 'line endings and a trailing break do not make a new text');
    assert.deepEqual([sc(same)['confirm'], sc(same)['unchanged'], sc(same)['code']], [null, true, 'nothing_to_change']);
    // Replacing a text that is the record's CONTENT is refused like a file, until measured (review W1, finding 3).
    const replace = await c.callTool({ name: TOOL, arguments: { nodeId: 'hasText', markdown: MD, source: 'manual', replace: true } });
    assert.equal(sc(replace)['error']?.code, 'would_replace_file');
    assert.match(toolText(replace), /Inhalt/);
  } finally { await c.close(); mock.restore(); setServiceCredentialForTest(null); }
});

test('a text over the byte bound is too_large — counted in UTF-8 bytes, not characters', async () => {
  setServiceCredentialForTest(MARIA);
  const { mock } = repository();
  const c = await client();
  try {
    const big = 'ä'.repeat(Math.floor(FULLTEXT_MAX_BYTES / 2) + 1); // under the bound in characters, over it in bytes
    const r = await c.callTool({ name: TOOL, arguments: { nodeId: 'plain', markdown: big, source: 'manual' } });
    assert.equal(sc(r)['error']?.code, 'too_large');
  } finally { await c.close(); mock.restore(); setServiceCredentialForTest(null); }
});

test('the confirmed write sends the RAW text as text/plain and reads it back → stored', async () => {
  setServiceCredentialForTest(MARIA);
  const { mock, posts } = repository();
  const c = await client();
  try {
    const done = await previewThenConfirm(c, { nodeId: 'plain', markdown: MD, source: 'website', sourceUrl: 'https://example.org/q', language: 'de' });
    assert.notEqual(done.isError, true, toolText(done));
    assert.equal(sc(done)['status'], 'stored');
    assert.equal(posts.length, 1);
    assert.equal(posts[0]!.body, MD, 'raw, not JSON-encoded: a JSON string body is stored WITH its quotes (measured 2026-07-31)');
    assert.match(posts[0]!.url, /mimetype=text%2Fplain/);
    assert.match(posts[0]!.type, /application\/json/);
  } finally { await c.close(); mock.restore(); setServiceCredentialForTest(null); }
});

test('a reference is written on its original', async () => {
  setServiceCredentialForTest(MARIA);
  const { mock, posts } = repository();
  const c = await client();
  try {
    const done = await previewThenConfirm(c, { nodeId: 'ref', markdown: MD, source: 'manual' });
    assert.equal(sc(done)['status'], 'stored');
    assert.deepEqual(posts.map(p => p.id), ['plain']);
  } finally { await c.close(); mock.restore(); setServiceCredentialForTest(null); }
});

test('a read-back that differs is not_stored with outcomeOpen true — something WAS sent and kept', async () => {
  setServiceCredentialForTest(MARIA);
  const { mock } = repository({ store: () => 'Etwas anderes' });
  const c = await client();
  try {
    const done = await previewThenConfirm(c, { nodeId: 'plain', markdown: MD, source: 'manual' });
    assert.equal(done.isError, true);
    assert.equal(sc(done)['error']?.code, 'not_stored');
    assert.equal(sc(done)['error']?.outcomeOpen, true);
  } finally { await c.close(); mock.restore(); setServiceCredentialForTest(null); }
});

for (const [status, code, open, extra] of [
  [403, 'forbidden', false, {}],
  // After the repository's own 500 the READ-BACK decides (overall review, 20): nothing came back → nothing landed.
  [500, 'upstream_error', false, {}],
  [502, 'upstream_error', true, { readBackStatus: 503 }],
  // A proxy's 502/504 may answer while the repository still writes: never proof (review 3, finding 1).
  [502, 'upstream_error', true, {}],
  [504, 'upstream_error', true, {}],
  // A read-back that names no text is no "empty" — it is no answer (review 3, finding 1).
  [500, 'upstream_error', true, { nullText: true }],
] as const) {
  test(`a write answered ${status} is ${code} with outcomeOpen ${open} (${JSON.stringify(extra)})`, async () => {
    setServiceCredentialForTest(MARIA);
    const { mock } = repository({ writeStatus: status, ...extra });
    const c = await client();
    try {
      const done = await previewThenConfirm(c, { nodeId: 'plain', markdown: MD, source: 'manual' });
      assert.equal(done.isError, true);
      assert.equal(sc(done)['error']?.code, code);
      assert.equal(sc(done)['error']?.outcomeOpen, open);
    } finally { await c.close(); mock.restore(); setServiceCredentialForTest(null); }
  });
}

// ── review of W1 ───────────────────────────────────────────────────────────

test('a reference whose original cannot be read is refused — the safeguard never sees size 0 by accident (finding 2)', async () => {
  setServiceCredentialForTest(MARIA);
  // refFile → withFile; the original's read answers 503.
  const { mock, posts } = repository();
  const inner = globalThis.fetch;
  globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
    if (String(input).includes('/withFile/metadata')) return new Response('{}', { status: 503 });
    return inner(input as string, init);
  }) as typeof fetch;
  const c = await client();
  try {
    const r = await c.callTool({ name: TOOL, arguments: { nodeId: 'refFile', markdown: MD, source: 'binary' } });
    assert.equal(r.isError, true);
    assert.equal(sc(r)['error']?.code, 'unreadable_original');
    assert.equal(posts.length, 0);
  } finally { globalThis.fetch = inner; await c.close(); mock.restore(); setServiceCredentialForTest(null); }
});

test('a 403 on the record is forbidden, not not_found (finding 8)', async () => {
  setServiceCredentialForTest(MARIA);
  const { mock } = repository({ status: { geheim: 403 } });
  const c = await client();
  try {
    const r = await c.callTool({ name: TOOL, arguments: { nodeId: 'geheim', markdown: MD, source: 'manual' } });
    assert.equal(sc(r)['error']?.code, 'forbidden');
  } finally { await c.close(); mock.restore(); setServiceCredentialForTest(null); }
});

test('whitespace alone is no full text (finding 9)', async () => {
  setServiceCredentialForTest(MARIA);
  const { mock, posts } = repository();
  const c = await client();
  try {
    const r = await c.callTool({ name: TOOL, arguments: { nodeId: 'plain', markdown: '   \n\t ', source: 'manual' } });
    assert.equal(sc(r)['error']?.code, 'invalid_input');
    assert.equal(posts.length, 0);
  } finally { await c.close(); mock.restore(); setServiceCredentialForTest(null); }
});

test('with the safeguard lifted, a write that replaced the file is file_replaced — hash and type compared (finding 5)', async (t) => {
  setServiceCredentialForTest(MARIA);
  setKeepsBinaryForTest(true);
  t.after(() => setKeepsBinaryForTest(null));
  // Same type, other bytes is exactly the case the hash is for: a type check alone would call it kept.
  for (const [opts, expected] of [[{ replacesFile: true }, 'file_replaced'], [{ replacesSameType: true }, 'file_replaced'],
    [{}, 'stored']] as const) {
    const { mock } = repository(opts);
    const c = await client();
    try {
      const done = await previewThenConfirm(c, { nodeId: 'withFile', markdown: MD, source: 'binary' });
      const got = sc(done)['status'] === 'stored' ? 'stored' : sc(done)['error']?.code;
      assert.equal(got, expected, JSON.stringify(sc(done)));
      // The same shape W2 reports: status failed, code file_replaced (overall review, 4a).
      if (expected !== 'stored') assert.equal(sc(done)['error']?.status, 'failed');
    } finally { await c.close(); mock.restore(); }
  }
  setServiceCredentialForTest(null);
});

test('the comparison trims both ends and a BOM — the repository may keep neither (finding 11)', async () => {
  setServiceCredentialForTest(MARIA);
  const { mock } = repository({ store: (b) => `\uFEFF\n${b.trim()}` });
  const c = await client();
  try {
    const done = await previewThenConfirm(c, { nodeId: 'plain', markdown: `\n${MD}`, source: 'manual' });
    assert.equal(sc(done)['status'], 'stored', JSON.stringify(sc(done)));
  } finally { await c.close(); mock.restore(); setServiceCredentialForTest(null); }
});

// ── overall review W1–W4 ───────────────────────────────────────────────────

test('a 5xx whose text DID land is stored — the read-back says so (overall review, 20)', async () => {
  setServiceCredentialForTest(MARIA);
  const { mock } = repository({ writeStatus: 500, storeDespiteStatus: true });
  const c = await client();
  try {
    const done = await previewThenConfirm(c, { nodeId: 'plain', markdown: MD, source: 'manual' });
    assert.equal(sc(done)['status'], 'stored', JSON.stringify(sc(done)));
  } finally { await c.close(); mock.restore(); setServiceCredentialForTest(null); }
});

test('a record with a file is refused without asking the repository to extract its text (overall review, 12)', async () => {
  setServiceCredentialForTest(MARIA);
  const { mock } = repository();
  const c = await client();
  try {
    const r = await c.callTool({ name: TOOL, arguments: { nodeId: 'withFile', markdown: MD, source: 'binary' } });
    assert.equal(sc(r)['error']?.code, 'would_replace_file');
    assert.equal(mock.calls.filter(x => x.url.includes('/textContent')).length, 0,
      'a PDF text extraction takes seconds and decides nothing under the safeguard');
  } finally { await c.close(); mock.restore(); setServiceCredentialForTest(null); }
});

for (const [where, code] of [['meta:plain', 'unreadable'], ['text:plain', 'text_unreadable']] as const) {
  test(`a read that fails on the network (${where}) is ${code}, the same code W2 gives (overall review, 4b)`, async () => {
    setServiceCredentialForTest(MARIA);
    const { mock, posts } = repository({ throwOn: new Set([where]) });
    const c = await client();
    try {
      const r = await c.callTool({ name: TOOL, arguments: { nodeId: 'plain', markdown: MD, source: 'manual' } });
      assert.equal(sc(r)['error']?.code, code, JSON.stringify(sc(r)));
      assert.equal(sc(r)['error']?.outcomeOpen, false);
      assert.equal(posts.length, 0);
    } finally { await c.close(); mock.restore(); setServiceCredentialForTest(null); }
  });
}

// ── review 3 (after the overall review) ────────────────────────────────────

test('right before the write: content that changed is changed_since_preview, an unreadable record unreadable — nothing sent (finding 4)', async (t) => {
  setServiceCredentialForTest(MARIA);
  setKeepsBinaryForTest(true);
  t.after(() => { setKeepsBinaryForTest(null); setServiceCredentialForTest(null); });
  const status: Record<string, number> = {};
  const { mock, posts, recs } = repository({ status });
  try {
    // A file replaced between approval and write (only reachable with the safeguard lifted).
    const planned = await planFulltext({ nodeId: 'withFile', markdown: MD, source: 'binary', replace: true });
    assert.ok(planned.ok, JSON.stringify(planned));
    recs['withFile']!.hash = 'h-new-upload';
    const changed = await writeFulltext(planned.plan, MD);
    assert.deepEqual([changed.status, 'code' in changed && changed.code, 'outcomeOpen' in changed && changed.outcomeOpen],
      ['failed', 'changed_since_preview', false]);
    // A record that cannot be read right before the write.
    const plain = await planFulltext({ nodeId: 'plain', markdown: MD, source: 'manual' });
    assert.ok(plain.ok);
    status['plain'] = 503;
    const unreadable = await writeFulltext(plain.plan, MD);
    assert.deepEqual([unreadable.status, 'code' in unreadable && unreadable.code, 'outcomeOpen' in unreadable && unreadable.outcomeOpen],
      ['failed', 'unreadable', false]);
    assert.equal(posts.length, 0, 'nothing was sent in either case');
  } finally { mock.restore(); }
});

test('a record WITHOUT content is not refused for a hash or type it acquires — there is nothing to protect (finding 2)', async (t) => {
  setServiceCredentialForTest(MARIA);
  t.after(() => setServiceCredentialForTest(null));
  const { mock, posts, recs } = repository();
  try {
    const planned = await planFulltext({ nodeId: 'plain', markdown: MD, source: 'manual' });
    assert.ok(planned.ok);
    // A metadata edit may move a derived hash/type on a node that still has no content.
    recs['plain']!.hash = 'h-derived';
    recs['plain']!.mimetype = 'application/octet-stream';
    const out = await writeFulltext(planned.plan, MD);
    assert.equal(out.status, 'stored', JSON.stringify(out));
    assert.equal(posts.length, 1);
  } finally { mock.restore(); }
});

test('a text written here before is recognised with a charset in its type — the repeat is unchanged (finding 6)', async () => {
  setServiceCredentialForTest(MARIA);
  const { mock, recs } = repository();
  recs['hasText']!.mimetype = 'text/plain;charset=UTF-8';
  const c = await client();
  try {
    const same = await c.callTool({ name: TOOL, arguments: { nodeId: 'hasText', markdown: 'Alter Volltext', source: 'manual' } });
    assert.equal(sc(same)['unchanged'], true, JSON.stringify(sc(same)));
  } finally { await c.close(); mock.restore(); setServiceCredentialForTest(null); }
});
