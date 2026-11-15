import { test } from 'node:test';
import assert from 'node:assert/strict';

import { fetchWikipediaSummary } from '../src/wikipedia-api.js';
import { installFetchMock } from './fetchMock.js';

/** A standard REST summary payload for a real article. */
function summaryPayload(title: string, extract: string, lang = 'de') {
  return {
    type: 'standard',
    title,
    extract,
    thumbnail: { source: `https://upload.wikimedia.org/${title}.jpg`, width: 320, height: 240 },
    content_urls: { desktop: { page: `https://${lang}.wikipedia.org/wiki/${title}` } },
    lang,
  };
}

test('fetchWikipediaSummary: maps a direct summary hit to {title, extract, thumbnail, url, lang}', async () => {
  const mock = installFetchMock((url) => {
    if (url.includes('/page/summary/')) {
      return { json: summaryPayload('Photosynthese', 'Die Photosynthese ist ein Prozess.') };
    }
    return { json: {} };
  });
  try {
    const result = await fetchWikipediaSummary('Photosynthese', 'de');
    assert.ok(result);
    assert.equal(result.title, 'Photosynthese');
    assert.equal(result.extract, 'Die Photosynthese ist ein Prozess.');
    assert.equal(result.thumbnail, 'https://upload.wikimedia.org/Photosynthese.jpg');
    assert.equal(result.url, 'https://de.wikipedia.org/wiki/Photosynthese');
    assert.equal(result.lang, 'de');

    // A descriptive User-Agent is required by the Wikimedia REST API.
    const headers = mock.calls[0]?.init?.headers as Record<string, string> | undefined;
    assert.ok(headers && String(headers['User-Agent'] ?? '').length > 0);
  } finally {
    mock.restore();
  }
});

test('fetchWikipediaSummary: hits the correct language subdomain', async () => {
  const mock = installFetchMock((url) => {
    if (url.includes('/page/summary/')) return { json: summaryPayload('Photosynthesis', 'A process.', 'en') };
    return { json: {} };
  });
  try {
    await fetchWikipediaSummary('Photosynthesis', 'en');
    assert.ok(mock.calls[0]?.url.startsWith('https://en.wikipedia.org/'));
  } finally {
    mock.restore();
  }
});

test('fetchWikipediaSummary: rejects a host-injection lang and falls back to de', async () => {
  const mock = installFetchMock((url) => {
    if (url.includes('/page/summary/')) return { json: summaryPayload('Test', 'X.') };
    return { json: {} };
  });
  try {
    await fetchWikipediaSummary('Test', 'de.evil.com/');
    // Must NOT have contacted the injected host; the request stays on de.wikipedia.org.
    assert.ok(mock.calls[0]?.url.startsWith('https://de.wikipedia.org/'));
  } finally {
    mock.restore();
  }
});

test('fetchWikipediaSummary: returns null when the article does not exist (404 + empty opensearch)', async () => {
  const mock = installFetchMock((url) => {
    if (url.includes('/w/api.php')) return { json: ['Nichtvorhanden', [], [], []] };
    if (url.includes('/page/summary/')) return { status: 404, json: { type: 'not_found' } };
    return { json: {} };
  });
  try {
    const result = await fetchWikipediaSummary('Nichtvorhanden xyz123', 'de');
    assert.equal(result, null);
  } finally {
    mock.restore();
  }
});

test('fetchWikipediaSummary: falls back to opensearch title resolution, then summary', async () => {
  const mock = installFetchMock((url) => {
    if (url.includes('/w/api.php')) {
      // opensearch → resolves the misspelled query to the canonical title.
      return { json: ['photosynthese vorgang', ['Photosynthese'], ['Prozess'], ['https://de.wikipedia.org/wiki/Photosynthese']] };
    }
    if (url.includes('/page/summary/')) {
      // Direct lookup for the raw query misses; the resolved title hits.
      if (url.includes('Photosynthese')) return { json: summaryPayload('Photosynthese', 'Aufgelöst.') };
      return { status: 404, json: { type: 'not_found' } };
    }
    return { json: {} };
  });
  try {
    const result = await fetchWikipediaSummary('photosynthese vorgang', 'de');
    assert.ok(result);
    assert.equal(result.title, 'Photosynthese');
    assert.equal(result.extract, 'Aufgelöst.');
    // opensearch must have been consulted.
    assert.ok(mock.calls.some(c => c.url.includes('/w/api.php')));
  } finally {
    mock.restore();
  }
});

test('fetchWikipediaSummary: caps the extract to the requested number of sections (paragraphs)', async () => {
  const mock = installFetchMock((url) => {
    if (url.includes('/page/summary/')) {
      return { json: summaryPayload('Test', 'Absatz eins.\n\nAbsatz zwei.\n\nAbsatz drei.') };
    }
    return { json: {} };
  });
  try {
    const one = await fetchWikipediaSummary('Test', 'de', 1);
    assert.equal(one?.extract, 'Absatz eins.');
    const two = await fetchWikipediaSummary('Test', 'de', 2);
    assert.equal(two?.extract, 'Absatz eins.\n\nAbsatz zwei.');
  } finally {
    mock.restore();
  }
});

test('fetchWikipediaSummary: treats a disambiguation page as no article', async () => {
  const mock = installFetchMock((url) => {
    if (url.includes('/w/api.php')) return { json: ['Merkur', [], [], []] };
    if (url.includes('/page/summary/')) {
      return { json: { type: 'disambiguation', title: 'Merkur', extract: 'Merkur steht für …', lang: 'de' } };
    }
    return { json: {} };
  });
  try {
    const result = await fetchWikipediaSummary('Merkur', 'de');
    assert.equal(result, null);
  } finally {
    mock.restore();
  }
});

test('fetchWikipediaSummary: a 200 that is not JSON returns null instead of throwing', async () => {
  // The module documents "returns null when no article matches", and its
  // callers rely on that: services/search.ts wraps every call in .catch(() =>
  // null) precisely because a parse failure used to escape. A Wikimedia CDN
  // interstitial answers 200 with HTML — that must be a miss, not an error
  // surfacing as HTTP 500 from /api/wikipedia.
  const mock = installFetchMock(() => ({ text: '<html>Request blocked</html>' }));
  try {
    assert.equal(await fetchWikipediaSummary('Merkur', 'de'), null);
  } finally {
    mock.restore();
  }
});

test('fetchWikipediaSummary: a malformed opensearch body returns null instead of throwing', async () => {
  const mock = installFetchMock((url) => {
    if (url.includes('/w/api.php')) return { text: 'not json at all' };
    return { status: 404, json: {} };
  });
  try {
    assert.equal(await fetchWikipediaSummary('Mrekur', 'de'), null);
  } finally {
    mock.restore();
  }
});

// ── Relevance of the opensearch fallback (2026-08-02) ───────────────────────
// Live-measured: every wrong article came from this fallback, never from the
// direct lookup, and for "Dreiecke" the RIGHT article sat at position 5 while
// the wrong one was first. See src/wikipedia-relevance.ts.

/** Serve the opensearch list for any query; 404 every direct summary but `have`. */
function fuzzyMock(candidates: string[], have: Record<string, string> = {}) {
  return installFetchMock((url) => {
    if (url.includes('action=opensearch')) {
      return { json: ['q', candidates, candidates.map(() => ''), candidates.map(() => '')] };
    }
    const m = url.match(/\/page\/summary\/(.+)$/);
    const title = m ? decodeURIComponent(m[1]!) : '';
    if (title in have) return { json: summaryPayload(title, have[title]!) };
    return { status: 404, json: {} };
  });
}

test('fetchWikipediaSummary: picks the relevant candidate, not the first one', async () => {
  const mock = fuzzyMock(
    ['Dreiecker', 'Dreiecketer', 'Dreieck Essen-Ost', 'Dreieck', 'Dreiecks-Fettspinne'],
    { 'Dreieck': 'Ein Dreieck ist ein Polygon.' },
  );
  try {
    const result = await fetchWikipediaSummary('Dreiecke', 'de');
    assert.equal(result?.title, 'Dreieck', 'the base concept, not the Allgäu mountain');
    assert.equal(result?.match, 'fuzzy', 'a resolved-by-search hit must say so');
  } finally {
    mock.restore();
  }
});

test('fetchWikipediaSummary: returns nothing when no candidate is about the query', async () => {
  const mock = fuzzyMock(
    ['Stadt Bern', 'Stadtbergen', 'Stabi Berlin'],
    { 'Stadt Bern': 'Bern ist die Bundesstadt der Schweiz.' },
  );
  try {
    assert.equal(await fetchWikipediaSummary('Stadt Berlin', 'de'), null,
      'a wrong article is worse than none — it gets cited as the source');
  } finally {
    mock.restore();
  }
});

test('fetchWikipediaSummary: a direct hit is never relevance-checked', async () => {
  // "Bruchrechnen" → "Bruchrechnung" is a curated Wikipedia REDIRECT. No rule
  // short of a stemmer relates the two, so checking it would only ever reject
  // a correct answer.
  const mock = installFetchMock((url) => {
    if (url.includes('/page/summary/')) {
      return { json: summaryPayload('Bruchrechnung', 'Die Bruchrechnung behandelt Brüche.') };
    }
    return { json: ['q', [], [], []] };
  });
  try {
    const result = await fetchWikipediaSummary('Bruchrechnen', 'de');
    assert.equal(result?.title, 'Bruchrechnung');
    assert.equal(result?.match, 'exact', 'a direct/redirect hit is an exact resolution');
    assert.equal(mock.calls.filter(c => c.url.includes('opensearch')).length, 0,
      'no fallback search is needed when the direct lookup answers');
  } finally {
    mock.restore();
  }
});

test('fetchWikipediaSummary: asks opensearch for a list, not a single candidate', async () => {
  const mock = fuzzyMock(['Feinoptiker'], { 'Feinoptiker': 'Ein Feinoptiker fertigt Optik.' });
  try {
    const result = await fetchWikipediaSummary('Feinoptik', 'de');
    assert.equal(result?.title, 'Feinoptiker');
    const search = mock.calls.find(c => c.url.includes('action=opensearch'));
    const limit = new URL(search!.url).searchParams.get('limit');
    assert.ok(Number(limit) > 1, `limit must leave room for a better candidate, got ${limit}`);
  } finally {
    mock.restore();
  }
});

test('fetchWikipediaSummary: a disambiguation page is not fetched twice', async () => {
  // The picked title equals the query, and the direct lookup for exactly that
  // name already failed above — asking again would spend a round trip to reach
  // the same null. This is the branch behind the "disambiguation ends the
  // search" limitation in docs/plans/2026-08-02-wikipedia-relevance.md.
  const mock = installFetchMock((url) => {
    if (url.includes('action=opensearch')) {
      return { json: ['Bruch', ['Bruch', 'Bruchsal'], [], []] };
    }
    return { json: { type: 'disambiguation', title: 'Bruch', extract: 'Bruch steht für …', lang: 'de' } };
  });
  try {
    assert.equal(await fetchWikipediaSummary('Bruch', 'de'), null);
    assert.equal(mock.calls.filter(c => c.url.includes('/page/summary/')).length, 1,
      'the same title must not be fetched a second time');
  } finally {
    mock.restore();
  }
});
