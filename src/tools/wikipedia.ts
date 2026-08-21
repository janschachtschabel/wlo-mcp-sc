/**
 * tools/wikipedia.ts – get_wikipedia_summary:
 * External-knowledge lookup. Wraps the Wikipedia REST client so an agent can
 * fetch a short encyclopedic summary alongside WLO material without a separate
 * connector. Read-only, open-world.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { fetchWikipediaArticle, fetchWikipediaSummary } from '../wikipedia-api.js';
import { oneLine } from '../formatter.js';
import { capText } from '../text-cap.js';
import { toolError, wikiResolutionNotice } from './shared.js';

/**
 * Default bound on a full article. Measured 2026-08-06: Apolda 123.682
 * characters, Photosynthese 105.632 — handing that on unbounded floods the
 * context of every caller. Same figure `get_wlo_content_text` uses, so a text
 * reads the same length whichever tool produced it.
 */
const DEFAULT_MAX_CHARS = 200000;

export function registerWikipediaTool(server: McpServer): void {
  server.tool(
    'get_wikipedia_summary',
    `Wikipedia zu einem Begriff — Anriss (Vorgabe) oder der GANZE Artikeltext.
Für Hintergrundwissen neben WLO-Material, z.B. "was ist Photosynthese?".
fullText=true holt den vollständigen Artikel als Klartext, direkt von Wikipedia:
zum Zusammenfassen, für Aufgaben oder als Grundlage für einen neuen Datensatz.
Dafür ist KEINE Websuche und kein get_url_text nötig. Lange Artikel werden
gekürzt (maxChars, Vorgabe ${DEFAULT_MAX_CHARS}); die volle Länge wird genannt.
NICHT zum Suchen von Unterrichtsmaterial: dafür search_wlo_all.`,
    {
      query: z.string().min(1).max(200).describe('Topic or article title, e.g. "Photosynthese".'),
      language: z.string().regex(/^[a-z]{2,3}$/, 'ISO-639 language code, e.g. "de" or "en"').optional().default('de')
        .describe('Wikipedia language edition (ISO-639 code). Default "de".'),
      sections: z.number().int().min(1).max(3).optional().default(1)
        .describe('Leading paragraphs of the LEAD EXTRACT (1-3, default 1). Ignored when fullText=true.'),
      fullText: z.boolean().optional().default(false)
        .describe('true = the whole article as plain text instead of the lead extract. Costs one extra request, because the title is resolved and relevance-checked first.'),
      maxChars: z.number().int().min(500).max(200000).optional().default(DEFAULT_MAX_CHARS)
        .describe(`Only with fullText: cap on the returned text (default ${DEFAULT_MAX_CHARS}). Cut at a word boundary; the full length is disclosed. Real articles run to ~120.000 characters.`),
      outputFormat: z.enum(['markdown', 'json']).optional().default('markdown')
        .describe('"markdown" (default) or "json" ({query, found, summary}).'),
    },
    { readOnlyHint: true, openWorldHint: true },
    async (params) => {
      try {
        // Always the summary first, even when the full article is wanted: this
        // call is what RESOLVES the title and checks that the article is about
        // the question (`wikipedia-relevance.ts`). Fetching the article straight
        // from the raw query would skip that, and a caller writes "Quelle:
        // Wikipedia-Artikel „X"" underneath — a wrong article is a false
        // attribution, not just an odd answer.
        const summary = await fetchWikipediaSummary(
          params.query,
          params.language ?? 'de',
          (params.sections ?? 1) as 1 | 2 | 3,
        );

        // Only now, and only for a title this server stands behind.
        const article = summary && params.fullText
          ? await fetchWikipediaArticle(summary.title, params.language ?? 'de')
          : null;
        const body = article
          ? capText(article, params.maxChars ?? DEFAULT_MAX_CHARS).text
          : summary?.extract ?? '';

        if (params.outputFormat === 'json') {
          return { content: [{ type: 'text' as const, text: JSON.stringify({
            query: params.query,
            found: summary !== null,
            summary: summary ? { ...summary, extract: body } : null,
          }) }] };
        }

        if (!summary) {
          return { content: [{ type: 'text' as const, text: `Kein Wikipedia-Artikel gefunden für "${params.query}".` }] };
        }
        // oneLine on the heading for the same reason as every other record
        // renderer: this text is line-oriented and the value is foreign.
        const lines = [oneLine(`# ${summary.title}`), ''];
        const notice = wikiResolutionNotice(params.query, summary.title, summary.match);
        if (notice) lines.push(notice, '');
        // Said plainly rather than left to be noticed: a caller that asked for
        // the article and silently got the lead extract would summarise a
        // fraction of the page and present it as the whole.
        if (params.fullText && !article) {
          lines.push('Hinweis: Der Volltext war nicht abrufbar — unten steht nur der Anriss.', '');
        }
        lines.push(body, '', `[Wikipedia](${summary.url})`);
        return { content: [{ type: 'text' as const, text: lines.join('\n') }] };
      } catch (err) {
        return toolError('Fehler beim Abruf der Wikipedia-Zusammenfassung', err);
      }
    },
  );
}
