/**
 * tools/topic-page-content.ts – get_topic_page_content:
 * Resolve the swimlane structure of a Themenseite; in JSON mode the widget
 * configs (saved queries / node lists) are executed into real content cards
 * per swimlane.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import type { TargetGroup } from '../topic-page-api.js';
import { getTopicPageContent } from '../topic-page-api.js';
import { resolveTopicPageSwimlanes } from '../services/topic-page.js';
import { toolError } from './shared.js';
import { registerWloTool } from '../apps/register.js';
import { swimlanePayloadSchema } from '../apps/outputSchemas.js';

/**
 * @param topicPageWidgetUri – the W4 (topic-page/swimlane) `ui://` resource,
 *   when built; attached so an Apps-SDK host renders the swimlanes.
 */
export function registerTopicPageContentTool(server: McpServer, topicPageWidgetUri?: string): void {
  registerWloTool(server, {
    name: 'get_topic_page_content',
    widgetUri: topicPageWidgetUri,
    title: 'WLO Themenseiten-Inhalt',
    description: `Get the CONTENT STRUCTURE of a Themenseite (topic page): its sections
(swimlanes) — each with a heading and the nodeIds of the materials/collections
embedded in it. Use this AFTER search_wlo_topic_pages to see what is actually ON
a topic page (search_wlo_topic_pages only returns its URL). Resolve the returned
nodeIds to human titles with get_nodes_details.

Provide EITHER variantId (a "Variante-ID" from search_wlo_topic_pages — fastest)
OR collectionId (a "Sammlung-nodeId"). At least one is required.`,
    inputSchema: {
      collectionId: z.string().optional().describe(
        'Owning collection nodeId of the Themenseite (the "Sammlung-nodeId" from search_wlo_topic_pages).'
      ),
      variantId: z.string().optional().describe(
        'A specific page-variant nodeId (the "Variante-ID" from search_wlo_topic_pages). Faster than collectionId.'
      ),
      targetGroup: z.enum(['teacher', 'learner', 'general']).optional().describe(
        'When resolving by collectionId, pick the variant for this target group.'
      ),
      outputFormat: z.enum(['markdown', 'json']).optional().default('markdown').describe(
        '"markdown" (default) or "json". JSON is RENDER-READY: each swimlane carries its heading + up to maxPerSwimlane real content cards (resolved by EXECUTING the swimlane widget\'s saved query) + a hasMore flag, plus variantTitle and a topicPageUrl jump link. Use JSON to show "Themenseiten-Inhalte".'
      ),
      maxPerSwimlane: z.number().int().min(1).max(10).optional().default(3).describe(
        'JSON only: max real content cards resolved per swimlane (default 3). hasMore signals there is more on the full topic page (topicPageUrl).'
      ),
    },
    outputSchema: swimlanePayloadSchema,
    annotations: { readOnlyHint: true },
    handler: async (params) => {
      try {
        if (!params.collectionId && !params.variantId) {
          return { content: [{ type: 'text' as const, text: 'Bitte collectionId oder variantId angeben.' }], isError: true };
        }
        const struct = await getTopicPageContent({
          collectionId: params.collectionId,
          variantId: params.variantId,
          targetGroup: params.targetGroup as TargetGroup | undefined,
        });
        if (!struct || struct.swimlanes.length === 0) {
          // A valid-but-empty payload keeps the structuredContent contract even
          // when no variant / an empty config is found (this is not an error).
          const empty = {
            variantId: struct?.variantId ?? params.variantId ?? '',
            collectionId: struct?.collectionId ?? params.collectionId ?? null,
            variantTitle: struct?.variantTitle ?? '',
            // Header fields survive the empty case so the widget can still say
            // WHAT is empty (schema-optional; undefined is valid and dropped).
            collectionTitle: struct?.collectionTitle,
            description: struct?.description,
            topicPageUrl: null,
            swimlaneCount: 0,
            swimlanesTotal: struct?.swimlanes.length ?? 0,
            swimlanes: [],
          };
          return {
            content: [{ type: 'text' as const, text: 'Keine Themenseiten-Inhaltsstruktur gefunden (keine Variante oder leere Konfiguration).' }],
            structuredContent: empty,
          };
        }

        // RENDER-READY Themenseiten content: the swimlane resolver executes each
        // swimlane's widget config (saved query / node list / single node) into
        // real content cards, bounded (≤ maxPerSwimlane cards, ≤ MAX_LANES
        // swimlanes). It IS the structuredContent contract (widget + model) and
        // is therefore resolved in BOTH formats; markdown keeps its lightweight
        // structure text below. topicPageUrl provides the jump-off point.
        const payload = await resolveTopicPageSwimlanes(struct, params.maxPerSwimlane ?? 3);
        if (params.outputFormat === 'json') {
          return { content: [{ type: 'text' as const, text: JSON.stringify(payload) }], structuredContent: payload };
        }

        const lines: string[] = [];
        if (struct.variantTitle) lines.push(`# ${struct.variantTitle}`);
        lines.push(`Abschnitte (Swimlanes): ${struct.swimlanes.length}`);
        lines.push('');
        struct.swimlanes.forEach((sl, i) => {
          lines.push(`## ${i + 1}. ${sl.heading || '(ohne Überschrift)'}${sl.type ? ` [${sl.type}]` : ''}`);
          for (const it of sl.items) {
            lines.push(`  - ${it.widget || 'widget'}${it.nodeId ? ` → nodeId: ${it.nodeId}` : ''}`);
          }
        });
        if (struct.referencedNodeIds.length) {
          lines.push('');
          lines.push(`Eingebettete nodeIds (${struct.referencedNodeIds.length}): ${struct.referencedNodeIds.join(', ')}`);
        }
        return { content: [{ type: 'text' as const, text: lines.join('\n') }], structuredContent: payload };
      } catch (err) {
        return toolError('Fehler beim Abruf des Themenseiten-Inhalts', err);
      }
    },
  });
}
