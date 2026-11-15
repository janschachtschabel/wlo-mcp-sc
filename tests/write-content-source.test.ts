/**
 * write-content-source.test.ts – deciding what a create call is actually filing.
 *
 * Two ways to make a record, side by side:
 *
 *   url      → the record POINTS at something; the content stays where it is
 *              (this is the crawler's world, unchanged)
 *   content  → the record CARRIES the bytes, because there is no URL: the
 *   /file      material was written in the conversation
 *
 * This module is the gate between them and is pure on purpose — every rule that
 * decides whether bytes may be uploaded is testable without a repository.
 *
 * Three rules it exists to hold:
 *
 *  1. **Exactly one source.** Two sources given is a rejection, never a silent
 *     priority — "url wins" would file a link while the person watched their
 *     worksheet in the preview.
 *  2. **The type is DETECTED, never declared.** A caller that cannot state the
 *     MIME cannot state it wrongly, so an executable dressed as `image/png`
 *     never reaches the repository under a type that would get it served.
 *  3. **The file name is DERIVED from the title.** No caller-supplied name means
 *     no path separators to strip and no traversal surface at all.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  resolveContentSource,
  describeUpload,
  MAX_TEXT_BYTES,
  MAX_FILE_BYTES,
  resolveFileUpload,
} from '../src/services/write/content-source.js';

const b64 = (bytes: number[]) => Buffer.from(bytes).toString('base64');
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13];
const JPEG = [0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46];
const GIF = [...Buffer.from('GIF89a'), 1, 0, 1, 0];
const WEBP = [...Buffer.from('RIFF'), 26, 0, 0, 0, ...Buffer.from('WEBPVP8 ')];

const ok = (r: ReturnType<typeof resolveContentSource>) => {
  assert.ok(r.ok, `expected a source, got: ${r.ok ? '' : r.reason}`);
  return r.source;
};

// ── choosing between the two ways ──────────────────────────────────────────

test('a URL alone files a link, exactly as before', () => {
  const s = ok(resolveContentSource({ title: 'Erfurt', url: 'https://example.org/a' }));
  assert.equal(s.kind, 'url');
  assert.equal(s.kind === 'url' && s.url, 'https://example.org/a');
});

test('text alone becomes a file the record carries', () => {
  const s = ok(resolveContentSource({ title: 'Bruchrechnung Übung', content: '# Aufgabe 1\n' }));
  assert.equal(s.kind, 'file');
  if (s.kind !== 'file') return;
  assert.equal(s.file.mimeType, 'text/markdown');
  assert.equal(s.file.bytes.toString('utf8'), '# Aufgabe 1\n');
});

test('two sources at once are refused, never silently ranked', () => {
  const r = resolveContentSource({
    title: 'x', url: 'https://example.org/a', content: '# hallo',
  });
  assert.equal(r.ok, false);
  assert.match(r.ok ? '' : r.reason, /genau eine|nur eine/i);
});

test('no source at all is refused with a reason naming both ways', () => {
  const r = resolveContentSource({ title: 'x' });
  assert.equal(r.ok, false);
  const reason = r.ok ? '' : r.reason;
  assert.match(reason, /url/i);
  assert.match(reason, /content|datei|text/i);
});

// ── the file name comes from the title ─────────────────────────────────────

test('the file name is derived from the title with the format’s extension', () => {
  const s = ok(resolveContentSource({ title: 'Brüche kürzen: Übung 1', content: '# x' }));
  assert.equal(s.kind === 'file' && s.file.fileName, 'brueche-kuerzen-uebung-1.md');
});

/**
 * A title is free text from a conversation. Because the name is DERIVED rather
 * than taken, a title that looks like a path cannot become one — there is no
 * caller-supplied name to sanitise in the first place.
 */
test('a title shaped like a path cannot produce one', () => {
  const s = ok(resolveContentSource({ title: '../../etc/passwd', content: '# x' }));
  const name = s.kind === 'file' ? s.file.fileName : '';
  assert.ok(!name.includes('/') && !name.includes('\\') && !name.includes('..'),
    `derived name must carry no path parts, got ${name}`);
});

test('a title with nothing usable still yields a name', () => {
  const s = ok(resolveContentSource({ title: '???', content: '# x' }));
  assert.match(s.kind === 'file' ? s.file.fileName : '', /^\S+\.md$/);
});

// ── images: detected, not declared ─────────────────────────────────────────

for (const [label, bytes, mime, ext] of [
  ['PNG', PNG, 'image/png', 'png'],
  ['JPEG', JPEG, 'image/jpeg', 'jpg'],
  ['GIF', GIF, 'image/gif', 'gif'],
  ['WebP', WEBP, 'image/webp', 'webp'],
] as const) {
  test(`${label} is recognised from its own bytes`, () => {
    const s = ok(resolveContentSource({ title: 'Diagramm', fileBase64: b64([...bytes]) }));
    assert.equal(s.kind === 'file' && s.file.mimeType, mime);
    assert.equal(s.kind === 'file' && s.file.fileName, `diagramm.${ext}`);
  });
}

/**
 * The rule that makes detection worth having: anything we cannot recognise is
 * refused rather than filed under a guessed type. A PDF is refused here too —
 * deliberately out of scope, and saying so beats storing it as an unknown blob.
 */
test('bytes we cannot recognise as a supported image are refused', () => {
  for (const [what, raw] of [
    ['a script', Buffer.from('#!/bin/sh\nrm -rf /')],
    ['HTML', Buffer.from('<html><script>alert(1)</script>')],
    ['a PDF', Buffer.from('%PDF-1.4\n')],
    ['an SVG', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script/></svg>')],
  ] as const) {
    const r = resolveContentSource({ title: 'x', fileBase64: raw.toString('base64') });
    assert.equal(r.ok, false, `${what} must not be accepted`);
    assert.match(r.ok ? '' : r.reason, /bild|image/i);
  }
});

test('base64 that does not decode is a rejection, not a crash', () => {
  const r = resolveContentSource({ title: 'x', fileBase64: 'not base64 !!!' });
  assert.equal(r.ok, false);
});

test('an empty source is refused rather than filed as an empty record', () => {
  assert.equal(resolveContentSource({ title: 'x', content: '   ' }).ok, false);
  assert.equal(resolveContentSource({ title: 'x', fileBase64: '' }).ok, false);
});

// ── size ───────────────────────────────────────────────────────────────────

test('text beyond the cap is refused with the limit named', () => {
  const r = resolveContentSource({ title: 'x', content: 'a'.repeat(MAX_TEXT_BYTES + 1) });
  assert.equal(r.ok, false);
  assert.match(r.ok ? '' : r.reason, new RegExp(String(Math.floor(MAX_TEXT_BYTES / 1024))));
});

test('an image beyond the cap is refused with the limit named', () => {
  const big = Buffer.concat([Buffer.from(PNG), Buffer.alloc(MAX_FILE_BYTES)]);
  const r = resolveContentSource({ title: 'x', fileBase64: big.toString('base64') });
  assert.equal(r.ok, false);
  assert.match(r.ok ? '' : r.reason, new RegExp(String(Math.floor(MAX_FILE_BYTES / 1024 / 1024))));
});

// ── what the person confirms ───────────────────────────────────────────────

/**
 * The confirmation token is bound to the change set, so everything the call will
 * send has to be IN it. Bytes are payload: without this line someone approves
 * "create a record" and we additionally upload something they never saw.
 *
 * Name, type, size and a digest, because those are checkable. For text the first
 * lines as well — that is the part a person can actually read.
 */
test('the preview names what will be uploaded, digest included', () => {
  const s = ok(resolveContentSource({ title: 'Übung', content: '# Aufgabe 1\nRechne aus.\n' }));
  const line = describeUpload(s.kind === 'file' ? s.file : (() => { throw new Error('file'); })());

  assert.match(line, /uebung\.md/, 'the file name');
  assert.match(line, /text\/markdown/, 'the type');
  assert.match(line, /\b24\b/, 'the exact byte count');
  assert.match(line, /[0-9a-f]{12}/, 'a digest prefix');
  assert.match(line, /Aufgabe 1/, 'and the readable beginning of the text');
});

test('two different texts never share a preview digest', () => {
  const a = ok(resolveContentSource({ title: 'x', content: '# eins' }));
  const b = ok(resolveContentSource({ title: 'x', content: '# zwei' }));
  const dig = (s: typeof a) => (s.kind === 'file' ? s.file.digest : '');
  assert.notEqual(dig(a), dig(b), 'the digest must bind the actual bytes');
});

test('the preview of an image says so without pretending to show it', () => {
  const s = ok(resolveContentSource({ title: 'Diagramm', fileBase64: b64(PNG) }));
  const line = describeUpload(s.kind === 'file' ? s.file : (() => { throw new Error('file'); })());
  assert.match(line, /image\/png/);
  assert.match(line, /diagramm\.png/);
  assert.ok(!/�/.test(line), 'binary must not be dumped into the preview');
});

// ── the shape image bytes actually arrive in ───────────────────────────────

/**
 * A model that has an image hands it over as a data URL far more often than as
 * bare base64 — it is what every browser API and every image tool produces.
 * Rejecting it was bad twice over: the feature failed on its most likely input,
 * and the message ("not a recognised image") pointed at the file TYPE while the
 * problem was the ENCODING, so the obvious next move is to try a different
 * image rather than to strip twenty-two characters.
 */
test('a data URL is accepted, not mistaken for an unknown file type', () => {
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
  const s = ok(resolveContentSource({
    title: 'Diagramm',
    fileBase64: `data:image/png;base64,${png.toString('base64')}`,
  }));
  assert.equal(s.kind === 'file' && s.file.mimeType, 'image/png');
  assert.equal(s.kind === 'file' && s.file.bytes.equals(png), true, 'the prefix must not become payload');
});

/**
 * The declared type in a data URL is NOT trusted — the bytes still decide. A
 * caller could otherwise reintroduce exactly the mismatch that detection exists
 * to rule out, simply by writing a different MIME into the prefix.
 */
test('the type in a data URL prefix does not override the bytes', () => {
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16]);
  const s = ok(resolveContentSource({
    title: 'x', fileBase64: `data:image/png;base64,${jpeg.toString('base64')}`,
  }));
  assert.equal(s.kind === 'file' && s.file.mimeType, 'image/jpeg', 'the bytes win');
});

test('a data URL whose payload is not an image is still refused', () => {
  const r = resolveContentSource({
    title: 'x',
    fileBase64: `data:image/png;base64,${Buffer.from('<script>').toString('base64')}`,
  });
  assert.equal(r.ok, false);
  assert.match(r.ok ? '' : r.reason, /bild|image/i);
});

/**
 * The encoding check has to fire for text that is not base64 at all, otherwise
 * the caller is told the file type is wrong when nothing was ever decoded.
 * `'not base64 !!!'` re-encodes four characters shorter than it arrived, which
 * a tolerance of 4 let through — padding is at most two characters, so that is
 * what the tolerance models.
 */
test('text that is not base64 is refused as an encoding problem, not a type problem', () => {
  const r = resolveContentSource({ title: 'x', fileBase64: 'not base64 !!!' });
  assert.equal(r.ok, false);
  assert.match(r.ok ? '' : r.reason, /base64/i);
});

test('base64 without padding is still accepted', () => {
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
  const unpadded = png.toString('base64').replace(/=+$/, '');
  assert.equal(resolveContentSource({ title: 'x', fileBase64: unpadded }).ok, true);
});

// ── the same bytes, for a record that already exists ───────────────────────

/**
 * `wlo_update_content` needs the file rules without the URL question: on an
 * existing record `url` is an ordinary metadata field, not a content source, and
 * a call that only changes the title must be able to send no file at all.
 *
 * Shared with `resolveContentSource` rather than copied — the rules that decide
 * whether bytes may be uploaded (type detection, size, encoding) are the ones a
 * second copy would let drift apart.
 */
test('an update with no file at all is fine, and says so with null', () => {
  const r = resolveFileUpload('Titel', {});
  assert.equal(r.ok, true);
  assert.equal(r.ok && r.file, null);
});

test('an update carries the same detection and naming rules as a create', () => {
  const r = resolveFileUpload('Brüche kürzen', { content: '# neu\n' });
  assert.ok(r.ok && r.file);
  assert.equal(r.file.fileName, 'brueche-kuerzen.md');
  assert.equal(r.file.mimeType, 'text/markdown');
});

test('an update may not send text and an image in the same call', () => {
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1]);
  const r = resolveFileUpload('x', { content: '# a', fileBase64: png.toString('base64') });
  assert.equal(r.ok, false);
  assert.match(r.ok ? '' : r.reason, /genau eine|nur eine/i);
});

test('an update refuses the same unrecognised bytes a create refuses', () => {
  const r = resolveFileUpload('x', { fileBase64: Buffer.from('%PDF-1.4').toString('base64') });
  assert.equal(r.ok, false);
  assert.match(r.ok ? '' : r.reason, /bild|image/i);
});
