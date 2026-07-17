import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  sanitizeRepositoryUrl,
  buildTopicPageUrl,
  buildRenderUrl,
  wloFetch,
  getNodeBreadcrumb,
  getNodeDownloadText,
  WLO_REPOSITORY_URL,
} from '../src/wlo-api.js';
import { installFetchMock, makeNode } from './fetchMock.js';

test('getNodeDownloadText caps an oversized download and marks it truncated', async () => {
  const big = 'x'.repeat(200_000); // 200 KB — well over the cap
  const mock = installFetchMock(() => ({ text: big }));
  try {
    const out = await getNodeDownloadText('node-1');
    assert.ok(out !== null, 'download returned');
    assert.ok(out!.length <= 64 * 1024 + 32, `capped length was ${out!.length}`);
    assert.match(out!, /gekürzt/, 'truncation marker present');
  } finally { mock.restore(); }
});

test('getNodeDownloadText returns a small download unchanged', async () => {
  const mock = installFetchMock(() => ({ text: '# Skill\n\nDo the thing.' }));
  try {
    assert.equal(await getNodeDownloadText('node-1'), '# Skill\n\nDo the thing.');
  } finally { mock.restore(); }
});

test('sanitizeRepositoryUrl: trims, strips slashes and trailing /rest', () => {
  assert.equal(
    sanitizeRepositoryUrl('  https://host.example/edu-sharing///  '),
    'https://host.example/edu-sharing',
  );
  assert.equal(
    sanitizeRepositoryUrl('https://host.example/edu-sharing/rest'),
    'https://host.example/edu-sharing',
  );
});

test('sanitizeRepositoryUrl: adds https:// and /edu-sharing for bare hosts', () => {
  assert.equal(
    sanitizeRepositoryUrl('repository.staging.openeduhub.net'),
    'https://repository.staging.openeduhub.net/edu-sharing',
  );
});

test('sanitizeRepositoryUrl: empty input → empty string', () => {
  assert.equal(sanitizeRepositoryUrl(''), '');
  assert.equal(sanitizeRepositoryUrl('   '), '');
});

test('buildTopicPageUrl: null without pageConfigRef, URL with it', () => {
  assert.equal(buildTopicPageUrl('coll-1', undefined), null);
  assert.equal(buildTopicPageUrl('coll-1', ''), null);
  assert.equal(
    buildTopicPageUrl('coll-1', 'workspace://SpacesStore/cfg'),
    `${WLO_REPOSITORY_URL}/components/topic-pages?collectionId=coll-1`,
  );
});

test('buildRenderUrl: render permalink', () => {
  assert.equal(buildRenderUrl('n-1'), `${WLO_REPOSITORY_URL}/components/render/n-1`);
});

test('buildRenderUrl: encodes ids so a crafted id cannot rewrite the path', () => {
  assert.equal(
    buildRenderUrl('../../evil?x=y'),
    `${WLO_REPOSITORY_URL}/components/render/..%2F..%2Fevil%3Fx%3Dy`,
  );
});

test('buildTopicPageUrl: encodes the collectionId in the query string', () => {
  assert.equal(
    buildTopicPageUrl('a b&c=1', 'workspace://SpacesStore/cfg'),
    `${WLO_REPOSITORY_URL}/components/topic-pages?collectionId=a%20b%26c%3D1`,
  );
});

test('wloFetch: injects an AbortSignal (timeout) when the caller supplies none', async () => {
  const realFetch = globalThis.fetch;
  let capturedInit: RequestInit | undefined;
  globalThis.fetch = (async (_url: any, init?: RequestInit) => {
    capturedInit = init;
    return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
  }) as typeof fetch;
  try {
    await wloFetch('https://example.test/x', { headers: { Accept: 'application/json' } });
    assert.ok(capturedInit?.signal instanceof AbortSignal, 'expected an AbortSignal on the fetch init');
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('wloFetch: keeps a caller-supplied signal instead of overriding it', async () => {
  const realFetch = globalThis.fetch;
  const ctrl = new AbortController();
  let capturedSignal: AbortSignal | undefined;
  globalThis.fetch = (async (_url: any, init?: RequestInit) => {
    capturedSignal = init?.signal ?? undefined;
    return new Response('{}', { status: 200 });
  }) as typeof fetch;
  try {
    await wloFetch('https://example.test/x', { signal: ctrl.signal });
    assert.equal(capturedSignal, ctrl.signal);
  } finally {
    globalThis.fetch = realFetch;
  }
});

// getNodeBreadcrumb: edu-sharing's /parents returns the FULL ancestor chain in
// one call, ordered self-first ([self, …, root]) for collection nodes (verified
// live). The breadcrumb reverses that to root→node, guards cycles, caps depth.

test('getNodeBreadcrumb: reverses the self→root chain into a root→node breadcrumb', async () => {
  const mock = installFetchMock((url) => {
    if (url.includes('/parents')) {
      return { json: { nodes: [
        makeNode('leaf', 'Persönliche Daten'),
        makeNode('sub', 'Bedienen'),
        makeNode('portal', 'Medienbildung'),
        makeNode('root', 'Portale'),
      ] } };
    }
    return { json: {} };
  });
  try {
    const crumb = await getNodeBreadcrumb('leaf');
    assert.deepEqual(crumb, [
      { nodeId: 'root', title: 'Portale' },
      { nodeId: 'portal', title: 'Medienbildung' },
      { nodeId: 'sub', title: 'Bedienen' },
      { nodeId: 'leaf', title: 'Persönliche Daten' },
    ]);
  } finally {
    mock.restore();
  }
});

test('getNodeBreadcrumb: returns [] when /parents has no chain (e.g. file nodes)', async () => {
  const mock = installFetchMock((url) => {
    if (url.includes('/parents')) return { status: 500, json: {} };
    return { json: {} };
  });
  try {
    assert.deepEqual(await getNodeBreadcrumb('some-file'), []);
  } finally {
    mock.restore();
  }
});

test('getNodeBreadcrumb: de-duplicates a malformed chain (cycle guard)', async () => {
  const mock = installFetchMock((url) => {
    if (url.includes('/parents')) {
      return { json: { nodes: [
        makeNode('a', 'A'),
        makeNode('root', 'Root'),
        makeNode('root', 'Root again'),
      ] } };
    }
    return { json: {} };
  });
  try {
    const crumb = await getNodeBreadcrumb('a');
    assert.deepEqual(crumb.map(c => c.nodeId), ['root', 'a']);
  } finally {
    mock.restore();
  }
});

test('getNodeBreadcrumb: caps the depth to maxDepth (root-most kept)', async () => {
  const mock = installFetchMock((url) => {
    if (url.includes('/parents')) {
      // self-first: [self, p1, p2, root]
      return { json: { nodes: [
        makeNode('self', 'Self'),
        makeNode('p1', 'P1'),
        makeNode('p2', 'P2'),
        makeNode('root', 'Root'),
      ] } };
    }
    return { json: {} };
  });
  try {
    const crumb = await getNodeBreadcrumb('self', 2);
    // Reversed order is root→node; the cap keeps the first two (root-most).
    assert.deepEqual(crumb.map(c => c.nodeId), ['root', 'p2']);
  } finally {
    mock.restore();
  }
});
