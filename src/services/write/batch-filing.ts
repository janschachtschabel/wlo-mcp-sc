/**
 * batch-filing.ts – MA-4: filing an approved batch into the person's personal area.
 *
 *  - `folderLayout`: ONE `validateSession`. With `TOOLPERMISSION_CREATE_ELEMENTS_FOLDERS` the batch
 *    gets its own folder (`folder`), otherwise the files go flat into the home (`flat`). Unreadable →
 *    `flat`: the safe guess files nothing the person could not file by hand. (Whether persons hold
 *    that permission on WLO is measurement MA-0, still open.)
 *  - `createBatchFolder`: `cm:folder` in `-userhome-`, `renameIfExists`; 403 → `denied` (the caller
 *    continues flat and says so once — never a service account instead).
 *  - `fileBatchEntry`: the slot's bytes must match the APPROVED entry (sha256 and detected type), else
 *    nothing is created; then a `ccm:io` in the parent via the measured two-call create path
 *    (`createContentNode`), title from the entry, `cm:name` = the approved file name. Both halves are
 *    read back: the content (`size`) AND the title (`statuses` of the metadata write) — a dropped title
 *    is `unverified`, never `stored`. An error after the node exists keeps its id (`unverified`).
 *    The upload deadline grows with the size (the shared 20 s were sized for 2 MB).
 *  - `fileManifest`: `vorgang.json` the TOOL built from the plan and the results.
 */

import { BASE_URL } from '../../wlo-config.js';
import { wloFetch } from '../../wlo-fetch.js';
import { readJson } from '../../read-json.js';
import { flattenText } from '../../text-sanitize.js';
import type { BatchEntry, StoreResult } from './batch-confirm.js';
import type { UploadFile } from './content-source.js';
import type { UploadType } from './file-types.js';
import { failureDetail } from './nodes.js';
import { wroteNothing } from '../../upstream-error.js';
import { createContentNode } from './nodes-lifecycle.js';
import { getCollectionContents, readNodeMetadata } from '../../wlo-node.js';
import type { WloNode } from '../../wlo-types.js';
import { MANIFEST_NAME, MANIFEST_SUMMARY_PROPERTY, parseManifestSummary, summarizeManifest, type ManifestEntry } from './batch-manifest.js';

export const FOLDER_PERMISSION = 'TOOLPERMISSION_CREATE_ELEMENTS_FOLDERS';
const JSON_HEADERS = { Accept: 'application/json', 'Content-Type': 'application/json' };
const FOLDER_NAME_CHARS = 120;

export async function folderLayout(): Promise<'folder' | 'flat'> {
  try {
    const res = await wloFetch(`${BASE_URL}/authentication/v1/validateSession`,
      { headers: { Accept: 'application/json' } });
    if (!res.ok) return 'flat';
    const data = await readJson<{ toolPermissions?: unknown }>(res, 'folderLayout');
    const perms = Array.isArray(data?.toolPermissions) ? data.toolPermissions : [];
    return perms.includes(FOLDER_PERMISSION) ? 'folder' : 'flat';
  } catch {
    return 'flat';
  }
}

export type FolderOutcome =
  | { status: 'created'; nodeId: string }
  | { status: 'denied' }
  /** `open`: the folder MAY exist (a 5xx, or an answer without an id). */
  | { status: 'failed'; detail: string; open?: true };

export async function createBatchFolder(name: string): Promise<FolderOutcome> {
  const folderName = flattenText(name).slice(0, FOLDER_NAME_CHARS).trim() || 'Ablage';
  const params = new URLSearchParams({ type: 'cm:folder', renameIfExists: 'true' });
  const res = await wloFetch(`${BASE_URL}/node/v1/nodes/-home-/-userhome-/children?${params}`, {
    method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ 'cm:name': [folderName] }),
  });
  if (res.status === 403) return { status: 'denied' };
  if (!res.ok) return { status: 'failed', detail: await failureDetail(res), ...(wroteNothing(res.status) ? {} : { open: true as const }) };
  const created = await readJson<{ node?: { ref?: { id?: string } } }>(res, 'createBatchFolder');
  const nodeId = created?.node?.ref?.id;
  return nodeId ? { status: 'created', nodeId }
    : { status: 'failed', open: true, detail: 'Der Ordner wurde angelegt, aber ohne verwertbare ID gemeldet.' };
}

export interface SlotBytes {
  data: Buffer;
  sha256: string;
  type: UploadType;
}

/** Upload deadline: 20 s plus 2 s per MB, at most 5 minutes. */
export function uploadTimeoutMs(bytes: number): number {
  return Math.min(20_000 + Math.ceil(bytes / (1024 * 1024)) * 2_000, 300_000);
}

async function fileFile(
  parent: string, title: string, file: UploadFile, extra: Record<string, string[]> = {},
): Promise<StoreResult> {
  const out = await createContentNode({ 'cclom:title': [title], ...extra },
    { mode: 'user', parent, file, uploadTimeoutMs: uploadTimeoutMs(file.bytes.length) });
  if (out.status !== 'created') {
    return { status: 'failed', detail: out.status === 'failed' ? out.detail : 'Bereits vorhanden.',
      ...(out.status === 'failed' && out.open ? { open: true as const } : {}),
      ...(out.status === 'failed' && out.httpStatus !== undefined ? { httpStatus: out.httpStatus } : {}) };
  }
  // The record exists and a later step got no answer: its id is reported, its state is open.
  if (out.incomplete) return { status: 'unverified', nodeId: out.nodeId, detail: out.incomplete };
  const upload = out.upload;
  if (!upload || upload.status === 'failed' || upload.status === 'dropped') {
    // The record exists without its bytes — the person can delete it (the id is reported).
    return { status: 'dropped', nodeId: out.nodeId, ...(upload && 'detail' in upload ? { detail: upload.detail } : {}) };
  }
  if (upload.status === 'unverified') return { status: 'unverified', nodeId: out.nodeId, detail: upload.detail };
  // The content is there — the title must be too (every write reads back).
  const titel = out.statuses.find((s) => s.property === 'cclom:title');
  if (titel && !titel.ok) {
    return { status: 'unverified', nodeId: out.nodeId, detail: 'Der Titel wurde nicht übernommen.' };
  }
  return { status: 'stored', nodeId: out.nodeId };
}

export async function fileBatchEntry(parent: string, entry: BatchEntry, slot: SlotBytes): Promise<StoreResult> {
  // The SIZE too, although an equal checksum implies it: the size is what the
  // preview SHOWED, and a caller that declared 1 kB for a 40 MB file had the
  // person approve a line that was not true (audit 2026-11-12, S-5).
  if (slot.sha256 !== entry.sha256 || slot.type.ext !== entry.ext || slot.data.length !== entry.size) {
    return { status: 'failed', detail: 'Die Datei passt nicht zur freigegebenen (Prüfsumme, Art oder Größe).' };
  }
  return fileFile(parent, entry.title, {
    bytes: slot.data, fileName: entry.fileName, mimeType: slot.type.mimeType,
    digest: slot.sha256, excerpt: '',
  });
}

/**
 * The manifest file, and its summary in the record's metadata (decision A,
 * `batch-manifest.ts` says why). The summary is what `wlo_list_my_batches`
 * reads; it is read back, and one that did not land makes the manifest
 * `unverified` — the list would show that batch as unreadable.
 */
export async function fileManifest(
  parent: string, manifest: { ordner: string; layout: string; inhalte: ManifestEntry[] } & Record<string, unknown>,
): Promise<StoreResult> {
  const bytes = Buffer.from(JSON.stringify(manifest, null, 2), 'utf8');
  const summary = JSON.stringify(summarizeManifest(manifest));
  const out = await fileFile(parent, 'vorgang.json', {
    bytes, fileName: 'vorgang.json', mimeType: 'application/json', digest: '', excerpt: '',
  }, { [MANIFEST_SUMMARY_PROPERTY]: [summary] });
  if (!out.nodeId || out.status === 'failed') return out;
  const { node } = await readNodeMetadata(out.nodeId);
  if (node?.properties?.[MANIFEST_SUMMARY_PROPERTY]?.[0] === summary) return out;
  return { status: 'unverified', nodeId: out.nodeId,
    detail: 'Die Kennzahlen des Vorgangs kamen nicht in der Beschreibung an — wlo_list_my_batches zeigt ihn als unreadable.' };
}

/** What a look for a batch's vorgang.json came to. */
export type ManifestLook =
  /** A manifest whose summary names a record of THIS batch: filed, complete. */
  | { found: 'filed'; nodeId: string }
  /** A manifest record without a readable summary that can be this batch's: created, and not finished. */
  | { found: 'incomplete'; nodeId: string }
  | { found: 'none' }
  /** The place could not be read to its end — no statement either way. */
  | { found: 'unknown' };

const LOOK_PAGE = 250;
/** The own area read for a look — the bound `wlo_list_my_batches` reads it with. */
const LOOK_FILES_MAX = 500;
/** Manifest records whose summary is read, newest first. Each is one request. */
const LOOK_CANDIDATES_MAX = 20;

/**
 * Is this batch's vorgang.json there? Asked after a manifest call whose outcome
 * stayed open (a create answered 5xx/429, or no answer) and BEFORE anything is
 * filed again: with `renameIfExists` a second create makes "vorgang (1).json".
 *
 * Through the children listing of the place it was filed in, never the search
 * index (a negative must come from the node store). Which record is OURS:
 *  - its summary names a record this batch stored (`ownNodeIds` — node ids are
 *    unique, and at least one file is stored before a manifest is filed);
 *  - or it has NO readable summary — the create landed and the step that writes
 *    the summary never ran — and it lies in the batch's own folder
 *    (`ownFolder`) or was created since the batch was prepared (`since`). That
 *    may be another batch's unfinished manifest; taking it for ours costs a
 *    look by the person, not taking it costs a second file.
 * Listing names only: a summary runs to ~50 000 characters (`batch-manifest.ts`).
 */
export async function findFiledManifest(
  parent: string, ownNodeIds: ReadonlySet<string>, opts: { since: number; ownFolder: boolean },
): Promise<ManifestLook> {
  const candidates: WloNode[] = [];
  let cut = true;
  try {
    for (let skip = 0; skip < LOOK_FILES_MAX; skip += LOOK_PAGE) {
      const page = await getCollectionContents(parent, 'files', LOOK_PAGE, skip, ['cm:name']);
      candidates.push(...page.nodes.filter(n => MANIFEST_NAME.test(n.properties?.['cm:name']?.[0] ?? n.name ?? '')));
      if (page.nodes.length < LOOK_PAGE) { cut = false; break; }
    }
  } catch {
    return { found: 'unknown' };
  }
  candidates.sort((a, b) => String(b.createdAt ?? '').localeCompare(String(a.createdAt ?? '')));
  let unread = cut || candidates.length > LOOK_CANDIDATES_MAX;
  let incomplete: string | undefined;
  for (const candidate of candidates.slice(0, LOOK_CANDIDATES_MAX)) {
    const id = candidate.ref?.id;
    if (!id) continue;
    const { node } = await readNodeMetadata(id, [MANIFEST_SUMMARY_PROPERTY]);
    if (!node) { unread = true; continue; }
    const summary = parseManifestSummary(node.properties?.[MANIFEST_SUMMARY_PROPERTY]?.[0]);
    if (summary) {
      if (summary.inhalte.some(e => e.nodeId !== undefined && ownNodeIds.has(e.nodeId))) return { found: 'filed', nodeId: id };
      continue; // another batch's manifest
    }
    const created = Date.parse(String(candidate.createdAt ?? ''));
    // An unreadable date does not rule the record out: unknown is not "older".
    if (opts.ownFolder || !Number.isFinite(created) || created >= opts.since) incomplete ??= id;
  }
  if (incomplete) return { found: 'incomplete', nodeId: incomplete };
  return unread ? { found: 'unknown' } : { found: 'none' };
}
