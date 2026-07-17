import { test } from 'node:test';
import assert from 'node:assert/strict';

import { connectedClient, installFetchMock, makeNode, toolText, type MockResult } from './fetchMock.js';

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
  const client = await connectedClient();
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
  const client = await connectedClient();
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

test('find_wlo_skills: reports a clear message when no skills collection is configured', async () => {
  const client = await connectedClient();
  try {
    const result = await client.callTool({ name: 'find_wlo_skills', arguments: {} });
    assert.match(toolText(result), /WLO_SKILLS_COLLECTION_ID|Skill-Sammlung/);
  } finally {
    await client.close();
  }
});
