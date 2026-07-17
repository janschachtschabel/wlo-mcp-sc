/**
 * tools/compendium.ts – get_compendium_text:
 * Fetch the FULL editorial compendium text of one or more collections — the
 * authoritative prose overview, untruncated (collection search only carries a
 * 500-char preview). Read-only.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { getCompendiumTexts } from '../services/compendium.js';
import { toolError } from './shared.js';

export function registerCompendiumTool(server: McpServer): void {
  server.tool(
    'get_compendium_text',
    `Hole den VOLLSTÄNDIGEN redaktionellen Kompendiumstext (kuratierte Übersichts-Prosa) einer oder mehrerer WLO-Sammlungen. Nutze dies, wenn ein Sammlungsergebnis nur einen gekürzten "Kompendium: …"-Auszug zeigt und du den ganzen Text brauchst, oder um zusammenzufassen, worum es in einer Sammlung geht. Gib eine "Sammlung-nodeId" (oder mehrere). NICHT für Dateien/Materialien — gilt nur für Sammlungen mit redaktionellem Text.`,
    {
      nodeId: z.string().optional().describe('A single collection nodeId.'),
      nodeIds: z.array(z.string()).max(25).optional().describe('Up to 25 collection nodeIds for a bulk fetch.'),
      outputFormat: z.enum(['markdown', 'json']).optional().default('markdown')
        .describe('"markdown" (default) or "json" ({entries:[{nodeId,title,compendiumText}]}).'),
    },
    { readOnlyHint: true },
    async (params) => {
      try {
        const ids = [...(params.nodeId ? [params.nodeId] : []), ...(params.nodeIds ?? [])];
        if (ids.length === 0) {
          return { content: [{ type: 'text' as const, text: 'Bitte nodeId oder nodeIds angeben.' }], isError: true };
        }

        const entries = await getCompendiumTexts(ids);

        if (params.outputFormat === 'json') {
          return { content: [{ type: 'text' as const, text: JSON.stringify({ entries }) }] };
        }

        const blocks = entries.map(e => {
          const heading = `# ${e.title || e.nodeId}`;
          const body = e.compendiumText ?? '_Kein Kompendiumstext hinterlegt._';
          return `${heading}\n\n${body}`;
        });
        return { content: [{ type: 'text' as const, text: blocks.join('\n\n---\n\n') }] };
      } catch (err) {
        return toolError('Fehler beim Abruf des Kompendiumstextes', err);
      }
    },
  );
}
