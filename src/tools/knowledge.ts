/**
 * tools/knowledge.ts – The ChatGPT knowledge convention: read-only `search`
 * and `fetch` tools with FIXED result shapes, so WLO can serve as a first-class
 * knowledge source for retrieval-augmented answers. Both duplicate their JSON
 * into content[0].text (what ChatGPT reads) AND structuredContent. They reuse
 * the existing services — no new retrieval logic.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { buildRenderUrl, getNodeTextContent, readNodeMetadata } from '../wlo-api.js';
import { formatNode } from '../formatter.js';
import { searchAll } from '../services/search.js';
import { registerWloTool } from '../apps/register.js';
import { capText } from '../text-cap.js';
import {
  searchKnowledgeSchema, searchKnowledgeRichSchema,
  fetchDocumentSchema, fetchDocumentRichSchema,
} from '../apps/outputSchemas.js';
import { nodeLookupMiss, toolError } from './shared.js';

/**
 * Cap on the fetched document text. 100 000 (user decision 2026-08-20 — 10 000
 * "klingt zu wenig") rather than unbounded, because this answer has no dial:
 * the convention allows only `id`, ChatGPT calls fetch on its own after
 * `search`, and the document travels TWICE (content[0].text and
 * structuredContent), so the cap is the only bound the chat's context has.
 */
const FETCH_TEXT_CAP = 100000;

/**
 * How many content hits `search` asks for. Higher than `search_wlo_all`'s
 * default of 8 on purpose: this tool cannot narrow anything (one `query`
 * parameter, no filters, no paging), so the only way it reaches a usable hit is
 * a slightly wider first page.
 */
const SEARCH_MAX_CONTENT = 10;
const SEARCH_MAX_COLLECTIONS = 5;

/**
 * Drop the inline compendium text from a rich `search` answer.
 *
 * On `search_wlo_all` the compendium is opt-in (`includeCompendium`, default
 * off), but the search projection carries it inline anyway, so it arrives
 * unasked. `search` has a single `query` parameter and can never opt in — and
 * the convention makes us send the payload TWICE (`content[0].text` and
 * `structuredContent`), which doubles it. Measured on staging 2026-08-09 for
 * "Klimawandel": 61 742 of 93 583 characters, 66 % of the answer. No widget
 * reads the field. Whoever wants the text has `get_compendium_text`.
 */
function stripCompendium<T extends { compendiumText?: string }>(nodes: T[]): T[] {
  return nodes.map(({ compendiumText: _dropped, ...rest }) => rest as T);
}

/**
 * The two `search` descriptions. Both close on the SAME delimiting sentence,
 * because the boundary against `search_wlo_all` is not how much comes back — in
 * rich mode that is identical — but that this tool takes a single `query` by
 * convention and therefore cannot narrow anything.
 */
const SEARCH_DELIMITATION = `NIMM search_wlo_all, SOBALD DIE ANFRAGE ETWAS EINGRENZT — ein Fach ("Biologie"), eine Stufe ("Klasse 7", "Sekundarstufe I"), einen Materialtyp ("nur Videos"), einen Anbieter, oder wenn weitere Treffer nachgeladen werden sollen. Dieses Werkzeug nimmt konventionsbedingt NUR einen Suchbegriff und hat für all das keinen Parameter; es würde die Einschränkung stillschweigend ignorieren.`;

/** What `search` is when it returns three fields per hit. */
const SEARCH_DESCRIPTION_LEAN = `Belegstellen-Suche in WirLernenOnline (WLO) nach Unterrichtsmaterial — Video, Arbeitsblatt, Übung. Minimaler Einstieg nach der ChatGPT-Knowledge-Konvention: liefert je Treffer NUR {id, title, url}, danach fetch mit einer id für den Volltext. Gedacht für Zitate und Quellenangaben, meist modell-intern.
Liefert weder Vorschaubild, Lizenz, Fach und Stufe noch Sammlungen oder Themenseiten und kann die WLO-Oberfläche nicht anzeigen. ${SEARCH_DELIMITATION}`;

/** Same tool with the buckets and the widget — only the "delivers less" half drops. */
const SEARCH_DESCRIPTION_RICH = `Belegstellen-Suche in WirLernenOnline (WLO) nach Unterrichtsmaterial — Video, Arbeitsblatt, Übung. Nach der ChatGPT-Knowledge-Konvention: je Treffer {id, title, url} für Zitate, danach fetch mit einer id für den Volltext. Liefert zusätzlich dieselben Töpfe wie search_wlo_all (content/collections/topicPages mit Vorschaubild, Lizenz, Fach, Stufe) und zeigt die WLO-Oberfläche an.
${SEARCH_DELIMITATION}`;

/** `fetch`, lean: the convention document, nothing rendered. */
const FETCH_DESCRIPTION_LEAN = `Fetch one WLO node by its id and return the full document ({id, title, text, url, metadata}) for retrieval-augmented answers (the ChatGPT knowledge convention). Obtain ids from search first.
Carries fewer fields than get_node_details — no preview image, no download link, no keywords — and renders no interface. For compact metadata of MANY nodes use get_nodes_details.`;

/** `fetch`, rich: same document plus the node the results widget renders. */
const FETCH_DESCRIPTION_RICH = `Fetch one WLO node by its id and return the full document ({id, title, text, url, metadata}) for retrieval-augmented answers (the ChatGPT knowledge convention). Obtain ids from search first. Also returns the complete record (preview image, download link, licence, subject, level) and renders the WLO detail view.
For compact metadata of MANY nodes use get_nodes_details.`;

export interface KnowledgeToolOptions {
  /** `lean` = the convention's minimum (default), `rich` = plus buckets + widget. */
  mode?: 'lean' | 'rich';
  /** `ui://…` results widget; attached in rich mode only (lean has nothing to render). */
  widgetUri?: string;
}

export function registerKnowledgeTools(server: McpServer, opts: KnowledgeToolOptions = {}): void {
  const rich = opts.mode === 'rich';
  registerWloTool(server, {
    name: 'search',
    title: 'Search WLO',
    description: rich ? SEARCH_DESCRIPTION_RICH : SEARCH_DESCRIPTION_LEAN,
    inputSchema: {
      query: z.string().min(1).max(200).describe('Search query, e.g. "Photosynthese Sekundarstufe I".'),
    },
    outputSchema: rich ? searchKnowledgeRichSchema : searchKnowledgeSchema,
    annotations: { readOnlyHint: true },
    // Lean mode declares no widget: there is nothing in {id,title,url} to render.
    widgetUri: rich ? opts.widgetUri : undefined,
    handler: async (params: { query: string }) => {
      try {
        const envelope = await searchAll({
          query: params.query,
          maxContent: SEARCH_MAX_CONTENT,
          maxCollections: SEARCH_MAX_COLLECTIONS,
        });
        const all = [
          ...envelope.content.results,
          ...envelope.collections.results,
          ...envelope.topicPages.results,
        ];
        // The ChatGPT knowledge convention requires an absolute, openable `url`;
        // fall back to the in-repo render URL when the node has no external link.
        // A topic page's own URL wins: formatNode fills `url` from content.url
        // for a collection node, so trying `url` first cited every topic page by
        // its /components/render/ link instead (measured on staging 2026-08-09).
        // Only topic pages carry topicPageUrl, so content nodes are unaffected.
        const results = all.map(n => ({ id: n.nodeId, title: n.title, url: n.topicPageUrl || n.url || buildRenderUrl(n.nodeId) }));
        // `results` FIRST and untouched in both modes — rich only adds siblings.
        // A connector that rejects the extra keys is the risk this mode carries;
        // one that ignores them reads exactly what lean mode would have sent.
        const payload = rich
          ? {
              results,
              ...envelope,
              content:     { ...envelope.content,     results: stripCompendium(envelope.content.results) },
              collections: { ...envelope.collections, results: stripCompendium(envelope.collections.results) },
              topicPages:  { ...envelope.topicPages,  results: stripCompendium(envelope.topicPages.results) },
            }
          : { results };
        return { content: [{ type: 'text' as const, text: JSON.stringify(payload) }], structuredContent: payload };
      } catch (err) {
        return toolError('Fehler bei der Wissenssuche', err);
      }
    },
  });

  registerWloTool(server, {
    name: 'fetch',
    title: 'Fetch WLO document',
    description: rich ? FETCH_DESCRIPTION_RICH : FETCH_DESCRIPTION_LEAN,
    inputSchema: {
      id: z.string().min(1).describe('The WLO node id (from a search result).'),
    },
    outputSchema: rich ? fetchDocumentRichSchema : fetchDocumentSchema,
    annotations: { readOnlyHint: true },
    // Same reasoning as `search`: the lean document has no renderable node in it.
    widgetUri: rich ? opts.widgetUri : undefined,
    handler: async (params: { id: string }) => {
      try {
        // Same distinction as get_node_details: a citation tool that reports a
        // refused record as absent teaches the model the source does not exist.
        const { node, status } = await readNodeMetadata(params.id);
        if (!node) {
          return { content: [{ type: 'text' as const, text: nodeLookupMiss(params.id, status) }], isError: true };
        }
        const f = formatNode(node);
        // Prefer the curated compendium text, then the stored full text, then
        // the description — whichever is the richest available document body.
        // Off the RAW property: `formatNode` carries only the `hasCompendium`
        // signal since 2026-08-20, and reading the field from it silently
        // demoted every collection fetch to its description (found red-first
        // here — the same rule `getCompendiumTexts` and the detail preview
        // already follow).
        let text = node.properties?.['ccm:oeh_collection_compendium_text']?.[0] ?? '';
        if (!text) text = (await getNodeTextContent(params.id)) ?? '';
        if (!text) text = f.description ?? '';
        text = capText(text, FETCH_TEXT_CAP).text;

        const doc = {
          id: f.nodeId,
          title: f.title,
          text,
          url: f.topicPageUrl || f.url || buildRenderUrl(f.nodeId),   // see `search`
          metadata: {
            disciplines: f.disciplines,
            educationalContexts: f.educationalContexts,
            learningResourceTypes: f.learningResourceTypes,
            license: f.license,
            publisher: f.publisher,
            nodeType: f.nodeType,
          },
        };
        // The convention document FIRST and untouched; rich adds the same node
        // in the shape the results widget renders, so the detail answer is no
        // longer poorer than get_node_details on the very fields a reader needs
        // (preview image, download link, description).
        const payload = rich ? { ...doc, total: 1, count: 1, results: [f] } : doc;
        return { content: [{ type: 'text' as const, text: JSON.stringify(payload) }], structuredContent: payload };
      } catch (err) {
        return toolError('Fehler beim Dokumentabruf', err);
      }
    },
  });
}
