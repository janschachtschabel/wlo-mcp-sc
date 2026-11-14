/**
 * tests/live/collection-move-and-proposals.test.ts – what the repository does
 * with the requests of package 4 (plan 2026-11-14): moving a collection, and
 * proposing a material for a collection the caller may only READ.
 *
 * The second half needs TWO accounts: the service account owns a collection
 * and grants the test account (`WLO_TEST_USER`, no admin) read permission on
 * it. Without the second account that half is skipped — and says so.
 *
 * Throwaway data only; cleanup is part of the contract. No account name is
 * printed.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { BASE_URL } from '../../src/wlo-config.js';
import { wloFetch } from '../../src/wlo-fetch.js';
import { runWithCredential, type WloCredential } from '../../src/auth/credential.js';
import { createCollection, deleteCollection } from '../../src/services/write/collections.js';
import { readFilingTarget } from '../../src/services/write/create-filing.js';
import { moveCollection, planMove } from '../../src/services/write/collection-move.js';
import { decideProposal, listProposals, proposeForCollection } from '../../src/services/write/collection-proposals.js';
import { deleteContentNode } from '../../src/services/write/nodes-lifecycle.js';
import { listCollectionTree } from '../../src/services/collection-tree-flat.js';
import { requireLiveTarget, runStamp } from './guard.js';

const JSON_HEADERS = { Accept: 'application/json', 'Content-Type': 'application/json' };

async function make(parent: string | null, title: string): Promise<string> {
  const made = await createCollection(parent, { title });
  if (made.status !== 'created') assert.fail(`Sammlung abgelehnt: ${JSON.stringify(made)}`);
  return made.nodeId;
}
async function record(label: string): Promise<string> {
  const res = await wloFetch(`${BASE_URL}/node/v1/nodes/-home-/-userhome-/children?type=ccm%3Aio&renameIfExists=true`, {
    method: 'POST', headers: JSON_HEADERS,
    body: JSON.stringify({ 'cm:name': [`mcp-${label}-${runStamp.replace(/[:.]/g, '-')}.txt`], 'cclom:title': [`MCP ${label} ${runStamp}`] }),
  });
  const id = ((await res.json()) as { node?: { ref?: { id?: string } } }).node?.ref?.id;
  assert.ok(id, `Datensatz ${label} nicht angelegt (HTTP ${res.status})`);
  return id;
}

test('S5: a collection moves with its sub-tree and keeps its id; a namesake and the own sub-tree are refused before anything is sent', async () => {
  requireLiveTarget();
  const root = await make(null, `MCP-Struktur Umhängen ${runStamp}`);
  try {
    const a = await make(root, 'A');
    const a1 = await make(a, 'A1');
    const b = await make(root, 'B');

    const plan = await planMove(a, b);
    assert.ok(plan.ok, JSON.stringify(plan));
    assert.deepEqual([plan.from.nodeId, plan.to.nodeId, plan.subCount, plan.subMore], [root, b, 1, false]);
    assert.equal(plan.to.path.at(-1), 'B');
    assert.equal((await moveCollection(a, b)).status, 'ok');
    const below = await listCollectionTree({ rootId: b, depth: 2, maxItems: 50, skipCount: 0, includeContentCounts: false });
    assert.deepEqual(below.items.map(i => i.nodeId), [a, a1]);

    const again = await planMove(a, b);
    assert.deepEqual([again.ok, !again.ok && again.code], [false, 'no_change']);
    const cyclic = await planMove(b, a1);
    assert.deepEqual([cyclic.ok, !cyclic.ok && cyclic.code], [false, 'invalid_input']);
    const twin = await make(root, 'a ');
    const namesake = await planMove(twin, b);
    assert.deepEqual([namesake.ok, !namesake.ok && namesake.code, !namesake.ok && namesake.existingId], [false, 'exists', a]);
  } finally {
    assert.equal((await deleteCollection(root)).status, 'ok', `NICHT GELÖSCHT: ${root}`);
  }
});

test('S8: who may READ a collection and not write it may propose; who may write decides — accept files first, then marks', async (t) => {
  requireLiveTarget();
  const user = process.env['WLO_TEST_USER'];
  const password = process.env['WLO_TEST_PASSWORD'];
  if (!user || !password) { t.skip('WLO_TEST_USER / WLO_TEST_PASSWORD sind nicht gesetzt — ohne zweites Konto nicht messbar'); return; }
  const reader: WloCredential = { header: 'Basic ' + Buffer.from(`${user}:${password}`).toString('base64'), label: user, source: 'user' };
  const asReader = <T>(fn: () => Promise<T>) => runWithCredential(reader, fn);

  const collection = await make(null, `MCP-Struktur Vorschlag ${runStamp}`);
  let material: string | undefined;
  try {
    const granted = await wloFetch(`${BASE_URL}/node/v1/nodes/-home-/${collection}/permissions?sendMail=false&sendCopy=false`, {
      method: 'POST', headers: JSON_HEADERS,
      body: JSON.stringify({ inherited: true, permissions: [{ authority: { authorityName: user, authorityType: 'USER' }, permissions: ['Consumer'] }] }),
    });
    assert.equal(granted.status, 200, 'Leserecht für das Testkonto');
    material = await asReader(() => record('vorschlag'));

    // The reader sees on the collection itself that it may not write it.
    const seen = await asReader(() => readFilingTarget(collection));
    assert.ok(seen.ok && seen.target.readOnly === true, JSON.stringify(seen));
    const owned = await readFilingTarget(collection);
    assert.ok(owned.ok && owned.target.readOnly === undefined);

    assert.deepEqual(await asReader(() => proposeForCollection(collection, material!)), { status: 'proposed' });
    assert.deepEqual(await asReader(() => proposeForCollection(collection, material!)), { status: 'already_proposed' });
    const hidden = await asReader(() => listProposals(collection, 'PENDING'));
    assert.deepEqual([hidden.ok, !hidden.ok && hidden.httpStatus], [false, 403], 'der Vorschlagende sieht die Liste nicht');

    const pending = await listProposals(collection, 'PENDING');
    assert.ok(pending.ok);
    const proposal = pending.proposals.find(p => p.nodeId === material);
    assert.ok(proposal, 'der Vorschlag steht in der Liste derer, die schreiben dürfen');
    const tree = await listCollectionTree({ rootId: collection, depth: 1, maxItems: 10, skipCount: 0, includeContentCounts: false });
    assert.equal(tree.count, 0);

    assert.deepEqual(await decideProposal(collection, proposal, true), { status: 'accepted' });
    const accepted = await listProposals(collection, 'ACCEPTED');
    assert.ok(accepted.ok && accepted.proposals.some(p => p.proposalId === proposal.proposalId));
    const still = await listProposals(collection, 'PENDING');
    assert.ok(still.ok && !still.proposals.some(p => p.proposalId === proposal.proposalId));
  } finally {
    assert.equal((await deleteCollection(collection)).status, 'ok', `NICHT GELÖSCHT: ${collection}`);
    if (material) {
      const gone = await asReader(() => deleteContentNode(material!));
      assert.equal(gone.status, 'ok', `NICHT GELÖSCHT: ${material} ${JSON.stringify(gone)}`);
    }
  }
});
