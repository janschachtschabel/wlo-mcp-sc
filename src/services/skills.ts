/**
 * services/skills.ts – Find WLO "skills" and read their Markdown.
 *
 * A skill is a `ccm:io` whose content type is the `ai_skill` entry of the
 * openeduhub `contentTypes` vocabulary and whose ATTACHED FILE is the SKILL.md.
 * Two steps, deliberately separate (see `tools/skills.ts` for the tool surface):
 * `searchSkills` returns a short catalogue — nodeId, title, description,
 * keywords — and `getSkill` reads one node's Markdown. Nothing downloads a file
 * the caller has not asked for by id.
 *
 * Two search paths, because the repository supports exactly these two:
 *
 *   - repository-wide: one `ngsearch` carrying `ccm:oeh_extendedType`. Measured
 *     2026-08-08 on staging and production — the field is indexed and facetable,
 *     the criterion narrows (110 hits for `organization` against 403 431 total),
 *     multiple values are OR-ed (110 + 42 = 152), and it AND-s with
 *     `ngsearchword`. It takes the FULL vocabulary URI; the bare slug matches
 *     nothing.
 *   - scoped to a skills collection: a bounded walk of its sub-collections.
 *     `virtual:parent_recursive` — which the `page_variant` query accepts — is
 *     refused by `ngsearch` with 400 `DAOValidationException` on both instances
 *     (measured the same day), so a scoped query cannot be expressed at all and
 *     the subtree has to be enumerated.
 *
 * Trust boundary: a skill is uploaded content. The Markdown is data for a model
 * to weigh, never an instruction this server obeys — the tool layer frames it.
 */

import type { WloNode } from '../wlo-api.js';
import { getNodeDownloadText, getNodeMetadata, getNodeTextContent, ngsearch, stripStoreRef } from '../wlo-api.js';
import type { FormattedNode } from '../formatter.js';
import { formatNode } from '../formatter.js';
import { nodeMatchesCriteria, queryTerms, termMatches } from '../node-match.js';
import type { UnresolvedFilter } from '../filter-criteria.js';
import { buildFilterCriteria } from '../filter-criteria.js';
import { SKILL_CONTENT_TYPE_URI, SKILL_PROPS, collectSkillNodes } from './skill-catalogue.js';
import { skillActivationLine } from './skill-activation.js';
import type { SkillFile } from './skill-files.js';
import { readSkillBundle } from './skill-files.js';
import type { SkillReference } from './skill-references.js';
import { parseSkillReferences } from './skill-references.js';

/** What the search returns per hit — enough to choose, not enough to act. */
export interface SkillSummary {
  nodeId: string;
  /**
   * The record this entry stands for: itself for an original, the referenced
   * node for a collection entry (`ccm:original`). THE identity of a skill — the
   * same skill placed in three collections has three nodeIds and one of these.
   * Also the only id a write may target; writes to a reference are discarded.
   */
  originalId: string;
  title: string;
  description: string;
  keywords: string[];
  url: string;
  downloadUrl: string;
}

/** One skill including its instruction Markdown (null when no text could be read). */
export interface SkillDocument extends SkillSummary {
  content: string | null;
  /**
   * The line announcing that this skill is now in effect, or `null` when the
   * record is not marked as a skill (see `skill-activation.ts`). Carried as its
   * own field rather than built by the renderer, so the JSON output and any
   * client rendering it themselves get the same sentence.
   */
  activation: string | null;
  /** The other files of the skill's workspace folder (see `skill-files.ts`). */
  files?: SkillFile[];
  /** Set instead of `files` when the folder is too large to be one skill's bundle. */
  folderFileCount?: number;
  /** What the document itself points at, read from its `:::` blocks. */
  references: SkillReference[];
}

export interface SearchSkillsOptions {
  query?: string;
  maxResults?: number;
  /** Restrict to this collection (the configured skills root, or any other). */
  collectionId?: string;
  /** Follow the collection's sub-collections too (default true). */
  includeSubcollections?: boolean;
  /**
   * Subject / education level the skill is TAGGED with — the alternative to
   * placing it in that collection. `ccm:taxonid` composes with the content type
   * (measured 2026-08-08: 9878 Physik records, 9877 of them also carrying an
   * extendedType), so "welche Skills gehören zu Physik" is answerable without any
   * collection membership. Labels, resolved to URIs by `buildFilterCriteria`.
   */
  discipline?: string;
  educationalContext?: string;
}

/**
 * Hits fetched per repository-wide search, regardless of `maxResults` (which the
 * tool schema caps at 25). The ranking below reads keywords, which the backend's
 * relevance score does not, so it needs a pool to work with — and one page costs
 * the same request.
 */
const SKILL_SEARCH_PAGE = 50;

function toSummary(n: FormattedNode, raw: WloNode): SkillSummary {
  return {
    nodeId: n.nodeId,
    originalId: stripStoreRef(raw.properties?.['ccm:original']?.[0] ?? '') || n.nodeId,
    title: n.title,
    description: n.description,
    keywords: n.keywords,
    url: n.url,
    downloadUrl: n.downloadUrl,
  };
}

/**
 * One entry per skill, whatever it is placed in.
 *
 * A skill that sits in the catalogue AND in a subject collection comes back
 * twice — once as the original, once as a reference with a different nodeId —
 * and two rows with two ids read as two skills. The ORIGINAL wins when both are
 * present: it is the id a write may target, and its companion files resolve
 * without the extra hop through `ccm:original`.
 *
 * Insertion order is preserved (replacing a Map value keeps its position), so
 * the ranking below is unaffected.
 */
function dedupeByOriginal(skills: SkillSummary[]): SkillSummary[] {
  const byOriginal = new Map<string, SkillSummary>();
  for (const skill of skills) {
    const seen = byOriginal.get(skill.originalId);
    const seenIsReference = !!seen && seen.nodeId !== seen.originalId;
    if (!seen || (seenIsReference && skill.nodeId === skill.originalId)) byOriginal.set(skill.originalId, skill);
  }
  return [...byOriginal.values()];
}

/**
 * How well a skill answers the task. Title before keywords before description:
 * a skill's title names what it does, its keywords name when to reach for it,
 * and its description elaborates — so a term found in the title is worth more
 * than the same term buried in prose.
 *
 * `queryTerms`/`termMatches` are the shared matcher: they drop German stopwords
 * (which sit INSIDE ordinary words — "Stu-die-n") and require a short term to
 * hit a word start. A local tokenizer here would be a second, drifting copy.
 */
function scoreSkill(s: SkillSummary, terms: string[]): number {
  const title = s.title.toLowerCase();
  const keywords = s.keywords.join(' ').toLowerCase();
  const description = s.description.toLowerCase();
  return terms.reduce((sum, t) =>
    sum + (termMatches(t, title) ? 3 : 0)
        + (termMatches(t, keywords) ? 2 : 0)
        + (termMatches(t, description) ? 1 : 0), 0);
}

/**
 * Rank by relevance, keeping the upstream order among equal scores (sort is
 * stable): with no query every skill scores 0 and the catalogue is returned as
 * the repository ordered it.
 */
function rankSkills(skills: SkillSummary[], query: string | undefined): SkillSummary[] {
  const terms = queryTerms(query ?? '');
  if (!terms.length) return skills;
  return [...skills].sort((a, b) => scoreSkill(b, terms) - scoreSkill(a, terms));
}

/**
 * Search the skill catalogue, reporting the vocab filters that did not resolve.
 *
 * They are reported rather than swallowed because an unresolved filter is
 * DROPPED from the query: the caller gets a wider result set than they asked
 * for, and nothing says so.
 */
export async function searchSkillsDetailed(
  opts: SearchSkillsOptions,
): Promise<{ skills: SkillSummary[]; unresolved: UnresolvedFilter[] }> {
  const query = (opts.query ?? '').trim();
  const maxResults = opts.maxResults ?? 10;
  const collectionId = (opts.collectionId ?? '').trim();
  const { criteria: filters, unresolved } = buildFilterCriteria(opts);

  // More hits than asked for: the ranking below decides the order, and it reads
  // keywords, which the backend's relevance score does not. A pool of one page
  // costs the same request and gives that ranking something to work with.
  const found = collectionId
    ? await collectSkillNodes(collectionId, opts.includeSubcollections !== false)
    : (await ngsearch(
        [
          { property: 'ngsearchword', values: [query || '*'] },
          { property: 'ccm:oeh_extendedType', values: [SKILL_CONTENT_TYPE_URI] },
          ...filters,
        ],
        'FILES',
        SKILL_SEARCH_PAGE,
        0,
        SKILL_PROPS,
      )).nodes;

  // The collection path cannot send criteria — `/children` takes none — so the
  // same resolved URIs are matched against the listing here. Both fields are in
  // SKILL_PROPS, so the projection carries them.
  const nodes = collectionId && filters.length
    ? found.filter(n => nodeMatchesCriteria(n, filters))
    : found;

  const summaries = nodes.map(n => toSummary(formatNode(n), n));
  return { skills: rankSkills(dedupeByOriginal(summaries), query).slice(0, maxResults), unresolved };
}

/** The skills alone — for callers that do not surface the filter diagnostics. */
export async function searchSkills(opts: SearchSkillsOptions): Promise<SkillSummary[]> {
  return (await searchSkillsDetailed(opts)).skills;
}

/**
 * The instruction text of a skill: the attached file verbatim
 * (`eduservlet/download`), falling back to the repository's EXTRACTED
 * `/textContent` for a node whose binary is not anonymously downloadable. `null`
 * when neither source answers.
 *
 * Exported because a skill REGISTRY is a skill record and its document is read
 * the same way (`skill-registry.ts`). Two copies of this fallback would be two
 * places for the anonymous-download rule to drift.
 *
 * A REFERENCE id works here exactly like its original — measured 2026-08-08 on
 * staging: the same 3466 bytes, status 200, from both ids. So this deliberately
 * does NOT resolve `ccm:original` first; `readSkillBundle` has to, because the
 * folder hangs off the original, and the text does not.
 */
export async function readSkillText(nodeId: string): Promise<string | null> {
  // UNBOUNDED, and that is the user's decision (2026-08-20), not an oversight:
  // an instruction must arrive whole — a model follows the half it got, and
  // the cut half is where the guardrails tend to live. The ordinary anonymous
  // download keeps its 64-KiB cap for every other file; a first fix raised
  // this path to 1 MiB and was replaced the same day, because any bound is a
  // size at which a skill silently stops being followed. The residual risk is
  // deliberate and rests on what this path reads: curated records from the
  // operator's own repository, not caller-supplied URLs. The /textContent
  // fallback below carries no cap of its own.
  return (await getNodeDownloadText(nodeId, Number.POSITIVE_INFINITY)) ?? (await getNodeTextContent(nodeId));
}

/**
 * One skill by nodeId, including its instruction Markdown. `null` means the node
 * itself could not be read — a skill whose TEXT is missing still comes back,
 * with `content: null`, because its metadata already answers "does this exist".
 *
 * The content type is NOT re-checked here: `search_skill` has already applied
 * it, and a repository where the field is not yet maintained would otherwise
 * answer "no such skill" for a record that is plainly there.
 */
export async function getSkill(
  nodeId: string,
  opts: { includeFiles?: boolean } = {},
): Promise<SkillDocument | null> {
  const node = await getNodeMetadata(nodeId, SKILL_PROPS);
  if (!node) return null;
  // The text and the folder listing are independent reads of the same record.
  const [content, bundle] = await Promise.all([
    readSkillText(nodeId),
    opts.includeFiles === false ? Promise.resolve(null) : readSkillBundle(node, nodeId),
  ]);
  const summary = toSummary(formatNode(node), node);
  return {
    ...summary,
    content,
    activation: skillActivationLine(summary.title, node.properties?.['ccm:oeh_extendedType'] ?? []),
    references: parseSkillReferences(content ?? ''),
    ...(bundle
      ? { files: bundle.files, ...(bundle.folderFileCount ? { folderFileCount: bundle.folderFileCount } : {}) }
      : {}),
  };
}

/**
 * The one-tool variant: search, rank, and return the best match WITH its
 * Markdown, plus the runners-up so a wrong pick stays visible to the caller.
 *
 * Goes through `getSkill` rather than fetching the text itself, so the companion
 * files come with it — listed by name, which is what makes them reachable at all.
 * The original reason was stronger and has expired: until 2026-08-16 this mode
 * registered no tool taking a nodeId, so an unlisted companion was invisible and
 * unreachable at once. `get_skill` is registered in every mode now, so the point
 * is discoverability rather than reachability. Costs one metadata read.
 */
export async function pickBestSkill(
  opts: SearchSkillsOptions,
): Promise<{ skill: SkillDocument; alternatives: SkillSummary[] } | null> {
  const ranked = await searchSkills({ ...opts, maxResults: opts.maxResults ?? 5 });
  const best = ranked[0];
  if (!best) return null;
  const skill = await getSkill(best.nodeId);
  // The record was listed a moment ago; if it cannot be read now, the summary
  // still answers what was found — only the instructions are missing. Nothing
  // took effect, so nothing is announced either.
  return {
    skill: skill ?? { ...best, content: null, activation: null, references: [] },
    alternatives: ranked.slice(1),
  };
}
