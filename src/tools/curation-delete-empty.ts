/**
 * tools/curation-delete-empty.ts – wlo_delete_collections (chatbot team, S7,
 * 2026-11-14).
 *
 * Many collections under ONE approval — but only those that are EMPTY. The
 * rules live in `services/write/delete-empty-plan.ts`.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { buildChangeSet } from '../services/write/change-set.js';
import { requireWrite } from '../services/write/credential-gate.js';
import {
  DELETE_EMPTY_MAX, deleteEmptyStep, deleteLine, resolveDeletions, type DeleteItem,
} from '../services/write/delete-empty-plan.js';
import { runPlan, type ItemState, type StoredPlan } from '../services/write/plan-runner.js';
import type { WloToolResult } from '../apps/register.js';
import { previewReply, rejectionReply, registerCurationTool, type WriteAuthChallenge } from './curation-shared.js';
import { planReply } from './curation-plan-reply.js';
import { canonicalArgs, runPlannedCall } from './curation-plan.js';

const KIND = 'delete-empty-collections';

const STATUS_LABEL: Record<string, string> = {
  deleted: 'gelöscht', not_empty: 'nicht leer — bleibt bestehen', unverified: 'offen — nicht bestätigt',
  failed: 'nicht gelöscht', pending: 'offen',
};
// "Not deleted" over an outcome nobody knows is a claim; so is the reverse.
const label = (s: ItemState) => (s.status === 'failed' && s.outcomeOpen
  ? 'offen — Ausgang unbekannt, bitte nachsehen'
  : STATUS_LABEL[s.status] ?? s.status) + (s.code ? ` (${s.code})` : '');

function answer(plan: StoredPlan<DeleteItem>, report: Awaited<ReturnType<typeof runPlan>>): WloToolResult {
  return planReply('Löschen leerer Sammlungen:', report, plan.expiresAt, plan.items.map(i => ({
    id: { nodeId: i.nodeId },
    text: `„${i.title}“`,
    state: plan.state.get(i.key)!,
  })), label, 'items');
}

export function registerCurationDeleteEmptyTool(server: McpServer, challenge: WriteAuthChallenge): void {
  registerCurationTool(server, challenge, {
    replay: false, // the key continues a stored plan (plan-runner.ts)
    name: 'wlo_delete_collections',
    title: 'WLO Leere Sammlungen löschen (Stapel)',
    description: `Lösche viele Sammlungen mit EINER Bestätigung — aber NUR leere: ohne Untersammlung, ohne Verweis, ohne eigenes Material. Gedacht zum gefahrlosen Zurücknehmen eines falsch angelegten Baums; bis zu ${DELETE_EMPTY_MAX} nodeIds.
Eine Sammlung, deren einziger Inhalt mitgenannte leere Untersammlungen sind, zählt als leer (Kinder werden zuerst gelöscht). Alles andere bleibt und kommt als not_empty zurück — das ist eine Antwort, kein Fehler. „Leer“ wird direkt gelesen, für die Vorschau und noch einmal unmittelbar vor jedem Löschen — es heißt: nichts, was DIESE Anmeldung sehen kann.
Ohne Schlüssel: Vorschau mit jeder Sammlung und dem, was mit ihr geschieht. Mit confirmToken: läuft bis zu ~40 s je Aufruf; ist es nicht fertig, kommt complete: false mit continuationToken. Antwort: items [{nodeId, status, code?}] — deleted, not_empty, unverified, failed.
Gelöschtes lässt sich nicht verlässlich wiederherstellen. Für EINE Sammlung samt Inhalt: wlo_delete_collection.`,
    inputSchema: {
      nodeIds: z.array(z.string().min(1).max(200)).min(1).max(DELETE_EMPTY_MAX).describe('nodeIds der Sammlungen. Reihenfolge egal.'),
      confirmToken: z.string().max(200).optional(),
      continuationToken: z.string().max(200).optional(),
    },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
    handler: async (params) => {
      requireWrite();
      const ids = [...new Set((params['nodeIds'] as string[]).map(id => id.trim()))];
      return runPlannedCall<DeleteItem>({
        kind: KIND, params,
        // Order does not matter to the caller, so it does not make another plan.
        args: canonicalArgs([...ids].sort()),
        step: (plan) => deleteEmptyStep(plan),
        answer,
        prepare: async () => {
          const resolved = await resolveDeletions(ids);
          if (!resolved.ok) return { reply: rejectionReply(resolved.reasons, { refused: resolved.refused }) };
          const { items, notEmpty, unknown, viaChildren } = resolved;
          const candidates = items.filter(i => !notEmpty.has(i.key));
          if (!candidates.length) {
            // Nothing to approve. An answer, not an error: "not empty" is what was asked.
            return { reply: {
              content: [{ type: 'text' as const, text: [
                `Keine der ${items.length} Sammlungen ist leer — es wurde nichts gelöscht.`,
                ...items.map(i => `- ${deleteLine(i, notEmpty.get(i.key), false)}`),
              ].join('\n') }],
              structuredContent: {
                complete: true, progress: { done: items.length, total: items.length },
                items: items.map(i => ({ nodeId: i.nodeId, status: 'not_empty' as const })),
              },
            } };
          }
          const cs = buildChangeSet('delete-empty-collections', 'collection', {}, {}, {
            action: `Löscht ${candidates.length} leere Sammlungen`
              + (notEmpty.size ? `; ${notEmpty.size} sind nicht leer und bleiben bestehen` : '')
              + '. Eine Sammlung, die beim Löschen doch nicht leer ist, bleibt ebenfalls:',
            items: items.map(i => deleteLine(i, notEmpty.get(i.key), unknown.has(i.key), viaChildren.has(i.key))),
          });
          const initial = new Map<string, ItemState>([...notEmpty.keys()].map(key => [key, { status: 'not_empty' }]));
          return { draft: { cs, items, initial, preview: () => previewReply(cs,
            'Gelöschte Sammlungen lassen sich nicht verlässlich wiederherstellen.') } };
        },
        context: 'Fehler beim Löschen leerer Sammlungen',
        whatIsOpen: 'Ob schon Sammlungen gelöscht wurden',
      });
    },
  });
}
