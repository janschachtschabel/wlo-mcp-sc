/**
 * tests/live/collection-metadata.test.ts – where a collection's title and
 * description live, and what the node metadata route does with either spelling.
 *
 * The metadata tools are open for collections (user decision 2026-11-13:
 * editors maintain a collection's subject, level and keywords like a record's).
 * Their `title`/`description` parameters write `cclom:title` /
 * `cclom:general_description`, while the collection view reads `cm:title` /
 * `cm:description`. This file measures what that mismatch does, because the
 * routing in `services/write/collection-fields.ts` rests on it.
 *
 * Throwaway data only; cleanup is part of the contract.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { getNodeMetadata } from '../../src/wlo-node.js';
import { createCollection, deleteCollection, renameCollection } from '../../src/services/write/collections.js';
import { updateNodeMetadata } from '../../src/services/write/nodes.js';
import { requireLiveTarget, runStamp } from './guard.js';

const FIELDS = ['cm:title', 'cclom:title', 'cm:description', 'cclom:general_description', 'cm:name'];

async function snapshot(id: string): Promise<Record<string, string | undefined>> {
  const node = await getNodeMetadata(id);
  assert.ok(node, 'die Sammlung muss lesbar sein');
  const out: Record<string, string | undefined> = {
    'dto.title': node.title, 'collection.title': node.collection?.title, 'collection.description': node.collection?.description,
  };
  for (const f of FIELDS) out[f] = node.properties?.[f]?.[0];
  return out;
}

test('a collection: what the node metadata route stores for cclom:* and for cm:*', async () => {
  requireLiveTarget();
  const made = await createCollection(null, {
    title: `MCP-Sammlungsfelder ${runStamp}`,
    description: 'Wegwerf-Sammlung des Live-Vertragstests — darf gelöscht werden.',
  });
  if (made.status !== 'created') assert.fail(`Sammlung abgelehnt: ${JSON.stringify(made)}`);
  try {
    console.log('fresh      :', JSON.stringify(await snapshot(made.nodeId)));

    const a = await updateNodeMetadata(made.nodeId, {
      'cclom:title': [`LOM-Titel ${runStamp}`],
      'cclom:general_description': ['LOM-Beschreibung'],
    }, { commit: false });
    console.log('cclom write:', JSON.stringify(a.statuses));
    const afterLom = await snapshot(made.nodeId);
    console.log('after cclom:', JSON.stringify(afterLom));

    const b = await updateNodeMetadata(made.nodeId, {
      'cm:title': [`CM-Titel ${runStamp}`],
      'cm:description': ['CM-Beschreibung'],
    }, { commit: false });
    console.log('cm write   :', JSON.stringify(b.statuses));
    const afterCm = await snapshot(made.nodeId);
    console.log('after cm   :', JSON.stringify(afterCm));

    const renamed = await renameCollection(made.nodeId, { title: `Umbenannt ${runStamp}`, description: 'Neu beschrieben' });
    console.log('rename     :', JSON.stringify(renamed));
    console.log('after ren. :', JSON.stringify(await snapshot(made.nodeId)));

    // The route the tools take for a collection: cm:* must land where the
    // collection view reads it.
    assert.equal(afterCm['cm:title'], `CM-Titel ${runStamp}`);
    assert.equal(afterCm['cm:description'], 'CM-Beschreibung');
  } finally {
    await deleteCollection(made.nodeId);
  }
});
