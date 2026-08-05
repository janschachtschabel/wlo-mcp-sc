/**
 * tools/curation-compendium.ts – writing a collection's editorial prose.
 *
 * `ccm:oeh_collection_compendium_text` is not in the metadata set. Measured:
 * `PUT …/metadata` answers 200 for it and stores nothing. The property endpoint
 * is the only route that works, and `updateNodeMetadata` already routes it
 * there via the field allow-list — so this tool adds the conversation, not a
 * second write path.
 *
 * Removing the text is its own parameter rather than "pass an empty string":
 * an empty string is a value, `null` is the absence of one, and only the second
 * actually clears the property.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { registerWloTool } from '../apps/register.js';
import { OAUTH_SECURITY_SCHEMES } from '../apps/tool-defaults.js';
import { requireWrite } from '../services/write/credential-gate.js';
import { buildChangeSet } from '../services/write/change-set.js';
import { updateNodeMetadata, deleteProperty } from '../services/write/nodes.js';
import { verifyWrite } from '../services/write/verify.js';
import { validateField } from '../services/write/fields.js';
import { getNodeMetadata, readNodeMetadata } from '../wlo-node.js';
import { sanitizeText } from '../text-sanitize.js';
import {
  previewReply,
  confirmOrExplain,
  reportOutcome,
  unverifiedReply,
  desiredFromChangeSet,
  errorText,
  timeoutOrError,
} from './curation-shared.js';

const PROPERTY = 'ccm:oeh_collection_compendium_text';

export function registerCurationCompendiumTool(server: McpServer): void {
  registerWloTool(server, {
    name: 'wlo_update_compendium',
    title: 'WLO Kompendialtext bearbeiten',
    description:
      'Schreibe oder ersetze den redaktionellen Kompendialtext einer WLO-Sammlung (Markdown) — die ' +
      'Übersichts-Prosa, die auf der Themenseite steht. Mit remove=true wird der Text entfernt; die ' +
      'Sammlung und ihre Inhalte bleiben dabei unangetastet. ZWEISTUFIG: ohne confirmToken nur Vorschau, ' +
      'es wird nichts geschrieben. Danach wird zurückgelesen und berichtet, ob der Text wirklich ankam. ' +
      'Gilt nur für Sammlungen, nicht für einzelne Materialien. Erfordert eine Anmeldung.',
    inputSchema: {
      nodeId: z.string().describe('nodeId der Sammlung.'),
      text: z.string().optional().describe('Der neue Kompendialtext als Markdown.'),
      remove: z.boolean().optional().describe('true entfernt den vorhandenen Text.'),
      confirmToken: z.string().optional()
        .describe('Bestätigungsschlüssel aus der Vorschau. Ohne ihn wird ausschließlich die Vorschau erzeugt.'),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    securitySchemes: OAUTH_SECURITY_SCHEMES,
    handler: async (params: Record<string, unknown>) => {
      try {
        requireWrite();

        const nodeId = String(params['nodeId'] ?? '');
        const remove = params['remove'] === true;
        const text = typeof params['text'] === 'string' ? params['text'] : undefined;
        if (!remove && text === undefined) {
          return errorText('Bitte entweder einen Text angeben oder mit remove=true den vorhandenen entfernen.');
        }

        const node = await getNodeMetadata(nodeId);
        if (!node) {
          return errorText(`Die Sammlung „${sanitizeText(nodeId)}“ wurde nicht gefunden oder ist nicht lesbar.`);
        }
        const before = node.properties ?? {};
        const title = sanitizeText(before['cm:title']?.[0] ?? before['cclom:title']?.[0] ?? nodeId);

        if (remove) return await handleRemoval(nodeId, title, before, params);

        const validated = validateField(PROPERTY, text as string);
        if (!validated.ok) return errorText(validated.reason);

        const cs = buildChangeSet(nodeId, 'compendium', before, { [PROPERTY]: validated.values });
        const token = typeof params['confirmToken'] === 'string' ? params['confirmToken'] : '';
        if (!token) return previewReply(cs, 'Zum Übernehmen bitte bestätigen.');

        const refusal = confirmOrExplain(token, cs);
        if (refusal) return refusal;

        const { statuses } = await updateNodeMetadata(nodeId, desiredFromChangeSet(cs), { commit: false });
        try {
          return reportOutcome(cs, statuses, await verifyWrite(nodeId, cs));
        } catch (err) {
          return unverifiedReply(err);
        }
      } catch (err) {
        return timeoutOrError('Der Kompendialtext konnte nicht bearbeitet werden', err,
          `Ob der Text an „${sanitizeText(String(params['nodeId'] ?? ''))}“ gespeichert wurde, ist offen`);
      }
    },
  });
}

/**
 * Removal is a separate path because it cannot be expressed as a field change:
 * the change set carries values, and what clears the property is their absence.
 * The intent therefore travels as an `action`, which is also what the
 * confirmation token binds to.
 */
async function handleRemoval(
  nodeId: string,
  title: string,
  before: Record<string, string[]>,
  params: Record<string, unknown>,
) {
  if (!before[PROPERTY]?.length) {
    return errorText(`Die Sammlung „${title}“ hat keinen Kompendialtext, der entfernt werden könnte.`);
  }

  const cs = buildChangeSet(nodeId, 'compendium', before, {}, {
    action: `Entfernt den Kompendialtext von „${title}“ (${nodeId}). Die Sammlung selbst bleibt mit allen Inhalten bestehen.`,
  });

  const token = typeof params['confirmToken'] === 'string' ? params['confirmToken'] : '';
  if (!token) return previewReply(cs, 'Zum Entfernen bitte bestätigen.');

  const refusal = confirmOrExplain(token, cs);
  if (refusal) return refusal;

  const failure = await deleteProperty(nodeId, PROPERTY);
  if (failure) return errorText(`Der Kompendialtext konnte nicht entfernt werden: ${failure}`);

  // The status is read, not inferred from a null node: `getNodeMetadata` folds
  // every non-OK response into null, and "we could not look" would otherwise be
  // indistinguishable from "the property is gone" — and reported as success.
  const { node: after, status } = await readNodeMetadata(nodeId);
  if (!after) {
    return errorText(
      `Das Entfernen wurde abgeschickt, ließ sich danach aber nicht überprüfen ` +
        `(HTTP ${status || 'keine verwertbare Antwort'}). Ob der Kompendialtext weg ist, ist damit offen — ` +
        'bitte die Sammlung direkt ansehen.',
    );
  }
  if (after.properties?.[PROPERTY]?.length) {
    return errorText(
      'Das Entfernen wurde mit Erfolg beantwortet, der Text steht aber weiterhin im Datensatz. ' +
        'Er wurde also NICHT entfernt — bitte die Rechte an dieser Sammlung prüfen.',
    );
  }
  return { content: [{ type: 'text' as const, text: `Kompendialtext von „${title}“ entfernt.` }] };
}
