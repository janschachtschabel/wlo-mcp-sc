/**
 * An umlaut is one code point (NFC) or a base letter plus a combining mark
 * (NFD — what macOS file names and some editors produce). `queryTerms` brings
 * the QUERY into one form; a matcher that only lowercases the text it is
 * compared with then misses in a new way: a decomposed query against a
 * decomposed title matched by accident before, and no longer did.
 *
 * Every matcher here is asked all four ways round.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { rerankNodes } from '../src/reranker.js';
import { searchSkills } from '../src/services/skills.js';
import { SKILL_CONTENT_TYPE_URI } from '../src/services/skill-catalogue.js';
import { findCollectionsByTreeTraversal } from '../src/services/collection-traversal.js';
import { nodeMatchesText } from '../src/node-match.js';
import { rankBm25 } from '../src/text-bm25.js';
import { installFetchMock, makeNode, type MockResult } from './fetchMock.js';

const FORMS = ['NFC', 'NFD'] as const;
const PAIRS = FORMS.flatMap(q => FORMS.map(t => [q, t] as const));

test('the two forms really differ — or this file tests nothing', () => {
  assert.notEqual('Größe'.normalize('NFC'), 'Größe'.normalize('NFD'));
});

for (const [q, t] of PAIRS) {
  test(`reranker: a ${q} query finds a ${t} title and keyword`, () => {
    const query = 'Größen schätzen'.normalize(q);
    // (A match in the description alone scores nothing — the reranker's own rule.)
    for (const where of ['cclom:title', 'cclom:general_keyword']) {
      // Same shape, so nothing but the match tells the two apart.
      const other = makeNode('a-other', 'Arbeitsblatt', { [where]: ['Bruchrechnung üben und anwenden'] });
      const hit = makeNode('z-hit', 'Arbeitsblatt', { [where]: ['Größen schätzen und messen'.normalize(t)] });
      // The id tie-break puts `a-other` first, so only a score moves the hit up.
      assert.equal(rerankNodes([other, hit], query)[0]?.ref?.id, 'z-hit', where);
    }
  });

  test(`search_skill ranking: a ${q} query finds a ${t} title, keyword and description`, async () => {
    const skill = (id: string, title: string, desc: string, keywords: string[]) => makeNode(id, title, {
      'cclom:general_description': [desc], 'cclom:general_keyword': keywords, 'ccm:oeh_extendedType': [SKILL_CONTENT_TYPE_URI],
    });
    const word = 'Prüfung'.normalize(t);
    for (const hit of [skill('hit', word, 'x', []), skill('hit', 'Titel', word, []), skill('hit', 'Titel', 'x', [word])]) {
      const mock = installFetchMock((url): MockResult => (url.includes('/ngsearch')
        ? { json: { nodes: [skill('other', 'Stunde planen', 'Plant.', ['Unterricht']), hit], pagination: { total: 2, from: 0, count: 2 } } }
        : { json: {} }));
      try {
        const skills = await searchSkills({ query: 'Prüfung'.normalize(q) });
        assert.equal(skills[0]?.nodeId, 'hit');
      } finally { mock.restore(); }
    }
  });

  test(`tree fallback: a ${q} query scores a ${t} title when choosing the branches to read`, async () => {
    // "für" is a stopword, so nothing MATCHES and the fallback scoring decides
    // which fifteen of the sixteen second-level branches are opened. The one
    // that carries the word is the sixteenth.
    const coll = (id: string, title: string) => ({ ...makeNode(id, title), type: 'ccm:map' });
    const level2 = [...Array.from({ length: 15 }, (_, i) => coll(`c-${i}`, `Sammlung ${i}`)), coll('c-15', 'Material für alle'.normalize(t))];
    const mock = installFetchMock((url) => ({ json: { nodes: url.includes('/p-0/') ? level2 : [] } }));
    try {
      await findCollectionsByTreeTraversal([coll('p-0', 'Portal')], 'für'.normalize(q));
      assert.ok(mock.calls.some(c => c.url.includes('/c-15/')), 'the scored branch is among those read');
    } finally { mock.restore(); }
  });

  test(`shared matchers: ${q} query × ${t} text`, () => {
    assert.equal(nodeMatchesText(makeNode('n', 'Größen schätzen'.normalize(t)), 'Größen'.normalize(q)), true);
    const ranked = rankBm25(['Die Größe eines Körpers.'.normalize(t), 'Etwas anderes.'], 'Größe'.normalize(q));
    assert.deepEqual(ranked.unmatched, []);
  });
}
