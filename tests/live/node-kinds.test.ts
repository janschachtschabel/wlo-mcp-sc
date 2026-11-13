/**
 * tests/live/node-kinds.test.ts – what tells a COLLECTION from the other things
 * that share its node type.
 *
 * The curation tools decide by kind which endpoint a node is sent to, and the
 * first version of that check (audit 2026-11-12, K-1) read `type === 'ccm:map'`
 * as "is a collection". It is not: `ccm:map` is the repository's general
 * container. Measured 2026-11-12 against staging —
 *
 *   collection            ccm:map   aspects ∋ ccm:collection   DTO `collection` set
 *   page-config folder    ccm:map   no ccm:collection          `collection` null
 *   page variant          ccm:map   no ccm:collection          `collection` null
 *   reference in a coll.  ccm:io    aspects ∋ ccm:collection_io_reference, `originalId` set
 *
 * — the last three read anonymously off the public Wellenoptik collection. This
 * file pins the two kinds the server CREATES, because they are the ones whose
 * handling depends on the answer: a collection it made, and the folder a batch
 * filing lands in.
 *
 * Throwaway data only, in the service account's own home. Cleanup is part of
 * the contract.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { getCollectionContents, getNodeMetadata } from '../../src/wlo-node.js';
import { isCollectionNode, isContentNode } from '../../src/node-kind.js';
import { createCollection, deleteCollection } from '../../src/services/write/collections.js';
import { createBatchFolder } from '../../src/services/write/batch-filing.js';
import { deleteContentNode } from '../../src/services/write/nodes-lifecycle.js';
import { requireLiveTarget, runStamp } from './guard.js';

test('a collection carries the ccm:collection aspect — and is told apart by it', async () => {
  requireLiveTarget();
  const made = await createCollection(null, {
    title: `MCP-Knotenart ${runStamp}`,
    description: 'Wegwerf-Sammlung des Live-Vertragstests — darf gelöscht werden.',
  });
  if (made.status !== 'created') assert.fail(`Sammlung abgelehnt: ${JSON.stringify(made)}`);
  try {
    const node = await getNodeMetadata(made.nodeId);
    assert.ok(node, 'die angelegte Sammlung muss lesbar sein');
    console.log('collection:', node.type, JSON.stringify(node.aspects));
    assert.equal(node.type, 'ccm:map');
    assert.ok(node.aspects?.includes('ccm:collection'));
    assert.equal(isCollectionNode(node), true);
    // `aspects` is a top-level DTO field: a NARROW property filter must not drop
    // it, or a check reading through one would refuse every collection.
    const narrow = await getNodeMetadata(made.nodeId, ['cm:name']);
    assert.ok(narrow?.aspects?.includes('ccm:collection'), 'aspects survive a narrow propertyFilter');
  } finally {
    await deleteCollection(made.nodeId);
  }
});

test('the folder of a batch filing is NOT a collection, whatever type it reports', async () => {
  requireLiveTarget();
  const folder = await createBatchFolder(`MCP-Knotenart ${runStamp.replace(/[:.]/g, '-')}`);
  if (folder.status === 'denied') {
    console.log('folder: account may not create folders — nothing to measure');
    return;
  }
  if (folder.status !== 'created') assert.fail(`Ordner abgelehnt: ${JSON.stringify(folder)}`);
  try {
    const node = await getNodeMetadata(folder.nodeId);
    assert.ok(node, 'der angelegte Ordner muss lesbar sein');
    console.log('batch folder:', node.type, JSON.stringify(node.aspects));
    assert.equal(isCollectionNode(node), false);
    assert.notEqual(node.type, 'ccm:io', 'ein Ordner ist kein einzelner Datensatz');
  } finally {
    const gone = await deleteContentNode(folder.nodeId);
    console.log('folder cleanup:', gone.status);
  }
});

test('the personal area resolves to a container that is not a collection', async () => {
  requireLiveTarget();
  const node = await getNodeMetadata('-userhome-');
  assert.ok(node, '-userhome- muss für das angemeldete Konto lesbar sein');
  console.log('-userhome-:', node.type, JSON.stringify(node.aspects));
  assert.equal(isCollectionNode(node), false);
});

test('a reference in a collection is a record (ccm:io) — the delete and filing tools rely on it', async () => {
  requireLiveTarget();
  // Wellenoptik on staging: a public collection with filed material. Read-only.
  const page = await getCollectionContents('bf729405-18ff-440b-9d5b-dd466ff563c3', 'files', 10, 0);
  const references = page.nodes.filter(n => n.originalId && n.originalId !== n.ref?.id);
  if (references.length === 0) {
    console.log('references: the collection holds none right now — nothing to measure');
    return;
  }
  console.log('references:', references.length, [...new Set(references.map(n => n.type))].join(','));
  for (const n of references) assert.equal(isContentNode(n), true, `Verknüpfung ${n.ref?.id} meldet Typ ${n.type}`);
});
