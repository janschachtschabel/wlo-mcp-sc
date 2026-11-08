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
  plan_expired: 'Der Plan zu diesem Schlüssel ist nicht mehr bekannt — abgelaufen (30 Minuten ab der Bestätigung) '
    + 'oder nach einem Neustart des Servers verloren. Es wurde nichts geschrieben. Weiter geht es mit demselben '
    + 'Aufruf ohne Schlüssel: die neue Vorschau zeigt, was schon da ist, und die Person bestätigt erneut.',
  plan_mismatch: 'Dieser Schlüssel gehört zu einem anderen Plan — einer anderen Anmeldung oder anderen Angaben im '
    + 'Aufruf. Es wurde nichts geschrieben. Bitte den Aufruf mit genau den bestätigten Angaben wiederholen, oder ohne '
    + 'Schlüssel für eine neue Vorschau.',
  too_many_plans: 'Diese Anmeldung hat schon fünf unfertige Pläne offen. Es wurde nichts geschrieben, und der '
    + 'Bestätigungsschlüssel gilt weiter, bis er zehn Minuten nach der Vorschau abläuft: erst einen laufenden Plan '
    + 'mit continuationToken zu Ende führen, dann denselben Aufruf mit diesem Schlüssel wiederholen.',
};

/** A key that cannot be used (yet). Never a write: every code is decided before any step runs. */
export function planErrorReply(code: PlanErrorCode): WloToolResult {
  const message = PLAN_ERROR_TEXT[code];
  return {
    content: [{ type: 'text' as const, text: message }],
    structuredContent: { error: { code, message } },
    isError: true,
  };
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
      [listKey]: entries.map(e => ({ ...e.id, ...e.state })),
      ...(open ? { continuationToken: report.planId, expiresAt: new Date(expiresAt).toISOString() } : {}),
      ...(report.inProgress ? { inProgress: true } : {}),
    },
  };
}
