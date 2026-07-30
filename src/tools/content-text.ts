/**
 * tools/content-text.ts – get_wlo_content_text:
 * The material's OWN text (worksheet, article, transcript) rather than its
 * metadata — so the content can actually be worked with, summarized or
 * adapted. Read-only. Sourcing and bounds live in services/content-text.ts.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { getContentText } from '../services/content-text.js';
import { registerWloTool } from '../apps/register.js';
import { contentTextSchema } from '../apps/outputSchemas.js';
import { toolError } from './shared.js';

/** Default cap: enough for a worksheet, far below a context-flooding 41k text. */
const DEFAULT_MAX_CHARS = 8000;

/**
 * @param readingWidgetUri – the W5 (reading) `ui://` resource, when built;
 *   attached so an Apps-SDK host renders the text with follow-up actions.
 */
export function registerContentTextTool(server: McpServer, readingWidgetUri?: string): void {
  registerWloTool(server, {
    name: 'get_wlo_content_text',
    widgetUri: readingWidgetUri,
    title: 'WLO Volltext',
    description: `Hole den VOLLTEXT eines WLO-Inhalts — den eigentlichen Text eines Arbeitsblatts, Artikels oder Materials, nicht nur seine Metadaten. Nutze dies, wenn du mit dem Inhalt arbeiten sollst: zusammenfassen, Aufgaben daraus ableiten, an eine Klassenstufe anpassen, Fragen dazu beantworten.
Gib die "nodeId" aus einer WLO-Suche an. Der Text kommt bevorzugt aus dem Repository; nur wenn dort nichts hinterlegt ist und das Material extern verlinkt ist, wird der Text von der verlinkten Seite geholt (\`source\` sagt, welcher Weg es war).
Gibt es keinen Text, ist das kein Fehler: \`source: "none"\` mit einem \`reason\` — \`access_denied\` (Material ist nicht öffentlich), \`no_text_no_url\`, \`extraction_failed\`, \`node_not_found\`. Lange Texte werden gekürzt (\`truncated\`), \`maxChars\` steuert die Grenze.
ABWÄGUNG: Dieser Abruf dauert typisch 1–3 Sekunden. Brauchst du nur Titel, Fach, Lizenz oder Link, nimm get_node_details — das ist deutlich schneller. Nutze dieses Werkzeug erst, wenn der Inhalt selbst gebraucht wird.`,
    inputSchema: {
      nodeId: z.string().describe('nodeId of the material (from any WLO search result).'),
      maxChars: z.number().int().min(500).max(50000).optional().default(DEFAULT_MAX_CHARS)
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
        const lines = [`# ${result.title || result.nodeId}`, '', `Quelle: ${origin}`];
        if (result.truncated) lines.push(`Hinweis: gekürzt auf ${params.maxChars ?? DEFAULT_MAX_CHARS} von ${result.charCount} Zeichen.`);
        lines.push('');
        lines.push(result.text || `_Kein Volltext verfügbar (${result.reason ?? 'unbekannt'})._`);

        return {
          content: [{ type: 'text' as const, text: lines.join('\n') }],
          structuredContent: result,
        };
      } catch (err) {
        return toolError('Fehler beim Abruf des Volltextes', err);
      }
    },
  });
}
