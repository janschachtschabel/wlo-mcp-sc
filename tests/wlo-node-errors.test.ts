/**
 * wlo-node-errors.test.ts – what the node endpoints do when the repository
 * answers, but not with usable JSON.
 *
 * A reverse proxy, a maintenance page or an empty body all produce HTTP 200
 * with a body `res.json()` cannot parse. Each function here already documents
 * an error contract for the non-OK case; this pins that a parse failure takes
 * the SAME route rather than throwing past a caller that was promised `[]`.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  getChildCollections,
  getCollectionContents,
  getNodeMetadata,
  getNodeParents,
  getNodesMetadata,
  readNodeTextContent,
} from '../src/wlo-api.js';
import { installFetchMock } from './fetchMock.js';

/** HTTP 200 with a body that is not JSON — the gateway/maintenance-page case. */
const notJson = () => installFetchMock(() => ({ text: '<html>maintenance</html>' }));

test('getChildCollections: an unparseable 200 body degrades to []', async () => {
  const mock = notJson();
  try {
    assert.deepEqual(await getChildCollections('c-1'), []);
  } finally { mock.restore(); }
});

test('getNodeMetadata: an unparseable 200 body degrades to null', async () => {
  const mock = notJson();
  try {
    assert.equal(await getNodeMetadata('n-1'), null);
  } finally { mock.restore(); }
});

test('getNodeParents: an unparseable 200 body degrades to []', async () => {
  const mock = notJson();
  try {
    assert.deepEqual(await getNodeParents('n-1'), []);
  } finally { mock.restore(); }
});

test('readNodeTextContent: an unparseable 200 body reports no text, keeping the status', async () => {
  const mock = notJson();
  try {
    assert.deepEqual(await readNodeTextContent('n-1'), { text: null, status: 200 });
  } finally { mock.restore(); }
});

test('getCollectionContents: an unparseable 200 body throws a named error', async () => {
  // This one throws by contract (it is the primary read of a browse call, and a
  // silent empty page would look like an empty collection). The error must name
  // the failing call rather than surfacing "Unexpected token <".
  const mock = notJson();
  try {
    await assert.rejects(
      () => getCollectionContents('c-1'),
      /getCollectionContents: upstream response was not valid JSON/,
    );
  } finally { mock.restore(); }
});

test('getNodesMetadata: one unparseable node does not sink the whole fan-out', async () => {
  const mock = installFetchMock((url) => {
    if (url.includes('/bad/')) return { text: '<html>maintenance</html>' };
    return { json: { node: { ref: { id: 'good', repo: '-home-' }, properties: {} } } };
  });
  try {
    const out = await getNodesMetadata(['good', 'bad']);
    assert.equal(out.length, 1);
    assert.equal(out[0]?.ref?.id, 'good');
  } finally { mock.restore(); }
});
