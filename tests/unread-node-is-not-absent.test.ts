/**
 * A node that could not be READ is not a node that is absent, and not a node
 * without the thing asked for. `getNodeMetadata` answers `null` for a 404, a
 * 403 and a 503 alike; four surfaces turned that `null` into a negative.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { connectedClient, installFetchMock, makeNode, toolText, type MockResult } from './fetchMock.js';
import { getCompendiumTexts } from '../src/services/compendium.js';
import { getContentText } from '../src/services/content-text.js';
import { getRelatedContent } from '../src/services/related.js';
import { getTopicPageContent } from '../src/topic-page-structure.js';

/** Every metadata read answers `status`; nothing else is expected to matter. */
function metadataAnswers(status: number, other: (url: string) => MockResult = () => ({ json: {} })) {
  return installFetchMock((url) => (url.includes('/metadata') ? { status, json: {} } : other(url)));
}

type Structured = { missing?: { part: string; code: string }[]; results?: unknown[] };

// ── get_related_content ──────────────────────────────────────────────────

for (const [status, code, says, saysNot] of [
  [503, 'upstream_busy', /derzeit nicht abrufbar/, /nicht gefunden/],
  [500, 'upstream_error', /derzeit nicht abrufbar/, /nicht gefunden/],
  [403, 'forbidden', /nicht zugänglich/, /nicht gefunden/],
  [401, 'forbidden', /nicht zugelassen/, /nicht gefunden/],
  [404, 'not_found', /nicht gefunden/, /derzeit nicht abrufbar/],
] as const) {
  test(`get_related_content: a seed answered ${status} is reported as ${code}`, async () => {
    const mock = metadataAnswers(status);
    const client = await connectedClient();
    try {
      const result = await client.callTool({ name: 'get_related_content', arguments: { nodeId: 'seed-1' } });
      const text = toolText(result);
      assert.match(text, says);
      assert.doesNotMatch(text, saysNot);
      const structured = result.structuredContent as Structured;
      assert.deepEqual(structured.missing, [{ part: 'seed-1', code }]);
      assert.deepEqual(structured.results, []);
    } finally { await client.close(); mock.restore(); }
  });
}

test('getRelatedContent: the service hands the status on instead of a bare null', async () => {
  const mock = metadataAnswers(503);
  try {
    assert.deepEqual(await getRelatedContent({ nodeId: 'seed-1' }), { seedStatus: 503 });
  } finally { mock.restore(); }
});

// ── siblings that could not be listed (R8) ───────────────────────────────

function seedWithParent(childrenStatus: number) {
  return installFetchMock((url) => {
    if (url.includes('/metadata')) {
      return { json: { node: makeNode('seed', 'Seed', { 'virtual:primaryparent_nodeid': ['parent-1'] }) } };
    }
    if (url.includes('/children')) return { status: childrenStatus, json: {} };
    return { json: { nodes: [], pagination: { total: 0, from: 0, count: 0 } } };
  });
}

test('get_related_content: a REFUSED sibling listing is not "no further contents"', async () => {
  const mock = seedWithParent(403);
  const client = await connectedClient();
  try {
    const result = await client.callTool({ name: 'get_related_content', arguments: { nodeId: 'seed', includeSiblings: true } });
    const text = toolText(result);
    assert.doesNotMatch(text, /Keine weiteren Inhalte in der Sammlung/);
    assert.match(text, /mit dieser Anmeldung nicht lesbar/);
    assert.equal((result.structuredContent as { siblingsRefused?: boolean }).siblingsRefused, true);

    const json = await client.callTool({ name: 'get_related_content', arguments: { nodeId: 'seed', includeSiblings: true, outputFormat: 'json' } });
    const block = JSON.parse((json.content as { text: string }[])[0]!.text) as { siblings: unknown[]; siblingsRefused?: boolean };
    assert.deepEqual(block.siblings, []);
    assert.equal(block.siblingsRefused, true);
  } finally { await client.close(); mock.restore(); }
});

test('get_related_content: a sibling listing that did not answer says so', async () => {
  const mock = seedWithParent(503);
  const client = await connectedClient();
  try {
    const result = await client.callTool({ name: 'get_related_content', arguments: { nodeId: 'seed', includeSiblings: true } });
    const text = toolText(result);
    assert.doesNotMatch(text, /Keine weiteren Inhalte in der Sammlung/);
    assert.match(text, /konnten gerade nicht gelesen werden/);
    assert.equal((result.structuredContent as { siblingsUnread?: boolean }).siblingsUnread, true);
  } finally { await client.close(); mock.restore(); }
});

test('get_related_content: an answered, empty sibling listing keeps its sentence', async () => {
  const mock = installFetchMock((url) => {
    if (url.includes('/metadata')) {
      return { json: { node: makeNode('seed', 'Seed', { 'virtual:primaryparent_nodeid': ['parent-1'] }) } };
    }
    return { json: { nodes: [], pagination: { total: 0, from: 0, count: 0 } } };
  });
  const client = await connectedClient();
  try {
    const result = await client.callTool({ name: 'get_related_content', arguments: { nodeId: 'seed', includeSiblings: true } });
    assert.match(toolText(result), /Keine weiteren Inhalte in der Sammlung\./);
    const structured = result.structuredContent as Record<string, unknown>;
    assert.equal(structured['siblingsUnread'], undefined);
    assert.equal(structured['siblingsRefused'], undefined);
  } finally { await client.close(); mock.restore(); }
});

// ── compendium ───────────────────────────────────────────────────────────

/** One collection per outcome: text, no text, 503, 403, 404. */
function compendiumMock() {
  return installFetchMock((url) => {
    if (!url.includes('/metadata')) return { json: {} };
    if (url.includes('with-text')) {
      return { json: { node: makeNode('with-text', 'Optik', { 'ccm:oeh_collection_compendium_text': ['Licht und Sehen.'] }) } };
    }
    if (url.includes('no-text')) return { json: { node: makeNode('no-text', 'Akustik') } };
    if (url.includes('busy')) return { status: 503, json: {} };
    if (url.includes('closed')) return { status: 403, json: {} };
    return { status: 404, json: {} };
  });
}
const COMPENDIUM_IDS = ['with-text', 'no-text', 'busy', 'closed', 'gone'];

test('getCompendiumTexts: an entry says WHY it has no text when the node was not read', async () => {
  const mock = compendiumMock();
  try {
    const entries = await getCompendiumTexts(COMPENDIUM_IDS);
    assert.deepEqual(entries.map(e => [e.nodeId, e.compendiumText, e.unread]), [
      ['with-text', 'Licht und Sehen.', undefined],
      ['no-text', null, undefined],
      ['busy', null, 'upstream_busy'],
      ['closed', null, 'forbidden'],
      ['gone', null, 'not_found'],
    ]);
  } finally { mock.restore(); }
});

test('get_compendium_text: "no compendium text" is said only over a collection that was read', async () => {
  const mock = compendiumMock();
  const client = await connectedClient();
  try {
    const result = await client.callTool({ name: 'get_compendium_text', arguments: { nodeIds: COMPENDIUM_IDS } });
    const blocks = (result.content as { text: string }[])[0]!.text.split('\n\n---\n\n');
    assert.equal(blocks.length, 5);
    assert.match(blocks[1]!, /_Kein Kompendiumstext hinterlegt\._/);
    for (const unread of blocks.slice(2)) assert.doesNotMatch(unread, /Kein Kompendiumstext hinterlegt/);
    assert.match(blocks[2]!, /konnte gerade nicht gelesen werden/);
    assert.match(blocks[3]!, /mit dieser Anmeldung nicht lesbar/);
    assert.match(blocks[4]!, /nicht gefunden/);
    assert.deepEqual((result.structuredContent as Structured).missing, [
      { part: 'busy', code: 'upstream_busy' }, { part: 'closed', code: 'forbidden' }, { part: 'gone', code: 'not_found' },
    ]);

    const json = await client.callTool({ name: 'get_compendium_text', arguments: { nodeIds: COMPENDIUM_IDS, outputFormat: 'json' } });
    const payload = JSON.parse((json.content as { text: string }[])[0]!.text) as { entries: { nodeId: string; unread?: string }[] };
    assert.deepEqual(payload.entries.map(e => e.unread), [undefined, undefined, 'upstream_busy', 'forbidden', 'not_found']);
  } finally { await client.close(); mock.restore(); }
});

test('get_compendium_text (JSON): the text block and structuredContent are one object', async () => {
  const mock = compendiumMock();
  const client = await connectedClient();
  try {
    for (const args of [{ nodeIds: COMPENDIUM_IDS }, { nodeId: 'with-text', query: 'Licht' }]) {
      const result = await client.callTool({ name: 'get_compendium_text', arguments: { ...args, outputFormat: 'json' } });
      const fromText = JSON.parse((result.content as { text: string }[])[0]!.text) as { entries: unknown[] };
      // One answer — except the joined Markdown: `entries` holds the same prose, so the
      // block leaves `text` out and the structured answer keeps it empty (its schema requires the key).
      const { text, ...structured } = JSON.parse(JSON.stringify(result.structuredContent)) as { text: string };
      assert.equal(text, '');
      assert.deepEqual(fromText, structured);
      assert.ok(Array.isArray(fromText.entries), '`entries` stays where a client of the old block looks for it');
    }
  } finally { await client.close(); mock.restore(); }
});

test('get_compendium_text: with nothing unread the answer carries no `missing`', async () => {
  const mock = compendiumMock();
  const client = await connectedClient();
  try {
    const result = await client.callTool({ name: 'get_compendium_text', arguments: { nodeIds: ['with-text', 'no-text'] } });
    assert.equal((result.structuredContent as Structured).missing, undefined);
  } finally { await client.close(); mock.restore(); }
});

// ── topic page structure ─────────────────────────────────────────────────

for (const [status, reason] of [[503, 'source_unreachable'], [500, 'source_unreachable'], [403, 'node_not_readable'], [401, 'node_not_readable'], [404, 'node_not_found']] as const) {
  test(`getTopicPageContent: a seed answered ${status} is ${reason}`, async () => {
    const mock = metadataAnswers(status);
    try {
      assert.equal((await getTopicPageContent({ collectionId: 'coll-1' })).reason, reason);
      assert.equal((await getTopicPageContent({ collectionId: 'coll-1', variantId: 'var-1' })).reason, reason, 'the fast path too');
    } finally { mock.restore(); }
  });
}

// ── content text ─────────────────────────────────────────────────────────

const noStoredText = (url: string): MockResult => (url.includes('/textContent') ? { json: { text: null } } : { json: {} });

test('getContentText: metadata that did not answer is "could not be read", not "not found"', async () => {
  const mock = metadataAnswers(503, noStoredText);
  try {
    assert.equal((await getContentText('n-1', 1000)).reason, 'text_unreadable');
  } finally { mock.restore(); }
});

test('getContentText: refused metadata is access_denied, a 404 is node_not_found', async () => {
  let mock = metadataAnswers(403, noStoredText);
  try { assert.equal((await getContentText('n-1', 1000)).reason, 'access_denied'); } finally { mock.restore(); }
  mock = metadataAnswers(404, noStoredText);
  try { assert.equal((await getContentText('n-1', 1000)).reason, 'node_not_found'); } finally { mock.restore(); }
});
