import { test } from 'node:test';
import assert from 'node:assert/strict';

import { getSkill, pickBestSkill, searchSkills, searchSkillsDetailed } from '../src/services/skills.js';
import { SKILL_CONTENT_TYPE_URI, SKILL_VISIT_MAX } from '../src/services/skill-catalogue.js';
import { installFetchMock, makeNode, type MockResult } from './fetchMock.js';

/** A `ccm:io` carrying an attached SKILL.md — the shape the curation produces. */
function skillNode(
  id: string,
  title: string,
  desc: string,
  keywords: string[] = [],
  extendedType: string = SKILL_CONTENT_TYPE_URI,
) {
  return {
    ...makeNode(id, title, {
      'cclom:general_description': [desc],
      'cclom:general_keyword': keywords,
      'ccm:oeh_extendedType': [extendedType],
    }),
    downloadUrl: `https://repository.staging.openeduhub.net/edu-sharing/eduservlet/download?nodeId=${id}`,
  };
}

/** Body of the last POST as a parsed object (the ngsearch criteria live there). */
function lastPostBody(mock: { calls: Array<{ url: string; init?: RequestInit }> }, urlPart: string): any {
  const call = [...mock.calls].reverse().find(c => c.url.includes(urlPart));
  assert.ok(call, `no request to ${urlPart}`);
  return JSON.parse(String(call!.init?.body ?? '{}'));
}

// ── searchSkills: repository-wide (no skills collection configured) ───────────

test('searchSkills filters the whole repository by the ai_prompt content type', async () => {
  const mock = installFetchMock((url): MockResult => {
    if (url.includes('/ngsearch')) {
      return { json: {
        nodes: [skillNode('s-plan', 'Stunde planen', 'Plant eine Unterrichtsstunde.', ['Unterricht'])],
        pagination: { total: 1, from: 0, count: 1 },
      } };
    }
    return { json: {} };
  });
  try {
    const skills = await searchSkills({ query: 'Unterricht planen' });

    const body = lastPostBody(mock, '/ngsearch');
    const ext = body.criteria.find((c: any) => c.property === 'ccm:oeh_extendedType');
    assert.deepEqual(ext?.values, [SKILL_CONTENT_TYPE_URI], 'the content-type filter must be sent');
    const word = body.criteria.find((c: any) => c.property === 'ngsearchword');
    assert.deepEqual(word?.values, ['Unterricht planen']);

    assert.equal(skills.length, 1);
    assert.equal(skills[0].nodeId, 's-plan');
    assert.deepEqual(skills[0].keywords, ['Unterricht']);
    assert.ok(!('content' in skills[0]), 'the search result carries no markdown body');
    assert.ok(!mock.calls.some(c => c.url.includes('/eduservlet/download')), 'search must not download anything');
  } finally {
    mock.restore();
  }
});

test('searchSkills without a query lists the catalogue (ngsearchword=*)', async () => {
  const mock = installFetchMock((url): MockResult =>
    url.includes('/ngsearch')
      ? { json: { nodes: [skillNode('s-a', 'A', 'a')], pagination: { total: 1, from: 0, count: 1 } } }
      : { json: {} });
  try {
    await searchSkills({});
    const body = lastPostBody(mock, '/ngsearch');
    const word = body.criteria.find((c: any) => c.property === 'ngsearchword');
    assert.deepEqual(word?.values, ['*']);
  } finally {
    mock.restore();
  }
});

// ── searchSkills: linked to a subject by METADATA, not by placement ──────────

test('searchSkills sends the discipline alongside the content type', async () => {
  // "Welche Skills gehören zu Physik" without any collection membership. Measured
  // 2026-08-08: ccm:taxonid AND ccm:oeh_extendedType compose (9878 Physik records
  // → 9877 of them learning_material).
  const mock = installFetchMock((url): MockResult =>
    url.includes('/ngsearch')
      ? { json: { nodes: [skillNode('s-optik', 'Optik erklären', 'x')], pagination: { total: 1, from: 0, count: 1 } } }
      : { json: {} });
  try {
    await searchSkills({ discipline: 'Physik', educationalContext: 'Sekundarstufe I' });
    const criteria = lastPostBody(mock, '/ngsearch').criteria;
    const byProperty = Object.fromEntries(criteria.map((c: any) => [c.property, c.values]));
    assert.deepEqual(byProperty['ccm:taxonid'], ['http://w3id.org/openeduhub/vocabs/discipline/460']);
    assert.ok(byProperty['ccm:educationalcontext']?.length, 'the education level resolves too');
    assert.deepEqual(byProperty['ccm:oeh_extendedType'], [SKILL_CONTENT_TYPE_URI], 'still only skills');
  } finally {
    mock.restore();
  }
});

test('searchSkills applies the discipline locally when scoped to a collection', async () => {
  // The collection path cannot send criteria — it lists and filters here.
  const physics = skillNode('s-optik', 'Optik erklären', 'x');
  physics.properties!['ccm:taxonid'] = ['http://w3id.org/openeduhub/vocabs/discipline/460'];
  const maths = skillNode('s-bruch', 'Brüche üben', 'x');
  maths.properties!['ccm:taxonid'] = ['http://w3id.org/openeduhub/vocabs/discipline/380'];
  const mock = collectionMock([physics, maths]);
  try {
    const skills = await searchSkills({ collectionId: 'skills-root', discipline: 'Physik' });
    assert.deepEqual(skills.map(s => s.nodeId), ['s-optik']);
  } finally {
    mock.restore();
  }
});

test('searchSkills reports a filter value it could not resolve instead of dropping it', async () => {
  // An unresolved vocab filter is silently omitted from the query, so the caller
  // gets a WIDER result set than asked for and no sign of it.
  const mock = installFetchMock((url): MockResult =>
    url.includes('/ngsearch')
      ? { json: { nodes: [], pagination: { total: 0, from: 0, count: 0 } } }
      : { json: {} });
  try {
    const { unresolved } = await searchSkillsDetailed({ discipline: 'Phsyik' });
    assert.equal(unresolved[0]?.field, 'discipline');
    assert.equal(unresolved[0]?.value, 'Phsyik');
    assert.ok(unresolved[0]?.suggestions?.some(s => /physik/i.test(s)), 'with a "did you mean"');
  } finally {
    mock.restore();
  }
});

// ── searchSkills: scoped to the configured skills collection ─────────────────

/**
 * Root collection → one skillset sub-collection → skill files. The subtree walk
 * is the only scoping mechanism available: `virtual:parent_recursive` is refused
 * by ngsearch with 400 DAOValidationException (measured 2026-08-08 on both
 * instances), so the query cannot carry the collection.
 */
function collectionMock(files: ReturnType<typeof skillNode>[]) {
  return installFetchMock((url): MockResult => {
    if (url.includes('filter=folders')) {
      return { json: { nodes: url.includes('skills-root') ? [makeNode('skillset-1', 'Lehrtoolkit')] : [] } };
    }
    if (url.includes('filter=files')) {
      return { json: {
        nodes: url.includes('skillset-1') ? files : [],
        pagination: { total: files.length, from: 0, count: files.length },
      } };
    }
    return { json: {} };
  });
}

test('searchSkills scoped to a collection walks its skillset sub-collections', async () => {
  const mock = collectionMock([
    skillNode('s-plan', 'Stunde planen', 'Plant eine Unterrichtsstunde.'),
    skillNode('s-test', 'Prüfung erstellen', 'Erstellt eine Klassenarbeit.'),
  ]);
  try {
    const skills = await searchSkills({ collectionId: 'skills-root' });
    assert.deepEqual(skills.map(s => s.nodeId).sort(), ['s-plan', 's-test']);
    assert.ok(!mock.calls.some(c => c.url.includes('/ngsearch')), 'the scoped path does not use ngsearch');
  } finally {
    mock.restore();
  }
});

test('searchSkills drops collection entries that are not ai_prompt content', async () => {
  const mock = collectionMock([
    skillNode('s-plan', 'Stunde planen', 'Plant eine Unterrichtsstunde.'),
    skillNode('m-video', 'Ein Video', 'Gewöhnliches Lernmaterial.', [],
      'http://w3id.org/openeduhub/vocabs/contentTypes/learning_material'),
  ]);
  try {
    const skills = await searchSkills({ collectionId: 'skills-root' });
    assert.deepEqual(skills.map(s => s.nodeId), ['s-plan'], 'only the prompt is a skill');
  } finally {
    mock.restore();
  }
});

test('searchSkills ranks a keyword-only match above an unrelated skill', async () => {
  // Title and description say nothing about "Vertretung"; only the keyword does.
  const mock = collectionMock([
    skillNode('s-plan', 'Stunde planen', 'Plant eine Unterrichtsstunde.', ['Planung']),
    skillNode('s-sub', 'Spontan einspringen', 'Kurzfristig übernehmen.', ['Vertretungsstunde']),
  ]);
  try {
    const skills = await searchSkills({ collectionId: 'skills-root', query: 'Vertretung' });
    assert.equal(skills[0].nodeId, 's-sub', 'keywords must count towards the ranking');
  } finally {
    mock.restore();
  }
});

test('searchSkills honours maxResults', async () => {
  const mock = collectionMock([
    skillNode('s-1', 'Eins', 'a'), skillNode('s-2', 'Zwei', 'b'), skillNode('s-3', 'Drei', 'c'),
  ]);
  try {
    assert.equal((await searchSkills({ collectionId: 'skills-root', maxResults: 2 })).length, 2);
  } finally {
    mock.restore();
  }
});

test('searchSkills stops the subtree walk at the visit cap', async () => {
  // A WIDE tree: one level with more branches than the cap allows. A
  // misconfigured collection id points the walk at a whole subject portal, and
  // one live run over such a portal read 717 records across 30 collections.
  let n = 0;
  const mock = installFetchMock((url): MockResult => {
    if (url.includes('filter=folders')) {
      return { json: { nodes: Array.from({ length: 40 }, () => makeNode(`c-${n++}`, 'Zweig')) } };
    }
    if (url.includes('filter=files')) {
      return { json: { nodes: [], pagination: { total: 0, from: 0, count: 0 } } };
    }
    return { json: {} };
  });
  try {
    assert.deepEqual(await searchSkills({ collectionId: 'skills-root' }), []);
    const listings = mock.calls.filter(c => c.url.includes('filter=files')).length;
    assert.ok(listings <= SKILL_VISIT_MAX, `read ${listings} collections, cap is ${SKILL_VISIT_MAX}`);
  } finally {
    mock.restore();
  }
});

/** Collect what the logger wrote to stderr while `fn` ran. */
async function captureStderr(fn: () => Promise<unknown>): Promise<string> {
  const captured: string[] = [];
  const realWrite = process.stderr.write.bind(process.stderr);
  process.stderr.write = ((chunk: unknown) => { captured.push(String(chunk)); return true; }) as never;
  try { await fn(); } finally { process.stderr.write = realWrite; }
  return captured.join('');
}

test('searchSkills discloses a listing the visit cap truncated', async () => {
  // The cap can bite on the LAST level read: every sub-collection is then
  // refused, the next level is empty, and the loop exits normally — so a check
  // on "is there a level left" sees nothing and the truncated listing passes as
  // the whole catalogue. That is the exact silence the cap's own comment
  // promises to break.
  const mock = installFetchMock((url): MockResult => {
    if (url.includes('filter=folders')) {
      return { json: { nodes: Array.from({ length: 40 }, (_, i) => makeNode(`c-${i}`, 'Zweig')) } };
    }
    if (url.includes('filter=files')) return { json: { nodes: [], pagination: { total: 0, from: 0, count: 0 } } };
    return { json: {} };
  });
  try {
    const logged = await captureStderr(() => searchSkills({ collectionId: 'skills-root' }));
    assert.match(logged, /listing may be incomplete/, 'the truncation must be logged');
  } finally {
    mock.restore();
  }
});

test('searchSkills fails loudly when the collection cannot be read at all', async () => {
  // `mapPool` turns a failed collection into null, so a total upstream outage
  // yields an empty list — and the tool then reports "no skills found", a
  // statement about the catalogue made from a statement about the server.
  const mock = installFetchMock((): MockResult => ({ status: 503, json: {} }));
  try {
    await assert.rejects(
      () => searchSkills({ collectionId: 'skills-root' }),
      /nicht abrufbar|not readable|unreadable/i,
      'an unreadable collection is an error, not an empty catalogue',
    );
  } finally {
    mock.restore();
  }
});

test('searchSkills does not descend past the documented skills structure', async () => {
  // Root → skillsets → skill records is the shape the operator is told to build
  // (SKILLS.md). A DEEP tree therefore means the configured id points at
  // something else, and following it is how a skill lookup turns into a crawl —
  // the depth bound is what keeps the cost proportional to that structure
  // instead of to whatever it was pointed at.
  const mock = installFetchMock((url): MockResult => {
    if (url.includes('filter=folders')) {
      const here = url.split('/nodes/-home-/')[1]!.split('/')[0]!;
      const depth = here === 'skills-root' ? 0 : Number(here.split('-')[1]);
      return { json: { nodes: [makeNode(`lvl-${depth + 1}`, 'Tiefer')] } };
    }
    if (url.includes('filter=files')) {
      const here = url.split('/nodes/-home-/')[1]!.split('/')[0]!;
      return { json: {
        nodes: [skillNode(`skill-at-${here}`, `Skill in ${here}`, 'x')],
        pagination: { total: 1, from: 0, count: 1 },
      } };
    }
    return { json: {} };
  });
  try {
    const ids = (await searchSkills({ collectionId: 'skills-root', maxResults: 25 })).map(s => s.nodeId);
    assert.ok(ids.includes('skill-at-skills-root'), 'the root itself is read');
    assert.ok(ids.includes('skill-at-lvl-1'), 'the skillsets are read');
    assert.ok(!ids.includes('skill-at-lvl-3'), 'a third level below the root is not followed');
  } finally {
    mock.restore();
  }
});

test('searchSkills can be restricted to one collection, without its sub-collections', async () => {
  // "Which skills belong to Optik?" — a subject collection carries its skills as
  // ordinary content, so the answer is one listing. The sub-collections are only
  // read when the caller asks for them.
  const mock = installFetchMock((url): MockResult => {
    if (url.includes('filter=folders')) return { json: { nodes: [makeNode('sub-1', 'Unterthema')] } };
    if (url.includes('filter=files')) {
      const here = url.split('/nodes/-home-/')[1]!.split('/')[0]!;
      return { json: {
        nodes: [skillNode(`skill-in-${here}`, `Skill in ${here}`, 'x')],
        pagination: { total: 1, from: 0, count: 1 },
      } };
    }
    return { json: {} };
  });
  try {
    const ids = (await searchSkills({ collectionId: 'optik', includeSubcollections: false })).map(s => s.nodeId);
    assert.deepEqual(ids, ['skill-in-optik']);
    assert.ok(!mock.calls.some(c => c.url.includes('filter=folders')),
      'restricted to one collection, the sub-collection listing is not even requested');
  } finally {
    mock.restore();
  }
});

// ── ccm:original: one skill, however many places it sits in ─────────────────

test('searchSkills reports the original id, and it equals the nodeId for an original', async () => {
  const mock = collectionMock([skillNode('s-plan', 'Stunde planen', 'Plant.')]);
  try {
    const [skill] = await searchSkills({ collectionId: 'skills-root' });
    assert.equal(skill!.originalId, 's-plan', 'a record that is its own original says so');
  } finally {
    mock.restore();
  }
});

test('searchSkills returns a skill ONCE even when it sits in several collections', async () => {
  // The catalogue holds the original, Physik/Optik holds a reference to it. A
  // subtree walk sees both, and without de-duplication the same skill is offered
  // twice under two different nodeIds — which reads as two skills.
  const original = skillNode('orig-1', 'Stunde planen', 'Plant.');
  const reference = skillNode('ref-1', 'Stunde planen', 'Plant.');
  reference.properties!['ccm:original'] = ['orig-1'];
  const mock = collectionMock([reference, original]);
  try {
    const skills = await searchSkills({ collectionId: 'skills-root' });
    assert.equal(skills.length, 1, 'one skill, not two');
    assert.equal(skills[0]!.nodeId, 'orig-1', 'and the ORIGINAL is the one offered');
    assert.equal(skills[0]!.originalId, 'orig-1');
  } finally {
    mock.restore();
  }
});

test('searchSkills keeps a reference when its original is not in the result set', async () => {
  const reference = skillNode('ref-1', 'Stunde planen', 'Plant.');
  reference.properties!['ccm:original'] = ['orig-1'];
  const mock = collectionMock([reference]);
  try {
    const skills = await searchSkills({ collectionId: 'skills-root' });
    assert.deepEqual(skills.map(s => [s.nodeId, s.originalId]), [['ref-1', 'orig-1']],
      'the reference is usable and names the record it stands for');
  } finally {
    mock.restore();
  }
});

// ── getSkill: the attached Markdown ──────────────────────────────────────────

test('getSkill returns the attached markdown together with the metadata', async () => {
  const mock = installFetchMock((url): MockResult => {
    if (url.includes('/metadata')) return { json: { node: skillNode('s-plan', 'Stunde planen', 'Plant.', ['Planung']) } };
    if (url.includes('/eduservlet/download')) return { text: '# Stunde planen\n\nSchritt 1 …' };
    return { json: {} };
  });
  try {
    const skill = await getSkill('s-plan');
    assert.ok(skill);
    assert.equal(skill!.title, 'Stunde planen');
    assert.deepEqual(skill!.keywords, ['Planung']);
    assert.match(skill!.content ?? '', /Schritt 1/);
  } finally {
    mock.restore();
  }
});

test('getSkill falls back to the stored text when the file cannot be downloaded', async () => {
  const mock = installFetchMock((url): MockResult => {
    if (url.includes('/metadata')) return { json: { node: skillNode('s-plan', 'Stunde planen', 'Plant.') } };
    if (url.includes('/eduservlet/download')) return { status: 403, text: 'forbidden' };
    if (url.includes('/textContent')) return { json: { content: '# aus dem Index' } };
    return { json: {} };
  });
  try {
    const skill = await getSkill('s-plan');
    assert.match(skill?.content ?? '', /aus dem Index/);
  } finally {
    mock.restore();
  }
});

// ── getSkill: the companion-file manifest ───────────────────────────────────

/** Skill node + its workspace folder holding two more files. */
function bundleMock(folderFiles: ReturnType<typeof skillNode>[], folderTotal?: number) {
  return installFetchMock((url): MockResult => {
    if (url.includes('/metadata')) {
      const id = url.split('/nodes/-home-/')[1]!.split('/')[0]!;
      const node = skillNode(id, 'Stunde planen', 'Plant.');
      node.properties!['virtual:primaryparent_nodeid'] = ['folder-1'];
      return { json: { node } };
    }
    if (url.includes('filter=files')) {
      return { json: {
        nodes: folderFiles,
        pagination: { total: folderTotal ?? folderFiles.length, from: 0, count: folderFiles.length },
      } };
    }
    if (url.includes('/eduservlet/download')) return { text: '# Stunde planen' };
    return { json: {} };
  });
}

test('getSkill lists the other files of the skill folder, with their nodeIds', async () => {
  const mock = bundleMock([
    skillNode('s-plan', 'SKILL.md', ''),
    skillNode('f-vorlage', 'vorlage.docx', ''),
    skillNode('f-check', 'checkliste.md', ''),
  ]);
  try {
    const skill = await getSkill('s-plan');
    assert.deepEqual(skill?.files?.map(f => f.nodeId), ['f-vorlage', 'f-check'],
      'the skill itself is not listed among its own companions');
    assert.equal(skill?.files?.[0]?.title, 'vorlage.docx');
    assert.match(skill?.content ?? '', /Stunde planen/);
  } finally {
    mock.restore();
  }
});

test('getSkill reports a folder that is not a skill bundle as a count, not as a file list', async () => {
  // Measured on staging: real WLO workspace folders hold 484–3744 records, and
  // listing one took 1.7–20.6 s. Dumping those names as "companion files" would
  // be wrong AND slow — a folder that large simply is not one skill's bundle.
  const mock = bundleMock([skillNode('s-plan', 'SKILL.md', '')], 3744);
  try {
    const skill = await getSkill('s-plan');
    assert.deepEqual(skill?.files, []);
    assert.equal(skill?.folderFileCount, 3744, 'the caller is told why the manifest is empty');
  } finally {
    mock.restore();
  }
});

test('getSkill still returns the instructions when the folder cannot be listed', async () => {
  const mock = installFetchMock((url): MockResult => {
    if (url.includes('/metadata')) {
      const node = skillNode('s-plan', 'Stunde planen', 'Plant.');
      node.properties!['virtual:primaryparent_nodeid'] = ['folder-1'];
      return { json: { node } };
    }
    if (url.includes('filter=files')) return { status: 403, json: {} };
    if (url.includes('/eduservlet/download')) return { text: '# Stunde planen' };
    return { json: {} };
  });
  try {
    const skill = await getSkill('s-plan');
    assert.match(skill?.content ?? '', /Stunde planen/, 'the manifest is an extra, never a precondition');
    assert.deepEqual(skill?.files, []);
  } finally {
    mock.restore();
  }
});

test('getSkill asks the repository for the fields the manifest needs', async () => {
  // A mock returns whatever it likes regardless of `propertyFilter`, so the
  // reference test below would pass over a projection that never requests
  // `ccm:original` — and against the real repository the field would simply be
  // absent, silently turning every reference into "no companions".
  const mock = bundleMock([skillNode('s-plan', 'SKILL.md', '')]);
  try {
    await getSkill('s-plan');
    const meta = mock.calls.find(c => c.url.includes('/metadata'));
    assert.ok(meta, 'metadata is read');
    assert.match(meta!.url, /propertyFilter=ccm%3Aoriginal/, 'ccm:original must be in the projection');
    assert.match(meta!.url, /propertyFilter=virtual%3Aprimaryparent_nodeid/, 'and the workspace folder');
  } finally {
    mock.restore();
  }
});

test('getSkill resolves a reference to its original before reading the folder', async () => {
  // A skill reached through a collection is a REFERENCE, and its own
  // virtual:primaryparent_nodeid is the COLLECTION (measured 2026-08-08) — the
  // folder hangs off the original.
  const mock = installFetchMock((url): MockResult => {
    if (url.includes('/metadata')) {
      const id = url.split('/nodes/-home-/')[1]!.split('/')[0]!;
      const node = skillNode(id, 'Stunde planen', 'Plant.');
      node.properties!['virtual:primaryparent_nodeid'] = id === 'ref-1' ? ['some-collection'] : ['folder-1'];
      if (id === 'ref-1') node.properties!['ccm:original'] = ['orig-1'];
      return { json: { node } };
    }
    if (url.includes('filter=files')) {
      const here = url.split('/nodes/-home-/')[1]!.split('/')[0]!;
      return { json: {
        nodes: here === 'folder-1' ? [skillNode('orig-1', 'SKILL.md', ''), skillNode('f-1', 'vorlage.docx', '')] : [],
        pagination: { total: here === 'folder-1' ? 2 : 0, from: 0, count: here === 'folder-1' ? 2 : 0 },
      } };
    }
    if (url.includes('/eduservlet/download')) return { text: '# Stunde planen' };
    return { json: {} };
  });
  try {
    const skill = await getSkill('ref-1');
    assert.deepEqual(skill?.files?.map(f => f.nodeId), ['f-1']);
    assert.ok(!mock.calls.some(c => c.url.includes('some-collection')),
      'the reference\'s own parent is the collection and must not be listed');
  } finally {
    mock.restore();
  }
});

test('getSkill skips the folder read when files are not wanted', async () => {
  const mock = bundleMock([skillNode('s-plan', 'SKILL.md', ''), skillNode('f-1', 'vorlage.docx', '')]);
  try {
    const skill = await getSkill('s-plan', { includeFiles: false });
    assert.equal(skill?.files, undefined);
    assert.ok(!mock.calls.some(c => c.url.includes('filter=files')), 'no folder listing was requested');
  } finally {
    mock.restore();
  }
});

test('getSkill returns null when the node cannot be read', async () => {
  const mock = installFetchMock((): MockResult => ({ status: 404, json: {} }));
  try {
    assert.equal(await getSkill('does-not-exist'), null);
  } finally {
    mock.restore();
  }
});

// ── pickBestSkill: the one-tool variant ─────────────────────────────────────

test('pickBestSkill returns the top-ranked skill with its markdown plus the runners-up', async () => {
  const mock = installFetchMock((url): MockResult => {
    if (url.includes('/ngsearch')) {
      return { json: { nodes: [
        skillNode('s-plan', 'Stunde planen', 'Plant eine Unterrichtsstunde.', ['Planung']),
        skillNode('s-sub', 'Vertretungsstunde', 'Kurzfristig übernehmen.', ['Vertretung']),
      ], pagination: { total: 2, from: 0, count: 2 } } };
    }
    if (url.includes('/metadata')) {
      const id = url.split('/nodes/-home-/')[1]!.split('/')[0]!;
      return { json: { node: skillNode(id, 'Vertretungsstunde', 'Kurzfristig übernehmen.') } };
    }
    if (url.includes('filter=files')) return { json: { nodes: [], pagination: { total: 0, from: 0, count: 0 } } };
    if (url.includes('/eduservlet/download')) {
      return { text: `# ${new URL(url).searchParams.get('nodeId')}` };
    }
    return { json: {} };
  });
  try {
    const picked = await pickBestSkill({ query: 'Vertretungsstunde vorbereiten' });
    assert.equal(picked?.skill.nodeId, 's-sub');
    assert.match(picked?.skill.content ?? '', /s-sub/);
    assert.deepEqual(picked?.alternatives.map(a => a.nodeId), ['s-plan']);
    const downloads = mock.calls.filter(c => c.url.includes('/eduservlet/download'));
    assert.equal(downloads.length, 1, 'only the chosen skill is downloaded');
  } finally {
    mock.restore();
  }
});

test('pickBestSkill returns null when nothing matches', async () => {
  const mock = installFetchMock((url): MockResult =>
    url.includes('/ngsearch')
      ? { json: { nodes: [], pagination: { total: 0, from: 0, count: 0 } } }
      : { json: {} });
  try {
    assert.equal(await pickBestSkill({ query: 'gibt es nicht' }), null);
  } finally {
    mock.restore();
  }
});
