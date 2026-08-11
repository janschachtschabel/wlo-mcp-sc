/**
 * services/skill-registry-cache.ts – a memo of the authoritative registry
 * lookup, kept warm in the background so a collection result costs nothing.
 *
 * The problem it solves: the live lookup reads a collection's children listing,
 * which is measured at ~1.0–1.4 s per collection (2026-08-10) and is paid
 * whether or not a registry is there. That is why the enrichment was off by
 * default — five collections in one search meant five to seven seconds.
 *
 * The rule that shapes everything here: **what the cache remembers comes from
 * `loadSkillRegistry`**, the same children listing the live path reads.
 * `CLAUDE.md` forbids resting an approval list on the search index — a record
 * can fall out of the index while sitting perfectly in the node store, which a
 * live collection did on 2026-08-09. The index is used exactly once, as a
 * starting shot that says WHERE looking is worth it; what counts is always the
 * listing's answer.
 *
 * That is also the reason a remembered "there is no registry here" may stand as
 * an answer rather than a gap: it rests on a listing that replied.
 *
 * A lookup has THREE outcomes, and each is remembered differently. It answered →
 * the entry stands. It FAILED → nothing is remembered and the collection is
 * queued again, because an outage must not become a statement. Or the file
 * listing was CUT SHORT at the scan cap → the entry is kept, so the same first
 * page is not read again and again, but it settles nothing: 50 of 400 files
 * read means "none among those", not "none here".
 *
 * Why a queue rather than a pre-built index of every collection: measured
 * 2026-08-11, the collection tree is 35 collections at level 1, 331 at level 2
 * and ~1335 at level 3 — a full walk is ~1700 collections and ~3400 requests per
 * cycle, roughly 11 requests per second sustained on a five-minute schedule
 * against a shared instance. The queue is bounded by what callers actually ask
 * for instead: a search returns five collections, and the second time they cost
 * nothing.
 */

import type { WloNode } from '../wlo-api.js';
import type { FormattedNode } from '../formatter.js';
import { ngsearch } from '../wlo-search.js';
import { mapPool } from '../concurrency.js';
import { log } from '../logger.js';
import {
  WLO_SKILL_CACHE,
  WLO_SKILL_CACHE_REFRESH_MS,
  WLO_SKILL_CACHE_TTL_MS,
} from '../wlo-config.js';
import { SKILL_CONTENT_TYPE_URI, SKILL_PROPS } from './skill-catalogue.js';
import {
  buildRegistryFrom,
  isMarkdownSkillDoc,
  loadSkillRegistry,
  pickRegistryNode,
  toRegistrySummary,
  type ScanTruncation,
} from './skill-registry.js';

/**
 * Collections waiting to be resolved.
 *
 * Capped because it is fed from result lists — without a bound a caller could
 * push arbitrary node ids into memory. The cap WARNS rather than silently
 * dropping: collections left unchecked with nothing to see is the failure mode
 * this project rejects everywhere else.
 */
const QUEUE_MAX = 500;

/**
 * Collections one tick resolves.
 *
 * Without a ceiling a single interval turns into a crawl of whatever piled up
 * since the last one. At `CACHE_POOL` concurrency this is ~7 s of background
 * work in the worst case; the remainder waits for the next tick and is reported.
 */
const TICK_BATCH_MAX = 50;

/**
 * Listings fetched at once.
 *
 * The same value as the live path's `REGISTRY_POOL`, and for the same measured
 * reason (2026-08-10, 28 real records): 5 → 2083 ms, **10 → 1095 ms**,
 * 20 → 1048 ms. Ten is the knee; beyond it the gain is ~4 % while the burst is
 * what trips a rate limit on a busier instance.
 */
const CACHE_POOL = 10;

/** One collection's answer, as the children listing gave it. */
export interface CacheEntry {
  /**
   * `null` is a real answer — "looked, none there" — not a missing value.
   * Unless `scanTruncated` is set; see there.
   */
  registry: CachedRegistry | null;
  /** When the listing replied, for the TTL. */
  checkedAt: number;
  /**
   * Set when the file listing was cut short at the scan cap. `registry: null`
   * then means "not among the files we saw", which is a WEAKER claim than "this
   * collection has none" — a registry sitting past the cap is invisible to the
   * scan. Held so the same capped page is not re-read on every tick and every
   * request, but it does not settle the question: `attachCachedRegistries` does
   * not count it, so the caller keeps its pointer line.
   */
  scanTruncated?: ScanTruncation;
}

/** The shape a result node carries — the field itself, not a copy of its declaration. */
export type CachedRegistry = NonNullable<FormattedNode['skillRegistry']>;

/**
 * Answers held at once.
 *
 * Above the ~1700 collections this repository holds (measured 2026-08-11), so it
 * does not bite in practice — it is the bound that keeps "the queue is not a
 * memory lever" true even for a caller that one day feeds ids from somewhere
 * other than a repository response. The oldest ANSWER goes, not the oldest
 * insertion: `Map.set` on an existing key leaves its position alone, so
 * insertion order stops tracking recency after the first refresh.
 */
export const CACHE_MAX_ENTRIES = 2000;

const entries = new Map<string, CacheEntry>();
const queue = new Set<string>();

/** How many answers are held. Exported for tests and the cap's own log line. */
export function cacheSize(): number {
  return entries.size;
}

/**
 * The one place an answer is written.
 *
 * Three paths produce one — the live fallback, the background tick and the
 * corpus seed — and each of them has to hold the same cap and the same
 * bookkeeping. A copy per path is how a bound comes to apply to two of three
 * writers.
 */
function remember(collectionId: string, entry: CacheEntry): void {
  if (!entries.has(collectionId) && entries.size >= CACHE_MAX_ENTRIES) evictOldest();
  entries.set(collectionId, entry);
  queue.delete(collectionId);
}

/**
 * Drop the answer checked longest ago, and say so. A cap nobody can see reads
 * as a complete memory that quietly forgets.
 */
function evictOldest(): void {
  let oldestId: string | undefined;
  let oldestAt = Infinity;
  for (const [id, entry] of entries) {
    if (entry.checkedAt < oldestAt) { oldestAt = entry.checkedAt; oldestId = id; }
  }
  if (!oldestId) return;
  entries.delete(oldestId);
  log.warn('skill-registry-cache: at capacity — the oldest answer was dropped', {
    dropped: oldestId, max: CACHE_MAX_ENTRIES,
  });
}

/**
 * Lookups running right now, so two callers wanting the same cold collection
 * share one children listing.
 *
 * Without it a burst right after startup pays for first contact once per
 * request: the second caller reads the cache before the first has anything to
 * write into it. `mapPool` catches per item, so a shared rejection is handled
 * once per caller and nothing escapes.
 */
const inFlight = new Map<string, Promise<RegistryLookup>>();

type RegistryLookup = Awaited<ReturnType<typeof loadSkillRegistry>>;

function lookupOnce(collectionId: string): Promise<RegistryLookup> {
  const running = inFlight.get(collectionId);
  if (running) return running;
  const pending = loadSkillRegistry(collectionId, { resolveHeads: false });
  inFlight.set(collectionId, pending);
  // `then(done, done)` rather than `finally`, which would leave the rejection of
  // its own derived promise unhandled.
  const done = () => { if (inFlight.get(collectionId) === pending) inFlight.delete(collectionId); };
  void pending.then(done, done);
  return pending;
}

/**
 * What a finished lookup means for the cache, or `null` when it means nothing.
 *
 * Two kinds of non-answer, remembered differently. A lookup that THREW (nulled
 * by `mapPool`) or reported `unreadable` learned nothing at all — the entry
 * stays absent and the collection is queued again, because an outage must never
 * become "this collection has no approved skills". A scan cut short at the file
 * cap DID reply: re-reading the same first page cannot produce a different
 * answer, so it is remembered — but marked, so it settles nothing.
 */
function entryFrom(result: RegistryLookup | null, checkedAt: number): CacheEntry | null {
  if (!result || result.reason === 'unreadable') return null;
  return {
    registry: result.registry ? toRegistrySummary(result.registry) : null,
    checkedAt,
    ...(result.scanTruncated ? { scanTruncated: result.scanTruncated } : {}),
  };
}

/**
 * What the cache knows about a collection.
 *
 * `undefined` means NEVER CHECKED and is not the same claim as an entry with
 * `registry: null`. Every caller depends on telling those apart — one leaves the
 * question open, the other answers it.
 */
export function lookupCachedRegistry(collectionId: string): CacheEntry | undefined {
  return entries.get(collectionId);
}

/**
 * Mark collections for background resolution. Idempotent, synchronous, never
 * throws — it sits in the request path and must cost nothing.
 *
 * Already-answered collections are skipped; re-checking them is the TTL's job,
 * not the caller's.
 */
export function queueCollections(collectionIds: string[]): void {
  let dropped = 0;
  for (const raw of collectionIds) {
    const id = raw?.trim();
    if (!id || entries.has(id) || queue.has(id)) continue;
    if (queue.size >= QUEUE_MAX) { dropped++; continue; }
    queue.add(id);
  }
  if (dropped) {
    log.warn('skill-registry-cache: queue full — collections stay unchecked for now', {
      dropped, queueMax: QUEUE_MAX,
    });
  }
}

/** How many collections are waiting. Exported for tests and the tick report. */
export function queueLength(): number {
  return queue.size;
}

/**
 * Attach the catalogue the cache already knows, and queue what it does not.
 *
 * Synchronous and free — it sits in the request path. A cold collection costs
 * the caller nothing but the answer it would have had anyway; the next call for
 * the same collection gets it.
 *
 * @returns how many of `nodes` the cache could answer AUTHORITATIVELY, whether
 *   or not a registry was found — a remembered scan that was cut short at the
 *   file cap does NOT count. The caller turns that into `registryChecked`:
 *   a collection with no registry carries no field, so the nodes alone cannot
 *   tell "not looked up" from "looked up, none there".
 */
export function attachCachedRegistries(nodes: FormattedNode[]): number {
  let answered = 0;
  const cold: string[] = [];
  for (const node of nodes) {
    if (node.nodeType !== 'collection') continue;
    // A registry already on the node came from the live path, which read the
    // listing just now; this entry may be minutes old. Fresher wins.
    if (node.skillRegistry) { answered++; continue; }
    const entry = entries.get(node.nodeId);
    if (!entry) { cold.push(node.nodeId); continue; }
    if (entry.registry) { node.skillRegistry = entry.registry; answered++; continue; }
    // Held so the capped page is not read again, but it answered nothing: a
    // registry past the scan cap is invisible to it. Counting it would print
    // "geprüft" over a look that saw 50 of 400 files.
    if (entry.scanTruncated) continue;
    answered++;
  }
  if (cold.length) queueCollections(cold);
  return answered;
}

/**
 * Live lookups one request may make.
 *
 * A collection listing can return 50 collections, and firing 50 children calls
 * on one request is the crawl this design exists to avoid. Ten matches the pool,
 * so the bounded set resolves in roughly ONE round-trip of wall clock; the rest
 * is queued for the background and reported as unanswered, which keeps the
 * caller's "not checked" line honest instead of implying a look that never
 * happened.
 */
const LIVE_FALLBACK_MAX = 10;

/**
 * Attach every collection's catalogue, falling back to a live lookup for what
 * the cache does not know — and remember what that lookup found.
 *
 * This is the shape the answer is supposed to have: the catalogue is THERE,
 * from memory when possible and from the children listing when not. First
 * contact with a set of cold collections costs one round-trip (~1.0–1.4 s,
 * measured 2026-08-10 — the lookups run pooled, so it is per REQUEST, not per
 * collection); everything after that is free until the entry expires.
 *
 * A lookup that did not answer leaves nothing behind and is queued again — the
 * same asymmetry the background tick holds, and for the same reason: an outage
 * must not become "this collection has no approved skills". A scan cut short at
 * the file cap is kept but does not count (see `CacheEntry.scanTruncated`).
 *
 * `WLO_SKILL_CACHE=off` short-circuits this to 0: the operator's switch covers
 * the request path as well as the background timer.
 *
 * @returns how many of `nodes` are now answered authoritatively. Anything short
 *   of the collection count means the caller keeps its pointer line.
 */
export async function ensureRegistries(nodes: FormattedNode[]): Promise<number> {
  // The operator's switch covers the REQUEST path too, not only the background
  // tick. It is flipped because of the cost, and a live fallback that kept
  // running would charge every request the full children listing while no tick
  // existed to expire anything or drain the queue it fed.
  if (!WLO_SKILL_CACHE) return 0;

  let answered = attachCachedRegistries(nodes);
  const cold = nodes.filter(n => n.nodeType === 'collection' && !n.skillRegistry
    && !entries.has(n.nodeId));
  if (!cold.length) return answered;

  const live = cold.slice(0, LIVE_FALLBACK_MAX);
  const results = await mapPool(live, CACHE_POOL, n => lookupOnce(n.nodeId));
  const checkedAt = Date.now();

  live.forEach((node, i) => {
    const entry = entryFrom(results[i], checkedAt);
    if (!entry) return;                        // nothing learned; stays queued
    remember(node.nodeId, entry);
    if (entry.registry) node.skillRegistry = entry.registry;
    if (!entry.scanTruncated) answered++;
  });
  return answered;
}

/** What one tick did. Logged in full — a background job nobody can see is a rumour. */
export interface CacheTickReport {
  /** Collections the children listing actually SETTLED — registry or none. */
  resolved: number;
  /** Of those, the ones carrying a registry. */
  found: number;
  /** Lookups that did not answer — nothing remembered, queued again. */
  failed: number;
  /**
   * Listings that replied but were cut short at the file cap: remembered so the
   * same page is not read again, and counted apart because they settle nothing.
   */
  inconclusive: number;
  /** Entries past the TTL, re-queued (their old answer stays readable). */
  expired: number;
  /** Still waiting after the batch cap. */
  queueLeft: number;
  ms: number;
}

/**
 * Re-queue everything older than the TTL.
 *
 * The stale entry is deliberately LEFT IN PLACE until a new answer replaces it.
 * Deleting it would make an answered collection look unanswered for the length
 * of the renewal, and the caller would print "nicht geprüft" over data it
 * already had.
 */
function expireStale(now: number): number {
  let expired = 0;
  for (const [id, entry] of entries) {
    if (now - entry.checkedAt <= WLO_SKILL_CACHE_TTL_MS || queue.has(id)) continue;
    if (queue.size >= QUEUE_MAX) break;
    queue.add(id);
    expired++;
  }
  return expired;
}

/**
 * Resolve up to `TICK_BATCH_MAX` queued collections through the children
 * listing and remember what it said.
 *
 * `resolveHeads: false` is deliberate: title and nodeId are already in the
 * `:::` blocks, so one collection costs the listing plus the document, whatever
 * the registry declares. Descriptions and keywords stay with `get_skill_registry`.
 *
 * A lookup that did not answer is remembered as NOTHING and queued again. That
 * asymmetry is what lets a remembered `registry: null` count as an answer — it
 * can only come from a listing that replied.
 */
export async function runCacheTick(opts: { now?: number } = {}): Promise<CacheTickReport> {
  const startedAt = Date.now();
  // Injected so a test can age the cache instead of sleeping through the TTL.
  const expired = expireStale(opts.now ?? startedAt);
  const batch = [...queue].slice(0, TICK_BATCH_MAX);
  for (const id of batch) queue.delete(id);

  let found = 0;
  let failed = 0;
  let inconclusive = 0;

  const results = await mapPool(batch, CACHE_POOL, (id) => lookupOnce(id));

  const checkedAt = Date.now();
  // Paired by index rather than by a returned id: `mapPool` keeps order and
  // nulls a slot whose lookup threw, so the id is only knowable from `batch`.
  batch.forEach((id, i) => {
    const entry = entryFrom(results[i], checkedAt);
    // A lookup that THREW (nulled by mapPool) and one that reported `unreadable`
    // are the same case: the collection could not be read, so nothing was
    // learned. Remembering that as "no registry here" is the one thing this
    // cache must never do — it would turn an outage into a statement.
    if (!entry) {
      failed++;
      queue.add(id);
      return;
    }
    if (entry.registry) found++;
    else if (entry.scanTruncated) inconclusive++;
    remember(id, entry);
  });

  const report: CacheTickReport = {
    resolved: batch.length - failed - inconclusive, found, failed, inconclusive,
    expired, queueLeft: queue.size, ms: Date.now() - startedAt,
  };
  if (batch.length) log.info('skill-registry-cache: tick', { ...report });
  return report;
}

/** Skill records one corpus query returns. 28 exist on staging (2026-08-11). */
const CORPUS_PAGE_MAX = 100;

let timer: ReturnType<typeof setInterval> | null = null;
let warmup: Promise<void> = Promise.resolve();

/**
 * Adopt every registry the search corpus already reveals.
 *
 * One `ngsearch` (~1.2 s, measured 2026-08-11 over 28 records) returns the whole
 * skill corpus, and each hit carries `virtual:primaryparent_nodeid` — already in
 * `SKILL_PROPS`, so the parent costs nothing extra. Grouped by parent and run
 * through the SAME `pickRegistryNode` the live path uses, that yields a
 * ready-made answer for every collection the index knows about: the fast path,
 * one document read each and no children listing at all.
 *
 * **Positive findings only.** A hit is a record the index handed over, so
 * "this collection HAS a registry" rests on evidence. Absence from the index
 * rests on a gap nobody can see — a record can fall out of it while sitting
 * perfectly in the node store (a live collection did, 2026-08-09), and that is
 * the claim `CLAUDE.md` refuses to let the index make. So a parent that yields
 * nothing here is left UNKNOWN, not recorded as empty, and the children listing
 * answers it when someone actually asks.
 *
 * Two consequences worth knowing. Most parents in the corpus are skill FOLDERS,
 * not collections (measured: 28 records, 28 distinct parents, none a
 * collection) — harmless, because a lookup happens by collection id and a
 * folder id never matches one. And an adopted entry expires like any other, at
 * which point the children listing re-checks it and gets the last word.
 */
async function seedFromCorpus(): Promise<void> {
  const res = await ngsearch(
    [{ property: 'ccm:oeh_extendedType', values: [SKILL_CONTENT_TYPE_URI] }],
    'FILES', CORPUS_PAGE_MAX, 0, SKILL_PROPS,
  );

  const byParent = new Map<string, WloNode[]>();
  for (const node of res.nodes) {
    const parent = node.properties?.['virtual:primaryparent_nodeid']?.[0]?.trim();
    if (!parent || !isMarkdownSkillDoc(node)) continue;
    byParent.set(parent, [...(byParent.get(parent) ?? []), node]);
  }

  const picks: { parent: string; picked: NonNullable<ReturnType<typeof pickRegistryNode>> }[] = [];
  for (const [parent, nodes] of byParent) {
    const picked = pickRegistryNode(nodes);
    if (picked) picks.push({ parent, picked });
  }

  let adopted = 0;
  await mapPool(picks, CACHE_POOL, async ({ parent, picked }) => {
    // Never over an existing answer. What is already there came from the
    // children listing — the authority — and this comes from the index, which
    // may only ever produce a POSITIVE for a collection nobody has looked at.
    // The TTL brings it back to the listing soon enough.
    if (entries.has(parent)) return;
    const { registry, reason } = await buildRegistryFrom(picked, parent, { resolveHeads: false });
    // The record exists but its text could not be read: nothing to publish, and
    // nothing learned either — leave it unknown so the listing tries later.
    if (reason === 'unreadable') return;
    remember(parent, { registry: toRegistrySummary(registry), checkedAt: Date.now() });
    adopted++;
  });

  log.info('skill-registry-cache: seeded from the skill corpus', {
    records: res.nodes.length, total: res.pagination?.total, candidates: picks.length, adopted,
  });
}

/**
 * Warm the cache and keep it warm. Returns IMMEDIATELY — nothing about this may
 * sit in front of a transport coming up, let alone in front of a request.
 *
 * Off, already running, or the operator's switch: all no-ops.
 */
export function startSkillRegistryCache(): void {
  if (!WLO_SKILL_CACHE || timer) return;

  // `unref` so a background refresh never keeps the process alive on its own —
  // a stdio server must still exit when its client goes away.
  timer = setInterval(() => { void runCacheTick().catch(warmupFailed); }, WLO_SKILL_CACHE_REFRESH_MS);
  timer.unref?.();

  // Floating on purpose, with its own catch: an unhandled rejection here would
  // take down a server that is perfectly able to answer without a warm cache.
  // The first tick is part of the promise — "warm" has to mean the seeded
  // collections were actually resolved, not merely queued.
  warmup = seedFromCorpus().then(() => runCacheTick()).then(() => undefined).catch(warmupFailed);
}

function warmupFailed(err: unknown): void {
  log.warn('skill-registry-cache: warmup failed — collections stay uncached for now', {
    error: err instanceof Error ? err.message : String(err),
  });
}

/**
 * The in-flight warmup, for a caller that needs it settled — tests, and a
 * shutdown that would rather not abandon a request mid-flight.
 */
export function cacheWarmup(): Promise<void> {
  return warmup;
}

/**
 * Stop the background work and forget everything.
 *
 * Also the reset tests use: module state that survives between test files is how
 * one test starts depending on another having run first.
 */
export function stopSkillRegistryCache(): void {
  if (timer) { clearInterval(timer); timer = null; }
  warmup = Promise.resolve();
  entries.clear();
  queue.clear();
  inFlight.clear();
}
