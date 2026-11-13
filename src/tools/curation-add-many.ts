/**
 * tools/curation-add-many.ts – wlo_add_to_collections (BOERDi wishlist item 7,
 * decision E4 = B, 2026-11-06).
 *
 * Many materials into many collections under ONE approval, on the same plan
 * runner and with the same answer shape as `wlo_create_collection_tree`. The
 * rules of the plan and the step live in `services/write/filing-plan.ts`.
 *
 * Not live-verified: staging answers every filing PUT with 500 since
 * 2026-11-06 (STATUS) — the offline tests prove what we send, never that the
 * repository accepts it.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { buildChangeSet } from '../services/write/change-set.js';
import { requireWrite } from '../services/write/credential-gate.js';
import {
  FILING_MAX_PAIRS, filingLine, filingStep, resolvePairs, type FilingItem, type PairInput,
} from '../services/write/filing-plan.js';
import { runPlan, type ItemState, type StoredPlan } from '../services/write/plan-runner.js';
import type { WloToolResult } from '../apps/register.js';
import { previewReply, rejectionReply, registerCurationTool, type WriteAuthChallenge } from './curation-shared.js';
import { planReply } from './curation-plan-reply.js';
import { runPlannedCall } from './curation-plan.js';

const KIND = 'add-to-collections';

const STATUS_LABEL: Record<string, string> = {
  added: 'aufgenommen', already: 'war schon enthalten', unverified: 'offen — nicht bestätigt',
  failed: 'nicht aufgenommen', pending: 'offen',
};
const label = (s: ItemState) => `${STATUS_LABEL[s.status] ?? s.status}${s.code ? ` (${s.code})` : ''}`;

function answer(plan: StoredPlan<FilingItem>, report: Awaited<ReturnType<typeof runPlan>>): WloToolResult {
  return planReply('Aufnahme in Sammlungen:', report, plan.expiresAt, plan.items.map(i => ({
    id: {
      nodeId: i.requestedId,
      collectionId: i.collection.nodeId,
      ...(i.requestedId !== i.filedId ? { filedId: i.filedId } : {}),
    },
    text: `„${i.materialTitle}“ → „${i.collection.title}“`,
    state: plan.state.get(i.key)!,
  })), label, 'pairs');
}

export function registerCurationAddManyTool(server: McpServer, challenge: WriteAuthChallenge): void {
  registerCurationTool(server, challenge, {
    replay: false, // the key continues a stored plan (plan-runner.ts)
    name: 'wlo_add_to_collections',
    title: 'WLO Materialien in Sammlungen aufnehmen',
    description: `Nimm viele vorhandene Materialien in Sammlungen auf — bis zu ${FILING_MAX_PAIRS} Paare {nodeId, collectionId} mit EINER Bestätigung. Nichts wird verschoben oder kopiert; eine Sammlung enthält Verweise.
Ohne Schlüssel: Vorschau mit jedem Paar. Mit confirmToken: läuft bis zu ~40 s je Aufruf; ist es nicht fertig, kommt complete: false mit continuationToken (fortsetzen ohne neue Bestätigung, 30 min ab Bestätigung). Ein Schlüssel darf erneut vorgelegt werden — er setzt fort oder liefert dasselbe Ergebnis.
Eine Verknüpfungs-id wird als ihr Original aufgenommen; schon enthaltene Paare kommen als already zurück; ein gescheitertes Paar hält die übrigen nicht auf. Antwort: pairs [{nodeId, collectionId, filedId?, status, code?}].
Für ein einzelnes Material: wlo_add_to_collection.`,
    inputSchema: {
      pairs: z.array(z.object({
        nodeId: z.string().min(1).max(200),
        collectionId: z.string().min(1).max(200),
      })).min(1).max(FILING_MAX_PAIRS),
      confirmToken: z.string().max(200).optional(),
      continuationToken: z.string().max(200).optional(),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    handler: async (params) => {
      requireWrite();
      const pairs = params['pairs'] as PairInput[];
      return runPlannedCall<FilingItem>({
        kind: KIND, params,
        // The plan is bound to the pairs as NAMED — resolving them again for a
        // continuation would cost the reads the plan exists to save.
        args: JSON.stringify(pairs.map(p => [p.nodeId.trim(), p.collectionId.trim()])),
        step: () => filingStep,
        answer,
        prepare: async () => {
          const resolved = await resolvePairs(pairs);
          // `refused` names each unusable id with the code the single tool gives
          // for it — `invalid_input` alone cannot tell "does not exist" from "is
          // not a collection" to a program that reads only the code.
          if (!resolved.ok) return { reply: rejectionReply(resolved.reasons, { refused: resolved.refused }) };
          const items = resolved.items;
          const cs = buildChangeSet('add-to-collections', 'collection', {}, {}, {
            action: `Führt ${items.length} Aufnahmen aus (${new Set(items.map(i => i.filedId)).size} Materialien, `
              + `${new Set(items.map(i => i.collection.nodeId)).size} Sammlungen). Die Materialien selbst werden nicht verändert:`,
            items: items.map(filingLine),
          });
          return { draft: { cs, items, preview: () => previewReply(cs, 'Zum Aufnehmen bitte bestätigen.') } };
        },
        context: 'Fehler beim Aufnehmen in Sammlungen',
        whatIsOpen: 'Ob schon Materialien aufgenommen wurden',
      });
    },
  });
}
