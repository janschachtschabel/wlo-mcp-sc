/**
 * services/collection-overview.ts – a collection at a glance, in one call
 * (BOERDi wishlist item 1, 2026-11-06).
 *
 * Every part already had a home; this module only runs them TOGETHER and says
 * which ones did not come back. Two rules hold it:
 *
 * - The head read decides whether there is anything to answer for (not found,
 *   refused, not a collection) — before a single part is started.
 * - After that, a part that fails is NAMED in `missing` and never takes the
 *   others down: the chatbot's page context renders what arrived.
 *
 * The compendium outline costs no request: the head read is `-all-` and
 * already carries the text, so only its headings are taken from it. The text
 * itself stays with `get_compendium_text`.
 */

import { isCollectionNode } from '../node-kind.js';
import { getCollectionContents, readNodeBreadcrumb, readNodeMetadata, type WloNode } from '../wlo-api.js';
import { formatNode, formatNodes } from '../formatter.js';
import { flattenText } from '../text-sanitize.js';
import { buildCompendiumView } from './compendium-view.js';
import { getCollectionStats } from './stats.js';
import { buildCollectionTree } from './collection-traversal.js';
import { ensureRegistryFor } from './skill-registry-cache.js';
import { DESCRIBED_MAX, describeEntries } from './skill-registry.js';
import { BUSY_RETRY_DEFAULT_S, failureCode, type FailureCode } from './failure-code.js';

export const OVERVIEW_PARTS = ['breadcrumb', 'compendium', 'stats', 'skills', 'subcollections', 'contents'] as const;
export type OverviewPart = (typeof OVERVIEW_PARTS)[number];

/**
 * Deepest outline level the overview carries (0 = main sections). Measured
 * 2026-11-06 on Optik: 242 headings, 19 KB of outline JSON in full, 1.3 KB for
 * levels 0–1 — 188 of the 242 sit on level 2. The full outline is
 * `get_compendium_text`'s answer, not a glance's.
 */
const TOC_MAX_DEPTH = 1;

export type OverviewErrorCode = 'not_found' | 'not_a_collection' | 'forbidden' | 'upstream_busy' | 'upstream_error';
/**
 * `not_checked`: the skill lookup did not answer (e.g. a collection too large
 * for the bounded registry scan) — not a failure, and not "none approved".
 */
export type PartCode = FailureCode | 'not_checked';

class NotChecked extends Error {}

export interface OverviewOptions {
  include: readonly OverviewPart[];
  maxContents: number;
  maxSubcollections: number;
}

export interface CollectionOverview {
  collection: {
    nodeId: string; title: string; description: string; url: string;
    isTopicPage: boolean; topicPageUrl: string | null;
  };
  breadcrumb?: Array<{ nodeId: string; title: string }>;
  compendium?: {
    hasText: boolean; chars: number; toc: Array<{ title: string; depth: number }>;
    /** Headings in the full outline. */
    headings: number;
    /** Set when deeper headings were left out of `toc`. */
    tocDepthLimited?: true;
  };
  stats?: {
    contents: number; subcollections: number; sampled: number;
    byType: Array<{ label: string; count: number }>;
    bySubject: Array<{ label: string; count: number }>;
    byLevel: Array<{ label: string; count: number }>;
  };
  skills?: Array<{ nodeId: string; title: string; context?: string; description?: string }>;
  subcollections?: Array<{ nodeId: string; title: string; contentCount?: number; contentsRefused?: true; contentsUnread?: true }>;
  /** Set only when there are more sub-collections than were listed. */
  subcollectionsTruncated?: true;
  contents?: {
    total: number; truncated: boolean;
    items: Array<{
      nodeId: string; title: string; url: string; learningResourceTypes: string[]; license: string;
      /** Present exactly when the listed id is a collection REFERENCE. */
      originalId?: string;
    }>;
  };
  missing: Array<{ part: OverviewPart; code: PartCode }>;
}

export type OverviewResult =
  | { ok: true; overview: CollectionOverview }
  | { ok: false; error: { code: OverviewErrorCode; message: string; retryAfter?: number } };

function headError(status: number): { code: OverviewErrorCode; message: string; retryAfter?: number } {
  if (status === 404) return { code: 'not_found', message: 'Diese Sammlung gibt es nicht.' };
  if (status === 401 || status === 403) {
    return { code: 'forbidden', message: 'Diese Sammlung ist mit der aktuellen Anmeldung nicht lesbar.' };
  }
  // The same busy rule every other read follows (`codeOfStatus`).
  if (status === 429 || status === 503) {
    return { code: 'upstream_busy', message: 'Das Repository ist gerade überlastet. Bitte gleich noch einmal.',
      retryAfter: BUSY_RETRY_DEFAULT_S };
  }
  return { code: 'upstream_error', message: 'Die Sammlung konnte nicht gelesen werden; über ihren Inhalt sagt das nichts.' };
}

/** A part's failure as a code — never the repository's own text. */
function partCode(err: unknown): PartCode {
  return err instanceof NotChecked ? 'not_checked' : failureCode(err);
}

/** The head read, following a reference to its original. */
async function readHead(collectionId: string): Promise<{ node: WloNode } | { status: number }> {
  const first = await readNodeMetadata(collectionId);
  if (!first.node) return { status: first.status };
  const original = first.node.originalId;
  if (!original || original === collectionId) return { node: first.node };
  const resolved = await readNodeMetadata(original);
  return resolved.node ? { node: resolved.node } : { status: resolved.status };
}

export async function getCollectionOverview(collectionId: string, opts: OverviewOptions): Promise<OverviewResult> {
  const head = await readHead(collectionId);
  if (!('node' in head)) return { ok: false, error: headError(head.status) };
  const { node } = head;
  if (!isCollectionNode(node)) {
    return { ok: false, error: { code: 'not_a_collection', message: 'Diese nodeId ist keine Sammlung.' } };
  }

  const id = node.ref?.id ?? collectionId;
  const formatted = formatNode(node);
  const overview: CollectionOverview = {
    collection: {
      nodeId: id,
      title: formatted.title,
      description: formatted.description,
      url: formatted.url,
      isTopicPage: Boolean(formatted.topicPageUrl),
      topicPageUrl: formatted.topicPageUrl || null,
    },
    missing: [],
  };
  const wanted = new Set(opts.include);

  if (wanted.has('compendium')) {
    const text = node.properties?.['ccm:oeh_collection_compendium_text']?.[0] ?? '';
    const outline = text ? buildCompendiumView(text, {}).outline : [];
    const toc = outline.filter(o => o.depth <= TOC_MAX_DEPTH).map(o => ({ title: flattenText(o.title), depth: o.depth }));
    overview.compendium = {
      hasText: text.length > 0,
      chars: text.length,
      toc,
      headings: outline.length,
      ...(toc.length < outline.length ? { tocDepthLimited: true as const } : {}),
    };
  }

  const parts: Partial<Record<OverviewPart, () => Promise<void>>> = {
    breadcrumb: async () => {
      const { ok, chain, status } = await readNodeBreadcrumb(id);
      if (!ok) throw new Error(`breadcrumb: HTTP ${status}`);
      overview.breadcrumb = chain;
    },
    stats: async () => {
      const s = await getCollectionStats(id);
      overview.stats = {
        contents: s.fileCount,
        subcollections: s.subCollectionCount,
        sampled: s.sampledFiles,
        byType: s.breakdown['learningResourceType'] ?? [],
        bySubject: s.breakdown['discipline'] ?? [],
        byLevel: s.breakdown['educationalContext'] ?? [],
      };
    },
    skills: async () => {
      const { registry, answered } = await ensureRegistryFor(id);
      // "Not answered" is not "none approved": only an answered lookup may say so.
      if (!answered) throw new NotChecked('skills: lookup not answered');
      const entries = registry?.entries ?? [];
      const { described } = await describeEntries(entries.slice(0, DESCRIBED_MAX));
      const descriptions = new Map(described.map(d => [d.nodeId, d.description]));
      overview.skills = entries.map(e => ({
        nodeId: e.nodeId,
        title: e.title,
        ...(e.context ? { context: e.context } : {}),
        ...(descriptions.get(e.nodeId) ? { description: descriptions.get(e.nodeId) } : {}),
      }));
    },
    subcollections: async () => {
      if (opts.maxSubcollections === 0) { overview.subcollections = []; return; }
      const tree = await buildCollectionTree({
        parentId: id, depth: 1, maxResults: opts.maxSubcollections, includeContentCounts: true,
      });
      overview.subcollections = tree.nodes.map(n => ({
        nodeId: n.nodeId, title: n.title, ...(n.fileCount !== undefined ? { contentCount: n.fileCount } : {}),
        // Not readable for this login: listed all the same — without it the list looked complete.
        ...(n.contentsRefused ? { contentsRefused: true as const } : {}),
        // Its count did not answer: said, or the entry stands there without a number and without a reason.
        ...(n.contentsUnread ? { contentsUnread: true as const } : {}),
      }));
      if (tree.truncated) overview.subcollectionsTruncated = true;
    },
    contents: async () => {
      const page = await getCollectionContents(id, 'files', Math.max(1, opts.maxContents), 0);
      const items = formatNodes(page.nodes).slice(0, opts.maxContents).map(n => ({
        nodeId: n.nodeId, title: n.title, url: n.url, learningResourceTypes: n.learningResourceTypes, license: n.license,
        ...(n.originalId ? { originalId: n.originalId } : {}),
      }));
      overview.contents = { total: page.pagination.total, items, truncated: page.pagination.total > items.length };
    },
  };

  const run = OVERVIEW_PARTS.filter(p => wanted.has(p) && parts[p]);
  const settled = await Promise.allSettled(run.map(p => parts[p]!()));
  settled.forEach((s, i) => {
    if (s.status === 'rejected') overview.missing.push({ part: run[i]!, code: partCode(s.reason) });
  });
  return { ok: true, overview };
}
