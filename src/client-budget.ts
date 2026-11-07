/**
 * client-budget.ts – who a request is counted as, and what counts
 * (plan 2026-11-07-chatbot-anbindung-stabilitaet.md, S1/S2).
 *
 * Two facts shape it. A chatbot backend is ONE address for all its users, so an
 * address budget throttles every person at once; a trusted client therefore
 * presents a secret key (`X-WLO-Client-Key`) and is counted in its own bucket at
 * its own rate — addresses change, a key does not. And only `tools/call` reaches
 * edu-sharing: `initialize` and `notifications/*` of a stateless server cost
 * nothing upstream, so the tool budget counts tool calls alone (the transport
 * keeps a looser bound on all POSTs, see `http-app.ts`).
 *
 * No I/O and no clock of its own (the caller passes `now`), so every rule here
 * is tested offline.
 */

import { createHash } from 'node:crypto';

import { createRateLimiter, type RateLimiter } from './rate-limit.js';

/** Shorter keys are refused: a key is a bearer secret, and a short one is guessable. */
export const MIN_CLIENT_KEY_LENGTH = 32;

/** The header a trusted client sends. Never logged, never echoed. */
export const CLIENT_KEY_HEADER = 'x-wlo-client-key';

export interface TrustedClient { name: string; rpm: number }

const hashKey = (key: string) => createHash('sha256').update(key).digest('hex');

/**
 * Parse `TRUSTED_CLIENT_KEYS`: comma-separated `name:rpm:key`. Only the first two
 * colons separate fields, so a key may contain colons. Entries are kept by the
 * SHA-256 of the key — the key itself is not retained — and a refused entry is
 * reported by its name only, so a startup warning cannot leak a secret.
 */
export function parseTrustedClientKeys(raw: string | undefined): {
  clients: Map<string, TrustedClient>; rejected: string[];
} {
  const clients = new Map<string, TrustedClient>();
  const rejected: string[] = [];
  const names = new Set<string>();
  const entries = (raw ?? '').split(',').map(e => e.trim()).filter(Boolean);
  for (const [index, entry] of entries.entries()) {
    const first = entry.indexOf(':');
    const second = first < 0 ? -1 : entry.indexOf(':', first + 1);
    // An entry without any colon may be a pasted KEY: `rejected` goes into the
    // startup log, so it is named by its position, never by its text.
    if (first < 0) { rejected.push(`entry #${index + 1}`); continue; }
    const name = entry.slice(0, first).trim();
    if (second < 0) { rejected.push(name); continue; }
    const rpm = Number(entry.slice(first + 1, second).trim());
    const key = entry.slice(second + 1).trim();
    if (!name || !Number.isInteger(rpm) || rpm <= 0 || key.length < MIN_CLIENT_KEY_LENGTH) {
      rejected.push(name);
      continue;
    }
    // Two entries of one name would share the bucket `client:<name>` with the
    // last rate silently winning — refused, so the operator sees it.
    if (names.has(name)) { rejected.push(`${name} (duplicate name)`); continue; }
    names.add(name);
    clients.set(hashKey(key), { name, rpm });
  }
  return { clients, rejected };
}

/**
 * The bucket a request is counted in. A known key → the client's own bucket and
 * rate; anything else — no header, an unknown or repeated one — is the address,
 * exactly as before keys existed.
 */
export function budgetBucket(
  header: string | string[] | undefined, ip: string, clients: ReadonlyMap<string, TrustedClient>,
): { key: string; rpm?: number; kind: 'client' | 'address' } {
  const client = typeof header === 'string' && header ? clients.get(hashKey(header.trim())) : undefined;
  return client
    ? { key: `client:${client.name}`, rpm: client.rpm, kind: 'client' }
    : { key: ip, kind: 'address' };
}

/** How many `tools/call` messages a parsed JSON-RPC body carries (a batch counts each). */
export function countToolCalls(body: unknown): number {
  const messages = Array.isArray(body) ? body : [body];
  return messages.filter(m =>
    typeof m === 'object' && m !== null && (m as { method?: unknown }).method === 'tools/call').length;
}

/**
 * The body of a 429: a JSON-RPC error, because a client speaking JSON-RPC read the
 * old free-text `{"error": "…"}` as a network failure (chatbot finding B3).
 * −32029 sits in the range JSON-RPC reserves for server errors; `data.code` is
 * what a program branches on — `rate_limited` for the request budget,
 * `too_many_logins` for the login-guessing guard — and `data.retryAfter` repeats
 * the `Retry-After` header.
 */
export function rateLimitedBody(
  retryAfter: number, message: string, code: 'rate_limited' | 'too_many_logins' = 'rate_limited',
): string {
  return JSON.stringify({
    jsonrpc: '2.0',
    id: null,
    error: { code: -32029, message, data: { code, retryAfter } },
  });
}

/**
 * The same refusal for a REST surface (`/api`, `/auth/status`), whose successful
 * answers are plain JSON: the human text stays in `error`, beside the code a
 * program branches on and the wait the `Retry-After` header repeats.
 */
export function restRateLimitedBody(
  retryAfter: number, message: string, code: 'rate_limited' | 'too_many_logins' = 'rate_limited',
): string {
  return JSON.stringify({ error: message, code, retryAfter });
}

/**
 * How many POSTs of any kind a bucket may send per tool call it is allowed. Three
 * because a client that opens a session per call sends initialize +
 * notifications/initialized + tools/call; protocol messages never reach
 * edu-sharing, but without any bound they would be a free way to flood the
 * process.
 */
export const PROTOCOL_FACTOR = 3;

export interface ClientBudgets {
  clients: ReadonlyMap<string, TrustedClient>;
  /** The tool-call limiter of the client with this bucket key (`client:<name>`). */
  tool(bucketKey: string): RateLimiter | undefined;
  /** The all-POST limiter of that client, at `PROTOCOL_FACTOR` × its rate. */
  protocol(bucketKey: string): RateLimiter | undefined;
}

/** One pair of limiters per trusted client, each at the client's own rate. */
export function createClientBudgets(clients: ReadonlyMap<string, TrustedClient>): ClientBudgets {
  const tool = new Map<string, RateLimiter>();
  const protocol = new Map<string, RateLimiter>();
  for (const { name, rpm } of clients.values()) {
    tool.set(`client:${name}`, createRateLimiter(rpm));
    protocol.set(`client:${name}`, createRateLimiter(rpm * PROTOCOL_FACTOR));
  }
  return { clients, tool: k => tool.get(k), protocol: k => protocol.get(k) };
}
