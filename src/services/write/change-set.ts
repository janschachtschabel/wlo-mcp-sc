/**
 * services/write/change-set.ts – the concrete diff a person confirms.
 *
 * Everything a write tool intends to do is first expressed here, as a list of
 * old value → new value, and rendered in German for the user. Two properties
 * are load-bearing:
 *
 *   - Unchanged fields are dropped. A preview listing ten fields of which one
 *     actually changes trains people to skim it, and a skimmed confirmation is
 *     no confirmation.
 *   - Every value is sanitized before it is rendered. The values come out of
 *     the repository, written by someone else; without flattening, a title
 *     containing line breaks could end the sentence around it and open what
 *     reads like a fresh instruction block.
 *
 * The ChangeSet is also what a confirmation token is bound to (`confirm.ts`),
 * so its shape decides what "the same change" means.
 */

import { flattenText } from '../../text-sanitize.js';
import { cutAtWordBoundary } from '../../text-cap.js';
import { WRITABLE_FIELDS, type FieldRoute } from './fields.js';

export type ChangeKind = 'content' | 'collection' | 'compendium' | 'topic-page';

export interface FieldChange {
  property: string;
  /** German label shown in the preview. */
  label: string;
  before: string[] | null;
  after: string[] | null;
  route: FieldRoute;
}

export interface ChangeSet {
  /** The node that will be written. Not necessarily the one the caller named. */
  nodeId: string;
  kind: ChangeKind;
  changes: FieldChange[];
  /** True for deletions — the tools word and confirm those differently. */
  destructive: boolean;
  /** Title of the affected node at planning time, for the deletion preview. */
  title: string;
  /**
   * The id the caller named, when it is NOT the one being written: they named a
   * collection reference and the write was redirected to the original
   * (`resolveWriteTarget`).
   *
   * It is carried in the change set rather than handled inside the write call
   * because the token binds to this object. A redirection decided after the
   * preview would move the write to a record the user never saw named — the
   * same hole as sending a different field with an approved token.
   */
  redirectedFrom?: string;
  /**
   * A mutation that changes no field but still needs confirming — submitting a
   * record for review, adding it to a collection. One German sentence, rendered
   * as the first line of the preview and part of what the token is bound to.
   */
  action?: string;
}

/** Properties whose new values are added to what is there, not put in its place. */
const MERGED_PROPERTIES = new Set(['cclom:general_keyword']);

function sameValues(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

/**
 * Union of existing and new values, comparing case-insensitively so that adding
 * "mathematik" to a record already tagged "Mathematik" is correctly recognised
 * as no change at all. Existing spellings are kept — re-casing someone else's
 * keyword is not what was asked for.
 */
function merge(before: string[], added: string[]): string[] {
  const seen = new Set(before.map(v => v.toLowerCase()));
  const out = [...before];
  for (const v of added) {
    if (seen.has(v.toLowerCase())) continue;
    seen.add(v.toLowerCase());
    out.push(v);
  }
  return out;
}

/**
 * Build the diff between a node's current properties and the desired values.
 *
 * `desired` is expected to have passed `validateField` already — this step is
 * about what changes, not about what is allowed.
 */
export function buildChangeSet(
  nodeId: string,
  kind: ChangeKind,
  before: Record<string, string[]>,
  desired: Record<string, string[]>,
  opts: { destructive?: boolean; action?: string; redirectedFrom?: string } = {},
): ChangeSet {
  const changes: FieldChange[] = [];

  for (const [property, values] of Object.entries(desired)) {
    const spec = WRITABLE_FIELDS[property];
    if (!spec) continue; // unknown properties were already rejected upstream
    const current = before[property] ?? [];
    const after = MERGED_PROPERTIES.has(property) ? merge(current, values) : values;
    if (sameValues(current, after)) continue;
    changes.push({
      property,
      label: spec.label,
      before: current.length > 0 ? current : null,
      after,
      route: spec.route,
    });
  }

  return {
    nodeId,
    kind,
    changes,
    destructive: opts.destructive === true,
    title: before['cclom:title']?.[0] ?? before['cm:name']?.[0] ?? '',
    ...(opts.action ? { action: opts.action } : {}),
    ...(opts.redirectedFrom ? { redirectedFrom: opts.redirectedFrom } : {}),
  };
}

/** True when there is something for the user to confirm. */
export function hasSomethingToConfirm(cs: ChangeSet): boolean {
  return cs.changes.length > 0 || cs.destructive || cs.action !== undefined;
}

/**
 * How much of ONE value the preview shows before it has to say it cut something.
 *
 * Not a safety limit — `flattenText` below is what makes a value safe to embed,
 * and it runs whatever the length. This is the reading budget, and it used to be
 * `sanitizeText`'s 120 characters: enough for a title, far too little for the
 * fields that carry prose. The write surface allows 20 000 characters for a
 * description and 100 000 for a compendium text (`fields.ts`), so the routine
 * case was a person approving text the preview never showed them. 600 fits
 * essentially every real WLO description whole, which turns truncation from the
 * normal case back into the exception it should be.
 */
const VALUE_PREVIEW_MAX = 600;

/**
 * One foreign value, made safe and made readable — and honest about the
 * difference when the two conflict.
 *
 * `sanitizeText` cuts at 120 with a bare ellipsis, which says *that* something
 * was left out but never *how much*. Over a 20 000-character description that
 * reads like a rounding, not like an omission, and the token binds the full
 * value regardless. So the cut is disclosed with the total length, the way
 * `text-cap.ts` states the rule for every other truncation in this codebase.
 */
function previewValue(raw: string): string {
  const flat = flattenText(raw);
  if (flat.length <= VALUE_PREVIEW_MAX) return flat;
  return `${cutAtWordBoundary(flat, VALUE_PREVIEW_MAX)} […] (Anfang gezeigt, insgesamt ${flat.length} Zeichen)`;
}

/**
 * Quoted so the reader can see where a value begins and ends — trailing spaces
 * and commas are otherwise invisible. `(leer)` stays unquoted: it is a
 * statement about the field, not a value it holds.
 */
function renderValues(values: string[] | null): string {
  if (!values || values.length === 0) return '(leer)';
  return `„${previewValue(values.join(', '))}“`;
}

/**
 * Render the diff as the German preview the user reads before confirming.
 * One change per line, so a long list stays scannable.
 */
export function renderChangeSet(cs: ChangeSet): string {
  const lines: string[] = [];

  // First, ahead of the action and every field: WHICH record is edited outranks
  // what changes in it. A reader who stops after one line must not have missed
  // that the id they passed is not the id that changes. Both ids are flattened
  // like every other foreign value here — one of them came from the caller.
  //
  // What it does NOT say is that the reference will show the new value. It
  // usually will, by inheritance — but a reference that was overridden once
  // keeps its own value for good (measured, F2), and this preview has not read
  // it. An unverified promise is the one thing a confirmation must not contain.
  if (cs.redirectedFrom) {
    lines.push(
      `Achtung: „${flattenText(cs.redirectedFrom)}“ ist eine Verknüpfung in einer Sammlung, `
        + `kein eigener Datensatz. Geändert wird das Original: ${flattenText(cs.nodeId)}.`,
    );
  }

  // Flattened, not capped. The action is a whole sentence built from parts that
  // were sanitized individually (a title via `recordTitle`, a suggestion id via
  // `sanitizeText`); capping it again spends the 120-character budget on the
  // fixed German prose. Measured: a submit preview then ended at "… zur…" and a
  // decline preview — which has no field changes and is therefore ONLY this line
  // — lost both the nodeId and the clause saying the record stays untouched.
  if (cs.action) lines.push(flattenText(cs.action));

  if (cs.destructive) {
    // The title is WHAT is being deleted, so a silent cut here is the worst
    // place for one: the reader would confirm the removal of a record they
    // cannot fully name.
    const what = cs.title ? previewValue(cs.title) : '(ohne Titel)';
    lines.push(`Löscht: ${what} (${cs.nodeId})`);
  }

  for (const c of cs.changes) {
    if (MERGED_PROPERTIES.has(c.property)) {
      const existing = new Set((c.before ?? []).map(v => v.toLowerCase()));
      const added = (c.after ?? []).filter(v => !existing.has(v.toLowerCase()));
      lines.push(`${c.label}: + ${previewValue(added.join(', '))}`);
      continue;
    }
    lines.push(`${c.label}: ${renderValues(c.before)} → ${renderValues(c.after)}`);
  }

  if (lines.length === 0) return 'Keine Änderung — die gewünschten Werte stehen bereits so im Datensatz.';
  return lines.join('\n');
}
