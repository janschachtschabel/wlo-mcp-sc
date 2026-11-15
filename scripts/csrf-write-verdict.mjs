/**
 * csrf-write-verdict.mjs – turning one write attempt into an answer for E1.
 *
 * Separate from the probe that performs the requests so it can be tested
 * without the network, and because this is where the measurement can go wrong
 * quietly: every branch below is a decision about what a status code is allowed
 * to prove.
 *
 * The rule the whole module follows: a rejection only counts as evidence when
 * the repository's own error object came back with it. That object is written
 * by the handler, so its presence means the request got past every filter in
 * front of it — which is exactly what "is there a CSRF gate?" asks. A bare
 * `403`, an HTML error page or an empty body prove nothing and are reported as
 * such.
 *
 * German belongs in the printed report, not here — see `csrf-write-probe.mjs`.
 */

/** How a single write attempt came back. */
export const CLASSES = /** @type {const} */ ([
  'passed', // 2xx — the write was accepted
  'unauthenticated', // 401 — the session did not carry
  'csrf-gate', // 403 naming a token
  'forbidden', // 403 without one: rights or gate, undecidable
  'handler', // rejected by the handler itself ⇒ no filter refused it first
  'unclear', // rejected with nothing to read
  'error', // the request never completed
]);

/** Words a CSRF filter uses for itself. Deliberately narrow. */
const TOKEN_WORDS = /\b(csrf|xsrf)\b/i;

/**
 * Did the repository answer with its own error object?
 *
 * edu-sharing reports handler-level failures as `{error, message, …}`. A filter
 * that refuses a request earlier answers with an empty body or a container's
 * HTML page, so this distinction is the one piece of evidence available.
 */
function isRepositoryError(body) {
  try {
    const parsed = JSON.parse(body);
    return Boolean(
      parsed && typeof parsed === 'object'
      && (typeof parsed.error === 'string' || typeof parsed.message === 'string'),
    );
  } catch {
    return false; // not JSON — no evidence either way
  }
}

/**
 * Classify one write attempt.
 *
 * @param {number} status HTTP status, or 0 when the request failed to complete
 * @param {string} body   response body as text (may be empty)
 * @returns {typeof CLASSES[number]}
 */
export function classifyResponse(status, body) {
  if (!status) return 'error';
  if (status >= 200 && status < 300) return 'passed';
  if (status === 401) return 'unauthenticated';
  // Checked before the generic branch: a CSRF filter may well answer with a
  // JSON body, so "has an error object" must not outrank the token word.
  if (status === 403) return TOKEN_WORDS.test(body) ? 'csrf-gate' : 'forbidden';
  return isRepositoryError(body) ? 'handler' : 'unclear';
}

/** Reaching the handler and being let through both mean: no gate in the way. */
const GOT_THROUGH = new Set(['passed', 'handler']);

/** Everything that stops a request short of the handler. */
const TURNED_AWAY = new Set(['csrf-gate', 'forbidden', 'unauthenticated']);

/**
 * The answer to E1, from the two attempts that carry information.
 *
 * Only the own-origin attempt decides — that is the one the widget will make.
 * The foreign-origin attempt adds *how* the server protects itself, which is
 * worth reporting but never turns a passing own-origin result into a blocker.
 *
 * @param {{ownOrigin: string, foreignOrigin: string}} attempts
 * @returns {{result: 'no-token'|'token-required'|'unclear-rights'|'unclear-auth'|'unclear',
 *           originChecked: boolean|null}}
 */
export function overallVerdict({ ownOrigin, foreignOrigin }) {
  if (ownOrigin === 'csrf-gate') return { result: 'token-required', originChecked: true };
  if (GOT_THROUGH.has(ownOrigin)) {
    return { result: 'no-token', originChecked: TURNED_AWAY.has(foreignOrigin) };
  }
  if (ownOrigin === 'unauthenticated') return { result: 'unclear-auth', originChecked: null };
  if (ownOrigin === 'forbidden') return { result: 'unclear-rights', originChecked: null };
  return { result: 'unclear', originChecked: null };
}
