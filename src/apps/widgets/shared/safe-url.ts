/**
 * safe-url.ts – URL scheme guard for widget hrefs.
 *
 * Node URLs (notably the publisher-supplied `ccm:wwwurl` behind `node.url`) are
 * external, untrusted metadata. `escapeHtml` neutralizes markup but NOT a
 * dangerous URL scheme, so a `javascript:`/`data:` value would still render as a
 * clickable link inside the widget iframe. `safeHref` returns the URL only when
 * it resolves to an http(s)/mailto scheme, otherwise '' (no link) — apply it
 * before `escapeHtml` wherever a node-derived URL becomes an `href`. Pure and
 * DOM-free (shared by the esbuild browser bundle and the Node test runner).
 */

const SAFE_SCHEMES = /^(https?|mailto):$/;

/** The URL if its scheme is http(s)/mailto (or it is relative), else ''. */
export function safeHref(url: string | null | undefined): string {
  const s = (url ?? '').trim();
  if (!s) return '';
  try {
    // A non-special base lets relative/protocol-relative URLs resolve to https
    // (kept) while an explicit dangerous scheme (javascript:, data:, …) keeps
    // its own protocol and is rejected.
    const parsed = new URL(s, 'https://wlo.invalid');
    return SAFE_SCHEMES.test(parsed.protocol) ? s : '';
  } catch {
    return '';
  }
}
