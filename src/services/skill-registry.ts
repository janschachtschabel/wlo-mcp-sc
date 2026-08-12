/**
 * services/skill-registry.ts – which skills a content collection declares as its
 * own, read from a registry document that lives IN the collection.
 *
 * The editorial process this serves reverses the question `search_skill`
 * answers. Not "which skills exist" but "which skills apply here": a collection
 * carries one `ai_prompt` document — the registry — whose `:::` blocks name the
 * skills approved for it. This module finds that document and turns it into a
 * catalogue.
 *
 * A registry IS a skill record: same content type, same attached Markdown, same
 * `:::` blocks. So almost nothing here is new — `parseSkillReferences` already
 * reads the blocks, and the only genuinely new part is FINDING the document and
 * resolving what it points at.
 *
 * Found through the collection's CHILDREN listing, never through the search
 * index. The index and the node store are separate systems in edu-sharing, and a
 * record can fall out of the former while sitting perfectly in the latter — that
 * happened to a live collection on 2026-08-09. An approval list must not depend
 * on it.
 *
 * Trust boundary: the registry document is uploaded content, exactly like a
 * skill. Its text is data for a model to weigh, never an instruction this server
 * obeys — the tool layer frames it, and renders the server-built catalogue
 * BEFORE the document.
 */

import type { WloNode } from '../wlo-api.js';
import { getCollectionContents, getNodeMetadata } from '../wlo-api.js';
import type { FormattedNode } from '../formatter.js';
import { formatNode } from '../formatter.js';
import { mapPool } from '../concurrency.js';
import { nodeTitle } from '../node-match.js';
import { log } from '../logger.js';
import { REGISTRY_CONTENT_TYPE_URI, SKILL_PROPS } from './skill-catalogue.js';
import { parseSkillReferences } from './skill-references.js';
import { readSkillText } from './skills.js';

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

/** The filename that names a registry outright. */
const REGISTRY_FILENAME = 'skill_registry.md';

/** The phrase that marks a registry through its title, for a file the upload named otherwise. */
const REGISTRY_TITLE_MARK = 'skill registry';

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
 * Both halves matter for a different reason. The filename rule is the one the
 * editorial guide asks for, but it distinguishes nothing today: all 28 skill
 * records on staging are named `SKILL.md` (measured 2026-08-10), because that is
 * what the upload produces. The TITLE is free text an editor sets, so it is the
 * rule that can work before the convention spreads.
 *
 * The title comes from `nodeTitle`, the canonical chain every other consumer
 * uses — NOT from `cclom:title` alone. `cm:title` is in the same projection and
 * is the carrier this repository has measured as the one actually set (109/109
 * production variants). Reading one property made a marked registry invisible,
 * and with a second prompt document present the nodeId tie-break then answered
 * with the wrong document's catalogue.
 */
function isMarked(node: WloNode): boolean {
  const name = (node.properties?.['cm:name']?.[0] ?? '').toLowerCase();
  return name === REGISTRY_FILENAME || nodeTitle(node).toLowerCase().includes(REGISTRY_TITLE_MARK);
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
function registryTitleOf(node: WloNode): string {
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
async function scanForRegistry(
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

/**
 * One skill the registry declares. Title and nodeId come out of the `:::` block
 * and cost nothing; description and keywords only when the heads are resolved.
 */
export interface RegistryEntry {
  nodeId: string;
  title: string;
  description?: string;
  keywords?: string[];
}

export interface SkillRegistry {
  collectionId: string;
  /** The registry record itself. */
  registryNodeId: string;
  registryTitle: string;
  /** The document, unchanged. `null` when the record was found but no text could be read. */
  markdown: string | null;
  /** The declared skills, in document order. */
  entries: RegistryEntry[];
  /** References that name no readable record — stated rather than swallowed. */
  unresolved: { title: string; nodeId: string }[];
  /** Set when more than one candidate could have been the registry. */
  ambiguous?: { candidates: number; chosen: string };
  /** Set when the document declares more skills than one answer carries. */
  truncated?: { listed: number; referenced: number };
}

export type RegistryMiss =
  | 'collection_not_found'
  | 'no_registry'   // the collection exists but holds no ai_prompt Markdown
  | 'unreadable';   // the listing failed, or the registry's own text could not be read

/**
 * Entries the TOOL tier carries — one explicit call about one collection.
 *
 * The cap exists so a document that grew unbounded references cannot turn one
 * call into unbounded reads (this tier fetches one metadata record per skill),
 * and it is DISCLOSED, never silent. Raised from 30 to 100 on 2026-08-11: a
 * curated approval list of sixty is a legitimate thing for an editorial team to
 * declare, and cutting it to thirty made the tool no more informative than the
 * listing that pointed at it.
 *
 * At `REGISTRY_POOL` = 10 that is ten waves; extrapolated from the 2026-08-10
 * measurement of 28 records in 1095 ms, a full hundred lands around 4 s. Paid
 * once, on request, for one collection — not per search.
 */
export const REGISTRY_MAX = 100;

/**
 * Entries the SEARCH tier carries — the catalogue that rides along in a result
 * list, resolving nothing.
 *
 * A different bound because it answers a different question: five collections in
 * one answer, each with its list, is what has to stay readable. Deliberately
 * equal to `REGISTRY_LINES_MAX` in `formatter.ts`, so a search listing is always
 * COMPLETE for what it carries and never shows a sample of its own catalogue.
 * (The two constants cannot be shared: `formatter.ts` is a leaf module and this
 * one imports from it, so the dependency would be a cycle.)
 */
export const REGISTRY_SEARCH_MAX = 30;

/**
 * Skill heads fetched at once.
 *
 * The only stage of this module that CAN be parallel: the children listing and
 * the document read are one call each and strictly ordered — the document's id
 * comes from the listing, and which skills to resolve comes from the document.
 *
 * 10 rather than 5, measured against staging 2026-08-10 over 28 real records
 * (best of two runs each): pool 1 → 9068 ms, 5 → 2083 ms, **10 → 1095 ms**,
 * 20 → 1048 ms, 30 → 870 ms. The knee is here — 10 nearly halves the phase
 * against 5, while 10→20 buys ~4 % and 30 means firing every `REGISTRY_MAX`
 * request at once, which is the shape that trips a rate limit on a busier
 * instance. No request failed at any of these sizes.
 *
 * Only the tool path pays this at all: the search tier (`resolveHeads: false`)
 * takes titles from the `:::` blocks and fetches no head.
 */
const REGISTRY_POOL = 10;

/**
 * The catalogue a collection declares, in one of two tiers.
 *
 * `resolveHeads: false` is the tier the collection search uses: title and nodeId
 * are already IN the `:::` block, so the whole answer costs two requests — the
 * children listing and the document — no matter how many skills are declared.
 * `resolveHeads: true` (the default, for the tool) adds one metadata read per
 * declared skill to fill in description and keywords, which is what a model
 * needs to choose between them.
 *
 * A reference the repository cannot resolve is reported in `unresolved` rather
 * than dropped: a registry that names five skills and lists four reads as an
 * approval list with four entries, which is a different claim.
 */
export async function loadSkillRegistry(
  collectionId: string,
  opts: { resolveHeads?: boolean } = {},
): Promise<{ registry: SkillRegistry | null; reason?: RegistryMiss; scanTruncated?: ScanTruncation }> {
  const { picked, reason, truncated } = await scanForRegistry(collectionId);
  if (!picked) return { registry: null, reason, ...(truncated ? { scanTruncated: truncated } : {}) };
  return buildRegistryFrom(picked, collectionId, opts);
}

/**
 * Turn a picked registry record into its catalogue: read the document, parse the
 * `:::` blocks, optionally resolve each skill's head.
 *
 * Split out from `loadSkillRegistry` because the cache reaches the same record a
 * second way — through the search corpus, where the document is already
 * identified and no children listing is needed. Two ways in, ONE rule for what a
 * registry then means; a second copy would drift on the cap, the ordering, or
 * what counts as unresolved.
 */
export async function buildRegistryFrom(
  picked: NonNullable<ReturnType<typeof pickRegistryNode>>,
  collectionId: string,
  opts: { resolveHeads?: boolean } = {},
): Promise<{ registry: SkillRegistry; reason?: RegistryMiss }> {
  const registryNodeId = picked.node.ref?.id ?? '';
  const base: SkillRegistry = {
    collectionId,
    registryNodeId,
    registryTitle: registryTitleOf(picked.node),
    markdown: null,
    entries: [],
    unresolved: [],
    ...(picked.candidates > 1 ? { ambiguous: { candidates: picked.candidates, chosen: registryNodeId } } : {}),
  };

  const markdown = await readSkillText(registryNodeId);
  // The record exists — saying "no registry here" would be a different and wrong
  // claim, so it comes back named, with the reason attached.
  if (markdown === null) return { registry: base, reason: 'unreadable' };

  const referenced = parseSkillReferences(markdown).filter(r => r.kind === 'ki-skill');
  // The tier decides how many, not just what: `resolveHeads: false` is the
  // listing's cheap pass and carries the narrower bound, everything else is the
  // tool answering about one collection.
  const capped = referenced.slice(0, opts.resolveHeads === false ? REGISTRY_SEARCH_MAX : REGISTRY_MAX);

  // A block with no repository URL names nothing anyone can fetch — neither tier
  // can turn it into a usable entry, so it is reported as unresolved in both.
  const unresolved = capped.filter(r => !r.nodeId).map(r => ({ title: r.title, nodeId: '' }));
  const withId = capped.filter(r => r.nodeId);

  let entries: RegistryEntry[];
  if (opts.resolveHeads === false) {
    entries = withId.map(r => ({ nodeId: r.nodeId, title: r.title }));
  } else {
    const heads = await mapPool(withId, REGISTRY_POOL, r => getNodeMetadata(r.nodeId, SKILL_PROPS));
    entries = [];
    withId.forEach((ref, i) => {
      const node = heads[i];
      if (!node) { unresolved.push({ title: ref.title, nodeId: ref.nodeId }); return; }
      const formatted = formatNode(node);
      entries.push({
        nodeId: ref.nodeId,
        // The record wins over the block: the document is authored and goes
        // stale, while the record is what `get_skill` will actually return.
        title: formatted.title || ref.title,
        description: formatted.description,
        keywords: formatted.keywords,
      });
    });
  }

  if (referenced.length > capped.length) {
    log.info('skill-registry: the registry declares more skills than one answer carries', {
      collectionId, registryNodeId, referenced: referenced.length, listed: capped.length,
    });
  }

  return {
    registry: {
      ...base,
      markdown,
      entries,
      unresolved,
      ...(referenced.length > capped.length
        ? { truncated: { listed: capped.length, referenced: referenced.length } }
        : {}),
    },
  };
}

/**
 * The catalogue in the shape a result node carries it.
 *
 * Four writers produce it: `enrichSkillRegistry` below, and in
 * `services/skill-registry-cache.ts` the live fallback, the background tick and
 * the corpus seed. A copy per writer drifts on exactly the field that is set
 * least often — `truncated`, the disclosure that the catalogue is shorter than
 * the registry declares, which is the one a reader cannot notice missing.
 *
 * The return type is `FormattedNode`'s own field rather than a second
 * declaration of the same shape, so "attaching is assignment" is checked
 * instead of asserted.
 */
export function toRegistrySummary(registry: SkillRegistry): NonNullable<FormattedNode['skillRegistry']> {
  return {
    nodeId: registry.registryNodeId,
    title: registry.registryTitle,
    entries: registry.entries.map(e => ({ nodeId: e.nodeId, title: e.title })),
    ...(registry.truncated ? { truncated: registry.truncated } : {}),
  };
}

/**
 * Attach each collection's skill registry to a list of results.
 *
 * Lives here rather than in `services/search.ts`, where it started: two callers
 * now need it — `searchAll` and the collection search, which does not go through
 * `searchAll` — and "how a registry is attached to a node" is registry knowledge,
 * not search knowledge.
 *
 * Uses the cheap tier, which resolves nothing: `resolveHeads: false` reads the
 * children listing and the document, and takes title and nodeId straight out of
 * the `:::` blocks. Two requests per collection, whatever the registry declares.
 *
 * Opt-in for a measured reason (staging, 2026-08-10): it adds ~1.0–1.4 s to a
 * search, and the cost is the `/children` call, paid whether or not a registry
 * exists. The default path instead points a model at `get_skill_registry` and
 * lets it pay for the ONE collection it is working with.
 *
 * Failures are swallowed per collection on purpose: the registry is an extra,
 * and one unreadable collection must not cost the caller the search they asked
 * for. `mapPool` nulls a thrown entry and `loadSkillRegistry` already degrades
 * rather than throwing, so both paths simply leave the field unset.
 */
export async function enrichSkillRegistry(collections: FormattedNode[]): Promise<void> {
  await mapPool(collections, REGISTRY_POOL, async (n) => {
    const { registry } = await loadSkillRegistry(n.nodeId, { resolveHeads: false });
    if (!registry) return null;
    n.skillRegistry = toRegistrySummary(registry);
    return null;
  });
}
