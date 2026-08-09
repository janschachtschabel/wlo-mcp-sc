/**
 * services/write/duplicates.ts - is there already a record for this?
 *
 * Moved out of `nodes-lifecycle.ts` when the file-carrying create path arrived
 * and brought a SECOND way to ask the question. Two ways, because the two create
 * paths anchor on different things:
 *
 *   url  -> `ccm:wwwurl` identifies the material exactly. A hit BLOCKS: a second
 *           record for the same address is a duplicate by definition.
 *   file -> there is no address, so the anchor is the title within the place the
 *           record would be filed. A hit only WARNS, because two worksheets may
 *           legitimately share a name and refusing would be worse than a second
 *           record someone can merge.
 *
 * Keeping both here rather than in the lifecycle module is what stops that file
 * growing a second reason to change - and it names the seam a newcomer looks for.
 */

import { ngsearch } from '../../wlo-search.js';
import { getCollectionContents } from '../../wlo-node.js';
import { log } from '../../logger.js';

export interface ExistingRecord {
  nodeId: string;
  title: string;
  url: string;
}

/**
 * How many hits to compare. The search is by exact property value, so a real
 * duplicate ranks high; this only bounds the neighbours that come along.
 */
const DUPLICATE_SCAN_LIMIT = 20;

/**
 * Find an existing record for a source URL, or null.
 *
 * Two things make this stricter than the search it is built on. `ngsearch`
 * answers with neighbours as well as the exact hit, so "any result came back"
 * is not the same as "this URL already exists" — every hit's own `ccm:wwwurl`
 * is compared. And the comparison ignores case, because the repository stores
 * whatever a crawler found and scheme and host are case-insensitive in practice.
 *
 * Nothing beyond case is normalised: a trailing slash can distinguish two real
 * pages, and a wrong "already exists" blocks a legitimate record.
 */
export async function findByUrl(url: string): Promise<ExistingRecord | null> {
  const wanted = url.trim().toLowerCase();
  if (!wanted) return null;

  const { nodes } = await ngsearch(
    [{ property: 'ccm:wwwurl', values: [url.trim()] }],
    'FILES',
    DUPLICATE_SCAN_LIMIT,
    0,
    ['ccm:wwwurl', 'cclom:title', 'cm:name'],
  );

  for (const node of nodes) {
    const stored = node.properties?.['ccm:wwwurl']?.[0];
    if (!stored || stored.trim().toLowerCase() !== wanted) continue;
    return {
      nodeId: node.ref?.id ?? '',
      title: node.properties?.['cclom:title']?.[0] ?? node.properties?.['cm:name']?.[0] ?? '',
      url: stored,
    };
  }
  return null;
}

/**
 * How much of the storage location to compare. A personal home or the editorial
 * inbox holds far more than this over time, so the check is explicitly a look at
 * the RECENT neighbourhood rather than an exhaustive search — which is honest
 * about what it can promise, and is why a hit warns instead of blocking.
 */
const TITLE_SCAN_LIMIT = 100;

/**
 * Find a record with the same title in the place a new one would be filed, or
 * null.
 *
 * The anchor for a record that carries its own file: there is no `ccm:wwwurl` to
 * compare, so the question becomes "did I already file something by this name
 * here". Case and surrounding space are ignored, because a title comes out of a
 * conversation and `Brüche kürzen` and `brüche kürzen` are the same intent.
 *
 * **Degrades to null on any failure, deliberately.** This is a courtesy, not a
 * gate: a listing the repository refuses must not stop someone filing their
 * worksheet. The reason goes to the log so an operator can see the check is not
 * working, rather than the user meeting an error for a warning they did not ask
 * for.
 */
export async function findByTitle(title: string, parentId: string): Promise<ExistingRecord | null> {
  const wanted = title.trim().toLowerCase();
  if (!wanted) return null;

  let nodes;
  try {
    ({ nodes } = await getCollectionContents(parentId, 'files', TITLE_SCAN_LIMIT, 0, [
      'cclom:title', 'cm:name', 'ccm:wwwurl',
    ]));
  } catch (err) {
    log.warn('duplicate-by-title check could not list the storage location', {
      parentId,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }

  for (const node of nodes) {
    const stored = node.properties?.['cclom:title']?.[0] ?? node.title ?? node.name ?? '';
    if (stored.trim().toLowerCase() !== wanted) continue;
    return {
      nodeId: node.ref?.id ?? '',
      title: stored,
      url: node.properties?.['ccm:wwwurl']?.[0] ?? '',
    };
  }
  return null;
}
