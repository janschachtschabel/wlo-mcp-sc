/**
 * escape.ts – HTML escaping for widget rendering.
 *
 * Widget bodies build their DOM from interpolated `structuredContent` strings
 * (titles, descriptions, publisher names) that originate from an external
 * backend. Every interpolated value MUST pass through `escapeHtml` before it
 * lands in an HTML string, so a malicious/edge-case node title cannot inject
 * markup or script into the sandboxed widget iframe. Pure, DOM-free (shared by
 * the browser bundle via esbuild and by the Node test runner).
 */

const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

/**
 * Escape the five HTML-significant characters. Safe for both text nodes and
 * quoted attribute values. Non-string input (a missing payload field) coerces
 * to an empty string rather than throwing.
 */
export function escapeHtml(value: string): string {
  if (typeof value !== 'string') return '';
  return value.replace(/[&<>"']/g, ch => HTML_ESCAPES[ch] ?? ch);
}
