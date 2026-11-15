/**
 * tests/live/fixtures.ts – the throwaway records the live contract tests write
 * to, and the cleanup that removes them again.
 *
 * Extracted when the delete measurement became the second consumer, for the
 * same reason `guard.ts` was: these functions create real records in a real
 * repository and are responsible for deleting them afterwards. A second copy is
 * the kind that keeps working while quietly losing a `finally` — and what that
 * costs is not a red test but litter in staging that nobody can attribute.
 */

import assert from 'node:assert/strict';

import { getCollectionContents } from '../../src/wlo-node.js';
import { addToCollection, createCollection, deleteCollection } from '../../src/services/write/collections.js';
import { createContentNode, deleteContentNode } from '../../src/services/write/nodes-lifecycle.js';
import { resolveFileUpload } from '../../src/services/write/content-source.js';
import type { UploadFile } from '../../src/services/write/content-source.js';

/** A markdown file the way the curation tools build one. */
export function markdownFile(title: string, body: string): UploadFile {
  const built = resolveFileUpload(title, { content: body, contentFormat: 'markdown' });
  assert.ok(built.ok && built.file, `Datei konnte nicht gebaut werden: ${JSON.stringify(built)}`);
  return built.file;
}

/**
 * An original plus a reference to it, and the cleanup that removes both.
 *
 * The reference is identified by `ccm:original`, never by position: a
 * collection listing is not ordered by anything these tests control.
 */
export async function withReference(
  fixtureTitle: string,
  file: UploadFile,
  body: (ids: { originalId: string; referenceId: string }) => Promise<void>,
): Promise<void> {
  const created = await createContentNode({ 'cclom:title': [fixtureTitle] }, { mode: 'user', file });
  if (created.status !== 'created') assert.fail(`create abgelehnt: ${JSON.stringify(created)}`);
  const originalId = created.nodeId;

  let collectionId = '';
  try {
    const collection = await createCollection(null, {
      title: `${fixtureTitle} (Sammlung)`,
      description: 'Wegwerf-Sammlung des Live-Vertragstests — darf gelöscht werden.',
    });
    if (collection.status !== 'created') assert.fail(`Sammlung abgelehnt: ${JSON.stringify(collection)}`);
    collectionId = collection.nodeId;

    const added = await addToCollection(collectionId, originalId);
    assert.equal(added.status, 'ok', `Verknüpfen fehlgeschlagen: ${JSON.stringify(added)}`);

    const page = await getCollectionContents(collectionId, 'files', 20, 0, ['ccm:original']);
    const referenceId = page.nodes
      .find(n => n.properties?.['ccm:original']?.[0] === originalId)?.ref?.id;
    assert.ok(referenceId, 'die angelegte Verknüpfung war in der Sammlung nicht auffindbar');
    assert.notEqual(referenceId, originalId, 'eine Verknüpfung muss ein eigener Knoten sein');

    await body({ originalId, referenceId });
  } finally {
    // Both run even when an assertion failed — a broken run must not litter
    // staging. Deleting the collection does NOT delete the original, and a
    // delete of a record a test already removed is a no-op we ignore.
    if (collectionId) await deleteCollection(collectionId);
    await deleteContentNode(originalId);
  }
}
