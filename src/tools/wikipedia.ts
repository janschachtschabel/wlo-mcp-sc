/**
 * tools/wikipedia.ts – get_wikipedia_summary:
 * External-knowledge lookup. Wraps the Wikipedia REST client so an agent can
 * fetch a short encyclopedic summary alongside WLO material without a separate
 * connector. Read-only, open-world.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { fetchWikipediaSummary } from '../wikipedia-api.js';
import { toolError } from './shared.js';

export function registerWikipediaTool(server: McpServer): void {
  server.tool(
    'get_wikipedia_summary',
    `Get a short Wikipedia summary (lead extract + link) for a term or concept.
Use this when the user wants background/encyclopedic context on a topic (e.g.
"was ist Photosynthese?") to complement WLO teaching material. Do NOT use this
to search for WLO/OER learning materials — use search_wlo_content or
search_wlo_all for that.`,
    {
      query: z.string().min(1).max(200).describe('Topic or article title, e.g. "Photosynthese".'),
      language: z.string().regex(/^[a-z]{2,3}$/, 'ISO-639 language code, e.g. "de" or "en"').optional().default('de')
        .describe('Wikipedia language edition (ISO-639 code). Default "de".'),
      sections: z.number().int().min(1).max(3).optional().default(1)
        .describe('Number of leading paragraphs of the lead extract to include (1-3, default 1).'),
      outputFormat: z.enum(['markdown', 'json']).optional().default('markdown')
        .describe('"markdown" (default) or "json" ({query, found, summary}).'),
    },
    { readOnlyHint: true, openWorldHint: true },
    async (params) => {
      try {
        const summary = await fetchWikipediaSummary(
          params.query,
          params.language ?? 'de',
          (params.sections ?? 1) as 1 | 2 | 3,
        );

        if (params.outputFormat === 'json') {
          return { content: [{ type: 'text' as const, text: JSON.stringify({
            query: params.query,
            found: summary !== null,
            summary,
          }) }] };
        }

        if (!summary) {
          return { content: [{ type: 'text' as const, text: `Kein Wikipedia-Artikel gefunden für "${params.query}".` }] };
        }
        const lines = [`# ${summary.title}`, '', summary.extract, '', `[Wikipedia](${summary.url})`];
        return { content: [{ type: 'text' as const, text: lines.join('\n') }] };
      } catch (err) {
        return toolError('Fehler beim Abruf der Wikipedia-Zusammenfassung', err);
      }
    },
  );
}
