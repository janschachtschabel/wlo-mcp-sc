/**
 * formatter.ts – Extract and clean WLO node properties into a structured output.
 */

import type { WloNode } from './wlo-api.js';
import { buildTopicPageUrl } from './wlo-api.js';
import { labelFromUri, type VocabKey } from './vocabs.js';
import { nodeTitle } from './node-match.js';

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
/**
 * The `nodeId:` line, saying when the id names a REFERENCE rather than a record.
 *
 * Both ids are stated, because both are needed and for different things: either
 * one loads the material, only the original may be written to, and only the
 * original resolves a skill's companion files without a second lookup.
 *
 * Shared rather than repeated: the skill tools have rendered this sentence since
 * before ordinary results could, and one wording for one fact is the point — a
 * caller should not have to learn that "(Verknüpfung; Original: …)" and some
 * second phrasing mean the same thing.
 *
 * `originalId` equal to `nodeId` is treated as no reference at all. Search
 * results carry the DTO field, which is simply absent on an original, while the
 * skill catalogue derives its own from `ccm:original`, which points at the
 * record itself. One rule absorbs both.
 */
export function nodeIdLine(nodeId: string, originalId?: string): string {
  return originalId && originalId !== nodeId
    ? `nodeId: ${nodeId} (Verknüpfung; Original: ${originalId})`
    : `nodeId: ${nodeId}`;
}

function headingFor(title: string, url: string): string {
  const text = title.replace(/[[\]]/g, '\\$&');
  if (!url) return `## ${text}`;
  const target = url.replace(/</g, '%3C').replace(/>/g, '%3E');
  return `## [${text}](<${target}>)`;
}


/**
 * What a skill catalogue is NOT: the instructions.
 *
 * Every listing surface hands over titles and nodeIds — a name for a procedure,
 * never the procedure. The failure that costs is a model answering FROM the
 * catalogue: "Fragen generieren" reads like a step that arrived when it is the
 * label of one nobody fetched, and the answer then invents what the SKILL.md
 * would have said. So the sentence names both halves, the tool and what it needs,
 * because a pointer without the nodeId is a step a model cannot take.
 *
 * Shared rather than written per surface: three of them list a catalogue, two
 * already carried near-identical closing pointers of their own and the third had
 * none. Which surfaces may use it is a property of the TIER, not of the caller —
 * see `registrySummaryLines`, where a head-line-only listing prints no skill
 * nodeId and therefore promises no load. Pinned by
 * `tests/shared-rule-discipline.test.ts`.
 *
 * It says what the listing is NOT and never what it holds, because the two
 * surfaces hold different things: a node's catalogue carries title and nodeId
 * only (descriptions cost a read per skill and stay with `get_skill_registry`),
 * that tool's carries descriptions and keywords too. A first draft named the
 * fields — "nur Titel und Beschreibungen" — and was therefore false on the
 * surface that shows the most of them, which is the one a search answer renders.
 *
 * And it rules out the two ids standing beside the right one. Naming the tool is
 * not enough where THREE nodeIds are in view: a rendered collection carries its
 * own on the record line, the registry document's on the head line and the
 * skill's on its entry — and the one nearest the note is the registry's. Both
 * wrong picks fail usefully (`get_skill` on a registry hands back the approval
 * list, on a collection nothing), but a model that reads an approval list as an
 * instruction has been handed a document that looks like the thing it asked for.
 *
 * "einer Registry oder Sammlung", not "der": `search_skill`'s catalogue holds
 * neither, so the definite article would point at things its answer does not
 * show. The indefinite one states a rule instead, which is true on all three.
 */
export const DESCRIPTIONS_ONLY_NOTE =
  'Das ist nur die Übersicht — die Anleitungen selbst stehen nicht darin. '
  + 'Die Anleitung (SKILL.md) lädt `get_skill` mit der nodeId des gewünschten Skills, '
  + 'nicht mit der einer Registry oder Sammlung.';

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
  return n.skillRegistry ? registrySummaryLines(n.skillRegistry) : [];
}

/**
 * Lines a catalogue may spend inside a RESULT.
 *
 * Replaces `REGISTRY_LINES_MAX` (100), which was not a budget at all: a registry
 * of sixty skills wrote sixty lines into EVERY collection hit. Measured against
 * the real Optik registry on 2026-08-18, that was ~3330 characters per
 * collection, of which 1008 were bare UUIDs — and those UUIDs bought exactly one
 * thing, calling `get_skill` directly, i.e. skipping the step the note three
 * lines below tells the reader not to skip.
 *
 * One number, three forms, and the degradation is MONOTONE: the bigger the
 * registry, the shorter its block gets — never longer. Twelve is where a list
 * stops being scannable and still sits under the cost of one extra round trip.
 *
 * Not shared with `REGISTRY_SEARCH_MAX`: that bounds what the SERVICE hands over
 * (and `get_skill_registry` still shows all of it), this bounds what a search
 * result prints. They answer different questions and may move apart.
 */
export const REGISTRY_INLINE_MAX = 12;

/**
 * Names, several per line, `·`-separated.
 *
 * One line each would make the context index cost as much as the list it
 * replaces. A name longer than the width gets its own line rather than being
 * split — half a context name is a name nobody can pass back.
 */
function packNames(names: string[], width = 100): string[] {
  const out: string[] = [];
  let cur = '';
  for (const name of names) {
    const next = cur ? `${cur} · ${name}` : name;
    if (cur && next.length > width) { out.push(cur); cur = name; }
    else cur = next;
  }
  if (cur) out.push(cur);
  return out;
}

/**
 * The same catalogue, for a registry `renderToText` will not render itself.
 *
 * Two kinds of caller need it, and no count is given here because one goes
 * stale: tools that are ABOUT a collection they never return (via
 * `subjectRegistryText`), and tools that render their own line-oriented format
 * instead of `renderToText`. ONE rule for what a catalogue looks like and which
 * caps it discloses; a copy per caller would drift on `truncated`, the
 * disclosure a reader cannot notice missing.
 *
 * Three forms, chosen by `REGISTRY_INLINE_MAX`:
 *
 * 1. **grouped/flat with nodeIds** — the whole thing fits.
 * 2. **context index** — too many to list, few enough to NAME. No skill nodeId
 *    is printed, so nothing here promises a load. Names, not just a count,
 *    because without a name nobody can ask for one context.
 * 3. **head line alone** — not even the names fit. Then the count and the tool
 *    are the honest answer.
 *
 * @param opts.entries `false` for the head line alone — where a tool renders one
 *   block per node and a hundred skills under each would destroy the shape it
 *   exists for. It may name the context COUNT, never the names: thirty portals
 *   with seven names each is the same wall by another route.
 */
export function registrySummaryLines(
  r: NonNullable<FormattedNode['skillRegistry']>,
  opts: { entries?: boolean; described?: boolean; narrowed?: boolean } = {},
): string[] {
  const declared = r.truncated?.referenced ?? r.entries.length;
  const contexts = r.contexts ?? [];
  const general = r.entries.filter(e => !e.context);
  const packed = contexts.length
    ? packNames(contexts.map(c => oneLine(`${c.path} (${c.skills})`)))
    : [];

  // Grouped costs one line per context, one per entry, one for the always-block.
  const groupedCost = contexts.length + r.entries.length + (contexts.length && general.length ? 1 : 0);
  const form: 'full' | 'index' | 'head' =
    opts.entries === false ? 'head'
      : groupedCost <= REGISTRY_INLINE_MAX ? 'full'
        : contexts.length && packed.length <= REGISTRY_INLINE_MAX ? 'index'
          : 'head';

  // What the head line offers, and it must be true of the form BELOW it.
  //
  // full/uncapped: the whole catalogue is here, so pointing at the tool for
  //   completeness sends a model on a round-trip for what it was just handed —
  //   what that tool adds is depth per entry.
  // full/capped: both tiers carry the same 100, so the tool cannot show MORE
  //   entries. What still names the rest is the document, returned verbatim.
  // index: the names are here, the skills are one targeted call away.
  // head: nothing is listed, so the tool IS the listing.
  let reach: string;
  if (form === 'index') {
    reach = 'Skills und Anleitung je Kontext mit get_skill_registry und context:"<Name>"';
  } else if (form === 'head') {
    reach = 'auflisten mit get_skill_registry';
  } else if (r.truncated) {
    reach = `hier die ersten ${r.truncated.listed}; die übrigen nennt nur das Registry-Dokument selbst `
      + '(get_skill_registry gibt es unverändert aus)';
  } else if (opts.described) {
    // The caller already put the descriptions AND the editors' instruction in
    // this answer (the named-context path of `subjectRegistryText`). Offering
    // them as what the tool adds sends a model back for what it is holding;
    // what is genuinely still there is the keywords and the document itself.
    reach = 'alle hier gelistet; Schlagworte und das Registry-Dokument mit get_skill_registry';
  } else {
    reach = 'alle hier gelistet; Beschreibungen und Redaktionshinweise mit get_skill_registry';
  }
  // A short form still owes the capped disclosure — it is the only sign that the
  // service dropped entries, and the tool cannot make them up either.
  if (form !== 'full' && r.truncated) {
    reach += '; die übrigen nennt nur das Registry-Dokument selbst';
  }

  // Suppressed on a NARROWED answer: `contexts` then holds the one context that
  // matched, so the number would be the view's while the sentence reads as a
  // claim about the registry — and that answer names its context in its opening
  // line anyway. The singular is spelled out because „in 1 Kontexten" is wrong
  // German and a registry with exactly one context is ordinary.
  const outline = opts.narrowed || !contexts.length
    ? ''
    : ` in ${contexts.length} ${contexts.length === 1 ? 'Kontext' : 'Kontexten'}`;
  const lines = [
    `Skill-Registry: ${r.title || '(ohne Titel)'} (nodeId: ${r.nodeId}) — `
    + `${declared} freigegebene Skills${outline}, ${reach}`,
  ];

  const entryLine = (e: { nodeId: string; title: string }, indent: string) =>
    `${indent}Skill: ${e.title} (nodeId: ${e.nodeId}) — laden mit get_skill`;

  if (form === 'index') {
    for (const line of packed) lines.push(`  Kontexte: ${line}`);
    return lines;
  }
  if (form === 'head') return lines;

  if (!contexts.length) {
    for (const e of r.entries) lines.push(entryLine(e, '  '));
  } else {
    const shown = new Set<string>();
    for (const c of contexts) {
      lines.push(oneLine(`  Kontext: ${c.path} (${c.skills})`));
      for (const e of r.entries.filter(x => x.context === c.path)) {
        lines.push(entryLine(e, '    '));
        shown.add(e.nodeId);
      }
    }
    // Everything the groups did not take. In this form that is exactly the
    // context-free skills — a context past `REGISTRY_CONTEXT_MAX` would leave
    // orphans, but fifty contexts never reach the grouped form.
    const rest = r.entries.filter(e => !shown.has(e.nodeId));
    if (rest.length) {
      lines.push(`  Ohne Kontext — gilt immer (${rest.length})`);
      for (const e of rest) lines.push(entryLine(e, '    '));
    }
  }
  // Suppressed entries are not "left out": the head line already offers the
  // listing, so counting them off again would read as a second, unreachable
  // remainder.
  if (declared > r.entries.length) lines.push(`  … und ${declared - r.entries.length} weitere`);
  // Only where a skill nodeId was actually printed. Forms 2 and 3 list none (and
  // an empty catalogue has nothing to list), so the note would point at ids the
  // answer does not carry — a listing that promises a step its own content
  // cannot support is worse than one that promises none.
  //
  // Indented with the entries it closes. Flush left it lands between the last
  // skill and the node's own `Typ:` line, where "das ist nur die Übersicht"
  // reads as a statement about the RECORD rather than about the catalogue.
  if (r.entries.length) lines.push(`  ${DESCRIPTIONS_ONLY_NOTE}`);
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
