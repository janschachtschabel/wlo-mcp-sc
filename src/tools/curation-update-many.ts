/**
 * tools/curation-update-many.ts – wlo_update_contents (plan 2026-11-08, W3).
 *
 * Metadata for up to 200 records under ONE approval, on the plan runner of
 * `wlo_add_to_collections` (same answer shape, same continuation). The rules —
 * which field is written and which proposed, the original as target, the
 * read-back — live in `services/write/update-many.ts`; this module validates the
 * fields (the same surface as `wlo_update_content`) and renders.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { buildChangeSet } from '../services/write/change-set.js';
import { requireWrite } from '../services/write/credential-gate.js';
import { DIRECT_PROPERTIES } from '../services/write/field-routing.js';
import { runPlan, type ItemState, type StoredPlan } from '../services/write/plan-runner.js';
import {
  UPDATE_MANY_MAX, planView, prepareUpdates, updateLine, updateStep, type UpdateInput, type UpdateItem,
} from '../services/write/update-many.js';
import { WRITABLE_FIELDS } from '../services/write/fields.js';
import { sanitizeText } from '../text-sanitize.js';
import type { WloToolResult } from '../apps/register.js';
import {
  collectDesired, previewReply, rejectionReply, registerCurationTool, type WriteAuthChallenge,
} from './curation-shared.js';
import { CONTENT_FIELDS, FIELD_SCHEMA } from './curation-fields.js';
import { planReply } from './curation-plan-reply.js';
import { canonicalArgs, runPlannedCall } from './curation-plan.js';

const KIND = 'update-contents';

const STATUS_LABEL: Record<string, string> = {
  stored: 'geschrieben', suggested: 'vorgeschlagen', partly: 'teilweise', not_stored: 'nicht gespeichert',
  unverified: 'offen — nicht bestätigt', failed: 'gescheitert', pending: 'offen',
};
const label = (s: ItemState) => `${STATUS_LABEL[s.status] ?? s.status}${s.code ? ` (${s.code})` : ''}`
  + `${s.written || s.suggested ? ` — ${s.written ?? 0} geschrieben, ${s.suggested ?? 0} vorgeschlagen` : ''}`;

const directLabels = [...DIRECT_PROPERTIES].map(p => WRITABLE_FIELDS[p]?.label ?? p).join(', ');

/** Nothing left to plan: say why, record by record — never "the values are already there" over refusals. */
function nothingToDo(notes: string[], extra: Record<string, unknown>): WloToolResult {
  return {
    content: [{ type: 'text' as const, text: ['Kein Datensatz bleibt im Plan — es gibt nichts zu bestätigen.', ...notes].join('\n') }],
    structuredContent: { confirm: null, unchanged: true, ...extra },
  };
}

function answer(plan: StoredPlan<UpdateItem>, report: Awaited<ReturnType<typeof runPlan>>): WloToolResult {
  return planReply('Metadaten:', report, plan.expiresAt, plan.items.map(i => ({
    id: { nodeId: i.requestedId, ...(i.requestedId !== i.targetId ? { targetId: i.targetId } : {}) },
    text: `„${i.title}“`,
    state: plan.state.get(i.key)!,
  })), label, 'items');
}

const itemSchema = z.object({
  nodeId: z.string().min(1).max(200),
  reason: z.string().max(500).optional()
    .describe('Begründung für die VORSCHLÄGE dieses Datensatzes (Pflicht im Repository; ohne Angabe ein Standardtext).'),
  ...FIELD_SCHEMA,
});

export function registerCurationUpdateManyTool(server: McpServer, challenge: WriteAuthChallenge): void {
  registerCurationTool(server, challenge, {
    replay: false, // the key continues a stored plan (plan-runner.ts)
    name: 'wlo_update_contents',
    title: 'WLO Metadaten für viele Datensätze',
    description: `Ändere die Metadaten vieler vorhandener Datensätze — bis zu ${UPDATE_MANY_MAX} — mit EINER Bestätigung. Je Eintrag nodeId und Felder wie bei wlo_update_content.
Der Server entscheidet je Feld: ${directLabels} werden direkt GESCHRIEBEN und zurückgelesen; alles, was redaktionell bestätigt werden muss (Lizenz, Urheber, Herausgeber, Quell-URL, Sprache, Zielgruppe, Qualität), wird als VORSCHLAG hinterlegt (reason = Begründung). Verknüpfung → Original.
Ohne Schlüssel: Vorschau je Datensatz (was geschrieben, was vorgeschlagen wird), unchanged, refused. Mit confirmToken: liest jeden Datensatz erneut (kostet bei vielen Einträgen Zeit), schreibt dann ~40 s je Aufruf; complete: false → continuationToken (oder derselbe Aufruf) setzt ohne neue Bestätigung fort. Antwort: items [{nodeId, targetId?, status, code?, outcomeOpen?, written, suggested}], status stored|suggested|partly|not_stored|unverified|failed.
Für einen einzelnen Datensatz oder Dateiinhalt: wlo_update_content.`,
    inputSchema: {
      items: z.array(itemSchema).min(1).max(UPDATE_MANY_MAX),
      confirmToken: z.string().max(200).optional(),
      continuationToken: z.string().max(200).optional(),
    },
    // Not idempotent: a NEW preview and approval of the same items proposes the same values again.
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    handler: async (params) => {
      requireWrite();
      const raw = params['items'] as Array<Record<string, unknown>>;
      return runPlannedCall<UpdateItem>({
        kind: KIND, params,
        // The plan is bound to the items as NAMED — in one spelling, whatever
        // order the client wrote their keys in.
        args: canonicalArgs(raw),
        step: () => updateStep,
        answer,
        prepare: async () => {
          // Validated like wlo_update_content, every record, before anything is read.
          const inputs: UpdateInput[] = [];
          const reasons: string[] = [];
          const validationNotes: string[] = [];
          raw.forEach((item, index) => {
            const collected = collectDesired(item, CONTENT_FIELDS);
            const who = `Eintrag ${index + 1} (${sanitizeText(String(item['nodeId']))})`;
            if (!collected.ok) { reasons.push(...collected.reasons.map(r => `${who}: ${r}`)); return; }
            validationNotes.push(...collected.notes.map(n => `${who}: ${n}`));
            if (Object.keys(collected.desired).length === 0) { reasons.push(`${who}: kein zu änderndes Feld.`); return; }
            inputs.push({ nodeId: String(item['nodeId']).trim(), desired: collected.desired,
              ...(typeof item['reason'] === 'string' ? { reason: item['reason'] } : {}) });
          });
          if (reasons.length) return { reply: rejectionReply(reasons) };

          const prepared = await prepareUpdates(inputs);
          const writes = prepared.items.reduce((n, i) => n + i.write.changes.length, 0);
          const proposals = prepared.items.reduce((n, i) => n + i.suggest.length, 0);
          const cs = buildChangeSet('update-contents', 'content', {}, {}, prepared.items.length ? {
            action: `Ändert ${prepared.items.length} Datensätze: ${writes} Felder werden geschrieben und zurückgelesen, `
              + `${proposals} Werte als Vorschlag zur redaktionellen Entscheidung hinterlegt:`,
            items: prepared.items.map(updateLine),
          } : {});
          const notes = [
            ...validationNotes,
            ...(prepared.unchanged.length
              ? [`Unverändert, nicht im Plan (die Werte stehen schon so da): ${prepared.unchanged.map(u => `„${sanitizeText(u.title)}“`).join(', ')}.`]
              : []),
            ...prepared.refused.map(r => `Nicht im Plan — ${sanitizeText(r.nodeId)}: ${sanitizeText(r.reason)} (${r.code}).`),
          ];
          const extra = { unchangedItems: prepared.unchanged, refused: prepared.refused };
          if (!prepared.items.length) return { reply: nothingToDo(notes, extra) };
          return { draft: { cs, items: prepared.items, preview: () => {
            const preview = previewReply(cs, 'Zum Ausführen bitte bestätigen.', notes);
            // `plan`: per record what is written (with its old value) and what is proposed.
            return { ...preview, structuredContent: { ...(preview.structuredContent ?? {}), ...extra, plan: prepared.items.map(planView) } };
          } } };
        },
        context: 'Fehler beim Ändern der Metadaten',
        whatIsOpen: 'Ob schon Datensätze geändert wurden',
      });
    },
  });
}
