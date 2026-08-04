import { test } from 'node:test';
import assert from 'node:assert/strict';

import { connectedClient, installFetchMock, makeNode, toolText } from './fetchMock.js';

/**
 * Route WLO node endpoints by their URL suffix.
 *
 * `/parents` answers EMPTY here because that is what it does live for a
 * `ccm:io`. The containing collections come from `/usage/v1`. An earlier
 * version of this mock served `/parents` with a collection for content nodes,
 * which made the tool look correct while it was answering "in no collection"
 * for material that was filed in several.
 */
function installNodeMock() {
  return installFetchMock((url) => {
    if (url.includes('/usage/v1/')) {
      const id = /\/usages\/node\/([^/]+)\/collections/.exec(url)?.[1] ?? '';
      return {
        json: [{
          collectionUsageType: 'ACTIVE',
          collection: {
            ref: { id: `parent-of-${id}`, repo: '-home-' },
            type: 'ccm:map',
            isDirectory: true,
            properties: { 'cm:title': [`Sammlung ${id}`], 'cclom:title': [`Sammlung ${id}`] },
          },
        }],
      };
    }
    const m = url.match(/-home-\/([^/]+)\/(metadata|textContent|parents)/);
    const id = m ? decodeURIComponent(m[1]) : '';
    const kind = m ? m[2] : '';
    if (kind === 'metadata') return { json: { node: makeNode(id, `Titel ${id}`) } };
    if (kind === 'textContent') return { json: { content: `Volltext von ${id}` } };
    if (kind === 'parents') return { json: { nodes: [] } };
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

/**
 * Reality for a CONTENT node, measured: `/parents` answers 200 with an empty
 * list — it only ever carries ancestors for collections. The collections a
 * material is filed in live behind `/usage/v1`. A caller that reads `/parents`
 * alone therefore gets "in no collection" for a record that is in two, which is
 * a false statement rather than a missing one.
 */
function installContentNodeMock(opts: { usages?: number; usageStatus?: number } = {}) {
  return installFetchMock((url) => {
    if (url.includes('/usage/v1/')) {
      if (opts.usageStatus && opts.usageStatus !== 200) return { status: opts.usageStatus, json: {} };
      return {
        json: Array.from({ length: opts.usages ?? 2 }, (_, i) => ({
          collectionUsageType: 'ACTIVE',
          collection: {
            ref: { id: `coll-${i + 1}`, repo: '-home-' },
            type: 'ccm:map',
            isDirectory: true,
            properties: { 'cm:title': [`Sammlung ${i + 1}`], 'cclom:title': [`Sammlung ${i + 1}`] },
          },
        })),
      };
    }
    const m = url.match(/-home-\/([^/]+)\/(metadata|textContent|parents)/);
    const id = m ? decodeURIComponent(m[1]) : '';
    const kind = m ? m[2] : '';
    if (kind === 'metadata') return { json: { node: makeNode(id, `Titel ${id}`) } };
    if (kind === 'textContent') return { json: { content: `Volltext von ${id}` } };
    if (kind === 'parents') return { json: { nodes: [] } };   // as live, for a ccm:io
    return { status: 404, json: {} };
  });
}

test('includeParents finds the collections a MATERIAL is filed in', async () => {
  const mock = installContentNodeMock();
  const client = await connectedClient();
  try {
    const text = toolText(await client.callTool({
      name: 'get_node_details', arguments: { nodeId: 'n1', includeParents: true },
    }));
    assert.match(text, /Sammlung 1/);
    assert.match(text, /Sammlung 2/);
    assert.doesNotMatch(text, /Keine Eltern-Sammlungen/, 'the old answer was a false statement');
  } finally {
    await client.close();
    mock.restore();
  }
});

test('a material in no collection says exactly that, and it is true', async () => {
  const mock = installContentNodeMock({ usages: 0 });
  const client = await connectedClient();
  try {
    const text = toolText(await client.callTool({
      name: 'get_node_details', arguments: { nodeId: 'n1', includeParents: true },
    }));
    assert.match(text, /keiner Sammlung|Keine Eltern-Sammlungen/i);
  } finally {
    await client.close();
    mock.restore();
  }
});

test('when the lookup fails, includeParents says so instead of claiming emptiness', async () => {
  // "We could not find out" must not reach the user as "it is in none".
  const mock = installContentNodeMock({ usageStatus: 500 });
  const client = await connectedClient();
  try {
    const text = toolText(await client.callTool({
      name: 'get_node_details', arguments: { nodeId: 'n1', includeParents: true },
    }));
    assert.match(text, /nicht ermittel|nicht bestimm|unklar/i);
    assert.doesNotMatch(text, /Keine Eltern-Sammlungen gefunden/);
  } finally {
    await client.close();
    mock.restore();
  }
});

test('includeParents in JSON reports the same collections', async () => {
  const mock = installContentNodeMock();
  const client = await connectedClient();
  try {
    const payload = JSON.parse(toolText(await client.callTool({
      name: 'get_node_details', arguments: { nodeId: 'n1', includeParents: true, outputFormat: 'json' },
    })));
    assert.equal(payload.parents.length, 2);
    assert.equal(payload.parents[0].nodeId, 'coll-1');
    assert.equal(payload.parents[0].title, 'Sammlung 1');
  } finally {
    await client.close();
    mock.restore();
  }
});

/** A node carrying a raw URI in every vocabulary field includeRaw covers. */
function installRawMock() {
  return installFetchMock((url) => {
    if (url.includes('/usage/v1/')) return { json: [] };
    if (url.includes('/metadata')) {
      const id = /-home-\/([^/]+)\/metadata/.exec(url)?.[1] ?? '';
      return {
        json: {
          node: makeNode(decodeURIComponent(id), 'Ein Material', {
            'ccm:taxonid': ['http://w3id.org/openeduhub/vocabs/discipline/380'],
            'ccm:educationalcontext': ['http://w3id.org/openeduhub/vocabs/educationalContext/sekundarstufe_1'],
            'ccm:educationalintendedenduserrole': ['http://w3id.org/openeduhub/vocabs/intendedEndUserRole/teacher'],
            'ccm:oeh_lrt_aggregated': ['http://w3id.org/openeduhub/vocabs/new_lrt_aggregated/material'],
            'ccm:commonlicense_key': ['CC_BY'],
          }),
        },
      };
    }
    return { status: 404, json: {} };
  });
}

test('includeRaw returns the same five fields in markdown as in JSON', async () => {
  // They disagreed: JSON carried five, markdown three. A caller who switched
  // output format silently lost the target group and the resource type.
  const mock = installRawMock();
  const client = await connectedClient();
  try {
    const md = toolText(await client.callTool({
      name: 'get_node_details', arguments: { nodeId: 'n1', includeRaw: true },
    }));
    const json = JSON.parse(toolText(await client.callTool({
      name: 'get_node_details', arguments: { nodeId: 'n1', includeRaw: true, outputFormat: 'json' },
    })));

    assert.deepEqual(Object.keys(json.raw).sort(), [
      'disciplines', 'educationalContexts', 'learningResourceTypes', 'license', 'userRoles',
    ]);
    for (const uri of [
      'discipline/380', 'educationalContext/sekundarstufe_1',
      'intendedEndUserRole/teacher', 'new_lrt_aggregated/material',
    ]) {
      assert.match(md, new RegExp(uri.replace('/', '\\/')), `${uri} is missing from the markdown`);
    }
    assert.match(md, /CC_BY/);
  } finally {
    await client.close();
    mock.restore();
  }
});

test('the includeRaw description names the fields it actually delivers', async () => {
  // It promised "the original ccm:* / cclom:* property URIs" and delivers five
  // vocabulary fields plus the licence key. A description broader than the
  // behaviour sends a caller looking for values that never arrive.
  const client = await connectedClient();
  try {
    const tool = (await client.listTools()).tools.find(t => t.name === 'get_node_details');
    assert.ok(tool);
    const text = tool.description ?? '';
    assert.match(text, /ccm:taxonid/);
    assert.match(text, /ccm:oeh_lrt_aggregated/);
    assert.match(text, /ccm:commonlicense_key/);
    assert.doesNotMatch(text, /the original ccm:\* \/ cclom:\* property URIs/);
  } finally {
    await client.close();
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
