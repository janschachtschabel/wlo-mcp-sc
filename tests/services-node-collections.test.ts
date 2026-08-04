/**
 * services-node-collections.test.ts – from a material back to its collections.
 *
 * The whole feature turns on one measured trap. edu-sharing creates a
 * REFERENCE node when material is filed into a collection, and the listing
 * endpoints hand out those reference ids. The usage endpoint only knows the
 * ORIGINAL: given a reference id it answers `200` with an empty array, not an
 * error. So the reference must be resolved FIRST, always — a "try it, resolve
 * on empty" fallback would make the normal case slow and the empty case
 * ambiguous.
 *
 * Reproduced live 2026-08-01 against production, anonymously:
 *   reference c2e9b9ca-… → originalId 5a19e0e1-…
 *   usages/5a19e0e1-…/collections → 200, 2 ACTIVE entries
 *   usages/c2e9b9ca-…/collections → 200, 0 entries
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import type { WloNode } from '../src/wlo-api.js';
import { getNodeCollections, getParentCollections } from '../src/services/node-collections.js';
import { installFetchMock } from './fetchMock.js';

const COLLECTION_NODE: WloNode = { ref: { id: 'coll-1', repo: '-home-' }, type: 'ccm:map', properties: {} };

const REFERENCE = 'c2e9b9ca-8389-494f-ba24-f45da654d9c2';
const ORIGINAL = '5a19e0e1-92ec-47db-9a19-779d4d576485';

function collectionEntry(id: string, title: string, usageType = 'ACTIVE') {
  return {
    collectionUsageType: usageType,
    collection: {
      ref: { id, repo: 'local' },
      type: 'ccm:map',
      isDirectory: true,
      properties: { 'cm:title': [title], 'cclom:title': [title] },
    },
  };
}

/**
 * Serve node metadata and usages. `originalId` present ⇒ the requested node is
 * a reference; usages answer only for the id given in `usagesFor`.
 */
function serve(opts: {
  originalId?: string;
  usagesFor?: string;
  entries?: unknown[];
  metadataStatus?: number;
  usagesStatus?: number;
}) {
  return installFetchMock((url) => {
    if (url.includes('/node/v1/nodes/')) {
      if (opts.metadataStatus && opts.metadataStatus !== 200) return { status: opts.metadataStatus, json: {} };
      const id = /\/nodes\/-home-\/([^/?]+)/.exec(url)?.[1] ?? '';
      return {
        json: {
          node: {
            ref: { id, repo: '-home-' },
            ...(opts.originalId ? { originalId: opts.originalId } : {}),
            properties: { 'cclom:title': ['Arbeitsblatt Ernährung'] },
          },
        },
      };
    }
    if (url.includes('/usage/v1/usages/node/')) {
      if (opts.usagesStatus && opts.usagesStatus !== 200) return { status: opts.usagesStatus, json: {} };
      const id = /\/usages\/node\/([^/?]+)/.exec(url)?.[1] ?? '';
      return { json: id === opts.usagesFor ? (opts.entries ?? []) : [] };
    }
    return { json: {} };
  });
}

test('a reference id is resolved to the original before the lookup', async () => {
  const mock = serve({
    originalId: ORIGINAL,
    usagesFor: ORIGINAL,
    entries: [collectionEntry('c-1', 'Ernährung'), collectionEntry('c-2', 'Biologie-Breakouts')],
  });
  try {
    const r = await getNodeCollections(REFERENCE);
    assert.ok(r);
    assert.equal(r.nodeId, ORIGINAL, 'the resolved original is reported');
    assert.equal(r.requestedNodeId, REFERENCE);
    assert.equal(r.wasReference, true);
    assert.deepEqual(r.collections.map(c => c.title), ['Ernährung', 'Biologie-Breakouts']);
  } finally {
    mock.restore();
  }
});

test('the resolution happens before the lookup, not after an empty result', async () => {
  // Asserted on the request order: exactly one usage call, and it carries the
  // ORIGINAL id. A "try the reference first" implementation would show two.
  const mock = serve({ originalId: ORIGINAL, usagesFor: ORIGINAL, entries: [collectionEntry('c-1', 'Ernährung')] });
  try {
    await getNodeCollections(REFERENCE);
    const usageCalls = mock.calls.filter(c => c.url.includes('/usage/v1/'));
    assert.equal(usageCalls.length, 1);
    assert.match(usageCalls[0]!.url, new RegExp(ORIGINAL));
    assert.doesNotMatch(usageCalls[0]!.url, new RegExp(REFERENCE));
  } finally {
    mock.restore();
  }
});

test('an original id is used as-is and flagged as not a reference', async () => {
  const mock = serve({ usagesFor: ORIGINAL, entries: [collectionEntry('c-1', 'Ernährung')] });
  try {
    const r = await getNodeCollections(ORIGINAL);
    assert.equal(r?.wasReference, false);
    assert.equal(r?.nodeId, ORIGINAL);
    assert.equal(r?.collections.length, 1);
  } finally {
    mock.restore();
  }
});

test('the collections endpoint is used, not the general usages one', async () => {
  // The bare /usages/node/{id} also returns courses and third-party apps.
  const mock = serve({ usagesFor: ORIGINAL, entries: [] });
  try {
    await getNodeCollections(ORIGINAL);
    const usage = mock.calls.find(c => c.url.includes('/usage/v1/'));
    assert.match(usage?.url ?? '', /\/usages\/node\/[^/]+\/collections$/);
  } finally {
    mock.restore();
  }
});

test('only ACTIVE memberships count', async () => {
  const mock = serve({
    usagesFor: ORIGINAL,
    entries: [collectionEntry('c-1', 'Ernährung'), collectionEntry('c-2', 'Altlast', 'INACTIVE')],
  });
  try {
    const r = await getNodeCollections(ORIGINAL);
    assert.deepEqual(r?.collections.map(c => c.title), ['Ernährung']);
  } finally {
    mock.restore();
  }
});

test('being in no collection is a named result, not an empty silence', async () => {
  const mock = serve({ usagesFor: ORIGINAL, entries: [] });
  try {
    const r = await getNodeCollections(ORIGINAL);
    assert.equal(r?.collections.length, 0);
    assert.equal(r?.reason, 'not_in_any_collection');
  } finally {
    mock.restore();
  }
});

test('a node that does not exist is told apart from one in no collection', async () => {
  // The usage endpoint answers 500 for an unknown id on both prod and staging
  // (measured), so it cannot make this distinction. Resolving the node first
  // can: a missing node fails there with 404.
  const mock = serve({ metadataStatus: 404 });
  try {
    const r = await getNodeCollections('gibt-es-nicht');
    assert.equal(r, null, 'null means "no such node" — the caller names the reason');
  } finally {
    mock.restore();
  }
});

test('a broken usage lookup is an error, never an empty result', async () => {
  const mock = serve({ usagesFor: ORIGINAL, usagesStatus: 500 });
  try {
    await assert.rejects(() => getNodeCollections(ORIGINAL), /Sammlung|500|nicht ermittel/i);
  } finally {
    mock.restore();
  }
});

test('a collection with a topic page reports its URL', async () => {
  const withPage = collectionEntry('c-1', 'Ernährung');
  (withPage.collection.properties as Record<string, string[]>)['ccm:page_config_ref'] = ['cfg-1'];
  const mock = serve({ usagesFor: ORIGINAL, entries: [withPage] });
  try {
    const r = await getNodeCollections(ORIGINAL);
    assert.ok(r?.collections[0]?.topicPageUrl, 'a curated topic page is a better destination than the raw collection');
  } finally {
    mock.restore();
  }
});

test('a collection whose parent lookup fails is reported as unknown, not as "in no collection"', async () => {
  // `getNodeParents` degrades to [] on ANY non-OK response, so "the read was
  // refused" and "it has no parents" arrive identical. Passing that on as an
  // empty list makes get_wlo_node_details print "Keine Eltern-Sammlungen
  // gefunden." — the same confident falsehood the material branch of this
  // function was written to prevent, on the other branch.
  const mock = installFetchMock((url) => (url.includes('/parents') ? { status: 403, json: {} } : { json: {} }));
  try {
    const outcome = await getParentCollections(COLLECTION_NODE, 'coll-1');
    assert.equal(outcome.status, 'unknown');
  } finally {
    mock.restore();
  }
});

test('a collection that genuinely has no parents stays a plain empty result', async () => {
  // The guard above must not turn every empty answer into a failure: a root
  // collection legitimately has no parents and must still read as `ok`.
  const mock = installFetchMock(() => ({ json: { nodes: [] } }));
  try {
    const outcome = await getParentCollections(COLLECTION_NODE, 'coll-1');
    assert.equal(outcome.status, 'ok');
    assert.deepEqual(outcome.status === 'ok' ? outcome.collections : null, []);
  } finally {
    mock.restore();
  }
});

test('an unparseable usage response throws instead of claiming "in keiner Sammlung"', async () => {
  // Same rule as the non-OK branch above it: "we could not find out" must not
  // reach the user as "it is in no collection".
  const mock = installFetchMock((url) => {
    if (url.includes('/usage/v1')) return { text: '<html>gateway</html>' };
    return { json: { node: { ref: { id: 'orig-1' }, properties: {} } } };
  });
  try {
    await assert.rejects(() => getNodeCollections('orig-1'), /konnten nicht ermittelt werden/);
  } finally { mock.restore(); }
});
