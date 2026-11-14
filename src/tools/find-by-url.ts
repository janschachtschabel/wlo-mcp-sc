/**
 * tools/find-by-url.ts – find_content_by_url: is there already a record for
 * these addresses? (BOERDi wishlist item 2, 2026-11-06).
 *
 * The lookup lives in `services/url-matches.ts`, shared with the create path's
 * duplicate check; this module holds the schema, the per-entry failure codes and
 * the rendering. Every entry fails ON ITS OWN — one bad address does not take
 * the other nineteen with it.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { registerWloTool } from '../apps/register.js';
import { mapPool } from '../concurrency.js';
import { oneLine } from '../formatter.js';
import { log } from '../logger.js';
import { getNodeCollections } from '../services/node-collections.js';
import { findUrlMatches, normalizeSourceUrl, type UrlMatch } from '../services/url-matches.js';
import { failureFields } from '../services/failure-code.js';

const MAX_URLS = 20;
/** Addresses checked at once; each asks up to three spellings. */
const URL_POOL = 4;
/** Collection counts per address at once — each is a metadata plus a usage read. */
const COUNT_POOL = 2;

const matchSchema = z.object({
  nodeId: z.string(),
  title: z.string(),
  wwwurl: z.string(),
  match: z.enum(['exact', 'normalized']),
  /** Only with `includeCollections`; null = could not be determined. */
  inCollections: z.number().int().nullable().optional(),
});

export const urlLookupSchema = z.object({
  results: z.array(z.object({
    url: z.string(),
    normalized: z.string().optional(),
    matches: z.array(matchSchema),
    error: z.object({
      code: z.enum(['invalid_url', 'upstream_busy', 'not_found', 'upstream_error']), message: z.string(),
      retryAfter: z.number().optional(),
    }).optional(),
  })),
});
type UrlLookup = z.infer<typeof urlLookupSchema>;
type Entry = UrlLookup['results'][number];

async function lookUp(url: string, includeCollections: boolean): Promise<Entry> {
  const normalized = normalizeSourceUrl(url);
  if (!normalized) {
    return { url, matches: [], error: { code: 'invalid_url', message: 'Keine http(s)-Adresse.' } };
  }
  let found: UrlMatch[];
  try {
    found = await findUrlMatches(url, normalized);
  } catch (err) {
    log.warn('url lookup failed', { error: err instanceof Error ? err.message : String(err) });
    // Busy is told apart from broken here as everywhere else (`failureFields`),
    // and so is a 404: an ANSWER, not an outage — as `upstream_error` a client
    // retried what never comes (chatbot follow-up 2026-11-14). A timeout or a
    // 401/403 stays `upstream_error`, the code this entry had.
    const fields = failureFields(err);
    return {
      url, normalized, matches: [],
      error: fields.code === 'upstream_busy'
        ? { code: 'upstream_busy', retryAfter: fields.retryAfter,
          message: 'Das Repository ist gerade überlastet; ob es einen Datensatz gibt, ist offen.' }
        : fields.code === 'not_found'
          ? { code: 'not_found', message: 'Das Repository hat die Suche mit „nicht gefunden“ (HTTP 404) beantwortet — keine Störung, erneutes Versuchen ändert nichts; ob es einen Datensatz gibt, ist offen.' }
          : { code: 'upstream_error', message: 'Die Suche im Repository ist fehlgeschlagen; ob es einen Datensatz gibt, ist offen.' },
    };
  }
  // Bounded: twenty copies of one address are forty reads, and four addresses
  // run at once.
  const counts = includeCollections
    ? await mapPool(found, COUNT_POOL, m => collectionCount(m.nodeId))
    : [];
  const matches = found.map((m, i) => ({
    nodeId: m.nodeId, title: m.title, wwwurl: m.url, match: m.match,
    ...(includeCollections ? { inCollections: counts[i] ?? null } : {}),
  }));
  return { url, normalized, matches };
}

/** `null` — not 0 — when the count could not be read: 0 is a statement. */
async function collectionCount(nodeId: string): Promise<number | null> {
  try {
    return (await getNodeCollections(nodeId))?.collections.length ?? null;
  } catch {
    return null;
  }
}

export function registerFindByUrlTool(server: McpServer): void {
  registerWloTool(server, {
    name: 'find_content_by_url',
    title: 'WLO Datensatz zur Adresse',
    description: `Prüfe für bis zu ${MAX_URLS} Web-Adressen, ob es in WLO schon einen Datensatz dazu gibt (Feld ccm:wwwurl) — vor dem Erschließen oder Anlegen einer Seite.
Je Treffer "match": "exact" = dieselbe Adresse (bis auf Groß-/Kleinschreibung) — als Dublette behandeln; "normalized" = gleich erst nach Bereinigung (Schrägstrich am Ende, Fragment, utm_*/fbclid/gclid entfernt) — nachfragen, nicht still als Dublette werten. Kein Volltext-Vergleich: eine andere Seite derselben Domain ist kein Treffer. Es erscheint nur, was die anfragende Anmeldung lesen darf. Fehler stehen je Eintrag ("invalid_url", "upstream_busy", "not_found", "upstream_error"), nicht für den ganzen Aufruf.
includeCollections=true zählt je Treffer die Sammlungen (kostet je Treffer zwei Abrufe).
Nicht für die thematische Suche — dafür search_wlo_content.`,
    inputSchema: {
      urls: z.array(z.string().max(2000)).min(1).max(MAX_URLS).describe('Die zu prüfenden Adressen (http/https).'),
      includeCollections: z.boolean().optional().default(false).describe('Je Treffer die Zahl der Sammlungen mitliefern.'),
    },
    outputSchema: urlLookupSchema,
    annotations: { readOnlyHint: true, idempotentHint: true },
    handler: async (params) => {
      const urls = params.urls as string[];
      const results = (await mapPool(urls, URL_POOL, url => lookUp(url, params.includeCollections === true)))
        .map((r, i) => r ?? {
          url: urls[i]!, matches: [],
          error: { code: 'upstream_error' as const, message: 'Die Prüfung ist fehlgeschlagen.' },
        });
      const lines = results.map(r => {
        if (r.error) return oneLine(`${r.url}: ${r.error.code} — ${r.error.message}`);
        if (!r.matches.length) return oneLine(`${r.url}: kein Datensatz`);
        return [oneLine(`${r.url}:`), ...r.matches.map(m => oneLine(
          `  - [${m.match}] ${m.title || '(ohne Titel)'} — nodeId: ${m.nodeId} — ${m.wwwurl}`
          + (m.inCollections === undefined ? '' : ` — Sammlungen: ${m.inCollections ?? 'nicht ermittelbar'}`),
        ))].join('\n');
      });
      return {
        content: [{ type: 'text' as const, text: lines.join('\n') }],
        structuredContent: { results } satisfies UrlLookup,
      };
    },
  });
}
