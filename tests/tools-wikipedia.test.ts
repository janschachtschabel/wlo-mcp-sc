import { test } from 'node:test';
import assert from 'node:assert/strict';

import { connectedClient, installFetchMock } from './fetchMock.js';

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
