/**
 * tools/content-text.ts – get_wlo_content_text:
 * The material's OWN text (worksheet, article, transcript) rather than its
 * metadata — so the content can actually be worked with, summarized or
 * adapted. Read-only. Sourcing and bounds live in services/content-text.ts.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { getContentText, type ContentTextMiss } from '../services/content-text.js';
import { oneLine } from '../formatter.js';
import { registerWloTool } from '../apps/register.js';
import { contentTextSchema } from '../apps/outputSchemas.js';
import { toolError } from './shared.js';

/** Default cap: enough for a worksheet, far below a context-flooding 41k text. */
const DEFAULT_MAX_CHARS = 200000;

/**
 * The no-text reasons in words. The result is the sentence the model acts on,
 * and a slug in parentheses (`no_text_no_url`) is what it paraphrased AROUND on
 * 2026-08-22 — substituting the collection's compendium text for a video that
 * honestly has none.
 */
const NO_TEXT_REASONS: Record<ContentTextMiss, string> = {
  access_denied: 'der Abruf wurde verweigert',
  no_text_no_url: 'es gibt keinen gespeicherten Text und keine auswertbare verlinkte Seite',
  extraction_failed: 'die verlinkte Seite ließ sich nicht als Text lesen',
  node_not_found: 'das Material wurde nicht gefunden',
};

/**
 * @param readingWidgetUri – the W5 (reading) `ui://` resource, when built;
 *   attached so an Apps-SDK host renders the text with follow-up actions.
 */
export function registerContentTextTool(server: McpServer, readingWidgetUri?: string): void {
  registerWloTool(server, {
    name: 'get_wlo_content_text',
    widgetUri: readingWidgetUri,
    title: 'WLO Volltext',
    description: `Der INHALT eines WLO-Materials — der eigentliche Text des Arbeitsblatts, Artikels oder Dokuments, nicht seine Metadaten. Der Knopf „Volltext anzeigen" führt hierher.
NIMM DIES, sobald es um den Inhalt geht: „zeig mir den Inhalt", „was steht in dem Arbeitsblatt", „den ganzen Text", „lies das Dokument", „zusammenfassen", „mach Aufgaben daraus", „passe es an Klasse 7 an". Auch dann, wenn die nodeId schon aus einer früheren Antwort im Gespräch stammt — dann genügt sie.
NICHT get_node_details: das liefert nur Metadaten (Titel, Fach, Lizenz, Link) und ist die Detailansicht, nicht der Inhalt.
Der Text kommt aus dem Repository (~0,3 s) oder, bei extern verlinktem Material, von der verlinkten Seite (\`source\`). Lange Texte werden gekürzt (\`truncated\`, \`maxChars\`).
Gibt es keinen Text, kommt \`source: "none"\` mit \`reason\` (\`access_denied\`, \`no_text_no_url\`, \`extraction_failed\`, \`node_not_found\`). Das ist kein Fehler, sondern die Auskunft, dass es wirklich keinen Text gibt: dann sag das — und **erfinde keinen Inhalt**.`,
    inputSchema: {
      nodeId: z.string().describe('nodeId of the material (from any WLO search result).'),
      maxChars: z.number().int().min(500).max(200000).optional().default(DEFAULT_MAX_CHARS)
        .describe(`Max characters returned (default ${DEFAULT_MAX_CHARS}). Longer texts are cut at a word boundary and flagged via "truncated".`),
      outputFormat: z.enum(['markdown', 'json']).optional().default('markdown')
        .describe('"markdown" (default, the text with a short provenance header) or "json" (structured).'),
    },
    outputSchema: contentTextSchema,
    annotations: { readOnlyHint: true },
    handler: async (params) => {
      try {
        const result = await getContentText(params.nodeId, params.maxChars ?? DEFAULT_MAX_CHARS);

        if (params.outputFormat === 'json') {
          return {
            content: [{ type: 'text' as const, text: JSON.stringify(result) }],
            structuredContent: result,
          };
        }

        // Provenance is stated, never implied: a teacher reusing the text needs
        // to know whether it came from the repository or from the linked page.
        const origin = result.source === 'repository'
          ? 'WLO-Repository'
          : result.source === 'external-extraction'
            ? `verlinkte Seite (${result.sourceUrl})`
            : 'kein Text verfügbar';
        // The header is flattened, the body is not: title and sourceUrl are
        // repository-supplied, and a newline in either forges a SECOND `Quelle:`
        // line — a false provenance claim in the one place a teacher reads to
        // attribute the text. The document below keeps its own line breaks.
        const lines = [`# ${result.title || result.nodeId}`, '', `Quelle: ${origin}`]
          .map(oneLine);
        if (result.truncated) lines.push(`Hinweis: gekürzt auf ${params.maxChars ?? DEFAULT_MAX_CHARS} von ${result.charCount} Zeichen.`);
        lines.push('');
        lines.push(result.text || [
          `Dieses Material hat keinen hinterlegten Volltext — ${result.reason ? NO_TEXT_REASONS[result.reason] : 'Grund unbekannt'}.`,
          'Bitte genau das kurz weitergeben und keinen Ersatztext aus anderen Quellen (z. B. dem Kompendium einer Sammlung) liefern.',
        ].join(' '));

        return {
          content: [{ type: 'text' as const, text: lines.join('\n') }],
          // The FULL result, text included, in the markdown branch too: the
          // reading widget renders from structuredContent (widgetUri above),
          // and JSON-first clients read nothing else. The text travelling
          // twice is the price of serving both consumers — do not "optimize"
          // it out of this branch (review 2026-08-20).
          structuredContent: result,
        };
      } catch (err) {
        return toolError('Fehler beim Abruf des Volltextes', err);
      }
    },
  });
}
