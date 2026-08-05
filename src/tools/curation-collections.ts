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

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { registerWloTool } from '../apps/register.js';
import { OAUTH_SECURITY_SCHEMES } from '../apps/tool-defaults.js';
import { requireWrite } from '../services/write/credential-gate.js';
import { buildChangeSet, type ChangeSet } from '../services/write/change-set.js';
import {
  createCollection,
  renameCollection,
  addToCollection,
  removeFromCollection,
} from '../services/write/collections.js';
import type { MutationOutcome } from '../services/write/verify.js';
import { getNodeMetadata } from '../wlo-node.js';
import { sanitizeText } from '../text-sanitize.js';
import {
  previewReply,
  confirmOrExplain,
  errorText,
  reportMutation,
  prependText,
  collectDesired,
  rejectionReply,
  type ParamMap,
  timeoutOrError,
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
  const raw = properties?.['cm:title']?.[0] ?? properties?.['cclom:title']?.[0] ?? properties?.['cm:name']?.[0];
  return raw ? sanitizeText(raw) : fallback;
}

/** Preview, or the outcome of redeeming the token. Null means "go ahead". */
function gate(params: Record<string, unknown>, cs: ChangeSet, whatHappensNext: string) {
  const token = typeof params['confirmToken'] === 'string' ? params['confirmToken'] : '';
  if (!token) return previewReply(cs, whatHappensNext);
  return confirmOrExplain(token, cs);
}

export function registerCurationCollectionTools(server: McpServer): void {
  registerWloTool(server, {
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
    securitySchemes: OAUTH_SECURITY_SCHEMES,
    handler: async (params: Record<string, unknown>) => {
      try {
        requireWrite();
        const title = String(params['title'] ?? '').trim();
        if (!title) return errorText('Eine Sammlung braucht einen Titel.');
        const collected = collectDesired(params, COLLECTION_FIELDS);
        if (!collected.ok) return rejectionReply(collected.reasons);
        const parentId = typeof params['parentId'] === 'string' && params['parentId'] ? params['parentId'] : null;

        // The collection does not exist yet, so the change set is anchored on
        // the intended title — that is what identifies it before it has an id.
        // The values go in as real changes so the preview names the description
        // and the token binds it; carrying it beside the change set would let an
        // approved create write text nobody was shown.
        const cs = buildChangeSet(`neu:${title}`, 'collection', {}, collected.desired, {
          action: parentId
            ? `Legt die Untersammlung „${sanitizeText(title)}“ unter ${parentId} an.`
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
          `Ob die Sammlung „${sanitizeText(String(params['title'] ?? ''))}“ angelegt wurde, ist offen`);
      }
    },
  });

  registerWloTool(server, {
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
    securitySchemes: OAUTH_SECURITY_SCHEMES,
    handler: async (params: Record<string, unknown>) => {
      try {
        requireWrite();
        const nodeId = String(params['nodeId'] ?? '');
        const title = String(params['title'] ?? '').trim();
        if (!title) return errorText('Eine Sammlung braucht einen Titel.');
        const collected = collectDesired(params, COLLECTION_FIELDS);
        if (!collected.ok) return rejectionReply(collected.reasons);

        const node = await getNodeMetadata(nodeId);
        if (!node) return errorText(`Die Sammlung „${sanitizeText(nodeId)}“ wurde nicht gefunden oder ist nicht lesbar.`);
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
          `Ob die Sammlung „${sanitizeText(String(params['nodeId'] ?? ''))}“ umbenannt wurde, ist offen`);
      }
    },
  });

  registerWloTool(server, {
    name: 'wlo_add_to_collection',
    title: 'WLO Material in Sammlung aufnehmen',
    description:
      'Nimm ein vorhandenes Material in eine WLO-Sammlung auf. Das Material bleibt dabei dort, wo es ist — ' +
      'eine Sammlung enthält Verweise, es wird nichts verschoben oder kopiert. ZWEISTUFIG: ohne confirmToken ' +
      'nur Vorschau. Erfordert eine Anmeldung.',
    inputSchema: {
      collectionId: z.string().describe('nodeId der Sammlung.'),
      nodeId: z.string().describe('nodeId des Materials.'),
      confirmToken: CONFIRM_TOKEN,
    },
    annotations: WRITE_ANNOTATIONS,
    securitySchemes: OAUTH_SECURITY_SCHEMES,
    handler: (params) => referenceHandler(params, {
      verb: 'Aufnehmen',
      action: (material, collection, ids) =>
        `Nimmt „${material}“ in die Sammlung „${collection}“ auf (${ids}). ` +
        'Das Material selbst wird dabei nicht verändert.',
      apply: addToCollection,
      done: (material, collection) => `„${material}“ ist jetzt in „${collection}“.`,
      context: 'Das Material konnte nicht aufgenommen werden',
    }),
  });

  registerWloTool(server, {
    name: 'wlo_remove_from_collection',
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
    securitySchemes: OAUTH_SECURITY_SCHEMES,
    handler: (params) => referenceHandler(params, {
      verb: 'Herausnehmen',
      action: (material, collection, ids) =>
        `Nimmt „${material}“ aus der Sammlung „${collection}“ heraus (${ids}). ` +
        'Das Material selbst bleibt bestehen und wird nicht gelöscht.',
      apply: removeFromCollection,
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
  done: (material: string, collection: string) => string;
  context: string;
}

/**
 * Adding and removing a reference are the same shape: read both ends so the
 * preview can name them, confirm, apply. Kept as one function so the two can
 * never drift into saying different things about what a reference is.
 */
async function referenceHandler(params: Record<string, unknown>, spec: ReferenceSpec) {
  try {
    requireWrite();
    const collectionId = String(params['collectionId'] ?? '');
    const nodeId = String(params['nodeId'] ?? '');

    const [collection, material] = await Promise.all([
      getNodeMetadata(collectionId),
      getNodeMetadata(nodeId),
    ]);
    if (!collection) return errorText(`Die Sammlung „${sanitizeText(collectionId)}“ wurde nicht gefunden oder ist nicht lesbar.`);
    if (!material) return errorText(`Das Material „${sanitizeText(nodeId)}“ wurde nicht gefunden oder ist nicht lesbar.`);

    const collectionTitle = titleOf(collection.properties, collectionId);
    const materialTitle = titleOf(material.properties, nodeId);

    const cs = buildChangeSet(`${collectionId}/${nodeId}`, 'collection', {}, {}, {
      action: spec.action(materialTitle, collectionTitle, `${collectionId} / ${nodeId}`),
    });
    const refusal = gate(params, cs, `Zum ${spec.verb} bitte bestätigen.`);
    if (refusal) return refusal;

    return reportMutation(
      await spec.apply(collectionId, nodeId),
      spec.done(materialTitle, collectionTitle),
      spec.context,
    );
  } catch (err) {
    return timeoutOrError(spec.context, err,
      `Ob die Änderung an der Sammlung „${sanitizeText(String(params['collectionId'] ?? ''))}“ gewirkt hat, ist offen`);
  }
}
