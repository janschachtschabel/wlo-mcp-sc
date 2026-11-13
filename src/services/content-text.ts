/**
 * services/content-text.ts – The actual TEXT of a material, not its metadata.
 *
 * Three sources, repository first:
 *   1. edu-sharing's own `/textContent` — it already holds converted text for
 *      the large majority (29 of 32 sampled live records, 2026-07-28), for
 *      linked pages as well as attached files.
 *   2. The file itself, where it IS text the repository does not extract — a
 *      Markdown file of a public record (`fileTextFor`).
 *   3. The external extraction service, but only for records that are merely
 *      LINKED (`ccm:wwwurl`) and whose text the repository does not have.
 *
 * No in-process conversion (no PDF parser, no Markitdown): that would be
 * CPU-bound and would block the single Node thread for every other user. Both
 * paths here are remote HTTP, i.e. asynchronous I/O.
 */

import { WLO_TEXT_TIMEOUT_MS, getNodeMetadata, readNodeDownload, readNodeTextContent, stripStoreRef } from '../wlo-api.js';
import { extractTextFromUrl } from '../text-extraction-api.js';
import { nodeTitle } from '../node-match.js';
import { capText } from '../text-cap.js';
import { isPrivateHost, resolvesToPrivateAddress } from '../url-safety.js';
import { log } from '../logger.js';

/** Where the returned text came from. */
export type ContentTextSource = 'repository' | 'external-extraction' | 'none';

/**
 * Why there is no text:
 *   - `node_not_found`     — the id does not resolve to a node
 *   - `no_text_no_url`     — nothing stored and nothing to extract from
 *   - `extraction_failed`  — an external URL exists but the service could not
 *                            read it (or is switched off)
 *   - `access_denied`      — the material is not public; anonymous callers may
 *                            not read it. No converter can change that — only
 *                            rights can, so this is deliberately its own answer
 *                            rather than being folded into "no text".
 *   - `not_extracted`      — the node HAS a file, but the repository gained no
 *                            text from it. Measured on staging 2026-11-13
 *                            (`npm run measure:uploads`): images, audio, video,
 *                            a PDF without a text layer, and Markdown — the
 *                            last is read as the file it is where the record
 *                            is public (`fileTextFor`). "No stored text"
 *                            would claim the file is missing.
 *   - `text_unreadable`    — the text READ failed (timeout, 5xx). No statement
 *                            about the material at all: a large PDF timing out
 *                            must not read as "the repository gained no text"
 *                            (review P2, 2026-11-08).
 */
export type ContentTextMiss =
  | 'node_not_found'
  | 'no_text_no_url'
  | 'extraction_failed'
  | 'access_denied'
  | 'not_extracted'
  | 'text_unreadable';

/**
 * The one sentence for "file there, no text from it" — the reading tool, the
 * reading widget's caller and `includeTextContent` say it alike.
 */
export const NOT_EXTRACTED_NOTE =
  'Die Datei ist vorhanden, das Repository hat aber keinen Text daraus gewonnen (regelmäßig bei Bildern, Audio, Video, PDFs ohne Textebene und nicht öffentlichen Markdown-Dateien).';

/**
 * Replacement characters and control characters (other than tab/newline/CR):
 * what `textContent` hands back for an image or other binary (skill
 * `wlo-content-files`). Text carrying them is debris, however short.
 */
// eslint-disable-next-line no-control-regex -- matching control characters IS the point here
const BINARY_DEBRIS = /[\uFFFD\u0000-\u0008\u000B\u000C\u000E-\u001F]/;

export interface ContentText {
  nodeId: string;
  title: string;
  text: string;
  source: ContentTextSource;
  /** The external URL the text was extracted from; null for repository text. */
  sourceUrl: string | null;
  /** Length BEFORE truncation, so the caller can see what it is missing. */
  charCount: number;
  /**
   * Set when the SOURCE was larger than what is read of it (`TEXT_CONTENT_MAX_BYTES`,
   * `FILE_TEXT_MAX_BYTES`): `charCount` is then the length that was read — the
   * text is at least that long.
   */
  charCountIsLowerBound?: true;
  truncated: boolean;
  reason?: ContentTextMiss;
}

/**
 * Below this a "text" is boilerplate (cookie banner, nav crumbs), not content.
 * Exported because `services/url-text.ts` judges extraction results by the same
 * rule — one floor, not two that drift apart.
 */
export const MIN_USEFUL_CHARS = 200;

/**
 * Whether what `textContent` handed back is text at all: not blank, and — when
 * short — not binary debris. ONE rule for every path that shows a stored text
 * (`get_wlo_content_text` and `includeTextContent`), so one record cannot read
 * as text in one tool and as "no text extracted" in its sibling.
 */
export function isStoredText(text: string | null | undefined): boolean {
  const t = (text ?? '').trim();
  return t.length > 0 && (t.length >= MIN_USEFUL_CHARS || !BINARY_DEBRIS.test(t));
}

/**
 * A stored-text read that never throws: a timeout (a large PDF) is a failed
 * read with status 0, reported as such — never the loss of the whole answer.
 */
export function readStoredText(nodeId: string): Promise<{ text: string | null; status: number; none?: true; cut?: true }> {
  return readNodeTextContent(nodeId, WLO_TEXT_TIMEOUT_MS).catch(() => ({ text: null, status: 0 }));
}

/**
 * File types that ARE text and that the repository extracts nothing from.
 * Measured 2026-11-13: a Markdown upload is stored as `text/x-web-markdown`
 * whatever type the upload names, and `/textContent` answers `{"text":null}`.
 * An ALLOW list on purpose: for every other type the download is bytes, or
 * markup (`text/html`) the repository already turns into text itself.
 */
const VERBATIM_TEXT_TYPES = new Set(['text/x-web-markdown', 'text/markdown', 'text/x-markdown']);

/** The most that is read of such a file; what lies past it is cut by the caller's own cap anyway. */
export const FILE_TEXT_MAX_BYTES = 2 * 1024 * 1024;

/**
 * The file itself as text, for a type the repository does not extract — or
 * null. Works for a PUBLIC record only: no login reads a private file's bytes
 * (`eduservlet/download` 403, measured 2026-11-06 and again 2026-11-13), and
 * then the honest answer stays "no text extracted". Never throws.
 *
 * The ONE way out every path that shows a stored text takes
 * (`get_wlo_content_text`, `includeTextContent` on details and on search hits,
 * the `fetch` tool), with its conditions in one place: a record that carries a
 * file and links nowhere — a linked record's text is the page's. The type is
 * the repository's verdict, apparently by file name, so the bytes are checked
 * too: control characters anywhere mean this is no text, however long.
 */
export async function fileTextFor(
  nodeId: string, file: { mimeType?: string; fileSize?: number; linked: boolean },
): Promise<{ text: string; cut: boolean } | null> {
  if (file.linked || !(Number(file.fileSize ?? 0) > 0)) return null;
  const type = (file.mimeType ?? '').split(';')[0]!.trim().toLowerCase();
  if (!VERBATIM_TEXT_TYPES.has(type)) return null;
  const read = await readNodeDownload(nodeId, FILE_TEXT_MAX_BYTES).catch(() => null);
  if (!read || !read.text.trim() || BINARY_DEBRIS.test(read.text)) return null;
  return { text: read.text, cut: read.truncated };
}

/**
 * Whether a stored-text read ANSWERED: a text, or the repository's own "there
 * is none" (`{"text":null}`). A 200 that names no text field — an HTML login
 * page, another JSON — says nothing about the record.
 */
export function storedTextAnswered(read: { text: string | null; status: number; none?: true }): boolean {
  return read.status === 200 && (read.text !== null || read.none === true);
}

/** Fields read off the node: its title and the external URL for the fallback. */
const NODE_PROPS = ['ccm:wwwurl', 'cclom:title', 'cm:title', 'cm:name'];

/** Injection point for tests — DNS does not belong in a unit test. */
export interface ContentTextDeps {
  lookup?: (hostname: string) => Promise<{ address: string }[]>;
}

/**
 * Is this URL's host safe to hand to the fetching service?
 *
 * Literal check first, resolver second — the same order `services/url-text.ts`
 * uses: a literal private address needs no DNS round trip. An unresolvable name
 * counts as a refusal rather than as "public", because the extraction service
 * does its own lookup and may get an answer we never saw.
 *
 * Only the host is ever logged, never the URL: it can carry a token in its
 * query string, and a refusal must not be the thing that records it.
 */
async function hostIsPublic(
  url: string,
  lookup?: (hostname: string) => Promise<{ address: string }[]>,
): Promise<boolean> {
  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    return false;
  }
  if (isPrivateHost(host)) {
    log.warn('content text refused a private-network URL', { host });
    return false;
  }
  const resolved = await resolvesToPrivateAddress(host, lookup);
  if (resolved !== 'public') {
    log.warn('content text refused a host by resolution', { host, resolved });
    return false;
  }
  return true;
}

export async function getContentText(
  nodeId: string,
  maxChars: number,
  deps: ContentTextDeps = {},
): Promise<ContentText> {
  // In parallel: the text read is the slow one (median 4.6 s live), so pulling
  // the node's title and fallback URL alongside it costs no extra wall time.
  const [repo, node] = await Promise.all([
    readStoredText(nodeId),
    getNodeMetadata(nodeId, NODE_PROPS),
  ]);

  const title = node ? nodeTitle(node) : '';
  const base = { nodeId, title, sourceUrl: null as string | null };
  const miss = (reason: ContentTextMiss): ContentText =>
    ({ ...base, text: '', source: 'none', charCount: 0, truncated: false, reason });

  const repoText = (repo.text ?? '').trim();
  const linked = Boolean(stripStoreRef(node?.properties?.['ccm:wwwurl']?.[0]));
  // The floor is for CRAWLED text — a linked page's cookie banner. A node that
  // links nowhere holds the text of its own file or the full text written to
  // it (plan 2026-11-08, W1), and a short one is still that text.
  if (repoText.length >= MIN_USEFUL_CHARS || (isStoredText(repoText) && node && !linked)) {
    return cap({ ...base, text: repo.text as string, source: 'repository' }, maxChars, repo.cut);
  }
  // A refused read outranks a missing one, and is checked FIRST: a node that is
  // not public refuses its metadata too (live-verified), so the "not found"
  // branch would otherwise claim the material does not exist when it does.
  if (repo.status === 403 || repo.status === 401) return miss('access_denied');
  if (!node) return miss('node_not_found');

  const wwwurl = stripStoreRef(node.properties?.['ccm:wwwurl']?.[0]);
  if (!wwwurl) {
    // Only an ANSWERED read may say what the record holds.
    if (!storedTextAnswered(repo)) return miss('text_unreadable');
    const file = await fileTextFor(nodeId, { mimeType: node.mimetype, fileSize: Number(node.size ?? 0), linked: false });
    if (file) return cap({ ...base, text: file.text, source: 'repository' }, maxChars, file.cut);
    return miss(Number(node.size ?? 0) > 0 ? 'not_extracted' : 'no_text_no_url');
  }

  // SSRF (audit 2026-08-12, F-4): the check inside `extractTextFromUrl` judges
  // only the LITERAL host, so a PUBLIC name with a private A record walked
  // straight past it and turned the extraction service into a probe for its own
  // network. `get_url_text` has resolved its host all along because its input is
  // a tool argument; this input is a curated repository field — but WLO takes
  // open contributions and `get_wlo_content_text` answers anonymous callers, so
  // "curated" does not imply "trusted address". A refusal reports the existing
  // `extraction_failed`: the tool's answer vocabulary stays unchanged.
  if (!(await hostIsPublic(wwwurl, deps.lookup))) return miss('extraction_failed');

  const extracted = await extractTextFromUrl(wwwurl);
  if (!extracted || extracted.trim().length < MIN_USEFUL_CHARS) return miss('extraction_failed');
  return cap({ ...base, text: extracted, source: 'external-extraction', sourceUrl: wwwurl }, maxChars);
}

/** Apply the shared truncation rule (text-cap.ts) to a ContentText in progress. */
function cap(
  r: { nodeId: string; title: string; text: string; source: ContentTextSource; sourceUrl: string | null },
  maxChars: number,
  sourceCut = false,
): ContentText {
  return { ...r, ...capText(r.text, maxChars), ...(sourceCut ? { charCountIsLowerBound: true as const } : {}) };
}
