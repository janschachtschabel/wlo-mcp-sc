/**
 * measure-tree-reading.ts – what the tree tools can know about positions, and
 * what a content count costs (`npm run measure:tree`; wishes S11–S13 of the
 * chatbot team, 2026-11-15).
 *
 * ANONYMOUS and read-only: plain `fetch` without any credential — deliberately
 * not `wloFetch`, which would attach the operator's login when one is
 * configured — and the npm script loads no `.env`. It writes nothing and
 * creates nothing. Staging only.
 *
 * Three questions:
 *   1. Does a children listing carry `ccm:collection_ordered_position` per
 *      child, what does an unset one look like, and do ties exist?
 *   2. Where does the time of `includeContentCounts` go, and is another form
 *      of the count request, a wider pool or ONE search facet faster?
 *   3. What does the first request of a fresh process cost (DNS, TLS)?
 */

import { BASE_URL, WLO_ROOT_COLLECTION_ID } from '../src/wlo-config.js';

if (!new URL(BASE_URL).hostname.includes('staging')) {
  console.error(`refusing: ${new URL(BASE_URL).hostname} is not a staging host`);
  process.exit(1);
}

const POSITION = 'ccm:collection_ordered_position';
/** `--quick`: only the positions and the tool's own timing — a tenth of the requests. */
const QUICK = process.argv.includes('--quick');
const SUBJECT = process.argv.slice(2).find(a => !a.startsWith('--')) ?? 'Physik';

interface Listed { ref?: { id?: string }; title?: string; properties?: Record<string, string[]> }
interface Answer { status: number; ms: number; bytes: number; body: { nodes?: Listed[]; pagination?: { total: number }; facets?: unknown } | null }

let sent = 0;
async function ask(url: string, init: RequestInit = {}): Promise<Answer> {
  sent += 1;
  const started = performance.now();
  const res = await fetch(url, { ...init, headers: { Accept: 'application/json', ...(init.body ? { 'Content-Type': 'application/json' } : {}) } });
  const text = await res.text();
  const ms = performance.now() - started;
  let body: Answer['body'] = null;
  try { body = JSON.parse(text) as Answer['body']; } catch { /* reported as status + null */ }
  return { status: res.status, ms, bytes: text.length, body };
}

async function pooled<T, R>(items: T[], width: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let at = 0;
  await Promise.all(Array.from({ length: Math.min(width, items.length) }, async () => {
    while (at < items.length) { const i = at++; out[i] = await fn(items[i]!); }
  }));
  return out;
}

const median = (xs: number[]): number => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]!;
const secs = (ms: number): string => (ms / 1000).toFixed(2);

const children = (parent: string, query: string): string => `${BASE_URL}/node/v1/nodes/-home-/${parent}/children?${query}`;
const FOLDERS = `filter=folders&maxItems=100&propertyFilter=cm:title&propertyFilter=${encodeURIComponent(POSITION)}`;
const SORTED = `&sortProperties=${encodeURIComponent(POSITION)}&sortAscending=true`;

// ── 3. the first request of this process ────────────────────────────────────
const first = await ask(children(WLO_ROOT_COLLECTION_ID, `${FOLDERS}${SORTED}`));
const second = await ask(children(WLO_ROOT_COLLECTION_ID, `${FOLDERS}${SORTED}`));
console.log('== first request of a fresh process ==');
console.log(`first ${first.ms.toFixed(0)} ms (HTTP ${first.status}), the same again ${second.ms.toFixed(0)} ms`);

// ── 1. positions ────────────────────────────────────────────────────────────
interface ParentStat { id: string; title: string; kids: number; positioned: number; distinct: number; tied: number; values: string[] }
function stat(id: string, title: string, nodes: Listed[]): ParentStat {
  const values = nodes.map(n => n.properties?.[POSITION]).filter((v): v is string[] => v !== undefined).map(v => JSON.stringify(v));
  const distinct = new Set(values).size;
  return { id, title, kids: nodes.length, positioned: values.length, distinct, tied: values.length - distinct, values };
}

const portals = first.body?.nodes ?? [];
const portal = portals.find(p => p.title === SUBJECT);
if (!portal?.ref?.id) { console.error(`no portal titled ${SUBJECT}`); process.exit(1); }

console.log('\n== positions: does the listing carry them? ==');
const rootStat = stat(WLO_ROOT_COLLECTION_ID, '(root)', portals);
console.log(`root: ${rootStat.kids} children, ${rootStat.positioned} with the property, ${rootStat.distinct} distinct value(s): ${[...new Set(rootStat.values)].join(' ')}`);
console.log(`an unset one: ${JSON.stringify(portals.find(p => p.properties?.[POSITION] === undefined)?.properties)}`);
const plain = await ask(children(WLO_ROOT_COLLECTION_ID, FOLDERS));
const same = JSON.stringify(plain.body?.nodes?.map(n => n.ref?.id)) === JSON.stringify(portals.map(n => n.ref?.id));
console.log(`root, sorted vs. unsorted listing: ${same ? 'same order' : 'different order'}`);

/** The whole sub-tree of the subject portal, level by level, as the flat tool reads it. */
const walkStarted = performance.now();
const walkSentBefore = sent;
const tree: Array<{ id: string; title: string; depth: number }> = [];
const stats: ParentStat[] = [];
let level = [{ id: portal.ref.id, title: SUBJECT }];
for (let depth = 1; depth <= 4 && level.length; depth++) {
  const listings = await pooled(level, 8, p => ask(children(p.id, `${FOLDERS}${SORTED}`)));
  const next: typeof level = [];
  listings.forEach((l, i) => {
    const nodes = l.body?.nodes ?? [];
    if (l.status !== 200) console.log(`  listing of ${level[i]!.id}: HTTP ${l.status}`);
    stats.push(stat(level[i]!.id, level[i]!.title, nodes));
    for (const n of nodes) { if (n.ref?.id) { tree.push({ id: n.ref.id, title: n.title ?? '', depth }); next.push({ id: n.ref.id, title: n.title ?? '' }); } }
  });
  level = next;
}
const walkMs = performance.now() - walkStarted;
console.log(`\n${SUBJECT}: ${tree.length} collections over 4 levels, ${sent - walkSentBefore} listings in ${secs(walkMs)} s (pool 8)`);

// The first level of every portal as well: a wider sample of how positions are used.
const others = await pooled(portals.filter(p => p.ref?.id && p !== portal), 8, async p => stat(p.ref!.id!, p.title ?? '', (await ask(children(p.ref!.id!, `${FOLDERS}${SORTED}`))).body?.nodes ?? []));
const sample = [rootStat, ...stats, ...others].filter(s => s.kids > 0);
const withAny = sample.filter(s => s.positioned > 0);
console.log(`\nparents with children: ${sample.length}`);
console.log(`  no child has a position:            ${sample.filter(s => s.positioned === 0).length}`);
console.log(`  every child has one:                ${withAny.filter(s => s.positioned === s.kids).length}`);
console.log(`  some have one, some not:            ${withAny.filter(s => s.positioned < s.kids).length}`);
console.log(`  positions with a TIE:               ${withAny.filter(s => s.tied > 0).length}`);
console.log(`  two or more DIFFERENT positions:    ${withAny.filter(s => s.distinct > 1).length}`);
console.log(`  value forms seen: ${[...new Set(withAny.flatMap(s => s.values))].slice(0, 12).join(' ')}`);
for (const s of withAny.slice(0, 12)) console.log(`  · ${s.title}: ${s.positioned}/${s.kids} positioned, ${s.distinct} distinct`);

// ── 2. the content count ────────────────────────────────────────────────────
console.log(`\n== content counts for the ${tree.length} collections of ${SUBJECT} ==`);
const VARIANTS: Array<[string, string]> = [
  ['today: maxItems=1, three title properties', 'filter=files&maxItems=1&skipCount=0&propertyFilter=cm%3Atitle&propertyFilter=cclom%3Atitle&propertyFilter=cm%3Aname'],
  ['maxItems=1, one property', 'filter=files&maxItems=1&skipCount=0&propertyFilter=cm%3Aname'],
  ['maxItems=0, one property', 'filter=files&maxItems=0&skipCount=0&propertyFilter=cm%3Aname'],
];
const totals = new Map<string, number[]>();
async function run(label: string, query: string, width: number): Promise<void> {
  const times: number[] = [];
  const perCall: number[] = [];
  let failed = 0;
  let got: number[] = [];
  for (let round = 0; round < 3; round++) {
    const started = performance.now();
    const answers = await pooled(tree, width, n => ask(children(n.id, query)));
    times.push(performance.now() - started);
    perCall.push(median(answers.map(a => a.ms)));
    failed += answers.filter(a => a.status !== 200).length;
    got = answers.map(a => a.body?.pagination?.total ?? -1);
  }
  totals.set(`${label}@${width}`, got);
  console.log(`${label.padEnd(44)} pool ${String(width).padStart(2)}: ${times.map(secs).join(' / ')} s — median ${secs(median(times))} s, median call ${median(perCall).toFixed(0)} ms, failed ${failed}`);
}
if (!QUICK) {
for (const [label, query] of VARIANTS) await run(label, query, 8);
for (const width of [4, 12, 16, 24]) await run(VARIANTS[2]![0], VARIANTS[2]![1], width);
await run(VARIANTS[0]![0], VARIANTS[0]![1], 16);
const reference = totals.get(`${VARIANTS[0]![0]}@8`)!;
for (const [key, got] of totals) {
  const differ = got.filter((t, i) => t !== reference[i]).length;
  if (differ) console.log(`  DIFFERENT totals than today's request: ${key} on ${differ} collections`);
}
console.log(`  totals of every variant equal today's: ${[...totals.values()].every(g => g.every((t, i) => t === reference[i]))}`);
console.log(`  sum of direct contents: ${reference.reduce((a, b) => a + Math.max(0, b), 0)}, collections with none: ${reference.filter(t => t === 0).length}`);

console.log('\n== ONE search request that counts per collection? ==');
const search = `${BASE_URL}/search/v1/queries/-home-/mds_oeh/ngsearch?contentType=FILES&maxItems=0&skipCount=0&propertyFilter=cm%3Aname`;
// `ccm:taxonid` is the control: a facet the metadata set declares, so a 400 on the others is about THEM.
for (const property of ['ccm:taxonid', 'virtual:primaryparent_nodeid', 'ccm:collection_io_reference', 'collections.ref.id', 'virtual:parent_recursive', 'virtual:collection_id_primary', 'ccm:original']) {
  const res = await ask(search, { method: 'POST', body: JSON.stringify({ criteria: [{ property: 'ngsearchword', values: [SUBJECT] }], facets: [{ property }], facetLimit: 50, facetMinCount: 1 }) });
  const facets = (res.body?.facets ?? []) as Array<{ property?: string; values?: Array<{ value: string; count: number }> }>;
  const buckets = facets[0]?.values ?? [];
  const inTree = buckets.filter(b => tree.some(n => n.id === b.value || b.value.endsWith(n.id)));
  console.log(`facet ${property}: HTTP ${res.status}, ${buckets.length} buckets, ${inTree.length} of them collections of this tree, first: ${JSON.stringify(buckets.slice(0, 2))}`);
}
}
console.log(`\nrequests sent: ${sent}`);

// ── the tool's own walk, as built ───────────────────────────────────────────
// Imported late: the numbers above must not depend on what the server's modules
// do while they load. No `.env` is loaded, so `wloFetch` attaches no login.
console.log(`\n== list_collection_tree on ${SUBJECT} (the service function, depth 4, one page) ==`);
const { listCollectionTree } = await import('../src/services/collection-tree-flat.js');
for (const [includeContentCounts, order] of [[false, 'stored'], [true, 'stored'], [false, 'position']] as const) {
  const times: number[] = [];
  let said = '';
  for (let round = 0; round < 3; round++) {
    const started = performance.now();
    const out = await listCollectionTree({ rootId: portal.ref.id, depth: 4, maxItems: 250, skipCount: 0, includeContentCounts, order });
    times.push(performance.now() - started);
    const flagged = [out.root, ...out.items].filter(i => i.childrenPositioned !== undefined);
    said = `${out.count} items`
      + (includeContentCounts ? `, ${out.items.filter(i => i.contentCount !== undefined).length} counted` : '')
      + (order === 'position' ? `, positions decide on ${flagged.filter(i => i.childrenPositioned).length} of ${flagged.length} listed parents` : '')
      + (out.incomplete ? `, incomplete (${out.unreadParents?.length ?? 0} parents named)` : '');
  }
  console.log(`includeContentCounts=${includeContentCounts} order=${order}: ${times.map(secs).join(' / ')} s — median ${secs(median(times))} s (${said})`);
}
