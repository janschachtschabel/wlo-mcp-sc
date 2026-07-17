import { test } from 'node:test';
import assert from 'node:assert/strict';

import { getCollectionStats } from '../src/services/stats.js';
import { installFetchMock, makeNode } from './fetchMock.js';

// A child file with resolved DISPLAYNAME labels (as the children endpoint returns).
function fileNode(id: string, lrt: string, discipline: string, ec: string) {
  return makeNode(id, id, {
    'ccm:oeh_lrt_aggregated_DISPLAYNAME': [lrt],
    'ccm:taxonid_DISPLAYNAME': [discipline],
    'ccm:educationalcontext_DISPLAYNAME': [ec],
  });
}

function installStatsMock(fileNodes: ReturnType<typeof makeNode>[], fileTotal: number, folderTotal: number) {
  return installFetchMock((url) => {
    if (url.includes('/metadata')) return { json: { node: makeNode('coll-1', 'Biologie-Sammlung') } };
    if (url.includes('/children')) {
      if (url.includes('filter=folders')) return { json: { nodes: [], pagination: { total: folderTotal, from: 0, count: 0 } } };
      if (url.includes('filter=files'))   return { json: { nodes: fileNodes, pagination: { total: fileTotal, from: 0, count: fileNodes.length } } };
    }
    return { json: {} };
  });
}

test('getCollectionStats: counts files/sub-collections and tallies the child breakdown', async () => {
  const mock = installStatsMock([
    fileNode('f1', 'Video', 'Biologie', 'Sekundarstufe I'),
    fileNode('f2', 'Video', 'Biologie', 'Sekundarstufe II'),
    fileNode('f3', 'Arbeitsblatt', 'Chemie', 'Sekundarstufe I'),
  ], 3, 2);
  try {
    const stats = await getCollectionStats('coll-1');
    assert.equal(stats.title, 'Biologie-Sammlung');
    assert.equal(stats.fileCount, 3);
    assert.equal(stats.subCollectionCount, 2);
    assert.equal(stats.sampledFiles, 3);
    // Video (2) before Arbeitsblatt (1).
    assert.deepEqual(stats.breakdown.learningResourceType, [
      { label: 'Video', count: 2 },
      { label: 'Arbeitsblatt', count: 1 },
    ]);
    assert.deepEqual(stats.breakdown.discipline, [
      { label: 'Biologie', count: 2 },
      { label: 'Chemie', count: 1 },
    ]);
    assert.equal(stats.breakdown.educationalContext.find(b => b.label === 'Sekundarstufe I')?.count, 2);
  } finally {
    mock.restore();
  }
});

test('getCollectionStats: fileCount uses the pagination total, not the sample size', async () => {
  // Only 2 files returned in the sample, but the collection has 500 in total.
  const mock = installStatsMock([
    fileNode('f1', 'Video', 'Biologie', 'Sekundarstufe I'),
    fileNode('f2', 'Video', 'Biologie', 'Sekundarstufe I'),
  ], 500, 0);
  try {
    const stats = await getCollectionStats('coll-1');
    assert.equal(stats.fileCount, 500);
    assert.equal(stats.sampledFiles, 2);
  } finally {
    mock.restore();
  }
});

test('getCollectionStats: an empty collection yields zero counts and empty breakdown buckets', async () => {
  const mock = installStatsMock([], 0, 0);
  try {
    const stats = await getCollectionStats('coll-1');
    assert.equal(stats.fileCount, 0);
    assert.equal(stats.sampledFiles, 0);
    assert.deepEqual(stats.breakdown.learningResourceType, []);
    assert.deepEqual(stats.breakdown.discipline, []);
  } finally {
    mock.restore();
  }
});
