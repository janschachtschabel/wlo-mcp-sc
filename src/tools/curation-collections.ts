/**
 * tools/curation-collections.ts – building and arranging collections.
 *
 * Four tools, none of them destructive: create, rename, add material, remove
 * material. Deleting a collection lives in `curation-delete.ts` with the other
 * irreversible act, so the "no way back" wording is written once.
 *
 * The distinction this file exists to keep sharp: **removing material from a
 * collection is not deleting it.** A collection holds references. Every reply
 * here says so, because the two requests differ by one path segment and a
 * conversation blurs exactly that kind of difference.
 */

import { collectionTitleFromProperties, titleFromProperties } from '../node-match.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { requireWrite, requireWriteRoute } from '../services/write/credential-gate.js';
import { buildChangeSet, type ChangeSet } from '../services/write/change-set.js';
import {
  createCollection,
  renameCollection,
  addToCollection,
  addToCollectionRequest,
  removeFromCollection,
  removeFromCollectionRequest,
} from '../services/write/collections.js';
import type { MutationOutcome } from '../services/write/verify.js';
import type { PrepareOutcome } from '../services/write/prepared-request.js';
import { getNodeMetadata } from '../wlo-node.js';
import { resolveWriteTarget } from '../services/write/nodes.js';
import { isAlreadyFiled, readFilingTarget } from '../services/write/create-filing.js';
import { sanitizeText } from '../text-sanitize.js';
import {
  registerCurationTool,
  type WriteAuthChallenge,
  previewReply,
  confirmOrExplain,
  errorText,
  codedError,
  plainText,
  wrongKind,
  wrongKindReply,
  reportMutation,
  preparedReply,
  prependText,
  collectDesired,
  rejectionReply,
  type ParamMap,
  timeoutOrError,
  isPreviewCall,
  recordTitle,
  candidatesField,
} from './curation-shared.js';

const CONFIRM_TOKEN = z.string().optional()
  .describe('Bestätigungsschlüssel aus der Vorschau. Ohne ihn wird ausschließlich die Vorschau erzeugt.');

const WRITE_ANNOTATIONS = { readOnlyHint: false, destructiveHint: false, idempotentHint: false };

/**
 * A collection's own title and description. Both are written by these tools, so
 * both belong in the change set: what the preview shows and what the
 * confirmation token binds is exactly this map's worth of values.
 */
const COLLECTION_FIELDS: ParamMap = {
  title: 'cm:title',
  description: 'cm:description',
};

/** Title of a node as shown to the user, whatever property carries it. */
function titleOf(properties: Record<string, string[]> | undefined, fallback: string): string {
  const raw = collectionTitleFromProperties(properties);
  return raw ? sanitizeText(raw) : fallback;
}

/** Preview, or the outcome of redeeming the token. Null means "go ahead". */
function gate(params: Record<string, unknown>, cs: ChangeSet, whatHappensNext: string) {
  const token = typeof params['confirmToken'] === 'string' ? params['confirmToken'] : '';
  if (!token) return previewReply(cs, whatHappensNext);
  return confirmOrExplain(token, cs);
}

export function registerCurationCollectionTools(server: McpServer, challenge: WriteAuthChallenge): void {
  registerCurationTool(server, challenge, {
    name: 'wlo_create_collection',
    title: 'WLO Sammlung anlegen',
    description:
      'Lege eine neue WLO-Sammlung an — eine kuratierte Themenseite. Ohne parentId entsteht sie auf oberster ' +
      'Ebene, mit parentId als Untersammlung. ZWEISTUFIG: ohne confirmToken nur Vorschau. Erfordert eine Anmeldung.',
    inputSchema: {
      title: z.string().describe('Titel der Sammlung.'),
      description: z.string().optional().describe('Kurzbeschreibung.'),
      parentId: z.string().optional().describe('nodeId der übergeordneten Sammlung; weglassen für oberste Ebene.'),
      confirmToken: CONFIRM_TOKEN,
    },
    annotations: WRITE_ANNOTATIONS,
    handler: async (params: Record<string, unknown>) => {
      try {
        requireWrite();
        const title = String(params['title'] ?? '').trim();
        if (!title) return errorText('Eine Sammlung braucht einen Titel.');
        const collected = collectDesired(params, COLLECTION_FIELDS);
        if (!collected.ok) return rejectionReply(collected.reasons, candidatesField(collected.candidates));
        const parentId = typeof params['parentId'] === 'string' && params['parentId'] ? params['parentId'] : null;
        // The parent is read and must be a collection — the check the tree tool
        // and `addToCollectionId` already apply (`readFilingTarget`). The create
        // endpoint was handed any id: a folder's, a record's (cross-package
        // review of the audit follow-up, phase 1).
        const parent = parentId ? await readFilingTarget(parentId) : null;
        if (parent && !parent.ok) {
          return parent.reason === 'not_found'
            ? codedError('not_found', `Die übergeordnete Sammlung „${sanitizeText(parentId!)}“ wurde nicht gefunden oder ist nicht lesbar. Es wurde nichts angelegt.`)
            : codedError('not_a_collection', `„${sanitizeText(parentId!)}“ ist keine Sammlung — eine Untersammlung braucht eine Sammlung als Eltern. Es wurde nichts angelegt.`);
        }

        // The collection does not exist yet, so the change set is anchored on
        // the intended title — that is what identifies it before it has an id.
        // The values go in as real changes so the preview names the description
        // and the token binds it; carrying it beside the change set would let an
        // approved create write text nobody was shown.
        const cs = buildChangeSet(`neu:${title}`, 'collection', {}, collected.desired, {
          // Named by its title: the key binds to this sentence, and a bare id is
          // not something a person can check.
          action: parent?.ok
            ? `Legt die Untersammlung „${sanitizeText(title)}“ unter „${sanitizeText(parent.target.title)}“ (${parentId}) an.`
            : `Legt die Sammlung „${sanitizeText(title)}“ auf oberster Ebene an.`,
        });
        const refusal = gate(params, cs, 'Zum Anlegen bitte bestätigen.');
        if (refusal) return refusal;

        const description = collected.desired['cm:description']?.[0];
        const result = await createCollection(parentId, { title, description });
        if (result.status === 'failed') return errorText(`Die Sammlung konnte nicht angelegt werden: ${result.detail}`);
        const created = `Sammlung „${sanitizeText(title)}“ angelegt: ${result.nodeId}`;
        const report = reportMutation(result.check, created, 'Die Sammlung wurde angelegt, aber nicht vollständig');
        // The collection exists whatever the read-back said, so its id leads the
        // reply — without it nobody can go and look at what did or did not land.
        return result.check.status === 'ok' ? report : prependText(report, created);
      } catch (err) {
        return timeoutOrError('Die Sammlung konnte nicht angelegt werden', err,
          `Ob die Sammlung „${sanitizeText(String(params['title'] ?? ''))}“ angelegt wurde, ist offen`, { preview: isPreviewCall(params) });
      }
    },
  });

  registerCurationTool(server, challenge, {
    name: 'wlo_rename_collection',
    title: 'WLO Sammlung umbenennen',
    description:
      'Ändere Titel und Beschreibung einer WLO-Sammlung. ZWEISTUFIG: ohne confirmToken nur Vorschau mit ' +
      'altem und neuem Titel. Erfordert eine Anmeldung.',
    inputSchema: {
      nodeId: z.string().describe('nodeId der Sammlung.'),
      title: z.string().describe('Neuer Titel.'),
      description: z.string().optional().describe('Neue Beschreibung.'),
      confirmToken: CONFIRM_TOKEN,
    },
    annotations: WRITE_ANNOTATIONS,
    handler: async (params: Record<string, unknown>) => {
      try {
        requireWrite();
        const nodeId = String(params['nodeId'] ?? '');
        const title = String(params['title'] ?? '').trim();
        if (!title) return errorText('Eine Sammlung braucht einen Titel.');
        const collected = collectDesired(params, COLLECTION_FIELDS);
        if (!collected.ok) return rejectionReply(collected.reasons, candidatesField(collected.candidates));

        const node = await getNodeMetadata(nodeId);
        if (!node) return codedError('not_found', `Die Sammlung „${sanitizeText(nodeId)}“ wurde nicht gefunden oder ist nicht lesbar.`);
        // The repository validates nothing here; the tool boundary is the one place that can (audit K-11).
        const wrong = wrongKind(node, 'collection');
        if (wrong) return wrongKindReply(nodeId, wrong);
        const old = titleOf(node.properties, nodeId);

        // Both values are diffed against the record, so the preview shows the
        // description this call would overwrite and the token binds it. Passing
        // it beside the change set meant a curator approved a rename and got a
        // description they never read.
        const cs = buildChangeSet(nodeId, 'collection', node.properties ?? {}, collected.desired, {
          action: `Ändert die Sammlung „${old}“ (${nodeId}).`,
        });
        const refusal = gate(params, cs, 'Zum Übernehmen bitte bestätigen.');
        if (refusal) return refusal;

        const description = collected.desired['cm:description']?.[0];
        // "nicht vollständig geändert" rather than "nicht umbenannt": the title
        // and the description travel on different routes, so one can land while
        // the other does not.
        return reportMutation(
          await renameCollection(nodeId, { title, description }),
          `Sammlung heißt jetzt „${sanitizeText(title)}“.`,
          'Die Sammlung konnte nicht vollständig geändert werden',
        );
      } catch (err) {
        return timeoutOrError('Die Sammlung konnte nicht umbenannt werden', err,
          `Ob die Sammlung „${sanitizeText(String(params['nodeId'] ?? ''))}“ umbenannt wurde, ist offen`, { preview: isPreviewCall(params) });
      }
    },
  });

  registerCurationTool(server, challenge, {
    name: 'wlo_add_to_collection',
    preparable: true,
    title: 'WLO Material in Sammlung aufnehmen',
    description:
      'Nimm ein vorhandenes Material in eine WLO-Sammlung auf. Das Material bleibt dabei dort, wo es ist — ' +
      'eine Sammlung enthält Verweise, es wird nichts verschoben oder kopiert. Die id einer Verknüpfung (aus ' +
      'einer Sammlungsliste) wird aufs Original umgeleitet; liegt das Material schon in der Sammlung, wird ' +
      'nichts gesendet. ZWEISTUFIG: ohne confirmToken nur Vorschau. Erfordert eine Anmeldung.',
    inputSchema: {
      collectionId: z.string().describe('nodeId der Sammlung.'),
      nodeId: z.string().describe('nodeId des Materials.'),
      confirmToken: CONFIRM_TOKEN,
    },
    annotations: WRITE_ANNOTATIONS,
    handler: (params) => referenceHandler(params, {
      verb: 'Aufnehmen',
      action: (material, collection, ids) =>
        `Nimmt „${material}“ in die Sammlung „${collection}“ auf (${ids}). ` +
        'Das Material selbst wird dabei nicht verändert.',
      apply: addToCollection,
      fileOriginal: true,
      // Filing needs no lookup — the collection is the caller's and the record
      // id is already resolved to the original, so the descriptor is ready by
      // construction.
      prepare: (collection, nodeId) => ({ status: 'ready', request: addToCollectionRequest(collection, nodeId) }),
      done: (material, collection) => `„${material}“ ist jetzt in „${collection}“.`,
      context: 'Das Material konnte nicht aufgenommen werden',
    }),
  });

  registerCurationTool(server, challenge, {
    name: 'wlo_remove_from_collection',
    preparable: true,
    title: 'WLO Material aus Sammlung nehmen',
    description:
      'Nimm ein Material aus einer WLO-Sammlung heraus. Das Material selbst wird NICHT gelöscht und bleibt ' +
      'in allen anderen Sammlungen erhalten — entfernt wird nur der Verweis aus dieser einen Sammlung. Zum ' +
      'wirklichen Löschen eines Materials gibt es wlo_delete_content. ZWEISTUFIG: ohne confirmToken nur ' +
      'Vorschau. Erfordert eine Anmeldung.',
    inputSchema: {
      collectionId: z.string().describe('nodeId der Sammlung.'),
      nodeId: z.string().describe('nodeId des Materials.'),
      confirmToken: CONFIRM_TOKEN,
    },
    annotations: WRITE_ANNOTATIONS,
    handler: (params) => referenceHandler(params, {
      verb: 'Herausnehmen',
      action: (material, collection, ids) =>
        `Nimmt „${material}“ aus der Sammlung „${collection}“ heraus (${ids}). ` +
        'Das Material selbst bleibt bestehen und wird nicht gelöscht.',
      apply: removeFromCollection,
      prepare: removeFromCollectionRequest,
      done: (material, collection) => `„${material}“ ist nicht mehr in „${collection}“. Das Material selbst besteht weiter.`,
      context: 'Das Material konnte nicht herausgenommen werden',
    }),
  });
}

interface ReferenceSpec {
  /** Capitalised, as it appears in "Zum … bitte bestätigen." */
  verb: string;
  action: (material: string, collection: string, ids: string) => string;
  apply: (collection: string, nodeId: string) => Promise<MutationOutcome>;
  /** The same call as `apply`, described instead of sent (E2). Only tools
   *  registered `preparable` need one. Async because a removal has to resolve
   *  the reference id first, and that lookup can honestly come up empty. */
  prepare?: (collection: string, nodeId: string) => PrepareOutcome | Promise<PrepareOutcome>;
  done: (material: string, collection: string) => string;
  context: string;
  /**
   * File the ORIGINAL when the id names a collection reference — the rule of the
   * batch tool (`filing-plan.ts`: "the filing PUT takes the original"), which
   * the single tool did not follow (audit 2026-11-12, K-11). Ids from a
   * collection listing are reference ids, so this is the ordinary case.
   *
   * Only for adding. A REMOVAL addresses the reference node itself, and the
   * removal path resolves that on its own.
   */
  fileOriginal?: true;
}

/**
 * Adding and removing a reference are the same shape: read both ends so the
 * preview can name them, confirm, apply. Kept as one function so the two can
 * never drift into saying different things about what a reference is.
 */
async function referenceHandler(params: Record<string, unknown>, spec: ReferenceSpec) {
  try {
    const route = requireWriteRoute();
    const collectionId = String(params['collectionId'] ?? '');
    const nodeId = String(params['nodeId'] ?? '');

    const [collection, material] = await Promise.all([
      getNodeMetadata(collectionId),
      getNodeMetadata(nodeId),
    ]);
    if (!collection) return codedError('not_found', `Die Sammlung „${sanitizeText(collectionId)}“ wurde nicht gefunden oder ist nicht lesbar.`);
    if (!material) return codedError('not_found', `Das Material „${sanitizeText(nodeId)}“ wurde nicht gefunden oder ist nicht lesbar.`);
    const notCollection = wrongKind(collection, 'collection');
    if (notCollection) return wrongKindReply(collectionId, notCollection);
    // Both ends are checked: what is filed is a RECORD (a reference is one too,
    // measured 2026-11-12). A collection or folder id here was sent on as given.
    const notRecord = wrongKind(material, 'content');
    if (notRecord) return wrongKindReply(nodeId, notRecord);

    // What is SENT: the original for a filing, the id as given otherwise. It is
    // in the change set's key and in the sentence the key binds to, so the
    // person approves the record that is actually filed.
    const sentId = spec.fileOriginal ? resolveWriteTarget(material, nodeId).targetId : nodeId;
    // When redirected, the ORIGINAL is read: the preview names what is filed (an
    // overridden reference carries a title of its own), and an original that
    // cannot be read is found out here, not after the key was spent.
    const sent = sentId === nodeId ? material : await getNodeMetadata(sentId);
    if (!sent) {
      return codedError('not_found', `„${sanitizeText(nodeId)}“ ist eine Verknüpfung; aufgenommen würde das Original `
        + `${sanitizeText(sentId)}, das aber nicht lesbar ist. Es wurde nichts geändert.`);
    }

    const collectionTitle = titleOf(collection.properties, collectionId);
    // A MATERIAL: the record chain, not the collection's.
    const materialTitle = titleFromProperties(sent.properties) ? recordTitle(sent.properties) : sentId;

    // Already there: nothing is sent and no key is issued — the rule of the
    // batch tool (`filingStep`). The redirection makes the case ordinary: a
    // reference id from collection X filed "into X" is its original, which X
    // already holds. `null` (could not be found out) files as before.
    if (spec.fileOriginal && await isAlreadyFiled(sentId, collectionId) === true) {
      return plainText(`„${materialTitle}“ ist bereits in „${collectionTitle}“ — es wurde nichts gesendet.`);
    }

    const ids = sentId === nodeId
      ? `${collectionId} / ${nodeId}`
      : `${collectionId} / Verknüpfung ${nodeId} — aufgenommen wird das Original ${sentId}`;

    const cs = buildChangeSet(`${collectionId}/${sentId}`, 'collection', {}, {}, {
      action: spec.action(materialTitle, collectionTitle, ids),
    });
    const refusal = gate(params, cs, `Zum ${spec.verb} bitte bestätigen.`);
    if (refusal) return refusal;

    if (route === 'prepare') {
      // Never fall through to the write: without a descriptor this call would
      // otherwise change data under the shared account, which is the one thing
      // the prepare route exists to avoid. Unreachable while only preparable
      // tools take this route — and cheap insurance if one is added past that.
      if (!spec.prepare) {
        return errorText('Dieser Vorgang lässt sich in dieser Betriebsart nicht vorbereiten. Es wurde nichts geändert.');
      }
      const prepared = await spec.prepare(collectionId, sentId);
      // A refusal is a finding about the collection, not a failure of this
      // server — and it must not become a request anyway, since somebody else
      // would then send it with a real person's rights.
      if (prepared.status === 'refused') return errorText(prepared.detail);
      return preparedReply(prepared.request, spec.done(materialTitle, collectionTitle));
    }

    return reportMutation(
      await spec.apply(collectionId, sentId),
      spec.done(materialTitle, collectionTitle),
      spec.context,
    );
  } catch (err) {
    return timeoutOrError(spec.context, err,
      `Ob die Änderung an der Sammlung „${sanitizeText(String(params['collectionId'] ?? ''))}“ gewirkt hat, ist offen`, { preview: isPreviewCall(params) });
  }
}
