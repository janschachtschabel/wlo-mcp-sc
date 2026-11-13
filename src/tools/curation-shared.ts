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

import { titleFromProperties } from '../node-match.js';
import { titleOn } from '../services/write/collection-fields.js';
import type { WloNode } from '../wlo-types.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { validateField, applyLicenceDefaults, WRITABLE_FIELDS } from '../services/write/fields.js';
import { flattenText, sanitizeText } from '../text-sanitize.js';
import { log } from '../logger.js';
import { toolError } from './shared.js';
import { renderChangeSet, hasSomethingToConfirm, displayValue, type ChangeSet } from '../services/write/change-set.js';
import { mintToken, consumeToken, currentIdentity, TOKEN_TTL_MS } from '../services/write/confirm.js';
import { lookupReplayInCall } from '../services/write/confirm-replay.js';
import { replayAnswer, runWithReplay } from './curation-replay.js';
import { writeRefusal, mayPrepare } from '../services/write/credential-gate.js';
import type { PreparedRequest } from '../services/write/prepared-request.js';
import { registerWloTool, type WloToolDef, type WloToolResult } from '../apps/register.js';
import { OAUTH_SECURITY_SCHEMES } from '../apps/tool-defaults.js';
import { detachedFromRequest } from '../request-scope.js';
import { wrongKind } from '../node-kind.js';
import { codedError, textResult } from './curation-reply.js';

// Two parts of this module moved out (audit 2026-11-12, A-5): the reply shapes
// and the outcome reports. Re-exported, because every curation tool imports
// from here and where a function lives is not their concern.
export { codedError, errorText, plainText, prependText } from './curation-reply.js';
export { reportOutcome, markWritten, reportMutation, unverifiedReply, desiredFromChangeSet } from './curation-report.js';

// The decision lives in `node-kind.ts` so `services/` applies the same one;
// re-exported here, where every curation tool already imports from.
export { wrongKind };

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
    /**
     * `false` for tools whose key already continues a stored PLAN
     * (`plan-runner.ts`): a replay of the first slice would stop the plan from
     * continuing. Every other curation tool gets the safe retry (plan
     * 2026-11-07, S3).
     */
    replay?: false;
  },
): void {
  const { preparable, replay, ...toolDef } = def;
  registerWloTool(server, {
    ...toolDef,
    securitySchemes: OAUTH_SECURITY_SCHEMES,
    handler: async (args, extra) => {
      const refusal = writeRefusal();
      if (refusal === null || (preparable && mayPrepare())) {
        const alias = repositoryAliasIn(args);
        if (alias) {
          return codedError('invalid_input', `„${sanitizeText(alias)}“ ist ein Platzhalter des Repositorys, keine nodeId. `
            + 'Es wurde nichts geändert.');
        }
        // Detached from the inbound request (request-scope.ts): an abort hits
        // the response, not the work, so a write that has begun — and the
        // read-back and stored result that follow it — runs to its end even
        // when the caller has hung up. A re-presented key then finds the result.
        const run = async () => namePreviewTool(await detachedFromRequest(() => def.handler(args, extra)), def.name);
        const token = typeof args['confirmToken'] === 'string' ? args['confirmToken'] : '';
        return token && replay !== false ? runWithReplay(token, args, run) : run();
      }
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
 * An id argument that is a repository ALIAS (`-userhome-`, `-inbox-`,
 * `-root-`), or null. An alias names a PLACE the repository resolves per
 * caller — and what it resolves to is a `ccm:map` (measured 2026-11-12), so it
 * passes for a container wherever only the type is asked. Nothing a person
 * means by "this record" or "this collection" is ever one, so no curation tool
 * takes one: checked here, at the seam every one of them passes, rather than
 * per tool (the first version guarded the delete tools alone — review of audit
 * package 2). Looks at every argument whose NAME ends in `Id`/`Ids`, also
 * inside lists of items; free text is never read as an id.
 */
export function repositoryAliasIn(args: Record<string, unknown>, depth = 0): string | null {
  for (const [key, value] of Object.entries(args)) {
    const values = Array.isArray(value) ? value : [value];
    for (const v of values) {
      if (typeof v === 'string') {
        if (/Ids?$/.test(key) && /^-.*-$/.test(v.trim())) return v;
      } else if (v && typeof v === 'object' && depth < 2) {
        const inner = repositoryAliasIn(v as Record<string, unknown>, depth + 1);
        if (inner) return inner;
      }
    }
  }
  return null;
}

/** The refusal sentence for `wrongKind`, for every tool that changes rather than deletes. */
export function wrongKindReply(id: string, wrong: { code: string; reason: string }): WloToolResult {
  return codedError(wrong.code, `„${sanitizeText(id)}“ ${wrong.reason} Es wurde nichts geändert.`);
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

// Lives in the write service so services can tell an abort from a refusal
// too; re-exported here, where every curation tool already imports it.
import { isOutcomeOpen } from '../services/write/timeouts.js';
export { isOutcomeOpen };

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
  if (!isOutcomeOpen(err)) return toolError(context, err);
  if (opts.preview) {
    // A call without any key is a preview and never writes, so here — and only
    // here — the outcome is NOT open: a program may simply repeat the call
    // (chatbot feedback 2026-11-07). With a key the abort may have hit a write,
    // even one that had not started yet; saying "open" there is the safe side.
    log.warn('preview aborted before an answer arrived', { context });
    return codedError('timeout',
      'Vom Repository kam keine Antwort (Zeitüberschreitung oder Verbindungsabbruch) — beim Vorbereiten der Vorschau, vor jeder Änderung. ' +
        'Es wurde nichts geändert. Bitte den Aufruf erneut ausführen.', { outcomeOpen: false });
  }
  log.warn('mutation aborted before an answer arrived', { context });
  // `timeout` = the OUTCOME IS OPEN, the same code the plan answers use: a
  // program must look before it repeats, never retry blindly.
  return codedError('timeout',
    `Vom Repository kam keine Antwort (Zeitüberschreitung oder Verbindungsabbruch). ${whatIsOpen} — der Abbruch trifft die Antwort, ` +
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
export function recordTitle(properties: Record<string, string[]> | undefined, node?: Pick<WloNode, 'type' | 'aspects'>): string {
  // With the node: a collection is named by ITS title (`titleOn`), not by a stray record title.
  const raw = node ? titleOn(node, properties) : titleFromProperties(properties);
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

export function rejectionReply(reasons: string[], extra: Record<string, unknown> = {}): WloToolResult {
  return codedError('invalid_input',
    ['Die Angaben wurden nicht übernommen:', ...reasons.map(r => `- ${r}`)].join('\n'), { reasons, ...extra });
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
    case 'replay':
      // Two calls sent at once: both passed the seam, the other one redeemed.
      return replayAnswer(lookupReplayInCall(token, currentIdentity())) ?? confirmUnknown();
    case 'expired':
      // An EXPIRED key was never redeemed: nothing was written under it.
      return codedError('confirm_expired',
        'Der Bestätigungsschlüssel ist abgelaufen (zehn Minuten). Bitte den Aufruf ohne confirmToken ' +
          'wiederholen, die Vorschau erneut prüfen und mit dem neuen Schlüssel bestätigen.', { outcomeOpen: false });
    case 'mismatch':
      return codedError('confirm_mismatch',
        'Der Bestätigungsschlüssel gehört zu einer anderen Änderung als der jetzt angeforderten — ' +
          'die Werte wurden dazwischen verändert, der Datensatz hat sich geändert, oder der Schlüssel ' +
          'wurde unter einer anderen Anmeldung ausgestellt (etwa vor einer Neuanmeldung). ' +
          'Es wurde nichts geschrieben. Bitte den Aufruf ohne confirmToken wiederholen und die neue Vorschau prüfen.',
        // The key is still unredeemed here (a redeemed one with other arguments is the replay's mismatch).
        { outcomeOpen: false });
    default:
      return confirmUnknown();
  }
}

/**
 * A key this server does not know. THIS call writes nothing — but "unknown"
 * also covers a key that was redeemed before and has since been forgotten (a
 * restart loses every key and stored result), and that earlier call may have
 * written. So the outcome is OPEN, and the sentence no longer says "nothing was
 * written": read as "start over", it created the duplicates this whole
 * arrangement exists to prevent (audit 2026-11-12, K-7; review of package 4).
 */
function confirmUnknown(): WloToolResult {
  return codedError('confirm_unknown',
    'Der Bestätigungsschlüssel ist unbekannt oder wurde bereits benutzt — jeder Schlüssel gilt genau einmal. '
      + 'Dieser Aufruf hat nichts geschrieben. Wurde der Schlüssel aber schon einmal eingelöst (etwa vor einem '
      + 'Neustart des Servers), kann JENER Aufruf geschrieben haben: bitte den Aufruf ohne confirmToken wiederholen '
      + 'und in der neuen Vorschau prüfen, was schon da ist, bevor erneut bestätigt wird.',
    { outcomeOpen: true });
}
