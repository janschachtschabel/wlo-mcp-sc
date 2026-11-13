/**
 * text-content-bound.test.ts – `/textContent` is read under a byte bound, and
 * "there is none" is told apart from "no answer".
 *
 * Measured on staging 2026-11-13 (`npm run measure:uploads`): a 50 MB text file
 * answers its 52 428 837 characters as ONE JSON value, and the read took all of
 * it into memory — once as bytes and once as a string, for a tool whose largest
 * answer is 200 000 characters. The file size is the uploader's choice.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { TEXT_CONTENT_MAX_BYTES, readNodeTextContent } from '../src/wlo-node-text.js';
import { enrichStoredText } from '../src/services/content-search.js';
import { storedTextFields } from '../src/services/node-details.js';
import type { FormattedNode } from '../src/formatter.js';
import { installFetchMock, strictClient, toolText, type MockResult } from './fetchMock.js';

const md = { fileSize: 70, mimeType: 'text/x-web-markdown', linked: false };

/** A body delivered in pieces, counting what was actually pulled. */
function streamed(body: string, pieceBytes = 256 * 1024) {
  const bytes = Buffer.from(body, 'utf8');
  const state = { pulled: 0, cancelled: false };
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (state.pulled >= bytes.length) { controller.close(); return; }
      const piece = bytes.subarray(state.pulled, state.pulled + pieceBytes);
      state.pulled += piece.length;
      controller.enqueue(new Uint8Array(piece));
    },
    cancel() { state.cancelled = true; },
  }, { highWaterMark: 0 });
  return { stream, state, total: bytes.length };
}

async function withBody<T>(body: string, run: (s: ReturnType<typeof streamed>) => Promise<T>): Promise<T> {
  const s = streamed(body);
  const real = globalThis.fetch;
  globalThis.fetch = (async () => new Response(s.stream, { status: 200, headers: { 'content-type': 'application/json' } })) as typeof fetch;
  try { return await run(s); } finally { globalThis.fetch = real; }
}

test('a text past the bound is cut while it is read — the rest is never taken into memory', async () => {
  const sentence = 'Licht breitet sich geradlinig aus. Größe „ä“ \\n ';
  const big = JSON.stringify({ text: sentence.repeat(Math.ceil(3 * TEXT_CONTENT_MAX_BYTES / sentence.length)) });
  await withBody(big, async (s) => {
    const read = await readNodeTextContent('n1');
    assert.equal(read.status, 200);
    assert.equal(read.cut, true);
    assert.ok(read.text!.startsWith('Licht breitet sich geradlinig aus. Größe „ä“ \\n Licht'), 'decoded as the JSON string it is');
    assert.ok(Buffer.byteLength(read.text!) <= TEXT_CONTENT_MAX_BYTES, 'within the bound');
    assert.ok(read.text!.length > TEXT_CONTENT_MAX_BYTES / 4, 'and not thrown away either');
    assert.ok(!/�/.test(read.text!), 'no half character at the cut');
    assert.equal(s.state.cancelled, true, 'the stream was cancelled');
    assert.ok(s.state.pulled < s.total / 2, `pulled ${s.state.pulled} of ${s.total}`);
  });
});

test('a cut that lands inside an escape still decodes', async () => {
  // Eight cuts, one per pad; three of them land inside an escape (1, 3 and 2 characters to drop).
  const LS = String.fromCharCode(0x2028);
  for (let pad = 0; pad < 8; pad++) {
    const unit = `${'x'.repeat(pad)}\\ ä " ${LS} `;
    const body = `{"text":${JSON.stringify(unit.repeat(Math.ceil(1.2 * TEXT_CONTENT_MAX_BYTES / unit.length))).replace(/ä/g, '\\u00e4')}}`;
    await withBody(body, async () => {
      const read = await readNodeTextContent('n1');
      assert.equal(read.cut, true, `pad ${pad}`);
      assert.ok(read.text && read.text.length > 1000, `pad ${pad}: decoded`);
    });
  }
});

test('a body past the bound that is not the text shape is no answer — never a guess', async () => {
  await withBody(`{"other":"${'x'.repeat(2 * TEXT_CONTENT_MAX_BYTES)}"}`, async (s) => {
    const read = await readNodeTextContent('n1');
    assert.deepEqual([read.text, read.status, read.none], [null, 200, undefined]);
    assert.equal(s.state.cancelled, true, 'and it was not read to its end to find that out');
  });
});

test('a text whose document merely ENDS past the bound is whole — not reported as cut', async () => {
  for (const tail of ['"}', '"}\n', '" }\n\n']) {
    const text = 'a'.repeat(TEXT_CONTENT_MAX_BYTES - '{"text":"'.length - 1);
    await withBody(`{"text":"${text}${tail}`, async () => {
      const read = await readNodeTextContent('n1');
      assert.deepEqual([read.text?.length, read.cut], [text.length, undefined], JSON.stringify(tail));
    });
  }
});

test('an ordinary answer is unchanged, and `{"text":null}` says "none" where `{}` says nothing', async () => {
  const answers: Record<string, MockResult> = {
    a: { json: { text: 'Volltext' } }, b: { json: { content: 'Inhalt' } }, c: { json: { text: null } }, d: { json: {} },
    e: { text: '<html>login</html>' }, f: { status: 403, json: {} },
  };
  const mock = installFetchMock((url) => answers[/-home-\/(\w)\//.exec(url)![1]!]!);
  try {
    assert.deepEqual(await readNodeTextContent('a'), { text: 'Volltext', status: 200 });
    assert.deepEqual(await readNodeTextContent('b'), { text: 'Inhalt', status: 200 });
    assert.deepEqual(await readNodeTextContent('c'), { text: null, status: 200, none: true });
    assert.deepEqual(await readNodeTextContent('d'), { text: null, status: 200 });
    assert.deepEqual(await readNodeTextContent('e'), { text: null, status: 200 });
    assert.deepEqual(await readNodeTextContent('f'), { text: null, status: 403 });
  } finally { mock.restore(); }
});

// ── What the two sibling paths make of it ───────────────────────────────────

const hit = (nodeId: string, extra: Partial<FormattedNode> = {}) => ({ nodeId, fileSize: 0, mimeType: '', ...extra }) as FormattedNode;

test('search enrichment: "the repository has none" is an empty text, not an unreadable one', async () => {
  // Measured: a Markdown file, an image, audio and video all answer {"text":null}.
  // Reported as unreadable that read "try again" for a state that stays.
  const mock = installFetchMock((url): MockResult => {
    if (url.includes('/img/textContent')) return { json: { text: null } };
    if (url.includes('/gone/textContent')) return { json: {} };
    if (url.includes('/md/textContent')) return { json: { text: null } };
    if (url.includes('eduservlet/download') && url.includes('nodeId=md')) return { text: '# Optik\n\nBrechung' };
    return { status: 404, json: {} };
  });
  try {
    const list = [hit('img', { fileSize: 4478, mimeType: 'image/png' }), hit('gone'), hit('md', { fileSize: 70, mimeType: 'text/x-web-markdown' })];
    const report = await enrichStoredText(list);
    assert.equal(list[0]!.textContent, '');
    assert.equal(list[1]!.textContent, undefined);
    assert.deepEqual(report.unreadable, ['gone']);
    assert.equal(list[2]!.textContent, '# Optik\n\nBrechung', 'a public Markdown file is its own text');
    assert.equal(mock.calls.filter(c => c.url.includes('eduservlet/download')).length, 1, 'and nothing else is downloaded');
  } finally { mock.restore(); }
});

test('detail enrichment: the same Markdown file reads as text there too; a private one keeps its note', async () => {
  const mock = installFetchMock((url): MockResult => {
    if (url.includes('/textContent')) return { json: { text: null } };
    if (url.includes('nodeId=pub')) return { text: '# Optik' };
    return { status: 403, json: {} };
  });
  try {
    assert.deepEqual(await storedTextFields('pub', md), { textContent: '# Optik' });
    const priv = await storedTextFields('priv', md);
    assert.equal(priv['textContent'], '');
    assert.match(priv['textContentNote']!, /keinen Text daraus gewonnen/);
  } finally { mock.restore(); }
});

// ── Review of 2026-11-13 ────────────────────────────────────────────────────

test('a 200 that names no text field is "could not be read" on every path — and starts no download', async () => {
  const mock = installFetchMock((url): MockResult => {
    if (url.includes('/textContent')) return { text: '<html>Anmeldung</html>' };
    if (url.includes('/metadata')) return { json: { node: { ref: { id: 'n1' }, properties: { 'cclom:title': ['Notiz'] }, size: 70, mimetype: 'text/x-web-markdown' } } };
    return { text: '# Optik' };
  });
  try {
    const { getContentText } = await import('../src/services/content-text.js');
    assert.equal((await getContentText('n1', 8000)).reason, 'text_unreadable');
    const fields = await storedTextFields('n1', md);
    assert.equal(fields['textContent'], '');
    assert.match(fields['textContentError']!, /nennt keinen Text/);
    assert.equal(mock.calls.filter(c => c.url.includes('eduservlet/download')).length, 0);
  } finally { mock.restore(); }
});

test('the file fallback: not for a linked record, not without a file, and never bytes that are no text', async () => {
  const { fileTextFor } = await import('../src/services/content-text.js');
  let body = '# Optik';
  const mock = installFetchMock((): MockResult => ({ text: body }));
  try {
    assert.deepEqual(await fileTextFor('n1', md), { text: '# Optik', cut: false });
    assert.equal(await fileTextFor('n1', { ...md, linked: true }), null);
    assert.equal(await fileTextFor('n1', { ...md, fileSize: 0 }), null);
    assert.equal(mock.calls.length, 1, 'neither of the two was downloaded');
    // The type is the repository's verdict by file name: a binary called x.md.
    body = `${'Text '.repeat(200)}${String.fromCharCode(0, 1)}${'x'.repeat(400)}`;
    assert.equal(await fileTextFor('n1', md), null, 'control characters anywhere, however long the file');
    body = '   \n';
    assert.equal(await fileTextFor('n1', md), null);
  } finally { mock.restore(); }
});

test('storedFileOf: a record is linked when its address leads out of the repository', async () => {
  const { storedFileOf } = await import('../src/services/node-details.js');
  const { WLO_REPOSITORY_URL } = await import('../src/wlo-config.js');
  assert.equal(storedFileOf({ fileSize: 70, mimeType: 'text/x-web-markdown', url: `${WLO_REPOSITORY_URL}/components/render/n1` }).linked, false);
  assert.equal(storedFileOf({ fileSize: 70, mimeType: 'text/x-web-markdown', url: '' }).linked, false);
  assert.equal(storedFileOf({ fileSize: '70', mimeType: 'text/x-web-markdown', url: 'https://example.org/a' }).linked, true);
  assert.equal(storedFileOf({ fileSize: '70', url: 'https://example.org/a' }).fileSize, 70);
});

test('get_wlo_content_text: a source larger than what is read says "at least" — the count is of the part read', async () => {
  const sentence = 'Licht breitet sich geradlinig aus. ';
  const big = JSON.stringify({ text: sentence.repeat(Math.ceil(2 * TEXT_CONTENT_MAX_BYTES / sentence.length)) });
  const mock = installFetchMock((url): MockResult => {
    if (url.includes('/textContent')) return { text: big };
    return { json: { node: { ref: { id: 'n1' }, properties: { 'cclom:title': ['Lang'] }, size: 9_000_000, mimetype: 'text/plain' } } };
  });
  const client = await strictClient();
  try {
    const r = await client.callTool({ name: 'get_wlo_content_text', arguments: { nodeId: 'n1', maxChars: 1000 } });
    const s = r.structuredContent as { charCount: number; charCountIsLowerBound?: boolean; truncated: boolean };
    assert.equal(s.charCountIsLowerBound, true);
    assert.equal(s.truncated, true);
    assert.ok(s.charCount < big.length / 2);
    assert.match(toolText(r), /gekürzt auf 1000 von mindestens \d+ Zeichen/);
  } finally { await client.close(); mock.restore(); }
});

test('get_wlo_content_text: an ordinary long text carries no such caveat', async () => {
  const mock = installFetchMock((url): MockResult => {
    if (url.includes('/textContent')) return { json: { text: 'Licht breitet sich geradlinig aus. '.repeat(100) } };
    return { json: { node: { ref: { id: 'n1' }, properties: { 'cclom:title': ['Kurz'] } } } };
  });
  const client = await strictClient();
  try {
    const r = await client.callTool({ name: 'get_wlo_content_text', arguments: { nodeId: 'n1', maxChars: 1000 } });
    assert.equal('charCountIsLowerBound' in (r.structuredContent as object), false);
    assert.match(toolText(r), /gekürzt auf 1000 von 3499 Zeichen/);
  } finally { await client.close(); mock.restore(); }
});

test('fetch: a public Markdown record hands over its file, not its description', async () => {
  const { WLO_REPOSITORY_URL } = await import('../src/wlo-config.js');
  const mock = installFetchMock((url): MockResult => {
    if (url.includes('/textContent')) return { json: { text: null } };
    if (url.includes('eduservlet/download')) return { text: '# Optik\n\nDer ganze Text.' };
    return { json: { node: { ref: { id: 'n1' }, type: 'ccm:io', size: 70, mimetype: 'text/x-web-markdown',
      content: { url: `${WLO_REPOSITORY_URL}/components/render/n1` },
      properties: { 'cclom:title': ['Optik'], 'cclom:general_description': ['Nur die Beschreibung.'] } } } };
  });
  const client = await strictClient();
  try {
    const r = await client.callTool({ name: 'fetch', arguments: { id: 'n1' } });
    assert.equal((r.structuredContent as { text: string }).text, '# Optik\n\nDer ganze Text.');
  } finally { await client.close(); mock.restore(); }
});
