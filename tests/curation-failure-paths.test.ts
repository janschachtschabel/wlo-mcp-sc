/**
 * curation-failure-paths.test.ts – what the curation tools say when it does
 * NOT go well (audit 2026-11-05, A-6).
 *
 * Every happy path of these tools was tested; not one of their refusal, failure
 * or abort messages was. Those are the answers that matter most, because the
 * project's own rules hang on them: an ABORTED write must be reported as an
 * open outcome (the abort hits the response, not the work — CLAUDE.md), a
 * refusal must happen before anything is sent upstream, and a failed upstream
 * call must say so instead of reading as success.
 *
 * Asserted on the text a person reads, plus the upstream call count where the
 * claim is "nothing was sent".
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { setServiceCredentialForTest, type WloCredential } from '../src/auth/credential.js';
import { connectedClient, installFetchMock, toolText, type MockResult } from './fetchMock.js';

const USER: WloCredential = { header: 'Basic x', label: 'maria', source: 'user' };

function tokenFrom(text: string): string {
  const m = /confirmToken[^\w-]*([A-Za-z0-9_-]{20,})/.exec(text);
  assert.ok(m, `the preview carries a confirm token:\n${text}`);
  return m[1]!;
}

/** An error shaped the way an aborted fetch rejects. */
function abortError(): Error {
  const err = new Error('The operation was aborted due to timeout');
  err.name = 'TimeoutError';
  return err;
}

async function withUser<T>(fn: () => Promise<T>): Promise<T> {
  setServiceCredentialForTest(USER);
  try { return await fn(); } finally { setServiceCredentialForTest(null); }
}

const node = (id: string, props: Record<string, string[]>) =>
  ({ json: { node: { ref: { id, repo: '-home-' }, type: 'ccm:map', aspects: ['ccm:collection'], properties: props } } });

// ── wlo_create_collection ────────────────────────────────────────────────────

test('create_collection: a blank title is refused before anything is sent', async () => {
  await withUser(async () => {
    const mock = installFetchMock(() => ({ json: {} }));
    const c = await connectedClient();
    try {
      const r = await c.callTool({ name: 'wlo_create_collection', arguments: { title: '   ' } });
      assert.match(toolText(r), /braucht einen Titel/);
      assert.equal(mock.calls.length, 0, 'no upstream request for a refused call');
    } finally { await c.close(); mock.restore(); }
  });
});

test('create_collection: a refused create says it failed, not that it worked', async () => {
  await withUser(async () => {
    const mock = installFetchMock((_url, init): MockResult =>
      (init?.method ?? 'GET') === 'GET' ? { json: {} } : { status: 500, text: 'boom' });
    const c = await connectedClient();
    try {
      const preview = toolText(await c.callTool({ name: 'wlo_create_collection', arguments: { title: 'Optik' } }));
      const r = await c.callTool({
        name: 'wlo_create_collection', arguments: { title: 'Optik', confirmToken: tokenFrom(preview) },
      });
      assert.match(toolText(r), /konnte nicht angelegt werden/);
      assert.equal(r.isError, true);
    } finally { await c.close(); mock.restore(); }
  });
});

test('create_collection: an aborted create is reported as OPEN, never as failed', async () => {
  await withUser(async () => {
    const mock = installFetchMock((_url, init): MockResult => {
      if ((init?.method ?? 'GET') !== 'GET') throw abortError();
      return { json: {} };
    });
    const c = await connectedClient();
    try {
      const preview = toolText(await c.callTool({ name: 'wlo_create_collection', arguments: { title: 'Optik' } }));
      const text = toolText(await c.callTool({
        name: 'wlo_create_collection', arguments: { title: 'Optik', confirmToken: tokenFrom(preview) },
      }));
      assert.match(text, /keine Antwort/);
      assert.match(text, /kann also gewirkt haben/, 'the work may have happened — the caller must check');
    } finally { await c.close(); mock.restore(); }
  });
});

// ── wlo_rename_collection ────────────────────────────────────────────────────

test('rename_collection: an aborted rename is reported as open, naming the collection', async () => {
  await withUser(async () => {
    const mock = installFetchMock((url, init): MockResult => {
      if ((init?.method ?? 'GET') !== 'GET') throw abortError();
      return url.includes('coll-9') ? node('coll-9', { 'cm:title': ['Alt'] }) : { json: {} };
    });
    const c = await connectedClient();
    try {
      const preview = toolText(await c.callTool({
        name: 'wlo_rename_collection', arguments: { nodeId: 'coll-9', title: 'Neu' },
      }));
      const text = toolText(await c.callTool({
        name: 'wlo_rename_collection', arguments: { nodeId: 'coll-9', title: 'Neu', confirmToken: tokenFrom(preview) },
      }));
      assert.match(text, /keine Antwort/);
      assert.match(text, /coll-9/);
    } finally { await c.close(); mock.restore(); }
  });
});

// ── wlo_update_compendium ────────────────────────────────────────────────────

test('update_compendium: neither a text nor remove=true is refused before anything is sent', async () => {
  await withUser(async () => {
    const mock = installFetchMock(() => ({ json: {} }));
    const c = await connectedClient();
    try {
      const r = await c.callTool({ name: 'wlo_update_compendium', arguments: { nodeId: 'coll-1' } });
      assert.match(toolText(r), /entweder einen Text angeben/);
      assert.equal(mock.calls.length, 0);
    } finally { await c.close(); mock.restore(); }
  });
});

test('update_compendium: an aborted write is reported as open', async () => {
  await withUser(async () => {
    const mock = installFetchMock((url, init): MockResult => {
      if ((init?.method ?? 'GET') !== 'GET') throw abortError();
      return url.includes('coll-1') ? node('coll-1', { 'cm:title': ['Optik'] }) : { json: {} };
    });
    const c = await connectedClient();
    try {
      const args = { nodeId: 'coll-1', text: '# Optik\n\nNeuer Text.' };
      const preview = toolText(await c.callTool({ name: 'wlo_update_compendium', arguments: args }));
      const text = toolText(await c.callTool({
        name: 'wlo_update_compendium', arguments: { ...args, confirmToken: tokenFrom(preview) },
      }));
      assert.match(text, /keine Antwort/);
      assert.match(text, /kann also gewirkt haben/);
    } finally { await c.close(); mock.restore(); }
  });
});

// ── wlo_suggest_metadata / wlo_list_suggestions ──────────────────────────────

test('suggest_metadata: proposing what the record already says is refused, not stored', async () => {
  await withUser(async () => {
    const mock = installFetchMock((url, init): MockResult => {
      if ((init?.method ?? 'GET') !== 'GET') return { status: 500, text: 'must not write' };
      return url.includes('n-1') ? { json: { node: { ref: { id: 'n-1', repo: '-home-' }, type: 'ccm:io',
        properties: { 'cclom:title': ['Bruchrechnung'] } } } } : { json: {} };
    });
    const c = await connectedClient();
    try {
      const r = await c.callTool({
        name: 'wlo_suggest_metadata',
        arguments: { nodeId: 'n-1', suggestions: [{ field: 'title', value: 'Bruchrechnung', reason: 'passt' }] },
      });
      assert.match(toolText(r), /stehen bereits so im Datensatz/);
      assert.ok(!mock.calls.some(x => (x.init?.method ?? 'GET') !== 'GET'), 'nothing was written');
    } finally { await c.close(); mock.restore(); }
  });
});

test('list_suggestions: an upstream failure is an error, not an empty list', async () => {
  // "Keine Vorschläge" over a repository that did not answer would tell the
  // editor there is nothing to decide.
  await withUser(async () => {
    const mock = installFetchMock((url): MockResult =>
      url.includes('/suggestions/') ? { status: 500, text: 'boom' } : node('n-1', { 'cclom:title': ['X'] }));
    const c = await connectedClient();
    try {
      const r = await c.callTool({ name: 'wlo_list_suggestions', arguments: { nodeId: 'n-1' } });
      assert.equal(r.isError, true, toolText(r));
      assert.doesNotMatch(toolText(r), /keine Vorschläge/i);
    } finally { await c.close(); mock.restore(); }
  });
});

// ── get_collection_stats ─────────────────────────────────────────────────────

test('collection_stats: a collection without a title is headed by its nodeId', async () => {
  const mock = installFetchMock((url): MockResult => {
    if (url.includes('/children')) return { json: { nodes: [], pagination: { total: 0, from: 0, count: 0 } } };
    return node('coll-untitled', {});
  });
  const c = await connectedClient();
  try {
    const text = toolText(await c.callTool({ name: 'get_collection_stats', arguments: { nodeId: 'coll-untitled' } }));
    assert.match(text, /# Sammlungs-Statistik: coll-untitled/);
  } finally { await c.close(); mock.restore(); }
});

// ── wlo_decide_suggestion ────────────────────────────────────────────────────

test('decide_suggestion: an aborted accept is reported as open — and never marked accepted', async () => {
  // The order rule says the value is written BEFORE the proposal is marked
  // ACCEPTED. An abort during that write must therefore leave the decision
  // unrecorded, and the reply must say the write's outcome is open.
  await withUser(async () => {
    const mock = installFetchMock((url, init): MockResult => {
      const method = init?.method ?? 'GET';
      if (url.includes('/suggestions/v1/')) {
        if (method === 'GET') {
          return { json: { nodeId: 'n-1', suggestions: {
            'cclom:title': [{ id: 's-1', propertyId: 'cclom:title', value: 'Neuer Titel', status: 'PENDING' }],
          } } };
        }
        return { json: {} };
      }
      if (method !== 'GET') throw abortError();
      return { json: { node: { ref: { id: 'n-1', repo: '-home-' }, properties: { 'cclom:title': ['Alt'] } } } };
    });
    const c = await connectedClient();
    try {
      const args = { nodeId: 'n-1', suggestionId: 's-1', decision: 'accept' };
      const preview = toolText(await c.callTool({ name: 'wlo_decide_suggestion', arguments: args }));
      const text = toolText(await c.callTool({
        name: 'wlo_decide_suggestion', arguments: { ...args, confirmToken: tokenFrom(preview) },
      }));
      assert.match(text, /keine Antwort/);
      assert.ok(
        !mock.calls.some(x => x.url.includes('/suggestions/v1/') && x.init?.method === 'PATCH'),
        'the proposal was not marked decided over a write whose outcome is unknown',
      );
    } finally { await c.close(); mock.restore(); }
  });
});
