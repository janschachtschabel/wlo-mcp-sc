import { test } from 'node:test';
import assert from 'node:assert/strict';

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

import { registerSkillsTool } from '../src/tools/skills.js';
import { applyReadOnlyToolDefaults } from '../src/apps/tool-defaults.js';
import { connectedClient, installFetchMock, makeNode, toolText, type MockResult } from './fetchMock.js';

/**
 * A server with the skills tool registered for an explicit collection — the
 * shape an operator who configured `WLO_SKILLS_COLLECTION_ID` gets. The tool now
 * takes the collection as an argument instead of reading the module constant, so
 * a test can exercise the configured case without touching the environment.
 */
async function configuredClient(collectionId = 'skills-coll'): Promise<Client> {
  const server = new McpServer({ name: 'test', version: '0.0.0' });
  applyReadOnlyToolDefaults(server);
  registerSkillsTool(server, collectionId);
  const [ct, st] = InMemoryTransport.createLinkedPair();
  const c = new Client({ name: 'test-client', version: '0.0.0' });
  await Promise.all([server.connect(st), c.connect(ct)]);
  return c;
}

function skillNode(id: string, title: string, desc: string) {
  return {
    ...makeNode(id, title, { 'cclom:general_description': [desc] }),
    downloadUrl: `https://redaktion.openeduhub.net/edu-sharing/eduservlet/download?nodeId=${id}`,
  };
}

function skillsMock() {
  return installFetchMock((url): MockResult => {
    if (url.includes('/children')) {
      return { json: { nodes: [
        skillNode('s-search', 'WLO Search', 'Find OER content and summarise it.'),
        skillNode('s-topic', 'WLO Topic Launcher', 'Guide a learner into a topic page.'),
      ], pagination: { total: 2, from: 0, count: 2 } } };
    }
    if (url.includes('/eduservlet/download')) {
      const id = new URL(url).searchParams.get('nodeId');
      return { text: `# Skill ${id}\nApply these instructions for ${id}.` };
    }
    return { json: {} };
  });
}

test('find_wlo_skills: markdown lists matching skills with their raw instructions', async () => {
  const mock = skillsMock();
  const client = await configuredClient();
  try {
    const result = await client.callTool({ name: 'find_wlo_skills', arguments: { nodeId: 'skills-coll', query: 'search' } });
    const text = toolText(result);
    assert.match(text, /WLO Search/);
    assert.match(text, /Find OER content/);
    assert.match(text, /Apply these instructions for s-search/, 'raw skill markdown is included');
  } finally {
    await client.close();
    mock.restore();
  }
});

test('find_wlo_skills: json output returns the skills array with content', async () => {
  const mock = skillsMock();
  const client = await configuredClient();
  try {
    const result = await client.callTool({ name: 'find_wlo_skills', arguments: { nodeId: 'skills-coll', outputFormat: 'json' } });
    const parsed = JSON.parse(toolText(result));
    assert.equal(parsed.skills.length, 2);
    assert.ok(parsed.skills.every((s: { content?: string }) => typeof s.content === 'string'));
  } finally {
    await client.close();
    mock.restore();
  }
});

test('find_wlo_skills is ABSENT when no skills collection is configured', async () => {
  // It used to be listed and then fail on every call with "set
  // WLO_SKILLS_COLLECTION_ID" — a message aimed at the operator, delivered to a
  // model that cannot act on it and has no way to guess a valid nodeId. A
  // capability that cannot work is better withheld than advertised, the same
  // reasoning the write tools follow in anonymous mode.
  const client = await connectedClient();
  try {
    const names = (await client.listTools()).tools.map(t => t.name);
    assert.ok(!names.includes('find_wlo_skills'));
  } finally {
    await client.close();
  }
});

test('find_wlo_skills is offered once a collection IS configured', async () => {
  const client = await configuredClient();
  try {
    const names = (await client.listTools()).tools.map(t => t.name);
    assert.ok(names.includes('find_wlo_skills'), 'otherwise the gate would hide it always');
  } finally {
    await client.close();
  }
});

test('find_wlo_skills uses the configured collection when no nodeId is given', async () => {
  const mock = skillsMock();
  const client = await configuredClient('konfigurierte-sammlung');
  try {
    const parsed = JSON.parse(toolText(await client.callTool({
      name: 'find_wlo_skills', arguments: { outputFormat: 'json' },
    })));
    assert.equal(parsed.collectionId, 'konfigurierte-sammlung');
    assert.ok(mock.calls.some(c => c.url.includes('konfigurierte-sammlung')));
  } finally {
    await client.close();
    mock.restore();
  }
});
