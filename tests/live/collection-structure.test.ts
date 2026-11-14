/**
 * tests/live/collection-structure.test.ts – what the repository does with the
 * requests of the collection-structure tools (plan 2026-11-14).
 *
 *   - S3: a NEW collection keeps subject, level and keywords written on the
 *     node route beside its description (`createCollection` with `extra`).
 *   - S1: the children listing ignores a set order unless asked with the sort
 *     parameter; asked that way, a child without a position follows those with
 *     one. This is the rule `getChildCollectionsResult({ stored: true })` and
 *     `list_collection_tree` rest on.
 *
 * Throwaway data only; cleanup is part of the contract.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { BASE_URL } from '../../src/wlo-config.js';
import { wloFetch } from '../../src/wlo-fetch.js';
import { getChildCollectionsResult, getNodeMetadata } from '../../src/wlo-node.js';
import { createCollection, deleteCollection } from '../../src/services/write/collections.js';
import { listCollectionTree } from '../../src/services/collection-tree-flat.js';
import { resolveVocab } from '../../src/vocabs.js';
import { requireLiveTarget, runStamp } from './guard.js';

async function make(parent: string | null, title: string, extra?: Record<string, string[]>): Promise<string> {
  const made = await createCollection(parent, { title, ...(extra ? { extra } : {}) });
  if (made.status !== 'created') assert.fail(`Sammlung abgelehnt: ${JSON.stringify(made)}`);
  if (extra) assert.equal(made.check.status, 'ok', `Rücklesen: ${JSON.stringify(made.check)}`);
  return made.nodeId;
}

test('S3: a new collection keeps subject, level and keywords, and the read-back finds them', async () => {
  requireLiveTarget();
  const physik = resolveVocab('Physik', 'discipline')!;
  const sek1 = resolveVocab('Sekundarstufe I', 'educationalContext')!;
  const extra = { 'ccm:taxonid': [physik], 'ccm:educationalcontext': [sek1], 'cclom:general_keyword': ['Lehrplan', `mcp-${runStamp}`] };
  const id = await make(null, `MCP-Struktur S3 ${runStamp}`, extra);
  try {
    const node = await getNodeMetadata(id);
    assert.ok(node);
    for (const [property, values] of Object.entries(extra)) {
      assert.deepEqual(node.properties?.[property], values, property);
    }
  } finally {
    assert.equal((await deleteCollection(id)).status, 'ok', `NICHT GELÖSCHT: ${id}`);
  }
});

test('S1: a set order is returned only when asked for; a child without a position follows; the flat list reads it', async () => {
  requireLiveTarget();
  const root = await make(null, `MCP-Struktur S1 ${runStamp}`);
  try {
    const c = await make(root, 'C');
    const a = await make(root, 'A');
    const b = await make(root, 'B');
    const ids = async (stored: boolean) => (await getChildCollectionsResult(root, 50, 0, ['cm:title'], { stored })).nodes.map(n => n.ref?.id);
    assert.deepEqual(await ids(false), [c, a, b], 'ohne Parameter: Anlege-Reihenfolge');
    assert.deepEqual(await ids(true), [c, a, b], 'mit Parameter, ohne gesetzte Reihenfolge: ebenfalls');

    const res = await wloFetch(`${BASE_URL}/collection/v1/collections/-home-/${root}/order`, {
      method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/json' }, body: JSON.stringify([b, c, a]),
    });
    assert.equal(res.status, 200);
    assert.deepEqual(await ids(false), [c, a, b], 'ohne Parameter bleibt es bei der Anlege-Reihenfolge');
    assert.deepEqual(await ids(true), [b, c, a]);

    const d = await make(root, 'D');
    assert.deepEqual(await ids(true), [b, c, a, d], 'ein Kind ohne Position steht dahinter');

    const flat = await listCollectionTree({ rootId: root, depth: 2, maxItems: 250, skipCount: 0, includeContentCounts: true });
    assert.deepEqual(flat.items.map(i => i.nodeId), [b, c, a, d]);
    assert.deepEqual(flat.items.map(i => i.contentCount), [0, 0, 0, 0]);
    assert.equal(flat.items[0]!.path.length, 2);
  } finally {
    assert.equal((await deleteCollection(root)).status, 'ok', `NICHT GELÖSCHT: ${root}`);
  }
});
