/**
 * services/write/field-routing.ts – which metadata the server WRITES and which it
 * only PROPOSES when many records are changed at once (plan 2026-11-08, W3).
 *
 * User decision 2026-11-08 (F5): no `mode` for the caller. Descriptive metadata
 * is what the follow-up steps work with, so it is written directly — title,
 * description, keywords, subject, educational level, content type. Everything
 * that needs an editorial decision — licence, author, publisher, source URL,
 * language, target group, the quality fields — becomes a suggestion for a
 * person to accept or decline. One set, one place: a second copy is where a
 * licence would quietly start being written.
 */

export const DIRECT_PROPERTIES: ReadonlySet<string> = new Set([
  'cclom:title',
  'cclom:general_description',
  'cclom:general_keyword',
  'ccm:taxonid',
  'ccm:educationalcontext',
  'ccm:oeh_lrt',
]);

/** Split desired values into what is written and what is proposed. */
export function routeFields(desired: Record<string, string[]>): {
  write: Record<string, string[]>;
  suggest: Record<string, string[]>;
} {
  const write: Record<string, string[]> = {};
  const suggest: Record<string, string[]> = {};
  for (const [property, values] of Object.entries(desired)) {
    (DIRECT_PROPERTIES.has(property) ? write : suggest)[property] = values;
  }
  return { write, suggest };
}
