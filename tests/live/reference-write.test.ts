/**
 * tests/live/reference-write.test.ts – what edu-sharing does when a write is
 * aimed at a collection REFERENCE instead of the original.
 *
 * Most of this pins REPOSITORY behaviour rather than ours: what the repository
 * does when it receives the write is the ground our decision stands on, and it
 * is the part nobody can check by reading our source.
 *
 * The first test is the exception and belongs beside them deliberately. It
 * exercises OUR resolution against a real reference, so the file now holds both
 * halves: "aimed at a reference, the value lands on the reference" (the
 * repository) and "our write path does not aim there" (us). The pair is the
 * whole argument, and splitting it across two files would let one half be
 * changed without the other being re-read.
 *
 * It exists because the documented measurement was WRONG. The project skill
 * `wlo-collections-references` states that a metadata write to a reference
 * "verpufft STILLSCHWEIGEND (200 OK ohne Effekt)". Measured against staging on
 * 2026-08-16, it does not vanish: it is STORED on the reference, which then
 * stops tracking the original — a silent, permanent local override, which is a
 * worse failure than a discarded write and needs the opposite fix. A false
 * measurement is more expensive than none, because it sounds like it was
 * checked.
 *
 * Content behaves the OTHER WAY ROUND and that asymmetry is the reason both are
 * tested here: bytes are not copied per reference, so an upload aimed at a
 * reference lands on the original.
 *
 * Throwaway data only, in the service account's own home. Every test deletes
 * what it created.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { getNodeMetadata } from '../../src/wlo-node.js';
import {
  createContentNode,
  deleteContentNode,
} from '../../src/services/write/nodes-lifecycle.js';
import { updateNodeMetadata, resolveWriteTarget } from '../../src/services/write/nodes.js';
import { uploadContent } from '../../src/services/write/content-upload.js';
import { requireLiveTarget, runStamp } from './guard.js';
import { markdownFile, withReference } from './fixtures.js';

const propOf = async (nodeId: string, property: string): Promise<string | undefined> =>
  (await getNodeMetadata(nodeId))?.properties?.[property]?.[0];

test('our write path resolves a real reference to the original and lands there', async () => {
  requireLiveTarget();

  // The counterpart to the test below, and the only one of the two that is
  // about US. It also proves the one thing no offline test can: that a REAL
  // reference from a real repository carries `originalId` in the DTO at all —
  // `resolveWriteTarget` is built on that field, and a fixture asserting it
  // would only be asserting our own idea of the response.
  await withReference(
    `MCP-Referenztest ${runStamp} (Auflösung)`,
    markdownFile('SKILL', '# Ursprung\n'),
    async ({ originalId, referenceId }) => {
      const node = await getNodeMetadata(referenceId);
      assert.ok(node, 'die Verknüpfung war nicht lesbar');

      const target = resolveWriteTarget(node, referenceId);
      assert.equal(target.redirected, true, 'eine Verknüpfung wird als solche erkannt');
      assert.equal(target.targetId, originalId, 'und zeigt auf das Original');

      const written = await updateNodeMetadata(
        target.targetId,
        { 'cclom:general_description': ['UEBER-DIE-AUFLOESUNG'] },
        { commit: false },
      );
      assert.ok(written.statuses.every(s => s.ok), `Schreibvorgang abgelehnt: ${JSON.stringify(written.statuses)}`);

      assert.equal(
        await propOf(originalId, 'cclom:general_description'),
        'UEBER-DIE-AUFLOESUNG',
        'der Wert steht am Original — das ist der Zweck der Auflösung',
      );
    },
  );
});

test('a metadata write aimed at a reference is STORED on the reference, not on the original', async () => {
  requireLiveTarget();

  await withReference(
    `MCP-Referenztest ${runStamp}`,
    markdownFile('SKILL', '# Ursprung\n'),
    async ({ originalId, referenceId }) => {
      const before = await propOf(originalId, 'cclom:general_description');

      const written = await updateNodeMetadata(
        referenceId,
        { 'cclom:general_description': ['AN-DIE-VERKNUEPFUNG'] },
        { commit: false },
      );
      assert.ok(written.statuses.every(s => s.ok), `Schreibvorgang abgelehnt: ${JSON.stringify(written.statuses)}`);

      assert.equal(
        await propOf(referenceId, 'cclom:general_description'),
        'AN-DIE-VERKNUEPFUNG',
        'der Wert steht auf der Verknüpfung — er verpufft NICHT, anders als dokumentiert war',
      );
      assert.notEqual(
        await propOf(originalId, 'cclom:general_description'),
        'AN-DIE-VERKNUEPFUNG',
        'und er erreicht das Original nicht: wer das Original pflegen will, muss dessen id nehmen',
      );
      assert.equal(
        await propOf(originalId, 'cclom:general_description'),
        before,
        'das Original bleibt unberührt',
      );
    },
  );
});

test('once overridden, a reference stops tracking the original', async () => {
  requireLiveTarget();

  // The consequence that makes the first test matter. A discarded write is
  // recoverable by repeating it at the right node; an override is not noticed
  // at all, and the two records drift from here on.
  await withReference(
    `MCP-Referenztest ${runStamp} (Override)`,
    markdownFile('SKILL', '# Ursprung\n'),
    async ({ originalId, referenceId }) => {
      await updateNodeMetadata(referenceId, { 'cclom:general_description': ['VERKNUEPFUNG-EIGEN'] },
        { commit: false });
      await updateNodeMetadata(originalId, { 'cclom:general_description': ['ORIGINAL-NEU'] },
        { commit: false });

      assert.equal(await propOf(originalId, 'cclom:general_description'), 'ORIGINAL-NEU');
      assert.equal(
        await propOf(referenceId, 'cclom:general_description'),
        'VERKNUEPFUNG-EIGEN',
        'die Verknüpfung behält ihren eigenen Wert — sie erbt nach einem Override nicht mehr',
      );
    },
  );
});

test('a content upload aimed at a reference reaches the ORIGINAL', async () => {
  requireLiveTarget();

  // The asymmetry: metadata is per node, bytes are not. A reference points at
  // the original's content, so the upload lands there and bumps ITS version.
  // Sizes rather than text: the download endpoint answers 403 for the service
  // account, and `cclom:size` is set by the same write we are checking.
  await withReference(
    `MCP-Referenztest ${runStamp} (Inhalt)`,
    markdownFile('SKILL', '# Fassung eins\n'),
    async ({ originalId, referenceId }) => {
      const replacement = markdownFile('SKILL', '# Fassung zwei, deutlich laenger\n');
      const upload = await uploadContent(referenceId, replacement);
      assert.equal(upload.status, 'stored', `Upload abgelehnt: ${JSON.stringify(upload)}`);

      assert.equal(
        await propOf(originalId, 'cclom:size'),
        String(replacement.bytes.length),
        'die neuen Bytes liegen am Original — ein Upload „auf die Verknüpfung" trifft es',
      );
    },
  );
});

test('replacing a file keeps cm:name, whatever the new file is called', async () => {
  requireLiveTarget();

  // The precondition for replacing the SKILL.md of a curated record: the
  // upload's own file name is derived from the TITLE (`fileNameFrom`), so a
  // record created as `alpha.md` would be renamed by every later replacement if
  // the repository adopted the multipart name. It does not — measured, because
  // 28 records whose name IS the convention were about to be rewritten on the
  // assumption.
  const created = await createContentNode(
    { 'cclom:title': [`MCP-Referenztest ${runStamp} (Name)`] },
    { mode: 'user', file: markdownFile('Alpha', '# Fassung eins\n') },
  );
  if (created.status !== 'created') assert.fail(`create abgelehnt: ${JSON.stringify(created)}`);

  try {
    assert.equal(await propOf(created.nodeId, 'cm:name'), 'alpha.md', 'der Name kommt beim Anlegen vom Titel');

    const upload = await uploadContent(created.nodeId, markdownFile('Beta', '# Fassung zwei\n'));
    assert.equal(upload.status, 'stored', `Upload abgelehnt: ${JSON.stringify(upload)}`);

    assert.equal(
      await propOf(created.nodeId, 'cm:name'),
      'alpha.md',
      'der Dateiname des Uploads („beta.md") wird NICHT übernommen — der Datensatz behält seinen',
    );
  } finally {
    await deleteContentNode(created.nodeId);
  }
});
