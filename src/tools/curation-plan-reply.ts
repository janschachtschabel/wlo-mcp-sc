/**
 * tools/curation-plan-reply.ts – what a planned, multi-call write answers
 * (`wlo_create_collection_tree`, `wlo_add_to_collections`; BOERDi wishlist
 * items 6 and 7, decision E4 = B, 2026-11-06 — and since 2026-11-08
 * `wlo_update_contents` and `wlo_attach_fulltexts`, which list `items`).
 *
 * All of them run on `services/write/plan-runner.ts` and must answer in ONE
 * shape, because the chatbot drives both with the same loop: `complete`,
 * `progress`, one entry per plan step, and a `continuationToken` while
 * anything is open. A second copy of this shape is where the two would drift.
 */

import type { WloToolResult } from '../apps/register.js';
import { oneLine } from '../formatter.js';
import type { ItemState, PlanReport } from '../services/write/plan-runner.js';

export type PlanErrorCode = 'plan_expired' | 'plan_mismatch' | 'too_many_plans';

const PLAN_ERROR_TEXT: Record<PlanErrorCode, string> = {
  // NOT "nothing was written": a key that named a plan once may have run half
  // of it before the plan was lost (audit 2026-11-12, K-7).
  plan_expired: 'Der Plan zu diesem Schlüssel ist nicht mehr bekannt — abgelaufen (30 Minuten ab der Bestätigung) '
    + 'oder nach einem Neustart des Servers verloren. Dieser Aufruf hat nichts geschrieben; frühere Aufrufe '
    + 'desselben Plans können aber schon Schritte ausgeführt haben. Weiter geht es mit demselben Aufruf ohne '
    + 'Schlüssel: die neue Vorschau zeigt, was schon da ist (beim Aufnehmen in Sammlungen meldet erst der neue Lauf '
    + 'schon Erledigtes als already), und die Person bestätigt erneut.',
  plan_mismatch: 'Dieser Schlüssel gehört zu einem anderen Plan — einer anderen Anmeldung oder anderen Angaben im '
    + 'Aufruf. Dieser Aufruf hat nichts geschrieben; JENER Plan kann aber schon Schritte ausgeführt haben und läuft '
    + 'mit seinen eigenen Angaben weiter. Bitte den Aufruf mit genau den bestätigten Angaben wiederholen, oder ohne '
    + 'Schlüssel für eine neue Vorschau.',
  too_many_plans: 'Diese Anmeldung hat schon fünf unfertige Pläne offen. Es wurde nichts geschrieben, und der '
    + 'Bestätigungsschlüssel gilt weiter, bis er zehn Minuten nach der Vorschau abläuft: erst einen laufenden Plan '
    + 'mit continuationToken zu Ende führen, dann denselben Aufruf mit diesem Schlüssel wiederholen.',
};

/**
 * Whether something may already have been written under this KEY. `true` for a
 * plan that is gone (its earlier calls may have run steps) and for a mismatch
 * (the key names a LIVING plan of other arguments, which may have run steps
 * too). Only a full plan list is decided before the key did anything.
 */
const PLAN_OUTCOME_OPEN: Record<PlanErrorCode, boolean> = {
  plan_expired: true, plan_mismatch: true, too_many_plans: false,
};

/** A key that cannot be used (yet). THIS call never writes: every code is decided before any step runs. */
export function planErrorReply(code: PlanErrorCode): WloToolResult {
  const message = PLAN_ERROR_TEXT[code];
  return {
    content: [{ type: 'text' as const, text: message }],
    structuredContent: { error: { code, message, outcomeOpen: PLAN_OUTCOME_OPEN[code] } },
    isError: true,
  };
}

/**
 * A step that ended as `failed` while its outcome is not known — never worded
 * as "not done". `where` names the place to look ("in der Sammlung"), for the
 * tools that have one: "bitte prüfen" alone does not say what to open.
 */
const openOutcome = (where?: string) => `offen — Ausgang unbekannt, bitte ${where ? `${where} ` : ''}prüfen`;

/**
 * Closed statuses that ARE a statement about an open outcome: `unverified`
 * ("offen — nicht bestätigt") and `partly` (something landed, something did
 * not). Replacing their word with the general one would say less.
 */
const WORDS_ITS_OWN_OPEN: ReadonlySet<string> = new Set(['unverified', 'partly']);

/** What a tool's own wording adds to the shared rule — two things the single shared form had taken away (review 2026-11-14). */
export interface PlanLabelOptions {
  /** Where an open outcome is checked: "in der Sammlung", "am Datensatz". */
  where?: string;
  /** Word the note as `status — Hinweis` instead of `status (Hinweis)` — the tree's line form. */
  noteAfterDash?: true;
}

/**
 * The German word for one step's state — the ONE function every plan tool
 * words its steps with (audit 2026-11-14, W7). Each tool passes its word table
 * (`labels`: status → word) and, where a code needs explaining, `codeNotes`.
 *
 * It exists for one rule: a `failed` step with `outcomeOpen` is "offen —
 * Ausgang unbekannt", never the table's "nicht …". "Not filed" over an outcome
 * nobody knows sends a model to do it again. Seven tools carried a copy of this
 * function and three of them had no such rule — a tree step the runner ended
 * after `MAX_OPEN_TRIES` read "nicht angelegt" over a collection that may exist.
 */
export function planItemLabel(
  state: ItemState, labels: Readonly<Record<string, string>>, codeNotes: Readonly<Record<string, string>> = {},
  opts: PlanLabelOptions = {},
): string {
  // Not `failed` alone: `not_stored` carries `outcomeOpen: true` too (a field
  // write answered 5xx whose read-back shows the old value), and its table word
  // "nicht gespeichert" stood beside a structured "outcome open" (review
  // 2026-11-14). Any closed status says "open" when its outcome is — except
  // the ones whose own word already does, and says more (`WORDS_ITS_OWN_OPEN`).
  const open = state.outcomeOpen === true && state.status !== 'pending' && !WORDS_ITS_OWN_OPEN.has(state.status);
  const word = open ? openOutcome(opts.where) : labels[state.status] ?? state.status;
  if (!state.code) return word;
  const note = codeNotes[state.code] ?? state.code;
  return opts.noteAfterDash ? `${word} — ${note}` : `${word} (${note})`;
}

/**
 * One step as answered: `id` is what identifies it to the caller (a tree path; a
 * material and a collection) and is spread into the structured entry; `text`
 * names it in the reply.
 */
export interface PlanEntry { id: Record<string, string>; text: string; state: ItemState }

/**
 * The answer after a run: a headline, one line per step, and the key while
 * anything is open. `label` turns a status into the German word the text uses;
 * the structured part keeps the English status (E6).
 */
export function planReply(
  headline: string,
  report: PlanReport,
  expiresAt: number,
  entries: PlanEntry[],
  label: (s: ItemState) => string,
  /** The structured list's name: `nodes` for a tree, `pairs` for filings, `items` for metadata and full texts. */
  listKey = 'nodes',
): WloToolResult {
  const open = !report.complete;
  const lines = [
    `${headline} ${report.progress.done} von ${report.progress.total} Schritten erledigt.`,
    ...(report.inProgress ? ['Ein anderer Aufruf arbeitet gerade an diesem Plan — hier der aktuelle Stand.'] : []),
    ...entries.map(e => `- ${oneLine(e.text)}: ${label(e.state)}${e.state.nodeId ? ` (${e.state.nodeId})` : ''}`),
    ...(open
      ? ['', `Noch nicht fertig. Derselbe Aufruf mit continuationToken: ${report.planId} setzt fort — ohne neue `
          + `Bestätigung, bis ${new Date(expiresAt).toISOString()}.`]
      : []),
  ];
  return {
    content: [{ type: 'text' as const, text: lines.join('\n') }],
    structuredContent: {
      complete: report.complete,
      progress: report.progress,
      // `tries` is the runner's own counter, not something a caller acts on.
      [listKey]: entries.map(e => { const { tries: _tries, ...state } = e.state; return { ...e.id, ...state }; }),
      ...(open ? { continuationToken: report.planId, expiresAt: new Date(expiresAt).toISOString() } : {}),
      ...(report.inProgress ? { inProgress: true } : {}),
    },
  };
}
