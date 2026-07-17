/**
 * services/stats.ts – get_collection_stats business logic.
 *
 * Aggregates a quick profile of a collection: how many files and sub-collections
 * it holds, plus a breakdown of its files by learning-resource type, subject,
 * and educational level.
 *
 * The counts come from the children pagination totals. The breakdown is tallied
 * from the collection's ACTUAL child files (up to `sampleSize`), not from an
 * ngsearch facet query: WLO collections curate *references* to nodes whose
 * primary parent lives elsewhere, so a facet query scoped by
 * `virtual:primaryparent_nodeid` returns nothing for them (verified live). The
 * children endpoint, by contrast, returns the referenced files with their
 * `*_DISPLAYNAME` labels — so a local tally is both accurate and label-ready.
 */

import { getCollectionContents, getNodeMetadata } from '../wlo-api.js';
import { formatNode, formatNodes } from '../formatter.js';

/** Default cap on how many child files the breakdown is tallied over. */
const DEFAULT_SAMPLE_SIZE = 100;

export interface CollectionStats {
  nodeId: string;
  title: string;
  fileCount: number;
  subCollectionCount: number;
  /** Number of child files the breakdown was tallied over (≤ fileCount). */
  sampledFiles: number;
  /** Labeled counts keyed by dimension (learningResourceType/discipline/educationalContext). */
  breakdown: Record<string, { label: string; count: number }[]>;
}

/** Count label occurrences, dropping empties; most frequent first, label tie-break. */
function tally(labels: string[]): { label: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const l of labels) {
    if (!l) continue;
    counts.set(l, (counts.get(l) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

export async function getCollectionStats(
  nodeId: string,
  sampleSize = DEFAULT_SAMPLE_SIZE,
): Promise<CollectionStats> {
  // Title, the sub-collection total, and the child files (for count + tally) in
  // parallel. The files call doubles as the breakdown sample.
  const [meta, folders, files] = await Promise.all([
    getNodeMetadata(nodeId),
    getCollectionContents(nodeId, 'folders', 1, 0),
    getCollectionContents(nodeId, 'files', sampleSize, 0),
  ]);

  const fileNodes = formatNodes(files.nodes);
  const breakdown: Record<string, { label: string; count: number }[]> = {
    learningResourceType: tally(fileNodes.flatMap(n => n.learningResourceTypes)),
    discipline:           tally(fileNodes.flatMap(n => n.disciplines)),
    educationalContext:   tally(fileNodes.flatMap(n => n.educationalContexts)),
  };

  return {
    nodeId,
    title: meta ? formatNode(meta).title : '',
    fileCount: files.pagination.total,
    subCollectionCount: folders.pagination.total,
    sampledFiles: fileNodes.length,
    breakdown,
  };
}
