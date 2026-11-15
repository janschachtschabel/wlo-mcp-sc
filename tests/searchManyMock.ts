/**
 * searchManyMock.ts – Test helper (NOT a test file). A repository stub for the
 * batch search that can ANSWER LATE and counts how many calls are open at once —
 * the two things `installFetchMock` (synchronous handler) cannot express.
 */

import { clearShortCaches } from '../src/short-cache.js';
import type { WloNode } from '../src/wlo-api.js';

export interface SeenSearch {
  /** `ngsearchword` / `cclom:title` / `cclom:general_keyword` — which query variant asked. */
  variant: string;
  /** The variant's search text, lower-cased (keyword variant: its terms joined by a space). */
  word: string;
  maxItems: number;
  criteria: Array<{ property: string; values: string[] }>;
}

export interface SearchReply {
  nodes?: WloNode[];
  status?: number;
  headers?: Record<string, string>;
  /** Answer after this many milliseconds. */
  delayMs?: number;
  /** Answer when this settles instead — the test decides WHEN, no clock involved. */
  until?: Promise<unknown>;
}

export interface ManyMock {
  searches: SeenSearch[];
  /** The most repository calls open at the same moment. */
  maxOpen: () => number;
  restore: () => void;
}

const VARIANT_PROPS = ['ngsearchword', 'cclom:title', 'cclom:general_keyword'];

export function installManyMock(reply: (seen: SeenSearch) => SearchReply): ManyMock {
  const real = globalThis.fetch;
  clearShortCaches();
  const searches: SeenSearch[] = [];
  let open = 0;
  let maxOpen = 0;
  globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : String((input as { url?: string })?.url ?? input);
    if (!url.includes('/ngsearch')) return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
    const criteria = JSON.parse(String(init?.body ?? '{}')).criteria as SeenSearch['criteria'];
    const lead = criteria.find(c => VARIANT_PROPS.includes(c.property));
    const seen: SeenSearch = {
      variant: lead?.property ?? '',
      word: (lead?.values ?? []).join(' ').toLowerCase(),
      maxItems: Number(new URL(url).searchParams.get('maxItems') ?? '0'),
      criteria,
    };
    searches.push(seen);
    const { nodes = [], status = 200, headers = {}, delayMs = 0, until } = reply(seen);
    open++;
    maxOpen = Math.max(maxOpen, open);
    try {
      // Always one turn of the timer queue, so that calls sent together overlap.
      await (until ?? new Promise(resolve => setTimeout(resolve, delayMs)));
    } finally {
      open--;
    }
    const body = JSON.stringify({ nodes, pagination: { total: nodes.length, from: 0, count: nodes.length } });
    return new Response(body, { status, headers: { 'content-type': 'application/json', ...headers } });
  }) as typeof fetch;
  return { searches, maxOpen: () => maxOpen, restore: () => { globalThis.fetch = real; } };
}

/** Only the full-text variant answers — one list per query, whatever the variant count. */
export function fullTextOnly(byWord: Record<string, SearchReply>): (seen: SeenSearch) => SearchReply {
  return seen => {
    const own = byWord[seen.word] ?? {};
    // Failures and delays hit every variant; the hits come from one.
    return seen.variant === 'ngsearchword' ? own : { ...own, nodes: [] };
  };
}
