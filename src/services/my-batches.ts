/**
 * services/my-batches.ts – the person's own batch filings, found again
 * (BOERDi wishlist item 9, decision A, 2026-11-06).
 *
 * Two rules:
 *
 * - The NODE store, never the search index. A list that says "you have no
 *   batches" is a negative, and in this project a negative may only come from a
 *   children listing (a record can fall out of the index while it sits in the
 *   node store). The own area is listed flat (the layout without folder right,
 *   MA-0) and one folder level deep (the layout with it), each listing bounded,
 *   and a bound that was reached is DISCLOSED.
 * - Only the batches shown are read. A manifest's summary can run to 24 000
 *   characters, so the listing asks for names and dates only, and the summary
 *   (`cm:description`, see `write/batch-manifest.ts`) is read for at most
 *   `limit` records.
 */

import { getCollectionContents, readNodeMetadata, type WloNode } from '../wlo-api.js';
import { mapPool } from '../concurrency.js';
import {
  MANIFEST_NAME, MANIFEST_SUMMARY_PROPERTY, parseManifestSummary, type ManifestSummary,
} from './write/batch-manifest.js';

const HOME = '-userhome-';
/** Files of the own area read before the listing counts as cut short. */
const FILES_MAX = 500;
const PAGE = 250;
/** Folders of the own area looked into (one level). */
const FOLDERS_MAX = 50;
/**
 * Files read per folder: ONE page. A batch folder holds at most 201 entries (200
 * files plus vorgang.json), so a second page could only belong to a folder the
 * person filled otherwise — and 50 folders at two pages each is the 100-request
 * worst case this halves. A fuller folder still counts as a cut scan.
 */
const FOLDER_FILES_MAX = PAGE;
const LIST_PROPS = ['cm:name', 'cclom:title'];

export type BatchStatusCount = 'stored' | 'dropped' | 'unverified' | 'failed' | 'open';

export interface BatchSummary {
  manifestNodeId: string;
  /** The batch folder, or null when the batch lies flat in the own area. */
  folderNodeId: string | null;
  title: string;
  createdAt: string;
  status: 'ok' | 'unreadable';
  counts?: Record<BatchStatusCount, number>;
}

export interface BatchDetail extends BatchSummary {
  entries?: Array<{ index: number; title: string; nodeId?: string; status: BatchStatusCount }>;
}

/** The manifest's German states, in the E6 English the answer uses. */
const STATUS_OF: Record<string, BatchStatusCount> = {
  stored: 'stored', dropped: 'dropped', unverified: 'unverified', failed: 'failed', offen: 'open',
};

interface Found { node: WloNode; folderNodeId: string | null; folderTitle?: string }

/** Every page of a listing up to `max`; `cut` when more were there. */
async function listAll(nodeId: string, filter: 'files' | 'folders', max: number): Promise<{ nodes: WloNode[]; cut: boolean }> {
  const nodes: WloNode[] = [];
  for (let skip = 0; skip < max; skip += PAGE) {
    const page = await getCollectionContents(nodeId, filter, Math.min(PAGE, max - skip), skip, LIST_PROPS);
    nodes.push(...page.nodes);
    if (page.nodes.length < Math.min(PAGE, max - skip)) return { nodes, cut: false };
    if (nodes.length >= (page.pagination.total || nodes.length)) return { nodes, cut: false };
  }
  return { nodes, cut: true };
}

const isManifest = (n: WloNode) =>
  MANIFEST_NAME.test(n.properties?.['cm:name']?.[0] ?? n.name ?? '');

/** All manifest records of the own area, newest first, and whether any listing was cut short. */
async function findManifests(): Promise<{ found: Found[]; scanCut: boolean }> {
  const [files, folders] = await Promise.all([listAll(HOME, 'files', FILES_MAX), listAll(HOME, 'folders', FOLDERS_MAX)]);
  const inFolders = await mapPool(folders.nodes, 4, async f => {
    const id = f.ref?.id ?? '';
    const listing = await listAll(id, 'files', FOLDER_FILES_MAX);
    return { listing, id, title: f.properties?.['cm:name']?.[0] ?? f.name ?? '' };
  });
  // A folder whose listing failed is a part we did not look at — disclosed, not silently skipped.
  const folderCut = inFolders.some(r => r === null || r.listing.cut);
  const found: Found[] = [
    ...files.nodes.filter(isManifest).map(node => ({ node, folderNodeId: null })),
    ...inFolders.flatMap(r => (r
      ? r.listing.nodes.filter(isManifest).map(node => ({ node, folderNodeId: r.id, folderTitle: r.title }))
      : [])),
  ];
  found.sort((a, b) => String(b.node.createdAt ?? '').localeCompare(String(a.node.createdAt ?? '')));
  return { found, scanCut: files.cut || folders.cut || folderCut };
}

function countsOf(summary: ManifestSummary): Record<BatchStatusCount, number> {
  const counts: Record<BatchStatusCount, number> = { stored: 0, dropped: 0, unverified: 0, failed: 0, open: 0 };
  for (const e of summary.inhalte) counts[STATUS_OF[e.stand] ?? 'open']++;
  return counts;
}

async function describe(f: Found, withEntries: boolean): Promise<BatchDetail> {
  const id = f.node.ref?.id ?? '';
  const base = { manifestNodeId: id, folderNodeId: f.folderNodeId, createdAt: String(f.node.createdAt ?? '') };
  const { node } = await readNodeMetadata(id, [MANIFEST_SUMMARY_PROPERTY]);
  const summary = parseManifestSummary(node?.properties?.[MANIFEST_SUMMARY_PROPERTY]?.[0]);
  // Unreadable: the folder's name is what the person recognises; flat, only the file is left to name.
  if (!summary) {
    return { ...base, title: f.folderTitle || f.node.properties?.['cclom:title']?.[0] || 'vorgang.json', status: 'unreadable' };
  }
  return {
    ...base, title: summary.ordner, status: 'ok', counts: countsOf(summary),
    ...(withEntries ? { entries: summary.inhalte.map(e => ({
      index: e.index, title: e.titel, ...(e.nodeId ? { nodeId: e.nodeId } : {}), status: STATUS_OF[e.stand] ?? 'open',
    })) } : {}),
  };
}

export async function listMyBatches(limit: number): Promise<{ batches: BatchSummary[]; scanCut: boolean }> {
  const { found, scanCut } = await findManifests();
  const shown = found.slice(0, limit);
  const batches = (await mapPool(shown, 4, f => describe(f, false)))
    .map((b, i) => b ?? { manifestNodeId: shown[i]!.node.ref?.id ?? '', folderNodeId: shown[i]!.folderNodeId,
      title: 'vorgang.json', createdAt: String(shown[i]!.node.createdAt ?? ''), status: 'unreadable' as const });
  return { batches, scanCut };
}

/**
 * One batch with its entries — only one of the OWN manifests. An id from
 * anywhere else is `null`: this tool must not become a reader of other records'
 * descriptions.
 */
export async function getMyBatch(manifestNodeId: string): Promise<{ batch: BatchDetail | null; scanCut: boolean }> {
  const { found, scanCut } = await findManifests();
  const hit = found.find(f => f.node.ref?.id === manifestNodeId);
  return { batch: hit ? await describe(hit, true) : null, scanCut };
}
