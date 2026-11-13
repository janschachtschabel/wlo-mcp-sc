/**
 * tools/curation-fulltext.ts – wlo_attach_fulltext (plan 2026-11-08, W1).
 *
 * A full text into the record's own `textContent`. The rules — the safeguard for
 * records with a file, the refusal of linked records, the raw body, the
 * read-back — live in `services/write/fulltext.ts`; this module validates,
 * previews and reports. Live-measured 2026-11-13 (`tests/live/fulltext.test.ts`):
 * a record without a file takes the text; on a record with one it REPLACES the file.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { buildChangeSet } from '../services/write/change-set.js';
import { requireWrite } from '../services/write/credential-gate.js';
import { FULLTEXT_MAX_BYTES, fulltextLine, planFulltext, writeFulltext } from '../services/write/fulltext.js';
import { SOURCE_SCHEMA, parseFulltextInput } from './curation-fulltext-input.js';
import { registerCurationFulltextsTool } from './curation-fulltexts.js';
import { sanitizeText } from '../text-sanitize.js';
import {
  codedError, confirmOrExplain, previewReply, timeoutOrError, isPreviewCall, plainText, registerCurationTool,
  type WriteAuthChallenge,
} from './curation-shared.js';

/** W1 and W2 — registered together, so the two full-text tools are always listed as a pair. */
export function registerCurationFulltextTools(server: McpServer, challenge: WriteAuthChallenge): void {
  registerCurationFulltextTool(server, challenge);
  registerCurationFulltextsTool(server, challenge);
}

function registerCurationFulltextTool(server: McpServer, challenge: WriteAuthChallenge): void {
  registerCurationTool(server, challenge, {
    name: 'wlo_attach_fulltext',
    title: 'WLO Volltext anhängen',
    description: `Lege einen Volltext (Markdown) im textContent eines vorhandenen Datensatzes ab — dort, wo get_wlo_content_text und includeTextContent ihn lesen. Für Volltexte aus einer Datei, einer Webseite oder von Hand (source), bis ${FULLTEXT_MAX_BYTES} Bytes.
ZWEISTUFIG: ohne confirmToken nur Vorschau (Datensatz, Größe, Prüfsumme, ob ersetzt wird). Schon in der Vorschau abgelehnt, mit Code: would_replace_file (der Datensatz trägt eine Datei oder einen früheren Volltext — der Text würde sie ersetzen; möglich nur an einem Datensatz ohne Datei), link_record (verlinkter Datensatz: dessen Text liest das Repository von der Seite), exists, too_large, not_found, forbidden, unreadable, unreadable_original, text_unreadable. Steht derselbe Text schon da: confirm null, unchanged true. Unmittelbar vor dem Schreiben wird erneut geprüft (changed_since_preview), danach zurückgelesen; eine Verknüpfung wird am Original geändert. Erfordert eine Anmeldung.`,
    inputSchema: {
      nodeId: z.string().min(1).max(200),
      markdown: z.string().min(1).describe('Der Volltext als Markdown.'),
      source: SOURCE_SCHEMA,
      sourceUrl: z.string().max(2000).optional().describe('Quelle des Texts (http/https), bei website.'),
      language: z.string().max(10).optional().describe('Sprachcode, z. B. "de".'),
      replace: z.boolean().optional().default(false).describe('Einen vorhandenen Volltext ersetzen.'),
      confirmToken: z.string().max(200).optional(),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    handler: async (params) => {
      try {
        requireWrite();
        const parsed = parseFulltextInput(params, params['replace'] === true);
        if (!parsed.ok) return codedError('invalid_input', parsed.reason, { outcomeOpen: false });
        const input = parsed.input;
        const planned = await planFulltext(input);
        if (!planned.ok && planned.code === 'nothing_to_change') {
          // "Already there" is no error — the shape every sibling uses (overall review, 4c).
          return { ...plainText(`${sanitizeText(input.nodeId)}: ${planned.reason} Es gibt nichts zu bestätigen.`),
            structuredContent: { confirm: null, unchanged: true, code: 'nothing_to_change' } };
        }
        if (!planned.ok) {
          return codedError(planned.code, `${sanitizeText(input.nodeId)}: ${planned.reason}`, { outcomeOpen: false });
        }
        const { plan } = planned;
        const cs = buildChangeSet(plan.targetId, 'content', {}, {}, {
          action: fulltextLine(plan),
          ...(plan.requestedId !== plan.targetId ? { redirectedFrom: plan.requestedId } : {}),
        });
        const token = typeof params['confirmToken'] === 'string' ? params['confirmToken'] : '';
        if (!token) return previewReply(cs, 'Zum Ablegen bitte bestätigen.');
        const refusal = confirmOrExplain(token, cs);
        if (refusal) return refusal;

        const out = await writeFulltext(plan, input.markdown);
        if (out.status === 'stored') {
          return { ...plainText(`Volltext abgelegt und zurückgelesen: „${plan.title}“ (${plan.targetId}), ${plan.bytes} Bytes.`),
            structuredContent: { status: 'stored', nodeId: plan.requestedId,
              ...(plan.requestedId !== plan.targetId ? { targetId: plan.targetId } : {}), bytes: plan.bytes, sha256: plan.sha256 } };
        }
        return codedError(out.code, `Volltext für „${plan.title}“ (${plan.targetId}): ${out.detail}`,
          { outcomeOpen: out.outcomeOpen, status: out.status });
      } catch (err) {
        return timeoutOrError('Der Volltext konnte nicht abgelegt werden', err,
          `Ob der Volltext an „${sanitizeText(String(params['nodeId'] ?? ''))}“ angekommen ist, ist offen`, { preview: isPreviewCall(params) });
      }
    },
  });
}
