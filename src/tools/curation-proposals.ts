/**
 * tools/curation-proposals.ts – wlo_list_collection_proposals and
 * wlo_decide_collection_proposal (chatbot team, S8, 2026-11-14).
 *
 * Proposing itself is not a tool of its own: the filing tools propose where
 * the caller may read a collection and not write it (`filing-plan.ts`). These
 * two are for whoever MAY write it. What a proposal is and how a decision is
 * written lives in `services/write/collection-proposals.ts`.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { buildChangeSet } from '../services/write/change-set.js';
import { requireWrite } from '../services/write/credential-gate.js';
import { readFilingTarget } from '../services/write/create-filing.js';
import {
  PROPOSALS_MAX, decideProposal, listProposals, type Proposal, type ProposalStatus,
} from '../services/write/collection-proposals.js';
import { nodeIdLine, oneLine, quotedTitle } from '../formatter.js';
import { sanitizeText } from '../text-sanitize.js';
import { CONFIRM_TOKEN } from './curation-fields.js';
import {
  codedError, confirmOrExplain, isPreviewCall, markWritten, plainText, previewReply, registerCurationTool,
  timeoutOrError, type WriteAuthChallenge,
} from './curation-shared.js';

const STATUS_LABEL: Record<ProposalStatus, string> = { PENDING: 'offen', ACCEPTED: 'angenommen', DECLINED: 'abgelehnt' };

/** Why a listing could not be had, as a code — a proposer without write permission gets 403 (measured). */
function listingRefused(collectionId: string, httpStatus: number, detail: string) {
  if (httpStatus === 403 || httpStatus === 401) {
    return codedError('forbidden', `Die Vorschläge an „${sanitizeText(collectionId)}“ sieht nur, wer an dieser Sammlung schreiben darf. `
      + 'Wer nur lesen darf, kann vorschlagen, die eigenen Vorschläge aber nicht auflisten.', { outcomeOpen: false });
  }
  return codedError(httpStatus === 404 ? 'not_found' : 'upstream_error', `Die Vorschläge konnten nicht gelesen werden: ${detail}`, { outcomeOpen: false });
}

async function target(collectionId: string) {
  const found = await readFilingTarget(collectionId);
  if (found.ok) return { ok: true as const, title: sanitizeText(found.target.title) };
  return { ok: false as const, reply: found.reason === 'not_a_collection'
    ? codedError('not_a_collection', `„${sanitizeText(collectionId)}“ ist keine Sammlung.`, { outcomeOpen: false })
    : codedError('not_found', `Die Sammlung „${sanitizeText(collectionId)}“ wurde nicht gefunden oder ist nicht lesbar.`, { outcomeOpen: false }) };
}

export function registerCurationProposalTools(server: McpServer, challenge: WriteAuthChallenge): void {
  registerCurationTool(server, challenge, {
    name: 'wlo_list_collection_proposals',
    title: 'WLO Vorschläge an eine Sammlung ansehen',
    description: `Zeige, welche Materialien für EINE Sammlung vorgeschlagen wurden — von Personen, die dort lesen, aber nicht schreiben dürfen. Ein Vorschlag ist KEINE Aufnahme: das Material liegt erst nach der Entscheidung in der Sammlung. Ändert nichts.
Sichtbar nur für Personen mit Schreibrecht an der Sammlung (sonst forbidden). status: PENDING (Vorgabe, noch offen), ACCEPTED, DECLINED. Antwort: proposals [{nodeId, title, proposalId, status, accessible?}] — accessible: false heißt, das vorgeschlagene Material ist für diese Anmeldung selbst nicht lesbar.
Entscheiden mit wlo_decide_collection_proposal. Erfordert eine Anmeldung.`,
    inputSchema: {
      collectionId: z.string().trim().min(1).max(200).describe('nodeId der Sammlung.'),
      status: z.enum(['PENDING', 'ACCEPTED', 'DECLINED']).optional().default('PENDING'),
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    handler: async (params: Record<string, unknown>) => {
      try {
        requireWrite();
        const collectionId = String(params['collectionId'] ?? '').trim();
        const status = (params['status'] ?? 'PENDING') as ProposalStatus;
        const t = await target(collectionId);
        if (!t.ok) return t.reply;
        const list = await listProposals(collectionId, status);
        if (!list.ok) return listingRefused(collectionId, list.httpStatus, list.detail);
        const structuredContent = {
          collectionId, status, count: list.proposals.length, proposals: list.proposals,
          ...(list.truncated ? { truncated: true as const } : {}),
        };
        const head = oneLine(`Vorschläge (${STATUS_LABEL[status]}) an die Sammlung ${nodeIdLine(collectionId)}: ${list.proposals.length} — ${quotedTitle(t.title)}`);
        const lines = list.proposals.length
          // The id first, the title last and quoted: a title is data.
          ? list.proposals.map(p => oneLine(`- ${nodeIdLine(p.nodeId)}${p.accessible === false ? ' [für diese Anmeldung nicht lesbar]' : ''} — ${quotedTitle(p.title)}`))
          : [`Es gibt keine Vorschläge mit dem Status ${STATUS_LABEL[status]}.`];
        if (list.truncated) lines.push(`… es gibt mehr als ${PROPOSALS_MAX}; gezeigt sind die ersten.`);
        return { ...plainText([head, ...lines].join('\n')), structuredContent };
      } catch (err) {
        return timeoutOrError('Die Vorschläge konnten nicht gelesen werden', err, 'Die Liste der Vorschläge', { preview: true });
      }
    },
  });

  registerCurationTool(server, challenge, {
    name: 'wlo_decide_collection_proposal',
    title: 'WLO Vorschlag an eine Sammlung entscheiden',
    description: `Nimm einen Vorschlag an eine Sammlung an oder lehne ihn ab. ANNEHMEN nimmt das Material in die Sammlung auf, liest das zurück und markiert ERST DANN den Vorschlag als angenommen — ein „angenommen“ über einer Sammlung, die das Material nie bekam, läse sich wie erledigte Arbeit. ABLEHNEN markiert den Vorschlag; das Material bleibt, wo es ist, kann für diese Sammlung aber nicht noch einmal vorgeschlagen werden.
Nur ein OFFENER Vorschlag lässt sich entscheiden. nodeId ist die des vorgeschlagenen Materials (aus wlo_list_collection_proposals). ZWEISTUFIG: ohne confirmToken nur Vorschau. Erfordert Schreibrecht an der Sammlung.`,
    inputSchema: {
      collectionId: z.string().trim().min(1).max(200).describe('nodeId der Sammlung.'),
      nodeId: z.string().trim().min(1).max(200).describe('nodeId des vorgeschlagenen Materials.'),
      decision: z.enum(['accept', 'decline']),
      confirmToken: CONFIRM_TOKEN,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    handler: async (params: Record<string, unknown>) => {
      const collectionId = String(params['collectionId'] ?? '').trim();
      const nodeId = String(params['nodeId'] ?? '').trim();
      try {
        requireWrite();
        const accept = params['decision'] === 'accept';
        const t = await target(collectionId);
        if (!t.ok) return t.reply;
        const pending = await listProposals(collectionId, 'PENDING');
        if (!pending.ok) return listingRefused(collectionId, pending.httpStatus, pending.detail);
        const proposal: Proposal | undefined = pending.proposals.find(p => p.nodeId === nodeId);
        if (!proposal) {
          return pending.truncated
            ? codedError('not_checked', `Die Sammlung hat mehr als ${PROPOSALS_MAX} offene Vorschläge; unter den gelesenen ist „${sanitizeText(nodeId)}“ nicht. Es wurde nichts geändert.`, { outcomeOpen: false })
            : codedError('no_pending_proposal', `Für „${sanitizeText(nodeId)}“ gibt es an „${t.title}“ keinen offenen Vorschlag — nur ein offener lässt sich entscheiden. Es wurde nichts geändert.`, { outcomeOpen: false });
        }
        const cs = buildChangeSet(collectionId, 'collection', {}, {}, {
          action: accept
            ? `Nimmt den Vorschlag an: „${proposal.title}“ (${nodeId}) wird in die Sammlung „${t.title}“ (${collectionId}) aufgenommen, `
              + `danach wird der Vorschlag (${proposal.proposalId}) als angenommen markiert.`
            : `Lehnt den Vorschlag ab: „${proposal.title}“ (${nodeId}) wird NICHT in die Sammlung „${t.title}“ (${collectionId}) aufgenommen; `
              + `der Vorschlag (${proposal.proposalId}) wird als abgelehnt markiert und kann für diese Sammlung nicht wiederholt werden.`,
        });
        const token = typeof params['confirmToken'] === 'string' ? params['confirmToken'] : '';
        // Unmeasured: whether a material this login cannot read can be filed by it. Said before the key.
        const notes = accept && proposal.accessible === false
          ? ['Das vorgeschlagene Material ist für diese Anmeldung selbst nicht lesbar — ob das Aufnehmen gelingt, zeigt erst der Versuch.'] : [];
        if (!token) return previewReply(cs, accept ? 'Zum Annehmen bitte bestätigen.' : 'Zum Ablehnen bitte bestätigen.', notes);
        const refusal = confirmOrExplain(token, cs);
        if (refusal) return refusal;

        const outcome = await decideProposal(collectionId, proposal, accept);
        const ids = { collectionId, nodeId, proposalId: proposal.proposalId };
        switch (outcome.status) {
          case 'accepted':
            return { ...plainText(`Angenommen: „${proposal.title}“ liegt jetzt in „${t.title}“, und der Vorschlag ist als angenommen markiert.`),
              structuredContent: { ...ids, status: 'accepted' } };
          case 'declined':
            return { ...plainText(`Abgelehnt: der Vorschlag ist als abgelehnt markiert. „${proposal.title}“ wurde nicht aufgenommen.`),
              structuredContent: { ...ids, status: 'declined' } };
          case 'filed_not_marked':
            // The material IS in the collection: said first, and marked as written.
            return markWritten(codedError('proposal_not_marked', `„${proposal.title}“ liegt jetzt in „${t.title}“. `
              + (outcome.mark === 'failed'
                ? `Der Vorschlag ließ sich aber nicht als angenommen markieren und steht weiter als offen da (${outcome.detail}). `
                : `Ob der Vorschlag als angenommen markiert ist, ließ sich nicht bestätigen (${outcome.detail}). `)
              + 'Nicht noch einmal annehmen.', { ...ids, mark: outcome.mark }), nodeId);
          case 'failed':
            return codedError(outcome.httpStatus === 403 || outcome.httpStatus === 401 ? 'forbidden' : 'upstream_error',
              `Die Entscheidung konnte nicht geschrieben werden: ${outcome.detail}`, ids);
          case 'not_visible':
            return codedError('not_visible', `Die Anfrage wurde angenommen, die Änderung ist aber nicht zu sehen. ${outcome.detail}`, ids);
          default:
            return codedError('unverified', `Die Anfrage wurde angenommen, ließ sich danach aber nicht überprüfen. ${outcome.detail}`, ids);
        }
      } catch (err) {
        return timeoutOrError('Der Vorschlag konnte nicht entschieden werden', err,
          `Ob der Vorschlag für „${sanitizeText(nodeId)}“ entschieden wurde, ist offen`, { preview: isPreviewCall(params) });
      }
    },
  });
}
