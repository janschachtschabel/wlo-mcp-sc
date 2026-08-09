/**
 * services/write/content-source.ts – what a create call is filing.
 *
 * Two ways to make a record, side by side:
 *
 *   url  → the record POINTS at something and the content stays where it is.
 *          The repository crawls it; `ccm:wwwurl` carries the address. This is
 *          the original path and is unchanged.
 *   file → the record CARRIES the bytes, because there is no URL: the material
 *          was written in the conversation. Text (Markdown) or an image.
 *
 * Pure — no HTTP, no filesystem, no environment. Every rule that decides
 * whether bytes may be uploaded is therefore testable without a repository,
 * which matters more here than usual: these rules are the ones that keep an
 * executable from being filed under a type that would get it served.
 *
 * Three decisions this module encodes, each narrowing what can go wrong:
 *
 * - **Exactly one source.** Two given is a rejection, never a silent priority.
 *   "url wins" would file a link while the person watched their worksheet in
 *   the preview.
 * - **The type is DETECTED from the bytes, never declared by the caller.** What
 *   a caller cannot state, it cannot state wrongly. Anything unrecognised is
 *   refused rather than stored under a guess.
 * - **The file name is DERIVED from the title.** No caller-supplied name means
 *   no path separators to strip and no traversal surface to reason about.
 *
 * Deliberately NOT supported, and both omissions are the point:
 *
 * - **HTML.** A record whose bytes the repository serves as `text/html` from
 *   its own origin is stored XSS. Markdown covers what worksheets need.
 * - **SVG.** It is a document format that executes script. Magic bytes cannot
 *   separate a drawing from a payload, because there is nothing to separate —
 *   the same file is both.
 */

import { createHash } from 'node:crypto';
// `cutAtWordBoundary`, not `capText`: this excerpt becomes one line of a
// confirmation preview, and `capText`'s marker starts with a blank line — which
// in a line-oriented preview forges an extra change line. The head of the
// sentence already states the exact byte count, so the cut is disclosed without
// a marker at all.
import { cutAtWordBoundary } from '../../text-cap.js';
import { flattenText } from '../../text-sanitize.js';

/** Bytes ready to be attached to a record, with what the preview needs to name them. */
export interface UploadFile {
  bytes: Buffer;
  /** Derived from the title; carries the extension matching `mimeType`. */
  fileName: string;
  mimeType: string;
  /** SHA-256 prefix — what binds the confirmation token to these exact bytes. */
  digest: string;
  /** Readable beginning, for text only. Empty for an image. */
  excerpt: string;
}

export type ContentSource =
  | { kind: 'url'; url: string }
  | { kind: 'file'; file: UploadFile };

export type SourceResult =
  | { ok: true; source: ContentSource }
  | { ok: false; reason: string };

/**
 * Generous for Markdown — a long worksheet is a few tens of kilobytes — and far
 * below the transport limit, so the refusal comes from here with a sentence a
 * person can act on, rather than from the HTTP layer as a bare 413.
 */
export const MAX_TEXT_BYTES = 512 * 1024;

/** An image the model generated. Same reasoning as above. */
export const MAX_FILE_BYTES = 2 * 1024 * 1024;

/** How much of a text is shown in the confirmation preview. */
const EXCERPT_CHARS = 300;
/** Enough digest to bind the bytes; the whole hash would only be noise to read. */
const DIGEST_CHARS = 12;

const TEXT_FORMATS = {
  markdown: { mimeType: 'text/markdown', ext: 'md' },
  text: { mimeType: 'text/plain', ext: 'txt' },
} as const;

export type TextFormat = keyof typeof TEXT_FORMATS;

export function isTextFormat(value: unknown): value is TextFormat {
  return typeof value === 'string' && value in TEXT_FORMATS;
}

/**
 * Image formats we can recognise with certainty from a fixed prefix. The list
 * IS the allow-list: detection and permission are the same decision, so a
 * format cannot be permitted without also being recognisable.
 */
const IMAGE_SIGNATURES: { mimeType: string; ext: string; matches: (b: Buffer) => boolean }[] = [
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

/**
 * Title → a file name that is only ever a base name.
 *
 * Transliterates the German umlauts rather than dropping them, so `Brüche`
 * becomes `brueche` and not `brche`. Everything outside `a-z0-9` collapses to a
 * single hyphen, which is also what removes every path separator, `.` and `..`
 * — the traversal question never arises because no caller-supplied name exists.
 */
function fileNameFrom(title: string, ext: string): string {
  const slug = title
    .toLowerCase()
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/, '');
  // A title of punctuation alone still needs a name the repository accepts.
  return `${slug || 'inhalt'}.${ext}`;
}

function makeFile(bytes: Buffer, mimeType: string, fileName: string, excerpt: string): UploadFile {
  return {
    bytes,
    fileName,
    mimeType,
    digest: createHash('sha256').update(bytes).digest('hex').slice(0, DIGEST_CHARS),
    excerpt,
  };
}

function fromText(title: string, raw: string, format: TextFormat): SourceResult {
  if (!raw.trim()) {
    return { ok: false, reason: 'Der Inhalt ist leer. Ein Datensatz ohne Inhalt wird nicht angelegt.' };
  }
  // Stored EXACTLY as given — the trim above only answers "is there anything
  // here". Silently dropping a trailing newline would mean the digest in the
  // preview describes bytes the caller did not send, which is the one thing
  // that fingerprint exists to rule out.
  const bytes = Buffer.from(raw, 'utf8');
  if (bytes.byteLength > MAX_TEXT_BYTES) {
    return {
      ok: false,
      reason: `Der Text ist ${Math.round(bytes.byteLength / 1024)} KB groß, erlaubt sind ` +
        `${Math.floor(MAX_TEXT_BYTES / 1024)} KB. Bitte kürzen oder aufteilen.`,
    };
  }
  const { mimeType, ext } = TEXT_FORMATS[format];
  return {
    ok: true,
    source: {
      kind: 'file',
      file: makeFile(bytes, mimeType, fileNameFrom(title, ext), cutAtWordBoundary(raw, EXCERPT_CHARS)),
    },
  };
}

/**
 * A `data:<mime>;base64,` prefix, which is how image bytes usually arrive.
 *
 * Every browser API and image tool produces this form, so a model that HAS an
 * image hands over a data URL far more often than bare base64. Refusing it
 * failed the feature on its most likely input — and failed it with "not a
 * recognised image", pointing at the file type while the problem was the
 * encoding.
 *
 * The declared type is matched but deliberately DISCARDED: the bytes still
 * decide. Trusting it would reintroduce exactly the mismatch that detection
 * exists to rule out, by letting a caller write any MIME into the prefix.
 */
const DATA_URL_PREFIX = /^data:[\w.+-]+\/[\w.+-]+(;[\w-]+=[\w-]+)*;base64,/i;

function fromBase64(title: string, raw: string): SourceResult {
  const cleaned = raw.trim().replace(DATA_URL_PREFIX, '');
  if (!cleaned) {
    return { ok: false, reason: 'Die Bilddatei ist leer.' };
  }
  // Node's base64 decoder skips anything it does not recognise instead of
  // failing, so a decode that "worked" proves nothing — re-encoding and
  // comparing lengths is what catches a string that was never base64.
  //
  // Tolerance 2, because that is the most padding a caller can omit. It used to
  // be 4, which is wider than the thing it models: `not base64 !!!` re-encodes
  // exactly four characters shorter and slipped through, so the caller was told
  // the file TYPE was wrong about bytes that had never decoded.
  const bytes = Buffer.from(cleaned, 'base64');
  if (!bytes.byteLength || Math.abs(bytes.toString('base64').length - cleaned.replace(/\s+/g, '').length) > 2) {
    return {
      ok: false,
      reason: 'Die Bilddaten sind kein gültiges Base64. Erwartet wird der reine Base64-Text oder eine ' +
        'data:-URL (data:image/png;base64,…).',
    };
  }
  if (bytes.byteLength > MAX_FILE_BYTES) {
    return {
      ok: false,
      reason: `Die Datei ist ${Math.round(bytes.byteLength / 1024 / 1024)} MB groß, erlaubt sind ` +
        `${Math.floor(MAX_FILE_BYTES / 1024 / 1024)} MB.`,
    };
  }
  const signature = IMAGE_SIGNATURES.find((s) => s.matches(bytes));
  if (!signature) {
    return {
      ok: false,
      reason: 'Diese Datei ist kein erkanntes Bild (unterstützt: PNG, JPEG, GIF, WebP). Andere Dateitypen ' +
        'werden nicht hochgeladen — auch nicht unter einem angegebenen Typ, weil der Typ hier aus den Daten ' +
        'selbst gelesen wird.',
    };
  }
  return {
    ok: true,
    source: {
      kind: 'file',
      file: makeFile(bytes, signature.mimeType, fileNameFrom(title, signature.ext), ''),
    },
  };
}

/** Bytes to attach, or `null` when the call carries none. */
export type FileResult =
  | { ok: true; file: UploadFile | null }
  | { ok: false; reason: string };

export interface FileParams {
  content?: string | undefined;
  contentFormat?: string | undefined;
  fileBase64?: string | undefined;
}

const given = (value: string | undefined): boolean => value !== undefined && value !== '';

/**
 * Turn `content`/`fileBase64` into bytes, or report that none were sent.
 *
 * The file half on its own, because the two tools ask different questions
 * around it. Creating a record needs a source and `url` is one of them; changing
 * an existing record needs no file at all, and there `url` is an ordinary
 * metadata field rather than a content source. What must NOT differ between them
 * is everything below this line — type detection, size, encoding, the derived
 * name — so both go through here.
 *
 * @param title  What the file name is derived from. On an update the caller
 *               passes the record's stored title when none is being changed.
 */
export function resolveFileUpload(title: string, params: FileParams): FileResult {
  if (given(params.content) && given(params.fileBase64)) {
    return {
      ok: false,
      reason: 'Es wurden Text und Bild zugleich angegeben. Bitte genau eine Datei je Aufruf: ' +
        'entweder content oder fileBase64.',
    };
  }

  if (given(params.fileBase64)) {
    const r = fromBase64(title, params.fileBase64!);
    return r.ok ? { ok: true, file: (r.source as { kind: 'file'; file: UploadFile }).file } : r;
  }

  if (!given(params.content)) return { ok: true, file: null };

  const format = params.contentFormat ?? 'markdown';
  if (!isTextFormat(format)) {
    return {
      ok: false,
      reason: `Unbekanntes Format „${flattenText(String(format))}“. Möglich sind markdown und text. ` +
        'HTML wird bewusst nicht hochgeladen.',
    };
  }
  const r = fromText(title, params.content!, format);
  return r.ok ? { ok: true, file: (r.source as { kind: 'file'; file: UploadFile }).file } : r;
}

/**
 * Decide what this CREATE call files, or say why it cannot.
 *
 * Exactly one source: `url` for material that lives elsewhere, or a file the
 * record carries. Two given is a rejection, never a silent priority.
 *
 * @param params.title       Required; the file name is derived from it.
 * @param params.url         Source URL — the record points at it.
 * @param params.content     Text the record will carry.
 * @param params.contentFormat `markdown` (default) or `text`.
 * @param params.fileBase64  Image bytes the record will carry.
 */
export function resolveContentSource(params: FileParams & {
  title: string;
  url?: string | undefined;
}): SourceResult {
  const hasUrl = !!params.url?.trim();
  const hasFile = given(params.content) || given(params.fileBase64);

  if (hasUrl && hasFile) {
    return {
      ok: false,
      reason: 'Es wurde mehr als eine Inhaltsquelle angegeben. Bitte genau eine: entweder url für ein ' +
        'Material, das anderswo liegt, oder content bzw. fileBase64 für einen Inhalt, den der Datensatz ' +
        'selbst tragen soll.',
    };
  }
  if (!hasUrl && !hasFile) {
    return {
      ok: false,
      reason: 'Es fehlt die Inhaltsquelle. Entweder url angeben (das Material liegt anderswo und wird ' +
        'verlinkt) oder content für einen Text bzw. fileBase64 für ein Bild, das der Datensatz selbst trägt.',
    };
  }
  if (hasUrl) return { ok: true, source: { kind: 'url', url: params.url!.trim() } };

  const r = resolveFileUpload(params.title, params);
  if (!r.ok) return r;
  // `hasFile` is true here, so `resolveFileUpload` cannot have returned null.
  return { ok: true, source: { kind: 'file', file: r.file! } };
}

/**
 * One line for the confirmation preview naming everything the upload will send.
 *
 * The token is bound to a fingerprint of the change set, so bytes that are not
 * described here would be approved unseen. Name, type, exact size and a digest
 * are what makes the description checkable; for text the readable beginning is
 * added, because that is the part a person can actually judge.
 *
 * Flattened, not capped: the excerpt is already bounded, and capping the
 * assembled sentence again would spend the budget on the fixed prose.
 */
export function describeUpload(file: UploadFile): string {
  const head = `Lädt die Datei „${file.fileName}“ hoch (${file.mimeType}, `
    + `${file.bytes.byteLength} Bytes, SHA-256 ${file.digest}).`;
  return flattenText(file.excerpt ? `${head} Anfang des Inhalts: ${file.excerpt}` : head);
}
