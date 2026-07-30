import { test } from 'node:test';
import assert from 'node:assert/strict';

import { connectedClient, installFetchMock, makeNode, toolText } from './fetchMock.js';

/**
 * `get_wlo_content_text` delivers the material's own text so a worksheet can
 * actually be worked with, rather than only described. Metadata tools already
 * exist; this one is about the content itself.
 */

const LONG = 'Grundwert, Prozentwert und Prozentsatz berechnen. '.repeat(20);

function installMock(repoText: string, wwwurl?: string) {
  return installFetchMock((url) => {
    if (url.includes('/textContent')) return { json: { content: repoText } };
    if (url.includes('/metadata')) {
      return { json: { node: makeNode('n1', 'Arbeitsblatt', {
        'cclom:title': ['Arbeitsblatt Prozentrechnung'],
        ...(wwwurl ? { 'ccm:wwwurl': [wwwurl] } : {}),
      }) } };
    }
    if (url.includes('text-extraction')) return { json: { text: LONG, status: 200 } };
    return { json: {} };
  });
}

test('get_wlo_content_text: returns the material text as structured content', async () => {
  const mock = installMock(LONG);
  const client = await connectedClient();
  try {
    const res = await client.callTool({
      name: 'get_wlo_content_text',
      arguments: { nodeId: 'n1', outputFormat: 'json' },
    });
    const sc = res.structuredContent as { text: string; source: string; title: string; truncated: boolean };
    assert.equal(sc.source, 'repository');
    assert.equal(sc.title, 'Arbeitsblatt Prozentrechnung');
    assert.ok(sc.text.includes('Prozentsatz'));
    assert.equal(sc.truncated, false);
  } finally {
    await client.close();
    mock.restore();
  }
});

test('get_wlo_content_text: markdown output carries the text and names its source', async () => {
  const mock = installMock(LONG);
  const client = await connectedClient();
  try {
    const res = await client.callTool({
      name: 'get_wlo_content_text',
      arguments: { nodeId: 'n1' },
    });
    const text = toolText(res);
    assert.match(text, /Arbeitsblatt Prozentrechnung/);
    assert.match(text, /Prozentsatz/, 'the material text itself');
    assert.match(text, /Quelle:/i, 'provenance is stated, not implied');
  } finally {
    await client.close();
    mock.restore();
  }
});

test('get_wlo_content_text: no text anywhere is a stated reason, not an error', async () => {
  const mock = installMock('');
  const client = await connectedClient();
  try {
    const res = await client.callTool({
      name: 'get_wlo_content_text',
      arguments: { nodeId: 'n1', outputFormat: 'json' },
    });
    assert.notEqual(res.isError, true);
    const sc = res.structuredContent as { source: string; reason?: string };
    assert.equal(sc.source, 'none');
    assert.equal(sc.reason, 'no_text_no_url');
  } finally {
    await client.close();
    mock.restore();
  }
});

test('get_wlo_content_text: maxChars is honoured', async () => {
  const mock = installMock(LONG);
  const client = await connectedClient();
  try {
    const res = await client.callTool({
      name: 'get_wlo_content_text',
      // 500 is the schema minimum — below that a "full text" is not one.
      arguments: { nodeId: 'n1', maxChars: 500, outputFormat: 'json' },
    });
    const sc = res.structuredContent as { truncated: boolean; charCount: number; text: string };
    assert.equal(sc.truncated, true);
    assert.ok(sc.charCount > 500, 'the full length is still reported');
    assert.ok(sc.text.length < sc.charCount, 'and the delivered text is shorter');
  } finally {
    await client.close();
    mock.restore();
  }
});

test('get_wlo_content_text is registered and describes what it is for', async () => {
  const client = await connectedClient();
  try {
    const { tools } = await client.listTools();
    const tool = tools.find(x => x.name === 'get_wlo_content_text');
    assert.ok(tool, 'tool is registered');
    const head = (tool.description ?? '').slice(0, 256).toLowerCase();
    assert.match(head, /volltext|inhalt|text/, 'names what it returns up front');
    assert.equal(tool.annotations?.readOnlyHint, true);
  } finally {
    await client.close();
  }
});
