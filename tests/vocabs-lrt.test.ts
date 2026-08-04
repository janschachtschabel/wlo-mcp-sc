/**
 * vocabs-lrt.test.ts – the vocabulary a curator actually chooses from.
 *
 * `new_lrt` and `new_lrt_aggregated` are different axes, not two versions of
 * one list: the aggregated one is a flat set of media types, this one a
 * hierarchy of educational object types. We write `ccm:oeh_lrt` and never the
 * aggregated field — the repository derives that, and the derivation rule is
 * published in this very vocabulary, which is what `AGGREGATION` carries.
 *
 * The counts are pinned deliberately. If a regeneration changes them, that is a
 * change in the published vocabulary and someone should look at it, not a test
 * to relax.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  LRT_CONCEPTS,
  AGGREGATION,
  UNMAPPED,
  resolveLrt,
} from '../src/vocabs-lrt.js';

const AGG_BASE = 'http://w3id.org/openeduhub/vocabs/new_lrt_aggregated/';
const LRT_BASE = 'http://w3id.org/openeduhub/vocabs/new_lrt/';

test('the vocabulary carries all 220 concepts', () => {
  assert.equal(LRT_CONCEPTS.length, 220);
  assert.equal(new Set(LRT_CONCEPTS.map(c => c.uri)).size, 220, 'every URI is distinct');
});

test('every concept URI sits in the new_lrt namespace', () => {
  for (const c of LRT_CONCEPTS) assert.ok(c.uri.startsWith(LRT_BASE), c.uri);
});

test('214 concepts map to exactly one aggregated concept', () => {
  assert.equal(Object.keys(AGGREGATION).length, 214);
  for (const [from, to] of Object.entries(AGGREGATION)) {
    assert.ok(from.startsWith(LRT_BASE), from);
    assert.ok(to.startsWith(AGG_BASE), `${from} → ${to} is not an aggregated URI`);
  }
});

test('the six concepts without an aggregation are exactly the known ones', () => {
  // Material tagged only with one of these is invisible to the aggregated
  // content-type facets — which is why the tool has to say so.
  assert.deepEqual([...UNMAPPED].sort(), [
    'Anleitung',
    'Dokumente und textbasierte Inhalte',
    'Lehr- und Lernmaterial',
    'Material',
    'Unterrichtsplanung',
    'Weiteres Material',
  ].sort());
});

test('mapped and unmapped together account for every concept', () => {
  const unmappedUris = LRT_CONCEPTS.filter(c => c.aggregatedUri === null);
  assert.equal(unmappedUris.length, UNMAPPED.length);
  assert.equal(Object.keys(AGGREGATION).length + UNMAPPED.length, LRT_CONCEPTS.length);
});

test('a plain label resolves to its URI', () => {
  const r = resolveLrt('Arbeitsblatt');
  assert.equal(r.status, 'ok');
  assert.ok(r.status === 'ok' && r.uri.startsWith(LRT_BASE));
});

test('resolution ignores case and surrounding space', () => {
  const a = resolveLrt('Arbeitsblatt');
  const b = resolveLrt('  arbeitsblatt ');
  assert.equal(a.status, 'ok');
  assert.deepEqual(a, b);
});

test('a URI from this vocabulary resolves to itself', () => {
  const uri = LRT_CONCEPTS[0]!.uri;
  const r = resolveLrt(uri);
  assert.ok(r.status === 'ok' && r.uri === uri);
});

test('a URI from a different vocabulary is not accepted', () => {
  assert.equal(resolveLrt(`${AGG_BASE}2e678af3-1026-4171-b88e-3b3a915d1673`).status, 'unknown');
});

test('an alias resolves like the label', () => {
  const r = resolveLrt('Edu-Breakout');
  assert.equal(r.status, 'ok');
  assert.deepEqual(r, resolveLrt('EduBreakout'));
});

test('a label used by two different concepts is reported, never guessed', () => {
  // "Suchmaschine" exists both as a kind of source and as a kind of tool.
  // Picking one silently would write a content type the curator did not choose.
  const r = resolveLrt('Suchmaschine');
  assert.equal(r.status, 'ambiguous');
  assert.ok(r.status === 'ambiguous' && r.candidates.length === 2);
  const paths = r.status === 'ambiguous' ? r.candidates.map(c => c.path) : [];
  assert.equal(new Set(paths).size, 2, 'the candidates are told apart by where they sit');
  for (const p of paths) assert.ok(p.length > 0);
});

test('an unknown label resolves to nothing', () => {
  assert.equal(resolveLrt('Zauberstab').status, 'unknown');
  assert.equal(resolveLrt('').status, 'unknown');
});

test('"Unterrichtsplanung" resolves and is one of the unmapped six', () => {
  const r = resolveLrt('Unterrichtsplanung');
  assert.ok(r.status === 'ok');
  const concept = LRT_CONCEPTS.find(c => c.uri === r.uri);
  assert.equal(concept?.aggregatedUri, null);
  assert.ok(UNMAPPED.includes('Unterrichtsplanung'));
});

test('every concept carries a non-empty label and a path for disambiguation', () => {
  for (const c of LRT_CONCEPTS) {
    assert.ok(c.label.trim().length > 0, c.uri);
    assert.ok(typeof c.path === 'string', c.uri);
  }
});
