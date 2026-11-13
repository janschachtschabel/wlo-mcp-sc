/**
 * tools/curation-report.ts – saying what actually landed.
 *
 * Split out of `curation-shared.ts` (audit 2026-11-12, A-5). The rule this
 * module exists for: nothing is called done that was not read back as stored —
 * three separate edu-sharing mechanisms discard a write while answering 200.
 */

import type { ChangeSet } from '../services/write/change-set.js';
import type { FieldWriteStatus } from '../services/write/nodes.js';
import type { VerifyResult, MutationOutcome } from '../services/write/verify.js';
import type { WloToolResult } from '../apps/register.js';
import { codedError, plainText, textResult } from './curation-reply.js';

const OUTCOME_NOTE: Record<string, string> = {
  dropped: 'vom Repository verworfen (die Anfrage wurde mit 200 beantwortet, der Wert steht aber nicht im Datensatz)',
  changed: 'abweichend gespeichert — das Repository hat einen eigenen Wert eingetragen',
};

/**
 * Report what actually landed, field by field.
 *
 * Deliberately never says "erfolgreich" over a result that was not read back as
 * stored: three separate edu-sharing mechanisms discard a write while answering
 * 200, and a confident success message is how they stay invisible.
 */
export function reportOutcome(
  cs: ChangeSet,
  statuses: FieldWriteStatus[],
  verified: VerifyResult,
): WloToolResult {
  const failedWrite = new Map(statuses.filter(s => !s.ok).map(s => [s.property, s.detail ?? '']));
  const stored: string[] = [];
  const failed: string[] = [];
  // A value stored DIFFERENTLY is still a write — only refused and dropped fields left the record as it was.
  let changedSomething = false;
  // A field rejected with a 5xx whose value is not (yet) visible: not proof that nothing landed.
  let rejectedOpen = false;

  for (const change of cs.changes) {
    const label = change.label;
    // `verifyWrite` classifies every field of the change set, so an absent
    // outcome would mean the read-back and the plan disagreed — treat it like a
    // drop rather than quietly counting it as saved.
    const outcome = verified.outcomes[change.property] ?? 'dropped';
    if (outcome === 'changed') changedSomething = true;
    const rejected = failedWrite.get(change.property);
    if (rejected !== undefined) {
      // The write call was answered with an error — and the READ-BACK decides
      // what that meant, as in the batch tools (audit 2026-11-12, K-5). A 5xx is
      // no proof that nothing landed: the value may stand in the record, and
      // "nicht gespeichert" over it sends the caller to write it again.
      if (outcome === 'stored') stored.push(`- ${label} (das Repository meldete einen Fehler — ${rejected} —, der Wert steht aber im Datensatz)`);
      else if (outcome === 'changed') failed.push(`- ${label}: vom Repository abgelehnt (${rejected}) — im Datensatz steht dennoch ein anderer Wert als vorher`);
      else failed.push(`- ${label}: vom Repository abgelehnt (${rejected})`);
      // A read-back straight after a 5xx shows the OLD value also when the write
      // is still on its way behind a proxy (502/503/504) — the rule the full-text
      // write applies. "Dropped" is proof only after a refusal the repository
      // itself made.
      if (outcome !== 'stored' && /\b5\d\d\b/.test(rejected)) rejectedOpen = true;
      continue;
    }
    if (outcome === 'stored') stored.push(`- ${label}`);
    else failed.push(`- ${label}: ${OUTCOME_NOTE[outcome]}`);
  }

  const lines: string[] = [];
  if (stored.length > 0) lines.push('Gespeichert:', ...stored);
  if (failed.length > 0) {
    if (lines.length > 0) lines.push('');
    lines.push('NICHT gespeichert:', ...failed);
  }
  if (lines.length === 0) lines.push('Es gab nichts zu ändern.');

  // Coded (chatbot feedback 2026-11-07, finding 4): a program must be able to
  // tell "some fields did not land" from every other error without reading
  // German — and what DID land is in the text beside it. `outcomeOpen` is
  // false only when THIS report wrote nothing at all, which the read-back
  // knows field by field; a caller that wrote something else first (a new
  // record) says so with `markWritten`.
  if (failed.length === 0) return textResult(lines.join('\n'));
  return codedError('not_stored', lines.join('\n'), { outcomeOpen: stored.length > 0 || changedSomething || rejectedOpen });
}

/**
 * The call wrote something before this answer — a created record — so its
 * error, whatever the field report says, is not "nothing written". Without it a
 * create whose fields were all dropped read `outcomeOpen: false`, and a client
 * starting over would create a second record (finding 4). The id travels IN the
 * error: wherever `recordExists` is true a program finds the record there, not
 * only in the sentence (chatbot feedback 2026-11-13, D3).
 */
export function markWritten(result: WloToolResult, nodeId: string): WloToolResult {
  const sc = result.structuredContent as { error?: Record<string, unknown> } | undefined;
  if (!sc?.error) return result;
  return { ...result, structuredContent: { ...sc, error: { ...sc.error, outcomeOpen: true, recordExists: true, nodeId } } };
}

/**
 * Report a mutation that changes no property — create, rename, file a
 * reference, delete — after its read-back.
 *
 * `done` is said only over an `ok`. The counterpart of `reportOutcome` for the
 * mutations a field comparison cannot see, and for the same reason: a `200` from
 * edu-sharing is not evidence that anything changed.
 */
export function reportMutation(
  outcome: MutationOutcome,
  done: string,
  context: string,
): WloToolResult {
  switch (outcome.status) {
    case 'ok':
      return plainText(done);
    case 'failed':
      return codedError('upstream_error', `${context}: ${outcome.detail}`);
    case 'not_visible':
      return codedError('not_visible',
        `Die Anfrage wurde angenommen, im Datensatz ist die Änderung aber nicht zu sehen. ${outcome.detail} ` +
          'Bitte im Repository nachsehen, bevor der Vorgang wiederholt wird.',
      );
    default:
      return codedError('unverified',
        'Die Anfrage wurde angenommen, ließ sich danach aber nicht überprüfen — ob sie gewirkt hat, ist damit ' +
          `offen. ${outcome.detail} Bitte den Datensatz direkt ansehen.`,
      );
  }
}

/**
 * Reply for a write whose result could not be read back. Neither success nor
 * failure may be claimed — the only honest answer is that it is open.
 */
export function unverifiedReply(err: unknown): WloToolResult {
  const detail = err instanceof Error ? err.message : String(err);
  return codedError('unverified',
    `Die Änderung wurde abgeschickt, konnte danach aber nicht überprüft werden. Ob sie gespeichert ` +
      `wurde, ist damit offen — bitte den Datensatz direkt ansehen. (${detail})`,
    { outcomeOpen: true },
  );
}

/**
 * The values to send upstream — taken from the change set, NOT from the raw
 * parameters. The difference matters for merged fields: the user asked to add
 * one keyword, the change set holds the union, and sending the raw parameter
 * would silently drop the existing ones.
 */
export function desiredFromChangeSet(cs: ChangeSet): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const change of cs.changes) out[change.property] = change.after ?? [];
  return out;
}
