/**
 * write-vocab-exact.test.ts – a WRITE takes a vocabulary value by its name or
 * a listed alias, never by a substring guess (chatbot feedback 2026-11-13, Z1).
 *
 * `resolveVocab` accepts a substring hit of four characters or more, first
 * table entry wins. Right for a search — a filter that matches nothing is
 * harmless — and wrong for a write: "Wirtschaft" was stored as Agrarwirtschaft,
 * and because subject, level and target group REPLACE what a record carries, a
 * record tagged Physik and Chemie carried only Agrarwirtschaft afterwards.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

import { validateField } from '../src/services/write/fields.js';
import { listVocab, resolveVocab, resolveVocabMatch } from '../src/vocabs.js';
import { registerCurationContentTools } from '../src/tools/curation-content.js';
import { registerCurationUpdateManyTool } from '../src/tools/curation-update-many.js';
import { registerCurationSuggestionTools } from '../src/tools/curation-suggestions.js';
import { applyReadOnlyToolDefaults } from '../src/apps/tool-defaults.js';
import { setServiceCredentialForTest, type WloCredential } from '../src/auth/credential.js';
import { installFetchMock, toolText } from './fetchMock.js';

const FIELD = { discipline: 'ccm:taxonid', educationalContext: 'ccm:educationalcontext', userRole: 'ccm:educationalintendedenduserrole' } as const;

// The cases the chatbot team measured: what the write stored for each input.
const GUESSED: Array<[keyof typeof FIELD, string]> = [
  ['discipline', 'Wirtschaft'], ['discipline', 'Technik'], ['discipline', 'Kunstgeschichte'],
  ['discipline', 'Mathematik und Physik'], ['educationalContext', 'Gesamtschule'],
  ['educationalContext', 'Sekundarstufe'], ['userRole', 'Eltern und Lehrer'],
];

for (const [field, input] of GUESSED) {
  test(`a write refuses the substring guess for ${field} "${input}" — and names candidates`, () => {
    const vocab = field === 'userRole' ? 'userRole' : field;
    // The premise: the search-side resolution DOES guess here.
    assert.equal(resolveVocabMatch(input, vocab)?.match, 'fuzzy', 'the fixture must be a fuzzy case');
    const out = validateField(FIELD[field], input);
    assert.equal(out.ok, false);
    if (out.ok) return;
    assert.match(out.reason, /kommt im Vokabular für .* nicht vor/);
    assert.match(out.reason, /Meintest du: /);
    assert.equal(out.refused?.length, 1, JSON.stringify(out));
    const { value, suggestions } = out.refused![0]!;
    assert.ok(suggestions.length >= 1 && suggestions.length <= 5, JSON.stringify(out));
    assert.equal(value, input);
    // The value the guess WOULD have written leads them: nothing is hidden, only not chosen.
    const guessed = listVocab(vocab).find(e => e.uri === resolveVocab(input, vocab))!.label;
    assert.equal(suggestions[0], guessed, `${guessed} does not lead ${suggestions.join(', ')}`);
    for (const s of suggestions) assert.equal(validateField(FIELD[field], s).ok, true, `a suggestion must itself be accepted: ${s}`);
  });
}

test('the name, an alias, and the URI are still accepted — for every entry of the three vocabularies', () => {
  for (const [field, vocab] of [['discipline', 'discipline'], ['educationalContext', 'educationalContext'], ['userRole', 'userRole']] as const) {
    for (const entry of listVocab(vocab)) {
      for (const spelling of [entry.label, entry.uri, ...entry.aliases]) {
        const out = validateField(FIELD[field], spelling);
        assert.equal(out.ok, true, `${field}: „${spelling}“ ${out.ok ? '' : out.reason}`);
      }
    }
  }
});

test('a word with no near entry is refused without inventing candidates', () => {
  const out = validateField('ccm:taxonid', 'Qwertzuiop');
  assert.equal(out.ok, false);
  if (!out.ok) {
    assert.doesNotMatch(out.reason, /Meintest du/);
    assert.deepEqual(out.refused, [{ value: 'Qwertzuiop', suggestions: [] }]);
  }
});

test('the SEARCH still resolves a substring — only the write got stricter', () => {
  assert.ok(resolveVocab('Wirtschaft', 'discipline'));
});

// ── through the tools: a program reads the candidates ────────────────────────

const MARIA: WloCredential = { header: 'Basic x', label: 'maria', source: 'user' };

async function client(): Promise<Client> {
  const server = new McpServer({ name: 'test', version: '0.0.0' });
  applyReadOnlyToolDefaults(server);
  registerCurationContentTools(server, 'Bearer error="invalid_request"');
  registerCurationUpdateManyTool(server, 'Bearer error="invalid_request"');
  registerCurationSuggestionTools(server, 'Bearer error="invalid_request"');
  const [ct, st] = InMemoryTransport.createLinkedPair();
  const c = new Client({ name: 'test-client', version: '0.0.0' });
  await Promise.all([server.connect(st), c.connect(ct)]);
  return c;
}

interface Candidate { field: string; value: string; suggestions: string[] }
const candidatesOf = (r: unknown) =>
  ((r as { structuredContent?: { error?: { candidates?: Candidate[] } } }).structuredContent?.error?.candidates ?? []);

test('every tool that writes or proposes carries the candidates in fields, and sends nothing', async () => {
  setServiceCredentialForTest(MARIA);
  const mock = installFetchMock(() => ({ json: { node: { ref: { id: 'n1', repo: '-home-' }, type: 'ccm:io',
    properties: { 'cclom:title': ['Licht'], 'ccm:taxonid': ['http://w3id.org/openeduhub/vocabs/discipline/460'] } } } }));
  try {
    const c = await client();
    const calls: Array<[string, Record<string, unknown>]> = [
      ['wlo_update_content', { nodeId: 'n1', discipline: 'Wirtschaft', educationalContext: 'Sekundarstufe' }],
      ['wlo_create_content', { title: 'Neu', url: 'https://example.org/x', discipline: 'Wirtschaft' }],
      ['wlo_update_contents', { items: [{ nodeId: 'n1', discipline: 'Wirtschaft' }] }],
      ['wlo_suggest_metadata', { nodeId: 'n1', suggestions: [{ field: 'discipline', value: 'Wirtschaft', reason: 'passt' }] }],
    ];
    for (const [name, args] of calls) {
      const r = await c.callTool({ name, arguments: args });
      assert.equal((r as { isError?: boolean }).isError, true, `${name}: ${toolText(r)}`);
      assert.match(toolText(r), /Meintest du: /, name);
      const found = candidatesOf(r);
      const discipline = found.find(x => x.field === 'discipline');
      assert.ok(discipline, `${name}: ${JSON.stringify(found)}`);
      assert.equal(discipline.value, 'Wirtschaft');
      assert.ok(discipline.suggestions.includes('Agrarwirtschaft'));
      if (name === 'wlo_update_content') assert.ok(found.some(x => x.field === 'educationalContext'), 'both fields in one answer');
    }
    assert.equal(mock.calls.filter(k => (k.init?.method ?? 'GET') !== 'GET').length, 0, 'nothing was sent');
  } finally { setServiceCredentialForTest(null); mock.restore(); }
});
