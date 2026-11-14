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
import { notPublicNote, withNotPublic } from './curation-public.js';

const KIND = 'add-to-collections';

const STATUS_LABEL: Record<string, string> = {
  added: 'aufgenommen', already: 'war schon enthalten', unverified: 'offen — nicht bestätigt',
  failed: 'nicht aufgenommen', pending: 'offen', moved: 'umsortiert — aufgenommen und aus der Quelle genommen',
  proposed: 'VORGESCHLAGEN — liegt noch nicht in der Sammlung, die Redaktion entscheidet',
};
/** What a code says about the SOURCE of a move — the status alone names only the filing. */
const CODE_NOTE: Record<string, string> = {
  not_removed: 'NICHT aus der Quelle genommen — liegt jetzt in BEIDEN Sammlungen',
  not_in_source: 'war in der Quelle nicht enthalten',
  already_proposed: 'war für diese Sammlung schon vorgeschlagen (offen oder bereits entschieden) — liegt NICHT in der Sammlung',
  source_is_original: 'liegt in der Quelle als Original, nicht als Verweis — dort NICHT herausgenommen (das würde das Material löschen); liegt jetzt in BEIDEN',
};
// "Not filed" over an outcome nobody knows sends a model to file again.
const label = (s: ItemState) => (s.status === 'failed' && s.outcomeOpen
  ? 'offen — Ausgang unbekannt, bitte prüfen'
  : STATUS_LABEL[s.status] ?? s.status) + (s.code ? ` (${CODE_NOTE[s.code] ?? s.code})` : '');

function answer(plan: StoredPlan<FilingItem>, report: Awaited<ReturnType<typeof runPlan>>): WloToolResult {
  return planReply('Aufnahme in Sammlungen:', report, plan.expiresAt, plan.items.map(i => ({
    id: {
      nodeId: i.requestedId,
      collectionId: i.collection.nodeId,
      ...(i.requestedId !== i.filedId ? { filedId: i.filedId } : {}),
      ...(i.source ? { removeFrom: i.source.nodeId } : {}),
    },
    text: `„${i.materialTitle}“ → „${i.collection.title}“${i.source ? ` (aus „${i.source.title}“)` : ''}`,
    state: plan.state.get(i.key)!,
  })), label, 'pairs');
}

export function registerCurationAddManyTool(server: McpServer, challenge: WriteAuthChallenge): void {
  registerCurationTool(server, challenge, {
    replay: false, // the key continues a stored plan (plan-runner.ts)
    name: 'wlo_add_to_collections',
    title: 'WLO Materialien in Sammlungen aufnehmen',
    description: `Nimm viele vorhandene Materialien in Sammlungen auf — bis zu ${FILING_MAX_PAIRS} Paare {nodeId, collectionId} mit EINER Bestätigung. Eine Sammlung enthält Verweise; das Material selbst bleibt, wo es ist.
Ohne Schlüssel: Vorschau mit jedem Paar. Mit confirmToken: bis zu ~40 s je Aufruf; ist es nicht fertig, kommt complete: false mit continuationToken (fortsetzen ohne neue Bestätigung, 30 min). Ein Schlüssel darf erneut vorgelegt werden.
Eine Verknüpfungs-id wird als ihr Original aufgenommen; schon Enthaltenes kommt als already zurück; ein gescheitertes Paar hält die übrigen nicht auf. Antwort: pairs [{nodeId, collectionId, filedId?, status, code?}].
UMSORTIEREN: je Paar optional removeFrom — erst aufnehmen und zurücklesen, dann aus dieser Sammlung nehmen (moved). Scheitert das Entfernen: Code not_removed, es liegt dann in BEIDEN.
Darf die Anmeldung an einem Ziel nur lesen, wird dort VORGESCHLAGEN (proposed, noch nicht aufgenommen). Die Vorschau nennt, was noch nicht öffentlich ist.
Einzeln: wlo_add_to_collection.`,
    inputSchema: {
      pairs: z.array(z.object({
        nodeId: z.string().min(1).max(200),
        collectionId: z.string().min(1).max(200),
        removeFrom: z.string().min(1).max(200).optional().describe('Quell-Sammlung, aus der das Material NACH dem Aufnehmen herausgenommen wird (Umsortieren).'),
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
        args: JSON.stringify(pairs.map(p => [p.nodeId.trim(), p.collectionId.trim(), p.removeFrom?.trim() ?? ''])),
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
              + `${new Set(items.map(i => i.collection.nodeId)).size} Sammlungen)`
              + (items.some(i => i.source) ? `; ${items.filter(i => i.source).length} davon werden danach aus ihrer bisherigen Sammlung herausgenommen` : '')
              + (items.some(i => i.propose) ? `; ${items.filter(i => i.propose).length} gehen als VORSCHLAG an eine Sammlung, an der diese Anmeldung nicht schreiben darf` : '')
              + '. Die Materialien selbst werden nicht verändert:',
            items: items.map(filingLine),
          });
          // Not public: said before the key, as a sentence and as data (S9). Counted per MATERIAL.
          const notPublic = [...new Set(items.filter(i => i.notPublic).map(i => i.requestedId))];
          const notes = notPublic.length ? [notPublicNote(notPublic.length, new Set(items.map(i => i.requestedId)).size)] : [];
          return { draft: { cs, items, preview: () => withNotPublic(previewReply(cs, 'Zum Aufnehmen bitte bestätigen.', notes), notPublic) } };
        },
        context: 'Fehler beim Aufnehmen in Sammlungen',
        whatIsOpen: 'Ob schon Materialien aufgenommen wurden',
      });
    },
  });
}
