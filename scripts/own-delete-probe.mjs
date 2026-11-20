/**
 * own-delete-probe.mjs – what the repository says about "own content in the
 * personal area" (plan 2026-11-20, wlo_delete_own_content). Staging only, with
 * the test account and own throwaway nodes, every node deleted at the end.
 *
 * Measures: the id behind `-userhome-`; `cm:creator` against the identity;
 * `virtual:primaryparent_nodeid` of a record flat in the home and of one in a
 * folder there; `isPublic`; the usages of a record before and after a
 * reference into an own test collection; the delete and its read-back.
 *
 * Prints only shapes and booleans — no login, no ticket, no cookie.
 * Run: node scripts/own-delete-probe.mjs
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
// Only these keys are read from `.env`; nothing else there is touched.
for (const key of ['WLO_TEST_USER', 'WLO_TEST_PASSWORD', 'WLO_REPOSITORY_URL']) {
  let text = '';
  try { text = readFileSync(join(here, '..', '.env'), 'utf8'); } catch { /* none */ }
  if (process.env[key]) continue;
  const line = text.split(/\r?\n/).find(l => l.startsWith(`${key}=`));
  if (line) process.env[key] = line.slice(key.length + 1).trim().replace(/^"(.*)"$/, '$1');
}
const REPO = process.env.WLO_REPOSITORY_URL;
if (!REPO || new URL(REPO).hostname !== 'repository.staging.openeduhub.net') { console.error('staging only'); process.exit(1); }
const auth = 'Basic ' + Buffer.from(`${process.env.WLO_TEST_USER}:${process.env.WLO_TEST_PASSWORD}`).toString('base64');
const API = `${REPO}/rest`;
const H = { Authorization: auth, Accept: 'application/json', 'Content-Type': 'application/json', DisableGuest: 'true' };
const stamp = `boerdi-durchtest-own-${Date.now()}`;
const made = [];

async function call(method, path, body) {
  const res = await fetch(`${API}${path}`, { method, headers: H, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
  const text = await res.text();
  let json = null; try { json = text ? JSON.parse(text) : null; } catch { /* not json */ }
  return { status: res.status, json };
}
const meta = async id => (await call('GET', `/node/v1/nodes/-home-/${id}/metadata?propertyFilter=-all-`));
const prop = (node, key) => node?.properties?.[key]?.[0];

try {
  const me = await call('GET', '/iam/v1/people/-home-/-me-');
  const authority = me.json?.person?.authorityName;
  const homeFromMe = me.json?.person?.homeFolder?.id;
  const home = await meta('-userhome-');
  const homeId = home.json?.node?.ref?.id;
  console.log('M1 home:', { metaStatus: home.status, homeIdPresent: Boolean(homeId), sameAsIamHomeFolder: homeFromMe ? homeFromMe === homeId : 'no homeFolder in iam' });

  const flat = await call('POST', `/node/v1/nodes/-home-/${homeId}/children?type=ccm:io&renameIfExists=true`, { 'cm:name': [`${stamp}-flat`], 'cclom:title': [`${stamp} flat`] });
  const flatId = flat.json?.node?.ref?.id; if (flatId) made.push(flatId);
  const fm = await meta(flatId);
  const fn = fm.json?.node;
  console.log('M2 flat record:', {
    create: flat.status, creatorEqualsAuthority: prop(fn, 'cm:creator') === authority,
    creatorShape: typeof prop(fn, 'cm:creator'), ownerEqualsAuthority: prop(fn, 'cm:owner') === authority,
    primaryParentIsHome: prop(fn, 'virtual:primaryparent_nodeid') === homeId,
    parentRefIsHome: fn?.parent?.id === homeId, isPublic: fn?.isPublic, type: fn?.type, aspects: (fn?.aspects ?? []).length,
    createdByShape: fn?.createdBy ? Object.keys(fn.createdBy).sort().join(',') : 'none',
  });

  const folder = await call('POST', `/node/v1/nodes/-home-/${homeId}/children?type=cm:folder&renameIfExists=true`, { 'cm:name': [`${stamp}-folder`] });
  const folderId = folder.json?.node?.ref?.id; if (folderId) made.push(folderId);
  const inner = await call('POST', `/node/v1/nodes/-home-/${folderId}/children?type=ccm:io&renameIfExists=true`, { 'cm:name': [`${stamp}-inner`], 'cclom:title': [`${stamp} inner`] });
  const innerId = inner.json?.node?.ref?.id; if (innerId) made.unshift(innerId);
  const im = (await meta(innerId)).json?.node;
  const fo = (await meta(folderId)).json?.node;
  console.log('M3 record in a home folder:', {
    folder: folder.status, inner: inner.status,
    innerParentIsFolder: prop(im, 'virtual:primaryparent_nodeid') === folderId,
    folderParentIsHome: prop(fo, 'virtual:primaryparent_nodeid') === homeId,
    folderType: fo?.type, innerIsPublic: im?.isPublic,
  });

  const allBefore = await call('GET', `/usage/v1/usages/node/${flatId}`);
  const collBefore = await call('GET', `/usage/v1/usages/node/${flatId}/collections`);
  console.log('M4a usages before:', { all: allBefore.status, allShape: Array.isArray(allBefore.json) ? `array ${allBefore.json.length}` : Object.keys(allBefore.json ?? {}).sort().join(','), allUsagesLen: Array.isArray(allBefore.json?.usages) ? allBefore.json.usages.length : '-', coll: collBefore.status, collLen: Array.isArray(collBefore.json) ? collBefore.json.length : typeof collBefore.json });

  const col = await call('POST', '/collection/v1/collections/-home-/-root-/children', { title: `${stamp} col`, properties: { 'cm:title': [`${stamp} col`] }, collection: { type: 'default' } });
  const colId = col.json?.collection?.ref?.id ?? col.json?.ref?.id;
  if (colId) made.push(colId);
  const ref = await call('PUT', `/collection/v1/collections/-home-/${colId}/references/${flatId}`);
  const allAfter = await call('GET', `/usage/v1/usages/node/${flatId}`);
  const collAfter = await call('GET', `/usage/v1/usages/node/${flatId}/collections`);
  console.log('M4b usages after a reference:', { colCreate: col.status, colIdPresent: Boolean(colId), ref: ref.status, allShape: Array.isArray(allAfter.json) ? `array ${allAfter.json.length}` : Object.keys(allAfter.json ?? {}).sort().join(','), allUsagesLen: Array.isArray(allAfter.json?.usages) ? allAfter.json.usages.length : '-', collLen: Array.isArray(collAfter.json) ? collAfter.json.length : collAfter.status, usageKeys: Array.isArray(allAfter.json) && allAfter.json[0] ? Object.keys(allAfter.json[0]).sort().join(',') : '' });
  const fm2 = (await meta(flatId)).json?.node;
  console.log('M4c the record after the reference:', { primaryParentStillHome: prop(fm2, 'virtual:primaryparent_nodeid') === homeId, isPublic: fm2?.isPublic });
} catch (err) {
  console.error('probe failed:', err instanceof Error ? err.message : String(err));
} finally {
  for (const id of made) {
    const d = await call('DELETE', `/node/v1/nodes/-home-/${id}?recycle=true`);
    const g = await call('GET', `/node/v1/nodes/-home-/${id}/metadata`);
    console.log('cleanup:', { delete: d.status, afterwards: g.status });
  }
}
