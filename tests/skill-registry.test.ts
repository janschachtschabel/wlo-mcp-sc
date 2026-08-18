import { test } from 'node:test';
import assert from 'node:assert/strict';

import { REGISTRY_CONTEXT_MAX, REGISTRY_MAX, REGISTRY_SEARCH_MAX, loadSkillRegistry, pickRegistryNode, toRegistrySummary } from '../src/services/skill-registry.js';
import { formattedNodeSchema } from '../src/apps/outputSchemas.js';
import { formatNode } from '../src/formatter.js';
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

/**
 * The editorial team names the same document three ways. `skill_registry.md` is
 * what the guide asks for; `skill_katalog.md` is what staging actually carries
 * (measured 2026-08-12, see `skill-catalogue.ts`), and `skill_catalog.md` is the
 * English spelling of that. All three have to win the tie-break, or a collection
 * holding one alongside a second prompt document resolves alphabetically by
 * nodeId — a coin flip over which catalogue a model is handed.
 */
for (const name of ['skill_registry.md', 'SKILL_CATALOG.md', 'skill_katalog.md']) {
  test(`pickRegistryNode prefers the file named ${name}`, () => {
    const chosen = pickRegistryNode([
      promptNode('aaa-other', 'Irgendein Skill'),
      promptNode('zzz-reg', 'Noch ein Skill', { name }),
    ]);

    assert.equal(chosen?.node.ref?.id, 'zzz-reg', `${name} must name the registry outright`);
  });
}

test('pickRegistryNode prefers a title carrying Skillkatalog — the spelling staging uses', () => {
  // The live registry on the Optik collection is titled "Skillkatalog Physik
  // Optik" (2026-08-12). It wins today only because it is the sole candidate;
  // beside a second prompt document it would not mark itself at all.
  const chosen = pickRegistryNode([
    promptNode('aaa', 'Rückmeldung formulieren'),
    promptNode('zzz', 'Skillkatalog Physik Optik'),
  ]);

  assert.equal(chosen?.node.ref?.id, 'zzz');
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
 * at once.
 *
 * SUPERSEDED IN PART 2026-08-18: it used to be deliberately equal to
 * `REGISTRY_LINES_MAX` in `formatter.ts`, so that a listing always printed
 * everything it held. That constant is gone; what a RESULT prints is now bounded
 * by `REGISTRY_INLINE_MAX` (12 lines), independently of what the service hands
 * over. The equality below is still pinned — the two TIERS must agree on what
 * "the approved skills" are — but it no longer says anything about rendering.
 *
 * The TOOL tier is one explicit call about one collection, and it fetches one
 * metadata record per skill. There a hundred is affordable, and a curated list
 * of sixty should not be cut to thirty.
 */
test('the listing tier carries as many entries as the tool tier', () => {
  // Decided 2026-08-15: a collection answer hands over the approval list in
  // full, up to 100 — the listing no longer stops at 30 while the tool went on
  // to 100. The equality is pinned because a SENTENCE hangs on it: while the
  // listing was the narrower tier it could honestly say "mehr mit
  // get_skill_registry", and `formatter.ts` had to stop saying that. Raise one
  // without the other and that offer silently becomes true again — or, the
  // other way round, stays retracted when it no longer needs to be.
  assert.equal(REGISTRY_SEARCH_MAX, REGISTRY_MAX,
    'the two tiers carry the same number of entries — see registryLines() in formatter.ts');
});

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

// ── Kontexte: Überschriften gliedern den Katalog ─────────────────────────────

/**
 * A context is a section of level 2 or 3 WITH A NON-EMPTY TITLE. Everything else
 * is transparent: a block inside it belongs to the nearest NAMED context above
 * it, and if there is none, to the general part.
 *
 * One rule, two right answers — an untitled `##` at top level lands in the
 * general part, an untitled `###` inside a named H2 lands in that H2. Both match
 * where the editor actually wrote it. Dropping untitled sections instead would
 * have swallowed their skills.
 */

const cheap = { resolveHeads: false } as const;

test('two H2 sections yield two contexts, and every entry carries its path', async () => {
  const md = `# Katalog\n\n## Planung\n\n${kiSkillBlock('Stunde planen', uuid(1))}\n\n`
    + `${kiSkillBlock('Reihe planen', uuid(2))}\n\n## Material\n\n${kiSkillBlock('Blatt bauen', uuid(3))}\n`;
  const { mock } = registryMock(md);
  try {
    const { registry } = await loadSkillRegistry('coll-1', cheap);

    assert.deepEqual(registry?.contexts.map(c => c.path), ['Planung', 'Material']);
    assert.deepEqual(registry?.contexts.map(c => c.level), [2, 2]);
    assert.deepEqual(registry?.contexts.map(c => c.skills.length), [2, 1]);
    assert.deepEqual(registry?.entries.map(e => e.context), ['Planung', 'Planung', 'Material']);
    assert.deepEqual(registry?.general.skills, [], 'every skill sits in a context here');
  } finally { mock.restore(); }
});

test('an H3 becomes a sub-context whose path names its H2', async () => {
  const md = `## Planung\n\n${kiSkillBlock('Stunde', uuid(1))}\n\n### Wochenplanung\n\n${kiSkillBlock('Woche', uuid(2))}\n`;
  const { mock } = registryMock(md);
  try {
    const { registry } = await loadSkillRegistry('coll-1', cheap);

    assert.deepEqual(registry?.contexts.map(c => c.path), ['Planung', 'Planung/Wochenplanung']);
    assert.deepEqual(registry?.contexts.map(c => c.level), [2, 3]);
    assert.deepEqual(registry?.entries.map(e => e.context), ['Planung', 'Planung/Wochenplanung'],
      'the innermost named context wins, not the enclosing H2');
    assert.deepEqual(registry?.contexts[0]?.skills, [uuid(1)], 'the H2 keeps only its own skill');
  } finally { mock.restore(); }
});

test('a skill before the first H2 belongs to no context and lands in the general part', async () => {
  const md = `# Katalog\n\n${kiSkillBlock('Lehrprofil', uuid(1))}\n\n## Planung\n\n${kiSkillBlock('Stunde', uuid(2))}\n`;
  const { mock } = registryMock(md);
  try {
    const { registry } = await loadSkillRegistry('coll-1', cheap);

    assert.equal(registry?.entries[0]?.context, undefined);
    assert.equal(registry?.entries[1]?.context, 'Planung');
    assert.deepEqual(registry?.general.skills, [uuid(1)]);
  } finally { mock.restore(); }
});

test('a flat document declares no contexts at all — the state of every registry today', async () => {
  const md = `# Katalog\n\n${kiSkillBlock('Eins', uuid(1))}\n\n${kiSkillBlock('Zwei', uuid(2))}\n`;
  const { mock } = registryMock(md);
  try {
    const { registry } = await loadSkillRegistry('coll-1', cheap);

    assert.deepEqual(registry?.contexts, [], 'no contexts — the rendering must stay as it is today');
    assert.deepEqual(registry?.entries.map(e => e.context), [undefined, undefined]);
    assert.deepEqual(registry?.general.skills, [uuid(1), uuid(2)]);
  } finally { mock.restore(); }
});

test('a named section with no skill yet is still a context', async () => {
  // Measured 2026-08-18 against the real Optik document: the editors had written
  // `## Browserplugin` with its instruction and no skills yet — a group is
  // created before it is filled. Hiding it made the catalogue disagree with a
  // document anyone can read, and made `resolveContext` answer "unknown" for a
  // heading that is plainly there.
  const md = `## Browserplugin

Anweisungen fuer den Kontext Browserplugin.

`
    + `## Planung

${kiSkillBlock('Stunde', uuid(1))}
`;
  const { mock } = registryMock(md);
  try {
    const { registry } = await loadSkillRegistry('coll-1', cheap);

    assert.deepEqual(registry?.contexts.map(c => [c.path, c.skills.length]),
      [['Browserplugin', 0], ['Planung', 1]]);
    assert.equal(registry?.contexts[0]?.instruction, 'Anweisungen fuer den Kontext Browserplugin.',
      'an empty group still has something to say');
  } finally { mock.restore(); }
});

test('an untitled H2 is no context, and its skills stay general', async () => {
  const md = `## Planung\n\n${kiSkillBlock('Stunde', uuid(1))}\n\n##\n\n${kiSkillBlock('Frei', uuid(2))}\n`;
  const { mock } = registryMock(md);
  try {
    const { registry } = await loadSkillRegistry('coll-1', cheap);

    assert.deepEqual(registry?.contexts.map(c => c.path), ['Planung'],
      'a section nobody can name by title is not addressable, so it is not offered');
    assert.deepEqual(registry?.general.skills, [uuid(2)], 'but its skill is kept, not dropped');
    assert.equal(registry?.entries[1]?.context, undefined);
  } finally { mock.restore(); }
});

test('an untitled H3 inside a named H2 hands its skills to that H2', async () => {
  // Same rule as above, opposite outcome — and both are right: what decides is
  // the nearest NAMED context above the block.
  const md = `## Planung\n\n${kiSkillBlock('Stunde', uuid(1))}\n\n###\n\n${kiSkillBlock('Woche', uuid(2))}\n`;
  const { mock } = registryMock(md);
  try {
    const { registry } = await loadSkillRegistry('coll-1', cheap);

    assert.deepEqual(registry?.contexts.map(c => c.path), ['Planung']);
    assert.deepEqual(registry?.entries.map(e => e.context), ['Planung', 'Planung']);
    assert.deepEqual(registry?.general.skills, []);
  } finally { mock.restore(); }
});

test('a general skill does not migrate into the context that follows it', async () => {
  const md = `##\n\n${kiSkillBlock('Frei', uuid(1))}\n\n## Planung\n\n${kiSkillBlock('Stunde', uuid(2))}\n`;
  const { mock } = registryMock(md);
  try {
    const { registry } = await loadSkillRegistry('coll-1', cheap);
    assert.deepEqual(registry?.general.skills, [uuid(1)]);
    assert.deepEqual(registry?.contexts[0]?.skills, [uuid(2)]);
  } finally { mock.restore(); }
});

test('more contexts than the cap are reported as capped, not silently cut', async () => {
  const sections = Array.from({ length: REGISTRY_CONTEXT_MAX + 5 },
    (_, i) => `## Kontext ${i}\n\n${kiSkillBlock(`Skill ${i}`, uuid(i + 1))}`).join('\n\n');
  const { mock } = registryMock(`# Katalog\n\n${sections}\n`);
  try {
    const { registry } = await loadSkillRegistry('coll-1', cheap);

    assert.equal(registry?.contexts.length, REGISTRY_CONTEXT_MAX);
    assert.deepEqual(registry?.contextsTruncated, { listed: REGISTRY_CONTEXT_MAX, found: REGISTRY_CONTEXT_MAX + 5 });
  } finally { mock.restore(); }
});

// ── Die Anweisung der Redaktion ──────────────────────────────────────────────

test('the lead prose is the instruction; what follows a block belongs to that skill', async () => {
  const md = `## Planung\n\nZuerst /lehrprofil aufrufen.\n\n${kiSkillBlock('Stunde', uuid(1))}\n\n`
    + 'Plant eine Einzelstunde als Verlaufsplan.\n';
  const { mock } = registryMock(md);
  try {
    const { registry } = await loadSkillRegistry('coll-1', cheap);
    assert.equal(registry?.contexts[0]?.instruction, 'Zuerst /lehrprofil aufrufen.');
  } finally { mock.restore(); }
});

test('a section with no block at all does not lend its prose to the next context', async () => {
  const md = `## Planung\n\nZeile eins.\n\nZeile zwei.\n\n## Material\n\n${kiSkillBlock('Blatt', uuid(1))}\n`;
  const { mock } = registryMock(md);
  try {
    const { registry } = await loadSkillRegistry('coll-1', cheap);
    // Both are contexts now; what this pins is that "Material" did not absorb
    // the prose of its predecessor.
    assert.deepEqual(registry?.contexts.map(c => c.path), ['Planung', 'Material']);
    assert.equal(registry?.contexts[0]?.instruction, `Zeile eins.

Zeile zwei.`,
      'a section with no block contributes all of its prose');
    assert.equal(registry?.contexts[1]?.instruction, undefined);
  } finally { mock.restore(); }
});

test('a context whose block follows immediately carries no instruction — not an empty one', async () => {
  const md = `## Planung\n\n${kiSkillBlock('Stunde', uuid(1))}\n`;
  const { mock } = registryMock(md);
  try {
    const { registry } = await loadSkillRegistry('coll-1', cheap);
    assert.equal(registry?.contexts[0]?.instruction, undefined,
      'an empty string would render as an instruction that says nothing');
  } finally { mock.restore(); }
});

test('an H2 instruction ends at its first H3, not at its first block', async () => {
  // Without this the H2 — which has no block of its own — would pull the H3
  // heading and the H3's prose into its own instruction.
  const md = `## Planung\n\nGilt für alles darunter.\n\n### Woche\n\nNur für die Woche.\n\n${kiSkillBlock('Woche', uuid(1))}\n`;
  const { mock } = registryMock(md);
  try {
    const { registry } = await loadSkillRegistry('coll-1', cheap);

    const h2 = registry?.contexts.find(c => c.path === 'Planung');
    const h3 = registry?.contexts.find(c => c.path === 'Planung/Woche');
    assert.equal(h2?.instruction, 'Gilt für alles darunter.');
    assert.equal(h3?.instruction, 'Nur für die Woche.');
  } finally { mock.restore(); }
});

test('the prose before the first H2 becomes the general instruction', async () => {
  // The real document opens exactly like this: what the catalogue is, where it
  // comes from, under which licence.
  const md = '# Skillkatalog\n\nKatalog der KI-Skills für diese Sammlung.\n\n'
    + `Bezugsquelle: WLO · Lizenz: CC BY 4.0\n\n## Planung\n\n${kiSkillBlock('Stunde', uuid(1))}\n`;
  const { mock } = registryMock(md);
  try {
    const { registry } = await loadSkillRegistry('coll-1', cheap);

    assert.match(registry?.general.instruction ?? '', /Katalog der KI-Skills/);
    assert.match(registry?.general.instruction ?? '', /CC BY 4\.0/);
    assert.ok(!/Planung/.test(registry?.general.instruction ?? ''), 'it stops at the first context');
  } finally { mock.restore(); }
});

test('the prose of an untitled section is appended to the general instruction', async () => {
  const md = `# Katalog\n\nOben.\n\n## Planung\n\n${kiSkillBlock('Stunde', uuid(1))}\n\n##\n\nAuch allgemein.\n`;
  const { mock } = registryMock(md);
  try {
    const { registry } = await loadSkillRegistry('coll-1', cheap);

    assert.match(registry?.general.instruction ?? '', /Oben\./);
    assert.match(registry?.general.instruction ?? '', /Auch allgemein\./,
      'an unnameable section still has something to say');
  } finally { mock.restore(); }
});

test('a context that only groups is listed, and its count stays with the sub-context', async () => {
  // "Planung" holds no skill of its own — its one skill sits in "Woche". It is
  // listed all the same, because otherwise "Planung/Woche" would name a parent
  // the catalogue does not carry. But it counts zero: a parent and its child
  // must not report the same skill twice, and what "Planung" holds is on the
  // very next line.
  const md = `## Planung\n\nGilt für alles darunter.\n\n### Woche\n\n${kiSkillBlock('Woche', uuid(1))}\n`;
  const { mock } = registryMock(md);
  try {
    const { registry } = await loadSkillRegistry('coll-1', cheap);

    assert.deepEqual(registry?.contexts.map(c => [c.path, c.skills.length]),
      [['Planung', 0], ['Planung/Woche', 1]]);
    assert.equal(registry?.contexts[0]?.instruction, 'Gilt für alles darunter.',
      'a grouping context is exactly where a shared instruction belongs');
  } finally { mock.restore(); }
});

test('a block whose reference names no record still shapes the outline', async () => {
  // A `::: ki-skill` block without a repository URL is `unresolved`, never an
  // entry — but it is what makes its section a context. Ignoring it would drop
  // the heading, and with it the editors' instruction for a group they filled.
  const md = '## Planung\n\nZuerst /lehrprofil.\n\n::: ki-skill\n[Noch ohne Ziel](https://extern.example)\n:::\n';
  const { mock } = registryMock(md);
  try {
    const { registry } = await loadSkillRegistry('coll-1', cheap);

    assert.deepEqual(registry?.contexts.map(c => c.path), ['Planung']);
    assert.deepEqual(registry?.contexts[0]?.skills, [], 'no nodeId, so nothing to list');
    assert.equal(registry?.contexts[0]?.instruction, 'Zuerst /lehrprofil.');
    assert.equal(registry?.unresolved.length, 1);
  } finally { mock.restore(); }
});

// ── Was ein Trefferknoten von den Kontexten trägt ────────────────────────────

test('the node summary carries the context names and counts — and no instruction', async () => {
  // The instruction is the token bomb: seven groups of up to 1200 characters in
  // EVERY collection hit. It stays behind the targeted call.
  const md = `## Planung\n\nZuerst /lehrprofil aufrufen.\n\n${kiSkillBlock('Stunde', uuid(1))}\n\n`
    + `## Material\n\n${kiSkillBlock('Blatt', uuid(2))}\n\n${kiSkillBlock('Video', uuid(3))}\n`;
  const { mock } = registryMock(md);
  try {
    const { registry } = await loadSkillRegistry('coll-1', cheap);
    const summary = toRegistrySummary(registry!);

    assert.deepEqual(summary.contexts, [{ path: 'Planung', skills: 1 }, { path: 'Material', skills: 2 }]);
    assert.ok(!JSON.stringify(summary).includes('lehrprofil'),
      'no instruction text may ride along on a search result');
  } finally { mock.restore(); }
});

test('a registry without contexts carries no contexts field at all', async () => {
  // Absent, not `[]`: every registry written before 2026-08-18 is flat, and an
  // empty array would show up in structuredContent where nothing was before.
  const md = `# Katalog\n\n${kiSkillBlock('Eins', uuid(1))}\n`;
  const { mock } = registryMock(md);
  try {
    const { registry } = await loadSkillRegistry('coll-1', cheap);
    const summary = toRegistrySummary(registry!);
    assert.ok(!('contexts' in summary), 'a flat registry must render exactly as it does today');
  } finally { mock.restore(); }
});

test('the contexts field survives the output schema', async () => {
  // A separate assertion on purpose: zod strips what is not declared, so a field
  // can be right in the text and gone from structuredContent with nothing
  // failing. Asserting the summary object alone would not notice.
  const md = `## Planung\n\n${kiSkillBlock('Stunde', uuid(1))}\n`;
  const { mock } = registryMock(md);
  try {
    const { registry } = await loadSkillRegistry('coll-1', cheap);
    // Through `formatNode`, not a hand-built literal: the schema has twenty
    // required fields, and a fixture that lists them itself would go stale
    // against the very shape it is meant to check.
    const parsed = formattedNodeSchema.parse({
      ...formatNode(makeNode('n-1', 'Sammlung')),
      nodeType: 'collection',
      skillRegistry: toRegistrySummary(registry!),
    });
    assert.deepEqual(parsed.skillRegistry?.contexts, [{ path: 'Planung', skills: 1 }]);
  } finally { mock.restore(); }
});

test('an outline costs nothing: the cheap tier still runs on exactly two calls', async () => {
  // THE promise of this whole package. Contexts, their instructions and the
  // per-entry grouping are all read out of a document the cheap tier already
  // downloads — so a registry with seven groups costs a collection search
  // exactly what a flat one costs, and that is two requests.
  const md = `# Katalog\n\nAllgemeine Vorrede.\n\n## Planung\n\nZuerst /lehrprofil.\n\n`
    + `${kiSkillBlock('Stunde', uuid(1))}\n\n### Woche\n\n${kiSkillBlock('Woche', uuid(2))}\n\n`
    + `## Material\n\n${kiSkillBlock('Blatt', uuid(3))}\n`;
  const { mock, counts } = registryMock(md);
  try {
    const { registry } = await loadSkillRegistry('coll-1', cheap);

    assert.equal(counts.children, 1, 'one children listing');
    assert.equal(counts.download, 1, 'one document read');
    assert.equal(counts.metadata, 0, 'no skill head is fetched — not even to learn its group');

    // And the cheap tier is not a lesser tier for contexts: it carries the whole
    // outline. Only description and keywords stay behind with the tool.
    assert.deepEqual(registry?.contexts.map(c => c.path), ['Planung', 'Planung/Woche', 'Material']);
    assert.deepEqual(registry?.entries.map(e => e.context), ['Planung', 'Planung/Woche', 'Material']);
    assert.equal(registry?.contexts[0]?.instruction, 'Zuerst /lehrprofil.');
    assert.match(registry?.general.instruction ?? '', /Allgemeine Vorrede/);
    assert.equal(registry?.entries[0]?.description, undefined, 'the cheap tier still carries no head');
  } finally { mock.restore(); }
});

test('the tool tier stamps the same contexts onto its richer entries', async () => {
  // Two code paths build entries — cheap from the block, tool from the record.
  // The context is the DOCUMENT's word in both, so it must not go missing on the
  // path that fetches more.
  const md = `## Planung\n\n${kiSkillBlock('Stunde', uuid(1))}\n\n## Material\n\n${kiSkillBlock('Blatt', uuid(2))}\n`;
  const { mock } = registryMock(md, {
    [uuid(1)]: { title: 'Stunde planen', desc: 'Plant eine Stunde.', keywords: ['Planung'] },
    [uuid(2)]: { title: 'Blatt bauen', desc: 'Baut ein Blatt.', keywords: ['Material'] },
  });
  try {
    const { registry } = await loadSkillRegistry('coll-1');

    assert.deepEqual(registry?.entries.map(e => e.context), ['Planung', 'Material']);
    assert.equal(registry?.entries[0]?.description, 'Plant eine Stunde.', 'and the head is there too');
  } finally { mock.restore(); }
});
