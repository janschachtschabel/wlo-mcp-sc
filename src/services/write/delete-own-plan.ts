/**
 * services/write/delete-own-plan.ts – delete the person's OWN records, and only
 * those (plan 2026-11-20, chatbot team: "Gliederungsdatei aus WLO löschen").
 *
 * `wlo_delete_content` deletes whatever the login may delete — for an editorial
 * account far more than its own uploads. This plan deletes a record only when
 * the SERVER finds, right before the delete:
 *
 * - it is a record (`ccm:io`), not a collection, a folder or a collection's
 *   reference;
 * - its `cm:creator` is this login's account (measured 2026-11-20: the creator
 *   is the authority the identity reports; `cm:owner` is not). The account is
 *   `accountOf` — the one a block's issuance confirmed, else the name as typed;
 *   compared without case, as the repository's account names are. A login typed
 *   in another spelling than its account only ever reads `not_own`;
 * - its primary parent is the person's home folder, or a plain folder there (a
 *   `ccm:map` without the collection aspect — a batch filing's folder), up to
 *   `HOME_FOLDER_DEPTH` folders deep;
 * - it has no usage (`/usage/v1`: a reference into a collection, a course, an
 *   app) — a record in the home may still be referenced from a collection, and
 *   that reference does not change its primary parent (measured);
 * - it is not public.
 *
 * The first condition not met is the node's code, and the node stays — an
 * answer per node, not a failure of the call. What cannot be found out keeps
 * the node too (`not_checked`): "not used" and "own" are decided by reading,
 * never by a missing answer. One function (`checkOwnDeletable`) decides for the
 * preview and for the step, so the two cannot drift apart.
 */

import { currentCredential } from '../../auth/credential.js';
import { isReferenceNode, wrongKind } from '../../node-kind.js';
import { readNodeMetadata, getNodeUsageCount } from '../../wlo-node.js';
import { mapPool } from '../../concurrency.js';
import { sanitizeText } from '../../text-sanitize.js';
import { quotedTitle } from '../../text-line.js';
import { isRefusal, wroteNothing } from '../../upstream-error.js';
import { titleFromProperties } from '../../node-match.js';
import { failureCode } from '../failure-code.js';
import { log } from '../../logger.js';
import { accountOf } from './confirm.js';
import { deleteContentNode } from './nodes-lifecycle.js';
import { isOutcomeOpen } from './timeouts.js';
import type { ItemState, PlanItem, Step } from './plan-runner.js';

/** A batch filing holds up to five outlines; ten leaves room without making this a mass delete. */
export const OWN_DELETE_MAX = 10;
/** Folders between a record and the home that still count as "in the home" (a filing folder is one). */
const HOME_FOLDER_DEPTH = 3;
const READ_POOL = 4;
const PROPS = ['cm:creator', 'virtual:primaryparent_nodeid', 'cclom:title', 'cm:title', 'cm:name'];

export type KeepCode =
  | 'not_found' | 'is_a_collection' | 'is_a_folder' | 'not_a_record' | 'is_reference'
  | 'not_own' | 'not_in_home' | 'in_use' | 'is_public' | 'not_checked';

export interface OwnItem extends PlanItem {
  nodeId: string;
  title: string;
  /** A delete of THIS plan left for the repository (its answer may be missing). */
  sent?: boolean;
}

/** Who is asking and where their home is — read for every decision, never assumed. */
export interface OwnContext { account: string; home: string }

export type Verdict =
  | { kind: 'ok'; title: string }
  | { kind: 'keep'; code: KeepCode; title: string }
  /** Not there (404), or refused to this login (`refused`) — only a 404 proves a delete. */
  | { kind: 'gone'; refused: boolean }
  | { kind: 'unknown'; title: string };

/** This personal login's account and its home folder's id; `null` without a personal login or when the home is not readable. */
export async function ownContext(): Promise<OwnContext | null> {
  const cred = currentCredential();
  if (cred?.source !== 'user') return null;
  const home = await readNodeMetadata('-userhome-', ['cm:name']);
  const homeId = home.node?.ref?.id;
  return homeId ? { account: accountOf(cred).trim().toLowerCase(), home: homeId } : null;
}

/** First value of a property. */
function first(props: Record<string, string[] | undefined> | undefined, key: string): string | undefined {
  return props?.[key]?.[0];
}

/** Is `parent` the home, or a plain folder that leads there? `null` = a folder on the way was not readable. */
async function inHome(parent: string | undefined, home: string): Promise<boolean | null> {
  let at = parent;
  for (let depth = 0; at; depth++) {
    if (at === home) return true;
    // Past the cap nothing more is read: deeper is not the home.
    if (depth >= HOME_FOLDER_DEPTH) return false;
    const folder = await readNodeMetadata(at, ['virtual:primaryparent_nodeid']);
    if (!folder.node) return isRefusal(folder.status) || folder.status === 404 ? false : null;
    // Only a plain folder leads on; a collection on the way is a collection's content, not the person's own area.
    if (wrongKind(folder.node, 'content')?.code !== 'is_a_folder') return false;
    at = first(folder.node.properties, 'virtual:primaryparent_nodeid');
  }
  return false;
}

/**
 * The one decision, for the preview and again right before the delete. The
 * conditions are checked in the order of the plan's table; the first one not
 * met is the code.
 */
export async function checkOwnDeletable(nodeId: string, ctx: OwnContext): Promise<Verdict> {
  const read = await readNodeMetadata(nodeId, PROPS);
  const node = read.node;
  if (!node) {
    if (read.status === 404) return { kind: 'gone', refused: false };
    if (isRefusal(read.status)) return { kind: 'gone', refused: true };
    return { kind: 'unknown', title: nodeId };
  }
  const title = sanitizeText(titleFromProperties(node.properties) || node.title || nodeId);
  const keep = (code: KeepCode): Verdict => ({ kind: 'keep', code, title });
  const wrong = wrongKind(node, 'content');
  if (wrong) return keep(wrong.code === 'is_a_collection' || wrong.code === 'is_a_folder' ? wrong.code : 'not_a_record');
  if (isReferenceNode(node)) return keep('is_reference');
  if ((first(node.properties, 'cm:creator') ?? '').trim().toLowerCase() !== ctx.account) return keep('not_own');
  const home = await inHome(first(node.properties, 'virtual:primaryparent_nodeid'), ctx.home);
  if (home === null) return { kind: 'unknown', title };
  if (!home) return keep('not_in_home');
  const usages = await getNodeUsageCount(nodeId);
  if (usages === null) return { kind: 'unknown', title };
  if (usages > 0) return keep('in_use');
  // Only an explicit `false` is "not public"; a missing field decides nothing (the node stays).
  if (node.isPublic === true) return keep('is_public');
  if (node.isPublic !== false) return { kind: 'unknown', title };
  return { kind: 'ok', title };
}

export interface Resolved {
  items: OwnItem[];
  /** The nodes that stay, with their code — decided now, shown in the preview, not asked again. */
  kept: Map<string, KeepCode>;
}

/** Read every named node. `null` when who is asking or their home cannot be found out. */
export async function resolveOwnDeletions(ids: string[]): Promise<Resolved | null> {
  const ctx = await ownContext();
  if (!ctx) return null;
  const unique = [...new Set(ids.map(id => id.trim()))];
  const verdicts = await mapPool(unique, READ_POOL, id => checkOwnDeletable(id, ctx));
  const kept = new Map<string, KeepCode>();
  const items = unique.map((id, i): OwnItem => {
    const v = verdicts[i] ?? { kind: 'unknown' as const, title: id };
    if (v.kind === 'gone') kept.set(id, 'not_found');
    else if (v.kind === 'keep') kept.set(id, v.code);
    else if (v.kind === 'unknown') kept.set(id, 'not_checked');
    return { key: id, nodeId: id, title: v.kind === 'gone' ? id : v.title };
  });
  return { items, kept };
}

/** What the person is told a code means — in the preview and in the answer. */
export const KEEP_TEXT: Readonly<Record<KeepCode, string>> = {
  not_found: 'nicht gefunden oder nicht lesbar',
  is_a_collection: 'ist eine Sammlung, kein Datensatz',
  is_a_folder: 'ist ein Ordner, kein Datensatz',
  not_a_record: 'ist kein Datensatz',
  is_reference: 'ist eine Verknüpfung in einer Sammlung, nicht der Datensatz selbst',
  not_own: 'nicht von dieser Anmeldung angelegt',
  not_in_home: 'liegt nicht im persönlichen Bereich',
  in_use: 'wird verwendet (etwa in einer Sammlung)',
  is_public: 'ist öffentlich',
  not_checked: 'ließ sich gerade nicht prüfen',
};

/** The preview line of one node — part of what the key authorises. */
export function ownDeleteLine(item: OwnItem, code: KeepCode | undefined): string {
  // The id first, then the title through `quotedTitle`: a title is the repository's text, and a quote mark in
  // it must not close the pair and forge a second line in a preview a person acts on.
  return `${item.nodeId} ${quotedTitle(item.title)}: ${code ? `bleibt — ${KEEP_TEXT[code]}` : 'wird gelöscht'}`;
}

/** The step: the conditions again, right before the delete; then the delete. */
export function deleteOwnStep(): Step<OwnItem> {
  // Read once per call's run (the runner starts steps in waves); a later call reads it again.
  let context: Promise<OwnContext | null> | undefined;
  return async (item): Promise<ItemState> => {
    try {
      const ctx = await (context ??= ownContext());
      if (!ctx) return { status: 'pending', code: 'not_checked', outcomeOpen: Boolean(item.sent) };
      const verdict = await checkOwnDeletable(item.nodeId, ctx);
      // Not there: only a 404 after a delete of this plan is OUR delete. A refused look proves nothing — open.
      if (verdict.kind === 'gone') {
        if (!item.sent) return { status: 'kept', code: 'not_found' };
        return verdict.refused ? { status: 'failed', code: 'forbidden', outcomeOpen: true } : { status: 'deleted' };
      }
      if (verdict.kind === 'unknown') return { status: 'pending', code: 'not_checked', outcomeOpen: Boolean(item.sent) };
      if (verdict.kind === 'keep') return { status: 'kept', code: verdict.code };

      item.sent = true;
      const outcome = await deleteContentNode(item.nodeId);
      if (outcome.status === 'ok') return { status: 'deleted' };
      if (outcome.status === 'failed') {
        log.warn('own delete step failed', { nodeId: item.nodeId, detail: outcome.detail });
        // A refusal deleted nothing. Anything else is looked at again: gone then is OUR delete.
        if (wroteNothing(outcome.httpStatus ?? 0)) return { status: 'failed', code: failureCode(outcome.detail), outcomeOpen: false };
        return { status: 'pending', code: failureCode(outcome.detail) };
      }
      return { status: 'unverified', outcomeOpen: true };
    } catch (err) {
      if (isOutcomeOpen(err)) return { status: 'pending', code: 'timeout' };
      log.warn('own delete step failed', { nodeId: item.nodeId, error: err instanceof Error ? err.message : String(err) });
      return { status: 'failed', code: failureCode(err), ...(item.sent ? { outcomeOpen: true } : {}) };
    }
  };
}
