# Authentication — how a person signs in to this server

Who this is for: whoever operates this deployment, and whoever has to change the
auth code later. It explains **what runs, why it is built that way, and which
decisions must not be quietly undone.** Every number and behaviour here was
measured against a live repository; where a claim rests on a measurement, the
date is given, and the design documents in `docs/plans/` hold the raw figures.

---

## 1. The constraint everything follows from

edu-sharing has no token to hand out.

Probed 2026-07-30: its own OpenAPI declares exactly two security schemes,
`basicAuth` and `cookieAuth`. There is no OIDC discovery document, no dynamic
client registration, and a `Bearer` header is **ignored rather than rejected** —
a request carrying one looks authenticated and silently is not.

That rules out the obvious design. This server cannot receive a token, exchange
it, and forward it upstream, because there is nothing upstream that would accept
one. **Every scheme that reaches edu-sharing therefore carries the user's actual
password.** The whole of the rest of this document is about carrying it as
little and as briefly as possible.

Do not re-derive this. If you want to contradict it, re-measure it.

A second measurement shapes the code just as much. Asked "who am I?" without a
credential, edu-sharing answers **200** with the authority `esguest`; with a
*wrong* credential it answers **401** (measured against production 2026-07-31, on
the identity endpoint and the search endpoints alike). So:

> **A 200 is not proof of a login.** Every check of a credential in this server
> reads the reported *authority*, never the status code. `auth/identity.ts` owns
> that rule and `auth/access-issue.ts` is its only gate-keeping caller.

---

## 2. The three identities

| Mode | Where it comes from | May read | May write |
|---|---|---|---|
| **anonymous** | no header — or the explicit `wlo-anon.v1` token (§5b) | public material | never |
| **service** | `WLO_SERVICE_USER` + `WLO_SERVICE_PASSWORD` | whatever that account sees — **for everybody** | only with `WLO_ALLOW_SERVICE_WRITES` |
| **user** | the caller's own access block | that person's rights | always |

The service account is a shared identity: everything it can see, every user of
this deployment can see, and every change it makes is attributed to it rather
than to a person. That is why writing under it is off by default — it is a
decision, not a default.

Two scopes worth stating explicitly:

- The service account applies to **`POST /mcp` only.** The public REST layer
  (`GET /api/*`) and the launcher run anonymously by construction
  (`runAnonymous` wraps the whole HTTP handler; the MCP branch elevates
  deliberately). Otherwise everything the account can see would be world-readable
  without a login.
- **Write permission is not the same as authentication.** `services/write/credential-gate.ts`
  decides it separately, and it is stricter.

---

## 3. The access block

An access block is the user's WLO credential, encrypted so that only this server
can open it.

```
wlo2.<b64u(wrappedKey)>.<b64u(iv)>.<b64u(ciphertext||gcmTag)>
```

- A fresh **AES-256-GCM** key encrypts the payload; **RSA-2048-OAEP-SHA256**
  wraps that key. Hybrid rather than plain RSA because OAEP caps the plaintext at
  190 bytes — a long password plus the id can exceed it, and the failure would
  hit only some users and only in production.
- The payload is `{ v: 2, jti, u, secret, iat }`: the access id, the WLO user
  name, the password, and the issuing browser's clock.
- **Everything is inside the AEAD, especially the `jti`.** Revocation acts on
  that id, so an id sitting *outside* the authenticated payload could be swapped
  — a holder of a revoked block would splice in one that is still listed and
  carry on. `tests/access-token.test.ts` pins that splice as unreadable.

**The password is encrypted in the browser.** `/auth` and `/oauth/authorize`
fetch the public key from `GET /auth/public-key` and use WebCrypto; what leaves
the device is the block. The server opens it in memory to verify the login and
to build the `Authorization: Basic` header for the repository — it is never
written to disk.

`src/auth/access-token.ts` is pure: no HTTP, no filesystem, no environment. It
also contains `encodeAccessToken`, which production never calls — it is the
executable specification of the wire format, and it is what the browser
implementation is validated against.

### Where the credential may travel

One rule, one place: `src/wlo-fetch.ts` is the only module that attaches a
credential, and it attaches it only to the configured repository host. Nothing
else in the codebase can put a password on the wire.

---

## 4. The allow-list

`src/auth/access-registry.ts` holds which blocks are still valid. Two properties
matter more than the mechanism:

**It is an ALLOW-list, not a deny-list.** A deny-list that goes missing silently
resurrects every revoked block; an allow-list that goes missing invalidates
everything and people fetch a new one. Inconvenient beats unsafe, so *every*
failure here closes the door: only an **absent** file counts as "first start". A
present-but-unreadable or malformed one disables the feature and logs why.

**It holds ids, never credentials** — `{ jti, label, iat }` and nothing else,
asserted by test. It is also the only module in this project that writes to disk
at runtime, which is why the container mounts exactly one writable volume and
keeps everything else read-only. `tests/shared-rule-discipline.test.ts` enforces
that claim against the source rather than trusting this paragraph.

Writes are serialised and **undone on failure**, so the list never grants what it
could not record. Ten blocks per WLO account; the oldest is evicted beyond that,
because nothing removes an entry on its own — both revocation paths below need a
person to act.

### What revocation actually proves

There are two paths, and they prove different things. That is not redundancy:
each one is the *only* path available on one of the two routes into the server.

**`POST /auth/revoke` — by block.** Takes a block, decrypts it, removes its
`jti`. Note carefully what that does and does not establish:

> Revocation requires **knowledge of the access id**, not possession of the
> original block. The public key is published so browsers can encrypt, so anyone
> can build a block carrying a given id.

That is the intended trade — whoever notices a compromise must be able to act
immediately — but it makes the id the secret. **It must never be logged and never
appear in a response.** `tests/auth-endpoints.test.ts` pins both halves: a forged
block with a listed id revokes, and the issuance answer does not carry the id.

**`POST /auth/revoke-all` — by account.** Verifies a WLO login and removes every
entry carrying that user name. This exists because the path above is unreachable
for OAuth users: there the block goes to the AI host and **the person never sees
it**, so an id they cannot read is an id they cannot revoke. Until 2026-08-06 an
OAuth-issued access could only be ended by the operator editing the registry file
— a gap found in use, not in review.

Here the password is the proof, and the check that establishes it may never be
skipped. The same published key that lets anyone forge a block carrying an *id*
lets anyone forge one carrying a *name*; without the upstream check, a guessed
username would disconnect a stranger's AI host. So the login is verified at the
reported **authority** — not at the status code, which is `200` either way — in
`auth/access-verify.ts`, the single module all three password-checking endpoints
go through. `tests/shared-rule-discipline.test.ts` pins that there is one such
module and that both callers use it; `tests/auth-revoke-all.test.ts` pins that a
rejected login removes nothing.

Matching is by **exact** user name. Whether edu-sharing treats `Jan` and `jan` as
one login is unmeasured, and folding case would be a convenience if they are the
same account and a way to wipe a stranger's accesses if they are not. The page
reports the number removed, so a name spelt differently is visible rather than
silent.

---

## 5. Two ways in

Both end at the same place: a `wlo2.…` block the caller presents as
`Authorization: Bearer …`.

### 5a. Paste it once — `/auth`

For a client with a header or API-key field. The user opens `/auth`, types their
WLO login, the page encrypts locally, `POST /auth/issue` verifies the login
upstream and lists the id, and the page shows the block. Two copy buttons: with
and without the `Bearer ` prefix, because a client that wants only the token
silently fails when the word travels with it (that cost a live afternoon).

Revoke at `/auth-revoke.html` (or `GET /auth/revoke`, the same page) — by pasting
the block back, or by logging in to end every access of the account at once.

### 5b. OAuth 2.1 — every other client

Measured 2026-08-05: ChatGPT's connector offers **no header or API-key field at
all** — only OAuth, none, or mixed. So for that client the block cannot be
entered by hand, and OAuth is the only mechanism that reaches every host.

```
client → GET /.well-known/oauth-authorization-server   (RFC 8414)
       → GET /.well-known/oauth-protected-resource     (RFC 9728)
       → POST /oauth/register                          (RFC 7591, open)
       → browser to GET /oauth/authorize               (consent + WLO login)
       → POST /oauth/authorize                         (mints a code)
       → POST /oauth/token                             (code → access token)
```

Both spellings of each discovery path are served (`…/mcp` too): our issuer has no
path component, so the plain form is the correct one, but a client guessing wrong
would otherwise see a 404 and conclude this server has no OAuth at all.

Verified live: **ChatGPT (2026-08-05) and Claude (2026-08-06) both discover this
unprompted**, with no client id or secret entered by hand.

The consent page has **three** exits, not two: sign in, connect without an
account, or refuse.

The middle one exists because of a shape that only shows up live (measured
2026-08-06 on claude.ai): a client that has found the discovery documents *wants
a token* and cannot simply send no header. Without an answer for "I have no WLO
account" its only choices are signing in or cancelling — and cancelling is not a
connection. Someone who just wants to search was stuck.

That exit yields the token `wlo-anon.v1`, and it is a **constant on purpose**:

- It grants exactly what a request with no `Authorization` grants. Forging it
  saves the forger the trouble of omitting the header.
- So it needs no key material, no allow-list entry, no revocation and no expiry
  — none of those would protect anything. It therefore also works on a
  deployment that has no access blocks configured.
- Nothing is verified when it is issued, because there is no credential to
  verify: no upstream call, no registry write, and the guessing limiter is not
  touched (it counts credentials, and there is none).

Two properties keep it honest. **The intent must be stated** — a consent request
that merely forgot its access block still fails, rather than quietly becoming an
anonymous connection. And **the match is exact**: a typo in the token surfaces as
a broken token (401), not as anonymous. Where "anonymous" lands is defined by
§2 — it behaves exactly like a call with no header, which on a deployment with a
service account means that account's rights.

Three further decisions are load-bearing:

**The access token IS the block.** No second credential is minted, so nothing
rests on disk and no session store exists to lose on a restart — and one entry in
the allow-list covers both routes, so revoking it ends both. There is no
`refresh_token` and no `expires_in`: access ends when the block is revoked or the
WLO password changes. Do not wrap it in another token.

What that does *not* mean, and the correction is the point: the block itself
never reaches the OAuth user, so **`/auth/revoke` is unreachable for them**.
Ending an OAuth access is what `/auth/revoke-all` is for (§4). An earlier version
of this document claimed a single revocation covered both ways in without saying
which revocation — true for the paste route, false for OAuth.

**A request with no `Authorization` still answers 200, anonymously.** The `401`
fires only for a Bearer that was *presented and cannot be used* — forged, or
revoked. That is the doorway the MCP specification prescribes, and it carries
`WWW-Authenticate` with the `resource_metadata` pointer. A `Basic` header we
cannot parse degrades to anonymous instead: that is a WLO login the caller got
wrong, not a token of ours, and an authorization flow would answer a question
they did not ask.

**The request is checked before anyone sees a password field, and a refusal
never redirects.** Sending an error to a `redirect_uri` we did not recognise
would turn this server into a redirector. The check lives once, in
`src/auth/oauth-authorize.ts`, and both the GET (what to show) and the POST (what
to mint) run it — a second copy is where the PKCE requirement quietly disappears
from the path that actually hands out the code.

### The pieces the flow needs

| | Shape | Lifetime | Why |
|---|---|---|---|
| `client_id` | `wloc1.<iv>.<ct‖tag>`, AES-256-GCM under a key derived from the RSA key via HKDF | forever | carries its own registration, so a deploy does not break every client — the allow-list is the only disk writer |
| authorization code | `mcp_ac_` + 32 random bytes, stored under its SHA-256 | 60 s, one use, ≤1000 outstanding | a one-time bearer of somebody's access |
| PKCE | S256 only; challenge 43 chars, verifier 43–128 (RFC 7636 §4.1) | per flow | `plain` proves nothing — the "proof" is the string that travelled in the URL |

The code store deliberately does **not** import `access-token.ts`: the block
waits there as a ciphertext and is never opened between authorization and token
exchange. We hold the key and could — we do not, because nothing on that path
needs the password.

At `/oauth/token` the code is **removed from the store before any check runs**. A
failed PKCE proof must not leave it retryable. And every failure answers the same
`invalid_grant` text, because which check failed is exactly what the holder of a
stolen code would like to learn.

---

## 6. Why the write tools are visible to people who cannot use them

Until 2026-08-05 the 13 curation tools were simply absent without a
write-capable identity. It looked like the safer choice and it was the reason
the login never started: **a model that never sees a write tool never calls one,
so nothing ever asks the host to authenticate**, and a connector added without
OAuth stayed anonymous forever.

They are now always in `tools/list`, declare
`securitySchemes: [{type:'oauth2', scopes:['wlo']}]`, and refuse at call time
with `_meta["mcp/www_authenticate"]` on the result — which is the client's cue to
run the flow. The HTTP status stays 200, so anonymous reading is untouched. This
is the pattern OpenAI's own mixed-auth example uses.

**The refusal is unchanged and absolute.** An anonymous call reaches no write
code and makes no upstream request — asserted against the recorded fetch calls,
not against the reply text. The gate lives in exactly one place,
`registerCurationTool` in `src/tools/curation-shared.ts`, and a source scan fails
the build if a curation tool is ever registered past it.

---

## 7. Abuse limits

`/auth/issue`, `/auth/revoke-all` and `POST /oauth/authorize` are the endpoints
on this server that check a password, which makes each a guessing oracle with our
address as the origin. All three pass two limiters:

- **requests per address** (`RATE_LIMIT_RPM`), the ordinary public-surface bound;
- **distinct logins per address** (`AUTH_CREDENTIAL_LIMIT`) — the guessing guard.
  It counts *credentials*, not requests, because a per-user client legitimately
  sends its header on every call. It runs after decoding (so only logins we would
  really try upstream count) and before the upstream call (so a guesser never
  reaches WLO).

Two things make those limits hold:

**No CORS header on `/auth*` or `/oauth/authorize`.** Both limiters count per
client *address*, so a wildcard origin would let a page spend every visitor's
quota on a guess and read the outcome. The rest of the OAuth surface keeps the
wildcard and needs it — the discovery documents are public and secret-free.

**Those endpoints require `Content-Type: application/json`** (415 otherwise).
Without it the CORS argument does not hold: a `<form enctype="text/plain">` is a
*simple* request, needs no preflight, and its body can be crafted to parse as
JSON — so a page could make every visitor submit a guess from their own address
and learn the outcome out of band. Requiring the header makes the request
non-simple again, so the browser must preflight, and the preflight fails.
(`/oauth/register` and `/oauth/token` are deliberately exempt: neither carries a
credential.)

---

## 8. Operator setup

| Variable | Effect |
|---|---|
| `WLO_AUTH_PRIVATE_KEY` | PKCS#8 PEM. **Setting it is all it takes** to enable personal logins and the whole OAuth surface. Unset ⇒ `/auth*` and `/oauth/*` answer 404 and a Bearer is refused. |
| `WLO_AUTH_PRIVATE_KEY_PREVIOUS` | Rotation window — tried after the current key, so blocks issued under the old one keep working. |
| `WLO_AUTH_REGISTRY_PATH` | The allow-list file. Must point **into a writable volume**; anywhere else and the feature stays off with the reason in the log. Default `/data/access-registry.json`. |
| `WLO_PUBLIC_BASE_URL` | This deployment's public origin. It is the issuer, so whoever sets it decides where a login happens — derived from the `Host` header it would be the *caller*. Consulted from the header only under `TRUST_PROXY`. Without a resolvable issuer, OAuth is off. |

```bash
openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048
```

> **This key decrypts every issued block back into a live WLO password.** Keep it
> in the server's `.env`. Never in the image, never in the repository.

The public key is *derived* from the private one, so there is no second variable
to drift.

### Checking it works

```bash
docker compose logs mcp-server | grep -m1 'access blocks'
```

`access blocks are enabled` with the registry path, or one of two errors naming
which half failed. A first start **writes** the empty registry rather than
assuming it could — reading proves nothing about writing, and a Docker named
volume mounted where the image never created the directory belongs to root while
the container runs as `node` (measured 2026-08-05). One line in the boot log
beats a correct-looking startup and a 500 for a stranger.

From a chat, `wlo_auth_status` reports the current mode. Read it carefully:
`mode: "service"` together with `authenticated: false` means WLO is *rejecting*
the configured credentials — and then every query fails, returning nothing at
all rather than public content.

---

## 9. What this does and does not protect

**Protected.** The password never travels in the clear from the browser. A block
is useless anywhere except this server, unlike a `Basic` header, which works
against all of WLO. Compromise is revocable in one step by whoever holds the
block. Nothing containing a credential is written to disk. A stolen
authorization code is useless without the PKCE verifier, and is spent on first
presentation either way.

**Not protected, and deliberately so.** The operator of this server can read
every password: it holds the private key and builds a `Basic` header from the
result. That is not a flaw in the scheme, it is the consequence of §1 — there is
no token to relay, so anything that reaches edu-sharing carries the password. A
deployment is therefore a trust relationship with its operator, and the
`WLO_REPOSITORY_URL` must be `https` (the server warns at startup otherwise,
because HTTP Basic is base64, not encryption).

**Also not protected.** Anyone who learns a `jti` can revoke that access (§4). A
person who can read the server's environment has everything. And an access block
survives a WLO password change only until the repository stops accepting the old
one — there is no expiry of our own.

**Not protected and not meant to be:** the anonymous token. It is a public
constant, and anyone may use it. That is not a weakness, because it authorises
exactly what an unauthenticated request already authorises — treating it as a
secret would be theatre. It is worth stating plainly so that nobody later
"hardens" it into something that looks like a credential and is then trusted like
one.

---

## 10. Rules that bind future changes

Each of these was paid for once. Changing any of them is a decision, not a
refactor.

1. **A 200 from edu-sharing is not proof of a login.** Read the authority — in
   `auth/access-verify.ts`, which every password-checking endpoint goes through.
   On the revocation path this is what stands between a guessed username and a
   stranger's accesses.
2. **The access id lives inside the AEAD**, or revocation can be dodged by
   swapping it.
3. **The registry is an allow-list where every failure closes the door**, holds
   ids and never a credential, and is the only runtime disk writer. A failed
   write is undone rather than left granting what it could not record.
4. **`/auth*` and `/oauth/authorize` send no CORS header and require
   `application/json`.** Both halves are needed; either alone is bypassable.
5. **The authorization request is checked before a password field is shown, and a
   refusal gets a page, never a redirect.** The check lives once.
6. **The access token IS the block.** No wrapper, no refresh token, no expiry —
   it is the only reason one allow-list entry covers both routes. The block still
   never reaches the OAuth user, so revoking *that* access needs the account
   path, not the block path.
7. **The code is consumed before it is judged**, and every failure answers the
   same text.
8. **A request with no `Authorization` keeps answering 200 anonymously.** This is
   the property the whole undertaking most easily breaks.
9. **Write tools refuse at call time**, through the single gate in
   `registerCurationTool`. They are *visible* to everyone on purpose; the refusal
   is what is absolute.
10. **The anonymous token is the one Bearer whose "no credential" is an answer,
    not a failure.** It must never reach the 401, its match must stay exact, and
    the intent must be stated explicitly at the consent endpoint. Do not give it
    key material or an allow-list entry — it grants nothing that would justify
    either, and both would suggest it protects something.

Design documents and the measurements behind them:
`docs/plans/2026-08-04-mcp-access-token-design.md`,
`docs/plans/2026-08-05-mcp-oauth-design.md`,
`docs/plans/2026-07-31-write-support-research.md`. Live progress and the dated
findings: `docs/plans/STATUS.md`.
