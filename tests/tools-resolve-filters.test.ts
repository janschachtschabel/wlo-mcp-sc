/**
 * tools-resolve-filters.test.ts – every filter label of a plan, in one call
 * (BOERDi wishlist item 3, 2026-11-06).
 *
 * Replaces chains of lookup_wlo_vocabulary calls (154 counted) and the chatbot's
 * own matching. It resolves through the SAME `resolveVocabMatch` the search and
 * write paths use, so the three can never read one label differently.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { assertRejectsWithoutUpstream, connectedClient, installFetchMock } from './fetchMock.js';

interface Resolved { input: string; status: string; uri: string; label: string; keys?: string[]; suggestions?: string[] }
interface Payload {
  results: Record<string, Resolved[]>;
  unresolved: Array<{ vocabulary: string; input: string; suggestions: string[] }>;
}

async function resolve(filters: Record<string, string[]>): Promise<Payload> {
  const mock = installFetchMock(url => { throw new Error(`no upstream expected: ${url}`); });
  const c = await connectedClient();
  try {
    const r = await c.callTool({ name: 'resolve_wlo_filters', arguments: { filters } });
    assert.notEqual(r.isError, true, JSON.stringify(r.content));
    assert.equal(mock.calls.length, 0, 'local tables only — no repository call');
    return r.structuredContent as unknown as Payload;
  } finally { await c.close(); mock.restore(); }
}

test('the wishlist examples resolve, each saying how', async () => {
  const p = await resolve({
    discipline: ['Physik'],
    educationalContext: ['Klasse 7', 'Sek I', 'Oberstufe'],
    userRole: ['Lehrkraft'],
    license: ['CC BY-SA'],
  });
  assert.equal(p.results['discipline']![0]!.status, 'exact');
  assert.match(p.results['discipline']![0]!.uri, /^http:\/\/w3id\.org\//);
  const levels = p.results['educationalContext']!;
  assert.deepEqual(levels.map(l => l.status), ['alias', 'alias', 'alias']);
  assert.match(levels[0]!.uri, /sekundarstufe_1$/);
  assert.equal(levels[0]!.label, 'Sekundarstufe I');
  assert.match(levels[2]!.uri, /sekundarstufe_2$/);
  assert.equal(p.results['userRole']![0]!.status, 'alias');
  assert.deepEqual(p.results['license']![0], { input: 'CC BY-SA', status: 'exact', uri: 'CC_BY_SA', label: 'CC BY-SA' });
  assert.deepEqual(p.unresolved, []);
});

test('"CC BY NC" is unresolved with a suggestion instead of silently becoming CC BY', async () => {
  const p = await resolve({ license: ['CC BY NC'] });
  assert.equal(p.results['license']?.length ?? 0, 0);
  assert.equal(p.unresolved[0]?.vocabulary, 'license');
  assert.ok(p.unresolved[0]!.suggestions.some(s => /NC/.test(s)), JSON.stringify(p.unresolved));
});

test('a typo resolves as fuzzy and carries suggestions — never taken over silently', async () => {
  const p = await resolve({ lrt: ['Arbeitsblat'] });
  const hit = p.results['lrt']![0]!;
  assert.equal(hit.status, 'fuzzy');
  assert.ok(hit.suggestions?.includes('Arbeitsblatt'), JSON.stringify(hit));
});

test('the OER bundle names the keys it stands for; an unknown word is unresolved', async () => {
  const p = await resolve({ license: ['OER'], lrt: ['Quatschwort'] });
  assert.deepEqual(p.results['license']![0]!.keys?.length, 4);
  assert.equal(p.unresolved[0]?.vocabulary, 'lrt');
  assert.equal(p.unresolved[0]?.input, 'Quatschwort');
});

test('at most ten values per vocabulary, enforced by the schema', async () => {
  const c = await connectedClient();
  try {
    await assertRejectsWithoutUpstream(c, 'resolve_wlo_filters',
      { filters: { discipline: Array.from({ length: 11 }, (_, i) => `Fach ${i}`) } }, '11 values');
  } finally { await c.close(); }
});
