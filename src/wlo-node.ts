/**
 * wlo-node.ts – edu-sharing node endpoints + node URL builders.
 *
 * Children (files / sub-collections), single/bulk metadata, stored text and
 * anonymous file download, the parents/breadcrumb chain, and the URL builders
 * (topic-page, in-repo render, download). Uses the shared `wloFetch` +
 * `propertyFilter` helpers and config from `wlo-config`.
 */

import { BASE_URL, DISPLAY_PROPS, WLO_REPOSITORY_URL, appendPropertyFilter } from './wlo-config.js';
import { wloFetch, logUpstreamMiss } from './wlo-fetch.js';
import { readJson } from './read-json.js';
import type { SearchResponse, WloNode } from './wlo-types.js';
import { log } from './logger.js';
import { nodeTitle } from './node-match.js';

/**
 * Build the topic-pages URL for a collection that has ccm:page_config_ref.
 * Returns null if pageConfigRef is falsy.
 */
export function buildTopicPageUrl(
  collectionId: string,
  pageConfigRef?: string | null,
): string | null {
  if (!pageConfigRef) return null;
  return `${WLO_REPOSITORY_URL}/components/topic-pages?collectionId=${encodeURIComponent(collectionId)}`;
}

/**
 * Build the in-repo viewer URL (``/components/render/<id>``) for a node.
 * Used by ``get_node_details`` to expose a stable permalink.
 */
export function buildRenderUrl(nodeId: string): string {
  return `${WLO_REPOSITORY_URL}/components/render/${encodeURIComponent(nodeId)}`;
}

/** The prefix edu-sharing puts in front of a node id inside a property value. */
const STORE_REF_PREFIX = 'workspace://SpacesStore/';

/** Strip the `workspace://SpacesStore/` store-ref prefix from a node reference. */
export function stripStoreRef(s: string | undefined): string {
  return (s ?? '').replace(STORE_REF_PREFIX, '');
}

/**
 * The inverse: the form a node id takes INSIDE a property value.
 *
 * Reading strips the prefix everywhere, so every id this project passes around is
 * bare — but a value written back has to carry it again (measured 2026-08-09:
 * 28/28 `ccm:page_config` documents on staging store variants as full store
 * refs). Idempotent, so a caller that already holds a ref is safe.
 */
export function toStoreRef(id: string | undefined): string {
  const bare = stripStoreRef(id);
  return bare ? `${STORE_REF_PREFIX}${bare}` : '';
}

/**
 * GET /node/v1/nodes/-home-/{nodeId}/children
 * filter: 'files' → contents, 'folders' → sub-collections, undefined → both
 */
export async function getCollectionContents(
  nodeId: string,
  filter: 'files' | 'folders' | 'both' = 'files',
  maxItems = 30,
  skipCount = 0,
  props: string[] | undefined = DISPLAY_PROPS,
): Promise<SearchResponse> {
  const params = new URLSearchParams({
    maxItems: String(maxItems),
    skipCount: String(skipCount),
  });
  if (filter !== 'both') params.set('filter', filter);
  appendPropertyFilter(params, props);

  const url = `${BASE_URL}/node/v1/nodes/-home-/${encodeURIComponent(nodeId)}/children?${params}`;
  const res = await wloFetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`getCollectionContents failed: ${res.status} ${res.statusText}`);

  // Throws rather than degrading, unlike getChildCollections below: this is the
  // PRIMARY read of a browse call, and a silently empty page is indistinguishable
  // from a genuinely empty collection.
  const data = await readJson<{ nodes?: WloNode[]; pagination?: SearchResponse['pagination'] }>(
    res, 'getCollectionContents',
  );
  if (!data) throw new Error('getCollectionContents: upstream response was not valid JSON');
  return {
    nodes: data.nodes ?? [],
    pagination: data.pagination ?? { total: 0, from: 0, count: 0 },
  };
}

/** A sub-collection listing plus whether the repository actually answered it. */
export interface ChildCollectionsResult {
  nodes: WloNode[];
  /**
   * False when the listing could not be read (non-OK status, unparseable body).
   * `nodes` is then empty for a reason that has nothing to do with the
   * collection — callers that turn emptiness into a statement must check this.
   */
  reachable: boolean;
}

/**
 * GET /node/v1/nodes/-home-/{nodeId}/children?filter=folders
 * Returns direct sub-collections of a collection node, and whether the listing
 * was readable at all. Same endpoint as getCollectionContents but with
 * filter=folders.
 */
export async function getChildCollectionsResult(
  nodeId: string,
  maxItems = 100,
  skipCount = 0,
  props: string[] | undefined = DISPLAY_PROPS,
): Promise<ChildCollectionsResult> {
  const params = new URLSearchParams({
    filter: 'folders',
    maxItems: String(maxItems),
    skipCount: String(skipCount),
  });
  appendPropertyFilter(params, props);

  const url = `${BASE_URL}/node/v1/nodes/-home-/${encodeURIComponent(nodeId)}/children?${params}`;
  const res = await wloFetch(url, { headers: { Accept: 'application/json' } });
  // Degrades to [] rather than throwing, unlike getCollectionContents above:
  // this is a secondary/navigational read whose absence must not fail the call.
  if (!res.ok) { logUpstreamMiss('getChildCollections', res); return { nodes: [], reachable: false }; }

  const data = await readJson<{ nodes?: WloNode[] }>(res, 'getChildCollections');
  // A body that is not JSON is the same class of failure as a non-OK status:
  // we did not learn what is in this collection.
  return data ? { nodes: data.nodes ?? [], reachable: true } : { nodes: [], reachable: false };
}

/**
 * The same listing as {@link getChildCollectionsResult}, reduced to the nodes.
 *
 * Most callers only navigate and genuinely do not care why a branch is empty.
 * The two that DO care — the "no collections found" message and the per-portal
 * sub-collection count — use the result form, because an empty list from a 503
 * would otherwise be presented as a fact about the catalogue ("this portal has
 * 0 sub-collections", "try a broader term") when it is a fact about the server.
 */
export async function getChildCollections(
  nodeId: string,
  maxItems = 100,
  skipCount = 0,
  props: string[] | undefined = DISPLAY_PROPS,
): Promise<WloNode[]> {
  return (await getChildCollectionsResult(nodeId, maxItems, skipCount, props)).nodes;
}

/**
 * GET /node/v1/nodes/-home-/{nodeId}/metadata
 * Fetch metadata for a single node (FILE or COLLECTION).
 *
 * @param props optional narrow projection; omitted/empty keeps the full
 *   `-all-` set (~59 properties). Pass an explicit list on hot paths that read
 *   only a handful of fields.
 */
export async function getNodeMetadata(
  nodeId: string,
  props?: string[],
): Promise<WloNode | null> {
  return (await readNodeMetadata(nodeId, props)).node;
}

/**
 * The same read, reporting the HTTP status alongside the node.
 *
 * `null` above collapses every non-OK status into one value, so a caller that
 * turns it into a sentence can only say "not found" — and that is the one
 * answer it does not support. A record that is not public refuses its metadata
 * too (measured, see `services/content-text.ts`), so "not found" would tell a
 * teacher the material does not exist when it does; a 503 would say the same
 * about a perfectly healthy record. Use this form wherever the miss becomes
 * text. Same split as `getNodeParents` / `readNodeParents`.
 *
 * `status` is `0` when the body could not be parsed — the request succeeded but
 * we still did not learn anything.
 */
export async function readNodeMetadata(
  nodeId: string,
  props?: string[],
): Promise<{ node: WloNode | null; status: number }> {
  const params = new URLSearchParams();
  appendPropertyFilter(params, props);
  const url = `${BASE_URL}/node/v1/nodes/-home-/${encodeURIComponent(nodeId)}/metadata?${params}`;
  const res = await wloFetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) { logUpstreamMiss('getNodeMetadata', res); return { node: null, status: res.status }; }
  const data = await readJson<{ node?: WloNode }>(res, 'getNodeMetadata');
  return { node: data?.node ?? null, status: data ? res.status : 0 };
}

/**
 * Fetch metadata for multiple node IDs in parallel. Works for ANY node type
 * (files, collections, widgets) — not collections specifically.
 * Uses GET /node/v1/nodes/-home-/{id}/metadata per node.
 *
 * @param props optional narrow projection, applied to EVERY request in the
 *   fan-out. Omitted keeps `-all-` (~59 properties per node), which is right
 *   when the nodes are rendered as content cards and wasteful when the caller
 *   reads one field off each — pass the list on those paths.
 */
export async function getNodesMetadata(
  nodeIds: string[],
  concurrency = 8,
  props?: string[],
): Promise<WloNode[]> {
  if (nodeIds.length === 0) return [];
  // Bounded worker pool (not raw Promise.all) so a large id list — e.g. every
  // widget node across a topic page's swimlanes — cannot open dozens–hundreds of
  // simultaneous upstream sockets. Order is preserved; failed/absent nodes drop.
  const out: (WloNode | null)[] = new Array(nodeIds.length).fill(null);
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < nodeIds.length) {
      const i = next++;
      try {
        out[i] = await getNodeMetadata(nodeIds[i], props);
      } catch (err) {
        // Skip a failed node, keep the rest — but leave a trace: a thrown fetch
        // (timeout/network) would otherwise silently shrink fan-out results.
        out[i] = null;
        log.warn('getNodesMetadata item failed', {
          nodeId: nodeIds[i],
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(concurrency, nodeIds.length) }, () => worker()),
  );
  return out.filter((n): n is WloNode => n !== null);
}

/**
 * GET /node/v1/nodes/-home-/{nodeId}/parents
 * Returns the parent nodes (collections) of a given node.
 *
 * For collection nodes this endpoint returns the WHOLE ancestor chain in one
 * call, ordered self-first (`[self, …ancestors…, root]`) — verified live. For
 * file nodes (`ccm:io`) it can 500; then this returns `[]` (graceful).
 *
 * @param props optional narrow projection; omitted/empty keeps `-all-`. The
 *   full set is expensive here because it applies to EVERY node of the chain.
 */
export async function getNodeParents(
  nodeId: string,
  props?: string[],
): Promise<WloNode[]> {
  return (await readNodeParents(nodeId, props)).nodes;
}

/**
 * The same read, reporting whether the repository actually answered.
 *
 * The graceful `[]` above collapses "this node has no parents" and "the read
 * was refused" into one value. For a breadcrumb that is the right trade — a
 * missing crumb is cosmetic. For an answer of the form "this collection is in
 * no other collection" it is not: that is a statement about the record, and a
 * refused read must not be reported as one. Same split as
 * `getNodeTextContent` / `readNodeTextContent`.
 */
export async function readNodeParents(
  nodeId: string,
  props?: string[],
): Promise<{ ok: boolean; nodes: WloNode[]; status: number }> {
  const params = new URLSearchParams();
  appendPropertyFilter(params, props);
  const url = `${BASE_URL}/node/v1/nodes/-home-/${encodeURIComponent(nodeId)}/parents?${params}`;
  const res = await wloFetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) { logUpstreamMiss('getNodeParents', res); return { ok: false, nodes: [], status: res.status }; }
  const data = await readJson<{ nodes?: WloNode[]; parents?: WloNode[] }>(res, 'getNodeParents');
  // A 200 whose body is not JSON is not an answer either — `readJson` returns
  // null there, and claiming "no parents" from it would be the same falsehood.
  if (data === null) return { ok: false, nodes: [], status: res.status };
  return { ok: true, nodes: data.nodes ?? data.parents ?? [], status: res.status };
}

export interface BreadcrumbEntry {
  nodeId: string;
  title: string;
}

/** Best human-readable title of a node for a breadcrumb label: the shared
 * chain (node-match.ts, leaf module) with the nodeId as last resort so a
 * breadcrumb segment is never empty. */
function breadcrumbTitle(n: WloNode): string {
  return nodeTitle(n) || n.ref?.id || '';
}

/**
 * Ancestor path of a node, ordered root → node. Since edu-sharing's `/parents`
 * returns the full chain self-first in a single call, this reverses it to
 * root→node, de-duplicates (cycle guard against malformed data), and caps the
 * depth. Returns `[]` when no chain is available (e.g. file nodes, where
 * `/parents` has no meaningful result).
 */
export async function getNodeBreadcrumb(
  nodeId: string,
  maxDepth = 20,
): Promise<BreadcrumbEntry[]> {
  return (await readNodeBreadcrumb(nodeId, maxDepth)).chain;
}

/**
 * The same path, reporting whether `/parents` actually answered.
 *
 * The empty chain above is the right trade where a breadcrumb decorates a
 * record. It is not where the breadcrumb IS the answer: `get_node_breadcrumb`
 * used to explain an empty result as "probably a file node or the root", which
 * is an invented cause when the read was simply refused.
 */
export async function readNodeBreadcrumb(
  nodeId: string,
  maxDepth = 20,
): Promise<{ ok: boolean; chain: BreadcrumbEntry[]; status: number }> {
  const { ok, nodes: parents, status } = await readNodeParents(nodeId);
  const chain: BreadcrumbEntry[] = [];
  const seen = new Set<string>();
  // /parents is ordered self→root; walk it in reverse to build root→node.
  for (let i = parents.length - 1; i >= 0; i--) {
    const id = parents[i].ref?.id;
    if (!id || seen.has(id)) continue;   // cycle / malformed-data guard
    seen.add(id);
    chain.push({ nodeId: id, title: breadcrumbTitle(parents[i]) });
    if (chain.length >= maxDepth) break; // depth cap (root-most kept)
  }
  return { ok, chain, status };
}
