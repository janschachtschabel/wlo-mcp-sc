/**
 * services/write/nodes.ts – writing a `ccm:io`'s metadata.
 *
 * Three measured facts shape this module, none of them visible from the API:
 *
 *   1. `obeyMds=false` is mandatory. With the default, any property the metadata
 *      set does not declare as a widget is dropped while the call answers 200.
 *   2. `PUT …/metadata` changes the record; `POST …/metadata` changes it AND
 *      creates a version. A conversation edits iteratively, so drafting uses
 *      `PUT` and only an explicit commit uses `POST` — otherwise the version
 *      history fills with one entry per correction.
 *   3. Some properties are not in the MDS at all (the compendium text). For
 *      those, `PUT /metadata` answers 200 and stores nothing; the property
 *      endpoint is the only route that works.
 *
 * Whether a write actually landed is NOT decided here. This module reports what
 * the API said; `verify.ts` reads the record back and reports what is true.
 */

import { BASE_URL, WLO_FETCH_TIMEOUT_MS } from '../../wlo-config.js';
import { wloFetch, HEADERS } from '../../wlo-fetch.js';
import { log } from '../../logger.js';
import { sanitizeText } from '../../text-sanitize.js';
import type { WloNode } from '../../wlo-types.js';
import { getNodeMetadata } from '../../wlo-node.js';
import { WRITABLE_FIELDS } from './fields.js';


/**
 * How long a write carrying `ccm:wwwurl` may take, in milliseconds.
 *
 * Setting that one property is the slow act in this whole server, and it is slow
 * wherever it happens — measured 2026-08-17 with the same address in the same
 * run: creating WITH the URL took 8.8 s, while creating without it took 0.5 s
 * and setting the URL afterwards took 7.8 s. The cost travels with the property;
 * it cannot be moved off the caller's wait by reordering.
 *
 * What it buys is visible: the record afterwards carries a real preview image
 * (~50 kB JPEG, `preview.isIcon = false`) instead of the SVG placeholder, so the
 * repository renders the page while the write is in flight. The render is cached
 * per address — a second record for the same URL returns the identical bytes and
 * a preview fetch costs 0.3 s — which is why the numbers scatter so widely:
 * `planet-schule.de` cost **46.5 s** cold and 8.8 s once cached.
 *
 * 60 s therefore, covering the cold case with margin. That is a long time to
 * hold a tool call, and it is still the better end of the trade: an abort
 * reports failure for work the repository finishes, and a retry then creates a
 * SECOND record. Making this fast is not something this server can do — the
 * render would have to become asynchronous in the repository, where the
 * placeholder preview already exists for exactly that shape.
 */
export const WWWURL_WRITE_TIMEOUT_MS = 60_000;

/**
 * The budget for one metadata write: larger when it carries `ccm:wwwurl`.
 *
 * Never below what the operator configured — `WLO_FETCH_TIMEOUT_MS` is raised
 * for an instance that is slow everywhere, and a fixed value here would quietly
 * undercut that.
 *
 * @param properties the properties about to be written.
 * @param configured the operator's per-request budget; defaults to the live one.
 */
export function writeTimeoutMs(
  properties: Record<string, string[]>,
  configured: number = WLO_FETCH_TIMEOUT_MS,
): number {
  const slow = 'ccm:wwwurl' in properties;
  return Math.max(configured, slow ? WWWURL_WRITE_TIMEOUT_MS : 0);
}

/** Which node a metadata write is aimed at, and which one the caller named. */
export interface WriteTarget {
  /** Where the write goes — the original. */
  targetId: string;
  /** What the caller named. Kept because the preview has to say both. */
  requestedId: string;
  /** True when the two differ, i.e. the caller named a reference. */
  redirected: boolean;
}

/**
 * Point a metadata write at the record rather than at a reference to it.
 *
 * A collection listing hands out reference ids, so this is the ordinary case,
 * not an exotic one. Measured against staging (plan 2026-08-17, F1/F2): a write
 * aimed at a reference is STORED on the reference, never reaches the original,
 * and the reference stops inheriting from then on. `verifyWrite` cannot catch
 * it — it re-reads the same node and finds exactly the value it wrote.
 *
 * Reads the DTO's `originalId`, never the `ccm:original` property: the property
 * points at the record itself on an original (measured, F6), so a rule built on
 * it needs a self-comparison and quietly reports every record as a reference to
 * itself when that comparison is forgotten. The DTO field is simply absent on an
 * original. The self-pointing case is still handled here, because the cost of
 * being wrong is a preview announcing a redirection nobody can check.
 *
 * Takes the node the caller has ALREADY read rather than an id of its own: every
 * write path reads the record first (to diff against it), so a second read would
 * add a round trip and, worse, could disagree with the first — and the change
 * set the user approves is built from the first. A node that cannot be read
 * never gets here; each tool refuses before a change set exists.
 *
 * Deliberately NOT applied to deletion. Measured 2026-08-17 (F10): deleting a
 * reference removes only the reference and leaves the record alone, so
 * redirecting a deletion would convert today's harmless behaviour into the
 * data loss this function exists to prevent.
 */
export function resolveWriteTarget(node: WloNode, requestedId: string): WriteTarget {
  const original = node.originalId;
  const redirected = original !== undefined && original !== requestedId;
  return {
    targetId: redirected ? original : requestedId,
    requestedId,
    redirected,
  };
}

/**
 * The target of a write plus the properties a change set must diff against.
 * `ok: false` when the target exists but could not be read — never a baseline
 * taken from somewhere else.
 */
export type WriteBaseline =
  | { ok: true; target: WriteTarget; before: Record<string, string[]> }
  | { ok: false; target: WriteTarget; reason: string };

/**
 * Resolve the write target AND fetch the state to compare against.
 *
 * `resolveWriteTarget` answers WHERE to write; this answers what is there now,
 * and the two are not the same question once a redirection is in play. A change
 * set diffed against the REFERENCE while writing to the ORIGINAL describes a
 * different record than the one being changed — and while a reference still
 * inherits, the two are identical and nothing looks wrong. They diverge exactly
 * when the reference was written to directly before (measured, F2 — the state
 * older versions of these tools produced), and then three things go wrong at
 * once: a field counts as unchanged because the REFERENCE already shows the
 * wanted value (so the original never receives it, and the tool reports
 * success), the preview shows the reference's value as "before", and a merged
 * field — keywords — merges into the reference's list and writes that over the
 * original's, dropping whatever only the original had.
 *
 * The extra read happens ONLY when redirected. In the ordinary case the node the
 * caller already has IS the target, and paying a round trip to confirm what is
 * in hand would be waste.
 *
 * An unreadable target refuses. Falling back to the reference's properties is
 * the one thing this function must not do: it would look like an ordinary diff
 * and silently describe the wrong record.
 */
export async function readWriteBaseline(node: WloNode, requestedId: string): Promise<WriteBaseline> {
  const target = resolveWriteTarget(node, requestedId);
  if (!target.redirected) return { ok: true, target, before: node.properties ?? {} };

  const original = await getNodeMetadata(target.targetId);
  if (!original) {
    return {
      ok: false,
      target,
      reason:
        `„${sanitizeText(requestedId)}“ ist eine Verknüpfung; geändert würde das Original `
        + `${sanitizeText(target.targetId)}, das aber nicht lesbar ist. Es wurde nichts geändert — `
        + 'ohne den aktuellen Stand des Originals wäre die Vorschau eine Aussage über den falschen Datensatz.',
    };
  }
  return { ok: true, target, before: original.properties ?? {} };
}

export interface FieldWriteStatus {
  property: string;
  ok: boolean;
  /** Why it failed — the upstream status and, when short enough, its message. */
  detail?: string;
}

export interface UpdateResult {
  statuses: FieldWriteStatus[];
}

export interface UpdateOptions {
  /** `true` writes a new version; `false` (the default while drafting) does not. */
  commit: boolean;
  /** Version history entry. Only used when committing. */
  versionComment?: string;
}

/** Used when a commit arrives without one — an empty history entry helps nobody. */
const DEFAULT_VERSION_COMMENT = 'Bearbeitet über den WLO-MCP-Server';

function nodePath(nodeId: string, suffix: string): string {
  return `${BASE_URL}/node/v1/nodes/-home-/${encodeURIComponent(nodeId)}/${suffix}`;
}

/**
 * A short, safe description of a failed upstream call for the user-facing report.
 *
 * The body is sanitized because it is foreign text on its way to the model: an
 * edu-sharing stack trace carries newlines, and a newline lets it end our
 * sentence and open a line that reads like one of ours. `sanitizeText` also caps
 * the length, which is why the slice here only bounds what is read.
 */
export async function failureDetail(res: Response): Promise<string> {
  let body = '';
  try {
    body = (await res.text()).slice(0, 200);
  } catch {
    // A body we cannot read is not worth failing over — the status carries the
    // information that matters.
  }
  const detail = sanitizeText(body);
  return detail ? `HTTP ${res.status}: ${detail}` : `HTTP ${res.status}`;
}

/**
 * Write MDS-routed properties in one call.
 * Returns null on success, or the failure detail.
 */
async function writeMetadata(
  nodeId: string,
  properties: Record<string, string[]>,
  opts: UpdateOptions,
): Promise<string | null> {
  const params = new URLSearchParams({ obeyMds: 'false' });
  if (opts.commit) {
    params.set('versionComment', (opts.versionComment ?? '').trim() || DEFAULT_VERSION_COMMENT);
  }
  const res = await wloFetch(`${nodePath(nodeId, 'metadata')}?${params}`, {
    method: opts.commit ? 'POST' : 'PUT',
    headers: HEADERS,
    body: JSON.stringify(properties),
    // A write carrying `ccm:wwwurl` waits for the repository's page render.
    signal: AbortSignal.timeout(writeTimeoutMs(properties)),
  });
  return res.ok ? null : await failureDetail(res);
}

/**
 * Write one property through the endpoint that bypasses the MDS entirely.
 * `null` as the value deletes the property.
 */
async function writeProperty(
  nodeId: string,
  property: string,
  values: string[] | null,
): Promise<string | null> {
  const params = new URLSearchParams({ property });
  const res = await wloFetch(`${nodePath(nodeId, 'property')}?${params}`, {
    method: 'POST',
    headers: HEADERS,
    body: JSON.stringify(values),
  });
  return res.ok ? null : await failureDetail(res);
}

/**
 * Write ONE property through the endpoint that bypasses the MDS.
 *
 * For properties outside `WRITABLE_FIELDS`, which is what `updateNodeMetadata`
 * routes by. `ccm:page_config` is one: it is a page-builder document, not a
 * metadata field, and putting it on the general write surface would let
 * `wlo_update_content` drop arbitrary JSON into it.
 *
 * Values only — deletion keeps its own name below, so no caller of this one has
 * to think about `null`.
 */
export async function setProperty(
  nodeId: string,
  property: string,
  values: string[],
): Promise<string | null> {
  return writeProperty(nodeId, property, values);
}

/**
 * Remove a property entirely.
 *
 * Only the property endpoint can express this: `null` as the body deletes,
 * where the metadata endpoint has no way to say "no value" as opposed to "empty
 * value". Exported rather than folded into `updateNodeMetadata`, whose value
 * type is `string[]` and should stay that way — a nullable value there would
 * make every caller think about deletion.
 */
export async function deleteProperty(nodeId: string, property: string): Promise<string | null> {
  return writeProperty(nodeId, property, null);
}

/**
 * Apply the desired values to a node, routing each property to the endpoint
 * that can actually write it.
 *
 * `desired` is expected to have passed `validateField` — this step is about
 * transport, not about what is allowed.
 *
 * A rejected bulk write is retried field by field: edu-sharing fails the whole
 * call over one unacceptable value, and losing four good edits to one bad one
 * would be a poor trade for the person who asked for them.
 */
export async function updateNodeMetadata(
  nodeId: string,
  desired: Record<string, string[]>,
  opts: UpdateOptions,
): Promise<UpdateResult> {
  const mdsFields: Record<string, string[]> = {};
  const propertyFields: [string, string[]][] = [];

  for (const [property, values] of Object.entries(desired)) {
    if (WRITABLE_FIELDS[property]?.route === 'property') propertyFields.push([property, values]);
    else mdsFields[property] = values;
  }

  const statuses: FieldWriteStatus[] = [];
  const mdsNames = Object.keys(mdsFields);

  if (mdsNames.length > 0) {
    const bulkFailure = await writeMetadata(nodeId, mdsFields, opts);
    if (!bulkFailure) {
      for (const property of mdsNames) statuses.push({ property, ok: true });
    } else if (mdsNames.length === 1) {
      // Nothing to isolate — the single field IS the failure.
      statuses.push({ property: mdsNames[0]!, ok: false, detail: bulkFailure });
    } else {
      log.warn('bulk metadata write rejected, retrying field by field', {
        nodeId, properties: mdsNames, detail: bulkFailure,
      });
      // The retry always DRAFTS. With `commit: true` each surviving field would
      // POST its own version, so one bad value out of five would leave four
      // history entries carrying the same comment for what was asked to be one
      // edit. The version is created once below, over whatever landed.
      const draft: UpdateOptions = { ...opts, commit: false };
      const landed: Record<string, string[]> = {};
      for (const property of mdsNames) {
        const failure = await writeMetadata(nodeId, { [property]: mdsFields[property]! }, draft);
        if (failure) {
          statuses.push({ property, ok: false, detail: failure });
        } else {
          statuses.push({ property, ok: true });
          landed[property] = mdsFields[property]!;
        }
      }
      if (opts.commit && Object.keys(landed).length > 0) {
        // Re-sending values the record already holds changes nothing except the
        // version history — which is the point: the curator asked for a version.
        const commitFailure = await writeMetadata(nodeId, landed, opts);
        if (commitFailure) {
          // The values are stored; only the history entry is missing. Reporting
          // the fields as failed would be worse than saying nothing here.
          log.warn('fields stored, but the version commit failed', { nodeId, detail: commitFailure });
        }
      }
    }
  }

  for (const [property, values] of propertyFields) {
    const failure = await writeProperty(nodeId, property, values);
    statuses.push(failure ? { property, ok: false, detail: failure } : { property, ok: true });
  }

  return { statuses };
}
