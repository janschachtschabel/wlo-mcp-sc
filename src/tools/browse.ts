/**
 * tools/browse.ts – Guided exploration of the collection tree:
 * get_subject_portals (Fachportale under the WLO root) and
 * browse_collection_tree (sub-collections with optional content counts).
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import type { WloNode } from '../wlo-api.js';
import {
  WLO_ROOT_COLLECTION_ID,
  getChildCollectionsResult,
} from '../wlo-api.js';
import { sortByTitle } from '../reranker.js';
import { formatNode, oneLine } from '../formatter.js';
import type { CollectionTreeNode } from '../services/collection-traversal.js';
import { buildCollectionTree } from '../services/collection-traversal.js';
import { resolveVocab } from '../vocabs.js';
import { log } from '../logger.js';
import { mapPool } from '../concurrency.js';
import { toolError } from './shared.js';
import { registerWloTool } from '../apps/register.js';
import { browseTreeSchema, subjectPortalListSchema } from '../apps/outputSchemas.js';

/**
 * Resolve a subject/Fachportal NAME (e.g. "Mathematik" or the abbreviation
 * "Mathe") to its portal node, so callers can drill down by name without a
 * separate get_subject_portals round-trip. Tiered match — exact → prefix →
 * substring, shortest title wins on ties — tolerates paraphrased input.
 * Returns null when nothing matches. Pure (no I/O): the caller supplies the
 * portal list.
 */
export function matchSubjectPortal(portals: WloNode[], name: string): WloNode | null {
  const needle = name.trim().toLowerCase();
  if (!needle) return null;
  const title = (n: WloNode) => (formatNode(n).title || '').toLowerCase();
  const byShortestTitle = (a: WloNode, b: WloNode) => title(a).length - title(b).length;

  for (const tier of [
    (t: string) => t === needle,
    (t: string) => t.startsWith(needle),
    (t: string) => t.includes(needle),
  ]) {
    const hits = portals.filter(p => tier(title(p)));
    if (hits.length) return hits.sort(byShortestTitle)[0];
  }
  return null;
}

/**
 * @param browseWidgetUri – the W2 (interactive browse) `ui://` resource, when
 *   built; attached to both browse tools so an Apps-SDK host renders the
 *   drill-down explorer.
 */
export function registerBrowseTools(server: McpServer, browseWidgetUri?: string): void {
  registerWloTool(server, {
    name: 'get_subject_portals',
    title: 'WLO Fachportale',
    widgetUri: browseWidgetUri,
    description: `Zeige, WELCHE Fächer/Themen es auf WirLernenOnline gibt — die WLO-Fachportale (Mathematik, Informatik, Deutsch, …), die obersten Fach-Hubs des Inhaltsbaums. Nutze dies für Anfragen wie "welche Fächer gibt es?" oder als Einstieg für geführtes Stöbern ("zeig mir Mathe" → Portal → Unter-Sammlungen → Inhalte).
Liefert deterministische alphabetische Reihenfolge, je Portal nodeId, Name, Beschreibung, optional Themenseiten-URL und die zugeordneten Fächer/Bildungsstufen.`,
    inputSchema: {
      educationalContext: z.string().optional().describe(
        'Filter by educational level (e.g. "Sekundarstufe I"). Most portals span multiple levels — '+
        'the filter only excludes portals where the level is explicitly different.'
      ),
      includeContentCounts: z.boolean().optional().default(false).describe(
        'When true, also fetch the number of direct sub-collections per portal (extra round-trip).'
      ),
      outputFormat: z.enum(['markdown', 'json']).optional().default('markdown'),
    },
    outputSchema: subjectPortalListSchema,
    annotations: { readOnlyHint: true },
    handler: async (params) => {
      try {
        const listing = await getChildCollectionsResult(WLO_ROOT_COLLECTION_ID, 100);
        // "No portals" is a statement about WLO; an unread listing is a
        // statement about the server. Fail loudly rather than answering
        // "WLO Fachportale: 0" — that reads as a fact and is acted on as one.
        if (!listing.reachable) throw new Error('Die Fachportal-Liste ist derzeit nicht abrufbar.');
        const portals = listing.nodes;

        // Optional educational-context filter
        let filtered = portals;
        if (params.educationalContext) {
          const wantedUri = resolveVocab(params.educationalContext, 'educationalContext');
          if (wantedUri) {
            filtered = portals.filter(p => {
              const ec = p.properties?.['ccm:educationalcontext'] ?? [];
              // Keep portals that don't specify a context (apply to all) OR match.
              return ec.length === 0 || ec.includes(wantedUri);
            });
          }
        }

        // Deterministic alphabetical sort
        const sorted = sortByTitle(filtered);

        // Optional content-count enrichment — bounded concurrency (not raw
        // Promise.allSettled) so up to ~100 portals don't fan out at once.
        const counts: Record<string, number> = {};
        if (params.includeContentCounts) {
          await mapPool(sorted, 5, async (p) => {
            const id = p.ref?.id;
            if (!id) return null;
            const subs = await getChildCollectionsResult(id, 100);
            // Only record a count we actually learned: a 0 that came from a
            // failed listing would read as "this portal is empty".
            if (subs.reachable) counts[id] = subs.nodes.length;
            return null;
          });
        }

        const formatted = sorted.map(p => {
          const f = formatNode(p);
          return {
            ...f,
            subCollectionCount: params.includeContentCounts ? counts[f.nodeId] : undefined,
          };
        });

        if (params.outputFormat === 'json') {
          return {
            content: [{
              type: 'text' as const,
              text: JSON.stringify({ total: formatted.length, results: formatted }),
            }],
            structuredContent: { total: formatted.length, results: formatted },
          };
        }

        const lines: string[] = [`WLO Fachportale: ${formatted.length}\n`];
        for (const p of formatted) {
          const parts: string[] = [];
          parts.push(`## ${p.title}`);
          parts.push(`nodeId: ${p.nodeId}`);
          if (p.description) parts.push(`Beschreibung: ${p.description.slice(0, 300)}${p.description.length > 300 ? '…' : ''}`);
          if (p.disciplines.length) parts.push(`Fach: ${p.disciplines.join(', ')}`);
          if (p.educationalContexts.length) parts.push(`Bildungsstufe: ${p.educationalContexts.join(', ')}`);
          if (p.topicPageUrl) parts.push(`Themenseite: ${p.topicPageUrl}`);
          if (p.subCollectionCount !== undefined) parts.push(`Sub-Sammlungen: ${p.subCollectionCount}`);
          // Same record format and same reason as renderToText: every part is
          // one logical line, and a repository title carrying a newline would
          // otherwise open a second portal entry with a nodeId of its choosing.
          lines.push(parts.map(oneLine).join('\n'));
          lines.push('');
        }
        return {
          content: [{ type: 'text' as const, text: lines.join('\n').trim() }],
          structuredContent: { total: formatted.length, results: formatted },
        };
      } catch (err) {
        return toolError('Fehler beim Abruf der Fachportale', err);
      }
    },
  });

  registerWloTool(server, {
    name: 'browse_collection_tree',
    title: 'WLO Sammlungsbaum',
    widgetUri: browseWidgetUri,
    // The browse widget calls this tool from inside the iframe for drill-down.
    widgetAccessible: true,
    description: `Navigiere durch die Unterthemen einer WLO-Sammlung oder eines Fachportals — für geführtes Stöbern wie "zeig mir die Unterthemen von Mathematik" oder "was steckt in dieser Sammlung". Gib ENTWEDER eine \`nodeId\` (beliebige Sammlung) ODER einen \`subject\`-Namen (Fachportal wie "Mathematik"/"Mathe") — Letzterer wird server-seitig aufgelöst, kein get_subject_portals nötig.
Liefert die direkten Unter-Sammlungen (depth=1, Default) oder zwei Ebenen (depth=2), optional mit Datei-Anzahl je Knoten. Deterministisch (alphabetisch, nodeId als Tie-Breaker).
Die Übersicht ist bewusst auf zwei Ebenen und eine begrenzte Breite je Knoten gedeckelt. Zweige mit \`hasMoreChildren\` enthalten mehr, als hier steht — sag der Nutzerin/dem Nutzer das und öffne einen Zweig gezielt mit einem erneuten Aufruf (\`nodeId\` des Zweigs), statt die Auswahl als vollständig darzustellen.`,
    inputSchema: {
      nodeId: z.string().optional().describe('Parent collection nodeId (any collection). Optional if `subject` is given.'),
      subject: z.string().optional().describe('Subject/Fachportal NAME (e.g. "Mathematik" or "Mathe"), resolved to its portal nodeId server-side. Alternative to nodeId.'),
      depth: z.number().int().min(1).max(2).optional().default(1).describe(
        '1 = direct sub-collections only (fast); 2 = also include grand-children (more API calls).'
      ),
      includeContentCounts: z.boolean().optional().default(false).describe(
        'When true, fetch the number of files (Inhalte) inside each sub-collection (extra round-trip per node).'
      ),
      includeContentPreview: z.number().int().min(1).max(5).optional().describe(
        'When set (1–5), attach the first N content items (Inhalte) of each sub-collection as ' +
        'a "contentPreview" array — a peek at what is inside without a second call. Bounded extra fetches.'
      ),
      maxResults: z.number().int().min(1).max(100).optional().default(50),
      outputFormat: z.enum(['markdown', 'json']).optional().default('markdown'),
    },
    outputSchema: browseTreeSchema,
    annotations: { readOnlyHint: true },
    handler: async (params) => {
      const depth = params.depth ?? 1;

      try {
        // Resolve the parent node: an explicit nodeId wins; otherwise resolve a
        // subject NAME to its Fachportal (saves a get_subject_portals round-trip).
        let parentId = params.nodeId;
        if (!parentId && params.subject) {
          const listing = await getChildCollectionsResult(WLO_ROOT_COLLECTION_ID, 100);
          // Without the portal list there is no "not found" to report — only an
          // unanswered question. Saying "Verfügbar: ." would invent an answer.
          if (!listing.reachable) throw new Error('Die Fachportal-Liste ist derzeit nicht abrufbar.');
          const portals = listing.nodes;
          const hit = matchSubjectPortal(portals, params.subject);
          if (!hit?.ref?.id) {
            const available = sortByTitle(portals)
              .map(p => oneLine(formatNode(p).title))
              .filter(Boolean)
              .join(', ');
            log.warn('no subject portal matched', { subject: params.subject });
            return {
              content: [{ type: 'text' as const, text:
                `Kein Fachportal für "${oneLine(params.subject)}" gefunden. Verfügbar: ${available}.` }],
              isError: true,
            };
          }
          parentId = hit.ref.id;
        }
        if (!parentId) {
          log.warn('browse_collection_tree called without nodeId or subject');
          return {
            content: [{ type: 'text' as const, text: 'Bitte nodeId oder subject angeben.' }],
            isError: true,
          };
        }

        // The bounded, cycle-guarded walk itself lives in services/ — a tool
        // module holds its schema and its rendering, never an algorithm.
        // `truncated` is disclosed below so the caller can offer a targeted
        // drill-down rather than presenting a slice as the whole tree.
        const { nodes: tree, truncated } = await buildCollectionTree({
          parentId,
          depth,
          maxResults: params.maxResults ?? 50,
          includeContentCounts: params.includeContentCounts ?? false,
          contentPreview: params.includeContentPreview,
        });
        const payload = { parent: parentId, depth, total: tree.length, results: tree, truncated };

        if (params.outputFormat === 'json') {
          return {
            content: [{ type: 'text' as const, text: JSON.stringify(payload) }],
            structuredContent: payload,
          };
        }

        const lines: string[] = [`Sub-Sammlungen unter ${parentId}: ${tree.length} (Tiefe ${depth})\n`];
        const renderTree = (nodes: CollectionTreeNode[], indent: number) => {
          for (const n of nodes) {
            const pad = '  '.repeat(indent);
            const cnt = n.fileCount !== undefined ? ` [${n.fileCount} Inhalte]` : '';
            // oneLine per rendered value: this listing is line-oriented, so a
            // title carrying a newline would add a branch with a nodeId that
            // exists nowhere in the tree (same rule as renderToText).
            lines.push(oneLine(`${pad}- **${n.title}** (${n.nodeId})${cnt}`));
            for (const p of n.contentPreview ?? []) {
              lines.push(oneLine(`${pad}    · ${p.title}`));
            }
            if (n.children?.length) renderTree(n.children, indent + 1);
            if (n.hasMoreChildren) {
              lines.push(`${pad}  … weitere Unterthemen vorhanden — zum Öffnen: browse_collection_tree mit nodeId=${n.nodeId}`);
            }
          }
        };
        renderTree(tree, 0);
        if (truncated) {
          lines.push('');
          lines.push('Hinweis: Diese Übersicht zeigt zwei Ebenen in begrenzter Breite. Zweige mit dem Hinweis oben lassen sich gezielt einzeln öffnen.');
        }
        return {
          content: [{ type: 'text' as const, text: lines.join('\n').trim() }],
          structuredContent: payload,
        };
      } catch (err) {
        return toolError('Fehler beim Sub-Sammlungs-Abruf', err);
      }
    },
  });
}
