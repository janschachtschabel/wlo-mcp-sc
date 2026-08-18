/**
 * tests/live/reference-delete.test.ts – what a deletion aimed at a collection
 * REFERENCE actually removes.
 *
 * The question had to be answered before anything was built (plan 2026-08-17,
 * T0.1), because the id a caller naturally passes IS a reference — a collection
 * listing hands out nothing else — and if the repository followed it to the
 * original, tidying a collection would destroy the material for everyone.
 *
 * It does not. Measured 2026-08-17 against staging: the reference is gone (404)
 * and the original is untouched (200). So there is no data loss here, and the
 * consequence runs the OTHER way: `wlo_delete_content` reports a deletion that
 * is true of the node it was handed and false of the material, which survives
 * under its own id and in every other collection.
 *
 * That is why this file also pins the boundary of the write-target resolution:
 * deletion must NOT be redirected to the original. Metadata writes are
 * redirected because a write to a reference is a silent local override; a
 * deletion redirected the same way would turn today's harmless behaviour into
 * exactly the data loss this measurement was looking for.
 *
 * Throwaway data only, in the service account's own home. Cleanup is part of
 * the contract.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { readNodeMetadata } from '../../src/wlo-node.js';
import { deleteContentNode } from '../../src/services/write/nodes-lifecycle.js';
import { requireLiveTarget, runStamp } from './guard.js';
import { markdownFile, withReference } from './fixtures.js';

test('a delete aimed at a reference removes the REFERENCE — the original survives', async () => {
  requireLiveTarget();

  await withReference(
    `MCP-Loeschtest ${runStamp}`,
    markdownFile('SKILL', '# Ursprung\n'),
    async ({ originalId, referenceId }) => {
      const outcome = await deleteContentNode(referenceId);
      assert.equal(outcome.status, 'ok', `Löschen abgelehnt: ${JSON.stringify(outcome)}`);

      // On the HTTP status, not on `getNodeMetadata`'s null: that folds every
      // non-OK answer into one value, so a 500 would read as "gone" and confirm
      // a deletion the repository may not have performed. Same reason
      // `confirmDeleted` reads the status.
      const reference = await readNodeMetadata(referenceId, ['cm:name']);
      assert.equal(reference.status, 404, 'die Verknüpfung selbst ist verschwunden');

      const original = await readNodeMetadata(originalId, ['cm:name']);
      assert.equal(
        original.status,
        200,
        'das Original überlebt — ein Löschvorgang auf eine Verknüpfung ist kein Datenverlust, '
          + 'aber auch keine Löschung des Materials',
      );
      assert.ok(original.node, 'und es ist weiterhin lesbar');
    },
  );
});
