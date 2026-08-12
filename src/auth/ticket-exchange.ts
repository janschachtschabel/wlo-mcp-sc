/**
 * auth/ticket-exchange.ts – an edu-sharing ticket becomes an access block.
 *
 * The embedding flow this serves: an edu-sharing page renders the chat widget
 * and hands it the ticket of the person already signed in there (the same
 * `?ticket=…` convention the md-editor consumes in production). The widget
 * cannot use the ticket as a connector credential — our block machinery only
 * knew passwords — so this module exchanges it: prove the ticket against the
 * repository, wrap it in an ordinary `wlo2.` block with `k: 'ticket'`, list
 * its id. From there on NOTHING is special: the block rides the same header,
 * the same registry, the same revocation and the same abuse buckets as a
 * password block, and `credentialFromAccessBlock` rebuilds
 * `EDU-TICKET <ticket>` for upstream calls.
 *
 * Why wrap at all, instead of letting the widget hold the raw ticket: a block
 * is useless anywhere except against this server, while a raw ticket is a
 * live repository credential — the same reasoning that made blocks encrypt
 * passwords (`access-token.ts`). The ticket transits here ONCE and is never
 * logged; what the widget stores is revocable.
 *
 * Deliberately NOT reused: `verifyBlockLogin`. It decodes a block we issued;
 * here the caller presents a foreign credential to be verified — the same
 * step at a different trust stage, like `/auth/issue` vs `/oauth/authorize`.
 * The shared rules ARE reused where they live: `proveLogin`
 * (`access-verify.ts`) bounds the guessing before the upstream call and reads
 * the AUTHORITY, never the status code.
 */

import { createHash } from 'node:crypto';
import { encodeAccessToken } from './access-token.js';
import { proveLogin, type VerifyDeps } from './access-verify.js';
import type { WloCredential } from './credential.js';
import { log } from '../logger.js';
import { sanitizeText } from '../text-sanitize.js';

export type TicketExchangeOutcome =
  | { ok: true; block: string; authority: string; displayName?: string }
  | { ok: false; status: 400 | 429; error: string };

/** Same shape as the block paths — the limiter budget is deliberately shared. */
export type TicketExchangeDeps = VerifyDeps;

/**
 * Shape check before anything else. Bounds what may become an
 * `Authorization` header value: printable ASCII only (CR/LF would be header
 * injection), a minimum length below which nothing edu-sharing issues exists,
 * and a maximum well under the block bound. Over-refusing is fine — a ticket
 * that needs escaping is not one the repository handed out.
 */
export function isWellFormedTicket(raw: string | null | undefined): boolean {
  if (!raw || typeof raw !== 'string') return false;
  return /^[\x21-\x7e]{8,512}$/.test(raw);
}

/**
 * The access id for a ticket block — a domain-separated hash of the ticket
 * itself, NOT a random id.
 *
 * Deterministic on purpose: an embedded widget exchanges on every page load,
 * and with random ids each reload would list a fresh entry until the
 * per-account cap (`MAX_BLOCKS_PER_LABEL`) started evicting the person's
 * OTHER blocks — the ones they pasted into their AI hosts. Same ticket, same
 * id, same registry entry, however often the page reloads.
 *
 * The id stays a usable revocation secret: its only preimage is the ticket,
 * and whoever holds the ticket holds the stronger secret already.
 */
function ticketJti(ticket: string): string {
  return createHash('sha256').update(`wlo-ticket:${ticket}`).digest('base64url');
}

/**
 * Verify a ticket against the repository and issue the block that carries it.
 *
 * @param ticket The raw ticket as presented by the caller. Never logged.
 * @param now    Milliseconds since the epoch; limiter window and stored `iat`
 *               both come from here.
 */
export async function exchangeTicket(
  ticket: string,
  deps: TicketExchangeDeps,
  now: number,
): Promise<TicketExchangeOutcome> {
  if (!isWellFormedTicket(ticket)) {
    return { ok: false, status: 400, error: 'Es wurde kein brauchbares Ticket übermittelt.' };
  }

  const credential: WloCredential = { header: `EDU-TICKET ${ticket}`, label: 'edu-ticket', source: 'user' };
  const proof = await proveLogin(credential, deps, now, 'ticket-exchange');
  if (!proof.ok) {
    if (proof.reason === 'limited') {
      return { ok: false, status: 429, error: 'Zu viele verschiedene Anmeldungen von dieser Adresse.' };
    }
    // `proveLogin` collapses "rejected" and "unreachable" into the same
    // answer — deliberately the same coarseness as the password path, so the
    // two error texts cannot be used to probe which tickets exist.
    log.info('ticket exchange refused — ticket not accepted');
    return {
      ok: false,
      status: 400,
      error: 'Dieses Ticket hat WLO nicht angenommen (ungültig oder abgelaufen).',
    };
  }
  const identity = proof.identity;
  if (!identity.authority) {
    // Authenticated without a name cannot happen by construction (the check
    // reads the authority to decide) — but the type allows it, and a block
    // labelled with nothing would be unfindable for revocation-by-account.
    return { ok: false, status: 400, error: 'Dieses Ticket hat WLO nicht angenommen (ungültig oder abgelaufen).' };
  }

  const jti = ticketJti(ticket);
  const iat = Math.floor(now / 1000);
  const block = encodeAccessToken(
    { v: 2, jti, u: identity.authority, secret: ticket, iat, k: 'ticket' },
    deps.support.keys.publicKeyPem,
  );
  // Label = the verified authority, so revocation-by-account catches ticket
  // blocks together with the same person's password blocks.
  //
  // Only when the id is not listed yet, and that guard is not cosmetic: `add`
  // ALWAYS commits — it serialises the whole list, writes a temp file and
  // renames it — while the registry is the one thing this server writes to disk
  // at runtime. An embedded widget exchanges on every page load, so without the
  // guard every page load rewrote the file, and the only difference between the
  // old content and the new one was a refreshed `iat`. Keeping the first one is
  // the more accurate record anyway: it is when this access began.
  //
  // `k: 'ticket'` is what keeps that guard from being the whole story. It marks
  // the entry as one that appeared because someone opened a page, so the cap
  // counts it apart from the blocks the same person pasted into their AI hosts
  // (`MAX_BLOCKS_PER_LABEL`). The id is deterministic per TICKET, so a session's
  // reloads are one entry — but each new session brings a new ticket and a new
  // entry, and counted together those retired a pasted block after ten of them.
  if (!deps.support.registry.has(jti)) {
    await deps.support.registry.add({ jti, label: identity.authority, iat, k: 'ticket' });
  }
  log.info('ticket exchanged for an access block', { label: sanitizeText(identity.authority) });

  return {
    ok: true,
    block,
    authority: identity.authority,
    ...(identity.displayName ? { displayName: identity.displayName } : {}),
  };
}
