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
 * asserts the written file carries exactly `jti`, `label` and `iat`.
 *
 * The only module in this project that writes to disk at runtime. The container
 * therefore mounts one writable volume and keeps `read_only: true` for
 * everything else.
 */

import { readFile, rename, writeFile } from 'node:fs/promises';
import { log } from '../logger.js';

export interface RegistryEntry {
  /** Access id, as carried inside the block's authenticated payload. */
  jti: string;
  /** WLO user name, so the operator can tell whose access an entry is. */
  label: string;
  /** Issued-at, seconds. */
  iat: number;
}

export interface AccessRegistry {
  has(jti: string): boolean;
  add(entry: RegistryEntry): Promise<void>;
  remove(jti: string): Promise<boolean>;
}

/** Bumped only if the on-disk shape changes; an unknown value fails closed. */
const FORMAT_VERSION = 1;

/**
 * How many blocks one WLO account may have listed at a time.
 *
 * A bound is needed because nothing else ever removes an entry: revoking one
 * takes the ACCESS ID, and the only place that id exists is inside the block —
 * so a block someone fetched and lost stays valid for ever, and a working login
 * could otherwise add an entry per request to a file rewritten in full each time.
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
 */
export const MAX_BLOCKS_PER_LABEL = 10;

function isEntry(value: unknown): value is RegistryEntry {
  if (typeof value !== 'object' || value === null) return false;
  const e = value as Record<string, unknown>;
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
      await writeFile(path, JSON.stringify({ v: FORMAT_VERSION, entries: [] }), 'utf8');
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
        const temp = `${path}.tmp`;
        // Write-then-rename: a crash mid-write leaves the previous registry
        // intact rather than a truncated file that would fail closed on restart.
        await writeFile(temp, body, 'utf8');
        await rename(temp, path);
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
   * Drop this label's oldest entries until it is back at the cap, and report
   * what went so the caller can undo it. Oldest by INSERTION order: a `Map`
   * preserves it and a reopened registry inherits the file's order, so the order
   * entries were registered in is already there and needs no sort — and no
   * tie-break for two blocks fetched in the same second.
   *
   * Only ever called from `add`, so a file that already exceeds the cap (an
   * operator's edit, a lowered constant) is left alone until that account
   * fetches its next block. Pruning at load would mean opening the registry
   * could write, and `openRegistry` is also the read path.
   */
  function evictOldest(label: string): [string, RegistryEntry][] {
    const mine = [...entries.values()].filter((e) => e.label === label);
    const excess = mine.length - MAX_BLOCKS_PER_LABEL;
    if (excess <= 0) return [];
    const dropped: [string, RegistryEntry][] = [];
    for (const e of mine.slice(0, excess)) {
      entries.delete(e.jti);
      dropped.push([e.jti, e]);
    }
    return dropped;
  }

  return {
    has: (jti) => entries.has(jti),
    async add(entry) {
      await commit(() => {
        const previous = entries.get(entry.jti);
        entries.set(entry.jti, entry);
        const evicted = evictOldest(entry.label);
        return () => {
          for (const [jti, e] of evicted) entries.set(jti, e);
          if (previous) entries.set(entry.jti, previous); else entries.delete(entry.jti);
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
  };
}
