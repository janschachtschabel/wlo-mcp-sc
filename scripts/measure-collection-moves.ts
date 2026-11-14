/**
 * measure-collection-moves.ts – what a repository does with the requests the
 * collection-maintenance tools need (plan 2026-11-14, packages 3 and 4;
 * `npm run measure:moves`).
 *
 *   M1  order of a collection's CONTENTS: which ids `POST …/order` takes
 *   M2  moving a collection: id, sub-tree, a namesake at the target, a target
 *       inside its own sub-tree, and what happens to locally set permissions
 *   M3  proposing a material for a collection WITHOUT write permission — the
 *       question that needs two accounts (`WLO_TEST_USER` beside the service one)
 *
 * It REPORTS and keeps nothing: throwaway nodes in the callers' own areas,
 * deleted again; one that stays is named. Staging only. No credential and no
 * account name is printed.
 */

import { BASE_URL } from '../src/wlo-config.js';
import { requireLiveTarget } from '../tests/live/guard.js';

const STAMP = `zqmv${Date.now().toString(36)}`;
type Account = 'service' | 'test';
const env = (name: string) => process.env[name] ?? '';
const NAMES = [env('WLO_SERVICE_USER'), env('WLO_TEST_USER')].filter(Boolean);
const header = (who: Account) => 'Basic ' + Buffer.from(who === 'service'
  ? `${env('WLO_SERVICE_USER')}:${env('WLO_SERVICE_PASSWORD')}` : `${env('WLO_TEST_USER')}:${env('WLO_TEST_PASSWORD')}`).toString('base64');
/** No account name leaves this script. */
const mask = (text: string) => NAMES.reduce((t, n) => t.split(n).join('<account>'), text);

interface Reply { status: number; json: Record<string, unknown> | null; text: string }
async function call(who: Account, method: string, path: string, body?: unknown): Promise<Reply> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: { Authorization: header(who), Accept: 'application/json', ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(60_000),
  });
  const text = await res.text();
  let json: Record<string, unknown> | null = null;
  try { json = JSON.parse(text) as Record<string, unknown>; } catch { /* not JSON */ }
  return { status: res.status, json, text: mask(text.replace(/\s+/g, ' ').slice(0, 220)) };
}
const say = (label: string, r: Reply, extra = '') => console.log(`  ${label}: HTTP ${r.status}${extra ? ` — ${extra}` : ''}${r.status >= 400 ? ` — ${r.text}` : ''}`);

const made: Array<{ who: Account; id: string; kind: 'collection' | 'node' }> = [];
const title = new Map<string, string>();
const name = (id: string | undefined) => (id ? title.get(id) ?? id.slice(0, 8) : '?');

async function collection(who: Account, parent: string | null, label: string): Promise<string> {
  const r = await call(who, 'POST', `/collection/v1/collections/-home-/${parent ?? '-root-'}/children`,
    { title: `${label} ${STAMP}`, properties: { 'cm:title': [`${label} ${STAMP}`] }, collection: { type: 'EDITORIAL' } });
  const id = ((r.json?.['collection'] as { ref?: { id?: string } } | undefined)?.ref?.id) ?? '';
  if (!id) throw new Error(`create collection ${label}: HTTP ${r.status} ${r.text}`);
  if (!parent) made.push({ who, id, kind: 'collection' });
  title.set(id, label);
  return id;
}
async function material(who: Account, label: string): Promise<string> {
  const r = await call(who, 'POST', '/node/v1/nodes/-home-/-userhome-/children?type=ccm%3Aio&renameIfExists=true',
    { 'cm:name': [`${label}-${STAMP}.txt`], 'cclom:title': [`${label} ${STAMP}`] });
  const id = ((r.json?.['node'] as { ref?: { id?: string } } | undefined)?.ref?.id) ?? '';
  if (!id) throw new Error(`create material ${label}: HTTP ${r.status} ${r.text}`);
  made.push({ who, id, kind: 'node' });
  title.set(id, label);
  return id;
}
interface Listed { ref?: { id?: string }; originalId?: string; properties?: Record<string, string[]> }
async function children(who: Account, id: string, filter: 'files' | 'folders', sorted = false): Promise<Listed[]> {
  const r = await call(who, 'GET', `/node/v1/nodes/-home-/${id}/children?filter=${filter}&maxItems=50&propertyFilter=-all-`
    + (sorted ? '&sortProperties=ccm%3Acollection_ordered_position&sortAscending=true' : ''));
  return (r.json?.['nodes'] as Listed[] | undefined) ?? [];
}
const showFiles = (list: Listed[]) => list.map(n => `${name(n.originalId)}@${n.properties?.['ccm:collection_ordered_position']?.[0] ?? '-'}`).join(', ') || '(none)';
const showFolders = (list: Listed[]) => list.map(n => name(n.ref?.id)).join(', ') || '(none)';

async function permissions(who: Account, id: string): Promise<string> {
  const r = await call(who, 'GET', `/node/v1/nodes/-home-/${id}/permissions`);
  const local = (r.json?.['permissions'] as { localPermissions?: { inherited?: boolean; permissions?: Array<{ permissions?: string[] }> } } | undefined)?.localPermissions;
  return `HTTP ${r.status}, inherited=${String(local?.inherited)}, local entries=${local?.permissions?.length ?? 0}`
    + ` [${(local?.permissions ?? []).map(p => (p.permissions ?? []).join('+')).join(', ')}]`;
}
async function grant(id: string, permission: string): Promise<Reply> {
  return call('service', 'POST', `/node/v1/nodes/-home-/${id}/permissions?sendMail=false&sendCopy=false`, {
    inherited: true,
    permissions: [{ authority: { authorityName: env('WLO_TEST_USER'), authorityType: 'USER' }, permissions: [permission] }],
  });
}

requireLiveTarget();
if (!env('WLO_TEST_USER') || !env('WLO_TEST_PASSWORD')) throw new Error('WLO_TEST_USER / WLO_TEST_PASSWORD are not set — M3 needs a second account.');
console.log(`stamp ${STAMP}`);

try {
  // ── M1 ────────────────────────────────────────────────────────────────────
  console.log('\nM1 order of contents');
  const r1 = await collection('service', null, 'ORDER');
  const mats = [await material('service', 'm1'), await material('service', 'm2'), await material('service', 'm3')];
  for (const m of mats) say(`file ${name(m)}`, await call('service', 'PUT', `/collection/v1/collections/-home-/${r1}/references/${m}`));
  let refs = await children('service', r1, 'files');
  console.log(`  listing plain : ${showFiles(refs)}   (reference ids differ from originals: ${refs.every(n => n.ref?.id !== n.originalId)})`);
  const refOf = (orig: string) => refs.find(n => n.originalId === orig)?.ref?.id ?? '';
  say('POST order with ORIGINAL ids [m3, m1, m2]', await call('service', 'POST', `/collection/v1/collections/-home-/${r1}/order`, [mats[2], mats[0], mats[1]]));
  say('POST order with REFERENCE ids [m3, m1, m2]', await call('service', 'POST', `/collection/v1/collections/-home-/${r1}/order`, [refOf(mats[2]!), refOf(mats[0]!), refOf(mats[1]!)]));
  console.log(`  listing plain : ${showFiles(await children('service', r1, 'files'))}`);
  console.log(`  listing sorted: ${showFiles(await children('service', r1, 'files', true))}`);
  // Mixed: sub-collections and contents in one order call?
  const sub = await collection('service', r1, 'SUB');
  refs = await children('service', r1, 'files');
  say('POST order mixing a sub-collection and references', await call('service', 'POST', `/collection/v1/collections/-home-/${r1}/order`, [refOf(mats[0]!), sub, refOf(mats[1]!), refOf(mats[2]!)]));
  console.log(`  files sorted  : ${showFiles(await children('service', r1, 'files', true))}`);
  const subNode = (await children('service', r1, 'folders', true))[0];
  console.log(`  folder position: ${subNode?.properties?.['ccm:collection_ordered_position']?.[0] ?? '-'}`);
  say('remove m2 by ORIGINAL id', await call('service', 'DELETE', `/collection/v1/collections/-home-/${r1}/references/${mats[1]}`));
  console.log(`  files after   : ${showFiles(await children('service', r1, 'files', true))}`);

  // ── M2 ────────────────────────────────────────────────────────────────────
  console.log('\nM2 moving a collection');
  const r2 = await collection('service', null, 'MOVE');
  const a = await collection('service', r2, 'A');
  const a1 = await collection('service', a, 'A1');
  const b = await collection('service', r2, 'B');
  say('file m1 into A1', await call('service', 'PUT', `/collection/v1/collections/-home-/${a1}/references/${mats[0]}`));
  say('grant the test account Consumer on A (local permission)', await grant(a, 'Consumer'));
  console.log(`  A before: ${await permissions('service', a)}`);
  const moved = await call('service', 'POST', `/node/v1/nodes/-home-/${b}/children/_move?source=${a}`);
  say('move A under B', moved, `returned id equals A: ${((moved.json?.['node'] as { ref?: { id?: string } } | undefined)?.ref?.id) === a}`);
  console.log(`  under MOVE now: ${showFolders(await children('service', r2, 'folders'))} · under B: ${showFolders(await children('service', b, 'folders'))} · under A: ${showFolders(await children('service', a, 'folders'))}`);
  console.log(`  A1 still holds: ${showFiles(await children('service', a1, 'files'))}`);
  console.log(`  A after : ${await permissions('service', a)}`);
  const parents = await call('service', 'GET', `/node/v1/nodes/-home-/${a1}/parents?propertyFilter=cm%3Atitle`);
  console.log(`  parents of A1: ${((parents.json?.['nodes'] as Listed[] | undefined) ?? []).map(n => name(n.ref?.id)).join(' < ')}`);
  const x = await collection('service', r2, 'A');
  title.set(x, 'A(second)');
  say('move a namesake "A" under B (B already holds an "A")', await call('service', 'POST', `/node/v1/nodes/-home-/${b}/children/_move?source=${x}`));
  console.log(`  under B: ${showFolders(await children('service', b, 'folders'))}`);
  say('move B under A1 (its own sub-tree)', await call('service', 'POST', `/node/v1/nodes/-home-/${a1}/children/_move?source=${b}`));
  console.log(`  under MOVE: ${showFolders(await children('service', r2, 'folders'))}`);
  say('move a MATERIAL reference? (move collection A1 to the top level -root-)', await call('service', 'POST', `/node/v1/nodes/-home-/-root-/children/_move?source=${a1}`));

  // ── M3 ────────────────────────────────────────────────────────────────────
  console.log('\nM3 proposing without write permission (two accounts)');
  const p = await collection('service', null, 'PROPOSE');
  const t1 = await material('test', 't1');
  const t2 = await material('test', 't2');
  const propose = (who: Account, m: string) => call(who, 'PUT', `/collection/v1/collections/-home-/${p}/references/${m}?asProposal=true`);
  say('test account, NO right on the collection: propose t1', await propose('test', t1));
  say('grant the test account Consumer on the collection', await grant(p, 'Consumer'));
  say('test account, may READ the collection: plain filing of t1', await call('test', 'PUT', `/collection/v1/collections/-home-/${p}/references/${t1}`));
  say('test account, may READ the collection: propose t1', await propose('test', t1));
  say('test account: propose t1 a second time', await propose('test', t1));
  say('test account: propose t2', await propose('test', t2));
  for (const who of ['service', 'test'] as const) {
    const list = await call(who, 'GET', `/collection/v1/collections/-home-/${p}/children/proposals?status=PENDING&maxItems=20`);
    const nodes = (list.json?.['nodes'] as Array<Record<string, unknown>> | undefined) ?? [];
    say(`${who}: list PENDING proposals`, list, `${nodes.length} entries; keys of one: ${Object.keys(nodes[0] ?? {}).filter(k => ['proposal', 'status', 'accessible', 'ref', 'originalId'].includes(k)).join(', ')}`
      + `; accessible=${JSON.stringify(nodes.map(n => n['accessible']))}; titles=${JSON.stringify(nodes.map(n => name((n['ref'] as { id?: string } | undefined)?.id)))}`);
    if (who === 'service' && nodes[0]) {
      const prop = nodes[0]['proposal'] as { ref?: { id?: string }; type?: string; properties?: Record<string, string[]> } | undefined;
      console.log(`    proposal node: type=${prop?.type}, status=${prop?.properties?.['ccm:collection_proposal_status']?.[0]}, target set=${Boolean(prop?.properties?.['ccm:collection_proposal_target']?.[0])}`);
    }
  }
  console.log(`  references in the collection (service): ${showFiles(await children('service', p, 'files'))}`);
  const usage = await call('test', 'GET', `/usage/v1/usages/node/${t1}/collections`);
  console.log(`  usage of t1 (test account): HTTP ${usage.status} ${JSON.stringify(((usage.json as unknown as Array<{ collectionUsageType?: string }> | null) ?? []).map?.(u => u.collectionUsageType) ?? usage.text)}`);
  say('service: can it READ the proposed material t1 (owned by the test account)?', await call('service', 'GET', `/node/v1/nodes/-home-/${t1}/metadata?propertyFilter=cm%3Aname`));
  say('service ACCEPTS t1: plain filing', await call('service', 'PUT', `/collection/v1/collections/-home-/${p}/references/${t1}`));
  console.log(`  references in the collection: ${showFiles(await children('service', p, 'files'))}`);
  const after = await call('service', 'GET', `/collection/v1/collections/-home-/${p}/children/proposals?status=PENDING&maxItems=20`);
  const pending = (after.json?.['nodes'] as Array<Record<string, unknown>> | undefined) ?? [];
  console.log(`  PENDING after the filing: ${pending.length} (${pending.map(n => name((n['ref'] as { id?: string } | undefined)?.id)).join(', ')})`);
  for (const n of pending) {
    const id = (n['ref'] as { id?: string } | undefined)?.id;
    const propId = (n['proposal'] as { ref?: { id?: string } } | undefined)?.ref?.id;
    if (!propId) continue;
    const to = id === t1 ? 'ACCEPTED' : 'DECLINED';
    say(`service sets the proposal of ${name(id)} to ${to}`, await call('service', 'POST', `/node/v1/nodes/-home-/${propId}/property?property=ccm%3Acollection_proposal_status`, [to]));
  }
  for (const status of ['PENDING', 'ACCEPTED', 'DECLINED']) {
    const l = await call('service', 'GET', `/collection/v1/collections/-home-/${p}/children/proposals?status=${status}&maxItems=20`);
    console.log(`  ${status}: ${((l.json?.['nodes'] as Array<Record<string, unknown>> | undefined) ?? []).map(n => name((n['ref'] as { id?: string } | undefined)?.id)).join(', ') || '(none)'}`);
  }
  say('test account: propose t2 again after DECLINED', await propose('test', t2));
} finally {
  console.log('\ncleanup');
  for (const m of made.reverse()) {
    const path = m.kind === 'collection' ? `/collection/v1/collections/-home-/${m.id}` : `/node/v1/nodes/-home-/${m.id}?recycle=false`;
    const del = await call(m.who, 'DELETE', path).catch(() => null);
    const gone = await call(m.who, 'GET', `/node/v1/nodes/-home-/${m.id}/metadata?propertyFilter=cm%3Aname`).catch(() => null);
    if (gone?.status !== 404) console.error(`  NOT DELETED: ${m.kind} ${m.id} (${name(m.id)}) delete HTTP ${del?.status}, read HTTP ${gone?.status}`);
  }
  console.log('  done');
}
