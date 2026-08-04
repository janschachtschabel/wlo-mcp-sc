/**
 * tools/curation-content.ts – changing an existing WLO record.
 *
 * The first tool in this server that does not only read. Its shape is the
 * pattern every later mutation follows:
 *
 *   call without confirmToken  → read the record, show the diff, hand out a key,
 *                                write NOTHING
 *   call with the matching key → write, read back, report per field what landed
 *
 * The refusal in anonymous mode is repeated here even though the tool is not
 * registered in that mode: a host may serve a tool list cached from a session
 * that had an identity, and the call would then arrive anyway.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { registerWloTool } from '../apps/register.js';
import { toolError } from './shared.js';
import { requireWrite, writeMode } from '../services/write/credential-gate.js';
import { buildChangeSet } from '../services/write/change-set.js';
import { updateNodeMetadata } from '../services/write/nodes.js';
import { createContentNode, submitForReview } from '../services/write/nodes-lifecycle.js';
import { verifyWrite } from '../services/write/verify.js';
import { getNodeMetadata } from '../wlo-node.js';
import { flattenText, sanitizeText } from '../text-sanitize.js';
import {
  collectDesired,
  rejectionReply,
  previewReply,
  confirmOrExplain,
  reportOutcome,
  unverifiedReply,
  desiredFromChangeSet,
  errorText,
  prependText,
  recordTitle,
  isUpstreamTimeout,
  timeoutOrError,
} from './curation-shared.js';
import { CONTENT_FIELDS, FIELD_SCHEMA, CONFIRM_TOKEN } from './curation-fields.js';

const updateSchema = {
  nodeId: z.string().describe('nodeId of the record to change.'),
  ...FIELD_SCHEMA,
  confirmToken: CONFIRM_TOKEN,
  commit: z.boolean().optional().default(false)
    .describe('true legt eine neue Version an (für den Abschluss einer Bearbeitung); false bearbeitet den Entwurf.'),
  // Bounded like every other free text that reaches the repository: this one
  // lands in a permanent version-history entry, and an unbounded string out of a
  // conversation should not get there unchecked (mirrors MAX_LENGTH in fields.ts).
  versionComment: z.string().max(1000).optional()
    .describe('Kommentar für die Versionshistorie, nur mit commit=true.'),
};

const createSchema = {
  ...FIELD_SCHEMA,
  url: z.string().describe('Quell-URL des Materials (ccm:wwwurl); nur http/https. Pflichtangabe.'),
  title: z.string().describe('Titel des neuen Datensatzes. Pflichtangabe.'),
  confirmToken: CONFIRM_TOKEN,
};

const submitSchema = {
  nodeId: z.string().describe('nodeId des Datensatzes, der zur Prüfung eingereicht werden soll.'),
  // Travels to the editorial queue under the submitter's name, so it is bounded
  // here and shown in the preview below — see the action string.
  comment: z.string().max(1000).optional().describe('Notiz für die Redaktion.'),
  confirmToken: CONFIRM_TOKEN,
};

export function registerCurationContentTools(server: McpServer): void {
  registerWloTool(server, {
    name: 'wlo_update_content',
    title: 'WLO Inhalt bearbeiten',
    description:
      'Ändere die Metadaten eines vorhandenen WLO-Datensatzes (Titel, Beschreibung, Schlagwörter, Lizenz, ' +
      'Fach, Bildungsstufe, Inhaltstyp …). ZWEISTUFIG: Ohne confirmToken wird nur eine Vorschau der Änderung ' +
      'zurückgegeben und NICHTS geschrieben; erst ein zweiter Aufruf mit dem Schlüssel aus der Vorschau ' +
      'schreibt. Danach wird der Datensatz erneut gelesen und je Feld berichtet, was tatsächlich ankam. ' +
      'Erfordert eine Anmeldung. NICHT für neue Inhalte und nicht zum Löschen.',
    inputSchema: updateSchema,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    // Not `noauth`: this tool refuses a caller without an identity.
    securitySchemes: [{ type: 'http' }],
    handler: async (params: Record<string, unknown>) => {
      try {
        requireWrite();

        const nodeId = String(params['nodeId'] ?? '');
        const collected = collectDesired(params, CONTENT_FIELDS);
        if (!collected.ok) return rejectionReply(collected.reasons);
        if (Object.keys(collected.desired).length === 0) {
          return {
            content: [{ type: 'text' as const, text: 'Es wurde kein zu änderndes Feld angegeben.' }],
            isError: true,
          };
        }

        const node = await getNodeMetadata(nodeId);
        if (!node) {
          // The id is echoed back sanitized: it came from the caller, and this
          // text goes to the model.
          return {
            content: [{
              type: 'text' as const,
              text: `Der Datensatz „${sanitizeText(nodeId)}“ wurde nicht gefunden oder ist nicht lesbar.`,
            }],
            isError: true,
          };
        }

        const commit = params['commit'] === true;
        const versionComment = typeof params['versionComment'] === 'string' ? params['versionComment'] : undefined;

        // A commit writes the same values but also adds a permanent entry to the
        // record's version history, with a comment. Both belong in the change
        // set: unbound, a token minted for a quiet draft edit would authorise a
        // published version nobody previewed.
        const cs = buildChangeSet(nodeId, 'content', node.properties ?? {}, collected.desired, {
          ...(commit
            ? {
                // Flattened at the composition site like every other foreign
                // part of an action, so the sentence it becomes is safe on its
                // own terms rather than relying on the renderer.
                action: `Legt beim Übernehmen eine neue Version an${
                  versionComment ? ` mit dem Kommentar „${flattenText(versionComment)}“` : ''}.`,
              }
            : {}),
        });

        const token = typeof params['confirmToken'] === 'string' ? params['confirmToken'] : '';
        if (!token) {
          return previewReply(cs, 'Zum Übernehmen bitte bestätigen.', collected.notes);
        }

        const refusal = confirmOrExplain(token, cs);
        if (refusal) return refusal;

        const { statuses } = await updateNodeMetadata(nodeId, desiredFromChangeSet(cs), {
          commit,
          versionComment,
        });

        try {
          const verified = await verifyWrite(nodeId, cs);
          return reportOutcome(cs, statuses, verified);
        } catch (err) {
          return unverifiedReply(err);
        }
      } catch (err) {
        return timeoutOrError('Der Datensatz konnte nicht bearbeitet werden', err,
          `Ob die Änderung an „${sanitizeText(String(params['nodeId'] ?? ''))}“ gespeichert wurde, ist offen`);
      }
    },
  });

  registerWloTool(server, {
    name: 'wlo_create_content',
    title: 'WLO Inhalt anlegen',
    description:
      'Lege einen NEUEN WLO-Datensatz für ein Material an, das über eine URL erreichbar ist. Vorher wird ' +
      'geprüft, ob es zu dieser URL bereits einen Datensatz gibt — dann wird nichts angelegt und der ' +
      'vorhandene genannt. ZWEISTUFIG: ohne confirmToken nur Vorschau, nichts wird angelegt. Der Datensatz ' +
      'entsteht als Entwurf und geht NICHT automatisch in die redaktionelle Prüfung — dafür gibt es ' +
      'wlo_submit_content. Erfordert eine Anmeldung.',
    inputSchema: createSchema,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    securitySchemes: [{ type: 'http' }],
    handler: async (params: Record<string, unknown>) => {
      try {
        requireWrite();

        const collected = collectDesired(params, CONTENT_FIELDS);
        if (!collected.ok) return rejectionReply(collected.reasons);
        const url = collected.desired['ccm:wwwurl']?.[0];
        const title = collected.desired['cclom:title']?.[0];
        if (!url || !title) {
          return errorText('Zum Anlegen werden mindestens eine Quell-URL und ein Titel benötigt.');
        }

        // A record that does not exist yet has no id, so the change set is
        // anchored on the URL — which is exactly what identifies the intended
        // record, and what the confirmation token binds to.
        const cs = buildChangeSet(url, 'content', {}, collected.desired, {
          action: 'Legt einen neuen Datensatz an:',
        });

        const token = typeof params['confirmToken'] === 'string' ? params['confirmToken'] : '';
        if (!token) return previewReply(cs, 'Zum Anlegen bitte bestätigen.', collected.notes);

        const refusal = confirmOrExplain(token, cs);
        if (refusal) return refusal;

        const result = await createContentNode(collected.desired, { mode: writeMode() });
        if (result.status === 'duplicate') {
          return errorText(
            `Es gibt bereits einen Datensatz für diese URL: „${sanitizeText(result.existing.title)}“ ` +
              `(${result.existing.nodeId}). Es wurde nichts angelegt — bitte diesen bearbeiten statt einen zweiten anzulegen.`,
          );
        }
        if (result.status === 'failed') {
          return errorText(`Der Datensatz konnte nicht angelegt werden: ${result.detail}`);
        }

        // The metadata step ran against the new node, so the read-back has to
        // compare against THAT id, not the URL the change set was anchored on.
        const stored = buildChangeSet(result.nodeId, 'content', {}, collected.desired);
        try {
          const verified = await verifyWrite(result.nodeId, stored);
          const report = reportOutcome(stored, result.statuses, verified);
          return prependText(report, `Angelegt: ${result.nodeId}`);
        } catch (err) {
          return prependText(unverifiedReply(err), `Angelegt: ${result.nodeId}`);
        }
      } catch (err) {
        // Nothing upstream happens before the token is redeemed, so any abort
        // here interrupted a write that may well have completed.
        if (isUpstreamTimeout(err)) {
          return errorText(
            'Die Antwort des Repositories kam nicht rechtzeitig. Ob der Datensatz angelegt wurde, ist damit ' +
              'unklar — der Abbruch trifft die Antwort, nicht die Arbeit. Bitte den Aufruf erneut ausführen: ' +
              'Gibt es den Datensatz zu dieser URL bereits, wird er mit seiner ID genannt, statt einen zweiten anzulegen.',
          );
        }
        return toolError('Der Datensatz konnte nicht angelegt werden', err);
      }
    },
  });

  registerWloTool(server, {
    name: 'wlo_submit_content',
    title: 'WLO Inhalt zur Prüfung einreichen',
    description:
      'Reiche einen vorhandenen Datensatz zur redaktionellen Prüfung ein (WLO-Upload-Workflow). Das ist ein ' +
      'eigener Schritt: Anlegen und Bearbeiten reichen NICHTS automatisch ein, damit kein Entwurf ' +
      'versehentlich in der Redaktions-Warteschlange landet. ZWEISTUFIG: ohne confirmToken nur Vorschau. ' +
      'Erfordert eine Anmeldung.',
    inputSchema: submitSchema,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    securitySchemes: [{ type: 'http' }],
    handler: async (params: Record<string, unknown>) => {
      try {
        requireWrite();

        const nodeId = String(params['nodeId'] ?? '');
        const comment = typeof params['comment'] === 'string' ? params['comment'] : '';

        const node = await getNodeMetadata(nodeId);
        if (!node) return errorText(`Der Datensatz „${sanitizeText(nodeId)}“ wurde nicht gefunden oder ist nicht lesbar.`);

        // The note is IN the action, which means it is in the preview and in the
        // token's fingerprint. Without that, an approval for "submit this
        // record" would carry whatever note arrived with the confirming call —
        // unseen, and attributed to the person who approved something else.
        // Flattened rather than capped: it is exactly the text they must read.
        const cs = buildChangeSet(nodeId, 'content', node.properties ?? {}, {}, {
          action: `Reicht „${recordTitle(node.properties)}“ (${nodeId}) zur redaktionellen Prüfung ein.`
            + (comment ? ` Notiz an die Redaktion: „${flattenText(comment)}“` : ''),
        });

        const token = typeof params['confirmToken'] === 'string' ? params['confirmToken'] : '';
        if (!token) {
          return previewReply(
            cs,
            'Danach liegt der Datensatz bei der Redaktion und kann nicht mehr unbemerkt zurückgezogen werden.',
          );
        }

        const refusal = confirmOrExplain(token, cs);
        if (refusal) return refusal;

        const outcome = await submitForReview(nodeId, comment);
        switch (outcome.status) {
          case 'submitted':
            return { content: [{ type: 'text' as const, text:
              `Zur redaktionellen Prüfung eingereicht — der Datensatz trägt jetzt den Status ` +
              `${outcome.workflowStatus} und liegt bei ${sanitizeText(outcome.receiver)}.` }] };
          case 'dropped':
            // The measured failure this read-back exists for: the call succeeds
            // and the record shows no submission. "Eingereicht" would leave a
            // draft in nobody's queue while the user believes an editor has it.
            return errorText(
              'Das Einreichen wurde mit Erfolg beantwortet, der Datensatz zeigt danach aber keinen ' +
                'Workflow-Status. Er wurde also NICHT eingereicht — bitte die Rechte an diesem Datensatz prüfen.',
            );
          case 'unverified':
            return errorText(
              `Das Einreichen wurde abgeschickt, konnte danach aber nicht überprüft werden. Ob der Datensatz ` +
                `in der Redaktions-Warteschlange liegt, ist damit offen. (${outcome.detail})`,
            );
          default:
            return errorText(`Das Einreichen ist fehlgeschlagen: ${outcome.detail}`);
        }
      } catch (err) {
        return timeoutOrError('Der Datensatz konnte nicht eingereicht werden', err,
          `Ob „${sanitizeText(String(params['nodeId'] ?? ''))}“ in der Redaktions-Warteschlange liegt, ist offen`);
      }
    },
  });
}
