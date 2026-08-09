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

import { BASE_URL } from '../../wlo-config.js';
import { wloFetch, HEADERS } from '../../wlo-fetch.js';
import { log } from '../../logger.js';
import { sanitizeText } from '../../text-sanitize.js';
import { WRITABLE_FIELDS } from './fields.js';


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
