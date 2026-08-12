import { test } from 'node:test';
import assert from 'node:assert/strict';

import { REGISTRY_MAX, REGISTRY_SEARCH_MAX, loadSkillRegistry, pickRegistryNode } from '../src/services/skill-registry.js';
import { REGISTRY_CONTENT_TYPE_URI } from '../src/services/skill-catalogue.js';
import { installFetchMock, makeNode, type MockResult } from './fetchMock.js';
import type { WloNode } from '../src/wlo-api.js';

/**
 * A candidate as the children listing hands it over. `text/x-web-markdown` is
 * what staging actually reports for every SKILL.md (measured 2026-08-10, 25/25)
 * — not `text/markdown`, which is why the value is pinned here.
 */
function promptNode(
  id: string,
  title: string,
  opts: { name?: string; mimetype?: string; mediatype?: string; extendedType?: string | null } = {},
): WloNode {
  const ext: Record<string, string[]> =
    opts.extendedType === null ? {} : { 'ccm:oeh_extendedType': [opts.extendedType ?? REGISTRY_CONTENT_TYPE_URI] };
  return {
    ...makeNode(id, title, { 'cm:name': [opts.name ?? 'SKILL.md'], ...ext }),
    mimetype: opts.mimetype ?? 'text/x-web-markdown',
    mediatype: opts.mediatype ?? 'file-markdown',
  };
}

test('pickRegistryNode picks the single ai_prompt markdown candidate', () => {
  const chosen = pickRegistryNode([
    { ...makeNode('pdf-1', 'Ein PDF'), mimetype: 'application/pdf', mediatype: 'file-pdf' },
    promptNode('reg-1', 'Skills dieser Sammlung'),
  ]);

  assert.equal(chosen?.node.ref?.id, 'reg-1');
  assert.equal(chosen?.candidates, 1, 'only one candidate qualified');
});

test('pickRegistryNode prefers the file named SKILL_REGISTRY.md', () => {
  const chosen = pickRegistryNode([
    promptNode('other', 'Irgendein Skill'),
    promptNode('reg', 'Noch ein Skill', { name: 'SKILL_REGISTRY.md' }),
  ]);

  assert.equal(chosen?.node.ref?.id, 'reg');
  assert.equal(chosen?.candidates, 2, 'the ambiguity is reported, not hidden');
});

test('pickRegistryNode prefers a title carrying SKILL REGISTRY, case-insensitively', () => {
  const chosen = pickRegistryNode([
    promptNode('a', 'Rückmeldung formulieren'),
    promptNode('b', 'Skill Registry — Physik'),
  ]);

  assert.equal(chosen?.node.ref?.id, 'b');
});

test('pickRegistryNode is stable when nothing distinguishes the candidates', () => {
  const nodes = [promptNode('zzz', 'Zweiter'), promptNode('aaa', 'Erster')];

  const first = pickRegistryNode(nodes);
  const again = pickRegistryNode([...nodes].reverse());

  assert.equal(first?.node.ref?.id, 'aaa', 'lowest nodeId wins');
  assert.equal(again?.node.ref?.id, 'aaa', 'the input order does not change the answer');
  assert.equal(first?.candidates, 2);
});

test('pickRegistryNode rejects an ai_prompt that is not markdown', () => {
  const chosen = pickRegistryNode([
    promptNode('docx', 'Prompt als Word-Datei', {
      mimetype: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      mediatype: 'file-word',
    }),
  ]);

  assert.equal(chosen, null);
});

test('pickRegistryNode rejects markdown that is not an ai_prompt', () => {
  const chosen = pickRegistryNode([
    promptNode('notes', 'Notizen der Redaktion', { extendedType: null }),
  ]);

  assert.equal(chosen, null);
});

test('pickRegistryNode accepts the other markdown spellings and the coarse mediatype', () => {
  for (const mimetype of ['text/markdown', 'text/x-markdown']) {
    assert.ok(pickRegistryNode([promptNode('m', 'Registry', { mimetype })]), `${mimetype} must qualify`);
  }
  // A repository that reports an unhelpful mimetype but the right coarse label.
  assert.ok(
    pickRegistryNode([promptNode('m', 'Registry', { mimetype: 'application/octet-stream' })]),
    'mediatype file-markdown must qualify on its own',
  );
});

test('pickRegistryNode returns null for an empty listing', () => {
  assert.equal(pickRegistryNode([]), null);
});

/** The same candidate with its readable title in `cm:title` instead. */
function promptNodeCmTitle(id: string, title: string): WloNode {
  const node = promptNode(id, title);
  delete node.properties!['cclom:title'];
  node.properties!['cm:title'] = [title];
  return node;
}

test('pickRegistryNode recognises a registry whose title lives in cm:title', () => {
  // `cm:title` is in the projection (DISPLAY_PROPS) and second in the canonical
  // chain `node-match.nodeTitle` — which this repository measured as the carrier
  // that is actually set (109/109 production variants, CLAUDE.md). A rule that
  // reads only `cclom:title` does not merely miss the mark: with a second prompt
  // document present it falls through to the nodeId sort and answers with the
  // WRONG document's catalogue.
  const chosen = pickRegistryNode([
    promptNode('aaa-other', 'Rückmeldung formulieren'),
    promptNodeCmTitle('zzz-reg', 'Skill Registry — Physik'),
  ]);

  assert.equal(chosen?.node.ref?.id, 'zzz-reg', 'the marked document wins over the lower nodeId');
});

// ── the children listing that finds the registry ─────────────────────────────

test('the registry is named by the canonical title chain, not by one property', async () => {
  const mock = installFetchMock((url): MockResult => {
    if (url.includes('/children')) {
      return { json: { nodes: [promptNodeCmTitle('reg-3', 'Skill Registry Optik')], pagination: { total: 1, from: 0, count: 1 } } };
    }
    return { json: {} };
  });
  try {
    const { registry } = await loadSkillRegistry('coll-1', { resolveHeads: false });
    // Without the canonical chain this reports the raw file name, and every
    // caller renders "# SKILL.md" as the heading of an approval list.
    assert.equal(registry?.registryTitle, 'Skill Registry Optik');
  } finally {
    mock.restore();
  }
});

test('a scan that hit its cap does not claim the collection has no registry', async () => {
  const mock = installFetchMock((url): MockResult => {
    if (url.includes('/children')) {
      // 50 files come back and the repository reports 120 in total — the
      // registry may simply be past the page this lookup reads.
      return { json: {
        nodes: Array.from({ length: 50 }, (_, i) => makeNode(`f-${i}`, `Datei ${i}`)),
        pagination: { total: 120, from: 0, count: 50 },
      } };
    }
    return { json: {} };
  });
  try {
    const { registry, reason, scanTruncated } = await loadSkillRegistry('coll-1', { resolveHeads: false });

    assert.equal(registry, null);
    assert.equal(reason, 'no_registry');
    // "There is no registry here" over a partially read listing is a claim the
    // data does not support — the project holds the same rule for every other
    // bounded traversal ("no silent caps").
    assert.deepEqual(scanTruncated, { scanned: 50, total: 120 });
  } finally {
    mock.restore();
  }
});

test('a listing read in full reports no truncation', async () => {
  const mock = installFetchMock((url): MockResult => {
    if (url.includes('/children')) {
      return { json: { nodes: [makeNode('f-1', 'Datei')], pagination: { total: 1, from: 0, count: 1 } } };
    }
    return { json: {} };
  });
  try {
    const { reason, scanTruncated } = await loadSkillRegistry('coll-1', { resolveHeads: false });
    assert.equal(reason, 'no_registry');
    assert.equal(scanTruncated, undefined, 'nothing was left unread — say nothing');
  } finally {
    mock.restore();
  }
});

test('the registry lookup reads file children and asks for the type field', async () => {
  const mock = installFetchMock((url): MockResult => {
    if (url.includes('/children')) {
      return { json: { nodes: [promptNode('reg-1', 'Skill Registry Physik')], pagination: { total: 1, from: 0, count: 1 } } };
    }
    return { json: {} };
  });
  try {
    const { registry } = await loadSkillRegistry('coll-1', { resolveHeads: false });
    assert.equal(registry?.registryNodeId, 'reg-1');
    assert.equal(registry?.registryTitle, 'Skill Registry Physik');

    const call = mock.calls.find(c => c.url.includes('/children'));
    assert.ok(call, 'the children endpoint must be called');
    // Measured 2026-08-10: without this projection the listing reports
    // `ccm:oeh_extendedType` as empty, and every candidate is silently rejected.
    assert.ok(
      call!.url.includes(encodeURIComponent('ccm:oeh_extendedType')) || call!.url.includes('ccm:oeh_extendedType'),
      `the request must project ccm:oeh_extendedType — got ${call!.url}`,
    );
    assert.ok(call!.url.includes('filter=files'), 'only file children can be a registry');
  } finally {
    mock.restore();
  }
});

test('the registry lookup falls back to the file name when the record has no title', async () => {
  const mock = installFetchMock((url): MockResult => {
    if (url.includes('/children')) {
      const node = promptNode('reg-2', '', { name: 'SKILL_REGISTRY.md' });
      delete node.properties!['cclom:title'];
      return { json: { nodes: [node], pagination: { total: 1, from: 0, count: 1 } } };
    }
    return { json: {} };
  });
  try {
    const { registry } = await loadSkillRegistry('coll-1', { resolveHeads: false });
    assert.equal(registry?.registryNodeId, 'reg-2');
    assert.equal(registry?.registryTitle, 'SKILL_REGISTRY.md', 'a nameless registry is still nameable');
  } finally {
    mock.restore();
  }
});

// ── loadSkillRegistry: the catalogue ─────────────────────────────────────────

/**
 * A `::: ki-skill` block as the WLO editor writes it.
 *
 * The ids are real UUIDs on purpose: `parseSkillReferences` only extracts
 * UUID-shaped ids, so a block carrying `skill-a` parses to an empty nodeId and
 * every catalogue built from it comes out empty.
 */
function kiSkillBlock(title: string, nodeId: string): string {
  return `::: ki-skill\n[${title}](https://repo.example/edu-sharing/components/render/${nodeId})\n:::`;
}

/** Distinct, UUID-shaped ids for the referenced skills. */
const uuid = (n: number) => `${String(n).padStart(8, '0')}-0000-4000-8000-000000000000`;
const SKILL_A = uuid(1);
const SKILL_B = uuid(2);
const SKILL_GONE = uuid(9);

/**
 * One registry document plus the skills it points at. Counts every upstream call
 * by kind, so a test can assert what a call COSTS and not only what it returns.
 */
function registryMock(
  markdown: string,
  heads: Record<string, { title: string; desc: string; keywords: string[] }> = {},
) {
  const counts = { children: 0, download: 0, metadata: 0, textContent: 0 };
  const mock = installFetchMock((url): MockResult => {
    if (url.includes('/children')) {
      counts.children++;
      return { json: { nodes: [promptNode('reg-1', 'Skill Registry')], pagination: { total: 1, from: 0, count: 1 } } };
    }
    if (url.includes('/eduservlet/download')) {
      counts.download++;
      return { text: markdown };
    }
    if (url.includes('/textContent')) {
      counts.textContent++;
      return { json: { text: markdown } };
    }
    if (url.includes('/metadata')) {
      counts.metadata++;
      const id = /nodes\/-home-\/([^/?]+)/.exec(url)?.[1] ?? '';
      const head = heads[id];
      if (!head) return { status: 404, json: {} };
      return { json: { node: makeNode(id, head.title, {
        'cclom:general_description': [head.desc],
        'cclom:general_keyword': head.keywords,
      }) } };
    }
    return { json: {} };
  });
  return { mock, counts };
}

test('loadSkillRegistry returns the entries a registry names, in document order', async () => {
  const markdown = `# Skills dieser Sammlung\n\n${kiSkillBlock('Fragen generieren', SKILL_A)}\n\n${kiSkillBlock('Kompendialtext schreiben', SKILL_B)}\n`;
  const { mock } = registryMock(markdown, {
    [SKILL_A]: { title: 'Fragen generieren', desc: 'Erzeugt Aufgaben.', keywords: ['Aufgaben'] },
    [SKILL_B]: { title: 'Kompendialtext schreiben', desc: 'Schreibt einen Überblickstext.', keywords: ['Text'] },
  });
  try {
    const { registry, reason } = await loadSkillRegistry('coll-1');

    assert.equal(reason, undefined);
    assert.equal(registry?.registryNodeId, 'reg-1');
    assert.equal(registry?.markdown, markdown, 'the document is handed over unchanged');
    assert.deepEqual(registry?.entries.map(e => e.nodeId), [SKILL_A, SKILL_B]);
    assert.equal(registry?.entries[0]?.title, 'Fragen generieren');
    assert.equal(registry?.entries[0]?.description, 'Erzeugt Aufgaben.');
    assert.deepEqual(registry?.entries[0]?.keywords, ['Aufgaben']);
  } finally {
    mock.restore();
  }
});

test('loadSkillRegistry ignores wlo-material blocks', async () => {
  const markdown = `::: wlo-material\n![Bruch](https://repo.example/preview?nodeId=mat-1)\n[**Bruchrechnen**](https://extern.example) — Lizenz: [CC BY](https://x)\n:::\n\n${kiSkillBlock('Fragen generieren', SKILL_A)}\n`;
  const { mock } = registryMock(markdown, { [SKILL_A]: { title: 'Fragen generieren', desc: '', keywords: [] } });
  try {
    const { registry } = await loadSkillRegistry('coll-1');
    assert.deepEqual(registry?.entries.map(e => e.nodeId), [SKILL_A], 'material is not a skill');
  } finally {
    mock.restore();
  }
});

test('loadSkillRegistry names the references it could not read instead of dropping them', async () => {
  const markdown = `${kiSkillBlock('Lebt noch', SKILL_A)}\n\n${kiSkillBlock('Gelöscht', SKILL_GONE)}\n`;
  const { mock } = registryMock(markdown, { [SKILL_A]: { title: 'Lebt noch', desc: 'da', keywords: [] } });
  try {
    const { registry } = await loadSkillRegistry('coll-1');

    assert.deepEqual(registry?.entries.map(e => e.nodeId), [SKILL_A], 'the readable one survives');
    assert.deepEqual(registry?.unresolved, [{ title: 'Gelöscht', nodeId: SKILL_GONE }]);
  } finally {
    mock.restore();
  }
});

test('loadSkillRegistry with resolveHeads:false costs exactly two upstream calls', async () => {
  const markdown = `${kiSkillBlock('Fragen generieren', SKILL_A)}\n\n${kiSkillBlock('Korrigieren', SKILL_B)}\n`;
  const { mock, counts } = registryMock(markdown, {
    [SKILL_A]: { title: 'x', desc: 'y', keywords: [] },
    [SKILL_B]: { title: 'x', desc: 'y', keywords: [] },
  });
  try {
    const { registry } = await loadSkillRegistry('coll-1', { resolveHeads: false });

    // The cost promise the collection search rests on: title and nodeId come out
    // of the `:::` block itself, so no skill is read at all.
    assert.equal(counts.children, 1, 'one children listing');
    assert.equal(counts.download, 1, 'one document read');
    assert.equal(counts.metadata, 0, 'no skill head is fetched');
    assert.deepEqual(registry?.entries.map(e => e.title), ['Fragen generieren', 'Korrigieren']);
    assert.deepEqual(registry?.entries.map(e => e.nodeId), [SKILL_A, SKILL_B]);
    assert.equal(registry?.entries[0]?.description, undefined, 'the cheap tier carries no head');
    assert.deepEqual(registry?.unresolved, [], 'nothing was attempted, so nothing failed');
  } finally {
    mock.restore();
  }
});

/**
 * CONTRACT CHANGED 2026-08-11. One cap became two, because the two tiers pay
 * different prices and answer different questions.
 *
 * The SEARCH tier rides along in a result list and resolves nothing; its bound
 * is what a listing can carry without becoming a wall of text — five collections
 * at once — and it is deliberately equal to `REGISTRY_LINES_MAX`, so a search
 * listing is always COMPLETE for what it holds.
 *
 * The TOOL tier is one explicit call about one collection, and it fetches one
 * metadata record per skill. There a hundred is affordable, and a curated list
 * of sixty should not be cut to thirty.
 */
test('the search tier caps the catalogue at REGISTRY_SEARCH_MAX and says so', async () => {
  const blocks = Array.from({ length: REGISTRY_SEARCH_MAX + 1 }, (_, i) => kiSkillBlock(`Skill ${i}`, uuid(100 + i))).join('\n\n');
  const { mock } = registryMock(blocks);
  try {
    const { registry } = await loadSkillRegistry('coll-1', { resolveHeads: false });

    assert.equal(registry?.entries.length, REGISTRY_SEARCH_MAX);
    assert.deepEqual(registry?.truncated, { listed: REGISTRY_SEARCH_MAX, referenced: REGISTRY_SEARCH_MAX + 1 });
  } finally {
    mock.restore();
  }
});

/** `n` declared skills, with every head resolvable — the tool tier's real path. */
function bigRegistry(n: number) {
  const ids = Array.from({ length: n }, (_, i) => uuid(100 + i));
  const blocks = ids.map((id, i) => kiSkillBlock(`Skill ${i}`, id)).join('\n\n');
  const heads = Object.fromEntries(
    ids.map((id, i) => [id, { title: `Skill ${i}`, desc: `Beschreibung ${i}`, keywords: [`k${i}`] }]),
  );
  return registryMock(blocks, heads);
}

test('the tool tier carries far more than the search tier', async () => {
  // A registry of 60: the listing shows 30 and points onward, the tool answers
  // with all 60. Before this change the tool cut it to 30 as well, so the
  // pointer beside the listing led to an answer no larger than the one already
  // given.
  const { mock, counts } = bigRegistry(60);
  try {
    const { registry } = await loadSkillRegistry('coll-1');
    assert.equal(registry?.entries.length, 60, 'the tool answers with the whole approval list');
    assert.equal(registry?.truncated, undefined, 'nothing was cut, so nothing is claimed to be');
    assert.equal(counts.metadata, 60, 'one head per declared skill — that is what the tier costs');
  } finally {
    mock.restore();
  }
});

test('the tool tier has a bound of its own, and discloses it', async () => {
  const { mock } = bigRegistry(REGISTRY_MAX + 5);
  try {
    const { registry } = await loadSkillRegistry('coll-1');
    assert.equal(registry?.entries.length, REGISTRY_MAX);
    assert.deepEqual(registry?.truncated, { listed: REGISTRY_MAX, referenced: REGISTRY_MAX + 5 });
  } finally {
    mock.restore();
  }
});

test('loadSkillRegistry reports no_registry for a collection without one', async () => {
  const mock = installFetchMock((url): MockResult => {
    if (url.includes('/children')) {
      return { json: { nodes: [makeNode('pdf', 'Arbeitsblatt')], pagination: { total: 1, from: 0, count: 1 } } };
    }
    return { json: {} };
  });
  try {
    const { registry, reason } = await loadSkillRegistry('coll-1');
    assert.equal(registry, null);
    assert.equal(reason, 'no_registry');
  } finally {
    mock.restore();
  }
});

test('loadSkillRegistry tells a missing collection apart from an unreadable one', async () => {
  for (const [status, expected] of [[404, 'collection_not_found'], [503, 'unreadable']] as const) {
    const mock = installFetchMock((): MockResult => ({ status, json: {} }));
    try {
      const { registry, reason } = await loadSkillRegistry('coll-1');
      assert.equal(registry, null);
      assert.equal(reason, expected, `HTTP ${status} must be reported as ${expected}`);
    } finally {
      mock.restore();
    }
  }
});

test('loadSkillRegistry reports unreadable when the registry document has no text', async () => {
  const mock = installFetchMock((url): MockResult => {
    if (url.includes('/children')) {
      return { json: { nodes: [promptNode('reg-1', 'Skill Registry')], pagination: { total: 1, from: 0, count: 1 } } };
    }
    return { status: 403, json: {} };   // neither the download nor /textContent answers
  });
  try {
    const { registry, reason } = await loadSkillRegistry('coll-1');
    assert.equal(reason, 'unreadable');
    // The record was found; saying "no registry" would be a different, wrong claim.
    assert.equal(registry?.registryNodeId, 'reg-1');
    assert.equal(registry?.markdown, null);
  } finally {
    mock.restore();
  }
});

test('loadSkillRegistry discloses that several candidates were in play', async () => {
  const markdown = kiSkillBlock('Fragen generieren', SKILL_A);
  const mock = installFetchMock((url): MockResult => {
    if (url.includes('/children')) {
      return { json: {
        nodes: [promptNode('reg-b', 'Zweiter Prompt'), promptNode('reg-a', 'Erster Prompt')],
        pagination: { total: 2, from: 0, count: 2 },
      } };
    }
    if (url.includes('/eduservlet/download')) return { text: markdown };
    return { json: {} };
  });
  try {
    const { registry } = await loadSkillRegistry('coll-1', { resolveHeads: false });
    assert.equal(registry?.registryNodeId, 'reg-a');
    assert.deepEqual(registry?.ambiguous, { candidates: 2, chosen: 'reg-a' });
  } finally {
    mock.restore();
  }
});
