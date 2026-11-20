/**
 * live/delete-own.test.ts – wlo_delete_own_content against staging (plan
 * 2026-11-20). Proves the repository answers what the offline fake assumes:
 * the creator, the home, a filing folder, a reference's usage, the delete.
 *
 * Staging only (`requireLiveTarget`), own throwaway nodes, every one removed.
 * The configured account is used as a PERSONAL login here — "own" needs one.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { runWithCredential, type WloCredential } from '../../src/auth/credential.js';
import { getChildCollectionsResult, getCollectionContents, readNodeMetadata } from '../../src/wlo-node.js';
import { WLO_ROOT_COLLECTION_ID } from '../../src/wlo-config.js';
import { createContentNode, deleteContentNode } from '../../src/services/write/nodes-lifecycle.js';
import { addToCollection, createCollection, deleteCollection } from '../../src/services/write/collections.js';
import { createBatchFolder } from '../../src/services/write/batch-filing.js';
import { deleteOwnStep, resolveOwnDeletions } from '../../src/services/write/delete-own-plan.js';
import type { ItemState } from '../../src/services/write/plan-runner.js';
import { requireLiveTarget, runStamp } from './guard.js';
import { withCleanup, type Cleanup } from './cleanup.js';
import { markdownFile } from './fixtures.js';

function personal(): WloCredential {
  const user = process.env['WLO_SERVICE_USER'] ?? '';
  const password = process.env['WLO_SERVICE_PASSWORD'] ?? '';
  return { header: `Basic ${Buffer.from(`${user}:${password}`).toString('base64')}`, label: user, source: 'user' };
}

async function record(title: string, parent?: string): Promise<string> {
  // A file, as an outline the chatbot files is one.
  const file = markdownFile(title, `# ${title}

Wegwerf-Datei des Live-Tests — darf gelöscht werden.
`);
  const made = await createContentNode({ 'cclom:title': [title] }, { mode: 'user', file, ...(parent ? { parent } : {}) });
  if (made.status !== 'created') assert.fail(`Anlegen abgelehnt: ${JSON.stringify(made)}`);
  return made.nodeId;
}

test('own records in the home and in a filing folder are deleted; a referenced one stays in_use; a foreign one stays not_own', async () => {
  requireLiveTarget();
  await runWithCredential(personal(), async () => {
    const cleanups: Cleanup[] = [];
    await withCleanup(async () => {
      const flat = await record(`MCP-Eigen flach ${runStamp}`);
      cleanups.push([flat, () => deleteContentNode(flat)]);
      const folder = await createBatchFolder(`MCP-Eigen Ordner ${runStamp}`);
      assert.equal(folder.status, 'created', JSON.stringify(folder));
      const folderId = folder.status === 'created' ? folder.nodeId : '';
      cleanups.push([folderId, () => deleteContentNode(folderId)]);
      const inner = await record(`MCP-Eigen im Ordner ${runStamp}`, folderId);
      cleanups.unshift([inner, () => deleteContentNode(inner)]);
      const used = await record(`MCP-Eigen verwendet ${runStamp}`);
      cleanups.push([used, () => deleteContentNode(used)]);
      const collection = await createCollection(null, { title: `MCP-Eigen Sammlung ${runStamp}` });
      assert.equal(collection.status, 'created', JSON.stringify(collection));
      const collectionId = collection.status === 'created' ? collection.nodeId : '';
      cleanups.unshift([collectionId, () => deleteCollection(collectionId)]);
      assert.equal((await addToCollection(collectionId, used)).status, 'ok');
      // A record somebody else created: the original behind a reference in a public subject collection.
      // Not a search hit — measured 2026-11-20, most search hits answer 404 at the metadata endpoint.
      let hit: string | undefined;
      const subjects = await getChildCollectionsResult(WLO_ROOT_COLLECTION_ID, 5, 0, ['cm:title']);
      for (const subject of subjects.nodes) {
        const page = await getCollectionContents(subject.ref?.id ?? '', 'files', 5, 0, ['ccm:original']);
        for (const ref of page.nodes) {
          const original = ref.properties?.['ccm:original']?.[0];
          if (original && (await readNodeMetadata(original, ['cm:creator'])).node) { hit = original; break; }
        }
        if (hit) break;
      }
      assert.ok(hit, 'a readable public record to stand for "foreign" was not found');

      const resolved = await resolveOwnDeletions([flat, inner, used, hit, collectionId]);
      assert.ok(resolved, 'who is asking and the home were readable');
      assert.deepEqual(Object.fromEntries(resolved.kept), { [used]: 'in_use', [hit]: 'not_own', [collectionId]: 'is_a_collection' });

      const step = deleteOwnStep();
      const states: Record<string, ItemState> = {};
      for (const item of resolved.items.filter(i => !resolved.kept.has(i.key))) states[item.nodeId] = await step(item, undefined);
      assert.deepEqual(Object.fromEntries(Object.entries(states).map(([k, v]) => [k, v.status])), { [flat]: 'deleted', [inner]: 'deleted' });
      for (const id of [flat, inner]) assert.equal((await readNodeMetadata(id)).status, 404, `${id} is gone`);
      // Both deleted: nothing left to clean for them.
      cleanups.splice(0, cleanups.length, ...cleanups.filter(([id]) => id !== flat && id !== inner));
    }, () => cleanups);
  });
});
