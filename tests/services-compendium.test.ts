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

/**
 * `-all-` fetched ~47 properties per node although only two are read. Measured
 * against the editorial repository 2026-08-03 (read-only, anonymous): every
 * field a `propertyFilter` names comes back byte-identical to the `-all-` read,
 * including a 4914-character `cclom:general_description` — the filter is a
 * whitelist, not a size limit — and the response shrinks 43% (19941 → 11287
 * bytes over four collections). The compendium field itself could not be the
 * witness: it is unpopulated across all 196 collections reachable from twelve
 * broad search terms, which is why this had to be measured on the mechanism
 * rather than on the field.
 */
test('getCompendiumTexts asks only for the properties it reads', async () => {
  const mock = installMetadataMock();
  try {
    await getCompendiumTexts(['with-text']);
    const url = mock.calls[0]?.url ?? '';
    assert.doesNotMatch(url, /propertyFilter=-all-/, 'no 47-property response for two fields');
    assert.match(url, /propertyFilter=/, 'the read is projected');
    assert.match(decodeURIComponent(url), /ccm:oeh_collection_compendium_text/, 'and names the text it exists to fetch');
  } finally {
    mock.restore();
  }
});
