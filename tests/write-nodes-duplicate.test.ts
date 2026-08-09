/**
 * write-nodes-duplicate.test.ts – not creating the same record twice.
 *
 * The API-side check is "did any hit come back", which is too loose to build a
 * create flow on: `ngsearch` on `ccm:wwwurl` also returns neighbours, so a
 * search for one URL can answer with records that point somewhere else
 * entirely. Comparing the actual URL of each hit — case-insensitively, because
 * scheme and host are case-insensitive in practice and the repository stores
 * whatever the crawler found — is what makes the answer usable.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { findByUrl, findByTitle } from '../src/services/write/duplicates.js';
import { installFetchMock, makeNode } from './fetchMock.js';

/** One ngsearch response carrying the given `ccm:wwwurl` values. */
function serveHits(urls: string[]) {
  return installFetchMock(() => ({
    json: {
      nodes: urls.map((u, i) => ({
        ref: { id: `node-${i}`, repo: '-home-' },
        properties: { 'ccm:wwwurl': [u], 'cclom:title': [`Treffer ${i}`] },
      })),
      pagination: { total: urls.length, from: 0, count: urls.length },
    },
  }));
}

test('an exact match is found', async () => {
  const mock = serveHits(['https://example.org/material']);
  try {
    const hit = await findByUrl('https://example.org/material');
    assert.ok(hit);
    assert.equal(hit.nodeId, 'node-0');
    assert.equal(hit.title, 'Treffer 0');
  } finally {
    mock.restore();
  }
});

test('a match differing only in case is still a duplicate', async () => {
  const mock = serveHits(['https://Example.ORG/Material']);
  try {
    assert.ok(await findByUrl('https://example.org/material'));
  } finally {
    mock.restore();
  }
});

test('an unrelated hit in the result set is not treated as a duplicate', async () => {
  // This is the whole point: ngsearch answered, but with someone else's record.
  const mock = serveHits(['https://example.org/etwas-anderes']);
  try {
    assert.equal(await findByUrl('https://example.org/material'), null);
  } finally {
    mock.restore();
  }
});

test('the right record is picked out of a mixed result set', async () => {
  const mock = serveHits([
    'https://example.org/anderes',
    'https://example.org/material',
    'https://example.org/noch-etwas',
  ]);
  try {
    const hit = await findByUrl('https://example.org/material');
    assert.equal(hit?.nodeId, 'node-1');
  } finally {
    mock.restore();
  }
});

test('an empty result set means no duplicate', async () => {
  const mock = serveHits([]);
  try {
    assert.equal(await findByUrl('https://example.org/material'), null);
  } finally {
    mock.restore();
  }
});

test('the search asks for the URL property, not the display projection', async () => {
  // Without ccm:wwwurl in the projection every hit would compare as "no URL"
  // and no duplicate could ever be found.
  const mock = serveHits(['https://example.org/material']);
  try {
    await findByUrl('https://example.org/material');
    const url = mock.calls[0]?.url ?? '';
    assert.match(url, /propertyFilter=ccm%3Awwwurl|propertyFilter=ccm:wwwurl/);
    const body = JSON.parse(String(mock.calls[0]?.init?.body ?? '{}'));
    assert.deepEqual(body.criteria, [{ property: 'ccm:wwwurl', values: ['https://example.org/material'] }]);
  } finally {
    mock.restore();
  }
});

test('a trailing-slash difference is NOT silently treated as the same URL', async () => {
  // Two URLs that differ by a slash can be two different pages. Guessing here
  // would block a legitimate create with a wrong "already exists".
  const mock = serveHits(['https://example.org/material/']);
  try {
    assert.equal(await findByUrl('https://example.org/material'), null);
  } finally {
    mock.restore();
  }
});

// ── the second anchor: title, for a record that carries its own file ────────

/**
 * A file-carrying record has no `ccm:wwwurl`, so the URL anchor does not exist.
 * The title within the place the record would be filed is what is left — and it
 * is deliberately weaker: a hit WARNS rather than blocking, because two
 * worksheets may legitimately share a name and refusing to file the second one
 * would be worse than a duplicate somebody can merge.
 *
 * Scoped to the storage location on purpose. A repository-wide title search
 * would flag every record called "Bruchrechnung" and the warning would become
 * noise nobody reads.
 */
test('a same-title record in the storage location is found', async () => {
  const mock = installFetchMock(() => ({
    status: 200,
    json: {
      nodes: [
        makeNode('other', 'Etwas anderes'),
        makeNode('twin', 'Brüche kürzen'),
      ],
    },
  }));
  try {
    const hit = await findByTitle('Brüche kürzen', '-userhome-');
    assert.equal(hit?.nodeId, 'twin');
  } finally {
    mock.restore();
  }
});

test('the title comparison ignores case and surrounding space', async () => {
  const mock = installFetchMock(() => ({
    status: 200, json: { nodes: [makeNode('twin', 'Brüche Kürzen')] },
  }));
  try {
    assert.ok(await findByTitle('  brüche kürzen ', '-userhome-'));
  } finally {
    mock.restore();
  }
});

test('a different title in the same place is not a duplicate', async () => {
  const mock = installFetchMock(() => ({
    status: 200, json: { nodes: [makeNode('other', 'Etwas anderes')] },
  }));
  try {
    assert.equal(await findByTitle('Brüche kürzen', '-userhome-'), null);
  } finally {
    mock.restore();
  }
});

/**
 * The check is a courtesy, not a gate. If the listing fails, creating the record
 * must still be possible — an unreachable duplicate check that blocked the
 * create would turn a warning into an outage.
 */
test('a listing that fails degrades to "no duplicate known", not to an error', async () => {
  const mock = installFetchMock(() => ({ status: 500, json: {} }));
  try {
    assert.equal(await findByTitle('Brüche kürzen', '-userhome-'), null);
  } finally {
    mock.restore();
  }
});

test('an empty title is not looked up at all', async () => {
  const mock = installFetchMock(() => ({ status: 200, json: { nodes: [] } }));
  try {
    assert.equal(await findByTitle('   ', '-userhome-'), null);
    assert.equal(mock.calls.length, 0, 'no request for a title there is nothing to compare');
  } finally {
    mock.restore();
  }
});
