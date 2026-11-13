/**
 * services/skill-registry-detect.ts – which child of a collection IS its registry.
 *
 * Split out of `skill-registry.ts` (audit 2026-11-12, A-5). That module had two
 * jobs — recognising the registry document, and building a catalogue from it —
 * and they change for different reasons: this one when the repository reports a
 * file differently, the other when the editorial format grows.
 *
 * The measurements these rules rest on are in `CLAUDE.md` (Skill-Registry, T1):
 * `/children` carries `ccm:oeh_extendedType` only when asked for it, a SKILL.md
 * reports `text/x-web-markdown`, and the title is read through `nodeTitle`.
 */

import type { WloNode } from '../wlo-api.js';
import { getCollectionContents } from '../wlo-api.js';
import { nodeTitle } from '../node-match.js';
import { log } from '../logger.js';
import { REGISTRY_CONTENT_TYPE_URI, SKILL_PROPS } from './skill-catalogue.js';
import type { RegistryMiss } from './skill-registry.js';

/**
 * What a SKILL.md reports as its media type.
 *
 * `text/x-web-markdown` is edu-sharing's own spelling and the only one staging
 * actually produces (measured 2026-08-10: 25/25 skill records — then still
 * `ai_prompt` — alongside `mediatype: file-markdown`). The media type is
 * unaffected by the 2026-08-12 vocabulary move; only the content type changed.
 * The IANA form and the historical `x-` form are
 * accepted too, so a repository that starts reporting either keeps working.
 */
const MARKDOWN_MIME = new Set(['text/x-web-markdown', 'text/markdown', 'text/x-markdown']);

/** edu-sharing's coarse label, derived from the mimetype — the fallback when the raw value is unhelpful. */
const MARKDOWN_MEDIATYPE = 'file-markdown';

/**
 * How a document names itself the registry — in its file name or in its title.
 *
 * ONE rule for both carriers, because the editorial team writes the same word in
 * both places and in whichever spelling is to hand. All four endings are in real
 * use, not hypothetical: `docs/SKILLS.md` asks for `SKILL_REGISTRY.md`, staging
 * carries `skill_katalog.md` (measured 2026-08-12, see `skill-catalogue.ts`)
 * beside the English `skill_catalog.md`, and the live registry on the Optik
 * collection is titled "Skillkatalog Physik Optik" — which the earlier
 * `'skill registry'` phrase did not match at all. The separator class covers
 * `skill_registry`, `Skill-Katalog`, `Skill Registry` and the run-together
 * `Skillkatalog` alike.
 *
 * Matching a little too eagerly is the safe direction here and is why this may
 * be one loose pattern rather than an exact-name list: it decides a TIE-BREAK
 * among documents that are already `ai_prompt` Markdown in one collection, never
 * whether a registry is recognised at all. Missing a real registry costs the
 * collection its catalogue; over-matching costs at most the wrong pick between
 * two documents that both look like one.
 */
const REGISTRY_MARK = /skill[\s_-]*(registry|catalogue|catalog|katalog)/i;

export function isMarkdownSkillDoc(node: WloNode): boolean {
  return MARKDOWN_MIME.has((node.mimetype ?? '').toLowerCase()) || node.mediatype === MARKDOWN_MEDIATYPE;
}

/**
 * A registry carries the `ai_prompt` entry — the vocabulary term skills
 * themselves left behind on 2026-08-12 (see `REGISTRY_CONTENT_TYPE_URI`).
 * Imported from the one module that owns it rather than spelled out a second
 * time.
 *
 * The listing must be projected with `SKILL_PROPS` for this to see anything:
 * measured 2026-08-10, `/children` returns `ccm:oeh_extendedType` only when the
 * request asks for it — the default projection reports the same node as empty.
 */
function isAiPrompt(node: WloNode): boolean {
  return node.properties?.['ccm:oeh_extendedType']?.includes(REGISTRY_CONTENT_TYPE_URI) ?? false;
}

/**
 * Whether this candidate names itself the registry.
 *
 * Both carriers are asked, and each covers what the other misses. The FILE NAME
 * is what the editorial guide asks for, but it distinguishes nothing until the
 * convention spreads: every skill record on staging is named `SKILL.md`
 * (measured 2026-08-10), because that is what the upload produces. The TITLE is
 * free text an editor sets, so it is the rule that works today — and the one the
 * live Optik registry is actually found by.
 *
 * The title comes from `nodeTitle`, the canonical chain every other consumer
 * uses — NOT from `cclom:title` alone. `cm:title` is in the same projection and
 * is the carrier this repository has measured as the one actually set (109/109
 * production variants). Reading one property made a marked registry invisible,
 * and with a second prompt document present the nodeId tie-break then answered
 * with the wrong document's catalogue.
 */
function isMarked(node: WloNode): boolean {
  const name = node.properties?.['cm:name']?.[0] ?? '';
  return REGISTRY_MARK.test(name) || REGISTRY_MARK.test(nodeTitle(node));
}

/**
 * File children read while looking for the registry. A content collection is not
 * a harvest folder, and the registry is one document among a collection's own
 * material — a page is plenty, and an unbounded listing would turn every search
 * result into a crawl.
 */
const REGISTRY_SCAN_MAX = 50;

/**
 * The registry among a collection's file children, and how many candidates it
 * was chosen from.
 *
 * `candidates` is not decoration: with every file named `SKILL.md`, a collection
 * holding two skills lands in the tie-break immediately, and a registry picked
 * silently out of several is exactly the kind of mistake nobody notices. The
 * caller surfaces it.
 *
 * @returns the chosen node with the candidate count, or `null` when the
 *   collection holds no `ai_prompt` Markdown at all.
 */
export function pickRegistryNode(nodes: WloNode[]): { node: WloNode; candidates: number } | null {
  const candidates = nodes.filter(n => isAiPrompt(n) && isMarkdownSkillDoc(n));
  if (!candidates.length) return null;

  const marked = candidates.filter(isMarked);
  const pool = marked.length ? marked : candidates;
  // Sorted by nodeId so the answer does not depend on the order the repository
  // happened to list the children in — the same collection must resolve to the
  // same registry on every call.
  const node = [...pool].sort((a, b) => (a.ref?.id ?? '').localeCompare(b.ref?.id ?? ''))[0]!;
  return { node, candidates: candidates.length };
}

/**
 * What a registry record is called, for a document whose title was never set.
 *
 * Same chain as everywhere else (`nodeTitle`), so the heading of an approval
 * list cannot disagree with the title the entries below it are rendered under —
 * those go through `formatNode`, which uses exactly this.
 */
export function registryTitleOf(node: WloNode): string {
  return nodeTitle(node).trim();
}

/**
 * The HTTP status behind a failed listing, read back out of the error text.
 *
 * `getCollectionContents` throws a plain `Error` whose message it composes as
 * `getCollectionContents failed: <status> <statusText>`, and the distinction
 * between "there is no such collection" (404) and "it could not be read right
 * now" (5xx) is one a person's answer depends on. The coupling to that message
 * is deliberate and pinned by `tests/skill-registry.test.ts`, so a change to the
 * wording fails a test instead of silently turning every outage into "not found".
 */
function statusFromError(err: unknown): number {
  return Number(/\b(\d{3})\b/.exec(err instanceof Error ? err.message : String(err))?.[1] ?? 0);
}

/**
 * How much of the file listing was left unread.
 *
 * `null` from a scan means "no registry among the files we saw", which is only
 * the same as "this collection has none" when we saw all of them. The project
 * holds that rule for every other bounded traversal, and a definite answer over
 * a truncated read is exactly what it exists to prevent.
 */
export interface ScanTruncation {
  scanned: number;
  total: number;
}

/** Find the registry record among a collection's file children, or say why not. */
export async function scanForRegistry(
  collectionId: string,
): Promise<{ picked: ReturnType<typeof pickRegistryNode>; reason?: RegistryMiss; truncated?: ScanTruncation }> {
  let listing;
  try {
    // SKILL_PROPS, not the default projection: measured 2026-08-10, `/children`
    // returns `ccm:oeh_extendedType` only when the request asks for it, and
    // without it every candidate looks like ordinary material.
    listing = await getCollectionContents(collectionId, 'files', REGISTRY_SCAN_MAX, 0, SKILL_PROPS);
  } catch (err) {
    const status = statusFromError(err);
    log.warn('skill-registry: the collection could not be listed — reporting no registry', {
      collectionId, status, error: err instanceof Error ? err.message : String(err),
    });
    return { picked: null, reason: status === 404 ? 'collection_not_found' : 'unreadable' };
  }

  const total = listing.pagination?.total ?? listing.nodes.length;
  const truncated: ScanTruncation | undefined =
    total > listing.nodes.length ? { scanned: listing.nodes.length, total } : undefined;

  const picked = pickRegistryNode(listing.nodes);
  if (!picked) {
    if (truncated) {
      log.warn('skill-registry: the file listing was cut short — "no registry" is not a finding of absence', {
        collectionId, ...truncated, cap: REGISTRY_SCAN_MAX,
      });
    }
    return { picked: null, reason: 'no_registry', ...(truncated ? { truncated } : {}) };
  }

  if (picked.candidates > 1) {
    log.info('skill-registry: several ai_prompt documents in one collection — one was chosen', {
      collectionId, candidates: picked.candidates, chosen: picked.node.ref?.id,
    });
  }
  return { picked };
}
