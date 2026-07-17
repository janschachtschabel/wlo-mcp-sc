import { test } from 'node:test';
import assert from 'node:assert/strict';

import { connectedClient, installFetchMock, makeNode, toolText } from './fetchMock.js';

/** Route WLO node endpoints by their URL suffix (metadata / textContent / parents). */
function installNodeMock() {
  return installFetchMock((url) => {
    const m = url.match(/-home-\/([^/]+)\/(metadata|textContent|parents)/);
    const id = m ? decodeURIComponent(m[1]) : '';
    const kind = m ? m[2] : '';
    if (kind === 'metadata') return { json: { node: makeNode(id, `Titel ${id}`) } };
    if (kind === 'textContent') return { json: { content: `Volltext von ${id}` } };
    if (kind === 'parents') return { json: { nodes: [makeNode(`parent-of-${id}`, `Sammlung ${id}`)] } };
    return { status: 404, json: {} };
  });
}

test('get_nodes_details: includeTextContent/includeParents enrich each result', async () => {
  const mock = installNodeMock();
  const client = await connectedClient();
  try {
    const result = await client.callTool({
      name: 'get_nodes_details',
      arguments: { nodeIds: ['n1', 'n2'], includeTextContent: true, includeParents: true },
    });
    const payload = JSON.parse(toolText(result as any));
    assert.equal(payload.resolved, 2);
    // Volltext pro Knoten
    assert.match(payload.results.n1.textContent, /Volltext von n1/);
    assert.match(payload.results.n2.textContent, /Volltext von n2/);
    // Eltern-Sammlungen als {nodeId, title}
    assert.equal(payload.results.n1.parents[0].nodeId, 'parent-of-n1');
    assert.ok(payload.results.n1.parents[0].title);
  } finally {
    await client.close();
    mock.restore();
  }
});

/** Node mock whose metadata carries an editorial compendium text. */
function installCompendiumMock(text: string) {
  return installFetchMock((url) => {
    const m = url.match(/-home-\/([^/]+)\/(metadata|textContent|parents)/);
    const id = m ? decodeURIComponent(m[1]) : '';
    const kind = m ? m[2] : '';
    if (kind === 'metadata') {
      return { json: { node: makeNode(id, `Titel ${id}`, {
        'ccm:oeh_collection_compendium_text': [text],
      }) } };
    }
    return { status: 404, json: {} };
  });
}

test('get_node_details (singular): json output surfaces compendiumText when present', async () => {
  const mock = installCompendiumMock('Diese Sammlung behandelt die Optik.');
  const client = await connectedClient();
  try {
    const result = await client.callTool({
      name: 'get_node_details',
      arguments: { nodeId: 'coll-x', outputFormat: 'json' },
    });
    const payload = JSON.parse(toolText(result as any));
    assert.equal(payload.compendiumText, 'Diese Sammlung behandelt die Optik.');
  } finally {
    await client.close();
    mock.restore();
  }
});

test('get_node_details (singular): markdown output includes a Kompendium line when present', async () => {
  const mock = installCompendiumMock('Diese Sammlung behandelt die Optik.');
  const client = await connectedClient();
  try {
    const result = await client.callTool({
      name: 'get_node_details',
      arguments: { nodeId: 'coll-x', outputFormat: 'markdown' },
    });
    assert.match(toolText(result as any), /Kompendium: Diese Sammlung behandelt die Optik\./);
  } finally {
    await client.close();
    mock.restore();
  }
});

test('get_node_details (singular): no compendium property → no compendiumText key, no Kompendium line', async () => {
  const mock = installNodeMock();  // makeNode without the property
  const client = await connectedClient();
  try {
    const jsonRes = await client.callTool({
      name: 'get_node_details',
      arguments: { nodeId: 'plain', outputFormat: 'json' },
    });
    assert.equal('compendiumText' in JSON.parse(toolText(jsonRes as any)), false);

    const mdRes = await client.callTool({
      name: 'get_node_details',
      arguments: { nodeId: 'plain', outputFormat: 'markdown' },
    });
    assert.ok(!toolText(mdRes as any).includes('Kompendium:'));
  } finally {
    await client.close();
    mock.restore();
  }
});

test('get_nodes_details (plural): results carry compendiumText when present', async () => {
  const mock = installCompendiumMock('Kompendium Text');
  const client = await connectedClient();
  try {
    const result = await client.callTool({
      name: 'get_nodes_details',
      arguments: { nodeIds: ['c1'] },
    });
    const payload = JSON.parse(toolText(result as any));
    assert.equal(payload.results.c1.compendiumText, 'Kompendium Text');
  } finally {
    await client.close();
    mock.restore();
  }
});

test('get_nodes_details: without the flags, output is unchanged and no extra fetches happen', async () => {
  const mock = installNodeMock();
  const client = await connectedClient();
  try {
    const result = await client.callTool({
      name: 'get_nodes_details',
      arguments: { nodeIds: ['n1'] },
    });
    const payload = JSON.parse(toolText(result as any));
    // Backward-compat: keine Enrichment-Felder wenn nicht angefordert.
    assert.equal(payload.results.n1.textContent, undefined);
    assert.equal(payload.results.n1.parents, undefined);
    // Und keine unnötigen Round-Trips zu /textContent oder /parents.
    assert.ok(!mock.calls.some(c => c.url.includes('/textContent')));
    assert.ok(!mock.calls.some(c => c.url.includes('/parents')));
  } finally {
    await client.close();
    mock.restore();
  }
});
