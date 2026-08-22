/**
 * services/preview-inline.ts – Restricted previews, fetched under the caller's
 * login and shipped as `data:` URIs.
 *
 * The asymmetry this closes (user question 2026-08-22): the METADATA of an
 * `isPublic: false` record reaches the widget because the server fetches it
 * with the per-request credential — the preview image did not, because a
 * browser `<img>` is an anonymous request and receives the repository's
 * permission-shield SVG (HTTP 200, so even an error fallback never fires).
 * `wloFetch` runs inside the same request context and therefore carries the
 * SAME credential the search ran with; the widget then needs no network at all.
 *
 * Where the bytes travel is the design decision: the result's `_meta` — the
 * Apps-SDK channel a host hands to the WIDGET and never to the model. Putting
 * 8 × ~40 KB of base64 into `structuredContent` would be the compendium
 * disease with pictures: paid out of the model's context on every editorial
 * search.
 *
 * Self-guarding by content type: if the credential did NOT reach the fetch
 * (anonymous session, expired login), the repository answers its shield —
 * `image/svg+xml` — and SVG is never inlined, so the alarming image cannot
 * come back through this path.
 */

import { isRepositoryUrl, wloFetch } from '../wlo-api.js';
import { mapPool } from '../concurrency.js';
import { log } from '../logger.js';
import type { FormattedNode } from '../formatter.js';

/**
 * At most this many preview fetches per answer. An editorial search is the only
 * caller that pays anything (public records never fetch), and its lists are
 * capped near this size anyway; the bound exists so a future wider list cannot
 * silently fan out.
 */
export const INLINE_PREVIEW_MAX = 8;

/**
 * Per-image byte cap. Measured previews run 7–100 KB; the base64 form costs
 * 4/3 of this on the wire (widget-only — never the model's context).
 */
export const INLINE_PREVIEW_BYTES_MAX = 300_000;

/**
 * Per-image fetch budget. Deliberately far below ``WLO_FETCH_TIMEOUT_MS``
 * (20 s): these are optional thumbnails fetched AFTER the search has its
 * answer, and at 8 images over a pool of 4 the default budget could add two
 * full upstream timeouts to a response that is otherwise done. A live preview
 * answers in milliseconds (measured 2026-08-22: 6 KB JPEG).
 */
export const PREVIEW_FETCH_TIMEOUT_MS = 4000;

/**
 * Fetch the previews of the `isPublic: false` nodes and return
 * `nodeId → data:` URI for those that yielded a real raster image.
 *
 * Every failure path skips the one image and keeps the rest: a missing picture
 * degrades to the lock glyph the widget shows anyway, which is strictly better
 * than failing the whole search over a thumbnail.
 */
export async function inlineRestrictedPreviews(
  nodes: ReadonlyArray<FormattedNode>,
): Promise<Record<string, string>> {
  const restricted = nodes
    // Materials only: the collection tile renders no thumbnail at all (block
    // glyph, early return in tile.ts), so bytes for those would never be
    // drawn. And only repository URLs — any other host serves an anonymous
    // <img> just as well (no shield there), while the credential boundary in
    // wlo-fetch.ts means only the repository fetch can differ for the
    // signed-in caller. Same boundary, literally: isRepositoryUrl.
    .filter(n => n.isPublic === false && n.nodeType !== 'collection'
      && n.previewUrl && !n.previewIsIcon && isRepositoryUrl(n.previewUrl))
    .slice(0, INLINE_PREVIEW_MAX);
  if (restricted.length === 0) return {};

  const out: Record<string, string> = {};
  await mapPool(restricted, 4, async (n) => {
    try {
      const res = await wloFetch(n.previewUrl, { signal: AbortSignal.timeout(PREVIEW_FETCH_TIMEOUT_MS) });
      if (!res.ok) return null;
      const type = (res.headers.get('content-type') ?? '').split(';')[0]!.trim().toLowerCase();
      // Raster images only. SVG is either the permission shield (the anonymous
      // answer) or a mime-type placeholder — both are exactly what the lock
      // glyph replaces, so inlining them would undo the fix.
      if (!/^image\/(jpeg|png|webp|gif)$/.test(type)) return null;
      // A declared oversize is skipped without buffering it; the read-side
      // check below still guards answers that declare nothing (NaN and the
      // absent-header 0 both fail this comparison and fall through).
      if (Number(res.headers.get('content-length') ?? '') > INLINE_PREVIEW_BYTES_MAX) return null;
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.byteLength === 0 || buf.byteLength > INLINE_PREVIEW_BYTES_MAX) return null;
      out[n.nodeId] = `data:${type};base64,${buf.toString('base64')}`;
    } catch (err) {
      // One dead thumbnail is not worth a log per request at scale — but a
      // debug-visible line beats silence when someone asks why a picture is
      // missing.
      log.info('inline preview skipped', {
        nodeId: n.nodeId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
    return null;
  });
  return out;
}
