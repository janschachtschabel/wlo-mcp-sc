import { test } from 'node:test';
import assert from 'node:assert/strict';

import { getCompendiumTexts } from '../src/services/compendium.js';
import { installFetchMock, makeNode } from './fetchMock.js';

const LONG_TEXT = 'Kompendium. ' + 'x'.repeat(800); // > 500 chars to prove non-truncation

/** Routes per-node metadata GETs by the node id embedded in the URL. */
function installMetadataMock() {
  return installFetchMock((url) => {
    if (url.includes('/metadata')) {
      if (url.includes('with-text')) {
        return { json: { node: makeNode('with-text', 'Sammlung Optik', {
          'cm:name': ['Sammlung Optik'],
          'ccm:oeh_collection_compendium_text': [LONG_TEXT],
        }) } };
      }
      if (url.includes('no-text')) {
        return { json: { node: makeNode('no-text', 'Sammlung Leer') } };
      }
    }
    return { json: {} };
  });
}

test('getCompendiumTexts: returns the FULL, untruncated compendium text for a node that has it', async () => {
  const mock = installMetadataMock();
  try {
    const entries = await getCompendiumTexts(['with-text']);
    assert.equal(entries.length, 1);
    assert.equal(entries[0].nodeId, 'with-text');
    assert.equal(entries[0].title, 'Sammlung Optik');
    assert.equal(entries[0].compendiumText, LONG_TEXT); // not sliced to 500
  } finally {
    mock.restore();
  }
});

test('getCompendiumTexts: compendiumText is null when the node lacks the property', async () => {
  const mock = installMetadataMock();
  try {
    const entries = await getCompendiumTexts(['no-text']);
    assert.equal(entries.length, 1);
    assert.equal(entries[0].nodeId, 'no-text');
    assert.equal(entries[0].compendiumText, null);
  } finally {
    mock.restore();
  }
});

test('getCompendiumTexts: returns one entry per requested id, in order', async () => {
  const mock = installMetadataMock();
  try {
    const entries = await getCompendiumTexts(['with-text', 'no-text']);
    assert.deepEqual(entries.map(e => e.nodeId), ['with-text', 'no-text']);
    assert.equal(entries[0].compendiumText, LONG_TEXT);
    assert.equal(entries[1].compendiumText, null);
  } finally {
    mock.restore();
  }
});

test('getCompendiumTexts: empty input returns empty array without any fetch', async () => {
  const mock = installFetchMock(() => ({ json: {} }));
  try {
    const entries = await getCompendiumTexts([]);
    assert.deepEqual(entries, []);
    assert.equal(mock.calls.length, 0);
  } finally {
    mock.restore();
  }
});
