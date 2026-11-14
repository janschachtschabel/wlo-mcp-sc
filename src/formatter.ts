/**
 * formatter.ts – Extract and clean WLO node properties into a structured output.
 */

import type { WloNode } from './wlo-api.js';
import { buildTopicPageUrl } from './wlo-api.js';
import { labelFromUri, type VocabKey } from './vocabs.js';
import { nodeTitle } from './node-match.js';
import { oneLine, nodeIdLine } from './text-line.js';
import { registryLines, registryHintFor } from './registry-render.js';

// Moved out on 2026-11-05 and re-exported so every importer keeps its path.
export { oneLine, quotedTitle, nodeIdLine } from './text-line.js';
export { DESCRIPTIONS_ONLY_NOTE, REGISTRY_INLINE_MAX, registrySummaryLines, registryHintFor } from './registry-render.js';

export interface FormattedNode {
  nodeId: string;
  /**
   * The record this node points at, when `nodeId` names a collection REFERENCE
   * rather than the record itself.
   *
   * Absent on an original — not set equal to `nodeId`. That mirrors the
   * repository DTO, which omits the field exactly there, and it keeps every
   * existing response unchanged: the field appears where it has something to
   * say and nowhere else.
   *
   * It matters because collection listings hand out reference ids and nothing
   * else, so this is the id a caller naturally passes on. Measured 2026-08-16:
   * a metadata write aimed at a reference is stored ON the reference and never
   * reaches the record. Our write tools resolve it themselves
   * (`resolveWriteTarget`); this field is how a caller can see the difference
   * at all.
   */
  originalId?: string;
  title: string;
  description: string;
  keywords: string[];
  disciplines: string[];
  educationalContexts: string[];
  userRoles: string[];
  learningResourceTypes: string[];
  /**
   * Primary "open this resource" link. Priority:
   *   1. `ccm:wwwurl` — external link (most content nodes)
   *   2. `node.content.url` — in-repo viewer (PDF/video preview)
   *   3. empty (the consumer should fall back to render-by-nodeId)
   */
  url: string;
  /**
   * Direct binary download (without auth). Set only on file nodes whose
   * server returned a `downloadUrl`. Null for external-link nodes and
   * collections.
   */
  downloadUrl: string;
  /**
   * In-repo viewer URL (`/components/render/<id>` style). Useful when a
   * frontend wants to embed the edu-sharing PDF/video preview component.
   * Empty for external-link-only nodes.
   */
  contentUrl: string;
  /** Thumbnail URL — may be a generic mediatype icon, see `previewIsIcon`. */
  previewUrl: string;
  /**
   * `true` = thumbnail is a generic icon (no real preview was generated).
   * Frontends can use this to decide between rendering the icon as small/
   * subdued vs. featuring a true thumbnail prominently.
   */
  previewIsIcon: boolean;
  /**
   * Present exactly when the repository says the node is NOT readable by
   * GROUP_EVERYONE — an authenticated search returns such records, and every
   * anonymous fetch of their preview answers the permission-shield image.
   * Absent for public records and for instances that never send the field.
   */
  isPublic?: false;
  /**
   * How many materials the collection holds — present only when the search DTO
   * carried `collection.childReferencesCount` (the collections query does; a
   * metadata read does not — measured 2026-08-22). Absent = unknown, never 0.
   *
   * It is the repository's own COUNTER, and that is all it is (chatbot team,
   * 2026-11-14): it lags by seconds behind a filing or removal, and at a
   * collection with sub-collections it counted their references too. Good for
   * "roughly how much is here"; never the read-back of a write — the tools that
   * need the number read the listing (`list_collection_tree`
   * `includeContentCounts`, `browse_collection_tree` `includeContentCounts`).
   */
  contentsCount?: number;
  /** MIME type if the node has a binary attachment, e.g. `application/pdf`. */
  mimeType: string;
  /** File size in bytes (0 for nodes without binary content). */
  fileSize: number;
  license: string;
  publisher: string;
  nodeType: 'collection' | 'content';
  topicPageUrl: string;
  /**
   * Stored full-text content (crawled webpage / PDF extract), capped. Only
   * present when a caller opted in (e.g. search_wlo_content `includeTextContent`);
   * absent otherwise, so default output is unchanged.
   */
  textContent?: string;
  /**
   * Editorial compendium text (`ccm:oeh_collection_compendium_text`) — filled
   * ONLY by the opt-in `includeCompendium` enrichment. `formatNode` never sets
   * it (user decision 2026-08-20): the property is UNCAPPED and rides in
   * DISPLAY_PROPS — the earlier claim here that DISPLAY_PROPS omits it was
   * false, measured live when one Optik search hit shipped 37 428 chars
   * inline, 75 % of the whole answer, in every format. The text itself is
   * `get_compendium_text`'s job (TOC + targeted passages).
   */
  compendiumText?: string;
  /** The record HAS a compendium — the signal that the tool call is worth it. */
  hasCompendium?: true;
  /**
   * The skill registry this COLLECTION declares — which skills are approved for
   * it (`services/skill-registry.ts`). Present only when the collection carries
   * one; no field means no registry.
   *
   * Entries carry title and nodeId only: both come out of the registry
   * document's `:::` blocks, so the whole enrichment costs two requests per
   * collection regardless of how many skills are declared. Description and
   * keywords need one read per skill and stay with `get_skill_registry`.
   */
  skillRegistry?: {
    nodeId: string;
    title: string;
    /**
     * `context` is the group the registry document filed the skill under —
     * absent for one that belongs to none and therefore applies everywhere.
     * Needed here because the listing GROUPS by it; without it the renderer
     * would have the context names and no way to say which skill is whose.
     */
    entries: { nodeId: string; title: string; context?: string }[];
    /**
     * The named groups the registry document declares, with how many skills each
     * holds ITSELF — a group that only groups reports zero, because what it
     * holds is listed under its sub-contexts and must not be counted twice.
     *
     * Absent for a flat document, which is every registry written before
     * 2026-08-18: an empty array would appear in `structuredContent` where
     * nothing was before.
     *
     * Names and counts only. The editorial instruction belongs to the targeted
     * call — seven groups of up to 1200 characters in EVERY collection hit is
     * the cost this whole package exists to remove.
     */
    contexts?: { path: string; skills: number }[];
    /** Set when the registry declares more skills than the catalogue lists. */
    truncated?: { listed: number; referenced: number };
  };
}

/**
 * `node.size` arrives as a STRING from the live edu-sharing API (the JSON
 * serialises byte counts quoted) while the declared outputSchema — and every
 * consumer — expects a number. MCP hosts (Claude) validate structuredContent
 * against the schema and reject the whole tool result on a mismatch, so the
 * coercion must happen here at the source. Unparseable → 0 ("unknown", the
 * existing absent-value semantics), never NaN.
 */
function toFileSize(size: number | string | undefined): number {
  const n = typeof size === 'string' ? Number(size) : size ?? 0;
  return Number.isFinite(n) ? n : 0;
}

function first(arr: string[] | undefined): string {
  return arr?.[0] ?? '';
}

/**
 * Resolve a vocab-backed property to display labels.
 *
 * **Priority order (deliberate):**
 *
 * 1. **`<property>_DISPLAYNAME`** — server-side resolved labels straight
 *    from the edu-sharing index. This is the *only* source that covers
 *    BOTH the school discipline vocab AND the Hochschulfächersystematik
 *    (and any future vocab) without us maintaining hundreds of mappings
 *    locally. Verified to be present for `ccm:taxonid`,
 *    `ccm:educationalcontext`, `ccm:oeh_lrt_aggregated`.
 *
 * 2. **Local `labelFromUri` lookup** — fallback for legacy data and
 *    properties where `_DISPLAYNAME` isn't populated (e.g.
 *    `ccm:commonlicense_key` — license keys are stored as raw strings
 *    like `CC_BY_SA` and have no server-side display name).
 *
 * 3. **Raw URI** — final fallback inside `labelFromUri` so the consumer
 *    sees something rather than nothing.
 *
 * Why we do NOT use `_DISPLAYNAME` for label-→-URI resolution
 * (`resolveVocab`): user inputs like "Mathematik" are ambiguous between
 * the school vocab (`discipline/380` = Mathematik) and Hochschul-`n4`
 * ("Mathematik, Naturwissenschaften" — broader than expected).
 * Mapping inputs is therefore kept conservative on the school vocab,
 * while displaying labels uses DISPLAYNAME for full coverage.
 */
/**
 * Case-insensitive stable dedup. Some WLO nodes have:
 *   - duplicate URIs (data-side bug: `[Bio, Phys, Bio]`)
 *   - mixed-vocab entries that resolve to the same human concept
 *     (e.g. `Biologie` from school vocab + `Biologie` from Hochschul-vocab)
 * Both produce noisy duplicate labels in the output. Drop them, keeping
 * the first occurrence of each (case-insensitive).
 */
function dedupStable(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of values) {
    const key = v.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(v);
  }
  return out;
}

function resolveLabels(
  uris: string[] | undefined,
  displayNames: string[] | undefined,
  vocab: Parameters<typeof labelFromUri>[1],
): string[] {
  if (displayNames && displayNames.length > 0) {
    // Pair URIs with DISPLAYNAMEs and drop entries where the URI is a
    // vocabulary-root (e.g. ".../discipline/") — the index resolves those
    // to the vocabulary title ("Schulfächer") which is meaningless for UI.
    const cleaned: string[] = [];
    for (let i = 0; i < displayNames.length; i++) {
      const name = displayNames[i];
      if (typeof name !== 'string' || name.trim() === '') continue;
      const uri = uris?.[i] ?? '';
      if (uri && /\/$/.test(uri)) continue;  // ".../discipline/" root URI
      cleaned.push(name);
    }
    if (cleaned.length > 0) return dedupStable(cleaned);
  }
  if (!uris) return [];
  return dedupStable(
    uris
      .filter(u => !!u && !/\/$/.test(u))    // drop empties and ".../vocab/" root URIs
      .map(u => labelFromUri(u, vocab))
  );
}

export function formatNode(node: WloNode): FormattedNode {
  const p = node.properties ?? {};
  const nodeId = node.ref?.id ?? first(p['sys:node-uuid']);
  const pageConfigRef = first(p['ccm:page_config_ref']);

  return {
    nodeId,
    // Spread, not `originalId: node.originalId`: that sets the KEY on every
    // record with the value `undefined`, so `'originalId' in node` answers yes
    // for an original. JSON and zod both drop it, which is exactly why the
    // discrepancy would sit unnoticed until someone tests for presence.
    ...(node.originalId ? { originalId: node.originalId } : {}),
    // Shared canonical chain (node-match.ts) — no PAGE_VARIANT placeholder
    // leaks through get_node_details / get_collection_contents / browse.
    title:                nodeTitle(node),
    description:          first(p['cclom:general_description']) || node.collection?.description || '',
    keywords:             p['cclom:general_keyword'] ?? [],
    disciplines:          resolveLabels(p['ccm:taxonid'],                    p['ccm:taxonid_DISPLAYNAME'],                    'discipline'),
    educationalContexts:  resolveLabels(p['ccm:educationalcontext'],         p['ccm:educationalcontext_DISPLAYNAME'],         'educationalContext'),
    // Intended end-user role lives in ccm:educationalintendedenduserrole
    // (empirically verified against staging — ccm:oeh_intended_end_user_role
    // is NEVER set on real nodes). The same property is also used in the
    // search filter (buildFilterCriteria), now consistent.
    userRoles:            resolveLabels(p['ccm:educationalintendedenduserrole'], p['ccm:educationalintendedenduserrole_DISPLAYNAME'], 'userRole'),
    learningResourceTypes:resolveLabels(p['ccm:oeh_lrt_aggregated'],         p['ccm:oeh_lrt_aggregated_DISPLAYNAME'],         'lrt'),
    url:                  first(p['ccm:wwwurl']) || node.content?.url || '',
    downloadUrl:          node.downloadUrl ?? '',
    contentUrl:           node.content?.url ?? '',
    previewUrl:           node.preview?.url ?? '',
    previewIsIcon:        node.preview?.isIcon ?? false,
    mimeType:             node.mimetype ?? '',
    fileSize:             toFileSize(node.size),
    // Licenses don't have a server-side _DISPLAYNAME — keep local map.
    license:              labelFromUri(first(p['ccm:commonlicense_key']), 'license') || '',
    publisher:            first(p['ccm:oeh_publisher_combined']) || '',
    nodeType:             (node.type === 'ccm:map' || node.isDirectory === true) ? 'collection' : 'content',
    topicPageUrl:         buildTopicPageUrl(nodeId, pageConfigRef) ?? '',
    // The SIGNAL, never the text: the raw property is uncapped (largest on
    // staging: 65 250 chars) and used to ship inline with every search hit.
    // Spread like `originalId`, so an absent compendium leaves no key at all.
    ...(p['ccm:oeh_collection_compendium_text']?.[0] ? { hasCompendium: true as const } : {}),
    // Only the remarkable case travels: an AUTHENTICATED search returns records
    // anonymous callers cannot read (measured 2026-08-22 — "SUPRA Licht
    // Schatten": 0 anonymous, 13 authenticated), and for those every anonymous
    // fetch of the preview answers the repository's permission-shield image.
    // `true` and "field never sent" both stay absent, like `originalId`.
    ...(node.isPublic === false ? { isPublic: false as const } : {}),
    // How much a collection HOLDS, when the repository said it: the collections
    // search query carries `collection.childReferencesCount` on every hit, a
    // metadata read carries no `collection` object at all (measured
    // 2026-08-22). Absence therefore means "not known here", never zero, and
    // no path pays an extra fetch for the number.
    ...(typeof node.collection?.childReferencesCount === 'number'
      ? { contentsCount: node.collection.childReferencesCount }
      : {}),
  };
}

/**
 * The one sentence for an `isPublic: false` record, shared by every renderer
 * (search lists, `get_node_details`): a hit only the signed-in caller can see
 * must say so, or the model recommends material the audience cannot open.
 */
export const NOT_PUBLIC_LINE = 'Sichtbarkeit: nicht öffentlich — Abruf nur mit Anmeldung';

export function formatNodes(nodes: WloNode[]): FormattedNode[] {
  return nodes.map(formatNode);
}

/**
 * Render a structured JSON envelope. Use when the caller wants to parse fields
 * directly instead of regex-matching the markdown output.
 */
export function renderToJson(nodes: FormattedNode[], totalHits?: number, flags: { incomplete?: boolean; restricted?: boolean } = {}): string {
  return JSON.stringify({
    total: totalHits ?? nodes.length,
    count: nodes.length,
    results: nodes,
    // In the TEXT too: a client that parses block 0 and never looks at
    // `structuredContent` otherwise reads a list a source left short as the
    // whole list (chatbot feedback 2026-11-13, D7). Absent when complete.
    ...(flags.incomplete ? { incomplete: true } : {}),
    // A branch the repository refused to open: not an outage, not empty (2026-11-14).
    ...(flags.restricted ? { restricted: true } : {}),
  });
}

/**
 * Which ngsearch facet property maps to which output key + vocab for label
 * resolution. Only these narrowing-relevant facets are surfaced; other facet
 * properties are ignored.
 */
const FACET_PROPERTY_VOCAB: Record<string, { key: string; vocab: VocabKey }> = {
  'ccm:oeh_lrt_aggregated': { key: 'learningResourceType', vocab: 'lrt' },
  'ccm:taxonid':            { key: 'discipline',           vocab: 'discipline' },
  'ccm:educationalcontext': { key: 'educationalContext',   vocab: 'educationalContext' },
};

/**
 * Turn raw ngsearch facet groups (`{property, values:[{value: URI, count}]}`)
 * into labeled counts keyed by the search-filter name, e.g.
 * `{ learningResourceType: [{label:"Video", count:1203}], … }`. Facet values are
 * URIs (no server-side display strings), so they're resolved via the existing
 * vocab. Unknown facet URIs fall back to their raw value (rare long-tail).
 */
export function resolveFacetCounts(
  facets: { property: string; values: { value: string; count: number }[] }[] | undefined,
): Record<string, { label: string; count: number; uri: string }[]> {
  const out: Record<string, { label: string; count: number; uri: string }[]> = {};
  for (const group of facets ?? []) {
    const map = FACET_PROPERTY_VOCAB[group.property];
    if (!map) continue;
    // `uri` is carried alongside the resolved label so a caller can filter by the
    // exact concept — important for the `discipline` facet, where a university
    // subject (Hochschulfächersystematik) shares its label with a school subject
    // but is a distinct URI (input accepts the raw URI via resolveVocab).
    out[map.key] = (group.values ?? []).map(v => ({
      label: labelFromUri(v.value, map.vocab),
      count: v.count,
      uri: v.value,
    }));
  }
  return out;
}

/**
 * The record's heading — a Markdown link when the node has a URL.
 *
 * Why a link and not plain text: clients routinely dropped the address and the
 * nodeId when presenting results, because a model reformats an answer and bare
 * text is the first thing it rewrites away. Ready-made formatting it tends to
 * carry over. The `nodeId:` and `URL:` lines below stay exactly as they were —
 * this adds a second, more durable route to the same fact.
 *
 * Both halves are repository-supplied, so both are protected the way the rest of
 * this renderer protects its delimiters. A `[` or `]` in the title would end the
 * link text early and spill the remainder as prose; a `(` or `)` in the URL
 * would end the target. Angle brackets are CommonMark's own answer to the
 * second (a `<…>` target may contain parentheses), and `<`/`>` inside the URL
 * are percent-encoded so they cannot close it.
 */
function headingFor(title: string, url: string): string {
  const text = title.replace(/[[\]]/g, '\\$&');
  if (!url) return `## ${text}`;
  const target = url.replace(/</g, '%3C').replace(/>/g, '%3E');
  return `## [${text}](<${target}>)`;
}


/**
 * Render a list of FormattedNodes as a compact text format for LLM consumption.
 *
 * @param opts.registryHint `false` for one list of an answer composed of
 *   several — the caller then emits `registryHintFor` once over all of them, or
 *   omits it because it already looked the registries up.
 */
export function renderToText(
  nodes: FormattedNode[],
  totalHits?: number,
  opts: { registryHint?: boolean } = {},
): string {
  const lines: string[] = [];
  if (totalHits !== undefined) {
    lines.push(`Gefundene Treffer gesamt: ${totalHits}, zeige ${nodes.length}\n`);
  }
  for (const n of nodes) {
    const parts: string[] = [];
    parts.push(headingFor(n.title || '(kein Titel)', n.url || n.contentUrl || ''));
    parts.push(nodeIdLine(n.nodeId, n.originalId));
    if (n.description) parts.push(`Beschreibung: ${n.description.slice(0, 400)}${n.description.length > 400 ? '…' : ''}`);
    if (n.keywords.length)             parts.push(`Schlagworte: ${n.keywords.slice(0, 10).join(', ')}`);
    if (n.disciplines.length)          parts.push(`Fach: ${n.disciplines.join(', ')}`);
    if (n.educationalContexts.length)  parts.push(`Bildungsstufe: ${n.educationalContexts.join(', ')}`);
    if (n.userRoles.length)            parts.push(`Zielgruppe: ${n.userRoles.join(', ')}`);
    if (n.learningResourceTypes.length)parts.push(`Ressourcentyp: ${n.learningResourceTypes.join(', ')}`);
    if (n.url)                         parts.push(`URL: ${n.url}`);
    if (n.downloadUrl)                 parts.push(`Download: ${n.downloadUrl}`);
    if (n.contentUrl && n.contentUrl !== n.url) parts.push(`Render-URL: ${n.contentUrl}`);
    if (n.previewUrl)                  parts.push(`Vorschaubild: ${n.previewUrl}${n.previewIsIcon ? ' (Icon)' : ''}`);
    if (n.mimeType)                    parts.push(`MIME-Typ: ${n.mimeType}${n.fileSize ? ` (${Math.round(n.fileSize/1024)} KB)` : ''}`);
    // Always stated, never omitted: a missing licence is itself the decisive
    // fact for a teacher (do NOT treat as free to reuse), and an absent line
    // reads like an unremarkable one. Matches the tile and the REST page.
    parts.push(`Lizenz: ${n.license || 'nicht angegeben'}`);
    // Only for the remarkable case: a hit the audience cannot open must say so.
    if (n.isPublic === false) parts.push(NOT_PUBLIC_LINE);
    if (n.publisher)                   parts.push(`Anbieter: ${n.publisher}`);
    if (n.topicPageUrl)                parts.push(`Themenseite: ${n.topicPageUrl}`);
    if (n.compendiumText)              parts.push(`Kompendium: ${n.compendiumText.slice(0, 500)}${n.compendiumText.length > 500 ? '…' : ''}`);
    else if (n.hasCompendium)          parts.push('Kompendium: vorhanden — Inhaltsverzeichnis und gezielte Absätze über get_compendium_text (optional mit query).');
    if (n.textContent)                 parts.push(`Volltext (Auszug): ${n.textContent.slice(0, 500)}${n.textContent.length > 500 ? '…' : ''}`);
    parts.push(...registryLines(n));
    parts.push(`Typ: ${n.nodeType === 'collection' ? 'Sammlung' : 'Inhalt'}`);
    // Every part above is exactly one logical line, so flattening here covers
    // all of them — including fields added later.
    lines.push(parts.map(oneLine).join('\n'));
    lines.push('');
  }
  if (opts.registryHint !== false) lines.push(...registryHintFor(nodes).map(oneLine));
  return lines.join('\n').trim();
}
