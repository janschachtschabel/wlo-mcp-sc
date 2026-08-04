/**
 * services/write/nodes-lifecycle.ts - bringing a record into being.
 *
 * Split from `nodes.ts` when that file passed 300 lines: writing a property on
 * an existing node and creating a record are different jobs with different
 * failure modes. This one owns the ORDER the repository demands - duplicate
 * check, then a deliberately small create body, then the metadata step - and
 * `nodes.ts` owns the transport each of those steps uses.
 */

import { BASE_URL, WLO_INBOX_ID } from '../../wlo-config.js';
import { wloFetch, HEADERS } from '../../wlo-fetch.js';
import { readJson } from '../../read-json.js';
import { ngsearch } from '../../wlo-search.js';
import { getNodeMetadata } from '../../wlo-node.js';
import { log } from '../../logger.js';
import type { WriteMode } from './credential-gate.js';
import { updateNodeMetadata, failureDetail, type FieldWriteStatus } from './nodes.js';
import { confirmDeleted, type MutationOutcome } from './verify.js';

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
 * Properties the create endpoint accepts. The list is short on purpose: the
 * endpoint is selective, and everything else lands in the metadata step that
 * follows. `cclom:title` is NOT here — measured, the repository replaces a
 * create-time title with one derived from the URL, so sending it would produce
 * a record whose title silently is not the one that was asked for.
 */
const CREATE_BODY_FIELDS = [
  'ccm:wwwurl',
  'cclom:general_description',
  'cclom:general_keyword',
  'cclom:general_language',
] as const;

/** Shown in the version history as the reason the record exists. */
const CREATE_VERSION_COMMENT = 'Angelegt über den WLO-MCP-Server';

export type CreateOutcome =
  | { status: 'created'; nodeId: string; statuses: FieldWriteStatus[] }
  | { status: 'duplicate'; existing: ExistingRecord }
  | { status: 'failed'; detail: string };

/**
 * Where a new record is filed.
 *
 * A personal login writes to their own home — the record belongs to them and
 * they can find it again. The service account has no home worth writing to, so
 * it uses the shared inbox the editorial team watches. Pure, with the inbox id
 * passed in, so both branches are testable without touching the environment.
 */
export function resolveCreateParent(mode: WriteMode, inboxId: string): string {
  if (mode === 'user') return '-userhome-';
  const inbox = inboxId.trim();
  if (!inbox) {
    throw new Error(
      'Für das Dienstkonto ist kein Ablageort konfiguriert. Die Betreiberin muss WLO_INBOX_ID auf die ' +
        'nodeId des gemeinsamen Posteingangs setzen — eine fest eingebaute ID würde auf einem anderen ' +
        'Repository in einen fremden Ordner schreiben.',
    );
  }
  return inbox;
}

/**
 * Create a `ccm:io` for a source URL.
 *
 * Order matters and is measured: duplicate check → small create body → metadata
 * for the title and everything else. The duplicate check runs first so a second
 * record for the same URL is never created and then reported.
 *
 * This never submits the record for review. That is a separate, explicit act —
 * a draft must not reach the editorial queue because someone was still writing.
 */
export async function createContentNode(
  desired: Record<string, string[]>,
  opts: { mode: WriteMode; inboxId?: string },
): Promise<CreateOutcome> {
  const url = desired['ccm:wwwurl']?.[0]?.trim();
  if (!url) {
    return { status: 'failed', detail: 'Ohne Quell-URL kann kein Datensatz angelegt werden.' };
  }

  let parent: string;
  try {
    parent = resolveCreateParent(opts.mode, opts.inboxId ?? WLO_INBOX_ID);
  } catch (err) {
    return { status: 'failed', detail: err instanceof Error ? err.message : String(err) };
  }

  const existing = await findByUrl(url);
  if (existing) return { status: 'duplicate', existing };

  const body: Record<string, string[]> = { 'ccm:linktype': ['USER_GENERATED'] };
  for (const property of CREATE_BODY_FIELDS) {
    const values = desired[property];
    if (values?.length) body[property] = values;
  }

  const params = new URLSearchParams({
    type: 'ccm:io',
    renameIfExists: 'true',
    versionComment: CREATE_VERSION_COMMENT,
  });
  const res = await wloFetch(
    `${BASE_URL}/node/v1/nodes/-home-/${encodeURIComponent(parent)}/children?${params}`,
    { method: 'POST', headers: HEADERS, body: JSON.stringify(body) },
  );
  if (!res.ok) return { status: 'failed', detail: await failureDetail(res) };

  // An unparseable body takes the same route as one carrying no id: the POST was
  // accepted, so a record may exist — and with `renameIfExists` a retry would
  // create a second one rather than fail loudly.
  const created = await readJson<{ node?: { ref?: { id?: string } } }>(res, 'createContentNode');
  const nodeId = created?.node?.ref?.id;
  if (!nodeId) {
    return {
      status: 'failed',
      detail: 'Das Repository hat den Datensatz angelegt, aber keine verwertbare Antwort mit ID zurückgegeben. ' +
        'Bitte im Repository nachsehen, bevor der Vorgang wiederholt wird.',
    };
  }

  // Everything the create body could not carry — the title above all.
  const rest: Record<string, string[]> = {};
  for (const [property, values] of Object.entries(desired)) {
    if ((CREATE_BODY_FIELDS as readonly string[]).includes(property)) continue;
    rest[property] = values;
  }
  const { statuses } = await updateNodeMetadata(nodeId, rest, { commit: false });

  log.info('content node created', { nodeId, parent, mode: opts.mode });
  return { status: 'created', nodeId, statuses };
}

// ── Submitting for editorial review ──────────────────────────────────────────

/**
 * The group WLO's editorial workflow routes submissions to, and the status that
 * puts a record in their queue. Both are fixed by the repository's workflow
 * configuration, not by us — a different value silently produces a submission
 * nobody sees.
 */
const REVIEW_RECEIVER = 'GROUP_ORG_WLO-Uploadmanager';
const REVIEW_STATUS = '200_tocheck';

/**
 * What the record shows after a submission was sent.
 *
 * Measured against staging 2026-08-02: a submitted `ccm:io` carries
 * `ccm:wf_status: ['200_tocheck']` and `ccm:wf_receiver`, a record that was
 * never submitted carries neither. The submission is therefore verifiable, and
 * reporting it on the strength of a `200` alone would be a choice to know less
 * than we can — the same choice that makes silent drops invisible everywhere
 * else in this pipeline.
 */
export type SubmitOutcome =
  | { status: 'submitted'; receiver: string; workflowStatus: string }
  | { status: 'dropped' }
  | { status: 'unverified'; detail: string }
  | { status: 'failed'; detail: string };

/**
 * Hand a record to the editorial queue, then read the record back.
 *
 * Deliberately never called by `createContentNode`. Submitting spends a
 * reviewer's attention and cannot be taken back quietly, so it stays a separate
 * act that the person asks for and confirms on its own.
 */
export async function submitForReview(nodeId: string, comment: string): Promise<SubmitOutcome> {
  const res = await wloFetch(
    `${BASE_URL}/node/v1/nodes/-home-/${encodeURIComponent(nodeId)}/workflow`,
    {
      method: 'PUT',
      headers: HEADERS,
      body: JSON.stringify({
        receiver: [{ authorityName: REVIEW_RECEIVER }],
        status: REVIEW_STATUS,
        comment,
      }),
    },
  );
  if (!res.ok) return { status: 'failed', detail: await failureDetail(res) };

  const node = await getNodeMetadata(nodeId);
  if (!node) {
    return {
      status: 'unverified',
      detail: `Der Datensatz „${nodeId}“ war zur Kontrolle nicht lesbar.`,
    };
  }
  const stored = node.properties?.['ccm:wf_status']?.[0];
  if (stored !== REVIEW_STATUS) {
    log.warn('submission not visible on the record', { nodeId, stored: stored ?? null });
    return { status: 'dropped' };
  }
  log.info('content submitted for review', { nodeId, receiver: REVIEW_RECEIVER });
  return {
    status: 'submitted',
    receiver: node.properties?.['ccm:wf_receiver']?.[0] ?? REVIEW_RECEIVER,
    workflowStatus: stored,
  };
}

// ── Deleting a record ────────────────────────────────────────────────────────

/**
 * Delete a `ccm:io`.
 *
 * `recycle=true` is always sent explicitly. The flag decides whether the node
 * goes to the archive or is destroyed outright, and the default is not ours to
 * rely on — a repository configuration change would otherwise turn every
 * deletion into a permanent one without a line of our code changing.
 *
 * What this does NOT mean is that the deletion can be undone. A person-scoped
 * archive query found a deleted node once and then returned nothing for the
 * same node minutes later, so recoverability could not be demonstrated. Callers
 * must treat a deletion as final and must not tell anyone otherwise.
 */
export async function deleteContentNode(nodeId: string): Promise<MutationOutcome> {
  const res = await wloFetch(
    `${BASE_URL}/node/v1/nodes/-home-/${encodeURIComponent(nodeId)}?recycle=true`,
    { method: 'DELETE', headers: { Accept: 'application/json' } },
  );
  if (!res.ok) return { status: 'failed', detail: await failureDetail(res) };
  log.warn('content node deleted', { nodeId });
  return await confirmDeleted(nodeId);
}
