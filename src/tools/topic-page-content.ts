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
import { findTopicPagesByQuery, resolveTopicPageSwimlanes } from '../services/topic-page.js';
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
    description: `Zeige eine WLO-Themenseite zu einem Thema mit ihren Schwimmlinien (swimlanes) — z.B. "zeig die Themenseite zu Optik". Liefert die render-fertigen Abschnitte mit echten Inhaltskarten (die Schwimmlinien-Ansicht der Themenseite).

Gib EINES an:
- query: ein Themenname (z.B. "Optik") — das Tool findet die passende Themenseite
  selbst und liefert ihre Schwimmlinien in EINEM Aufruf. Nutze dies für eine
  direkte Anfrage wie "zeig die Themenseite zu Optik"; kein vorheriges
  search_wlo_topic_pages nötig.
- variantId (eine "Variante-ID") oder collectionId (eine "Sammlung-nodeId") aus
  search_wlo_topic_pages, wenn du diese Suche schon ausgeführt hast.`,
    inputSchema: {
      query: z.string().optional().describe(
        'Topic name (German), e.g. "Optik". Resolves the best matching Themenseite internally and renders its swimlanes in ONE call — no prior search_wlo_topic_pages needed. Alternative to variantId/collectionId.'
      ),
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
        const tg = params.targetGroup as TargetGroup | undefined;
        let collectionId = params.collectionId;
        let variantId = params.variantId;

        if (!collectionId && !variantId) {
          if (!params.query?.trim()) {
            return { content: [{ type: 'text' as const, text: 'Bitte query, collectionId oder variantId angeben.' }], isError: true };
          }
          // One-step topic path: resolve the best Themenseite for the topic so
          // the swimlane widget triggers without a prior search_wlo_topic_pages
          // call. Prefer the resolved collectionId (it carries the page header).
          // No match falls through to the empty-payload path below.
          const found = await findTopicPagesByQuery(params.query, tg);
          if (found.length) {
            collectionId = found[0].collectionId ?? undefined;
            if (!collectionId) variantId = found[0].variantId;
          }
        }

        const struct = (collectionId || variantId)
          ? await getTopicPageContent({ collectionId, variantId, targetGroup: tg })
          : null;
        if (!struct || struct.swimlanes.length === 0) {
          // A valid-but-empty payload keeps the structuredContent contract even
          // when no variant / an empty config is found (this is not an error).
          const empty = {
            variantId: struct?.variantId ?? variantId ?? '',
            collectionId: struct?.collectionId ?? collectionId ?? null,
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
