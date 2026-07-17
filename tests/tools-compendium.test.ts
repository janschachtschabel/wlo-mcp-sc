import { test } from 'node:test';
import assert from 'node:assert/strict';

import { connectedClient, installFetchMock, makeNode } from './fetchMock.js';

function metadataMock() {
  return installFetchMock((url) => {
    if (url.includes('/metadata') && url.includes('coll-1')) {
      return { json: { node: makeNode('coll-1', 'Sammlung Optik', {
        'cm:name': ['Sammlung Optik'],
        'ccm:oeh_collection_compendium_text': ['Die Optik behandelt Licht und Sehen.'],
      }) } };
    }
    return { json: {} };
  });
}

test('get_compendium_text: markdown output includes the full compendium text', async () => {
  const mock = metadataMock();
  const client = await connectedClient();
  try {
    const result = await client.callTool({ name: 'get_compendium_text', arguments: { nodeId: 'coll-1' } });
    const text = (result.content as Array<{ type: string; text: string }>)[0]?.text ?? '';
    assert.match(text, /Sammlung Optik/);
    assert.match(text, /Die Optik behandelt Licht und Sehen\./);
  } finally {
    await client.close();
    mock.restore();
  }
});

test('get_compendium_text: json output returns {entries}', async () => {
  const mock = metadataMock();
  const client = await connectedClient();
  try {
    const result = await client.callTool({
      name: 'get_compendium_text',
      arguments: { nodeIds: ['coll-1'], outputFormat: 'json' },
    });
    const text = (result.content as Array<{ type: string; text: string }>)[0]?.text ?? '';
    const parsed = JSON.parse(text);
    assert.equal(parsed.entries.length, 1);
    assert.equal(parsed.entries[0].nodeId, 'coll-1');
    assert.match(parsed.entries[0].compendiumText, /Licht und Sehen/);
  } finally {
    await client.close();
    mock.restore();
  }
});

test('get_compendium_text: errors when neither nodeId nor nodeIds is given', async () => {
  const client = await connectedClient();
  try {
    const result = await client.callTool({ name: 'get_compendium_text', arguments: {} });
    assert.equal(result.isError, true);
    const text = (result.content as Array<{ type: string; text: string }>)[0]?.text ?? '';
    assert.match(text, /nodeId/);
  } finally {
    await client.close();
  }
});

test('get_compendium_text: rejects more than 25 nodeIds (no network)', async () => {
  const client = await connectedClient();
  try {
    const tooMany = Array.from({ length: 26 }, (_, i) => `id-${i}`);
    let rejected = false;
    try {
      const result = await client.callTool({ name: 'get_compendium_text', arguments: { nodeIds: tooMany } });
      rejected = result.isError === true;
    } catch {
      rejected = true;
    }
    assert.equal(rejected, true, 'expected 26 nodeIds to be rejected');
  } finally {
    await client.close();
  }
});
