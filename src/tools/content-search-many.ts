/**
 * tools/content-search-many.ts – search_wlo_content_many (Z4, chatbot team,
 * 2026-11-13). Schema and rendering; how the searches are run, bounded and
 * made distinct lives in `services/content-search-many.ts`.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { registerWloTool } from '../apps/register.js';
import { nodeIdLine, oneLine } from '../formatter.js';
import {
  inputProblem, searchContentMany, type ManyAnswer, type ManyQueryResult,
} from '../services/content-search-many.js';
import { codedErrorResult, toolError } from './shared.js';

const MAX_QUERIES = 8;
const MAX_RESULTS = 5;
const DEFAULT_RESULTS = 3;

/** The filters of `search_wlo_content`, by the same names. */
const filterShape = {
  educationalContext: z.string().max(200).optional().describe('Bildungsstufe: "Primarstufe", "Sekundarstufe I", … oder URI'),
  discipline: z.string().max(200).optional().describe('Fach: "Mathematik", "Biologie", … oder URI'),
  userRole: z.string().max(200).optional().describe('Zielgruppe: "Lehrer/in", "Lerner/in", … oder URI'),
  learningResourceType: z.string().max(200).optional().describe('Ressourcentyp: "Arbeitsblatt", "Video", … oder URI'),
  publisher: z.string().max(200).optional().describe('Anbieter, z.B. "Klexikon", "Serlo"'),
  license: z.string().max(200).optional().describe('EINE Lizenz: "CC BY", "CC BY-SA", "CC0", "gemeinfrei" oder der Schlüssel ("CC_BY"). Exakt geprüft. "OER" geht hier nicht.'),
};

const hitSchema = z.object({
  nodeId: z.string(),
  originalId: z.string().optional(),
  title: z.string(),
  url: z.string(),
  description: z.string(),
  learningResourceTypes: z.array(z.string()),
  educationalContexts: z.array(z.string()),
  license: z.string(),
  /** The preview image, when the record has one. May be a generic media-type icon. */
  previewUrl: z.string().optional(),
});

export const searchManySchema = z.object({
  results: z.record(z.string(), z.object({
    count: z.number(),
    results: z.array(hitSchema),
    more: z.literal(true).optional(),
    licenseFilter: z.object({ checked: z.number(), kept: z.number() }).optional(),
    movedToOtherQueries: z.number().optional(),
    fuzzyFilters: z.array(z.string()).optional(),
  })),
  missing: z.array(z.object({
    part: z.string(),
    code: z.enum(['unresolved_filter', 'timeout', 'forbidden', 'not_found', 'upstream_busy', 'upstream_error']),
    message: z.string().optional(),
    retryAfter: z.number().optional(),
  })),
  distinctApplied: z.literal(true).optional(),
});

/** What a query's block says under its hits — each sentence only where its field is set. */
function notes(r: ManyQueryResult): string[] {
  const lines: string[] = [];
  if (r.licenseFilter && r.licenseFilter.kept < r.licenseFilter.checked) {
    lines.push(`Lizenz exakt geprüft: ${r.licenseFilter.kept} von ${r.licenseFilter.checked} Kandidaten passen.`);
  }
  if (r.movedToOtherQueries) lines.push(`${r.movedToOtherQueries} Treffer stehen bei einer anderen Anfrage, zu der sie besser passen.`);
  if (r.fuzzyFilters) lines.push(`Filter geraten: ${r.fuzzyFilters.join(', ')}.`);
  if (r.more) lines.push('Es gibt weitere Treffer — search_wlo_content liefert mehr und blättert.');
  return lines;
}

function renderMarkdown(answer: ManyAnswer, queryOf: Map<string, string>): string {
  const blocks = Object.entries(answer.results).map(([id, r]) => {
    const head = `## ${id} — „${queryOf.get(id) ?? ''}“ (${r.count})`;
    const hits = r.results.map((h, i) => [
      `${i + 1}. **${h.title}**`,
      [...h.learningResourceTypes, ...h.educationalContexts, h.license].filter(Boolean).join(' · '),
      h.url,
      nodeIdLine(h.nodeId, h.originalId),
      h.description,
    ].filter(Boolean).map((line, j) => (j === 0 ? line : `   ${line}`)));
    // "keine Treffer" is a statement about the catalogue — over a window that
    // was not the last one it is only a statement about what was looked at.
    const empty = r.count > 0 ? [] : [r.more ? 'keine Treffer im geprüften Ausschnitt' : 'keine Treffer'];
    // Every line carries repository values: one line each, or a title forges a record.
    return [head, ...hits.flat(), ...empty, ...notes(r)].map(oneLine).join('\n');
  });
  const missing = answer.missing.map(m => oneLine(
    `${m.part}: nicht beantwortet (${m.code}${m.message ? `: ${m.message}` : ''}${m.retryAfter ? `, erneut in ${m.retryAfter} s` : ''})`));
  if (missing.length) blocks.push(['## Nicht beantwortet — KEIN Befund „keine Treffer“', ...missing].join('\n'));
  return blocks.join('\n\n');
}

export function registerContentSearchManyTool(server: McpServer): void {
  registerWloTool(server, {
    name: 'search_wlo_content_many',
    title: 'WLO Inhaltssuche (mehrere Anfragen)',
    description: `Mehrere Inhaltssuchen in EINEM Aufruf — bis zu ${MAX_QUERIES} Anfragen, je bis zu ${MAX_RESULTS} Treffer. Statt mehrerer search_wlo_content-Aufrufe nacheinander: ein Material je Schritt eines Lernpfads, je Abschnitt einer Stunde, je Unterthema.
Jede Anfrage trägt eine eigene "id"; die Treffer stehen unter results[id] in KURZFORM (nodeId, Titel, URL, Beschreibung bis 200 Zeichen, Typ, Bildungsstufe, Lizenz). Filter gelten für alle Anfragen, ein Filter in einer Anfrage ersetzt dort den gemeinsamen.
distinct: true zeigt jedes Material nur bei der Anfrage, zu der es am besten passt — die andere rückt aus ihren eigenen Treffern nach.
Was nicht beantwortet wurde, steht in "missing" (unresolved_filter, timeout, upstream_busy …) und ist KEIN Befund „keine Treffer“; ein nicht auflösbarer Filter wird nie weggelassen.
NICHT: kein Blättern, keine Gesamtzahl, kein Volltext — "more" sagt nur, dass es weitere gibt. Mehr zu EINER Anfrage: search_wlo_content. Volle Details: get_nodes_details. Nur zählen: count_wlo_content_matches.`,
    inputSchema: {
      queries: z.array(z.object({
        id: z.string().min(1).max(40).describe('Eigene Kennung, eindeutig im Aufruf; Schlüssel der Antwort.'),
        query: z.string().trim().min(1).max(200).describe('Suchbegriff (Deutsch), das Thema ohne Rahmenwörter.'),
        filters: z.object(filterShape).optional().describe('Filter nur für diese Anfrage; ersetzt den gleichnamigen gemeinsamen. Ein leerer Wert zählt als nicht angegeben.'),
      })).min(1).max(MAX_QUERIES),
      ...filterShape,
      maxResults: z.number().int().min(1).max(MAX_RESULTS).optional().default(DEFAULT_RESULTS)
        .describe(`Treffer je Anfrage (1–${MAX_RESULTS}, Vorgabe ${DEFAULT_RESULTS}).`),
      distinct: z.boolean().optional().default(false)
        .describe('Jedes Material nur einmal, bei der am besten passenden Anfrage.'),
      outputFormat: z.enum(['markdown', 'json']).optional().default('markdown'),
    },
    outputSchema: searchManySchema,
    annotations: { readOnlyHint: true, idempotentHint: true },
    handler: async (params) => {
      const shared = {
        educationalContext: params.educationalContext, discipline: params.discipline, userRole: params.userRole,
        learningResourceType: params.learningResourceType, publisher: params.publisher, license: params.license,
      };
      const problem = inputProblem({ queries: params.queries, shared });
      if (problem) return codedErrorResult('invalid_input', problem);
      try {
        const answer = await searchContentMany({
          queries: params.queries, shared,
          maxResults: params.maxResults ?? DEFAULT_RESULTS, distinct: params.distinct ?? false,
        });
        const text = (params.outputFormat ?? 'markdown') === 'json'
          ? JSON.stringify(answer)
          : renderMarkdown(answer, new Map(params.queries.map((q: { id: string; query: string }) => [q.id, q.query])));
        return { content: [{ type: 'text' as const, text }], structuredContent: answer };
      } catch (err) {
        return toolError('Fehler bei der Mehrfachsuche', err);
      }
    },
  });
}
