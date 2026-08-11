/**
 * formatter.ts – Extract and clean WLO node properties into a structured output.
 */

import type { WloNode } from './wlo-api.js';
import { buildTopicPageUrl } from './wlo-api.js';
import { labelFromUri, type VocabKey } from './vocabs.js';
import { nodeTitle } from './node-match.js';

export interface FormattedNode {
  nodeId: string;
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
   * Editorial compendium text (`ccm:oeh_collection_compendium_text`) — a
   * curated prose summary of what a collection covers. The most authoritative
   * source for a collection overview when present. Only carried on nodes that
   * expose the property; search/list endpoints request DISPLAY_PROPS (which
   * omits it), so this stays empty there and is populated on the `-all-`
   * detail path (get_node_details / get_nodes_details).
   */
  compendiumText?: string;
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
    entries: { nodeId: string; title: string }[];
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
    // Undefined when the property is absent (search/list nodes) so the field
    // simply doesn't appear in JSON output — only detail nodes carry it.
    compendiumText:       p['ccm:oeh_collection_compendium_text']?.[0],
  };
}

export function formatNodes(nodes: WloNode[]): FormattedNode[] {
  return nodes.map(formatNode);
}

/**
 * Render a structured JSON envelope. Use when the caller wants to parse fields
 * directly instead of regex-matching the markdown output.
 */
export function renderToJson(nodes: FormattedNode[], totalHits?: number): string {
  return JSON.stringify({
    total: totalHits ?? nodes.length,
    count: nodes.length,
    results: nodes,
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
 * Collapse line breaks so a value cannot break out of its line.
 *
 * The text format below is line-oriented — `## title` opens a record, `Key: value`
 * carries a field — and every value in it is repository-supplied: titles,
 * descriptions, publisher names, server-side `_DISPLAYNAME` labels, URLs. A
 * newline in any of them opened a second, fabricated record with its own nodeId
 * and its own `Lizenz:` line, and a forged licence is precisely the claim a
 * teacher acts on. This is not sanitizing (the text stays as it is, it is data —
 * see `text-sanitize.ts` for the elevated-authority boundary); it is the renderer
 * protecting its own delimiters.
 *
 * Exported because several tools render their own line-oriented text instead of
 * going through `renderToText` (the collection tree, the Fachportal list, the
 * Themenseiten listing, the swimlane outline). They have the same delimiters and
 * therefore need the same protection — one implementation, not four.
 */
export function oneLine(value: string): string {
  return value.replace(/\s*[\r\n]+\s*/g, ' ');
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

/** Render a list of FormattedNodes as a compact text format for LLM consumption. */
/**
 * Skills shown per collection in a LISTING. The registry itself is capped
 * separately (`REGISTRY_MAX`); this is the narrower bound that keeps one search
 * answer readable — five collections carrying thirty skills each is a wall of
 * text where a search result should be.
 */
const REGISTRY_LINES_MAX = 4;

/**
 * The registry a collection declares, as listing lines — one per part, so the
 * caller's `oneLine` pass covers each of them.
 *
 * Two numbers can differ here and both are stated: how many skills the registry
 * DECLARES (`truncated.referenced`, set when the service capped it) and how many
 * this listing SHOWS. A short list that silently stands for a long one reads as
 * the whole approval list, which is the one thing it must not do.
 */
function registryLines(n: FormattedNode): string[] {
  const r = n.skillRegistry;
  if (!r) return [];
  const declared = r.truncated?.referenced ?? r.entries.length;
  // What `get_skill_registry` will actually return. It caps at REGISTRY_MAX too,
  // so promising "alle" beside a larger declared number points at a tool that
  // cannot keep the promise — the bound belongs next to the number it bounds.
  const reach = r.truncated
    ? `die ersten ${r.truncated.listed} mit get_skill_registry`
    : 'vollständig mit get_skill_registry';
  const shown = r.entries.slice(0, REGISTRY_LINES_MAX);
  const lines = [
    `Skill-Registry: ${r.title || '(ohne Titel)'} (nodeId: ${r.nodeId}) — `
    + `${declared} freigegebene Skills, ${reach}`,
  ];
  for (const e of shown) lines.push(`  Skill: ${e.title} (nodeId: ${e.nodeId}) — laden mit get_skill`);
  if (declared > shown.length) lines.push(`  … und ${declared - shown.length} weitere`);
  return lines;
}

/**
 * One line telling a model that a collection MAY declare approved skills, and
 * when it is worth finding out. Emitted once per answer, not per collection.
 *
 * Everything about this sentence follows from one constraint: **nothing has been
 * read**. The search does not look a registry up — measured 2026-08-10 at
 * ~1.0–1.4 s per search, paid through the `/children` call whether or not a
 * registry exists — so this line cannot claim one is there. An earlier draft
 * said "Skills für diese Sammlung", which is an existence claim over data nobody
 * fetched; with today's staging (no collection has a registry yet) it would be
 * wrong essentially every time, and a model may report it to a user before
 * checking.
 *
 * So it says three things and no more: that the answer is UNKNOWN, HOW to get
 * it, and WHEN that is worth a round-trip. The third is what keeps it from
 * becoming noise — without an occasion, a hint that fires on every collection
 * listing gets learned as decoration and ignored.
 *
 * Once per ANSWER, because the sentence is identical for every collection and
 * the ids are all in the same block anyway — and "answer" is not the same as
 * "list". `search_wlo_all` renders three lists into one answer and topic pages
 * are `ccm:map`, so a hint emitted per list fired twice; `get_related_content`
 * renders two. Which is why this is exported: a composed answer suppresses the
 * per-list hint (`renderToText`'s `registryHint: false`) and calls this once
 * over the union.
 */
export function registryHintFor(nodes: FormattedNode[]): string[] {
  // Only when at least one collection has NOT already answered the question.
  // Under the (opt-in) search enrichment a collection carries its registry, and
  // repeating "not checked" beside the check would be plainly false.
  const unanswered = nodes.some(n => n.nodeType === 'collection' && !n.skillRegistry);
  if (!unanswered) return [];
  return ['Hinweis: Ob eine Sammlung eigene Arbeitsanleitungen („Skills") freigegeben hat, '
    + 'ist hier nicht geprüft — viele führen keine. `get_skill_registry` mit ihrer nodeId '
    + 'beantwortet es, und lohnt sich, wenn es um das Vorgehen MIT einer Sammlung geht '
    + '(„wie arbeite ich damit", „was ist hier vorgesehen") statt um ihre Inhalte.'];
}

/**
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
    parts.push(`nodeId: ${n.nodeId}`);
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
    if (n.publisher)                   parts.push(`Anbieter: ${n.publisher}`);
    if (n.topicPageUrl)                parts.push(`Themenseite: ${n.topicPageUrl}`);
    if (n.compendiumText)              parts.push(`Kompendium: ${n.compendiumText.slice(0, 500)}${n.compendiumText.length > 500 ? '…' : ''}`);
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
