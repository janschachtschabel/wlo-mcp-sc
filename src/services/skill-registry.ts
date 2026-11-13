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

import { sharedReadScope } from '../auth/credential.js';
import { shortCache } from '../short-cache.js';
import { getNodeMetadata } from '../wlo-api.js';
import type { FormattedNode } from '../formatter.js';
import { formatNode } from '../formatter.js';
import { mapPool } from '../concurrency.js';
import { log } from '../logger.js';
import { SKILL_PROPS } from './skill-catalogue.js';
import { parseSkillReferences } from './skill-references.js';
import {
  layoutContexts, resolveContext,
  type ContextResolution, type RegistryContext, type RegistryGeneral,
} from './registry-contexts.js';
import { readSkillText } from './skills.js';
import { pickRegistryNode, registryTitleOf, scanForRegistry, type ScanTruncation } from './skill-registry-detect.js';

// Finding the registry document among a collection's children lives in
// `skill-registry-detect.ts` (split out 2026-11-13, audit A-5): what COUNTS as a
// registry is one question, what is built from it is another. Re-exported for
// the callers that already import these from here.
export { isMarkdownSkillDoc, pickRegistryNode, type ScanTruncation } from './skill-registry-detect.js';

/**
 * One skill the registry declares. Title and nodeId come out of the `:::` block
 * and cost nothing; description and keywords only when the heads are resolved.
 */
/**
 * How many skills of a collection get a „what is this for" line.
 *
 * One metadata read each, so this number IS the per-answer bill — and it is a
 * cap on the READS, not just on the output: a registry may declare a hundred
 * skills (`REGISTRY_MAX`), and a hundred reads per collection answer is the cost
 * the cheap tier exists to avoid. Three, by the user's decision (2026-08-18);
 * everything past it keeps title and nodeId, which is what the surface carried
 * before.
 */
export const DESCRIBED_MAX = 3;

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
): Promise<{ registry: SkillRegistry | null; reason?: RegistryMiss; scanTruncated?: ScanTruncation; tooLarge?: true }> {
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
): Promise<{ registry: SkillRegistry; reason?: RegistryMiss; tooLarge?: true }> {
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

  // A registry document past the skill bound reads as unreadable — but marked:
  // reading it again cannot answer differently, so the cache must not retry it
  // on every tick (`tooLarge`).
  const { text: markdown, refused } = await readSkillText(registryNodeId);
  // The record exists — saying "no registry here" would be a different and wrong
  // claim, so it comes back named, with the reason attached.
  if (markdown === null) return { registry: base, reason: 'unreadable', ...(refused === 'too_large' ? { tooLarge: true as const } : {}) };

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
/** nodeId → description ('' = read, and it has none). */
const descriptionCache = shortCache<string>(500);

export async function describeEntries(
  entries: readonly RegistryEntry[],
): Promise<{ described: RegistryEntry[]; unreadable: RegistryEntry[] }> {
  // Spread rather than widening the parameter: `readonly` is the promise to the
  // caller that its list is not touched, and `mapPool` takes a mutable one.
  // A description is remembered for a minute (`short-cache.ts`, audit P-4): the
  // same three heads were read again for every answer about a collection. Only
  // a head that was READ is kept — "not readable" is asked again each time.
  // Keyed by whose rights read it: a skill that is not public answers 403 to an
  // anonymous caller, and must not be described to them out of somebody else's read.
  const scope = sharedReadScope();
  const heads = await mapPool([...entries], REGISTRY_POOL, async (e) => {
    const key = `${scope}:${e.nodeId}`;
    const kept = scope ? descriptionCache.get(key) : undefined;
    if (kept !== undefined) return { description: kept };
    const node = await getNodeMetadata(e.nodeId, SKILL_PROPS);
    if (!node) return null;
    const description = formatNode(node).description ?? '';
    if (scope) descriptionCache.set(key, description);
    return { description };
  });
  const described: RegistryEntry[] = [];
  const unreadable: RegistryEntry[] = [];
  entries.forEach((entry, i) => {
    const head = heads[i];
    if (!head) { unreadable.push(entry); return; }
    if (head.description) described.push({ ...entry, description: head.description });
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
 * Four writers produce it: `refreshRegistries`, and in
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
