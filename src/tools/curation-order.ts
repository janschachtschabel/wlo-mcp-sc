/**
 * tools/curation-order.ts – wlo_order_collection (chatbot team, S1,
 * 2026-11-14). Schema and wording only; what a list must be and how it is
 * sent lives in `services/write/collection-order.ts`.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { buildChangeSet } from '../services/write/change-set.js';
import { requireWrite } from '../services/write/credential-gate.js';
import { readFilingTarget } from '../services/write/create-filing.js';
import { ORDER_MAX, planOrder, readOrderable, setCollectionOrder } from '../services/write/collection-order.js';
import { sanitizeText } from '../text-sanitize.js';
import { CONFIRM_TOKEN } from './curation-fields.js';
import {
  codedError, confirmOrExplain, isPreviewCall, previewReply, registerCurationTool, reportMutation,
  timeoutOrError, type WriteAuthChallenge,
} from './curation-shared.js';

export function registerCurationOrderTool(server: McpServer, challenge: WriteAuthChallenge): void {
  registerCurationTool(server, challenge, {
    name: 'wlo_order_collection',
    title: 'WLO Reihenfolge in einer Sammlung setzen',
    description: `Lege die Reihenfolge der Untersammlungen ODER der Inhalte einer Sammlung fest — etwa die Abfolge eines Lehrplans. \`order\` nennt die nodeIds in der gewünschten Reihenfolge und muss ALLE Einträge dieser Art nennen (sonst stünden danach zwei auf demselben Platz); eine unvollständige Liste wird abgelehnt und nennt, was fehlt. Je Aufruf nur eine Art — Untersammlungen und Inhalte werden getrennt gelistet.
Bei Inhalten darf die nodeId die des Materials oder die des Verweises aus der Sammlungsliste sein. Die aktuelle Reihenfolge liefern list_collection_tree und browse_collection_tree mit order: "stored".
ZWEISTUFIG: ohne confirmToken nur Vorschau mit der neuen Abfolge. Danach wird die Reihenfolge aus der Liste der Sammlung zurückgelesen. Erfordert eine Anmeldung.`,
    inputSchema: {
      collectionId: z.string().trim().min(1).max(200).describe('nodeId der Sammlung, deren Einträge geordnet werden.'),
      order: z.array(z.string().trim().min(1).max(200)).min(1).max(ORDER_MAX)
        .describe(`Alle Untersammlungen ODER alle Inhalte dieser Sammlung, in der gewünschten Reihenfolge (höchstens ${ORDER_MAX}).`),
      confirmToken: CONFIRM_TOKEN,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    handler: async (params: Record<string, unknown>) => {
      try {
        requireWrite();
        const collectionId = String(params['collectionId'] ?? '').trim();
        const target = await readFilingTarget(collectionId);
        if (!target.ok) {
          return target.reason === 'not_a_collection'
            ? codedError('not_a_collection', `„${sanitizeText(collectionId)}“ ist keine Sammlung. Es wurde nichts geändert.`)
            : codedError('not_found', `Die Sammlung „${sanitizeText(collectionId)}“ wurde nicht gefunden oder ist nicht lesbar.`);
        }
        const have = await readOrderable(collectionId);
        if (!have.ok) {
          const what = have.kind === 'collections' ? 'Untersammlungen' : 'Inhalte';
          return have.reason === 'too_many'
            ? codedError('too_many', `Die Sammlung hat mehr als ${ORDER_MAX} ${what} — ob eine Liste alle nennt, lässt sich hier nicht prüfen. Es wurde nichts geändert.`, { outcomeOpen: false })
            : codedError('not_checked', `Die ${what} der Sammlung ließen sich gerade nicht lesen. Ohne sie lässt sich nicht prüfen, ob die Liste vollständig ist — es wurde nichts geändert. Bitte später erneut versuchen.`, { outcomeOpen: false });
        }
        const plan = planOrder(have, params['order'] as string[]);
        if (!plan.ok) {
          return codedError(plan.code, plan.reasons.join(' '), {
            reasons: plan.reasons, outcomeOpen: false,
            ...(plan.missing ? { missing: plan.missing } : {}), ...(plan.unknown ? { unknown: plan.unknown } : {}),
          });
        }
        const what = plan.kind === 'collections' ? 'Untersammlungen' : 'Inhalte';
        const title = sanitizeText(target.target.title);
        // Every line is a place: the key binds to the whole sequence, titles and ids.
        const cs = buildChangeSet(collectionId, 'collection', {}, {}, {
          action: `Setzt die Reihenfolge der ${plan.children.length} ${what} von „${title}“ (${collectionId}):`,
          // The id that is SENT is in the line: two references of one material are two places.
          items: plan.children.map((c, i) => `${i + 1}. „${c.title}“ (${c.materialId ? `${c.materialId}; Verweis ${c.id}` : c.id})`),
        });
        const token = typeof params['confirmToken'] === 'string' ? params['confirmToken'] : '';
        if (!token) return previewReply(cs, 'Zum Setzen der Reihenfolge bitte bestätigen.');
        const refusal = confirmOrExplain(token, cs);
        if (refusal) return refusal;

        const outcome = await setCollectionOrder(collectionId, plan.kind, plan.children.map(c => c.id));
        const done = reportMutation(outcome, `Die Reihenfolge der ${plan.children.length} ${what} von „${title}“ ist gesetzt.`,
          'Die Reihenfolge konnte nicht gesetzt werden');
        if (outcome.status !== 'ok') return done;
        return { ...done, structuredContent: { collectionId, kind: plan.kind, order: plan.children.map(c => c.materialId ?? c.id) } };
      } catch (err) {
        return timeoutOrError('Die Reihenfolge konnte nicht gesetzt werden', err,
          `Ob die Reihenfolge in „${sanitizeText(String(params['collectionId'] ?? ''))}“ gesetzt wurde, ist offen`, { preview: isPreviewCall(params) });
      }
    },
  });
}
