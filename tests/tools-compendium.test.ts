import { test } from 'node:test';
import assert from 'node:assert/strict';

import { assertRejectsWithoutUpstream, connectedClient, installFetchMock, makeNode } from './fetchMock.js';
import { contentTextSchema } from '../src/apps/outputSchemas.js';
import { renderReading } from '../src/apps/widgets/reading/render.js';

function metadataMock() {
  return installFetchMock((url) => {
    if (url.includes('/metadata') && url.includes('coll-1')) {
      return { json: { node: makeNode('coll-1', 'Sammlung Optik', {
        'cm:name': ['Sammlung Optik'],
        'ccm:oeh_collection_compendium_text': ['Die Optik behandelt Licht und Sehen.'],
      }) } };
    }
    return { json: {} };
  });
}

test('get_compendium_text: markdown output includes the full compendium text', async () => {
  const mock = metadataMock();
  const client = await connectedClient();
  try {
    const result = await client.callTool({ name: 'get_compendium_text', arguments: { nodeId: 'coll-1' } });
    const text = (result.content as Array<{ type: string; text: string }>)[0]?.text ?? '';
    assert.match(text, /Sammlung Optik/);
    assert.match(text, /Die Optik behandelt Licht und Sehen\./);
  } finally {
    await client.close();
    mock.restore();
  }
});

test('get_compendium_text: json output returns {entries}', async () => {
  const mock = metadataMock();
  const client = await connectedClient();
  try {
    const result = await client.callTool({
      name: 'get_compendium_text',
      arguments: { nodeIds: ['coll-1'], outputFormat: 'json' },
    });
    const text = (result.content as Array<{ type: string; text: string }>)[0]?.text ?? '';
    const parsed = JSON.parse(text);
    assert.equal(parsed.entries.length, 1);
    assert.equal(parsed.entries[0].nodeId, 'coll-1');
    assert.match(parsed.entries[0].compendiumText, /Licht und Sehen/);
  } finally {
    await client.close();
    mock.restore();
  }
});

test('get_compendium_text: errors when neither nodeId nor nodeIds is given', async () => {
  const client = await connectedClient();
  try {
    const result = await client.callTool({ name: 'get_compendium_text', arguments: {} });
    assert.equal(result.isError, true);
    const text = (result.content as Array<{ type: string; text: string }>)[0]?.text ?? '';
    assert.match(text, /nodeId/);
  } finally {
    await client.close();
  }
});

test('get_compendium_text: rejects more than 25 nodeIds (no network)', async () => {
  const client = await connectedClient();
  try {
    const tooMany = Array.from({ length: 26 }, (_, i) => `id-${i}`);
    await assertRejectsWithoutUpstream(
      client,
      'get_compendium_text',
      { nodeIds: tooMany },
      'expected 26 nodeIds to be rejected',
    );
  } finally {
    await client.close();
  }
});

// ── Rendering in the reading view (audit finding 2026-07-30) ────────────────
// The reading widget was built for "material full text OR editorial compendium
// prose" (its own header), yet the compendium tool returned neither
// structuredContent nor a widget — the one tool whose output IS long prose was
// the one that never rendered it.

test('one collection yields a reading payload the widget renders with its actions', async () => {
  const mock = metadataMock();
  const client = await connectedClient();
  try {
    const r = await client.callTool({ name: 'get_compendium_text', arguments: { nodeId: 'coll-1' } });
    const sc = contentTextSchema.parse(r.structuredContent);
    assert.equal(sc.nodeId, 'coll-1', 'the id travels, so the follow-up buttons have something to name');
    assert.match(sc.text, /Licht und Sehen/);
    const html = renderReading(sc as never, 'de', { canFollowUp: true });
    assert.doesNotMatch(html, /wlo-empty/, 'the reading view is not empty');
    assert.match(html, /wlo-reading__action/, 'and offers summarize / simplify / exercises');
  } finally { await client.close(); mock.restore(); }
});

test('a bulk fetch keeps every text and drops the per-node actions', async () => {
  // "Fasse DIESEN Inhalt zusammen" is ambiguous across several collections, so
  // the payload carries no nodeId — which is exactly what gates the buttons off.
  const mock = installFetchMock((url) => {
    const id = /coll-\d/.exec(url)?.[0];
    if (url.includes('/metadata') && id) {
      return { json: { node: makeNode(id, `Sammlung ${id}`, {
        'ccm:oeh_collection_compendium_text': [`Prosa zu ${id}.`],
      }) } };
    }
    return { json: {} };
  });
  const client = await connectedClient();
  try {
    const r = await client.callTool({ name: 'get_compendium_text', arguments: { nodeIds: ['coll-1', 'coll-2'] } });
    const sc = contentTextSchema.parse(r.structuredContent);
    assert.equal(sc.nodeId, '', 'no single node owns a bulk answer');
    assert.match(sc.text, /Prosa zu coll-1/);
    assert.match(sc.text, /Prosa zu coll-2/);
    assert.equal(sc.text, (r.content as Array<{ text: string }>)[0]?.text, 'payload and text output agree');
    const html = renderReading(sc as never, 'de', { canFollowUp: true });
    assert.doesNotMatch(html, /wlo-reading__action/, 'no per-node action on a bulk answer');
  } finally { await client.close(); mock.restore(); }
});


// ── Outline + targeted passages (2026-08-18) ─────────────────────────────────
// The compendium texts on staging run to 65 250 characters. Returning one whole
// answers a question nobody asked and buries the part that was asked about.

/** A document shaped like the real ones: one H1 title, content in H2/H3. */
const STRUCTURED = [
  '# Optik',
  '',
  'Kompendialer Text zum Themenbereich.',
  '',
  '## Strahlenoptik',
  '',
  'Der Lichtstrahl ist das Grundmodell der geometrischen Optik und beschreibt die '
    + 'Ausbreitung des Lichts entlang gerader Linien in einem homogenen Medium.',
  '',
  '### Brechung',
  '',
  'An der Grenzflaeche zweier Medien wird der Strahl gebrochen; das Brechungsgesetz '
    + 'verknuepft die Winkel mit den Ausbreitungsgeschwindigkeiten beider Medien.',
  '',
  '## Lehrplaene',
  '',
  'Der Lehrplan Sachsen verortet die Optik in der Mittelstufe, der Lehrplan '
    + 'Rheinland-Pfalz zusaetzlich in der Sekundarstufe II.',
].join('\n');

function textMock(compendium: string) {
  return installFetchMock((url) => {
    if (url.includes('/metadata') && url.includes('coll-1')) {
      return { json: { node: makeNode('coll-1', 'Sammlung Optik', {
        'cm:name': ['Sammlung Optik'],
        'ccm:oeh_collection_compendium_text': [compendium],
      }) } };
    }
    return { json: {} };
  });
}

async function callCompendium(args: Record<string, unknown>): Promise<{ text: string; result: Record<string, unknown> }> {
  const client = await connectedClient();
  try {
    const result = await client.callTool({ name: 'get_compendium_text', arguments: args });
    return { text: (result.content as Array<{ text: string }>)[0]?.text ?? '', result: result as never };
  } finally { await client.close(); }
}

test('without a query the outline comes first and the whole text follows', async () => {
  const mock = textMock(STRUCTURED);
  try {
    const { text } = await callCompendium({ nodeId: 'coll-1' });
    const outlineAt = text.indexOf('- Strahlenoptik');
    const bodyAt = text.indexOf('Grundmodell der geometrischen Optik');
    assert.ok(outlineAt >= 0 && bodyAt >= 0, 'both an outline and the text');
    assert.ok(outlineAt < bodyAt,
      'server-derived sections precede the untrusted document — after it they are '
      + 'indistinguishable from sections the document forged');
    assert.match(text, /Lehrplan Sachsen/, 'and nothing of the text is missing');
  } finally { mock.restore(); }
});

test('the outline lists sub-headings indented under their section', async () => {
  const mock = textMock(STRUCTURED);
  try {
    const { text } = await callCompendium({ nodeId: 'coll-1' });
    assert.match(text, /^- Strahlenoptik$/m);
    assert.match(text, /^ {2}- Brechung$/m, 'depth is what tells a reader it is a sub-section');
    assert.doesNotMatch(text, /^- Optik$/m,
      'the single H1 is the document title, not a section — the block heading already carries it');
  } finally { mock.restore(); }
});

test('a query returns the matching passages under their heading path, not the whole text', async () => {
  const mock = textMock(STRUCTURED);
  try {
    const { text } = await callCompendium({ nodeId: 'coll-1', query: 'Lehrplan Sachsen' });
    assert.match(text, /Lehrplan Sachsen verortet/);
    assert.doesNotMatch(text, /Grundmodell der geometrischen Optik/,
      'the passage that does not answer stays out');
    assert.match(text, /Lehrplaene/, 'the path names where the passage came from');
    assert.match(text, /Strahlenoptik/, 'and the outline still says what else is in there');
  } finally { mock.restore(); }
});

test('query words that occur nowhere in the text are named', async () => {
  // Measured on the real Optik text: "Lehrplan Thueringen Regelschule" scores
  // through `lehrplan` alone and fills the answer with Rheinland-Pfalz. Without
  // this line it reads as an answer to the question that was asked.
  const mock = textMock(STRUCTURED);
  try {
    const { text } = await callCompendium({ nodeId: 'coll-1', query: 'Lehrplan Thueringen Regelschule' });
    assert.match(text, /thueringen/i);
    assert.match(text, /regelschule/i);
  } finally { mock.restore(); }
});

test('a query that matches nothing is not an error and still shows the outline', async () => {
  const mock = textMock(STRUCTURED);
  try {
    const { text, result } = await callCompendium({ nodeId: 'coll-1', query: 'Quantenfeldtheorie' });
    assert.notEqual(result['isError'], true, 'a miss is an answer, not a failure');
    assert.match(text, /Strahlenoptik/, 'the outline is how a caller finds the word that works');
    assert.doesNotMatch(text, /Grundmodell der geometrischen Optik/,
      'and it must not quietly fall back to the full text — that answers another question');
  } finally { mock.restore(); }
});

test('each main section is capped on its own, and the answer says so', async () => {
  const long = ['## Kurz', '', 'knapp', '', '## Lang', '',
    Array.from({ length: 400 }, () => 'Wort').join(' ')].join('\n');
  const mock = textMock(long);
  try {
    const { text, result } = await callCompendium({ nodeId: 'coll-1' });
    assert.match(text, /knapp/, 'a short section is untouched');
    assert.match(text, /gek.rzt/i, 'the cut is disclosed');
    const sc = contentTextSchema.parse(result['structuredContent']);
    assert.equal(sc.truncated, true);
    assert.equal(sc.charCount, long.length, 'charCount is the length BEFORE the cut');
  } finally { mock.restore(); }
});

test('a heading carrying a line terminator produces no outline entry at all', async () => {
  // The forgery this rules out: a title that renders as two lines, the second
  // of which looks like an outline entry nobody wrote. Measured — the line is
  // not recognised as a heading in the first place, because JavaScript's `.`
  // excludes \r as well as \n. So the outline is short, never wrong.
  const doc = ['## Echt\r- Gefaelschter Eintrag', '', 'Inhalt eins.', '', '## Zweit', '', 'Inhalt zwei.']
    .join('\n');
  const mock = textMock(doc);
  try {
    const { text } = await callCompendium({ nodeId: 'coll-1' });
    // Scoped to the OUTLINE. The document's own bytes are reproduced verbatim
    // below it — that is what "untrusted document" means, and it is why the
    // server-derived part goes first.
    const outline = text.slice(text.indexOf('## Inhalt'), text.indexOf('_Gesamttext'));
    assert.match(outline, /^- Zweit$/m, 'the well-formed heading is there');
    assert.doesNotMatch(outline, /Gefaelschter Eintrag/, 'and the forged one never entered');
    assert.doesNotMatch(outline, /Echt/, 'the malformed heading is no section either');
  } finally { mock.restore(); }
});

test('json output carries the outline, and the passages only when asked', async () => {
  const mock = textMock(STRUCTURED);
  try {
    const plain = JSON.parse((await callCompendium({ nodeId: 'coll-1', outputFormat: 'json' })).text);
    assert.ok(plain.entries[0].outline.length >= 2);
    assert.match(plain.entries[0].compendiumText, /Grundmodell/);
    assert.equal(plain.entries[0].passages, undefined, 'no query, no selection');

    const asked = JSON.parse((await callCompendium(
      { nodeId: 'coll-1', outputFormat: 'json', query: 'Lehrplan Thueringen' })).text);
    assert.ok(asked.entries[0].outline.length >= 2, 'the outline travels in both modes');
    assert.equal(asked.entries[0].passages.length >= 1, true);
    assert.deepEqual(asked.entries[0].unmatchedTerms, ['thueringen']);
    assert.equal(asked.entries[0].compendiumText, undefined,
      'the answer is the passages — carrying the full text beside them undoes the query');
  } finally { mock.restore(); }
});

test('a collection without a compendium text still answers, and says nothing is there', async () => {
  const mock = installFetchMock((url) => {
    if (url.includes('/metadata') && url.includes('coll-1')) {
      return { json: { node: makeNode('coll-1', 'Leer', { 'cm:name': ['Leer'] }) } };
    }
    return { json: {} };
  });
  try {
    const { text } = await callCompendium({ nodeId: 'coll-1', query: 'Lehrplan' });
    assert.match(text, /Kein Kompendiumstext/);
  } finally { mock.restore(); }
});
