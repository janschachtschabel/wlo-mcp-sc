/**
 * tools/content-count.ts – count_wlo_content_matches (BOERDi wishlist item 5,
 * 2026-11-06). Schema and rendering; the counting rules live in
 * `services/content-count.ts`.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { registerWloTool } from '../apps/register.js';
import { oneLine } from '../formatter.js';
import { countMatches } from '../services/content-count.js';
import { toolError } from './shared.js';

const MAX_QUERIES = 30;
const MAX_TOP = 3;

const filterSchema = z.object({
  educationalContext: z.string().max(200).optional(),
  discipline: z.string().max(200).optional(),
  userRole: z.string().max(200).optional(),
  learningResourceType: z.string().max(200).optional(),
}).optional();

export const countMatchesSchema = z.object({
  results: z.array(z.object({
    id: z.string(),
    total: z.number(),
    top: z.array(z.object({ nodeId: z.string(), title: z.string(), url: z.string() })),
    fuzzyFilters: z.array(z.enum(['educationalContext', 'discipline', 'userRole', 'learningResourceType'])).optional(),
  })),
  missing: z.array(z.object({
    part: z.string(),
    code: z.enum(['unresolved_filter', 'timeout', 'forbidden', 'upstream_error']),
    message: z.string().optional(),
  })),
});

export function registerContentCountTool(server: McpServer): void {
  registerWloTool(server, {
    name: 'count_wlo_content_matches',
    title: 'WLO Treffer zählen',
    description: `Zähle für bis zu ${MAX_QUERIES} Suchanfragen zugleich, wie viele passende Inhalte es in WLO gibt, dazu bis zu ${MAX_TOP} Treffer je Anfrage — Grundlage für "Wo hat meine Gliederung Lücken?".
Eine Suche je Anfrage, ohne Varianten und Umsortierung: "total" ist die Zahl des Repositorys (dieselbe Anfrage, dieselbe Zahl). Sie zählt jeden Volltexttreffer, auch schwache — die Top-Treffer zeigen, wie gut sie zum Thema passt.
Filter: Bildungsstufe, Fach, Zielgruppe, Ressourcentyp. Ein nicht auflösbarer Filter wird NICHT weggelassen — die Anfrage steht dann in "missing" (unresolved_filter); ein geratener in "fuzzyFilters".
Zählt über ganz WLO, nicht in einer Sammlung (für Teilbäume: browse_collection_tree mit includeContentCounts). Nicht zum Lesen der Inhalte — dafür search_wlo_content.`,
    inputSchema: {
      queries: z.array(z.object({
        id: z.string().min(1).max(100).describe('Eigene Kennung, kommt unverändert zurück.'),
        query: z.string().min(1).max(500),
        filters: filterSchema,
      })).min(1).max(MAX_QUERIES),
      top: z.number().int().min(0).max(MAX_TOP).optional().default(2)
        .describe(`Treffer je Anfrage (0–${MAX_TOP}, Vorgabe 2).`),
    },
    outputSchema: countMatchesSchema,
    annotations: { readOnlyHint: true, idempotentHint: true },
    handler: async (params) => {
      try {
        const answer = await countMatches(params.queries, params.top ?? 2);
        const lines = [
          ...answer.results.map(r => `${r.id}: ${r.total}${r.top.length ? ` — z. B. ${r.top.map(t => t.title).join(' · ')}` : ''}`
            + (r.fuzzyFilters ? ` (geraten: ${r.fuzzyFilters.join(', ')})` : '')),
          ...answer.missing.map(m => `${m.part}: nicht gezählt (${m.code}${m.message ? `: ${m.message}` : ''})`),
        ];
        return { content: [{ type: 'text' as const, text: lines.map(oneLine).join('\n') }], structuredContent: answer };
      } catch (err) {
        return toolError('Fehler beim Zählen', err);
      }
    },
  });
}
