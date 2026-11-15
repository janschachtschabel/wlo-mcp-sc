/**
 * batch-manifest.ts – the compact form of a batch's `vorgang.json` that is kept
 * in the record's METADATA (BOERDi wishlist item 9, decision A, 2026-11-06).
 *
 * Why metadata at all: this server cannot read a private file's bytes with a
 * Basic login (measured: `eduservlet/download` 403, `GET …/content` 405,
 * `…/textContent` empty), so a list built on the file would show every batch as
 * unreadable. Why `cm:description`: a property the content model does not
 * declare is not kept (`PUT …/metadata` 400, `POST …/property` 200 and dropped),
 * while model text properties keep 53 950 characters unchanged; and of those,
 * `cclom:general_description` is every hit's visible description and
 * `ccm:oeh_collection_compendium_text` is read by this server as a compendium.
 *
 * Writer (`batch-filing.ts`) and reader (`services/my-batches.ts`) share this
 * module, so the two cannot drift on what the summary holds.
 *
 * `@2` (plan 2026-11-08, W4) adds each entry's ROLE — structure document or
 * content. Only the batch knows which file is the structure document; without
 * it in the manifest that knowledge died with the chatbot's conversation. `@1`
 * is still read (every entry `content`), because filed batches stay filed.
 *
 * The summary carries only what the list shows, and the full manifest stays the
 * file. Its size at 200 entries (review 2026-11-08, computed with this
 * function): 30 286 characters with 37-character titles, 47 086 with
 * 121-character ones — inside the 53 950 measured as kept. Titles made of
 * characters JSON escapes can pass that; the read-back then reports the
 * manifest `unverified`, never filed. So the summary writes `rolle` ONLY for a
 * structure document: `content` is the default the reader restores, and
 * spelling it 200 times would cost ~3 600 characters of that margin.
 */

export const MANIFEST_FORMAT = 'wlo.ablage-vorgang@2';
/** Formats this reader understands; `@1` predates the role. */
const READABLE_FORMATS: ReadonlySet<string> = new Set(['wlo.ablage-vorgang@1', MANIFEST_FORMAT]);

/** What a file is to the batch (W4): the document describing the structure, or one of its contents. */
export type BatchRole = 'structure' | 'content';
export const BATCH_ROLES: readonly BatchRole[] = ['structure', 'content'];
/** Where the summary lives on the vorgang.json record. */
export const MANIFEST_SUMMARY_PROPERTY = 'cm:description';
/** How a manifest record is recognised by name (`renameIfExists` appends " (1)"). */
export const MANIFEST_NAME = /^vorgang( \(\d+\))?\.json$/i;

export interface ManifestEntry { index: number; titel: string; nodeId?: string; stand: string; rolle?: BatchRole }
export interface ManifestSummary { format: string; ordner: string; layout: string; inhalte: ManifestEntry[] }

/**
 * A title as the SUMMARY carries it. The size figures above hold for titles of
 * at most 121 characters; a batch title may be 200 since 2026-11-13, and at
 * that length two hundred entries pass what the property keeps (~62 900 against
 * 53 950) — the manifest would read back `unverified` and the batch list could
 * not show it. The full title stays in the manifest FILE and on the record.
 */
const SUMMARY_TITLE_CHARS = 120;
const summaryTitle = (title: string): string =>
  title.length > SUMMARY_TITLE_CHARS ? `${title.slice(0, SUMMARY_TITLE_CHARS)}…` : title;

/** The summary of a server-built manifest — the same entries, without checksum, size and file name. */
export function summarizeManifest(manifest: { ordner: string; layout: string; inhalte: ManifestEntry[] }): ManifestSummary {
  return {
    format: MANIFEST_FORMAT,
    ordner: manifest.ordner,
    layout: manifest.layout,
    inhalte: manifest.inhalte.map(e => ({ index: e.index, titel: summaryTitle(e.titel), ...(e.nodeId ? { nodeId: e.nodeId } : {}), stand: e.stand,
      ...(e.rolle === 'structure' ? { rolle: e.rolle } : {}) })),
  };
}

/** The summary, or null when the text is not one — never a guess from a partial parse. */
export function parseManifestSummary(text: string | undefined): ManifestSummary | null {
  if (!text) return null;
  let value: unknown;
  try { value = JSON.parse(text); } catch { return null; }
  const v = value as Partial<ManifestSummary> | null;
  if (!v || !READABLE_FORMATS.has(String(v.format)) || typeof v.ordner !== 'string' || !Array.isArray(v.inhalte)) return null;
  const inhalte = v.inhalte.filter((e): e is ManifestEntry =>
    !!e && typeof e.index === 'number' && typeof e.titel === 'string' && typeof e.stand === 'string'
    && (e.rolle === undefined || BATCH_ROLES.includes(e.rolle)));
  if (inhalte.length !== v.inhalte.length) return null;
  return { format: String(v.format), ordner: v.ordner, layout: String(v.layout ?? ''),
    inhalte: inhalte.map(e => ({ ...e, rolle: e.rolle ?? 'content' })) };
}
