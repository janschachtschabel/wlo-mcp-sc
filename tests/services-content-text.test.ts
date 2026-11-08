// MUST stay first — enables the extraction service before wlo-config resolves it.
import './enable-extraction-env.js';

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { getContentText } from '../src/services/content-text.js';
import { resolveExtractionUrl } from '../src/wlo-config.js';
import { installFetchMock, makeNode } from './fetchMock.js';

/**
 * The actual TEXT of a material, not its metadata — what a teacher needs to work
 * with a worksheet. Measured on 32 live records (2026-07-28): edu-sharing's own
 * `/textContent` already holds usable text for 29 of them, so the repository is
 * the primary source and the external extraction service is the fallback for
 * the remaining link-only records. Both are remote HTTP, so neither blocks the
 * single Node thread — an in-process converter would.
 */

const EXTRACTION_HOST = 'text-extraction.staging.openeduhub.net';

interface MockOpts {
  repoText?: string;
  wwwurl?: string;
  /** The node carries a file of this size (DTO field `size`). */
  fileSize?: number;
  /** HTTP status of the text read (default 200). */
  repoStatus?: number;
  nodeMissing?: boolean;
  extractionText?: string;
  extractionStatus?: number;
}

function installMock(o: MockOpts) {
  return installFetchMock((url) => {
    if (url.includes('/textContent')) {
      if (o.repoStatus && o.repoStatus !== 200) return { status: o.repoStatus, json: {} };
      return { json: { content: o.repoText ?? '' } };
    }
    if (url.includes('/metadata')) {
      if (o.nodeMissing) return { json: {} };
      return { json: { node: { ...makeNode('n1', 'Arbeitsblatt Prozentrechnung', {
        'cclom:title': ['Arbeitsblatt Prozentrechnung'],
        ...(o.wwwurl ? { 'ccm:wwwurl': [o.wwwurl] } : {}),
      }), ...(o.fileSize ? { size: o.fileSize } : {}) } } };
    }
    if (url.includes(EXTRACTION_HOST)) {
      if (o.extractionStatus && o.extractionStatus !== 200) return { status: o.extractionStatus, json: {} };
      return { json: { text: o.extractionText ?? '', lang: 'de', status: 200 } };
    }
    return { json: {} };
  });
}

const LONG = 'Prozentrechnung: Grundwert, Prozentwert und Prozentsatz. '.repeat(20);

/**
 * The fallback path resolves the `ccm:wwwurl` host before handing it to the
 * extraction service (SSRF, audit 2026-08-12 F-4), so every test that reaches
 * that path injects its DNS answer. Neither DNS nor the network belongs in a
 * unit test — the same reason `services/url-text.ts` has a `lookup` seam.
 */
const PUBLIC_DNS = { lookup: async () => [{ address: '93.184.216.34' }] };

test('getContentText: repository text wins and the external service is not called', async () => {
  const mock = installMock({ repoText: LONG, wwwurl: 'https://tutory.de/dok/1' });
  try {
    const r = await getContentText('n1', 8000);
    assert.equal(r.source, 'repository');
    assert.equal(r.reason, undefined);
    assert.ok(r.text.startsWith('Prozentrechnung'));
    assert.equal(r.title, 'Arbeitsblatt Prozentrechnung');
    assert.equal(
      mock.calls.filter(c => c.url.includes(EXTRACTION_HOST)).length, 0,
      'no external call when the repository already has the text',
    );
  } finally {
    mock.restore();
  }
});

test('getContentText: metadata and text are fetched in parallel, not one after the other', async () => {
  // The text read is the slow one (median 4.6 s live); pulling the title
  // alongside it costs no extra wall time, but doing it afterwards would.
  const mock = installMock({ repoText: LONG });
  try {
    await getContentText('n1', 8000);
    const kinds = mock.calls.map(c => (c.url.includes('/textContent') ? 'text' : c.url.includes('/metadata') ? 'meta' : 'other'));
    assert.ok(kinds.includes('text') && kinds.includes('meta'), 'both reads happen');
    assert.equal(kinds.filter(k => k === 'other').length, 0, 'and nothing else on the happy path');
  } finally {
    mock.restore();
  }
});

test('getContentText: falls back to the extraction service when the repository is empty', async () => {
  const mock = installMock({ repoText: '', wwwurl: 'https://tutory.de/dok/1', extractionText: LONG });
  try {
    const r = await getContentText('n1', 8000, PUBLIC_DNS);
    assert.equal(r.source, 'external-extraction');
    assert.equal(r.sourceUrl, 'https://tutory.de/dok/1');
    assert.ok(r.text.length > 200);
    assert.equal(mock.calls.filter(c => c.url.includes(EXTRACTION_HOST)).length, 1);
  } finally {
    mock.restore();
  }
});

test('getContentText: a too-short repository text does not count as content', async () => {
  // Live records return stubs like a cookie banner; those must not shadow the
  // real text the extraction service can still fetch.
  const mock = installMock({ repoText: 'Cookie-Hinweis', wwwurl: 'https://tutory.de/dok/1', extractionText: LONG });
  try {
    const r = await getContentText('n1', 8000, PUBLIC_DNS);
    assert.equal(r.source, 'external-extraction');
  } finally {
    mock.restore();
  }
});

test('getContentText: a permission-restricted node says access_denied, not "no text"', async () => {
  // Live: 4 of 9 edu-sharing-hosted binaries answer 403 on BOTH /textContent and
  // the download URL (2026-07-28). Reporting that as "nothing stored" is wrong
  // and actionable-looking; the truth is that anonymous access is not allowed,
  // which is a different problem with a different remedy (sign in).
  const mock = installFetchMock((url) => {
    if (url.includes('/textContent')) return { status: 403, json: {} };
    if (url.includes('/metadata')) {
      return { json: { node: makeNode('n1', 'Geschützte Handreichung', {
        'cclom:title': ['Geschützte Handreichung'],
      }) } };
    }
    return { json: {} };
  });
  try {
    const r = await getContentText('n1', 8000);
    assert.equal(r.source, 'none');
    assert.equal(r.reason, 'access_denied');
    assert.equal(r.title, 'Geschützte Handreichung', 'metadata is still returned');
  } finally {
    mock.restore();
  }
});

test('getContentText: no text and no external URL → reason no_text_no_url', async () => {
  const mock = installMock({ repoText: '' });
  try {
    const r = await getContentText('n1', 8000);
    assert.equal(r.source, 'none');
    assert.equal(r.reason, 'no_text_no_url');
    assert.equal(r.text, '');
  } finally {
    mock.restore();
  }
});

test('getContentText: an unknown node reports node_not_found', async () => {
  const mock = installMock({ repoText: '', nodeMissing: true });
  try {
    const r = await getContentText('ghost', 8000);
    assert.equal(r.source, 'none');
    assert.equal(r.reason, 'node_not_found');
  } finally {
    mock.restore();
  }
});

test('getContentText: a failing extraction service reports extraction_failed', async () => {
  const mock = installMock({ repoText: '', wwwurl: 'https://tutory.de/dok/1', extractionStatus: 424 });
  try {
    const r = await getContentText('n1', 8000, PUBLIC_DNS);
    assert.equal(r.source, 'none');
    assert.equal(r.reason, 'extraction_failed');
  } finally {
    mock.restore();
  }
});

test('getContentText: refuses a wwwurl whose PUBLIC name resolves into a private network', async () => {
  // Audit F-4. `isPrivateHost` inside the extraction client only judges the
  // LITERAL host, so `http://name.example.org/` with an A record of 10.0.0.5
  // walked straight through and turned the extraction service into a probe for
  // its own network. `ccm:wwwurl` is a curated field, but WLO is an
  // open-contribution platform and this tool answers anonymous callers —
  // "curated" is not the same as "trusted address".
  const mock = installMock({ repoText: '', wwwurl: 'http://name.example.org/doc', extractionText: LONG });
  const befragt: string[] = [];
  try {
    const r = await getContentText('n1', 8000, {
      lookup: async (h) => { befragt.push(h); return [{ address: '10.0.0.5' }]; },
    });
    // The resolver really ran — without this the assertions below would also
    // hold for a build in which the guard silently does nothing.
    assert.deepEqual(befragt, ['name.example.org']);
    assert.equal(r.source, 'none');
    assert.equal(r.reason, 'extraction_failed');
    assert.equal(r.text, '');
    assert.equal(
      mock.calls.filter(c => c.url.includes(EXTRACTION_HOST)).length, 0,
      'the extraction service must never be asked for a private-resolving host',
    );
  } finally {
    mock.restore();
  }
});

test('getContentText: refuses a name that does not resolve rather than waving it through', async () => {
  // The extraction service does its own lookup; a name we cannot resolve may
  // well resolve for it, and not necessarily to what we would have seen.
  const mock = installMock({ repoText: '', wwwurl: 'http://nx.example.org/doc', extractionText: LONG });
  try {
    const r = await getContentText('n1', 8000, {
      lookup: async () => { throw new Error('NXDOMAIN'); },
    });
    assert.equal(r.reason, 'extraction_failed');
    assert.equal(mock.calls.filter(c => c.url.includes(EXTRACTION_HOST)).length, 0);
  } finally {
    mock.restore();
  }
});

test('getContentText: a literal private address is refused before any lookup', async () => {
  const mock = installMock({ repoText: '', wwwurl: 'http://169.254.169.254/latest/meta-data/', extractionText: LONG });
  try {
    const r = await getContentText('n1', 8000, {
      lookup: async () => { throw new Error('darf nicht gefragt werden'); },
    });
    assert.equal(r.reason, 'extraction_failed');
    assert.equal(mock.calls.filter(c => c.url.includes(EXTRACTION_HOST)).length, 0);
  } finally {
    mock.restore();
  }
});

test('getContentText: truncates to maxChars and says so', async () => {
  // A single live record returned 41 300 characters — unbounded output would
  // flood the model's context window.
  const mock = installMock({ repoText: LONG });
  try {
    const r = await getContentText('n1', 100);
    assert.equal(r.truncated, true);
    assert.ok(r.text.length <= 140, `capped, saw ${r.text.length}`);
    assert.ok(r.charCount > 100, 'the untruncated length is still reported');
  } finally {
    mock.restore();
  }
});

/**
 * This test used to pin the opposite: that an unset variable defaults to
 * `https://text-extraction.staging.openeduhub.net`. That default sent the URLs
 * of PRODUCTION material to a STAGING host on any deploy that had not set the
 * variable — the exact outcome the validation below exists to prevent ("a typo
 * must not redirect material URLs to a host the operator never chose"). An
 * unset variable is no more a choice than a typo is, so it now disables the
 * service and says so, and `/textContent` remains the only source.
 */
test('resolveExtractionUrl: unset disables the service — no cross-environment default', () => {
  assert.equal(resolveExtractionUrl(undefined), '');
  assert.equal(resolveExtractionUrl('https://extract.example.org/'), 'https://extract.example.org');
  assert.equal(resolveExtractionUrl('  '), '');
});

test('resolveExtractionUrl: an unusable value disables the service instead of building a broken target', () => {
  // The value is operator configuration, so the risk is a typo, not an attack.
  // What must NOT happen is a silent fallback to the public default: that would
  // ship material URLs to a host the operator did not choose. Disabling keeps
  // the repository's own /textContent as the only source — visible in the logs,
  // and it degrades to less data rather than to a different destination.
  assert.equal(resolveExtractionUrl('text-extraction.example.net'), '', 'no scheme');
  assert.equal(resolveExtractionUrl('ftp://extract.example.org'), '', 'not http(s)');
  assert.equal(resolveExtractionUrl('not a url'), '', 'unparseable');
  // `${base}/from-url` would land after the query string and never reach the API.
  assert.equal(resolveExtractionUrl('https://extract.example.org/?x=1'), '', 'carries a query');
  assert.equal(resolveExtractionUrl('https://extract.example.org/#f'), '', 'carries a fragment');
  // A base path is legitimate — the caller appends `/from-url` to it.
  assert.equal(
    resolveExtractionUrl('https://extract.example.org/api/'),
    'https://extract.example.org/api',
    'a base path survives, trailing slash stripped',
  );
  assert.equal(resolveExtractionUrl('http://localhost:8080'), 'http://localhost:8080', 'plain http is allowed');
});

// ── plan 2026-11-08, phase 2: a full text written to textContent is read ──

test('getContentText: a SHORT repository text counts when the node links nowhere — it is no crawled page', async () => {
  // The 200-character floor is for crawler output of a linked page (cookie
  // banners). A full text attached to an uploaded file (W1) may be short and is
  // still the text: below the floor it read as "no text".
  const mock = installMock({ repoText: 'Kurzer Volltext einer Folie.', fileSize: 1200 });
  try {
    const r = await getContentText('n1', 8000);
    assert.equal(r.source, 'repository');
    assert.equal(r.text, 'Kurzer Volltext einer Folie.');
  } finally {
    mock.restore();
  }
});

test('getContentText: a file without extracted text says not_extracted, not "no stored text"', async () => {
  // Markdown, JSON and images yield no text at the repository (measured in the
  // edu-sharing client library, 2026-08-27 and 2026-09-11) — the file is there.
  const mock = installMock({ repoText: '', fileSize: 4096 });
  try {
    const r = await getContentText('n1', 8000);
    assert.equal(r.source, 'none');
    assert.equal(r.reason, 'not_extracted');
  } finally {
    mock.restore();
  }
});

test('getContentText: a FAILED text read is text_unreadable — never a claim about the file (review P2, finding 1)', async () => {
  const mock = installMock({ repoStatus: 503, fileSize: 4096 });
  try {
    const r = await getContentText('n1', 8000);
    assert.equal(r.source, 'none');
    assert.equal(r.reason, 'text_unreadable');
  } finally {
    mock.restore();
  }
});

test('getContentText: a short text is not taken when the metadata could not be read (review P2, finding 5)', async () => {
  const mock = installMock({ repoText: 'Kurz.', nodeMissing: true });
  try {
    const r = await getContentText('n1', 8000);
    assert.notEqual(r.source, 'repository');
  } finally {
    mock.restore();
  }
});

test('getContentText: a short text with replacement or control characters is binary debris, not the text (review P2, finding 4)', async () => {
  const mock = installMock({ repoText: 'JFIF\uFFFD\u0001\u0002x', fileSize: 50_000 });
  try {
    const r = await getContentText('n1', 8000);
    assert.equal(r.source, 'none');
    assert.equal(r.reason, 'not_extracted');
  } finally {
    mock.restore();
  }
});
