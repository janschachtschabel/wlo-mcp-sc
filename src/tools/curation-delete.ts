/**
 * tools/curation-delete.ts – the two irreversible acts, kept together.
 *
 * Deleting content and deleting a collection share the one thing that matters
 * here: what the user is told before and after. Grouping them means that
 * wording lives in one place instead of drifting apart across two files.
 *
 * The rule those tools follow: **never promise a way back.** `recycle=true` is
 * always sent, so the repository may keep an archive copy — but a person-scoped
 * archive query found a deleted node once and then returned nothing for the same
 * node minutes later, so recoverability could not be demonstrated. Telling
 * someone their material can be restored, when we cannot show that it can, is
 * the reassurance that costs them the material.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { requireWrite } from '../services/write/credential-gate.js';
import { buildChangeSet } from '../services/write/change-set.js';
import { deleteContentNode } from '../services/write/nodes-lifecycle.js';
import { resolveWriteTarget } from '../services/write/nodes.js';
import { deleteCollection } from '../services/write/collections.js';
import type { MutationOutcome } from '../services/write/verify.js';
import { getNodeMetadata } from '../wlo-node.js';
import { CONTAINER_TYPE, CONTENT_TYPE } from '../node-kind.js';
import { sanitizeText } from '../text-sanitize.js';
import {
  registerCurationTool,
  type WriteAuthChallenge,
  previewReply,
  confirmOrExplain,
  codedError,
  wrongKind,
  reportMutation,
  timeoutOrError,
  isPreviewCall,
} from './curation-shared.js';

/** Said in the preview of every deletion, and never contradicted afterwards. */
const NO_WAY_BACK =
  'Das lässt sich über dieses Werkzeug nicht rückgängig machen. Ob das Repository eine Archivkopie ' +
  'behält, ist ungeprüft — bitte davon ausgehen, dass die Löschung endgültig ist.';

const deleteSchema = {
  nodeId: z.string().describe('nodeId des zu löschenden Eintrags.'),
  confirmToken: z.string().optional()
    .describe('Bestätigungsschlüssel aus der Vorschau. Ohne ihn wird ausschließlich die Vorschau erzeugt.'),
};

export function registerCurationDeleteTools(server: McpServer, challenge: WriteAuthChallenge): void {
  registerCurationTool(server, challenge, {
    name: 'wlo_delete_content',
    title: 'WLO Inhalt löschen',
    description:
      'Lösche einen WLO-Datensatz endgültig. ZWEISTUFIG: ohne confirmToken wird nur gezeigt, was gelöscht ' +
      'würde, und nichts passiert. NICHT verwenden, um ein Material aus einer Sammlung zu nehmen — dafür ' +
      'gibt es wlo_remove_from_collection. Mit der id des Datensatzes verschwindet das Material aus allen ' +
      'Sammlungen, in denen es vorkommt. Mit der id einer Sammlungs-Verknüpfung (das ist es, was ' +
      'Sammlungslisten liefern) verschwindet nur die Verknüpfung, und der Datensatz bleibt bestehen — die ' +
      'Vorschau sagt, welcher der beiden Fälle vorliegt. Nur für einzelne Datensätze: eine Sammlung oder ein ' +
      'Ordner wird abgelehnt. Erfordert eine Anmeldung.',
    inputSchema: deleteSchema,
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
    handler: (params) => runDeletion(params, {
      kind: 'content',
      whatItMeans:
        'Der Datensatz verschwindet damit aus allen Sammlungen, in denen er vorkommt.',
      // Measured 2026-08-17 (F10): the reference goes, the record stays. Without
      // this the preview promised the loss of a material that survives — the one
      // sentence a person reads before an irreversible act, and wrong in the
      // direction that makes them hesitate over nothing while the actual link
      // they wanted gone disappears either way.
      whatItMeansForReference: (recordId) =>
        'Diese id benennt eine VERKNÜPFUNG in einer Sammlung, nicht den Datensatz selbst. Gelöscht wird '
        + `nur die Verknüpfung: der Datensatz (${sanitizeText(recordId)}) bleibt bestehen, samt allen `
        + 'anderen Sammlungen, in denen er vorkommt. Um das Material wirklich zu löschen, die id des '
        + 'Originals verwenden; um es nur aus dieser Sammlung zu nehmen, wlo_remove_from_collection.',
      remove: deleteContentNode,
      notFound: 'Der Datensatz',
      context: 'Der Datensatz konnte nicht gelöscht werden',
    }),
  });

  registerCurationTool(server, challenge, {
    name: 'wlo_delete_collection',
    title: 'WLO Sammlung löschen',
    description:
      'Lösche eine WLO-Sammlung endgültig, samt ihrer Untersammlungen. Die darin verlinkten Materialien ' +
      'bleiben bestehen — eine Sammlung enthält Verweise; nur direkt in ihr angelegte Originale gehen mit. ' +
      'Nur für Sammlungen: ein Datensatz oder Ordner wird abgelehnt. ZWEISTUFIG: ohne confirmToken wird nur ' +
      'gezeigt, was gelöscht würde. Erfordert eine Anmeldung.',
    inputSchema: deleteSchema,
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
    handler: (params) => runDeletion(params, {
      kind: 'collection',
      // Measured 2026-08-09 (skill wlo-collections-references): a record that
      // lies in the collection as an ORIGINAL — created there, not filed — goes
      // with it. "Die Materialien bleiben bestehen" was true of links only.
      whatItMeans:
        'Untersammlungen werden mitgelöscht. Verlinkte Materialien bleiben bestehen — eine Sammlung enthält ' +
        'in der Regel Verweise. Datensätze, die als Original direkt in der Sammlung angelegt wurden, werden ' +
        'dagegen mitgelöscht.',
      remove: deleteCollection,
      notFound: 'Die Sammlung',
      context: 'Die Sammlung konnte nicht gelöscht werden',
    }),
  });
}

interface DeletionSpec {
  kind: 'content' | 'collection';
  /** One German sentence on the scope of the loss, shown in the preview. */
  whatItMeans: string;
  /**
   * Replaces `whatItMeans` when the id names a collection reference. Receives
   * the id of the record that SURVIVES the deletion.
   *
   * Only `wlo_delete_content` sets it, and only because the case is MEASURED
   * there. Deleting a collection that is itself filed into another collection
   * goes through a different endpoint whose behaviour on a reference nobody has
   * checked, and a preview is the last place to state something unverified.
   */
  whatItMeansForReference?: (recordId: string) => string;
  remove: (nodeId: string) => Promise<MutationOutcome>;
  /** How to name the thing when it cannot be found. */
  notFound: string;
  /** Prefix for an unexpected error. */
  context: string;
}

/** Which tool fits instead — appended to the refusal. */
function useInstead(code: string, type: string | undefined): string {
  if (code === 'is_a_collection') return ' Zum Löschen einer Sammlung: wlo_delete_collection.';
  // Measured 2026-11-12: the folder of a batch filing is a `ccm:map` WITHOUT the
  // collection aspect. Neither tool deletes it — a folder goes with the
  // ORIGINALS inside it, and neither preview sentence says that.
  if (code === 'is_a_folder' || (code === 'not_a_collection' && type === CONTAINER_TYPE)) {
    return ' Einen Ordner samt Inhalt löscht dieser Server nicht — die enthaltenen Datensätze einzeln löschen '
      + '(wlo_delete_content) oder den Ordner in der Redaktionsumgebung entfernen.';
  }
  return code === 'not_a_collection' && type === CONTENT_TYPE ? ' Zum Löschen eines Datensatzes: wlo_delete_content.' : '';
}

/**
 * The shared two-step deletion. Reads the record first so the preview can name
 * what would be lost — an id alone is not something a person can consent to.
 */
async function runDeletion(params: Record<string, unknown>, spec: DeletionSpec) {
  // Outside the try so the catch below can name WHICH record it cannot vouch for.
  const nodeId = String(params['nodeId'] ?? '');
  try {
    requireWrite();

    const node = await getNodeMetadata(nodeId);
    if (!node) {
      return codedError('not_found', `${spec.notFound} „${sanitizeText(nodeId)}“ wurde nicht gefunden oder ist nicht lesbar.`);
    }

    // The tool must fit the node (audit 2026-11-12, K-1). Each tool has its own
    // endpoint and its own preview sentence, and the repository checks neither:
    // a collection id here used to get the preview of ONE record ("verschwindet
    // aus allen Sammlungen") over a deletion of the collection. A collection is
    // told by its ASPECT, not by `ccm:map` — a workspace folder is a map too,
    // and under the collection preview ("verlinkte Materialien bleiben
    // bestehen") it would go with the originals inside it. A node whose kind is
    // not named is refused: the one irreversible act must know what it hits.
    // (An alias such as `-userhome-` never gets here — `registerCurationTool`.)
    const wrong = wrongKind(node, spec.kind);
    if (wrong) {
      return codedError(wrong.code,
        `„${sanitizeText(nodeId)}“ ${wrong.reason}${useInstead(wrong.code, node.type)} Es wurde nichts gelöscht.`);
    }

    // The id is used AS GIVEN, deliberately — this is the one write path that
    // must NOT resolve to the original. Measured 2026-08-17 (F10): deleting a
    // collection reference removes the reference and leaves the record alone, so
    // redirecting here would convert a harmless tidy-up into exactly the data
    // loss `resolveWriteTarget` exists to prevent.
    //
    // The other half of that measurement is not addressed here and is worth
    // naming: over a reference id this tool reports a deletion the MATERIAL does
    // not undergo — it survives under its own id and in every other collection.
    // That is a wording problem in the tool description, not a routing one.
    const cs = buildChangeSet(nodeId, spec.kind, node.properties ?? {}, {}, { destructive: true });

    // The resolver answers "is this a reference, and what does it point at" —
    // the one place that reads the DTO field, including the self-pointing case.
    // Used here to DESCRIBE the node, deliberately never to route the deletion:
    // see the comment above `buildChangeSet`.
    const target = resolveWriteTarget(node, nodeId);
    const scope = target.redirected && spec.whatItMeansForReference
      ? spec.whatItMeansForReference(target.targetId)
      : spec.whatItMeans;

    const token = typeof params['confirmToken'] === 'string' ? params['confirmToken'] : '';
    if (!token) return previewReply(cs, `${scope} ${NO_WAY_BACK}`);

    const refusal = confirmOrExplain(token, cs);
    if (refusal) return refusal;

    const what = cs.title ? `„${sanitizeText(cs.title)}“` : nodeId;
    // "wurde gelöscht" is only said once the record is no longer readable. The
    // one reply in this server that nobody can act on afterwards is the one that
    // must not be guessed.
    return reportMutation(await spec.remove(nodeId), `${what} wurde gelöscht.`, spec.context);
  } catch (err) {
    // Of every mutation here this is the one where a wrong "it failed" costs
    // most: it is irreversible, so the reader who believes it stops looking.
    return timeoutOrError(spec.context, err, `Ob „${sanitizeText(nodeId)}“ gelöscht wurde, ist offen`, { preview: isPreviewCall(params) });
  }
}
