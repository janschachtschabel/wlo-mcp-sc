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

import { sharedAcrossRequests } from '../request-scope.js';
import {
  configuredServiceCredential,
  currentCredential,
  runAnonymous,
  runWithCredential,
  sharedReadScope,
} from '../auth/credential.js';
import { keyedDigest } from '../keyed-digest.js';
import { SHORT_CACHE_MS, shortCache } from '../short-cache.js';
import type { WloNode } from '../wlo-api.js';
import type { FormattedNode } from '../formatter.js';
import { capText } from '../text-cap.js';
import { ngsearch } from '../wlo-search.js';
import { mapPool } from '../concurrency.js';
import { log } from '../logger.js';
import {
  WLO_SKILL_CACHE,
  WLO_SKILL_CACHE_REFRESH_MS,
  WLO_SKILL_CACHE_TTL_MS,
} from '../wlo-config.js';
import { REGISTRY_CONTENT_TYPE_URI, SKILL_PROPS } from './skill-catalogue.js';
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
  /**
   * Set when a registry document WAS found but is larger than the skill bound,
   * so it was not read. The same shape as `scanTruncated`: a reply that asking
   * again cannot change (a 2-MiB download per tick, for nothing), remembered so
   * it is not repeated — and settling nothing, because "no approved skills" is
   * not what was learned.
   */
  oversized?: true;
  /**
   * Set when the listing was REFUSED (401/403) for the rights it was asked
   * with. An answer for that scope — asking again on every tick cannot change
   * it, and it used to be re-queued for ever, with a warning each time — but
   * not a finding of absence: the caller keeps its "nicht geprüft" line. Never
   * lent to another scope (`held` lends positives only): whoever is refused as
   * nobody may well be allowed as themselves.
   */
  refused?: true;
  /**
   * The registry's general instruction — the prose above its first H2, capped.
   *
   * Held HERE and deliberately not on `CachedRegistry`: that type IS the field a
   * result node carries, so putting prose there would put it in every search hit,
   * which is the cost this cache exists to remove. A collection answer wants it;
   * a list of fifty search results does not.
   *
   * Capped at storage time rather than at render time, because this map holds up
   * to `CACHE_MAX_ENTRIES` entries and a curator can write a page: uncapped, the
   * bound on the number of entries would stop being a bound on memory.
   */
  generalInstruction?: string;
}

/** Per-collection cap for the stored instruction — a memory bound, not a layout one. */
const GENERAL_INSTRUCTION_MAX = 1200;

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

/**
 * Whose rights an answer was read with, as far as it may be SHARED.
 *
 * A children listing answers differently for the service account (`/mcp`
 * without a login, and the background tick), for nobody (`/api/*`) and for a
 * person. Keyed by collection alone, the catalogue the service account read was
 * handed to an anonymous caller, and an anonymous "none there" answered for
 * everyone else. So every entry, every queued id and every lookup in flight
 * belongs to ONE scope — and a personal login has none: its answers are never
 * SHARED. The same rule, from the same function, as `short-cache.ts`.
 *
 * What a personal login may BORROW is the anonymous scope's POSITIVE answers
 * (`held`): a registry nobody-in-particular can read is readable by everyone.
 * Never a negative — a person may see a registry an anonymous reader is refused
 * — and never anything of the service account's, which may see more than the
 * person. What its OWN lookups answered it gets back from `personalMemo`, for a
 * minute and for that identity alone.
 */
type Scope = NonNullable<ReturnType<typeof sharedReadScope>>;

const SCOPES: readonly Scope[] = ['anonymous', 'service'];

/** The key an id is held under in the caller's scope, or `null` when nothing of this caller's may be held. */
function scopedKey(collectionId: string): string | null {
  const scope = sharedReadScope();
  return scope ? keyIn(scope, collectionId) : null;
}

const keyIn = (scope: Scope, collectionId: string): string => `${scope}:${collectionId}`;

/** A key taken apart again — for the tick, which must ask with the rights the key names. */
function parseKey(key: string): { scope: Scope; collectionId: string } {
  const at = key.indexOf(':');
  return { scope: key.slice(0, at) as Scope, collectionId: key.slice(at + 1) };
}

/** How many of `keys` belong to `scope` — the caps below are per scope. */
function countIn(keys: Iterable<string>, scope: Scope): number {
  const prefix = `${scope}:`;
  let n = 0;
  for (const key of keys) if (key.startsWith(prefix)) n++;
  return n;
}

/**
 * Whether one more key of `scope` is past `max`. The total (`size`) is looked
 * at first: no scope can be at its cap while both together are below it, so the
 * count — a walk over the keys — is paid only by a map that is nearly full.
 */
const atCap = (keys: Iterable<string>, scope: Scope, max: number, size: number): boolean =>
  size >= max && countIn(keys, scope) >= max;

/** Whether the tick can read with a scope's rights at all. */
const canEnter = (scope: Scope): boolean => scope === 'anonymous' || configuredServiceCredential() !== null;

/**
 * Run `fn` with the rights of a scope, whatever the caller's own are.
 *
 * The background work has no caller: left to the ambient credential it would
 * read every queued collection with the service account and file the answers
 * under whichever scope had asked. `null` when the scope cannot be entered — a
 * `service` key outliving its account must not be answered with other rights.
 */
function inScope<T>(scope: Scope, fn: () => T): T | null {
  if (scope === 'anonymous') return runAnonymous(fn);
  const service = configuredServiceCredential();
  return service ? runWithCredential(service, fn) : null;
}

/**
 * Both maps are keyed by `scopedKey`, and `CACHE_MAX_ENTRIES` / `QUEUE_MAX`
 * apply PER SCOPE: shared, the open `/api` surface could fill the queue or push
 * the service account's answers out. A personal login stores nothing HERE (its
 * own answers live in `personalMemo`, with its own bound), so the total is
 * bounded by two scopes × the cap.
 */
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
function remember(key: string, entry: CacheEntry): void {
  const { scope } = parseKey(key);
  if (!entries.has(key) && atCap(entries.keys(), scope, CACHE_MAX_ENTRIES, entries.size)) evictOldest(scope);
  entries.set(key, entry);
  queue.delete(key);
}

/**
 * Answers one PERSONAL login's own lookups got, held for that identity alone.
 *
 * Without it a signed-in caller was never served a negative: the scope caches
 * keep nothing of a person's, and only the anonymous scope's POSITIVES are lent.
 * So every signed-in search and collection answer paid the live listing again
 * (up to `LIVE_FALLBACK_MAX` per request, ~1.0–1.4 s) for every collection
 * WITHOUT a registry — the common case, and every widget user is a personal
 * login.
 *
 * Four things keep it from becoming the leak the scopes exist to prevent:
 *
 *  - the key is a keyed digest of the credential (`keyed-digest.ts`) — never the
 *    credential, never logged, and useless outside this process;
 *  - one identity never reads another's entry, and no shared scope reads any;
 *  - it is SHORT (a minute, as `short-cache.ts`) — a person's rights change
 *    with a group membership, and nothing here is told about that;
 *  - it is bounded over ALL identities together (the oldest goes), and holds a
 *    `CacheEntry` — the summary and the capped general instruction the scope
 *    caches hold, never the registry document.
 *
 * Only an ANSWER is written (the callers write what `entryFrom` returned), and
 * a forced lookup replaces the entry.
 */
export const PERSONAL_MEMO_MAX = 1000;
const personalMemo = shortCache<CacheEntry>(PERSONAL_MEMO_MAX, SHORT_CACHE_MS);

/** The memo key of the calling PERSON for a collection; `null` for the shared scopes. */
function personalKey(collectionId: string): string | null {
  const cred = currentCredential();
  if (!cred || cred.source === 'service') return null;
  return `${keyedDigest(`registry-memo:${cred.header}`)}:${collectionId}`;
}

/** File an answer where the CALLER's later requests find it: its scope's cache, or its own memo. */
function rememberForCaller(collectionId: string, entry: CacheEntry): void {
  const key = scopedKey(collectionId);
  if (key) { remember(key, entry); return; }
  const own = personalKey(collectionId);
  if (own) personalMemo.set(own, entry);
}

/**
 * What the caller may be answered from memory for a collection.
 *
 * Its own scope's entry. For a personal login: what its OWN lookup answered
 * within the last minute — first, because that is the more specific and the
 * fresher answer (a forced "none now" must not be papered over with the
 * anonymous scope's older catalogue) — else the anonymous scope's entry when
 * that one FOUND a registry. A negative, a refusal, a capped scan or an
 * oversized document is not lent: each says "an anonymous reader saw none", and
 * the person may see more.
 */
function held(collectionId: string): CacheEntry | undefined {
  const key = scopedKey(collectionId);
  if (key) return entries.get(key);
  const own = personalKey(collectionId);
  const mine = own ? personalMemo.get(own) : undefined;
  if (mine) return mine;
  const lent = entries.get(keyIn('anonymous', collectionId));
  return lent?.registry ? lent : undefined;
}

/**
 * Drop the answer checked longest ago, and say so. A cap nobody can see reads
 * as a complete memory that quietly forgets.
 */
function evictOldest(scope: Scope): void {
  const prefix = `${scope}:`;
  let oldestId: string | undefined;
  let oldestAt = Infinity;
  for (const [id, entry] of entries) {
    if (id.startsWith(prefix) && entry.checkedAt < oldestAt) { oldestAt = entry.checkedAt; oldestId = id; }
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
  const key = scopedKey(collectionId);
  // A personal login shares nothing — not even a lookup in flight, which would
  // hand one person's listing to whoever asked a moment later. It stays bound to
  // its own request, too: nobody else waits for it.
  if (!key) return loadSkillRegistry(collectionId, { resolveHeads: false });
  const running = inFlight.get(key);
  if (running) return running;
  // Outside the request scope: this promise is SHARED by every caller wanting the
  // collection, and its result feeds the cache — one of them hanging up must not
  // fail the others.
  const pending = sharedAcrossRequests(() => loadSkillRegistry(collectionId, { resolveHeads: false }));
  inFlight.set(key, pending);
  // `then(done, done)` rather than `finally`, which would leave the rejection of
  // its own derived promise unhandled.
  const done = () => { if (inFlight.get(key) === pending) inFlight.delete(key); };
  void pending.then(done, done);
  return pending;
}

/** Whether an entry ANSWERS the question — a capped scan, an oversized document and a refusal are held, and answer nothing. */
const settles = (entry: CacheEntry): boolean => !entry.scanTruncated && !entry.oversized && !entry.refused;

/**
 * What a finished lookup means for the cache, or `null` when it means nothing.
 *
 * Two kinds of non-answer, remembered differently. A lookup that THREW (nulled
 * by `mapPool`) or reported `unreadable` learned nothing at all — the entry
 * stays absent and the collection is queued again, because an outage must never
 * become "this collection has no approved skills". A scan cut short at the file
 * cap DID reply: re-reading the same first page cannot produce a different
 * answer, so it is remembered — but marked, so it settles nothing. The same
 * goes for an oversized document and for a listing the repository REFUSED
 * (401/403): asked again with the same rights, it refuses again.
 */
function entryFrom(result: RegistryLookup | null, checkedAt: number): CacheEntry | null {
  if (!result) return null;
  if (result.reason === 'unreadable') {
    if (result.tooLarge) return { registry: null, checkedAt, oversized: true };
    if (result.refused) return { registry: null, checkedAt, refused: true };
    return null;
  }
  const general = result.registry?.general.instruction;
  return {
    registry: result.registry ? toRegistrySummary(result.registry) : null,
    checkedAt,
    ...(result.scanTruncated ? { scanTruncated: result.scanTruncated } : {}),
    ...(general ? { generalInstruction: capText(general, GENERAL_INSTRUCTION_MAX).text } : {}),
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
  return held(collectionId);
}

/**
 * Mark collections for background resolution. Idempotent, synchronous, never
 * throws — it sits in the request path and must cost nothing.
 *
 * Already-answered collections are skipped; re-checking them is the TTL's job,
 * not the caller's.
 */
export function queueCollections(collectionIds: string[]): void {
  // A personal login's own answer is kept for nobody, and the tick must never
  // read with a person's rights. What the tick CAN do for it is look as nobody:
  // a registry found that way is one the person is served next time (`held`).
  const scope = sharedReadScope() ?? 'anonymous';
  let dropped = 0;
  let waiting = -1;                            // counted once, and only when the queue is nearly full
  for (const raw of collectionIds) {
    const id = raw?.trim();
    if (!id) continue;
    const key = keyIn(scope, id);
    if (entries.has(key) || queue.has(key)) continue;
    if (queue.size >= QUEUE_MAX) {
      if (waiting < 0) waiting = countIn(queue, scope);
      if (waiting >= QUEUE_MAX) { dropped++; continue; }
      waiting++;
    }
    queue.add(key);
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
 * @returns the nodeIds the cache could answer AUTHORITATIVELY, whether or not
 *   a registry was found — a remembered scan that was cut short at the file cap
 *   is NOT in the set. The caller turns membership into `registryChecked`: a
 *   collection with no registry carries no field, so the nodes alone cannot
 *   tell "not looked up" from "looked up, none there". A SET rather than a
 *   count since 2026-08-19, because one search reconciles TWO buckets
 *   (collections and topic pages) against one shared call — and a count cannot
 *   say which side an answer belongs to: 4 answered ids are not "2 of 2
 *   collections", and treating them so printed a catalogue with "nicht
 *   geprüft" beside it.
 */
export function attachCachedRegistries(nodes: FormattedNode[]): Set<string> {
  const answered = new Set<string>();
  const cold: string[] = [];
  for (const node of nodes) {
    if (node.nodeType !== 'collection') continue;
    // A registry already on the node came from the live path, which read the
    // listing just now; this entry may be minutes old. Fresher wins.
    if (node.skillRegistry) { answered.add(node.nodeId); continue; }
    const entry = held(node.nodeId);
    if (!entry) { cold.push(node.nodeId); continue; }
    if (entry.registry) { node.skillRegistry = entry.registry; answered.add(node.nodeId); continue; }
    // Held so the capped page is not read again, but it answered nothing: a
    // registry past the scan cap is invisible to it. Counting it would print
    // "geprüft" over a look that saw 50 of 400 files.
    if (!settles(entry)) continue;
    answered.add(node.nodeId);
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
 * `WLO_SKILL_CACHE=off` short-circuits this to an empty set: the operator's
 * switch covers the request path as well as the background timer.
 *
 * `force` — the caller asked for the state NOW (`includeSkillRegistry`). Every
 * collection is then looked up fresh and NOTHING remembered is attached: not
 * for an id whose lookup failed (the remembered catalogue would read as the
 * fresh one), and not for one that answered "none" (for a personal login the
 * anonymous scope's older positive was lent back in its place). It is a mode of
 * THIS function, not a second call the call sites make before it, because the
 * rule "what the forced pass touched is closed to the ordinary pass" was
 * re-derived per call site and got one half of it wrong at each of them.
 *
 * @returns the nodeIds now answered authoritatively (see
 *   `attachCachedRegistries` for why ids rather than a count). A node missing
 *   from the set means the caller keeps its pointer line for it.
 */
export async function ensureRegistries(nodes: FormattedNode[], opts: { force?: boolean } = {}): Promise<Set<string>> {
  // Before the switch: a forced lookup is what was asked for, and works with
  // the cache switched off — only the remembering depends on the switch.
  if (opts.force) return (await refreshRegistries(nodes)).answered;

  // The operator's switch covers the REQUEST path too, not only the background
  // tick. It is flipped because of the cost, and a live fallback that kept
  // running would charge every request the full children listing while no tick
  // existed to expire anything or drain the queue it fed.
  if (!WLO_SKILL_CACHE) return new Set();

  const answered = attachCachedRegistries(nodes);
  const cold = nodes.filter(n => n.nodeType === 'collection' && !n.skillRegistry
    && !held(n.nodeId));
  if (!cold.length) return answered;

  const live = cold.slice(0, LIVE_FALLBACK_MAX);
  const results = await mapPool(live, CACHE_POOL, n => lookupOnce(n.nodeId));
  const checkedAt = Date.now();

  live.forEach((node, i) => {
    const entry = entryFrom(results[i], checkedAt);
    if (!entry) return;                        // nothing learned; stays queued
    rememberForCaller(node.nodeId, entry);
    if (entry.registry) node.skillRegistry = entry.registry;
    if (settles(entry)) answered.add(node.nodeId);
  });
  return answered;
}

/**
 * A FRESH lookup for every collection among `nodes`, whatever the cache holds —
 * the caller asked for it (`includeSkillRegistry`). Through the cache, which is
 * the point (audit 2026-11-12, K-15). The forced pass used to run beside it:
 *
 *  - a registry that had been REMOVED left no field on the node, and the cache
 *    pass that followed filled the stale catalogue back in;
 *  - what the fresh lookup learned was not written back, so the next call
 *    answered from the old entry again;
 *  - and a lookup that FAILED counted as "checked, none there", because the
 *    forced pass as a whole was taken for an answer.
 *
 * So: each answer replaces the entry (for a personal login: its own memo entry)
 * — a registry that is gone leaves an entry saying so — and only the ids that
 * really answered are returned: a failed or inconclusive lookup leaves the node
 * without a field and with its "nicht geprüft" line. Works with the cache
 * switched off too: the lookup is what was asked for; only the remembering
 * depends on the switch.
 *
 * Call sites go through `ensureRegistries(nodes, { force: true })`. Following
 * this with an ordinary pass over the same nodes is the mistake that mode
 * exists to rule out.
 */
export async function refreshRegistries(nodes: FormattedNode[]): Promise<{ answered: Set<string>; failed: Set<string> }> {
  const answered = new Set<string>();
  // Asked, and no answer came. The caller must NOT fall back to the remembered
  // catalogue for these: shown beside a request for the state now, an entry up
  // to its TTL old reads as that state (review of audit package 9).
  const failed = new Set<string>();
  const targets = nodes.filter(n => n.nodeType === 'collection');
  if (!targets.length) return { answered, failed };
  const results = await mapPool(targets, CACHE_POOL, n => lookupOnce(n.nodeId));
  const checkedAt = Date.now();
  targets.forEach((node, i) => {
    const entry = entryFrom(results[i], checkedAt);
    if (!entry) { failed.add(node.nodeId); return; }   // did not answer: nothing is claimed
    if (WLO_SKILL_CACHE) rememberForCaller(node.nodeId, entry);
    if (!settles(entry)) return;               // capped scan / oversized: held, but no answer
    if (entry.registry) node.skillRegistry = entry.registry;
    answered.add(node.nodeId);
  });
  return { answered, failed };
}

/**
 * Catalogues the cache ALREADY holds for these ids, and a queue entry for the
 * rest. Never goes upstream.
 *
 * For the broad overviews — `browse_collection_tree`, `get_subject_portals` —
 * which render one line per collection over thirty or fifty of them. Even the
 * bounded live fallback (`LIVE_FALLBACK_MAX`) is the wrong trade there: those
 * tools exist to be fast and wide, and first contact would charge every one of
 * them a children listing. Queued instead, so the tick answers it and the next
 * call is complete.
 *
 * It keeps no ledger of answered ids, unlike `attachCachedRegistries`, and that
 * is not an oversight: these callers never print "geprüft, keine vorhanden". A marker
 * appears only where a registry was actually found, so there is no claim of
 * absence to qualify.
 */
export function cachedRegistriesFor(ids: string[]): Map<string, CachedRegistry> {
  const found = new Map<string, CachedRegistry>();
  if (!WLO_SKILL_CACHE) return found;
  const cold: string[] = [];
  for (const id of ids) {
    const entry = held(id);
    if (!entry) { cold.push(id); continue; }
    if (entry.registry) found.set(id, entry.registry);
  }
  if (cold.length) queueCollections(cold);
  return found;
}

/**
 * The catalogue of ONE collection — the one a tool was called about, rather than
 * one it is returning.
 *
 * `ensureRegistries` answers for a list of RESULTS, which is the wrong half for
 * `get_collection_contents`, `search_wlo_within_collection`, `get_node_details`
 * on a collection or `get_topic_page_content`: there the collection whose
 * approved skills the caller wants is named in the ARGUMENTS and never appears
 * among the results. Same cache, same live fallback, same asymmetry — only the
 * question is about one id.
 *
 * Three outcomes, not two, and the caller needs all three: a catalogue,
 * `answered` with no registry ("this collection declares none"), and NOT
 * answered — the listing failed, the id is unknown to us, or the cache is
 * switched off. Collapsing the last two into one `null` made a failed lookup
 * read as a collection that approves nothing, which is a different claim.
 *
 * A scan cut short at the file cap counts as unanswered for the same reason it
 * does in `attachCachedRegistries`: 50 files read of 400 does not settle
 * whether a registry is there.
 *
 * It never throws. This is an extra on an answer the caller already owes, so a
 * registry lookup must not turn a listing into an error.
 */
export async function ensureRegistryFor(
  collectionId: string,
): Promise<{ registry: CachedRegistry | null; answered: boolean; generalInstruction?: string }> {
  if (!WLO_SKILL_CACHE || !collectionId) return { registry: null, answered: false };
  const known = held(collectionId);
  if (known) {
    return {
      registry: known.registry,
      answered: settles(known),
      ...(known.generalInstruction ? { generalInstruction: known.generalInstruction } : {}),
    };
  }

  const result = await lookupOnce(collectionId).catch(() => null);
  const entry = entryFrom(result, Date.now());
  if (!entry) {
    // Learned nothing — so it must be QUEUED, or the background tick never
    // warms it and every following request repeats this live call. `remember`
    // is what normally clears the queue entry; there is nothing to remember.
    queueCollections([collectionId]);
    return { registry: null, answered: false };
  }
  rememberForCaller(collectionId, entry);
  // A personal login's answer is held for a minute and for that identity only —
  // so the anonymous lookup is asked for as well: what it finds serves every
  // signed-in caller after that.
  if (!scopedKey(collectionId)) queueCollections([collectionId]);
  return {
    registry: entry.registry,
    answered: settles(entry),
    ...(entry.generalInstruction ? { generalInstruction: entry.generalInstruction } : {}),
  };
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
    if (atCap(queue, parseKey(id).scope, QUEUE_MAX, queue.size)) continue;
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
export function runCacheTick(opts: { now?: number } = {}): Promise<CacheTickReport> {
  // ONE tick at a time. The timer fires on a schedule, not when the last tick
  // is done: against a slow repository a tick outlives its interval, and two
  // ticks then drain the same queue with twice the upstream calls while the
  // slowness that caused it gets worse (audit 2026-11-12, K-16). A tick asked
  // for while one runs gets that one's report.
  if (ticking) return ticking;
  const run: Promise<CacheTickReport> = tick(opts).finally(() => { if (ticking === run) ticking = null; });
  ticking = run;
  return ticking;
}

/**
 * The keys one tick resolves: the scopes take turns, so a queue full of ids
 * from the open surface cannot make the other scope wait ten ticks.
 */
function nextBatch(): string[] {
  const perScope = SCOPES.map(scope => [...queue].filter(key => key.startsWith(`${scope}:`)));
  const batch: string[] = [];
  for (let i = 0; batch.length < TICK_BATCH_MAX && perScope.some(keys => i < keys.length); i++) {
    for (const keys of perScope) {
      if (i < keys.length && batch.length < TICK_BATCH_MAX) batch.push(keys[i]!);
    }
  }
  return batch;
}

let ticking: Promise<CacheTickReport> | null = null;
/** Raised by every stop, so a tick in flight can tell that its cache is gone. */
let generation = 0;

async function tick(opts: { now?: number }): Promise<CacheTickReport> {
  const startedAt = Date.now();
  // Injected so a test can age the cache instead of sleeping through the TTL.
  const expired = expireStale(opts.now ?? startedAt);
  // A key whose scope cannot be entered — a `service` key outliving its account
  // — is DROPPED here. Treated as a failed lookup it was queued again on every
  // tick, for ever, and took a place in each batch.
  for (const key of [...queue]) if (!canEnter(parseKey(key).scope)) queue.delete(key);
  const batch = nextBatch();
  for (const id of batch) queue.delete(id);

  let found = 0;
  let failed = 0;
  let inconclusive = 0;

  const mine = generation;
  // Each key is asked with the rights of the scope it was queued FOR — the tick
  // itself has no caller, and its ambient credential is the service account's.
  const results = await mapPool(batch, CACHE_POOL, async (key): Promise<RegistryLookup | null> => {
    const { scope, collectionId } = parseKey(key);
    return inScope(scope, () => lookupOnce(collectionId));
  });
  // Stopped (or reset) while this tick was out: what it learned belongs to a
  // cache that no longer exists, and writing it would refill the new one.
  if (mine !== generation) return { resolved: 0, found: 0, failed: 0, inconclusive: 0, expired, queueLeft: queue.size, ms: Date.now() - startedAt };

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
    else if (!settles(entry)) inconclusive++;
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
function seedFromCorpus(): Promise<void> {
  // Named rather than inherited: the seed fills ONE scope's entries, and which
  // one must not depend on where `startSkillRegistryCache` happened to be called
  // from. The widest shared scope there is — the other one is warmed by its own
  // callers through the listing.
  const scope: Scope = configuredServiceCredential() ? 'service' : 'anonymous';
  return inScope(scope, () => seedScope(scope)) ?? Promise.resolve();
}

async function seedScope(scope: Scope): Promise<void> {
  const res = await ngsearch(
    [{ property: 'ccm:oeh_extendedType', values: [REGISTRY_CONTENT_TYPE_URI] }],
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
    const key = keyIn(scope, parent);
    if (entries.has(key)) return;
    const { registry, reason } = await buildRegistryFrom(picked, parent, { resolveHeads: false });
    // The record exists but its text could not be read: nothing to publish, and
    // nothing learned either — leave it unknown so the listing tries later.
    if (reason === 'unreadable') return;
    remember(key, { registry: toRegistrySummary(registry), checkedAt: Date.now() });
    adopted++;
  });

  log.info('skill-registry-cache: seeded from the skill corpus', {
    records: res.nodes.length, total: res.pagination?.total, candidates: picks.length, adopted,
  });

  // The seed reads ONE page. Nothing goes wrong when it is not enough — the
  // collections past it are resolved by the children listing on first contact —
  // but they lose the fast path, and a bound that bites without saying so is
  // the invisible incompleteness this module warns about everywhere else.
  const total = res.pagination?.total ?? res.nodes.length;
  if (total > res.nodes.length) {
    log.warn('skill-registry-cache: the skill corpus is larger than one page — the rest is not seeded', {
      read: res.nodes.length, total, page: CORPUS_PAGE_MAX,
    });
  }
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
  generation += 1;
  ticking = null;
  warmup = Promise.resolve();
  entries.clear();
  queue.clear();
  inFlight.clear();
  personalMemo.clear();
}
