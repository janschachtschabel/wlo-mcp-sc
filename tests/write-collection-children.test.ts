/**
 * write-collection-children.test.ts – ONE lister of a collection's
 * sub-collections by title, for the tree and the move (audit 2026-11-14, W2).
 *
 * The tree's `merge` looked a sub-collection up by the RECORD title chain
 * (`cclom:title` first). A collection is titled by `cm:title` — the property
 * the collection endpoint writes — so a renamed collection that kept a
 * leftover `cclom:title` was not found, and the tree created a second one
 * beside it. The move did it right; the two now share the lister.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { readWholeListing, subCollectionsByTitle, SUBCOLLECTIONS_MAX } from '../src/services/write/collection-children.js';
import { findExisting, type TreeItem } from '../src/services/write/collection-tree.js';
import { installFetchMock, type MockResult } from './fetchMock.js';

const child = (id: string, props: Record<string, string[]>, title?: string) =>
  ({ ref: { id, repo: '-home-' }, type: 'ccm:map', aspects: ['ccm:collection'], properties: props, ...(title ? { title } : {}) });

function serve(children: unknown[], status = 200) {
  const skips: number[] = [];
  const mock = installFetchMock((url): MockResult => {
    const u = new URL(url);
    const skip = Number(u.searchParams.get('skipCount') ?? 0);
    const max = Number(u.searchParams.get('maxItems') ?? 100);
    skips.push(skip);
    if (status !== 200) return { status, json: {} };
    return { json: { nodes: children.slice(skip, skip + max) } };
  });
  return { mock, skips };
}

test('a sub-collection is found by its COLLECTION title — a leftover cclom:title does not hide it', async () => {
  const s = serve([child('c1', { 'cm:title': ['Linsen'], 'cclom:title': ['Alter Name'], 'cm:name': ['linsen'] })]);
  try {
    const byTitle = await subCollectionsByTitle('root');
    assert.equal(byTitle?.get('linsen'), 'c1');
    assert.equal(byTitle?.has('alter name'), false, 'the leftover record title is not what the collection is called');
  } finally { s.mock.restore(); }
});

test('the tree asks the same lister: merge finds the renamed collection instead of creating a second one', async () => {
  const s = serve([child('c1', { 'cm:title': ['Linsen'], 'cclom:title': ['Alter Name'] })]);
  try {
    const items: TreeItem[] = [{ key: 'Linsen', title: 'Linsen' }];
    const walk = await findExisting('root', items);
    assert.deepEqual(walk.ok && [...walk.existing], [['Linsen', 'c1']]);
  } finally { s.mock.restore(); }
});

test('case and spacing do not make another title; the first of two namesakes is kept', async () => {
  const s = serve([child('c1', { 'cm:title': ['  Geometrische   Optik '] }), child('c2', { 'cm:title': ['geometrische optik'] })]);
  try {
    assert.deepEqual([...(await subCollectionsByTitle('root'))!], [['geometrische optik', 'c1']]);
  } finally { s.mock.restore(); }
});

test('a listing that does not answer is "could not find out" — never an empty map', async () => {
  const s = serve([], 503);
  try {
    assert.equal(await subCollectionsByTitle('root'), null);
  } finally { s.mock.restore(); }
});

test('more sub-collections than are read is "could not find out" too: a namesake may lie beyond', async () => {
  const many = Array.from({ length: SUBCOLLECTIONS_MAX + 1 }, (_, i) => child(`c${i}`, { 'cm:title': [`T${i}`] }));
  const s = serve(many);
  try {
    assert.equal(await subCollectionsByTitle('root'), null);
    assert.deepEqual(s.skips, [0, 500, 1000, 1500], 'four pages of 500, as before');
  } finally { s.mock.restore(); }
});

test('readWholeListing: whole, unread, or too many — and it stops at the first short page', async () => {
  const pages = (total: number) => async (skip: number, size: number) =>
    Array.from({ length: Math.max(0, Math.min(size, total - skip)) }, (_, i) => skip + i);
  assert.equal((await readWholeListing(pages(250), 100, 500) as number[]).length, 250);
  assert.equal(await readWholeListing(pages(501), 100, 500), 'too_many');
  assert.equal((await readWholeListing(pages(500), 100, 500) as number[]).length, 500);
  assert.equal(await readWholeListing(async () => null, 100, 500), 'unread');
  let calls = 0;
  await readWholeListing(async (skip, size) => { calls++; return (await pages(30)(skip, size)); }, 100, 500);
  assert.equal(calls, 1);
});
