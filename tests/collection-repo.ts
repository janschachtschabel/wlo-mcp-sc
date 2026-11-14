/**
 * collection-repo.ts – Test helper (NOT a test file; excluded by the
 * `*.test.ts` glob). A small edu-sharing stand-in for the tools that maintain
 * collections: sub-collections, records, references, positions.
 *
 * It behaves the way the repository was MEASURED to (staging, 2026-11-14,
 * `npm run measure:order` / `measure:moves`), because a fixture that is kinder
 * than the repository hides exactly the defects these tools exist to avoid:
 *
 * - a listing is in the order of CREATION unless asked with the sort
 *   parameter; then positioned children come first, the others after them;
 * - `POST …/order` positions only the ids it names, and refuses the id of an
 *   ORIGINAL (400) — it wants the reference's;
 * - `DELETE …/references/{id}` with an original's id answers 200 and removes
 *   nothing;
 * - `_move` keeps the id, takes the sub-tree along, does not mind a namesake,
 *   and answers 500 for a target inside the moved sub-tree;
 * - a RECORD can lie in a collection directly, as an original; it is listed
 *   like a reference, and `DELETE …/references/{its id}` deletes the record;
 * - after a reference is deleted, the usage lookup for that material answers
 *   500 a few times before it recovers;
 * - a collection the caller may READ but not WRITE (`readOnly`) refuses a
 *   filing with 403 and takes a proposal; a second proposal of the same pair
 *   answers 409; the proposals listing needs write permission; accepting by
 *   filing leaves the proposal PENDING.
 */

import { installFetchMock, type MockResult } from './fetchMock.js';

export interface RepoNode {
  id: string;
  kind: 'collection' | 'record' | 'reference' | 'folder';
  title: string;
  parent?: string;
  /** For a reference: the record it points at. */
  original?: string;
  position?: number;
  props?: Record<string, string[]>;
  /** A collection the caller may read but not write. */
  readOnly?: boolean;
  /** A record only its owner can read (`isPublic: false`). */
  private?: boolean;
  seq: number;
}

export interface RepoProposal { id: string; collection: string; material: string; status: 'PENDING' | 'ACCEPTED' | 'DECLINED' }

export interface RepoOptions {
  /** Called for every request before it is answered; an answer here wins. May throw. */
  intercept?: (req: { method: string; url: string; id: string; body: unknown }) => MockResult | undefined;
}

const SORT = 'ccm:collection_ordered_position';

export function collectionRepo(opts: RepoOptions = {}) {
  const nodes = new Map<string, RepoNode>();
  const proposals: RepoProposal[] = [];
  /** Material id → how many usage lookups still answer 500. */
  const usageLag = new Map<string, number>();
  let seq = 0;
  const writes: Array<{ method: string; path: string; body: unknown }> = [];

  const add = (n: Omit<RepoNode, 'seq'>): RepoNode => { const node = { ...n, seq: ++seq }; nodes.set(n.id, node); return node; };
  const collection = (id: string, title: string, parent?: string) => add({ id, kind: 'collection', title, ...(parent ? { parent } : {}) });
  const record = (id: string, title: string, props: Record<string, string[]> = {}) => add({ id, kind: 'record', title, props });
  /** A record filed DIRECTLY in a collection — the original itself, no reference. */
  const direct = (collectionId: string, id: string, title: string) => add({ id, kind: 'record', title, parent: collectionId });
  const folder = (id: string, title: string) => add({ id, kind: 'folder', title });
  /** File `recordId` in `collectionId`; the reference gets its own id. */
  const file = (collectionId: string, recordId: string, refId = `ref-${recordId}-${collectionId}`) =>
    add({ id: refId, kind: 'reference', title: nodes.get(recordId)?.title ?? recordId, parent: collectionId, original: recordId });

  const childrenOf = (parent: string, files: boolean, sorted: boolean): RepoNode[] => {
    const list = [...nodes.values()].filter(n => n.parent === parent && (files ? n.kind === 'reference' || n.kind === 'record' : n.kind === 'collection'));
    list.sort((a, b) => a.seq - b.seq);
    if (!sorted) return list;
    return [...list.filter(n => n.position !== undefined).sort((a, b) => a.position! - b.position!), ...list.filter(n => n.position === undefined)];
  };
  const dto = (n: RepoNode) => ({
    ref: { id: n.id, repo: '-home-' },
    type: n.kind === 'collection' || n.kind === 'folder' ? 'ccm:map' : 'ccm:io',
    ...(n.kind === 'collection' ? { aspects: ['ccm:collection'] } : n.kind === 'folder' ? { aspects: [] } : { aspects: [] }),
    ...(n.kind === 'reference' ? { originalId: n.original } : {}),
    access: n.readOnly ? ['Read', 'ReadAll', 'Comment'] : ['Read', 'ReadAll', 'Comment', 'AddChildren', 'Write', 'Delete'],
    isPublic: !n.private,
    title: n.title,
    properties: {
      'cm:title': [n.title], 'cclom:title': [n.title], 'cm:name': [n.title],
      // On an original the property points at the record ITSELF (measured).
      ...(n.kind === 'reference' ? { 'ccm:original': [n.original!] } : n.kind === 'record' ? { 'ccm:original': [n.id] } : {}),
      ...(n.position !== undefined ? { [SORT]: [String(n.position)] } : {}),
      ...(n.props ?? {}),
    },
  });
  const isBelow = (id: string, ancestor: string): boolean => {
    for (let at = nodes.get(id); at; at = at.parent ? nodes.get(at.parent) : undefined) if (at.id === ancestor) return true;
    return false;
  };
  const removeTree = (id: string) => {
    for (const n of [...nodes.values()]) if (n.parent === id) removeTree(n.id);
    nodes.delete(id);
  };

  const mock = installFetchMock((rawUrl, init): MockResult => {
    const method = init?.method ?? 'GET';
    const url = new URL(rawUrl);
    const path = url.pathname;
    let body: unknown;
    try { body = init?.body ? JSON.parse(String(init.body)) : undefined; } catch { body = String(init?.body); }
    const idOf = /-home-\/([^/]+)/.exec(path)?.[1] ?? '';
    if (method !== 'GET') writes.push({ method, path, body });
    const over = opts.intercept?.({ method, url: rawUrl, id: decodeURIComponent(idOf), body });
    if (over) return over;

    let m: RegExpExecArray | null;
    if ((m = /\/collection\/v1\/collections\/-home-\/([^/]+)\/order$/.exec(path)) && method === 'POST') {
      const ids = body as string[];
      const mine = [...nodes.values()].filter(n => n.parent === m![1]);
      const stranger = ids.find(id => !mine.some(n => n.id === id));
      if (stranger) return { status: 400, json: { message: `Node id ${stranger} is not a children of the collection ${m[1]}` } };
      ids.forEach((id, i) => { nodes.get(id)!.position = i; });
      return { json: {} };
    }
    if ((m = /\/collection\/v1\/collections\/-home-\/([^/]+)\/children\/proposals$/.exec(path)) && method === 'GET') {
      if (nodes.get(m[1]!)?.readOnly) return { status: 403, json: { message: `No Write on collection ${m[1]}` } };
      const status = url.searchParams.get('status') ?? 'PENDING';
      const list = proposals.filter(p => p.collection === m![1] && p.status === status);
      return { json: { nodes: list.map(p => ({ ...dto(nodes.get(p.material)!), status: p.status, accessible: true,
        proposal: { ref: { id: p.id, repo: '-home-' }, type: 'ccm:collection_proposal', properties: { 'ccm:collection_proposal_status': [p.status] } } })) } };
    }
    if ((m = /\/node\/v1\/nodes\/-home-\/([^/]+)\/property$/.exec(path)) && method === 'POST') {
      const proposal = proposals.find(p => p.id === m![1]);
      if (proposal && url.searchParams.get('property') === 'ccm:collection_proposal_status') {
        proposal.status = (body as string[])[0] as RepoProposal['status'];
        return { json: {} };
      }
    }
    if ((m = /\/collection\/v1\/collections\/-home-\/([^/]+)\/references\/([^/]+)$/.exec(path))) {
      const [, cid, nid] = m as unknown as [string, string, string];
      if (method === 'PUT') {
        const original = nodes.get(nid)?.kind === 'reference' ? nodes.get(nid)!.original! : nid;
        if (!nodes.get(cid) || !nodes.get(original)) return { status: 404, json: {} };
        if (url.searchParams.get('asProposal') === 'true') {
          if (proposals.some(p => p.collection === cid && p.material === original)) return { status: 409, json: { message: `Node id ${original} is already proposed for this collection` } };
          proposals.push({ id: `prop-${original}-${cid}`, collection: cid, material: original, status: 'PENDING' });
          return { json: {} };
        }
        if (nodes.get(cid)!.readOnly) return { status: 403, json: { message: 'Zugriff verweigert.' } };
        // A second filing of what is there: 409, and no second reference (measured).
        if ([...nodes.values()].some(n => n.kind === 'reference' && n.parent === cid && n.original === original)) return { status: 409, json: {} };
        file(cid, original);
        return { json: {} };
      }
      if (method === 'DELETE') {
        // An ORIGINAL's id: 200, and nothing is removed.
        const n = nodes.get(nid);
        if (n?.kind === 'reference' && n.parent === cid) { nodes.delete(nid); usageLag.set(n.original!, 2); }
        // A record filed directly: the MATERIAL is deleted (measured 2026-11-14).
        else if (n?.kind === 'record' && n.parent === cid) nodes.delete(nid);
        return { json: {} };
      }
    }
    if ((m = /\/collection\/v1\/collections\/-home-\/([^/]+)$/.exec(path)) && method === 'DELETE') {
      if (!nodes.has(m[1]!)) return { status: 404, json: {} };
      removeTree(m[1]!);
      return { json: {} };
    }
    if ((m = /\/collection\/v1\/collections\/-home-\/([^/]+)\/children$/.exec(path)) && method === 'POST') {
      const id = `c-${seq + 1}`;
      collection(id, (body as { title: string }).title, m[1]!);
      return { json: { collection: { ref: { id } } } };
    }
    if ((m = /\/node\/v1\/nodes\/-home-\/([^/]+)\/children\/_move$/.exec(path)) && method === 'POST') {
      const source = url.searchParams.get('source') ?? '';
      const node = nodes.get(source);
      if (!node || !nodes.has(m[1]!)) return { status: 404, json: {} };
      if (isBelow(m[1]!, source)) return { status: 500, json: { message: 'CyclicChildRelationshipException: Node has been pasted into its own tree.' } };
      node.parent = m[1]!;
      node.seq = ++seq;
      delete node.position;
      return { json: { node: dto(node) } };
    }
    if ((m = /\/node\/v1\/nodes\/-home-\/([^/]+)\/children$/.exec(path)) && method === 'GET') {
      if (!nodes.has(m[1]!)) return { status: 404, json: {} };
      const files = url.searchParams.get('filter') !== 'folders';
      const all = childrenOf(m[1]!, files, url.searchParams.get('sortProperties') === SORT);
      const skip = Number(url.searchParams.get('skipCount') ?? 0);
      const page = all.slice(skip, skip + Number(url.searchParams.get('maxItems') ?? 100));
      return { json: { nodes: page.map(dto), pagination: { total: all.length, from: skip, count: page.length } } };
    }
    if ((m = /\/node\/v1\/nodes\/-home-\/([^/]+)\/parents$/.exec(path)) && method === 'GET') {
      const chain: RepoNode[] = [];
      for (let at = nodes.get(m[1]!); at; at = at.parent ? nodes.get(at.parent) : undefined) chain.push(at);
      return chain.length ? { json: { nodes: chain.map(dto) } } : { status: 404, json: {} };
    }
    if ((m = /\/node\/v1\/nodes\/-home-\/([^/]+)\/metadata$/.exec(path)) && method === 'GET') {
      const n = nodes.get(m[1]!);
      return n ? { json: { node: dto(n) } } : { status: 404, json: {} };
    }
    if ((m = /\/usage\/v1\/usages\/node\/([^/]+)\/collections$/.exec(path))) {
      const n = nodes.get(m[1]!);
      const original = n?.kind === 'reference' ? n.original! : m[1]!;
      const lag = usageLag.get(original) ?? 0;
      if (lag > 0) { usageLag.set(original, lag - 1); return { status: 500, json: { message: 'UsageException' } }; }
      const used = [...nodes.values()].filter(r => r.kind === 'reference' && r.original === original);
      return { json: used.map(r => ({ collectionUsageType: 'ACTIVE', collection: { ref: { id: r.parent, repo: '-home-' } } })) };
    }
    return { json: {} };
  });

  /** Ids of a collection's sub-collections (or, with `files`, of the materials in it), as a listing asked for the stored order returns them. */
  const order = (parent: string, files = false) => childrenOf(parent, files, true).map(n => (files ? n.original ?? n.id : n.id));
  return { mock, nodes, writes, proposals, collection, record, direct, folder, file, order };
}
