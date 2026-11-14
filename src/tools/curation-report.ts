/**
 * tools/curation-report.ts – saying what actually landed.
 *
 * Split out of `curation-shared.ts` (audit 2026-11-12, A-5). The rule this
 * module exists for: nothing is called done that was not read back as stored —
 * three separate edu-sharing mechanisms discard a write while answering 200.
 */

import type { ChangeSet } from '../services/write/change-set.js';
import { rejectedWriteIsOpen, type FieldWriteStatus } from '../services/write/nodes.js';
import type { VerifyResult, MutationOutcome } from '../services/write/verify.js';
import type { WloToolResult } from '../apps/register.js';
import type { UploadOutcome } from '../services/write/content-upload.js';
import { codedError, plainText, prependText, textResult } from './curation-reply.js';
import { wroteNothing } from '../upstream-error.js';
import { failureFields } from '../services/failure-code.js';

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
  const failedWrite = new Map(statuses.filter(s => !s.ok).map(s => [s.property, s]));
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
    const refusal = failedWrite.get(change.property);
    if (refusal !== undefined) {
      const rejected = refusal.detail ?? '';
      // The write call was answered with an error — and the READ-BACK decides
      // what that meant, as in the batch tools (audit 2026-11-12, K-5). A 5xx is
      // no proof that nothing landed: the value may stand in the record, and
      // "nicht gespeichert" over it sends the caller to write it again.
      if (outcome === 'stored') stored.push(`- ${label} (das Repository meldete einen Fehler — ${rejected} —, der Wert steht aber im Datensatz)`);
      else if (outcome === 'changed') failed.push(`- ${label}: vom Repository abgelehnt (${rejected}) — im Datensatz steht dennoch ein anderer Wert als vorher`);
      else failed.push(`- ${label}: vom Repository abgelehnt (${rejected})`);
      // "Dropped" is proof only after a refusal the repository itself made —
      // the reading the batch tool shares (`rejectedWriteIsOpen`).
      if (outcome !== 'stored' && rejectedWriteIsOpen(refusal)) rejectedOpen = true;
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
 * What became of the file, as one sentence for both tools.
 *
 * Worded about the FILE, not about the surrounding act, because the same
 * sentence has to be true beside "Angelegt: <id>" and after a metadata change —
 * "Der Datensatz wurde angelegt" would be a lie on the update path.
 *
 * Every outcome except `stored` is stated plainly, including the one edu-sharing
 * makes easy to miss: a `200` for an upload the record does not show. Someone
 * told "created" who finds an empty record learns the hard way; someone told the
 * record has no content yet can fix it.
 */
export function uploadNote(upload: UploadOutcome): string {
  switch (upload.status) {
    case 'stored':
      return `Datei hochgeladen (${upload.size} Bytes).`;
    case 'dropped':
      return upload.holds !== undefined
        // A replacement: the record is not empty — it still carries the OLD file.
        ? `ACHTUNG: Der Inhalt wurde NICHT ersetzt. Das Hochladen wurde mit Erfolg beantwortet, der Datensatz zeigt `
          + `aber weiterhin die bisherige Datei (${upload.holds} Bytes). Bitte die Rechte prüfen und den Inhalt erneut hochladen.`
        : 'ACHTUNG: Der Datensatz trägt danach KEINEN Inhalt. Das Hochladen wurde mit Erfolg '
          + 'beantwortet, der Datensatz zeigt aber keine Datei. Bitte die Rechte prüfen und den Inhalt '
          + 'erneut hochladen.';
    case 'unverified':
      return `Das Hochladen wurde abgeschickt, ließ sich danach aber nicht überprüfen. Ob der Datensatz `
        + `den Inhalt trägt, ist offen. (${upload.detail})`;
    default:
      return `ACHTUNG: Das Hochladen der Datei ist fehlgeschlagen: ${upload.detail}`;
  }
}

/**
 * One answer for a call that uploads a file AND may write fields — the upload's
 * outcome is part of the coded result, not a line of text in front of it
 * (audit 2026-11-14, W1). Three things were wrong while it was only text: a
 * lost replacement beside stored fields was a success (and replayed as one); a
 * file-only call closed with the field report's "Es gab nichts zu ändern"; and
 * an upload that LANDED beside refused fields answered `outcomeOpen: false`,
 * which a spent key turns into "nothing was written".
 *
 * `fields` is the field report, or null when the call changes no field.
 * `error.upload` carries the upload's status wherever the answer is an error.
 */
export function reportWithUpload(fields: WloToolResult | null, upload: UploadOutcome, lead = ''): WloToolResult {
  const note = `${lead}${uploadNote(upload)}`;
  const fieldError = (fields?.structuredContent as { error?: Record<string, unknown> } | undefined)?.error;
  const rest = fields?.content ?? [];
  if (upload.status === 'stored') {
    if (!fields) return textResult(note);
    if (!fieldError) return prependText(fields, note);
    // The file IS written: whatever the fields came to, this is not "nothing".
    return { ...fields, content: [{ type: 'text' as const, text: note }, ...rest],
      structuredContent: { ...(fields.structuredContent as Record<string, unknown>), error: { ...fieldError, outcomeOpen: true, upload: upload.status } } };
  }
  const refused = upload.status === 'failed' && wroteNothing(upload.httpStatus);
  // Proven not to have landed: read back as absent, or refused by the repository itself.
  const uploadOpen = !(upload.status === 'dropped' || refused);
  // Did the FIELDS write something? All stored (no error), or an error that does not rule it out.
  const fieldsWrote = Boolean(fields) && (!fieldError || fieldError['outcomeOpen'] !== false);
  const busy = upload.status === 'failed' && !refused ? unansweredWrite(upload.httpStatus) : null;
  const code = upload.status === 'dropped' ? 'not_stored'
    : upload.status === 'unverified' ? 'unverified'
      : refused ? refusalCode(upload.httpStatus) : busy?.code ?? 'upstream_error';
  const text = [note, ...rest.map(c => ('text' in c ? String(c.text) : ''))].filter(Boolean).join('\n');
  const error = codedError(String(fieldError?.['code'] ?? code), text, {
    // The wait belongs to the upload's own code: beside a field report's code it would name a wait for something else.
    ...(fieldError ?? (busy?.retryAfter !== undefined ? { retryAfter: busy.retryAfter } : {})), message: text, outcomeOpen: uploadOpen || fieldsWrote, upload: upload.status,
  });
  return { ...error, content: [{ type: 'text' as const, text: note }, ...rest] };
}

/** The code of a write the repository REFUSED (`wroteNothing`): which "no" it was — one mapping for every single tool. */
export function refusalCode(status: number): 'forbidden' | 'not_found' | 'refused' {
  return status === 401 || status === 403 ? 'forbidden' : status === 404 ? 'not_found' : 'refused';
}

/**
 * The code of a write that was answered and is NO verdict (5xx, 429, no status):
 * `upstream_busy` with its wait for 429/503 — what the plan steps answer —,
 * else `upstream_error`. Read from the STATUS in hand, through the one place
 * that pairs code and wait (`failureFields`); the single tools called a busy
 * repository an error (review 2026-11-14).
 */
function unansweredWrite(status: number): ReturnType<typeof failureFields> {
  return failureFields(`HTTP ${status}`);
}

/**
 * A single write the repository answered with an error, as ONE reply: its own
 * "no" (`wroteNothing`) is an answer — nothing was written, and the code says
 * which no; anything else is no verdict and stays open. Three tools each read
 * the status their own way (`403 ? forbidden : upstream_error`, no word on
 * whether anything was written).
 */
export function failedWriteReply(status: number, text: string, extra: Record<string, unknown> = {}): WloToolResult {
  return wroteNothing(status)
    ? codedError(refusalCode(status), text, { ...extra, outcomeOpen: false })
    : codedError(unansweredWrite(status).code, text, { ...extra, ...unansweredWrite(status), outcomeOpen: true });
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
    case 'failed': {
      const text = `${context}: ${outcome.detail}`;
      // Our own refusal (nothing was sent) says so; everything else is the repository's.
      if (outcome.code) return codedError(outcome.code, text, { outcomeOpen: false });
      // The repository's own "no" is an ANSWER: nothing was written, and the
      // code says which no. As `upstream_error` a 403 read like an outage, and
      // after a spent key like an open outcome ("look first") over a write
      // that provably did not happen (audit 2026-11-14, W3).
      return failedWriteReply(outcome.httpStatus ?? 0, text);
    }
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
