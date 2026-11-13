/**
 * tests/live/suggestions.test.ts – proposals, and deciding on them, against a
 * real repository (audit 2026-11-12, T-2; the changes of K-8 … K-10).
 *
 * Everything about the suggestion tools was last measured on 2026-08-01, and
 * the code changed on 2026-11-13 in ways only a repository can confirm:
 *
 *   - a decision is now READ BACK, so the tool depends on `GET` showing the
 *     status a `PATCH` set — on the very node it was set on;
 *   - a proposal for a field that holds several values is ADDED on accept, so
 *     the metadata write carries the whole list and must come back as one;
 *   - `createSuggestions` treats an answer naming no proposal as open, so the
 *     answer must name what it stored.
 *
 * One throwaway record in the account's own home, deleted in `finally`.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { getNodeMetadata } from '../../src/wlo-node.js';
import { validateField } from '../../src/services/write/fields.js';
import { createContentNode, deleteContentNode } from '../../src/services/write/nodes-lifecycle.js';
import { updateNodeMetadata } from '../../src/services/write/nodes.js';
import {
  createSuggestions, listSuggestions, setSuggestionStatus, valuesAfterAccept,
} from '../../src/services/write/suggestions.js';
import { requireLiveTarget, runStamp } from './guard.js';

const uri = (label: string): string => {
  const v = validateField('ccm:taxonid', label);
  assert.ok(v.ok, label);
  return v.values[0]!;
};

test('proposals are named when stored, a decision reads back, and accepting adds to a list', async () => {
  requireLiveTarget();
  const mathe = uri('Mathematik');
  const physik = uri('Physik');

  const created = await createContentNode(
    {
      'ccm:wwwurl': [`https://example.org/wlo-mcp-live-suggestions/${Date.now()}`],
      'cclom:title': [`MCP-Vorschlagstest ${runStamp}`],
      'cclom:general_description': ['Wegwerf-Datensatz des Live-Tests — darf gelöscht werden.'],
      'ccm:taxonid': [mathe],
    },
    { mode: 'user' },
  );
  if (created.status !== 'created') assert.fail(`create abgelehnt: ${JSON.stringify(created)}`);
  const nodeId = created.nodeId;

  try {
    // ── K-9: the answer names what it stored ────────────────────────────────
    const stored = await createSuggestions(nodeId, [
      { propertyId: 'cclom:title', value: 'Ein besserer Titel', description: 'Live-Test: wird abgelehnt.' },
      { propertyId: 'ccm:taxonid', value: physik, description: 'Live-Test: wird angenommen.' },
    ]);
    console.log('create:', JSON.stringify(stored).slice(0, 400));
    assert.equal(stored.ok, true, 'the repository must accept and NAME the proposals');
    if (!stored.ok) return;
    assert.equal(stored.suggestions.length, 2, 'as many named as sent');
    const title = stored.suggestions.find(s => s.propertyId === 'cclom:title')!;
    const subject = stored.suggestions.find(s => s.propertyId === 'ccm:taxonid')!;
    assert.ok(title?.id && subject?.id);

    const listed = await listSuggestions(nodeId);
    console.log('list:', listed.map(s => `${s.propertyId}=${s.status}`).join(', '));
    assert.deepEqual(listed.map(s => s.status).sort(), ['PENDING', 'PENDING']);

    // ── K-10: a decision is visible where it was set ────────────────────────
    const declined = await setSuggestionStatus(nodeId, title.id, 'DECLINED');
    console.log('decline:', JSON.stringify(declined));
    assert.deepEqual(declined, { ok: true }, 'PATCH, then GET shows DECLINED');
    assert.equal((await listSuggestions(nodeId, 'DECLINED')).some(s => s.id === title.id), true, 'and the status filter finds it');

    // What the REPOSITORY does with a second decision — measured, not asserted:
    // our tool refuses it itself (`already_decided`), whatever this says.
    const again = await setSuggestionStatus(nodeId, title.id, 'ACCEPTED');
    console.log('accept-after-decline (repository alone):', JSON.stringify(again));
    if (again.ok) await setSuggestionStatus(nodeId, title.id, 'DECLINED');

    // ── K-8: accepting ADDS to a field that holds several values ────────────
    const before = (await getNodeMetadata(nodeId))?.properties?.['ccm:taxonid'] ?? [];
    console.log('taxonid before:', JSON.stringify(before));
    assert.deepEqual(before, [mathe]);
    const after = valuesAfterAccept('ccm:taxonid', before, [subject.value]);
    assert.deepEqual(after, [mathe, physik]);
    const { statuses } = await updateNodeMetadata(nodeId, { 'ccm:taxonid': after }, { commit: false });
    assert.equal(statuses.every(s => s.ok), true, JSON.stringify(statuses));
    const readBack = (await getNodeMetadata(nodeId))?.properties?.['ccm:taxonid'] ?? [];
    console.log('taxonid after:', JSON.stringify(readBack));
    assert.deepEqual([...readBack].sort(), [mathe, physik].sort(), 'both subjects are on the record');

    const accepted = await setSuggestionStatus(nodeId, subject.id, 'ACCEPTED');
    console.log('accept:', JSON.stringify(accepted));
    assert.deepEqual(accepted, { ok: true });
  } finally {
    const gone = await deleteContentNode(nodeId);
    console.log('cleanup:', gone.status);
    assert.equal(gone.status, 'ok', `Datensatz ${nodeId} bitte von Hand entfernen`);
  }
});
