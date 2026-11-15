import { test } from 'node:test';
import assert from 'node:assert/strict';

import { lookupPublishers } from '../src/services/publishers.js';
import { installFetchMock } from './fetchMock.js';

interface Body { criteria: { property: string; values: string[] }[]; facets?: { property: string }[] }

function parseBody(init?: RequestInit): Body {
  return JSON.parse(String(init?.body ?? '{}')) as Body;
}

const PUBLISHER_FACET_RESPONSE = {
  nodes: [],
  pagination: { total: 0, from: 0, count: 0 },
  facets: [
    {
      property: 'ccm:oeh_publisher_combined',
      values: [
        { value: 'ZUM', count: 80 },
        { value: 'Serlo', count: 120 },
        { value: '', count: 5 },
      ],
    },
  ],
};

test('lookupPublishers: returns labeled publisher counts sorted by count desc', async () => {
  const mock = installFetchMock((url) => {
    if (url.includes('/ngsearch')) return { json: PUBLISHER_FACET_RESPONSE };
    return { json: {} };
  });
  try {
    const res = await lookupPublishers();
    // Highest count first; empty-value bucket dropped.
    assert.deepEqual(res, [
      { label: 'Serlo', count: 120 },
      { label: 'ZUM', count: 80 },
    ]);
    // The request must ask the backend to aggregate the publisher facet.
    const call = mock.calls.find(c => c.url.includes('/ngsearch'));
    const body = parseBody(call?.init);
    assert.ok(body.facets?.some(f => f.property === 'ccm:oeh_publisher_combined'));
  } finally {
    mock.restore();
  }
});

test('lookupPublishers: scopes by query and discipline filter', async () => {
  const mock = installFetchMock((url) => {
    if (url.includes('/ngsearch')) return { json: PUBLISHER_FACET_RESPONSE };
    return { json: {} };
  });
  try {
    await lookupPublishers({ query: 'photosynthese', discipline: 'Biologie' });
    const call = mock.calls.find(c => c.url.includes('/ngsearch'));
    const criteria = parseBody(call?.init).criteria;
    assert.ok(criteria.some(c => c.property === 'ngsearchword' && c.values.includes('photosynthese')));
    // Biologie resolves to a taxonid URI filter.
    assert.ok(criteria.some(c => c.property === 'ccm:taxonid'));
  } finally {
    mock.restore();
  }
});

test('lookupPublishers: no query and no filter falls back to a wildcard search', async () => {
  const mock = installFetchMock((url) => {
    if (url.includes('/ngsearch')) return { json: PUBLISHER_FACET_RESPONSE };
    return { json: {} };
  });
  try {
    await lookupPublishers();
    const call = mock.calls.find(c => c.url.includes('/ngsearch'));
    const criteria = parseBody(call?.init).criteria;
    assert.ok(criteria.some(c => c.property === 'ngsearchword' && c.values.includes('*')));
  } finally {
    mock.restore();
  }
});

test('lookupPublishers: maxResults caps the number of buckets returned', async () => {
  const mock = installFetchMock((url) => {
    if (url.includes('/ngsearch')) return { json: PUBLISHER_FACET_RESPONSE };
    return { json: {} };
  });
  try {
    const res = await lookupPublishers({ maxResults: 1 });
    assert.equal(res.length, 1);
    assert.equal(res[0].label, 'Serlo');
  } finally {
    mock.restore();
  }
});
