import { test } from 'node:test';
import assert from 'node:assert/strict';

import { nodeMatchesCriteria, nodeMatchesText, nodeTitle } from '../src/node-match.js';
import { makeNode } from './fetchMock.js';

test('nodeMatchesText: matches a title that lives only in cm:title (audit #9)', () => {
  const variant = makeNode('v1', '', { 'cclom:title': [], 'cm:name': ['PAGE_VARIANT_x'], 'cm:title': ['Optik Spezial'] });
  assert.equal(nodeMatchesText(variant, 'optik'), true);
});

test('nodeTitle: canonical fallback chain cclom:title → cm:title → cm:name → node fields', () => {
  assert.equal(nodeTitle(makeNode('a', 'CclomTitel', { 'cm:title': ['CmTitel'] })), 'CclomTitel');
  assert.equal(nodeTitle(makeNode('b', '', { 'cclom:title': [], 'cm:title': ['CmTitel'], 'cm:name': ['tech-name'] })), 'CmTitel');
  assert.equal(nodeTitle(makeNode('c', '', { 'cclom:title': [], 'cm:name': ['tech-name'] })), 'tech-name');
  assert.equal(nodeTitle({ ref: { id: 'd', repo: '-home-' }, name: 'NodeName' }), 'NodeName');
});

test('nodeMatchesCriteria: every criterion must intersect the node properties', () => {
  const n = makeNode('n', 'X', { 'ccm:taxonid': ['uri-bio'] });
  assert.equal(nodeMatchesCriteria(n, [{ property: 'ccm:taxonid', values: ['uri-bio', 'uri-che'] }]), true);
  assert.equal(nodeMatchesCriteria(n, [{ property: 'ccm:taxonid', values: ['uri-mat'] }]), false);
  assert.equal(nodeMatchesCriteria(n, []), true);
});

/**
 * Measured live against the editorial repository on 2026-08-03, over a 60-node
 * pool from a real search — the probe R7 deferred:
 *
 *   "Bruchrechnung"       →  0/60 pass  (correct: the pool is about something else)
 *   "die Bruchrechnung"   → 43/60 pass  (72% — "Schultheater", "Filmmusik", …)
 *   "der Wald"            → 48/60
 *   "IT"                  → 47/60
 *   "Optik im Unterricht" → 51/60
 *
 * One German article in front of the term flips the filter from correctly
 * rejecting everything to accepting three quarters of unrelated material,
 * because "die" occurs inside ordinary words ("Stu-die-n", "Me-die-n"). The
 * filter was a no-op for any query phrased the way a person speaks.
 */
test('a stopword in the query does not turn the filter into a pass-through', () => {
  // A real German description contains "die" both as a word and inside others
  // ("Stu-die-n", "Me-die-n") — which is why the live pool passed at 72%.
  const node = {
    properties: {
      'cclom:title': ['Schultheater auf Abstand — Stimme'],
      'cclom:general_description': ['Studien zu Medien zeigen, dass die Stimme im Raum getragen wird.'],
    },
  } as any;
  assert.equal(nodeMatchesText(node, 'Bruchrechnung'), false, 'the specific term does not match');
  assert.equal(
    nodeMatchesText(node, 'die Bruchrechnung'), false,
    'and putting an article in front must not make it match',
  );
});

test('a short term matches at a word start, not buried inside one', () => {
  // Measured: the query "IT" put these in the top five of a live search.
  const spurious = ['Germans are sitting too much', 'Mauritius in a Nutshell', 'Der Hotspot-Ansatz in der EU-Politik', 'Citizenship'];
  for (const title of spurious) {
    assert.equal(nodeMatchesText({ properties: { 'cclom:title': [title] } } as any, 'IT'), false, title);
  }
  // …while the term as an actual word, or as the first part of a compound, stays.
  assert.equal(nodeMatchesText({ properties: { 'cclom:title': ['IT-Sicherheit in der Schule'] } } as any, 'IT'), true);
  assert.equal(nodeMatchesText({ properties: { 'cclom:title': ['Europäische Asylpolitik'] } } as any, 'EU'), true, 'a prefix is a German compound, not an accident');
});

test('a longer term still matches inside a German compound', () => {
  // The substring behaviour is what German needs; only SHORT terms were the problem.
  const node = { properties: { 'cclom:title': ['Arten der Bruchrechnung'] } } as any;
  assert.equal(nodeMatchesText(node, 'Rechnung'), true, 'Rechnung inside Bruchrechnung');
  assert.equal(nodeMatchesText({ properties: { 'cclom:title': ['Leben in der mittelalterlichen Stadt'] } } as any, 'Mittelalter'), true);
});

test('a query made only of stopwords matches nothing rather than everything', () => {
  const node = { properties: { 'cclom:title': ['Studien zu Medien'] } } as any;
  assert.equal(nodeMatchesText(node, 'die und der'), false);
});
