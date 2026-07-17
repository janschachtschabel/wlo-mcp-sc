/**
 * rest/handlers.ts – The public REST layer's endpoint handlers.
 *
 * One `handle<Endpoint>(params)` per `/api/*` route — each a THIN wrapper over
 * `src/services/*` (no business logic of its own), validating query params and
 * returning a `RestResult`. The router in `routes.ts` dispatches to these; they
 * are grouped here so routing plumbing and per-endpoint logic have separate homes.
 */

import {
  searchAll,
  searchFacets,
  searchWithinCollection,
  listCollectionContents,
  type SearchAllOptions,
} from '../services/search.js';
import { getCompendiumTexts } from '../services/compendium.js';
import { buildFilterCriteria } from '../tools/shared.js';
import { resolveTopicPageSwimlanes } from '../services/topic-page.js';
import { getTopicPageContent, type TargetGroup } from '../topic-page-api.js';
import { fetchWikipediaSummary } from '../wikipedia-api.js';
import { WLO_SKILLS_COLLECTION_ID } from '../wlo-api.js';
import type { FormattedNode } from '../formatter.js';
import { listSkills, loadSkillMarkdown } from './skills.js';
import {
  validateQuery,
  validateNodeId,
  validateNodeIds,
  validateFilter,
  validateLang,
  clampInt,
  parseBool,
  parseFields,
} from './validate.js';
import { projectEnvelope, projectItems } from './project.js';
import { type RestResult, badRequest } from './result.js';

const INCLUDE_KEYS = ['content', 'collections', 'topicPages'] as const;
type IncludeKey = (typeof INCLUDE_KEYS)[number];

/** Parse `include=content,collections` → the service's include list (undefined = all). */
function parseInclude(raw: string | null): IncludeKey[] | undefined {
  if (!raw) return undefined;
  const allowed = new Set<string>(INCLUDE_KEYS);
  const parts = raw.split(',').map(s => s.trim()).filter(s => allowed.has(s)) as IncludeKey[];
  return parts.length ? parts : undefined;
}

const TARGET_GROUPS = new Set<string>(['teacher', 'learner', 'general']);

// ── /api/search ──────────────────────────────────────────────────────────────

export async function handleSearch(params: URLSearchParams): Promise<RestResult> {
  const q = validateQuery(params.get('q') ?? params.get('query'));
  if (!q.ok) return badRequest(q.error);

  // Optional field projection to trim the JSON (token saving for generic clients).
  const fields = parseFields(params.get('fields'));
  if (!fields.ok) return badRequest(fields.error);
  const includeFacets = parseBool(params.get('includeFacets'));

  // Vocab filters are length-bounded here; the service resolves label→URI and
  // reports whatever it can't map (unknown values are not an error).
  const filters: Record<string, string | undefined> = {};
  for (const name of ['educationalContext', 'discipline', 'learningResourceType', 'userRole', 'publisher']) {
    const v = validateFilter(params.get(name));
    if (!v.ok) return badRequest(`${name}: ${v.error}`);
    filters[name] = v.value;
  }

  const opts: SearchAllOptions = {
    query: q.value,
    educationalContext: filters['educationalContext'],
    discipline: filters['discipline'],
    learningResourceType: filters['learningResourceType'],
    userRole: filters['userRole'],
    publisher: filters['publisher'],
    maxContent: clampInt(params.get('maxContent'), 1, 25, 8),
    maxCollections: clampInt(params.get('maxCollections'), 1, 25, 5),
    skipCount: clampInt(params.get('skipCount'), 0, 10_000, 0),
    include: parseInclude(params.get('include')),
    includeCompendium: parseBool(params.get('includeCompendium')),
    includeTextContent: parseBool(params.get('includeTextContent')),
    includeWikipedia: parseBool(params.get('includeWikipedia')),
    includeTopicPageContent: parseBool(params.get('includeTopicPageContent')),
    maxPerSwimlane: clampInt(params.get('maxPerSwimlane'), 1, 10, 3),
  };
  // The facet aggregation (opt-in) overlaps the main search — no added wall-clock.
  const [envelope, facets] = await Promise.all([
    searchAll(opts),
    includeFacets ? searchFacets(opts) : Promise.resolve(undefined),
  ]);
  const projected = fields.value ? projectEnvelope(envelope, fields.value) : envelope;

  // Surface vocab filters that did not resolve to a URI (+ "did you mean"
  // suggestions) so a generic REST client gets the same self-correction the MCP
  // tools emit via _queryMeta. Pure re-derivation (no extra upstream call).
  const { unresolved } = buildFilterCriteria(opts);
  const response: Record<string, unknown> = { ...projected };
  if (unresolved.length) response.unresolvedFilters = unresolved;
  if (facets && Object.keys(facets).length) response.facets = facets;
  return { status: 200, json: response };
}

// ── /api/compendium ──────────────────────────────────────────────────────────

export async function handleCompendium(params: URLSearchParams): Promise<RestResult> {
  const idsRaw = params.get('ids');
  const single = params.get('nodeId');
  const list = idsRaw ? idsRaw.split(',') : single ? [single] : [];
  const ids = validateNodeIds(list);
  if (!ids.ok) return badRequest(ids.error);
  return { status: 200, json: { entries: await getCompendiumTexts(ids.value) } };
}

// ── /api/topic-page ──────────────────────────────────────────────────────────

export async function handleTopicPage(params: URLSearchParams): Promise<RestResult> {
  const collectionId = params.get('collectionId')?.trim() || undefined;
  const variantId = params.get('variantId')?.trim() || undefined;
  if (!collectionId && !variantId) {
    return badRequest('collectionId or variantId is required');
  }
  for (const id of [collectionId, variantId]) {
    if (id) {
      const v = validateNodeId(id);
      if (!v.ok) return badRequest(v.error);
    }
  }
  const tgRaw = params.get('targetGroup')?.trim();
  if (tgRaw && !TARGET_GROUPS.has(tgRaw)) {
    return badRequest('targetGroup must be one of: teacher, learner, general');
  }
  const maxPerSwimlane = clampInt(params.get('maxPerSwimlane'), 1, 10, 3);

  const struct = await getTopicPageContent({
    collectionId,
    variantId,
    targetGroup: tgRaw as TargetGroup | undefined,
  });
  if (!struct || struct.swimlanes.length === 0) {
    // A valid-but-empty payload keeps the response shape stable when no variant
    // or an empty config is found (mirrors the get_topic_page_content tool).
    return {
      status: 200,
      json: {
        variantId: struct?.variantId ?? variantId ?? '',
        collectionId: struct?.collectionId ?? collectionId ?? null,
        variantTitle: struct?.variantTitle ?? '',
        // Header fields survive the empty case so the widget can still say
        // WHAT is empty (undefined keys are dropped by JSON serialization).
        collectionTitle: struct?.collectionTitle,
        description: struct?.description,
        topicPageUrl: null,
        swimlaneCount: 0,
        swimlanesTotal: struct?.swimlanes.length ?? 0,
        swimlanes: [],
      },
    };
  }
  return { status: 200, json: await resolveTopicPageSwimlanes(struct, maxPerSwimlane) };
}

// ── /api/wikipedia ───────────────────────────────────────────────────────────

export async function handleWikipedia(params: URLSearchParams): Promise<RestResult> {
  const q = validateQuery(params.get('q') ?? params.get('query'));
  if (!q.ok) return badRequest(q.error);
  const lang = validateLang(params.get('lang'));
  if (!lang.ok) return badRequest(lang.error);
  const sections = clampInt(params.get('sections'), 1, 3, 1) as 1 | 2 | 3;

  const summary = await fetchWikipediaSummary(q.value, lang.value, sections);
  if (!summary) return { status: 404, json: { error: 'No Wikipedia article found' } };
  return { status: 200, json: summary };
}

// ── /api/collection ──────────────────────────────────────────────────────────

/** Compact skill/content item for the collection endpoint. */
function toCollectionItem(n: FormattedNode) {
  return {
    nodeId: n.nodeId,
    title: n.title,
    description: n.description,
    learningResourceTypes: n.learningResourceTypes,
    publisher: n.publisher,
    url: n.url,
    downloadUrl: n.downloadUrl,
  };
}

/**
 * List or search a WLO collection's contents — the launcher's skills source.
 * `nodeId` defaults to `WLO_SKILLS_COLLECTION_ID`. With `q` it searches within
 * the collection (primaryparent-scoped); without `q` it lists the direct file
 * children (reliable for reference collections). Each result carries the
 * anonymous `downloadUrl` for fetching the raw Markdown.
 */
export async function handleCollection(params: URLSearchParams): Promise<RestResult> {
  const nodeIdRaw = params.get('nodeId')?.trim() || WLO_SKILLS_COLLECTION_ID;
  if (!nodeIdRaw) return badRequest('nodeId is required (or set WLO_SKILLS_COLLECTION_ID)');
  const idV = validateNodeId(nodeIdRaw);
  if (!idV.ok) return badRequest(idV.error);
  const nodeId = idV.value;

  const fields = parseFields(params.get('fields'));
  if (!fields.ok) return badRequest(fields.error);

  const max = clampInt(params.get('max'), 1, 50, 20);

  const qTrim = (params.get('q') ?? params.get('query') ?? '').trim();
  if (qTrim.length > 200) return badRequest('q must be at most 200 characters');
  const query = qTrim || undefined;

  // Vocab filters (search case only); length-bounded, unknown values tolerated.
  const filters: Record<string, string | undefined> = {};
  for (const name of ['educationalContext', 'discipline', 'learningResourceType', 'userRole', 'publisher']) {
    const v = validateFilter(params.get(name));
    if (!v.ok) return badRequest(`${name}: ${v.error}`);
    filters[name] = v.value;
  }

  let results: FormattedNode[];
  let total: number;
  if (query) {
    const r = await searchWithinCollection({ nodeId, query, ...filters, maxResults: max });
    results = r.results;
    total = r.pagination.total;
  } else {
    const r = await listCollectionContents(nodeId, max);
    results = r.results;
    total = r.pagination.total;
  }

  const items = results.map(toCollectionItem);
  return {
    status: 200,
    json: {
      collectionId: nodeId,
      query: query ?? null,
      total,
      results: fields.value ? projectItems(items, fields.value) : items,
    },
  };
}

// ── /api/skills ──────────────────────────────────────────────────────────────

/** The skill catalogue: each entry carries an id + the path to fetch its raw text. */
export async function handleSkillsList(): Promise<RestResult> {
  return { status: 200, json: { skills: listSkills() } };
}

/** Raw Markdown of one skill by id (from `/api/skills/<id>`). */
export async function handleSkillRaw(id: string): Promise<RestResult> {
  const md = await loadSkillMarkdown(id);
  if (md == null) return { status: 404, json: { error: 'Skill not found' } };
  return { status: 200, raw: md, contentType: 'text/markdown; charset=utf-8' };
}

/** Prefix of the variable skill-Markdown route (`/api/skills/<id>`). */
export const SKILL_PREFIX = '/api/skills/';
