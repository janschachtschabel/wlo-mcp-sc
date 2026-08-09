/**
 * topic-page-api.ts – Themenseiten (page_variant / page_config) DISCOVERY.
 *
 * Finding topic pages in the repository lives here: searching page variants,
 * finding collections that own one, resolving a variant back to its owning
 * collection, and listing a collection's theme pages. Parsing what a page
 * SHOWS is `topic-page-structure.ts`; generic node/search access stays in
 * `wlo-api.ts`.
 */

import type { SearchCriterion, WloNode } from './wlo-api.js';
import {
  BASE_URL,
  DISPLAY_PROPS,
  WLO_ROOT_COLLECTION_ID,
  appendPropertyFilter,
  buildTopicPageUrl,
  getChildCollections,
  getNodeMetadata,
  stripStoreRef,
} from './wlo-api.js';
import { orderVariants, parsePageConfigOrder, readPageConfigOrder } from './topic-page-config.js';
import type { PageConfigOrder } from './topic-page-config.js';
import { HEADERS, wloFetch, logUpstreamMiss } from './wlo-fetch.js';
import { readJson } from './read-json.js';
import { nodeMatchesText } from './node-match.js';
import { displayTitleOrEmpty } from './topic-page-title.js';

// Topic-page variants additionally need the page_variant fields
// (template flag, target group, swimlane config). Exported because
// `topic-page-structure.ts` reads the same projection off the config folder.
export const TOPIC_PAGE_PROPS: string[] = [
  ...DISPLAY_PROPS,
  'ccm:page_variant_is_template',
  'ccm:page_variant_profiling_target_group',
  'ccm:page_variant_config',
];

export type TargetGroup = 'teacher' | 'learner' | 'general';

/**
 * The two profiling filters a caller may narrow a Themenseiten listing with.
 * `educationalContext` is a RESOLVED vocabulary URI, never a label — the
 * label→URI mapping happens in the tool layer.
 */
export interface VariantFilters {
  targetGroup?: TargetGroup;
  educationalContext?: string;
}

/**
 * Does this page variant survive the caller's filters?
 *
 * **A variant that carries no value is never excluded.** Measured 2026-08-07
 * against both instances: 98 of 109 non-template variants on production have no
 * `ccm:page_variant_profiling_target_group` and 97 have no
 * `ccm:educationalcontext` (staging: 49 and 45 of 68). Treating "unset" as a
 * mismatch — which is what handing these fields to the search does, since the
 * ES query can only match a present value — hides nine Themenseiten out of ten.
 * See `docs/plans/2026-08-07-topic-page-variants-analysis.md` §1.
 *
 * This is the ONE place the rule lives, so the listing modes cannot drift apart
 * again: Mode C used to filter upstream while Modes A/B filtered here, and the
 * same `targetGroup` therefore produced two different result sets.
 */
export function variantMatchesFilters(
  props: Record<string, string[] | undefined>,
  filters: VariantFilters,
): boolean {
  const tg = props['ccm:page_variant_profiling_target_group']?.[0];
  if (filters.targetGroup && tg && tg !== filters.targetGroup) return false;
  const contexts = props['ccm:educationalcontext'] ?? [];
  if (filters.educationalContext && contexts.length && !contexts.includes(filters.educationalContext)) return false;
  return true;
}

export interface ThemePageInfo {
  variantId: string;
  variantName: string;
  /**
   * Human-readable label of the page-variant node itself, from `cclom:title`
   * — e.g. "Fachportalstartseite", "Vorlage: Themenseite". Distinct from
   * `variantName`, which holds the auto-generated technical `cm:name`
   * ("PAGE_VARIANT_<uuid>"). Used as a display fallback when the owning
   * collection can't be resolved, so the UI never shows the raw
   * PAGE_VARIANT/UUID string.
   *
   * `cm:title` is deliberately NOT a fallback: it carries that same technical
   * string on 109 of 109 production variants (measured 2026-08-07), so falling
   * back to it replaces "no label" with a UUID that only looks like one.
   */
  variantTitle?: string;
  targetGroup: string;
  educationalContexts: string[];
  isTemplate: boolean;
  topicPageUrl: string;
  collectionId?: string;
  collectionName?: string;
  /**
   * True for the variant the page actually renders: `ccm:page_config.default`
   * of its page-config folder, or the first still-existing entry of that
   * document's `variants[]` when no default is recorded (`readPageConfigOrder`).
   *
   * A collection can own SEVERAL page-config folders while its own
   * `ccm:page_config_ref` names the active one, so this additionally requires
   * the variant to sit in THAT folder. Variants of a superseded folder are still
   * listed — dropping them would lose the pages whose only folder is superseded
   * — they are simply never the rendered one.
   */
  isDefault?: boolean;
}

/**
 * POST /search/v1/queries/-home-/mds_oeh/page_variant
 * Search for page_variant nodes (Themenseiten-Varianten).
 *
 * The ONLY criterion sent is the template flag. The profiling fields are
 * deliberately NOT passed — they are ~90 % unpopulated, so filtering upstream
 * hides pages rather than narrowing them (see `variantMatchesFilters`).
 * `ccm:page_variant_is_template` is the one flag that is reliably set;
 * `virtual:page_variant_global` is not an alternative — its MDS statement only
 * exists for the value `"true"`, so `["false"]` filters nothing at all
 * (measured 2026-08-07: identical counts to sending no criterion).
 *
 * Does NOT support full-text search: `ngsearchword` is accepted and matches
 * zero nodes on both instances, and no title parameter exists at all.
 *
 * `withinCollectionId` scopes the search to a collection SUBTREE via
 * `virtual:parent_recursive`. That field takes exactly ONE value — passing two
 * is refused with `InvalidParameterException: … non-multivalue field` — so a
 * set of candidate collections cannot be batched into one query.
 */
export async function searchPageVariants(
  options: {
    isTemplate?: boolean;
    withinCollectionId?: string;
  } = {},
  maxItems = 50,
): Promise<WloNode[]> {
  const criteria: SearchCriterion[] = [];
  criteria.push({
    property: 'ccm:page_variant_is_template',
    values: [String(options.isTemplate ?? false)],
  });
  if (options.withinCollectionId) {
    criteria.push({
      property: 'virtual:parent_recursive',
      values: [options.withinCollectionId],
    });
  }

  const params = new URLSearchParams({
    contentType: 'ALL',
    maxItems: String(maxItems),
    skipCount: '0',
  });
  appendPropertyFilter(params, TOPIC_PAGE_PROPS);
  const url = `${BASE_URL}/search/v1/queries/-home-/mds_oeh/page_variant?${params}`;
  const body = JSON.stringify({ criteria });
  const res = await wloFetch(url, { method: 'POST', headers: HEADERS, body });
  if (!res.ok) { logUpstreamMiss('searchPageVariants', res); return []; }
  const data = await readJson<{ nodes?: WloNode[] }>(res, 'searchPageVariants');
  return data?.nodes ?? [];
}

/**
 * Collections that HAVE a Themenseite, matched locally against the query.
 *
 * Needed because the keyword-collections endpoint cannot surface them
 * (live-verified 2026-07-17): it returns a FIXED reduced projection without
 * ``ccm:page_config_ref``, and the top-level subject portals — the collections
 * that actually carry Themenseiten — do not appear in its hits at all. The
 * root ``/children`` projection DOES include the config ref, so one bounded
 * call plus a local text match finds them.
 */
export async function searchTopicPageCollections(query: string, maxItems = 10): Promise<WloNode[]> {
  const q = query.trim();
  if (!q) return [];
  const portals = await getChildCollections(WLO_ROOT_COLLECTION_ID, 100);
  return portals
    .filter(n => n.properties?.['ccm:page_config_ref']?.[0] && nodeMatchesText(n, q))
    .slice(0, maxItems);
}

/** The collection that owns a Themenseite, as resolved from a page variant. */
export interface TopicPageOwner {
  id: string;
  name: string;
  /**
   * The owner's own (active) `ccm:page_config_ref`, carried out of the read
   * that already had to check it to identify this node as an owner — so the
   * caller needs no further metadata fetch (Mode-C latency, 2026-07-27).
   */
  pageConfigRef: string;
}

/** Enough to hop one level up the containment chain. */
const PARENT_REF_PROPS: string[] = ['virtual:primaryparent_nodeid'];

/**
 * What a page-config FOLDER is read for: who owns it, and which of its variants
 * the page renders. Both live on the same node, so they cost one request
 * together — asking separately was an avoidable round-trip per topic page.
 */
const FOLDER_PROPS: string[] = ['virtual:primaryparent_nodeid', 'ccm:page_config'];

/** The only fields read off the owning collection. */
const OWNER_PROPS: string[] = ['ccm:page_config_ref', 'cclom:title', 'cm:name'];

/** One containment hop: the node's primary parent id, or '' when unavailable. */
async function primaryParentOf(nodeId: string): Promise<string> {
  const node = await getNodeMetadata(nodeId, PARENT_REF_PROPS);
  return stripStoreRef(node?.properties?.['virtual:primaryparent_nodeid']?.[0]);
}

/** One page-config folder, fully resolved: its owning collection and its variant order. */
export interface ResolvedPageFolder {
  owner: TopicPageOwner | null;
  config: PageConfigOrder;
}

/**
 * Read a page-config folder and the collection above it — two `/metadata` reads,
 * deliberately NOT `/parents`: that endpoint answers 500 (AccessDeniedException)
 * for anonymous callers on page-config folders, so every walk returned an empty
 * chain — no collection title, no topic-page URL — while costing ~1.1 s each.
 * `/metadata` works anonymously at ~0.19 s (live-verified 2026-07-27 against
 * production).
 */
export async function resolvePageFolder(folderId: string): Promise<ResolvedPageFolder> {
  const folder = await getNodeMetadata(folderId, FOLDER_PROPS);
  const config = parsePageConfigOrder(folder?.properties?.['ccm:page_config']?.[0]);
  const ownerId = stripStoreRef(folder?.properties?.['virtual:primaryparent_nodeid']?.[0]);
  if (!ownerId) return { owner: null, config };

  const owner = await getNodeMetadata(ownerId, OWNER_PROPS);
  const props = owner?.properties ?? {};
  // Carrying `ccm:page_config_ref` at all is what makes this collection a
  // Themenseite owner. It is deliberately NOT compared against `folderId`: a
  // collection may hold several page-config folders while its own ref names
  // only the ACTIVE one (5 of 25 sampled pages), and requiring a match would
  // drop those pages entirely. The owner's own ref is the right one to carry
  // forward — it points at the page that is actually published.
  if (!props['ccm:page_config_ref']?.length) return { owner: null, config };
  return {
    owner: {
      id: ownerId,
      name: props['cclom:title']?.[0] ?? props['cm:name']?.[0] ?? owner?.name ?? '',
      pageConfigRef: props['ccm:page_config_ref'][0] ?? '',
    },
    config,
  };
}

/**
 * Resolve a page-variant node back to its owning collection, hopping
 * variant → page_config folder → collection via `virtual:primaryparent_nodeid`.
 * Returns the owner or null.
 *
 * The extra hop is the whole point: this is the path for a variant whose own
 * `virtual:primaryparent_nodeid` is missing from the search projection. When the
 * folder IS known, callers use `resolvePageFolder` directly and skip this read —
 * a page variant lives under exactly one page-config folder, so the known
 * primary parent is authoritative.
 */
export async function resolveVariantCollection(variantId: string): Promise<TopicPageOwner | null> {
  const folderId = await primaryParentOf(variantId);
  if (!folderId) return null;
  return (await resolvePageFolder(folderId)).owner;
}

/**
 * Given a collection nodeId, check if it has ccm:page_config_ref and resolve
 * the theme page variants underneath it.
 * Returns an array of ThemePageInfo with variant details.
 */
export async function getCollectionThemePages(
  collectionId: string,
  filters: VariantFilters = {},
): Promise<ThemePageInfo[]> {
  // Only the owner fields are read below, and this runs once per candidate on
  // the Mode-B hot path — no reason to pull the full `-all-` projection.
  const node = await getNodeMetadata(collectionId, OWNER_PROPS);
  if (!node) return [];

  const props = node.properties ?? {};
  const pageConfigRef = props['ccm:page_config_ref']?.[0];
  if (!pageConfigRef) return [];

  const configId = stripStoreRef(pageConfigRef);

  // The page VARIANTS are the DIRECT children of the config folder: they
  // THEMSELVES carry ``ccm:page_variant_config`` (live-verified 2026-07-17;
  // mirrors getTopicPageContent below). Reading the children's CONTENTS
  // instead — the previous behaviour — hit WIDGET_* nodes without variant
  // metadata (wrong variantId, targetGroup "nicht gesetzt"). Reading one
  // level also drops the per-child fan-out (one upstream call instead of N).
  const configChildren = await getChildCollections(configId, 50, 0, TOPIC_PAGE_PROPS);
  const collectionName = props['cclom:title']?.[0] || props['cm:name']?.[0] || node.name || '';
  const topicPageUrl = buildTopicPageUrl(collectionId, pageConfigRef) ?? '';

  const real = configChildren.filter(v => isUsableVariant(v));
  // The order the page builder keeps — only worth a round-trip when there is
  // actually a choice to make. 93 of 99 production pages carry exactly one
  // variant, so this extra read fires on ~6 % of pages instead of all of them.
  const ordered = real.length > 1
    ? orderVariants(real, await readPageConfigOrder(configId))
    : real;

  const out: ThemePageInfo[] = [];
  for (const [index, variant] of ordered.entries()) {
    const vProps = variant.properties ?? {};
    if (!variantMatchesFilters(vProps, filters)) continue;

    out.push({
      variantId: variant.ref?.id ?? '',
      variantName: vProps['cm:name']?.[0] || variant.name || '',
      // Checked, not trusted: `cclom:title` carries the technical
      // `PAGE_VARIANT_<uuid>` string on 22 of 68 staging variants. Empty lets
      // `pickThemePageTitle` fall through to the collection name.
      variantTitle: displayTitleOrEmpty(vProps['cclom:title']?.[0]),
      // Empty, not a German placeholder: this is the machine field. The
      // "nicht gesetzt" wording belongs to `targetGroupLabel`, which the
      // presentation layer derives — emitting it here made an unset value look
      // set to any consumer comparing against ''.
      targetGroup: vProps['ccm:page_variant_profiling_target_group']?.[0] || '',
      educationalContexts: vProps['ccm:educationalcontext'] ?? [],
      isTemplate: false,
      topicPageUrl,
      collectionId,
      collectionName,
      isDefault: index === 0,
    });
  }
  return out;
}

/** A real, selectable page variant: configured, and not a template. */
export function isUsableVariant(node: WloNode): boolean {
  const p = node.properties ?? {};
  return !!p['ccm:page_variant_config']?.[0] && p['ccm:page_variant_is_template']?.[0] !== 'true';
}

