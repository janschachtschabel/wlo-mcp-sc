/**
 * tools/curation-shared.ts – the two-step conversation every mutation has.
 *
 * The design chose one shared write pipeline over self-contained tools for a
 * specific reason: otherwise each tool re-implements confirmation, read-back
 * and reporting, and they drift apart. `services/write/` owns the mechanics;
 * this module owns the part the user actually reads — the preview, the refusal,
 * and the honest report of what landed.
 *
 * Kept out of `tools/shared.ts` deliberately: that module is about search
 * (filters, query metadata, result rendering) and would gain a second, unrelated
 * reason to change.
 */

import { validateField, applyLicenceDefaults, WRITABLE_FIELDS } from '../services/write/fields.js';
import { sanitizeText } from '../text-sanitize.js';
import { log } from '../logger.js';
import { toolError } from './shared.js';
import { renderChangeSet, hasSomethingToConfirm, type ChangeSet } from '../services/write/change-set.js';
import { mintToken, consumeToken } from '../services/write/confirm.js';
import type { FieldWriteStatus } from '../services/write/nodes.js';
import type { VerifyResult, MutationOutcome } from '../services/write/verify.js';
import type { WloToolResult } from '../apps/register.js';

/** Tool parameter name → the repository property it writes. */
export type ParamMap = Readonly<Record<string, string>>;

export type CollectResult =
  | {
      ok: true;
      desired: Record<string, string[]>;
      /** Accepted values worth a word of warning — shown with the preview. */
      notes: string[];
    }
  | { ok: false; reasons: string[] };

/**
 * Turn the tool's parameters into validated repository properties.
 *
 * Collects ALL rejections rather than stopping at the first: someone who
 * mistyped two fields should learn both in one reply, not discover the second
 * after fixing the first.
 */
export function collectDesired(params: Record<string, unknown>, map: ParamMap): CollectResult {
  const desired: Record<string, string[]> = {};
  const reasons: string[] = [];
  const notes: string[] = [];

  for (const [param, property] of Object.entries(map)) {
    const raw = params[param];
    if (raw === undefined || raw === null) continue;
    const input = Array.isArray(raw) ? raw.map(String) : [String(raw)];
    const result = validateField(property, input);
    if (!result.ok) {
      reasons.push(result.reason);
      continue;
    }
    desired[property] = result.values;
    if (result.note) notes.push(result.note);
  }

  if (reasons.length > 0) return { ok: false, reasons };
  return { ok: true, desired: applyLicenceDefaults(desired), notes };
}

function textResult(text: string, isError = false): WloToolResult {
  return { content: [{ type: 'text' as const, text }], ...(isError ? { isError: true } : {}) };
}

/** A plain German error reply — the shape every curation refusal uses. */
export function errorText(text: string): WloToolResult {
  return textResult(text, true);
}

/** A plain reply that reports something done. */
export function plainText(text: string): WloToolResult {
  return textResult(text);
}

/**
 * Did this call give up waiting rather than get an answer?
 *
 * The distinction decides what may be said afterwards. A refusal from the
 * repository means nothing happened; an abort means the request was in flight
 * when we stopped listening — measured 2026-08-02, a timed-out create had
 * already produced the record. Reporting the second as a failure states
 * something we do not know.
 */
export function isUpstreamTimeout(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false;
  const { name, message } = err as { name?: unknown; message?: unknown };
  if (name === 'TimeoutError' || name === 'AbortError') return true;
  return typeof message === 'string' && /abort|timeout|timed out/i.test(message);
}

/**
 * The reply for a mutation we stopped listening to.
 *
 * Every curation tool ends in a `catch`, and the obvious thing to write there is
 * "X konnte nicht … werden". For an ABORT that sentence is false: measured
 * 2026-08-02, a timed-out create had already produced the record. The abort hits
 * the response, not the work.
 *
 * So the catch has to ask which of the two happened. A refusal from the
 * repository really did nothing and may be reported plainly; an abort leaves the
 * outcome open, and the only honest reply says so and sends the reader to look.
 *
 * Used by every mutation rather than by one of them: the property is not
 * "creating is careful", it is "this server does not state outcomes it does not
 * know". A tool that skips it re-opens the hole for its own operation.
 *
 * @param context   what failed, as the plain-failure message's prefix.
 * @param whatIsOpen one German sentence naming the question the abort left open.
 */
export function timeoutOrError(context: string, err: unknown, whatIsOpen: string): WloToolResult {
  if (!isUpstreamTimeout(err)) return toolError(context, err);
  log.warn('mutation aborted before an answer arrived', { context });
  return errorText(
    `Die Antwort des Repositories kam nicht rechtzeitig. ${whatIsOpen} — der Abbruch trifft die Antwort, ` +
      'nicht die Arbeit. Der Vorgang kann also gewirkt haben. Bitte im Repository nachsehen, bevor er ' +
      'wiederholt wird.',
  );
}

/**
 * A record's title for a preview or report, sanitized: it comes out of the
 * repository, written by someone else, and this text goes to the model.
 */
export function recordTitle(properties: Record<string, string[]> | undefined): string {
  const raw = properties?.['cclom:title']?.[0] ?? properties?.['cm:title']?.[0]
    ?? properties?.['cm:name']?.[0] ?? '';
  return raw ? sanitizeText(raw) : '(ohne Titel)';
}

/**
 * German label for a property. Falls back to the raw name for properties
 * outside our write surface — a suggestion may name one, and hiding which
 * property it was would make the refusal unactionable.
 *
 * That fallback is the reason for the sanitizing: a property name off our own
 * list is a fixed string, but one that came with a stored proposal is foreign
 * text, and the labels are rendered into line-oriented lists.
 */
export function fieldLabel(property: string): string {
  return WRITABLE_FIELDS[property]?.label ?? sanitizeText(property);
}

/**
 * Put a line in front of an existing reply without losing its error flag.
 * Used to report the new record's id above the per-field outcome.
 */
export function prependText(result: WloToolResult, line: string): WloToolResult {
  return { ...result, content: [{ type: 'text' as const, text: line }, ...result.content] };
}

export function rejectionReply(reasons: string[]): WloToolResult {
  return textResult(
    ['Die Angaben wurden nicht übernommen:', ...reasons.map(r => `- ${r}`)].join('\n'),
    true,
  );
}

/**
 * The reply for a call that carried no token: show exactly what would change
 * and hand back the key that authorises it. Nothing has been written.
 */
export function previewReply(cs: ChangeSet, whatHappensNext: string, notes: string[] = []): WloToolResult {
  if (!hasSomethingToConfirm(cs)) {
    return textResult(renderChangeSet(cs));
  }
  const token = mintToken(cs);
  return textResult(
    [
      'Bitte prüfen — bisher wurde nichts geändert:',
      '',
      renderChangeSet(cs),
      // Notes belong BEFORE the confirmation line: they are part of what the
      // person is agreeing to, not a footnote after the decision.
      ...(notes.length > 0 ? ['', ...notes.map(n => `⚠ ${n}`)] : []),
      '',
      `${whatHappensNext} Dazu denselben Aufruf mit confirmToken: ${token} wiederholen.`,
      'Der Schlüssel gilt einmalig und zehn Minuten lang.',
    ].join('\n'),
  );
}

/**
 * Redeem a token. Returns null when the write may proceed, or the reply that
 * explains why it may not.
 */
export function confirmOrExplain(token: string, cs: ChangeSet): WloToolResult | null {
  switch (consumeToken(token, cs)) {
    case 'ok':
      return null;
    case 'expired':
      return textResult(
        'Der Bestätigungsschlüssel ist abgelaufen (zehn Minuten). Bitte den Aufruf ohne confirmToken ' +
          'wiederholen, die Vorschau erneut prüfen und mit dem neuen Schlüssel bestätigen.',
        true,
      );
    case 'mismatch':
      return textResult(
        'Der Bestätigungsschlüssel gehört zu einer anderen Änderung als der jetzt angeforderten — ' +
          'entweder wurden die Werte dazwischen verändert oder der Datensatz hat sich geändert. ' +
          'Es wurde nichts geschrieben. Bitte den Aufruf ohne confirmToken wiederholen und die neue Vorschau prüfen.',
        true,
      );
    default:
      return textResult(
        'Der Bestätigungsschlüssel ist unbekannt oder wurde bereits benutzt — jeder Schlüssel gilt genau einmal. ' +
          'Es wurde nichts geschrieben. Bitte den Aufruf ohne confirmToken wiederholen.',
        true,
      );
  }
}

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

  for (const change of cs.changes) {
    const label = change.label;
    const rejected = failedWrite.get(change.property);
    if (rejected !== undefined) {
      failed.push(`- ${label}: vom Repository abgelehnt (${rejected})`);
      continue;
    }
    // `verifyWrite` classifies every field of the change set, so an absent
    // outcome would mean the read-back and the plan disagreed — treat it like a
    // drop rather than quietly counting it as saved.
    const outcome = verified.outcomes[change.property] ?? 'dropped';
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

  return textResult(lines.join('\n'), failed.length > 0);
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
      return errorText(`${context}: ${outcome.detail}`);
    case 'not_visible':
      return errorText(
        `Die Anfrage wurde angenommen, im Datensatz ist die Änderung aber nicht zu sehen. ${outcome.detail} ` +
          'Bitte im Repository nachsehen, bevor der Vorgang wiederholt wird.',
      );
    default:
      return errorText(
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
  return textResult(
    `Die Änderung wurde abgeschickt, konnte danach aber nicht überprüft werden. Ob sie gespeichert ` +
      `wurde, ist damit offen — bitte den Datensatz direkt ansehen. (${detail})`,
    true,
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
