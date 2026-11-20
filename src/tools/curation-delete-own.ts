/**
 * tools/curation-delete-own.ts – wlo_delete_own_content (plan 2026-11-20,
 * chatbot team: "Gliederungsdatei behalten oder aus WLO löschen?").
 *
 * A tool of its own, not a mode of `wlo_delete_content`: a client allows tools
 * by NAME, and the chatbot excludes `wlo_delete_content` from its flows. The
 * rules live in `services/write/delete-own-plan.ts`.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { buildChangeSet } from '../services/write/change-set.js';
import { requireWrite } from '../services/write/credential-gate.js';
import {
  KEEP_TEXT, OWN_DELETE_MAX, deleteOwnStep, ownDeleteLine, resolveOwnDeletions, type KeepCode, type OwnItem,
} from '../services/write/delete-own-plan.js';
import { runPlan, type ItemState, type StoredPlan } from '../services/write/plan-runner.js';
import type { WloToolResult } from '../apps/register.js';
import { codedError, personalLoginRefusal, previewReply, registerCurationTool, type WriteAuthChallenge } from './curation-shared.js';
import { planItemLabel, planReply } from './curation-plan-reply.js';
import { quotedTitle } from '../text-line.js';
import { canonicalArgs, runPlannedCall } from './curation-plan.js';

const KIND = 'delete-own-content';

const STATUS_LABEL: Record<string, string> = {
  deleted: 'gelöscht', kept: 'bleibt bestehen', unverified: 'offen — nicht bestätigt', failed: 'nicht gelöscht', pending: 'offen',
};
const label = (s: ItemState) => planItemLabel(s, STATUS_LABEL, KEEP_TEXT);

function answer(plan: StoredPlan<OwnItem>, report: Awaited<ReturnType<typeof runPlan>>): WloToolResult {
  return planReply('Eigene Inhalte löschen:', report, plan.expiresAt, plan.items.map(i => ({
    id: { nodeId: i.nodeId },
    text: quotedTitle(i.title),
    state: plan.state.get(i.key)!,
  })), label, 'items');
}

const OWN_ONLY = 'Eigene Inhalte löschen geht nur mit der eigenen WLO-Anmeldung — nicht über ein gemeinsames Konto, '
  + 'für das es kein „eigen“ gibt.';

export function registerCurationDeleteOwnTool(server: McpServer, challenge: WriteAuthChallenge): void {
  registerCurationTool(server, challenge, {
    name: 'wlo_delete_own_content',
    title: 'WLO Eigene Inhalte löschen',
    description: `Lösche EIGENE Datensätze aus dem persönlichen Bereich — nur die. Der Server prüft je Knoten, direkt vor dem Löschen: ein Datensatz (keine Sammlung, kein Ordner, keine Verknüpfung), von DIESER Anmeldung angelegt, im persönlichen Bereich (auch in einem Ordner dort, etwa einer Stapel-Ablage), nirgends verwendet und nicht öffentlich. Bis zu ${OWN_DELETE_MAX} nodeIds; nur mit eigener Anmeldung.
Ein Knoten, der eine Bedingung verletzt, bleibt: status kept, code not_found, is_a_collection, is_a_folder, not_a_record, is_reference, not_own, not_in_home, in_use, is_public oder not_checked — eine Antwort je Knoten, kein Fehler.
Ohne Schlüssel: Vorschau je Knoten (ist nichts löschbar, ohne Schlüssel). Mit confirmToken: items [{nodeId, status, code?}] — deleted, kept, unverified, failed, pending.
Nicht verlässlich wiederherstellbar. Für alles, was diese Anmeldung löschen darf: wlo_delete_content.`,
    inputSchema: {
      nodeIds: z.array(z.string().min(1).max(200)).min(1).max(OWN_DELETE_MAX).describe('nodeIds der eigenen Datensätze. Reihenfolge egal.'),
      confirmToken: z.string().max(200).optional(),
      continuationToken: z.string().max(200).optional(),
    },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
    replay: false, // the key continues a stored plan (plan-runner.ts)
    handler: async (params) => {
      requireWrite();
      const refusal = personalLoginRefusal(challenge, OWN_ONLY);
      if (refusal) return refusal;
      // Sorted once: the preview's lines are part of the fingerprint, and the order must not decide the key.
      const ids = [...new Set((params['nodeIds'] as string[]).map(id => id.trim()))].sort();
      return runPlannedCall<OwnItem>({
        kind: KIND, params,
        // Order does not matter to the caller, so it does not make another plan.
        args: canonicalArgs(ids),
        step: () => deleteOwnStep(),
        answer,
        prepare: async () => {
          const resolved = await resolveOwnDeletions(ids);
          if (!resolved) {
            return { reply: codedError('upstream_error', 'Wer angemeldet ist oder wo der persönliche Bereich liegt, ließ sich gerade '
              + 'nicht lesen. Es wurde nichts gelöscht; bitte später erneut versuchen.') };
          }
          const { items, kept } = resolved;
          const candidates = items.filter(i => !kept.has(i.key));
          const keptItem = (i: OwnItem) => ({ nodeId: i.nodeId, status: 'kept' as const, code: kept.get(i.key) as KeepCode });
          if (!candidates.length) {
            // Nothing to approve. An answer, not an error: each node says why it stays. What could not
            // be checked is said as such — "not reachable" is not "not deletable".
            const unchecked = [...kept.values()].filter(code => code === 'not_checked').length;
            const head = unchecked
              ? `${unchecked} von ${items.length} Knoten ${unchecked === 1 ? 'ließ' : 'ließen'} sich gerade nicht prüfen — es wurde nichts gelöscht; bitte später erneut versuchen.`
              : `Keiner der ${items.length} Knoten ist löschbar — es wurde nichts gelöscht.`;
            return { reply: {
              content: [{ type: 'text' as const, text: [
                head,
                ...items.map(i => `- ${ownDeleteLine(i, kept.get(i.key))}`),
              ].join('\n') }],
              structuredContent: {
                // `complete` only: each node's `code: not_checked` is what says it could not be checked.
                complete: true, progress: { done: items.length, total: items.length }, items: items.map(keptItem),
              },
            } };
          }
          const cs = buildChangeSet(KIND, 'content', {}, {}, {
            destructive: true,
            action: `Löscht ${candidates.length} eigene ${candidates.length === 1 ? 'Datensatz' : 'Datensätze'}`
              + (kept.size ? `; ${kept.size} ${kept.size === 1 ? 'bleibt' : 'bleiben'} bestehen` : '')
              + '. Unmittelbar vor dem Löschen wird jede Bedingung noch einmal geprüft:',
            items: items.map(i => ownDeleteLine(i, kept.get(i.key))),
          });
          const initial = new Map<string, ItemState>([...kept].map(([key, code]) => [key, { status: 'kept', code }]));
          return { draft: { cs, items, initial, preview: () => previewReply(cs,
            'Gelöschte Datensätze lassen sich nicht verlässlich wiederherstellen.') } };
        },
        context: 'Fehler beim Löschen eigener Inhalte',
        whatIsOpen: 'Ob schon Datensätze gelöscht wurden',
      });
    },
  });
}
