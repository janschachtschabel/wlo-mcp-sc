/**
 * auth/ticket-origins.ts – which browser origins may exchange an edu-sharing
 * ticket at `POST /auth/ticket` (`TICKET_ALLOWED_ORIGINS`, plan 2026-11-07 R4).
 *
 * The endpoint is the one CORS carve-out on `/auth*` (`isCredentialSurface`,
 * `http-app.ts`), because its only real client is a widget on a foreign page.
 * The list narrows "foreign" to the pages that actually embed it — in practice
 * the same list the chatbot keeps as its own `CORS_ORIGINS`.
 *
 * Three rules, and the third is why the second is safe:
 * - NO list (unset) allows every origin: today's behaviour, no break on upgrade
 *   — but a list that was SET and whose every entry was unusable allows NO
 *   browser origin (`resolveTicketOrigins`): `chatbot.example.org` without a
 *   scheme must not read as "restriction off" (review 2026-11-07);
 * - a request WITHOUT `Origin` is allowed: that is a server, not a browser
 *   (the chatbot backend), and the list is about which PAGES may do this;
 * - `Origin` is not a security boundary against a non-browser client — anyone
 *   with curl can omit or forge it. What the list closes is the browser path: a
 *   foreign page cannot make a visitor's browser exchange that visitor's ticket
 *   and read the block back. A server that holds a ticket holds the stronger
 *   secret already (the same reasoning as the ticket-hash access id).
 *
 * Pure, no I/O. `parseAllowedOrigins` also reads `WIDGET_OAUTH_ORIGINS` (R1):
 * the same list syntax, a different rule — see `oauth-consent.ts`.
 */

/** Parse the comma-separated list; anything that is not a web origin is named in `rejected`. */
export function parseAllowedOrigins(raw: string | undefined): { origins: ReadonlySet<string>; rejected: string[] } {
  const origins = new Set<string>();
  const rejected: string[] = [];
  for (const entry of (raw ?? '').split(',').map(e => e.trim()).filter(Boolean)) {
    const origin = originOf(entry);
    if (origin) origins.add(origin); else rejected.push(entry);
  }
  return { origins, rejected };
}

/** The normalised origin of an `http(s)` URL, else null — `*`, `null` and unreadable values included. */
function originOf(value: string): string | null {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.origin : null;
  } catch {
    return null;
  }
}

/**
 * `TICKET_ALLOWED_ORIGINS` as the server uses it: `origins` is undefined when
 * the variable is unset or blank (no restriction), and a set — possibly EMPTY,
 * which then admits no browser — as soon as anything was configured.
 * `allRejected` tells the entry point to say so loudly.
 */
export function resolveTicketOrigins(raw: string | undefined): {
  origins: ReadonlySet<string> | undefined; rejected: string[]; allRejected: boolean;
} {
  const { origins, rejected } = parseAllowedOrigins(raw);
  if (!(raw ?? '').split(',').some(e => e.trim())) return { origins: undefined, rejected, allRejected: false };
  return { origins, rejected, allRejected: origins.size === 0 };
}

/** May a request carrying this `Origin` header exchange a ticket? `allowed` undefined = no list. */
export function ticketOriginAllowed(origin: string | undefined, allowed: ReadonlySet<string> | undefined): boolean {
  if (allowed === undefined || origin === undefined) return true;
  const normalised = originOf(origin);
  return normalised !== null && allowed.has(normalised);
}
