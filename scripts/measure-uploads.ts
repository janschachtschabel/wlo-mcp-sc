/**
 * measure-uploads.ts – MA-0: which files a repository takes, how long it takes
 * them, and what `GET …/textContent` makes of each (`npm run measure:uploads`).
 *
 * It REPORTS and keeps nothing: every record is a throwaway in the caller's
 * own area and is deleted again; one that stays is named. Staging only — the
 * same guard as the live tests.
 *
 *   npm run measure:uploads                      formats + 1 and 10 MB
 *   npm run measure:uploads -- --media <dir>     also every file in <dir> (images, audio, video)
 *   npm run measure:uploads -- --big             also one 50 MB file
 *
 * The office files are built here, as STORED zip containers: no dependency,
 * and what is uploaded is exactly what the source shows.
 */

import { crc32 } from 'node:zlib';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { getNodeMetadata, readNodeTextContent } from '../src/wlo-api.js';
import { createContentNode, deleteContentNode } from '../src/services/write/nodes-lifecycle.js';
import { detectUploadType } from '../src/services/write/file-types.js';
import { zipEntryNames } from '../src/services/write/zip-entries.js';
import type { UploadFile } from '../src/services/write/content-source.js';
import { requireLiveTarget } from '../tests/live/guard.js';

const TOKEN = `zqma${Date.now().toString(36)}`;
const SENTENCE = `Lichtbrechung am Prisma ${TOKEN}`;
const TEXT_TIMEOUT_MS = 120_000;
const UPLOAD_TIMEOUT_MS = 300_000;

/** A zip container with every entry STORED (method 0). */
function zip(entries: Array<[string, string]>): Buffer {
  const local: Buffer[] = []; const central: Buffer[] = []; let offset = 0;
  for (const [name, text] of entries) {
    const data = Buffer.from(text, 'utf8'); const n = Buffer.from(name, 'utf8'); const crc = crc32(data);
    const head = Buffer.alloc(30);
    head.writeUInt32LE(0x04034b50, 0); head.writeUInt16LE(20, 4); head.writeUInt32LE(crc, 14);
    head.writeUInt32LE(data.length, 18); head.writeUInt32LE(data.length, 22); head.writeUInt16LE(n.length, 26);
    const dir = Buffer.alloc(46);
    dir.writeUInt32LE(0x02014b50, 0); dir.writeUInt16LE(20, 4); dir.writeUInt16LE(20, 6); dir.writeUInt32LE(crc, 16);
    dir.writeUInt32LE(data.length, 20); dir.writeUInt32LE(data.length, 24); dir.writeUInt16LE(n.length, 28);
    dir.writeUInt32LE(offset, 42);
    local.push(head, n, data); central.push(dir, n); offset += 30 + n.length + data.length;
  }
  const dirBytes = Buffer.concat(central); const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(dirBytes.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, dirBytes, end]);
}

const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const PKG = 'http://schemas.openxmlformats.org/package/2006';
const rels = (target: string, type = 'officeDocument') =>
  `${XML}<Relationships xmlns="${PKG}/relationships"><Relationship Id="rId1" Type="${REL}/${type}" Target="${target}"/></Relationships>`;
const types = (overrides: Array<[string, string]>) =>
  `${XML}<Types xmlns="${PKG}/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
  `<Default Extension="xml" ContentType="application/xml"/>${overrides.map(([p, t]) => `<Override PartName="${p}" ContentType="${t}"/>`).join('')}</Types>`;
const OX = 'application/vnd.openxmlformats-officedocument';

function docx(): Buffer {
  return zip([
    ['[Content_Types].xml', types([['/word/document.xml', `${OX}.wordprocessingml.document.main+xml`]])],
    ['_rels/.rels', rels('word/document.xml')],
    ['word/document.xml', `${XML}<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>` +
      `<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Optik</w:t></w:r></w:p><w:p><w:r><w:t>${SENTENCE}</w:t></w:r></w:p></w:body></w:document>`],
  ]);
}

function xlsx(): Buffer {
  const main = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
  return zip([
    ['[Content_Types].xml', types([['/xl/workbook.xml', `${OX}.spreadsheetml.sheet.main+xml`], ['/xl/worksheets/sheet1.xml', `${OX}.spreadsheetml.worksheet+xml`]])],
    ['_rels/.rels', rels('xl/workbook.xml')],
    ['xl/workbook.xml', `${XML}<workbook xmlns="${main}" xmlns:r="${REL}"><sheets><sheet name="Messwerte" sheetId="1" r:id="rId1"/></sheets></workbook>`],
    ['xl/_rels/workbook.xml.rels', rels('worksheets/sheet1.xml', 'worksheet')],
    ['xl/worksheets/sheet1.xml', `${XML}<worksheet xmlns="${main}"><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>${SENTENCE}</t></is></c></row></sheetData></worksheet>`],
  ]);
}

function pptx(): Buffer {
  const p = 'http://schemas.openxmlformats.org/presentationml/2006/main'; const a = 'http://schemas.openxmlformats.org/drawingml/2006/main';
  return zip([
    ['[Content_Types].xml', types([['/ppt/presentation.xml', `${OX}.presentationml.presentation.main+xml`], ['/ppt/slides/slide1.xml', `${OX}.presentationml.slide+xml`]])],
    ['_rels/.rels', rels('ppt/presentation.xml')],
    ['ppt/presentation.xml', `${XML}<p:presentation xmlns:p="${p}" xmlns:r="${REL}"><p:sldIdLst><p:sldId id="256" r:id="rId1"/></p:sldIdLst></p:presentation>`],
    ['ppt/_rels/presentation.xml.rels', rels('slides/slide1.xml', 'slide')],
    ['ppt/slides/slide1.xml', `${XML}<p:sld xmlns:p="${p}" xmlns:a="${a}"><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>` +
      `<p:sp><p:nvSpPr><p:cNvPr id="2" name="T"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:p><a:r><a:t>${SENTENCE}</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>`],
  ]);
}

function odt(): Buffer {
  const o = 'urn:oasis:names:tc:opendocument:xmlns';
  return zip([
    ['mimetype', 'application/vnd.oasis.opendocument.text'],
    ['META-INF/manifest.xml', `${XML}<manifest:manifest xmlns:manifest="${o}:manifest:1.0" manifest:version="1.2">` +
      `<manifest:file-entry manifest:full-path="/" manifest:media-type="application/vnd.oasis.opendocument.text"/>` +
      `<manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"/></manifest:manifest>`],
    ['content.xml', `${XML}<office:document-content xmlns:office="${o}:office:1.0" xmlns:text="${o}:text:1.0" office:version="1.2">` +
      `<office:body><office:text><text:h text:outline-level="1">Optik</text:h><text:p>${SENTENCE}</text:p></office:text></office:body></office:document-content>`],
  ]);
}

/** A one-page PDF with a real text layer; offsets computed, so the xref is valid. */
function pdf(text: string | null): Buffer {
  const stream = text ? `BT /F1 18 Tf 40 100 Td (${text}) Tj ET` : '0.5 g 20 20 100 100 re f';
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 200] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let out = '%PDF-1.4\n'; const offsets: number[] = [];
  objects.forEach((body, i) => { offsets.push(out.length); out += `${i + 1} 0 obj\n${body}\nendobj\n`; });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map(o => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

const padded = (mb: number) => Buffer.from(`${SENTENCE}\n` + 'Licht breitet sich geradlinig aus. '.repeat(Math.ceil(mb * 1024 * 1024 / 35)).slice(0, mb * 1024 * 1024));

interface Row { file: string; bytes: number; detected: string; upload: string; uploadMs: number; storedAs: string; text: string; textMs: number }

async function measure(fileName: string, bytes: Buffer, sendAs?: string): Promise<Row> {
  const detected = detectUploadType(bytes, bytes.subarray(0, 4).toString('latin1') === 'PK\u0003\u0004' ? zipEntryNames(bytes) : [], fileName);
  const mimeType = sendAs ?? detected?.mimeType ?? 'application/octet-stream';
  const file: UploadFile = { bytes, fileName, mimeType, digest: createHash('sha256').update(bytes).digest('hex').slice(0, 16), excerpt: '' };
  const row: Row = { file: sendAs ? `${fileName} as ${sendAs}` : fileName, bytes: bytes.length, detected: detected ? detected.ext : 'REFUSED by us',
    upload: '', uploadMs: 0, storedAs: '', text: '', textMs: 0 };
  let id = '';
  try {
    let t = Date.now();
    const made = await createContentNode({ 'cclom:title': [`MA-0 ${fileName} ${TOKEN}`] }, { mode: 'user', file, uploadTimeoutMs: UPLOAD_TIMEOUT_MS });
    row.uploadMs = Date.now() - t;
    if (made.status !== 'created') { row.upload = `${made.status}: ${JSON.stringify(made).slice(0, 160)}`; return row; }
    id = made.nodeId;
    row.upload = JSON.stringify(made.upload ?? 'no upload report').slice(0, 120);
    const node = await getNodeMetadata(id, ['-all-']);
    row.storedAs = `${node?.mimetype ?? '?'} ${String(node?.size ?? '?')} B`;
    t = Date.now();
    const got: { text: string | null; status: number | string; cut?: true } =
      await readNodeTextContent(id, TEXT_TIMEOUT_MS).catch((err: unknown) => ({ text: null, status: `threw ${String(err).slice(0, 80)}` }));
    row.textMs = Date.now() - t;
    row.text = got.text === null ? `none (HTTP ${got.status})`
      : `${got.text.length} chars${got.cut ? ' (READ CUT at the bound — the text is longer)' : ''}, token ${got.text.includes(TOKEN) ? 'FOUND' : 'absent'}: ${JSON.stringify(got.text.slice(0, 70))}`;
  } catch (err) {
    row.upload ||= `threw ${String(err).slice(0, 160)}`;
  } finally {
    if (id) {
      const gone = await deleteContentNode(id).catch((err: unknown) => ({ status: 'failed', detail: String(err) }));
      if (gone.status !== 'ok') console.error(`NOT DELETED: ${id} (${fileName}) ${JSON.stringify(gone)}`);
    }
  }
  return row;
}

requireLiveTarget();
const args = process.argv.slice(2);
const mediaDir = args.includes('--media') ? args[args.indexOf('--media') + 1] : undefined;
const md = `# Optik\n\n${SENTENCE}\n\n- Reflexion\n- Brechung\n`;

const cases: Array<[string, Buffer, string?]> = [
  ['notiz.txt', Buffer.from(`${SENTENCE}\n`)],
  ['notiz.md', Buffer.from(md)],
  // The document's open question: does markdown sent as an unknown type arrive as text?
  ['notiz.md', Buffer.from(md), 'application/octet-stream'],
  ['notiz.md', Buffer.from(md), 'text/plain'],
  ['text.pdf', pdf(SENTENCE)],
  ['ohne-text.pdf', pdf(null)],
  ['text.docx', docx()], ['tabelle.xlsx', xlsx()], ['folien.pptx', pptx()], ['text.odt', odt()],
  ...(mediaDir ? readdirSync(mediaDir).sort().map(f => [f, readFileSync(join(mediaDir, f))] as [string, Buffer]) : []),
  ['gross-1mb.txt', padded(1)], ['gross-10mb.txt', padded(10)],
  ...(args.includes('--big') ? [['gross-50mb.txt', padded(50)] as [string, Buffer]] : []),
];

console.log(`token ${TOKEN}`);
for (const [name, bytes, sendAs] of cases) {
  const r = await measure(name, bytes, sendAs);
  console.log(`\n${r.file}  (${r.bytes} B, our detection: ${r.detected})\n  upload ${r.uploadMs} ms: ${r.upload}\n  stored as: ${r.storedAs}\n  textContent ${r.textMs} ms: ${r.text}`);
}
