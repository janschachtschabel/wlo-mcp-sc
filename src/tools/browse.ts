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
  getChildCollections,
  getCollectionContents,
} from '../wlo-api.js';
import { sortByTitle } from '../reranker.js';
import type { FormattedNode } from '../formatter.js';
import { formatNode, formatNodes } from '../formatter.js';
import { resolveVocab } from '../vocabs.js';
import { mapPool, toolError } from './shared.js';
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
        const portals = await getChildCollections(WLO_ROOT_COLLECTION_ID, 100);

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
            const subs = await getChildCollections(id, 100);
            counts[id] = subs.length;
            return null;
          });
        }

        const formatted = sorted.map(p => {
          const f = formatNode(p);
          return {
            ...f,
            subCollectionCount: params.includeContentCounts ? (counts[f.nodeId] ?? 0) : undefined,
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
          lines.push(parts.join('\n'));
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
Liefert die direkten Unter-Sammlungen (depth=1, Default) oder zwei Ebenen (depth=2), optional mit Datei-Anzahl je Knoten. Deterministisch (alphabetisch, nodeId als Tie-Breaker).`,
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
      const previewN = params.includeContentPreview;

      try {
        // Resolve the parent node: an explicit nodeId wins; otherwise resolve a
        // subject NAME to its Fachportal (saves a get_subject_portals round-trip).
        let parentId = params.nodeId;
        if (!parentId && params.subject) {
          const portals = await getChildCollections(WLO_ROOT_COLLECTION_ID, 100);
          const hit = matchSubjectPortal(portals, params.subject);
          if (!hit?.ref?.id) {
            const available = sortByTitle(portals)
              .map(p => formatNode(p).title)
              .filter(Boolean)
              .join(', ');
            return {
              content: [{ type: 'text' as const, text:
                `Kein Fachportal für "${params.subject}" gefunden. Verfügbar: ${available}.` }],
              isError: true,
            };
          }
          parentId = hit.ref.id;
        }
        if (!parentId) {
          return {
            content: [{ type: 'text' as const, text: 'Bitte nodeId oder subject angeben.' }],
            isError: true,
          };
        }

        const level1 = await getChildCollections(parentId, params.maxResults ?? 50);
        const sorted1 = sortByTitle(level1);

        type TreeNode = ReturnType<typeof formatNode> & {
          fileCount?: number;
          children?: TreeNode[];
          /** First N content items, only when includeContentPreview is set. */
          contentPreview?: FormattedNode[];
        };

        // Bound the tree walk: recurse only while the current level is below the
        // requested depth (a closure-constant check would descend the WHOLE
        // subtree), cap concurrency with mapPool, and guard against cyclic
        // collection references with a visited set — so one call can never fan
        // out unbounded or fail to terminate.
        const TREE_CONCURRENCY = 5;
        const visited = new Set<string>();
        const enrichOne = async (n: WloNode, level: number): Promise<TreeNode> => {
          const f = formatNode(n) as TreeNode;
          const id = n.ref?.id;
          if (id) visited.add(id);
          if (params.includeContentCounts && id) {
            const filesResp = await getCollectionContents(id, 'files', 1, 0);
            f.fileCount = filesResp.pagination.total;
          }
          if (level < depth && id) {
            const children = await getChildCollections(id, 30);
            // Claim each child in `visited` at SCHEDULING time (synchronously in
            // this filter), not when its own enrichOne starts — otherwise two
            // parents sharing a child could both pass the check before either
            // marks it, emitting the same subtree twice. Claiming here makes the
            // placement deterministic (first parent in traversal order wins).
            const sortedChildren = sortByTitle(children).filter(c => {
              const cid = c.ref?.id;
              if (!cid) return true;
              if (visited.has(cid)) return false;
              visited.add(cid);
              return true;
            });
            const enriched = await mapPool(sortedChildren, TREE_CONCURRENCY, c => enrichOne(c, level + 1));
            f.children = enriched.filter((c): c is TreeNode => c !== null);
          }
          return f;
        };

        const tree = (await mapPool(sorted1, TREE_CONCURRENCY, n => enrichOne(n, 1)))
          .filter((n): n is TreeNode => n !== null);

        // Optional content preview: attach the first N files of each collection
        // in the tree. A single bounded pass (≤5 in flight) over the flattened
        // node list caps upstream concurrency even for a wide depth-2 tree.
        if (previewN) {
          const flat: TreeNode[] = [];
          const collect = (nodes: TreeNode[]) => {
            for (const n of nodes) { flat.push(n); if (n.children) collect(n.children); }
          };
          collect(tree);
          await mapPool(flat, 5, async (node) => {
            const resp = await getCollectionContents(node.nodeId, 'files', previewN, 0);
            node.contentPreview = formatNodes(resp.nodes).slice(0, previewN);
            return null;
          });
        }

        if (params.outputFormat === 'json') {
          return {
            content: [{
              type: 'text' as const,
              text: JSON.stringify({ parent: parentId, depth, total: tree.length, results: tree }),
            }],
            structuredContent: { parent: parentId, depth, total: tree.length, results: tree },
          };
        }

        const lines: string[] = [`Sub-Sammlungen unter ${parentId}: ${tree.length} (Tiefe ${depth})\n`];
        const renderTree = (nodes: TreeNode[], indent: number) => {
          for (const n of nodes) {
            const pad = '  '.repeat(indent);
            const cnt = n.fileCount !== undefined ? ` [${n.fileCount} Inhalte]` : '';
            lines.push(`${pad}- **${n.title}** (${n.nodeId})${cnt}`);
            for (const p of n.contentPreview ?? []) {
              lines.push(`${pad}    · ${p.title}`);
            }
            if (n.children?.length) renderTree(n.children, indent + 1);
          }
        };
        renderTree(tree, 0);
        return {
          content: [{ type: 'text' as const, text: lines.join('\n').trim() }],
          structuredContent: { parent: parentId, depth, total: tree.length, results: tree },
        };
      } catch (err) {
        return toolError('Fehler beim Sub-Sammlungs-Abruf', err);
      }
    },
  });
}
