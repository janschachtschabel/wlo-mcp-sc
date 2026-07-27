import { test } from 'node:test';
import assert from 'node:assert/strict';

import { getNodeMetadata, getNodeParents } from '../src/wlo-api.js';
import { installFetchMock, makeNode } from './fetchMock.js';

/**
 * `/parents` and `/metadata` default to the heaviest projection (`-all-`, ~59
 * properties per node — and `/parents` returns the whole ancestor chain). Hot
 * paths that read three fields must be able to ask for three fields; every
 * existing caller keeps `-all-` (Mode-C latency work, 2026-07-27).
 */

function filtersOf(url: string): string[] {
  return [...new URL(url).searchParams.getAll('propertyFilter')];
}

test('getNodeParents: keeps the -all- projection when no props are given', async () => {
  const mock = installFetchMock(() => ({ json: { nodes: [] } }));
  try {
    await getNodeParents('node-1');
    assert.deepEqual(filtersOf(mock.calls[0].url), ['-all-']);
  } finally {
    mock.restore();
  }
});

test('getNodeParents: narrows to the requested properties', async () => {
  const mock = installFetchMock(() => ({ json: { nodes: [] } }));
  try {
    await getNodeParents('node-1', ['ccm:page_config_ref', 'cclom:title']);
    assert.deepEqual(filtersOf(mock.calls[0].url), ['ccm:page_config_ref', 'cclom:title']);
  } finally {
    mock.restore();
  }
});

test('getNodeMetadata: keeps the -all- projection when no props are given', async () => {
  const mock = installFetchMock(() => ({ json: { node: makeNode('n1', 'T') } }));
  try {
    await getNodeMetadata('n1');
    assert.deepEqual(filtersOf(mock.calls[0].url), ['-all-']);
  } finally {
    mock.restore();
  }
});

test('getNodeMetadata: narrows to the requested properties', async () => {
  const mock = installFetchMock(() => ({ json: { node: makeNode('n1', 'T') } }));
  try {
    await getNodeMetadata('n1', ['cm:name']);
    assert.deepEqual(filtersOf(mock.calls[0].url), ['cm:name']);
  } finally {
    mock.restore();
  }
});

test('getNodeMetadata: an empty props array falls back to -all- (never an unfiltered request)', async () => {
  const mock = installFetchMock(() => ({ json: { node: makeNode('n1', 'T') } }));
  try {
    await getNodeMetadata('n1', []);
    assert.deepEqual(filtersOf(mock.calls[0].url), ['-all-']);
  } finally {
    mock.restore();
  }
});
