/**
 * tools/compendium.ts – get_compendium_text:
 * Fetch the FULL editorial compendium text of one or more collections — the
 * authoritative prose overview, untruncated (collection search only carries a
 * 500-char preview). Read-only.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { getCompendiumTexts } from '../services/compendium.js';
import { oneLine } from '../formatter.js';
import { toolError } from './shared.js';
import { registerWloTool } from '../apps/register.js';
import { contentTextSchema } from '../apps/outputSchemas.js';

/**
 * @param readingWidgetUri – the W5 (reading) `ui://` resource, when built. The
 *   compendium IS editorial prose, which is what that view renders; it was the
 *   only long-text tool that never reached it (audit 2026-07-30).
 */
export function registerCompendiumTool(server: McpServer, readingWidgetUri?: string): void {
  registerWloTool(server, {
    name: 'get_compendium_text',
    title: 'WLO Kompendiumstext',
    widgetUri: readingWidgetUri,
    description: `Hole den VOLLSTÄNDIGEN redaktionellen Kompendiumstext (kuratierte Übersichts-Prosa) einer oder mehrerer WLO-Sammlungen. Nutze dies, wenn ein Sammlungsergebnis nur einen gekürzten "Kompendium: …"-Auszug zeigt und du den ganzen Text brauchst, oder um zusammenzufassen, worum es in einer Sammlung geht. Gib eine "Sammlung-nodeId" (oder mehrere). NICHT für Dateien/Materialien — gilt nur für Sammlungen mit redaktionellem Text.`,
    inputSchema: {
      nodeId: z.string().optional().describe('A single collection nodeId.'),
      nodeIds: z.array(z.string()).max(25).optional().describe('Up to 25 collection nodeIds for a bulk fetch.'),
      outputFormat: z.enum(['markdown', 'json']).optional().default('markdown')
        .describe('"markdown" (default) or "json" ({entries:[{nodeId,title,compendiumText}]}).'),
    },
    outputSchema: contentTextSchema,
    annotations: { readOnlyHint: true },
    handler: async (params) => {
      try {
        const ids = [...(params.nodeId ? [params.nodeId] : []), ...(params.nodeIds ?? [])];
        if (ids.length === 0) {
          return { content: [{ type: 'text' as const, text: 'Bitte nodeId oder nodeIds angeben.' }], isError: true };
        }

        const entries = await getCompendiumTexts(ids);

        const blocks = entries.map(e => {
          // Flattened because the blocks are separated by `---` and opened by a
          // heading: a newline in a title would split one collection's prose
          // into two, the second under a collection name nobody wrote. The body
          // is prose and keeps its paragraphs.
          const heading = oneLine(`# ${e.title || e.nodeId}`);
          const body = e.compendiumText ?? '_Kein Kompendiumstext hinterlegt._';
          return `${heading}\n\n${body}`;
        });
        const joined = blocks.join('\n\n---\n\n');

        // The reading view shows ONE text. A bulk fetch is still one readable
        // document — the same joined markdown the text output carries — but it
        // has no single owner, so `nodeId` stays empty. That is deliberate:
        // the widget gates its "summarize this" buttons on nodeId, and those
        // are meaningless across several collections.
        const single = entries.length === 1 ? entries[0] : undefined;
        const structuredContent = {
          nodeId: single?.nodeId ?? '',
          title: single?.title ?? `Kompendiumstexte (${entries.length})`,
          text: joined,
          source: 'repository' as const,
          sourceUrl: null,
          charCount: joined.length,
          truncated: false,
          // No `reason`: the schema reserves it for "there is no text", and
          // there always is one here — a collection without prose still yields
          // the "_Kein Kompendiumstext hinterlegt._" line, which says so in the
          // text itself.
        };

        if (params.outputFormat === 'json') {
          return {
            content: [{ type: 'text' as const, text: JSON.stringify({ entries }) }],
            structuredContent,
          };
        }
        return { content: [{ type: 'text' as const, text: joined }], structuredContent };
      } catch (err) {
        return toolError('Fehler beim Abruf des Kompendiumstextes', err);
      }
    },
  });
}
