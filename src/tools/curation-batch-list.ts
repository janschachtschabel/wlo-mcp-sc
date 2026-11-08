/**
 * tools/curation-batch-list.ts – wlo_list_my_batches (BOERDi wishlist item 9,
 * decision A, 2026-11-06): the person's own batch filings, found again, so the
 * chatbot can show "deine letzten Ablagen" after the login and continue one.
 *
 * Read-only, but only for the person themselves: it goes through
 * `registerCurationTool` (oauth2 + the login gate, so a client that is not
 * signed in is asked to sign in) and the same personal-login check the batch
 * tools use — the service account is refused, never used. The finding and
 * reading rules live in `services/my-batches.ts`.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { BATCH_ROLES, type BatchRole } from '../services/write/batch-manifest.js';
import { getMyBatch, listMyBatches, type BatchSummary } from '../services/my-batches.js';
import { failureFields } from '../services/failure-code.js';
import { oneLine } from '../formatter.js';
import type { WloToolResult } from '../apps/register.js';
import { registerCurationTool, type WriteAuthChallenge } from './curation-shared.js';

const LIMIT_MAX = 20;

const countsSchema = z.object({
  stored: z.number(), dropped: z.number(), unverified: z.number(), failed: z.number(), open: z.number(),
});
const batchSchema = z.object({
  manifestNodeId: z.string(),
  folderNodeId: z.string().nullable(),
  title: z.string(),
  createdAt: z.string(),
  status: z.enum(['ok', 'unreadable']),
  counts: countsSchema.optional(),
  entries: z.array(z.object({
    index: z.number(), title: z.string(), nodeId: z.string().optional(),
    status: z.enum(['stored', 'dropped', 'unverified', 'failed', 'open']),
    /** Structure document or content (W4); an @1 manifest reads `content`. */
    role: z.enum(BATCH_ROLES as [BatchRole, ...BatchRole[]]),
  })).optional(),
});
export const myBatchesSchema = z.object({
  batches: z.array(batchSchema).optional(),
  batch: batchSchema.optional(),
  /** Set when a listing of the own area was cut short: older batches may be missing. */
  scanTruncated: z.literal(true).optional(),
});

function line(b: BatchSummary): string {
  const c = b.counts;
  const stand = b.status === 'unreadable' ? 'Kennzahlen nicht lesbar'
    : `${c!.stored} abgelegt, ${c!.dropped} ohne Inhalt, ${c!.unverified} unklar, ${c!.failed} gescheitert, ${c!.open} offen`;
  return oneLine(`- ${b.title} (${b.createdAt.slice(0, 16).replace('T', ' ')}) — ${stand} — manifestNodeId: ${b.manifestNodeId}`);
}

function failure(code: string, message: string, extra: { retryAfter?: number } = {}): WloToolResult {
  return { content: [{ type: 'text' as const, text: message }], structuredContent: { error: { code, message, ...extra } }, isError: true };
}

export function registerMyBatchesTool(
  server: McpServer, challenge: WriteAuthChallenge, personalRefusal: () => WloToolResult | null,
): void {
  registerCurationTool(server, challenge, {
    name: 'wlo_list_my_batches',
    title: 'WLO Meine Ablagen',
    description: `Finde die eigenen Stapel-Ablagen im persönlichen Bereich wieder (entstanden mit wlo_prepare_file_batch / wlo_store_batch_file / wlo_store_batch_manifest) — neueste zuerst, je Ablage Titel, Datum und Stand der Dateien. Mit nodeId (manifestNodeId) eine Ablage mit allen Einträgen. Nur mit eigener Anmeldung; nur lesend.
Grundlage ist der Vorgang (vorgang.json) bzw. seine Kennzahlen am Datensatz; eine Ablage, deren Kennzahlen nicht lesbar sind, steht mit status "unreadable" da. Bis zu ${LIMIT_MAX} Ablagen.`,
    inputSchema: {
      limit: z.number().int().min(1).max(LIMIT_MAX).optional().default(10).describe(`Wie viele Ablagen (1–${LIMIT_MAX}, Vorgabe 10).`),
      nodeId: z.string().max(200).optional().describe('manifestNodeId einer eigenen Ablage — dann mit allen Einträgen.'),
    },
    outputSchema: myBatchesSchema,
    annotations: { readOnlyHint: true, idempotentHint: true },
    handler: async (params) => {
      const refusal = personalRefusal();
      if (refusal) {
        const text = refusal.content.map(c => ('text' in c ? c.text : '')).join(' ');
        return failure('login_required', text);
      }
      try {
        const trunc = (cut: boolean) => (cut ? { scanTruncated: true as const } : {});
        const cutNote = 'Der eigene Bereich ist größer als gelesen — ältere Ablagen können fehlen.';
        if (params.nodeId) {
          const { batch, scanCut } = await getMyBatch(String(params.nodeId).trim());
          if (!batch) return failure('not_found', 'Keine eigene Ablage mit dieser manifestNodeId.');
          const text = [line(batch), ...(batch.entries ?? []).map(e =>
            oneLine(`  ${e.index}. ${e.title}${e.role === 'structure' ? ' (Strukturdokument)' : ''} — ${e.status}${e.nodeId ? ` — nodeId: ${e.nodeId}` : ''}`)),
          ...(scanCut ? [cutNote] : [])].join('\n');
          return { content: [{ type: 'text' as const, text }], structuredContent: { batch, ...trunc(scanCut) } };
        }
        const { batches, scanCut } = await listMyBatches(params.limit ?? 10);
        const text = [batches.length ? batches.map(line).join('\n') : 'Keine Ablagen im persönlichen Bereich.',
          ...(scanCut ? [cutNote] : [])].join('\n');
        return { content: [{ type: 'text' as const, text }], structuredContent: { batches, ...trunc(scanCut) } };
      } catch (err) {
        // Not answerable — "no batches" must not stand in for "could not look".
        const { code, ...extra } = failureFields(err);
        return failure(code, 'Der persönliche Bereich war nicht lesbar; ob es Ablagen gibt, ist offen.', extra);
      }
    },
  });
}
