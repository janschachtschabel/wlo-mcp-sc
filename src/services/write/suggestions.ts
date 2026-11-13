/**
 * services/write/suggestions.ts – proposals about a node, and the decision on them.
 *
 * `/suggestions/v1` is a staging area plus a record of who decided what. It is
 * NOT a mechanism that applies anything: measured on staging (2026-08-01), a
 * suggestion moved to `ACCEPTED` left the node's property absent. Applying the
 * value stays the caller's job, through the ordinary write pipeline with its
 * read-back — which is why nothing in this module WRITES a node.
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
import { failureDetail, resolveWriteTarget } from './nodes.js';
import type { WloNode } from '../../wlo-types.js';
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
  /**
   * `open`: the repository may have stored proposals — a 5xx, or a 200 whose
   * body we could not read. A 4xx (and 429, which is not processed) is a
   * refusal: nothing stored.
   */
  | { ok: false; detail: string; open?: true;
      /** The POST was answered 2xx and still named nothing stored: sent, and not verifiable. */
      accepted?: true };

/** How a status reads to a person. One table: the list and the refusal of a second decision use it. */
export const STATUS_LABEL: Record<string, string> = {
  PENDING: 'offen',
  ACCEPTED: 'angenommen',
  DECLINED: 'abgelehnt',
};

/**
 * Fields that hold SEVERAL values. A proposal carries exactly ONE, so for these
 * it means "add this one": accepting it written as the whole field replaced
 * every subject a record had with the one proposed (audit 2026-11-12, K-8).
 * Removing a value is not something a proposal can express — that is an edit.
 *
 * NOT here, deliberately: author and publisher. Both can hold several entries,
 * but a proposal for them is a statement about who made the material — most
 * often a corrected spelling — and adding that beside the old entry would keep
 * the mistake it was meant to fix. They are replaced, and the preview shows
 * before → after.
 */
export const HOLDS_SEVERAL: ReadonlySet<string> = new Set([
  'cclom:general_keyword',
  'ccm:taxonid',
  'ccm:educationalcontext',
  'ccm:oeh_lrt',
  'ccm:educationalintendedenduserrole',
  'cclom:general_language',
]);

const holds = (property: string, current: string[], value: string): boolean =>
  HOLDS_SEVERAL.has(property)
    // Case-insensitively, like the keyword merge: "mathematik" on a record
    // tagged "Mathematik" is no new value.
    ? current.some(v => v.toLowerCase() === value.toLowerCase())
    : current.length === 1 && current[0] === value;

/** What a field holds once a proposal for it is accepted. */
export function valuesAfterAccept(property: string, current: string[], proposed: string[]): string[] {
  if (!HOLDS_SEVERAL.has(property)) return proposed;
  const out = [...current];
  for (const v of proposed) if (!holds(property, out, v)) out.push(v);
  return out;
}

/**
 * The drafts worth filing: those whose value the record does not hold yet.
 * Decided per VALUE — of two subjects proposed, the one already there is not a
 * decision to put in front of anybody. The single tool and the batch tool both
 * go through here (K-9); they had two rules.
 */
export function newProposals(before: Record<string, string[]>, drafts: SuggestionDraft[]): SuggestionDraft[] {
  // Also against each other: the same value twice in one call ("Optik" and
  // "optik" as keywords, one title two times) is one decision, not two.
  const taken = new Map<string, string[]>();
  return drafts.filter((d) => {
    if (holds(d.propertyId, before[d.propertyId] ?? [], d.value)) return false;
    const mine = taken.get(d.propertyId) ?? [];
    const again = HOLDS_SEVERAL.has(d.propertyId)
      ? mine.some(v => v.toLowerCase() === d.value.toLowerCase())
      : mine.includes(d.value);
    if (again) return false;
    taken.set(d.propertyId, [...mine, d.value]);
    return true;
  });
}

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
  if (!res.ok) return { ok: false, detail: await failureDetail(res), ...(res.status >= 500 ? { open: true as const } : {}) };

  const body = await readJson<unknown>(res, 'createSuggestions');
  if (body === null) {
    // The POST was accepted, so proposals may exist; `suggestions: []` would
    // report the opposite of that to the confirm step.
    return {
      ok: false,
      open: true,
      accepted: true,
      detail: 'Das Repository hat die Vorschläge angenommen, aber keine verwertbare Antwort zurückgegeben.',
    };
  }
  const suggestions = parseSuggestions(body);
  if (suggestions.length === 0) {
    // Asked to store some, answered with none: no proof either way. The single
    // tool printed "Als Vorschlag hinterlegt:" over an empty list here while the
    // batch tool called the same answer unverified (K-9) — it is decided once now.
    return {
      ok: false,
      open: true,
      accepted: true,
      detail: 'Das Repository hat geantwortet, aber keinen der Vorschläge als hinterlegt genannt.',
    };
  }
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

/** A proposal and the node it lies on — which is where its status has to be set. */
export type FiledSuggestion = Suggestion & { at: string };

/**
 * The proposals about a RECORD, wherever they lie.
 *
 * Proposals are filed at the original (K-9), but a caller holds whatever id a
 * listing handed out — often a collection reference. So both nodes are asked:
 * the one named, and the original behind it. Whether the repository resolves a
 * reference id here itself is unmeasured (staging cannot create references at
 * the moment); an id appearing under both is kept once, at the node named.
 */
export async function suggestionsFor(
  node: WloNode, requestedId: string, status?: SuggestionStatus,
): Promise<FiledSuggestion[]> {
  const target = resolveWriteTarget(node, requestedId);
  const ids = target.redirected ? [requestedId, target.targetId] : [requestedId];
  const lists = await Promise.all(ids.map(async at => (await listSuggestions(at, status)).map(x => ({ ...x, at }))));
  const seen = new Set<string>();
  return lists.flat().filter(x => (seen.has(x.id) ? false : (seen.add(x.id), true)));
}

export type DecisionOutcome =
  | { ok: true }
  /** `open`: whether the decision was recorded is not known (a 5xx, or a read-back that did not answer). */
  | { ok: false; detail: string; open: boolean };

/**
 * Record a decision — and read it back.
 *
 * A 200 from this repository is not proof that anything was stored; that is the
 * rule every write here follows, and this one did not (K-10). The status is
 * read again, and only a list that SHOWS the decision makes it taken.
 */
export async function setSuggestionStatus(
  nodeId: string,
  id: string,
  status: SuggestionStatus,
): Promise<DecisionOutcome> {
  const params = new URLSearchParams({ id, status });
  const res = await wloFetch(suggestionPath(nodeId, params), {
    method: 'PATCH',
    headers: HEADERS,
  });
  if (!res.ok) return { ok: false, detail: await failureDetail(res), open: res.status >= 500 };

  let now: Suggestion | undefined;
  try {
    now = (await listSuggestions(nodeId)).find(x => x.id === id);
  } catch (err) {
    return { ok: false, open: true,
      detail: `Die Entscheidung wurde abgeschickt, ließ sich danach aber nicht überprüfen (${err instanceof Error ? err.message : String(err)}).` };
  }
  if (!now) {
    // Not "still open": the proposal is not in the list any more, and what
    // became of it is not something this read can say.
    return { ok: false, open: true,
      detail: 'Die Entscheidung wurde mit Erfolg beantwortet, der Vorschlag steht danach aber nicht mehr in der Liste — ob sie vermerkt wurde, ist offen.' };
  }
  if (now.status !== status) {
    return { ok: false, open: false,
      detail: `Das Repository hat die Entscheidung mit Erfolg beantwortet, der Vorschlag steht aber weiterhin als „${STATUS_LABEL[now.status] ?? 'unbekannt'}“ da.` };
  }
  log.info('suggestion decided', { nodeId, id, status });
  return { ok: true };
}
