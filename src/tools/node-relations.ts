/**
 * tools/node-relations.ts – Navigate from a node to nodes around it:
 * get_related_content (other material sharing its subject/level) and
 * get_node_breadcrumb (its ancestor path to the root of the collection tree).
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { getNodeBreadcrumb } from '../wlo-api.js';
import { getRelatedContent } from '../services/related.js';
import { renderToText } from '../formatter.js';
import { toolError } from './shared.js';

export function registerNodeRelationTools(server: McpServer): void {
  server.tool(
    'get_related_content',
    `Finde ähnliche WLO-Materialien zu einem Inhalt — "mehr wie dieses" / "was passt noch dazu" nach einer Suche oder Detailansicht. Andere Materialien mit gleichem Fach und gleicher Bildungsstufe.
Gib die nodeId eines Inhalts oder einer Sammlung; das Tool liest deren Fächer/Stufen und sucht Material mit gleichem Profil (der Ausgangsknoten wird ausgeschlossen). Optional \`siblings\` — die weiteren Inhalte der Eltern-Sammlung.`,
    {
      nodeId: z.string().describe('Seed node ID (content item or collection) to find related material for.'),
      maxResults: z.number().int().min(1).max(30).optional().default(8).describe(
        'Maximum number of related items (1–30, default 8).'
      ),
      includeSiblings: z.boolean().optional().default(false).describe(
        'Also return the other contents of the seed\'s primary parent collection as "siblings".'
      ),
      outputFormat: z.enum(['markdown', 'json']).optional().default('markdown'),
    },
    { readOnlyHint: true },
    async (params) => {
      try {
        const related = await getRelatedContent({
          nodeId: params.nodeId,
          maxResults: params.maxResults ?? 8,
          includeSiblings: params.includeSiblings ?? false,
        });
        if (!related) {
          return { content: [{ type: 'text' as const, text: `Node ${params.nodeId} nicht gefunden.` }] };
        }

        if ((params.outputFormat ?? 'markdown') === 'json') {
          return { content: [{ type: 'text' as const, text: JSON.stringify(related) }] };
        }

        const lines: string[] = [
          `# Verwandte Inhalte zu „${related.seedTitle || params.nodeId}"`,
        ];
        const basis = [
          related.disciplines.length ? `Fach: ${related.disciplines.join(', ')}` : '',
          related.educationalContexts.length ? `Bildungsstufe: ${related.educationalContexts.join(', ')}` : '',
        ].filter(Boolean).join(' · ');
        if (basis) lines.push(`_Basis: ${basis}_`);
        lines.push('');
        lines.push(renderToText(related.results) || 'Keine verwandten Inhalte gefunden.');
        if (related.siblings) {
          lines.push('');
          lines.push(`## Aus derselben Sammlung (${related.siblings.length})`);
          lines.push(renderToText(related.siblings) || 'Keine weiteren Inhalte in der Sammlung.');
        }
        return { content: [{ type: 'text' as const, text: lines.join('\n') }] };
      } catch (err) {
        return toolError('Fehler beim Abruf verwandter Inhalte', err);
      }
    },
  );

  server.tool(
    'get_node_breadcrumb',
    `Zeige, WO eine WLO-Sammlung im Themenbaum sitzt — der Pfad von der WLO-Wurzel bis zum Knoten (Breadcrumb). Nutze dies zur Orientierung nach einem tiefen Drilldown.
Gilt für Sammlungs-Knoten; Datei-/Inhalts-Knoten (ccm:io) haben hier keinen Breadcrumb und liefern einen leeren Pfad.`,
    {
      nodeId: z.string().describe('Collection node ID to build the breadcrumb for.'),
      outputFormat: z.enum(['markdown', 'json']).optional().default('markdown'),
    },
    { readOnlyHint: true },
    async (params) => {
      try {
        const crumb = await getNodeBreadcrumb(params.nodeId);

        if ((params.outputFormat ?? 'markdown') === 'json') {
          return {
            content: [{ type: 'text' as const, text: JSON.stringify({ nodeId: params.nodeId, breadcrumb: crumb }) }],
          };
        }

        if (crumb.length === 0) {
          return { content: [{ type: 'text' as const, text:
            `Kein Pfad für ${params.nodeId} verfügbar (evtl. ein Datei-Knoten oder die Wurzel).` }] };
        }
        const path = crumb.map(c => c.title).join(' › ');
        return { content: [{ type: 'text' as const, text: path }] };
      } catch (err) {
        return toolError('Fehler beim Abruf des Breadcrumb-Pfads', err);
      }
    },
  );
}
