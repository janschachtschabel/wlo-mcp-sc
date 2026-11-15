/**
 * write-target.test.ts – which node a metadata write is aimed at.
 *
 * A collection listing hands out REFERENCE ids, so the id a caller naturally
 * passes is usually not the record. Measured against staging (plan 2026-08-17,
 * F1/F2): a write aimed at a reference is stored ON the reference, never reaches
 * the original, and the reference stops inheriting from then on — a silent,
 * permanent local override that `verifyWrite` cannot see, because it reads back
 * the same node and finds the value it just wrote.
 *
 * The rule lives in one function so the field that carries it is read in one
 * place; `shared-rule-discipline.test.ts` fails a second reader.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { resolveWriteTarget } from '../src/services/write/nodes.js';
import type { WloNode } from '../src/wlo-types.js';

const node = (id: string, originalId?: string): WloNode => ({
  ref: { id, repo: '-home-' },
  ...(originalId ? { originalId } : {}),
});

test('a reference is resolved to the original it points at', () => {
  const target = resolveWriteTarget(node('reference-1', 'original-1'), 'reference-1');

  assert.equal(target.targetId, 'original-1', 'geschrieben wird am Original');
  assert.equal(target.requestedId, 'reference-1', 'was die Aufruferin genannt hat, bleibt erhalten');
  assert.equal(target.redirected, true);
});

test('an original resolves to itself and reports no redirection', () => {
  // F6: the DTO field is ABSENT on an original. That is the whole reason the
  // rule reads `node.originalId` and not the `ccm:original` property, which
  // points at the record itself and would need a self-comparison.
  const target = resolveWriteTarget(node('original-1'), 'original-1');

  assert.equal(target.targetId, 'original-1');
  assert.equal(target.redirected, false, 'ohne Umleitung darf die Vorschau auch keine ankündigen');
});

test('a node whose originalId is its own id is not reported as redirected', () => {
  // Defends the preview against the shape `ccm:original` actually has. If the
  // DTO ever gained it too, `redirected: true` would announce a redirection to
  // the same node — a sentence the user cannot act on and cannot verify.
  const target = resolveWriteTarget(node('node-1', 'node-1'), 'node-1');

  assert.equal(target.targetId, 'node-1');
  assert.equal(target.redirected, false);
});

/**
 * ── Woher der Vergleichsstand kommt ─────────────────────────────────────────
 *
 * Die Auflösung allein genügt nicht. Die Änderungsmenge wird gegen einen
 * Vorher-Stand gebaut, und der muss vom Knoten kommen, der GESCHRIEBEN wird.
 *
 * Solange eine Verknüpfung erbt, sind beide Stände gleich und der Unterschied
 * fällt nicht auf. Nach einem früheren Direktschreiben — genau der Zustand, den
 * ältere Fassungen dieser Werkzeuge erzeugt haben (F2) — laufen sie auseinander,
 * und dann beschreibt die Vorschau einen anderen Datensatz als den geänderten:
 * ein Feld gilt als „unverändert", weil die VERKNÜPFUNG den Wunschwert schon
 * zeigt, und das Original bekommt ihn nie.
 */

import { readWriteBaseline } from '../src/services/write/nodes.js';
import { installFetchMock } from './fetchMock.js';

const withProps = (id: string, props: Record<string, string[]>, originalId?: string): WloNode => ({
  ref: { id, repo: '-home-' },
  properties: props,
  ...(originalId ? { originalId } : {}),
});

test('the baseline of a redirected write comes from the ORIGINAL, not from the reference', async () => {
  // Die Verknüpfung wurde früher direkt beschrieben und zeigt "REF-Wert"; das
  // Original trägt weiterhin "ORIGINAL-Wert". Gegen den zweiten muss verglichen
  // werden — er ist der, der gleich überschrieben wird.
  const mock = installFetchMock((url) => {
    const id = decodeURIComponent(url.match(/-home-\/([^/]+)\/metadata/)?.[1] ?? '');
    return { json: { node: withProps(id, { 'cclom:general_description': ['ORIGINAL-Wert'] }) } };
  });
  try {
    const reference = withProps('ref-1', { 'cclom:general_description': ['REF-Wert'] }, 'orig-1');
    const baseline = await readWriteBaseline(reference, 'ref-1');

    assert.equal(baseline.ok, true);
    if (!baseline.ok) return;
    assert.equal(baseline.target.targetId, 'orig-1');
    assert.deepEqual(baseline.before['cclom:general_description'], ['ORIGINAL-Wert']);
  } finally {
    mock.restore();
  }
});

test('without a redirection the node already read is used — no second request', async () => {
  // Der Normalfall darf nichts kosten: kein Abruf, und derselbe Stand wie bisher.
  const mock = installFetchMock(() => ({ status: 500, json: {} }));
  try {
    const own = withProps('n-1', { 'cclom:general_description': ['Wert'] });
    const baseline = await readWriteBaseline(own, 'n-1');

    assert.equal(baseline.ok, true);
    if (!baseline.ok) return;
    assert.equal(baseline.target.redirected, false);
    assert.deepEqual(baseline.before['cclom:general_description'], ['Wert']);
    assert.equal(mock.calls.length, 0, 'ohne Umleitung wird nichts nachgelesen');
  } finally {
    mock.restore();
  }
});

test('an unreadable original refuses rather than falling back to the reference', async () => {
  // Der Rückfall auf die Verknüpfung wäre genau der Fehler: er sähe aus wie ein
  // normaler Vergleich und beschriebe den falschen Datensatz.
  const mock = installFetchMock(() => ({ status: 404, json: {} }));
  try {
    const reference = withProps('ref-1', { 'cclom:general_description': ['REF-Wert'] }, 'orig-1');
    const baseline = await readWriteBaseline(reference, 'ref-1');

    assert.equal(baseline.ok, false);
    if (baseline.ok) return;
    assert.match(baseline.reason, /orig-1/, 'die Meldung nennt den Knoten, der nicht lesbar war');
  } finally {
    mock.restore();
  }
});
