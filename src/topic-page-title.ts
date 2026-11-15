/**
 * topic-page-title.ts – what may be shown as a Themenseite's title.
 *
 * A page-variant node carries several name-ish properties, and two of them are
 * machine-generated: `cm:name` is `PAGE_VARIANT_<uuid>` by construction, and
 * `cm:title` holds the same string on 109 of 109 production variants (measured
 * 2026-08-07). `cclom:title` is the one an editor fills in — but it is not
 * safe either: on staging 22 of 68 variants carry the technical string there
 * too, because a page created and never renamed keeps it.
 *
 * So the rule is about the VALUE, not about which property it came from, and it
 * has to run wherever such a value is read from the repository.
 *
 * This lives in a leaf module rather than in `tools/shared.ts`, where it started.
 * `topic-page-variant.ts`, `topic-page-structure.ts` and
 * `services/write/topic-page.ts` all need it, and none of them may import from
 * `tools/` — the direction is enforced by
 * `tests/shared-rule-discipline.test.ts`, and the same move was made for
 * `mapPool` and `buildFilterCriteria` before this one.
 *
 * It imports nothing, and that is deliberate: `pickThemePageTitle` used to live
 * here and needed `ThemePageInfo`, pointing this module back at one that imports
 * it. It moved to `topic-page-variant.ts` beside that type on 2026-08-11;
 * `tools/shared.ts` re-exports it, so no caller changed.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * True for technical, non-human-readable identifiers that must never be shown
 * as a Themenseite title — the auto-generated `PAGE_VARIANT_<uuid>` name and
 * bare node UUIDs. An empty value counts as a placeholder, so callers can use
 * this as a single "is this usable as a title" question.
 */
export function isPlaceholderTitle(s: string | undefined | null): boolean {
  const t = (s ?? '').trim();
  if (!t) return true;
  if (/^page[_-]?variant/i.test(t)) return true;
  if (UUID_RE.test(t)) return true;
  return false;
}

/**
 * A repository title, or '' when what came back is a technical id.
 *
 * Empty rather than a substitute: every consumer already has its own fallback
 * chain (the collection title, then a generic label), and inventing one here
 * would override a better answer the caller can see and this module cannot.
 */
export function displayTitleOrEmpty(raw: string | undefined | null): string {
  const t = (raw ?? '').trim();
  return isPlaceholderTitle(t) ? '' : t;
}
