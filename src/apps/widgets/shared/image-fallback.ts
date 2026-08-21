/**
 * shared/image-fallback.ts – A preview that never loads must leave a clean
 * card, not a broken-image box.
 *
 * The widget CSP names the hosts previews are known to come from
 * (`apps/resources.ts`), but it cannot name every one: the repository decides
 * at request time whether to serve the image itself or redirect to the
 * publisher's thumbnail host, and a host we did not measure is blocked by the
 * very allowlist that protects the frame. A dead publisher URL or a 404 does
 * the same thing without any policy involved.
 *
 * So the last word belongs to the browser: whatever the reason, a failed
 * preview is replaced by the glyph the card would have shown had the record
 * carried no preview at all — which is what `data-fallback` on the `<img>` is
 * for. The markup side owns the glyph (`tile.ts`), this module owns the swap;
 * neither needs a second copy of the other's decision.
 *
 * DOM glue — excluded from the build tsconfig, like the widget entry points.
 */

/**
 * Listen once, for the whole document, for images that failed to load.
 *
 * Idempotent-by-construction callers: both shells call it exactly once at
 * start-up, before the first paint, so a repaint never needs to re-register.
 */
export function installImageFallback(): void {
  document.addEventListener(
    'error',
    (event) => {
      const img = event.target as HTMLImageElement | null;
      if (!img || img.tagName !== 'IMG') return;
      // Only OUR previews carry it, so a stray image elsewhere on the page (or
      // a future one) is left exactly as it is.
      const glyph = img.getAttribute('data-fallback');
      if (!glyph) return;

      const span = document.createElement('span');
      span.className = 'wlo-tile__icon';
      span.setAttribute('aria-hidden', 'true');
      // textContent, not innerHTML: the glyph is data, and this is the one
      // place in the widget that writes an element from a DOM attribute.
      span.textContent = glyph;
      img.replaceWith(span);
    },
    // Capture phase: `error` does not bubble, so this is the ONLY way to catch
    // it from a delegated listener. Without `true` nothing here ever runs.
    true,
  );
}
