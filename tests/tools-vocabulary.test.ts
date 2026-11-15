import { test } from 'node:test';
import assert from 'node:assert/strict';

import { connectedClient, toolText } from './fetchMock.js';

import { QUALITY_SCALE_FIELDS, validateField } from '../src/services/write/fields.js';
import { scaleEntry, scaleKeys } from '../src/vocabs-quality-scale.js';

// ── universitySubject (Stage 2): model-free fuzzy disambiguation ──────────────

test('lookup_wlo_vocabulary universitySubject + query returns candidates with usable URIs', async () => {
  const client = await connectedClient();
  try {
    const result = await client.callTool({
      name: 'lookup_wlo_vocabulary',
      arguments: { vocabulary: 'universitySubject', query: 'Maschinenbau' },
    });
    const text = toolText(result);
    assert.match(text, /Maschinenbau\/Verfahrenstechnik/);
    assert.match(text, /hochschulfaechersystematik\/n63/); // the real ccm:taxonid URI
  } finally {
    await client.close();
  }
});

test('lookup_wlo_vocabulary universitySubject without query asks for a search term', async () => {
  const client = await connectedClient();
  try {
    const result = await client.callTool({
      name: 'lookup_wlo_vocabulary',
      arguments: { vocabulary: 'universitySubject' },
    });
    const text = toolText(result);
    assert.match(text, /query/i);       // guidance: pass a query to narrow the large vocab
    assert.match(text, /344/);          // the vocabulary size is named
  } finally {
    await client.close();
  }
});

test('lookup_wlo_vocabulary discipline still lists the school subjects (unchanged)', async () => {
  const client = await connectedClient();
  try {
    const result = await client.callTool({
      name: 'lookup_wlo_vocabulary',
      arguments: { vocabulary: 'discipline' },
    });
    const text = toolText(result);
    assert.match(text, /Mathematik/);
    assert.match(text, /vocabs\/discipline\//); // school-subject URIs, not university
  } finally {
    await client.close();
  }
});

// ── The quality vocabularies (2026-08-18/19) ─────────────────────────────────
// Both exist for the WRITE surface, not for filtering: these fields answer
// HTTP 400 as an ngsearch criterion. Until this test they had no coverage at
// all, which is how the scale half came to be promised by two messages and
// served by none.

test('lookup_wlo_vocabulary qualityFinding lists the verdicts a model may write', async () => {
  const client = await connectedClient();
  try {
    const text = toolText(await client.callTool({
      name: 'lookup_wlo_vocabulary',
      arguments: { vocabulary: 'qualityFinding' },
    }));
    assert.match(text, /keine Auffälligkeiten gefunden \(Maschine\)/);
    // The human verdicts stay in the vocabulary — the lookup must not misreport
    // what the repository holds; only WRITING them is closed (write/fields.ts).
    assert.match(text, /Auffälligkeiten gefunden \(Mensch\)/);
  } finally {
    await client.close();
  }
});

test('lookup_wlo_vocabulary qualityScale names every position of every writable scale', async () => {
  const client = await connectedClient();
  try {
    const text = toolText(await client.callTool({
      name: 'lookup_wlo_vocabulary',
      arguments: { vocabulary: 'qualityScale' },
    }));
    for (const property of QUALITY_SCALE_FIELDS) {
      assert.ok(text.includes(property), `${property} fehlt im Skalen-Verzeichnis`);
      for (const key of scaleKeys(property)) {
        const caption = scaleEntry(property, key)?.caption ?? '';
        assert.ok(text.includes(caption),
          `${property}: Stufe ${key} („${caption}“) fehlt`);
      }
    }
  } finally {
    await client.close();
  }
});

test('every listed scale names the parameter that writes it', async () => {
  // A caption a caller cannot act on is half an answer: the properties are not
  // the tool's parameter names, and guessing the mapping is the next failure.
  //
  // Over EVERY scale, not two by name: a tenth scale added to the write surface
  // without an entry in CONTENT_FIELDS renders as a bare property, and a
  // spot-check of two names stays green while exactly the promise this listing
  // exists for goes missing. The expected name is deliberately not derived from
  // CONTENT_FIELDS here — that would assert the implementation against itself;
  // what is asserted is that SOME parameter is named, plus one literal name,
  // because a model-facing parameter name is API and worth pinning.
  const client = await connectedClient();
  try {
    const lines = toolText(await client.callTool({
      name: 'lookup_wlo_vocabulary',
      arguments: { vocabulary: 'qualityScale' },
    })).split('\n');
    const nameless = QUALITY_SCALE_FIELDS.filter(property => {
      const entry = lines.find(l => l.startsWith('- ') && l.includes(`(${property})`));
      return !entry || !/Parameter: \w+/.test(entry);
    });
    assert.deepEqual(nameless, [], 'gelistet, aber ohne Kuratier-Parameter');
    assert.ok(lines.some(l => l.includes('Parameter: qualityDidactics')));
  } finally {
    await client.close();
  }
});

test('a refused scale position points at a lookup that actually answers', async () => {
  // The guard for the defect this test was written after: both the refusal
  // (write/fields.ts) and the parameter description named `lookup_wlo_vocabulary`
  // for the captions, and that tool had no scale vocabulary at all — so the one
  // recovery path a model is given ended in a second error.
  const refusal = validateField('ccm:oeh_quality_didactics', '99');
  assert.equal(refusal.ok, false);
  const reason = refusal.ok ? '' : refusal.reason;
  const named = reason.match(/\b(lookup_wlo_\w+)\b/)?.[1];
  assert.ok(named, `die Ablehnung nennt kein Werkzeug: ${reason}`);

  const client = await connectedClient();
  try {
    const { tools } = await client.listTools();
    const tool = tools.find(t => t.name === named);
    assert.ok(tool, `${named} ist nicht registriert`);
    const values = (tool.inputSchema as { properties?: Record<string, { enum?: string[] }> })
      .properties?.['vocabulary']?.enum ?? [];
    // Whichever value serves the scales, ONE of them must return the caption the
    // refusal says is acceptable input.
    const answers = await Promise.all(values.map(async (v) =>
      toolText(await client.callTool({ name: named, arguments: { vocabulary: v } }))));
    assert.ok(answers.some(a => a.includes('✰✰✰ gute Methodik')),
      `keiner der Werte ${values.join(', ')} nennt die Beschriftungen der Skala`);
  } finally {
    await client.close();
  }
});

test('the vocabulary parameter description names every value it accepts', async () => {
  // `qualityFinding` was accepted by the enum and absent from the description a
  // model reads to choose. A value nobody is told about is a value nobody uses.
  const client = await connectedClient();
  try {
    const { tools } = await client.listTools();
    const schema = tools.find(t => t.name === 'lookup_wlo_vocabulary')?.inputSchema as
      { properties?: Record<string, { enum?: string[]; description?: string }> };
    const field = schema.properties?.['vocabulary'];
    const missing = (field?.enum ?? []).filter(v => !(field?.description ?? '').includes(v));
    assert.deepEqual(missing, [], 'im Enum, aber nicht in der Beschreibung');
  } finally {
    await client.close();
  }
});
