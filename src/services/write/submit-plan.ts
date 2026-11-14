/**
 * services/write/submit-plan.ts – many records to the editorial queue as ONE
 * plan (chatbot team, S4, 2026-11-14).
 *
 * The step is the one `wlo_submit_content` takes (`submitForReview`, with its
 * read-back). What the plan adds:
 *
 * - Every id is read BEFORE the preview: it must be a readable single record.
 *   One unusable id refuses the whole call, named with the code the single
 *   tool gives — an approval must not cover a list nobody could check.
 * - A record already in the queue is `already` and sends nothing. Decided for
 *   the preview AND again in the step: the plan writes up to thirty minutes
 *   after its approval, and a second submission would leave a receipt that is
 *   not its own (the reason the single tool refuses it).
 * - An aborted submission stays OPEN. The next call reads the record; a status
 *   that is there after OUR request left is our submission, not "already".
 */

import { wrongKind, type KindMismatch } from '../../node-kind.js';
import { readNodeMetadata } from '../../wlo-api.js';
import { mapPool } from '../../concurrency.js';
import { sanitizeText } from '../../text-sanitize.js';
import { nodeTitle } from '../../node-match.js';
import { isRefusal } from '../../upstream-error.js';
import { failureCode } from '../failure-code.js';
import { log } from '../../logger.js';
import { REVIEW_STATUS, submitForReview } from './nodes-lifecycle.js';
import { isOutcomeOpen } from './timeouts.js';
import type { ItemState, PlanItem, Step } from './plan-runner.js';

/** The frame of the other batch tools (chatbot team, 2026-11-06). */
export const SUBMIT_MAX = 200;
const READ_POOL = 4;
const STATUS_PROPS = ['cclom:title', 'cm:title', 'cm:name', 'ccm:wf_status'];

export interface SubmitItem extends PlanItem {
  nodeId: string;
  title: string;
  /** A submission of THIS plan left for the repository (its answer may be missing). */
  sent?: boolean;
}

export interface SubmitRefusal {
  nodeId: string;
  /** The codes `wrongKind` gives for "expected a record", plus `not_found`. */
  code: 'not_found' | KindMismatch['code'];
}

const inQueue = (properties: Record<string, string[]> | undefined) => properties?.['ccm:wf_status']?.[0] === REVIEW_STATUS;

/** Read every record; refuse with one reason per unusable id. `already` holds the keys that need no step. */
export async function resolveSubmissions(ids: string[]): Promise<
  | { ok: true; items: SubmitItem[]; already: Set<string> }
  | { ok: false; reasons: string[]; refused: SubmitRefusal[] }
  /** A read did not ANSWER: nothing is known about that record, and "not found" would be a claim. */
  | { ok: false; unread: string[] }
> {
  const unique = [...new Set(ids.map(id => id.trim()))];
  // Full projection is not needed, but the KIND is: type and aspects come with every projection.
  const read = await mapPool(unique, READ_POOL, id => readNodeMetadata(id, STATUS_PROPS));
  const reasons: string[] = [];
  const refused: SubmitRefusal[] = [];
  const items: SubmitItem[] = [];
  const already = new Set<string>();
  const unread: string[] = [];
  unique.forEach((id, i) => {
    const node = read[i]?.node;
    // `mapPool` turns a throw into null: an outage, like a 5xx.
    if (!node && !(read[i] && isRefusal(read[i]!.status))) { unread.push(id); return; }
    if (!node) {
      reasons.push(`Der Datensatz „${sanitizeText(id)}“ wurde nicht gefunden oder ist nicht lesbar.`);
      refused.push({ nodeId: id, code: 'not_found' });
      return;
    }
    const wrong = wrongKind(node, 'content');
    if (wrong) {
      reasons.push(`„${sanitizeText(id)}“ ${wrong.reason}`);
      refused.push({ nodeId: id, code: wrong.code });
      return;
    }
    items.push({ key: id, nodeId: id, title: sanitizeText(nodeTitle(node) || id) });
    if (inQueue(node.properties)) already.add(id);
  });
  if (reasons.length) return { ok: false, reasons, refused };
  return unread.length ? { ok: false, unread } : { ok: true, items, already };
}

/** The preview line of one record — part of what the token authorises. */
export function submitLine(item: SubmitItem, already: boolean): string {
  return `„${item.title}“ (${item.nodeId})${already ? ` — liegt schon zur Prüfung vor (Status ${REVIEW_STATUS}), kein Schritt` : ''}`;
}

/**
 * The workflow PUT came back non-OK. A 4xx is a refusal: nothing was written.
 * A 5xx is not that — a proxy may answer 502/504 while the PUT lands — so the
 * record is read before anything is said: in the queue, it is our submission.
 */
async function afterRefusedPut(item: SubmitItem, detail: string): Promise<ItemState> {
  const code = failureCode(detail);
  const status = Number(/\bHTTP (\d{3})\b/.exec(detail)?.[1] ?? 0);
  if (status >= 400 && status < 500 && status !== 429) return { status: 'failed', code, outcomeOpen: false };
  const after = await readNodeMetadata(item.nodeId, STATUS_PROPS);
  if (after.node && inQueue(after.node.properties)) return { status: 'submitted' };
  // Busy, or not readable: the next call looks again before it sends again.
  if (!after.node || code === 'upstream_busy') return { status: 'pending', code };
  return { status: 'failed', code, outcomeOpen: true };
}

export function submitStep(comment: string): Step<SubmitItem> {
  return async (item): Promise<ItemState> => {
    try {
      // Right before the write, not only at the preview (see the head of this file).
      const now = await readNodeMetadata(item.nodeId, STATUS_PROPS);
      if (!now.node) {
        // Gone or closed since the preview: an answer, and nothing was sent by this step.
        if (isRefusal(now.status)) return { status: 'failed', code: now.status === 404 ? 'not_found' : 'forbidden', outcomeOpen: Boolean(item.sent) };
        // Not readable right now: submitting blind could be the second submission.
        // Nothing left for the repository in THIS step unless an earlier try sent.
        return { status: 'pending', code: 'not_checked', outcomeOpen: Boolean(item.sent) };
      }
      if (inQueue(now.node.properties)) return { status: item.sent ? 'submitted' : 'already' };

      // Set BEFORE the request leaves: an abort hits the answer, not the work.
      item.sent = true;
      const outcome = await submitForReview(item.nodeId, comment);
      switch (outcome.status) {
        case 'submitted': return { status: 'submitted' };
        // Answered with success, and the record shows no submission: nothing is in the queue.
        case 'dropped': return { status: 'not_stored', code: 'dropped' };
        case 'unverified': return { status: 'unverified', outcomeOpen: true };
        default:
          log.warn('batch submission step failed', { nodeId: item.nodeId, detail: outcome.detail });
          return await afterRefusedPut(item, outcome.detail);
      }
    } catch (err) {
      // Open, not failed: the next call reads the record before it sends again.
      if (isOutcomeOpen(err)) return { status: 'pending', code: 'timeout' };
      log.warn('batch submission step failed', { nodeId: item.nodeId, error: err instanceof Error ? err.message : String(err) });
      return { status: 'failed', code: failureCode(err), ...(item.sent ? { outcomeOpen: true } : {}) };
    }
  };
}
