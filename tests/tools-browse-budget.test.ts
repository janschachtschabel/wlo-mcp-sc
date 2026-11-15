import { test } from 'node:test';
import assert from 'node:assert/strict';

import { connectedClient, installFetchMock, makeNode, toolText } from './fetchMock.js';

/**
 * A depth-2 tree fetched up to 30 grand-children per node, unbounded in total:
 * a 15-node portal could return hundreds of nodes, and `includeContentPreview`
 * then issued one upstream call per node (measured 11.7 s / 460 kB for a
 * 97-node tree). The tree is now bounded to a node budget AND says so, so the
 * model can offer a deliberate drill-down instead of silently seeing a slice.
 */

function installWideMock(level1: number, childrenPer: number) {
  return installFetchMock((url) => {
    const m = /nodes\/-home-\/([^/?]+)\/children/.exec(url);
    if (!m) return { json: {} };
    const parent = m[1];
    const isLevel1Parent = parent.startsWith('lvl1-');
    const n = isLevel1Parent ? childrenPer : level1;
    const prefix = isLevel1Parent ? `lvl2-${parent}` : 'lvl1';
    return { json: {
      nodes: Array.from({ length: n }, (_, i) => makeNode(`${prefix}-${i}`, `${prefix} ${String(i).padStart(2, '0')}`)),
    } };
  });
}

function parse(result: unknown): { total: number; truncated?: boolean; results: Array<{ nodeId: string; hasMoreChildren?: boolean; children?: unknown[] }> } {
  const text = (result as { content: Array<{ text: string }> }).content[0]?.text ?? '';
  return JSON.parse(text);
}

test('browse_collection_tree depth=2: caps children per node and flags that more exist', async () => {
  const mock = installWideMock(15, 30);
  const client = await connectedClient();
  try {
    const res = await client.callTool({
      name: 'browse_collection_tree',
      arguments: { nodeId: 'root', depth: 2, outputFormat: 'json' },
    });
    const out = parse(res);
    assert.equal(out.results.length, 15, 'level 1 is untouched');
    for (const n of out.results) {
      assert.ok((n.children?.length ?? 0) <= 10, `each node shows at most ten children, saw ${n.children?.length}`);
      assert.equal(n.hasMoreChildren, true, 'a node with 30 children must disclose the cut');
    }
    assert.equal(out.truncated, true, 'the envelope discloses the cut too');
  } finally {
    await client.close();
    mock.restore();
  }
});

test('browse_collection_tree depth=2: a wide level 1 shrinks the per-node slice to stay within budget', async () => {
  // 50 parents × 10 would be 500 nodes; the budget narrows the slice instead.
  const mock = installWideMock(50, 30);
  const client = await connectedClient();
  try {
    const res = await client.callTool({
      name: 'browse_collection_tree',
      arguments: { nodeId: 'root', depth: 2, maxResults: 50, outputFormat: 'json' },
    });
    const out = parse(res);
    const totalNodes = out.results.length + out.results.reduce((s, n) => s + (n.children?.length ?? 0), 0);
    assert.ok(totalNodes <= 200, `the whole tree stays bounded, saw ${totalNodes} nodes`);
    // Deterministic: every parent gets the SAME slice size, none is starved.
    const sizes = new Set(out.results.map(n => n.children?.length ?? 0));
    assert.equal(sizes.size, 1, `every parent gets an equal slice, saw ${[...sizes].join(',')}`);
  } finally {
    await client.close();
    mock.restore();
  }
});

test('browse_collection_tree: a node with few children is not flagged', async () => {
  const mock = installWideMock(3, 2);
  const client = await connectedClient();
  try {
    const res = await client.callTool({
      name: 'browse_collection_tree',
      arguments: { nodeId: 'root', depth: 2, outputFormat: 'json' },
    });
    const out = parse(res);
    assert.equal(out.truncated, false);
    for (const n of out.results) assert.equal(n.hasMoreChildren, undefined);
  } finally {
    await client.close();
    mock.restore();
  }
});

test('browse_collection_tree markdown: names the follow-up call for a truncated node', async () => {
  const mock = installWideMock(2, 30);
  const client = await connectedClient();
  try {
    const res = await client.callTool({
      name: 'browse_collection_tree',
      arguments: { nodeId: 'root', depth: 2, outputFormat: 'markdown' },
    });
    const text = toolText(res);
    assert.match(text, /weitere Unterthemen/i, 'says that more exist');
    assert.match(text, /browse_collection_tree/, 'names the tool to call for the rest');
    assert.match(text, /lvl1-0/, 'names the nodeId to drill into');
  } finally {
    await client.close();
    mock.restore();
  }
});
