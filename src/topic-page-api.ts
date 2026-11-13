/**
 * topic-page-api.ts – Themenseiten (page_variant / page_config) DISCOVERY.
 *
 * Finding topic pages in the repository lives here: searching page variants,
 * finding collections that own one, resolving a variant back to its owning
 * collection, and listing a collection's theme pages. Parsing what a page
 * SHOWS is `topic-page-structure.ts`; generic node/search access stays in
 * `wlo-api.ts`.
 */

import { sharedReadScope } from './auth/credential.js';
import { collectionTitleFromProperties } from './node-match.js';
import { shortCache } from './short-cache.js';
import type { SearchCriterion, WloNode } from './wlo-api.js';
import {
  BASE_URL,
  WLO_ROOT_COLLECTION_ID,
  appendPropertyFilter,
  buildTopicPageUrl,
  getChildCollectionsResult,
  getNodeMetadata,
  readNodeMetadata,
  stripStoreRef } from './wlo-api.js';
import { orderVariants, parsePageConfigOrder, readPageConfigOrder } from './topic-page-config.js';
import type { PageConfigOrder } from './topic-page-config.js';
import { HEADERS, wloFetch } from './wlo-fetch.js';
import { upstreamErrorMessage } from './upstream-error.js';
import { readJson } from './read-json.js';
import { nodeMatchesText } from './node-match.js';
import {
  TOPIC_PAGE_PROPS,
  isUsableVariant,
  variantFields,
  variantMatchesFilters } from './topic-page-variant.js';
import type { ThemePageInfo, VariantFilters } from './topic-page-variant.js';


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
  // THROWS rather than degrading (audit 2026-11-12, K-3), like `ngsearch`: this
  // is the primary read of the listing it serves, and `[]` there was reported as
  // "es gibt keine Themenseiten" — a statement about the catalogue made from an
  // index that did not answer.
  if (!res.ok) throw new Error(upstreamErrorMessage('searchPageVariants', res));
  const data = await readJson<{ nodes?: WloNode[] }>(res, 'searchPageVariants');
  if (!data) throw new Error('searchPageVariants: upstream response was not valid JSON');
  return data.nodes ?? [];
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
  return (await searchTopicPageCollectionsResult(query, maxItems)).nodes;
}

/**
 * The subject portals, remembered for a minute.
 *
 * Almost every search asked for this list again — a hundred collections with
 * their full display projection — to match a handful of names against it
 * (audit 2026-11-12, P-4). Which portals exist changes when an editor creates
 * one, so a minute-old list is the same list. Only a listing that ANSWERED is
 * kept; the projection is left as it was, because the nodes go on into search
 * results and the local match reads more than their titles.
 */
const portalCache = shortCache<WloNode[]>(4);

async function portalListing(): Promise<{ nodes: WloNode[]; reachable: boolean }> {
  // Keyed by whose rights read it; a personal login's listing is not shared.
  const scope = sharedReadScope();
  const key = `${scope}:${WLO_ROOT_COLLECTION_ID}`;
  const kept = scope ? portalCache.get(key) : undefined;
  if (kept) return { nodes: kept, reachable: true };
  const portals = await getChildCollectionsResult(WLO_ROOT_COLLECTION_ID, 100);
  if (scope && portals.reachable) portalCache.set(key, portals.nodes);
  return portals;
}

/** `searchTopicPageCollections`, saying whether the portal listing ANSWERED. */
export async function searchTopicPageCollectionsResult(
  query: string, maxItems = 10,
): Promise<{ nodes: WloNode[]; reachable: boolean }> {
  const q = query.trim();
  if (!q) return { nodes: [], reachable: true };
  const portals = await portalListing();
  return {
    reachable: portals.reachable,
    nodes: portals.nodes
      .filter(n => n.properties?.['ccm:page_config_ref']?.[0] && nodeMatchesText(n, q))
      .slice(0, maxItems),
  };
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
// `cm:title` is the carrier a collection's title actually lives in — without it in the projection the owner was named by its technical `cm:name`.
const OWNER_PROPS: string[] = ['ccm:page_config_ref', 'cclom:title', 'cm:title', 'cm:name'];

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
      name: collectionTitleFromProperties(props) || owner?.name || '',
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
  const { node, status } = await readNodeMetadata(collectionId, OWNER_PROPS);
  if (!node) {
    // Gone or not ours to read: a real "no page here". Anything else — a 5xx, a
    // synthetic 503, no answer at all — is "we did not find out", and `[]` there
    // was printed as "Keine Themenseiten gefunden." (review of audit package 9).
    if (status === 404 || status === 403 || status === 401) return [];
    throw new Error(`Die Sammlung ${collectionId} ließ sich nicht lesen (HTTP ${status}) — ob sie eine Themenseite hat, ist offen.`);
  }

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
  const listing = await getChildCollectionsResult(configId, 50, 0, TOPIC_PAGE_PROPS);
  if (!listing.reachable) {
    throw new Error(`Die Varianten der Themenseite von ${collectionId} ließen sich nicht lesen — ob sie eine hat, ist offen.`);
  }
  const configChildren = listing.nodes;
  const collectionName = collectionTitleFromProperties(props) || node.name || '';
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
      ...variantFields(variant),
      topicPageUrl,
      collectionId,
      collectionName,
      isDefault: index === 0,
    });
  }
  return out;
}

