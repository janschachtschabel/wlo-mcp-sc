/**
 * services/skill-files.ts – the other files that belong to a skill.
 *
 * A skill is one `ccm:io` whose attached file is the `SKILL.md`. Anything else
 * it needs — a template, a checklist, an image — is a SEPARATE record in the
 * same workspace folder, each with its own nodeId and its own anonymous
 * download. This module turns a skill into that list, so a model can see what
 * exists and fetch only what it needs.
 *
 * Two rules, both measured against staging on 2026-08-08:
 *
 *   - **A reference's own parent is the collection, not the folder.** A skill
 *     reached through a collection carries `ccm:collection_io_reference` and
 *     `ccm:original`; its `virtual:primaryparent_nodeid` points at the
 *     collection. The folder hangs off the ORIGINAL, so the original is resolved
 *     first (one extra read, ~0.2 s).
 *   - **The folder is only a bundle if it holds one skill.** Listing a real WLO
 *     harvest folder took 1.7 s (484 files), 6.9 s (3744) and once 20.6 s (680),
 *     and one of six refused anonymous access entirely. A folder with a handful
 *     of children answers in 0.2–0.4 s. So a folder past `SKILL_BUNDLE_MAX` is
 *     reported as a COUNT rather than listed: it is somebody's inbox, and its
 *     names are not this skill's companions.
 */

import type { WloNode } from '../wlo-api.js';
import { getCollectionContents, getNodeMetadata, stripStoreRef } from '../wlo-api.js';
import { formatNodes } from '../formatter.js';
import { log } from '../logger.js';

/** One file that sits beside a skill's `SKILL.md`. */
export interface SkillFile {
  nodeId: string;
  title: string;
  mimeType: string;
  fileSize: number;
  downloadUrl: string;
}

export interface SkillBundle {
  /** The skill's companions — empty when there are none, or when the folder is not a bundle. */
  files: SkillFile[];
  /** Set INSTEAD of `files` when the folder holds more than one skill's worth. */
  folderFileCount?: number;
}

/**
 * Above this many files the folder is not one skill's bundle. Generous on
 * purpose — the point is to exclude the 484-and-up harvest folders, not to cap
 * how many attachments a skill may have.
 */
const SKILL_BUNDLE_MAX = 25;

/** Only what the manifest shows; mimetype/size/downloadUrl are node fields, not properties. */
const BUNDLE_PROPS = ['cm:name', 'cclom:title'];

/**
 * The record a skill's folder hangs off: itself, or the original it references.
 *
 * Reads the PROPERTY, which is safe only because of the self-comparison at the
 * call site: on an original `ccm:original` points at the record itself (measured
 * 2026-08-17, 3/3 staging records), so without that comparison every record
 * would look like a reference to itself. `services/write/nodes.ts` uses the DTO
 * field instead and is the one place that decides a WRITE target; this read path
 * deliberately does not import from the write path.
 *
 * The strip is a no-op on staging — `ccm:original` is a bare uuid on 6/6 records
 * measured, references and originals alike — and stays because the repository
 * does use store refs for node pointers elsewhere (`ccm:page_config`).
 */
function originalIdOf(node: WloNode, nodeId: string): string {
  return stripStoreRef(node.properties?.['ccm:original']?.[0] ?? '') || nodeId;
}

/**
 * The files beside a skill, excluding the skill itself.
 *
 * Degrades to an empty list on any upstream failure: the manifest is an extra,
 * and a folder that cannot be read must not cost the caller the instructions it
 * actually asked for.
 */
export async function readSkillBundle(node: WloNode, nodeId: string): Promise<SkillBundle> {
  try {
    const originalId = originalIdOf(node, nodeId);
    let folderId = node.properties?.['virtual:primaryparent_nodeid']?.[0] ?? '';
    if (originalId !== nodeId) {
      const original = await getNodeMetadata(originalId, ['virtual:primaryparent_nodeid']);
      folderId = original?.properties?.['virtual:primaryparent_nodeid']?.[0] ?? '';
    }
    if (!folderId) return { files: [] };

    const listing = await getCollectionContents(folderId, 'files', SKILL_BUNDLE_MAX + 1, 0, BUNDLE_PROPS);
    if (listing.pagination.total > SKILL_BUNDLE_MAX) return { files: [], folderFileCount: listing.pagination.total };

    return {
      files: formatNodes(listing.nodes)
        .filter(f => f.nodeId !== originalId && f.nodeId !== nodeId)
        .map(f => ({
          nodeId: f.nodeId,
          title: f.title,
          mimeType: f.mimeType,
          fileSize: f.fileSize,
          downloadUrl: f.downloadUrl,
        })),
    };
  } catch (err) {
    log.warn('skills: the skill folder could not be listed — returning the instructions without a file manifest', {
      nodeId, error: err instanceof Error ? err.message : String(err),
    });
    return { files: [] };
  }
}
