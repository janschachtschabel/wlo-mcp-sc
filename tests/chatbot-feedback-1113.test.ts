/**
 * chatbot-feedback-1113.test.ts – what the chatbot team asked for on 2026-11-13
 * and what needed no change of contract.
 *
 *   - A listing that did not answer — a 5xx, or our own full upstream gate — is
 *     reported as incomplete everywhere, never passed off as "no children".
 *   - The empty case of `search_wlo_topic_pages` is parseable in JSON mode.
 *   - `get_skill` says in fields what its closing line said in prose (W6).
 *   - The caller's trace context is read, logged and handed on to the
 *     repository — and to nobody else (W5).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { log } from '../src/logger.js';
import { outgoingTraceHeaders, runWithRequestId, traceFrom } from '../src/request-id.js';
import { collectRecursiveContents } from '../src/services/collection-traversal.js';
import { searchSkillsDetailed } from '../src/services/skills.js';
import { stopSkillRegistryCache } from '../src/services/skill-registry-cache.js';
import { WLO_REPOSITORY_URL } from '../src/wlo-config.js';
import { wloFetch } from '../src/wlo-fetch.js';
import { connectedClient, installFetchMock, toolText, type MockResult } from './fetchMock.js';

const idOf = (url: string) => decodeURIComponent(new URL(url).pathname.match(/-home-\/([^/]+)\/children/)?.[1] ?? '');
const page = (nodes: unknown[]) => ({ json: { nodes, pagination: { total: nodes.length, from: 0, count: nodes.length } } });
const structured = (r: unknown) => (r as { structuredContent: Record<string, unknown> }).structuredContent;

// ── a sub-listing that did not answer ────────────────────────────────────────

test('the recursive walk says when a sub-listing did not answer — the branch below it is not "empty"', async () => {
  const mock = installFetchMock((url): MockResult => {
    const folders = new URL(url).searchParams.get('filter') === 'folders';
    if (folders) return idOf(url) === 'root' ? { status: 503, json: {} } : page([]);
    return page([{ ref: { id: 'f-root' }, properties: { 'cclom:title': ['Blatt'] } }]);
  });
  try {
    const out = await collectRecursiveContents('root', 10, new Set(), undefined);
    assert.equal(out.incomplete, true);
    assert.equal(out.nodes.length, 1, 'what was read is still returned');
  } finally { mock.restore(); }
});

test('get_collection_contents carries it — in the text and in the contract', async () => {
  stopSkillRegistryCache();
  const mock = installFetchMock((url): MockResult => {
    if (!url.includes('/children')) return { json: {} };
    const folders = new URL(url).searchParams.get('filter') === 'folders';
    if (folders) return idOf(url) === 'root-1' ? { status: 503, json: {} } : page([]);
    return page([]);
  });
  const client = await connectedClient();
  try {
    const args = { nodeId: 'root-1', includeSubcollections: true, contentFilter: 'files' };
    const r = await client.callTool({ name: 'get_collection_contents', arguments: args });
    assert.equal(structured(r)['incomplete'], true);
    assert.match(toolText(r), /KEIN Befund/);
    assert.doesNotMatch(toolText(r), /Sammlung ist leer/);
    const json = await client.callTool({ name: 'get_collection_contents', arguments: { ...args, outputFormat: 'json' } });
    const blocks = (json as { content: Array<{ text: string }> }).content.map(c => c.text);
    assert.doesNotThrow(() => JSON.parse(blocks[0]!), 'block 0 stays the payload');
    assert.ok(blocks.some(b => /KEIN Befund/.test(b)));
  } finally { await client.close(); mock.restore(); stopSkillRegistryCache(); }
});

test('browse_collection_tree marks a branch whose children could not be read', async () => {
  stopSkillRegistryCache();
  const mock = installFetchMock((url): MockResult => {
    if (!url.includes('/children')) return { json: {} };
    const folders = new URL(url).searchParams.get('filter') === 'folders';
    if (!folders) return page([]);
    if (idOf(url) === 'b-1') return { status: 503, json: {} };
    return idOf(url).startsWith('b-') ? page([]) : page([
      { ref: { id: 'b-1' }, type: 'ccm:map', aspects: ['ccm:collection'], properties: { 'cm:title': ['Optik'] } },
      { ref: { id: 'b-2' }, type: 'ccm:map', aspects: ['ccm:collection'], properties: { 'cm:title': ['Mechanik'] } },
    ]);
  });
  const client = await connectedClient();
  try {
    const r = await client.callTool({ name: 'browse_collection_tree', arguments: { nodeId: 'top', depth: 2 } });
    assert.match(toolText(r), /ließen sich gerade nicht lesen/);
    const tree = (structured(r)['results'] ?? structured(r)['tree']) as Array<Record<string, unknown>>;
    const flagged = JSON.stringify(structured(r));
    assert.match(flagged, /"childrenUnread":true/, flagged.slice(0, 300));
    assert.ok(tree === undefined || Array.isArray(tree));
  } finally { await client.close(); mock.restore(); stopSkillRegistryCache(); }
});

test('a skill walk whose sub-collections could not be listed is incomplete', async () => {
  const mock = installFetchMock((url): MockResult => {
    if (url.includes('filter=folders')) return { status: 503, json: {} };
    if (url.includes('filter=files')) return page([]);
    return { json: {} };
  });
  try {
    assert.equal((await searchSkillsDetailed({ collectionId: 'skills-root' })).incomplete, true);
  } finally { mock.restore(); }
});

// ── the empty case in JSON mode ──────────────────────────────────────────────

test('search_wlo_topic_pages: an empty answer in JSON mode is JSON first, the sentence after', async () => {
  stopSkillRegistryCache();
  const mock = installFetchMock((url): MockResult => {
    if (url.includes('/collection/v1/collections/-home-/search')) return { json: { collections: [] } };
    return page([]);
  });
  const client = await connectedClient();
  try {
    const r = await client.callTool({ name: 'search_wlo_topic_pages', arguments: { query: 'Quantenoptik', outputFormat: 'json' } });
    const blocks = (r as { content: Array<{ text: string }> }).content.map(c => c.text);
    assert.deepEqual(JSON.parse(blocks[0]!), { total: 0, count: 0, results: [] });
    assert.deepEqual(structured(r), { total: 0, count: 0, results: [] });
    assert.ok(blocks.length >= 2, 'the sentence is still there, as its own block');
  } finally { await client.close(); mock.restore(); stopSkillRegistryCache(); }
});

// ── W6: get_skill in fields ──────────────────────────────────────────────────

test('get_skill says in fields whether the instruction was loaded, and why not', async () => {
  const head = (extra: Record<string, unknown>) => ({ json: { node: {
    ref: { id: 's-1' }, name: 'SKILL.md', properties: { 'cclom:title': ['Stunde planen'] }, ...extra } } });
  // A video: ruled out by its metadata, never downloaded.
  let mock = installFetchMock((url): MockResult => (url.includes('/metadata') ? head({ mimetype: 'video/mp4', size: '900000' }) : { status: 404, json: {} }));
  let client = await connectedClient();
  try {
    const r = await client.callTool({ name: 'get_skill', arguments: { nodeId: 's-1', includeFiles: false } });
    assert.deepEqual(structured(r), { found: true, nodeId: 's-1', title: 'Stunde planen', contentLoaded: false, contentRefused: 'not_text' });
  } finally { await client.close(); mock.restore(); }

  mock = installFetchMock((url): MockResult => {
    if (url.includes('/metadata')) return head({ mimetype: 'text/x-web-markdown', size: '20' });
    if (url.includes('eduservlet/download')) return { text: '# Stunde planen\n\nSchritt 1.' };
    return { status: 404, json: {} };
  });
  client = await connectedClient();
  try {
    const r = await client.callTool({ name: 'get_skill', arguments: { nodeId: 's-1', includeFiles: false } });
    assert.deepEqual(structured(r), { found: true, nodeId: 's-1', title: 'Stunde planen', contentLoaded: true });
  } finally { await client.close(); mock.restore(); }

  mock = installFetchMock(() => ({ status: 404, json: {} }));
  client = await connectedClient();
  try {
    const r = await client.callTool({ name: 'get_skill', arguments: { nodeId: 'gibt-es-nicht' } });
    assert.deepEqual(structured(r), { found: false, nodeId: 'gibt-es-nicht', contentLoaded: false });
  } finally { await client.close(); mock.restore(); }
});

// ── W5: trace context ────────────────────────────────────────────────────────

test('trace headers are read in both B3 spellings — and only when they are well-formed', () => {
  const trace = '463ac35c9f6413ad48485a3953bb6124';
  const span = 'a2fb4a1d1a96d312';
  assert.deepEqual(traceFrom({ 'x-b3-traceid': trace, 'x-b3-spanid': span, 'x-b3-sampled': '1', 'x-client-trace-id': 'chat-7f3a' }),
    { clientTraceId: 'chat-7f3a', b3: { traceId: trace, spanId: span, sampled: '1' } });
  assert.deepEqual(traceFrom({ b3: `${trace}-${span}-1` }), { b3: { traceId: trace, spanId: span, sampled: '1' } });
  assert.deepEqual(traceFrom({ b3: `${trace.toUpperCase()}-${span}` }), { b3: { traceId: trace, spanId: span } }, 'case is normalised');
  // These go into every log line and on to the repository.
  assert.deepEqual(traceFrom({ 'x-b3-traceid': 'not-hex', 'x-b3-spanid': span }), {});
  assert.deepEqual(traceFrom({ 'x-client-trace-id': 'a b\n{"level":"error"}' }), {});
  assert.deepEqual(traceFrom({ 'x-client-trace-id': ['a', 'b'] }), {}, 'a repeated header is not a token');
  assert.deepEqual(traceFrom({}), {});
});

test('the log line of a request carries the trace it belongs to', async () => {
  const real = process.stderr.write.bind(process.stderr);
  const lines: string[] = [];
  process.stderr.write = ((chunk: unknown) => { lines.push(String(chunk)); return true; }) as typeof process.stderr.write;
  try {
    runWithRequestId('req-12345', () => log.info('x'), { clientTraceId: 'chat-7f3a', b3: { traceId: 'a'.repeat(32), spanId: 'b'.repeat(16) } });
    runWithRequestId('req-67890', () => log.info('y'));
  } finally { process.stderr.write = real; }
  const [withTrace, without] = lines.map(l => JSON.parse(l) as Record<string, unknown>);
  assert.deepEqual([withTrace!['req'], withTrace!['trace_id'], withTrace!['span_id'], withTrace!['client_trace_id']],
    ['req-12345', 'a'.repeat(32), 'b'.repeat(16), 'chat-7f3a']);
  assert.equal('trace_id' in without!, false, 'nothing is invented for a request that named no trace');
});

test('the trace is handed on to the REPOSITORY as a child span — and to nobody else', async () => {
  const mock = installFetchMock(() => ({ json: {} }));
  const sent = (i: number) => new Headers((mock.calls[i]!.init?.headers ?? {}) as HeadersInit);
  try {
    await runWithRequestId('req-12345', async () => {
      await wloFetch(`${WLO_REPOSITORY_URL}/rest/x`);
      await wloFetch('https://de.wikipedia.org/x');
    }, { clientTraceId: 'chat-7f3a', b3: { traceId: 'a'.repeat(32), spanId: 'b'.repeat(16), sampled: '1' } });
    const repo = sent(0);
    assert.equal(repo.get('x-client-trace-id'), 'chat-7f3a');
    assert.equal(repo.get('x-b3-traceid'), 'a'.repeat(32), 'the same trace');
    assert.equal(repo.get('x-b3-parentspanid'), 'b'.repeat(16), 'the caller\'s span is the parent');
    assert.match(repo.get('x-b3-spanid') ?? '', /^[0-9a-f]{16}$/);
    assert.notEqual(repo.get('x-b3-spanid'), 'b'.repeat(16), 'a span of its own');
    assert.equal(repo.get('x-b3-sampled'), '1');
    const other = sent(1);
    assert.equal(other.get('x-client-trace-id'), null);
    assert.equal(other.get('x-b3-traceid'), null);

    await wloFetch(`${WLO_REPOSITORY_URL}/rest/y`);
    assert.equal(sent(2).get('x-b3-traceid'), null, 'outside a request nothing is sent');
    assert.deepEqual(outgoingTraceHeaders(), {});
  } finally { mock.restore(); }
});

test('get_topic_page_content: variants that could not be LISTED are not "no_variant"', async () => {
  stopSkillRegistryCache();
  const mock = installFetchMock((url): MockResult => {
    if (url.includes('/coll-9/metadata')) {
      return { json: { node: { ref: { id: 'coll-9' }, type: 'ccm:map', aspects: ['ccm:collection'],
        properties: { 'cm:title': ['Optik'], 'ccm:page_config_ref': ['workspace://SpacesStore/cfg-9'] } } } };
    }
    if (url.includes('/cfg-9/children')) return { status: 503, json: {} };
    return page([]);
  });
  const client = await connectedClient();
  try {
    const r = await client.callTool({ name: 'get_topic_page_content', arguments: { collectionId: 'coll-9' } });
    assert.equal(structured(r)['reason'], 'source_unreachable', toolText(r));
  } finally { await client.close(); mock.restore(); stopSkillRegistryCache(); }
});
