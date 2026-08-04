/**
 * write-verify.test.ts – the rule that a write is not believed until re-read.
 *
 * edu-sharing answers `200` in three independent situations where the value is
 * discarded: the MDS filters the property, the node lacks the aspect that
 * carries it, and the caller lacks the right. All three are measured, and none
 * of them is visible in the write response. Without this step the server would
 * confidently report success for every one of them.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildChangeSet } from '../src/services/write/change-set.js';
import { verifyWrite } from '../src/services/write/verify.js';
import { installFetchMock } from './fetchMock.js';

const BEFORE = {
  'cclom:title': ['Alt'],
  'cclom:general_language': ['de'],
};

/** Serve one node whose stored properties are whatever the test says they are. */
function serveNode(properties: Record<string, string[]>) {
  return installFetchMock(() => ({
    json: { node: { ref: { id: 'node-1', repo: '-home-' }, properties } },
  }));
}

test('a value that arrived is reported as stored', async () => {
  const cs = buildChangeSet('node-1', 'content', BEFORE, { 'cclom:title': ['Neu'] });
  const mock = serveNode({ 'cclom:title': ['Neu'] });
  try {
    const result = await verifyWrite('node-1', cs);
    assert.equal(result.outcomes['cclom:title'], 'stored');
    assert.equal(result.allStored, true);
  } finally {
    mock.restore();
  }
});

test('a silently discarded value is reported as dropped, not as success', async () => {
  const cs = buildChangeSet('node-1', 'content', BEFORE, { 'cclom:title': ['Neu'] });
  const mock = serveNode({ 'cclom:title': ['Alt'] }); // the server kept the old value
  try {
    const result = await verifyWrite('node-1', cs);
    assert.equal(result.outcomes['cclom:title'], 'dropped');
    assert.equal(result.allStored, false);
  } finally {
    mock.restore();
  }
});

test('a field that was never set and still is not counts as dropped', async () => {
  const cs = buildChangeSet('node-1', 'content', BEFORE, {
    'cclom:general_description': ['Ein Text'],
  });
  const mock = serveNode({ 'cclom:title': ['Alt'] });
  try {
    const result = await verifyWrite('node-1', cs);
    assert.equal(result.outcomes['cclom:general_description'], 'dropped');
  } finally {
    mock.restore();
  }
});

test('a value the repository rewrote is neither stored nor dropped', async () => {
  // This is how a derived or normalised field shows up — worth telling apart
  // from a discarded one, because the answer for the user is different.
  const cs = buildChangeSet('node-1', 'content', BEFORE, { 'cclom:title': ['Neu'] });
  const mock = serveNode({ 'cclom:title': ['Neu (aus URL abgeleitet)'] });
  try {
    const result = await verifyWrite('node-1', cs);
    assert.equal(result.outcomes['cclom:title'], 'changed');
    assert.equal(result.allStored, false);
  } finally {
    mock.restore();
  }
});

test('one dropped field among several makes the whole write unverified', async () => {
  const cs = buildChangeSet('node-1', 'content', BEFORE, {
    'cclom:title': ['Neu'],
    'cclom:general_language': ['en'],
  });
  const mock = serveNode({ 'cclom:title': ['Neu'], 'cclom:general_language': ['de'] });
  try {
    const result = await verifyWrite('node-1', cs);
    assert.equal(result.outcomes['cclom:title'], 'stored');
    assert.equal(result.outcomes['cclom:general_language'], 'dropped');
    assert.equal(result.allStored, false);
  } finally {
    mock.restore();
  }
});

test('the read-back asks for every property, not the display subset', async () => {
  // A projection that omits the written field would report it dropped forever.
  const cs = buildChangeSet('node-1', 'content', BEFORE, { 'cclom:title': ['Neu'] });
  const mock = serveNode({ 'cclom:title': ['Neu'] });
  try {
    await verifyWrite('node-1', cs);
    assert.match(mock.calls[0]?.url ?? '', /propertyFilter=-all-/);
  } finally {
    mock.restore();
  }
});

test('an unreadable node is an error, never a silent pass', async () => {
  const cs = buildChangeSet('node-1', 'content', BEFORE, { 'cclom:title': ['Neu'] });
  const mock = installFetchMock(() => ({ status: 500, json: {} }));
  try {
    await assert.rejects(() => verifyWrite('node-1', cs), /Kontrolle|nicht gelesen|nicht überprüf/i);
  } finally {
    mock.restore();
  }
});

test('a change set with nothing in it verifies trivially', async () => {
  const cs = buildChangeSet('node-1', 'content', BEFORE, {});
  const mock = serveNode({ 'cclom:title': ['Alt'] });
  try {
    const result = await verifyWrite('node-1', cs);
    assert.deepEqual(result.outcomes, {});
    assert.equal(result.allStored, true);
  } finally {
    mock.restore();
  }
});
