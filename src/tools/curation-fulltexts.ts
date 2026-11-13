/**
 * tools/curation-fulltexts.ts – wlo_attach_fulltexts (plan 2026-11-08, W2).
 *
 * Up to 200 full texts under ONE approval, on the plan runner (same answer shape
 * and continuation as `wlo_update_contents`), with W1's rules per record
 * (`services/write/fulltext.ts`) and the bounds of `fulltext-plan.ts`. No
 * generic replay (`replay: false`): the confirmation key and `continuationToken`
 * both continue the STORED plan (`plan-runner.ts`), which never writes a record
 * twice.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { buildChangeSet } from '../services/write/change-set.js';
import { requireWrite } from '../services/write/credential-gate.js';
import { FULLTEXT_MAX_BYTES, fulltextLine, type FulltextInput } from '../services/write/fulltext.js';
import {
  FULLTEXTS_KIND, FULLTEXTS_MAX_BYTES, FULLTEXTS_MAX_ITEMS, FULLTEXT_BUSY_RETRY_S, fulltextStep, hasFulltextRoom, prepareFulltexts, totalBytes, type FulltextItem,
} from '../services/write/fulltext-plan.js';
import { runPlan, type ItemState, type StoredPlan } from '../services/write/plan-runner.js';
import { sanitizeText } from '../text-sanitize.js';
import type { WloToolResult } from '../apps/register.js';
import { codedError, previewReply, registerCurationTool, type WriteAuthChallenge } from './curation-shared.js';
import { SOURCE_SCHEMA, parseFulltextInput } from './curation-fulltext-input.js';
import { planReply } from './curation-plan-reply.js';
import { canonicalArgs, runPlannedCall } from './curation-plan.js';

const STATUS_LABEL: Record<string, string> = {
  stored: 'abgelegt', not_stored: 'nicht angekommen', unverified: 'offen — nicht bestätigt', failed: 'gescheitert', pending: 'offen',
};
const label = (s: ItemState) => `${STATUS_LABEL[s.status] ?? s.status}${s.code ? ` (${s.code})` : ''}`;

function answer(plan: StoredPlan<FulltextItem>, report: Awaited<ReturnType<typeof runPlan>>): WloToolResult {
  return planReply('Volltexte:', report, plan.expiresAt, plan.items.map(i => ({
    id: { nodeId: i.plan.requestedId, ...(i.plan.requestedId !== i.plan.targetId ? { targetId: i.plan.targetId } : {}) },
    text: `„${i.plan.title}“`,
    state: plan.state.get(i.key)!,
  })), label, 'items');
}

function memoryFull(): WloToolResult {
  return codedError('upstream_busy', 'Der Server hält gerade zu viele Volltexte anderer Vorgänge. Es wurde nichts '
    + 'geschrieben, und der Bestätigungsschlüssel gilt weiter — bitte nach retryAfter Sekunden erneut senden.',
  { retryAfter: FULLTEXT_BUSY_RETRY_S, outcomeOpen: false });
}

const itemSchema = z.object({
  nodeId: z.string().min(1).max(200),
  markdown: z.string().min(1),
  source: SOURCE_SCHEMA,
  sourceUrl: z.string().max(2000).optional(),
  language: z.string().max(10).optional(),
});

export function registerCurationFulltextsTool(server: McpServer, challenge: WriteAuthChallenge): void {
  registerCurationTool(server, challenge, {
    replay: false, // the key continues a stored plan (plan-runner.ts)
    name: 'wlo_attach_fulltexts',
    title: 'WLO Volltexte für viele Datensätze',
    description: `Lege Volltexte (Markdown) für viele Datensätze mit EINER Bestätigung im textContent ab — bis zu ${FULLTEXTS_MAX_ITEMS} Einträge, zusammen höchstens ${FULLTEXTS_MAX_BYTES} Bytes (je Text ${FULLTEXT_MAX_BYTES}); mehr = mehrere Aufrufe. Je Datensatz dieselben Regeln wie wlo_attach_fulltext (Datensatz mit Datei abgelehnt,verlinkter Datensatz abgelehnt, zurückgelesen).
Ohne Schlüssel: Vorschau mit counts {new, replaced, unchanged, refused}, refused [{nodeId, code}], unchangedItems. Mit confirmToken: liest jeden Datensatz erneut (kostet bei vielen Einträgen Zeit), schreibt dann ~40 s je Aufruf; complete: false → continuationToken (oder derselbe Aufruf) setzt ohne neue Bestätigung fort. Antwort: items [{nodeId, targetId?, status, code?, outcomeOpen?}].`,
    inputSchema: {
      items: z.array(itemSchema).min(1).max(FULLTEXTS_MAX_ITEMS),
      replace: z.boolean().optional().default(false).describe('Vorhandene Volltexte ersetzen.'),
      confirmToken: z.string().max(200).optional(),
      continuationToken: z.string().max(200).optional(),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    handler: async (params) => {
      requireWrite();
      const raw = params['items'] as Array<Record<string, unknown>>;
      const replace = params['replace'] === true;
      return runPlannedCall<FulltextItem>({
        kind: FULLTEXTS_KIND, params,
        args: canonicalArgs({ items: raw, replace }),
        step: () => fulltextStep,
        answer,
        prepare: async (token) => {
          const inputs: FulltextInput[] = [];
          const reasons: string[] = [];
          raw.forEach((item, index) => {
            const parsed = parseFulltextInput(item, replace);
            if (parsed.ok) inputs.push(parsed.input);
            else reasons.push(`Eintrag ${index + 1} (${sanitizeText(String(item['nodeId']))}): ${parsed.reason}`);
          });
          if (reasons.length) return { reply: codedError('invalid_input', reasons.join('\n'), { reasons, outcomeOpen: false }) };
          // Before anything is read: the bound of one call.
          const bytes = totalBytes(inputs);
          if (bytes > FULLTEXTS_MAX_BYTES) {
            return { reply: codedError('invalid_input', `Zusammen ${bytes} Bytes — erlaubt sind ${FULLTEXTS_MAX_BYTES} je Aufruf. `
              + 'Bitte auf mehrere Aufrufe verteilen.', { outcomeOpen: false }) };
          }
          // A full memory is known before the records are read: refusing it after
          // 200 reads would spend the call's budget on an answer that was ready.
          // The sum of all texts is an upper bound of what the plan will hold.
          if (token && !hasFulltextRoom(bytes)) return { reply: memoryFull() };

          const prepared = await prepareFulltexts(inputs);
          const { counts } = prepared;
          const extra = { counts, unchangedItems: prepared.unchangedItems, refused: prepared.refused };
          const notes = prepared.refused.map(r => `Nicht im Plan — ${sanitizeText(r.nodeId)}: ${sanitizeText(r.reason)} (${r.code}).`);
          if (!prepared.items.length) {
            return { reply: {
              content: [{ type: 'text' as const, text: ['Kein Volltext bleibt im Plan — es gibt nichts zu bestätigen.', ...notes].join('\n') }],
              structuredContent: { confirm: null, unchanged: true, ...extra },
            } };
          }
          const cs = buildChangeSet(FULLTEXTS_KIND, 'content', {}, {}, {
            action: `Legt ${counts.new + counts.replaced} Volltexte ab (${counts.new} neu, ${counts.replaced} ersetzt; `
              + `${counts.unchanged} unverändert, ${counts.refused} abgelehnt). Jeder wird zurückgelesen:`,
            items: prepared.items.map(i => fulltextLine(i.plan)),
          });
          return { draft: { cs, items: prepared.items, preview: () => {
            const preview = previewReply(cs, 'Zum Ablegen bitte bestätigen.', notes);
            return { ...preview, structuredContent: { ...(preview.structuredContent ?? {}), ...extra } };
          } } };
        },
        // Again with what the plan really holds: other plans ran while this one was read.
        beforeRedeem: (draft) => (hasFulltextRoom(draft.items.reduce((n, i) => n + i.plan.bytes, 0)) ? null : memoryFull()),
        context: 'Fehler beim Ablegen der Volltexte',
        whatIsOpen: 'Ob schon Volltexte abgelegt wurden',
      });
    },
  });
}
