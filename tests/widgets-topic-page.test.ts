import { test } from 'node:test';
import assert from 'node:assert/strict';

import { renderTopicPage } from '../src/apps/widgets/topic-page/render.js';

function node(id: string, title: string): any {
  return {
    nodeId: id,
    title,
    description: '',
    disciplines: [],
    educationalContexts: [],
    learningResourceTypes: [],
    url: `https://example.org/${id}`,
    contentUrl: '',
    previewUrl: '',
    previewIsIcon: true,
    license: '',
    publisher: '',
    nodeType: 'content',
    topicPageUrl: '',
  };
}

function payload(over: Record<string, unknown> = {}): any {
  return {
    variantId: 'v1',
    collectionId: 'c1',
    variantTitle: 'Bruchrechnung',
    topicPageUrl: 'https://redaktion.openeduhub.net/edu-sharing/components/topic-pages?collectionId=c1',
    swimlaneCount: 2,
    swimlanesTotal: 2,
    swimlanes: [
      { heading: 'Einstieg', type: 'grid', items: [node('a', 'Video Bruch')], hasMore: true },
      { heading: 'Vertiefung', type: 'grid', items: [node('b', 'Arbeitsblatt Bruch')], hasMore: false },
    ],
    ...over,
  };
}

test('renderTopicPage renders the WLO-style page header: collection title over description over lanes', () => {
  const html = renderTopicPage(payload({
    collectionTitle: 'Optik',
    description: 'Alles zur <Lichtausbreitung>, Brechung und Reflexion.',
  }), 'de');
  assert.match(html, /<header class="wlo-topic__head">/);
  assert.match(html, /Optik/);
  assert.match(html, /&lt;Lichtausbreitung&gt;/, 'description is escaped');
  // The collection title takes precedence as the page heading.
  const h1 = html.match(/<h1[^>]*>(.*?)<\/h1>/)?.[1] ?? '';
  assert.match(h1, /Optik/);
});

test('renderTopicPage without header data renders no empty header block', () => {
  const html = renderTopicPage(payload(), 'de');
  assert.doesNotMatch(html, /wlo-topic__desc/, 'no empty description paragraph');
  assert.match(html, /Bruchrechnung/, 'variant title remains the fallback heading');
});

test('renderTopicPage shows the variant title and every swimlane heading + tiles', () => {
  const html = renderTopicPage(payload(), 'de');
  assert.match(html, /Bruchrechnung/);
  assert.match(html, /Einstieg/);
  assert.match(html, /Vertiefung/);
  assert.match(html, /Video Bruch/);
  assert.match(html, /Arbeitsblatt Bruch/);
});

test('renderTopicPage adds a "more on topic page" link only for lanes with hasMore', () => {
  const html = renderTopicPage(payload(), 'de');
  const moreLinks = html.match(/Mehr auf der Themenseite/g) ?? [];
  assert.equal(moreLinks.length, 1, 'exactly the one hasMore lane gets the link');
  assert.match(html, /href="https:\/\/redaktion\.openeduhub\.net\/edu-sharing\/components\/topic-pages\?collectionId=c1"/);
});

test('renderTopicPage drops a dangerous topicPageUrl (no javascript: more-link)', () => {
  const html = renderTopicPage(payload({ topicPageUrl: 'javascript:alert(1)' }), 'de');
  assert.doesNotMatch(html, /href="javascript:/i, 'no javascript: href');
  assert.doesNotMatch(html, /Mehr auf der Themenseite/, 'no more-link when the topic URL is unsafe');
});

test('renderTopicPage keeps the page header over the empty state (the title says WHAT is empty)', () => {
  const html = renderTopicPage(
    payload({ swimlanes: [], swimlaneCount: 0, collectionTitle: 'Optik', description: 'Einführung' }),
    'de',
  );
  assert.match(html, /wlo-topic__head/, 'header renders even without lanes');
  assert.match(html, /Optik/);
  assert.match(html, /Keine Treffer gefunden/);
});

test('renderTopicPage escapes the heading and renders an empty state when there are no swimlanes', () => {
  assert.match(renderTopicPage(payload({ variantTitle: '<x>' }), 'de'), /&lt;x&gt;/);
  const empty = payload({ swimlanes: [], swimlaneCount: 0 });
  assert.match(renderTopicPage(empty, 'de'), /Keine Treffer gefunden/);
  assert.match(renderTopicPage(undefined, 'en'), /No results found/);
});
