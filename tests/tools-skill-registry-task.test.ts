/**
 * tools-skill-registry-task.test.ts – `get_skill_registry` with `task` (BOERDi
 * wishlist item 10, decision E2, 2026-11-06).
 *
 * Not "which skills exist" but "which of the skills APPROVED for this collection
 * fits this task" — and, the team's condition, the answer carries that skill's
 * INSTRUCTION (else it stays two calls) and says plainly "none fits" when none
 * does. Only approved skills are candidates: the ranking runs over the
 * registry's own entries, never over a repository-wide search.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

import { registerSkillTools } from '../src/tools/skills.js';
import { registerSkillRegistryTool } from '../src/tools/skill-registry.js';
import { REGISTRY_CONTENT_TYPE_URI } from '../src/services/skill-catalogue.js';
import { applyReadOnlyToolDefaults } from '../src/apps/tool-defaults.js';
import { installFetchMock, makeNode, toolText, type MockResult } from './fetchMock.js';

const uuid = (n: number) => `${String(n).padStart(8, '0')}-0000-4000-8000-000000000000`;
const FRAGEN = uuid(1);
const VERSUCH = uuid(2);
const SKILL_TYPE = 'http://w3id.org/openeduhub/vocabs/contentTypes/ai_skill';

async function registryClient(): Promise<Client> {
  const server = new McpServer({ name: 'test', version: '0.0.0' });
  applyReadOnlyToolDefaults(server);
  registerSkillTools(server, { collectionId: '', mode: 'two-tool' });
  registerSkillRegistryTool(server);
  const [ct, st] = InMemoryTransport.createLinkedPair();
  const c = new Client({ name: 'test-client', version: '0.0.0' });
  await Promise.all([server.connect(st), c.connect(ct)]);
  return c;
}

const REGISTRY = [
  '# Skillkatalog Optik', '', 'Diese Skills gelten nur für Klasse 7.', '',
  `::: ki-skill\n[Fragen generieren](https://repo.example/edu-sharing/components/render/${FRAGEN})\n:::`, '',
  `::: ki-skill\n[Versuch planen](https://repo.example/edu-sharing/components/render/${VERSUCH})\n:::`,
].join('\n');

const SKILLS: Record<string, { title: string; description: string; keywords: string[]; text: string }> = {
  [FRAGEN]: { title: 'Fragen generieren', description: 'Erzeugt Verständnisfragen zu einem Material.',
    keywords: ['Aufgaben', 'Diagnose'], text: '# Fragen generieren\n\nANLEITUNG-FRAGEN: Lies das Material …' },
  [VERSUCH]: { title: 'Versuch planen', description: 'Plant ein Schülerexperiment mit Materialliste.',
    keywords: ['Experiment', 'Schülerversuch'], text: '# Versuch planen\n\nANLEITUNG-VERSUCH: Lege Ziel und Aufbau fest …' },
};

function repository(opts: { unreadable?: string } = {}) {
  return installFetchMock((url): MockResult => {
    if (url.includes('/children')) {
      return { json: { nodes: [{
        ...makeNode('reg-1', 'Skillkatalog Optik', { 'cm:name': ['SKILL_REGISTRY.md'], 'ccm:oeh_extendedType': [REGISTRY_CONTENT_TYPE_URI] }),
        mimetype: 'text/x-web-markdown', mediatype: 'file-markdown',
      }], pagination: { total: 1, from: 0, count: 1 } } };
    }
    const id = Object.keys(SKILLS).find(k => url.includes(k));
    if (url.includes('/eduservlet/download') || url.includes('/textContent') || url.includes('/content')) {
      if (id) return id === opts.unreadable ? { status: 403, json: {} } : { text: SKILLS[id]!.text };
      return { text: REGISTRY };
    }
    if (id && url.includes('/metadata')) {
      if (id === opts.unreadable) return { status: 403, json: {} };
      const s = SKILLS[id]!;
      return { json: { node: { ...makeNode(id, s.title, {
        'cclom:general_description': [s.description], 'cclom:general_keyword': s.keywords,
        'ccm:oeh_extendedType': [SKILL_TYPE],
      }), mimetype: 'text/x-web-markdown' } } };
    }
    return { json: { nodes: [], pagination: { total: 0, from: 0, count: 0 } } };
  });
}

async function ask(args: Record<string, unknown>, opts: { unreadable?: string } = {}) {
  const mock = repository(opts);
  const c = await registryClient();
  try {
    return await c.callTool({ name: 'get_skill_registry', arguments: { collectionId: 'coll-optik', ...args } });
  } finally { await c.close(); mock.restore(); }
}

test('with task, the answer carries the INSTRUCTION of the approved skill that fits', async () => {
  const r = await ask({ task: 'ein Experiment zur Brechung planen' });
  const text = toolText(r);
  assert.notEqual(r.isError, true, text);
  assert.match(text, /ANLEITUNG-VERSUCH/, 'the instruction itself, not just its name');
  assert.doesNotMatch(text, /ANLEITUNG-FRAGEN/, 'one instruction, the one that fits');
  assert.match(text, new RegExp(VERSUCH));
});

test('with task in JSON, the choice is a named field with the skill document', async () => {
  const r = await ask({ task: 'Experiment planen', outputFormat: 'json' });
  const payload = JSON.parse(toolText(r)) as { task: { match: string; chosen?: { nodeId: string }; skill?: { content?: string } } };
  assert.equal(payload.task.match, 'found');
  assert.equal(payload.task.chosen?.nodeId, VERSUCH);
  assert.match(payload.task.skill?.content ?? '', /ANLEITUNG-VERSUCH/);
});

test('when no approved skill fits, the answer says so plainly — and loads nothing', async () => {
  const r = await ask({ task: 'Gedichtinterpretation Goethe' });
  const text = toolText(r);
  assert.match(text, /Keiner der 2 freigegebenen Skills passt/);
  assert.doesNotMatch(text, /ANLEITUNG-/);
  const json = JSON.parse(toolText(await ask({ task: 'Gedichtinterpretation Goethe', outputFormat: 'json' }))) as { task: { match: string; skill?: unknown } };
  assert.equal(json.task.match, 'none');
  assert.equal(json.task.skill, undefined);
});

test('a fitting skill that cannot be read is named as such, never replaced by a non-fitting one', async () => {
  const r = await ask({ task: 'Experiment planen' }, { unreadable: VERSUCH });
  const text = toolText(r);
  assert.match(text, /nicht abrufbar/);
  assert.doesNotMatch(text, /ANLEITUNG-FRAGEN/, 'the skill that does not fit is not loaded in its place');
});

test('without task the answer is unchanged — the catalogue, no instruction', async () => {
  const text = toolText(await ask({}));
  assert.doesNotMatch(text, /ANLEITUNG-/);
  assert.match(text, /Versuch planen/);
});

test('an unreadable fitting skill is never offered as loadable, whatever the match', async () => {
  // Both fit "Experiment planen"; VERSUCH cannot be read.
  SKILLS[FRAGEN]!.keywords.push('planen', 'Experiment');
  try {
    const r = await ask({ task: 'Experiment planen', outputFormat: 'json' }, { unreadable: VERSUCH });
    const t = (JSON.parse(toolText(r)) as { task: { match: string; chosen?: { nodeId: string }; candidates: Array<{ nodeId: string; readable: boolean }> } }).task;
    const versuch = t.candidates.find(c => c.nodeId === VERSUCH);
    if (versuch) assert.equal(versuch.readable, false, 'listed, but marked unreadable');
    assert.doesNotMatch(toolText(r), /ANLEITUNG-VERSUCH/);
  } finally { SKILLS[FRAGEN]!.keywords.splice(2); }
});

test('when the task fits several skills equally, no instruction is guessed — the candidates come ranked', async () => {
  // "Material" is in both descriptions: a word that does not tell them apart.
  const r = await ask({ task: 'zu einem Material', outputFormat: 'json' });
  const t = (JSON.parse(toolText(r)) as { task: { match: string; candidates: unknown[]; skill?: unknown } }).task;
  assert.equal(t.match, 'ambiguous');
  assert.equal(t.skill, undefined);
  assert.ok(t.candidates.length >= 2);
  assert.match(toolText(await ask({ task: 'zu einem Material' })), /eindeutig/);
});

test('a task over a collection without a registry gets the plain miss, not an error', async () => {
  const mock = installFetchMock((url): MockResult => url.includes('/children')
    ? { json: { nodes: [], pagination: { total: 0, from: 0, count: 0 } } }
    : { json: {} });
  const c = await registryClient();
  try {
    const r = await c.callTool({ name: 'get_skill_registry', arguments: { collectionId: 'coll-leer', task: 'Experiment planen' } });
    assert.notEqual(r.isError, true, toolText(r));
    assert.match(toolText(r), /Registry/);
  } finally { await c.close(); mock.restore(); }
});


test('the editorial instruction travels with the handed-over skill, framed as curated content (review)', async () => {
  const text = toolText(await ask({ task: 'ein Experiment zur Brechung planen' }));
  assert.match(text, /ANLEITUNG-VERSUCH/);
  assert.match(text, /nur für Klasse 7/, 'an editorial constraint must not vanish when an instruction is handed over');
  assert.ok(text.indexOf('nur für Klasse 7') < text.indexOf('ANLEITUNG-VERSUCH'), 'ahead of the skill document');
  const json = JSON.parse(toolText(await ask({ task: 'Experiment planen', outputFormat: 'json' }))) as
    { task: { instructions?: Array<{ scope: string; text: string }> } };
  assert.ok(json.task.instructions?.some(i => i.scope === 'general' && /Klasse 7/.test(i.text)));
});

test('the answer is in structuredContent in BOTH formats — the chatbot reads nothing else (review)', async () => {
  const md = await ask({ task: 'Experiment planen' });
  const sc = md.structuredContent as { task?: { match: string; chosen?: { nodeId: string } }; registry?: unknown } | undefined;
  assert.equal(sc?.task?.match, 'found');
  assert.equal(sc?.task?.chosen?.nodeId, VERSUCH);
  const plain = await ask({});
  assert.ok((plain.structuredContent as { registry?: unknown } | undefined)?.registry, 'the catalogue too, without task');
});
