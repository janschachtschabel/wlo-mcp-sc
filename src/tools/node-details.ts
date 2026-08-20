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
import { formatNode, nodeIdLine, oneLine, registrySummaryLines } from '../formatter.js';
import { accessInfo, accessInfoLines } from '../node-access.js';
import { qualityInfo, qualityLines } from '../node-quality.js';
import { getParentCollections } from '../services/node-collections.js';
import { ensureRegistries } from '../services/skill-registry-cache.js';
import { registerWloTool } from '../apps/register.js';
import { capText } from '../text-cap.js';
import { nodeListSchema } from '../apps/outputSchemas.js';
import { nodeLookupMiss, subjectRegistryText, toolError } from './shared.js';
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
 * `wlo-node-text.ts`), so 50 ids at pool width 10 is five waves: ~23 s at the
 * median and ~46 s at the maximum, spent before a single line reaches the
 * caller. The remaining ids are NAMED in the response rather than silently left
 * textless.
 *
 * The cap is about that WAIT, not about a server-side limit. This comment used
 * to say the batch "can outlast the server's own 30 s request timeout"; measured
 * 2026-08-17, `httpServer.requestTimeout` bounds RECEIVING a request and not the
 * work on it — a handler answering after 35 s delivers its response — which is
 * also why this server's SSE streams survive. What gives up is the client, on a
 * budget we cannot see.
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
    description: `Die DETAILANSICHT eines WLO-Datensatzes: Titel, Fach, Bildungsstufe, Lizenz, Anbieter, Link — die Metadaten, nicht der Inhalt. Für ein Material schnell (~0,3 s); bei einer SAMMLUNG kommt einmalig der Abruf ihrer freigegebenen Skills dazu (~1 s), danach gemerkt.
Wer „den Inhalt", „den ganzen Text" oder eine Zusammenfassung will, braucht get_wlo_content_text — nicht dieses Werkzeug. Dort kommt der Text notfalls von der verlinkten Seite und es wird gesagt, warum keiner da ist; \`includeTextContent\` hier ist die schnelle Variante ohne den Rückfall.
Liefert dieselben Felder wie die Suchwerkzeuge, als lesbare Labels. Optional: textContent, parents (Sammlungen des Datensatzes), accessInfo (Login nötig? Kosten? Werbung? Barrierefreiheit? OER-Status), qualityInfo (redaktionelle Bewertungen) und raw — Letzteres genau fünf Vokabular-URIs plus den Lizenzschlüssel (ccm:taxonid, ccm:educationalcontext, ccm:educationalintendedenduserrole, ccm:oeh_lrt_aggregated, ccm:commonlicense_key), NICHT den ganzen Property-Bag.`,
    inputSchema: {
      skillContext: z.string().max(120).optional().describe(
        'Arbeitszusammenhang, zu dem die für diese Sammlung freigegebenen Skills gezeigt werden '
        + 'sollen (Kontextname aus dem Registry-Dokument, z. B. „Redaktionsumgebung"). Liefert '
        + 'zusätzlich die Anleitung der Redaktion dazu und spart den Aufruf von get_skill_registry. '
        + 'Kostet 2 Abrufe, rund 1,0–1,4 Sekunden. Passt der Name nicht, kommt trotzdem der '
        + 'vollständige Katalog samt Liste der vorhandenen Kontexte — nie ein Fehler.'
      ),
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
      includeQualityInfo: z.boolean().optional().default(false).describe(
        'Redaktionelle Qualitätsbewertung des Datensatzes mitgeben: Sachrichtigkeit, Didaktik, '
        + 'Sprache, Medien, Neutralität, Transparenz, Aktualität, Datenschutz, Bildungsrelevanz, '
        + 'Urheber-/Straf-/Persönlichkeitsrecht, Jugendschutz — als lesbare Bewertungen '
        + '("✰✰✰ gute Methodik", "keine Auffälligkeiten gefunden (Maschine)"). Nur wenige '
        + 'Datensätze sind bewertet; ein unbewertetes Feld fehlt in der Antwort. Standard: false.'),
      includeAccessInfo: z.boolean().optional().default(false).describe(
        'Also report access conditions (login? cost? advertising?), accessibility conformance '
        + '(WCAG/BITV) and OER status. Costs no extra request. Only what the record carries.'
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
        // A collection's approved skills belong to the record being detailed, so
        // they are attached to it rather than added beside it: both output
        // formats and the widget then carry them without a second rule. A no-op
        // for a material — `ensureRegistries` skips anything that is not a
        // collection.
        await ensureRegistries([formatted]);
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
        // Free: `readNodeMetadata` already read `-all-`, so this is a projection
        // of properties in hand, not a second request. Behind a flag anyway —
        // the point of opt-in here is that no existing answer grows.
        const access = params.includeAccessInfo ? accessInfo(props) : {};
        const quality = params.includeQualityInfo ? qualityInfo(props) : {};

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
          if (params.includeAccessInfo) payload['accessInfo'] = access;
          if (params.includeQualityInfo) payload['qualityInfo'] = quality;
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
        // Through the shared rule, not by hand: this is the tool a reference id
        // from a collection listing is most likely handed to, and the sentence
        // that says so must read the same here as in a search result.
        lines.push(nodeIdLine(params.nodeId, formatted.originalId));
        if (formatted.description) {
          const d = formatted.description;
          lines.push(`Beschreibung: ${d.slice(0, DESCRIPTION_PREVIEW_CAP)}${d.length > DESCRIPTION_PREVIEW_CAP ? '…' : ''}`);
        }
        // From props, not from FormattedNode: formatNode carries only the
        // hasCompendium signal since 2026-08-20, and this detail view already
        // holds the full property bag — the capped preview stays what it was.
        const comp = props['ccm:oeh_collection_compendium_text']?.[0];
        if (comp) {
          lines.push(`Kompendium: ${comp.slice(0, COMPENDIUM_PREVIEW_CAP)}${comp.length > COMPENDIUM_PREVIEW_CAP ? '…' : ''}`);
        }
        if (formatted.keywords.length) lines.push(`Schlagworte: ${formatted.keywords.join(', ')}`);
        if (formatted.disciplines.length) lines.push(`Fach: ${formatted.disciplines.join(', ')}`);
        if (formatted.educationalContexts.length) lines.push(`Bildungsstufe: ${formatted.educationalContexts.join(', ')}`);
        if (formatted.userRoles.length) lines.push(`Zielgruppe: ${formatted.userRoles.join(', ')}`);
        if (formatted.learningResourceTypes.length) lines.push(`Ressourcentyp: ${formatted.learningResourceTypes.join(', ')}`);
        if (formatted.license) lines.push(`Lizenz: ${formatted.license}`);
        // Beside the licence, not appended at the end: "may I use this, and can
        // my pupils open it" is one question, and OER status is a statement
        // about the licence itself.
        lines.push(...accessInfoLines(access));
        lines.push(...qualityLines(quality));
        if (formatted.publisher) lines.push(`Anbieter: ${formatted.publisher}`);
        if (formatted.url) lines.push(`URL: ${formatted.url}`);
        if (formatted.previewUrl) lines.push(`Vorschaubild: ${formatted.previewUrl}`);
        lines.push(`WLO-URL: ${renderUrl}`);
        if (formatted.topicPageUrl) lines.push(`Themenseite: ${formatted.topicPageUrl}`);
        // Hand-built format, so `renderToText`'s registry lines do not arrive on
        // their own — same lines, same caps, from the one function that owns
        // them.
        //
        // `skillContext` cannot be served from here: the node carries the cached
        // SUMMARY, and a named context needs the editors' prose, which only a
        // live read has. It therefore goes through `subjectRegistryText` like
        // every other single-collection answer, and replaces these lines rather
        // than joining them — two catalogues for one collection, one narrowed
        // and one not, is a contradiction a reader has to resolve.
        const skillContext = String(params.skillContext ?? '').trim();
        const contextual = skillContext && formatted.nodeType === 'collection'
          ? await subjectRegistryText(params.nodeId, skillContext)
          : '';
        if (contextual) lines.push(...contextual.split('\n'));
        else if (formatted.skillRegistry) lines.push(...registrySummaryLines(formatted.skillRegistry));
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
Saves N round-trips (e.g. resolving cards from a search).
Same FormattedNode shape as get_node_details (json mode), keyed by nodeId.

Optionally enrich each entry, as in get_node_details:
- includeTextContent: adds \`textContent\` (crawled/stored full text, capped) per node — the
  full text is the SLOW read, so it is fetched for at most the first ${TEXT_ENRICH_MAX} nodes;
  the rest are named in \`textContentSkipped\`. Ask for fewer ids, or use get_wlo_content_text.
- includeParents: adds \`parents\` (the collections each node belongs to) per node
- includeAccessInfo: adds \`accessInfo\` (login? cost? advertising? WCAG/BITV? OER status?)
  per node — no extra request
- includeQualityInfo: adds \`qualityInfo\` (editorial ratings: correctness, didactics,
  law, protection of minors) per node — no extra request either

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
      includeQualityInfo: z.boolean().optional().default(false).describe(
        'Redaktionelle Qualitätsbewertung des Datensatzes mitgeben: Sachrichtigkeit, Didaktik, '
        + 'Sprache, Medien, Neutralität, Transparenz, Aktualität, Datenschutz, Bildungsrelevanz, '
        + 'Urheber-/Straf-/Persönlichkeitsrecht, Jugendschutz — als lesbare Bewertungen '
        + '("✰✰✰ gute Methodik", "keine Auffälligkeiten gefunden (Maschine)"). Nur wenige '
        + 'Datensätze sind bewertet; ein unbewertetes Feld fehlt in der Antwort. Standard: false.'),
      includeAccessInfo: z.boolean().optional().default(false).describe(
        'Also report access conditions (login, cost, advertising), accessibility conformance '
        + 'and OER status per node. '
        + 'Costs no extra request.'
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
            // Here rather than in the enrichment block below: those cost an
            // upstream call each, this is a projection of properties already in
            // hand (`getNodeMetadata` reads `-all-`).
            if (params.includeAccessInfo) results[id]['accessInfo'] = accessInfo(node.properties ?? {});
            if (params.includeQualityInfo) results[id]['qualityInfo'] = qualityInfo(node.properties ?? {});
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
