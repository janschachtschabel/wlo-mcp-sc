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

import { toolError } from './shared.js';
import { requireWrite, writeMode } from '../services/write/credential-gate.js';
import { buildChangeSet } from '../services/write/change-set.js';
import { updateNodeMetadata } from '../services/write/nodes.js';
import { createContentNode, resolveCreateParent, submitForReview } from '../services/write/nodes-lifecycle.js';
import { resolveContentSource, resolveFileUpload, describeUpload } from '../services/write/content-source.js';
import { uploadContent, type UploadOutcome } from '../services/write/content-upload.js';
import { findByTitle } from '../services/write/duplicates.js';
import { WLO_INBOX_ID } from '../wlo-config.js';
import { verifyWrite } from '../services/write/verify.js';
import { getNodeMetadata } from '../wlo-node.js';
import { flattenText, sanitizeText } from '../text-sanitize.js';
import {
  registerCurationTool,
  type WriteAuthChallenge,
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
  // The same file surface as the create tool. Optional here and independent of
  // the metadata fields: a call may change only metadata, only the file, or both.
  content: z.string().optional()
    .describe('Neuer Inhalt als Text (z. B. überarbeitetes Markdown). ERSETZT den vorhandenen Inhalt des ' +
      'Datensatzes; die bisherige Fassung bleibt in der Versionshistorie.'),
  contentFormat: z.enum(['markdown', 'text']).optional()
    .describe('Format von content. Vorgabe: markdown. HTML wird nicht hochgeladen.'),
  fileBase64: z.string().optional()
    .describe('Neues Bild als Base64 oder data:-URL. ERSETZT den vorhandenen Inhalt. Erkannt werden PNG, ' +
      'JPEG, GIF und WebP — der Typ wird aus den Daten gelesen.'),
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
  title: z.string().describe('Titel des neuen Datensatzes. Pflichtangabe.'),
  // Exactly one source. Optional in the schema and checked in the handler,
  // because "exactly one of three" is a relationship between fields, and a
  // model reads one clear sentence better than three optional flags.
  url: z.string().optional()
    .describe('WEG 1 — das Material liegt woanders: Quell-URL (ccm:wwwurl), nur http/https. Der Inhalt ' +
      'bleibt extern und wird vom Repository erschlossen.'),
  content: z.string().optional()
    .describe('WEG 2 — der Datensatz trägt den Inhalt selbst: der Text, z. B. ein im Chat erstelltes ' +
      'Arbeitsblatt in Markdown. Für Inhalte ohne eigene URL.'),
  contentFormat: z.enum(['markdown', 'text']).optional()
    .describe('Format von content. Vorgabe: markdown. HTML wird nicht hochgeladen.'),
  fileBase64: z.string().optional()
    .describe('WEG 2 für Bilder: die Bilddatei als Base64, wahlweise als data:-URL ' +
      '(data:image/png;base64,…) oder als reiner Base64-Text. Erkannt werden PNG, JPEG, GIF und WebP — ' +
      'der Typ wird aus den Daten gelesen, ein angegebener Typ wird ignoriert.'),
  confirmToken: CONFIRM_TOKEN,
};

const submitSchema = {
  nodeId: z.string().describe('nodeId des Datensatzes, der zur Prüfung eingereicht werden soll.'),
  // Travels to the editorial queue under the submitter's name, so it is bounded
  // here and shown in the preview below — see the action string.
  comment: z.string().max(1000).optional().describe('Notiz für die Redaktion.'),
  confirmToken: CONFIRM_TOKEN,
};

/**
 * What became of the file, as one sentence for both tools.
 *
 * Worded about the FILE, not about the surrounding act, because the same
 * sentence has to be true beside "Angelegt: <id>" and after a metadata change —
 * "Der Datensatz wurde angelegt" would be a lie on the update path.
 *
 * Every outcome except `stored` is stated plainly, including the one edu-sharing
 * makes easy to miss: a `200` for an upload the record does not show. Someone
 * told "created" who finds an empty record learns the hard way; someone told the
 * record has no content yet can fix it.
 */
function uploadNote(upload: UploadOutcome | undefined): string {
  if (!upload) return '';
  switch (upload.status) {
    case 'stored':
      return ` — Datei hochgeladen (${upload.size} Bytes).`;
    case 'dropped':
      return ' — ACHTUNG: Der Datensatz trägt danach KEINEN Inhalt. Das Hochladen wurde mit Erfolg '
        + 'beantwortet, der Datensatz zeigt aber keine Datei. Bitte die Rechte prüfen und den Inhalt '
        + 'erneut hochladen.';
    case 'unverified':
      return ` — Das Hochladen wurde abgeschickt, ließ sich danach aber nicht überprüfen. Ob der Datensatz `
        + `den Inhalt trägt, ist offen. (${upload.detail})`;
    default:
      return ` — ACHTUNG: Das Hochladen der Datei ist fehlgeschlagen: ${upload.detail}`;
  }
}

export function registerCurationContentTools(server: McpServer, challenge: WriteAuthChallenge): void {
  registerCurationTool(server, challenge, {
    name: 'wlo_update_content',
    title: 'WLO Inhalt bearbeiten',
    description:
      'Ändere einen vorhandenen WLO-Datensatz: Metadaten (Titel, Beschreibung, Schlagwörter, Lizenz, Fach, ' +
      'Bildungsstufe, Inhaltstyp …) und/oder den INHALT selbst — mit content bzw. fileBase64 wird die ' +
      'hinterlegte Datei ERSETZT (z. B. ein überarbeitetes Arbeitsblatt); die bisherige Fassung bleibt in ' +
      'der Versionshistorie. Beides geht einzeln oder zusammen. ZWEISTUFIG: Ohne confirmToken wird nur eine ' +
      'Vorschau zurückgegeben und NICHTS geschrieben; erst ein zweiter Aufruf mit dem Schlüssel aus der ' +
      'Vorschau schreibt. Danach wird der Datensatz erneut gelesen und je Feld berichtet, was tatsächlich ' +
      'ankam. Erfordert eine Anmeldung. NICHT für neue Inhalte (dafür wlo_create_content) und nicht zum Löschen.',
    inputSchema: updateSchema,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    // Not `noauth`: this tool refuses a caller without an identity.
    handler: async (params: Record<string, unknown>) => {
      try {
        requireWrite();

        const nodeId = String(params['nodeId'] ?? '');
        const collected = collectDesired(params, CONTENT_FIELDS);
        if (!collected.ok) return rejectionReply(collected.reasons);
        const carriesFile = typeof params['content'] === 'string' || typeof params['fileBase64'] === 'string';
        // A file alone IS a change. Without this the tool would refuse "just
        // replace the content", which is the main reason the file path exists
        // on an existing record at all.
        if (Object.keys(collected.desired).length === 0 && !carriesFile) {
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

        // The file name is derived from a title, and on an update the caller may
        // not be changing one — so the record's STORED title is what names it.
        const resolved = resolveFileUpload(
          collected.desired['cclom:title']?.[0] ?? recordTitle(node.properties) ?? nodeId,
          {
            content: typeof params['content'] === 'string' ? params['content'] : undefined,
            contentFormat: typeof params['contentFormat'] === 'string' ? params['contentFormat'] : undefined,
            fileBase64: typeof params['fileBase64'] === 'string' ? params['fileBase64'] : undefined,
          },
        );
        if (!resolved.ok) return errorText(resolved.reason);
        const file = resolved.file;

        // Both extras belong in the change set, and for the same reason: the
        // token is bound to it, so anything the call will additionally DO must
        // be visible in the preview. A commit adds a permanent version entry; a
        // file replaces what the record currently carries.
        const extras = [
          file
            ? `Ersetzt den Inhalt des Datensatzes — die bisherige Fassung bleibt in der `
              + `Versionshistorie. ${describeUpload(file)}`
            : '',
          commit
            // Flattened at the composition site like every other foreign part of
            // an action, so the sentence it becomes is safe on its own terms
            // rather than relying on the renderer.
            ? `Legt beim Übernehmen eine neue Version an${
              versionComment ? ` mit dem Kommentar „${flattenText(versionComment)}“` : ''}.`
            : '',
        ].filter(Boolean);

        const cs = buildChangeSet(nodeId, 'content', node.properties ?? {}, collected.desired, {
          ...(extras.length ? { action: extras.join(' ') } : {}),
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

        // After the metadata, so a record whose content replacement fails still
        // carries the fields that were meant to describe it. The two are
        // separate repository operations and either can fail alone, so both are
        // reported rather than merged into one verdict.
        const upload = file ? await uploadContent(nodeId, file) : undefined;
        const note = uploadNote(upload).replace(/^ — /, '');

        try {
          const verified = await verifyWrite(nodeId, cs);
          const report = reportOutcome(cs, statuses, verified);
          return note ? prependText(report, note) : report;
        } catch (err) {
          const report = unverifiedReply(err);
          return note ? prependText(report, note) : report;
        }
      } catch (err) {
        return timeoutOrError('Der Datensatz konnte nicht bearbeitet werden', err,
          `Ob die Änderung an „${sanitizeText(String(params['nodeId'] ?? ''))}“ gespeichert wurde, ist offen`);
      }
    },
  });

  registerCurationTool(server, challenge, {
    name: 'wlo_create_content',
    title: 'WLO Inhalt anlegen',
    description:
      'Lege einen NEUEN WLO-Datensatz an. ZWEI WEGE: (1) url — das Material liegt woanders und wird ' +
      'verlinkt; vorher wird geprüft, ob es zu dieser URL schon einen Datensatz gibt, und dann nichts ' +
      'angelegt. (2) content oder fileBase64 — der Datensatz trägt den Inhalt selbst, als Datei. Das ist ' +
      'der Weg für im Chat erstellte Materialien (Arbeitsblatt als Markdown, erzeugtes Bild), die keine ' +
      'eigene URL haben. Genau eine Quelle angeben. ZWEISTUFIG: ohne confirmToken nur Vorschau, nichts ' +
      'wird angelegt; die Vorschau nennt bei einer Datei Name, Typ, Größe und Prüfsumme. Der Datensatz ' +
      'entsteht als Entwurf und geht NICHT automatisch in die redaktionelle Prüfung — dafür gibt es ' +
      'wlo_submit_content. Erfordert eine Anmeldung.',
    inputSchema: createSchema,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    handler: async (params: Record<string, unknown>) => {
      try {
        requireWrite();

        const collected = collectDesired(params, CONTENT_FIELDS);
        if (!collected.ok) return rejectionReply(collected.reasons);
        const title = collected.desired['cclom:title']?.[0];
        if (!title) return errorText('Zum Anlegen wird mindestens ein Titel benötigt.');

        const resolved = resolveContentSource({
          title,
          url: collected.desired['ccm:wwwurl']?.[0],
          content: typeof params['content'] === 'string' ? params['content'] : undefined,
          contentFormat: typeof params['contentFormat'] === 'string' ? params['contentFormat'] : undefined,
          fileBase64: typeof params['fileBase64'] === 'string' ? params['fileBase64'] : undefined,
        });
        if (!resolved.ok) return errorText(resolved.reason);
        const source = resolved.source;
        const file = source.kind === 'file' ? source.file : undefined;

        // A record that does not exist yet has no id, so the change set is
        // anchored on what identifies the intended record — the URL when there
        // is one, otherwise the title.
        //
        // The upload description goes in the ACTION, which means it is in the
        // preview AND in the token's fingerprint. That is the rule the whole
        // two-step exists for: bytes are payload, and an approval for "create a
        // record" must not additionally authorise a file nobody saw.
        const cs = buildChangeSet(source.kind === 'url' ? source.url : title, 'content', {}, collected.desired, {
          action: file
            ? `Legt einen neuen Datensatz an. ${describeUpload(file)}`
            : 'Legt einen neuen Datensatz an:',
        });

        const token = typeof params['confirmToken'] === 'string' ? params['confirmToken'] : '';
        if (!token) {
          // Only for the file path: a URL duplicate BLOCKS at execution and
          // needs no warning, while a same-title record is weaker evidence and
          // is the person's call — so it belongs in the preview, as a note
          // beside the change set rather than inside the fingerprint.
          const notes = [...collected.notes];
          if (file) {
            const twin = await findByTitle(title, resolveCreateParent(writeMode(), WLO_INBOX_ID));
            if (twin) {
              notes.push(
                `An diesem Ablageort gibt es bereits „${sanitizeText(twin.title)}" (${twin.nodeId}). ` +
                  'Möglicherweise eine Dublette — beim Bestätigen wird trotzdem ein zweiter Datensatz angelegt.',
              );
            }
          }
          return previewReply(cs, 'Zum Anlegen bitte bestätigen.', notes);
        }

        const refusal = confirmOrExplain(token, cs);
        if (refusal) return refusal;

        const result = await createContentNode(collected.desired, {
          mode: writeMode(),
          ...(file ? { file } : {}),
        });
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
        // The upload has its own read-back, so it gets its own line — and an
        // upload that did not land is stated as such next to the id, never
        // folded into a general success.
        const head = `Angelegt: ${result.nodeId}${uploadNote(result.upload)}`;
        try {
          const verified = await verifyWrite(result.nodeId, stored);
          return prependText(reportOutcome(stored, result.statuses, verified), head);
        } catch (err) {
          return prependText(unverifiedReply(err), head);
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

  registerCurationTool(server, challenge, {
    name: 'wlo_submit_content',
    title: 'WLO Inhalt zur Prüfung einreichen',
    description:
      'Reiche einen vorhandenen Datensatz zur redaktionellen Prüfung ein (WLO-Upload-Workflow). Das ist ein ' +
      'eigener Schritt: Anlegen und Bearbeiten reichen NICHTS automatisch ein, damit kein Entwurf ' +
      'versehentlich in der Redaktions-Warteschlange landet. ZWEISTUFIG: ohne confirmToken nur Vorschau. ' +
      'Erfordert eine Anmeldung.',
    inputSchema: submitSchema,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
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
