/**
 * wlo-node.ts – edu-sharing node endpoints + node URL builders.
 *
 * Children (files / sub-collections), single/bulk metadata, stored text and
 * anonymous file download, the parents/breadcrumb chain, and the URL builders
 * (topic-page, in-repo render, download). Uses the shared `wloFetch` +
 * `propertyFilter` helpers and config from `wlo-config`.
 */

import {
  BASE_URL, DISPLAY_PROPS, WLO_REPOSITORY_URL, appendPropertyFilter, wloFetch, logUpstreamMiss,
  type SearchResponse, type WloNode,
} from './wlo-config.js';
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

/** Anonymous binary-download URL for a node's uploaded file (works without auth). */
function buildDownloadUrl(nodeId: string): string {
  return `${WLO_REPOSITORY_URL}/eduservlet/download?nodeId=${encodeURIComponent(nodeId)}`;
}

/** Strip the `workspace://SpacesStore/` store-ref prefix from a node reference. */
export function stripStoreRef(s: string | undefined): string {
  return (s ?? '').replace('workspace://SpacesStore/', '');
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

  const data = await res.json() as { nodes?: WloNode[]; pagination?: SearchResponse['pagination'] };
  return {
    nodes: data.nodes ?? [],
    pagination: data.pagination ?? { total: 0, from: 0, count: 0 },
  };
}

/**
 * GET /node/v1/nodes/-home-/{nodeId}/children?filter=folders
 * Returns direct sub-collections of a collection node.
 * Same endpoint as getCollectionContents but with filter=folders.
 */
export async function getChildCollections(
  nodeId: string,
  maxItems = 100,
  skipCount = 0,
  props: string[] | undefined = DISPLAY_PROPS,
): Promise<WloNode[]> {
  const params = new URLSearchParams({
    filter: 'folders',
    maxItems: String(maxItems),
    skipCount: String(skipCount),
  });
  appendPropertyFilter(params, props);

  const url = `${BASE_URL}/node/v1/nodes/-home-/${encodeURIComponent(nodeId)}/children?${params}`;
  const res = await wloFetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) { logUpstreamMiss('getChildCollections', res); return []; }

  const data = await res.json() as { nodes?: WloNode[] };
  return data.nodes ?? [];
}

/**
 * GET /node/v1/nodes/-home-/{nodeId}/metadata?propertyFilter=-all-
 * Fetch metadata for a single node (FILE or COLLECTION).
 */
export async function getNodeMetadata(
  nodeId: string,
): Promise<WloNode | null> {
  const url = `${BASE_URL}/node/v1/nodes/-home-/${encodeURIComponent(nodeId)}/metadata?propertyFilter=-all-`;
  const res = await wloFetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) { logUpstreamMiss('getNodeMetadata', res); return null; }
  const data = await res.json() as { node?: WloNode };
  return data.node ?? null;
}

/**
 * Fetch metadata for multiple node IDs in parallel. Works for ANY node type
 * (files, collections, widgets) — not collections specifically.
 * Uses GET /node/v1/nodes/-home-/{id}/metadata per node.
 */
export async function getNodesMetadata(
  nodeIds: string[],
  concurrency = 8,
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
        out[i] = await getNodeMetadata(nodeIds[i]);
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
 * GET /node/v1/nodes/-home-/{nodeId}/textContent
 * Returns the stored full-text content of a node (web page text, PDF extract, etc.).
 */
export async function getNodeTextContent(
  nodeId: string,
): Promise<string | null> {
  const url = `${BASE_URL}/node/v1/nodes/-home-/${encodeURIComponent(nodeId)}/textContent`;
  const res = await wloFetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) return null;
  const data = await res.json() as { content?: string; text?: string };
  return data.content ?? data.text ?? null;
}

/**
 * Fetch a node's uploaded file as raw text via its anonymous `downloadUrl`
 * (`eduservlet/download`). Unlike `getNodeTextContent` (extracted/indexed text),
 * this returns the file verbatim — the right source for an uploaded Markdown
 * "skill". Returns null on a non-OK response.
 */
/** Byte cap for anonymous file downloads — bounds memory and model-context use. */
const DOWNLOAD_TEXT_CAP_BYTES = 64 * 1024;
const DOWNLOAD_TRUNCATION_MARKER = '\n\n…[gekürzt]';

export async function getNodeDownloadText(
  nodeId: string,
  maxBytes: number = DOWNLOAD_TEXT_CAP_BYTES,
): Promise<string | null> {
  const res = await wloFetch(buildDownloadUrl(nodeId), {
    headers: { Accept: 'text/markdown, text/plain, */*' },
  });
  if (!res.ok) return null;

  // Bounded read: stop after maxBytes and cancel the stream, so a large uploaded
  // file cannot exhaust server memory or flood the model context window. Falls
  // back to a capped full read when the body stream is unavailable.
  if (!res.body) {
    const text = await res.text();
    return text.length > maxBytes ? text.slice(0, maxBytes) + DOWNLOAD_TRUNCATION_MARKER : text;
  }
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  let truncated = false;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    if (received + value.length > maxBytes) {
      chunks.push(value.subarray(0, maxBytes - received));
      truncated = true;
      await reader.cancel();
      break;
    }
    chunks.push(value);
    received += value.length;
  }
  const text = Buffer.concat(chunks.map(c => Buffer.from(c))).toString('utf-8');
  return truncated ? text + DOWNLOAD_TRUNCATION_MARKER : text;
}

/**
 * GET /node/v1/nodes/-home-/{nodeId}/parents?propertyFilter=-all-
 * Returns the parent nodes (collections) of a given node.
 *
 * For collection nodes this endpoint returns the WHOLE ancestor chain in one
 * call, ordered self-first (`[self, …ancestors…, root]`) — verified live. For
 * file nodes (`ccm:io`) it can 500; then this returns `[]` (graceful).
 */
export async function getNodeParents(
  nodeId: string,
): Promise<WloNode[]> {
  const url = `${BASE_URL}/node/v1/nodes/-home-/${encodeURIComponent(nodeId)}/parents?propertyFilter=-all-`;
  const res = await wloFetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) { logUpstreamMiss('getNodeParents', res); return []; }
  const data = await res.json() as { nodes?: WloNode[]; parents?: WloNode[] };
  return data.nodes ?? data.parents ?? [];
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
  const parents = await getNodeParents(nodeId);
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
  return chain;
}
