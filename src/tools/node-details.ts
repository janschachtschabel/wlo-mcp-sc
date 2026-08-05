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
  getNodeTextContent,
  readNodeMetadata,
  readNodeTextContent,
  type WloNode,
} from '../wlo-api.js';
import { formatNode, oneLine } from '../formatter.js';
import { getParentCollections } from '../services/node-collections.js';
import { registerWloTool } from '../apps/register.js';
import { capText } from '../text-cap.js';
import { nodeListSchema } from '../apps/outputSchemas.js';
import { nodeLookupMiss, toolError } from './shared.js';
import { mapPool } from '../concurrency.js';

// Full-text length caps. JSON/bulk output carries the fuller text for machine
// consumers; the human-readable markdown detail view uses a shorter preview
// (deep text is available via get_compendium_text). Named so the two are an
// explicit choice, not stray literals.
const TEXT_CONTENT_CAP = 4000;
const TEXT_CONTENT_MARKDOWN_CAP = 2000;

/**
 * Preview length of the compendium text in the markdown record — the same cap
 * `formatter.renderToText` applies to the same field. Without it a detail call
 * asking for title and licence returned an entire editorial essay inline; the
 * untruncated text is what `get_compendium_text` is for.
 */
const COMPENDIUM_PREVIEW_CAP = 500;

/** Same idea for the description, and the same value `renderToText` uses. */
const DESCRIPTION_PREVIEW_CAP = 400;

/**
 * How many nodes of a bulk call may have their full text fetched.
 *
 * `/textContent` is the slow endpoint (median 4.6 s, max 9.2 s measured — see
 * `wlo-node-text.ts`), so 50 ids at pool width 10 is five waves and can outlast
 * the server's own 30 s request timeout: the caller then loses the connection
 * instead of receiving the metadata it also asked for. The remaining ids are
 * NAMED in the response rather than silently left textless.
 */
const TEXT_ENRICH_MAX = 20;

/**
 * @param searchResultsWidgetUri – the W1 (results) `ui://` resource, when
 *   built. One node is a list of one: the widget shows its tile, and "Details"
 *   opens the Einzelansicht that already existed for exactly this shape — the
 *   tool answering "tell me about THIS material" rendered nothing until then
 *   (audit 2026-07-30). Only `get_node_details` is wired; `get_nodes_details`
 *   is a model-internal batch resolver with no display job.
 */
export function registerNodeDetailTools(server: McpServer, searchResultsWidgetUri?: string): void {
  registerWloTool(server, {
    name: 'get_node_details',
    title: 'WLO Knoten-Details',
    widgetUri: searchResultsWidgetUri,
    description: `Retrieve detailed METADATA (and optionally the stored text and/or parent collections) for a specific WLO node.
Fast by default (~0.3 s): metadata only. The full text of the material is a
SEPARATE, slower concern — use get_wlo_content_text when you actually need the
content itself (it also falls back to the linked page and reports why a text is
missing). \`includeTextContent\` here is the quick variant without that fallback.
Auf Deutsch gefragt: dies ist die DETAILANSICHT (Titel, Fach, Lizenz, Link).
Wer „den Inhalt", „den ganzen Text" oder eine Zusammenfassung des Materials
will, braucht get_wlo_content_text — nicht dieses Werkzeug.

Returns the SAME field structure as search tools (formatNode):
title, description, keywords, disciplines (labels), educationalContexts (labels),
userRoles (labels), learningResourceTypes (labels), license (label), publisher,
url, previewUrl, topicPageUrl, nodeType.

Plus optional:
- textContent: the crawled/stored full text of the linked web page or document
- parents: the collection(s) this node belongs to (useful to find which Sammlung a content item is in)
- raw: the UNRESOLVED values behind five of the label fields, for debugging and for
  callers that need the vocabulary URIs — ccm:taxonid (disciplines),
  ccm:educationalcontext, ccm:educationalintendedenduserrole (userRoles),
  ccm:oeh_lrt_aggregated (learningResourceTypes) and the ccm:commonlicense_key.
  It is NOT the node's full property bag; nothing else is included.`,
    inputSchema: {
      nodeId: z.string().describe('Node ID of a content item or collection (from search results)'),
      includeTextContent: z.boolean().optional().default(false).describe(
        'Also fetch the stored full-text content of the node (crawled webpage/PDF text)'
      ),
      includeParents: z.boolean().optional().default(false).describe(
        'Also fetch the parent collections this node belongs to'
      ),
      includeRaw: z.boolean().optional().default(false).describe(
        'Include the unresolved vocabulary URIs and the licence key alongside the resolved labels'
      ),
      outputFormat: z.enum(['markdown', 'json']).optional().default('markdown').describe(
        '"markdown" (default, human-readable) or "json" (structured data, easier to parse for callers)'
      ),
    },
    outputSchema: nodeListSchema,
    annotations: { readOnlyHint: true },
    handler: async (params) => {
      try {
        const { node, status } = await readNodeMetadata(params.nodeId);
        if (!node) {
          // A miss still satisfies the schema, so the widget shows its empty
          // state instead of the host failing on a missing structuredContent.
          // WHY the status matters here: 401/403/5xx all produced "not found",
          // which tells a teacher a non-public material does not exist.
          return {
            content: [{ type: 'text' as const, text: nodeLookupMiss(params.nodeId, status) }],
            structuredContent: { total: 0, count: 0, results: [] },
          };
        }

        const props = node.properties ?? {};
        const formatted = formatNode(node);
        // One node is a list of one — the shape the results widget renders.
        const structuredContent = { total: 1, count: 1, results: [formatted] };

        // Extras that don't fit into FormattedNode. The text read reports its
        // status: "nothing stored" and "we could not read it" are different
        // answers, and only the first is a statement about the material.
        const renderUrl = buildRenderUrl(params.nodeId);
        const textRead = params.includeTextContent
          ? await readNodeTextContent(params.nodeId)
          : { text: null, status: 200 };
        const fullText = textRead.text;
        // Not `/parents`: that endpoint carries ancestors for a collection and
        // an empty list for a material, so it answered "in no collection" for
        // records that were in several. See `getParentCollections`.
        const parentOutcome = params.includeParents
          ? await getParentCollections(node, params.nodeId)
          : ({ status: 'ok', collections: [] } as const);
        const parents = parentOutcome.status === 'ok' ? parentOutcome.collections : [];

        // ── JSON output ───────────────────────────────────────────────────
        if (params.outputFormat === 'json') {
          const payload: Record<string, unknown> = {
            ...formatted,
            renderUrl,
          };
          if (params.includeParents) {
            payload['parents'] = parents;
            // An empty list and a failed lookup must not read the same.
            if (parentOutcome.status === 'unknown') payload['parentsError'] = parentOutcome.detail;
          }
          if (params.includeTextContent) {
            payload['textContent'] = fullText ? capText(fullText, TEXT_CONTENT_CAP).text : '';
            // An empty string and a failed read must not read the same, for the
            // same reason `parentsError` exists.
            if (!fullText && textRead.status !== 200) {
              payload['textContentError'] = `Der Volltext konnte nicht gelesen werden (HTTP ${textRead.status}).`;
            }
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
          return { content: [{ type: 'text' as const, text: JSON.stringify(payload) }], structuredContent };
        }

        // ── Markdown output (default, backward-compat with consumers that parse text) ──
        // This is the same line-oriented format `formatter.renderToText` emits —
        // `## title` opens a record, `Key: value` carries a field — and it is
        // built by hand here. Every value in it is repository-supplied, so it
        // needs renderToText's protection too: the `lines` array is flattened
        // with `oneLine` before joining (see below), or a newline in a title
        // would open a second record with its own nodeId and `Lizenz:` line.
        const lines: string[] = [];
        lines.push(`## ${formatted.title || params.nodeId}`);
        lines.push(`nodeId: ${params.nodeId}`);
        if (formatted.description) {
          const d = formatted.description;
          lines.push(`Beschreibung: ${d.slice(0, DESCRIPTION_PREVIEW_CAP)}${d.length > DESCRIPTION_PREVIEW_CAP ? '…' : ''}`);
        }
        if (formatted.compendiumText) {
          const c = formatted.compendiumText;
          lines.push(`Kompendium: ${c.slice(0, COMPENDIUM_PREVIEW_CAP)}${c.length > COMPENDIUM_PREVIEW_CAP ? '…' : ''}`);
        }
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
          // The same five fields the JSON branch carries. They used to differ,
          // so switching output format silently dropped two of them.
          // Blank lines are their own entries, never a `\n` inside a value:
          // `oneLine` below would fold an embedded break into a space and the
          // heading would stop being a heading.
          lines.push('', `### Raw URIs`);
          if (props['ccm:taxonid']?.length) lines.push(`Fach-URI: ${props['ccm:taxonid'].join(', ')}`);
          if (props['ccm:educationalcontext']?.length) lines.push(`Bildungsstufe-URI: ${props['ccm:educationalcontext'].join(', ')}`);
          if (props['ccm:educationalintendedenduserrole']?.length) lines.push(`Zielgruppe-URI: ${props['ccm:educationalintendedenduserrole'].join(', ')}`);
          if (props['ccm:oeh_lrt_aggregated']?.length) lines.push(`Ressourcentyp-URI: ${props['ccm:oeh_lrt_aggregated'].join(', ')}`);
          const rawLicense = props['ccm:commonlicense_key']?.[0];
          if (rawLicense) lines.push(`Lizenz-Key: ${rawLicense}`);
        }

        if (params.includeParents) {
          if (parentOutcome.status === 'unknown') {
            lines.push('', `Die Sammlungen zu diesem Knoten konnten nicht ermittelt werden (${parentOutcome.detail}).`);
          } else if (parents.length > 0) {
            lines.push('', `### Eltern-Sammlungen (${parents.length})`);
            for (const p of parents) {
              lines.push(`- ${p.title || p.nodeId || '?'} (nodeId: ${p.nodeId || '?'})`);
            }
          } else {
            lines.push('', 'Keine Eltern-Sammlungen gefunden.');
          }
        }

        if (params.includeTextContent && !fullText) {
          lines.push('', textRead.status === 200
            ? 'Kein gespeicherter Volltext verfügbar.'
            : `Der gespeicherte Volltext konnte nicht gelesen werden (HTTP ${textRead.status}); ob einer hinterlegt ist, sagt das nicht.`);
        }

        // Flatten every record line — see the note above. The stored full text is
        // appended AFTERWARDS and deliberately keeps its line breaks: it is a
        // document, not a field, and it is the last thing in the output.
        const out = lines.map(oneLine);
        if (params.includeTextContent && fullText) {
          const trimmed = capText(fullText, TEXT_CONTENT_MARKDOWN_CAP).text;
          out.push('', '### Gespeicherter Volltext', trimmed);
        }

        return { content: [{ type: 'text' as const, text: out.join('\n') }], structuredContent };
      } catch (err) {
        return toolError('Fehler beim Abruf der Node-Details', err);
      }
    },
  });

  server.tool(
    'get_nodes_details',
    `Bulk-fetch metadata for multiple node IDs in parallel.
Saves N round-trips when callers need details for many nodes (e.g. resolve cards from a search).
Returns the same FormattedNode shape as get_node_details (json mode), keyed by nodeId.

Optionally enrich each entry (like get_node_details, but for the whole batch):
- includeTextContent: adds \`textContent\` (crawled/stored full text, capped) per node — the
  full text is the SLOW read, so it is fetched for at most the first ${TEXT_ENRICH_MAX} nodes;
  the rest are named in \`textContentSkipped\`. Ask for fewer ids, or use get_wlo_content_text.
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
        // Kept so the parent lookup can pick the right endpoint per node kind
        // without loading each node a second time.
        const loaded = new Map<string, WloNode>();
        ids.forEach((id, i) => {
          const node = metas[i];
          if (node) {
            results[id] = { ...formatNode(node) };
            resolvedIds.push(id);
            loaded.set(id, node);
          } else {
            failed.push(id);
          }
        });

        // Optional per-node enrichment — opt-in, so callers that only want
        // metadata pay zero extra round-trips. Bounded concurrency (matches
        // topic-pages) keeps a 50-node batch from hammering the repository.
        // The full text additionally has a COUNT bound, because concurrency
        // alone does not bound wall-clock: 50 slow reads at width 10 outlast
        // the server's own request timeout. Skipped ids are named, not dropped.
        const textIds = params.includeTextContent ? resolvedIds.slice(0, TEXT_ENRICH_MAX) : [];
        const textSkipped = params.includeTextContent ? resolvedIds.slice(TEXT_ENRICH_MAX) : [];
        if (params.includeTextContent || params.includeParents) {
          const withText = new Set(textIds);
          await mapPool(resolvedIds, 10, async (id) => {
            if (withText.has(id)) {
              const fullText = await getNodeTextContent(id);
              results[id]['textContent'] = fullText ? capText(fullText, TEXT_CONTENT_CAP).text : '';
            }
            if (params.includeParents) {
              const node = loaded.get(id);
              const outcome = node
                ? await getParentCollections(node, id)
                : ({ status: 'unknown', detail: 'Knoten nicht geladen' } as const);
              results[id]['parents'] = outcome.status === 'ok' ? outcome.collections : [];
              if (outcome.status === 'unknown') results[id]['parentsError'] = outcome.detail;
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
              ...(textSkipped.length ? { textContentSkipped: textSkipped } : {}),
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
