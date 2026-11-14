/**
 * services/write/collection-proposals.ts – proposing a material for a
 * collection, and deciding such a proposal (chatbot team, S8, 2026-11-14).
 *
 * The repository's own mechanism for "I may read this collection, not write
 * it" — the counterpart of the metadata suggestions. Measured on staging with
 * two accounts (`npm run measure:moves`, and a second run the same day), and
 * every line is a rule here:
 *
 * - Whether the caller may WRITE a collection is on its DTO: `access` holds
 *   `Write`. With read but no write permission, a plain filing answers 403 and
 *   `PUT …/references/{material}?asProposal=true` answers 200. Without read
 *   permission both answer 403.
 * - A proposal creates a `ccm:collection_proposal` node, NOT a reference: the
 *   material is not in the collection.
 * - The proposer cannot read it back: the proposals listing needs write
 *   permission (403), and the usage lookup shows nothing. What IS observable
 *   is that the same PUT again answers 409 `already proposed` — so that is the
 *   read-back. A 409 on the first try means it was proposed before; that
 *   holds after a DECLINE too, which blocks the pair for good.
 * - Accepting is TWO writes, like a metadata suggestion: file the material,
 *   and only then set `ccm:collection_proposal_status` on the proposal node.
 *   The filing alone leaves it PENDING; the status alone files nothing. A
 *   writer who is not an admin may list and decide (measured).
 */

import { BASE_URL } from '../../wlo-config.js';
import { wloFetch, HEADERS } from '../../wlo-fetch.js';
import { readJson } from '../../read-json.js';
import { readNodeMetadata } from '../../wlo-node.js';
import type { WloNode } from '../../wlo-types.js';
import { nodeTitle } from '../../node-match.js';
import { sanitizeText } from '../../text-sanitize.js';
import { log } from '../../logger.js';
import { addToCollection } from './collections.js';
import { isAlreadyFiled } from './create-filing.js';
import { failureDetail, setProperty } from './nodes.js';
import type { MutationOutcome } from './verify.js';

export const PROPOSAL_STATUS_PROPERTY = 'ccm:collection_proposal_status';
export type ProposalStatus = 'PENDING' | 'ACCEPTED' | 'DECLINED';
const PAGE = 100;
/** Proposals read per collection and status. More than this is said, not guessed at. */
export const PROPOSALS_MAX = 300;

/**
 * May the caller write this collection? `null` when the DTO does not say —
 * then nothing is assumed, and the filing is tried as it always was.
 */
export function mayWrite(node: Pick<WloNode, 'access'>): boolean | null {
  return Array.isArray(node.access) ? node.access.includes('Write') : null;
}

const proposalPath = (collection: string, nodeId: string) =>
  `${BASE_URL}/collection/v1/collections/-home-/${encodeURIComponent(collection)}/references/${encodeURIComponent(nodeId)}?asProposal=true`;

export type ProposeOutcome =
  | { status: 'proposed' }
  /** It was proposed before — pending, accepted or declined; the repository does not say which to a proposer. */
  | { status: 'already_proposed' }
  | { status: 'unverified'; detail: string }
  | { status: 'failed'; detail: string; httpStatus: number };

/** Propose `nodeId` for `collection` and confirm it the only way a proposer can. */
export async function proposeForCollection(collection: string, nodeId: string): Promise<ProposeOutcome> {
  const put = () => wloFetch(proposalPath(collection, nodeId), { method: 'PUT', headers: HEADERS });
  const first = await put();
  if (first.status === 409) return { status: 'already_proposed' };
  if (!first.ok) return { status: 'failed', detail: await failureDetail(first), httpStatus: first.status };
  log.info('material proposed for a collection', { collection, nodeId });
  // The read-back (see the head of this file): the same request must now be
  // refused as a duplicate. It IS a write request — measured to answer 409 and
  // create nothing; should a repository ever answer 200 here, that is reported
  // as not confirmed, and may have left a second proposal.
  const again = await put();
  if (again.status === 409) return { status: 'proposed' };
  return { status: 'unverified', detail: again.ok
    ? 'Der Vorschlag wurde angenommen, ließ sich aber nicht als vorhanden bestätigen.'
    : `Der Vorschlag wurde angenommen; die Kontrolle danach schlug fehl (${await failureDetail(again)}).` };
}

export interface Proposal {
  /** The proposed material. */
  nodeId: string;
  title: string;
  /** The `ccm:collection_proposal` node — what a decision is written on. */
  proposalId: string;
  status: ProposalStatus;
  /** False when the caller cannot read the proposed material itself. */
  accessible?: boolean;
}

export type ProposalList =
  | { ok: true; proposals: Proposal[]; truncated: boolean }
  | { ok: false; httpStatus: number; detail: string };

interface ProposalDto extends WloNode { proposal?: WloNode; status?: string; accessible?: boolean }

/** The proposals of one collection in one status. Needs write permission on the collection. */
export async function listProposals(collection: string, status: ProposalStatus): Promise<ProposalList> {
  const proposals: Proposal[] = [];
  for (let skip = 0; skip < PROPOSALS_MAX; skip += PAGE) {
    const res = await wloFetch(
      `${BASE_URL}/collection/v1/collections/-home-/${encodeURIComponent(collection)}/children/proposals?status=${status}&maxItems=${PAGE}&skipCount=${skip}`,
      { headers: { Accept: 'application/json' } },
    );
    if (!res.ok) return { ok: false, httpStatus: res.status, detail: await failureDetail(res) };
    const data = await readJson<{ nodes?: ProposalDto[] }>(res, 'listProposals');
    if (!data) return { ok: false, httpStatus: 0, detail: 'Die Antwort des Repositorys war nicht lesbar.' };
    const nodes = data.nodes ?? [];
    for (const n of nodes) {
      const nodeId = n.ref?.id;
      const proposalId = n.proposal?.ref?.id;
      if (!nodeId || !proposalId) continue;
      proposals.push({
        nodeId, proposalId, status,
        title: sanitizeText(nodeTitle(n) || nodeId),
        ...(n.accessible === false ? { accessible: false } : {}),
      });
    }
    if (nodes.length < PAGE) return { ok: true, proposals, truncated: false };
  }
  return { ok: true, proposals, truncated: true };
}

/**
 * Write the decision on the proposal node and read it back — from the node
 * itself where it can be read, else from the listing of that status (which is
 * capped, so it can only confirm, never deny, past its bound).
 */
async function setProposalStatus(collection: string, proposal: Proposal, to: 'ACCEPTED' | 'DECLINED'): Promise<MutationOutcome> {
  const failure = await setProperty(proposal.proposalId, PROPOSAL_STATUS_PROPERTY, [to]);
  if (failure) return { status: 'failed', detail: failure };
  const node = (await readNodeMetadata(proposal.proposalId, [PROPOSAL_STATUS_PROPERTY])).node;
  const stored = node?.properties?.[PROPOSAL_STATUS_PROPERTY]?.[0];
  if (stored === to) return { status: 'ok' };
  if (stored !== undefined) return { status: 'not_visible', detail: `Der Vorschlag steht danach als ${sanitizeText(stored)} da, nicht als ${to}.` };
  const now = await listProposals(collection, to);
  if (!now.ok) return { status: 'unverified', detail: now.detail };
  if (now.proposals.some(p => p.proposalId === proposal.proposalId)) return { status: 'ok' };
  return now.truncated
    ? { status: 'unverified', detail: `Die Liste der Vorschläge ist länger als ${PROPOSALS_MAX}; der Vorschlag stand nicht unter den gelesenen.` }
    : { status: 'not_visible', detail: `Der Vorschlag wird danach nicht als ${to} geführt.` };
}

export type DecisionOutcome =
  | { status: 'accepted' }
  | { status: 'declined' }
  /**
   * Accepting: the material IS in the collection. `mark` says what is known of
   * the proposal: `failed` — it is still pending; `unverified` / `not_visible`
   * — the mark was sent and could not be confirmed.
   */
  | { status: 'filed_not_marked'; mark: 'failed' | 'unverified' | 'not_visible'; detail: string }
  | { status: 'failed' | 'unverified' | 'not_visible'; detail: string; httpStatus?: number };

/**
 * Decide ONE pending proposal. Accepting files FIRST and marks THEN: an
 * `ACCEPTED` proposal over a collection that never got the material reads as
 * work already done (the rule the metadata suggestions follow).
 */
export async function decideProposal(collection: string, proposal: Proposal, accept: boolean): Promise<DecisionOutcome> {
  if (!accept) {
    const declined = await setProposalStatus(collection, proposal, 'DECLINED');
    return declined.status === 'ok' ? { status: 'declined' } : declined;
  }
  // A second filing of what is there answers 409 (measured): look first.
  if (await isAlreadyFiled(proposal.nodeId, collection) !== true) {
    const filed = await addToCollection(collection, proposal.nodeId);
    // 409: it is there (right after a removal "is it there?" is unknown for seconds — measured).
    if (filed.status !== 'ok' && !(filed.status === 'failed' && filed.httpStatus === 409)) return filed;
  }
  // From here on the material IS in the collection: whatever happens to the mark, that is said.
  let marked: MutationOutcome;
  try {
    marked = await setProposalStatus(collection, proposal, 'ACCEPTED');
  } catch (err) {
    marked = { status: 'unverified', detail: err instanceof Error ? err.message : String(err) };
  }
  return marked.status === 'ok' ? { status: 'accepted' } : { status: 'filed_not_marked', mark: marked.status, detail: marked.detail };
}
