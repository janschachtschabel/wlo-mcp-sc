/**
 * tools/curation-decide.ts – accepting or declining a stored proposal.
 *
 * Split from `curation-suggestions.ts` because the two have different reasons to
 * change: that file stores opinions, this one changes records. This is the only
 * tool in the suggestion group that touches a node, and the whole write pipeline
 * (change set, confirmation, read-back) lives on this side of the line.
 *
 * The order is the design decision. Accepting is two upstream operations and
 * either can fail alone:
 *
 *   apply the value → read it back → only THEN mark the proposal accepted
 *
 * A proposal marked ACCEPTED over a record that never received the value reads,
 * to the next curator, as work already done. The reverse failure — value
 * written, proposal still open — costs one repeated decision and states nothing
 * untrue. So a write that did not verify produces no ACCEPTED, ever.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { requireWrite } from '../services/write/credential-gate.js';
import { buildChangeSet } from '../services/write/change-set.js';
import { updateNodeMetadata, readWriteBaseline } from '../services/write/nodes.js';
import { verifyWrite } from '../services/write/verify.js';
import { validateField } from '../services/write/fields.js';
import { listSuggestions, setSuggestionStatus } from '../services/write/suggestions.js';
import { getNodeMetadata } from '../wlo-node.js';
import { sanitizeText } from '../text-sanitize.js';
import {
  registerCurationTool,
  type WriteAuthChallenge,
  previewReply,
  confirmOrExplain,
  reportOutcome,
  unverifiedReply,
  desiredFromChangeSet,
  errorText,
  plainText,
  prependText,
  recordTitle,
  fieldLabel,
  timeoutOrError,
} from './curation-shared.js';
import { CONFIRM_TOKEN } from './curation-fields.js';

export function registerCurationDecisionTool(server: McpServer, challenge: WriteAuthChallenge): void {
  registerCurationTool(server, challenge, {
    name: 'wlo_decide_suggestion',
    title: 'WLO Vorschlag annehmen oder ablehnen',
    description:
      'Entscheide über einen hinterlegten Metadaten-Vorschlag. "accept" schreibt den Wert in den Datensatz, ' +
      'liest ihn zurück und vermerkt den Vorschlag erst dann als angenommen — kommt der Wert nicht an, bleibt ' +
      'der Vorschlag offen und das wird berichtet. "decline" vermerkt nur die Ablehnung und lässt den ' +
      'Datensatz unberührt. Die ID kommt aus wlo_list_suggestions. ZWEISTUFIG: ohne confirmToken nur ' +
      'Vorschau. Erfordert eine Anmeldung.',
    inputSchema: {
      nodeId: z.string().describe('nodeId des Datensatzes.'),
      suggestionId: z.string().describe('ID des Vorschlags aus wlo_list_suggestions.'),
      decision: z.enum(['accept', 'decline']).describe('accept übernimmt den Wert, decline lehnt ihn ab.'),
      confirmToken: CONFIRM_TOKEN,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    handler: async (params: Record<string, unknown>) => {
      try {
        requireWrite();
        return await handleDecide(params);
      } catch (err) {
        return timeoutOrError('Über den Vorschlag konnte nicht entschieden werden', err,
          `Ob der Wert in „${sanitizeText(String(params['nodeId'] ?? ''))}“ geschrieben und der Vorschlag vermerkt wurde, ist offen`);
      }
    },
  });
}

async function handleDecide(params: Record<string, unknown>) {
  const nodeId = String(params['nodeId'] ?? '');
  const suggestionId = String(params['suggestionId'] ?? '');
  const token = typeof params['confirmToken'] === 'string' ? params['confirmToken'] : '';

  const found = (await listSuggestions(nodeId)).find(s => s.id === suggestionId);
  if (!found) {
    return errorText(
      `Zu diesem Datensatz gibt es keinen Vorschlag mit der ID „${sanitizeText(suggestionId)}“. ` +
        'Die gültigen IDs liefert wlo_list_suggestions.',
    );
  }

  const node = await getNodeMetadata(nodeId);
  if (!node) return errorText(`Der Datensatz „${sanitizeText(nodeId)}“ wurde nicht gefunden oder ist nicht lesbar.`);
  const before = node.properties ?? {};
  const label = fieldLabel(found.propertyId);
  const title = recordTitle(before);
  // Everything about a stored proposal is foreign text, its id included. The
  // raw `found.id` still goes upstream; only what a person reads is flattened.
  const id = sanitizeText(found.id);

  if (params['decision'] === 'decline') {
    const cs = buildChangeSet(nodeId, 'content', before, {}, {
      action: `Lehnt den Vorschlag ${id} für „${label}“ ab. ` +
        `Am Datensatz „${title}“ (${nodeId}) ändert sich dadurch nichts.`,
    });
    if (!token) return previewReply(cs, 'Zum Ablehnen bitte bestätigen.');
    const refusal = confirmOrExplain(token, cs);
    if (refusal) return refusal;

    const failure = await setSuggestionStatus(nodeId, found.id, 'DECLINED');
    if (failure) return errorText(`Die Ablehnung konnte nicht vermerkt werden: ${failure}`);
    return plainText(`Vorschlag ${id} abgelehnt. Der Datensatz ist unverändert.`);
  }

  // A suggestion can come from anywhere, including another system, so its
  // property is not necessarily one we may write. Refused before the change set,
  // so nothing is half-done — and declining stays available, or the proposal
  // would be stuck on the list forever.
  const checked = validateField(found.propertyId, found.value);
  if (!checked.ok) {
    return errorText(
      `${checked.reason} Der Vorschlag wurde deshalb NICHT übernommen. ` +
        'Mit decision="decline" lässt er sich ablehnen.',
    );
  }

  // Two nodes, deliberately. The VALUE belongs on the record, so it follows the
  // write target; the PROPOSAL is filed on the node it was found on
  // (`listSuggestions(nodeId)` above), so its status stays there. Marking it
  // accepted on a node that never carried it would lose the proposal.
  //
  // The comparison state follows the VALUE, not the proposal: diffing against an
  // overridden reference would find the wanted value already present, skip the
  // write, and mark the proposal accepted over a record that never received it.
  const baseline = await readWriteBaseline(node, nodeId);
  if (!baseline.ok) return errorText(baseline.reason);
  const { target, before: writeBefore } = baseline;
  // Title and id in one sentence have to belong to the SAME node. `title` above
  // is the requested node's, which is the right one for the decline path — here
  // the id is the target's, so the title has to come from the target too, or a
  // person confirms a sentence naming a title that record does not carry.
  const targetTitle = recordTitle(writeBefore);
  const cs = buildChangeSet(target.targetId, 'content', writeBefore, { [found.propertyId]: checked.values }, {
    action: `Nimmt den Vorschlag ${id} für „${label}“ an: der Wert wird in „${targetTitle}“ (${target.targetId}) ` +
      'geschrieben und der Vorschlag anschließend als angenommen vermerkt.',
    ...(target.redirected ? { redirectedFrom: target.requestedId } : {}),
  });
  if (!token) return previewReply(cs, 'Zum Annehmen bitte bestätigen.');
  const refusal = confirmOrExplain(token, cs);
  if (refusal) return refusal;

  if (cs.changes.length === 0) {
    const failure = await setSuggestionStatus(nodeId, found.id, 'ACCEPTED');
    if (failure) {
      return errorText(
        `Der Wert stand bereits im Datensatz, der Vorschlag konnte aber nicht als angenommen vermerkt werden: ${failure}`,
      );
    }
    return plainText(`Der Wert stand bereits so im Datensatz. Vorschlag ${id} ist jetzt als angenommen vermerkt.`);
  }

  const { statuses } = await updateNodeMetadata(cs.nodeId, desiredFromChangeSet(cs), { commit: false });
  let verified;
  try {
    verified = await verifyWrite(cs);
  } catch (err) {
    // Unknown outcome. Marking the proposal accepted here would turn "we do not
    // know" into "it is done".
    return prependText(unverifiedReply(err), `Vorschlag ${id} bleibt offen.`);
  }

  const report = reportOutcome(cs, statuses, verified);
  if (!verified.allStored) {
    return prependText(
      report,
      `Vorschlag ${id} bleibt offen — er wurde NICHT als angenommen markiert, ` +
        'weil der Wert nicht im Datensatz angekommen ist.',
    );
  }

  const failure = await setSuggestionStatus(nodeId, found.id, 'ACCEPTED');
  if (failure) {
    return prependText(
      report,
      `Der Wert wurde übernommen, der Vorschlag konnte aber nicht als angenommen markiert werden ` +
        `(${failure}) — er steht weiterhin offen.`,
    );
  }
  return prependText(report, `Vorschlag ${id} angenommen.`);
}
