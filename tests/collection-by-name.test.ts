/**
 * collection-by-name.test.ts – a collection named by its TITLE (Z3, 2026-11-13).
 *
 * Five read tools take `collection` instead of a nodeId. The rule under test is
 * narrow on purpose: exactly ONE collection with the same normalised title is
 * taken; anything else ends the call with `ambiguous_collection` and
 * candidates, and the tool does not run. No prefix, no substring — a tool that
 * lists the wrong collection looks exactly like the right answer.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { installFetchMock, makeNode, strictClient, toolText, type MockResult } from './fetchMock.js';
import { looseCollectionTitle, normalizeCollectionTitle, resolveCollectionByName } from '../src/services/collection-by-name.js';
import { searchCollectionsResult } from '../src/services/collection-search.js';
import { stopSkillRegistryCache } from '../src/services/skill-registry-cache.js';
import { runAnonymous, runWithCredential, type WloCredential } from '../src/auth/credential.js';
import { resolveVocab } from '../src/vocabs.js';
import { WLO_ROOT_COLLECTION_ID } from '../src/wlo-config.js';

const MDS = '/mds_oeh/collections';
const NAME = '/collection/v1/collections/-home-/search';
const PHYSIK = resolveVocab('Physik', 'discipline')!;
const BIOLOGIE = resolveVocab('Biologie', 'discipline')!;

interface Coll { id: string; title: string; under?: string[]; taxon?: string; count?: number }

/** A collection as the mds search returns it: `cm:title`, and the content count on the DTO. */
function node(c: Coll) {
  return {
    ...makeNode(c.id, c.title, { 'cm:title': [c.title], 'cclom:title': [c.title], ...(c.taxon ? { 'ccm:taxonid': [c.taxon] } : {}) }),
    type: 'ccm:map', aspects: ['ccm:collection'],
    ...(c.count === undefined ? {} : { collection: { childReferencesCount: c.count } }),
  };
}

const listing = (nodes: unknown[] = []): MockResult => ({ json: { nodes, pagination: { total: nodes.length, from: 0, count: nodes.length } } });

interface RepoOptions {
  mdsStatus?: number; nameStatus?: number; nameLeg?: Coll[]; parentsStatus?: number;
  /** This index answers its first (narrow) request and is down for the widened one. */
  downWhenWide?: 'mds' | 'name';
  /** The re-read (`/metadata`) of these ids answers with this status. */
  reReadStatus?: Record<string, number>;
}

const FIRST_MDS = 25;
const FIRST_NAME = 5;
const WIDE_MDS = 100;
const WIDE_NAME = 50;
const windowOf = (url: string): number => Number(new URL(url).searchParams.get('maxItems'));

/**
 * A repository holding `colls`: the mds index returns them whatever the word,
 * in order, up to the window asked — as both real indexes do.
 */
function repository(colls: Coll[], opts: RepoOptions = {}) {
  const byId = new Map(colls.concat(opts.nameLeg ?? []).map(c => [c.id, c] as const));
  return installFetchMock(url => {
    if (url.includes(MDS)) {
      if (opts.mdsStatus || (opts.downWhenWide === 'mds' && windowOf(url) > FIRST_MDS)) return { status: opts.mdsStatus ?? 503, json: {} };
      return { json: { nodes: colls.slice(0, windowOf(url)).map(node) } };
    }
    if (url.includes(NAME)) {
      if (opts.nameStatus || (opts.downWhenWide === 'name' && windowOf(url) > FIRST_NAME)) return { status: opts.nameStatus ?? 503, json: {} };
      return { json: { collections: (opts.nameLeg ?? []).slice(0, windowOf(url)).map(node) } };
    }
    const id = /\/nodes\/-home-\/([^/?]+)\//.exec(url)?.[1] ?? '';
    const c = byId.get(id);
    if (url.includes('/parents')) {
      if (opts.parentsStatus) return { status: opts.parentsStatus, json: {} };
      // self → root, as the repository orders it.
      const up = [...(c?.under ?? [])].reverse().map((t, i) => node({ id: `anc-${id}-${i}`, title: t }));
      return { json: { nodes: [node(c ?? { id, title: id }), ...up, node({ id: WLO_ROOT_COLLECTION_ID, title: 'Portale' })] } };
    }
    if (url.includes('/metadata') && opts.reReadStatus?.[id]) return { status: opts.reReadStatus[id], json: {} };
    if (url.includes('/metadata')) return c ?{ json: { node: node(c) } } : { status: 404, json: {} };
    return listing();
  });
}

const searches = (calls: Array<{ url: string }>) => calls.filter(c => c.url.includes(MDS) || c.url.includes(NAME)).length;
/** The search requests of a run as `index=window`, in the order they were sent per index. */
const windows = (calls: Array<{ url: string }>) => calls
  .filter(c => c.url.includes(MDS) || c.url.includes(NAME))
  .map(c => `${c.url.includes(MDS) ? 'mds' : 'name'}=${windowOf(c.url)}`).sort();
const reReads = (calls: Array<{ url: string }>) => calls.filter(c => c.url.includes('/metadata')).map(c => /\/nodes\/-home-\/([^/?]+)\//.exec(c.url)?.[1]).sort();
const fillers = (n: number, prefix = 'c') => Array.from({ length: n }, (_, i) => ({ id: `${prefix}-${i}`, title: `Optik Teil ${i}` }));

const OPTIK: Coll = { id: 'c-optik', title: 'Optik', under: ['Physik'], taxon: PHYSIK, count: 212 };

// ── The rule ────────────────────────────────────────────────────────────────

test('exactly one collection with the same title is taken, with its path from the portal down', async () => {
  const mock = repository([OPTIK, { id: 'c-geo', title: 'Geometrische Optik', under: ['Physik', 'Optik'] }]);
  try {
    const r = await resolveCollectionByName('Optik');
    assert.deepEqual(r, { ok: true, collection: { nodeId: 'c-optik', title: 'Optik', path: ['Physik'] } },
      'the root above the portals and the collection itself are not part of the path');
  } finally { mock.restore(); }
});

test('strict: titles compare without case, and a run of spaces or hyphens is ONE separator that stays', () => {
  assert.equal(normalizeCollectionTitle('Bruch-Rechnung'), normalizeCollectionTitle(' bruch   rechnung '));
  assert.equal(normalizeCollectionTitle('Bruch – Rechnung'), normalizeCollectionTitle('BRUCH RECHNUNG'));
  // Different words the old single rule merged.
  for (const [a, b] of [['Masse', 'Maße'], ['Statue', 'Statü'], ['Wach Stube', 'Wachs Tube'], ['Klasse 1 0', 'Klasse 10'],
    ['Bruchrechnung', 'Bruch-Rechnung'], ['Genetik', 'Genetik und Vererbung']] as const) {
    assert.notEqual(normalizeCollectionTitle(a), normalizeCollectionTitle(b), `${a} / ${b}`);
  }
  // The loose rule is the old one — and only ever a second pass.
  assert.equal(looseCollectionTitle('Größen'), looseCollectionTitle('GROESSEN'));
  assert.equal(looseCollectionTitle('Bruchrechnung'), looseCollectionTitle(' Bruch – Rechnung '));
  assert.notEqual(looseCollectionTitle('Genetik'), looseCollectionTitle('Genetik und Vererbung'));
});

test('a strict match wins over a loosely equal namesake: "Masse" is not "Maße"', async () => {
  const mock = repository([{ id: 'c-masse', title: 'Masse', under: ['Physik'] }, { id: 'c-masze', title: 'Maße', under: ['Mathematik'] }]);
  try {
    const masse = await resolveCollectionByName('masse');
    assert.deepEqual(masse, { ok: true, collection: { nodeId: 'c-masse', title: 'Masse', path: ['Physik'] } },
      'taken strictly, and not marked loose');
    const masze = await resolveCollectionByName('MAßE');
    assert.equal(masze.ok && masze.collection.nodeId, 'c-masze');
  } finally { mock.restore(); }
});

test('loose only when nothing matches strictly — and then it is said', async () => {
  const mock = repository([{ id: 'c-gr', title: 'Größen und Einheiten', under: ['Mathematik'] }]);
  try {
    const strict = await resolveCollectionByName('größen-und   EINHEITEN');
    assert.equal(strict.ok && strict.collection.nodeId, 'c-gr');
    assert.equal(strict.ok && 'matched' in strict.collection, false);
    for (const spelled of ['groessen und einheiten', 'GRÖSSEN UND EINHEITEN', 'Größenundeinheiten']) {
      const r = await resolveCollectionByName(spelled);
      assert.equal(r.ok && r.collection.nodeId, 'c-gr', spelled);
      assert.equal(r.ok && r.collection.matched, 'loose', spelled);
    }
  } finally { mock.restore(); }
});

test('two loosely equal titles and no strict one: ambiguous, none is taken', async () => {
  const mock = repository([{ id: 'c-masse', title: 'Masse' }, { id: 'c-masze', title: 'Maße' }]);
  try {
    const r = await resolveCollectionByName('Mas-se');
    assert.equal(!r.ok && r.reason, 'several');
    assert.deepEqual(!r.ok && r.candidates.map(c => c.nodeId).sort(), ['c-masse', 'c-masze']);
  } finally { mock.restore(); }
});

test('two collections with the same title: none is taken, both are offered with their paths', async () => {
  const mock = repository([
    { id: 'c-mech-7', title: 'Mechanik', under: ['Physik', 'Klasse 7'], count: 12 },
    { id: 'c-kin', title: 'Kinematik', under: ['Physik'] },
    { id: 'c-mech-s2', title: 'Mechanik', under: ['Physik', 'Sekundarstufe II'] },
  ]);
  try {
    const r = await resolveCollectionByName('Mechanik');
    assert.equal(r.ok, false);
    if (r.ok) return;
    assert.equal(r.reason, 'several');
    assert.deepEqual(r.candidates.slice(0, 2).map(c => [c.nodeId, c.path]).sort(), [
      ['c-mech-7', ['Physik', 'Klasse 7']],
      ['c-mech-s2', ['Physik', 'Sekundarstufe II']],
    ], 'the namesakes lead the list — their paths are what tells them apart');
    assert.equal(r.candidates.find(c => c.nodeId === 'c-mech-7')?.contentsCount, 12);
    assert.equal('contentsCount' in r.candidates.find(c => c.nodeId === 'c-mech-s2')!, false,
      'a count the search did not carry is omitted, not read and not zero');
  } finally { mock.restore(); }
});

test('no collection with exactly that title: nothing is guessed from a prefix or a substring', async () => {
  const mock = repository([
    { id: 'c-gv', title: 'Genetik und Vererbung', under: ['Biologie'] },
    { id: 'c-mol', title: 'Molekulargenetik', under: ['Biologie'] },
  ]);
  try {
    const r = await resolveCollectionByName('Genetik');
    assert.equal(r.ok, false);
    if (r.ok) return;
    assert.equal(r.reason, 'none');
    assert.deepEqual(r.candidates.map(c => c.nodeId).sort(), ['c-gv', 'c-mol']);
    assert.equal(r.incomplete, false);
  } finally { mock.restore(); }
});

test('at most five candidates', async () => {
  const mock = repository(Array.from({ length: 9 }, (_, i) => ({ id: `c-${i}`, title: `Optik ${i}` })));
  try {
    const r = await resolveCollectionByName('Optik');
    assert.equal(!r.ok && r.candidates.length, 5);
  } finally { mock.restore(); }
});

// ── The subject ─────────────────────────────────────────────────────────────

test('a discipline tells namesakes apart', async () => {
  const mock = repository([
    { id: 'c-en-ph', title: 'Energie', under: ['Physik'], taxon: PHYSIK },
    { id: 'c-en-bio', title: 'Energie', under: ['Biologie'], taxon: BIOLOGIE },
  ]);
  try {
    const r = await resolveCollectionByName('Energie', 'Biologie');
    assert.equal(r.ok && r.collection.nodeId, 'c-en-bio');
  } finally { mock.restore(); }
});

test('a discipline that names no subject is reported and narrows nothing', async () => {
  const mock = repository([OPTIK]);
  try {
    const r = await resolveCollectionByName('Optik', 'Zzyzxkunde');
    assert.equal(r.ok && r.collection.nodeId, 'c-optik', 'the unknown subject must not empty the lookup');
    assert.equal(r.unresolvedDiscipline?.value, 'Zzyzxkunde');
  } finally { mock.restore(); }
});

test('a namesake outside the named subject is still offered, after the ones inside', async () => {
  const mock = repository([{ id: 'c-en-ph', title: 'Energie', under: ['Physik'], taxon: PHYSIK }]);
  try {
    const r = await resolveCollectionByName('Energie', 'Biologie');
    assert.equal(r.ok, false, 'the only "Energie" is not a Biologie collection — it is not taken');
    assert.deepEqual(!r.ok && r.candidates.map(c => c.nodeId), ['c-en-ph']);
  } finally { mock.restore(); }
});

// ── Not reachable is not "none" ─────────────────────────────────────────────

test('an index that did not answer: no equal title is then NOT a finding', async () => {
  const mock = repository([], { mdsStatus: 503 });
  try {
    const r = await resolveCollectionByName('Optik');
    assert.deepEqual(r, { ok: false, reason: 'none', candidates: [], incomplete: true, unreachable: true });
  } finally { mock.restore(); }
});

// Supersedes the first cut, which took it: the namesake may sit in the index that was down.
test('a unique equal title found while an index was down is NOT taken — it is offered', async () => {
  for (const opts of [{ mdsStatus: 503, nameLeg: [OPTIK] }, { nameStatus: 503 }] as RepoOptions[]) {
    const mock = repository(opts.nameLeg ? [] : [OPTIK], opts);
    try {
      const r = await resolveCollectionByName('Optik');
      assert.equal(r.ok, false, JSON.stringify(opts));
      if (r.ok) return;
      assert.deepEqual([r.reason, r.incomplete, r.unreachable, r.windowFull], ['unverified', true, true, undefined]);
      assert.deepEqual(r.candidates.map(c => c.nodeId), ['c-optik']);
    } finally { mock.restore(); }
  }
});

// ── A full window is not "everything" ───────────────────────────────────────

// A full first window used to end in a refusal at once; measured 2026-11-13 that
// refused 9 of 24 real titles which had exactly one equal-titled collection.
// It is now VERIFIED over wider windows, once.

test('a full first window is verified over wider ones: one equal title and room to spare → taken', async () => {
  for (const [label, colls, opts] of [
    ['keyword index full', [OPTIK, ...fillers(24)], {}],
    ['name index full', [], { nameLeg: [OPTIK, ...fillers(4, 'n')] }],
  ] as Array<[string, Coll[], RepoOptions]>) {
    const mock = repository(colls, opts);
    try {
      const r = await resolveCollectionByName('Optik');
      assert.deepEqual(r, { ok: true, collection: { nodeId: 'c-optik', title: 'Optik', path: ['Physik'] } }, label);
      assert.deepEqual(windows(mock.calls), [`mds=${FIRST_MDS}`, `mds=${WIDE_MDS}`, `name=${FIRST_NAME}`, `name=${WIDE_NAME}`].sort(),
        `${label}: the first pass, then exactly one wider request per index`);
      const after = mock.calls.length;
      await resolveCollectionByName('Optik');
      assert.equal(mock.calls.length, after, `${label}: a verified resolution is remembered like any other`);
    } finally { mock.restore(); }
  }
});

test('the first window was not full: no wider request is sent', async () => {
  const mock = repository([OPTIK, ...fillers(19)], { nameLeg: fillers(4, 'n') });
  try {
    const r = await resolveCollectionByName('Optik');
    assert.equal(r.ok && r.collection.nodeId, 'c-optik');
    assert.deepEqual(windows(mock.calls), [`mds=${FIRST_MDS}`, `name=${FIRST_NAME}`]);
  } finally { mock.restore(); }
});

test('no equal title, or several, in a full first window: widening cannot help and is not asked', async () => {
  for (const colls of [fillers(30), [OPTIK, { id: 'c-optik-2', title: 'Optik' }, ...fillers(30)]]) {
    const mock = repository(colls);
    try {
      const r = await resolveCollectionByName('Optik');
      assert.deepEqual(!r.ok && [r.reason, r.windowFull], [colls.length === 30 ? 'none' : 'several', true]);
      assert.deepEqual(windows(mock.calls), [`mds=${FIRST_MDS}`, `name=${FIRST_NAME}`]);
    } finally { mock.restore(); }
  }
});

test('the wider keyword window reveals a second namesake: several, none is taken', async () => {
  const mock = repository([OPTIK, ...fillers(29), { id: 'c-optik-far', title: 'OPTIK', under: ['Technik'] }]);
  try {
    const r = await resolveCollectionByName('Optik');
    assert.equal(r.ok, false);
    if (r.ok) return;
    assert.deepEqual([r.reason, r.incomplete, r.windowFull], ['several', false, undefined],
      'both namesakes were seen in windows that were not full');
    assert.deepEqual(r.candidates.slice(0, 2).map(c => c.nodeId).sort(), ['c-optik', 'c-optik-far']);
  } finally { mock.restore(); }
});

test('the wider name window reveals a second namesake — and only equal titles are re-read', async () => {
  const far: Coll = { id: 'n-optik-far', title: 'Optik', under: ['Technik'] };
  const mock = repository([OPTIK], { nameLeg: [...fillers(9, 'n'), far, ...fillers(3, 'm')] });
  try {
    const r = await resolveCollectionByName('Optik');
    assert.equal(!r.ok && r.reason, 'several');
    assert.deepEqual(!r.ok && r.candidates.slice(0, 2).map(c => c.nodeId).sort(), ['c-optik', 'n-optik-far']);
    // First pass: its five name hits, as before. Wide pass: the ONE equal title among thirteen.
    assert.deepEqual(reReads(mock.calls), ['n-0', 'n-1', 'n-2', 'n-3', 'n-4', 'n-optik-far']);
  } finally { mock.restore(); }
});

// Gone or not answered — the bulk re-read cannot tell, so "the only one" is not claimed.
test('the wider name window names a namesake whose re-read FAILS: not taken, the first hit is offered', async () => {
  for (const status of [404, 503]) {
    const far: Coll = { id: 'n-optik-far', title: 'Optik', under: ['Technik'] };
    const mock = repository([OPTIK], { nameLeg: [...fillers(9, 'n'), far], reReadStatus: { [far.id]: status } });
    try {
      const r = await resolveCollectionByName('Optik');
      assert.equal(r.ok, false, String(status));
      if (r.ok) return;
      assert.deepEqual([r.reason, r.incomplete, r.unreachable], ['unverified', true, true], String(status));
      assert.equal(r.candidates[0]?.nodeId, 'c-optik', String(status));
      assert.ok(reReads(mock.calls).includes(far.id), 'the namesake was seen on the name leg and its re-read tried');
      await resolveCollectionByName('Optik');
      assert.equal(searches(mock.calls), 8, 'and nothing was remembered');
    } finally { mock.restore(); }
  }
});

test('the wider window is STILL full: found, not taken — the honest case stays honest', async () => {
  for (const [label, colls, opts] of [
    ['keyword index', [OPTIK, ...fillers(WIDE_MDS - 1)], {}],
    ['name index', [], { nameLeg: [OPTIK, ...fillers(WIDE_NAME - 1, 'n')] }],
  ] as Array<[string, Coll[], RepoOptions]>) {
    const mock = repository(colls, opts);
    try {
      const r = await resolveCollectionByName('Optik');
      assert.equal(r.ok, false, label);
      if (r.ok) return;
      assert.deepEqual([r.reason, r.incomplete, r.windowFull, r.unreachable], ['unverified', true, true, undefined], label);
      assert.equal(r.candidates[0]?.nodeId, 'c-optik', 'the equal title leads the candidates');
      assert.equal(searches(mock.calls), 4, label);
    } finally { mock.restore(); }
    // One fewer and the wider window had room: taken.
    const below = repository(colls.slice(0, -1), opts.nameLeg ? { nameLeg: opts.nameLeg.slice(0, -1) } : {});
    try {
      const r = await resolveCollectionByName('Optik');
      assert.equal(r.ok && r.collection.nodeId, 'c-optik', label);
    } finally { below.restore(); }
  }
});

test('an index down during the verification: not taken, and said as unreachable', async () => {
  for (const downWhenWide of ['mds', 'name'] as const) {
    const mock = repository([OPTIK, ...fillers(24)], { downWhenWide });
    try {
      const r = await resolveCollectionByName('Optik');
      assert.equal(r.ok, false, downWhenWide);
      if (r.ok) return;
      assert.deepEqual([r.reason, r.incomplete, r.unreachable], ['unverified', true, true], downWhenWide);
      assert.deepEqual(r.candidates.map(c => c.nodeId).slice(0, 1), ['c-optik'], 'the hit of the first pass is still offered');
      await resolveCollectionByName('Optik');
      assert.equal(searches(mock.calls), 8, 'and nothing was remembered');
    } finally { mock.restore(); }
  }
});

test('the verification changes nothing for the list callers: same two requests, same windows', async () => {
  const mock = repository([OPTIK, ...fillers(40)], { nameLeg: fillers(40, 'n') });
  try {
    const r = await searchCollectionsResult('Optik', 10);
    assert.deepEqual(windows(mock.calls), ['mds=10', 'name=5']);
    assert.deepEqual(reReads(mock.calls), ['n-0', 'n-1', 'n-2', 'n-3', 'n-4'], 'every new name hit is re-read, as before');
    assert.deepEqual(r.full, ['keyword', 'name']);
    assert.equal(r.nodes.length, 10);
  } finally { mock.restore(); }
});

// ── A hit without a discipline ──────────────────────────────────────────────

test('a namesake that carries no discipline is not excluded by one: the pair stays ambiguous', async () => {
  const mock = repository([
    { id: 'c-en-ph', title: 'Energie', under: ['Physik'], taxon: PHYSIK },
    { id: 'c-en-x', title: 'Energie', under: ['Projekte'] },
    { id: 'c-en-bio', title: 'Energie', under: ['Biologie'], taxon: BIOLOGIE },
  ]);
  try {
    const r = await resolveCollectionByName('Energie', 'Physik');
    assert.equal(r.ok, false);
    if (r.ok) return;
    assert.equal(r.reason, 'several');
    assert.deepEqual(r.candidates.map(c => [c.nodeId, c.disciplineUnknown]), [
      ['c-en-ph', undefined], ['c-en-x', true], ['c-en-bio', undefined],
    ], 'inside the subject and unknown first, the other subject last');
  } finally { mock.restore(); }
});

test('a path that cannot be read is omitted, never invented', async () => {
  const mock = repository([OPTIK], { parentsStatus: 500 });
  try {
    const r = await resolveCollectionByName('Optik');
    assert.deepEqual(r, { ok: true, collection: { nodeId: 'c-optik', title: 'Optik' } });
  } finally { mock.restore(); }
});

// ── The short memory ────────────────────────────────────────────────────────

test('a resolution is remembered: the second identical call asks no search', async () => {
  const mock = repository([OPTIK]);
  try {
    const first = await resolveCollectionByName('Optik');
    const after = mock.calls.length;
    const second = await resolveCollectionByName('  optik ');
    assert.deepEqual(second, first);
    assert.equal(mock.calls.length, after, 'no upstream call for a remembered resolution');
  } finally { mock.restore(); }
});

test('only a unique, complete resolution is remembered', async () => {
  // Ambiguous: asked again.
  let mock = repository([{ id: 'a', title: 'Mechanik' }, { id: 'b', title: 'Mechanik' }]);
  try {
    await resolveCollectionByName('Mechanik');
    await resolveCollectionByName('Mechanik');
    assert.equal(searches(mock.calls), 4, 'two legs, twice');
  } finally { mock.restore(); }
  // Found on one index while the other was down: the namesake may sit there.
  mock = repository([], { mdsStatus: 503, nameLeg: [OPTIK] });
  try {
    await resolveCollectionByName('Optik');
    await resolveCollectionByName('Optik');
    assert.equal(searches(mock.calls), 4);
  } finally { mock.restore(); }
});

test('a personal login neither reads nor feeds the shared memory', async () => {
  const maria: WloCredential = { header: 'Basic bWFyaWE6eA==', label: 'maria', source: 'user' } as WloCredential;
  const mock = repository([OPTIK]);
  try {
    await runWithCredential(maria, () => resolveCollectionByName('Optik'));
    await runWithCredential(maria, () => resolveCollectionByName('Optik'));
    assert.equal(searches(mock.calls), 4, 'her own second call is asked again');
    await resolveCollectionByName('Optik');
    assert.equal(searches(mock.calls), 6, 'and an anonymous caller does not get her answer');
  } finally { mock.restore(); }
});

test('the memory is keyed by whose rights read it: the service account and anonymous do not share', async () => {
  const service: WloCredential = { header: 'Basic c3ZjOng=', label: 'svc', source: 'service' };
  const mock = repository([OPTIK]);
  try {
    await runWithCredential(service, () => resolveCollectionByName('Optik'));
    await runAnonymous(() => resolveCollectionByName('Optik'));
    assert.equal(searches(mock.calls), 4, 'an anonymous caller is not answered from the service account\'s read');
    await runWithCredential(service, () => resolveCollectionByName('Optik'));
    assert.equal(searches(mock.calls), 4, 'the service account itself is');
  } finally { mock.restore(); }
});

// ── The five tools ──────────────────────────────────────────────────────────

interface Structured {
  resolvedCollection?: { nodeId: string; title: string; path?: string[]; matched?: string; unresolvedDiscipline?: { value: string } };
  error?: {
    code: string; message: string; incomplete?: boolean; windowFull?: boolean;
    candidates?: Array<{ nodeId: string; title: string; path?: string[]; disciplineUnknown?: boolean }>;
  };
}

async function call(name: string, args: Record<string, unknown>, colls: Coll[], opts: RepoOptions & { strict?: boolean } = {}) {
  stopSkillRegistryCache();
  const mock = repository(colls, opts);
  // Always the strict client: with the tool list in hand it validates EVERY
  // `structuredContent` against the advertised schema — success and coded error.
  const c = await strictClient();
  try {
    const r = await c.callTool({ name, arguments: args });
    const blocks = (r.content as Array<{ text: string }>).map(b => b.text);
    return { r, sc: r.structuredContent as Structured, blocks, calls: mock.calls };
  } finally { await c.close(); mock.restore(); }
}

const TOOLS: Array<{ name: string; id: string; formats: Array<string | undefined> }> = [
  { name: 'get_collection_overview', id: 'collectionId', formats: [undefined] },
  { name: 'get_collection_contents', id: 'nodeId', formats: ['markdown', 'json'] },
  { name: 'get_compendium_text', id: 'nodeId', formats: ['markdown', 'json'] },
  { name: 'search_wlo_within_collection', id: 'nodeId', formats: ['markdown', 'json'] },
  { name: 'browse_collection_tree', id: 'nodeId', formats: ['markdown', 'json'] },
];

for (const tool of TOOLS) {
  for (const format of tool.formats) {
    const fmt = format ? { outputFormat: format } : {};
    const label = `${tool.name}${format ? ` (${format})` : ''}`;

    test(`${label}: a title runs the tool on that collection and says which one`, async () => {
      const { r, sc, blocks, calls } = await call(tool.name, { collection: 'optik', ...fmt }, [OPTIK]);
      assert.notEqual(r.isError, true, toolText(r));
      assert.deepEqual(sc.resolvedCollection, { nodeId: 'c-optik', title: 'Optik', path: ['Physik'] });
      assert.ok(calls.some(c => /\/c-optik\/(children|metadata)/.test(c.url)), 'the tool itself ran on the resolved id');
      if (format === 'json') {
        const payload = JSON.parse(blocks[0]!) as Structured;
        assert.equal(payload.resolvedCollection?.nodeId, 'c-optik', 'block 0 stays JSON and carries the field');
        assert.ok(blocks.some(b => b.startsWith('Sammlung: Optik (unter Physik) — c-optik')));
      } else {
        assert.ok(blocks[0]!.startsWith('Sammlung: Optik (unter Physik) — c-optik\n'), blocks[0]!.slice(0, 120));
      }
    });

    test(`${label}: an ambiguous title returns candidates and the tool does not run`, async () => {
      const { r, sc, blocks, calls } = await call(tool.name, { collection: 'Genetik', ...fmt }, [
        { id: 'c-gv', title: 'Genetik und Vererbung', under: ['Biologie'] },
        { id: 'c-mol', title: 'Molekulargenetik', under: ['Biologie'] },
      ]);
      assert.equal(r.isError, true);
      assert.equal(sc.error?.code, 'ambiguous_collection');
      assert.deepEqual(sc.error?.candidates?.map(c => [c.nodeId, c.path]).sort(),
        [['c-gv', ['Biologie']], ['c-mol', ['Biologie']]]);
      assert.match(toolText(r), /Keine Sammlung trägt genau den Titel „Genetik“/);
      const other = calls.filter(c => !c.url.includes(MDS) && !c.url.includes(NAME) && !c.url.includes('/parents'));
      assert.deepEqual(other.map(c => c.url), [], 'nothing was listed or read for a candidate');
      if (format === 'json') assert.equal((JSON.parse(blocks[0]!) as Structured).error?.code, 'ambiguous_collection');
    });

    test(`${label}: an id beside a title — the title is ignored and nothing is looked up`, async () => {
      const args = { [tool.id]: 'c-optik', ...fmt };
      const plain = await call(tool.name, args, [OPTIK]);
      const both = await call(tool.name, { ...args, collection: 'Mechanik', discipline: 'Physik' }, [OPTIK]);
      assert.equal(searches(both.calls), searches(plain.calls), 'no collection search for the name');
      assert.deepEqual(both.calls.map(c => c.url).sort(), plain.calls.map(c => c.url).sort(), 'the same upstream calls as before');
      assert.equal(both.sc.resolvedCollection, undefined);
      assert.deepEqual(both.blocks.slice(0, 1), plain.blocks.slice(0, 1));
    });
  }
}

test('several namesakes: the sentence says so and names the narrowing parameter of THIS tool', async () => {
  const twins: Coll[] = [
    { id: 'c-en-ph', title: 'Energie', under: ['Physik'], taxon: PHYSIK, count: 3 },
    { id: 'c-en-bio', title: 'Energie', under: ['Biologie'], taxon: BIOLOGIE },
  ];
  const plain = await call('get_collection_contents', { collection: 'Energie' }, twins);
  assert.match(toolText(plain.r), /Mehrere Sammlungen tragen den Titel „Energie“.*`discipline`/);
  assert.match(toolText(plain.r), /- Energie \(unter Physik\) — nodeId: c-en-ph · 3 Inhalte/);
  const within = await call('search_wlo_within_collection', { collection: 'Energie' }, twins);
  assert.match(toolText(within.r), /`collectionDiscipline`/);

  // …and that parameter resolves it; `discipline` there stays the content filter.
  const narrowed = await call('search_wlo_within_collection',
    { collection: 'Energie', collectionDiscipline: 'Biologie', discipline: 'Physik' }, twins);
  assert.equal(narrowed.sc.resolvedCollection?.nodeId, 'c-en-bio');
});

test('a search index down and no match: the answer says "did not answer", not "no such collection"', async () => {
  const { r, sc } = await call('get_collection_contents', { collection: 'Optik' }, [], { nameStatus: 503 });
  assert.equal(sc.error?.code, 'ambiguous_collection');
  assert.equal(sc.error?.incomplete, true);
  assert.match(toolText(r), /hat nicht \(vollständig\) geantwortet/);
});

test('an unresolvable discipline is said in the answer and carried in resolvedCollection', async () => {
  const { r, sc } = await call('get_collection_contents', { collection: 'Optik', discipline: 'Zzyzxkunde' }, [OPTIK]);
  assert.notEqual(r.isError, true, toolText(r));
  assert.equal(sc.resolvedCollection?.unresolvedDiscipline?.value, 'Zzyzxkunde');
  assert.match(toolText(r), /Filter "Zzyzxkunde" für discipline nicht erkannt/);
});

test('browse_collection_tree: `subject` beside `collection` narrows the lookup instead of opening the portal', async () => {
  const twins: Coll[] = [
    { id: 'c-en-ph', title: 'Energie', under: ['Physik'], taxon: PHYSIK },
    { id: 'c-en-bio', title: 'Energie', under: ['Biologie'], taxon: BIOLOGIE },
  ];
  const { r, sc, calls } = await call('browse_collection_tree', { collection: 'Energie', subject: 'Physik' }, twins);
  assert.notEqual(r.isError, true, toolText(r));
  assert.equal(sc.resolvedCollection?.nodeId, 'c-en-ph');
  assert.ok(!calls.some(c => c.url.includes(`/${WLO_ROOT_COLLECTION_ID}/children`)), 'the portal list is not read');
});

// The id lost its `required` entry on purpose (an id OR a title) — so the
// handler answers for what the schema no longer refuses.
test('neither an id nor a title, or a blank id: invalid_input before any upstream call', async () => {
  const idOf = { get_collection_overview: 'collectionId', get_collection_contents: 'nodeId', search_wlo_within_collection: 'nodeId' };
  for (const [name, id] of Object.entries(idOf)) {
    for (const args of [{}, { [id]: '' }, { [id]: '   ' }, { [id]: '', collection: '  ' }]) {
      const { r, sc, calls } = await call(name, args, [OPTIK]);
      const label = `${name} ${JSON.stringify(args)}`;
      assert.equal(r.isError, true, label);
      assert.equal(sc.error?.code, 'invalid_input', label);
      assert.match(sc.error?.message ?? '', new RegExp(`${id} oder collection`), label);
      assert.equal(calls.length, 0, label);
    }
  }
});

test('the id parameter of those three tools says "id OR collection", and neither is required', async () => {
  const c = await strictClient();
  try {
    const { tools } = await c.listTools();
    for (const [name, id] of [['get_collection_overview', 'collectionId'], ['get_collection_contents', 'nodeId'], ['search_wlo_within_collection', 'nodeId']] as const) {
      const schema = tools.find(t => t.name === name)!.inputSchema as { required?: string[]; properties: Record<string, { description?: string }> };
      assert.equal((schema.required ?? []).includes(id), false, name);
      assert.match(schema.properties[id]!.description ?? '', new RegExp(`${id} (ODER|OR) \`collection\``), name);
    }
  } finally { await c.close(); }
});

test('a blank id beside a title: the title is resolved', async () => {
  const { r, sc } = await call('get_collection_contents', { nodeId: ' ', collection: 'Optik' }, [OPTIK]);
  assert.notEqual(r.isError, true, toolText(r));
  assert.equal(sc.resolvedCollection?.nodeId, 'c-optik');
});

test('a loose match is said in the text and carried as resolvedCollection.matched', async () => {
  const colls = [{ id: 'c-gr', title: 'Größen', under: ['Mathematik'] }];
  const loose = await call('get_collection_contents', { collection: 'Groessen' }, colls);
  assert.notEqual(loose.r.isError, true, toolText(loose.r));
  assert.equal(loose.sc.resolvedCollection?.matched, 'loose');
  assert.match(loose.blocks[0]!, /^Sammlung: Größen \(unter Mathematik\) — c-gr\nDer Titel stimmt nur in abweichender Schreibweise überein/);
  const strict = await call('get_collection_contents', { collection: 'größen' }, colls);
  assert.equal(strict.sc.resolvedCollection?.matched, undefined);
  assert.doesNotMatch(toolText(strict.r), /abweichender Schreibweise/);
});

test('found but not taken: the answer says why, and carries incomplete', async () => {
  const down = await call('get_collection_contents', { collection: 'Optik' }, [OPTIK], { nameStatus: 503 });
  assert.equal(down.r.isError, true);
  assert.deepEqual([down.sc.error?.code, down.sc.error?.incomplete, down.sc.error?.windowFull], ['ambiguous_collection', true, undefined]);
  assert.deepEqual(down.sc.error?.candidates?.map(c => c.nodeId), ['c-optik']);
  assert.match(toolText(down.r), /wurde gefunden, aber nicht übernommen/);
  assert.match(toolText(down.r), /war nur teilweise erreichbar/);
  assert.ok(!down.calls.some(c => c.url.includes('/c-optik/children')), 'the tool did not run');

  const full = await call('get_collection_contents', { collection: 'Optik' },
    [OPTIK, ...fillers(WIDE_MDS - 1)]);
  assert.deepEqual([full.sc.error?.code, full.sc.error?.incomplete, full.sc.error?.windowFull], ['ambiguous_collection', true, true]);
  assert.match(toolText(full.r), /Die Suche hat mehr Treffer, als geprüft wurden/);
  assert.doesNotMatch(toolText(full.r), /teilweise erreichbar/);
});

test('a candidate without a discipline says so', async () => {
  const { r, sc } = await call('get_collection_contents', { collection: 'Energie', discipline: 'Physik' }, [
    { id: 'c-en-ph', title: 'Energie', under: ['Physik'], taxon: PHYSIK },
    { id: 'c-en-x', title: 'Energie', under: ['Projekte'] },
  ]);
  assert.equal(sc.error?.code, 'ambiguous_collection');
  assert.equal(sc.error?.candidates?.find(c => c.nodeId === 'c-en-x')?.disciplineUnknown, true);
  assert.match(toolText(r), /- Energie \(unter Projekte\) — nodeId: c-en-x · Fach unbekannt/);
});
