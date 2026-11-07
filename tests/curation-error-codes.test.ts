/**
 * curation-error-codes.test.ts – every curation error a program can meet
 * carries a code, and the record-plus-filing answer keeps it (chatbot feedback
 * 2026-11-07, finding 4). Before, `reportOutcome` and `unverifiedReply`
 * answered `isError` with text only, and `withFiling` replaced the structured
 * part wholesale — a partly stored create reached the chatbot as an error with
 * no code at all.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { reportOutcome, unverifiedReply } from '../src/tools/curation-shared.js';
import { withFiling } from '../src/tools/curation-create-filing.js';
import { buildChangeSet } from '../src/services/write/change-set.js';

const errorOf = (r: { structuredContent?: unknown }) =>
  (r.structuredContent as { error?: Record<string, unknown> } | undefined)?.error;

test('a field the repository dropped is reported with code not_stored', () => {
  const cs = buildChangeSet('n-1', 'content', {}, { 'cclom:title': ['Neu'] });
  const r = reportOutcome(cs, [], { outcomes: { 'cclom:title': 'dropped' }, allStored: false } as never);
  assert.equal(r.isError, true);
  assert.equal(errorOf(r)?.['code'], 'not_stored');
});

test('a fully stored write is no error and carries no error part', () => {
  const cs = buildChangeSet('n-1', 'content', {}, { 'cclom:title': ['Neu'] });
  const r = reportOutcome(cs, [], { outcomes: { 'cclom:title': 'stored' }, allStored: true } as never);
  assert.notEqual(r.isError, true);
  assert.equal(errorOf(r), undefined);
});

test('a write that could not be read back is reported with code unverified', () => {
  const r = unverifiedReply(new Error('lesen fehlgeschlagen'));
  assert.equal(r.isError, true);
  assert.equal(errorOf(r)?.['code'], 'unverified');
});

test('withFiling keeps the error part beside the record it adds', () => {
  const r = withFiling(unverifiedReply(new Error('x')), { nodeId: 'n-1', title: 'T' });
  const sc = r.structuredContent as Record<string, unknown>;
  assert.equal(sc['nodeId'], 'n-1');
  assert.equal(errorOf(r)?.['code'], 'unverified');
});

// outcomeOpen: false means exactly "this call wrote nothing" — the one reading
// under which a client may start over with a new preview.

test('every field refused or dropped → not_stored with outcomeOpen: false — nothing was written', () => {
  const cs = buildChangeSet('n-1', 'content', {}, { 'cclom:title': ['Neu'], 'cclom:general_description': ['D'] });
  const r = reportOutcome(cs, [{ property: 'cclom:title', ok: false, detail: '403' }] as never,
    { outcomes: { 'cclom:general_description': 'dropped' }, allStored: false } as never);
  assert.equal(errorOf(r)?.['outcomeOpen'], false);
});

test('one field stored beside a dropped one → outcomeOpen: true — something WAS written', () => {
  const cs = buildChangeSet('n-1', 'content', {}, { 'cclom:title': ['Neu'], 'cclom:general_description': ['D'] });
  const r = reportOutcome(cs, [], { outcomes: { 'cclom:title': 'stored', 'cclom:general_description': 'dropped' },
    allStored: false } as never);
  assert.equal(errorOf(r)?.['outcomeOpen'], true);
});

test('a value the repository stored DIFFERENTLY counts as written → outcomeOpen: true', () => {
  const cs = buildChangeSet('n-1', 'content', {}, { 'cclom:title': ['Neu'] });
  const r = reportOutcome(cs, [], { outcomes: { 'cclom:title': 'changed' }, allStored: false } as never);
  assert.equal(errorOf(r)?.['outcomeOpen'], true);
});
