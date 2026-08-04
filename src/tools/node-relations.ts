/**
 * tools/node-relations.ts – Navigate from a node to nodes around it:
 * get_related_content (other material sharing its subject/level) and
 * get_node_breadcrumb (its ancestor path to the root of the collection tree).
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { readNodeBreadcrumb } from '../wlo-api.js';
import { getRelatedContent } from '../services/related.js';
import { getNodeCollections } from '../services/node-collections.js';
import { oneLine, renderToText } from '../formatter.js';
import { sanitizeText } from '../text-sanitize.js';
import { toolError } from './shared.js';
import { registerWloTool } from '../apps/register.js';
import { nodeListSchema } from '../apps/outputSchemas.js';

export function registerNodeRelationTools(server: McpServer, searchResultsWidgetUri?: string): void {
  registerWloTool(server, {
    name: 'get_related_content',
    title: 'WLO Ähnliche Inhalte',
    widgetUri: searchResultsWidgetUri,
    description: `Finde ähnliche WLO-Materialien zu einem Inhalt — "mehr wie dieses" / "was passt noch dazu" nach einer Suche oder Detailansicht. Andere Materialien mit gleichem Fach und gleicher Bildungsstufe.
Gib die nodeId eines Inhalts oder einer Sammlung; das Tool liest deren Fächer/Stufen und sucht Material mit gleichem Profil (der Ausgangsknoten wird ausgeschlossen). Optional \`siblings\` — die weiteren Inhalte der Eltern-Sammlung.`,
    inputSchema: {
      nodeId: z.string().describe('Seed node ID (content item or collection) to find related material for.'),
      maxResults: z.number().int().min(1).max(30).optional().default(8).describe(
        'Maximum number of related items (1–30, default 8).'
      ),
      includeSiblings: z.boolean().optional().default(false).describe(
        'Also return the other contents of the seed\'s primary parent collection as "siblings".'
      ),
      outputFormat: z.enum(['markdown', 'json']).optional().default('markdown'),
    },
    outputSchema: nodeListSchema,
    annotations: { readOnlyHint: true },
    handler: async (params) => {
      try {
        const related = await getRelatedContent({
          nodeId: params.nodeId,
          maxResults: params.maxResults ?? 8,
          includeSiblings: params.includeSiblings ?? false,
        });
        if (!related) {
          // A miss still satisfies the schema: the widget renders its empty
          // state instead of the host failing on a missing structuredContent.
          return {
            content: [{ type: 'text' as const, text: `Node ${params.nodeId} nicht gefunden.` }],
            structuredContent: { total: 0, count: 0, results: [] },
          };
        }
        // Siblings are extra context for the model; the widget shows the
        // related items, which is what "Ähnliche Inhalte" promised.
        const structuredContent = {
          total: related.results.length,
          count: related.results.length,
          results: related.results,
        };

        if ((params.outputFormat ?? 'markdown') === 'json') {
          return { content: [{ type: 'text' as const, text: JSON.stringify(related) }], structuredContent };
        }

        // `oneLine` on the heading for the same reason `renderToText` flattens
        // its own fields: this heading sits directly in front of a record list,
        // so a newline in the seed title forges an extra entry inside it.
        const lines: string[] = [
          oneLine(`# Verwandte Inhalte zu „${related.seedTitle || params.nodeId}“`),
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
        return { content: [{ type: 'text' as const, text: lines.join('\n') }], structuredContent };
      } catch (err) {
        return toolError('Fehler beim Abruf verwandter Inhalte', err);
      }
    },
  });

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
        // The reachability-carrying form: here the breadcrumb IS the answer, so
        // an empty chain may not be explained away as "probably a file node" —
        // a refused or failed read says nothing about the kind of node.
        const { ok, chain: crumb, status } = await readNodeBreadcrumb(params.nodeId);

        if ((params.outputFormat ?? 'markdown') === 'json') {
          return {
            content: [{ type: 'text' as const, text: JSON.stringify({
              nodeId: params.nodeId,
              breadcrumb: crumb,
              ...(ok ? {} : { error: `Der Pfad konnte nicht gelesen werden (HTTP ${status}).` }),
            }) }],
          };
        }

        if (!ok) {
          return { content: [{ type: 'text' as const, text:
            `Der Pfad für ${sanitizeText(params.nodeId)} ist nicht abrufbar (HTTP ${status}) — `
            + 'der Abruf ist fehlgeschlagen, über den Knoten sagt das nichts.' }] };
        }
        if (crumb.length === 0) {
          return { content: [{ type: 'text' as const, text:
            `Kein Pfad für ${sanitizeText(params.nodeId)} verfügbar (evtl. ein Datei-Knoten oder die Wurzel).` }] };
        }
        // One path, one line: a newline in a segment title would otherwise read
        // as a second breadcrumb.
        const path = oneLine(crumb.map(c => c.title).join(' › '));
        return { content: [{ type: 'text' as const, text: path }] };
      } catch (err) {
        return toolError('Fehler beim Abruf des Breadcrumb-Pfads', err);
      }
    },
  );

  registerWloTool(server, {
    name: 'get_node_collections',
    title: 'WLO Sammlungen eines Materials',
    description:
      'Zeigt, in WELCHEN WLO-Sammlungen ein Material geführt wird — die Antwort auf "wo ist das ' +
      'eingeordnet?" und "wo finde ich mehr davon?". Führt vom einzelnen Fundstück zurück zur kuratierten ' +
      'Sammlung, die es enthält. Gilt für Material-/Inhalts-Knoten; für die Einordnung einer SAMMLUNG im ' +
      'Themenbaum ist get_node_breadcrumb zuständig. Ein Material kann in mehreren Sammlungen liegen; in ' +
      'keiner ist ebenfalls ein normales Ergebnis und wird als solches benannt. Die nodeId aus einem ' +
      'Sammlungs-Listing funktioniert genauso wie die aus einer Suche.',
    inputSchema: {
      nodeId: z.string().describe(
        'nodeId des Materials. Die ID aus einem Sammlungs-Listing funktioniert genauso wie die aus einer ' +
        'Suche — der Server löst intern auf.',
      ),
      outputFormat: z.enum(['markdown', 'json']).optional().default('markdown'),
    },
    annotations: { readOnlyHint: true },
    handler: async (params) => {
      try {
        const result = await getNodeCollections(params.nodeId);

        if (!result) {
          // Named, not just empty: "there is no such record" and "this record is
          // in no collection" lead to different answers for the person asking.
          const payload = { nodeId: params.nodeId, count: 0, collections: [], reason: 'node_not_found' };
          return {
            content: [{
              type: 'text' as const,
              text: (params.outputFormat ?? 'markdown') === 'json'
                ? JSON.stringify(payload)
                : `Kein Knoten mit der ID ${sanitizeText(params.nodeId)} gefunden (reason: node_not_found).`,
            }],
            isError: true,
          };
        }

        if ((params.outputFormat ?? 'markdown') === 'json') {
          return {
            content: [{
              type: 'text' as const,
              text: JSON.stringify({
                nodeId: result.nodeId,
                requestedNodeId: result.requestedNodeId,
                wasReference: result.wasReference,
                count: result.collections.length,
                collections: result.collections,
                ...(result.reason ? { reason: result.reason } : {}),
              }),
            }],
          };
        }

        const heading = oneLine(`# ${result.title || result.nodeId}`);
        if (result.collections.length === 0) {
          return { content: [{ type: 'text' as const, text:
            `${heading}\n\nDieses Material liegt in keiner Sammlung.` }] };
        }
        return { content: [{ type: 'text' as const, text: `${heading}\n\n${renderToText(result.collections)}` }] };
      } catch (err) {
        return toolError('Die Sammlungen zu diesem Material konnten nicht ermittelt werden', err);
      }
    },
  });
}
