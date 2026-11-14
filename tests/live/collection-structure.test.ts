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
import { isAlreadyFiled } from '../../src/services/write/create-filing.js';
import { filingStep, resolvePairs } from '../../src/services/write/filing-plan.js';
import { removeStep, resolveRemovals } from '../../src/services/write/remove-plan.js';
import { deleteEmptyStep, resolveDeletions } from '../../src/services/write/delete-empty-plan.js';
import { planOrder, readOrderable, setCollectionOrder } from '../../src/services/write/collection-order.js';
import { flattenTree, treeStep } from '../../src/services/write/collection-tree.js';
import { deleteContentNode } from '../../src/services/write/nodes-lifecycle.js';
import type { ItemState } from '../../src/services/write/plan-runner.js';
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

// ── package 3: order of contents, removing, moving, deleting empty ones ─────

/** A bare record in the caller's home — enough to be filed; deleted by the test. */
async function record(label: string): Promise<string> {
  const res = await wloFetch(`${BASE_URL}/node/v1/nodes/-home-/-userhome-/children?type=ccm%3Aio&renameIfExists=true`, {
    method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ 'cm:name': [`mcp-${label}-${runStamp.replace(/[:.]/g, '-')}.txt`], 'cclom:title': [`MCP ${label} ${runStamp}`] }),
  });
  const id = ((await res.json()) as { node?: { ref?: { id?: string } } }).node?.ref?.id;
  assert.ok(id, `Datensatz ${label} nicht angelegt (HTTP ${res.status})`);
  return id;
}

test('P3: contents are ordered by their REFERENCE ids, a move files first and removes then, and only empty collections are deleted', async () => {
  requireLiveTarget();
  const root = await make(null, `MCP-Struktur P3 ${runStamp}`);
  const records: string[] = [];
  try {
    const optik = await make(root, 'Optik');
    const mechanik = await make(root, 'Mechanik');
    const leer = await make(root, 'Leer');
    const leerKind = await make(leer, 'Leer darunter');
    for (const label of ['m1', 'm2', 'm3']) records.push(await record(label));
    const [m1, m2, m3] = records as [string, string, string];

    // Filing in a batch: the step of wlo_add_to_collections.
    const filing = await resolvePairs(records.map(nodeId => ({ nodeId, collectionId: optik })));
    assert.ok(filing.ok, JSON.stringify(filing));
    for (const item of filing.items) assert.equal((await filingStep(item, undefined)).status, 'added');

    // Order of the contents: originals are named, the references are sent.
    const have = await readOrderable(optik);
    assert.ok(have.ok);
    assert.equal(have.contents.length, 3);
    assert.ok(have.contents.every(c => c.materialId && c.materialId !== c.id), 'eine Sammlung hält Verweise mit eigener Kennung');
    const ordered = planOrder(have, [m3, m1, m2]);
    assert.ok(ordered.ok, JSON.stringify(ordered));
    assert.equal((await setCollectionOrder(optik, ordered.kind, ordered.children.map(c => c.id))).status, 'ok');
    const after = await readOrderable(optik);
    assert.ok(after.ok);
    assert.deepEqual(after.contents.map(c => c.materialId), [m3, m1, m2]);
    assert.equal(planOrder(after, [m3, m1, m2]).ok, false, 'dieselbe gesetzte Reihenfolge ist keine Änderung');

    // MOVE m1 from Optik to Mechanik.
    const move = await resolvePairs([{ nodeId: m1, collectionId: mechanik, removeFrom: optik }]);
    assert.ok(move.ok, JSON.stringify(move));
    assert.equal((await filingStep(move.items[0]!, undefined)).status, 'moved');
    const inOptik = await readOrderable(optik);
    const inMechanik = await readOrderable(mechanik);
    assert.ok(inOptik.ok && inMechanik.ok);
    assert.deepEqual(inOptik.contents.map(c => c.materialId), [m3, m2]);
    assert.deepEqual(inMechanik.contents.map(c => c.materialId), [m1]);
    // What the repository says about m1 afterwards — the usage endpoint was measured to answer 500
    // for a material after one of its references was deleted (2026-08-03).
    console.log('usage of the moved record after the move:', JSON.stringify(await isAlreadyFiled(m1, mechanik)));

    // Removing in a batch: one in, one not in.
    const removal = await resolveRemovals([{ nodeId: m2, collectionId: optik }, { nodeId: m2, collectionId: mechanik }]);
    assert.ok(removal.ok, JSON.stringify(removal));
    assert.deepEqual([...removal.absent], [`${m2}>${mechanik}`]);
    assert.equal((await removeStep(removal.items[0]!, undefined)).status, 'removed');
    assert.equal((await removeStep(removal.items[1]!, undefined)).status, 'absent');

    // Deleting: the empty chain goes, the two that hold a reference stay.
    const deletion = await resolveDeletions([leer, optik, leerKind, mechanik]);
    assert.ok(deletion.ok, JSON.stringify(deletion));
    assert.deepEqual([...deletion.notEmpty.keys()].sort(), [optik, mechanik].sort());
    const step = deleteEmptyStep();
    const outcome: Record<string, string> = {};
    for (const item of deletion.items) outcome[item.nodeId] = (await step(item, undefined)).status;
    assert.deepEqual(outcome, { [leerKind]: 'deleted', [leer]: 'deleted', [optik]: 'not_empty', [mechanik]: 'not_empty' });
    assert.equal(await getNodeMetadata(leer), null);
    assert.ok(await getNodeMetadata(optik));
  } finally {
    assert.equal((await deleteCollection(root)).status, 'ok', `NICHT GELÖSCHT: ${root}`);
    for (const id of records) {
      const gone = await deleteContentNode(id);
      assert.equal(gone.status, 'ok', `NICHT GELÖSCHT: ${id} ${JSON.stringify(gone)}`);
    }
  }
});

test('P3: a tree created in one plan stands in the order of its input', async () => {
  requireLiveTarget();
  const root = await make(null, `MCP-Struktur Baum ${runStamp}`);
  try {
    const flat = flattenTree([{ title: 'Zeta' }, { title: 'Alpha', children: [{ title: 'Zwei' }, { title: 'Eins' }] }, { title: 'Mitte' }]);
    assert.ok(flat.ok);
    const stored = { items: flat.items, state: new Map<string, ItemState>(flat.items.map(i => [i.key, { status: 'pending' }])) };
    const step = treeStep(root, stored as never, 'merge');
    for (const item of flat.items) {
      stored.state.set(item.key, await step(item, item.after ? stored.state.get(item.after) : undefined));
    }
    assert.deepEqual([...stored.state.values()].map(s => [s.status, s.code]), flat.items.map(() => ['created', undefined]));
    const tree = await listCollectionTree({ rootId: root, depth: 2, maxItems: 250, skipCount: 0, includeContentCounts: false });
    assert.deepEqual(tree.items.map(i => i.title), ['Zeta', 'Alpha', 'Mitte', 'Zwei', 'Eins']);
    const level1 = await readOrderable(root);
    assert.ok(level1.ok && level1.collections.every(c => c.hasPosition), 'die Reihenfolge ist ausdrücklich gesetzt');
  } finally {
    assert.equal((await deleteCollection(root)).status, 'ok', `NICHT GELÖSCHT: ${root}`);
  }
});
