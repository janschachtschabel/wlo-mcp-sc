/**
 * services/write/update-many.ts – metadata for many records under ONE approval
 * (plan 2026-11-08, W3; on the plan runner of `wlo_add_to_collections`).
 *
 * Per record the server decides, field by field, what it WRITES and what it only
 * PROPOSES (`field-routing.ts`, user decision F5). A reference is written as its
 * original (F6, `readWriteBaseline` — the same rule as `wlo_update_content`, so
 * the change set is diffed against the ORIGINAL's values). Every write reads
 * back; the entry says what landed with `status`, `code` and `outcomeOpen`.
 *
 * No MCP import: the tool (`tools/curation-update-many.ts`) validates the
 * fields and renders; this module plans and executes.
 */

import { mapPool } from '../../concurrency.js';
import { flattenText } from '../../text-sanitize.js';
import { readNodeMetadata } from '../../wlo-node.js';
import { nodeTitle } from '../../node-match.js';
import { failureCode } from '../failure-code.js';
import { buildChangeSet, displayValue, type ChangeSet } from './change-set.js';
import { routeFields } from './field-routing.js';
import { readWriteBaseline, updateNodeMetadata } from './nodes.js';
import type { ItemState, PlanItem, Step } from './plan-runner.js';
import { createSuggestions, type SuggestionDraft } from './suggestions.js';
import { verifyWrite } from './verify.js';

export const UPDATE_MANY_MAX = 200;
/** Records read at once while the preview is built. */
const PREVIEW_POOL = 8;
/** What a proposal says when the caller gave no reason (the repository requires one). */
export const DEFAULT_REASON = 'Vorgeschlagen über wlo_update_contents (Metadaten für viele Datensätze).';

export interface UpdateInput { nodeId: string; desired: Record<string, string[]>; reason?: string }

export interface UpdateItem extends PlanItem {
  requestedId: string;
  targetId: string;
  title: string;
  /** What is WRITTEN — diffed against the original's stored values. */
  write: ChangeSet;
  /** What is PROPOSED — one draft per new value. */
  suggest: SuggestionDraft[];
}

export interface Prepared {
  items: UpdateItem[];
  unchanged: Array<{ nodeId: string; title: string }>;
  refused: Array<{ nodeId: string; code: 'not_found' | 'forbidden' | 'unreadable' | 'duplicate' | 'unreadable_original'; reason: string }>;
}

/** Read every record, resolve references, split write from proposal, drop what changes nothing. */
export async function prepareUpdates(inputs: UpdateInput[]): Promise<Prepared> {
  const read = await mapPool(inputs, PREVIEW_POOL, async (input) => {
    const { node, status } = await readNodeMetadata(input.nodeId);
    // Only a 404 says the record is not there; a 401/403 says this login may not
    // look (the code W1/W2 give); anything else says we could not look.
    if (!node) {
      return { input, outcome: status === 404 ? 'not_found' as const : status === 401 || status === 403 ? 'forbidden' as const : 'unreadable' as const };
    }
    const baseline = await readWriteBaseline(node, input.nodeId);
    // The ORIGINAL's title — the record that is written. A reference written
    // directly once (F2) carries a title of its own (overall review, 19).
    return { input, outcome: baseline, title: nodeTitle(baseline.ok ? { ...node, properties: baseline.before } : node) };
  });

  const out: Prepared = { items: [], unchanged: [], refused: [] };
  const seen = new Set<string>();
  read.forEach((r, i) => {
    const input = inputs[i]!;
    if (r?.outcome === 'not_found') {
      out.refused.push({ nodeId: input.nodeId, code: 'not_found', reason: 'nicht gefunden' });
      return;
    }
    if (r?.outcome === 'forbidden') {
      out.refused.push({ nodeId: input.nodeId, code: 'forbidden', reason: 'mit dieser Anmeldung nicht lesbar' });
      return;
    }
    // `mapPool` answers a throw with null: a read that failed, not a missing record.
    if (!r || r.outcome === 'unreadable') {
      out.refused.push({ nodeId: input.nodeId, code: 'unreadable', reason: 'gerade nicht lesbar — ob es ihn gibt, ist offen' });
      return;
    }
    if (!r.outcome.ok) {
      out.refused.push({ nodeId: input.nodeId, code: 'unreadable_original', reason: r.outcome.reason });
      return;
    }
    const { target, before } = r.outcome;
    // Two names for one record would race each other's read-back.
    if (seen.has(target.targetId)) {
      out.refused.push({ nodeId: input.nodeId, code: 'duplicate', reason: `derselbe Datensatz wie ein früherer Eintrag (${target.targetId})` });
      return;
    }
    seen.add(target.targetId);
    const routed = routeFields(input.desired);
    const write = buildChangeSet(target.targetId, 'content', before, routed.write,
      target.redirected ? { redirectedFrom: target.requestedId } : {});
    const proposal = buildChangeSet(target.targetId, 'content', before, routed.suggest);
    const reason = input.reason?.trim() || DEFAULT_REASON;
    const suggest = proposal.changes.flatMap(c => (c.after ?? [])
      .filter(v => !(c.before ?? []).includes(v))
      .map(value => ({ propertyId: c.property, value, description: reason })));
    const title = r.title || input.nodeId;
    if (write.changes.length === 0 && suggest.length === 0) {
      out.unchanged.push({ nodeId: input.nodeId, title });
      return;
    }
    out.items.push({ key: target.targetId, requestedId: input.nodeId, targetId: target.targetId, title, write, suggest });
  });
  return out;
}

const shown = (property: string, values: string[] | null) =>
  (values ?? []).map(v => `„${flattenText(displayValue(property, v))}“`).join(', ') || '(leer)';

/**
 * One written field: before → after, so a replaced subject names what is lost.
 * A merged list (keywords) names the WHOLE list that is sent and what of it is
 * new: the existing entries are sent too, so they belong in what is approved
 * (overall review, 7). The old value is in the line, so it is in the
 * fingerprint — a change made between preview and confirmation meets
 * `confirm_mismatch` instead of being overwritten unseen (review P3).
 */
function changeText(c: ChangeSet['changes'][number]): string {
  if (c.property === 'cclom:general_keyword') {
    const added = (c.after ?? []).filter(v => !(c.before ?? []).includes(v));
    return `${c.label} ${shown(c.property, c.after)} (neu: ${shown(c.property, added)})`;
  }
  return `${c.label} ${shown(c.property, c.before)} → ${shown(c.property, c.after)}`;
}

/** The record as data, for the structured preview: what is written (with before) and what is proposed. */
export function planView(item: UpdateItem) {
  return {
    nodeId: item.requestedId,
    ...(item.requestedId !== item.targetId ? { targetId: item.targetId } : {}),
    write: item.write.changes.map(c => ({ property: c.property, before: c.before, after: c.after })),
    suggest: item.suggest.map(d => ({ propertyId: d.propertyId, value: d.value })),
  };
}

/**
 * One record as the person approves it — EVERYTHING the call will send, in
 * full (`flattenText`, never a capping `sanitizeText`: the key binds to this
 * line, and two lines sharing a capped prefix would share a key).
 */
export function updateLine(item: UpdateItem): string {
  const who = `„${flattenText(item.title)}“ (${item.requestedId}`
    + `${item.requestedId !== item.targetId ? ` → Original ${item.targetId}` : ''})`;
  const parts: string[] = [];
  if (item.write.changes.length) {
    parts.push(`schreibt ${item.write.changes.map(changeText).join('; ')}`);
  }
  if (item.suggest.length) {
    const byField = new Map<string, string[]>();
    for (const d of item.suggest) byField.set(d.propertyId, [...(byField.get(d.propertyId) ?? []), d.value]);
    const proposal = buildChangeSet(item.targetId, 'content', {}, Object.fromEntries(byField));
    parts.push(`schlägt vor ${proposal.changes.map(c => `${c.label} ${shown(c.property, c.after)}`).join('; ')}`
      + ` (Begründung: ${flattenText(item.suggest[0]!.description)})`);
  }
  return `${who}: ${parts.join(' — ')}`;
}

/** The values to send — from the change set, so a merged list (keywords) keeps what was there. */
function desiredOf(cs: ChangeSet): Record<string, string[]> {
  return Object.fromEntries(cs.changes.map(c => [c.property, c.after ?? []]));
}

const same = (a: string[] | null | undefined, b: string[] | null | undefined) => JSON.stringify(a ?? []) === JSON.stringify(b ?? []);

/**
 * Right before the write: does every field still hold the value the person saw
 * as "before"? A plan writes for up to 30 minutes after its approval, and a
 * value someone set in between would otherwise be overwritten unseen — while
 * the read-back reported `stored` (overall review, 13). Nothing is sent when it
 * fails, so `outcomeOpen` is false. Only asked when something is WRITTEN: a
 * proposal changes no value.
 */
async function changedSinceApproval(item: UpdateItem): Promise<ItemState | null> {
  if (!item.write.changes.length) return null;
  const { node, status } = await readNodeMetadata(item.targetId).catch(() => ({ node: null, status: 0 }));
  if (!node) return { status: 'failed', code: status === 404 ? 'not_found' : 'unreadable', outcomeOpen: false };
  const now = node.properties ?? {};
  return item.write.changes.every(c => same(now[c.property], c.before))
    ? null
    : { status: 'failed', code: 'changed_since_preview', outcomeOpen: false };
}

/**
 * Execute one record: write (and read back), then propose. `outcomeOpen` is
 * false only where it is KNOWN nothing landed — the same reading every other
 * error after a confirmation follows.
 */
export const updateStep: Step<UpdateItem> = async (item): Promise<ItemState> => {
  // No `nodeId` in the state: the answer spreads the state over the entry's
  // own ids, and the original's id would overwrite the id the caller named
  // (the entry carries `targetId` for that).
  const changed = await changedSinceApproval(item);
  if (changed) return changed;
  let written = 0;
  let notStored = 0;
  let changedOther = false;
  let firstCode: string | undefined;
  let unverified = false;

  if (item.write.changes.length) {
    try {
      const cs = item.write;
      const { statuses } = await updateNodeMetadata(cs.nodeId, desiredOf(cs), { commit: false });
      const rejected = statuses.find(s => !s.ok);
      if (rejected) firstCode = failureCode(new Error(rejected.detail ?? ''));
    } catch (err) {
      // The request may have reached the repository before the answer was lost.
      return { status: 'failed', code: failureCode(err), outcomeOpen: true };
    }
    try {
      const verified = await verifyWrite(item.write);
      for (const c of item.write.changes) {
        const o = verified.outcomes[c.property] ?? 'dropped';
        if (o === 'stored') written++;
        else { notStored++; if (o === 'changed') changedOther = true; }
      }
    } catch {
      unverified = true;
    }
  }

  let suggested = 0;
  let suggestFailed = false;
  let suggestOpen = false;
  if (item.suggest.length) {
    try {
      const out = await createSuggestions(item.targetId, item.suggest);
      // What the repository says it created, not what was asked for: an empty
      // list over a request for some is no proof either way (overall review, 8).
      if (out.ok && out.suggestions.length) suggested = out.suggestions.length;
      else if (out.ok) { suggestFailed = true; suggestOpen = true; unverified = true; }
      else {
        suggestFailed = true;
        if (out.open) suggestOpen = true;
        firstCode ??= failureCode(new Error(out.detail));
      }
    } catch (err) {
      suggestFailed = true;
      suggestOpen = true;
      firstCode ??= failureCode(err);
    }
  }

  const counts = { written, suggested };
  if (unverified) return { status: 'unverified', code: suggestFailed ? 'suggest_failed' : 'unverified', outcomeOpen: true, ...counts };
  if (notStored === 0 && !suggestFailed) {
    return { status: item.write.changes.length ? 'stored' : 'suggested', ...counts };
  }
  const landed = written > 0 || changedOther || suggested > 0;
  if (landed) {
    // The refusal's own code where there is one (a foreign record: forbidden).
    return { status: 'partly', code: notStored ? (firstCode ?? 'not_stored') : 'suggest_failed', outcomeOpen: true, ...counts };
  }
  return { status: 'not_stored', code: firstCode ?? 'not_stored', outcomeOpen: suggestOpen, ...counts };
};
