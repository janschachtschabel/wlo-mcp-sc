/**
 * tools/curation-suggestions.ts – proposing metadata, and reviewing proposals.
 *
 * A proposal is not a change. `/suggestions/v1` stores what a model thinks a
 * record should say; measured, it applies nothing on its own. So neither tool
 * here touches a node — the record stays exactly as it was, and someone decides
 * later (`curation-decide.ts`).
 *
 * `type: AI` is fixed at creation and cannot be changed afterwards (the PATCH
 * takes no type). That is deliberate: the type records that a model wrote the
 * proposal, the status records that a human approved it. Both stay readable
 * side by side, which is what the editorial team reads provenance from.
 *
 * Storing a proposal is still a write to the repository, so it goes through the
 * same two-step confirmation as every other mutation — one preview, one
 * single-use key. The friction is a call, and it is what keeps "the model may
 * propose" from meaning "the model may write unattended".
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { toolError } from './shared.js';
import { requireWrite, requireWriteRoute, type WriteRoute } from '../services/write/credential-gate.js';
import { buildChangeSet, type ChangeSet } from '../services/write/change-set.js';
import { validateField } from '../services/write/fields.js';
import {
  createSuggestions,
  createSuggestionsRequest,
  listSuggestions,
  suggestionsFor,
  newProposals,
  valuesAfterAccept,
  STATUS_LABEL,
  type Suggestion,
  type SuggestionDraft,
  type SuggestionStatus,
} from '../services/write/suggestions.js';
import { readWriteBaseline } from '../services/write/nodes.js';
import { propertyOn } from '../services/write/collection-fields.js';
import { getNodeMetadata } from '../wlo-node.js';
import { flattenText, sanitizeText } from '../text-sanitize.js';
import {
  registerCurationTool,
  type WriteAuthChallenge,
  previewReply,
  confirmOrExplain,
  rejectionReply,
  errorText,
  codedError,
  plainText,
  preparedReply,
  recordTitle,
  fieldLabel,
  timeoutOrError,
  isPreviewCall,
  candidatesField,
  candidatesOf,
  type FieldCandidates,
} from './curation-shared.js';
import { CONTENT_FIELDS, CONFIRM_TOKEN } from './curation-fields.js';

const FIELD_NAMES = Object.keys(CONTENT_FIELDS) as [string, ...string[]];

/**
 * Upper bound on suggestions per call — every caller-supplied array is bounded
 * in its schema (zod GHSA-mrhx-c7xc-m3w5). One entry per field and per keyword,
 * so this is far above what a single record can need.
 */
export const MAX_SUGGESTIONS = 50;

export function registerCurationSuggestionTools(server: McpServer, challenge: WriteAuthChallenge): void {
  registerCurationTool(server, challenge, {
    name: 'wlo_suggest_metadata',
    title: 'WLO Metadaten vorschlagen',
    description:
      'Schlage Metadaten für einen WLO-Datensatz VOR, ohne ihn zu ändern. Die Vorschläge werden mit ' +
      'Begründung im Repository hinterlegt und können später angenommen oder abgelehnt werden — nutze das, ' +
      'wenn jemand anders entscheiden soll oder die Entscheidung nicht jetzt fällt. Sollen die Werte direkt ' +
      'in den Datensatz, ist wlo_update_content das richtige Werkzeug. Gilt auch für Sammlungen. ZWEISTUFIG: ohne confirmToken nur ' +
      'Vorschau. Erfordert eine Anmeldung.',
    inputSchema: {
      nodeId: z.string().describe('nodeId des Datensatzes, für den vorgeschlagen wird.'),
      suggestions: z.array(z.object({
        field: z.enum(FIELD_NAMES).describe('Feld, z. B. "title", "description", "keywords", "discipline".'),
        value: z.string().describe('Der vorgeschlagene Wert. Labels werden wie beim Bearbeiten aufgelöst.'),
        // Bounded like the note in `wlo_submit_content`, and for the same
        // reason: it is stored, and since it now travels in the preview an
        // unbounded value would push the values it justifies out of view.
        reason: z.string().max(1000).describe(
          'Warum dieser Wert besser ist. Wird mitgespeichert und ist das, worauf die prüfende Person entscheidet.',
        ),
        confidence: z.number().min(0).max(1).optional().describe('Wie sicher der Vorschlag ist (0–1).'),
      })).min(1).max(MAX_SUGGESTIONS).describe('Ein Eintrag je Feld. Für mehrere Schlagwörter mehrere Einträge mit field="keywords".'),
      confirmToken: CONFIRM_TOKEN,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    // Preparable (user decision 2026-08-12): a proposal is one request, it
    // changes no record, and a person decides on it afterwards — so it is the
    // one write beyond collection membership the embedded page may carry out.
    preparable: true,
    handler: async (params: Record<string, unknown>) => {
      try {
        return await handleSuggest(params, requireWriteRoute());
      } catch (err) {
        return timeoutOrError('Die Vorschläge konnten nicht gespeichert werden', err,
          `Ob die Vorschläge zu „${sanitizeText(String(params['nodeId'] ?? ''))}“ hinterlegt wurden, ist offen`, { preview: isPreviewCall(params) });
      }
    },
  });

  registerCurationTool(server, challenge, {
    name: 'wlo_list_suggestions',
    title: 'WLO Vorschläge ansehen',
    description:
      'Zeige die hinterlegten Metadaten-Vorschläge zu einem WLO-Datensatz mit Begründung, Status und der ID, ' +
      'die wlo_decide_suggestion braucht. Ändert nichts. Erfordert eine Anmeldung.',
    inputSchema: {
      nodeId: z.string().describe('nodeId des Datensatzes.'),
      status: z.enum(['PENDING', 'ACCEPTED', 'DECLINED']).optional()
        .describe('Filter; ohne Angabe werden alle gezeigt. PENDING = noch offen.'),
    },
    annotations: { readOnlyHint: true },
    handler: async (params: Record<string, unknown>) => {
      try {
        requireWrite();
        const nodeId = String(params['nodeId'] ?? '');
        const status = params['status'] as SuggestionStatus | undefined;
        // Through a reference id the proposals of the ORIGINAL are listed too —
        // that is where they are filed. A node we cannot read is asked directly.
        const node = await getNodeMetadata(nodeId);
        const found = node ? await suggestionsFor(node, nodeId, status) : await listSuggestions(nodeId, status);
        if (found.length === 0) {
          return plainText(status
            ? `Zu diesem Datensatz gibt es keine Vorschläge mit dem Status ${STATUS_LABEL[status]}.`
            : 'Zu diesem Datensatz gibt es keine Vorschläge.');
        }
        return plainText([`Vorschläge zu ${sanitizeText(nodeId)}:`, ...found.map(renderSuggestion)].join('\n'));
      } catch (err) {
        return toolError('Die Vorschläge konnten nicht gelesen werden', err);
      }
    },
  });
}

/**
 * One proposal as one line.
 *
 * EVERY field is sanitized, the id and the status included: a proposal is stored
 * by whoever has write access — another system among them — so all of it is
 * foreign text, and this list is line-oriented. An unsanitized id or an unmapped
 * status would let a newline open a second row with its own „Status: angenommen“,
 * which is precisely what a curator scans the list for.
 */
function renderSuggestion(s: Suggestion): string {
  const parts = [`Wert: „${sanitizeText(s.value)}“`];
  if (s.description) parts.push(`Begründung: ${sanitizeText(s.description)}`);
  if (s.confidence !== undefined) parts.push(`Zuversicht: ${s.confidence}`);
  parts.push(`Status: ${STATUS_LABEL[s.status] ?? sanitizeText(s.status)}`);
  return `- ${sanitizeText(s.id)} · ${fieldLabel(s.propertyId)} — ${parts.join('; ')}`;
}

interface RawSuggestion {
  field: string;
  value: string;
  reason: string;
  confidence?: number;
}

/**
 * One proposal's rationale, next to the value it justifies.
 *
 * The value is named again even though the change lines already carry it: ONE
 * field can hold several proposals (`field: "keywords"` twice), and then the
 * rationales are only checkable beside the value each one belongs to — which is
 * the whole purpose of putting them in front of a person.
 *
 * The rationale is flattened and NOT capped: it is bounded by the schema, and it
 * is exactly the text being approved. The value is capped, because here it only
 * says which proposal is meant — the full value sits in the change line above
 * and is fingerprinted from there.
 */
function reasonLine(d: SuggestionDraft): string {
  const confidence = d.confidence !== undefined ? ` (Zuversicht ${d.confidence})` : '';
  return `„${sanitizeText(d.value)}“${confidence}: ${flattenText(d.description)}`;
}

async function handleSuggest(params: Record<string, unknown>, route: WriteRoute) {
  const nodeId = String(params['nodeId'] ?? '');
  const raw = (Array.isArray(params['suggestions']) ? params['suggestions'] : []) as RawSuggestion[];

  // Validated before anything is stored: a proposal whose value could never be
  // written is not a proposal, it is a task that fails later, for someone else.
  const drafts: SuggestionDraft[] = [];
  const reasons: string[] = [];
  const candidates: FieldCandidates[] = [];
  const notes: string[] = [];

  for (const entry of raw) {
    const property = CONTENT_FIELDS[entry.field];
    if (!property) {
      reasons.push(`Das Feld „${sanitizeText(entry.field)}“ gibt es nicht.`);
      continue;
    }
    const checked = validateField(property, entry.value);
    if (!checked.ok) {
      reasons.push(checked.reason);
      candidates.push(...candidatesOf(entry.field, checked.refused));
      continue;
    }
    // Shown with the preview like every other tool's: an alias is proposed as what it resolves to.
    if (checked.note && !notes.includes(checked.note)) notes.push(checked.note);
    // The normalised value is stored, not the raw label: it is what would be
    // written, and re-validating it on accept yields the same thing.
    const value = checked.values[0];
    if (value === undefined) continue;
    drafts.push({
      propertyId: property,
      value,
      description: entry.reason,
      ...(entry.confidence !== undefined ? { confidence: entry.confidence } : {}),
    });
  }
  if (reasons.length > 0) return rejectionReply(reasons, candidatesField(candidates));

  const node = await getNodeMetadata(nodeId);
  if (!node) return codedError('not_found', `Der Datensatz „${sanitizeText(nodeId)}“ wurde nicht gefunden oder ist nicht lesbar.`);

  // A proposal is about the RECORD, so it is compared against and filed at the
  // original — as the batch tool does (audit 2026-11-12, K-9). Through a
  // reference that was once written directly, the reference already shows the
  // wanted value and the original does not: "nothing to propose" was then said
  // about the wrong node.
  const baseline = await readWriteBaseline(node, nodeId);
  if (!baseline.ok) return errorText(baseline.reason);
  const { target, before } = baseline;
  const home = target.targetId;

  // Values the record already carries are dropped, per value — proposing those
  // would put a decision in front of someone that has nothing to decide. Filed
  // under the property this node keeps the value in (`collection-fields.ts`).
  const kept = newProposals(before, drafts.map(d => ({ ...d, propertyId: propertyOn(baseline.written, d.propertyId) })));
  // What the record would hold if every proposal were accepted. For a field
  // holding several values that is the list WITH the proposed one, which is
  // what the change line has to show — not the proposed value in place of it.
  const desired: Record<string, string[]> = {};
  for (const d of kept) {
    desired[d.propertyId] = valuesAfterAccept(d.propertyId, desired[d.propertyId] ?? before[d.propertyId] ?? [], [d.value]);
  }
  for (const property of Object.keys(desired)) {
    // A single-valued field proposed twice: both proposals stand side by side.
    const mine = kept.filter(d => d.propertyId === property).map(d => d.value);
    if (desired[property]!.length < mine.length) desired[property] = mine;
  }
  const planned = buildChangeSet(home, 'content', before, desired,
    target.redirected ? { redirectedFrom: target.requestedId } : {});
  if (kept.length === 0 || planned.changes.length === 0) {
    return errorText('Die vorgeschlagenen Werte stehen bereits so im Datensatz — es gibt nichts vorzuschlagen.');
  }

  // The rationales go INTO the action, which is what puts them in the preview
  // AND in the token's fingerprint — the rule `wlo_submit_content` states for
  // its note to the editorial team, applied to the same kind of text. Without
  // it the token binds the values alone, so a second call could carry any
  // justification at all: unseen by whoever approved, and stored as precisely
  // the text the reviewing curator decides on. Built after `kept`, because a
  // rationale for a value the record already holds is not part of what happens.
  const cs: ChangeSet = {
    ...planned,
    action: `Schlägt für „${recordTitle(before, baseline.written)}“ (${home}) die folgenden Werte zur Prüfung vor. `
      + 'Der Datensatz selbst wird dabei NICHT verändert. '
      + `Begründungen: ${kept.map(reasonLine).join('; ')}`,
  };

  const token = typeof params['confirmToken'] === 'string' ? params['confirmToken'] : '';
  if (!token) return previewReply(cs, 'Zum Hinterlegen der Vorschläge bitte bestätigen.', notes);
  const refusal = confirmOrExplain(token, cs);
  if (refusal) return refusal;

  if (route === 'prepare') {
    // Deliberately no id list in the sentence: the repository assigns the ids in
    // its answer to the POST, and in this direction nobody here reads it. Naming
    // ids we never saw would be the one thing worse than not naming them.
    return preparedReply(createSuggestionsRequest(home, kept), [
      `Als Vorschlag ${target.redirected ? `am Original ${home} ` : ''}hinterlegt (Status: offen) — „${recordTitle(before, baseline.written)}“ ist unverändert.`,
      'Mit wlo_list_suggestions lassen sich die Vorschläge samt ID ansehen.',
    ].join(' '));
  }

  const result = await createSuggestions(home, kept);
  if (!result.ok) {
    // `open`: a 5xx, or a 2xx that named nothing stored — proposals may exist,
    // and a caller starting over would file them twice.
    return codedError(result.open ? 'unverified' : 'refused',
      `Die Vorschläge konnten nicht gespeichert werden: ${result.detail}`
        + (result.open ? ' Ob welche hinterlegt wurden, ist offen — bitte mit wlo_list_suggestions nachsehen, bevor der Aufruf wiederholt wird.' : ''),
      { outcomeOpen: result.open === true });
  }

  const lines = result.suggestions.map(x => `- ${sanitizeText(x.id)} · ${fieldLabel(x.propertyId)}`);
  if (result.suggestions.length < kept.length) {
    // Fewer named than sent: what became of the rest is not known, and "hinterlegt"
    // over the shorter list would pass them off as stored.
    return codedError('unverified', [
      `Das Repository nennt nur ${result.suggestions.length} von ${kept.length} Vorschlägen als hinterlegt`
        + `${target.redirected ? ` (am Original ${home})` : ''}:`,
      ...lines,
      'Ob die übrigen gespeichert wurden, ist offen — bitte mit wlo_list_suggestions nachsehen, bevor der Aufruf wiederholt wird.',
    ].join('\n'), { outcomeOpen: true });
  }

  return plainText([
    target.redirected
      ? `Als Vorschlag am Original ${home} hinterlegt (Status: offen) — der Datensatz ist unverändert:`
      : 'Als Vorschlag hinterlegt (Status: offen) — der Datensatz ist unverändert:',
    ...lines,
    'Zum Übernehmen wlo_decide_suggestion mit der jeweiligen ID aufrufen.',
  ].join('\n'));
}
