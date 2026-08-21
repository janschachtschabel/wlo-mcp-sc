/**
 * tools/url-text.ts – get_url_text: the text behind an arbitrary web URL.
 *
 * Declared UNSAFE (see `unsafe-tools.ts`). Not because it is broken, but because
 * the risk it carries cannot be closed here: we never fetch the target — the
 * extraction service does, with Playwright, in its own process — so a redirect
 * from an approved URL into a private address is invisible at this layer.
 * `services/url-text.ts` refuses everything it CAN see beforehand.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { oneLine } from '../formatter.js';
import { getUrlText } from '../services/url-text.js';
import { registerWloTool } from '../apps/register.js';
import { urlTextSchema } from '../apps/outputSchemas.js';
import { toolError } from './shared.js';

const DEFAULT_MAX_CHARS = 200000;

/** What each refusal means, in the words a model should pass on. */
const REASON_TEXT: Record<string, string> = {
  not_http: 'Keine gültige http(s)-Adresse.',
  private_host: 'Adresse zeigt in ein privates Netz — aus Sicherheitsgründen abgelehnt.',
  dns_failed: 'Adresse liess sich nicht auflösen und damit nicht prüfen.',
  service_disabled: 'Kein Extraktionsdienst konfiguriert (WLO_TEXT_EXTRACTION_URL) — das ist eine Server-Einstellung, kein Problem der Seite.',
  extraction_failed: 'Der Extraktionsdienst konnte keinen Text gewinnen (geschützte Seite, reines Medium, oder Crawling-Sperre).',
};

export function registerUrlTextTool(server: McpServer): void {
  registerWloTool(server, {
    name: 'get_url_text',
    title: 'Volltext einer Webseite',
    description: `Hole den Text einer BELIEBIGEN Webseite — auch einer Wikipedia-Seite — über den Extraktionsdienst. Damit lässt sich eine Seite zusammenfassen, vergleichen oder als Grundlage für Aufgaben und neue Datensätze nutzen.
NIMM DIES statt einer Websuche, sobald die Adresse bekannt ist — auch für den vollen Artikeltext einer Wikipedia-Seite; get_wikipedia_summary liefert nur den Anriss.
NICHT für WLO-Material: dafür get_wlo_content_text mit der nodeId — schneller, und es funktioniert auch dort, wo dieses Werkzeug scheitert.
Kein Text ist ein normales Ergebnis, kein Fehler: "reason" sagt warum. Bei "extraction_failed" lohnt genau ein zweiter Versuch mit dem anderen "method" (geschützte Seiten, Crawling-Sperren, reine Video-/Audiodateien).
UNSICHER (unsafe): ruft eine vom Aufrufer gewählte Adresse über einen fremden Dienst ab; abschaltbar per WLO_DISABLE_UNSAFE_TOOLS.`,
    inputSchema: {
      url: z.string().url().max(2000).describe('Vollständige http(s)-Adresse der Webseite.'),
      method: z.enum(['browser', 'simple']).optional().default('browser').describe(
        '"browser" rendert JavaScript (Standard, langsamer); "simple" holt nur das HTML. ' +
        'Scheitert der eine Weg, ist der andere der sinnvolle zweite Versuch.'
      ),
      maxChars: z.number().int().min(500).max(200000).optional().default(DEFAULT_MAX_CHARS).describe(
        `Maximale Zeichenzahl (Standard ${DEFAULT_MAX_CHARS}). Längere Texte werden an einer Wortgrenze gekürzt und über "truncated" gemeldet.`
      ),
      outputFormat: z.enum(['markdown', 'json']).optional().default('markdown'),
    },
    outputSchema: urlTextSchema,
    annotations: { readOnlyHint: true, openWorldHint: true },
    unsafe: {
      reason: 'fetches an arbitrary caller-supplied URL through the extraction service; ' +
        'a redirect or a DNS change after our check happens inside that service, where we cannot see it',
    },
    handler: async (params) => {
      try {
        const maxChars = params.maxChars ?? DEFAULT_MAX_CHARS;
        const result = await getUrlText(params.url, params.method ?? 'browser', maxChars);

        if ((params.outputFormat ?? 'markdown') === 'json') {
          return {
            content: [{ type: 'text' as const, text: JSON.stringify(result) }],
            structuredContent: result,
          };
        }

        // The header is flattened, the body is not. `result.url` is normalised by
        // the service, so a newline cannot reach here today — but this line names
        // the source a reader will attribute the text to, and dropping `.url()`
        // from the schema (to accept, say, a relative URL) would reopen it
        // silently. The body keeps its own line breaks.
        const lines = [`Quelle: ${result.url}`].map(oneLine);
        if (result.truncated) {
          lines.push(oneLine(`Hinweis: gekürzt auf ${maxChars} von ${result.charCount} Zeichen.`));
        }
        lines.push('');
        lines.push(result.reason
          ? `_Kein Text: ${REASON_TEXT[result.reason] ?? result.reason} (reason: ${result.reason})_`
          : result.text);

        return {
          content: [{ type: 'text' as const, text: lines.join('\n') }],
          // The FULL result, text included, in the markdown branch too:
          // structuredContent is the machine contract (urlTextSchema) whatever
          // the outputFormat — stripping the text there would hand JSON-first
          // clients an empty answer (review 2026-08-20).
          structuredContent: result,
        };
      } catch (err) {
        return toolError('Fehler beim Abruf des Webseiten-Textes', err);
      }
    },
  });
}
