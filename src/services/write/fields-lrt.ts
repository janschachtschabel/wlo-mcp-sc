/**
 * services/write/fields-lrt.ts – validating the content type (`ccm:oeh_lrt`).
 *
 * Split out of `fields.ts` because it changes for a different reason: the other
 * validators encode what the repository accepts in a field, this one encodes how
 * a 220-concept vocabulary behaves — shared labels, missing aggregations, near
 * misses. That is vocabulary knowledge, not write-surface knowledge.
 *
 * The type import is type-only on purpose: `fields.ts` imports the function
 * below, so a value import back would close a runtime cycle.
 */

import { resolveLrt, LRT_CONCEPTS, type LrtConcept } from '../../vocabs-lrt.js';
import { sanitizeText } from '../../text-sanitize.js';
import { suggestEntries } from '../../vocab-suggest.js';
import type { FieldValidation, RefusedValue } from './fields.js';

/** How many near misses to offer for an unknown content type. */
const LRT_SUGGESTIONS = 5;

/** Whether a concept's name alone names it — two of the 220 labels stand for two concepts. */
function nameIsEnough(c: LrtConcept): boolean {
  return resolveLrt(c.label).status === 'ok';
}

/**
 * Resolve content types against `new_lrt`.
 *
 * Three outcomes matter beyond "found or not":
 *   - a label two concepts share is REFUSED with both named, not resolved to
 *     whichever comes first — picking silently would write a content type the
 *     curator did not choose;
 *   - an unknown label comes back with near misses, because a typo is the
 *     common case and a bare refusal makes the user guess;
 *   - a concept the vocabulary maps to no aggregated type is accepted WITH a
 *     note: the repository derives `ccm:oeh_lrt_aggregated` from this field,
 *     and material tagged only with one of those six does not show up under the
 *     aggregated content-type facets.
 */
export function validateContentTypes(values: string[]): FieldValidation {
  const uris: string[] = [];
  const unmappedChosen: string[] = [];
  // Every refused value, not the first — and each with what the write WOULD
  // take, so a program can choose again without a vocabulary lookup.
  const reasons: string[] = [];
  const refused: RefusedValue[] = [];

  for (const v of values) {
    const r = resolveLrt(v);
    if (r.status === 'ambiguous') {
      const options = r.candidates.map(c => `„${c.label}“ unter „${c.path}“ (${c.uri})`).join(' oder ');
      reasons.push(
        `„${sanitizeText(v)}“ kommt im Inhaltstyp-Vokabular zweimal mit unterschiedlicher Bedeutung vor: ${options}. ` +
          'Bitte die gemeinte Variante als URI angeben.',
      );
      refused.push({ value: v, suggestions: r.candidates.map(c => c.uri) });
      continue;
    }
    if (r.status === 'unknown') {
      const near = suggestEntries(v, LRT_CONCEPTS).slice(0, LRT_SUGGESTIONS);
      reasons.push(
        `„${sanitizeText(v)}“ ist kein bekannter Inhaltstyp.` +
          (near.length ? ` Meintest du: ${near.map(c => (nameIsEnough(c)
            ? c.label : `${c.label} unter „${c.path}“ (${c.uri})`)).join(', ')}?` : ''),
      );
      // The URI where the name would be refused in turn: a candidate is something the write takes.
      refused.push({ value: v, suggestions: near.map(c => (nameIsEnough(c) ? c.label : c.uri)) });
      continue;
    }
    if (!uris.includes(r.uri)) uris.push(r.uri);
    const concept = LRT_CONCEPTS.find(c => c.uri === r.uri);
    if (concept && concept.aggregatedUri === null && !unmappedChosen.includes(concept.label)) unmappedChosen.push(concept.label);
  }

  if (refused.length) return { ok: false, reason: reasons.join(' '), refused };
  if (unmappedChosen.length === 0) return { ok: true, values: uris };
  return {
    ok: true,
    values: uris,
    note:
      `Hinweis zum Inhaltstyp ${unmappedChosen.map(l => `„${l}“`).join(', ')}: für diesen Begriff ` +
      'kennt das Vokabular keine Zuordnung zum aggregierten Inhaltstyp. Das Material erscheint dann ' +
      'nicht unter den zusammengefassten Inhaltstyp-Filtern der Suche. Ein zusätzlicher, konkreterer ' +
      'Inhaltstyp behebt das.',
  };
}
