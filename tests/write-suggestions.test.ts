/**
 * write-suggestions.test.ts – the /suggestions/v1 client.
 *
 * The endpoint is a staging area for proposals, not a mechanism that applies
 * them: measured on staging 2026-08-01, a suggestion moved to ACCEPTED left the
 * node's property absent. Applying stays the caller's job, which is why this
 * module writes nothing to a node.
 *
 * The asymmetry between POST and GET is the trap worth a test of its own: POST
 * answers with an array, GET with a map keyed by propertyId. A reader written
 * for the POST shape reports "keine Vorschläge" for a node that has several —
 * an answer that is wrong rather than empty.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { installFetchMock } from './fetchMock.js';
import {
  createSuggestions,
  listSuggestions,
  setSuggestionStatus,
} from '../src/services/write/suggestions.js';

const NODE = '8e3f1a20-1111-4c33-9f10-aaaabbbbcccc';

function suggestion(id: string, propertyId: string, value: string, status = 'PENDING') {
  return { id, propertyId, value, status, description: 'Vom Modell vorgeschlagen', confidence: 0.8 };
}

test('storing proposals posts an array and declares them as AI-authored', async () => {
  const mock = installFetchMock(() => ({ json: [suggestion('s-1', 'cclom:title', 'Neuer Titel')] }));
  try {
    const result = await createSuggestions(NODE, [
      { propertyId: 'cclom:title', value: 'Neuer Titel', description: 'Der alte Titel nennt das Thema nicht.' },
    ]);
    assert.equal(result.ok, true);
    assert.equal(result.ok && result.suggestions.length, 1);
    assert.equal(result.ok && result.suggestions[0]?.id, 's-1');

    const call = mock.calls[0]!;
    assert.match(call.url, /\/suggestions\/v1\/-home-\//);
    assert.match(call.url, /type=AI/, 'the provenance is fixed at creation and cannot be changed later');
    assert.match(call.url, /version=/, 'the endpoint requires a version');
    assert.equal(call.init?.method, 'POST');

    const body = JSON.parse(String(call.init?.body));
    assert.ok(Array.isArray(body), 'measured: the body is an array of CreateSuggestionRequestDTO');
    assert.equal(body[0].propertyId, 'cclom:title');
    assert.equal(body[0].value, 'Neuer Titel');
    assert.match(body[0].description, /Thema/);
  } finally {
    mock.restore();
  }
});

test('a rejected POST is reported with its detail, not swallowed', async () => {
  const mock = installFetchMock(() => ({ status: 403, json: { message: 'no permission' } }));
  try {
    const result = await createSuggestions(NODE, [
      { propertyId: 'cclom:title', value: 'x', description: 'y' },
    ]);
    assert.equal(result.ok, false);
    assert.match(result.ok === false ? result.detail : '', /403/);
  } finally {
    mock.restore();
  }
});

test('reading understands the map shape the GET actually returns', async () => {
  // This is the measured trap: POST answers with an array, GET with a map keyed
  // by propertyId. Reading it as an array finds nothing.
  const mock = installFetchMock(() => ({
    json: {
      nodeId: NODE,
      suggestions: {
        'cclom:general_description': [suggestion('s-1', 'cclom:general_description', 'Eine Beschreibung')],
        'cclom:general_keyword': [
          suggestion('s-2', 'cclom:general_keyword', 'Photosynthese'),
          suggestion('s-3', 'cclom:general_keyword', 'Biologie'),
        ],
      },
    },
  }));
  try {
    const found = await listSuggestions(NODE);
    assert.equal(found.length, 3, 'all three, flattened out of the map');
    assert.deepEqual(found.map(s => s.id).sort(), ['s-1', 's-2', 's-3']);
    assert.equal(found.find(s => s.id === 's-2')?.propertyId, 'cclom:general_keyword');
  } finally {
    mock.restore();
  }
});

test('reading also understands the array shape the POST returns', async () => {
  const mock = installFetchMock(() => ({ json: [suggestion('s-9', 'cclom:title', 'Titel')] }));
  try {
    const found = await listSuggestions(NODE);
    assert.equal(found.length, 1);
  } finally {
    mock.restore();
  }
});

test('an unreadable node throws instead of answering "no suggestions"', async () => {
  // An empty list is a claim: "there is nothing to review". When the truth is
  // "we could not look", that claim sends a curator away from work that exists.
  const mock = installFetchMock(() => ({ status: 500, json: {} }));
  try {
    await assert.rejects(() => listSuggestions(NODE), /500|nicht/);
  } finally {
    mock.restore();
  }
});

test('a status filter is passed upstream rather than applied locally', async () => {
  const mock = installFetchMock(() => ({ json: { nodeId: NODE, suggestions: {} } }));
  try {
    await listSuggestions(NODE, 'PENDING');
    assert.match(mock.calls[0]!.url, /status=PENDING/);
  } finally {
    mock.restore();
  }
});

test('deciding sends id and status on the query and answers null on success', async () => {
  const mock = installFetchMock(() => ({ json: {} }));
  try {
    const failure = await setSuggestionStatus(NODE, 's-1', 'ACCEPTED');
    assert.equal(failure, null);
    const call = mock.calls[0]!;
    assert.equal(call.init?.method, 'PATCH');
    assert.match(call.url, /id=s-1/);
    assert.match(call.url, /status=ACCEPTED/);
  } finally {
    mock.restore();
  }
});

test('a failed decision answers with the detail so the tool can report it', async () => {
  const mock = installFetchMock(() => ({ status: 404, json: {} }));
  try {
    const failure = await setSuggestionStatus(NODE, 's-1', 'DECLINED');
    assert.match(failure ?? '', /404/);
  } finally {
    mock.restore();
  }
});

test('createSuggestions: an unparseable 200 body is reported, not counted as zero proposals', async () => {
  // parseSuggestions on an unparseable body used to throw a raw SyntaxError out
  // of a write. Reporting `ok:false` with a detail keeps the two-step confirm
  // able to say what is unclear.
  const mock = installFetchMock(() => ({ text: '<html>gateway</html>' }));
  try {
    const out = await createSuggestions(NODE, [
      { propertyId: 'cclom:title', value: ['Neu'], reason: 'Test' } as never,
    ]);
    assert.equal(out.ok, false);
    assert.match(String(out.detail), /Antwort/);
  } finally { mock.restore(); }
});

test('listSuggestions: an unparseable 200 body throws instead of claiming "keine Vorschläge"', async () => {
  // The contract is explicit: an empty array is the claim "there is nothing to
  // review". "We could not look" must never wear that claim.
  const mock = installFetchMock(() => ({ text: '<html>gateway</html>' }));
  try {
    await assert.rejects(() => listSuggestions(NODE), /nicht gelesen werden|nicht ausgewertet/);
  } finally { mock.restore(); }
});
