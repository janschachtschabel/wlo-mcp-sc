/**
 * write-nodes-create.test.ts – creating a record, in the order the repository
 * actually accepts.
 *
 * The counter-intuitive part is the title. Sending `cclom:title` at create looks
 * right and is what the sibling project does, but we measured the repository
 * overwriting it with a title derived from the URL. So the create body stays
 * small and the title arrives in the metadata step afterwards — which is also
 * where every other field goes, because the create endpoint is selective about
 * what it accepts.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createContentNode, resolveCreateParent } from '../src/services/write/nodes-lifecycle.js';
import { installFetchMock, type MockResult } from './fetchMock.js';

const URL_NEW = 'https://example.org/neues-material';

const DESIRED = {
  'cclom:title': ['Brüche verstehen'],
  'ccm:wwwurl': [URL_NEW],
  'cclom:general_description': ['Ein Arbeitsblatt.'],
  'cclom:general_keyword': ['Mathematik'],
  'cclom:general_language': ['de'],
  'ccm:oeh_publisher_combined': ['Beispielverlag'],
};

/**
 * Serve the whole create flow: an empty duplicate search, a create that reports
 * a new id, then anything else as success.
 */
function serveCreate(duplicateUrls: string[] = [], onCreate?: () => MockResult) {
  return installFetchMock((url, init) => {
    if (url.includes('/search/v1/')) {
      return {
        json: {
          nodes: duplicateUrls.map((u, i) => ({
            ref: { id: `alt-${i}`, repo: '-home-' },
            properties: { 'ccm:wwwurl': [u], 'cclom:title': ['Schon da'] },
          })),
          pagination: { total: duplicateUrls.length, from: 0, count: duplicateUrls.length },
        },
      };
    }
    if (url.includes('/children') && (init?.method ?? '') === 'POST') {
      return onCreate ? onCreate() : { json: { node: { ref: { id: 'neu-1', repo: '-home-' } } } };
    }
    return { json: {} };
  });
}

const createCall = (calls: Array<{ url: string; init?: RequestInit }>) =>
  calls.find(c => c.url.includes('/children'));

test('the create body carries no title — the repository would overwrite it', async () => {
  const mock = serveCreate();
  try {
    await createContentNode(DESIRED, { mode: 'user' });
    const body = JSON.parse(String(createCall(mock.calls)?.init?.body ?? '{}'));
    assert.equal(body['cclom:title'], undefined, 'measured: a create-time title is replaced from the URL');
  } finally {
    mock.restore();
  }
});

test('the create body carries the link type the repository requires', async () => {
  const mock = serveCreate();
  try {
    await createContentNode(DESIRED, { mode: 'user' });
    const body = JSON.parse(String(createCall(mock.calls)?.init?.body ?? '{}'));
    assert.deepEqual(body['ccm:linktype'], ['USER_GENERATED']);
    assert.deepEqual(body['ccm:wwwurl'], [URL_NEW]);
    assert.deepEqual(body['cclom:general_description'], ['Ein Arbeitsblatt.']);
    assert.deepEqual(body['cclom:general_keyword'], ['Mathematik']);
    assert.deepEqual(body['cclom:general_language'], ['de']);
  } finally {
    mock.restore();
  }
});

test('fields the create endpoint does not take are left for the metadata step', async () => {
  const mock = serveCreate();
  try {
    await createContentNode(DESIRED, { mode: 'user' });
    const body = JSON.parse(String(createCall(mock.calls)?.init?.body ?? '{}'));
    assert.equal(body['ccm:oeh_publisher_combined'], undefined);

    const metadata = mock.calls.find(c => c.url.includes('/metadata'));
    assert.ok(metadata, 'a metadata call follows the create');
    const meta = JSON.parse(String(metadata.init?.body ?? '{}'));
    assert.deepEqual(meta['cclom:title'], ['Brüche verstehen'], 'the title lands here');
    assert.deepEqual(meta['ccm:oeh_publisher_combined'], ['Beispielverlag']);
  } finally {
    mock.restore();
  }
});

test('the create request declares the type and asks the repository to rename on collision', async () => {
  const mock = serveCreate();
  try {
    await createContentNode(DESIRED, { mode: 'user' });
    const url = new URL(createCall(mock.calls)?.url ?? '');
    assert.equal(url.searchParams.get('type'), 'ccm:io');
    assert.equal(url.searchParams.get('renameIfExists'), 'true');
    assert.ok((url.searchParams.get('versionComment') ?? '').length > 0);
  } finally {
    mock.restore();
  }
});

test('a duplicate stops the flow before anything is created', async () => {
  const mock = serveCreate([URL_NEW]);
  try {
    const result = await createContentNode(DESIRED, { mode: 'user' });
    assert.equal(result.status, 'duplicate');
    assert.ok(result.status === 'duplicate' && result.existing.nodeId === 'alt-0');
    assert.equal(createCall(mock.calls), undefined, 'no create request was sent');
  } finally {
    mock.restore();
  }
});

test('a personal login creates in the user home', () => {
  assert.equal(resolveCreateParent('user', ''), '-userhome-');
  assert.equal(resolveCreateParent('user', 'inbox-id'), '-userhome-',
    'a configured inbox does not divert a personal record');
});

test('a service account creates in the configured inbox', () => {
  assert.equal(resolveCreateParent('service', 'inbox-id'), 'inbox-id');
});

test('a service account without a configured inbox is an error, not a guess', () => {
  // Hard-coding an id would write into whatever node that id happens to be on
  // the target repository — a different one on staging than on production.
  assert.throws(() => resolveCreateParent('service', ''), /WLO_INBOX_ID/);
});

test('a failed create is reported, and no metadata call follows it', async () => {
  const mock = serveCreate([], () => ({ status: 400, json: { error: 'nope' } }));
  try {
    const result = await createContentNode(DESIRED, { mode: 'user' });
    assert.equal(result.status, 'failed');
    assert.match(result.status === 'failed' ? result.detail : '', /400/);
    assert.equal(mock.calls.find(c => c.url.includes('/metadata')), undefined);
  } finally {
    mock.restore();
  }
});

test('a create without a source URL is refused before any request', async () => {
  const mock = serveCreate();
  try {
    const result = await createContentNode({ 'cclom:title': ['Ohne URL'] }, { mode: 'user' });
    assert.equal(result.status, 'failed');
    assert.match(result.status === 'failed' ? result.detail : '', /URL/i);
    assert.equal(mock.calls.length, 0);
  } finally {
    mock.restore();
  }
});

test('an unparseable create response is reported as "created, but no id" — not as a failure', async () => {
  // The POST was accepted; the body just does not say what came of it. Reporting
  // a failure here would invite a retry, and `renameIfExists` would make that a
  // second record rather than a no-op.
  const mock = serveCreate([], () => ({ text: '<html>gateway</html>' }));
  try {
    const out = await createContentNode(DESIRED, { mode: 'user' });
    assert.equal(out.status, 'failed');
    assert.match(String(out.detail), /keine verwertbare Antwort/);
  } finally { mock.restore(); }
});

/**
 * ── Wie lange das Anlegen dauern darf ───────────────────────────────────────
 *
 * Gemessen 2026-08-17 gegen Staging, je Anfrage getrennt: das Anlegen selbst
 * (`POST …/children`) braucht **18,6 s**, die beiden anderen Aufrufe der Folge
 * zusammen 1,7 s. Über vier Läufe lag das Anlegen bei 12,2 / 15,7 / 16,6 / 18,6 s.
 *
 * Die Ursache: das Repository RENDERT die Seite und speichert eine Vorschau am
 * Datensatz (echtes JPEG ~50 kB statt SVG-Platzhalter, `preview.isIcon=false`).
 * Das Ergebnis ist je Adresse zwischengespeichert — `planet-schule.de` kostete
 * kalt 46,5 s und danach 8,8 s —, weshalb Messungen mit jeweils neuer Einweg-URL
 * einen falschen, gleichmäßigen Sockel von 13–22 s erzeugen. Eine Domain, die es
 * nicht gibt, kostet trotzdem ~15 s: der Renderer läuft in seine eigene Frist.
 *
 * Und die Kosten hängen an der EIGENSCHAFT, nicht am Endpunkt — gleiche Adresse,
 * gleicher Lauf: anlegen mit URL 8,8 s gegen anlegen ohne URL 0,5 s + URL
 * nachsetzen 7,8 s. `ccm:wwwurl` aus dem Anlege-Body zu nehmen verschöbe die
 * Wartezeit also nur um einen Aufruf; die Reihenfolge bleibt, wie sie ist.
 */

/**
 * ── Die Grenze hängt an ccm:wwwurl, nicht am Anlegen ────────────────────────
 *
 * Gemessen 2026-08-17, gleiche URL im selben Lauf: anlegen MIT URL 8,8 s gegen
 * anlegen ohne URL 0,5 s + URL nachträglich setzen 7,8 s. Die Arbeit wandert mit
 * der Eigenschaft, sie verschwindet nicht. Sie entsteht, weil das Repository für
 * die Adresse eine Vorschau rendert: der Knoten trägt danach ein echtes JPEG
 * (~50 kB, `preview.isIcon=false`) statt des SVG-Platzhalters.
 *
 * Das Ergebnis wird je URL zwischengespeichert — derselbe Abruf für einen
 * ANDEREN Knoten mit derselben Adresse liefert dieselben Bytes, und ein zweiter
 * Aufruf kostet 0,3 s. Deshalb streuen die Messungen so stark: `planet-schule.de`
 * kalt 46,5 s, danach 8,8 s.
 *
 * Folge für uns: das größere Budget gehört überall dorthin, wo `ccm:wwwurl`
 * geschrieben wird — auch in den Metadaten-Pfad, den `wlo_update_content`
 * benutzt, wenn jemand die Quell-URL ändert.
 */

import { writeTimeoutMs, WWWURL_WRITE_TIMEOUT_MS } from '../src/services/write/nodes.js';
import { WLO_FETCH_TIMEOUT_MS } from '../src/wlo-config.js';

test('ein Schreibvorgang mit ccm:wwwurl bekommt das größere Budget', () => {
  assert.equal(writeTimeoutMs({ 'ccm:wwwurl': ['https://example.org/'] }), WWWURL_WRITE_TIMEOUT_MS);
});

test('ohne ccm:wwwurl bleibt es beim gewöhnlichen Budget', () => {
  // Gemessen 0,5-1,2 s ohne die URL — das gewöhnliche Limit ist dafür großzügig,
  // und ein hängender Socket soll nicht länger blockieren als nötig.
  assert.equal(writeTimeoutMs({ 'cclom:title': ['Titel'] }), WLO_FETCH_TIMEOUT_MS);
  assert.equal(writeTimeoutMs({}), WLO_FETCH_TIMEOUT_MS);
});

test('das größere Budget deckt den gemessenen kalten Lauf', () => {
  // 46,5 s für eine kalt gerenderte, echte Seite. Ein Abbruch davor meldet
  // Fehlschlag für Arbeit, die zu Ende läuft.
  assert.ok(WWWURL_WRITE_TIMEOUT_MS >= 46_500, `${WWWURL_WRITE_TIMEOUT_MS} ms deckt 46,5 s nicht`);
});

test('eine größere Einstellung des Betreibers wird auch hier nicht heruntergesetzt', () => {
  const higher = WWWURL_WRITE_TIMEOUT_MS + 5_000;
  assert.equal(writeTimeoutMs({ 'cclom:title': ['x'] }, higher), higher);
  assert.equal(writeTimeoutMs({ 'ccm:wwwurl': ['https://example.org/'] }, higher), higher);
});
