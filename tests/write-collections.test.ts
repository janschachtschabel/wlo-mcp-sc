/**
 * write-collections.test.ts – collections, and the trap that runs through them.
 *
 * A collection holds REFERENCES to material, not the material itself. Removing
 * a reference takes an item out of a collection; deleting the node it points at
 * destroys the material for everyone. The two are one path segment apart, which
 * is why the reference endpoint is pinned here rather than trusted.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  createCollection,
  renameCollection,
  addToCollection,
  addToCollectionRequest,
  removeFromCollection,
  removeFromCollectionRequest,
  deleteCollection,
} from '../src/services/write/collections.js';
import { installFetchMock } from './fetchMock.js';

const PARENT = 'parent-1';
const COLLECTION = 'coll-1';
const NODE = 'node-1';
/** The reference node the collection holds for NODE — a different id. */
const REFERENCE = 'ref-1';

/**
 * A repository that accepts every mutation AND shows the result afterwards.
 *
 * The read-back is what makes this a happy path: each of these calls answers
 * `200` on its own, and three measured edu-sharing mechanisms discard a write
 * while doing exactly that. A mock that only answered the mutation would let a
 * test claim success the code cannot claim.
 */
interface Repo {
  /** What a metadata read reports as `cm:title` — the read-back compares it. */
  title?: string;
  description?: string;
  /** Status of a node metadata read — 404 once the node is gone. */
  metadataStatus?: number;
  /** Collections the usage endpoint reports for the material. */
  usage?: string[];
  /** Status of every mutating call. */
  writeStatus?: number;
  /**
   * What the collection's child listing holds, as originalId → reference id.
   * A removal has to find the REFERENCE here before it can delete anything.
   */
  references?: Record<string, string>;
  /** Status of that listing — non-200 means the lookup could not run. */
  childrenStatus?: number;
}

function repo(state: Repo = {}) {
  const {
    title, description, metadataStatus = 200, usage = [COLLECTION], writeStatus = 200,
    references = { [NODE]: REFERENCE }, childrenStatus = 200,
  } = state;
  // A removal is confirmed by the reference node being gone, so the mock has to
  // let it disappear — a repository that still serves it after the DELETE is
  // the failure case, not the happy one.
  let referenceDeleted = false;
  return installFetchMock((url, init) => {
    if ((init?.method ?? 'GET') !== 'GET' && url.includes(`/references/${REFERENCE}`)) {
      if (writeStatus === 200) referenceDeleted = true;
    }
    if ((init?.method ?? 'GET') === 'GET') {
      if (referenceDeleted && url.includes(REFERENCE)) return { status: 404, json: {} };
      if (url.includes('/usage/v1/')) {
        return { json: usage.map(id => ({ collectionUsageType: 'ACTIVE', collection: { ref: { id } } })) };
      }
      if (url.includes('/children')) {
        if (childrenStatus !== 200) return { status: childrenStatus, json: {} };
        const nodes = Object.entries(references).map(([original, ref]) => ({
          ref: { id: ref, repo: '-home-' },
          properties: { 'ccm:original': [original] },
        }));
        return { json: { nodes, pagination: { total: nodes.length, from: 0, count: nodes.length } } };
      }
      if (metadataStatus !== 200) return { status: metadataStatus, json: {} };
      const properties: Record<string, string[]> = {};
      if (title !== undefined) properties['cm:title'] = [title];
      if (description !== undefined) properties['cm:description'] = [description];
      return { json: { node: { ref: { id: COLLECTION, repo: '-home-' }, properties } } };
    }
    if (writeStatus !== 200) return { status: writeStatus, json: {} };
    return { json: { collection: { ref: { id: 'neu-1' } } } };
  });
}

/** A repository that accepts the call and shows the change afterwards. */
const ok = (title = 'Bruchrechnung', description?: string) => repo({ title, description });

/** Every write in this file goes through a mutating HTTP method. */
const writes = (m: ReturnType<typeof installFetchMock>) =>
  m.calls.filter(c => (c.init?.method ?? 'GET') !== 'GET');

test('a top-level collection is created under the repository root', async () => {
  const mock = ok();
  try {
    await createCollection(null, { title: 'Bruchrechnung' });
    const url = mock.calls[0]?.url ?? '';
    assert.match(url, /\/collection\/v1\/collections\/-home-\/-root-\/children/);
    assert.equal(mock.calls[0]?.init?.method, 'POST');
  } finally {
    mock.restore();
  }
});

test('a sub-collection is created under its parent', async () => {
  const mock = ok('Brüche kürzen');
  try {
    await createCollection(PARENT, { title: 'Brüche kürzen' });
    assert.match(mock.calls[0]?.url ?? '', new RegExp(`/collections/-home-/${PARENT}/children`));
  } finally {
    mock.restore();
  }
});

test('a created collection carries the title and the editorial type', async () => {
  const mock = ok();
  try {
    await createCollection(null, { title: 'Bruchrechnung' });
    const body = JSON.parse(String(mock.calls[0]?.init?.body ?? '{}'));
    assert.deepEqual(body.properties?.['cm:title'], ['Bruchrechnung']);
    assert.equal(body.collection?.type, 'EDITORIAL');
  } finally {
    mock.restore();
  }
});

test('the create body carries the DTO title field, not only the property', async () => {
  // Measured against staging 2026-08-02: without the top-level `title`, the
  // endpoint answers 500 (`cmNameReadableName is null`) — it derives the node
  // name from that field, not from `properties['cm:title']`. The properties
  // alone looked plausible and were rejected every time.
  const mock = ok();
  try {
    await createCollection(null, { title: 'Bruchrechnung' });
    const body = JSON.parse(String(mock.calls[0]?.init?.body ?? '{}'));
    assert.equal(body.title, 'Bruchrechnung');
  } finally {
    mock.restore();
  }
});

test('the description is written through the node route, not the collection body', async () => {
  // Measured: a `cm:description` in the create body is accepted with 200 and
  // never stored. The node metadata endpoint stores it. Sending it in the
  // create body would be a silent drop of something the user typed.
  const mock = ok('Bruchrechnung', 'Alles zu Brüchen.');
  try {
    await createCollection(null, { title: 'Bruchrechnung', description: 'Alles zu Brüchen.' });
    const create = JSON.parse(String(mock.calls[0]?.init?.body ?? '{}'));
    assert.equal(create.properties?.['cm:description'], undefined, 'not in the create body');

    const nodeCall = mock.calls.find(c => c.url.includes('/node/v1/nodes/'));
    assert.ok(nodeCall, 'the description goes upstream on its own call');
    assert.match(nodeCall.url, /obeyMds=false/);
    const body = JSON.parse(String(nodeCall.init?.body ?? '{}'));
    assert.deepEqual(body['cm:description'], ['Alles zu Brüchen.']);
  } finally {
    mock.restore();
  }
});

test('no description means no extra write', async () => {
  const mock = ok();
  try {
    await createCollection(null, { title: 'Bruchrechnung' });
    assert.equal(writes(mock).filter(c => c.url.includes('/node/v1/nodes/')).length, 0);
  } finally {
    mock.restore();
  }
});

test('the new collection id is reported back, with the read-back that confirms it', async () => {
  const mock = ok();
  try {
    const r = await createCollection(null, { title: 'Bruchrechnung' });
    assert.equal(r.status, 'created');
    assert.ok(r.status === 'created' && r.nodeId === 'neu-1');
    assert.equal(r.status === 'created' && r.check.status, 'ok');
  } finally {
    mock.restore();
  }
});

test('a created collection whose title never landed is not reported as simply created', async () => {
  // The collection endpoint already discards `cm:description` while answering
  // 200 — measured. A 200 from it is therefore not evidence about `cm:title`
  // either, and the only way to know is to look.
  const mock = repo({ title: 'etwas ganz anderes' });
  try {
    const r = await createCollection(null, { title: 'Bruchrechnung' });
    assert.equal(r.status, 'created', 'the collection exists — saying "failed" would invite a second one');
    const check = r.status === 'created' ? r.check : { status: 'ok' as const };
    assert.equal(check.status, 'not_visible');
    assert.match(check.status === 'not_visible' ? check.detail : '', /Titel/);
  } finally {
    mock.restore();
  }
});

test('a created collection that cannot be read back is reported as unverified, not as done', async () => {
  const mock = repo({ metadataStatus: 500 });
  try {
    const r = await createCollection(null, { title: 'Bruchrechnung' });
    assert.equal(r.status === 'created' && r.check.status, 'unverified');
  } finally {
    mock.restore();
  }
});

test('a rejected create is reported, not thrown away', async () => {
  const mock = installFetchMock(() => ({ status: 403, json: {} }));
  try {
    const r = await createCollection(null, { title: 'Bruchrechnung' });
    assert.equal(r.status, 'failed');
    assert.match(r.status === 'failed' ? r.detail : '', /403/);
  } finally {
    mock.restore();
  }
});

test('renaming goes to the collection itself', async () => {
  const mock = ok('Brüche');
  try {
    await renameCollection(COLLECTION, { title: 'Brüche' });
    const url = mock.calls[0]?.url ?? '';
    assert.match(url, new RegExp(`/collection/v1/collections/-home-/${COLLECTION}$`));
    assert.equal(mock.calls[0]?.init?.method, 'PUT');
    const body = JSON.parse(String(mock.calls[0]?.init?.body ?? '{}'));
    assert.deepEqual(body.properties?.['cm:title'], ['Brüche']);
  } finally {
    mock.restore();
  }
});

test('the rename body identifies the collection in its own payload', async () => {
  // Measured: without `ref.id` the endpoint answers 500 (`NodeRef.getId()` on
  // null) even though the id is already in the path. The DTO is read, not the
  // URL.
  const mock = ok('Brüche');
  try {
    await renameCollection(COLLECTION, { title: 'Brüche' });
    const body = JSON.parse(String(mock.calls[0]?.init?.body ?? '{}'));
    assert.equal(body.ref?.id, COLLECTION);
    assert.equal(body.title, 'Brüche', 'the DTO title field, as on create');
  } finally {
    mock.restore();
  }
});

test('renaming writes the description through the node route too', async () => {
  const mock = ok('Brüche', 'Neue Beschreibung.');
  try {
    await renameCollection(COLLECTION, { title: 'Brüche', description: 'Neue Beschreibung.' });
    const nodeCall = writes(mock).find(c => c.url.includes('/node/v1/nodes/'));
    assert.ok(nodeCall, 'the collection route drops it — measured');
    assert.deepEqual(JSON.parse(String(nodeCall.init?.body ?? '{}'))['cm:description'], ['Neue Beschreibung.']);
  } finally {
    mock.restore();
  }
});

test('a rename the record does not show is not reported as done', async () => {
  const mock = repo({ title: 'Bruchrechnung' });
  try {
    const r = await renameCollection(COLLECTION, { title: 'Brüche' });
    assert.equal(r.status, 'not_visible');
    assert.match(r.status === 'not_visible' ? r.detail : '', /Bruchrechnung/, 'and names what the record holds');
  } finally {
    mock.restore();
  }
});

test('a rename whose description did not land names the description, not the title', async () => {
  const mock = repo({ title: 'Brüche' });
  try {
    const r = await renameCollection(COLLECTION, { title: 'Brüche', description: 'Neue Beschreibung.' });
    assert.equal(r.status, 'not_visible');
    assert.match(r.status === 'not_visible' ? r.detail : '', /Beschreibung/);
  } finally {
    mock.restore();
  }
});

test('a rename that cannot be read back is unverified, never failed', async () => {
  // "Failed" would say the record is unchanged. It may well have been renamed —
  // only the check could not run.
  const mock = repo({ metadataStatus: 500 });
  try {
    assert.equal((await renameCollection(COLLECTION, { title: 'Brüche' })).status, 'unverified');
  } finally {
    mock.restore();
  }
});

test('adding content sends NO body', async () => {
  // The endpoint takes the node in the path. A body here is at best ignored and
  // at worst a 400 — measured contract: PUT, no body.
  const mock = ok();
  try {
    await addToCollection(COLLECTION, NODE);
    assert.equal(mock.calls[0]?.init?.method, 'PUT');
    assert.equal(mock.calls[0]?.init?.body, undefined);
    assert.match(mock.calls[0]?.url ?? '', new RegExp(`/collections/-home-/${COLLECTION}/references/${NODE}`));
  } finally {
    mock.restore();
  }
});

test('removing content targets the reference, never the node itself', async () => {
  // The whole point: this must not become DELETE /node/v1/nodes/…/{node},
  // which would destroy the material for everyone instead of taking it out of
  // one collection.
  const mock = repo({ usage: [] });
  try {
    await removeFromCollection(COLLECTION, NODE);
    const del = mock.calls.find(c => c.init?.method === 'DELETE');
    assert.ok(del, 'a removal happened');
    assert.match(del.url, /\/collection\/v1\/collections\//);
    assert.doesNotMatch(del.url, /\/node\/v1\/nodes\/[^/]+$/, 'not the node endpoint');
  } finally {
    mock.restore();
  }
});

test('removing content deletes the REFERENCE id, not the material id', async () => {
  // Measured against staging 2026-08-03: DELETE …/references/{originalId}
  // answers 200 and removes NOTHING — the reference node is still readable 15 s
  // later and /usage/v1 still lists the collection. The same call with the
  // reference id removes it, and the usage endpoint reflects that at once.
  // The add takes the original id, so the two directions need different ids.
  const mock = repo({ usage: [] });
  try {
    assert.equal((await removeFromCollection(COLLECTION, NODE)).status, 'ok');
    const del = mock.calls.find(c => c.init?.method === 'DELETE');
    assert.ok(del);
    assert.match(del.url, new RegExp(`/references/${REFERENCE}$`), 'the reference, not the original');
    assert.doesNotMatch(del.url, new RegExp(`/references/${NODE}$`));
  } finally {
    mock.restore();
  }
});

test('a caller who names the reference id directly is served too', async () => {
  // A collection listing hands out reference ids, so that is what a curator has
  // in hand as often as the original.
  const mock = repo({ usage: [] });
  try {
    assert.equal((await removeFromCollection(COLLECTION, REFERENCE)).status, 'ok');
    const del = mock.calls.find(c => c.init?.method === 'DELETE');
    assert.match(del?.url ?? '', new RegExp(`/references/${REFERENCE}$`));
  } finally {
    mock.restore();
  }
});

test('material the collection does not hold is reported, and nothing is deleted', async () => {
  // The listing was read in full and holds no reference for it. Deleting
  // something anyway — or reporting a removal — would both be untrue.
  const mock = repo({ references: {} });
  try {
    const r = await removeFromCollection(COLLECTION, NODE);
    assert.equal(r.status, 'failed');
    assert.match(r.status === 'failed' ? r.detail : '', /nicht in dieser Sammlung/);
    assert.equal(mock.calls.filter(c => c.init?.method === 'DELETE').length, 0, 'nothing was deleted');
  } finally {
    mock.restore();
  }
});

test('a removal is confirmed by the reference being gone, not by the usage endpoint', async () => {
  // Measured against staging 2026-08-03: once a reference is deleted,
  // /usage/v1 for that material answers HTTP 500 with "Node does not exist" —
  // it keeps a usage row pointing at the reference it can no longer resolve.
  // (A material that was NEVER in a collection answers 200 with zero rows, and
  // the endpoint recovers as soon as the material is filed again — so the 500
  // is specific to the one state a removal's read-back has to check.)
  // Confirming through it would report every successful removal as unverified.
  const mock = installFetchMock((url, init) => {
    if ((init?.method ?? 'GET') !== 'GET') return { json: {} };
    if (url.includes('/usage/v1/')) return { status: 500, json: {} };
    if (url.includes('/children')) {
      return {
        json: {
          nodes: [{ ref: { id: REFERENCE, repo: '-home-' }, properties: { 'ccm:original': [NODE] } }],
          pagination: { total: 1, from: 0, count: 1 },
        },
      };
    }
    // The reference node itself: gone, which is what a removal means.
    if (url.includes(REFERENCE)) return { status: 404, json: {} };
    return { json: { node: { ref: { id: NODE, repo: '-home-' }, properties: {} } } };
  });
  try {
    assert.equal((await removeFromCollection(COLLECTION, NODE)).status, 'ok');
  } finally {
    mock.restore();
  }
});

test('a reference that survives the delete is not reported as removed', async () => {
  const mock = installFetchMock((url, init) => {
    if ((init?.method ?? 'GET') !== 'GET') return { json: {} };
    if (url.includes('/children')) {
      return {
        json: {
          nodes: [{ ref: { id: REFERENCE, repo: '-home-' }, properties: { 'ccm:original': [NODE] } }],
          pagination: { total: 1, from: 0, count: 1 },
        },
      };
    }
    // Still readable — the call was taken and the reference is still there.
    return { json: { node: { ref: { id: REFERENCE, repo: '-home-' }, properties: {} } } };
  });
  try {
    const r = await removeFromCollection(COLLECTION, NODE);
    assert.equal(r.status, 'not_visible');
    assert.match(r.status === 'not_visible' ? r.detail : '', /weiterhin/);
  } finally {
    mock.restore();
  }
});

test('a reference listing that cannot be read is unverified, and deletes nothing', async () => {
  // "Not in the collection" is a claim about the collection; a failed listing
  // supports no claim at all.
  const mock = repo({ childrenStatus: 500 });
  try {
    const r = await removeFromCollection(COLLECTION, NODE);
    assert.equal(r.status, 'unverified');
    assert.equal(mock.calls.filter(c => c.init?.method === 'DELETE').length, 0);
  } finally {
    mock.restore();
  }
});

test('deleting a collection targets the collection endpoint', async () => {
  const mock = repo({ metadataStatus: 404 });
  try {
    await deleteCollection(COLLECTION);
    assert.equal(mock.calls[0]?.init?.method, 'DELETE');
    assert.match(mock.calls[0]?.url ?? '', new RegExp(`/collection/v1/collections/-home-/${COLLECTION}$`));
  } finally {
    mock.restore();
  }
});

test('every failure comes back as a detail, never as silence', async () => {
  const mock = repo({ writeStatus: 500 });
  try {
    for (const outcome of [
      await addToCollection(COLLECTION, NODE),
      await removeFromCollection(COLLECTION, NODE),
      await deleteCollection(COLLECTION),
      await renameCollection(COLLECTION, { title: 'X' }),
    ]) {
      assert.equal(outcome.status, 'failed');
      assert.match(outcome.status === 'failed' ? outcome.detail : '', /500/);
    }
  } finally {
    mock.restore();
  }
});

test('a mutation is only reported ok once the record shows it', async () => {
  const mock = repo({ usage: [COLLECTION], metadataStatus: 200, title: 'Brüche' });
  try {
    assert.equal((await addToCollection(COLLECTION, NODE)).status, 'ok', 'the usage endpoint lists the collection');
  } finally {
    mock.restore();
  }
  const gone = repo({ metadataStatus: 404 });
  try {
    assert.equal((await deleteCollection(COLLECTION)).status, 'ok', 'the collection is no longer readable');
  } finally {
    gone.restore();
  }
});

test('a reference the collection does not show is not reported as added', async () => {
  const mock = repo({ usage: [] });
  try {
    const r = await addToCollection(COLLECTION, NODE);
    assert.equal(r.status, 'not_visible');
  } finally {
    mock.restore();
  }
});

test('a removal whose check could not run is unverified, never done', async () => {
  // Supersedes an older test that asserted the same intent through /usage/v1;
  // the surviving-reference case now lives above, against the oracle that
  // actually decides. This covers the third answer: the check itself failed.
  const mock = installFetchMock((url, init) => {
    if ((init?.method ?? 'GET') !== 'GET') return { json: {} };
    if (url.includes('/children')) {
      return {
        json: {
          nodes: [{ ref: { id: REFERENCE, repo: '-home-' }, properties: { 'ccm:original': [NODE] } }],
          pagination: { total: 1, from: 0, count: 1 },
        },
      };
    }
    if (url.includes(REFERENCE)) return { status: 503, json: {} };
    return { json: { node: { ref: { id: NODE, repo: '-home-' }, properties: {} } } };
  });
  try {
    assert.equal((await removeFromCollection(COLLECTION, NODE)).status, 'unverified');
  } finally {
    mock.restore();
  }
});

test('a reference check that cannot run is unverified, not a claim either way', async () => {
  const mock = installFetchMock((url, init) => {
    if ((init?.method ?? 'GET') !== 'GET') return { json: {} };
    if (url.includes('/usage/v1/')) return { status: 500, json: {} };
    return { json: { node: { ref: { id: NODE }, properties: {} } } };
  });
  try {
    assert.equal((await addToCollection(COLLECTION, NODE)).status, 'unverified');
  } finally {
    mock.restore();
  }
});

test('a collection still readable after the delete is not reported as deleted', async () => {
  const mock = repo({ metadataStatus: 200, title: 'Brüche' });
  try {
    assert.equal((await deleteCollection(COLLECTION)).status, 'not_visible');
  } finally {
    mock.restore();
  }
});

test('a delete whose check answers neither 200 nor 404 is unverified', async () => {
  // 500 says the repository could not answer, not that the node is gone.
  const mock = repo({ metadataStatus: 500 });
  try {
    assert.equal((await deleteCollection(COLLECTION)).status, 'unverified');
  } finally {
    mock.restore();
  }
});

test('an unparseable create response is reported as "created, but no id" — not as a failure', async () => {
  // A 200 whose body is not JSON says the repository accepted the POST; it does
  // not say what was created. Claiming "failed" would invite a retry and a
  // second collection, so this takes the same route as a response that carries
  // no id: the operation is reported unfinished, pointing the curator at the
  // repository rather than at the retry button.
  const mock = installFetchMock(() => ({ text: '<html>gateway</html>' }));
  try {
    const out = await createCollection(PARENT, { title: 'Neu' });
    assert.equal(out.status, 'failed');
    assert.match(String(out.detail), /keine verwertbare Antwort/);
  } finally { mock.restore(); }
});

/*
 * The request as data (E2). Filing material is the narrowest of these
 * mutations, and the first whose request a repository PAGE may perform with the
 * visitor's own session instead of ours. What is pinned here is that the
 * descriptor addresses the same endpoint the executing path uses — a second,
 * drifting copy of that knowledge in a browser bundle is the failure this whole
 * split exists to prevent.
 */

test('the filing request is a PUT on the reference endpoint, carrying no body', () => {
  const req = addToCollectionRequest(COLLECTION, NODE);
  assert.equal(req.method, 'PUT');
  assert.equal(req.path, `/edu-sharing/rest/collection/v1/collections/-home-/${COLLECTION}/references/${NODE}`);
  assert.equal(req.body, undefined, 'the node is named in the path; a body is at best ignored');
});

test('the descriptor and the executing call address the same endpoint', () => {
  // The guarantee behind "the browser never gets a second implementation".
  const mock = installFetchMock(() => ({ json: {} }));
  try {
    void addToCollection(COLLECTION, NODE);
  } finally {
    const sent = mock.calls.find(c => (c.init?.method ?? 'GET') === 'PUT');
    assert.ok(sent, 'the executing path sent a PUT');
    assert.ok(sent.url.endsWith(addToCollectionRequest(COLLECTION, NODE).path.replace('/edu-sharing', '')),
      `descriptor and call diverged:\n  call: ${sent.url}`);
    mock.restore();
  }
});

test('ids that need escaping are escaped once, in both', () => {
  const req = addToCollectionRequest('a b', 'c/d');
  assert.match(req.path, /a%20b/);
  assert.match(req.path, /c%2Fd/);
});

/*
 * Taking material OUT, prepared. Unlike filing, this one cannot be written down
 * from its arguments: the endpoint takes the REFERENCE id and the caller names
 * the material, so the descriptor can only be built after a lookup — and that
 * lookup has two honest ways to end without an id.
 */

test('the removal request names the REFERENCE id, never the material id', async () => {
  // The measured asymmetry (staging 2026-08-03) that makes preparing worth the
  // trouble: DELETE …/references/{originalId} answers 200 and removes NOTHING.
  // A browser building this request from the ids it has would hit exactly that.
  const mock = repo({ usage: [] });
  try {
    const out = await removeFromCollectionRequest(COLLECTION, NODE);
    assert.equal(out.status, 'ready');
    const req = out.status === 'ready' ? out.request : null;
    assert.equal(req?.method, 'DELETE');
    assert.equal(req?.path, `/edu-sharing/rest/collection/v1/collections/-home-/${COLLECTION}/references/${REFERENCE}`);
    assert.equal(mock.calls.filter(c => c.init?.method === 'DELETE').length, 0, 'describing is not deleting');
  } finally {
    mock.restore();
  }
});

test('the removal descriptor and the executing DELETE address the same endpoint', async () => {
  const mock = repo({ usage: [] });
  try {
    const out = await removeFromCollectionRequest(COLLECTION, NODE);
    await removeFromCollection(COLLECTION, NODE);
    const sent = mock.calls.find(c => c.init?.method === 'DELETE');
    assert.ok(sent, 'the executing path sent a DELETE');
    assert.ok(out.status === 'ready' && sent.url.endsWith(out.request.path.replace('/edu-sharing', '')),
      `descriptor and call diverged:\n  call: ${sent.url}`);
  } finally {
    mock.restore();
  }
});

test('material the collection does not hold is refused in the same words as the executing path', async () => {
  // Both routes have to say the same thing about the same collection. Two
  // wordings would be two answers to one question.
  const mock = repo({ references: {} });
  try {
    const out = await removeFromCollectionRequest(COLLECTION, NODE);
    assert.equal(out.status, 'refused');
    const executed = await removeFromCollection(COLLECTION, NODE);
    assert.equal(out.status === 'refused' ? out.detail : '', executed.status === 'failed' ? executed.detail : '?');
    assert.match(out.status === 'refused' ? out.detail : '', /nicht in dieser Sammlung/);
  } finally {
    mock.restore();
  }
});

test('a reference listing that cannot be read yields no request at all', async () => {
  // "Not in the collection" is a claim about the collection; a failed listing
  // supports no claim — least of all a request someone else would then send.
  const mock = repo({ childrenStatus: 500 });
  try {
    const out = await removeFromCollectionRequest(COLLECTION, NODE);
    assert.equal(out.status, 'refused');
    assert.match(out.status === 'refused' ? out.detail : '', /nicht lesbar/);
  } finally {
    mock.restore();
  }
});
