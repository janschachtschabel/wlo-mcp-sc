/**
 * tools/curation-submit-many.ts – wlo_submit_contents (chatbot team, S4,
 * 2026-11-14).
 *
 * Many records to the editorial queue under ONE approval, on the plan runner
 * and with the answer shape of the other batch tools. The rules of the plan
 * and the step live in `services/write/submit-plan.ts`.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { buildChangeSet } from '../services/write/change-set.js';
import { requireWrite } from '../services/write/credential-gate.js';
import { REVIEW_STATUS } from '../services/write/nodes-lifecycle.js';
import {
  SUBMIT_MAX, resolveSubmissions, submitLine, submitStep, type SubmitItem,
} from '../services/write/submit-plan.js';
import { runPlan, type ItemState, type StoredPlan } from '../services/write/plan-runner.js';
import { flattenText, sanitizeText } from '../text-sanitize.js';
import type { WloToolResult } from '../apps/register.js';
import { codedError, previewReply, rejectionReply, registerCurationTool, type WriteAuthChallenge } from './curation-shared.js';
import { planReply } from './curation-plan-reply.js';
import { canonicalArgs, runPlannedCall } from './curation-plan.js';

const KIND = 'submit-contents';

const STATUS_LABEL: Record<string, string> = {
  submitted: 'eingereicht', already: 'lag schon zur Prüfung vor', unverified: 'offen — nicht bestätigt',
  not_stored: 'NICHT eingereicht — der Datensatz zeigt keinen Workflow-Status', failed: 'nicht eingereicht', pending: 'offen',
};
// "Not submitted" over an outcome nobody knows sends a model to submit again.
const label = (s: ItemState) => (s.status === 'failed' && s.outcomeOpen
  ? 'offen — Ausgang unbekannt, bitte am Datensatz prüfen'
  : STATUS_LABEL[s.status] ?? s.status) + (s.code ? ` (${s.code})` : '');

function answer(plan: StoredPlan<SubmitItem>, report: Awaited<ReturnType<typeof runPlan>>): WloToolResult {
  return planReply('Einreichen zur Prüfung:', report, plan.expiresAt, plan.items.map(i => ({
    id: { nodeId: i.nodeId },
    text: `„${i.title}“ (${i.nodeId})`,
    state: plan.state.get(i.key)!,
  })), label, 'items');
}

export function registerCurationSubmitManyTool(server: McpServer, challenge: WriteAuthChallenge): void {
  registerCurationTool(server, challenge, {
    replay: false, // the key continues a stored plan (plan-runner.ts)
    name: 'wlo_submit_contents',
    title: 'WLO Inhalte zur Prüfung einreichen (Stapel)',
    description: `Reiche viele vorhandene Datensätze zur redaktionellen Prüfung ein — bis zu ${SUBMIT_MAX} mit EINER Bestätigung, etwa nach einem Upload. Nur einzelne Datensätze, keine Sammlungen oder Ordner.
Ohne Schlüssel: Vorschau mit jedem Datensatz. Mit confirmToken: läuft bis zu ~40 s je Aufruf; ist es nicht fertig, kommt complete: false mit continuationToken (fortsetzen ohne neue Bestätigung, 30 min ab Bestätigung). Ein Schlüssel darf erneut vorgelegt werden — er setzt fort oder liefert dasselbe Ergebnis, reicht nie doppelt ein.
Ein Datensatz, der schon zur Prüfung vorliegt, kommt als already zurück und wird nicht erneut eingereicht; ein gescheiterter Eintrag hält die übrigen nicht auf. Die Notiz gilt für alle. Antwort: items [{nodeId, status, code?}] — submitted, already, not_stored (mit Erfolg beantwortet, aber nicht in der Warteschlange), unverified, failed.
Danach liegen die Datensätze bei der Redaktion und können nicht unbemerkt zurückgezogen werden. Für einen einzelnen: wlo_submit_content.`,
    inputSchema: {
      items: z.array(z.object({ nodeId: z.string().trim().min(1).max(200) })).min(1).max(SUBMIT_MAX),
      // Travels to the queue under the submitter's name with EVERY record — bounded, and shown in the preview.
      comment: z.string().max(1000).optional().describe('Notiz für die Redaktion, an jedem der Datensätze.'),
      confirmToken: z.string().max(200).optional(),
      continuationToken: z.string().max(200).optional(),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    handler: async (params) => {
      requireWrite();
      const ids = (params['items'] as Array<{ nodeId: string }>).map(i => i.nodeId.trim());
      // What is SHOWN is what is sent: the note is flattened once, for the
      // preview and for the queue — invisible characters must not travel unseen.
      const comment = typeof params['comment'] === 'string' ? flattenText(params['comment']) : '';
      return runPlannedCall<SubmitItem>({
        kind: KIND, params,
        // The note is part of what was approved: a key presented with another one is not this plan.
        args: canonicalArgs([ids, comment]),
        step: () => submitStep(comment),
        answer,
        prepare: async () => {
          const resolved = await resolveSubmissions(ids);
          if (!resolved.ok && 'unread' in resolved) {
            return { reply: codedError('not_checked', `${resolved.unread.length} der Datensätze ließen sich gerade nicht lesen `
              + `(${resolved.unread.slice(0, 5).map(id => sanitizeText(id)).join(', ')}${resolved.unread.length > 5 ? ', …' : ''}). `
              + 'Das heißt nicht, dass es sie nicht gibt. Es wurde nichts eingereicht; bitte später erneut versuchen.', { outcomeOpen: false }) };
          }
          if (!resolved.ok) return { reply: rejectionReply(resolved.reasons, { refused: resolved.refused }) };
          const { items, already } = resolved;
          const open = items.filter(i => !already.has(i.key));
          if (!open.length) {
            // Nothing to approve: every record is in the queue. An answer, not an error —
            // for a batch "already there" is done (the single tool refuses, having one record).
            const entries = items.map(i => ({ nodeId: i.nodeId, status: 'already' as const }));
            return { reply: {
              content: [{ type: 'text' as const, text: [
                `Alle ${items.length} Datensätze liegen bereits zur redaktionellen Prüfung vor (Status ${REVIEW_STATUS}). Es wurde nichts geändert.`,
                ...items.map(i => `- ${submitLine(i, false)}`),
              ].join('\n') }],
              structuredContent: { complete: true, progress: { done: items.length, total: items.length }, items: entries },
            } };
          }
          // The note is IN the action: in the preview and in the token's
          // fingerprint — it is attributed to the person who approves.
          const cs = buildChangeSet('submit-contents', 'content', {}, {}, {
            action: `Reicht ${open.length} Datensätze zur redaktionellen Prüfung ein`
              + (already.size ? ` (${already.size} weitere liegen schon vor und werden nicht erneut eingereicht)` : '')
              + (comment ? `. Notiz an die Redaktion, an jedem Datensatz: „${comment}“` : '') + ':',
            items: items.map(i => submitLine(i, already.has(i.key))),
          });
          const initial = new Map<string, ItemState>([...already].map(key => [key, { status: 'already' }]));
          return { draft: { cs, items, initial, preview: () => previewReply(cs,
            'Danach liegen die Datensätze bei der Redaktion und können nicht mehr unbemerkt zurückgezogen werden.') } };
        },
        context: 'Fehler beim Einreichen zur Prüfung',
        whatIsOpen: 'Ob schon Datensätze eingereicht wurden',
      });
    },
  });
}
