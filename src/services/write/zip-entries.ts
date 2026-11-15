/**
 * zip-entries.ts – the entry NAMES of a ZIP file, read from its central directory, nothing unpacked.
 *
 * Only what MA-1 needs to tell OOXML/ODF documents apart (`word/document.xml`, `mimetype`, …). Finds
 * the end-of-central-directory record in the last 64 KB, then walks the directory headers. Stops at
 * MAX_ZIP_ENTRIES + 1 entries (the caller refuses such files) and at the first malformed header — a
 * broken directory yields what was read so far, which never contains an Office marker by accident.
 */

import { MAX_ZIP_ENTRIES } from './file-types.js';

const EOCD = 0x06054b50;
const CENTRAL = 0x02014b50;
const TAIL = 65_557;              // 22-byte EOCD + the longest possible comment

export function zipEntryNames(data: Buffer): string[] {
  const start = Math.max(0, data.length - TAIL);
  let eocd = -1;
  for (let i = data.length - 22; i >= start; i--) {
    if (data.readUInt32LE(i) === EOCD) { eocd = i; break; }
  }
  if (eocd < 0) return [];
  // The declared entry count — a short directory must not slip past the cap (review, finding 10).
  if (data.readUInt16LE(eocd + 10) > MAX_ZIP_ENTRIES) {
    return Array.from({ length: MAX_ZIP_ENTRIES + 1 }, () => '');
  }
  const dirSize = data.readUInt32LE(eocd + 12);
  const dirOffset = data.readUInt32LE(eocd + 16);
  if (dirOffset + dirSize > data.length) return [];
  const names: string[] = [];
  let pos = dirOffset;
  const end = dirOffset + dirSize;
  while (pos + 46 <= end && names.length <= MAX_ZIP_ENTRIES) {
    if (data.readUInt32LE(pos) !== CENTRAL) break;
    const nameLen = data.readUInt16LE(pos + 28);
    const extraLen = data.readUInt16LE(pos + 30);
    const commentLen = data.readUInt16LE(pos + 32);
    if (pos + 46 + nameLen > end) break;
    names.push(data.subarray(pos + 46, pos + 46 + nameLen).toString('utf8'));
    pos += 46 + nameLen + extraLen + commentLen;
  }
  return names;
}
