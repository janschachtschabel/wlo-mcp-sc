import { test } from 'node:test';
import assert from 'node:assert/strict';

import { assertRejectsWithoutUpstream, connectedClient, installFetchMock, makeNode } from './fetchMock.js';
import { contentTextSchema } from '../src/apps/outputSchemas.js';
import { renderReading } from '../src/apps/widgets/reading/render.js';

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
    await assertRejectsWithoutUpstream(
      client,
      'get_compendium_text',
      { nodeIds: tooMany },
      'expected 26 nodeIds to be rejected',
    );
  } finally {
    await client.close();
  }
});

// ── Rendering in the reading view (audit finding 2026-07-30) ────────────────
// The reading widget was built for "material full text OR editorial compendium
// prose" (its own header), yet the compendium tool returned neither
// structuredContent nor a widget — the one tool whose output IS long prose was
// the one that never rendered it.

test('one collection yields a reading payload the widget renders with its actions', async () => {
  const mock = metadataMock();
  const client = await connectedClient();
  try {
    const r = await client.callTool({ name: 'get_compendium_text', arguments: { nodeId: 'coll-1' } });
    const sc = contentTextSchema.parse(r.structuredContent);
    assert.equal(sc.nodeId, 'coll-1', 'the id travels, so the follow-up buttons have something to name');
    assert.match(sc.text, /Licht und Sehen/);
    const html = renderReading(sc as never, 'de', { canFollowUp: true });
    assert.doesNotMatch(html, /wlo-empty/, 'the reading view is not empty');
    assert.match(html, /wlo-reading__action/, 'and offers summarize / simplify / exercises');
  } finally { await client.close(); mock.restore(); }
});

test('a bulk fetch keeps every text and drops the per-node actions', async () => {
  // "Fasse DIESEN Inhalt zusammen" is ambiguous across several collections, so
  // the payload carries no nodeId — which is exactly what gates the buttons off.
  const mock = installFetchMock((url) => {
    const id = /coll-\d/.exec(url)?.[0];
    if (url.includes('/metadata') && id) {
      return { json: { node: makeNode(id, `Sammlung ${id}`, {
        'ccm:oeh_collection_compendium_text': [`Prosa zu ${id}.`],
      }) } };
    }
    return { json: {} };
  });
  const client = await connectedClient();
  try {
    const r = await client.callTool({ name: 'get_compendium_text', arguments: { nodeIds: ['coll-1', 'coll-2'] } });
    const sc = contentTextSchema.parse(r.structuredContent);
    assert.equal(sc.nodeId, '', 'no single node owns a bulk answer');
    assert.match(sc.text, /Prosa zu coll-1/);
    assert.match(sc.text, /Prosa zu coll-2/);
    assert.equal(sc.text, (r.content as Array<{ text: string }>)[0]?.text, 'payload and text output agree');
    const html = renderReading(sc as never, 'de', { canFollowUp: true });
    assert.doesNotMatch(html, /wlo-reading__action/, 'no per-node action on a bulk answer');
  } finally { await client.close(); mock.restore(); }
});
