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
