/**
 * wikipedia-relevance.test.ts – picking the right article among the fuzzy
 * candidates opensearch returns.
 *
 * The cases are the ones measured live against de.wikipedia.org on 2026-08-02
 * (see `docs/plans/2026-08-02-wikipedia-relevance.md`), plus the table from the
 * chatbot team's hand-over. The three that decide the implementation:
 *   - "Dreiecke" must reach "Dreieck" (5th candidate) and NOT "Dreiecker" (1st),
 *   - "Stadt Berlin" must reach nothing at all,
 *   - "Feinoptik" may reach "Feinoptiker".
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { pickRelevantTitle } from '../src/wikipedia-relevance.js';
import { connectedClient, installFetchMock, toolText } from './fetchMock.js';

// Verbatim opensearch responses (limit=10, de), measured 2026-08-02.
const DREIECKE = ['Dreiecker', 'Dreiecketer', 'Dreieck Essen-Ost', 'Dreieck Erlenbruch', 'Dreieck', 'Dreiecks-Fettspinne'];
const STADT_BERLIN = ['Stadt Bern', 'Stadt Überlingen (Schiff, 1929)', 'Stadtbergen', 'Stadtegerling', 'Stabi Berlin', 'Stadt Ueberlingen (Schiff, 1895)'];

test('pickRelevantTitle: the exact article wins outright', () => {
  assert.equal(pickRelevantTitle('Photosynthese', ['Photosynthese', 'Photosynthese (Spiel)']), 'Photosynthese');
});

test('pickRelevantTitle: reaches the base concept further down the list', () => {
  assert.equal(pickRelevantTitle('Dreiecke', DREIECKE), 'Dreieck');
});

test('pickRelevantTitle: a one-character suffix is not an inflection', () => {
  // "Dreiecker" is a mountain in the Allgäu. Alone on the list it must yield
  // nothing rather than the nearest string.
  assert.equal(pickRelevantTitle('Dreiecke', ['Dreiecker']), null);
});

test('pickRelevantTitle: rejects every candidate for a query none of them is about', () => {
  assert.equal(pickRelevantTitle('Stadt Berlin', STADT_BERLIN), null);
});

test('pickRelevantTitle: an article merely CONTAINING the topic word is not the topic', () => {
  // "Stabi Berlin" (the state library) contains "Berlin" as a whole word, so a
  // check that only asks "does the topic word occur" accepts it.
  assert.equal(pickRelevantTitle('Stadt Berlin', ['Stabi Berlin']), null);
});

test('pickRelevantTitle: an article LEADING with the topic word is the topic', () => {
  assert.equal(pickRelevantTitle('Stadt Berlin', ['Berlin Hauptstadt']), 'Berlin Hauptstadt');
});

test('pickRelevantTitle: a recognised German derivation is accepted', () => {
  assert.equal(pickRelevantTitle('Feinoptik', ['Feinoptiker']), 'Feinoptiker');
});

test('pickRelevantTitle: a compound query reaches its base concept', () => {
  assert.equal(pickRelevantTitle('Bruchrechnung', ['Bruch Grundlagen']), 'Bruch Grundlagen');
});

test('pickRelevantTitle: a qualifier in the query does not block the match', () => {
  assert.equal(pickRelevantTitle('Satz Pythagoras', ['Satz des Pythagoras']), 'Satz des Pythagoras');
});

test('pickRelevantTitle: among equally good candidates the closest one wins', () => {
  // Both lead with the concept; "Dreieck Essen-Ost" is a motorway junction.
  assert.equal(pickRelevantTitle('Dreiecke', ['Dreieck Essen-Ost', 'Dreieck']), 'Dreieck');
});

test('pickRelevantTitle: diacritics do not decide the match', () => {
  assert.equal(pickRelevantTitle('Ökosystem', ['Okosystem']), 'Okosystem');
  assert.equal(pickRelevantTitle('Okosystem', ['Ökosystem']), 'Ökosystem');
});

test('pickRelevantTitle: a query of nothing but stop words matches nothing', () => {
  assert.equal(pickRelevantTitle('die der und', ['Dieder']), null);
});

test('pickRelevantTitle: an empty query and an empty candidate list yield null', () => {
  assert.equal(pickRelevantTitle('', ['Photosynthese']), null);
  assert.equal(pickRelevantTitle('   ', ['Photosynthese']), null);
  assert.equal(pickRelevantTitle('Photosynthese', []), null);
});

test('pickRelevantTitle: a short query word is not stretched into a match', () => {
  // "Ohm" is below the content-word length, so there is nothing to match on.
  assert.equal(pickRelevantTitle('Ohm', ['Ohmsches Gesetz']), null);
});

// ── The tool surface ────────────────────────────────────────────────────────

test('get_wikipedia_summary: a search-resolved article says so in the text', async () => {
  const mock = installFetchMock((url) => {
    if (url.includes('action=opensearch')) {
      return { json: ['q', ['Feinoptiker'], [''], ['']] };
    }
    if (url.includes('/page/summary/Feinoptiker')) {
      return { json: {
        type: 'standard', title: 'Feinoptiker', extract: 'Ein Feinoptiker fertigt Optik.',
        content_urls: { desktop: { page: 'https://de.wikipedia.org/wiki/Feinoptiker' } }, lang: 'de',
      } };
    }
    return { status: 404, json: {} };
  });
  const client = await connectedClient();
  try {
    const result = await client.callTool({
      name: 'get_wikipedia_summary',
      arguments: { query: 'Feinoptik' },
    });
    const text = toolText(result);
    assert.match(text, /per Suche aufgelöst/, 'the caller must be able to tell it is not the asked-for title');
    assert.match(text, /Feinoptiker/);
  } finally {
    await client.close();
    mock.restore();
  }
});

test('get_wikipedia_summary: an exact hit carries no resolution notice', async () => {
  const mock = installFetchMock((url) => {
    if (url.includes('/page/summary/')) {
      return { json: {
        type: 'standard', title: 'Photosynthese', extract: 'Ein Prozess.',
        content_urls: { desktop: { page: 'https://de.wikipedia.org/wiki/Photosynthese' } }, lang: 'de',
      } };
    }
    return { json: ['q', [], [], []] };
  });
  const client = await connectedClient();
  try {
    const result = await client.callTool({
      name: 'get_wikipedia_summary',
      arguments: { query: 'Photosynthese' },
    });
    assert.doesNotMatch(toolText(result), /per Suche aufgelöst/);
  } finally {
    await client.close();
    mock.restore();
  }
});

test('pickRelevantTitle: a short topic word still counts when nothing longer is left', () => {
  // "stadt" is a stop word and "rom" is below the content-word floor, which
  // emptied the content set and answered nothing for a perfectly good query.
  assert.equal(pickRelevantTitle('Stadt Rom', ['Rom', 'Romane']), 'Rom');
  // The floor still applies while a longer word is available, so a qualifier
  // cannot outvote the topic.
  assert.equal(pickRelevantTitle('Rom Kolosseum', ['Kolosseum']), 'Kolosseum');
});

test('pickRelevantTitle: dropping the floor does not license a derivation match', () => {
  // With "rom" as the key, only a whole-word hit may pass — the morphological
  // rules keep their MIN_STEM_LENGTH guard, so "Romane" is not "Rom".
  assert.equal(pickRelevantTitle('Stadt Rom', ['Romane']), null);
});

test('search_wlo_all: a search-resolved Wikipedia hit is disclosed there too', async () => {
  // search_wlo_all is the documented default entry point, so a silent
  // substitution here reaches more callers than one in get_wikipedia_summary.
  const mock = installFetchMock((url) => {
    if (url.includes('action=opensearch')) return { json: ['q', ['Feinoptiker'], [''], ['']] };
    if (url.includes('/page/summary/Feinoptiker')) {
      return { json: {
        type: 'standard', title: 'Feinoptiker', extract: 'Ein Feinoptiker fertigt Optik.',
        content_urls: { desktop: { page: 'https://de.wikipedia.org/wiki/Feinoptiker' } }, lang: 'de',
      } };
    }
    if (url.includes('/page/summary/')) return { status: 404, json: {} };
    return { json: { nodes: [], pagination: { total: 0, from: 0, count: 0 } } };
  });
  const client = await connectedClient();
  try {
    const result = await client.callTool({
      name: 'search_wlo_all',
      arguments: { query: 'Feinoptik', includeWikipedia: true, outputFormat: 'markdown' },
    });
    assert.match(toolText(result), /per Suche aufgelöst/, 'the substitution must be visible here as well');
  } finally {
    await client.close();
    mock.restore();
  }
});

// ── The classifier trap (found by live probe 2026-08-02, not by review) ─────
// "only the longest content word counts" lets a generic noun outvote the proper
// name whenever it happens to be longer. Measured against the real client:
//   Insel Rab    → Insel (Album)     (a music album)
//   Element Zinn → Élément moral     (a French legal concept)
//   Fluss Po     → Fluss-Greiskraut  (a plant)

test('pickRelevantTitle: a generic classifier does not outvote the proper name', () => {
  assert.equal(pickRelevantTitle('Insel Rab', ['Insel (Album)']), null);
  assert.equal(pickRelevantTitle('Element Zinn', ['Élément moral']), null);
  assert.equal(pickRelevantTitle('Fluss Po', ['Fluss-Greiskraut']), null);
});

test('pickRelevantTitle: the specific term still decides when it is the longer one', () => {
  // "Rom" is a classifier-free qualifier, so nothing is dropped and the
  // specific term carries the match.
  assert.equal(pickRelevantTitle('Rom Kolosseum', ['Kolosseum']), 'Kolosseum');
});

test('pickRelevantTitle: covering more of the query beats covering less', () => {
  // Both candidates relate to the topic word; the one that also accounts for
  // the qualifier is the better answer.
  assert.equal(
    pickRelevantTitle('Satz Pythagoras', ['Pythagoras', 'Satz des Pythagoras']),
    'Satz des Pythagoras',
  );
});
