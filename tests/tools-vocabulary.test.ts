import { test } from 'node:test';
import assert from 'node:assert/strict';

import { connectedClient, toolText } from './fetchMock.js';

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
