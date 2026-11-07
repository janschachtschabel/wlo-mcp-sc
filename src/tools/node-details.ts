/**
 * tools/node-details.ts – Detail retrieval for single/multiple nodes:
 * get_node_details (metadata + full text + parents) and
 * get_nodes_details (bulk variant).
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { buildRenderUrl, readNodeMetadata, readNodeTextContent } from '../wlo-api.js';
import {
  formatNode, nodeIdLine, NOT_PUBLIC_LINE, oneLine, registrySummaryLines, renderToText, type FormattedNode,
} from '../formatter.js';
import { codeOfStatus, loadNodeDetails, TEXT_CONTENT_CAP, TEXT_ENRICH_MAX } from '../services/node-details.js';
import { accessInfo, accessInfoLines } from '../node-access.js';
import { qualityInfo, qualityLines } from '../node-quality.js';
import { getParentCollections } from '../services/node-collections.js';
import { ensureRegistries } from '../services/skill-registry-cache.js';
import { registerWloTool } from '../apps/register.js';
import { capText } from '../text-cap.js';
import { formattedNodeSchema, nodeListSchema } from '../apps/outputSchemas.js';
import { nodeLookupMiss, subjectRegistryText, toolError } from './shared.js';

// Full-text length caps. JSON/bulk output carries the fuller text for machine
// consumers; the human-readable markdown detail view uses a shorter preview
// (deep text is available via get_compendium_text). Named so the two are an
// explicit choice, not stray literals.
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
 * The list answer of `get_node_details` with `nodeIds` (E3): the record list the
 * widget renders, plus what each node was enriched with and what could not be
 * read. Declared field by field, because what a schema does not name does not
 * reach `structuredContent` (the rule `formattedNodeSchema` already follows).
 */
const nodeDetailsListSchema = nodeListSchema.extend({
  results: z.array(formattedNodeSchema.extend({
    /** Single `nodeId` only: the repository's render page for the record. */
    renderUrl: z.string().optional(),
    textContent: z.string().optional(),
    textContentError: z.string().optional(),
    parents: z.array(z.unknown()).optional(),
    parentsError: z.string().optional(),
    /** Single `nodeId` with `includeRaw`: the unresolved URIs and the licence key. */
    raw: z.record(z.string(), z.unknown()).optional(),
    accessInfo: z.record(z.string(), z.unknown()).optional(),
    qualityInfo: z.record(z.string(), z.unknown()).optional(),
  })),
  /** E6: why each id is missing — a deleted record and a refused one are different answers. */
  missing: z.array(z.object({
    part: z.string(),
    code: z.enum(['not_found', 'forbidden', 'timeout', 'upstream_busy', 'upstream_error']),
  })).optional(),
  textContentSkipped: z.array(z.string()).optional(),
});

/** At most this many ids per call, for both detail tools. */
const MAX_IDS = 50;

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
      nodeId: z.string().optional().describe('Node ID of ONE content item or collection (from search results). Either this or nodeIds.'),
      nodeIds: z.array(z.string()).min(1).max(MAX_IDS).optional().describe(
        `Several node IDs at once (1–${MAX_IDS}) instead of calling this tool repeatedly. The answer is then ALWAYS a list `
        + '{results, missing}, missing = [{part: nodeId, code: not_found|forbidden|timeout|upstream_error}]; the enrichments (textContent, parents, accessInfo, qualityInfo) sit on each result. '
        + 'includeRaw and skillContext apply to nodeId only.'),
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
    outputSchema: nodeDetailsListSchema,
    annotations: { readOnlyHint: true },
    handler: async (params) => {
      try {
        const many = Array.isArray(params.nodeIds) && params.nodeIds.length > 0;
        if (many === Boolean(params.nodeId)) {
          // A caller's mistake, not a failure: no log line, no stack.
          const message = 'Bitte genau eines angeben: nodeId oder nodeIds (für einen bzw. mehrere Datensätze).';
          return {
            content: [{ type: 'text' as const, text: message }],
            structuredContent: { error: { code: 'invalid_input', message } },
            isError: true,
          };
        }
        if (many) return await manyNodeDetails(params);

        const { node, status } = await readNodeMetadata(params.nodeId);
        if (!node) {
          // A miss still satisfies the schema, so the widget shows its empty
          // state instead of the host failing on a missing structuredContent.
          // WHY the status matters here: 401/403/5xx all produced "not found",
          // which tells a teacher a non-public material does not exist.
          // `missing` as with `nodeIds` (feedback 2026-11-07): a deleted record
          // and a refused one must not read the same to a program either.
          return {
            content: [{ type: 'text' as const, text: nodeLookupMiss(params.nodeId, status) }],
            structuredContent: { total: 0, count: 0, results: [], missing: [{ part: params.nodeId, code: codeOfStatus(status) }] },
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

        // ONE record for both channels: the JSON text and `structuredContent`
        // used to differ — the enrichments reached only the text, so a client
        // reading the contract never saw them (chatbot feedback 2026-11-07).
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
        // One node is a list of one — the shape the results widget renders.
        const structuredContent = { total: 1, count: 1, results: [payload] };

        // ── JSON output ───────────────────────────────────────────────────
        if (params.outputFormat === 'json') {
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
        // The inspection tool is where an editor decides whether to SHARE a
        // record — same sentence as the search lists, one exported constant.
        if (formatted.isPublic === false) lines.push(NOT_PUBLIC_LINE);
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
    `Bulk-fetch metadata for multiple node IDs in parallel (kept for existing callers).
Prefer get_node_details with nodeIds: same reads, answered as a list {results, missing} in structured content.
Same FormattedNode shape as get_node_details (json mode), keyed by nodeId.

Optional per node, as in get_node_details:
- includeTextContent: \`textContent\` (stored full text, capped) — the SLOW read, so only for the
  first ${TEXT_ENRICH_MAX} nodes; the rest are named in \`textContentSkipped\` (or use get_wlo_content_text).
- includeParents: \`parents\` (the collections the node belongs to)
- includeAccessInfo: \`accessInfo\` (login, cost, advertising, WCAG/BITV, OER status) — no extra request
- includeQualityInfo: \`qualityInfo\` (editorial ratings) — no extra request

Failed lookups land in \`failed\`, not as an overall error — one bad id does not ruin the batch.`,
    {
      nodeIds: z.array(z.string()).min(1).max(MAX_IDS).describe(
        `Array of node IDs to fetch (max ${MAX_IDS} per call).`
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
        const batch = await loadNodeDetails(params.nodeIds, params);
        const { ids, failed, textSkipped } = batch;
        const results = Object.fromEntries(batch.results);

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

/**
 * `get_node_details` with `nodeIds`: the same load `get_nodes_details` makes, the
 * answer as a list in request order. Collections in it get their catalogue like
 * every other record list.
 */
async function manyNodeDetails(params: {
  nodeIds: string[]; includeTextContent?: boolean; includeParents?: boolean;
  includeAccessInfo?: boolean; includeQualityInfo?: boolean; outputFormat?: string;
}) {
  const batch = await loadNodeDetails(params.nodeIds, params);
  const results = batch.ids.flatMap(id => {
    const r = batch.results.get(id);
    return r ? [r as FormattedNode & Record<string, unknown>] : [];
  });
  await ensureRegistries(results);
  const structuredContent = {
    total: results.length,
    count: results.length,
    results,
    missing: batch.failures.map(f => ({ part: f.id, code: f.code })),
    ...(batch.textSkipped.length ? { textContentSkipped: batch.textSkipped } : {}),
  };
  const text = params.outputFormat === 'json'
    ? JSON.stringify(structuredContent)
    : [
      renderToText(results, results.length) || 'Keiner der Datensätze war lesbar.',
      ...(batch.failures.length
        ? [oneLine(`Nicht lesbar: ${batch.failures.map(f => `${f.id} (${f.code})`).join(', ')}`)] : []),
      ...(batch.textSkipped.length
        ? [oneLine(`Volltext nur für die ersten ${TEXT_ENRICH_MAX}; ohne: ${batch.textSkipped.join(', ')}`)] : []),
    ].join('\n');
  return { content: [{ type: 'text' as const, text }], structuredContent };
}
