/**
 * tests/live/fulltext.test.ts – the two measurements behind W1/W2 (plan
 * 2026-11-08, §2 and §4.4), against STAGING only (`guard.ts`). Both are
 * answered since 2026-11-13; the tests PIN the answers.
 *
 * 1. Does a full text written with `POST …/textContent` (raw body,
 *    `mimetype=text/plain`) come back unchanged from `GET …/textContent` — and
 *    does the search find a word from it (F3)? Run through the PREVIEW path
 *    first, as the tool does: it reads textContent before writing, and whether
 *    that read's cache survives the write is part of the measurement.
 * 2. Does a record that carries a FILE keep it — same type, same content hash —
 *    and does the text read back? Measured 2026-11-13, twice: NO, the file is
 *    REPLACED (one content slot). So `keepsBinary()` stays false and W1 refuses
 *    such records by rule; test 2 turns red if a repository ever keeps the file.
 *
 * Staging refused every content write from 2026-11-06 to 2026-11-13 (500
 * `InvalidTypeException … content can't be updated via NodeService#setProperty`).
 * Should that answer return, it SKIPS a test with the reason — any other failure fails, and
 * a write that did not land never counts as "the file survived".
 * Every throwaway record is deleted in `finally`; one that stays is reported.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { BASE_URL } from '../../src/wlo-config.js';
import { wloFetch } from '../../src/wlo-fetch.js';
import { readNodeTextContent, getNodeMetadata, ngsearch } from '../../src/wlo-api.js';
import { createContentNode, deleteContentNode } from '../../src/services/write/nodes-lifecycle.js';
import { normalizedText, planFulltext, setKeepsBinaryForTest, writeFulltext, type FulltextPlan } from '../../src/services/write/fulltext.js';
import { markdownFile } from './fixtures.js';
import { requireLiveTarget, runStamp } from './guard.js';

const STAGING_DEFECT = /InvalidTypeException|content can't be updated/;

type Diag = { diagnostic: (m: string) => void };

async function plainRecord(title: string): Promise<string> {
  const res = await wloFetch(`${BASE_URL}/node/v1/nodes/-home-/-userhome-/children?type=ccm:io&renameIfExists=true&versionComment=live`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ 'cm:name': [`${title}.txt`], 'cclom:title': [title] }),
  });
  assert.ok(res.ok, `record create ${res.status}`);
  const id = ((await res.json()) as { node?: { ref?: { id?: string } } }).node?.ref?.id;
  assert.ok(id);
  return id!;
}

/** A throwaway that stays behind is litter nobody can attribute — say so. */
async function cleanup(t: Diag, id: string): Promise<void> {
  const out = await deleteContentNode(id).catch((err: unknown) => ({ status: 'failed', detail: String(err) }));
  if ((out as { status?: string }).status !== 'ok') t.diagnostic(`Wegwerf-Datensatz ${id} NICHT gelöscht: ${JSON.stringify(out)}`);
}

test('a full text written to textContent reads back unchanged, and the search may find it (F3)', async (t) => {
  requireLiveTarget();
  const token = `zqlive${Date.now().toString(36)}`;
  const md = `# Live-Volltext ${token}\n\nLicht breitet sich geradlinig aus. Äöü „Zitat“.\n`;
  const id = await plainRecord(`Live Volltext ${runStamp}`);
  try {
    const planned = await planFulltext({ nodeId: id, markdown: md, source: 'manual' });
    t.diagnostic(`Vorschau an einem Datensatz ohne Inhalt: ${planned.ok ? 'ok' : `${planned.code} — ${planned.reason}`}`);
    assert.ok(planned.ok, 'a record without content must be plannable');
    const out = await writeFulltext(planned.plan, md);
    if (out.status !== 'stored' && STAGING_DEFECT.test(out.detail)) {
      t.skip(`Staging nimmt keine Inhalte an: ${out.detail.slice(0, 120)}`);
      return;
    }
    assert.equal(out.status, 'stored', JSON.stringify(out));
    const back = await readNodeTextContent(id);
    assert.equal(normalizedText(back.text ?? ''), normalizedText(md));
    // F3 is a measurement, not a requirement: report it, do not fail on it.
    let found = false;
    for (let i = 0; i < 6 && !found; i++) {
      await new Promise(r => setTimeout(r, 20_000));
      const hits = await ngsearch([{ property: 'ngsearchword', values: [token] }], 'FILES', 10, 0);
      found = (hits.nodes ?? []).some(n => n.ref?.id === id);
    }
    t.diagnostic(`F3 — Suche findet ein Wort aus dem Volltext: ${found ? 'ja' : 'nein (nach 120 s)'}`);
  } finally {
    await cleanup(t, id);
  }
});

// MEASURED 2026-11-13, the first day staging accepted content writes again:
// the text lands and the FILE IS REPLACED (before: text/x-web-markdown, 47
// bytes; after: text/plain, 29 bytes, another hash — the earlier file is in the
// version list). So the safeguard is not provisional any more: `POST
// textContent` writes the record's content, there is no second slot. This test
// pins that answer and turns red the day a repository KEEPS the file — then,
// and only then, `FULLTEXT_KEEPS_BINARY` may become true.
test('a full text written to a record WITH a file REPLACES the file — the safeguard stays', async (t) => {
  requireLiveTarget();
  const created = await createContentNode({ 'cclom:title': [`Live Datei ${runStamp}`] },
    { mode: 'user', file: markdownFile('Live Datei', '# Original\n\nDiese Datei muss erhalten bleiben.\n') });
  if (created.status !== 'created' || created.upload?.status !== 'stored') {
    if (created.status === 'created') await cleanup(t, created.nodeId);
    t.skip(`Datei-Upload auf Staging nicht möglich: ${JSON.stringify(created).slice(0, 160)}`);
    return;
  }
  const id = created.nodeId;
  try {
    const before = await getNodeMetadata(id);
    const b = { size: Number(before?.size ?? 0), mimetype: String(before?.mimetype ?? ''), hash: String(before?.content?.hash ?? '') };
    const md = '# Volltext\n\nGewonnener Text.\n';
    const plan: FulltextPlan = { requestedId: id, targetId: id, title: 'live', bytes: Buffer.byteLength(md), sha256: 'x',
      replaces: false, source: 'binary', before: b };
    // This IS the measurement the safeguard rests on: lift it for this one write,
    // or the check right before the POST refuses the record it is meant to judge.
    setKeepsBinaryForTest(true);
    const out = await writeFulltext(plan, md).finally(() => setKeepsBinaryForTest(null));
    if (out.status !== 'stored' && 'detail' in out && STAGING_DEFECT.test(out.detail)) {
      t.skip(`Staging nimmt keine Inhalte an: ${out.detail.slice(0, 120)}`);
      return;
    }
    const after = await getNodeMetadata(id);
    const a = { size: Number(after?.size ?? 0), mimetype: String(after?.mimetype ?? ''), hash: String(after?.content?.hash ?? '') };
    // Printed BEFORE any verdict: this run carries the decision, and "file
    // replaced" is exactly the outcome whose numbers someone has to see.
    t.diagnostic(`vorher ${JSON.stringify(b)}, nachher ${JSON.stringify(a)}, Ergebnis ${JSON.stringify(out)}`);
    // A write that failed some OTHER way proves nothing about the file.
    assert.ok(out.status === 'stored' || (out.status === 'failed' && out.code === 'file_replaced'),
      `the write must land before the file can be judged: ${JSON.stringify(out)}`);
    assert.equal(normalizedText((await readNodeTextContent(id)).text ?? ''), normalizedText(md), 'the text itself landed');
    // The measured answer. If this fails, the file SURVIVED: read the numbers
    // above, run it again, and only then lift the safeguard in fulltext.ts.
    assert.notDeepEqual([a.mimetype, a.hash], [b.mimetype, b.hash],
      'the file was KEPT — the repository changed; the safeguard (FULLTEXT_KEEPS_BINARY) can be reconsidered');
    assert.equal(out.status === 'failed' ? out.code : 'stored', 'file_replaced', 'and the write path noticed it');
  } finally {
    await cleanup(t, id);
  }
});
