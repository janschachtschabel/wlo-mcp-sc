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
import { createContentNode } from './nodes-lifecycle.js';
import { readNodeMetadata } from '../../wlo-node.js';
import { MANIFEST_SUMMARY_PROPERTY, summarizeManifest, type ManifestEntry } from './batch-manifest.js';

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
  | { status: 'failed'; detail: string };

export async function createBatchFolder(name: string): Promise<FolderOutcome> {
  const folderName = flattenText(name).slice(0, FOLDER_NAME_CHARS).trim() || 'Ablage';
  const params = new URLSearchParams({ type: 'cm:folder', renameIfExists: 'true' });
  const res = await wloFetch(`${BASE_URL}/node/v1/nodes/-home-/-userhome-/children?${params}`, {
    method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ 'cm:name': [folderName] }),
  });
  if (res.status === 403) return { status: 'denied' };
  if (!res.ok) return { status: 'failed', detail: await failureDetail(res) };
  const created = await readJson<{ node?: { ref?: { id?: string } } }>(res, 'createBatchFolder');
  const nodeId = created?.node?.ref?.id;
  return nodeId ? { status: 'created', nodeId }
    : { status: 'failed', detail: 'Der Ordner wurde angelegt, aber ohne verwertbare ID gemeldet.' };
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
    { mode: 'user', parent, file, keepIdOnError: true, uploadTimeoutMs: uploadTimeoutMs(file.bytes.length) });
  if (out.status !== 'created') {
    return { status: 'failed', detail: out.status === 'failed' ? out.detail : 'Bereits vorhanden.' };
  }
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
  if (slot.sha256 !== entry.sha256 || slot.type.ext !== entry.ext) {
    return { status: 'failed', detail: 'Die Datei passt nicht zur freigegebenen (Prüfsumme oder Art).' };
  }
  return fileFile(parent, entry.title, {
    bytes: slot.data, fileName: entry.fileName, mimeType: slot.type.mimeType,
    digest: slot.sha256.slice(0, 16), excerpt: '',
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
