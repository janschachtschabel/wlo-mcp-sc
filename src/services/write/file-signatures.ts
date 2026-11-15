/**
 * file-signatures.ts – image formats recognised with certainty from a fixed prefix.
 *
 * Shared by the single-file upload (`content-source.ts`) and the batch upload (`file-types.ts`,
 * MA-1): one list, so a format cannot be allowed on one path and refused on the other. The list IS
 * the allow-list — detection and permission are the same decision.
 */

export interface Signature {
  mimeType: string;
  ext: string;
  matches: (b: Buffer) => boolean;
}

export const IMAGE_SIGNATURES: readonly Signature[] = [
  {
    mimeType: 'image/png',
    ext: 'png',
    matches: (b) => b.length >= 8 && b.subarray(0, 8).equals(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    ),
  },
  {
    mimeType: 'image/jpeg',
    ext: 'jpg',
    matches: (b) => b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  },
  {
    mimeType: 'image/gif',
    ext: 'gif',
    matches: (b) => b.length >= 6
      && (b.subarray(0, 6).toString('latin1') === 'GIF87a' || b.subarray(0, 6).toString('latin1') === 'GIF89a'),
  },
  {
    // RIFF container with a WEBP chunk — both halves, because "RIFF" alone is
    // also a WAV file.
    mimeType: 'image/webp',
    ext: 'webp',
    matches: (b) => b.length >= 12
      && b.subarray(0, 4).toString('latin1') === 'RIFF'
      && b.subarray(8, 12).toString('latin1') === 'WEBP',
  },
];
