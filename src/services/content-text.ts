/**
 * services/content-text.ts – The actual TEXT of a material, not its metadata.
 *
 * Two sources, repository first:
 *   1. edu-sharing's own `/textContent` — it already holds converted text for
 *      the large majority (29 of 32 sampled live records, 2026-07-28), for
 *      linked pages as well as attached files.
 *   2. The external extraction service, but only for records that are merely
 *      LINKED (`ccm:wwwurl`) and whose text the repository does not have.
 *
 * No in-process conversion (no PDF parser, no Markitdown): that would be
 * CPU-bound and would block the single Node thread for every other user. Both
 * paths here are remote HTTP, i.e. asynchronous I/O.
 */

import { WLO_TEXT_TIMEOUT_MS, getNodeMetadata, readNodeTextContent, stripStoreRef } from '../wlo-api.js';
import { extractTextFromUrl } from '../text-extraction-api.js';
import { nodeTitle } from '../node-match.js';

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
 */
export type ContentTextMiss =
  | 'node_not_found'
  | 'no_text_no_url'
  | 'extraction_failed'
  | 'access_denied';

export interface ContentText {
  nodeId: string;
  title: string;
  text: string;
  source: ContentTextSource;
  /** The external URL the text was extracted from; null for repository text. */
  sourceUrl: string | null;
  /** Length BEFORE truncation, so the caller can see what it is missing. */
  charCount: number;
  truncated: boolean;
  reason?: ContentTextMiss;
}

/** Below this a "text" is boilerplate (cookie banner, nav crumbs), not content. */
const MIN_USEFUL_CHARS = 200;

/** Fields read off the node: its title and the external URL for the fallback. */
const NODE_PROPS = ['ccm:wwwurl', 'cclom:title', 'cm:title', 'cm:name'];

export async function getContentText(nodeId: string, maxChars: number): Promise<ContentText> {
  // In parallel: the text read is the slow one (median 4.6 s live), so pulling
  // the node's title and fallback URL alongside it costs no extra wall time.
  const [repo, node] = await Promise.all([
    readNodeTextContent(nodeId, WLO_TEXT_TIMEOUT_MS).catch(() => ({ text: null, status: 0 })),
    getNodeMetadata(nodeId, NODE_PROPS),
  ]);

  const title = node ? nodeTitle(node) : '';
  const base = { nodeId, title, sourceUrl: null as string | null };
  const miss = (reason: ContentTextMiss): ContentText =>
    ({ ...base, text: '', source: 'none', charCount: 0, truncated: false, reason });

  if ((repo.text ?? '').trim().length >= MIN_USEFUL_CHARS) {
    return cap({ ...base, text: repo.text as string, source: 'repository' }, maxChars);
  }
  // A refused read outranks a missing one, and is checked FIRST: a node that is
  // not public refuses its metadata too (live-verified), so the "not found"
  // branch would otherwise claim the material does not exist when it does.
  if (repo.status === 403 || repo.status === 401) return miss('access_denied');
  if (!node) return miss('node_not_found');

  const wwwurl = stripStoreRef(node.properties?.['ccm:wwwurl']?.[0]);
  if (!wwwurl) return miss('no_text_no_url');

  const extracted = await extractTextFromUrl(wwwurl);
  if (!extracted || extracted.trim().length < MIN_USEFUL_CHARS) return miss('extraction_failed');
  return cap({ ...base, text: extracted, source: 'external-extraction', sourceUrl: wwwurl }, maxChars);
}

/** Cut to maxChars at a word boundary and disclose that it happened. */
function cap(
  r: { nodeId: string; title: string; text: string; source: ContentTextSource; sourceUrl: string | null },
  maxChars: number,
): ContentText {
  const full = r.text.trim();
  if (full.length <= maxChars) {
    return { ...r, text: full, charCount: full.length, truncated: false };
  }
  const slice = full.slice(0, maxChars);
  const lastSpace = slice.lastIndexOf(' ');
  const cut = lastSpace > maxChars * 0.8 ? slice.slice(0, lastSpace) : slice;
  return { ...r, text: `${cut.trimEnd()}\n\n[…gekürzt]`, charCount: full.length, truncated: true };
}
