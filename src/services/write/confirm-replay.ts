/**
 * services/write/confirm-replay.ts – a redeemed confirmation key answers again
 * with the SAME result (plan 2026-11-07, S3).
 *
 * A chatbot loses an answer to a network error or its own deadline and sends
 * the very same call again. The key was consumed by the first call, so the
 * second met `confirm_unknown` and the person was sent to "look in WLO". Here
 * the first call's result is kept and handed back, marked `replayed`, and
 * nothing is written twice.
 *
 * Three rules shape it.
 *
 * - **Bound to the call's ARGUMENTS, not the change set.** After the first write
 *   the preview reads the NEW state, so the second call's change set is empty
 *   or different — only its arguments are the same. The same rule plans follow
 *   (`plan-runner.ts`). Other arguments with the same key → `mismatch`.
 * - **Bound to the identity.** An answer is never handed to someone else; for a
 *   different identity the key is simply unknown, as before.
 * - **Recorded only when the key was REDEEMED inside the call.** A call that
 *   stopped earlier — a refused input, a timeout while reading the baseline —
 *   wrote nothing and consumed nothing; its retry must reach the tool again,
 *   not get the old refusal. The confirm path marks the redemption
 *   (`markRedeemed`, called by `consumeToken`), the tool seam completes it.
 *
 * In memory, 30 minutes, bounded; the key is held only as a SHA-256 hash. A
 * restart loses it, and a retry then answers `confirm_unknown` as before (F4).
 * No MCP SDK import: this is the write pipeline.
 */

import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash } from 'node:crypto';

/** How long a redeemed key keeps its answer. */
export const REPLAY_TTL_MS = 30 * 60 * 1000;
/** Upper bound on kept answers — fed by an internet-facing endpoint. */
const MAX_REPLAYS = 500;
/**
 * Per identity, so one busy identity — the shared service account above all —
 * cannot push another person's answer out and turn their retry into
 * `confirm_unknown` "nothing written" after a real write (the same reason
 * `confirm.ts` caps tokens per identity). 500 / 50 = ten such identities fill
 * the store before any of them loses an answer to another.
 */
const MAX_REPLAYS_PER_IDENTITY = 50;

interface Entry {
  identity: string;
  argsHash: string;
  state: 'running' | 'done';
  result?: unknown;
  expiresAt: number;
}

interface CallContext { tokenHash: string; argsHash: string; marked: boolean }

const entries = new Map<string, Entry>();
const context = new AsyncLocalStorage<CallContext>();

const hashOf = (value: string) => createHash('sha256').update(value).digest('hex');

/** Stable JSON: object keys sorted at every level, so key order changes nothing. */
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value as object).sort()
      .map(k => [k, canonical((value as Record<string, unknown>)[k])]));
  }
  return value;
}

/** A fingerprint of a call's arguments. */
export function argsHash(args: unknown): string {
  return hashOf(JSON.stringify(canonical(args)) ?? '');
}

/** Run one tool call with `token` as the key it may redeem. */
export function withReplayContext<T>(token: string, args: unknown, fn: () => Promise<T>): Promise<T> {
  return context.run({ tokenHash: hashOf(token), argsHash: argsHash(args), marked: false }, fn);
}

/**
 * Drop expired answers, then the oldest DONE answers of `identity` beyond its
 * cap, then the oldest done answers overall beyond the total. A `running` entry
 * is never evicted: it is a write in flight, and forgetting it would let the
 * retry run the handler a second time.
 */
function prune(now: number, identity: string): void {
  for (const [key, entry] of entries) if (entry.expiresAt <= now) entries.delete(key);
  const evictOldestDone = (cap: number, of?: string) => {
    let count = 0;
    for (const e of entries.values()) if (of === undefined || e.identity === of) count++;
    for (const [key, e] of entries) {
      if (count < cap) return;
      if (e.state === 'done' && (of === undefined || e.identity === of)) { entries.delete(key); count--; }
    }
  };
  evictOldestDone(MAX_REPLAYS_PER_IDENTITY, identity);
  evictOldestDone(MAX_REPLAYS);
}

/**
 * The key was redeemed in the current call: from now on a second presentation
 * waits for this call's answer instead of meeting a consumed key. Does nothing
 * outside a call context, or for a key the context was not opened for.
 */
export function markRedeemed(token: string, identity: string, now: number = Date.now()): void {
  const ctx = context.getStore();
  const tokenHash = hashOf(token);
  if (!ctx || ctx.tokenHash !== tokenHash) return;
  prune(now, identity);
  entries.set(tokenHash, { identity, argsHash: ctx.argsHash, state: 'running', expiresAt: now + REPLAY_TTL_MS });
  ctx.marked = true;
}

/** Store the current call's answer — only if its key was redeemed in it. */
export function completeReplay(result: unknown): void {
  const ctx = context.getStore();
  if (!ctx?.marked) return;
  const entry = entries.get(ctx.tokenHash);
  if (entry) { entry.state = 'done'; entry.result = result; }
}

/** Was the key redeemed inside the current call? From then on every answer is kept. */
export function redeemedInCall(): boolean {
  return context.getStore()?.marked === true;
}

export type ReplayLookup =
  | { kind: 'none' } | { kind: 'running' } | { kind: 'done'; result: unknown } | { kind: 'mismatch' };

/** What a presentation of `token` by `identity` with these arguments finds. */
export function lookupReplay(token: string, identity: string, args: string, now: number = Date.now()): ReplayLookup {
  const entry = entries.get(hashOf(token));
  if (!entry || entry.expiresAt <= now || entry.identity !== identity) return { kind: 'none' };
  if (entry.argsHash !== args) return { kind: 'mismatch' };
  return entry.state === 'done' ? { kind: 'done', result: entry.result } : { kind: 'running' };
}

/** `lookupReplay` with the arguments of the current call (for the confirm path). */
export function lookupReplayInCall(token: string, identity: string, now: number = Date.now()): ReplayLookup {
  const ctx = context.getStore();
  return ctx ? lookupReplay(token, identity, ctx.argsHash, now) : { kind: 'none' };
}
