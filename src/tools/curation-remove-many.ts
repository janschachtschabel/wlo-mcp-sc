/**
 * tools/curation-remove-many.ts – wlo_remove_from_collections (chatbot team,
 * S6, 2026-11-14).
 *
 * Many materials out of collections under ONE approval, on the plan runner and
 * with the answer shape of `wlo_add_to_collections`. The rules of the plan and
 * the step live in `services/write/remove-plan.ts`.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { buildChangeSet } from '../services/write/change-set.js';
import { requireWrite } from '../services/write/credential-gate.js';
import type { PairInput } from '../services/write/filing-plan.js';
import {
  REMOVE_MAX_PAIRS, removalLine, removeStep, resolveRemovals, type RemoveItem,
} from '../services/write/remove-plan.js';
import { runPlan, type ItemState, type StoredPlan } from '../services/write/plan-runner.js';
import type { WloToolResult } from '../apps/register.js';
import { previewReply, rejectionReply, registerCurationTool, type WriteAuthChallenge } from './curation-shared.js';
import { planReply } from './curation-plan-reply.js';
import { runPlannedCall } from './curation-plan.js';

const KIND = 'remove-from-collections';

const STATUS_LABEL: Record<string, string> = {
  removed: 'herausgenommen', absent: 'war nicht enthalten', unverified: 'offen — nicht bestätigt',
  failed: 'nicht herausgenommen', pending: 'offen',
};
// "Not removed" over an outcome nobody knows sends a model to act on a guess.
const label = (s: ItemState) => (s.status === 'failed' && s.outcomeOpen
  ? 'offen — Ausgang unbekannt, bitte in der Sammlung prüfen'
  : STATUS_LABEL[s.status] ?? s.status) + (s.code ? ` (${s.code})` : '');

function answer(plan: StoredPlan<RemoveItem>, report: Awaited<ReturnType<typeof runPlan>>): WloToolResult {
  return planReply('Herausnehmen aus Sammlungen:', report, plan.expiresAt, plan.items.map(i => ({
    id: { nodeId: i.requestedId, collectionId: i.collection.nodeId },
    text: `„${i.materialTitle}“ (${i.requestedId}) aus „${i.collection.title}“`,
    state: plan.state.get(i.key)!,
  })), label, 'pairs');
}

export function registerCurationRemoveManyTool(server: McpServer, challenge: WriteAuthChallenge): void {
  registerCurationTool(server, challenge, {
    replay: false, // the key continues a stored plan (plan-runner.ts)
    name: 'wlo_remove_from_collections',
    title: 'WLO Materialien aus Sammlungen nehmen (Stapel)',
    description: `Nimm viele Materialien aus Sammlungen heraus — bis zu ${REMOVE_MAX_PAIRS} Paare {nodeId, collectionId} mit EINER Bestätigung. Entfernt wird nur der Verweis; das Material selbst bleibt bestehen und bleibt in allen anderen Sammlungen. Die nodeId darf die des Materials oder die des Verweises aus einer Sammlungsliste sein.
Ohne Schlüssel: Vorschau mit jedem Paar. Mit confirmToken: läuft bis zu ~40 s je Aufruf; ist es nicht fertig, kommt complete: false mit continuationToken (fortsetzen ohne neue Bestätigung, 30 min ab Bestätigung). Ein Schlüssel darf erneut vorgelegt werden — er setzt fort oder liefert dasselbe Ergebnis.
Ein Paar, das nicht in seiner Sammlung liegt, kommt als absent zurück; ein gescheitertes Paar hält die übrigen nicht auf. Antwort: pairs [{nodeId, collectionId, status, code?}] — removed, absent, unverified, failed.
Zum UMSORTIEREN (aufnehmen und aus der alten Sammlung nehmen) wlo_add_to_collections mit removeFrom. Für ein einzelnes Paar: wlo_remove_from_collection.`,
    inputSchema: {
      pairs: z.array(z.object({
        nodeId: z.string().trim().min(1).max(200),
        collectionId: z.string().trim().min(1).max(200),
      })).min(1).max(REMOVE_MAX_PAIRS),
      confirmToken: z.string().max(200).optional(),
      continuationToken: z.string().max(200).optional(),
    },
    // Not destructive: only a reference goes, the material stays (the single tool says the same).
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    handler: async (params) => {
      requireWrite();
      const pairs = params['pairs'] as PairInput[];
      return runPlannedCall<RemoveItem>({
        kind: KIND, params,
        args: JSON.stringify(pairs.map(p => [p.nodeId.trim(), p.collectionId.trim()])),
        step: () => removeStep,
        answer,
        prepare: async () => {
          const resolved = await resolveRemovals(pairs);
          if (!resolved.ok) return { reply: rejectionReply(resolved.reasons, { refused: resolved.refused }) };
          const { items, absent } = resolved;
          const open = items.filter(i => !absent.has(i.key));
          if (!open.length) {
            // Nothing to approve. An answer, not an error: for a batch "not in there" is done.
            return { reply: {
              content: [{ type: 'text' as const, text: [
                `Keines der ${items.length} Materialien liegt in der genannten Sammlung — es wurde nichts geändert.`,
                ...items.map(i => `- ${removalLine(i, false)}`),
              ].join('\n') }],
              structuredContent: {
                complete: true, progress: { done: items.length, total: items.length },
                pairs: items.map(i => ({ nodeId: i.requestedId, collectionId: i.collection.nodeId, status: 'absent' as const })),
              },
            } };
          }
          const cs = buildChangeSet('remove-from-collections', 'collection', {}, {}, {
            action: `Nimmt ${open.length} Materialien aus Sammlungen heraus`
              + (absent.size ? ` (${absent.size} weitere liegen nicht in der genannten Sammlung)` : '')
              + '. Die Materialien selbst bleiben bestehen und werden nicht gelöscht:',
            items: items.map(i => removalLine(i, absent.has(i.key))),
          });
          const initial = new Map<string, ItemState>([...absent].map(key => [key, { status: 'absent' }]));
          return { draft: { cs, items, initial, preview: () => previewReply(cs, 'Zum Herausnehmen bitte bestätigen.') } };
        },
        context: 'Fehler beim Herausnehmen aus Sammlungen',
        whatIsOpen: 'Ob schon Materialien herausgenommen wurden',
      });
    },
  });
}
