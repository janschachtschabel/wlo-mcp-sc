/**
 * auth/access-registry.ts – which access blocks are still valid.
 *
 * An ALLOW-list, and the direction is the point. A deny-list that goes missing
 * silently resurrects every revoked block; an allow-list that goes missing
 * invalidates everything and people fetch a new block. Inconvenient beats
 * unsafe, so every failure here closes the door: only an ABSENT file counts as
 * "empty registry, first start". A present-but-unreadable one disables the
 * feature and says so.
 *
 * It holds IDS, never a credential — the credential lives encrypted inside the
 * user's own block and is only ever in memory here. `tests/access-registry.test.ts`
 * asserts the written file carries `jti`, `label` and `iat` plus the optional
 * `k`, `exp` and `acct` — and nothing resembling a credential.
 *
 * The only module in this project that writes to disk at runtime. The container
 * therefore mounts one writable volume and keeps `read_only: true` for
 * everything else.
 */

import { dirname } from 'node:path';
import { open, readFile, rename } from 'node:fs/promises';
import { log } from '../logger.js';

export interface RegistryEntry {
  /** Access id, as carried inside the block's authenticated payload. */
  jti: string;
  /** WLO user name, so the operator can tell whose access an entry is. */
  label: string;
  /** Issued-at, seconds. */
  iat: number;
  /**
   * How this entry came to be, mirroring `AccessPayload.k` in name, values and
   * meaning — absent is the block a person fetched and pasted somewhere.
   *
   * It exists for ONE decision, `evictOldest`: an entry a person made
   * deliberately and an entry that appeared because they loaded a web page are
   * not interchangeable, and without this field the registry cannot tell them
   * apart. See `MAX_BLOCKS_PER_LABEL` for what that cost.
   *
   * Entries written before 2026-08-13 carry no `k` and therefore read as
   * deliberate. For the ticket entries among them that is wrong and it is also
   * harmless: they age out of their own accord, and until they do they are
   * counted in the stricter class.
   */
  k?: 'ticket';
  /**
   * Expiry, seconds (plan 2026-11-07, R1): the entry stops counting as listed
   * at this instant, and the block reads exactly like a revoked one — 401 on
   * `/mcp`. The expiry lives HERE and not in the block, so the token stays the
   * block (no wrapper, no refresh token) and an operator can see it.
   *
   * Set for ticket blocks and for OAuth logins of an embedded widget
   * (`SESSION_BLOCK_TTL_S`); absent everywhere else — a block pasted into an AI
   * host, and every entry written before 2026-11-07, never expires.
   *
   * Optional, so no format bump (see `FORMAT_VERSION`): an old build ignores
   * it, which on a rollback lifts the expiry and keeps the access — the safe
   * direction for people, and a known one for the operator.
   */
  exp?: number;
  /**
   * The account the repository CONFIRMED for this login (audit 2026-11-12, S-2).
   *
   * `label` is the spelling the block carries, and it must stay that: a block is
   * bound to it (`credentialFromAccessBlock`). But edu-sharing accepts one login
   * in several spellings — measured on staging 2026-11-12: `LEHRERIN` and
   * `Lehrerin` sign in as `lehrerin` — so by label alone one account was several:
   * "revoke everything" missed the other spellings, and the per-account cap
   * counted each apart. Revocation and the cap therefore go by this name where
   * it is known.
   *
   * Optional, so no format bump: an old build ignores it and falls back to the
   * label, which is the behaviour before this field. Absent on entries written
   * before 2026-11-12 and on ticket entries, whose label already IS the
   * confirmed name.
   */
  acct?: string;
}

/** The account an entry belongs to: the confirmed name, else the label. */
const accountOf = (e: RegistryEntry): string => e.acct ?? e.label;

/** How long a ticket block or a widget's OAuth block stays listed: 12 h. */
export const SESSION_BLOCK_TTL_S = 12 * 60 * 60;

/**
 * How long an EXPIRED entry is kept as a record (review 2026-11-07). While it
 * exists, issuance refuses its id (`access-issue.ts`) — otherwise whoever holds
 * an expired widget block could list it again, without an expiry, through
 * `/auth/issue` or a consent. Issuance also refuses a block whose own `iat` is
 * more than `ISSUE_MAX_SKEW_S` off our clock, so a block can be issued at most
 * 24 h + 24 h after it was made; two days after `exp` covers both.
 */
export const EXPIRED_KEPT_S = 48 * 60 * 60;

export interface AccessRegistry {
  /** Listed AND not expired at `nowMs` — the check every opened block passes (`credentialFromHeader`). */
  has(jti: string, nowMs?: number): boolean;
  /** Present at all — listed, or expired and still kept as a record (`EXPIRED_KEPT_S`). */
  known(jti: string): boolean;
  /** The entry's `exp` (seconds), or undefined for an entry without one or no entry at all. */
  expiresAt(jti: string): number | undefined;
  /**
   * The name the id was listed for — the spelling its block carries. A block
   * presenting the id under ANOTHER name is not that access (audit S-1).
   */
  labelOf(jti: string): string | undefined;
  add(entry: RegistryEntry): Promise<void>;
  remove(jti: string): Promise<boolean>;
  /**
   * Drop every entry of one account and report how many went.
   *
   * The only revocation path available to someone who connected over OAuth:
   * there the block goes to the client and the person never sees it, so an id
   * they cannot read is an id they cannot revoke. The caller must have PROVEN
   * the login first — see `access-revoke.ts`.
   *
   * `account` is matched exactly against each entry's account (`acct`, else its
   * label). `typed` — the spelling the login was typed in — is matched against
   * the LABEL of entries that carry no `acct`, and only those: it is there to
   * find entries listed before the account name was recorded, and matching it
   * against a confirmed account would end a stranger's access wherever an
   * instance accepts an alias that equals somebody else's name.
   *
   * No case-folding: that one instance treats `Jan` and `jan` as one login
   * (measured 2026-11-12) is why the CONFIRMED name is recorded. Folding by rule
   * would wipe a stranger's accesses on an instance where the two differ.
   */
  removeByLabel(account: string, typed?: string): Promise<number>;
  /**
   * Record the confirmed account on an entry that has none — an entry listed
   * before `acct` existed, when its block is issued again. Everything else
   * (order, `exp`, `k`, `iat`) stays. Unknown ids and entries that already
   * carry an account are left alone.
   */
  noteAccount(jti: string, account: string): Promise<void>;
}

/**
 * Bumped only if the on-disk shape changes INCOMPATIBLY; an unknown value fails
 * closed.
 *
 * "Incompatibly" is doing real work in that sentence, and `k` (2026-08-13) is
 * the case that shows it. A mismatch makes `parseEntries` answer null, and null
 * switches per-user access off entirely — so a bump is not a migration marker,
 * it is a switch that takes every deployed block out of service the moment the
 * new image starts, with one log line to explain it.
 *
 * An OPTIONAL field is therefore not a reason to bump, as long as both
 * directions hold, and for `k` they do: a new build reading an old file sees no
 * `k` and treats those entries as deliberate, while an old build reading a new
 * file ignores the field in `isEntry` and carries it through untouched, because
 * serialisation writes whole entry objects rather than rebuilding them
 * field by field. `tests/access-registry.test.ts` pins both.
 */
const FORMAT_VERSION = 1;

/**
 * How many blocks one WLO account may have listed at a time.
 *
 * A bound is needed because nothing removes an entry on its own: a working login
 * could otherwise add an entry per request to a file rewritten in full each time.
 * Two revocation paths exist, and both need a person to act — `remove` takes the
 * ACCESS ID, which only exists inside the block, and `removeByLabel` needs the
 * account's password. A block someone fetched and forgot is listed until one of
 * the two is used.
 *
 * Note what that says and what it does not. `remove` is keyed on `jti` alone,
 * and `/auth/revoke` accepts ANY block carrying it — the public key is published
 * so browsers can encrypt, so anyone can build one. Possession of the original
 * block is therefore not what is being proven; knowledge of its id is. That is
 * the intended trade (whoever notices a compromise must be able to act fast),
 * and it makes the id the secret: it must never be logged, and never appear in a
 * response. `tests/auth-endpoints.test.ts` pins both halves.
 *
 * Per LABEL, deliberately, and never a global ceiling — a global one would let a
 * single account push everyone else's access out. Ten is well above real use
 * (a laptop, a phone, two or three AI hosts) so the cap bounds abuse and neglect
 * without rationing anything.
 *
 * Applied per KIND since 2026-08-13, and the reasoning above is why. It counts
 * things a person does on purpose, and a ticket entry is not one of those: an
 * embedded widget files one per edu-sharing session simply because someone
 * opened a page. Counted together, ten working days of widget use evicted the
 * block that person had pasted into their AI host weeks earlier — their
 * connector answered 401, re-pasting the same block did not help because it was
 * off the allow-list, and nothing said why. The deterministic `jti` in
 * `ticket-exchange.ts` prevents the same SESSION from filing twice; it cannot
 * prevent the next session from filing at all.
 *
 * One constant rather than a second number to justify: "well above real use"
 * holds in both classes. For tickets it reads as about two working weeks before
 * the oldest — by then long expired, so granting nothing — is retired.
 */
export const MAX_BLOCKS_PER_LABEL = 10;

/**
 * Owner-only (0600): the file lists access ids, and an id is a secret —
 * revocation acts on it (AUTH.md §4). The mode applies when a file is CREATED;
 * every commit writes a fresh temp file and renames it into place, so an
 * existing registry picks the mode up on its next write.
 */
const REGISTRY_FILE_OPTIONS = { encoding: 'utf8', mode: 0o600 } as const;

/**
 * Write the registry: temp file, SYNC, rename.
 *
 * The rename is atomic for the name, not for the bytes: without the sync the
 * new file's content may still sit in the page cache, and a hard stop then
 * leaves an empty file under the real name. That fails closed — and switches
 * every personal access off until someone notices (audit 2026-11-12, S-9).
 */
async function writeSynced(path: string, body: string): Promise<void> {
  const temp = `${path}.tmp`;
  const handle = await open(temp, 'w', REGISTRY_FILE_OPTIONS.mode);
  try {
    await handle.writeFile(body, REGISTRY_FILE_OPTIONS.encoding);
    await handle.sync();
  } finally {
    await handle.close();
  }
  await rename(temp, path);
  // The rename itself lives in the DIRECTORY entry. Best effort: a platform
  // that cannot open a directory for syncing (Windows) loses nothing it had.
  try {
    const dir = await open(dirname(path), 'r');
    try { await dir.sync(); } finally { await dir.close(); }
  } catch { /* not supported here */ }
}

function isEntry(value: unknown): value is RegistryEntry {
  if (typeof value !== 'object' || value === null) return false;
  const e = value as Record<string, unknown>;
  // `k` is optional and the only named value is 'ticket'. An unknown one fails
  // the whole entry closed rather than being dropped: a kind we cannot name is a
  // record written by something we do not understand, and admitting it in the
  // deliberate class is the direction that loses someone their pasted block.
  if (e['k'] !== undefined && e['k'] !== 'ticket') return false;
  // An expiry we cannot read fails closed the same way: dropping it would turn a
  // 12-hour access into one that never ends.
  if (e['exp'] !== undefined && typeof e['exp'] !== 'number') return false;
  // Revocation and the cap go by it: a value we cannot read fails closed.
  if (e['acct'] !== undefined && (typeof e['acct'] !== 'string' || !e['acct'])) return false;
  return typeof e['jti'] === 'string' && !!e['jti']
    && typeof e['label'] === 'string'
    && typeof e['iat'] === 'number';
}

function parseEntries(raw: string): RegistryEntry[] | null {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof data !== 'object' || data === null || Array.isArray(data)) return null;
  const { v, entries } = data as Record<string, unknown>;
  if (v !== FORMAT_VERSION || !Array.isArray(entries)) return null;
  if (!entries.every(isEntry)) return null;
  return entries;
}

/**
 * Load the registry, or null when it must not be trusted.
 *
 * Read ONCE and then held in memory: `has()` answers from memory on every
 * request. That makes revocation immediate in THIS process and invisible to
 * any other — the deployment runs one instance per file, and that is an
 * assumption, not a coincidence (auth review 2026-11-05). A second instance on
 * the same file needs a re-read before `has()` first.
 *
 * Null disables per-user access entirely — the caller treats it the way it
 * treats missing key material. A missing FILE is not that case: it is the
 * first start, and yields an empty registry that writes itself on first use.
 */
export async function openRegistry(path: string): Promise<AccessRegistry | null> {
  const entries = new Map<string, RegistryEntry>();

  let raw: string | null = null;
  try {
    raw = await readFile(path, 'utf8');
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== 'ENOENT') {
      log.error('access registry is unreadable — per-user access stays off', { path, code });
      return null;
    }
  }

  if (raw !== null) {
    const parsed = parseEntries(raw);
    if (!parsed) {
      log.error('access registry is malformed — per-user access stays off', { path });
      return null;
    }
    for (const e of parsed) entries.set(e.jti, e);
  } else {
    // A first start WRITES the empty registry instead of assuming it could.
    //
    // Reading proves nothing about writing, and the two come apart in exactly
    // the deployment this ships for: a Docker named volume mounted where the
    // image never created the directory belongs to root, while the container
    // runs as `node` (measured 2026-08-05). The read then answers ENOENT — "first
    // start" — the server logs `access blocks are enabled`, and the failure waits
    // for the first person who tries to fetch a block. One line in the boot log
    // is worth more than a correct-looking startup and a 500 for a stranger.
    try {
      // Write-then-rename like every later commit: a stop signal between
      // creating the file and filling it would leave an EMPTY file, which the
      // next start reads as malformed and answers by switching the feature off.
      await writeSynced(path, JSON.stringify({ v: FORMAT_VERSION, entries: [] }));
      log.info('access registry created — starting empty', { path });
    } catch (err) {
      log.error('access registry cannot be written — per-user access stays off', {
        path,
        code: (err as NodeJS.ErrnoException).code,
      });
      return null;
    }
  }

  // Writes are serialised through this chain because they share one temp path:
  // unserialised, writer B could still be filling the temp file when writer A
  // renames it into place, publishing a half-written registry — which then
  // fails closed on the next start and locks everyone out.
  //
  // NOT covered by a test, deliberately: provoking that interleaving needs
  // timing a unit test cannot pin down without becoming flaky, and a flaky test
  // is worse than an honest gap. The concurrency test pins the OUTCOME — no
  // entry is lost — not the mechanism.
  let pending: Promise<void> = Promise.resolve();

  /**
   * Change the map and write the result, serialised against every other write.
   *
   * `mutate` runs INSIDE the serialised section and returns how to undo itself,
   * or null when nothing changed (then nothing is written either). Both
   * properties are the point:
   *
   * - Mutating inside means a writer always serialises committed state, so an
   *   undo cannot strand a change another writer already persisted.
   * - Undoing on failure keeps this an allow-list that never grants what it
   *   could not record. An entry that lived in memory while missing from the
   *   file would authenticate until the next restart and then stop for no
   *   visible reason.
   */
  function commit(mutate: () => (() => void) | null): Promise<void> {
    const run = async (): Promise<void> => {
      const undo = mutate();
      if (!undo) return;
      try {
        const body = JSON.stringify({ v: FORMAT_VERSION, entries: [...entries.values()] });
        // Write-then-rename: a crash mid-write leaves the previous registry
        // intact rather than a truncated file that would fail closed on restart.
        await writeSynced(path, body);
      } catch (err) {
        undo();
        throw err;
      }
    };
    // `then(run, run)` — the second handler is why a transient failure stays
    // transient. With `then(run)` alone a single rejected write is carried
    // forward forever: every later call would return that same rejection
    // without attempting anything, so a full disk at the wrong moment would
    // disable REVOCATION until someone restarted the server.
    pending = pending.then(run, run);
    return pending;
  }

  /**
   * Drop the oldest entries of one label AND ONE KIND until that class is back
   * at the cap (the caller's undo restores a snapshot, not a list). Oldest by
   * INSERTION order: a `Map` preserves it and a reopened registry inherits the
   * file's order, so the order entries were registered in is already there and
   * needs no sort — and no tie-break for two blocks fetched in the same second.
   *
   * Scoped to the kind because the two are not interchangeable — see
   * `MAX_BLOCKS_PER_LABEL`. Only the class of the entry just added can have
   * grown, so pruning that one is both sufficient and the whole job.
   *
   * Only ever called from `add`, so a file that already exceeds the cap (an
   * operator's edit, a lowered constant) is left alone until that account
   * fetches its next block. Pruning at load would mean opening the registry
   * could write, and `openRegistry` is also the read path.
   *
   * EXPIRED entries never count against the cap, whatever their kind (R1): they
   * grant nothing, and a widget's OAuth login carries no `k` — it counts with
   * the pasted blocks, so a login every 12 h would otherwise retire the block
   * the person pasted into their AI host within a week. A separate `k` for
   * widgets would avoid that too, but an unknown `k` fails an old build's
   * registry closed, which a rollback must not do. They are deleted only once
   * past `EXPIRED_KEPT_S`, because until then they are the record that stops
   * the id being issued again.
   */
  function evictOldest(account: string, kind: RegistryEntry['k'], nowMs: number): void {
    const expired = (e: RegistryEntry) => e.exp !== undefined && nowMs >= e.exp * 1000;
    for (const e of [...entries.values()]) {
      if (accountOf(e) === account && e.exp !== undefined && nowMs >= (e.exp + EXPIRED_KEPT_S) * 1000) entries.delete(e.jti);
    }
    const mine = [...entries.values()].filter((e) => accountOf(e) === account && e.k === kind && !expired(e));
    const excess = mine.length - MAX_BLOCKS_PER_LABEL;
    for (const e of excess > 0 ? mine.slice(0, excess) : []) entries.delete(e.jti);
  }

  return {
    has: (jti, nowMs = Date.now()) => {
      const e = entries.get(jti);
      return e !== undefined && (e.exp === undefined || nowMs < e.exp * 1000);
    },
    known: (jti) => entries.has(jti),
    expiresAt: (jti) => entries.get(jti)?.exp,
    labelOf: (jti) => entries.get(jti)?.label,
    async add(entry) {
      await commit(() => {
        // Undo restores the WHOLE map in its old order: re-inserting evicted
        // entries one by one would file them as the newest, and the next
        // eviction after a failed write would then retire the wrong blocks.
        const before = [...entries.entries()];
        // Delete first, so a re-added (renewed) id counts as the newest — `set`
        // on an existing key keeps its old position.
        entries.delete(entry.jti);
        entries.set(entry.jti, entry);
        evictOldest(accountOf(entry), entry.k, Date.now());
        return () => {
          entries.clear();
          for (const [jti, e] of before) entries.set(jti, e);
        };
      });
    },
    async remove(jti) {
      let removed = false;
      await commit(() => {
        const previous = entries.get(jti);
        if (!previous) return null;
        entries.delete(jti);
        removed = true;
        return () => { entries.set(jti, previous); removed = false; };
      });
      return removed;
    },
    async noteAccount(jti, account) {
      await commit(() => {
        const previous = entries.get(jti);
        if (!previous || previous.acct !== undefined) return null;
        // `set` on an existing key keeps its position: the entry does not become the newest.
        entries.set(jti, { ...previous, acct: account });
        return () => { entries.set(jti, previous); };
      });
    },
    async removeByLabel(account, typed) {
      let count = 0;
      await commit(() => {
        const mine = [...entries.values()].filter((e) =>
          accountOf(e) === account || (typed !== undefined && e.acct === undefined && e.label === typed));
        if (!mine.length) return null;
        for (const e of mine) entries.delete(e.jti);
        count = mine.length;
        // Undo restores every entry AND the reported count, so a write that
        // fails leaves the caller with "nothing was revoked" rather than a
        // number for a change that never reached the file.
        return () => {
          for (const e of mine) entries.set(e.jti, e);
          count = 0;
        };
      });
      return count;
    },
  };
}
