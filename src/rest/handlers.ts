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
import { buildFilterCriteria, licenseFilterNotice, licensePagingNotice } from '../filter-criteria.js';
import { resolveTopicPageSwimlanes } from '../services/topic-page.js';
import type { TargetGroup } from '../topic-page-api.js';
import { getTopicPageContent } from '../topic-page-structure.js';
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
import { renderSearchPage, type SearchPageData } from './search-page.js';
import { type RestResult, badRequest } from './result.js';

const HTML_TYPE = 'text/html; charset=utf-8';

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
  // `format=html` renders the SAME envelope as a readable page — for AI
  // browsing pipelines that open URLs but only consume reader content (raw
  // JSON is dropped), and for humans clicking a shared link.
  const wantHtml = (params.get('format') ?? '').trim().toLowerCase() === 'html';
  const qRaw = params.get('q') ?? params.get('query');
  const q = validateQuery(qRaw);
  if (!q.ok) {
    // MISSING term (vs. invalid, which stays 400): AI fetch layers strip the
    // query string from model-built URLs, so a bare /api/search is the most
    // common failed call in the wild — and a 400 status is a dead end there
    // (hosts surface the status, not the JSON body). A 200 guidance envelope
    // in the normal response shape reaches the model: the empty `query` echo
    // trips the launcher template's freshness check, and the warnings teach
    // the stripping-proof path form and the paste-back recovery.
    if (!(qRaw ?? '').trim()) {
      const emptyBucket = { total: 0, count: 0, results: [] };
      const guidance = {
        query: '',
        content: emptyBucket,
        collections: emptyBucket,
        topicPages: emptyBucket,
        warnings: [
          'No search term received.',
          'If you built this URL with a query string, your fetch tool has probably stripped it. Use the path form GET /api/search/<term> (optional filters as query parameters), or ask the user to paste the full URL into the chat.',
        ],
      };
      if (wantHtml) return { status: 200, raw: renderSearchPage(guidance), contentType: HTML_TYPE };
      return { status: 200, json: guidance };
    }
    return badRequest(q.error);
  }

  // Optional field projection to trim the JSON (token saving for generic clients).
  const fields = parseFields(params.get('fields'));
  if (!fields.ok) return badRequest(fields.error);
  const includeFacets = parseBool(params.get('includeFacets'));

  // Vocab filters are length-bounded here; the service resolves label→URI and
  // reports whatever it can't map (unknown values are not an error).
  const filters: Record<string, string | undefined> = {};
  for (const name of ['educationalContext', 'discipline', 'learningResourceType', 'userRole', 'publisher', 'license']) {
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
    license: filters['license'],
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
  if (wantHtml) {
    // The JSON view discloses the exactness pass as `content.licenseFilter`;
    // the page has to say it in words, because a licence that removed every
    // candidate is otherwise indistinguishable from "there is nothing here".
    // Counts come from the UNPROJECTED envelope: `fields` may drop
    // `licenseFilter`, and a disclosure that disappears when the response is
    // trimmed is no disclosure.
    // `licenseFilter` exists exactly when a licence was set AND the content leg
    // ran, so it gates BOTH sentences — the paging caveat is about the content
    // search, and `include: collections` must not produce one.
    const lf = envelope.content.licenseFilter;
    const notices = lf
      ? [
          licenseFilterNotice(lf.checked, lf.kept, opts.license),
          licensePagingNotice(opts.license, opts.skipCount ?? 0),
        ].filter(Boolean)
      : [];
    const page = { ...(response as SearchPageData) };
    if (notices.length) page.warnings = [...(page.warnings ?? []), ...notices];
    return { status: 200, raw: renderSearchPage(page), contentType: HTML_TYPE };
  }
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

  const { structure: struct, reason } = await getTopicPageContent({
    collectionId,
    variantId,
    targetGroup: tgRaw as TargetGroup | undefined,
  });
  if (!struct || struct.swimlanes.length === 0) {
    // A valid-but-empty payload keeps the response shape stable when no variant
    // or an empty config is found (mirrors the get_topic_page_content tool),
    // and `reason` names which case it was instead of leaving callers guessing.
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
        reason,
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
 * `nodeId` defaults to `WLO_SKILLS_COLLECTION_ID`. With `q` it matches the
 * query and any filters LOCALLY against the collection's direct file children
 * — not a scoped ngsearch: the backend rejects `virtual:primaryparent_nodeid`
 * as a criterion with 400 (live-probed 2026-07-17). Without `q` it lists those
 * same children. Each result carries the anonymous `downloadUrl` for fetching
 * the raw Markdown.
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

  // Vocab filters; length-bounded, unknown values tolerated.
  const filters: Record<string, string | undefined> = {};
  for (const name of ['educationalContext', 'discipline', 'learningResourceType', 'userRole', 'publisher', 'license']) {
    const v = validateFilter(params.get(name));
    if (!v.ok) return badRequest(`${name}: ${v.error}`);
    filters[name] = v.value;
  }

  let results: FormattedNode[];
  let total: number;
  // Set only when a licence was filtered: `total` is already post-filter, so
  // without these two numbers an emptied result looks like an empty collection.
  let licenseFilter: { checked: number; kept: number } | undefined;
  // Local matching reads ONE bounded page of children, so its answer can be a
  // sample of a larger collection. `total` counts what matched inside that
  // window and cannot say so on its own; the MCP tool carries the same fact as
  // a sentence.
  let sample: { truncated: boolean; collectionTotal: number } | undefined;
  // A filter without `q` used to fall through to the plain listing, which takes
  // no filters at all — `license=OER` then answered with CC BY-NC-ND records and
  // no sign that anything had been ignored. Matching needs no query
  // (`searchWithinCollection` treats an empty one as "all contents"), so the
  // branch is about whether there is anything to match at all. The plain listing
  // keeps the query-less, filter-less case because it pages upstream, while
  // local matching samples at most 100 children in a single call.
  if (query || Object.values(filters).some(Boolean)) {
    const r = await searchWithinCollection({ nodeId, query, ...filters, maxResults: max });
    results = r.results;
    total = r.pagination.total;
    if (filters['license']) licenseFilter = { checked: r.licenseChecked, kept: r.pagination.total };
    sample = { truncated: r.truncated, collectionTotal: r.collectionTotal };
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
      ...(sample ?? {}),
      ...(licenseFilter ? { licenseFilter } : {}),
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
