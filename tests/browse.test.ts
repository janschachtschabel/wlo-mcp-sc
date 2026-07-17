import { test } from 'node:test';
import assert from 'node:assert/strict';

import { matchSubjectPortal } from '../src/tools/browse.js';
import { WLO_ROOT_COLLECTION_ID } from '../src/wlo-api.js';
import { connectedClient, installFetchMock, makeNode, toolText } from './fetchMock.js';

const PORTALS = [
  makeNode('math-portal', 'Mathematik'),
  makeNode('info-portal', 'Informatik'),
  makeNode('deutsch-portal', 'Deutsch'),
];

// ── Pure matcher (no network) ──────────────────────────────────────────
test('matchSubjectPortal: exact, case-insensitive title match', () => {
  assert.equal(matchSubjectPortal(PORTALS, 'Informatik')?.ref?.id, 'info-portal');
  assert.equal(matchSubjectPortal(PORTALS, 'informatik')?.ref?.id, 'info-portal');
});

test('matchSubjectPortal: prefix match resolves an abbreviation', () => {
  assert.equal(matchSubjectPortal(PORTALS, 'Mathe')?.ref?.id, 'math-portal');
});

test('matchSubjectPortal: no match and empty input return null', () => {
  assert.equal(matchSubjectPortal(PORTALS, 'Biologie'), null);
  assert.equal(matchSubjectPortal(PORTALS, '   '), null);
});

// ── Integration through the tool (fetch-mocked) ────────────────────────
function installBrowseMock() {
  return installFetchMock((url) => {
    const m = url.match(/-home-\/([^/]+)\/children/);
    const id = m ? decodeURIComponent(m[1]) : '';
    if (id === WLO_ROOT_COLLECTION_ID) return { json: { nodes: PORTALS } };
    if (id === 'math-portal') return { json: { nodes: [makeNode('algebra', 'Algebra')] } };
    return { json: { nodes: [] } };
  });
}

test('browse_collection_tree: resolves a subject NAME to its portal and drills in', async () => {
  const mock = installBrowseMock();
  const client = await connectedClient();
  try {
    const result = await client.callTool({
      name: 'browse_collection_tree',
      arguments: { subject: 'Mathe', outputFormat: 'json' },
    });
    const payload = JSON.parse(toolText(result as any));
    assert.equal(payload.parent, 'math-portal');
    assert.equal(payload.results[0].nodeId, 'algebra');
  } finally {
    await client.close();
    mock.restore();
  }
});

test('browse_collection_tree: includeContentPreview attaches the first N content items per sub-collection', async () => {
  const mock = installFetchMock((url) => {
    const m = url.match(/-home-\/([^/]+)\/children/);
    const id = m ? decodeURIComponent(m[1]) : '';
    const isFiles = url.includes('filter=files');
    if (id === 'math-portal' && !isFiles) return { json: { nodes: [makeNode('algebra', 'Algebra')] } };
    if (id === 'algebra' && isFiles) return { json: {
      nodes: [makeNode('f1', 'Arbeitsblatt 1'), makeNode('f2', 'Arbeitsblatt 2'), makeNode('f3', 'Arbeitsblatt 3')],
      pagination: { total: 3, from: 0, count: 3 },
    } };
    return { json: { nodes: [] } };
  });
  const client = await connectedClient();
  try {
    const result = await client.callTool({
      name: 'browse_collection_tree',
      arguments: { nodeId: 'math-portal', includeContentPreview: 2, outputFormat: 'json' },
    });
    const payload = JSON.parse(toolText(result as any));
    assert.equal(payload.results[0].nodeId, 'algebra');
    assert.equal(payload.results[0].contentPreview.length, 2); // capped at N=2
    assert.deepEqual(payload.results[0].contentPreview.map((n: { title: string }) => n.title), ['Arbeitsblatt 1', 'Arbeitsblatt 2']);
  } finally {
    await client.close();
    mock.restore();
  }
});

test('browse_collection_tree: without includeContentPreview, no contentPreview and no file fetch', async () => {
  const mock = installFetchMock((url) => {
    const m = url.match(/-home-\/([^/]+)\/children/);
    const id = m ? decodeURIComponent(m[1]) : '';
    if (id === 'math-portal') return { json: { nodes: [makeNode('algebra', 'Algebra')] } };
    return { json: { nodes: [] } };
  });
  const client = await connectedClient();
  try {
    const result = await client.callTool({
      name: 'browse_collection_tree',
      arguments: { nodeId: 'math-portal', outputFormat: 'json' },
    });
    const payload = JSON.parse(toolText(result as any));
    assert.equal(payload.results[0].contentPreview, undefined);
    assert.ok(!mock.calls.some(c => c.url.includes('filter=files')));
  } finally {
    await client.close();
    mock.restore();
  }
});

test('browse_collection_tree: depth=2 stops at grandchildren and does not walk deeper', async () => {
  // L1 → L2 → L3. At depth=2 the tree includes L1 and its child L2 but must
  // NOT fetch or include L3 (the pre-fix bug recursed the whole subtree because
  // the depth check was a closure constant, never decremented).
  const mock = installFetchMock((url) => {
    const m = url.match(/-home-\/([^/]+)\/children/);
    const id = m ? decodeURIComponent(m[1]) : '';
    if (id === 'root') return { json: { nodes: [makeNode('L1', 'Level 1')] } };
    if (id === 'L1') return { json: { nodes: [makeNode('L2', 'Level 2')] } };
    if (id === 'L2') return { json: { nodes: [makeNode('L3', 'Level 3')] } };
    return { json: { nodes: [] } };
  });
  const client = await connectedClient();
  try {
    const result = await client.callTool({
      name: 'browse_collection_tree',
      arguments: { nodeId: 'root', depth: 2, outputFormat: 'json' },
    });
    const payload = JSON.parse(toolText(result as any));
    assert.equal(payload.results[0].nodeId, 'L1');
    assert.equal(payload.results[0].children[0].nodeId, 'L2');
    const l2 = payload.results[0].children[0];
    assert.ok(!l2.children || l2.children.length === 0, 'L2 must be a leaf at depth=2 (no L3)');
    assert.ok(!mock.calls.some(c => c.url.includes('/L2/children')), 'L2 children must not be fetched at depth=2');
  } finally {
    await client.close();
    mock.restore();
  }
});

test('browse_collection_tree: neither nodeId nor subject is a validation error', async () => {
  const client = await connectedClient();
  try {
    const result = await client.callTool({ name: 'browse_collection_tree', arguments: {} });
    assert.equal((result as any).isError, true);
    assert.match(toolText(result as any), /nodeId oder subject/);
  } finally {
    await client.close();
  }
});

test('browse_collection_tree: unknown subject errors with the list of available subjects', async () => {
  const mock = installBrowseMock();
  const client = await connectedClient();
  try {
    const result = await client.callTool({
      name: 'browse_collection_tree',
      arguments: { subject: 'Zauberei' },
    });
    assert.equal((result as any).isError, true);
    const text = toolText(result as any);
    assert.match(text, /Mathematik/);
    assert.match(text, /Informatik/);
  } finally {
    await client.close();
    mock.restore();
  }
});
