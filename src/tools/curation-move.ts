/**
 * tools/curation-move.ts – wlo_move_collection (chatbot team, S5, 2026-11-14).
 * Schema and wording; what is read, refused and sent lives in
 * `services/write/collection-move.ts`.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { buildChangeSet } from '../services/write/change-set.js';
import { requireWrite } from '../services/write/credential-gate.js';
import { moveCollection, planMove, type Place } from '../services/write/collection-move.js';
import { sanitizeText } from '../text-sanitize.js';
import { CONFIRM_TOKEN } from './curation-fields.js';
import {
  codedError, confirmOrExplain, isPreviewCall, previewReply, registerCurationTool, reportMutation,
  timeoutOrError, type WriteAuthChallenge,
} from './curation-shared.js';

/** A place in a sentence. No collection above is the top level — said as that, not as an empty name. */
const where = (p: Place) => (p.nodeId
  ? `„${p.title}“ (${p.nodeId}${p.path.length > 1 ? `; Pfad: ${p.path.join(' › ')}` : ''})`
  : 'der obersten Ebene');

export function registerCurationMoveTool(server: McpServer, challenge: WriteAuthChallenge): void {
  registerCurationTool(server, challenge, {
    name: 'wlo_move_collection',
    title: 'WLO Sammlung umhängen',
    description: `Hänge eine Sammlung unter eine andere Elternsammlung — samt allen Untersammlungen und Inhalten. Die nodeId der Sammlung bleibt dieselbe, die Inhalte bleiben in ihr; nur ihr Platz im Baum ändert sich.
Abgelehnt wird vor jeder Bestätigung: ein Ziel im eigenen Teilbaum, ein Ziel, unter dem schon eine Sammlung gleichen Titels steht (das Repository würde beide nebeneinander stellen; Code exists mit existingId), und ein Ziel, unter dem die Sammlung schon liegt (no_change). Auf die oberste Ebene lässt sich hier nicht umhängen.
Rechte: an der Sammlung selbst gesetzte Rechte bleiben; geerbte Rechte kommen danach von der neuen Elternsammlung — die Sichtbarkeit kann sich dadurch ändern. Die Vorschau nennt alte und neue Elternsammlung mit Pfad und die Zahl der mitziehenden Untersammlungen.
ZWEISTUFIG: ohne confirmToken nur Vorschau. Danach wird der neue Pfad zurückgelesen. Erfordert eine Anmeldung.`,
    inputSchema: {
      nodeId: z.string().trim().min(1).max(200).describe('nodeId der Sammlung, die umgehängt wird.'),
      newParentId: z.string().trim().min(1).max(200).describe('nodeId der Sammlung, unter der sie danach liegt.'),
      confirmToken: CONFIRM_TOKEN,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    handler: async (params: Record<string, unknown>) => {
      try {
        requireWrite();
        const nodeId = String(params['nodeId'] ?? '').trim();
        const newParentId = String(params['newParentId'] ?? '').trim();
        const plan = await planMove(nodeId, newParentId);
        if (!plan.ok) {
          return codedError(plan.code, plan.message, { outcomeOpen: false, ...(plan.existingId ? { existingId: plan.existingId } : {}) });
        }
        const along = plan.subMore
          ? (plan.subCount ? `mindestens ${plan.subCount} Untersammlungen ziehen mit` : 'ihre Untersammlungen ziehen mit (die Zahl ließ sich nicht lesen)')
          : plan.subCount === 0 ? 'sie hat keine Untersammlungen' : `${plan.subCount} ${plan.subCount === 1 ? 'Untersammlung zieht' : 'Untersammlungen ziehen'} mit`;
        const cs = buildChangeSet(nodeId, 'collection', {}, {}, {
          action: `Hängt die Sammlung „${plan.collection.title}“ (${nodeId}) um — von ${where(plan.from)} nach ${where(plan.to)}. `
            + `Ihre Inhalte bleiben in ihr; ${along}. An der Sammlung selbst gesetzte Rechte bleiben, geerbte Rechte kommen danach von `
            + `„${plan.to.title}“ — ihre Sichtbarkeit kann sich dadurch ändern.`,
        });
        const token = typeof params['confirmToken'] === 'string' ? params['confirmToken'] : '';
        if (!token) return previewReply(cs, 'Zum Umhängen bitte bestätigen.');
        const refusal = confirmOrExplain(token, cs);
        if (refusal) return refusal;

        const outcome = await moveCollection(nodeId, newParentId);
        const done = reportMutation(outcome, `„${plan.collection.title}“ liegt jetzt unter „${plan.to.title}“.`, 'Die Sammlung konnte nicht umgehängt werden');
        if (outcome.status !== 'ok') return done;
        return { ...done, structuredContent: { nodeId, newParentId, previousParentId: plan.from.nodeId || null, path: [...plan.to.path, plan.collection.title] } };
      } catch (err) {
        return timeoutOrError('Die Sammlung konnte nicht umgehängt werden', err,
          `Ob „${sanitizeText(String(params['nodeId'] ?? ''))}“ umgehängt wurde, ist offen`, { preview: isPreviewCall(params) });
      }
    },
  });
}
