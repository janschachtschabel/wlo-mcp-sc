/**
 * tools/curation-create-filing.ts – the `addToCollectionId` half of
 * `wlo_create_content` (BOERDi wishlist item 4, 2026-11-06).
 *
 * Kept beside, not inside, `curation-content.ts` (450 lines): this is the
 * second reason to change that file would otherwise grow — what a combined
 * create-and-file says and does. The rule it holds is the two-step rule: the
 * filing is in the ChangeSet (`addTo` + the action sentence), so the token that
 * authorises the create authorises exactly this filing and nothing else.
 */

import { buildChangeSet } from '../services/write/change-set.js';
import { fileRecord, isAlreadyFiled, type FilingOutcome, type FilingTarget } from '../services/write/create-filing.js';
import type { ExistingRecord } from '../services/write/duplicates.js';
import { sanitizeText } from '../text-sanitize.js';
import type { WloToolResult } from '../apps/register.js';
import { confirmOrExplain, plainText, previewReply, prependText } from './curation-shared.js';

/** The sentence the create preview gains — part of what the token binds to. */
export function filingSentence(target: FilingTarget): string {
  return ` Danach wird er in die Sammlung „${sanitizeText(target.title)}“ (${target.nodeId}) aufgenommen.`;
}

/** What the person reads about the filing step once it ran. */
function filingLine(filing: FilingOutcome, target: FilingTarget): string {
  const name = `„${sanitizeText(target.title)}“`;
  switch (filing.status) {
    case 'added': return `In die Sammlung ${name} aufgenommen.`;
    case 'already': return `Liegt bereits in der Sammlung ${name}.`;
    case 'unverified': return `Ob der Datensatz in der Sammlung ${name} angekommen ist, ist offen (${filing.code}).`;
    case 'failed': return `Der Datensatz wurde aber nicht in die Sammlung ${name} aufgenommen (${filing.code}). `
      + 'Er bleibt bestehen; aufnehmen lässt er sich mit wlo_add_to_collection.';
  }
}

/**
 * Attach the record and the filing outcome as structured content, and the
 * filing line to the text. A failed filing is NOT an error result: the record
 * exists, and saying "failed" about the whole call would invite a second create.
 */
export function withFiling(
  result: WloToolResult,
  record: { nodeId: string; title: string },
  target?: FilingTarget,
  filing?: FilingOutcome,
): WloToolResult {
  const withLine = target && filing
    ? { ...result, content: [...result.content, { type: 'text' as const, text: filingLine(filing, target) }] }
    : result;
  return {
    ...withLine,
    structuredContent: {
      nodeId: record.nodeId,
      title: record.title,
      ...(filing ? { collection: { nodeId: filing.nodeId, status: filing.status, ...(filing.code ? { code: filing.code } : {}) } } : {}),
    },
  };
}

/**
 * The address already has a record and a collection was named: offer to file
 * THAT record instead of creating a second one. Its own preview and its own
 * ChangeSet — so a token for "create" cannot be spent on this, nor this on that.
 */
export async function fileExistingRecord(
  existing: ExistingRecord,
  target: FilingTarget,
  token: string,
): Promise<WloToolResult> {
  const record = { nodeId: existing.nodeId, title: existing.title };
  if (await isAlreadyFiled(existing.nodeId, target.nodeId) === true) {
    const done = withFiling(
      plainText(`Zu dieser URL gibt es bereits „${sanitizeText(existing.title)}“ (${existing.nodeId}). Angelegt wird nichts.`),
      record, target, { nodeId: target.nodeId, status: 'already' },
    );
    // Nothing to confirm — said in structured form too, as every preview does (12a).
    return { ...done, structuredContent: { ...(done.structuredContent as object), confirm: null, unchanged: true } };
  }
  const cs = buildChangeSet(`${target.nodeId}/${existing.nodeId}`, 'collection', {}, {}, {
    action: `Zu dieser URL gibt es bereits „${sanitizeText(existing.title)}“ (${existing.nodeId}). Angelegt wird nichts — `
      + `stattdessen wird dieser Datensatz in die Sammlung „${sanitizeText(target.title)}“ (${target.nodeId}) aufgenommen. `
      + 'Die im Aufruf angegebenen Metadaten werden dabei nicht übernommen — dafür gibt es wlo_update_content.',
    addTo: target,
  });
  if (!token) return previewReply(cs, 'Zum Aufnehmen bitte bestätigen.');
  const refusal = confirmOrExplain(token, cs);
  if (refusal) return refusal;
  const filing = await fileRecord(existing.nodeId, target);
  return withFiling(
    prependText(plainText('Kein neuer Datensatz angelegt.'), `Vorhanden: ${existing.nodeId}`),
    record, target, filing,
  );
}
