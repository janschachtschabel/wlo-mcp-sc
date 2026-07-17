import { test } from 'node:test';
import assert from 'node:assert/strict';

import { parseFields, PROJECTABLE_FIELDS } from '../src/rest/validate.js';
import { projectEnvelope } from '../src/rest/project.js';

test('parseFields returns undefined (no projection) when the param is absent/blank', () => {
  assert.deepEqual(parseFields(null), { ok: true, value: undefined });
  assert.deepEqual(parseFields('   '), { ok: true, value: undefined });
});

test('parseFields keeps the valid subset and always includes nodeId', () => {
  assert.deepEqual(parseFields('title,url'), { ok: true, value: ['nodeId', 'title', 'url'] });
});

test('parseFields ignores unknown field names but keeps the valid ones', () => {
  assert.deepEqual(parseFields('title,bogus,publisher'), { ok: true, value: ['nodeId', 'title', 'publisher'] });
});

test('parseFields does not duplicate nodeId when it is requested explicitly', () => {
  assert.deepEqual(parseFields('nodeId,title'), { ok: true, value: ['nodeId', 'title'] });
});

test('parseFields errors when no requested field is valid (self-correcting)', () => {
  const r = parseFields('foo,bar');
  assert.equal(r.ok, false);
  assert.match(r.ok === false ? r.error : '', /subset of:/);
});

test('PROJECTABLE_FIELDS covers the common list fields', () => {
  for (const f of ['nodeId', 'title', 'description', 'url', 'publisher']) {
    assert.ok(PROJECTABLE_FIELDS.has(f), `expected ${f} to be projectable`);
  }
});

const sampleEnvelope = {
  query: 'x',
  content: {
    total: 42,
    count: 1,
    results: [{ nodeId: 'a', title: 'T', description: 'D', url: 'u', publisher: 'P' }],
  },
  collections: { total: 0, count: 0, results: [] },
  topicPages: { total: 0, count: 0, results: [] },
  wikipedia: { title: 'W' },
} as unknown as Parameters<typeof projectEnvelope>[0];

test('projectEnvelope trims result items to the requested fields', () => {
  const out = projectEnvelope(sampleEnvelope, ['nodeId', 'title', 'url']);
  assert.deepEqual(out.content.results[0], { nodeId: 'a', title: 'T', url: 'u' });
});

test('projectEnvelope preserves envelope meta (totals, counts, query, wikipedia)', () => {
  const out = projectEnvelope(sampleEnvelope, ['nodeId', 'title']);
  assert.equal(out.query, 'x');
  assert.equal(out.content.total, 42);
  assert.equal(out.content.count, 1);
  assert.deepEqual(out.wikipedia, { title: 'W' });
});

test('projectEnvelope only emits fields actually present on the item', () => {
  const out = projectEnvelope(sampleEnvelope, ['nodeId', 'title', 'downloadUrl']);
  assert.deepEqual(out.content.results[0], { nodeId: 'a', title: 'T' });
});

test('projectEnvelope omits wikipedia when the source envelope has none', () => {
  const noWiki = { ...sampleEnvelope, wikipedia: undefined } as Parameters<typeof projectEnvelope>[0];
  const out = projectEnvelope(noWiki, ['nodeId']);
  assert.equal('wikipedia' in out, false);
});
