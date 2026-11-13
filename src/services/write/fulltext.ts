/**
 * services/write/fulltext.ts – a full text in the record's own `textContent`
 * (plan 2026-11-08, W1/W2; user decision 2026-11-08: the file hangs on the node,
 * the full text goes into textContent).
 *
 * What is known, and what the rules below rest on (plan §2):
 *  - `POST …/textContent` writes the record's CONTENT as text (`cclom:size` =
 *    the bytes sent, measured 2026-07-31). Whether a record that already HAS
 *    content keeps it is unmeasured — staging refuses every content write since
 *    2026-11-06 (500 `InvalidTypeException`). Until a live run settles it, the
 *    safeguard (`keepsBinary()` false) refuses such a record BEFORE any key
 *    (`would_replace_file`): an approval must not be able to cost a person their
 *    uploaded file. "Content" includes a text written here before — after a
 *    write the record HAS a size — so replacing one is refused too, for now.
 *  - The body is the RAW text with `Content-Type: application/json`: a
 *    JSON-encoded string body is stored with its quotes (measured 2026-07-31),
 *    and `text/plain` / `text/markdown` bodies answer 415 (measured 2026-11-08).
 *    `mimetype=text/plain`, because `GET …/textContent` extracts nothing from
 *    `text/markdown` (edu-sharing client library, 2026-08-27 and 2026-09-11).
 *  - A LINKED record (`ccm:wwwurl`) reads its text from the page; text POSTed to
 *    it does not come back (measured 2026-07-31). Refused as `link_record`.
 *  - Every write is read back through the same `GET …/textContent` every reader
 *    uses; a difference is `not_stored`, never success. Once the safeguard is
 *    lifted, the file's hash and type are compared too (`file_replaced`).
 *  - The safeguard is checked again right before EVERY write, not only at the
 *    confirmation: a plan (W2) writes for up to 30 minutes after it, and a file
 *    uploaded in between must not be the one the approval costs (overall review).
 *  - Every read here answers a network failure with a refusal code, never a
 *    throw: W1 and W2 then name the same cause the same way.
 */

import { createHash } from 'node:crypto';

import { readNodeMetadata, readNodeTextContent, stripStoreRef, type WloNode } from '../../wlo-api.js';
import { BASE_URL, WLO_TEXT_TIMEOUT_MS } from '../../wlo-config.js';
import { wloFetch } from '../../wlo-fetch.js';
import { nodeTitle } from '../../node-match.js';
import { wrongKind } from '../../node-kind.js';
import { flattenText } from '../../text-sanitize.js';
import { failureCode, writeFailureCode } from '../failure-code.js';
import { failureDetail, resolveWriteTarget } from './nodes.js';

/** Bytes (UTF-8) per full text. Measured to round-trip at 2 MB in a property (2026-11-07); a call carries one. */
export const FULLTEXT_MAX_BYTES = 2_000_000;
/** The POST carries up to 2 MB: the 20 s default is for reads, not for this (review W1). */
const FULLTEXT_WRITE_TIMEOUT_MS = 60_000;

/**
 * The safeguard (see the module head). Becomes `true` only after
 * `tests/live/fulltext.test.ts` shows a record's file survives the write.
 */
const FULLTEXT_KEEPS_BINARY = false;
let keepsBinaryOverride: boolean | null = null;
export function keepsBinary(): boolean { return keepsBinaryOverride ?? FULLTEXT_KEEPS_BINARY; }
/** Test seam: exercise the lifted safeguard. `null` restores it. */
export function setKeepsBinaryForTest(value: boolean | null): void { keepsBinaryOverride = value; }

export type FulltextSource = 'binary' | 'website' | 'manual';
export const FULLTEXT_SOURCES: readonly FulltextSource[] = ['binary', 'website', 'manual'];

export interface FulltextInput {
  nodeId: string;
  markdown: string;
  source: FulltextSource;
  sourceUrl?: string;
  language?: string;
  replace?: boolean;
}

export type RefusalCode =
  | 'not_found' | 'forbidden' | 'unreadable' | 'unreadable_original' | 'too_large' | 'exists' | 'nothing_to_change'
  | 'would_replace_file' | 'link_record' | 'text_unreadable' | 'not_a_record';

export interface FulltextPlan {
  requestedId: string;
  targetId: string;
  title: string;
  bytes: number;
  sha256: string;
  /** True when a text is there now and will be replaced. */
  replaces: boolean;
  source: FulltextSource;
  sourceUrl?: string;
  language?: string;
  /** The content before the write, for the after-check once the safeguard is lifted. */
  before: { size: number; mimetype: string; hash: string };
}

/**
 * A refusal made after the target was resolved names it (`targetId`), so a batch
 * can tell that two mentions meant one record even when the first changes nothing.
 */
export type PlanOutcome = { ok: true; plan: FulltextPlan } | { ok: false; code: RefusalCode; reason: string; targetId?: string };

/** A BOM, line endings and whitespace at either end are not a different text. */
export function normalizedText(text: string): string {
  return text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').trim();
}

const sizeOf = (node: WloNode | null) => Number(node?.size ?? 0) || 0;

/** A read's status as the refusal it means. */
function readRefusal(status: number, what: string): { ok: false; code: RefusalCode; reason: string } {
  if (status === 404) return { ok: false, code: 'not_found', reason: `${what} wurde nicht gefunden.` };
  if (status === 401 || status === 403) return { ok: false, code: 'forbidden', reason: `${what} darf mit dieser Anmeldung nicht gelesen werden.` };
  return { ok: false, code: 'unreadable', reason: `${what} ließ sich gerade nicht lesen (HTTP ${status}).` };
}

const WOULD_REPLACE_FILE = 'Der Datensatz trägt Inhalt — eine Datei oder einen früher geschriebenen Volltext. Ob das Schreiben '
  + 'ihn behält oder ersetzt, ist noch nicht gemessen; bis dahin wird nichts geschrieben, damit keine Datei verloren geht.';

/** Everything the preview needs, and every refusal that must come before a key. */
export async function planFulltext(input: FulltextInput): Promise<PlanOutcome> {
  const bytes = Buffer.byteLength(input.markdown, 'utf8');
  if (bytes > FULLTEXT_MAX_BYTES) {
    return { ok: false, code: 'too_large', reason: `Der Volltext hat ${bytes} Bytes, erlaubt sind ${FULLTEXT_MAX_BYTES}.` };
  }
  const asked = await readNodeMetadata(input.nodeId).catch(() => ({ node: null, status: 0 }));
  if (!asked.node) return readRefusal(asked.status, 'Der Datensatz');
  const target = resolveWriteTarget(asked.node, input.nodeId);
  const refuse = (code: RefusalCode, reason: string): PlanOutcome => ({ ok: false, code, reason, targetId: target.targetId });
  const refuseFile = () => refuse('would_replace_file', WOULD_REPLACE_FILE);
  // The ORIGINAL is what is written and what the safeguard judges — read once,
  // and a read that fails refuses: a node we could not see must never count as
  // "no file" (review W1, finding 2).
  let original: WloNode = asked.node;
  if (target.redirected) {
    const read = await readNodeMetadata(target.targetId).catch(() => ({ node: null, status: 0 }));
    if (!read.node) {
      return refuse('unreadable_original', `„${flattenText(input.nodeId)}“ ist eine Verknüpfung; das Original `
        + `${flattenText(target.targetId)} ließ sich nicht lesen (HTTP ${read.status}) — es wurde nichts geprüft und nichts geschrieben.`);
    }
    original = read.node;
  }
  const title = flattenText(nodeTitle(original) || target.targetId);
  // A full text is the CONTENT of a record. A collection or folder has no file
  // and no source URL, so it passed every safeguard below — and the write would
  // have put content on a container.
  const wrong = wrongKind(original, 'content');
  if (wrong) return refuse('not_a_record', `„${flattenText(target.targetId)}“ ${wrong.reason} Es wurde nichts geschrieben.`);

  if (stripStoreRef(original.properties?.['ccm:wwwurl']?.[0])) {
    return refuse('link_record', 'Der Datensatz verweist auf eine Webseite; deren Text liest das Repository selbst '
      + 'von der Seite, ein hier geschriebener Text käme nicht zurück (gemessen 2026-07-31).');
  }

  const size = sizeOf(original);
  // A FILE under the safeguard is refused without reading its text: extracting a
  // PDF takes seconds (median 4.6 s live), and 200 of them cost minutes in the
  // preview AND again at the confirmation — for an answer the extraction cannot
  // change (overall review, 12). Only a `text/plain` content can be a text
  // written here before, and for that the text below is the truer answer.
  // `startsWith`: what type the repository reports after a text write is unmeasured
  // (staging refuses content), and `text/plain;charset=UTF-8` is the likely spelling.
  if (size > 0 && !keepsBinary() && !String(original.mimetype ?? '').startsWith('text/plain')) return refuseFile();

  // The text first: `nothing_to_change` and `exists` write nothing and are the
  // truer answer — a record that carries a text written here before HAS content,
  // and the safeguard below would otherwise answer every repeat (finding 3).
  const current = await readNodeTextContent(target.targetId, WLO_TEXT_TIMEOUT_MS).catch(() => ({ text: null, status: 0 }));
  if (current.status !== 200) {
    return refuse('text_unreadable', `Der vorhandene Text ließ sich nicht lesen (HTTP ${current.status}); `
      + 'ohne ihn ist nicht zu sagen, ob etwas ersetzt würde.');
  }
  const existing = normalizedText(current.text ?? '');
  if (existing && existing === normalizedText(input.markdown)) {
    return refuse('nothing_to_change', 'Genau dieser Text steht schon im Datensatz.');
  }
  if (existing && !input.replace) {
    // Under the safeguard every text is content, so `replace` would only meet
    // `would_replace_file` — do not send the caller round that loop (overall review, 5).
    return refuse('exists', keepsBinary()
      ? 'Der Datensatz hat schon einen Volltext; zum Ersetzen replace: true angeben.'
      : 'Der Datensatz trägt schon einen Text (Volltext oder Textdatei). Ersetzen ist gesperrt, bis gemessen ist, dass eine Datei '
        + 'dabei erhalten bleibt.');
  }

  if (size > 0 && !keepsBinary()) return refuseFile();
  return { ok: true, plan: {
    requestedId: input.nodeId, targetId: target.targetId, title, bytes,
    sha256: createHash('sha256').update(input.markdown, 'utf8').digest('hex'),
    replaces: Boolean(existing), source: input.source,
    ...(input.sourceUrl ? { sourceUrl: input.sourceUrl } : {}), ...(input.language ? { language: input.language } : {}),
    before: { size, mimetype: String(original.mimetype ?? ''), hash: String(original.content?.hash ?? '') },
  } };
}

const SOURCE_LABEL: Record<FulltextSource, string> = { binary: 'aus der Datei', website: 'von einer Webseite', manual: 'von Hand' };

/**
 * What the person approves. The text itself is bound by its checksum (the rule
 * file uploads follow: name, size, checksum), and everything else that goes
 * into the version comment is spelled out.
 */
export function fulltextLine(plan: FulltextPlan): string {
  return `„${plan.title}“ (${plan.requestedId}${plan.requestedId !== plan.targetId ? ` → Original ${plan.targetId}` : ''}): `
    + `${plan.replaces ? 'ersetzt den vorhandenen Volltext durch' : 'legt als Volltext ab'} ${plan.bytes} Bytes Text `
    + `(sha256 ${plan.sha256}), Quelle ${SOURCE_LABEL[plan.source]}`
    + `${plan.sourceUrl ? ` ${flattenText(plan.sourceUrl)}` : ''}${plan.language ? `, Sprache ${flattenText(plan.language)}` : ''}`;
}

export function versionComment(plan: FulltextPlan): string {
  return flattenText(`Volltext ${SOURCE_LABEL[plan.source]}${plan.sourceUrl ? ` (${plan.sourceUrl})` : ''}`
    + `${plan.language ? `, ${plan.language}` : ''} — über den WLO-MCP-Server`).slice(0, 250);
}

export type WriteOutcome =
  | { status: 'stored' }
  | { status: 'not_stored' | 'unverified' | 'failed'; code: string; outcomeOpen: boolean; detail: string };

/**
 * Right before the POST: is the record still what the person approved? Nothing
 * is sent when it is not, so every answer here is `outcomeOpen: false`.
 */
async function stillAsApproved(plan: FulltextPlan): Promise<WriteOutcome | null> {
  const now = await readNodeMetadata(plan.targetId).catch(() => ({ node: null, status: 0 }));
  const refused = (code: string, detail: string): WriteOutcome => ({ status: 'failed', code, outcomeOpen: false, detail });
  if (!now.node) {
    return refused(now.status === 404 ? 'not_found' : 'unreadable',
      `Der Datensatz ließ sich vor dem Schreiben nicht lesen (HTTP ${now.status}) — es wurde nichts gesendet.`);
  }
  const size = sizeOf(now.node);
  if (size > 0 && !keepsBinary()) return refused('would_replace_file', `${WOULD_REPLACE_FILE} (Seit der Bestätigung hinzugekommen.)`);
  // Without content before and after there is nothing to protect: a hash or type
  // the repository derives for an empty node (unmeasured) must not refuse it.
  const noContent = size === 0 && plan.before.size === 0;
  if (!noContent && (size !== plan.before.size || String(now.node.mimetype ?? '') !== plan.before.mimetype
    || String(now.node.content?.hash ?? '') !== plan.before.hash)) {
    return refused('changed_since_preview', 'Der Inhalt des Datensatzes hat sich seit der Bestätigung geändert — es wurde nichts '
      + 'gesendet. Bitte eine neue Vorschau holen.');
  }
  return null;
}

/** Whether the read-back shows the text, shows nothing new, or cannot tell. */
async function readBack(plan: FulltextPlan, markdown: string): Promise<'landed' | 'absent' | 'other' | 'unreadable'> {
  const back = await readNodeTextContent(plan.targetId, WLO_TEXT_TIMEOUT_MS).catch(() => ({ text: null, status: 0 }));
  // A 200 whose body names no text (not JSON, neither `content` nor `text`) is no
  // answer — reading it as "empty" would turn it into proof that nothing landed.
  if (back.status !== 200 || back.text === null) return 'unreadable';
  const text = normalizedText(back.text ?? '');
  if (text === normalizedText(markdown)) return 'landed';
  // "Nothing landed" is provable only where nothing was there before.
  return !text && !plan.replaces ? 'absent' : 'other';
}

/** Write and read back. Called only after the key was redeemed. */
export async function writeFulltext(plan: FulltextPlan, markdown: string): Promise<WriteOutcome> {
  const changed = await stillAsApproved(plan);
  if (changed) return changed;
  const params = new URLSearchParams({ mimetype: 'text/plain', versionComment: versionComment(plan) });
  let res: Response;
  try {
    res = await wloFetch(`${BASE_URL}/node/v1/nodes/-home-/${encodeURIComponent(plan.targetId)}/textContent?${params}`, {
      method: 'POST',
      // Raw text under application/json — see the module head for why.
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: markdown,
      signal: AbortSignal.timeout(FULLTEXT_WRITE_TIMEOUT_MS),
    });
  } catch (err) {
    // The request may have arrived; the answer did not.
    return { status: 'failed', code: writeFailureCode(err), outcomeOpen: true, detail: err instanceof Error ? err.message : String(err) };
  }
  if (!res.ok) {
    const detail = await failureDetail(res);
    const failed = (outcomeOpen: boolean, note = ''): WriteOutcome =>
      ({ status: 'failed', code: failureCode(new Error(detail)), outcomeOpen, detail: `${detail}${note}` });
    // A 4xx is a refusal before any work. A 5xx may come after it (measured: a
    // 500 over a collection that WAS created, 2026-11-06) — so for the
    // repository's own 500 the READ-BACK decides, as W3 does (overall review,
    // 20). A 502/503/504 may come from a proxy while the repository still
    // writes: an empty read-back right then proves nothing (review 3, finding 1).
    if (res.status < 500) return failed(false);
    if (res.status !== 500) return failed(true);
    const seen = await readBack(plan, markdown);
    if (seen === 'absent') return failed(false, ' Zurückgelesen: der Text ist nicht angekommen.');
    if (seen !== 'landed') return failed(true);
    return afterLanded(plan);
  }
  const seen = await readBack(plan, markdown);
  if (seen === 'unreadable') return { status: 'unverified', code: 'unverified', outcomeOpen: true, detail: 'Zurücklesen scheiterte.' };
  if (seen !== 'landed') {
    return { status: 'not_stored', code: 'not_stored', outcomeOpen: true,
      detail: 'Das Repository hat die Anfrage angenommen, der zurückgelesene Text stimmt aber nicht mit dem gesendeten überein.' };
  }
  return afterLanded(plan);
}

/** The text landed. Once the safeguard is lifted, prove the file survived too. */
async function afterLanded(plan: FulltextPlan): Promise<WriteOutcome> {
  if (keepsBinary() && plan.before.size > 0) {
    // Only reachable once the safeguard is lifted: prove the file survived — its
    // hash and type, both, because a text replacing it may keep the type.
    const after = (await readNodeMetadata(plan.targetId).catch(() => ({ node: null }))).node;
    const hashAfter = String(after?.content?.hash ?? '');
    if (!after || String(after.mimetype ?? '') !== plan.before.mimetype || (plan.before.hash && hashAfter !== plan.before.hash)) {
      // `failed` + code, the shape W1 and W2 both report (overall review, 4a).
      return { status: 'failed', code: 'file_replaced', outcomeOpen: true,
        detail: 'Der Text ist gespeichert, aber die Datei des Datensatzes wurde dabei ersetzt (oder ließ sich danach nicht prüfen) — '
          + 'die frühere Fassung liegt in der Versionsliste.' };
    }
  }
  return { status: 'stored' };
}
