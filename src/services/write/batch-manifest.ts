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
 * module, so the two cannot drift on what the summary holds. The summary carries
 * only what the list shows — 200 entries stay near 24 000 characters, inside
 * what was measured — and the full manifest stays the file.
 */

export const MANIFEST_FORMAT = 'wlo.ablage-vorgang@1';
/** Where the summary lives on the vorgang.json record. */
export const MANIFEST_SUMMARY_PROPERTY = 'cm:description';
/** How a manifest record is recognised by name (`renameIfExists` appends " (1)"). */
export const MANIFEST_NAME = /^vorgang( \(\d+\))?\.json$/i;

export interface ManifestEntry { index: number; titel: string; nodeId?: string; stand: string }
export interface ManifestSummary { format: string; ordner: string; layout: string; inhalte: ManifestEntry[] }

/** The summary of a server-built manifest — the same entries, without checksum, size and file name. */
export function summarizeManifest(manifest: { ordner: string; layout: string; inhalte: ManifestEntry[] }): ManifestSummary {
  return {
    format: MANIFEST_FORMAT,
    ordner: manifest.ordner,
    layout: manifest.layout,
    inhalte: manifest.inhalte.map(e => ({ index: e.index, titel: e.titel, ...(e.nodeId ? { nodeId: e.nodeId } : {}), stand: e.stand })),
  };
}

/** The summary, or null when the text is not one — never a guess from a partial parse. */
export function parseManifestSummary(text: string | undefined): ManifestSummary | null {
  if (!text) return null;
  let value: unknown;
  try { value = JSON.parse(text); } catch { return null; }
  const v = value as Partial<ManifestSummary> | null;
  if (!v || v.format !== MANIFEST_FORMAT || typeof v.ordner !== 'string' || !Array.isArray(v.inhalte)) return null;
  const inhalte = v.inhalte.filter((e): e is ManifestEntry =>
    !!e && typeof e.index === 'number' && typeof e.titel === 'string' && typeof e.stand === 'string');
  return inhalte.length === v.inhalte.length ? { format: v.format, ordner: v.ordner, layout: String(v.layout ?? ''), inhalte } : null;
}
