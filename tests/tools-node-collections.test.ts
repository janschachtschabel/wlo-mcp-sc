/**
 * tools-node-collections.test.ts – the reverse lookup as a tool.
 *
 * The reason this is its own tool and not a flag on `get_node_details`: that
 * tool advertises itself as fast (~0.3 s, metadata only) and is called
 * casually and often. This costs two upstream round-trips for a question that
 * is rarely asked, so it must not sit on the fast path.
 *
 * The reason the empty case is named rather than silent: a model that receives
 * an empty list answers "this is in no collection", which is a claim. When the
 * truth is "we could not find out", that claim is a false statement to a user.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { connectedClient, installFetchMock, toolText } from './fetchMock.js';

const ORIGINAL = '5a19e0e1-92ec-47db-9a19-779d4d576485';
const REFERENCE = 'c2e9b9ca-8389-494f-ba24-f45da654d9c2';

function entry(id: string, title: string, usageType = 'ACTIVE') {
  return {
    collectionUsageType: usageType,
    collection: {
      ref: { id, repo: 'local' },
      type: 'ccm:map',
      isDirectory: true,
      properties: { 'cm:title': [title], 'cclom:title': [title] },
    },
  };
}

function serve(opts: { originalId?: string; entries?: unknown[]; metadataStatus?: number } = {}) {
  return installFetchMock((url) => {
    if (url.includes('/node/v1/nodes/')) {
      if (opts.metadataStatus && opts.metadataStatus !== 200) return { status: opts.metadataStatus, json: {} };
      const id = /\/nodes\/-home-\/([^/?]+)/.exec(url)?.[1] ?? '';
      return {
        json: {
          node: {
            ref: { id, repo: '-home-' },
            ...(opts.originalId ? { originalId: opts.originalId } : {}),
            properties: { 'cclom:title': ['Arbeitsblatt Ernährung'] },
          },
        },
      };
    }
    if (url.includes('/usage/v1/')) return { json: opts.entries ?? [] };
    return { json: {} };
  });
}

test('the tool is offered without any login', async () => {
  const client = await connectedClient();
  try {
    const names = (await client.listTools()).tools.map(t => t.name);
    assert.ok(names.includes('get_node_collections'), 'a read tool belongs on the public surface');
  } finally {
    await client.close();
  }
});

test('it lists the collections a material is filed in', async () => {
  const mock = serve({ entries: [entry('c-1', 'Ernährung'), entry('c-2', 'Biologie-Breakouts')] });
  const client = await connectedClient();
  try {
    const text = toolText(await client.callTool({
      name: 'get_node_collections', arguments: { nodeId: ORIGINAL },
    }));
    assert.match(text, /Ernährung/);
    assert.match(text, /Biologie-Breakouts/);
  } finally {
    await client.close();
    mock.restore();
  }
});

test('a reference id from a collection listing works just like an original', async () => {
  const mock = serve({ originalId: ORIGINAL, entries: [entry('c-1', 'Ernährung')] });
  const client = await connectedClient();
  try {
    const res = await client.callTool({
      name: 'get_node_collections', arguments: { nodeId: REFERENCE, outputFormat: 'json' },
    });
    const json = JSON.parse(toolText(res)) as {
      nodeId: string; requestedNodeId: string; wasReference: boolean; count: number;
    };
    assert.equal(json.nodeId, ORIGINAL);
    assert.equal(json.requestedNodeId, REFERENCE);
    assert.equal(json.wasReference, true, 'reported so a client can debug its own id handling');
    assert.equal(json.count, 1);
  } finally {
    await client.close();
    mock.restore();
  }
});

test('being in no collection says so, and says which case it is', async () => {
  const mock = serve({ entries: [] });
  const client = await connectedClient();
  try {
    const res = await client.callTool({
      name: 'get_node_collections', arguments: { nodeId: ORIGINAL, outputFormat: 'json' },
    });
    const json = JSON.parse(toolText(res)) as { count: number; reason?: string };
    assert.equal(json.count, 0);
    assert.equal(json.reason, 'not_in_any_collection');
    assert.notEqual((res as { isError?: boolean }).isError, true, 'not an error — it is a valid answer');
  } finally {
    await client.close();
    mock.restore();
  }
});

test('a node that does not exist is a different answer from one in no collection', async () => {
  const mock = serve({ metadataStatus: 404 });
  const client = await connectedClient();
  try {
    const res = await client.callTool({
      name: 'get_node_collections', arguments: { nodeId: 'gibt-es-nicht', outputFormat: 'json' },
    });
    assert.match(toolText(res), /node_not_found/);
    assert.equal((res as { isError?: boolean }).isError, true);
  } finally {
    await client.close();
    mock.restore();
  }
});

test('the markdown answer names the material and states the empty case in words', async () => {
  const mock = serve({ entries: [] });
  const client = await connectedClient();
  try {
    const text = toolText(await client.callTool({
      name: 'get_node_collections', arguments: { nodeId: ORIGINAL },
    }));
    assert.match(text, /Arbeitsblatt Ernährung/);
    assert.match(text, /keiner Sammlung/i);
  } finally {
    await client.close();
    mock.restore();
  }
});

test('the description points at the breadcrumb tool for collections', async () => {
  // The two together answer "where does this sit?" — one for material, one for
  // collections. Each must send the other case elsewhere.
  const client = await connectedClient();
  try {
    const { tools } = await client.listTools();
    const tool = tools.find(t => t.name === 'get_node_collections');
    assert.ok(tool);
    assert.match(tool.description ?? '', /get_node_breadcrumb/);
    assert.equal(tool.annotations?.readOnlyHint, true);
  } finally {
    await client.close();
  }
});
