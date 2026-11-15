import { test } from 'node:test';
import assert from 'node:assert/strict';

import { enhancedSearch, rerankNodes, sortByTitle } from '../src/reranker.js';
import { installFetchMock } from './fetchMock.js';
import type { WloNode } from '../src/wlo-api.js';

function node(id: string, title: string, extra: Partial<WloNode> = {}): WloNode {
  return {
    ref: { id, repo: '-home-' },
    properties: { 'cclom:title': [title] },
    ...extra,
  };
}

test('rerankNodes: empty query is a no-op', () => {
  const nodes = [node('b', 'Zebra'), node('a', 'Affe')];
  assert.deepEqual(rerankNodes(nodes, '  '), nodes);
});

test('rerankNodes: scores a title that lives only at the node level (regression L10)', () => {
  // Title only at node.title (no cclom:title/cm:name property). formatNode uses
  // this fallback; the reranker must too, or the node scores against an empty
  // title. Ids chosen so the nodeId tie-break would rank the match LAST without
  // its title score, isolating the fix.
  const match: WloNode = { ref: { id: 'z-match', repo: '-home-' }, title: 'Photosynthese Grundlagen', properties: {} };
  const other = node('a-other', 'Völlig anderes Thema');
  const ranked = rerankNodes([other, match], 'Photosynthese');
  assert.equal(ranked[0]?.ref?.id, 'z-match');
});

test('rerankNodes: a stopword-only match confers no relevance', () => {
  // Query has a stopword ("die") and a content term ("chemie"). `stop` matches
  // only the stopword; `zero` matches nothing. A stopword must not count as a
  // relevance signal, so both score 0 and the deterministic nodeId tie-break
  // decides ("a-zero" before "z-stop"). Before the fix the stopword gave
  // `stop` a positive score and it wrongly ranked first.
  const stop = node('z-stop', 'Die Insel');
  const zero = node('a-zero', 'Xylophon Zebra');
  const ranked = rerankNodes([stop, zero], 'die chemie');
  assert.deepEqual(ranked.map(n => n.ref?.id), ['a-zero', 'z-stop']);
});

test('rerankNodes: exact title match ranks first', () => {
  const nodes = [
    node('1', 'Allgemeine Chemie Grundlagen'),
    node('2', 'Bruchrechnung'),
    node('3', 'Bruchrechnung für Fortgeschrittene'),
  ];
  const ranked = rerankNodes(nodes, 'Bruchrechnung');
  assert.equal(ranked[0].ref?.id, '2');
  assert.equal(ranked[1].ref?.id, '3');
});

test('rerankNodes: deleted placeholder nodes are filtered out', () => {
  const nodes = [
    node('1', 'Element wurde gelöscht'),
    node('2', 'Bruchrechnung'),
  ];
  const ranked = rerankNodes(nodes, 'Bruchrechnung');
  assert.deepEqual(ranked.map(n => n.ref?.id), ['2']);
});

test('rerankNodes: equal scores tie-break deterministically by nodeId', () => {
  const a = node('aaa', 'Physik Basics');
  const b = node('bbb', 'Physik Basics');
  const r1 = rerankNodes([b, a], 'Physik Basics');
  const r2 = rerankNodes([a, b], 'Physik Basics');
  assert.deepEqual(r1.map(n => n.ref?.id), r2.map(n => n.ref?.id));
  assert.deepEqual(r1.map(n => n.ref?.id), ['aaa', 'bbb']);
});

test('sortByTitle: alphabetical (de), nodeId tie-breaker, input untouched', () => {
  const input = [node('2', 'Ökologie'), node('1', 'Physik'), node('3', 'Ökologie')];
  const sorted = sortByTitle(input);
  assert.deepEqual(sorted.map(n => n.ref?.id), ['2', '3', '1']);
  // original array order preserved (sortByTitle copies)
  assert.deepEqual(input.map(n => n.ref?.id), ['2', '1', '3']);
});

test('sortByTitle: orders page variants by cm:title, not the PAGE_VARIANT placeholder (audit #9)', () => {
  // Variants carry the readable title in cm:title while cm:name is the
  // technical "PAGE_VARIANT_<uuid>" placeholder — the sort must use the same
  // fallback chain as the formatter.
  const v = (id: string, cmName: string, cmTitle: string): WloNode => ({
    ref: { id, repo: '-home-' },
    properties: { 'cm:name': [cmName], 'cm:title': [cmTitle] },
  });
  const sorted = sortByTitle([v('1', 'PAGE_VARIANT_aaa', 'Zebra'), v('2', 'PAGE_VARIANT_zzz', 'Alpha')]);
  assert.deepEqual(sorted.map(n => n.ref?.id), ['2', '1'], 'Alpha before Zebra despite reversed cm:name order');
});

test('rerankNodes: a node titled only at cm:title is neither dropped nor unscored (audit #9)', () => {
  // isDeletedNode used a shorter title chain (no cm:title) and misclassified
  // such nodes as deleted placeholders.
  const cmTitleOnly: WloNode = { ref: { id: 'z-keep', repo: '-home-' }, properties: { 'cm:title': ['Optik Spezial'] } };
  const other = node('a-other', 'Ganz anderes Thema');
  const ranked = rerankNodes([other, cmTitleOnly], 'optik');
  assert.deepEqual(ranked.map(n => n.ref?.id), ['z-keep', 'a-other'], 'cm:title node survives and scores first');
});

test('a total upstream failure is an error, not an empty result set', async () => {
  // Discovered live (2026-07-31): with a wrong service password every upstream
  // call is answered 401, every query variant fails, and the search reported
  // "0 Treffer" with isError=false. The model then tells the user there is
  // nothing on the topic — a configuration fault rendered as a fact about the
  // world. "All variants failed" is categorically not "no matches".
  const mock = installFetchMock(() => ({ status: 401, json: { error: 'unauthorized' } }));
  try {
    await assert.rejects(
      () => enhancedSearch('Bruchrechnung', 'FILES', [], 5),
      /failed|401/i,
      'a search that could not be performed must not look like one that found nothing',
    );
  } finally { mock.restore(); }
});

test('a partial variant failure still degrades gracefully', async () => {
  // The counterpart: resilience must survive the fix above. One variant failing
  // is exactly what allSettled is for, and it must NOT turn into an error.
  let call = 0;
  const mock = installFetchMock(() => {
    call += 1;
    if (call === 1) return { status: 500, json: { error: 'boom' } };
    return { json: { nodes: [], pagination: { total: 0, from: 0, count: 0 } } };
  });
  try {
    const res = await enhancedSearch('Bruchrechnung', 'FILES', [], 5);
    assert.equal(res.nodes.length, 0, 'no hits, but a real answer');
  } finally { mock.restore(); }
});

/**
 * The phrase branch of `computeRelevanceScore` awards +30 for
 * `title.includes(query)` — by far its largest single bonus. For a ONE-WORD
 * query that branch is a raw substring test, so a short query scored the full
 * phrase bonus on a word that merely contains it. Measured live 2026-08-03: the
 * query "IT" put "Mauritius in a Nutshell", "supermarket self-checkouts" and
 * "EU-Migrations- und Asylpolitik" in the top five, above actual IT material.
 * The term branch had already been given the word-start rule; this one had not,
 * and it outweighs the term branch four to one.
 */
test('a short query does not win the phrase bonus on a word that merely contains it', () => {
  // All three are equally unrelated to IT, so nothing may outrank anything —
  // the deterministic nodeId tie-break must decide. A spurious +30 for the
  // mid-word "it" in "Maur-it-ius" would hoist it to the top instead.
  const ranked = rerankNodes(
    [node('z-mauritius', 'Mauritius in a Nutshell'), node('a-salz', 'Salz und Zucker'), node('m-politik', 'Politik heute')],
    'IT',
  );
  assert.deepEqual(
    ranked.map(n => n.ref?.id),
    ['a-salz', 'm-politik', 'z-mauritius'],
    'none of them is about IT, so none may be scored as if it were',
  );
});

test('a short query still ranks the material that IS about it first', () => {
  const ranked = rerankNodes(
    [node('z-mauritius', 'Mauritius in a Nutshell'), node('a-it', 'IT-Sicherheit in der Schule')],
    'IT',
  );
  assert.equal(ranked[0]?.ref?.id, 'a-it');
});

test('a multi-word phrase keeps the phrase bonus it always had', () => {
  const ranked = rerankNodes(
    [node('a', 'Ganz etwas anderes'), node('b', 'Optik im Unterricht der Sekundarstufe')],
    'Optik im Unterricht',
  );
  assert.equal(ranked[0]?.ref?.id, 'b');
});
