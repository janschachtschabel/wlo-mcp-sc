/**
 * services/skill-activation.ts – the line a model is asked to print when a skill
 * takes effect.
 *
 * A person talking to an AI host cannot otherwise tell that the answer they are
 * reading is being shaped by a document somebody uploaded to the repository.
 * The line says so, and says which one. It is built HERE rather than written
 * into each `SKILL.md` for two reasons: the editorial team should not have to
 * maintain it, and a line the document supplies is a line the document controls.
 *
 * Two properties this module owes its callers:
 *
 *   - It is a CLAIM ("this is a skill and it is now in effect"), so it rests on
 *     the content type, not on which tool was called. `get_skill` also serves a
 *     skill's companion files — a checklist, a template — and announcing one of
 *     those as an active skill would assert something the record denies.
 *   - The title comes from the repository and lands inside an instruction the
 *     model reproduces verbatim to the user. That is the elevated-authority
 *     boundary `text-sanitize.ts` owns, not the delimiter protection `oneLine`
 *     gives ordinary rendered values.
 */

import { sanitizeText } from '../text-sanitize.js';
import { SKILL_CONTENT_TYPE_URI } from './skill-catalogue.js';

/**
 * What the line calls the source. "edu-sharing" rather than "WLO" names the
 * system the document actually came from, which is the distinction a reader
 * needs: whether their host's own skills or a repository record is steering the
 * answer.
 */
export const ACTIVATION_LABEL = 'edu-sharing Skill';

/**
 * The activation line for a record, or `null` when there is nothing to announce
 * — the record is not marked as a skill, or carries no usable title.
 *
 * `null` is not a failure: the caller still returns the document. Only the claim
 * is withheld.
 *
 * @param title    the record's display title (already resolved by `nodeTitle`)
 * @param contentTypes  raw `ccm:oeh_extendedType` values of the record
 */
export function skillActivationLine(title: string, contentTypes: readonly string[]): string | null {
  if (!contentTypes.includes(SKILL_CONTENT_TYPE_URI)) return null;
  const name = sanitizeText(title);
  return name ? `[ ${ACTIVATION_LABEL} ] ${name} - aktiv` : null;
}
