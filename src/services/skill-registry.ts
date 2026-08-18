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
import {
  layoutContexts, resolveContext,
  type ContextResolution, type RegistryContext, type RegistryGeneral,
} from './registry-contexts.js';
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
  /**
   * The context this skill was declared under (`RegistryContext.path`), absent
   * when it belongs to none — then it sits in `general` and applies always.
   */
  context?: string;
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
  /**
   * The named groups the document's headings declare, in document order. Empty
   * for a flat document — which is every registry written before 2026-08-18, so
   * an empty list has to keep behaving exactly as it did.
   */
  contexts: RegistryContext[];
  /** Skills and prose that belong to no context and therefore apply always. */
  general: RegistryGeneral;
  /** Set when the document outlines more contexts than this answer lists. */
  contextsTruncated?: { listed: number; found: number };
  /** Set when more than one candidate could have been the registry. */
  ambiguous?: { candidates: number; chosen: string };
  /** Set when the document declares more skills than one answer carries. */
  truncated?: { listed: number; referenced: number };
}

export { REGISTRY_CONTEXT_MAX } from './registry-contexts.js';
export { resolveContext };
export type { ContextResolution, RegistryContext, RegistryGeneral } from './registry-contexts.js';

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
 * **Was 30, is `REGISTRY_MAX` since 2026-08-15** (the user's decision): a
 * collection answer hands over the approval list in full, and the rest only on
 * request. The old number rested on readability — five collections in one
 * answer, each with its list — but it made the two tiers disagree about what
 * "the approved skills" are, and the entry a model needs may be the 31st. It
 * costs no extra request either way: this tier takes title and nodeId out of
 * the `:::` blocks, so the whole answer is two calls whatever the number.
 *
 * Written as the other constant rather than repeating 100, because a SENTENCE
 * hangs on the two being equal (see `registryLines` in `formatter.ts`: while
 * this tier was the narrower one, a capped listing could point at
 * `get_skill_registry` for more entries, and now it cannot). It stays a separate
 * name because `formatter.ts` pins its own bound against THIS one, and the two
 * may legitimately diverge again — at which point the sentence has to move back.
 */
export const REGISTRY_SEARCH_MAX = REGISTRY_MAX;

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
    contexts: [],
    general: { skills: [] },
    ...(picked.candidates > 1 ? { ambiguous: { candidates: picked.candidates, chosen: registryNodeId } } : {}),
  };

  const markdown = await readSkillText(registryNodeId);
  // The record exists — saying "no registry here" would be a different and wrong
  // claim, so it comes back named, with the reason attached.
  if (markdown === null) return { registry: base, reason: 'unreadable' };

  const blocks = parseSkillReferences(markdown);
  const referenced = blocks.filter(r => r.kind === 'ki-skill');
  // The tier decides how many, not just what: `resolveHeads: false` is the
  // listing's cheap pass and carries the narrower bound, everything else is the
  // tool answering about one collection.
  const capped = referenced.slice(0, opts.resolveHeads === false ? REGISTRY_SEARCH_MAX : REGISTRY_MAX);

  // A block with no repository URL names nothing anyone can fetch — neither tier
  // can turn it into a usable entry, so it is reported as unresolved in both.
  const unresolved = capped.filter(r => !r.nodeId).map(r => ({ title: r.title, nodeId: '' }));
  const withId = capped.filter(r => r.nodeId);

  // The outline costs nothing: the document is already in hand, and both tiers
  // get the same contexts — the `:::` block carries the offset, the headings
  // carry the grouping, and neither needs a request.
  // Boundaries come from EVERY block, entries only from the capped skills: a
  // `::: wlo-material` block is no catalogue entry but it does end an
  // instruction, and so does a skill past the cap.
  const layout = layoutContexts(markdown, capped, blocks.map(r => r.offset));
  const contextOf = new Map(capped.map((r, i) => [r, layout.paths[i]]));

  let entries: RegistryEntry[];
  if (opts.resolveHeads === false) {
    entries = withId.map(r => ({
      nodeId: r.nodeId,
      title: r.title,
      ...(contextOf.get(r) ? { context: contextOf.get(r)! } : {}),
    }));
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
        // The CONTEXT is the document's word, not the record's — it says where
        // the editors filed the skill, which no metadata field carries.
        ...(contextOf.get(ref) ? { context: contextOf.get(ref)! } : {}),
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
      contexts: layout.contexts,
      general: layout.general,
      ...(layout.truncated ? { contextsTruncated: layout.truncated } : {}),
      ...(referenced.length > capped.length
        ? { truncated: { listed: capped.length, referenced: referenced.length } }
        : {}),
    },
  };
}

/**
 * A registry as ONE call reports it: everything, or one context of it.
 *
 * Lives here rather than in the tool that first needed it, because two surfaces
 * narrow the same way and must not drift on what "narrowed" means — which
 * entries come along (the context's own PLUS the ones that apply always) and
 * which slice of the document does. `get_skill_registry` renders it as a full
 * answer, `subjectRegistryText` as a block inside a collection answer; the
 * prose differs, the rule may not.
 *
 * A miss is not handled here at all: it comes back as the `resolution`, and each
 * caller falls back to the full answer in its own words. The rule that both
 * hold is that a miss NEVER narrows — never a shorter answer for a name that did
 * not land.
 */
export interface NarrowedRegistry {
  view: SkillRegistry;
  resolution: ContextResolution;
}

export function narrowRegistry(registry: SkillRegistry, wanted: string | undefined): NarrowedRegistry {
  const resolution = resolveContext(registry.contexts, (wanted ?? '').trim());
  if (resolution.kind !== 'found') return { view: registry, resolution };

  const ctx = resolution.context;
  const own = registry.entries.filter(e => e.context === ctx.path);
  const always = registry.entries.filter(e => !e.context);
  // Verbatim, but only what applies: the general preamble, the parent's
  // instruction (it governs a sub-context too), and this section's slice.
  const excerpt = [
    registry.general.instruction ?? '',
    resolution.parent?.instruction ?? '',
    (registry.markdown ?? '').slice(ctx.range.start, ctx.range.end),
  ].map(part => part.trim()).filter(Boolean).join('\n\n');

  return { view: { ...registry, entries: [...own, ...always], markdown: excerpt }, resolution };
}

/**
 * Fill in the description of entries a caller has already narrowed down to what
 * it will show. One metadata read per entry, bounded by the same pool the
 * expensive tier uses.
 *
 * Not `loadSkillRegistry({resolveHeads: true})`, and the difference is the bill:
 * that resolves EVERY declared skill (up to `REGISTRY_MAX`), while a narrowed
 * collection answer shows one context's skills plus the always-valid ones. On a
 * registry declaring a hundred, resolving first and narrowing after pays for
 * ninety-odd records nobody will read.
 *
 * Keywords are deliberately not filled in (the user's decision, 2026-08-18):
 * they are the longest field by far — measured at ~175 characters per skill
 * against ~170 for the description — and the description is what answers "is
 * this the skill I want".
 *
 * An entry whose record could not be read comes back under `unreadable` rather
 * than silently among the rest. The caller paid for that head, so it KNOWS —
 * and a catalogue that still says „laden mit get_skill“ beside it promises a
 * call that will answer „nicht abrufbar“. It stays listed either way: the cheap
 * tier lists it too, and dropping it would make the same collection answer
 * shorter for having looked closer.
 */
export async function describeEntries(
  entries: readonly RegistryEntry[],
): Promise<{ described: RegistryEntry[]; unreadable: RegistryEntry[] }> {
  // Spread rather than widening the parameter: `readonly` is the promise to the
  // caller that its list is not touched, and `mapPool` takes a mutable one.
  const heads = await mapPool([...entries], REGISTRY_POOL, e => getNodeMetadata(e.nodeId, SKILL_PROPS));
  const described: RegistryEntry[] = [];
  const unreadable: RegistryEntry[] = [];
  entries.forEach((entry, i) => {
    const node = heads[i];
    if (!node) { unreadable.push(entry); return; }
    const description = formatNode(node).description;
    if (description) described.push({ ...entry, description });
  });
  return { described, unreadable };
}

/** One instruction and the level it governs. */
export interface ContextInstruction {
  /** `general` applies everywhere; `parent` is the H2 above an H3. */
  scope: 'general' | 'parent' | 'context';
  /** The heading it was written under — absent for `general`, which has none. */
  title?: string;
  text: string;
}

/**
 * The instructions that govern a matched context, in the order they apply:
 * the general part first, then the parent's, then the context's own.
 *
 * Each carries its SCOPE, and a caller that renders them must keep them apart.
 * Joined into one paragraph — which is what this returned before 2026-08-18 —
 * a reader cannot tell where the general part ends and the context's own
 * begins, and the editors wrote them as separate sections precisely because
 * they mean different things.
 *
 * Structured fields rather than the document slice — a caller that only wants
 * "what am I supposed to do here" has no use for the `:::` blocks and the
 * per-skill prose that sit in the same section.
 */
export function contextInstructions(
  registry: SkillRegistry, resolution: ContextResolution,
): ContextInstruction[] {
  if (resolution.kind !== 'found') return [];
  const parts: ContextInstruction[] = [];
  if (registry.general.instruction) {
    parts.push({ scope: 'general', text: registry.general.instruction });
  }
  if (resolution.parent?.instruction) {
    parts.push({ scope: 'parent', title: resolution.parent.title, text: resolution.parent.instruction });
  }
  if (resolution.context.instruction) {
    parts.push({ scope: 'context', title: resolution.context.title, text: resolution.context.instruction });
  }
  return parts;
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
    entries: registry.entries.map(e => ({
      nodeId: e.nodeId,
      title: e.title,
      ...(e.context ? { context: e.context } : {}),
    })),
    // Names and counts, never the instruction — see the field's own comment.
    ...(registry.contexts.length
      ? { contexts: registry.contexts.map(c => ({ path: c.path, skills: c.skills.length })) }
      : {}),
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
