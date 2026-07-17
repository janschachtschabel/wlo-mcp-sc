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
