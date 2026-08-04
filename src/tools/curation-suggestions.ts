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

import { registerWloTool } from '../apps/register.js';
import { toolError } from './shared.js';
import { requireWrite } from '../services/write/credential-gate.js';
import { buildChangeSet } from '../services/write/change-set.js';
import { validateField } from '../services/write/fields.js';
import {
  createSuggestions,
  listSuggestions,
  type Suggestion,
  type SuggestionDraft,
  type SuggestionStatus,
} from '../services/write/suggestions.js';
import { getNodeMetadata } from '../wlo-node.js';
import { sanitizeText } from '../text-sanitize.js';
import {
  previewReply,
  confirmOrExplain,
  rejectionReply,
  errorText,
  plainText,
  recordTitle,
  fieldLabel,
  timeoutOrError,
} from './curation-shared.js';
import { CONTENT_FIELDS, CONFIRM_TOKEN } from './curation-fields.js';

const FIELD_NAMES = Object.keys(CONTENT_FIELDS) as [string, ...string[]];

const STATUS_LABEL: Record<string, string> = {
  PENDING: 'offen',
  ACCEPTED: 'angenommen',
  DECLINED: 'abgelehnt',
};

export function registerCurationSuggestionTools(server: McpServer): void {
  registerWloTool(server, {
    name: 'wlo_suggest_metadata',
    title: 'WLO Metadaten vorschlagen',
    description:
      'Schlage Metadaten für einen WLO-Datensatz VOR, ohne ihn zu ändern. Die Vorschläge werden mit ' +
      'Begründung im Repository hinterlegt und können später angenommen oder abgelehnt werden — nutze das, ' +
      'wenn jemand anders entscheiden soll oder die Entscheidung nicht jetzt fällt. Sollen die Werte direkt ' +
      'in den Datensatz, ist wlo_update_content das richtige Werkzeug. ZWEISTUFIG: ohne confirmToken nur ' +
      'Vorschau. Erfordert eine Anmeldung.',
    inputSchema: {
      nodeId: z.string().describe('nodeId des Datensatzes, für den vorgeschlagen wird.'),
      suggestions: z.array(z.object({
        field: z.enum(FIELD_NAMES).describe('Feld, z. B. "title", "description", "keywords", "discipline".'),
        value: z.string().describe('Der vorgeschlagene Wert. Labels werden wie beim Bearbeiten aufgelöst.'),
        reason: z.string().describe(
          'Warum dieser Wert besser ist. Wird mitgespeichert und ist das, worauf die prüfende Person entscheidet.',
        ),
        confidence: z.number().min(0).max(1).optional().describe('Wie sicher der Vorschlag ist (0–1).'),
      })).min(1).describe('Ein Eintrag je Feld. Für mehrere Schlagwörter mehrere Einträge mit field="keywords".'),
      confirmToken: CONFIRM_TOKEN,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    securitySchemes: [{ type: 'http' }],
    handler: async (params: Record<string, unknown>) => {
      try {
        requireWrite();
        return await handleSuggest(params);
      } catch (err) {
        return timeoutOrError('Die Vorschläge konnten nicht gespeichert werden', err,
          `Ob die Vorschläge zu „${sanitizeText(String(params['nodeId'] ?? ''))}“ hinterlegt wurden, ist offen`);
      }
    },
  });

  registerWloTool(server, {
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
    securitySchemes: [{ type: 'http' }],
    handler: async (params: Record<string, unknown>) => {
      try {
        requireWrite();
        const nodeId = String(params['nodeId'] ?? '');
        const status = params['status'] as SuggestionStatus | undefined;
        const found = await listSuggestions(nodeId, status);
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

async function handleSuggest(params: Record<string, unknown>) {
  const nodeId = String(params['nodeId'] ?? '');
  const raw = (Array.isArray(params['suggestions']) ? params['suggestions'] : []) as RawSuggestion[];

  // Validated before anything is stored: a proposal whose value could never be
  // written is not a proposal, it is a task that fails later, for someone else.
  const drafts: SuggestionDraft[] = [];
  const desired: Record<string, string[]> = {};
  const reasons: string[] = [];

  for (const entry of raw) {
    const property = CONTENT_FIELDS[entry.field];
    if (!property) {
      reasons.push(`Das Feld „${sanitizeText(entry.field)}“ gibt es nicht.`);
      continue;
    }
    const checked = validateField(property, entry.value);
    if (!checked.ok) {
      reasons.push(checked.reason);
      continue;
    }
    // The normalised value is stored, not the raw label: it is what would be
    // written, and re-validating it on accept yields the same thing.
    const value = checked.values[0];
    if (value === undefined) continue;
    desired[property] = [...(desired[property] ?? []), ...checked.values];
    drafts.push({
      propertyId: property,
      value,
      description: entry.reason,
      ...(entry.confidence !== undefined ? { confidence: entry.confidence } : {}),
    });
  }
  if (reasons.length > 0) return rejectionReply(reasons);

  const node = await getNodeMetadata(nodeId);
  if (!node) return errorText(`Der Datensatz „${sanitizeText(nodeId)}“ wurde nicht gefunden oder ist nicht lesbar.`);
  const before = node.properties ?? {};

  const cs = buildChangeSet(nodeId, 'content', before, desired, {
    action: `Schlägt für „${recordTitle(before)}“ (${nodeId}) die folgenden Werte zur Prüfung vor. ` +
      'Der Datensatz selbst wird dabei NICHT verändert:',
  });
  // buildChangeSet drops values the record already carries — proposing those
  // would put a decision in front of someone that has nothing to decide.
  const open = new Set(cs.changes.map(c => c.property));
  const kept = drafts.filter(d => open.has(d.propertyId));
  if (kept.length === 0) {
    return errorText('Die vorgeschlagenen Werte stehen bereits so im Datensatz — es gibt nichts vorzuschlagen.');
  }

  const token = typeof params['confirmToken'] === 'string' ? params['confirmToken'] : '';
  if (!token) return previewReply(cs, 'Zum Hinterlegen der Vorschläge bitte bestätigen.');
  const refusal = confirmOrExplain(token, cs);
  if (refusal) return refusal;

  const result = await createSuggestions(nodeId, kept);
  if (!result.ok) return errorText(`Die Vorschläge konnten nicht gespeichert werden: ${result.detail}`);

  return plainText([
    'Als Vorschlag hinterlegt (Status: offen) — der Datensatz ist unverändert:',
    ...result.suggestions.map(s => `- ${s.id} · ${fieldLabel(s.propertyId)}`),
    'Zum Übernehmen wlo_decide_suggestion mit der jeweiligen ID aufrufen.',
  ].join('\n'));
}
