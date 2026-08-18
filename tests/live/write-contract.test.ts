/**
 * tests/live/write-contract.test.ts – does the REPOSITORY accept what we send?
 *
 * The offline suite fakes the upstream (`tests/fetchMock.ts`), so it can only
 * prove the code sends what we decided to send — never that edu-sharing accepts
 * it. That gap has already cost two tools their entire function:
 * `wlo_create_collection` and `wlo_rename_collection` passed every test and had
 * never worked (research doc §9, 2026-08-02; audit 2026-08-12, finding 1). This
 * file closes the gap for the mutating contract — collection create → rename →
 * delete, record create → delete — with every assertion riding on the write
 * pipeline's own read-back, so "accepted" means "visible in the record", not
 * "answered 200".
 *
 * Deliberately OUTSIDE `npm test`: `scripts/run-tests.mjs` reads `tests/` FLAT,
 * so this subdirectory never runs offline or under netguard. Run it with
 * `npm run test:live` (see `scripts/run-live-tests.mjs`), which loads the
 * service credential from `.env` the same way the server does.
 *
 * Everything this file creates is a throwaway named after the run, and each
 * test deletes what it created — the delete IS part of the contract under test.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { requireLiveTarget, runStamp } from './guard.js';
import {
  createCollection,
  deleteCollection,
  renameCollection,
} from '../../src/services/write/collections.js';
import {
  createContentNode,
  deleteContentNode,
} from '../../src/services/write/nodes-lifecycle.js';
import type { MutationOutcome } from '../../src/services/write/verify.js';


test('collection contract: staging accepts create, rename and delete', async () => {
  requireLiveTarget();

  // The same call and parent (`-root-`) the 2026-08-02 live pass measured the
  // request bodies against, as the same service account.
  const created = await createCollection(null, {
    title: `MCP-Vertragstest ${runStamp}`,
    description: 'Wegwerf-Sammlung des Live-Vertragstests — darf gelöscht werden.',
  });
  if (created.status !== 'created') {
    assert.fail(`create wurde vom Repository abgelehnt: ${created.detail}`);
  }

  let cleanup: MutationOutcome | undefined;
  try {
    // `check` is the pipeline's own read-back: title AND description visible.
    assert.equal(
      created.check.status,
      'ok',
      `angelegt, aber nicht vollständig sichtbar: ${JSON.stringify(created.check)}`,
    );

    const renamed = await renameCollection(created.nodeId, {
      title: `MCP-Vertragstest ${runStamp} (umbenannt)`,
      description: 'Umbenannt vom Live-Vertragstest.',
    });
    assert.equal(renamed.status, 'ok', `rename kam nicht im Datensatz an: ${JSON.stringify(renamed)}`);
  } finally {
    // Runs even when an assertion above failed — a broken run must not litter
    // staging. Asserted AFTER the block so a cleanup problem cannot mask the
    // primary failure.
    cleanup = await deleteCollection(created.nodeId);
  }
  assert.equal(
    cleanup.status,
    'ok',
    `delete nicht bestätigt — Sammlung ${created.nodeId} bitte von Hand entfernen: ${JSON.stringify(cleanup)}`,
  );
});

test('content record contract: staging accepts create and delete', async () => {
  requireLiveTarget();

  // `mode: 'user'` files the record in the AUTHENTICATED account's own home
  // (here: the service user's), deliberately not the shared editorial inbox —
  // a contract test must not put throwaway records in the team's review view.
  // The URL is unique per run so the duplicate check cannot refuse a rerun.
  const created = await createContentNode(
    {
      'ccm:wwwurl': [`https://example.org/wlo-mcp-live-contract/${Date.now()}`],
      'cclom:title': [`MCP-Vertragstest ${runStamp}`],
      'cclom:general_description': ['Wegwerf-Datensatz des Live-Vertragstests — darf gelöscht werden.'],
    },
    { mode: 'user' },
  );
  if (created.status !== 'created') {
    assert.fail(`create wurde vom Repository abgelehnt: ${JSON.stringify(created)}`);
  }

  let cleanup: MutationOutcome | undefined;
  try {
    // The metadata step reports per field; a rejected title would make the
    // record unfindable, which is the silent failure this test exists to catch.
    const failed = created.statuses.filter(s => !s.ok);
    assert.equal(failed.length, 0, `Metadaten vom Repository abgelehnt: ${JSON.stringify(failed)}`);
  } finally {
    cleanup = await deleteContentNode(created.nodeId);
  }
  assert.equal(
    cleanup.status,
    'ok',
    `delete nicht bestätigt — Datensatz ${created.nodeId} bitte von Hand entfernen: ${JSON.stringify(cleanup)}`,
  );
});
