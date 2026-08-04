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

const DEFAULT_MAX_CHARS = 8000;

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
    description: `Hole den Text einer BELIEBIGEN Webseite über den Extraktionsdienst — für eine URL, die im Gespräch genannt wurde oder die du aus einem Ergebnis kennst. Damit lässt sich die Seite zusammenfassen, vergleichen oder als Grundlage für Aufgaben nutzen.
NICHT für WLO-Material: dafür get_wlo_content_text mit der nodeId nehmen. Das liest den Text direkt aus dem Repository, ist deutlich schneller und funktioniert auch dort, wo dieses Werkzeug scheitert.
Kein Text ist ein normales Ergebnis, kein Fehler: "reason" sagt warum. Bei "extraction_failed" lohnt genau ein zweiter Versuch mit dem anderen "method" — der Dienst rendert mit einem Browser und hat bekannte Lücken (geschützte oder bot-gesperrte Seiten, reine Video-/Audiodateien).
UNSICHER (unsafe): Das Werkzeug ruft eine vom Aufrufer gewählte Adresse über einen fremden Dienst ab. Die Betreiberin kann es mit WLO_DISABLE_UNSAFE_TOOLS abschalten; für den Produktivbetrieb wird davon abgeraten.`,
    inputSchema: {
      url: z.string().url().max(2000).describe('Vollständige http(s)-Adresse der Webseite.'),
      method: z.enum(['browser', 'simple']).optional().default('browser').describe(
        '"browser" rendert JavaScript (Standard, langsamer); "simple" holt nur das HTML. ' +
        'Scheitert der eine Weg, ist der andere der sinnvolle zweite Versuch.'
      ),
      maxChars: z.number().int().min(500).max(50000).optional().default(DEFAULT_MAX_CHARS).describe(
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
          structuredContent: result,
        };
      } catch (err) {
        return toolError('Fehler beim Abruf des Webseiten-Textes', err);
      }
    },
  });
}
