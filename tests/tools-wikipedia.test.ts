import { test } from 'node:test';
import assert from 'node:assert/strict';

import { connectedClient, installFetchMock, toolText } from './fetchMock.js';

function articleMock() {
  return installFetchMock((url) => {
    if (url.includes('/page/summary/')) {
      return { json: {
        type: 'standard',
        title: 'Photosynthese',
        extract: 'Die Photosynthese wandelt Lichtenergie um.',
        content_urls: { desktop: { page: 'https://de.wikipedia.org/wiki/Photosynthese' } },
        lang: 'de',
      } };
    }
    return { json: {} };
  });
}

test('get_wikipedia_summary: markdown output carries title, extract and link', async () => {
  const mock = articleMock();
  const client = await connectedClient();
  try {
    const result = await client.callTool({ name: 'get_wikipedia_summary', arguments: { query: 'Photosynthese' } });
    const text = (result.content as Array<{ type: string; text: string }>)[0]?.text ?? '';
    assert.match(text, /Photosynthese/);
    assert.match(text, /Die Photosynthese wandelt Lichtenergie um\./);
    assert.match(text, /de\.wikipedia\.org\/wiki\/Photosynthese/);
  } finally {
    await client.close();
    mock.restore();
  }
});

test('get_wikipedia_summary: json output has {query, found, summary}', async () => {
  const mock = articleMock();
  const client = await connectedClient();
  try {
    const result = await client.callTool({
      name: 'get_wikipedia_summary',
      arguments: { query: 'Photosynthese', outputFormat: 'json' },
    });
    const text = (result.content as Array<{ type: string; text: string }>)[0]?.text ?? '';
    const parsed = JSON.parse(text);
    assert.equal(parsed.found, true);
    assert.equal(parsed.query, 'Photosynthese');
    assert.equal(parsed.summary.title, 'Photosynthese');
    assert.equal(parsed.summary.lang, 'de');
    assert.ok(parsed.summary.url.includes('/wiki/Photosynthese'));
  } finally {
    await client.close();
    mock.restore();
  }
});

test('get_wikipedia_summary: reports found=false when no article matches', async () => {
  const mock = installFetchMock((url) => {
    if (url.includes('/w/api.php')) return { json: ['x', [], [], []] };
    if (url.includes('/page/summary/')) return { status: 404, json: {} };
    return { json: {} };
  });
  const client = await connectedClient();
  try {
    const result = await client.callTool({
      name: 'get_wikipedia_summary',
      arguments: { query: 'zzzznichtvorhanden', outputFormat: 'json' },
    });
    const text = (result.content as Array<{ type: string; text: string }>)[0]?.text ?? '';
    const parsed = JSON.parse(text);
    assert.equal(parsed.found, false);
    assert.equal(parsed.summary, null);
  } finally {
    await client.close();
    mock.restore();
  }
});

test('fullText liefert den ganzen Artikel — über den AUFGELÖSTEN Titel', async () => {
  // Zwei Anfragen, mit Absicht. Die erste löst den Titel auf UND prüft ihn gegen
  // die Relevanzregel (wikipedia-relevance.ts): „Stadt Berlin" hat einmal den
  // Schweizer Bundesort geliefert, und ein Aufrufer schreibt darunter „Quelle:
  // Wikipedia-Artikel ‚X'". Den Volltext direkt über die rohe Anfrage zu holen
  // würde genau diese Prüfung überspringen — deshalb geht der zweite Aufruf mit
  // dem geprüften Titel, nicht mit dem, was der Nutzer getippt hat.
  const seen: string[] = [];
  const mock = installFetchMock((url) => {
    seen.push(url);
    if (url.includes('/page/summary/')) {
      return { json: { title: 'Photosynthese', extract: 'Kurzfassung.',
        content_urls: { desktop: { page: 'https://de.wikipedia.org/wiki/Photosynthese' } } } };
    }
    if (url.includes('prop=extracts')) {
      return { json: { query: { pages: [{ title: 'Photosynthese', extract: 'GANZER ARTIKEL. '.repeat(50) }] } } };
    }
    return { status: 404, json: {} };
  });
  const client = await connectedClient();
  try {
    const result = await client.callTool({
      name: 'get_wikipedia_summary',
      arguments: { query: 'Photosynthese', fullText: true },
    });
    const text = toolText(result);
    assert.match(text, /GANZER ARTIKEL/, 'der Volltext steht in der Antwort');
    assert.doesNotMatch(text, /^Kurzfassung\.$/m, 'nicht mehr nur der Anriss');

    const extract = seen.find(u => u.includes('prop=extracts'));
    assert.ok(extract, `kein Volltext-Aufruf in: ${seen.join(' | ')}`);
    assert.match(extract, /titles=Photosynthese/, 'mit dem aufgelösten Titel');
    assert.match(extract, /explaintext=1/, 'als Klartext, nicht als HTML');
  } finally {
    mock.restore();
    await client.close();
  }
});

test('ohne fullText bleibt es beim Anriss und bei EINEM Aufruf', async () => {
  // Die Vorgabe darf sich nicht ändern: der häufige Fall ist Hintergrundwissen
  // neben WLO-Material, und ein Artikel von 100k Zeichen (gemessen: Apolda
  // 123.682) flutet jeden Kontext.
  const seen: string[] = [];
  const mock = installFetchMock((url) => {
    seen.push(url);
    return { json: { title: 'Photosynthese', extract: 'Kurzfassung.',
      content_urls: { desktop: { page: 'https://de.wikipedia.org/wiki/Photosynthese' } } } };
  });
  const client = await connectedClient();
  try {
    await client.callTool({ name: 'get_wikipedia_summary', arguments: { query: 'Photosynthese' } });
    assert.equal(seen.filter(u => u.includes('prop=extracts')).length, 0, 'kein Volltext-Aufruf');
  } finally {
    mock.restore();
    await client.close();
  }
});
