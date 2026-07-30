import { test } from 'node:test';
import assert from 'node:assert/strict';

import { connectedClient, makeNode } from './fetchMock.js';

/**
 * `browse_collection_tree` at depth 2 costs one `/children` call per level-1
 * node — level-2 nodes do not recurse, and without `includeContentCounts` they
 * issue no calls at all. That fan-out ran at a width of 5, i.e. four sequential
 * waves for a 20-child portal (~2.9 s measured). Widening it does NOT multiply
 * with the nested pool in the default case; only the opt-in count path nests,
 * which is why the two widths are separate constants.
 */

function installProbe(childrenPerNode: number) {
  const real = globalThis.fetch;
  let inFlight = 0;
  let maxInFlight = 0;
  const calls: string[] = [];
  globalThis.fetch = (async (input: unknown) => {
    const url = typeof input === 'string' ? input : String((input as { url?: string })?.url ?? input);
    calls.push(url);
    inFlight++;
    maxInFlight = Math.max(maxInFlight, inFlight);
    await new Promise(r => setImmediate(r));
    await new Promise(r => setImmediate(r));
    inFlight--;
    const m = /nodes\/-home-\/([^/]+)\/children/.exec(url);
    const parent = m?.[1] ?? 'root';
    const n = parent.startsWith('lvl1-') ? childrenPerNode : 20;
    const prefix = parent.startsWith('lvl1-') ? 'lvl2' : 'lvl1';
    return new Response(JSON.stringify({
      nodes: Array.from({ length: n }, (_, i) => makeNode(`${prefix}-${parent}-${i}`, `${prefix} ${i}`)),
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }) as typeof fetch;
  return {
    get maxInFlight() { return maxInFlight; },
    get childrenCalls() { return calls.filter(u => u.includes('/children')).length; },
    restore: () => { globalThis.fetch = real; },
  };
}

test('browse_collection_tree depth=2: fans out level-1 children wider than five at a time', async () => {
  const probe = installProbe(3);
  const client = await connectedClient();
  try {
    await client.callTool({
      name: 'browse_collection_tree',
      arguments: { nodeId: 'root', depth: 2, outputFormat: 'json' },
    });
    assert.ok(probe.maxInFlight > 5, `expected a wider fan-out than the old cap of 5, saw ${probe.maxInFlight}`);
    // 1 call for the parent's own children + exactly one per level-1 node.
    assert.equal(probe.childrenCalls, 21, 'depth 2 must not add calls for level-2 nodes');
  } finally {
    await client.close();
    probe.restore();
  }
});

test('browse_collection_tree depth=1: still a single upstream call', async () => {
  const probe = installProbe(3);
  const client = await connectedClient();
  try {
    await client.callTool({
      name: 'browse_collection_tree',
      arguments: { nodeId: 'root', depth: 1, outputFormat: 'json' },
    });
    assert.equal(probe.childrenCalls, 1);
  } finally {
    await client.close();
    probe.restore();
  }
});
