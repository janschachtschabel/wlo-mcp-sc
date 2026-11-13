/**
 * services/content-search-many.ts – several content searches in ONE call (Z4,
 * chatbot team, 2026-11-13).
 *
 * A learning path costs four to six `search_wlo_content` calls. Measured by the
 * client against staging: five one after another 12.8 s, five at once from the
 * client 6.1 s — and each of those five got slower, because five searches with
 * up to five query variants are about 25 repository requests against a
 * process-wide bound of 24 open calls (`upstream-gate.ts`).
 *
 * So this is not the single search in a loop. It is built for time, and every
 * lever is a deliberate loss against `services/content-search.ts`:
 * - fewer, smaller requests per query (`MANY_VARIANTS_MAX`, `MANY_POOL`);
 * - ONE pool for all requests of the call, well below the gate (`batchCeiling`);
 * - a deadline per query and per call — what is not finished is NAMED;
 * - no refill over further windows, no full text, no skill registry, no total.
 *
 * Two rules it shares with every bundling answer: a filter that does not
 * resolve is never dropped (the query is not searched — a result without the
 * filter reads as the filtered one), and a search that did not answer is a
 * `missing` part, never an empty list.
 *
 * Whether it IS faster has not been measured against a repository.
 */

import { WLO_UPSTREAM_CONCURRENCY } from '../wlo-api.js';
import { enhancedSearchScored } from '../reranker.js';
import { formatNodes, type FormattedNode } from '../formatter.js';
import {
  buildFilterCriteria, filterByExactLicense, resolveLicenseSelection,
} from '../filter-criteria.js';
import { dedupeByUrl, urlIdentity } from '../result-dedupe.js';
import { createLimiter } from '../concurrency.js';
import { cutAtWordBoundary } from '../text-cap.js';
import { currentRequestSignal, isClientGone, runWithRequestSignal } from '../request-scope.js';
import { FIELD_OF } from './content-count.js';
import { failureFields, type FailureCode } from './failure-code.js';

/**
 * Query variants per search. The single search sends up to five; the three
 * heaviest are the full text, the title and — when the query carries request
 * framing ("Arbeitsblatt zu …") — the topic alone, else the keywords. That
 * keeps the one variant measured to rescue a framed query (0 → 480 hits,
 * `query-expand.ts`) and drops the two that add recall at the margin. Eight
 * queries are then at most 24 requests instead of 40.
 */
export const MANY_VARIANTS_MAX = 3;

/**
 * Candidates read per variant (the single search: `WLO_POOL_SIZE`, 25). At most
 * five hits are shown per query, so ten per variant — up to thirty merged —
 * leave room for the URL dedupe and for the refill `distinct` needs, at well
 * under half the payload. Not measured; chosen from the output size.
 */
export const MANY_POOL = 10;

/**
 * The window when a licence is filtered. The repository matches a licence
 * FAMILY, and the surplus is systematic: measured 2026-08-09, the first ten
 * hits for "Optik" + CC BY held not one exact CC BY record
 * (`pageSizeForLicense`). Ten would starve the exactness pass; 25 is the pool
 * the single search reads. It costs payload, not requests.
 */
export const MANY_LICENSE_POOL = 25;

/**
 * How long ONE query may take, counted from its first request leaving the
 * pool. The client's measurement puts an ordinary search at 1.2–2.6 s (6.1 s
 * for five at once, 12.8 s for five in a row); 8 s is three times the slow end,
 * and above the 5 s a request may wait at the upstream gate — so a call the
 * gate turned away arrives as `upstream_busy`, not as our own `timeout`.
 */
export const MANY_QUERY_DEADLINE_MS = 8_000;

/**
 * How long the whole call may take. Just above the 12.8 s the five single
 * calls it replaces took one after another — past that it has stopped being
 * the faster way — and below the 20 s budget of a single repository call.
 */
export const MANY_CALL_DEADLINE_MS = 15_000;

/** Description length in the short form. */
const DESCRIPTION_MAX = 200;

/**
 * How many repository requests of ONE call may be open at once: half the
 * process-wide limit, so a batch cannot crowd everybody else out of the gate —
 * the measured slowdown was exactly that, 25 requests meeting a bound of 24.
 * At least 1: for a gate of 1–3 a floor of 2 was the WHOLE gate, or more than
 * it. A fixed 12 when the gate is switched off (0), which is half its default.
 */
export function batchCeiling(gateLimit: number = WLO_UPSTREAM_CONCURRENCY): number {
  return gateLimit <= 0 ? 12 : Math.max(1, Math.floor(gateLimit / 2));
}

export interface ManyFilters {
  educationalContext?: string;
  discipline?: string;
  userRole?: string;
  learningResourceType?: string;
  publisher?: string;
  license?: string;
}

export interface ManyQuery { id: string; query: string; filters?: ManyFilters }

export interface ManyOptions {
  queries: ManyQuery[];
  /** Filters for every query; a query's own filter of the same name replaces it. */
  shared?: ManyFilters;
  maxResults: number;
  distinct?: boolean;
  /** Tests only: the two deadlines, the filter resolution (to count it), the pool size and the clock. */
  perQueryMs?: number;
  totalMs?: number;
  resolveFilters?: typeof buildFilterCriteria;
  ceiling?: number;
  timers?: Timers;
}

/** The clock the two deadlines run on — injectable, so a test fires a deadline instead of waiting for one. */
export interface Timers {
  set: (fn: () => void, ms: number) => unknown;
  clear: (handle: unknown) => void;
}

const REAL_TIMERS: Timers = {
  set: (fn, ms) => setTimeout(fn, ms),
  clear: handle => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

/**
 * A query's own filters without the empty ones. An empty or blank value is "not
 * given": merged as it stands it REPLACED the shared filter of that name with
 * nothing, and the query was searched unfiltered while the answer read as filtered.
 */
function givenFilters(filters: ManyFilters | undefined): ManyFilters {
  return Object.fromEntries(Object.entries(filters ?? {})
    .filter(([, value]) => typeof value === 'string' && value.trim() !== ''));
}

/** A hit in short form — labels as `formatNode` gives them. */
export interface ShortHit {
  nodeId: string;
  /** Set exactly when `nodeId` names a collection reference (`FormattedNode.originalId`). */
  originalId?: string;
  title: string;
  url: string;
  description: string;
  learningResourceTypes: string[];
  educationalContexts: string[];
  license: string;
}

export interface ManyQueryResult {
  count: number;
  results: ShortHit[];
  /** The ranked window held more, or was not the last one. Never a total. */
  more?: true;
  /** Candidates before and after the exact-licence pass; set when a licence was filtered. */
  licenseFilter?: { checked: number; kept: number };
  /** `distinct`: hits of this query that are shown under another one instead. */
  movedToOtherQueries?: number;
  /** Filters that resolved only by GUESS. */
  fuzzyFilters?: string[];
}

export interface ManyMissing {
  part: string;
  code: FailureCode | 'unresolved_filter';
  message?: string;
  retryAfter?: number;
}

export interface ManyAnswer {
  results: Record<string, ManyQueryResult>;
  missing: ManyMissing[];
  distinctApplied?: true;
}

/**
 * Why this input cannot be searched at all, or `null`. Checked before anything
 * is asked: a duplicate id would make two answers share one key, and the OER
 * bundle is four searches per query (`services/license-search.ts` asks once
 * per licence key) — the multiplication this tool exists to avoid.
 */
export function inputProblem(input: { queries: ManyQuery[]; shared?: ManyFilters }): string | null {
  const ids = new Set<string>();
  for (const q of input.queries) {
    if (ids.has(q.id)) return `Die Kennung „${q.id}“ kommt mehrfach vor — jede Anfrage braucht eine eigene id.`;
    ids.add(q.id);
  }
  const licences = [input.shared?.license, ...input.queries.map(q => q.filters?.license)];
  if (licences.some(l => (resolveLicenseSelection(l)?.length ?? 0) > 1)) {
    return 'license: "OER" fasst mehrere Lizenzen zusammen und kostet eine Suche je Lizenz — hier nicht möglich. '
      + 'Eine einzelne Lizenz angeben (z. B. "CC BY", "CC BY-SA", "CC0") oder search_wlo_content mit license: "OER" nehmen.';
  }
  return null;
}

/** Why a query's work was stopped by one of OUR clocks — not a failure of the repository. */
class DeadlineReached extends Error {
  override name = 'DeadlineReached';
  constructor() { super('the deadline of the batch search was reached'); }
}

type Resolved = ReturnType<typeof buildFilterCriteria>;

/** One query's ranked window, before the cap — what `distinct` chooses from. */
interface Ranked {
  id: string;
  /** Deduplicated, licence-exact, in rank order. */
  hits: FormattedNode[];
  score: Map<string, number>;
  exhausted: boolean;
  licenseFilter?: { checked: number; kept: number };
  fuzzyFilters?: string[];
}

type Outcome = { ranked: Ranked } | { missing: ManyMissing };

interface CallContext {
  limiter: ReturnType<typeof createLimiter>;
  callSignal: AbortSignal;
  requestSignal: AbortSignal | undefined;
  perQueryMs: number;
  timers: Timers;
}

async function searchOne(q: ManyQuery, resolved: Resolved, license: string | undefined, ctx: CallContext): Promise<Outcome> {
  if (resolved.unresolved.length) {
    return { missing: {
      part: q.id,
      code: 'unresolved_filter',
      message: resolved.unresolved.map(u => `${u.field} „${u.value}"${u.suggestions?.length ? ` (meintest du: ${u.suggestions.join(', ')})` : ''}`).join('; '),
    } };
  }

  const own = new AbortController();
  const signal = AbortSignal.any([own.signal, ctx.callSignal, ...(ctx.requestSignal ? [ctx.requestSignal] : [])]);
  // The race below is what ANSWERS at the deadline; the signal is what stops
  // the work (requests in flight are aborted, queued ones are never sent).
  const stopped = new Promise<never>((_, reject) => {
    if (signal.aborted) reject(signal.reason);
    else signal.addEventListener('abort', () => reject(signal.reason), { once: true });
  });
  // Rejects whenever the signal aborts — also long after this query is done.
  stopped.catch(() => {});

  let clock: unknown;
  const schedule = <T>(task: () => Promise<T>): Promise<T> => ctx.limiter(() => {
    // The query's clock starts with its first request: time spent waiting for
    // the shared pool belongs to the call's deadline, not to this query's.
    clock ??= ctx.timers.set(() => own.abort(new DeadlineReached()), ctx.perQueryMs);
    return task();
  }, signal);

  const pool = license ? MANY_LICENSE_POOL : MANY_POOL;
  try {
    // Bound to `signal`, so `wloFetch` aborts this query's requests with it.
    const search = runWithRequestSignal(signal, () => enhancedSearchScored(
      // The whole merged window is asked for — it costs nothing upstream, and
      // it is what a short page and `distinct` are refilled from.
      q.query, 'FILES', resolved.criteria, pool * MANY_VARIANTS_MAX, 0,
      { maxVariants: MANY_VARIANTS_MAX, poolSize: pool, schedule },
    ));
    // Loses the race at a deadline and fails afterwards, with nobody waiting.
    search.catch(() => {});
    const { response, scores } = await Promise.race([search, stopped]);

    // Dedupe and the licence pass BEFORE the cap, as in the single search.
    const candidates = dedupeByUrl(formatNodes(response.nodes));
    const hits = filterByExactLicense(candidates, license);
    const fuzzy = resolved.labeled.filter(l => l.match === 'fuzzy').map(l => FIELD_OF[l.property]).filter(Boolean) as string[];
    return { ranked: {
      id: q.id, hits, score: scores,
      // Read off the WINDOW, never off a total (`content-search.ts`).
      exhausted: response.exhausted === true,
      ...(license ? { licenseFilter: { checked: candidates.length, kept: hits.length } } : {}),
      ...(fuzzy.length ? { fuzzyFilters: fuzzy } : {}),
    } };
  } catch (err) {
    // The caller hung up: nobody reads any part of this answer.
    if (isClientGone(err)) throw err;
    if (err instanceof DeadlineReached) return { missing: { part: q.id, code: 'timeout' } };
    return { missing: { part: q.id, ...failureFields(err) } };
  } finally {
    if (clock !== undefined) ctx.timers.clear(clock);
  }
}

/** The ids under which a hit is ONE material across queries: the record (a reference counts as its original) and its URL. */
function identities(hit: FormattedNode): string[] {
  const url = urlIdentity(hit);
  return [`node:${hit.originalId ?? hit.nodeId}`, ...(url ? [`url:${url}`] : [])];
}

/**
 * `distinct`: every material is shown under ONE query — the one it fits best.
 *
 * "Fits best" is the rerank score the hit was ordered by within its query
 * (0…1, relative to that query's best hit); equal scores go to the better
 * rank, then to the earlier query. Only what would be SHOWN competes: a
 * material at rank 20 of one query must not take it from the top of another
 * and then appear nowhere. So the shown pages are compared, the loser drops
 * the hit and moves up the next of its own window, and that repeats until no
 * material is shown twice. It ends: each round removes a hit from a window.
 */
function makeDistinct(ranked: Ranked[], max: number): Map<string, number> {
  const moved = new Map<string, number>();
  for (;;) {
    const shownAt = new Map<string, Array<{ list: Ranked; order: number; hit: FormattedNode; rank: number }>>();
    ranked.forEach((list, order) => list.hits.slice(0, max).forEach((hit, rank) => {
      for (const key of identities(hit)) shownAt.set(key, [...(shownAt.get(key) ?? []), { list, order, hit, rank }]);
    }));
    const clash = [...shownAt.values()].find(places => new Set(places.map(p => p.order)).size > 1);
    if (!clash) return moved;
    const fit = (p: (typeof clash)[number]) => p.list.score.get(p.hit.nodeId) ?? 0;
    const [winner, ...losers] = [...clash].sort((a, b) => fit(b) - fit(a) || a.rank - b.rank || a.order - b.order);
    for (const loser of losers) {
      if (loser.order === winner!.order) continue;
      loser.list.hits = loser.list.hits.filter(h => h !== loser.hit);
      moved.set(loser.list.id, (moved.get(loser.list.id) ?? 0) + 1);
    }
  }
}

function shortHit(n: FormattedNode): ShortHit {
  const description = n.description.trim();
  return {
    nodeId: n.nodeId,
    ...(n.originalId ? { originalId: n.originalId } : {}),
    title: n.title,
    url: n.url,
    // One line, so a bare ellipsis marks the cut (the block marker of
    // `capText` carries a paragraph break).
    description: description.length > DESCRIPTION_MAX ? `${cutAtWordBoundary(description, DESCRIPTION_MAX)}…` : description,
    learningResourceTypes: n.learningResourceTypes,
    educationalContexts: n.educationalContexts,
    license: n.license,
  };
}

export async function searchContentMany(opts: ManyOptions): Promise<ManyAnswer> {
  const resolve = opts.resolveFilters ?? buildFilterCriteria;
  const shared = opts.shared ?? {};
  // Once for the call: most queries of a learning path differ in the words only.
  const sharedResolved = resolve(shared);

  const call = new AbortController();
  const timers = opts.timers ?? REAL_TIMERS;
  const callClock = timers.set(() => call.abort(new DeadlineReached()), opts.totalMs ?? MANY_CALL_DEADLINE_MS);
  const ctx: CallContext = {
    limiter: createLimiter(opts.ceiling ?? batchCeiling()),
    timers,
    callSignal: call.signal,
    requestSignal: currentRequestSignal(),
    perQueryMs: opts.perQueryMs ?? MANY_QUERY_DEADLINE_MS,
  };

  let outcomes: Outcome[];
  try {
    // All queries start together; the limiter is what bounds the requests.
    outcomes = await Promise.all(opts.queries.map(q => {
      const given = givenFilters(q.filters);
      const own = Object.keys(given).length > 0;
      const filters = own ? { ...shared, ...given } : shared;
      return searchOne(q, own ? resolve(filters) : sharedResolved, filters.license, ctx);
    }));
  } finally {
    timers.clear(callClock);
  }

  const ranked = outcomes.flatMap(o => ('ranked' in o ? [o.ranked] : []));
  const moved = opts.distinct ? makeDistinct(ranked, opts.maxResults) : new Map<string, number>();

  const results = Object.fromEntries(ranked.map(r => {
    const shown = r.hits.slice(0, opts.maxResults);
    const result: ManyQueryResult = {
      count: shown.length,
      results: shown.map(shortHit),
      ...(r.hits.length > shown.length || !r.exhausted ? { more: true as const } : {}),
      ...(r.licenseFilter ? { licenseFilter: r.licenseFilter } : {}),
      ...(moved.get(r.id) ? { movedToOtherQueries: moved.get(r.id)! } : {}),
      ...(r.fuzzyFilters ? { fuzzyFilters: r.fuzzyFilters } : {}),
    };
    return [r.id, result];
  }));
  return {
    results,
    missing: outcomes.flatMap(o => ('missing' in o ? [o.missing] : [])),
    ...(opts.distinct ? { distinctApplied: true as const } : {}),
  };
}
