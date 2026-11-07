/**
 * file-types.ts – MA-1: the kind of an uploaded file, read from its bytes alone.
 *
 * Used by the batch upload into a person's personal area (upload slot, MA-2; batch filing, MA-4).
 * The type is DETECTED from the head of the file — and for ZIP containers from the entry names of
 * the central directory, which the caller lists without extracting anything — never taken from the
 * client's file name or MIME. What is not recognised is not filed:
 *
 *   %PDF-                                 → pdf
 *   ZIP + word/document.xml               → docx   (ppt/presentation.xml → pptx, xl/workbook.xml → xlsx)
 *   ZIP + mimetype application/vnd.oasis… → odt / ods / odp
 *   PNG, JPEG, GIF, WebP                  → the shared IMAGE_SIGNATURES
 *   ID3 or MPEG frame sync                → mp3;   "ftyp" at offset 4 → mp4
 *   UTF-8 without NUL                     → txt (md only when the client name ends in .md)
 *
 * Refused (null): text carrying HTML/SVG/XML markup ANYWHERE (`<!--`, `<!doctype`, `<?xml`, `<script`,
 * `<svg`, `<body`, …), UTF-16, PE, ELF and
 * Mach-O executables, a ZIP without an Office marker or with more than MAX_ZIP_ENTRIES entries,
 * invalid UTF-8, empty files. The extension always comes from the detected kind.
 */

import { IMAGE_SIGNATURES } from './file-signatures.js';

export interface UploadType {
  mimeType: string;
  ext: string;
}

/** A ZIP with more entries is refused outright (zip-bomb style containers, nothing is unpacked). */
export const MAX_ZIP_ENTRIES = 2000;

const OOXML: ReadonlyArray<[string, UploadType]> = [
  ['word/document.xml', {
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', ext: 'docx' }],
  ['ppt/presentation.xml', {
    mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', ext: 'pptx' }],
  ['xl/workbook.xml', {
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', ext: 'xlsx' }],
];

const ODF: ReadonlyArray<[string, string]> = [
  ['text', 'odt'], ['spreadsheet', 'ods'], ['presentation', 'odp'],
];

/** Markup anywhere in a text file — any tag (`<x `, `<x>`, `</x`), comment, doctype or XML head. No
 *  blank after `<` (as in HTML tokenising), so "0 < a < 1" is text (review MA-3/MA-4, finding 8). This
 *  also refuses markdown with inline HTML — on purpose: defence in depth, the repository's rendering
 *  of markdown is unmeasured. */
const MARKUP_ANYWHERE = /<!--|<!doctype|<\?xml|<\/?[a-z][a-z0-9-]*(?=[\s>/])/i;
/** Major brands of an ISO-BMFF (`ftyp`) file we accept as mp4. */
const MP4_BRANDS = new Set(['isom', 'iso2', 'iso4', 'iso5', 'iso6', 'mp41', 'mp42', 'avc1', 'M4V ', 'dash']);
const HEAD_BYTES = 8192;

function startsWith(b: Buffer, text: string, offset = 0): boolean {
  return b.length >= offset + text.length
    && b.subarray(offset, offset + text.length).toString('latin1') === text;
}

function isExecutable(b: Buffer): boolean {
  if (startsWith(b, 'MZ') || startsWith(b, '\u007fELF')) return true;
  if (b.length < 4) return false;
  const magic = b.readUInt32BE(0);
  // Mach-O 32/64 in both byte orders, and the universal ("fat") header.
  return [0xfeedface, 0xfeedfacf, 0xcefaedfe, 0xcffaedfe, 0xcafebabe].includes(magic);
}

function zipType(head: Buffer, entries: readonly string[]): UploadType | null {
  if (entries.length > MAX_ZIP_ENTRIES) return null;
  const names = new Set(entries);
  for (const [entry, type] of OOXML) {
    if (names.has(entry)) return type;
  }
  if (names.has('mimetype')) {
    // ODF stores `mimetype` first and uncompressed, so its value sits in the head.
    const text = head.subarray(0, 200).toString('latin1');
    for (const [kind, ext] of ODF) {
      const mimeType = `application/vnd.oasis.opendocument.${kind}`;
      if (text.includes(mimeType)) return { mimeType, ext };
    }
  }
  return null;
}

function textType(data: Buffer, clientName: string): UploadType | null {
  if (data.includes(0)) return null;
  let text: string;
  try {
    // ``stream`` tolerates a multi-byte character cut off at the end of a truncated buffer.
    text = new TextDecoder('utf-8', { fatal: true }).decode(data, { stream: true });
  } catch {
    return null;
  }
  if (MARKUP_ANYWHERE.test(text)) return null;
  return /\.md$/i.test(clientName)
    ? { mimeType: 'text/markdown', ext: 'md' }
    : { mimeType: 'text/plain', ext: 'txt' };
}

/** A real MPEG audio frame header, not just three sync bits (review MA-1/MA-2, finding 5). */
function isMpegFrame(b: Buffer): boolean {
  if (b.length < 4 || b[0] !== 0xff || (b[1]! & 0xe0) !== 0xe0) return false;
  const version = (b[1]! >> 3) & 3;
  const layer = (b[1]! >> 1) & 3;
  const bitrate = b[2]! >> 4;
  const rate = (b[2]! >> 2) & 3;
  return version !== 1 && layer !== 0 && bitrate !== 0 && bitrate !== 15 && rate !== 3;
}

function isMp4(b: Buffer): boolean {
  if (!startsWith(b, 'ftyp', 4) || b.length < 12) return false;
  const box = b.readUInt32BE(0);
  return box >= 16 && box <= 4096 && MP4_BRANDS.has(b.subarray(8, 12).toString('latin1'));
}

/**
 * The kind of a file from its bytes (`data`: the whole file, or at least its head — text checks run
 * over everything given), the entry names of its ZIP central directory (empty when it is no ZIP), and
 * — only to tell markdown from plain text — the client's file name. `null` = not allowed.
 */
export function detectUploadType(
  data: Buffer, zipEntries: readonly string[], clientName = '',
): UploadType | null {
  const head = data.subarray(0, HEAD_BYTES);
  if (head.length === 0 || isExecutable(head)) return null;
  // UTF-16 in either byte order — text we do not inspect, and FF FE also looks like MPEG sync.
  if (startsWith(head, '\u00ff\u00fe') || startsWith(head, '\u00fe\u00ff')) return null;
  if (startsWith(head, '%PDF-')) return { mimeType: 'application/pdf', ext: 'pdf' };
  if (startsWith(head, 'PK\u0003\u0004')) return zipType(head, zipEntries);
  const image = IMAGE_SIGNATURES.find((s) => s.matches(head));
  if (image) return { mimeType: image.mimeType, ext: image.ext };
  if (startsWith(head, 'ID3') || isMpegFrame(head)) return { mimeType: 'audio/mpeg', ext: 'mp3' };
  if (isMp4(head)) return { mimeType: 'video/mp4', ext: 'mp4' };
  return textType(data, clientName);
}
