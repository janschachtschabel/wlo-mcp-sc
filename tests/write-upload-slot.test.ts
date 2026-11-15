/**
 * write-upload-slot.test.ts – MA-2: a short-lived place for one uploaded file, owned by one identity.
 *
 * The chatbot streams each file of a batch here before the batch tool files it (MA-4). The slot:
 *  - keeps the bytes in memory (the server stores nothing at rest), hashing while it reads — a body
 *    over the limit is cut off and nothing is kept;
 *  - reads the type from the bytes (MA-1) — unknown types are refused;
 *  - hands out an opaque ref that only the SAME identity can take, exactly once;
 *  - expires after 30 minutes;
 *  - caps open refs per identity AND in total (unverified credentials must not fill the memory).
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';

import { UploadSlots } from '../src/services/write/upload-slot.js';

const PDF = Buffer.from('%PDF-1.7\nHallo\n%%EOF\n', 'latin1');

function strom(...teile: Buffer[]): Readable {
  return Readable.from(teile);
}

describe('UploadSlots', () => {
  let now: number;
  let slots: UploadSlots;

  beforeEach(() => {
    now = 1_000_000;
    slots = new UploadSlots({ maxBytes: 1024, maxPerIdentity: 2, maxTotal: 3,
      maxTotalBytes: 4096, ttlMs: 30 * 60 * 1000, clock: () => now });
  });

  it('stores a file, hashes it and detects its type', async () => {
    const r = await slots.put('person-a', strom(PDF), 'brief.pdf');
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.equal(r.slot.sha256, createHash('sha256').update(PDF).digest('hex'));
    assert.equal(r.slot.size, PDF.length);
    assert.deepEqual(r.slot.type, { mimeType: 'application/pdf', ext: 'pdf' });
    assert.match(r.slot.ref, /^[A-Za-z0-9_-]{20,}$/);
  });

  it('cuts off a body over the limit and keeps nothing', async () => {
    const r = await slots.put('person-a', strom(PDF, Buffer.alloc(2048)), 'gross.pdf');
    assert.deepEqual(r, { ok: false, code: 'too_large' });
    assert.equal(slots.open, 0);
  });

  it('refuses an unknown type and keeps nothing', async () => {
    const r = await slots.put('person-a', strom(Buffer.from('<html><body>x', 'latin1')), 'seite.txt');
    assert.deepEqual(r, { ok: false, code: 'unsupported_type' });
    assert.equal(slots.open, 0);
  });

  it('recognises an OOXML file from its central directory', async () => {
    const docx = minimalZip(['[Content_Types].xml', 'word/document.xml']);
    const r = await slots.put('person-a', strom(docx), 'text.docx');
    assert.equal(r.ok && r.slot.type.ext, 'docx');
  });

  it('only the same identity takes a ref, and only once', async () => {
    const r = await slots.put('person-a', strom(PDF), 'a.pdf');
    assert.ok(r.ok);
    if (!r.ok) return;
    assert.equal(slots.take(r.slot.ref, 'person-b'), null);
    const genommen = slots.take(r.slot.ref, 'person-a');
    assert.ok(genommen && genommen.data.equals(PDF));
    assert.equal(slots.take(r.slot.ref, 'person-a'), null);
  });

  it('expires after 30 minutes', async () => {
    const r = await slots.put('person-a', strom(PDF), 'a.pdf');
    assert.ok(r.ok);
    if (!r.ok) return;
    now += 30 * 60 * 1000 + 1;
    assert.equal(slots.take(r.slot.ref, 'person-a'), null);
    slots.sweep();
    assert.equal(slots.open, 0);
  });

  it('caps open refs per identity and in total', async () => {
    assert.ok((await slots.put('person-a', strom(PDF), 'a.pdf')).ok);
    assert.ok((await slots.put('person-a', strom(PDF), 'b.pdf')).ok);
    assert.deepEqual(await slots.put('person-a', strom(PDF), 'c.pdf'), { ok: false, code: 'too_many' });
    assert.ok((await slots.put('person-b', strom(PDF), 'd.pdf')).ok);
    assert.deepEqual(await slots.put('person-c', strom(PDF), 'e.pdf'), { ok: false, code: 'too_many' });
  });
});

/** A ZIP with the given (empty, stored) entries — enough central directory for MA-1. */
function minimalZip(names: string[]): Buffer {
  const lokal: Buffer[] = [];
  const zentral: Buffer[] = [];
  let offset = 0;
  for (const name of names) {
    const n = Buffer.from(name, 'utf8');
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0);
    lh.writeUInt16LE(n.length, 26);
    lokal.push(lh, n);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0);
    ch.writeUInt16LE(n.length, 28);
    ch.writeUInt32LE(offset, 42);
    zentral.push(ch, n);
    offset += 30 + n.length;
  }
  const cd = Buffer.concat(zentral);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(names.length, 8);
  eocd.writeUInt16LE(names.length, 10);
  eocd.writeUInt32LE(cd.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...lokal, cd, eocd]);
}
