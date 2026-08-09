import { test } from 'node:test';
import assert from 'node:assert/strict';

import { connectedClient, installFetchMock, makeNode } from './fetchMock.js';

/**
 * Mode C fetches page variants but returns Themenseiten, and several variants
 * can belong to one page — so the two counts never matched and the listing used
 * to GUESS the ratio: a pool of `maxResults * 2`, plus a one-shot top-up of
 * `max(50, maxResults * 5)` when the merge came up short. Two searches, and up
 * to fifty owner resolutions charged to a caller who asked for five results.
 *
 * The guess is gone. `virtual:primaryparent_nodeid` comes back on every hit and
 * one page-config folder IS one Themenseite, so the variants are grouped into
 * pages BEFORE any owner is resolved. What that buys is a HARD bound, which is
 * what these tests pin: the number of owner resolutions is `maxResults`, no
 * matter how many variants the repository returns or how hard they merge.
 */

function variantNode(i: number, parent: string) {
  return makeNode(`var-${i}`, `PAGE_VARIANT_${i}`, {
    'cm:name': [`PAGE_VARIANT_${i}`],
    'ccm:page_variant_profiling_target_group': ['teacher'],
    'virtual:primaryparent_nodeid': [`workspace://SpacesStore/${parent}`],
  });
}

/** The owner hop: cfg folder → its primary parent → that collection's metadata. */
function ownerLookup(url: string, cfg: string, coll: string, title: string) {
  if (url.includes(`${cfg}/metadata`)) {
    return { json: { node: makeNode(cfg, 'Config', {
      'virtual:primaryparent_nodeid': [`workspace://SpacesStore/${coll}`],
    }) } };
  }
  if (url.includes(`${coll}/metadata`)) {
    return { json: { node: makeNode(coll, title, {
      'cclom:title': [title],
      'ccm:page_config_ref': [`workspace://SpacesStore/${cfg}`],
    }) } };
  }
  return null;
}

/** maxItems of every page_variant search, in order. */
function poolSizes(calls: Array<{ url: string }>): number[] {
  return calls
    .filter(c => c.url.includes('/queries/-home-/mds_oeh/page_variant'))
    .map(c => Number(new URL(c.url).searchParams.get('maxItems')));
}

/** How many distinct page-config folders were walked. */
function foldersResolved(calls: Array<{ url: string }>): number {
  return new Set(
    calls.map(c => /(cfg-[\w-]+)\/metadata/.exec(c.url)?.[1]).filter(Boolean),
  ).size;
}

/** Each variant gets its own parent/collection → nothing ever merges. */
function installDistinctOwnersMock(available: number) {
  return installFetchMock((url) => {
    if (url.includes('/queries/-home-/mds_oeh/page_variant')) {
      const want = Number(new URL(url).searchParams.get('maxItems'));
      const n = Math.min(want, available);
      return { json: { nodes: Array.from({ length: n }, (_, i) => variantNode(i, `cfg-${i}`)) } };
    }
    const m = /(cfg|coll)-(\d+)\/metadata/.exec(url);
    if (m) {
      const hit = ownerLookup(url, `cfg-${m[2]}`, `coll-${m[2]}`, `Sammlung ${String(m[2]).padStart(3, '0')}`);
      if (hit) return hit;
    }
    return { json: {} };
  });
}

async function listPages(maxResults: number) {
  const client = await connectedClient();
  try {
    const result = await client.callTool({
      name: 'search_wlo_topic_pages',
      arguments: { maxResults, outputFormat: 'json' },
    });
    return JSON.parse((result.content as Array<{ text: string }>)[0]?.text ?? '{}');
  } finally {
    await client.close();
  }
}

test('Mode C: one search, never a second — the top-up round is gone', async () => {
  const mock = installDistinctOwnersMock(200);
  try {
    await listPages(20);
    assert.deepEqual(poolSizes(mock.calls), [300]);
  } finally {
    mock.restore();
  }
});

test('Mode C: only the requested number of pages is resolved, not the whole pool', async () => {
  // 200 variants come back; a caller who asked for 5 pages must not pay for 200
  // owner walks. This is the bound the old pool factor was trying to guess.
  const mock = installDistinctOwnersMock(200);
  try {
    const parsed = await listPages(5);
    assert.equal(parsed.total, 5);
    assert.equal(foldersResolved(mock.calls), 5, 'one folder walked per returned Themenseite');
    assert.equal(mock.calls.length, 1 + 5 * 2, 'search + (folder + owner) per page');
  } finally {
    mock.restore();
  }
});

test('Mode C: sibling variants do not consume the result budget', async () => {
  // The case the top-up existed for: the first variants all belong to ONE page.
  // Grouping happens before resolution, so the merge cannot leave the caller
  // short and no second request is needed.
  const mock = installFetchMock((url) => {
    if (url.includes('/queries/-home-/mds_oeh/page_variant')) {
      const siblings = Array.from({ length: 20 }, (_, i) => variantNode(i, 'cfg-same'));
      const distinct = Array.from({ length: 10 }, (_, i) => variantNode(100 + i, `cfg-${i}`));
      return { json: { nodes: [...siblings, ...distinct] } };
    }
    const same = ownerLookup(url, 'cfg-same', 'coll-same', 'Eine Sammlung');
    if (same) return same;
    const m = /(cfg|coll)-(\d+)\/metadata/.exec(url);
    if (m) {
      const hit = ownerLookup(url, `cfg-${m[2]}`, `coll-${m[2]}`, `Sammlung ${String(m[2]).padStart(3, '0')}`);
      if (hit) return hit;
    }
    return { json: {} };
  });
  try {
    const parsed = await listPages(5);
    assert.deepEqual(poolSizes(mock.calls), [300], 'no second search');
    assert.equal(parsed.total, 5, 'twenty siblings count as ONE page, the rest fill the request');
    assert.equal(foldersResolved(mock.calls), 5);
  } finally {
    mock.restore();
  }
});

test('Mode C: several page-config folders under ONE collection still fill the request', async () => {
  // Found by running Mode C against production 2026-08-07: "Zukunfts- und
  // Berufsorientierung" came back three times, because a collection may hold
  // several page-config folders (5 of 25 sampled pages). Grouping happens by
  // FOLDER — that is the only key available before resolution — but the merge
  // downstream keys on the owning COLLECTION, so three groups collapsed into
  // one entry and a request for 20 pages returned 19.
  const mock = installFetchMock((url) => {
    if (url.includes('/queries/-home-/mds_oeh/page_variant')) {
      // cfg-0/1/2 all belong to coll-0; cfg-3.. are pages of their own.
      const shared = [0, 1, 2].map(i => variantNode(i, `cfg-${i}`));
      const distinct = [3, 4, 5, 6].map(i => variantNode(i, `cfg-${i}`));
      return { json: { nodes: [...shared, ...distinct] } };
    }
    const cfg = /cfg-(\d+)\/metadata/.exec(url);
    if (cfg) {
      const owner = Number(cfg[1]) <= 2 ? 'coll-0' : `coll-${cfg[1]}`;
      return { json: { node: makeNode(`cfg-${cfg[1]}`, 'Config', {
        'virtual:primaryparent_nodeid': [`workspace://SpacesStore/${owner}`],
      }) } };
    }
    const coll = /(coll-\d+)\/metadata/.exec(url);
    if (coll) {
      return { json: { node: makeNode(coll[1], `Sammlung ${coll[1]}`, {
        'cclom:title': [`Sammlung ${coll[1]}`],
        'ccm:page_config_ref': ['workspace://SpacesStore/cfg-0'],
      }) } };
    }
    return { json: {} };
  });
  try {
    const parsed = await listPages(3);
    assert.equal(parsed.total, 3, 'three DISTINCT Themenseiten, not three folders of one');
    assert.deepEqual(
      parsed.results.map((r: { title: string }) => r.title),
      ['Sammlung coll-0', 'Sammlung coll-3', 'Sammlung coll-4'],
    );
  } finally {
    mock.restore();
  }
});

test('Mode C: fewer pages than requested is answered with what exists', async () => {
  const mock = installFetchMock((url) => {
    if (url.includes('/queries/-home-/mds_oeh/page_variant')) {
      return { json: { nodes: [variantNode(0, 'cfg-same'), variantNode(1, 'cfg-same')] } };
    }
    return ownerLookup(url, 'cfg-same', 'coll-same', 'Eine Sammlung') ?? { json: {} };
  });
  try {
    const parsed = await listPages(5);
    assert.deepEqual(poolSizes(mock.calls), [300], 'no pointless second request');
    assert.equal(parsed.total, 1);
  } finally {
    mock.restore();
  }
});

/** Capture the structured log lines written while `fn` runs. */
async function captureLog(fn: () => Promise<unknown>): Promise<string[]> {
  const lines: string[] = [];
  const realWrite = process.stderr.write.bind(process.stderr);
  process.stderr.write = ((chunk: string | Uint8Array, ...rest: unknown[]) => {
    lines.push(String(chunk));
    return realWrite(chunk as string, ...(rest as []));
  }) as typeof process.stderr.write;
  try {
    await fn();
  } finally {
    process.stderr.write = realWrite;
  }
  return lines;
}

test('Mode C: hitting the search cap is disclosed, not silent', async () => {
  // The listing fetches at most VARIANT_SEARCH_MAX variants in its one search.
  // The whole catalogue fits below that today (121 production / 99 staging,
  // measured 2026-08-07), but a cap nobody mentions reads as completeness once
  // the catalogue outgrows it.
  const mock = installDistinctOwnersMock(1000);
  try {
    const lines = await captureLog(() => listPages(3));
    const warned = lines.filter(l => l.includes('page-variant search hit its cap'));
    assert.equal(warned.length, 1, 'exactly one warning naming the cap');
    assert.match(warned[0], /"maxItems":300/);
  } finally {
    mock.restore();
  }
});

test('Mode C: a search below the cap says nothing', async () => {
  const mock = installDistinctOwnersMock(12);
  try {
    const lines = await captureLog(() => listPages(3));
    assert.equal(lines.filter(l => l.includes('page-variant search hit its cap')).length, 0);
  } finally {
    mock.restore();
  }
});
