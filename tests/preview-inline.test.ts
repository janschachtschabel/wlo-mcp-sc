/**
 * preview-inline.test.ts – Restricted previews travel WITH the answer, fetched
 * by the server under the caller's login.
 *
 * The asymmetry this fixes (user question 2026-08-22): metadata of an
 * `isPublic: false` record reaches the widget because the SERVER fetches it
 * with the caller's credential — the preview image did not, because a browser
 * `<img>` is always an anonymous request and gets the repository's permission
 * shield (HTTP 200, same 19 590-byte SVG every time). So the server now
 * fetches the image too — `wloFetch` carries the per-request credential — and
 * ships it as a `data:` URI in the result's `_meta`, the Apps-SDK channel that
 * reaches the widget and never the model. Inlining into `structuredContent`
 * would be the compendium disease with pictures: 8 × ~40 KB of base64 read by
 * the model on every editorial search.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { installFetchMock } from './fetchMock.js';
import {
  inlineRestrictedPreviews,
  INLINE_PREVIEW_MAX,
  INLINE_PREVIEW_BYTES_MAX,
} from '../src/services/preview-inline.js';

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);

function node(id: string, over: Record<string, unknown> = {}): any {
  return {
    nodeId: id,
    title: 'SUPRA Einheit',
    previewUrl: `https://repository.staging.openeduhub.net/edu-sharing/preview?nodeId=${id}`,
    previewIsIcon: false,
    isPublic: false,
    nodeType: 'content',
    ...over,
  };
}

test('a restricted preview comes back as a data URI; a public one costs nothing', async () => {
  const fetched: string[] = [];
  const mock = installFetchMock((url) => {
    fetched.push(url);
    return { body: JPEG, headers: { 'content-type': 'image/jpeg' } };
  });
  try {
    const map = await inlineRestrictedPreviews([node('r1'), node('p1', { isPublic: undefined })]);
    assert.match(map['r1'] ?? '', /^data:image\/jpeg;base64,/);
    assert.equal(map['p1'], undefined, 'public records keep their direct URL — no fetch, no bytes');
    assert.equal(fetched.length, 1, 'exactly the restricted preview was fetched');
    assert.match(fetched[0]!, /preview\?nodeId=r1/);
  } finally {
    mock.restore();
  }
});

test('an SVG answer is the shield or a placeholder — never inlined', async () => {
  // Self-guarding: if the credential did NOT reach the fetch, the repository
  // answers its shield (image/svg+xml). Inlining that would put the alarming
  // image back — the exact thing this exists to remove.
  const mock = installFetchMock(() => ({
    body: Buffer.from('<svg>shield</svg>'),
    headers: { 'content-type': 'image/svg+xml' },
  }));
  try {
    assert.deepEqual(await inlineRestrictedPreviews([node('r1')]), {});
  } finally {
    mock.restore();
  }
});

test('oversized images and failed fetches are skipped, not fatal', async () => {
  const big = Buffer.alloc(INLINE_PREVIEW_BYTES_MAX + 1, 1);
  const mock = installFetchMock((url) => {
    if (url.includes('r-big')) return { body: big, headers: { 'content-type': 'image/jpeg' } };
    if (url.includes('r-err')) return { status: 500, text: 'kaputt' };
    return { body: JPEG, headers: { 'content-type': 'image/jpeg' } };
  });
  try {
    const map = await inlineRestrictedPreviews([node('r-big'), node('r-err'), node('r-ok')]);
    assert.deepEqual(Object.keys(map), ['r-ok'], 'one bad image must not cost the others');
  } finally {
    mock.restore();
  }
});

test('the fetch count is capped — an editorial search must not fan out unbounded', async () => {
  let calls = 0;
  const mock = installFetchMock(() => {
    calls += 1;
    return { body: JPEG, headers: { 'content-type': 'image/jpeg' } };
  });
  try {
    const many = Array.from({ length: INLINE_PREVIEW_MAX + 5 }, (_, i) => node(`r${i}`));
    const map = await inlineRestrictedPreviews(many);
    assert.equal(calls, INLINE_PREVIEW_MAX);
    assert.equal(Object.keys(map).length, INLINE_PREVIEW_MAX);
  } finally {
    mock.restore();
  }
});

test('a restricted COLLECTION is never fetched — its tile renders no image at all', async () => {
  // tile.ts returns early for collections (block glyph, no thumbnail), and the
  // sections rendering them receive no preview map. Bytes for those would be
  // fetched, base64'd, shipped — and never drawn.
  //
  // Counted, not thrown: the service catches fetch errors by design, so a
  // throwing mock cannot tell "not fetched" from "fetched and swallowed".
  const mock = installFetchMock(() => ({ body: JPEG, headers: { 'content-type': 'image/jpeg' } }));
  try {
    const map = await inlineRestrictedPreviews([node('c1', { nodeType: 'collection' })]);
    assert.equal(mock.calls.length, 0, 'no fetch was paid');
    assert.deepEqual(map, {});
  } finally {
    mock.restore();
  }
});

test('a preview URL off the repository is never fetched', async () => {
  // Only the repository answers differently for the signed-in caller (the
  // shield mechanism); any other host serves an anonymous <img> just as well,
  // so inlining would move the fetch vantage to the server for nothing. Same
  // boundary as the credential attach in wlo-fetch.ts — literally, via
  // isRepositoryUrl. Counted, not thrown (see the collection test above).
  const mock = installFetchMock(() => ({ body: JPEG, headers: { 'content-type': 'image/jpeg' } }));
  try {
    const foreign = node('r1', { previewUrl: 'https://img.example.org/thumb.jpg' });
    const map = await inlineRestrictedPreviews([foreign]);
    assert.equal(mock.calls.length, 0, 'no fetch was paid');
    assert.deepEqual(map, {});
  } finally {
    mock.restore();
  }
});

test('a declared oversize is skipped before the body is read', async () => {
  const mock = installFetchMock(() => ({
    body: JPEG,
    headers: { 'content-type': 'image/jpeg', 'content-length': String(INLINE_PREVIEW_BYTES_MAX + 1) },
  }));
  try {
    assert.deepEqual(await inlineRestrictedPreviews([node('r1')]), {});
  } finally {
    mock.restore();
  }
});

test('each preview fetch carries its own short budget, not the 20 s upstream default', () => {
  // 8 optional thumbnails over a pool of 4 could otherwise add two full
  // upstream timeouts to a search whose answer is already complete. wloFetch
  // honours a caller signal (wlo-fetch.ts), so the budget is per fetch.
  const src = readFileSync(fileURLToPath(new URL('../src/services/preview-inline.ts', import.meta.url)), 'utf8');
  assert.match(src, /AbortSignal\.timeout\(PREVIEW_FETCH_TIMEOUT_MS\)/, 'the fetch passes its own signal');
  const m = src.match(/PREVIEW_FETCH_TIMEOUT_MS = (\d+)/);
  assert.ok(m && Number(m[1]) <= 5000, 'seconds, not the upstream default');
});

test('no restricted nodes → no work at all', async () => {
  // Counted, not thrown (see the collection test above for why a throwing mock
  // proves nothing here).
  const mock = installFetchMock(() => ({ body: JPEG, headers: { 'content-type': 'image/jpeg' } }));
  try {
    const map = await inlineRestrictedPreviews([node('p1', { isPublic: undefined })]);
    assert.equal(mock.calls.length, 0, 'no fetch was paid');
    assert.deepEqual(map, {});
  } finally {
    mock.restore();
  }
});

/**
 * End to end through the tool: the map rides in the RESULT's `_meta` — the
 * widget-only channel — never in structuredContent, and only when there was
 * something to inline.
 */
test('search_wlo_content ships inlined previews in result _meta', async () => {
  const { connectedClient, makeNode } = await import('./fetchMock.js');
  const JPEG_ = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 9, 9]);
  const mock = installFetchMock((url) => {
    if (url.includes('/preview?nodeId=locked')) {
      return { body: JPEG_, headers: { 'content-type': 'image/jpeg' } };
    }
    if (url.includes('ngsearch')) {
      const locked = {
        ...makeNode('locked', 'SUPRA Einheit'),
        isPublic: false,
        preview: { url: 'https://repository.staging.openeduhub.net/edu-sharing/preview?nodeId=locked', isIcon: false },
      };
      return { json: { nodes: [locked], pagination: { total: 1, from: 0, count: 1 } } };
    }
    return { json: {} };
  });
  const client = await connectedClient();
  try {
    const result = await client.callTool({ name: 'search_wlo_content', arguments: { query: 'SUPRA' } });
    const meta = (result as { _meta?: Record<string, unknown> })._meta;
    const map = meta?.['wlo/previewData'] as Record<string, string> | undefined;
    assert.match(map?.['locked'] ?? '', /^data:image\/jpeg;base64,/, 'the widget-only channel carries the picture');
    const sc = JSON.stringify(result.structuredContent ?? {});
    assert.ok(!sc.includes('base64'), 'and structuredContent — what the model reads — carries none of it');
  } finally {
    await client.close();
    mock.restore();
  }
});

/**
 * search_wlo_all ships the map too — asserted PER FORMAT. The project's own
 * lesson (2026-08-16, the JSON branch that shipped a hint beside
 * `registry: null`): a rule that lives on every return needs an assertion on
 * every return.
 */
test('search_wlo_all ships inlined previews in result _meta — markdown and json', async () => {
  const { connectedClient, makeNode } = await import('./fetchMock.js');
  for (const outputFormat of ['markdown', 'json'] as const) {
    const mock = installFetchMock((url) => {
      if (url.includes('/preview?nodeId=locked')) {
        return { body: JPEG, headers: { 'content-type': 'image/jpeg' } };
      }
      if (url.includes('ngsearch')) {
        const locked = {
          ...makeNode('locked', 'SUPRA Einheit'),
          isPublic: false,
          preview: { url: 'https://repository.staging.openeduhub.net/edu-sharing/preview?nodeId=locked', isIcon: false },
        };
        return { json: { nodes: [locked], pagination: { total: 1, from: 0, count: 1 } } };
      }
      return { json: { nodes: [], pagination: { total: 0, from: 0, count: 0 } } };
    });
    const client = await connectedClient();
    try {
      const result = await client.callTool({
        name: 'search_wlo_all',
        arguments: { query: 'SUPRA', include: ['content'], outputFormat },
      });
      const meta = (result as { _meta?: Record<string, unknown> })._meta;
      const map = meta?.['wlo/previewData'] as Record<string, string> | undefined;
      assert.match(map?.['locked'] ?? '', /^data:image\/jpeg;base64,/, `${outputFormat}: the map rides along`);
      assert.ok(
        !JSON.stringify(result.structuredContent ?? {}).includes('base64'),
        `${outputFormat}: none of it reaches structuredContent`,
      );
    } finally {
      await client.close();
      mock.restore();
    }
  }
});

test('an all-public answer carries no preview meta at all', async () => {
  const { connectedClient, makeNode } = await import('./fetchMock.js');
  const mock = installFetchMock((url) => {
    if (url.includes('ngsearch')) {
      return { json: { nodes: [makeNode('open', 'Frei')], pagination: { total: 1, from: 0, count: 1 } } };
    }
    if (url.includes('/preview')) throw new Error('must not fetch previews for public records');
    return { json: {} };
  });
  const client = await connectedClient();
  try {
    const result = await client.callTool({ name: 'search_wlo_content', arguments: { query: 'frei' } });
    const meta = (result as { _meta?: Record<string, unknown> })._meta;
    assert.equal(meta?.['wlo/previewData'], undefined);
  } finally {
    await client.close();
    mock.restore();
  }
});
