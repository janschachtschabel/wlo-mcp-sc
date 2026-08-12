# Relay clients and the credential limiter (design + tasks in one file)

**Status: P1 built 2026-08-12. P2 (session credential) is designed, not built —
it waits on a concrete edu-sharing embedding.**

## The problem, measured

`authAbuseLimiter` guards `POST /mcp` (`http-app.ts:225`) against this server
being used as a relay for guessing WLO logins. It counts **distinct credentials
per client address**, capped by `AUTH_CREDENTIAL_LIMIT` (default **10**) in a
**10-minute fixed window** (`createDistinctValueLimiter`, `rate-limit.ts:77`).

The mechanism is right and its reasoning is stated in the source: *"a per-user
client legitimately sends its header on every call"*, and *"a real user has
exactly one [login]"*. Both sentences assume **the client is one person's
machine**.

A **chatbot backend** is not that. It serves many people from **one address**,
and it forwards each person's own access block. Measured against the deployed
topology (one MCP process, one chatbot backend, 2026-08-12):

> The **11th distinct signed-in person within a 10-minute window is refused**
> with 429. Anonymous callers are unaffected — `if (userCred && …)` means no
> credential is never counted. Repeat calls by the same person cost nothing —
> `bucket.seen.has(hash)` returns false forever.

The observable signature is misleading: **signed-in users break while anonymous
users work**, and the client sees a tool error, not a rate limit.

## Why not simply exclude blocks from the counter

The obvious fix — *"only count `Basic`; a `wlo2.` block is already proven"* — is
wrong, and `docs/AUTH.md` §4 says why:

> "The public key is published so browsers can encrypt, **so anyone can build a
> block carrying a given id**."

`credentialFromAccessBlock` checks two things: the block decrypts (anyone can
encrypt) and its `jti` is on the allow-list. Whoever learns a **`jti`** can
therefore mint blocks carrying that id and an arbitrary password, and the server
will dutifully build `Basic` from it and send it upstream. Excluding blocks
would open exactly the oracle the limiter exists to close.

## The fix: key by what is being proven, not by who is asking

**A `Basic` credential is counted per address** (unchanged — a guesser presenting
Basic has no identity to bound). **A block is counted per `jti`.**

Under a valid `jti` there is exactly **one** correct password. A legitimate user
therefore contributes exactly one entry for the lifetime of that block; a guesser
contributes many, and they land in the same bucket no matter how many addresses
they come from.

| Scenario | today (key = address) | after (key = `jti`) |
|---|---|---|
| 500 people through one relay | ❌ 11th refused | ✅ one bucket each, never collide |
| guesser, leaked `jti`, 1 address | 10 tries / 10 min | 10 tries / 10 min |
| guesser, leaked `jti`, 50 addresses | **500** tries / 10 min | **10** tries / 10 min |
| guesser presenting `Basic` | 10 / address | **unchanged** |

The change is strictly better on both axes: it removes the address rotation that
defeats the guard today, and it removes the false positive on relay clients.

**The cap stays at `AUTH_CREDENTIAL_LIMIT`.** Ten wrong passwords under one id is
more than a legitimate client ever needs (it needs one), so a tighter per-block
cap would be an improvement — but it is a *separate* decision and is not bundled
here. Noted as a follow-up.

## Rules this must not break

1. **The `jti` is a secret** (`AUTH.md` §4: revocation acts on it). It becomes a
   map key here, which is memory, not output — it must **never** reach a log line
   or a response. The existing warning logs `{ ip }` and keeps doing so.
2. **A request with no `Authorization` keeps answering 200 anonymously**
   (`AUTH.md` §10 rule 8). Untouched: the counter still runs only under
   `if (userCred && …)`.
3. **`Basic` keeps its address bucket.** Any change that moved Basic off the
   address key would remove the guard for the only scheme that carries a
   guessable secret.
4. The three password-checking endpoints (`/auth/issue`, `/auth/revoke-all`,
   `POST /oauth/authorize`) use the same limiter through
   `auth/access-verify.ts` with an **address** key and are **not** touched — a
   password typed into a page is a guess by address, with no `jti` in play.

## P1 — tasks (built 2026-08-12)

- [x] **T1** Failing test first: `tests/auth-relay-limiter.test.ts`
  - many blocks with **different** `jti` from ONE address stay under the cap;
  - many **passwords** under ONE `jti` hit the cap, even across addresses;
  - `Basic` still buckets per address;
  - the bucket key never appears in a log line.
- [x] **T2** `src/auth/credential.ts`: `WloCredential` gains an optional
  `jti`, set only in `credentialFromAccessBlock`; new exported
  `abuseBucketKey(cred, ip)` holds the rule in ONE place.
- [x] **T3** `src/http-app.ts:225`: key the check with `abuseBucketKey`, and give
  the block branch its own refusal text (the address wording is wrong for it).
- [x] **T4** `docs/AUTH.md` §7 records the relay case and the per-`jti` rule.

## P2 — session credential (designed, NOT built)

For a chatbot embedded **inside** the repository, which holds the user's
edu-sharing session but never their password. Required because both credential
shapes this server accepts (`Basic`, and the `wlo2.` block that decodes to
`Basic`) **carry the password**, and a session is not one.

Measured in `docs/plans/2026-08-04-mcp-access-token-design.md` §"Verified facts":

- ✅ A Basic login issues a `JSESSIONID`, and **that cookie carries our
  endpoints**: with the cookie alone and no Basic header,
  `/iam/v1/people/-home-/-me-` reports the real authority.
- ⚠️ The cookie has **neither `Max-Age` nor `Expires`** — that is why it was
  rejected as *block content* in 2026-08-04. **That reason does not apply here:**
  an embedded host has a live session on every request and needs no durability.
- ⚠️ An `INGRESSCOOKIE` is set alongside it (load-balancer binding); the probe
  passed without it, but with several repository replicas it would be needed.

### Cookie attributes, measured 2026-08-12 (staging)

Probe: one Basic request to `/rest/iam/v1/people/-home-/-me-`, reading the raw
`Set-Cookie` attributes. **The server issues both cookies even when the login is
rejected (401)** — an anonymous session — so the flags below need no valid
account to observe.

| Cookie | Attributes |
|---|---|
| `INGRESSCOOKIE` | `Path=/edu-sharing; Secure; HttpOnly` |
| `JSESSIONID` | `Path=/edu-sharing; HttpOnly` |

Four consequences, and they cut two of the three delivery shapes:

1. **`HttpOnly` on both ⇒ the widget path is dead.** No JavaScript on an
   embedding host page can read `JSESSIONID`. "The host hands the session to the
   widget" is not hard, it is impossible. Note that a DevTools "copy as cURL"
   *does* show the cookie — the browser attaches HttpOnly cookies to requests —
   so that capture is not evidence of readability.
2. **No `SameSite` attribute at all.** Browsers treat the omission as `Lax`, so a
   **cross-site** embedded iframe carries no cookie either. The "browser attaches
   it by itself" route therefore requires same-site.
3. **`Path=/edu-sharing` and no `Domain`** ⇒ host-only, path-scoped. Combined
   with (2): for the browser to attach the cookies to a boerdi call, boerdi must
   be mounted on the **same host, under `/edu-sharing/…`** — a reverse-proxy
   mount inside the repository, not a sibling subdomain.
4. **`JSESSIONID` carries no `Secure`** (its neighbour does). Not our defect and
   not in this scope, but worth reporting to the operator: a session cookie
   without `Secure` may travel over plain HTTP.

### The authenticated run (same day, account `WLO-Upload`)

| Probe | Result |
|---|---|
| cookie set alone, **no** `Authorization` | `200`, authority `WLO-Upload` — **authenticated** |
| `JSESSIONID` only, `INGRESSCOOKIE` dropped | `200`, authority `WLO-Upload` — still authenticated |
| `JSESSIONID` corrupted, `INGRESSCOOKIE` valid | `200`, authority **`esguest`** |
| nothing at all (control) | `200`, authority `esguest` |

**1. The premise holds:** the cookie set alone authenticates. A session credential
is therefore a real credential shape for this repository, not a hope.

**2. The headline finding — an invalid session is indistinguishable from no
credential.** It does not 401; it answers `200` as guest, byte-identical to the
control row. That completes the asymmetry the design has to survive:

> A wrong **`Basic`** fails **loudly** (401, `identity.ts`, measured 2026-07-31).
> A wrong **cookie** fails **silently** (200, guest).

So the session branch **must** verify through `checkIdentity()`'s `authority`,
never through `res.ok` — once, when the credential is accepted. Without that, an
expired session shows the user their own name in the UI while every search
quietly returns public-only results, and every write fails for a reason nobody
can see. This is the same trap `identity.ts` was built for, one layer down.

**3. What the dropped `INGRESSCOOKIE` does NOT prove.** It authenticated without
it — but staging may well run a single replica, and then there is nothing to
bind to. The measurement cannot tell "not needed" from "nothing to be sticky
about". Treat the cookie set as **indivisible**: forward what arrived, in full.

**4. The abuse-limiter question, now answerable.** `abuseBucketKey` keys `Basic`
by address and a block by `jti`; a session has neither, and it was unclear what
bounds it. The measured shape settles it: `JSESSIONID` is 32 hex characters of
server-generated randomness — nothing human-chosen, nothing to guess. The
distinct-credential limiter exists to stop *password* guessing through this
relay, so a session credential should **not** enter that bucket at all: it could
only produce false positives, and they would be exactly the relay false positive
P1 just removed. The general `RATE_LIMIT_RPM` still applies. (The 128-bit
strength follows from the length *if* it is Tomcat's default id — the probe
measured the length, not the entropy.)

**5. Free consequence:** because the identity endpoint reports `authority` under
the cookie, "signed in as X" is available at no extra cost on this path —
unlike the block path, which deliberately does not know who.

Probe script: `scripts/session-cookie-probe.mjs` — credentials from the process
environment, `scripts/probe.env`, or the tree's `.env` (`WLO_SERVICE_*`); prints
names, value LENGTHS, attributes, status and `authority`, never a value.

### Can the repository hand a browser something usable? No — read off its own API description (2026-08-12)

Constraint from the operator: **nothing new can be built on the edu-sharing
side.** So the question became whether an *existing* endpoint already issues a
credential JavaScript may read. Answered from `/edu-sharing/rest/openapi.json`
(317 paths, fetched unauthenticated):

| Endpoint | Returns | Verdict |
|---|---|---|
| `GET /authentication/v1/validateSession` | `PrimaryLogin` — `authorityName`, `validLogin`, `isGuest`, `toolPermissions`, `sessionTimeout` … | **no credential.** A status object, nothing to forward |
| `POST /authentication/v1/appauth/{userId}` | `AuthenticationToken` — `{userId, ticket}` | a ticket exists, but only for a **registered application** |
| `GET /authentication/v1/oauth2consent[/data]` | `OAuth2Consent` — `clientId`, `state`, `scopes` | consent data only; there is **no token endpoint** anywhere in the 317 paths |

So the cheap hope — "the page fetches a ticket and hands it to us" — is dead,
measured rather than assumed. What the browser *can* read is the user's
identity (`authorityName`), which is useful for display and attribution but is
not a credential and must never be treated as one: a claim travelling in an
ordinary request proves nothing about who sent it.

**`appauth` is the one remaining server-side path, and it changes the question.**
It authenticates *any* user by id for a registered application — no password, no
session. That would need an admin **registration** at edu-sharing (configuration,
not code, which may be reachable where an endpoint is not) and the app secret
kept server-side. But it is impersonation by design: whoever may call it may
become anyone. It is therefore only safe with something that BINDS the claimed
user id to the actual visitor — and that binding is exactly what the embedded
page cannot give us. Not a fallback; a separate decision with its own threat
model.

**What survives for an embedded widget:** the browser is same-origin with the
repository, so the widget can act with the user's session itself
(`fetch(…, {credentials: 'include'})` — `HttpOnly` prevents *reading* the cookie,
not *sending* it). The rights-bound step runs in the browser; the orchestration
stays with us. And the reverse-proxy mount stays the clean long-term shape.

**Seam (three places):** `WloCredential` gains a session shape;
`credentialFromHeader` learns a third inbound form; `withCredential`
(`wlo-fetch.ts:46`) sets `Cookie:` instead of `Authorization:`.

**The invariant that must travel with it:** `withCredential` today holds the rule
*"the credential goes ONLY to the repository host"*. The cookie branch must sit
**inside** that host check, not beside it — otherwise a session id travels to
Wikipedia and the text-extraction service.

Not started: no concrete embedding exists yet, and building the credential shape
before knowing how the host delivers it would be a guess.

### Does a write need a CSRF token? No — measured 2026-08-12 (E1)

The embedded widget can only write with the visitor's session if a plain
`fetch` suffices. A CSRF token would break that: the code would have to obtain
one from somewhere, and "somewhere" is the repository we may not change. So the
question was measured before anything was designed on top of it.

**Method, and why it changes nothing.** Three `POST …/collections/-home-/{id}/children`
requests carrying **only the session cookies**, against a parent collection id
that does not exist. If such a request reaches the handler, the repository
answers with its own error object — and that answer is the evidence, because a
CSRF filter is a servlet filter and would have refused the request *before* the
handler ever saw it. The three differ only in what a browser would attach:

| Attempt | `Origin` / `Referer` | Result |
|---|---|---|
| no origin | none | `404` · `DAOMissingException: Node does not exist` |
| **own origin** | the repository's own | `404` · same |
| foreign origin | `https://fremde-seite.invalid` | `404` · same |

**1. No CSRF token is required.** All three reached the DAO layer. Nothing was
demanded, and no `Set-Cookie` came back on any of them — the server does not
even hand out a token when a write is attempted without one.

**2. The `Origin` header is not examined** on this route: the foreign origin
fared exactly as the own one.

**3. That is not a vulnerability report.** A real cross-site POST from a
browser would carry no cookie at all: `JSESSIONID` has no `SameSite`, browsers
default to `Lax`, and `Lax` withholds the cookie on cross-site POST. The
browser is the protection here; this script is not a browser and simply set the
header itself. Read together with the cookie attributes above, the exposure is
unchanged — but it means the repository's own defence rests on the browser
default, not on a check of its own.

**4. A cookie-only write completes end to end.** The `--schreiben` run created a
collection carrying nothing but the session cookies (`200`) and deleted it again
in the same run, leaving nothing behind. The claim the whole embedding rests on
— *a plain `fetch` from the page can write* — is therefore measured, not
inferred.

Two things travel with that. The service account in this tree, `WLO-Upload`,
demonstrably **has** write rights, which is exactly what the reading account
should not have. And this is one route, one deployment, one day: a production
edu-sharing could run a filter staging does not, so the executor still has to
report a `403` honestly instead of assuming this result holds forever.

Probe script: `scripts/csrf-write-probe.mjs` (normal run changes nothing;
`--schreiben` adds the real create-and-delete). Its classifier is pinned by
`tests/csrf-write-verdict.test.ts` — the point being that a bare `403` must come
out as *undecided* rather than as the convenient answer, because it can equally
mean "no write permission" and "silent gate".

## Follow-up, deliberately not bundled

- A **tighter cap for the block bucket** (a legitimate one needs exactly 1).
- **Capacity, not code:** `RATE_LIMIT_RPM` is **120/min per address** and is
  checked before the credential (`http-app.ts:177`), so a relay client spends one
  bucket for all its users — anonymous ones included. An agent-style client doing
  ~15 tool calls per run reaches it at ~8 runs/min. Operator decision
  (`RATE_LIMIT_RPM=0` exists for a WAF in front); named here so it is not
  discovered as a second wall after this one is removed.
