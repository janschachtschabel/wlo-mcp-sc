/**
 * services/write/suggestions.ts – proposals about a node, and the decision on them.
 *
 * `/suggestions/v1` is a staging area plus a record of who decided what. It is
 * NOT a mechanism that applies anything: measured on staging (2026-08-01), a
 * suggestion moved to `ACCEPTED` left the node's property absent. Applying the
 * value stays the caller's job, through the ordinary write pipeline with its
 * read-back — which is why nothing in this module touches a node.
 *
 * Two shapes, one endpoint: `POST` answers with an ARRAY of suggestions, `GET`
 * with a MAP keyed by propertyId. Both are measured. A reader written for one
 * shape reports "no suggestions" for a node that has several, so the parsing
 * lives in a single helper that accepts either.
 */

import { BASE_URL, WLO_REPOSITORY_URL } from '../../wlo-config.js';
import { wloFetch, HEADERS } from '../../wlo-fetch.js';
import { readJson } from '../../read-json.js';
import { log } from '../../logger.js';
import { failureDetail } from './nodes.js';
import { toRepositoryPath, type PreparedRequest } from './prepared-request.js';

export type SuggestionStatus = 'PENDING' | 'ACCEPTED' | 'DECLINED';

export interface Suggestion {
  id: string;
  propertyId: string;
  value: string;
  status: SuggestionStatus;
  /** Why the proposer suggests it — shown to whoever decides. */
  description?: string;
  confidence?: number;
}

export interface SuggestionDraft {
  propertyId: string;
  value: string;
  /** Mandatory upstream, and the part that makes a proposal reviewable. */
  description: string;
  confidence?: number;
}

export type CreateOutcome =
  | { ok: true; suggestions: Suggestion[] }
  | { ok: false; detail: string };

/**
 * Everything this server proposes carries the same version tag. The parameter is
 * mandatory upstream and groups a batch for `DELETE …?version=`; since we do not
 * offer that batch delete, one stable value is honest and one fewer knob to get
 * wrong.
 */
const VERSION = 'wlo-mcp';

/**
 * The provenance, fixed at creation. `PATCH` carries no `type`, so this can
 * never be changed afterwards — which is the point: `type` records that a model
 * wrote the proposal, `status` records that a human approved it. Overwriting the
 * first would not add the approval, it would erase the authorship.
 */
const TYPE = 'AI';

function suggestionPath(nodeId: string, params: URLSearchParams): string {
  return `${BASE_URL}/suggestions/v1/-home-/${encodeURIComponent(nodeId)}?${params}`;
}

/**
 * The query every creation carries. One helper rather than two literals: it is
 * where the provenance lives, and a second copy could drift into a proposal that
 * no longer says a model wrote it.
 */
function createParams(): URLSearchParams {
  return new URLSearchParams({ type: TYPE, version: VERSION });
}

/**
 * The proposal request as data, for someone else to send (E2).
 *
 * The embedded case: a repository page stores the proposal with the visitor's
 * own session, so it needs to be told which call to make. Built from the same
 * `suggestionPath` and `createParams` as {@link createSuggestions} — the
 * provenance query must not gain a second copy in a browser bundle.
 *
 * One honest difference to executing it here: the repository answers the POST
 * with the ids it assigned, and in this direction nobody reads that answer. The
 * caller therefore learns THAT the proposals were stored, not under which ids —
 * `wlo_list_suggestions` shows them.
 */
export function createSuggestionsRequest(
  nodeId: string, drafts: SuggestionDraft[],
): PreparedRequest {
  return {
    method: 'POST',
    path: toRepositoryPath(suggestionPath(nodeId, createParams()), WLO_REPOSITORY_URL),
    body: JSON.stringify(drafts),
  };
}

function toSuggestion(raw: unknown): Suggestion | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const id = typeof r['id'] === 'string' ? r['id'] : '';
  const propertyId = typeof r['propertyId'] === 'string' ? r['propertyId'] : '';
  if (!id || !propertyId) return null;
  return {
    id,
    propertyId,
    value: String(r['value'] ?? ''),
    status: (typeof r['status'] === 'string' ? r['status'] : 'PENDING') as SuggestionStatus,
    ...(typeof r['description'] === 'string' ? { description: r['description'] } : {}),
    ...(typeof r['confidence'] === 'number' ? { confidence: r['confidence'] } : {}),
  };
}

/**
 * Read either measured shape: a bare array, `{suggestions: [...]}`, or
 * `{suggestions: {propertyId: [...]}}`. Entries that carry neither an id nor a
 * property are dropped — they cannot be decided on, and listing them would offer
 * the user an action that cannot be taken.
 */
function parseSuggestions(payload: unknown): Suggestion[] {
  const container = Array.isArray(payload)
    ? payload
    : (payload as { suggestions?: unknown } | null)?.suggestions;

  const rows: unknown[] = Array.isArray(container)
    ? container
    : typeof container === 'object' && container !== null
      ? Object.values(container as Record<string, unknown>).flatMap(v => (Array.isArray(v) ? v : [v]))
      : [];

  return rows.map(toSuggestion).filter((s): s is Suggestion => s !== null);
}

/** Store proposals for a node. Nothing on the node itself changes. */
export async function createSuggestions(
  nodeId: string,
  drafts: SuggestionDraft[],
): Promise<CreateOutcome> {
  const res = await wloFetch(suggestionPath(nodeId, createParams()), {
    method: 'POST',
    headers: HEADERS,
    body: JSON.stringify(drafts),
  });
  if (!res.ok) return { ok: false, detail: await failureDetail(res) };

  const body = await readJson<unknown>(res, 'createSuggestions');
  if (body === null) {
    // The POST was accepted, so proposals may exist; `suggestions: []` would
    // report the opposite of that to the confirm step.
    return {
      ok: false,
      detail: 'Das Repository hat die Vorschläge angenommen, aber keine verwertbare Antwort zurückgegeben.',
    };
  }
  const suggestions = parseSuggestions(body);
  log.info('suggestions stored', { nodeId, count: suggestions.length });
  return { ok: true, suggestions };
}

/**
 * List a node's proposals.
 *
 * Throws when the node cannot be read. An empty array is the claim "there is
 * nothing to review"; when the truth is "we could not look", that claim sends a
 * curator away from work that exists.
 */
export async function listSuggestions(nodeId: string, status?: SuggestionStatus): Promise<Suggestion[]> {
  const params = new URLSearchParams();
  if (status) params.set('status', status);
  const res = await wloFetch(suggestionPath(nodeId, params), {
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) {
    throw new Error(
      `Die Vorschläge zu „${nodeId}“ konnten nicht gelesen werden (${await failureDetail(res)}). ` +
        'Ob es welche gibt, ist damit offen.',
    );
  }
  const body = await readJson<unknown>(res, 'listSuggestions');
  if (body === null) {
    throw new Error(
      `Die Vorschläge zu „${nodeId}“ konnten nicht ausgewertet werden — das Repository hat keine ` +
        'verwertbare Antwort geliefert. Ob es welche gibt, ist damit offen.',
    );
  }
  return parseSuggestions(body);
}

/** Record a decision. Answers `null` on success or the failure detail. */
export async function setSuggestionStatus(
  nodeId: string,
  id: string,
  status: SuggestionStatus,
): Promise<string | null> {
  const params = new URLSearchParams({ id, status });
  const res = await wloFetch(suggestionPath(nodeId, params), {
    method: 'PATCH',
    headers: HEADERS,
  });
  if (!res.ok) return await failureDetail(res);
  log.info('suggestion decided', { nodeId, id, status });
  return null;
}
