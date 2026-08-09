# Privacy Policy — WLO MCP Server

This document describes what data the WLO MCP Server processes, why, and for how
long. It is written to match the actual implementation and is intended as a
baseline the deploying **operator** adapts and publishes. The operator that runs
a deployment is the data controller and should add a contact address and their
governing jurisdiction.

_Last reviewed: 2026-08-04._

## What this server is

A Model Context Protocol (MCP) server that lets AI assistants search open
educational resources (OER) from [WirLernenOnline](https://wirlernenonline.de)
(the "WLO" edu-sharing repository). It has **no user accounts of its own, no
database, no cookies, and no session state** — every request is served in
isolation and nothing about it is retained after the response is sent.

Two things about the surface decide what this policy has to cover, and both
depend on how the operator configured the deployment:

**Reading is the default and needs no login.** Out of the box the server calls
the repository anonymously and offers 25–26 read-only tools plus a public
read-only REST layer.

**Writing exists, and requires an identity.** With a login the server also offers
14 curation tools that change data in the repository: editing metadata, creating
records, submitting them for editorial review, managing collections, choosing
which variant a topic page renders, deciding metadata proposals, and deleting
records. They are listed for every caller — a tool a model never sees is a login
that never starts — and **refuse at call time** without a write-capable identity,
carrying the challenge that asks the host to offer that login. Every mutation is
confirmed in two steps — a preview first, then a
single-use token bound to exactly that change — and is read back from the
repository afterwards, so a report never states more than was verified.

An operator who wants a strictly read-only deployment gets one by leaving
`WLO_SERVICE_USER`/`WLO_SERVICE_PASSWORD` unset and not configuring the
connector with per-user credentials; see "Operator checklist" below.

## How an identity reaches the server

There are three possibilities, resolved per request:

1. **Anonymous** (default) — no credential at all.
2. **A service account** from the environment (`WLO_SERVICE_USER` /
   `WLO_SERVICE_PASSWORD`) — one shared identity for everyone using this
   deployment. Writes under it are additionally gated behind
   `WLO_ALLOW_SERVICE_WRITES`, because a change made under a shared account is
   attributable to nobody.
3. **The individual user's own WLO login**, sent by their AI host as an
   `Authorization: Basic` header from the host's connector settings. The model
   never sees it.

**Scope:** the credential chain applies to the MCP endpoint (`POST /mcp`) only.
The public REST layer (`GET /api/*`) and the launcher page run anonymously by
construction and cannot inherit any configured account.

## Data the server processes

| Category | Purpose | Retention |
|----------|---------|-----------|
| **Search terms, node IDs, filter labels** (from tool calls / `GET /api/*`) | Forwarded to the upstream repository — and, when the Wikipedia or URL-text tools are used, to those services — to fulfil the request. | Not stored. Held in memory only for the duration of the request. |
| **Metadata values a curation tool writes** (titles, descriptions, keywords, licence, editorial notes, version comments) | Sent to the repository as the change the user confirmed. Once written they are part of the repository's record and its version history — under **the repository operator's** policy, not this server's. | Not stored here. This server keeps no copy after the response. |
| **An `Authorization` header a user's AI host sends** | Forwarded to the configured repository so the request acts as that person. Attached in exactly one place (`src/wlo-fetch.ts`) and **only** to the repository host — never to Wikipedia, never to the text-extraction service. | Not stored, not logged. Scoped to the single request that carried it (`AsyncLocalStorage`). |
| **A truncated SHA-256 digest of that header** | Abuse protection: counting how many *distinct* logins one client address presents, which is what separates a normal per-user client from credential guessing. Deliberately a digest — this state lives for a whole window, and holding passwords in it would create the exposure the guard exists to reduce. | In memory, ≤ 10 minutes (`AUTH_CREDENTIAL_LIMIT`, set `0` to disable). Never the cleartext. |
| **Client IP address** | Transient per-IP rate limiting (in-memory counters, fixed 60-second window). With `TRUST_PROXY=1` the **rightmost** `X-Forwarded-For` hop is used — the address the trusted proxy itself appended; the leftmost value is client-supplied and therefore spoofable. | Not persisted; counters reset on process restart and expire with the window. |
| **Pending confirmation tokens** | The two-step confirmation: a random token plus a SHA-256 fingerprint of the planned change. Holds no values in the clear. | In memory, 10 minutes, at most 1000 entries, single use. Lost on restart. |
| **The access-block allow-list** (only when `WLO_AUTH_PRIVATE_KEY` is set) | One entry per issued personal access block: a random access id, the **WLO user name** it was issued for, and the time this server registered it. Needed so a block can be revoked — without a record of what was issued, "revoke" cannot mean anything. Never a password: the credential travels encrypted inside the user's own block and is only ever in memory here. | **The one thing this server persists**, in a file on a dedicated volume (`WLO_AUTH_REGISTRY_PATH`). An entry lives until the user revokes it on `/auth-revoke.html`, until it is pushed out by that same account's eleventh newer block (each account keeps its ten most recent), or until the operator deletes it from the file. |
| **Operational logs** (structured JSON to `stderr`) | Diagnostics and abuse protection. A log line may include a **search term**, a **node ID**, or the **host** of a URL that was refused — for debugging only. | Governed by the **operator's** logging system, not by this server. The server writes to `stderr` and keeps nothing. |

The server **never logs credentials or tokens**, and never logs a full
caller-supplied URL (only its host), because such a URL can carry a token in its
query string.

## What the server does NOT collect

- No accounts of its own; **no password is ever stored**, and none is logged.
  Personal access blocks are not an exception: what is kept is an access id and
  a user name, never a credential.
- No cookies, tracking pixels, analytics, or advertising identifiers.
- No behavioural profiling across requests, and no record linking a person to
  what they searched for.
- The prompt launcher page (`/launcher.html`) and the access-block pages
  (`/auth`, `/auth-revoke.html`) are fully self-contained — they load **no
  third-party fonts, scripts, or assets**, so opening one does not leak the
  visitor's IP to any third party. The widgets are likewise self-contained.
- The access-block page never transmits the password: it is encrypted in the
  browser, and what reaches the server is ciphertext only. The page stores
  nothing in `localStorage`, `sessionStorage` or a cookie, and puts nothing in
  the URL.

## Data recipients (third parties)

Fulfilling a request may transmit data to:

1. **The WLO edu-sharing repository** (`WLO_REPOSITORY_URL`, default
   `redaktion.openeduhub.net`) — the source of the OER content and the target of
   every write. The only recipient that ever receives a credential.
2. **Wikipedia's public REST API** (`*.wikipedia.org`) — only when the
   `get_wikipedia_summary` tool or `GET /api/wikipedia` is invoked; receives the
   search term.
3. **A text-extraction service** (`WLO_TEXT_EXTRACTION_URL`) — only when
   configured. Receives the URL whose text is to be read: normally a material's
   curated source URL, and, where the operator leaves the `get_url_text` tool
   enabled, **any URL the caller supplies**. That service then fetches the target
   itself. Unset (the default) disables this path entirely.
4. **The AI host** that calls this server (e.g. ChatGPT, Claude) — the client
   that initiated the request. That host's own privacy policy governs the
   surrounding conversation; this server neither controls nor receives it.

No data is sold, and no data is shared with any recipient beyond what is
technically required to answer the request above.

## Security controls

- **Transport:** TLS is terminated by the operator's reverse proxy. A credential
  over a non-`https` repository URL would be on the wire in the clear (HTTP Basic
  is base64, not encryption); the server warns about this at startup.
- **Credential boundary:** a credential is attached in one place and only to the
  configured repository host, matched on prefix plus a boundary so a look-alike
  host cannot receive it.
- **Anonymous by default:** the whole HTTP handler runs in an explicitly
  anonymous scope; the MCP endpoint is the one branch that elevates deliberately.
  A surface added later is therefore public-safe without anyone remembering.
- **Two-step writes:** no mutation happens on a first call. The preview shows the
  concrete change; the token is bound to a fingerprint of exactly that change and
  is consumed on every attempt, so an approval cannot be replayed against a
  different one.
- **Write verification:** every write is read back from the repository and
  reported field by field, and an aborted request is reported as an *open*
  outcome rather than as a failure.
- **Rate limiting:** per-IP caps on the MCP endpoint (`RATE_LIMIT_RPM`) and on
  the tighter public REST surface (`API_RATE_LIMIT_RPM`), plus a cap on distinct
  logins per address (`AUTH_CREDENTIAL_LIMIT`).
- **Input validation:** every public REST parameter and every written field is
  length-, count- and format-bounded server-side; node IDs are URL-encoded before
  interpolation.
- **Request bounds:** oversized POST bodies are rejected (`MAX_BODY_BYTES`,
  `413`); inbound request and header timeouts are set.
- **SSRF:** a URL handed to the extraction service is checked against private
  network ranges both literally and after DNS resolution. See the known
  limitation under `get_url_text` in the README — the operator can switch that
  tool off with `WLO_DISABLE_UNSAFE_TOOLS`.
- **No detail leakage:** internal errors return a generic `500`.
- **Widget sandbox:** the widget CSP whitelists exactly the configured
  edu-sharing origin for connections and resources and permits no framing, so a
  rendered widget can load OER thumbnails and nothing else.
- **Container:** runs as the non-root `node` user; base image pinned by digest;
  CI gates on a clean production dependency audit.

## Data subject rights

Requests are transient and leave no record in the application. With personal
access blocks switched on there is **one** exception, and it is self-service:

- **The allow-list entry for an issued access block** (access id, WLO user name,
  issue time). Anyone can delete their own by pasting the block on
  `/auth-revoke.html`; the entry is removed and the block stops working
  immediately. Someone who no longer has the block can achieve the same by
  changing their WLO password, which invalidates every block containing it. An
  operator can also delete entries directly from the registry file.

Two further things outlive a request and are not this server's to erase:

- **Content written through the curation tools** lives in the WLO repository,
  including in its version history and its editorial workflow. Requests about it
  go to the repository operator.
- **Operational logs**, if the operator enables aggregation or long-lived
  retention, become that operator's responsibility under their own
  jurisdiction's rules (e.g. GDPR/DSGVO for EU deployments).

## Operator checklist

Before publishing this policy for a live deployment:

- [ ] Add the operator/controller identity and a contact address.
- [ ] State which mode this deployment runs in: anonymous, service account, or
      per-user login — and whether curation (write) tools are reachable at all.
      **This decides how much of this policy applies.**
- [ ] If writes are enabled, name the repository whose privacy policy governs the
      written content and its version history.
- [ ] State whether `WLO_TEXT_EXTRACTION_URL` is set and, if so, which service it
      points at — it is a third-party recipient of URLs.
- [ ] State whether `get_url_text` is enabled (`WLO_DISABLE_UNSAFE_TOOLS`); if it
      is, caller-supplied URLs reach that service.
- [ ] State the log retention period configured for your environment.
- [ ] Confirm the reverse proxy terminates TLS and does not add its own tracking.
- [ ] Confirm `WLO_REPOSITORY_URL` points at the intended repository and uses
      `https` if any credential is configured.
- [ ] Review your jurisdiction's requirements (for EU: GDPR/DSGVO, and — for
      public-sector/educational use — accessibility duties under BITV 2.0 /
      EN 301 549).
