/**
 * tools/knowledge.ts – The ChatGPT knowledge convention: read-only `search`
 * and `fetch` tools with FIXED result shapes, so WLO can serve as a first-class
 * knowledge source for retrieval-augmented answers. Both duplicate their JSON
 * into content[0].text (what ChatGPT reads) AND structuredContent. They reuse
 * the existing services — no new retrieval logic.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { buildRenderUrl, getNodeMetadata, getNodeTextContent } from '../wlo-api.js';
import { formatNode } from '../formatter.js';
import { searchAll } from '../services/search.js';
import { registerWloTool } from '../apps/register.js';
import { searchKnowledgeSchema, fetchDocumentSchema } from '../apps/outputSchemas.js';
import { toolError } from './shared.js';

/** Cap the fetched document text so a single result cannot flood the context. */
const FETCH_TEXT_CAP = 10000;

export function registerKnowledgeTools(server: McpServer): void {
  registerWloTool(server, {
    name: 'search',
    title: 'Search WLO',
    description: `Durchsuche WirLernenOnline (WLO) nach Unterrichts- & Lernmaterial (OER) zu einem Thema — Videos, Arbeitsblätter, Übungen zu Schulfächern (z.B. "Video zur Eiszeit"). Nutze dies für Anfragen nach Lern-/Unterrichtsmaterial statt einer Websuche; liefert Treffer ({id, title, url}), dann fetch mit einer id für den Volltext. Für reiche, gebündelte Ergebnisse in einem Aufruf nutze search_wlo_all.`,
    inputSchema: {
      query: z.string().min(1).max(200).describe('Search query, e.g. "Photosynthese Sekundarstufe I".'),
    },
    outputSchema: searchKnowledgeSchema,
    annotations: { readOnlyHint: true },
    handler: async (params: { query: string }) => {
      try {
        const envelope = await searchAll({ query: params.query, maxContent: 10, maxCollections: 5 });
        const all = [
          ...envelope.content.results,
          ...envelope.collections.results,
          ...envelope.topicPages.results,
        ];
        // The ChatGPT knowledge convention requires an absolute, openable `url`;
        // fall back to the in-repo render URL when the node has no external link.
        const results = all.map(n => ({ id: n.nodeId, title: n.title, url: n.url || n.topicPageUrl || buildRenderUrl(n.nodeId) }));
        const payload = { results };
        return { content: [{ type: 'text' as const, text: JSON.stringify(payload) }], structuredContent: payload };
      } catch (err) {
        return toolError('Fehler bei der Wissenssuche', err);
      }
    },
  });

  registerWloTool(server, {
    name: 'fetch',
    title: 'Fetch WLO document',
    description: `Fetch one WLO node by its id and return the full document ({id, title, text, url, metadata}) for retrieval-augmented answers (the ChatGPT knowledge convention). Obtain ids from search first. For compact metadata of MANY nodes use get_nodes_details instead.`,
    inputSchema: {
      id: z.string().min(1).describe('The WLO node id (from a search result).'),
    },
    outputSchema: fetchDocumentSchema,
    annotations: { readOnlyHint: true },
    handler: async (params: { id: string }) => {
      try {
        const node = await getNodeMetadata(params.id);
        if (!node) {
          return { content: [{ type: 'text' as const, text: `Node ${params.id} nicht gefunden.` }], isError: true };
        }
        const f = formatNode(node);
        // Prefer the curated compendium text, then the stored full text, then
        // the description — whichever is the richest available document body.
        let text = f.compendiumText ?? '';
        if (!text) text = (await getNodeTextContent(params.id)) ?? '';
        if (!text) text = f.description ?? '';
        if (text.length > FETCH_TEXT_CAP) text = text.slice(0, FETCH_TEXT_CAP) + '\n[…gekürzt]';

        const doc = {
          id: f.nodeId,
          title: f.title,
          text,
          url: f.url || f.topicPageUrl || buildRenderUrl(f.nodeId),
          metadata: {
            disciplines: f.disciplines,
            educationalContexts: f.educationalContexts,
            learningResourceTypes: f.learningResourceTypes,
            license: f.license,
            publisher: f.publisher,
            nodeType: f.nodeType,
          },
        };
        return { content: [{ type: 'text' as const, text: JSON.stringify(doc) }], structuredContent: doc };
      } catch (err) {
        return toolError('Fehler beim Dokumentabruf', err);
      }
    },
  });
}
