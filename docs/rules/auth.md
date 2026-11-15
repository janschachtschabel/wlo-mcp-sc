# Logins: access block, OAuth, tickets, limiters

Binding rules for this area, moved verbatim out of `CLAUDE.md` on 2026-11-14 (the file had grown to 2154 lines).
A dated sentence records what was measured or decided that day; where a later block says "superseded", the later one holds.
Index: [README.md](README.md) · short rules: [`CLAUDE.md`](../../CLAUDE.md).

- **MCP-Zugang per WLO-Konto (verschlüsselter Zugangsblock) — COMPLETE
  (2026-08-04/05; P0–P6 plus a review round of 7 fixed findings):**
  - Design: `docs/plans/2026-08-04-mcp-access-token-design.md`
  - Tasks:  `docs/plans/2026-08-04-mcp-access-token-tasks.md` (18 tasks, 7 phases)
  - Team decision paper (7 open questions F1–F7 for the user, not for us):
    `docs/plans/2026-08-04-auth-optionen-entscheidung.md`

  A user fetches a block at `/auth` whose password was encrypted **in the
  browser**, pastes it once as `Bearer …`, and revokes it at `/auth-revoke.html`
  (or `/auth/revoke`). Off unless `WLO_AUTH_PRIVATE_KEY` is set. The measurement
  that closed every other option: edu-sharing offers no OIDC discovery, no DCR,
  and declares only `basicAuth`/`cookieAuth` — **there is no token to relay**, so
  any scheme carries the credential itself. Do not re-derive this; re-measure it
  if you must contradict it.

  Rules that bind any change here: `/auth*` sends **no CORS header** (both abuse
  limiters count per client ADDRESS, so a wildcard origin lets a page spend every
  visitor's quota on a password guess and read the outcome); the access id lives
  INSIDE the AEAD (otherwise it is swapped to dodge revocation); the registry is
  an ALLOW-list where every failure closes the door, holds ids and never a
  credential, and is the ONLY runtime disk writer (enforced by
  `tests/shared-rule-discipline.test.ts`); its write chain must not carry one
  rejection forward, and a failed write is undone rather than left granting what
  it could not record.

- **OAuth 2.1 für alle Clients — COMPLETE (P1–P5, live 2026-08-05, T5.3-Review 2026-08-09):**
  - Design: `docs/plans/2026-08-05-mcp-oauth-design.md`
  - Tasks:  `docs/plans/2026-08-05-mcp-oauth-tasks.md` (17 tasks, 5 packages)

  Measured 2026-08-05: ChatGPT's connector offers **no header or API-key field**
  at all — only OAuth / none / mixed — so the access block cannot be entered
  there. Its probe fails with `does not implement OAuth`, and every discovery
  path on our server answers 404. OAuth is therefore the only mechanism that
  reaches every client, and a working reference exists at
  `C:\Users\jan\github\mcp-wiki-js-ai` (1331 lines, no new dependency).

  Two decisions the design locks: the access token IS the existing `wlo2.…`
  block, so no credential ever rests on disk (the rejected vault) and no session
  store is needed; and a request with NO `Authorization` keeps answering 200
  anonymously — the 401 fires only for a presented-but-unusable OAuth token.
  Open point 1 — whether a client discovers OAuth without a 401 — was the gate
  and was **measured positive on 2026-08-05**: ChatGPT read both discovery
  documents unprompted and reached `/oauth/register`. Anonymous reading and
  OAuth therefore coexist on the same URL; no second URL, no forced 401.

  Rules P3 adds, and they bind any change to the login flow: **the request is
  checked before anyone is shown a password field**, and a refused one gets a
  page, never a redirect — sending an error to a `redirect_uri` we did not
  recognise turns this server into a redirector. The check lives ONCE, in
  `src/auth/oauth-authorize.ts`, because GET decides what to show and POST what
  to mint, and a second copy is where the PKCE requirement quietly disappears
  from the path that actually issues the code. The consent page learns who is
  asking from `GET /oauth/authorize` with `Accept: application/json`, not from
  the query string — `client_id` is a ciphertext only the server opens, and
  repeating the caller's own text back would let it name itself. The access
  block waits in `oauth-codes.ts` as a CIPHERTEXT until `/oauth/token`; that
  module deliberately does not import `access-token.ts`.

  Rules P4 adds: the access token **IS** the block, which is the only reason one
  revocation ends both ways in — do not wrap it in a second credential. No
  `refresh_token`, no `expires_in`. The code is removed from the store BEFORE
  any check runs (a failed PKCE proof must not leave it retryable), and every
  failure answers the same `invalid_grant` text, because which check failed is
  what a holder of a stolen code would like to learn.

  Two rules from working the T5.3 leftovers: the OAuth surface spends TWO
  budgets — `/oauth/authorize` the tight `/auth*` one (a password is typed
  there), everything else the connector's own, because both discovery documents,
  the registration and the token exchange come from the CLIENT's address and a
  hosted connector serves many users from few of them; and the consent screen
  ranks the CHECKED value above the CLAIMED one — registration is open, so
  `client_name` is whatever the caller typed, and the verified redirect target
  leads with the emphasis while the name is labelled as self-declared.

  The T5.3 review (2026-08-09) adds one rule and it binds any change to the
  block format: **a block is LENGTH-bounded at `decodeAccessToken`**
  (`MAX_BLOCK_CHARS`, the one place every path decodes one). Shape was checked
  and size was not, and the payload takes arbitrary padding — a 1 MB junk field
  yields a 1 333 836-character block that decodes fine, because `validatePayload`
  drops unknown fields from the RESULT while the caller keeps the string.
  `/oauth/authorize` RETAINS that string in the code store, which bounds the
  number of records and not their size. A real block is 573 characters (605
  against the deployed RSA-2048 key), so do not lower the bound below an
  RSA-4096 rotation's needs — and do not remove it.

  Measured lesson from P3, the second time this shape has appeared: page and
  endpoint were each green against the author's own idea of the request body and
  **disagreed** (`response_type` was missing, so every consent failed). Only
  running it found that. `tests/oauth-authorize-page.test.ts` now takes the
  field names out of the PAGE and feeds them to the REAL check, and
  `tests/oauth-flow.test.ts` walks all nine steps through a real server —
  ending on the two lines that matter: a revoked token gets 401, and a request
  with no header still gets the full anonymous list.

  Three implementation decisions the tasks add on top of the design: the
  `client_id` carries its own content (AES-GCM under a key derived from the
  existing private key) rather than living in a store, because the allow-list is
  the only disk writer and an in-memory store would break every client on every
  deploy; the issuance path is EXTRACTED into `src/auth/access-issue.ts` rather
  than copied, because the authority check is the rule "200 is not proof of a
  login" hangs on; and the issuer origin comes from `WLO_PUBLIC_BASE_URL`, from
  the `Host` header only under `TRUST_PROXY`.

- **Relay clients and the credential limiter — P1 COMPLETE (2026-08-12); P2
  designed, not built:** `docs/plans/2026-08-12-relay-credential-limiter.md`

  The guessing guard on `POST /mcp` bounds **distinct secrets per identity**, and
  which identity that is depends on the scheme: `Basic` per client ADDRESS, a
  `wlo2.` block per **`jti`**. One place holds it — `abuseBucketKey`
  (`auth/credential.ts`). Keying a block by address was wrong twice over, and
  both halves were measured: it refused a **relay client** (a chatbot backend
  serving many people from one address hit the cap at its 11th signed-in person,
  while anonymous callers kept working — a misleading signature), and it
  under-bounded a guesser, who multiplied their budget simply by rotating
  addresses (50 addresses = 500 tries; now 10 in one bucket).

  Two rules bind any change. **Do not exempt blocks from the counter** on the
  argument that they are "already proven": `AUTH.md` §4 — the public key is
  published, so whoever learns a `jti` can mint blocks carrying it with any
  password. The same fact is why **a block is bound to the NAME its id was
  listed for** (`credentialFromAccessBlock` → `registry.labelOf`, audit
  2026-11-12): the holder of one listed id — their own — otherwise mints blocks
  with a stranger's name, a fresh ten guesses per id. `label` stays the spelling
  the block carries (the binding); the account edu-sharing CONFIRMED is the
  optional `acct`, which revocation and the cap go by, because one login has
  several accepted spellings (measured 2026-11-12). And **the bucket key is never logged or returned** — for a block it
  IS the access id, the secret revocation hangs on; the refusal names its
  `scope` and the address instead.

  P2 (a session credential for a chatbot embedded INSIDE the repository) is
  designed in the same file; it was built on 2026-11-15 in one shape (the session-exchange block at the end of
  this file) — but "no concrete embedding
  exists yet", the reason it was parked, stopped being true on 2026-08-12: the
  embedded case is served by the ticket block below, through a different
  mechanism. What P2 alone would still add is a host that cannot hand over a
  ticket either. The measurement it rests on is already in
  `2026-08-04-mcp-access-token-design.md` — a `JSESSIONID` DOES carry our
  endpoints; it was rejected as *block content* only because it has no lifetime,
  which is not a constraint for a host that has a live session per request. The
  invariant that must travel with it: the cookie branch belongs INSIDE
  `withCredential`'s repository-host check, not beside it.

- **Ticket-Tausch für eingebettete Widgets (`POST /auth/ticket`) — COMPLETE
  (2026-08-12); vollständig dokumentiert in `docs/AUTH.md` §5c:**

  An edu-sharing page that already knows who is signed in hands its widget that
  person's ticket (the `?ticket=…` convention the md-editor consumes in
  production). `auth/ticket-exchange.ts` proves it against the repository and
  wraps it in an ordinary `wlo2.` block carrying `k: 'ticket'`; from there
  NOTHING is special — same header, same registry, same revocation, and
  `credentialFromAccessBlock` rebuilds `EDU-TICKET <ticket>` upstream instead of
  `Basic`. Wrapping rather than letting the widget hold the raw ticket is the
  same reasoning that made blocks encrypt passwords: a block is useless anywhere
  except against this server, a raw ticket is a live repository credential.

  This is the THIRD mechanism tried for the embedded case and the first that
  works — do not re-derive the other two, they are measured in
  `2026-08-12-relay-credential-limiter.md`: the `JSESSIONID` relay of P2 above
  is dead for a widget (`HttpOnly` ⇒ no JavaScript can read it, no `SameSite`
  ⇒ a cross-site iframe carries nothing), and `appauth` is impersonation by
  design — whoever may call it may become anyone.

  Five rules bind any change here. (1) **The access id is a hash of the ticket**
  (`sha256('wlo-ticket:' + ticket)`), never random: an embedded widget exchanges
  on EVERY page load, so random ids would list a fresh entry each time until
  `MAX_BLOCKS_PER_LABEL` started evicting the person's OTHER blocks — the ones
  they pasted into their AI hosts. It stays a usable revocation secret because
  its only preimage is the ticket, and whoever holds that holds the stronger
  secret already. **That fixes the page load and not the session** (audit
  2026-08-13): the next session brings a new ticket, a new hash and a new entry,
  so a widget files about one per working day against a cap that counts
  deliberate acts — and ten days of it retired a pasted block, leaving a 401 that
  re-pasting could not cure. The entry therefore carries `k: 'ticket'`
  (`RegistryEntry`, mirroring `AccessPayload.k`) and **the cap applies per KIND**,
  one constant over two classes. `removeByLabel` is deliberately NOT split — a
  ticket block is as much of an access as a pasted one, and "everything revoked"
  over a widget that keeps working is a lie. (2) The registry is written **only when the id is not listed
  yet** (`listUnlessListed`), and that guard is not cosmetic: a listing commits (serialise, temp
  file, rename) and the registry is the one thing this server writes to disk at
  runtime, so without it every page load rewrote the file — the sole difference
  being a refreshed `iat`, while the first one is the more accurate record of
  when the access began. (3) The endpoint spends its **own** limiter budget
  (`TICKET_CREDENTIAL_LIMIT`, default 200) in its own buckets: a ticket is
  server-generated and unguessable, so counting distinct ones bounds nothing a
  password bucket bounds, and sharing `/auth/issue`'s budget would let one busy
  embedding spend the password-guessing quota. Where it is not wired, the
  fallback is the TIGHTER budget, deliberately. (4) `/auth/ticket` is the ONE
  exact-match carve-out from the no-CORS rule on `/auth*` (`isCredentialSurface`,
  `http-app.ts`) — it is called cross-origin by construction and no password is
  typed there; the carve-out is exact-match so `/auth/ticket-anything` cannot
  inherit it. (5) **A ticket block belongs to one listing** (chatbot team,
  2026-11-15; R2 is gone): it carries the listing's `iat` (ms fraction, never
  rounded), `credentialFromAccessBlock` compares it, a reload reuses the listing,
  and a revoked or expired listing stays dead — the session rule (11) below, in
  the same code.

  What happens when the ticket DIES is measured (2026-08-13, staging) and needs
  no code of ours: `/iam/…/-me-` answers **404**, and search/node/children answer
  **500** `A valid SecureContext was not provided`. Never 200-as-guest — the fear
  worth testing, since a silently-guest credential is exactly what
  `auth/identity.ts` exists for. `ngsearch` throws on non-OK rather than
  degrading, so it reaches the caller as an error and not as "keine Treffer". The
  ticket's own death needs no expiry of ours; the 12-hour allow-list expiry R1
  added on 2026-11-07 (user decision) bounds the BLOCK, a different thing.
  The `401` `docs/AUTH.md` §5c claimed here was wrong and is corrected.

- **Budgets of the in-memory write stores, and who can spend them (2026-11-14, second review of the audit
  fixes).** `src/services/write/store-budget.ts` is the ONE place: `budgetOf(cred)` → `{key, pool}`. Three rules.
  (1) A budget key is not the binding identity. Who may redeem a key or continue a plan is unchanged; the key only
  decides whose cap is counted and who may be evicted for room. (2) A confirmed account keys as `acct:<account>`,
  a listed block without one as `jti:<id>`, the service credential as `service:…` — the PROVEN pool. Everything
  else is UNPROVEN: `user:<label>:<keyed digest of the whole header>` and `anonymous`. A `Basic` login is never
  proven before a preview, and some previews cost no upstream call; with `user:<label>` alone, typing a person's
  account name evicted that person's pending keys, and twenty invented names evicted anybody's. (3) Each store
  (confirmation keys, plans, prepared batches) splits its total in half, and a caller fills and evicts only within
  its own pool; within a full pool the minter gives up its OWN oldest entry first. What remains, and is accepted:
  unproven callers can evict EACH OTHER — and an honest `Basic` user on `/mcp` is unproven. Whoever needs to be
  safe from that signs in with an access block or OAuth, which is what the hosts do. Unmeasured: whether the
  repository answers a wrong `Basic` as guest on a public record, which would let an unproven caller start a plan
  that only proposes.

- **Session exchange (`POST /auth/session`) — built 2026-11-15, off by default (`WLO_SESSION_EXCHANGE`);
  documented in `docs/AUTH.md` §5d.** This is P2 above, in the one shape that works: the path mounted on the
  repository's host below `/edu-sharing`, where the browser sends the cookie itself. Measured before it was built
  (`scripts/session-disableguest-probe.mjs`, staging, 2026-11-15 — re-measure before contradicting): an unknown or
  ENDED session answers `200` as `esguest` on the identity and `200` with the public results on a search; with
  `DisableGuest: true` both answer `401`. Rules. (1) `src/auth/upstream-auth.ts` is the ONE place a credential is
  put on a repository call: a session travels as `Cookie` + `DisableGuest: true` and NEVER beside `Authorization`;
  everything else as `Authorization`. `withCredential` and the login probe in `wlo-fetch.ts` both call it, inside
  the repository-host check. (2) Only `JSESSIONID` and `INGRESSCOOKIE` are taken from a `Cookie` header, and
  `rest/auth-pages.ts` is the only reader — guarded in `tests/session-exchange.test.ts` (one reader, one writer).
  (3) A block's content is its holder's to write, so the cookie string of a `k: 'session'` block is checked again
  when it is decoded. (4) The access id is a hash of the session id — checked again at decode, so a block sends only the session its id was
  made from — the entry is filed as `k: 'ticket'` with `sess: true` (an unknown `k` fails an older build's whole
  registry closed; second review 2026-11-15) and carries the
  twelve-hour expiry — the reasoning of the ticket block, unchanged. (5) No CORS on the path, `Origin` required and
  equal to the repository's origin or listed in `WLO_SESSION_ALLOWED_ORIGINS` — its OWN list (review 2026-11-15:
  reusing the ticket list entitled every ticket page to sessions and narrowed the ticket path for whoever set it). (6) Write paths with a session have a
  live test (`tests/live/session-exchange.test.ts`): no CSRF token is needed (2026-08-12), and an ended session is
  refused with 401 instead of reading as a guest.
  From the security review of the same day: (7) two DIFFERENT `JSESSIONID` values in one request are refused,
  never "the first one" — a sibling subdomain can plant one with a longer path (cookie tossing). (8) The kind is
  bound to the entry (`registry.kindOf`): a session-listed id decodes only as a session block. (9) The same session
  id under another person REPLACES the entry (not measured whether the repository reuses a session id across a
  change of login). (10) Accepted and written down in `docs/AUTH.md` §5d: the exchange turns an `HttpOnly` session
  into a block a script on the repository's origin can hold. (11) A session block belongs to ONE listing: it carries
  the entry's `iat` (seconds with a millisecond fraction — never round it) and is refused when that differs; the
  "same listing?" decision runs inside the registry's serialised write (`listUnlessListed`), and a fresh listing
  is STAMPED there, strictly after the previous one, never with the caller's clock (two listings of one instant
  would revive a revoked block; review 2026-11-15) — so a revocation or the twelve-hour end is not
  undone by the next exchange of the same session (chatbot team, 2026-11-15). Ticket blocks follow the same rule since
  the team's second answer of that day (`credentialFromAccessBlock` compares for both kinds; R2's "a logout lasts until
  the next exchange" is gone). (12) The chart
  routes the path with its own Ingress on the repository's host (`sessionIngress`), one `Exact` path below
  `/edu-sharing/`, forwarded UNCHANGED and answered by the server at that path (`WLO_SESSION_MOUNT_PATH`) — no
  rewrite annotation, which on ingress-nginx switches every path of the host to regex matching (review
  2026-11-15). That switch is the only way the chart sets `WLO_SESSION_EXCHANGE`; `createIngress: false` sets it
  without the object. (13) A second form: a TRUSTED FORWARDER (the chatbot backend) owns the path on the
  repository's host and passes the exchange on server to server to `/auth/session` at the root. With a key from
  `TRUSTED_CLIENT_KEYS`, `/auth/session` and `/auth/revoke` spend the client's protocol budget instead of the
  address budget, and the distinct-session guard counts per address the client names (`forwardedClientKey`:
  `X-WLO-Client-Address` when sent — then only it — else the `X-Forwarded-For` hop it added; the own header because
  Traefik drops `X-Forwarded-For` from untrusted senders by default) inside the client's space — every exchange of a forwarder comes from ITS one address, and a class
  loading at once was refused there (chatbot team, 2026-11-15). The forwarded address is read ONLY behind a valid
  key (`tests/shared-rule-discipline.test.ts`); the password paths keep the address. `TRUST_PROXY` is not the
  answer: it would make every caller's `X-Forwarded-For` count. For the `X-Forwarded-For` form it still decides
  which hop is the forwarder's, so it must fit the forwarder's way here: through the one proxy, or off when it
  connects directly. A forwarder that names no usable address is warned about in the log on every exchange. The
  named address is parsed only behind a known key (`forwarderBudget` takes it as a thunk), never with a zone id, and
  `addressUnit` is total: a header anyone can send must not be able to throw (review 2026-11-15).
