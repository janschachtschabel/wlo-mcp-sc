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

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { validateField, applyLicenceDefaults, WRITABLE_FIELDS } from '../services/write/fields.js';
import { flattenText, sanitizeText } from '../text-sanitize.js';
import { log } from '../logger.js';
import { codedErrorResult, toolError } from './shared.js';
import { renderChangeSet, hasSomethingToConfirm, displayValue, type ChangeSet } from '../services/write/change-set.js';
import { mintToken, consumeToken, TOKEN_TTL_MS } from '../services/write/confirm.js';
import { writeRefusal, mayPrepare } from '../services/write/credential-gate.js';
import type { PreparedRequest } from '../services/write/prepared-request.js';
import type { FieldWriteStatus } from '../services/write/nodes.js';
import type { VerifyResult, MutationOutcome } from '../services/write/verify.js';
import { registerWloTool, type WloToolDef, type WloToolResult } from '../apps/register.js';
import { OAUTH_SECURITY_SCHEMES } from '../apps/tool-defaults.js';

/**
 * The `WWW-Authenticate` value a curation tool answers with when the caller may
 * not write. Built once per server (it depends only on the public origin) and
 * handed to the registration functions — a module-level copy would be shared by
 * concurrent requests, and under `TRUST_PROXY` the origin is per-request.
 */
export type WriteAuthChallenge = string;

/**
 * Register a curation tool.
 *
 * Two things every one of them needs, in ONE place rather than once per tool:
 *
 *   1. the `oauth2` security declaration — a literal per tool is a chance per
 *      tool to write a scheme type the client does not know, and one such type
 *      refuses the WHOLE tool list (measured 2026-08-05);
 *   2. the call-time gate. The tools are listed even without an identity —
 *      that is what lets a client discover a login exists at all — so the
 *      refusal has to hold on its own, and it carries
 *      `_meta["mcp/www_authenticate"]` so the host knows to offer that login
 *      instead of just showing an error (OpenAI's own
 *      `authenticated_server_python`, read 2026-08-05).
 *
 * The gate runs BEFORE the handler, so no curation code path can be entered
 * without a write identity. Each handler additionally calls `requireWrite()`:
 * redundant here on purpose, because it is the guarantee that survives a tool
 * registered past this seam.
 */
export function registerCurationTool(
  server: McpServer,
  challenge: WriteAuthChallenge,
  def: Omit<WloToolDef, 'securitySchemes'> & {
    /**
     * May this tool answer with a prepared request when the caller cannot write
     * (E2)? Per tool rather than per server: `WLO_ALLOW_PREPARED_WRITES` says
     * the operator wants the embedded route at all, this says the tool has one.
     * Without it a curation tool keeps refusing exactly as before.
     */
    preparable?: boolean;
  },
): void {
  const { preparable, ...toolDef } = def;
  registerWloTool(server, {
    ...toolDef,
    securitySchemes: OAUTH_SECURITY_SCHEMES,
    handler: async (args, extra) => {
      const refusal = writeRefusal();
      if (refusal === null || (preparable && mayPrepare())) return namePreviewTool(await def.handler(args, extra), def.name);
      return {
        content: [{ type: 'text' as const, text: refusal }],
        // A code beside the text, for a program (BOERDi rule "errors as codes", E6).
        structuredContent: { error: { code: 'login_required', message: refusal } },
        _meta: { 'mcp/www_authenticate': [challenge] },
        isError: true,
      };
    },
  });
}

/**
 * Stamp the tool's name onto a structured preview. Here, at the one seam every
 * curation tool passes through, so "create" and "update" read differently to a
 * client without a second table of operation names that could drift from the
 * tools (BOERDi feedback 2026-11-06).
 */
function namePreviewTool(result: WloToolResult, tool: string): WloToolResult {
  const sc = result.structuredContent as { confirm?: { preview?: Record<string, unknown> } | null } | undefined;
  if (!sc?.confirm?.preview) return result;
  return {
    ...result,
    structuredContent: { ...sc, confirm: { ...sc.confirm, preview: { ...sc.confirm.preview, tool } } },
  };
}

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

/**
 * A plain German refusal. It carries the generic code `refused`, so EVERY
 * curation refusal has `structuredContent.error` — a chatbot that reads only
 * `structuredContent` otherwise sees nothing but `isError`. Where a program can
 * do something specific with the case, use `codedError` with its own code.
 */
export function errorText(text: string): WloToolResult {
  return codedError('refused', text);
}

/**
 * A refusal a PROGRAM can act on: the same text, plus `structuredContent.error`
 * with a code (BOERDi rule "errors as codes", English identifiers per E6). The
 * chatbot reads only `structuredContent`; a refusal without a code made it
 * match German sentences.
 */
export function codedError(code: string, text: string, extra: Record<string, unknown> = {}): WloToolResult {
  return codedErrorResult(code, text, extra);
}

/** A plain reply that reports something done. */
export function plainText(text: string): WloToolResult {
  return textResult(text);
}

// Lives in the write service so services can tell an abort from a refusal
// too; re-exported here, where every curation tool already imports it.
import { isUpstreamTimeout } from '../services/write/timeouts.js';
export { isUpstreamTimeout };

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
 * @param opts.preview the call carried no key at all (`isPreviewCall`) — nothing can have been written.
 */
export function timeoutOrError(
  context: string, err: unknown, whatIsOpen: string, opts: { preview?: boolean } = {},
): WloToolResult {
  if (!isUpstreamTimeout(err)) return toolError(context, err);
  if (opts.preview) {
    // A call without any key is a preview and never writes, so here — and only
    // here — the outcome is NOT open: a program may simply repeat the call
    // (chatbot feedback 2026-11-07). With a key the abort may have hit a write,
    // even one that had not started yet; saying "open" there is the safe side.
    log.warn('preview aborted before an answer arrived', { context });
    return codedError('timeout',
      'Die Antwort des Repositories kam nicht rechtzeitig — beim Vorbereiten der Vorschau, vor jeder Änderung. ' +
        'Es wurde nichts geändert. Bitte den Aufruf erneut ausführen.', { outcomeOpen: false });
  }
  log.warn('mutation aborted before an answer arrived', { context });
  // `timeout` = the OUTCOME IS OPEN, the same code the plan answers use: a
  // program must look before it repeats, never retry blindly.
  return codedError('timeout',
    `Die Antwort des Repositories kam nicht rechtzeitig. ${whatIsOpen} — der Abbruch trifft die Antwort, ` +
      'nicht die Arbeit. Der Vorgang kann also gewirkt haben. Bitte im Repository nachsehen, bevor er ' +
      'wiederholt wird.', { outcomeOpen: true });
}

/**
 * A call that carries no key of any kind: it can only preview. The one fact
 * `timeoutOrError` may rest "nothing was changed" on — a call WITH a key may
 * have reached a write, whichever line the abort hit.
 */
export function isPreviewCall(params: Record<string, unknown>): boolean {
  return !params['confirmToken'] && !params['continuationToken'] && !params['batchToken'];
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
  return codedError('invalid_input',
    ['Die Angaben wurden nicht übernommen:', ...reasons.map(r => `- ${r}`)].join('\n'), { reasons });
}

/**
 * The reply for a call that carried no token: show exactly what would change
 * and hand back the key that authorises it. Nothing has been written.
 */
export function previewReply(cs: ChangeSet, whatHappensNext: string, notes: string[] = []): WloToolResult {
  if (!hasSomethingToConfirm(cs)) {
    // Said in structured form too, so a client need not infer it from the text.
    return { ...textResult(renderChangeSet(cs)), structuredContent: { confirm: null, unchanged: true } };
  }
  const now = Date.now();
  const token = mintToken(cs, now);
  return withStructuredConfirm(textResult(
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
  ), structuredConfirm(cs, token, now));
}

/**
 * The same confirmation for a program (BOERDi wishlist 12a, 2026-11-06): the
 * chatbot used to pull the key out of the text with a regular expression, one
 * wording change away from breaking every write it offers.
 *
 * Built FROM the change set the token is bound to, never beside it, so the
 * structured preview cannot show a change the key does not authorise. Values are
 * the stored ones (URIs, not labels) — the text is where they are made legible.
 * No `outputSchema` on these tools (see `preparedReply`), so nothing validates
 * it away.
 */
function structuredConfirm(cs: ChangeSet, token: string, mintedAt: number) {
  const values = (v: string[] | null) => v?.map(flattenText) ?? null;
  // Labels from the SAME lookup the text preview uses, and only where one names
  // something the value does not already say (a URI, a rating) — so a client
  // can show the preview without asking the vocabulary.
  const labels = (property: string, v: string[] | null) => {
    if (!v) return undefined;
    const shown = v.map(x => flattenText(displayValue(property, x)));
    return shown.some((label, i) => label !== v[i]) ? shown : undefined;
  };
  return {
    token,
    expiresAt: new Date(mintedAt + TOKEN_TTL_MS).toISOString(),
    preview: {
      action: cs.destructive ? 'delete' : 'change',
      target: {
        nodeId: cs.nodeId,
        kind: cs.kind,
        title: flattenText(cs.title),
        ...(cs.redirectedFrom ? { redirectedFrom: cs.redirectedFrom } : {}),
      },
      ...(cs.action ? { statement: flattenText(cs.action) } : {}),
      ...(cs.addTo ? { collection: { nodeId: cs.addTo.nodeId, title: flattenText(cs.addTo.title) } } : {}),
      ...(cs.items?.length ? { items: cs.items.map(flattenText) } : {}),
      fields: cs.changes.map(c => {
        const oldLabels = labels(c.property, c.before);
        const newLabels = labels(c.property, c.after);
        return {
          name: c.property, label: c.label, old: values(c.before), new: values(c.after),
          ...(oldLabels ? { oldLabels } : {}),
          ...(newLabels ? { newLabels } : {}),
        };
      }),
    },
  };
}

function withStructuredConfirm(result: WloToolResult, confirm: ReturnType<typeof structuredConfirm>): WloToolResult {
  return { ...result, structuredContent: { confirm } };
}

/**
 * The reply for a confirmed change this server will NOT perform: the request,
 * for the page to send with the visitor's own session (E2).
 *
 * Only ever produced after the token was redeemed. Handing the request out with
 * the preview would let a browser execute without ever confirming, and the
 * two-step approval — whose whole purpose is that an injected instruction
 * cannot ride an approval given for something else — would be decoration.
 *
 * The descriptor travels in `structuredContent` and deliberately NOT in the
 * text: the model has no use for a method and a path, and text is what ends up
 * quoted into a conversation. No `outputSchema` is declared for these tools —
 * the SDK validates structured content only when one exists
 * (`server/mcp.js: if (!tool.outputSchema) return`), and declaring one would
 * make every preview reply, which carries no structured content, invalid.
 */
export function preparedReply(request: PreparedRequest, doneMessage: string): WloToolResult {
  return {
    content: [{
      type: 'text' as const,
      text: 'Die Änderung wurde hier nicht ausgeführt. Die fertige Anfrage steht im strukturierten Teil '
        + 'dieser Antwort; ausgeführt wird sie in der Seite, mit der dort bestehenden Anmeldung.',
    }],
    structuredContent: { preparedRequest: request, doneMessage },
  };
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
      return codedError('confirm_expired',
        'Der Bestätigungsschlüssel ist abgelaufen (zehn Minuten). Bitte den Aufruf ohne confirmToken ' +
          'wiederholen, die Vorschau erneut prüfen und mit dem neuen Schlüssel bestätigen.');
    case 'mismatch':
      return codedError('confirm_mismatch',
        'Der Bestätigungsschlüssel gehört zu einer anderen Änderung als der jetzt angeforderten — ' +
          'entweder wurden die Werte dazwischen verändert oder der Datensatz hat sich geändert. ' +
          'Es wurde nichts geschrieben. Bitte den Aufruf ohne confirmToken wiederholen und die neue Vorschau prüfen.');
    default:
      return codedError('confirm_unknown',
        'Der Bestätigungsschlüssel ist unbekannt oder wurde bereits benutzt — jeder Schlüssel gilt genau einmal. ' +
          'Es wurde nichts geschrieben. Bitte den Aufruf ohne confirmToken wiederholen.');
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
