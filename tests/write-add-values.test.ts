/**
 * write-add-values.test.ts – ADDING to subject, educational level and target
 * group (B1, user decision 2026-11-13).
 *
 * `discipline`, `educationalContext` and `userRole` REPLACE what the record
 * holds; `addDiscipline`, `addEducationalContext` and `addUserRole` add to it.
 * Pinned here: what is sent is the whole resulting list, merged into the node
 * that is WRITTEN (the original behind a reference); the preview — the sentence
 * the confirmation key binds to — shows which of the two was asked for; and a
 * key given for the one does not confirm the other.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

import { registerCurationContentTools } from '../src/tools/curation-content.js';
import { registerCurationUpdateManyTool } from '../src/tools/curation-update-many.js';
import { prepareUpdates, updateStep } from '../src/services/write/update-many.js';
import { applyReadOnlyToolDefaults } from '../src/apps/tool-defaults.js';
import { setServiceCredentialForTest, type WloCredential } from '../src/auth/credential.js';
import { resolveVocab } from '../src/vocabs.js';
import { installFetchMock, toolText } from './fetchMock.js';

const MARIA: WloCredential = { header: 'Basic x', label: 'maria', source: 'user' };
const CHALLENGE = 'Bearer error="invalid_request"';
const TAXON = 'ccm:taxonid';
const ROLE = 'ccm:educationalintendedenduserrole';

const uri = (label: string, vocab: 'discipline' | 'educationalContext' | 'userRole' = 'discipline') => {
  const found = resolveVocab(label, vocab);
  assert.ok(found, `Vokabular kennt „${label}“ nicht`);
  return found;
};
const PHYSIK = uri('Physik');
const CHEMIE = uri('Chemie');
const MATHE = uri('Mathematik');
const BIO = uri('Biologie');

async function client(): Promise<Client> {
  const server = new McpServer({ name: 'test', version: '0.0.0' });
  applyReadOnlyToolDefaults(server);
  registerCurationContentTools(server, CHALLENGE);
  registerCurationUpdateManyTool(server, CHALLENGE);
  const [ct, st] = InMemoryTransport.createLinkedPair();
  const c = new Client({ name: 'test-client', version: '0.0.0' });
  await Promise.all([server.connect(st), c.connect(ct)]);
  return c;
}

/** rec holds Physik + Chemie; ref is a reference to it whose OWN value differs (written directly once). */
function repository() {
  const nodes: Record<string, Record<string, string[]>> = {
    rec: { 'cclom:title': ['Linsen'], [TAXON]: [PHYSIK, CHEMIE] },
    ref: { 'cclom:title': ['Linsen'], [TAXON]: [BIO] },
    other: { 'cclom:title': ['Säuren'], [TAXON]: [CHEMIE] },
    coll: { 'cm:title': ['Optik'], [TAXON]: [PHYSIK] },
  };
  const writes: Array<{ id: string; props: Record<string, string[]> }> = [];
  const mock = installFetchMock((url, init) => {
    const method = init?.method ?? 'GET';
    const node = /\/nodes\/-home-\/([^/?]+)\/metadata/.exec(url);
    const id = node?.[1] ?? '';
    const stored = nodes[id];
    if (!stored) return { status: 404, json: {} };
    if (method !== 'GET') {
      const props = JSON.parse(String(init?.body ?? '{}')) as Record<string, string[]>;
      writes.push({ id, props });
      Object.assign(stored, props);
      return { json: {} };
    }
    const kind = id === 'coll' ? { type: 'ccm:map', aspects: ['ccm:collection'] } : { type: 'ccm:io', aspects: [] };
    return { json: { node: { ref: { id, repo: '-home-' }, ...kind,
      ...(id === 'ref' ? { originalId: 'rec' } : {}), properties: stored } } };
  });
  return { mock, nodes, writes };
}

type Structured = Record<string, unknown>;
const sc = (r: unknown) => (r as { structuredContent?: Structured }).structuredContent ?? {};
const token = (r: unknown) => String((sc(r)['confirm'] as { token?: string } | undefined)?.token ?? '');
const error = (r: unknown) => sc(r)['error'] as { code?: string; candidates?: Array<{ field: string; value: string }> } | undefined;
const line = (r: unknown, label: string) => toolText(r).split('\n').find(l => l.startsWith(`${label}:`));

async function run(fn: (c: Client, repo: ReturnType<typeof repository>) => Promise<void>) {
  const repo = repository();
  setServiceCredentialForTest(MARIA);
  const c = await client();
  try { await fn(c, repo); } finally { await c.close(); setServiceCredentialForTest(null); repo.mock.restore(); }
}

async function confirmed(c: Client, name: string, args: Record<string, unknown>) {
  const preview = await c.callTool({ name, arguments: args });
  const key = token(preview);
  assert.ok(key, `Vorschau ohne Schlüssel: ${toolText(preview)}`);
  return { preview, result: await c.callTool({ name, arguments: { ...args, confirmToken: key } }) };
}

test('addDiscipline: the preview shows what the field holds AND the addition; the whole list is stored — existing first', () => run(async (c, repo) => {
  const { preview, result } = await confirmed(c, 'wlo_update_content', { nodeId: 'rec', addDiscipline: 'Mathematik' });
  assert.equal(line(preview, 'Fach'), 'Fach: „Physik, Chemie“ + „Mathematik“', toolText(preview));
  assert.ok(!(result as { isError?: boolean }).isError, toolText(result));
  assert.deepEqual(repo.writes, [{ id: 'rec', props: { [TAXON]: [PHYSIK, CHEMIE, MATHE] } }]);
}));

test('addDiscipline with a list: only what is new is added, in the order given', () => run(async (c, repo) => {
  const { preview } = await confirmed(c, 'wlo_update_content', { nodeId: 'rec', addDiscipline: ['Biologie', 'Chemie', 'Mathematik'] });
  assert.equal(line(preview, 'Fach'), 'Fach: „Physik, Chemie“ + „Biologie, Mathematik“');
  assert.deepEqual(repo.writes[0]!.props[TAXON], [PHYSIK, CHEMIE, BIO, MATHE]);
}));

test('adding a value the record already holds is no change', () => run(async (c, repo) => {
  const r = await c.callTool({ name: 'wlo_update_content', arguments: { nodeId: 'rec', addDiscipline: ['Chemie', 'Physik'] } });
  assert.equal(token(r), '');
  assert.equal(sc(r)['unchanged'], true);
  assert.match(toolText(r), /Keine Änderung/);
  assert.equal(repo.writes.length, 0);
}));

test('discipline still REPLACES — and the preview says so', () => run(async (c, repo) => {
  const { preview } = await confirmed(c, 'wlo_update_content', { nodeId: 'rec', discipline: 'Mathematik' });
  assert.equal(line(preview, 'Fach'), 'Fach: „Physik, Chemie“ → „Mathematik“');
  assert.deepEqual(repo.writes[0]!.props[TAXON], [MATHE]);
}));

test('the other two fields add the same way — to records that already hold a value there', () => run(async (c, repo) => {
  const GRUND = uri('Grundschule', 'educationalContext');
  const LERNENDE = uri('Lernende', 'userRole');
  repo.nodes['rec']!['ccm:educationalcontext'] = [GRUND];
  repo.nodes['rec']![ROLE] = [LERNENDE];
  const { preview } = await confirmed(c, 'wlo_update_content',
    { nodeId: 'rec', addEducationalContext: 'Sekundarstufe I', addUserRole: ['Lehrer'] });
  assert.equal(line(preview, 'Bildungsstufe'), 'Bildungsstufe: „Primarstufe“ + „Sekundarstufe I“');
  assert.equal(line(preview, 'Zielgruppe'), 'Zielgruppe: „Lerner/in“ + „Lehrer/in“');
  // A replace would have sent the new value alone.
  assert.deepEqual(repo.writes[0]!.props['ccm:educationalcontext'], [GRUND, uri('Sekundarstufe I', 'educationalContext')]);
  assert.deepEqual(repo.writes[0]!.props[ROLE], [LERNENDE, uri('Lehrer', 'userRole')]);
}));

test('an add to an EMPTY field says so', () => run(async (c, repo) => {
  const { preview } = await confirmed(c, 'wlo_update_content', { nodeId: 'rec', addEducationalContext: 'Sekundarstufe I' });
  assert.equal(line(preview, 'Bildungsstufe'), 'Bildungsstufe: (leer) + „Sekundarstufe I“');
  assert.deepEqual(repo.writes[0]!.props['ccm:educationalcontext'], [uri('Sekundarstufe I', 'educationalContext')]);
}));

test('keywords keep their own add line', () => run(async (c, repo) => {
  repo.nodes['rec']!['cclom:general_keyword'] = ['Licht'];
  const preview = await c.callTool({ name: 'wlo_update_content', arguments: { nodeId: 'rec', keywords: ['Linsen'] } });
  assert.equal(line(preview, 'Schlagwörter'), 'Schlagwörter: + Linsen', toolText(preview));
}));

test('the field changes between preview and confirm: confirm_mismatch, nothing is written', () => run(async (c, repo) => {
  const args = { nodeId: 'rec', addDiscipline: 'Mathematik' };
  const preview = await c.callTool({ name: 'wlo_update_content', arguments: args });
  assert.ok(token(preview), toolText(preview));
  repo.nodes['rec']![TAXON] = [PHYSIK];
  const r = await c.callTool({ name: 'wlo_update_content', arguments: { ...args, confirmToken: token(preview) } });
  assert.equal(error(r)?.code, 'confirm_mismatch', toolText(r));
  assert.equal(repo.writes.length, 0);
}));

test('a legacy value outside the vocabulary survives an add untouched — shown as it is, not refused', () => run(async (c, repo) => {
  const LEGACY = 'http://legacy.example/alt/fach';
  repo.nodes['rec']![TAXON] = [PHYSIK, LEGACY];
  const { preview, result } = await confirmed(c, 'wlo_update_content', { nodeId: 'rec', addDiscipline: 'Mathematik' });
  assert.equal(line(preview, 'Fach'), `Fach: „Physik, ${LEGACY}“ + „Mathematik“`, toolText(preview));
  assert.ok(!(result as { isError?: boolean }).isError, toolText(result));
  assert.deepEqual(repo.writes, [{ id: 'rec', props: { [TAXON]: [PHYSIK, LEGACY, MATHE] } }]);
}));

test('an add on a COLLECTION merges into that node\'s values', () => run(async (c, repo) => {
  const { preview, result } = await confirmed(c, 'wlo_update_content', { nodeId: 'coll', addDiscipline: 'Mathematik' });
  assert.match(toolText(preview), /^Sammlung: „Optik“ \(coll\)$/m, toolText(preview));
  assert.equal(line(preview, 'Fach'), 'Fach: „Physik“ + „Mathematik“');
  assert.ok(!(result as { isError?: boolean }).isError, toolText(result));
  assert.deepEqual(repo.writes, [{ id: 'coll', props: { [TAXON]: [PHYSIK, MATHE] } }]);
}));

test('discipline and addDiscipline together are refused — nothing is guessed, nothing read', () => run(async (c, repo) => {
  const r = await c.callTool({ name: 'wlo_update_content', arguments: { nodeId: 'rec', discipline: 'Physik', addDiscipline: 'Mathematik' } });
  assert.equal((r as { isError?: boolean }).isError, true);
  assert.equal(error(r)?.code, 'invalid_input');
  assert.match(toolText(r), /„discipline“.*„addDiscipline“/s);
  assert.equal(token(r), '');
  assert.equal(repo.mock.calls.length, 0);
}));

test('a guessed value in an add is refused with candidates under the ADD parameter', () => run(async (c, repo) => {
  const r = await c.callTool({ name: 'wlo_update_content', arguments: { nodeId: 'rec', addDiscipline: 'Wirtschaft' } });
  assert.equal(error(r)?.code, 'invalid_input');
  const candidates = error(r)?.candidates ?? [];
  assert.deepEqual(candidates.map(k => [k.field, k.value]), [['addDiscipline', 'Wirtschaft']], JSON.stringify(sc(r)));
  assert.equal(repo.writes.length, 0);
}));

test('through a reference the values are added to the ORIGINAL\'s list, not the reference\'s', () => run(async (c, repo) => {
  const { preview, result } = await confirmed(c, 'wlo_update_content', { nodeId: 'ref', addDiscipline: ['Biologie', 'Mathematik'] });
  // Biologie is on the reference only — for the original it IS new.
  assert.equal(line(preview, 'Fach'), 'Fach: „Physik, Chemie“ + „Biologie, Mathematik“', toolText(preview));
  assert.ok(!(result as { isError?: boolean }).isError, toolText(result));
  assert.deepEqual(repo.writes, [{ id: 'rec', props: { [TAXON]: [PHYSIK, CHEMIE, BIO, MATHE] } }]);
}));

test('a key given for an ADD does not confirm a REPLACE that ends in the same list', () => run(async (c, repo) => {
  const preview = await c.callTool({ name: 'wlo_update_content', arguments: { nodeId: 'rec', addDiscipline: 'Mathematik' } });
  const r = await c.callTool({ name: 'wlo_update_content',
    arguments: { nodeId: 'rec', discipline: ['Physik', 'Chemie', 'Mathematik'], confirmToken: token(preview) } });
  assert.equal(error(r)?.code, 'confirm_mismatch', toolText(r));
  assert.equal(repo.writes.length, 0);
}));

test('the structured preview tells an add from a replace', () => run(async (c) => {
  const fields = (r: unknown) => (sc(r)['confirm'] as { preview: { fields: Array<Record<string, unknown>> } }).preview.fields;
  const add = fields(await c.callTool({ name: 'wlo_update_content', arguments: { nodeId: 'rec', addDiscipline: 'Mathematik', keywords: ['Licht'] } }));
  const subject = add.find(f => f['name'] === TAXON)!;
  assert.deepEqual(subject['old'], [PHYSIK, CHEMIE]);
  assert.deepEqual(subject['new'], [PHYSIK, CHEMIE, MATHE]);
  assert.deepEqual(subject['added'], [MATHE]);
  assert.deepEqual(subject['addedLabels'], ['Mathematik']);
  // Keywords were always merged: the same shape.
  assert.deepEqual(add.find(f => f['name'] === 'cclom:general_keyword')!['added'], ['Licht']);
  const replace = fields(await c.callTool({ name: 'wlo_update_content', arguments: { nodeId: 'rec', discipline: 'Mathematik' } }));
  assert.ok(!('added' in replace[0]!));
}));

test('wlo_create_content does not know the add parameters', () => run(async (c, repo) => {
  const tools = (await c.listTools()).tools;
  const props = (name: string) => Object.keys((tools.find(t => t.name === name)!.inputSchema as { properties: object }).properties);
  for (const p of ['addDiscipline', 'addEducationalContext', 'addUserRole']) {
    assert.ok(props('wlo_update_content').includes(p), p);
    assert.ok(!props('wlo_create_content').includes(p), p);
  }
  const itemProps = (tools.find(t => t.name === 'wlo_update_contents')!.inputSchema as unknown as
    { properties: { items: { items: { properties: object } } } }).properties.items.items.properties;
  assert.ok('addDiscipline' in itemProps);
  // Sent anyway, it is not a field of the new record.
  const r = await c.callTool({ name: 'wlo_create_content',
    arguments: { title: 'Neu', content: '# Text', addDiscipline: 'Mathematik' } });
  // The call itself went through as a preview — only then does "no Fach" say anything.
  assert.ok(!(r as { isError?: boolean }).isError, toolText(r));
  assert.ok(token(r), toolText(r));
  assert.doesNotMatch(toolText(r), /Fach/);
  assert.equal(repo.writes.length, 0);
}));

// ── wlo_update_contents ─────────────────────────────────────────────────────

test('wlo_update_contents: add per item — one record gains a subject, the other has its replaced', () => run(async (c, repo) => {
  const items = [{ nodeId: 'rec', addDiscipline: 'Mathematik' }, { nodeId: 'other', discipline: 'Mathematik' }];
  const { preview, result } = await confirmed(c, 'wlo_update_contents', { items });
  const text = toolText(preview);
  assert.match(text, /Fach „Physik“, „Chemie“, „Mathematik“ \(neu: „Mathematik“\)/, text);
  assert.match(text, /Fach „Chemie“ → „Mathematik“/, text);
  const plan = sc(preview)['plan'] as Array<{ nodeId: string; write: Array<Record<string, unknown>> }>;
  assert.deepEqual(plan.find(p => p.nodeId === 'rec')!.write[0]!['added'], [MATHE]);
  assert.ok(!('added' in plan.find(p => p.nodeId === 'other')!.write[0]!));
  assert.ok(!(result as { isError?: boolean }).isError, toolText(result));
  assert.deepEqual(repo.writes.find(w => w.id === 'rec')!.props, { [TAXON]: [PHYSIK, CHEMIE, MATHE] });
  assert.deepEqual(repo.writes.find(w => w.id === 'other')!.props, { [TAXON]: [MATHE] });
}));

test('wlo_update_contents: both parameters in one item are refused, naming the item', () => run(async (c, repo) => {
  const r = await c.callTool({ name: 'wlo_update_contents',
    arguments: { items: [{ nodeId: 'rec', discipline: 'Physik', addDiscipline: 'Mathematik' }] } });
  assert.equal(error(r)?.code, 'invalid_input');
  assert.match(toolText(r), /Eintrag 1.*„discipline“.*„addDiscipline“/s);
  assert.equal(repo.mock.calls.length, 0);
}));

test('wlo_update_contents: addUserRole follows its field — proposed, not written', () => run(async (c, repo) => {
  const preview = await c.callTool({ name: 'wlo_update_contents', arguments: { items: [{ nodeId: 'rec', addUserRole: 'Lehrer' }] } });
  assert.match(toolText(preview), /schlägt vor Zielgruppe/, toolText(preview));
  assert.equal(repo.writes.length, 0);
}));

test('wlo_update_contents: addUserRole on a record that holds one of two roles proposes only the new one', () => run(async (c, repo) => {
  const LERNENDE = uri('Lernende', 'userRole');
  const LEHRER = uri('Lehrer', 'userRole');
  repo.nodes['rec']![ROLE] = [LERNENDE];
  const preview = await c.callTool({ name: 'wlo_update_contents',
    arguments: { items: [{ nodeId: 'rec', addUserRole: ['Lernende', 'Lehrer'] }] } });
  assert.ok(token(preview), toolText(preview));
  const text = toolText(preview);
  assert.match(text, /schlägt vor Zielgruppe „Lehrer\/in“ \(/, text);
  assert.doesNotMatch(text, /schreibt/, text);
  const plan = sc(preview)['plan'] as Array<{ write: unknown[]; suggest: Array<{ propertyId: string; value: string }> }>;
  assert.deepEqual(plan[0]!.write, []);
  assert.deepEqual(plan[0]!.suggest, [{ propertyId: ROLE, value: LEHRER }]);
  assert.equal(repo.writes.length, 0);
}));

test('an add whose field changed after the approval is changed_since_preview — never merged into a list nobody saw', async () => {
  const repo = repository();
  setServiceCredentialForTest(MARIA);
  try {
    const prepared = await prepareUpdates([{ nodeId: 'rec', desired: { [TAXON]: [MATHE] }, added: [TAXON] }]);
    const item = prepared.items[0]!;
    assert.deepEqual(item.write.changes[0]!.after, [PHYSIK, CHEMIE, MATHE]);
    repo.nodes['rec']![TAXON] = [PHYSIK];
    const state = await updateStep(item, undefined);
    assert.deepEqual([state.status, state.code, state.outcomeOpen], ['failed', 'changed_since_preview', false]);
    assert.equal(repo.writes.length, 0);
  } finally { setServiceCredentialForTest(null); repo.mock.restore(); }
});
