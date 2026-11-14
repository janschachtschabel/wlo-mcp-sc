/**
 * collection-move-and-proposals.test.ts – package 4 of the collection-structure
 * plan (chatbot team, S5 / S8 / S9, 2026-11-14): hanging a collection under
 * another parent, proposing a material for a collection the caller may only
 * read, deciding such a proposal, and saying before the key what is not public.
 *
 * Runs against `collectionRepo` (tests/collection-repo.ts), which behaves as
 * the repository was MEASURED to with two accounts: a namesake at the target
 * is not refused by the repository; a read-only collection refuses a filing
 * (403) and takes a proposal; the same proposal again answers 409; the
 * proposals listing needs write permission; filing leaves the proposal PENDING.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

import { registerCurationMoveTool } from '../src/tools/curation-move.js';
import { registerCurationProposalTools } from '../src/tools/curation-proposals.js';
import { registerCurationAddManyTool } from '../src/tools/curation-add-many.js';
import { registerCurationCollectionTools } from '../src/tools/curation-collections.js';
import { applyReadOnlyToolDefaults } from '../src/apps/tool-defaults.js';
import { setServiceCredentialForTest, type WloCredential } from '../src/auth/credential.js';
import { setPlanBudgetForTest } from '../src/services/write/plan-runner.js';
import { notPublicNote } from '../src/tools/curation-public.js';
import { toolText } from './fetchMock.js';
import { collectionRepo, type RepoOptions } from './collection-repo.js';

const MARIA: WloCredential = { header: 'Basic x', label: 'maria', source: 'user' };

async function client(): Promise<Client> {
  const server = new McpServer({ name: 'test', version: '0.0.0' });
  applyReadOnlyToolDefaults(server);
  const challenge = 'Bearer error="invalid_request"';
  registerCurationMoveTool(server, challenge);
  registerCurationProposalTools(server, challenge);
  registerCurationAddManyTool(server, challenge);
  registerCurationCollectionTools(server, challenge);
  const [ct, st] = InMemoryTransport.createLinkedPair();
  const c = new Client({ name: 'test-client', version: '0.0.0' });
  await Promise.all([server.connect(st), c.connect(ct)]);
  return c;
}

interface Entry { nodeId?: string; collectionId?: string; status: string; code?: string; outcomeOpen?: boolean }
interface Answer {
  complete?: boolean; pairs?: Entry[]; status?: string; count?: number; path?: string[]; previousParentId?: string | null;
  proposals?: Array<{ nodeId: string; title: string; proposalId: string; status: string }>;
  confirm?: { token: string; preview: { items?: string[]; statement?: string; notes?: string[]; notPublic?: Array<{ nodeId: string; public: boolean }> } };
  error?: { code: string; outcomeOpen?: boolean; existingId?: string; recordExists?: boolean };
}
const sc = (r: unknown) => (r as { structuredContent: Answer }).structuredContent;
const codeOf = (e: Entry) => (e.code ? `${e.status}/${e.code}` : e.status);

async function scene(build: (repo: ReturnType<typeof collectionRepo>) => void, opts: RepoOptions = {}) {
  setServiceCredentialForTest(MARIA);
  const repo = collectionRepo(opts);
  build(repo);
  const c = await client();
  const call = (name: string, args: Record<string, unknown>) => c.callTool({ name, arguments: args });
  const confirm = async (name: string, args: Record<string, unknown>) => {
    const preview = await call(name, args);
    assert.notEqual(preview.isError, true, toolText(preview));
    const token = sc(preview).confirm?.token;
    assert.ok(token, `a preview with a key was expected: ${toolText(preview)}`);
    return { preview, done: await call(name, { ...args, confirmToken: token }) };
  };
  const end = async () => { setPlanBudgetForTest(null); await c.close(); repo.mock.restore(); setServiceCredentialForTest(null); };
  return { repo, call, confirm, end };
}

// ── wlo_move_collection ─────────────────────────────────────────────────────

/** Physik > Optik > Linsen (holding m1), Physik > Mechanik, and a second top-level tree Chemie > Optik. */
function tree(repo: ReturnType<typeof collectionRepo>) {
  repo.collection('physik', 'Physik');
  repo.collection('optik', 'Optik', 'physik');
  repo.collection('linsen', 'Linsen', 'optik');
  repo.collection('mechanik', 'Mechanik', 'physik');
  repo.collection('chemie', 'Chemie');
  repo.collection('chem-optik', 'optik ', 'chemie');
  repo.record('m1', 'Arbeitsblatt'); repo.file('linsen', 'm1');
}

test('wlo_move_collection: the preview names both parents with path and what goes along; the move keeps id, sub-tree and contents', async () => {
  const s = await scene(tree);
  try {
    const { preview, done } = await s.confirm('wlo_move_collection', { nodeId: 'optik', newParentId: 'mechanik' });
    const text = toolText(preview);
    assert.match(text, /Hängt die Sammlung „Optik“ \(optik\) um — von „Physik“ \(physik\) nach „Mechanik“ \(mechanik; Pfad: Physik › Mechanik\)/);
    assert.match(text, /1 Untersammlung zieht mit/);
    assert.doesNotMatch(text, /mindestens/);
    assert.match(text, /geerbte Rechte kommen danach von „Mechanik“/);
    assert.equal(done.isError, undefined, toolText(done));
    assert.deepEqual([sc(done).previousParentId, sc(done).path], ['physik', ['Physik', 'Mechanik', 'Optik']]);
    assert.equal(s.repo.nodes.get('optik')!.parent, 'mechanik');
    assert.equal(s.repo.nodes.get('linsen')!.parent, 'optik');
    assert.deepEqual(s.repo.order('linsen', true), ['m1']);
  } finally { await s.end(); }
});

test('wlo_move_collection: a namesake at the target is refused HERE — the repository would put both side by side', async () => {
  const s = await scene(tree);
  try {
    // "optik " under Chemie: same title but for case and spacing.
    const r = await s.call('wlo_move_collection', { nodeId: 'optik', newParentId: 'chemie' });
    assert.equal(r.isError, true);
    assert.deepEqual([sc(r).error!.code, sc(r).error!.existingId, sc(r).error!.outcomeOpen], ['exists', 'chem-optik', false]);
    assert.equal(s.repo.writes.length, 0);
  } finally { await s.end(); }
});

test('wlo_move_collection: a target in the own sub-tree, itself, the same parent, a record and an unknown id are refused before any key', async () => {
  const s = await scene(tree);
  try {
    for (const [args, code] of [
      [{ nodeId: 'optik', newParentId: 'linsen' }, 'invalid_input'],
      [{ nodeId: 'optik', newParentId: 'optik' }, 'invalid_input'],
      [{ nodeId: 'optik', newParentId: 'physik' }, 'no_change'],
      [{ nodeId: 'm1', newParentId: 'physik' }, 'not_a_collection'],
      [{ nodeId: 'optik', newParentId: 'm1' }, 'not_a_collection'],
      [{ nodeId: 'nope', newParentId: 'physik' }, 'not_found'],
    ] as const) {
      const r = await s.call('wlo_move_collection', args);
      assert.equal(sc(r).error?.code, code, `${JSON.stringify(args)}: ${toolText(r)}`);
      assert.equal(sc(r).confirm, undefined);
    }
    assert.equal(s.repo.writes.length, 0);
  } finally { await s.end(); }
});

test('wlo_move_collection: siblings that cannot be listed mean "not checked" — never a move into a possible namesake', async () => {
  const s = await scene(tree, { intercept: q => (q.method === 'GET' && q.id === 'mechanik' && q.url.includes('filter=folders') ? { status: 503, json: {} } : undefined) });
  try {
    const r = await s.call('wlo_move_collection', { nodeId: 'optik', newParentId: 'mechanik' });
    assert.deepEqual([sc(r).error!.code, sc(r).error!.outcomeOpen], ['not_checked', false]);
    assert.equal(s.repo.writes.length, 0);
  } finally { await s.end(); }
});

test('wlo_move_collection: answered 200 and still under the old parent is not_visible — never "moved"', async () => {
  const s = await scene(tree, { intercept: q => (q.method === 'POST' && q.url.includes('/_move') ? { json: {} } : undefined) });
  try {
    const { done } = await s.confirm('wlo_move_collection', { nodeId: 'optik', newParentId: 'mechanik' });
    assert.equal(sc(done).error!.code, 'not_visible');
  } finally { await s.end(); }
});

// ── proposing ───────────────────────────────────────────────────────────────

/** `own` may be written, `foreign` only read; m1 is public, p1 is private. */
function shared(repo: ReturnType<typeof collectionRepo>) {
  repo.collection('own', 'Meine Sammlung');
  repo.collection('foreign', 'Fachportal Optik');
  repo.nodes.get('foreign')!.readOnly = true;
  repo.record('m1', 'Arbeitsblatt');
  repo.record('p1', 'Mein Entwurf');
  repo.nodes.get('p1')!.private = true;
}

test('wlo_add_to_collection: a collection the caller may only read gets a PROPOSAL — the preview says so, and nothing is filed', async () => {
  const s = await scene(shared);
  try {
    const { preview, done } = await s.confirm('wlo_add_to_collection', { collectionId: 'foreign', nodeId: 'm1' });
    assert.match(toolText(preview), /SCHLÄGT „Arbeitsblatt“ für die Sammlung „Fachportal Optik“ VOR/);
    assert.match(toolText(preview), /erst, wenn die Redaktion den Vorschlag annimmt/);
    assert.match(toolText(preview), /Zum Vorschlagen bitte bestätigen/);
    assert.equal(done.isError, undefined, toolText(done));
    assert.equal(sc(done).status, 'proposed');
    assert.match(toolText(done), /liegt noch NICHT in der Sammlung/);
    assert.deepEqual(s.repo.order('foreign', true), []);
    assert.deepEqual(s.repo.proposals.map(p => [p.collection, p.material, p.status]), [['foreign', 'm1', 'PENDING']]);
    // The read-back a proposer has: the same request again, refused as a duplicate.
    assert.equal(s.repo.writes.filter(w => w.method === 'PUT').length, 2);
  } finally { await s.end(); }
});

test('wlo_add_to_collection: proposed before — said as that, not open, nothing changed', async () => {
  const s = await scene((repo) => { shared(repo); repo.proposals.push({ id: 'prop-x', collection: 'foreign', material: 'm1', status: 'DECLINED' }); });
  try {
    const { done } = await s.confirm('wlo_add_to_collection', { collectionId: 'foreign', nodeId: 'm1' });
    assert.deepEqual([sc(done).error!.code, sc(done).error!.outcomeOpen], ['already_proposed', false]);
    assert.equal(s.repo.proposals.length, 1);
  } finally { await s.end(); }
});

test('wlo_add_to_collection: a collection the caller may write is filed as before — no proposal', async () => {
  const s = await scene(shared);
  try {
    const { preview, done } = await s.confirm('wlo_add_to_collection', { collectionId: 'own', nodeId: 'm1' });
    assert.doesNotMatch(toolText(preview), /VOR|Vorschlag/);
    assert.equal(done.isError, undefined, toolText(done));
    assert.deepEqual(s.repo.order('own', true), ['m1']);
    assert.equal(s.repo.proposals.length, 0);
  } finally { await s.end(); }
});

test('wlo_add_to_collections: per pair — filed where the caller may write, proposed where not; a move into a read-only target is refused', async () => {
  const s = await scene(shared);
  try {
    const pairs = [{ nodeId: 'm1', collectionId: 'own' }, { nodeId: 'm1', collectionId: 'foreign' }];
    const { preview, done } = await s.confirm('wlo_add_to_collections', { pairs });
    const lines = sc(preview).confirm!.preview.items!;
    assert.doesNotMatch(lines[0]!, /VORSCHLAG/);
    assert.match(lines[1]!, /→ als VORSCHLAG an „Fachportal Optik“ \(foreign\) — dort darf diese Anmeldung nicht schreiben/);
    assert.match(toolText(preview), /1 gehen als VORSCHLAG/);
    assert.deepEqual(sc(done).pairs!.map(codeOf), ['added', 'proposed']);
    assert.match(toolText(done), /VORGESCHLAGEN — liegt noch nicht in der Sammlung/);
    assert.deepEqual(s.repo.order('foreign', true), []);

    const move = await s.call('wlo_add_to_collections', { pairs: [{ nodeId: 'm1', collectionId: 'foreign', removeFrom: 'own' }] });
    assert.equal(move.isError, true);
    assert.match(toolText(move), /ein Vorschlag ist keine Aufnahme/);
    assert.deepEqual(s.repo.order('own', true), ['m1']);
  } finally { await s.end(); }
});

test('wlo_add_to_collections: a proposal whose answer was lost is OURS on the next call — not "already proposed"', async () => {
  let lost = false;
  const s = await scene(shared, { intercept: (q) => {
    if (q.method !== 'PUT' || !q.url.includes('asProposal') || lost) return undefined;
    lost = true;
    s.repo.proposals.push({ id: 'prop-m1-foreign', collection: 'foreign', material: 'm1', status: 'PENDING' });
    throw Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' });
  } });
  try {
    const args = { pairs: [{ nodeId: 'm1', collectionId: 'foreign' }] };
    const first = sc((await s.confirm('wlo_add_to_collections', args)).done);
    assert.deepEqual(first.pairs!.map(codeOf), ['pending/timeout']);
    const second = sc(await s.call('wlo_add_to_collections', { ...args, continuationToken: (first as { continuationToken?: string }).continuationToken }));
    assert.deepEqual(second.pairs!.map(codeOf), ['proposed']);
    assert.equal(s.repo.proposals.length, 1);
  } finally { await s.end(); }
});

// ── not public ──────────────────────────────────────────────────────────────

test('a material that is not public is said BEFORE the key — as a sentence and as data — and filed all the same', async () => {
  const s = await scene(shared);
  try {
    const single = await s.confirm('wlo_add_to_collection', { collectionId: 'own', nodeId: 'p1' });
    assert.ok(toolText(single.preview).includes(notPublicNote(1, 1)));
    assert.deepEqual(sc(single.preview).confirm!.preview.notPublic, [{ nodeId: 'p1', public: false }]);
    assert.ok(sc(single.preview).confirm!.preview.notes!.includes(notPublicNote(1, 1)));
    assert.equal(single.done.isError, undefined, toolText(single.done));

    const pairs = [{ nodeId: 'p1', collectionId: 'foreign' }, { nodeId: 'm1', collectionId: 'foreign' }];
    const many = await s.call('wlo_add_to_collections', { pairs });
    assert.ok(toolText(many).includes(notPublicNote(1, 2)));
    assert.deepEqual(sc(many).confirm!.preview.notPublic, [{ nodeId: 'p1', public: false }]);
    assert.match(sc(many).confirm!.preview.items![0]!, /— noch nicht öffentlich$/);
    assert.doesNotMatch(sc(many).confirm!.preview.items![1]!, /öffentlich/);
  } finally { await s.end(); }
});

test('a public material gets no notice at all', async () => {
  const s = await scene(shared);
  try {
    const r = await s.call('wlo_add_to_collection', { collectionId: 'own', nodeId: 'm1' });
    assert.doesNotMatch(toolText(r), /öffentlich/);
    assert.equal(sc(r).confirm!.preview.notPublic, undefined);
    assert.equal(sc(r).confirm!.preview.notes, undefined);
  } finally { await s.end(); }
});

// ── listing and deciding ────────────────────────────────────────────────────

/** `own` holds two pending proposals (m1, p1) and one declined (m2). */
function withProposals(repo: ReturnType<typeof collectionRepo>) {
  shared(repo);
  repo.record('m2', 'Video');
  repo.proposals.push(
    { id: 'prop-1', collection: 'own', material: 'm1', status: 'PENDING' },
    { id: 'prop-2', collection: 'own', material: 'p1', status: 'PENDING' },
    { id: 'prop-3', collection: 'own', material: 'm2', status: 'DECLINED' },
  );
}

test('wlo_list_collection_proposals: pending by default, by status on request; the id comes first and the title last', async () => {
  const s = await scene(withProposals);
  try {
    const pending = await s.call('wlo_list_collection_proposals', { collectionId: 'own' });
    assert.deepEqual(sc(pending).proposals!.map(p => [p.nodeId, p.proposalId, p.status]), [['m1', 'prop-1', 'PENDING'], ['p1', 'prop-2', 'PENDING']]);
    assert.match(toolText(pending).split('\n')[1]!, /^- nodeId: m1 — „Arbeitsblatt“$/);
    const declined = await s.call('wlo_list_collection_proposals', { collectionId: 'own', status: 'DECLINED' });
    assert.deepEqual(sc(declined).proposals!.map(p => p.nodeId), ['m2']);
    const none = await s.call('wlo_list_collection_proposals', { collectionId: 'own', status: 'ACCEPTED' });
    assert.match(toolText(none), /keine Vorschläge mit dem Status angenommen/);
    assert.equal(s.repo.writes.length, 0);
  } finally { await s.end(); }
});

test('wlo_list_collection_proposals: without write permission it says who may see them — not "none"', async () => {
  const s = await scene(withProposals);
  try {
    const r = await s.call('wlo_list_collection_proposals', { collectionId: 'foreign' });
    assert.equal(r.isError, true);
    assert.equal(sc(r).error!.code, 'forbidden');
    assert.match(toolText(r), /sieht nur, wer an dieser Sammlung schreiben darf/);
  } finally { await s.end(); }
});

test('wlo_decide_collection_proposal accept: the material is filed FIRST, then the proposal is marked', async () => {
  const s = await scene(withProposals);
  try {
    const { preview, done } = await s.confirm('wlo_decide_collection_proposal', { collectionId: 'own', nodeId: 'm1', decision: 'accept' });
    assert.match(toolText(preview), /Nimmt den Vorschlag an: „Arbeitsblatt“ \(m1\) wird in die Sammlung „Meine Sammlung“ \(own\) aufgenommen/);
    assert.equal(sc(done).status, 'accepted');
    assert.deepEqual(s.repo.order('own', true), ['m1']);
    assert.equal(s.repo.proposals.find(p => p.id === 'prop-1')!.status, 'ACCEPTED');
    const sequence = s.repo.writes.map(w => (w.path.includes('/references/') ? 'file' : w.path.endsWith('/property') ? 'mark' : w.method));
    assert.deepEqual(sequence, ['file', 'mark']);
  } finally { await s.end(); }
});

test('wlo_decide_collection_proposal accept: a filing that fails marks NOTHING — the proposal stays pending', async () => {
  const s = await scene(withProposals, { intercept: q => (q.method === 'PUT' ? { status: 403, json: {} } : undefined) });
  try {
    const { done } = await s.confirm('wlo_decide_collection_proposal', { collectionId: 'own', nodeId: 'm1', decision: 'accept' });
    assert.equal(done.isError, true);
    assert.equal(s.repo.proposals.find(p => p.id === 'prop-1')!.status, 'PENDING');
    assert.ok(!s.repo.writes.some(w => w.path.endsWith('/property')));
  } finally { await s.end(); }
});

test('wlo_decide_collection_proposal accept: filed, and the mark does not land — said as that, with the material named as there', async () => {
  const s = await scene(withProposals, { intercept: q => (q.method === 'POST' && q.url.includes('/property') ? { status: 500, json: {} } : undefined) });
  try {
    const { done } = await s.confirm('wlo_decide_collection_proposal', { collectionId: 'own', nodeId: 'm1', decision: 'accept' });
    assert.deepEqual([sc(done).error!.code, sc(done).error!.recordExists], ['proposal_not_marked', true]);
    assert.match(toolText(done), /liegt jetzt in „Meine Sammlung“.*Nicht noch einmal annehmen/);
    assert.deepEqual(s.repo.order('own', true), ['m1']);
  } finally { await s.end(); }
});

test('wlo_decide_collection_proposal accept: the material is in the collection already — it is not filed again, only marked', async () => {
  const s = await scene((repo) => { withProposals(repo); repo.file('own', 'm1'); });
  try {
    const { done } = await s.confirm('wlo_decide_collection_proposal', { collectionId: 'own', nodeId: 'm1', decision: 'accept' });
    assert.equal(sc(done).status, 'accepted');
    assert.ok(!s.repo.writes.some(w => w.method === 'PUT'));
  } finally { await s.end(); }
});

test('wlo_decide_collection_proposal decline: marked, nothing filed; a mark that is not kept is not_visible', async () => {
  let s = await scene(withProposals);
  try {
    const { preview, done } = await s.confirm('wlo_decide_collection_proposal', { collectionId: 'own', nodeId: 'p1', decision: 'decline' });
    assert.match(toolText(preview), /wird NICHT in die Sammlung/);
    assert.equal(sc(done).status, 'declined');
    assert.equal(s.repo.proposals.find(p => p.id === 'prop-2')!.status, 'DECLINED');
    assert.deepEqual(s.repo.order('own', true), []);
  } finally { await s.end(); }
  s = await scene(withProposals, { intercept: q => (q.method === 'POST' && q.url.includes('/property') ? { json: {} } : undefined) });
  try {
    const { done } = await s.confirm('wlo_decide_collection_proposal', { collectionId: 'own', nodeId: 'p1', decision: 'decline' });
    assert.equal(sc(done).error!.code, 'not_visible');
  } finally { await s.end(); }
});

test('wlo_decide_collection_proposal: only a PENDING proposal can be decided; a reader is told who may', async () => {
  const s = await scene(withProposals);
  try {
    const decided = await s.call('wlo_decide_collection_proposal', { collectionId: 'own', nodeId: 'm2', decision: 'accept' });
    assert.deepEqual([sc(decided).error!.code, sc(decided).error!.outcomeOpen], ['no_pending_proposal', false]);
    const reader = await s.call('wlo_decide_collection_proposal', { collectionId: 'foreign', nodeId: 'm1', decision: 'accept' });
    assert.equal(sc(reader).error!.code, 'forbidden');
    assert.equal(s.repo.writes.length, 0);
  } finally { await s.end(); }
});

// ── review of package 4 (2026-11-14) ────────────────────────────────────────

test('wlo_move_collection: the namesake is told by the COLLECTION title — a leftover cclom:title does not hide it', async () => {
  const s = await scene((repo) => {
    tree(repo);
    // Under Mechanik: a collection whose current title is "Optik", with an old record title beside it.
    repo.collection('twin', 'Optik', 'mechanik');
    repo.nodes.get('twin')!.props = { 'cclom:title': ['Alter Titel'] };
  });
  try {
    const r = await s.call('wlo_move_collection', { nodeId: 'optik', newParentId: 'mechanik' });
    assert.deepEqual([sc(r).error?.code, sc(r).error?.existingId], ['exists', 'twin'], toolText(r));
  } finally { await s.end(); }
});

test('wlo_move_collection: a top-level collection is moved "von der obersten Ebene" — no empty name, no folder id', async () => {
  const s = await scene(tree);
  try {
    const { preview, done } = await s.confirm('wlo_move_collection', { nodeId: 'chemie', newParentId: 'mechanik' });
    assert.match(toolText(preview), /um — von der obersten Ebene nach „Mechanik“/);
    assert.doesNotMatch(toolText(preview), /\(\)|„“/);
    assert.equal(sc(done).previousParentId, null);
  } finally { await s.end(); }
});

test('wlo_move_collection: a collection or a target the caller may only read is refused before the key', async () => {
  for (const readOnly of ['optik', 'mechanik']) {
    const s = await scene((repo) => { tree(repo); repo.nodes.get(readOnly)!.readOnly = true; });
    try {
      const r = await s.call('wlo_move_collection', { nodeId: 'optik', newParentId: 'mechanik' });
      assert.deepEqual([sc(r).error?.code, sc(r).error?.outcomeOpen], ['forbidden', false], readOnly);
      assert.equal(s.repo.writes.length, 0);
    } finally { await s.end(); }
  }
});

test('wlo_move_collection: a sub-tree deeper than the count reaches is "mindestens", not an exact figure', async () => {
  const s = await scene((repo) => {
    tree(repo);
    let parent = 'linsen';
    for (let i = 1; i <= 4; i++) { repo.collection(`deep${i}`, `Tief ${i}`, parent); parent = `deep${i}`; }
  });
  try {
    const preview = await s.call('wlo_move_collection', { nodeId: 'optik', newParentId: 'mechanik' });
    assert.match(toolText(preview), /mindestens 4 Untersammlungen ziehen mit/);
  } finally { await s.end(); }
});

test('a pending PROPOSAL is not a filing: the material is still filed when its proposal is accepted', async () => {
  const s = await scene(withProposals);
  try {
    // The usage lookup lists the pending proposal for `own` — as PROPOSAL_PENDING.
    const { done } = await s.confirm('wlo_decide_collection_proposal', { collectionId: 'own', nodeId: 'm1', decision: 'accept' });
    assert.equal(sc(done).status, 'accepted');
    assert.equal(s.repo.writes.filter(w => w.method === 'PUT').length, 1, 'filed, not skipped as "already there"');
  } finally { await s.end(); }
});

test('wlo_decide_collection_proposal accept: the filing answers 409 (it is there, the lookup did not say so) — marked all the same', async () => {
  const s = await scene((repo) => { withProposals(repo); repo.file('own', 'm1'); },
    { intercept: q => (q.url.includes('/usage/') ? { status: 500, json: {} } : undefined) });
  try {
    const { done } = await s.confirm('wlo_decide_collection_proposal', { collectionId: 'own', nodeId: 'm1', decision: 'accept' });
    assert.equal(sc(done).status, 'accepted', toolText(done));
    assert.equal(s.repo.proposals.find(p => p.id === 'prop-1')!.status, 'ACCEPTED');
  } finally { await s.end(); }
});

test('wlo_decide_collection_proposal accept: a mark that was SENT and cannot be confirmed is said as that — not as "still pending"', async () => {
  // The mark lands; neither the proposal node nor the listing can be read afterwards.
  let marked = false;
  const s = await scene(withProposals, { intercept: (q) => {
    if (q.method === 'POST' && q.url.includes('/property')) { marked = true; return undefined; }
    if (marked && q.method === 'GET' && (q.url.includes('/prop-1/metadata') || q.url.includes('/children/proposals'))) return { status: 503, json: {} };
    return undefined;
  } });
  try {
    const { done } = await s.confirm('wlo_decide_collection_proposal', { collectionId: 'own', nodeId: 'm1', decision: 'accept' });
    assert.equal(sc(done).error!.code, 'proposal_not_marked');
    assert.equal((sc(done).error as { mark?: string }).mark, 'unverified');
    assert.match(toolText(done), /ließ sich nicht bestätigen/);
    assert.doesNotMatch(toolText(done), /steht weiter als offen da/);
    assert.match(toolText(done), /liegt jetzt in „Meine Sammlung“/);
  } finally { await s.end(); }
});

test('wlo_decide_collection_proposal: a material this login cannot read is named in the preview', async () => {
  const s = await scene(withProposals, { intercept: (q) => {
    if (q.method !== 'GET' || !q.url.includes('/children/proposals')) return undefined;
    return { json: { nodes: [{ ref: { id: 'm1' }, type: 'ccm:io', properties: { 'cclom:title': ['Arbeitsblatt'] }, status: 'PENDING', accessible: false,
      proposal: { ref: { id: 'prop-1' }, type: 'ccm:collection_proposal' } }] } };
  } });
  try {
    const r = await s.call('wlo_decide_collection_proposal', { collectionId: 'own', nodeId: 'm1', decision: 'accept' });
    assert.match(toolText(r), /für diese Anmeldung selbst nicht lesbar/);
    assert.equal(sc(r).confirm!.preview.notes!.length, 1);
  } finally { await s.end(); }
});

test('not public is asked of what is FILED: a reference to a private original is named, in the batch as in the single tool', async () => {
  const s = await scene((repo) => { shared(repo); repo.collection('third', 'Dritte'); repo.file('third', 'p1', 'ref-p1'); });
  try {
    const single = await s.call('wlo_add_to_collection', { collectionId: 'own', nodeId: 'ref-p1' });
    assert.ok(toolText(single).includes(notPublicNote(1, 1)));
    const many = await s.call('wlo_add_to_collections', { pairs: [{ nodeId: 'ref-p1', collectionId: 'own' }] });
    assert.ok(toolText(many).includes(notPublicNote(1, 1)), toolText(many));
    assert.deepEqual(sc(many).confirm!.preview.notPublic, [{ nodeId: 'ref-p1', public: false }]);
  } finally { await s.end(); }
});

test('a proposal that could not be sent (5xx) stays open and is retried; a refusal ends it as not open', async () => {
  let s = await scene(shared, { intercept: (() => { let n = 0; return (q: { method: string; url: string }) => (q.method === 'PUT' && q.url.includes('asProposal') && n++ === 0 ? { status: 502, json: {} } : undefined); })() });
  try {
    const args = { pairs: [{ nodeId: 'm1', collectionId: 'foreign' }] };
    const first = sc((await s.confirm('wlo_add_to_collections', args)).done);
    assert.deepEqual(first.pairs!.map(codeOf), ['pending/upstream_error']);
    const second = sc(await s.call('wlo_add_to_collections', { ...args, continuationToken: (first as { continuationToken?: string }).continuationToken }));
    assert.deepEqual(second.pairs!.map(codeOf), ['proposed']);
  } finally { await s.end(); }
  s = await scene(shared, { intercept: q => (q.method === 'PUT' && q.url.includes('asProposal') ? { status: 403, json: {} } : undefined) });
  try {
    const { done } = await s.confirm('wlo_add_to_collections', { pairs: [{ nodeId: 'm1', collectionId: 'foreign' }] });
    const e = sc(done).pairs![0]!;
    assert.deepEqual([e.status, e.code, e.outcomeOpen], ['failed', 'forbidden', false]);
  } finally { await s.end(); }
});

test('wlo_move_collection: a collection kept in a repository FOLDER is on the top level — the folder is not named as its parent', async () => {
  const s = await scene((repo) => { tree(repo); repo.folder('store', 'Ablage des Repositorys'); repo.nodes.get('chemie')!.parent = 'store'; });
  try {
    const { preview, done } = await s.confirm('wlo_move_collection', { nodeId: 'chemie', newParentId: 'mechanik' });
    assert.match(toolText(preview), /von der obersten Ebene nach/);
    assert.doesNotMatch(toolText(preview), /Ablage des Repositorys|store/);
    assert.equal(sc(done).previousParentId, null);
  } finally { await s.end(); }
});

test('a proposal the repository does not refuse as a duplicate afterwards is NOT confirmed', async () => {
  const s = await scene(shared, { intercept: q => (q.method === 'PUT' && q.url.includes('asProposal') ? { json: {} } : undefined) });
  try {
    const { done } = await s.confirm('wlo_add_to_collection', { collectionId: 'foreign', nodeId: 'm1' });
    assert.equal(done.isError, true);
    assert.equal(sc(done).error!.code, 'unverified');
  } finally { await s.end(); }
});
