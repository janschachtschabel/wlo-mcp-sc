import { test } from 'node:test';
import assert from 'node:assert/strict';

import { rerankNodes, sortByTitle } from '../src/reranker.js';
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
