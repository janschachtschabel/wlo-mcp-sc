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
    // FLIPPED 2026-08-20: the JSON detail shipped the FULL property while the
    // markdown side previewed 500 chars — the format asymmetry this project
    // hunts elsewhere, and a 37k text in every detail answer. The signal stays;
    // the text is get_compendium_text's job.
    assert.equal(payload.hasCompendium, true);
    assert.equal(payload.compendiumText, undefined);
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
    const bare = JSON.parse(toolText(jsonRes as any));
    assert.equal('compendiumText' in bare, false);
    assert.equal('hasCompendium' in bare, false, 'no compendium, no signal');

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

test('get_nodes_details (plural): results carry the compendium signal when present', async () => {
  const mock = installCompendiumMock('Kompendium Text');
  const client = await connectedClient();
  try {
    const result = await client.callTool({
      name: 'get_nodes_details',
      arguments: { nodeIds: ['c1'] },
    });
    const payload = JSON.parse(toolText(result as any));
    assert.equal(payload.results.c1.hasCompendium, true);
    assert.equal(payload.results.c1.compendiumText, undefined);
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

test('get_node_details: the detail view of a reference names the original', async () => {
  // The likeliest place a reference id is pasted: a collection listing hands out
  // nothing else, and this is the tool you call next to find out what it is.
  //
  // It builds its own `nodeId:` line rather than going through `renderToText`,
  // so it was missed when the shared rule was introduced — the rendered text
  // said nothing while `structuredContent` carried `originalId` all along.
  const mock = installFetchMock((url) => {
    const id = decodeURIComponent(url.match(/-home-\/([^/]+)\/metadata/)?.[1] ?? '');
    return { json: { node: { ...makeNode(id, `Titel ${id}`), originalId: 'original-1' } } };
  });
  const client = await connectedClient();
  try {
    const result = await client.callTool({ name: 'get_node_details', arguments: { nodeId: 'ref-1' } });
    assert.match(toolText(result), /nodeId: ref-1 \(Verkn(ü|ue)pfung; Original: original-1\)/);
  } finally {
    await client.close();
    mock.restore();
  }
});

test('get_node_details: a record that is not a reference keeps the plain nodeId line', async () => {
  const mock = installNodeMock();
  const client = await connectedClient();
  try {
    const result = await client.callTool({ name: 'get_node_details', arguments: { nodeId: 'n1' } });
    const text = toolText(result);
    assert.match(text, /nodeId: n1\n/);
    assert.doesNotMatch(text, /Original:/);
  } finally {
    await client.close();
    mock.restore();
  }
});

/** A record carrying all three access fields, labelled the way the repository does. */
const ACCESS_PROPS = {
  'ccm:conditionsOfAccess': ['http://w3id.org/openeduhub/vocabs/conditionsOfAccess/no_login'],
  'ccm:conditionsOfAccess_DISPLAYNAME': ['ohne Anmeldung'],
  'ccm:price': ['http://w3id.org/openeduhub/vocabs/price/yes_for_additional'],
  'ccm:price_DISPLAYNAME': ['zusätzliche Inhalte / Features per Kauf möglich'],
  // Deliberately WITHOUT a `_DISPLAYNAME`, because that is the measured reality
  // (2026-08-18): the metadata set declares the star scale for this field while
  // the corpus stores `containsAdvertisement/yes|no`, so the repository sends no
  // label. This is the only fixture entry that exercises `VOCAB_FALLBACK`
  // through a tool rather than through the unit test.
  'ccm:containsAdvertisement': ['http://w3id.org/openeduhub/vocabs/containsAdvertisement/yes'],
  'ccm:accessibilitySummary': ['http://w3id.org/openeduhub/vocabs/accessibilitySummary/aa'],
  'ccm:accessibilitySummary_DISPLAYNAME': ['AA (mittel)'],
  'ccm:license_oer': ['http://w3id.org/openeduhub/vocabs/oer/0'],
  'ccm:license_oer_DISPLAYNAME': ['alles OER'],
};

function installAccessMock() {
  return installFetchMock((url) => {
    const id = decodeURIComponent(url.match(/-home-\/([^/]+)\/metadata/)?.[1] ?? '');
    return { json: { node: makeNode(id, `Titel ${id}`, ACCESS_PROPS) } };
  });
}

test('get_node_details: includeAccessInfo adds all five fields', async () => {
  const mock = installAccessMock();
  const client = await connectedClient();
  try {
    const result = await client.callTool({
      name: 'get_node_details',
      arguments: { nodeId: 'n1', includeAccessInfo: true },
    });
    const text = toolText(result);
    assert.match(text, /Zugang: ohne Anmeldung/);
    assert.match(text, /Kosten: zusätzliche Inhalte \/ Features per Kauf möglich/);
    // From the local table, not from the repository — the fixture sends no
    // `_DISPLAYNAME` for this field.
    assert.match(text, /Werbung: Ja/);
    assert.match(text, /Barrierefreiheit: AA \(mittel\)/);
    assert.match(text, /OER-Status: alles OER/);
  } finally {
    await client.close();
    mock.restore();
  }
});

test('get_node_details: without the flag the answer carries none of it', async () => {
  // The assurance the plan asks for: an existing caller's output does not grow.
  // The properties are in the response either way — `readNodeMetadata` reads
  // `-all-` — so nothing but the flag keeps them out.
  const mock = installAccessMock();
  const client = await connectedClient();
  try {
    const result = await client.callTool({ name: 'get_node_details', arguments: { nodeId: 'n1' } });
    const text = toolText(result);
    for (const label of ['Zugang:', 'Kosten:', 'Werbung:', 'Barrierefreiheit:', 'OER-Status:']) {
      assert.ok(!text.includes(label), `"${label}" darf ohne includeAccessInfo nicht erscheinen`);
    }
  } finally {
    await client.close();
    mock.restore();
  }
});

test('get_node_details: the JSON format carries the same five values', async () => {
  const mock = installAccessMock();
  const client = await connectedClient();
  try {
    const result = await client.callTool({
      name: 'get_node_details',
      arguments: { nodeId: 'n1', includeAccessInfo: true, outputFormat: 'json' },
    });
    const payload = JSON.parse(toolText(result));
    assert.deepEqual(payload.accessInfo, {
      conditionsOfAccess: 'ohne Anmeldung',
      price: 'zusätzliche Inhalte / Features per Kauf möglich',
      advertising: 'Ja',
      accessibility: ['AA (mittel)'],
      oerStatus: 'alles OER',
    });
  } finally {
    await client.close();
    mock.restore();
  }
});

test('get_nodes_details: includeAccessInfo enriches every node of the batch', async () => {
  const mock = installAccessMock();
  const client = await connectedClient();
  try {
    const result = await client.callTool({
      name: 'get_nodes_details',
      arguments: { nodeIds: ['n1', 'n2'], includeAccessInfo: true },
    });
    const payload = JSON.parse(toolText(result));
    assert.equal(payload.results.n1.accessInfo.conditionsOfAccess, 'ohne Anmeldung');
    assert.equal(payload.results.n2.accessInfo.oerStatus, 'alles OER');
    assert.equal(payload.results.n1.accessInfo.accessibility[0], 'AA (mittel)');
    assert.equal(payload.results.n1.accessInfo.price, 'zusätzliche Inhalte / Features per Kauf möglich');
    // The batch tool loads through `getNodeMetadata`, not `readNodeMetadata`:
    // a projection that dropped this field would leave the unit test green.
    assert.equal(payload.results.n2.accessInfo.advertising, 'Ja');
  } finally {
    await client.close();
    mock.restore();
  }
});

test('get_nodes_details: without the flag no node carries accessInfo', async () => {
  const mock = installAccessMock();
  const client = await connectedClient();
  try {
    const result = await client.callTool({ name: 'get_nodes_details', arguments: { nodeIds: ['n1'] } });
    assert.equal(JSON.parse(toolText(result)).results.n1.accessInfo, undefined);
  } finally {
    await client.close();
    mock.restore();
  }
});

test('get_node_details states the restriction of an isPublic:false record', async () => {
  // The record inspection tool is where an editor decides whether to SHARE a
  // hit — recommending a record students cannot open is the mistake this line
  // prevents. Same sentence as the search lists (one exported constant).
  const mock = installFetchMock((url) => {
    if (url.includes('/metadata') && url.includes('locked-1')) {
      return { json: { node: { ...makeNode('locked-1', 'SUPRA Einheit 1'), isPublic: false } } };
    }
    return { json: {} };
  });
  const client = await connectedClient();
  try {
    const result = await client.callTool({ name: 'get_node_details', arguments: { nodeId: 'locked-1' } });
    const text = (result.content as Array<{ type: string; text: string }>)[0]?.text ?? '';
    assert.match(text, /nicht öffentlich/);
  } finally {
    await client.close();
    mock.restore();
  }
});
