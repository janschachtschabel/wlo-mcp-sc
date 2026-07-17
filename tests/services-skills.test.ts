import { test } from 'node:test';
import assert from 'node:assert/strict';

import { findSkills } from '../src/services/skills.js';
import { installFetchMock, makeNode, type MockResult } from './fetchMock.js';

function skillNode(id: string, title: string, desc: string) {
  return {
    ...makeNode(id, title, { 'cclom:general_description': [desc] }),
    downloadUrl: `https://redaktion.openeduhub.net/edu-sharing/eduservlet/download?nodeId=${id}`,
  };
}

/** Mock the /children listing + the eduservlet raw-markdown download. */
function installSkillMock() {
  return installFetchMock((url): MockResult => {
    if (url.includes('/children')) {
      return { json: { nodes: [
        skillNode('s-search', 'WLO Search', 'Find OER content and summarise it.'),
        skillNode('s-topic', 'WLO Topic Launcher', 'Guide a learner into a topic page.'),
      ], pagination: { total: 2, from: 0, count: 2 } } };
    }
    if (url.includes('/eduservlet/download')) {
      const id = new URL(url).searchParams.get('nodeId');
      return { text: `# Skill ${id}\nInstructions for ${id}.` };
    }
    return { json: {} };
  });
}

test('findSkills lists all skills with their raw content when no query is given', async () => {
  const mock = installSkillMock();
  try {
    const skills = await findSkills({ collectionId: 'skills-coll' });
    assert.equal(skills.length, 2);
    assert.deepEqual(skills.map(s => s.nodeId).sort(), ['s-search', 's-topic']);
    const search = skills.find(s => s.nodeId === 's-search')!;
    assert.equal(search.title, 'WLO Search');
    assert.match(search.description, /Find OER/);
    assert.match(search.content ?? '', /Skill s-search/);
    assert.match(search.downloadUrl, /eduservlet\/download\?nodeId=s-search/);
  } finally {
    mock.restore();
  }
});

test('findSkills: umlaut queries rank correctly (tokenizer is unicode-aware)', async () => {
  // The old tokenizer split on \W+ which treats ä/ö/ü/ß as separators —
  // "Köln" produced no usable term and the ranking silently did nothing.
  const mock = installFetchMock((url): MockResult => {
    if (url.includes('/children')) {
      return { json: { nodes: [
        skillNode('s-generic', 'Allgemeiner Skill', 'Hilft bei allem Möglichen.'),
        skillNode('s-koeln', 'Köln Spezial', 'Materialien über Köln und Umgebung.'),
      ], pagination: { total: 2, from: 0, count: 2 } } };
    }
    if (url.includes('/eduservlet/download')) return { text: '# x' };
    return { json: {} };
  });
  try {
    const skills = await findSkills({ collectionId: 'skills-coll', query: 'Köln' });
    assert.equal(skills[0].nodeId, 's-koeln', 'the Köln skill must rank first');
  } finally {
    mock.restore();
  }
});

test('findSkills ranks the best-matching skill first for a query', async () => {
  const mock = installSkillMock();
  try {
    const skills = await findSkills({ collectionId: 'skills-coll', query: 'topic launcher' });
    assert.equal(skills[0].nodeId, 's-topic', 'the topic-launcher skill ranks first');
  } finally {
    mock.restore();
  }
});

test('findSkills omits content (and the download call) when includeContent is false', async () => {
  const mock = installSkillMock();
  try {
    const skills = await findSkills({ collectionId: 'skills-coll', includeContent: false });
    assert.equal(skills.length, 2);
    assert.ok(skills.every(s => s.content === undefined), 'no content fetched');
    assert.ok(!mock.calls.some(c => c.url.includes('/eduservlet/download')), 'no download request made');
  } finally {
    mock.restore();
  }
});
