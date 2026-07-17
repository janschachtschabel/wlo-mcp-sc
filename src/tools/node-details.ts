/**
 * tools/node-details.ts – Detail retrieval for single/multiple nodes:
 * get_node_details (metadata + full text + parents) and
 * get_nodes_details (bulk variant).
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import {
  buildRenderUrl,
  getNodeMetadata,
  getNodeParents,
  getNodeTextContent,
} from '../wlo-api.js';
import { formatNode } from '../formatter.js';
import { mapPool, toolError } from './shared.js';

// Full-text length caps. JSON/bulk output carries the fuller text for machine
// consumers; the human-readable markdown detail view uses a shorter preview
// (deep text is available via get_compendium_text). Named so the two are an
// explicit choice, not stray literals.
const TEXT_CONTENT_CAP = 4000;
const TEXT_CONTENT_MARKDOWN_CAP = 2000;

export function registerNodeDetailTools(server: McpServer): void {
  server.tool(
    'get_node_details',
    `Retrieve detailed metadata, stored full-text content, and/or parent collections for a specific WLO node.

Returns the SAME field structure as search tools (formatNode):
title, description, keywords, disciplines (labels), educationalContexts (labels),
userRoles (labels), learningResourceTypes (labels), license (label), publisher,
url, previewUrl, topicPageUrl, nodeType.

Plus optional:
- textContent: the crawled/stored full text of the linked web page or document
- parents: the collection(s) this node belongs to (useful to find which Sammlung a content item is in)
- raw: the original ccm:* / cclom:* property URIs (for debugging / advanced use)`,
    {
      nodeId: z.string().describe('Node ID of a content item or collection (from search results)'),
      includeTextContent: z.boolean().optional().default(false).describe(
        'Also fetch the stored full-text content of the node (crawled webpage/PDF text)'
      ),
      includeParents: z.boolean().optional().default(false).describe(
        'Also fetch the parent collections this node belongs to'
      ),
      includeRaw: z.boolean().optional().default(false).describe(
        'Include raw URI values alongside the resolved labels'
      ),
      outputFormat: z.enum(['markdown', 'json']).optional().default('markdown').describe(
        '"markdown" (default, human-readable) or "json" (structured data, easier to parse for callers)'
      ),
    },
    { readOnlyHint: true },
    async (params) => {
      try {
        const node = await getNodeMetadata(params.nodeId);
        if (!node) {
          return { content: [{ type: 'text' as const, text: `Node ${params.nodeId} nicht gefunden.` }] };
        }

        const props = node.properties ?? {};
        const formatted = formatNode(node);

        // Extras that don't fit into FormattedNode
        const renderUrl = buildRenderUrl(params.nodeId);
        const fullText = params.includeTextContent ? await getNodeTextContent(params.nodeId) : null;
        const parents = params.includeParents ? await getNodeParents(params.nodeId) : [];

        // ── JSON output ───────────────────────────────────────────────────
        if (params.outputFormat === 'json') {
          const payload: Record<string, unknown> = {
            ...formatted,
            renderUrl,
          };
          if (params.includeParents) {
            payload['parents'] = parents.map(p => ({
              nodeId: p.ref?.id ?? '',
              title: p.properties?.['cclom:title']?.[0] ?? p.properties?.['cm:name']?.[0] ?? p.name ?? '',
            }));
          }
          if (params.includeTextContent) {
            payload['textContent'] = fullText && fullText.length > TEXT_CONTENT_CAP
              ? fullText.slice(0, TEXT_CONTENT_CAP) + '\n[…gekürzt]'
              : (fullText ?? '');
          }
          if (params.includeRaw) {
            payload['raw'] = {
              disciplines: props['ccm:taxonid'] ?? [],
              educationalContexts: props['ccm:educationalcontext'] ?? [],
              userRoles: props['ccm:educationalintendedenduserrole'] ?? [],
              learningResourceTypes: props['ccm:oeh_lrt_aggregated'] ?? [],
              license: props['ccm:commonlicense_key']?.[0] ?? '',
            };
          }
          return { content: [{ type: 'text' as const, text: JSON.stringify(payload) }] };
        }

        // ── Markdown output (default, backward-compat with consumers that parse text) ──
        const lines: string[] = [];
        lines.push(`## ${formatted.title || params.nodeId}`);
        lines.push(`nodeId: ${params.nodeId}`);
        if (formatted.description) lines.push(`Beschreibung: ${formatted.description}`);
        if (formatted.compendiumText) lines.push(`Kompendium: ${formatted.compendiumText}`);
        if (formatted.keywords.length) lines.push(`Schlagworte: ${formatted.keywords.join(', ')}`);
        if (formatted.disciplines.length) lines.push(`Fach: ${formatted.disciplines.join(', ')}`);
        if (formatted.educationalContexts.length) lines.push(`Bildungsstufe: ${formatted.educationalContexts.join(', ')}`);
        if (formatted.userRoles.length) lines.push(`Zielgruppe: ${formatted.userRoles.join(', ')}`);
        if (formatted.learningResourceTypes.length) lines.push(`Ressourcentyp: ${formatted.learningResourceTypes.join(', ')}`);
        if (formatted.license) lines.push(`Lizenz: ${formatted.license}`);
        if (formatted.publisher) lines.push(`Anbieter: ${formatted.publisher}`);
        if (formatted.url) lines.push(`URL: ${formatted.url}`);
        if (formatted.previewUrl) lines.push(`Vorschaubild: ${formatted.previewUrl}`);
        lines.push(`WLO-URL: ${renderUrl}`);
        if (formatted.topicPageUrl) lines.push(`Themenseite: ${formatted.topicPageUrl}`);
        lines.push(`Typ: ${formatted.nodeType === 'collection' ? 'Sammlung' : 'Inhalt'}`);

        if (params.includeRaw) {
          lines.push(`\n### Raw URIs`);
          if (props['ccm:taxonid']?.length) lines.push(`Fach-URI: ${props['ccm:taxonid'].join(', ')}`);
          if (props['ccm:educationalcontext']?.length) lines.push(`Bildungsstufe-URI: ${props['ccm:educationalcontext'].join(', ')}`);
          const rawLicense = props['ccm:commonlicense_key']?.[0];
          if (rawLicense) lines.push(`Lizenz-Key: ${rawLicense}`);
        }

        if (params.includeParents) {
          if (parents.length > 0) {
            lines.push(`\n### Eltern-Sammlungen (${parents.length})`);
            for (const p of parents) {
              const pName = (p.properties?.['cclom:title']?.[0] ?? p.properties?.['cm:name']?.[0] ?? p.name ?? p.ref?.id ?? '?');
              const pId = p.ref?.id ?? '?';
              lines.push(`- ${pName} (nodeId: ${pId})`);
            }
          } else {
            lines.push('\nKeine Eltern-Sammlungen gefunden.');
          }
        }

        if (params.includeTextContent) {
          if (fullText) {
            const trimmed = fullText.length > TEXT_CONTENT_MARKDOWN_CAP ? fullText.slice(0, TEXT_CONTENT_MARKDOWN_CAP) + '\n[…gekürzt]' : fullText;
            lines.push(`\n### Gespeicherter Volltext`);
            lines.push(trimmed);
          } else {
            lines.push('\nKein gespeicherter Volltext verfügbar.');
          }
        }

        return { content: [{ type: 'text' as const, text: lines.join('\n') }] };
      } catch (err) {
        return toolError('Fehler beim Abruf der Node-Details', err);
      }
    },
  );

  server.tool(
    'get_nodes_details',
    `Bulk-fetch metadata for multiple node IDs in parallel.
Saves N round-trips when callers need details for many nodes (e.g. resolve cards from a search).
Returns the same FormattedNode shape as get_node_details (json mode), keyed by nodeId.

Optionally enrich each entry (like get_node_details, but for the whole batch):
- includeTextContent: adds \`textContent\` (crawled/stored full text, capped) per node
- includeParents: adds \`parents\` (the collections each node belongs to) per node

Failed lookups (deleted node, network error) are returned in the \`failed\` array, not as
overall errors — so a single bad nodeId doesn't ruin the whole batch.`,
    {
      nodeIds: z.array(z.string()).min(1).max(50).describe(
        'Array of node IDs to fetch (max 50 per call).'
      ),
      includeTextContent: z.boolean().optional().default(false).describe(
        'Also fetch the stored full-text content of each node (crawled webpage/PDF text)'
      ),
      includeParents: z.boolean().optional().default(false).describe(
        'Also fetch the parent collections each node belongs to'
      ),
    },
    { readOnlyHint: true },
    async (params) => {
      try {
        const ids = Array.from(new Set(params.nodeIds.filter(Boolean)));
        // Bounded concurrency (not raw Promise.allSettled) so a 50-id batch does
        // not open 50 simultaneous upstream sockets. mapPool nulls a failed slot.
        const metas = await mapPool(ids, 10, (id) => getNodeMetadata(id));
        const results: Record<string, Record<string, unknown>> = {};
        const failed: string[] = [];
        const resolvedIds: string[] = [];
        ids.forEach((id, i) => {
          const node = metas[i];
          if (node) {
            results[id] = { ...formatNode(node) };
            resolvedIds.push(id);
          } else {
            failed.push(id);
          }
        });

        // Optional per-node enrichment — opt-in, so callers that only want
        // metadata pay zero extra round-trips. Bounded concurrency (matches
        // topic-pages) keeps a 50-node batch from hammering the repository.
        if (params.includeTextContent || params.includeParents) {
          await mapPool(resolvedIds, 10, async (id) => {
            if (params.includeTextContent) {
              const fullText = await getNodeTextContent(id);
              results[id]['textContent'] = fullText && fullText.length > TEXT_CONTENT_CAP
                ? fullText.slice(0, TEXT_CONTENT_CAP) + '\n[…gekürzt]'
                : (fullText ?? '');
            }
            if (params.includeParents) {
              const parents = await getNodeParents(id);
              results[id]['parents'] = parents.map(p => ({
                nodeId: p.ref?.id ?? '',
                title: p.properties?.['cclom:title']?.[0] ?? p.properties?.['cm:name']?.[0] ?? p.name ?? '',
              }));
            }
            return null;
          });
        }

        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              requested: ids.length,
              resolved: Object.keys(results).length,
              failed,
              results,
            }),
          }],
        };
      } catch (err) {
        return toolError('Fehler beim Bulk-Abruf der Node-Details', err);
      }
    },
  );
}
