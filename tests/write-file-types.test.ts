/**
 * write-file-types.test.ts – MA-1: what kind of file is this, read from the bytes alone.
 *
 * The batch upload (MA-2…MA-4) files whole folders into a person's personal area. The type is
 * DETECTED from the head of the file (and, for ZIP containers, from the entry names of the central
 * directory), never taken from the client's name or MIME. The list IS the allow-list: anything not
 * recognised — HTML, SVG, executables, a ZIP without an Office marker — returns null and is not
 * filed. The extension always comes from the detected kind, never from the client.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { detectUploadType, MAX_ZIP_ENTRIES } from '../src/services/write/file-types.js';
import { IMAGE_SIGNATURES } from '../src/services/write/file-signatures.js';

const b = (s: string) => Buffer.from(s, 'latin1');

describe('detectUploadType', () => {
  it('recognises PDF from its header', () => {
    assert.deepEqual(detectUploadType(b('%PDF-1.7\n...'), []), { mimeType: 'application/pdf', ext: 'pdf' });
  });

  it('tells OOXML documents apart by their central-directory entries', () => {
    const zip = b('PK\u0003\u0004rest');
    assert.equal(detectUploadType(zip, ['[Content_Types].xml', 'word/document.xml'])?.ext, 'docx');
    assert.equal(detectUploadType(zip, ['ppt/presentation.xml'])?.ext, 'pptx');
    assert.equal(detectUploadType(zip, ['xl/workbook.xml'])?.ext, 'xlsx');
  });

  it('recognises ODF by its mimetype entry content', () => {
    const odt = b('PK\u0003\u0004\u0000'.padEnd(30, '\u0000') + 'mimetypeapplication/vnd.oasis.opendocument.text');
    assert.equal(detectUploadType(odt, ['mimetype', 'content.xml'])?.ext, 'odt');
  });

  it('rejects a ZIP without an Office marker, and one with too many entries', () => {
    const zip = b('PK\u0003\u0004rest');
    assert.equal(detectUploadType(zip, ['a.txt', 'b.exe']), null);
    const viele = Array.from({ length: MAX_ZIP_ENTRIES + 1 }, (_, i) => `x/${i}.xml`);
    assert.equal(detectUploadType(zip, ['word/document.xml', ...viele]), null);
  });

  it('shares the image signatures with content-source (one list, no copy)', () => {
    assert.ok(IMAGE_SIGNATURES.length >= 4);
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);
    assert.deepEqual(detectUploadType(png, []), { mimeType: 'image/png', ext: 'png' });
    assert.equal(detectUploadType(Buffer.from([0xff, 0xd8, 0xff, 0xe0]), [])?.ext, 'jpg');
    assert.equal(detectUploadType(b('GIF89a...'), [])?.ext, 'gif');
    assert.equal(detectUploadType(b('RIFF\u0000\u0000\u0000\u0000WEBPVP8 '), [])?.ext, 'webp');
  });

  it('recognises MP3 (ID3 or MPEG sync) and MP4 (ftyp at offset 4)', () => {
    assert.equal(detectUploadType(b('ID3\u0004\u0000'), [])?.ext, 'mp3');
    assert.equal(detectUploadType(Buffer.from([0xff, 0xfb, 0x90, 0x64]), [])?.ext, 'mp3');
    assert.equal(detectUploadType(b('\u0000\u0000\u0000\u0018ftypmp42'), [])?.ext, 'mp4');
  });

  it('accepts UTF-8 text without NUL; markdown only by name', () => {
    assert.deepEqual(detectUploadType(Buffer.from('Hallo Welt — Brüche\n', 'utf8'), []),
      { mimeType: 'text/plain', ext: 'txt' });
    assert.deepEqual(detectUploadType(Buffer.from('# Titel\n', 'utf8'), [], 'notizen.md'),
      { mimeType: 'text/markdown', ext: 'md' });
    assert.equal(detectUploadType(Buffer.from('a\u0000b', 'latin1'), []), null);
    assert.equal(detectUploadType(Buffer.from([0xc3, 0x28]), []), null);   // invalid UTF-8
  });

  it('never accepts HTML, SVG or executables — even when named innocently', () => {
    for (const kopf of ['<!DOCTYPE html><p>', '<html><body>', '  <svg xmlns=', '<?xml version="1.0"?><svg',
      'MZ\u0090\u0000', '\u007fELF\u0002', 'Ïúíþ']) {
      assert.equal(detectUploadType(b(kopf), [], 'harmlos.txt'), null, kopf);
    }
  });

  it('takes the extension from the kind, never from the client name', () => {
    assert.equal(detectUploadType(b('%PDF-1.4'), [], 'bericht.docx')?.ext, 'pdf');
  });

  it('rejects an empty file', () => {
    assert.equal(detectUploadType(Buffer.alloc(0), []), null);
  });
});


describe('detectUploadType — review MA-1/MA-2 (findings 4/5)', () => {
  it('refuses markup anywhere in a text file', () => {
    for (const text of ['<!-- x --><svg onload=alert(1)>', 'Hallo\n<!doctype html><p>', '<script>x</script>',
      '# Titel\n\n<body onload=x>', 'a\n'.repeat(5000) + '<iframe src=x>']) {
      assert.equal(detectUploadType(Buffer.from(text, 'utf8'), [], 'notiz.md'), null, text.slice(0, 30));
    }
    assert.equal(detectUploadType(Buffer.from('2 < 3 und 5 > 4', 'utf8'), [])?.ext, 'txt');
    assert.equal(detectUploadType(Buffer.from('0 < a < 1, a<b', 'utf8'), [])?.ext, 'txt');
    for (const tag of ['<details ontoggle=x>', '<video><source onerror=x>', '<input onfocus=x>', '<math>', '</b>']) {
      assert.equal(detectUploadType(Buffer.from(`Text ${tag}`, 'utf8'), []), null, tag);
    }
  });

  it('checks NUL and UTF-8 over the whole file, not just the head', () => {
    const text = Buffer.concat([Buffer.from('a'.repeat(9000)), Buffer.from([0, 1, 2])]);
    assert.equal(detectUploadType(text, []), null);
  });

  it('refuses UTF-16 and a fake MPEG sync in front of an executable', () => {
    assert.equal(detectUploadType(Buffer.from('\ufeff<html>', 'utf16le'), []), null);
    assert.equal(detectUploadType(Buffer.concat([Buffer.from([0xff, 0xfb]), Buffer.from('MZ\u0090\u0000', 'latin1')]), []), null);
    assert.equal(detectUploadType(Buffer.from('\u0000\u0000\u0000\u0018ftypevil', 'latin1'), []), null);
  });
});
