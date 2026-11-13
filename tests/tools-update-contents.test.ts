/**
 * tools-update-contents.test.ts – metadata for many records under ONE approval
 * (plan 2026-11-08, W3; chatbot request 2026-11-07).
 *
 * What this pins: the SERVER decides per field whether a value is written or
 * proposed (user decision 2026-11-08, F5) — descriptive fields are written,
 * everything needing an editorial decision becomes a suggestion; a reference is
 * written as its original (F6); a record that already carries every value is not
 * in the plan; one refused record does not stop the rest; and every entry says
 * what happened with status, code and outcomeOpen.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

import { registerCurationUpdateManyTool } from '../src/tools/curation-update-many.js';
import { DIRECT_PROPERTIES, routeFields } from '../src/services/write/field-routing.js';
import { applyReadOnlyToolDefaults } from '../src/apps/tool-defaults.js';
import { setServiceCredentialForTest, type WloCredential } from '../src/auth/credential.js';
import { setPlanBudgetForTest } from '../src/services/write/plan-runner.js';
import { installFetchMock, toolText } from './fetchMock.js';

const MARIA: WloCredential = { header: 'Basic x', label: 'maria', source: 'user' };
const TOOL = 'wlo_update_contents';

async function client(): Promise<Client> {
  const server = new McpServer({ name: 'test', version: '0.0.0' });
  applyReadOnlyToolDefaults(server);
  registerCurationUpdateManyTool(server, 'Bearer error="invalid_request"');
  const [ct, st] = InMemoryTransport.createLinkedPair();
  const c = new Client({ name: 'test-client', version: '0.0.0' });
  await Promise.all([server.connect(st), c.connect(ct)]);
  return c;
}

/** m1, m2 (ref-2 is a reference to m2), fremd (writes answer 403). Metadata writes are KEPT. */
function repository(opts: { drop?: string[]; suggestStatus?: number; suggestEmptyBody?: boolean; suggestEmptyList?: boolean } = {}) {
  const stored: Record<string, Record<string, string[]>> = {
    m1: { 'cclom:title': ['Licht'] },
    m2: { 'cclom:title': ['Linsen'], 'cclom:general_description': ['Alt'], 'ccm:taxonid': ['http://w3id.org/openeduhub/vocabs/discipline/380'] },
    fremd: { 'cclom:title': ['Fremd'] },
    k1: { 'cclom:title': ['Schlagwortträger'], 'cclom:general_keyword': ['Alt1', 'Alt2'] },
    ...Object.fromEntries(Array.from({ length: 6 }, (_, i) => [`n${i}`, { 'cclom:title': [`N${i}`] }])),
  };
  const writes: Array<{ id: string; props: Record<string, string[]> }> = [];
  const suggestions: Array<{ id: string; body: Array<Record<string, unknown>> }> = [];
  const mock = installFetchMock((url, init) => {
    const method = init?.method ?? 'GET';
    const sug = /\/suggestions\/v1\/-home-\/([^/?]+)/.exec(url);
    if (sug && method === 'POST') {
      const body = JSON.parse(String(init?.body ?? '[]')) as Array<Record<string, unknown>>;
      suggestions.push({ id: sug[1]!, body });
      if (opts.suggestStatus) return { status: opts.suggestStatus, json: {} };
      if (opts.suggestEmptyBody) return { text: '' };
      if (opts.suggestEmptyList) return { json: [] };
      return { json: body.map((b, i) => ({ id: `s-${sug[1]}-${i}`, propertyId: b['propertyId'], value: b['value'], status: 'PENDING' })) };
    }
    const meta = /\/nodes\/-home-\/([^/]+)\/metadata/.exec(url);
    if (meta && method !== 'GET') {
      const id = meta[1]!;
      if (id === 'fremd') return { status: 403, json: { message: 'Forbidden' } };
      const props = JSON.parse(String(init?.body ?? '{}')) as Record<string, string[]>;
      writes.push({ id, props });
      for (const [k, v] of Object.entries(props)) if (!opts.drop?.includes(k)) stored[id]![k] = v;
      return { json: {} };
    }
    if (meta) {
      const id = meta[1]!;
      if (id === 'kaputt') return { status: 503, json: {} };
      if (id === 'gesperrt') return { status: 403, json: {} };
      if (id === 'ref-3') {
        // A reference written directly once (F2): its own title is not the original's.
        return { json: { node: { ref: { id, repo: '-home-' }, type: 'ccm:io', originalId: 'm2', properties: { 'cclom:title': ['Verknüpfungstitel'] } } } };
      }
      if (id === 'ref-2') {
        return { json: { node: { ref: { id, repo: '-home-' }, type: 'ccm:io', originalId: 'm2', properties: { ...stored['m2'] } } } };
      }
      if (!stored[id]) return { status: 404, json: {} };
      return { json: { node: { ref: { id, repo: '-home-' }, type: 'ccm:io', properties: { ...stored[id] } } } };
    }
    return { json: {} };
  });
  return { mock, writes, suggestions, stored };
}

interface Entry { nodeId: string; targetId?: string; status: string; code?: string; outcomeOpen?: boolean; written?: number; suggested?: number }
interface Answer {
  complete?: boolean; progress?: { done: number; total: number }; items?: Entry[];
  continuationToken?: string; confirm?: { token: string; preview: { items?: string[] } };
  unchanged?: boolean; unchangedItems?: Array<{ nodeId: string }>; refused?: Array<{ nodeId: string; code: string }>;
  plan?: Array<{ nodeId: string; targetId?: string; write: Array<{ property: string; before: string[] | null; after: string[] | null }>; suggest: Array<{ propertyId: string; value: string }> }>;
  error?: { code: string };
}
const sc = (r: unknown) => (r as { structuredContent: Answer }).structuredContent;

const ITEMS = [
  { nodeId: 'm1', title: 'Licht und Schatten', licenseKey: 'CC BY', reason: 'aus dem Volltext abgeleitet' },
  { nodeId: 'ref-2', description: 'Sammellinsen und Zerstreuungslinsen' },
];

async function previewAndConfirm(c: Client, items: unknown[] = ITEMS) {
  const preview = await c.callTool({ name: TOOL, arguments: { items } });
  assert.notEqual(preview.isError, true, toolText(preview));
  const token = sc(preview).confirm!.token;
  const done = await c.callTool({ name: TOOL, arguments: { items, confirmToken: token } });
  return { preview, token, done };
}

test('routing: the six descriptive fields are written, everything else is proposed', () => {
  assert.deepEqual([...DIRECT_PROPERTIES].sort(), [
    'cclom:general_description', 'cclom:general_keyword', 'cclom:title',
    'ccm:educationalcontext', 'ccm:oeh_lrt', 'ccm:taxonid',
  ]);
  const r = routeFields({ 'cclom:title': ['T'], 'ccm:commonlicense_key': ['CC_BY'], 'cclom:general_language': ['de'] });
  assert.deepEqual(Object.keys(r.write), ['cclom:title']);
  assert.deepEqual(Object.keys(r.suggest).sort(), ['cclom:general_language', 'ccm:commonlicense_key']);
});

test('the preview splits written from proposed per record, names the original, and sends nothing', async () => {
  setServiceCredentialForTest(MARIA);
  const { mock, writes, suggestions } = repository();
  const c = await client();
  try {
    const r = await c.callTool({ name: TOOL, arguments: { items: ITEMS } });
    const text = toolText(r);
    assert.deepEqual([writes.length, suggestions.length], [0, 0]);
    assert.match(text, /schreibt.*Licht und Schatten/s);
    assert.match(text, /schlägt vor.*Lizenz/s);
    assert.match(text, /aus dem Volltext abgeleitet/, 'the rationale is in what is approved');
    assert.match(text, /m2/, 'the reference is written as its original, and the preview says so');
    assert.equal(sc(r).confirm?.preview.items?.length, 2);
  } finally { await c.close(); mock.restore(); setServiceCredentialForTest(null); }
});

test('one approval writes and proposes for every record; a reference is written as its original', async () => {
  setServiceCredentialForTest(MARIA);
  const { mock, writes, suggestions } = repository();
  const c = await client();
  try {
    const a = sc((await previewAndConfirm(c)).done);
    assert.equal(a.complete, true);
    const m1 = a.items!.find(i => i.nodeId === 'm1')!;
    assert.equal(m1.status, 'stored');
    // A CC licence brings its version along (applyLicenceDefaults) — both are proposals.
    assert.deepEqual([m1.written, m1.suggested], [1, 2]);
    assert.ok(writes.some(w => w.id === 'm1' && w.props['cclom:title']?.[0] === 'Licht und Schatten'));
    assert.ok(!writes.some(w => w.props['ccm:commonlicense_key']), 'a licence is never written directly');
    const proposed = suggestions.filter(s => s.id === 'm1').flatMap(s => s.body.map(b => b['propertyId']));
    assert.deepEqual(proposed.sort(), ['ccm:commonlicense_cc_version', 'ccm:commonlicense_key']);
    assert.ok(suggestions.every(s => s.body.every(b => b['description'] === 'aus dem Volltext abgeleitet')));
    const ref = a.items!.find(i => i.nodeId === 'ref-2')!;
    assert.equal(ref.targetId, 'm2');
    assert.ok(writes.some(w => w.id === 'm2') && !writes.some(w => w.id === 'ref-2'));
  } finally { await c.close(); mock.restore(); setServiceCredentialForTest(null); }
});

test('a record already carrying every value is not in the plan; an unknown one is refused in the preview', async () => {
  setServiceCredentialForTest(MARIA);
  const { mock } = repository();
  const c = await client();
  try {
    const r = await c.callTool({ name: TOOL, arguments: { items: [
      { nodeId: 'm1', title: 'Licht' }, { nodeId: 'weg', title: 'X' }, { nodeId: 'm2', title: 'Neu' }] } });
    assert.deepEqual(sc(r).unchangedItems?.map(u => u.nodeId), ['m1']);
    assert.deepEqual(sc(r).refused?.map(u => [u.nodeId, u.code]), [['weg', 'not_found']]);
    assert.equal(sc(r).confirm?.preview.items?.length, 1);
  } finally { await c.close(); mock.restore(); setServiceCredentialForTest(null); }
});

test('the same record named twice (once as a reference) is refused as duplicate', async () => {
  setServiceCredentialForTest(MARIA);
  const { mock } = repository();
  const c = await client();
  try {
    const r = await c.callTool({ name: TOOL, arguments: { items: [
      { nodeId: 'm2', title: 'Eins' }, { nodeId: 'ref-2', title: 'Zwei' }] } });
    assert.deepEqual(sc(r).refused?.map(u => [u.nodeId, u.code]), [['ref-2', 'duplicate']]);
  } finally { await c.close(); mock.restore(); setServiceCredentialForTest(null); }
});

test('a refused record does not stop the rest; a dropped field is partly with not_stored', async () => {
  setServiceCredentialForTest(MARIA);
  const { mock } = repository({ drop: ['cclom:general_description'] });
  const c = await client();
  try {
    const a = sc((await previewAndConfirm(c, [
      { nodeId: 'fremd', title: 'Meins' },
      { nodeId: 'm2', title: 'Linsen neu', description: 'Neu beschrieben' },
      { nodeId: 'm1', title: 'Licht neu' }])).done);
    const by = (id: string) => a.items!.find(i => i.nodeId === id)!;
    assert.deepEqual([by('fremd').status, by('fremd').code, by('fremd').outcomeOpen], ['not_stored', 'forbidden', false]);
    assert.deepEqual([by('m2').status, by('m2').code, by('m2').outcomeOpen], ['partly', 'not_stored', true]);
    assert.equal(by('m1').status, 'stored');
  } finally { await c.close(); mock.restore(); setServiceCredentialForTest(null); }
});

test('with the budget spent it continues over continuationToken, without a second approval', async (t) => {
  setServiceCredentialForTest(MARIA);
  setPlanBudgetForTest(0);
  t.after(() => setPlanBudgetForTest(null));
  const { mock } = repository();
  const c = await client();
  try {
    const items = Array.from({ length: 6 }, (_, i) => ({ nodeId: `n${i}`, title: `T${i}` }));
    const first = sc((await previewAndConfirm(c, items)).done);
    assert.equal(first.complete, false, 'six records with a pool of four need a second wave');
    let state = first;
    for (let i = 0; i < 5 && !state.complete; i++) {
      assert.ok(state.continuationToken);
      state = sc(await c.callTool({ name: TOOL, arguments: { items, continuationToken: state.continuationToken } }));
    }
    assert.equal(state.complete, true);
    assert.equal(state.progress?.total, items.length);
  } finally { await c.close(); mock.restore(); setServiceCredentialForTest(null); }
});

test('more than 200 records are refused before anything is read', async () => {
  setServiceCredentialForTest(MARIA);
  const { mock } = repository();
  const c = await client();
  try {
    const items = Array.from({ length: 201 }, (_, i) => ({ nodeId: `n${i}`, title: 'x' }));
    const r = await c.callTool({ name: TOOL, arguments: { items } });
    assert.equal(r.isError, true);
    assert.equal((r.structuredContent as { error?: { code?: string } } | undefined)?.error?.code, 'invalid_input');
    assert.equal(mock.calls.length, 0);
  } finally { await c.close(); mock.restore(); setServiceCredentialForTest(null); }
});

// ── review of phase 3 ──────────────────────────────────────────────────────

test('a replaced field shows before → after, and the old value is part of what is approved (review 3)', async () => {
  setServiceCredentialForTest(MARIA);
  const { mock } = repository();
  const c = await client();
  try {
    const r = await c.callTool({ name: TOOL, arguments: { items: [{ nodeId: 'm2', discipline: 'Chemie' }] } });
    assert.match(toolText(r), /Mathematik.*→.*Chemie/s, 'the subject that is lost is named');
    const plan = sc(r).plan!;
    assert.deepEqual(plan[0]!.write[0]!.before, ['http://w3id.org/openeduhub/vocabs/discipline/380']);
  } finally { await c.close(); mock.restore(); setServiceCredentialForTest(null); }
});

test('nothing in the plan: the reply names the refusals, never "already stored" (review 4)', async () => {
  setServiceCredentialForTest(MARIA);
  const { mock } = repository();
  const c = await client();
  try {
    for (const extra of [{}, { confirmToken: 'irgendwas' }]) {
      const r = await c.callTool({ name: TOOL, arguments: { items: [{ nodeId: 'weg', title: 'X' }], ...extra } });
      assert.doesNotMatch(toolText(r), /stehen bereits so/);
      assert.match(toolText(r), /weg/);
      assert.deepEqual(sc(r).refused?.map(x => x.code), ['not_found']);
      assert.equal(sc(r).confirm ?? null, null);
    }
  } finally { await c.close(); mock.restore(); setServiceCredentialForTest(null); }
});

test('an unreadable record is unreadable, not not_found (review 8)', async () => {
  setServiceCredentialForTest(MARIA);
  const { mock } = repository();
  const c = await client();
  try {
    const r = await c.callTool({ name: TOOL, arguments: { items: [{ nodeId: 'kaputt', title: 'X' }, { nodeId: 'm1', title: 'Y' }] } });
    assert.deepEqual(sc(r).refused?.map(x => [x.nodeId, x.code]), [['kaputt', 'unreadable']]);
  } finally { await c.close(); mock.restore(); setServiceCredentialForTest(null); }
});

for (const [label, opts] of [['a 5xx', { suggestStatus: 502 }], ['an empty 200', { suggestEmptyBody: true }]] as const) {
  test(`a proposal answered with ${label} is open — never "nothing written" (review 1)`, async () => {
    setServiceCredentialForTest(MARIA);
    const { mock } = repository(opts);
    const c = await client();
    try {
      const a = sc((await previewAndConfirm(c, [{ nodeId: 'm1', licenseKey: 'CC BY' }])).done);
      assert.equal(a.items![0]!.outcomeOpen, true, JSON.stringify(a.items));
    } finally { await c.close(); mock.restore(); setServiceCredentialForTest(null); }
  });
}

test('a refused write beside landed proposals keeps its code (review 7)', async () => {
  setServiceCredentialForTest(MARIA);
  const { mock } = repository();
  const c = await client();
  try {
    const a = sc((await previewAndConfirm(c, [{ nodeId: 'fremd', title: 'Meins', licenseKey: 'CC BY' }])).done);
    assert.deepEqual([a.items![0]!.status, a.items![0]!.code], ['partly', 'forbidden']);
    assert.equal(a.items![0]!.suggested, 2);
  } finally { await c.close(); mock.restore(); setServiceCredentialForTest(null); }
});

test('validation notes reach the preview, named per record (review 6)', async () => {
  setServiceCredentialForTest(MARIA);
  const { mock } = repository();
  const c = await client();
  try {
    // „Anleitung“ has no aggregated content type — validateField notes that.
    const r = await c.callTool({ name: TOOL, arguments: { items: [{ nodeId: 'm1', contentType: 'Anleitung' }] } });
    assert.match(toolText(r), /Eintrag 1 \(m1\).*Hinweis zum Inhaltstyp/s);
  } finally { await c.close(); mock.restore(); setServiceCredentialForTest(null); }
});

test('two confirmations with the same key at once run ONE plan; the second is not sent to a new preview (review W2, finding 2)', async () => {
  setServiceCredentialForTest(MARIA);
  const { mock, writes } = repository();
  const c = await client();
  try {
    const items = [{ nodeId: 'n0', title: 'Neu 0' }, { nodeId: 'n1', title: 'Neu 1' }];
    const token = sc(await c.callTool({ name: TOOL, arguments: { items } })).confirm!.token;
    const [x, y] = await Promise.all([
      c.callTool({ name: TOOL, arguments: { items, confirmToken: token } }),
      c.callTool({ name: TOOL, arguments: { items, confirmToken: token } }),
    ]);
    for (const r of [x, y]) assert.equal(sc(r).error?.code, undefined, JSON.stringify(sc(r).error));
    assert.equal(writes.length, 2, 'each record written once');
  } finally { await c.close(); mock.restore(); setServiceCredentialForTest(null); }
});

// ── overall review W1–W4 ───────────────────────────────────────────────────

test('a record the login may not read is forbidden, the code W1/W2 give (overall review, 6)', async () => {
  setServiceCredentialForTest(MARIA);
  const { mock } = repository();
  const c = await client();
  try {
    const r = sc(await c.callTool({ name: TOOL, arguments: { items: [{ nodeId: 'm1', title: 'X' }, { nodeId: 'gesperrt', title: 'Y' }] } }));
    assert.deepEqual(r.refused!.map(x => [x.nodeId, x.code]), [['gesperrt', 'forbidden']]);
  } finally { await c.close(); mock.restore(); setServiceCredentialForTest(null); }
});

test('keywords: the preview names the WHOLE list that is sent, so a change in between is confirm_mismatch (overall review, 7)', async () => {
  setServiceCredentialForTest(MARIA);
  const { mock, stored, writes } = repository();
  const c = await client();
  try {
    const items = [{ nodeId: 'k1', keywords: ['Neu'] }];
    const preview = await c.callTool({ name: TOOL, arguments: { items } });
    const line = sc(preview).confirm!.preview.items!.join('\n');
    for (const kw of ['Alt1', 'Alt2', 'Neu']) assert.match(line, new RegExp(kw), `the list sent carries ${kw}`);
    // Someone removes Alt2 before the confirmation: sending the old merge would bring it back.
    stored['k1']!['cclom:general_keyword'] = ['Alt1'];
    const r = await c.callTool({ name: TOOL, arguments: { items, confirmToken: sc(preview).confirm!.token } });
    assert.equal(sc(r).error?.code, 'confirm_mismatch');
    assert.equal(writes.length, 0);
  } finally { await c.close(); mock.restore(); setServiceCredentialForTest(null); }
});

test('an empty list from the suggestion endpoint is no proof — unverified, not suggested (overall review, 8)', async () => {
  setServiceCredentialForTest(MARIA);
  const { mock } = repository({ suggestEmptyList: true });
  const c = await client();
  try {
    const a = sc((await previewAndConfirm(c, [{ nodeId: 'm1', licenseKey: 'CC BY', reason: 'r' }])).done);
    const m1 = a.items!.find(i => i.nodeId === 'm1')!;
    assert.deepEqual([m1.status, m1.outcomeOpen, m1.suggested], ['unverified', true, 0]);
  } finally { await c.close(); mock.restore(); setServiceCredentialForTest(null); }
});

test('a field changed by someone else while the plan waits is not overwritten (overall review, 13)', async (t) => {
  setServiceCredentialForTest(MARIA);
  setPlanBudgetForTest(0);
  t.after(() => setPlanBudgetForTest(null));
  const { mock, stored, writes } = repository();
  const c = await client();
  try {
    const items = Array.from({ length: 6 }, (_, i) => ({ nodeId: `n${i}`, title: `Geplant ${i}` }));
    const preview = await c.callTool({ name: TOOL, arguments: { items } });
    let st = sc(await c.callTool({ name: TOOL, arguments: { items, confirmToken: sc(preview).confirm!.token } }));
    assert.equal(st.complete, false);
    stored['n5']!['cclom:title'] = ['Von Hand geändert'];
    for (let i = 0; i < 4 && !st.complete; i++) {
      st = sc(await c.callTool({ name: TOOL, arguments: { items, continuationToken: st.continuationToken } }));
    }
    const n5 = st.items!.find(x => x.nodeId === 'n5')!;
    assert.deepEqual([n5.status, n5.code, n5.outcomeOpen], ['failed', 'changed_since_preview', false]);
    assert.ok(!writes.some(w => w.id === 'n5'));
    assert.deepEqual(stored['n5']!['cclom:title'], ['Von Hand geändert']);
  } finally { await c.close(); mock.restore(); setServiceCredentialForTest(null); }
});

test('the preview names a reference by its ORIGINAL — the record that is written (overall review, 19)', async () => {
  setServiceCredentialForTest(MARIA);
  const { mock } = repository();
  const c = await client();
  try {
    const r = sc(await c.callTool({ name: TOOL, arguments: { items: [{ nodeId: 'ref-3', description: 'Neu' }] } }));
    const line = r.confirm!.preview.items!.join('\n');
    assert.match(line, /„Linsen“/);
    assert.doesNotMatch(line, /Verknüpfungstitel/);
  } finally { await c.close(); mock.restore(); setServiceCredentialForTest(null); }
});

test('a continuation whose items carry their keys in another order still finds its plan (audit A-4)', async (t) => {
  setServiceCredentialForTest(MARIA);
  setPlanBudgetForTest(0);
  t.after(() => setPlanBudgetForTest(null));
  const { mock } = repository();
  const c = await client();
  try {
    const items = Array.from({ length: 6 }, (_, i) => ({ nodeId: `n${i}`, title: `T${i}` }));
    const first = sc((await previewAndConfirm(c, items)).done);
    assert.equal(first.complete, false);
    // The same items as a client would rebuild them: other key order.
    const rebuilt = items.map(i => ({ title: i.title, nodeId: i.nodeId }));
    const next = await c.callTool({ name: TOOL, arguments: { items: rebuilt, continuationToken: first.continuationToken } });
    // (Holds with or without `canonicalArgs`: the input schema already orders declared keys.
    // Pinned because a client rebuilding its items is the ordinary case, not for the helper.)
    assert.notEqual((next as { isError?: boolean }).isError, true, 'plan_mismatch for the same items');
    assert.equal(sc(next).progress?.total, items.length);
  } finally { await c.close(); mock.restore(); setServiceCredentialForTest(null); }
});
