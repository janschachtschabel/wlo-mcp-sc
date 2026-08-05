# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this project adheres
to [Semantic Versioning](https://semver.org/).

## [Unreleased]

Hardening, tests, modularization, and a full documentation overhaul following the
code audits.

### Added — OAuth login: the exchange, and with it the whole flow (2026-08-05)

`POST /oauth/token` completes the login: a one-time authorization code becomes
the access itself. What comes back **is** the `wlo2.…` access block — there is
no second credential, which is why one revocation on `/auth-revoke.html` ends
both the pasted block and the OAuth token at once. No `refresh_token` and no
`expires_in`: nothing here expires on a clock, it ends when the holder revokes
it or changes their WLO password.

PKCE is proof, not decoration: the verifier is hashed and compared in constant
time, and the code is removed from the store **before** any check runs, so a
failed attempt cannot be retried. A native client may come back on a different
loopback port (RFC 8252 §7.3); everything else about the redirect target must
match character for character.

`tests/oauth-flow.test.ts` walks the whole way through a real server —
discovery, registration, consent, exchange, a tool call with the token,
revocation, and then the two lines that matter most: the revoked token is
refused, and a request with no header still gets the full anonymous tool list.

### Added — OAuth login: the consent page (2026-08-05)

`GET /oauth/authorize` shows a page where a WLO editor logs in and allows a
client to act as them; `POST /oauth/authorize` verifies that login and hands the
client a one-time authorization code. Both are off (404) wherever access blocks
are off.

The order is the point: **the request is checked before anyone is shown a
password field.** An unknown client, a redirect target that was not registered,
`code_challenge_method` other than `S256`, a `response_type` we do not
implement — each is refused with a page in German and **no redirect**, because
bouncing an error to an address we did not recognise would make this server a
redirector for anyone who can write a link.

The password is encrypted in the browser exactly as on `/auth`, and the
resulting block waits in memory — as ciphertext, never opened — for
`/oauth/token` (package 4). Codes live one minute, work once, are stored under
their SHA-256, and are capped in number.

The page names the client that is asking. That name comes back from this server,
not from the query string: `client_id` is a ciphertext only the server can open,
so `GET /oauth/authorize` with `Accept: application/json` answers with the values
it recognised, and the page shows those.

### Added — OAuth discovery (2026-08-05)

The server now publishes the two OAuth metadata documents an MCP client looks
for — `/.well-known/oauth-authorization-server` and
`/.well-known/oauth-protected-resource`, each under both the plain and the
`/mcp`-suffixed path clients variously guess. They name the endpoints of the
login flow that packages 2–4 will build; today they exist so that a client
stops concluding this server has no OAuth at all. Off (404) without
`WLO_AUTH_PRIVATE_KEY` or without a resolvable public origin.

New: `WLO_PUBLIC_BASE_URL`, the address clients type in. The documents name it
as their own, so it is deliberately NOT taken from the request's `Host` header
unless `TRUST_PROXY` is set — a forged header would otherwise point somebody's
client at a login page this server does not own.

### Changed — an unusable Bearer token now answers 401 (2026-08-05)

A `Bearer` header that cannot be turned into a credential — forged, revoked, or
encrypted for a key this server does not hold — is answered with `401` and a
`WWW-Authenticate` challenge pointing at the protected-resource document, rather
than being served anonymously. That is how a client learns where to authorize,
and a revoked block now says "fetch a new one" instead of quietly returning less
than it used to.

Two things deliberately did **not** change: a request with **no** `Authorization`
still answers `200` with the full anonymous tool list, and a `Basic` header that
cannot be parsed still degrades to anonymous — a wrong WLO password is not an
invalid token of ours, and an authorization flow would answer a question the
caller did not ask.

### Added — personal access blocks (2026-08-04)

A user can now sign in with their own WLO account without handing their password
to their AI provider. On `/auth` the password is encrypted **in the browser**
with a key only this server can undo; the resulting `wlo2.…` block goes once into
the connector's `Authorization` field and can be revoked at `/auth-revoke.html` (or
`/auth/revoke` — the same page, since that is the path people guess). Off unless
`WLO_AUTH_PRIVATE_KEY` is set — the `/auth/…` endpoints then answer 404, the
pages say so, and a Bearer header is refused exactly as before. Anonymous
reading, the service account and the Basic header are untouched.

Why it is worth the machinery: today's `Basic <base64>` is the password in a thin
disguise. It is readable by whoever stores it, it works against **all** of WLO
rather than just this server, and it cannot be withdrawn short of a password
change. A block is unreadable to the AI provider, useless anywhere but here, and
revocable.

- **Hybrid encryption, not plain RSA.** RSA-2048-OAEP caps the plaintext at 190
  bytes; a long password plus the id can exceed that, and the failure would hit
  only some users and only in production. A fresh AES-256-GCM key encrypts the
  payload, RSA wraps the key. Everything — including the access id — is inside
  the authenticated payload, so an id cannot be swapped to dodge revocation.
- **The browser and the server are tested against each other.** The test imports
  the very file the page loads and hands its output to the real decoder, which
  works because `crypto.subtle` is a global in Node 20. Two implementations of
  one wire format is the seam that breaks silently otherwise.
- **Revocation needs a record, so the server now persists one thing.** An
  ALLOW-list of issued access ids (id, user name, issue time — never a
  credential) in a file on a dedicated volume; `read_only: true` still covers
  the rest of the container. Positive rather than deny: losing the file stops
  every issued block (inconvenient) instead of resurrecting every revoked one
  (unsafe). It belongs in the backup — see `docs/DEPLOYMENT.md` §3.1.
- **`/auth/issue` checks the reported authority, never `res.ok`.** Measured on
  staging: this API answers `200` with the guest authority for credentials that
  do not work, and an anonymous read of `-userhome-/children` answers `200` too.
  Trusting the status code would issue blocks for logins that fail, and the
  holder would find out days later as "the tools return nothing".
- **The one endpoint that checks a password is guarded twice** — requests per
  address and *distinct logins* per address — because it is otherwise a guessing
  oracle with this server's address as the origin. Both guards count per client
  ADDRESS, which is why `/auth*` sends **no CORS header at all**: a wildcard
  origin would let a web page spend every visitor's quota on a different guess
  and read which one worked. The pages are served from this origin and need
  none. (The MCP and REST surfaces keep theirs — their clients are not browsers.)
- **A registry entry is not forever.** Revoking a block requires holding it, so
  blocks people fetch and lose would otherwise stay valid indefinitely and the
  file would only grow. Each account keeps its ten most recent blocks, oldest
  first — per account and never global, so no one can push another's access out.
- **A failed write stays a failed write, not a broken registry.** The chain that
  serialises writes used to carry one rejection forward to every later one, so a
  full disk at the wrong moment disabled *revocation* until a restart; and the
  entry stayed in memory while missing from the file, briefly granting what was
  never recorded. Writes are now attempted again and undone on failure.
- **The `/auth` endpoints answer even when they fail.** A failing write escaped
  into a handler with no boundary there, and node:http does not await one — the
  caller got no response at all for 30 seconds. Now a generic `500`, with the
  reason in the log only.
- **Key rotation exists before it is needed.** `WLO_AUTH_PRIVATE_KEY_PREVIOUS`
  opens an overlap window; without one, changing the key would invalidate every
  user's configuration at the same moment.
- The two pages carry a **stricter CSP than the launcher** — no inline script or
  style at all, and `form-action 'none'` so a scripting failure cannot fall back
  to posting the password in clear. A test pins the policy, a second pins that
  the markup complies with it.
- Documented in both READMEs, `docs/DEPLOYMENT.md`, `docs/TOOLS.md` and
  `docs/PRIVACY.md` — the last of which no longer claims the server stores
  nothing, because it now stores this.

### Changed — module boundaries (2026-08-04)

A size-and-responsibility pass over every source file. Two findings, both the
project's recurring shape: something placed where its first caller needed it,
then reached for from everywhere else.

- **The browse tree walk moved out of the tool module.** `browse_collection_tree`
  held its bounded, cycle-guarded, budget-derived traversal inline — a 190-line
  handler in a 376-line file — although `CLAUDE.md` states that a tool module
  holds its schema and its rendering, never an algorithm, and names
  `services/collection-traversal.ts` as where such walks live. It is now
  `buildCollectionTree` there, beside the two walks split out of
  `tools/collections.ts` for the same reason. `browse.ts` drops to 274 lines and
  keeps what a tool owns: schema, subject→portal resolution, rendering.
  Behaviour-preserving — the 17 existing browse tests pin it, and the walk gained
  5 tests that assert the returned STRUCTURE instead of inferring a tree from
  rendered markdown.
- **`services/` and `rest/` no longer import from `tools/`.** `mapPool` (a
  concurrency primitive) and `buildFilterCriteria`/`formatUnresolvedHint`
  (vocabulary label→URI resolution) sat in `tools/shared.ts` because the MCP
  tools were their first callers; four services and the REST layer then imported
  them from there, pointing the dependency at the layer above. Neither has
  anything to do with MCP, so both moved to leaf modules — `src/concurrency.ts`
  and `src/filter-criteria.ts` — that any layer may use. No cycle existed yet;
  this removes the conditions for one. `tools/shared.ts` drops 300 → 171 lines.
  A third guard in `tests/shared-rule-discipline.test.ts` now fails on any
  reintroduced import, naming the file and line.

Not changed, and deliberately: the other `register*Tools` functions are long
because they carry tool schemas, German descriptions, and rendering — which is
what a tool module is for. Their algorithms already live in `services/`.

### Fixed — second full-project audit (2026-08-04)

A re-audit after the round below found five more instances of the same shape.
Two of them were live in every container.

- **An unparseable request target is answered instead of hanging the socket.**
  node:http accepts request targets the WHATWG URL parser refuses — `GET //[`
  among them. Three layers parsed the same `req.url` and only the dispatcher
  guarded its parse; its fallback handed the raw string to the REST router and
  the static router, where the throw escaped the handler (node:http never awaits
  the promise a handler returns). Reproduced over a raw socket: **no response at
  all**, the socket held until `requestTimeout` (30 s), and a generic
  `unhandledRejection` line as the only trace — from an unauthenticated request
  on a path neither rate limiter covers. The parse now lives in one leaf module
  (`src/request-url.ts`) and every layer gives the same total answer.
- **Docker deployments no longer run a timeout that was measured too short.**
  `docker-compose.yml` pinned `WLO_FETCH_TIMEOUT_MS` at `10000` while the code
  default had moved to `20000` and `.env.example` documented `20000`. Compose
  wins, so *every* container ran the value that cuts a 4.2–8.0 s create off
  mid-flight — the precise condition that makes a tool report a failure over a
  record the repository has already made. All numeric tuning defaults are now
  forwarded empty, so the number lives only where its measurement does.
  `docs/DEPLOYMENT.md` carried the stale `10000` too and now agrees.
- **The confirmation preview discloses what it leaves out.** Values were capped
  at `sanitizeText`'s 120 characters with a bare ellipsis, while the write
  surface allows 20 000 characters for a description and 100 000 for a
  compendium text. Measured: 526 characters written, 120 shown, nothing said
  about the rest — and the token binds the full value, so the person approved
  text the preview never showed them. Sharpest for `wlo_decide_suggestion`,
  where the value was written by somebody else and the preview is the only place
  it is ever seen. The budget is now 600 characters (enough for essentially every
  real description) and anything beyond it is cut at a word boundary and reported
  with its full length. The cutting rule is shared with `text-cap.ts` rather than
  copied; only the marker differs, because a newline would forge a second line in
  a line-oriented preview.
- **`.env.example` no longer activates a cross-environment setting.**
  `WLO_TEXT_EXTRACTION_URL=https://text-extraction.staging.openeduhub.net` sat
  active directly below a production `WLO_REPOSITORY_URL`, so `cp .env.example
  .env` — the copy step `docker-compose.yml` itself recommends — rebuilt exactly
  the leak that removing the code-side default was meant to end: the URLs of
  production material sent to a staging host.
- **A stale comment above the tool registration** claimed every WLO tool is
  "public, read-only OER data with no authentication", twenty lines above the
  registration of the 13 curation tools. Last remnant of the read-only drift
  corrected in the round below.
- **Three dead imports removed** (`safeHref` and `followUpButton` in the
  search-results widget renderer, the `ThemePageInfo` type in `tools/topic-pages.ts`)
  — each with exactly one occurrence, its own import line. Surfaced by running
  the type checker with `--noUnusedLocals`, which is not part of the normal gate.
- **The shared truncation rule is now actually shared.** `text-cap.ts` says in
  its own docstring that it was extracted "when a second caller needed the
  identical rule — two copies of a truncation marker drift silently". It was then
  used by **2 of 8** call sites: six modules carried their own
  `x.slice(0, CAP) + '\n[…gekürzt]'`, cutting mid-word where the shared rule cuts
  at a word boundary, and the byte-capped download path had already drifted to
  `'\n\n…[gekürzt]'` — the ellipsis on the other side of the bracket. All six go
  through `capText` now; the download path cannot (it caps bytes on a stream, not
  characters on a string) and takes the exported marker instead.
- **The identity probe parses its body through `readJson`** like every other
  upstream call. `read-json.ts` and `CLAUDE.md` both claim every client goes
  through it; `auth/identity.ts` did not, so a proxy maintenance page answering
  `200` with HTML surfaced as `identity check failed: Unexpected token <` rather
  than naming the call and its status.

### Added

- `tests/deploy-env-passthrough.test.ts` gained two guards for the class the
  compose drift belongs to: no numeric default may be restated in
  `docker-compose.yml` (mode flags whose deployment default deliberately differs
  are named with their reason), and `.env.example` may activate no setting a copy
  would silently adopt. The existing tests in that file pinned that a setting is
  *forwarded*; nothing pinned its *value*, which is why the drift was invisible.
- `tests/shared-rule-discipline.test.ts` — source-level guards for the pattern
  every audit round of this project has turned up: a rule extracted into a shared
  module, then not adopted by the modules written afterwards. Two rules so far —
  the truncation marker belongs to `text-cap.ts` alone, and an upstream body is
  parsed only through `read-json.ts`. A unit test of a helper proves the helper
  is right and says nothing about whether anyone uses it; only a source scan can.
  Sibling of `env-parsing-discipline.test.ts`, which exists for the same reason.

### Fixed — full-project audit follow-up (2026-08-04)

A whole-codebase audit across 12 dimensions found no exploitable vulnerability
and one recurring shape: a rule identified, named, solved in one place — and then
not carried to the other places it applies to. Every finding below is an instance.

- **An aborted write is no longer reported as a failure.** `isUpstreamTimeout`
  existed and was applied to exactly one of thirteen curation tools. The other
  twelve answered a timeout with "… konnte nicht … werden" — a claim about
  something we do not know, since the abort hits the response, not the work
  (measured 2026-08-02: a timed-out create had already produced the record). The
  worst case was reproducible: a **successful** `DELETE` whose read-back timed
  out reported `Der Datensatz konnte nicht gelöscht werden`, which is exactly the
  sentence that stops a curator from checking whether their material is gone.
  A shared `timeoutOrError` in `tools/curation-shared.ts` now separates "the
  repository refused" from "we stopped listening" at every mutation, and
  `confirmDeleted` turns a thrown read-back into the `unverified` outcome its own
  type already had.
- **Confirmation previews no longer truncate mid-sentence.** `renderChangeSet`
  passed the whole assembled action line through `sanitizeText`, whose 120-char
  cap is meant for a single foreign value. The fixed German prose plus a 36-char
  nodeId plus a title exceeded it routinely: a submit preview ended at `… zur…`,
  and a *decline* preview — which has no field changes and is therefore only that
  line — lost both the nodeId and the clause saying the record stays untouched.
  `sanitizeText` is now `flattenText` plus the cap, and the renderer uses
  `flattenText`. The same trap had already been identified and avoided in
  `fields.ts`; this is it reintroduced one module over.
- **`wlo_submit_content` binds its editorial note to the confirmation token.**
  The note travelled to the editorial queue under the submitter's name while
  appearing in neither the preview nor the token's fingerprint — so an approval
  for "submit this record" carried whatever text arrived with the confirming
  call. It is now part of the previewed action, and both it and
  `versionComment` are length-bounded (`max(1000)`) like every other free text
  that reaches the repository.
- **Five environment variables stopped silently mis-parsing.** `resolvePositiveInt`
  was written because `WLO_FETCH_TIMEOUT_MS=20s` resolved to a 20 ms timeout;
  `MAX_BODY_BYTES`, `RATE_LIMIT_RPM`, `API_RATE_LIMIT_RPM`,
  `AUTH_CREDENTIAL_LIMIT` and `WLO_POOL_SIZE` still used raw `parseInt`, so
  `MAX_BODY_BYTES=1MB` became a one-byte cap that answered every request with
  `413`, with nothing in the log pointing at the cause. All five now go through
  the shared parser; the rate limits use a new `resolveNonNegativeInt`, because
  `0` is documented there and means "disabled".
- **`rest/routes.ts` dispatches on the parsed path**, matching `http-app.ts`.
  Matching the raw request target made the two disagree for a request-target in
  absolute form, which HTTP/1.1 permits.

### Documentation — three published documents said "read-only" (2026-08-04)

Write support shipped in 2026-08; three documents that state publicly what this
server does still described a read-only, unauthenticated proxy.

- **`docs/PRIVACY.md` rewritten.** It claimed "no authentication", "the server
  never writes", "no write/mutation tools exist" and — of credentials — "it has
  none", for a server that accepts an `Authorization` header, forwards it to the
  repository, and registers thirteen write tools. It also omitted the
  text-extraction service as a third-party recipient and the 10-minute hashed
  credential digest the abuse guard keeps, and described the *first*
  `X-Forwarded-For` hop where the code takes the rightmost. The policy now covers
  the credential chain, what curation writes and where that data then lives, all
  four recipients, and an operator checklist that starts with "say which mode
  this deployment runs in".
- **`docs/apps-sdk-submission-checklist.md`**: the row a reviewer reads said
  "no write tools ✅". Replaced with the argument that is both true and stronger
  — write tools exist, are unregistered without an identity, refuse again at call
  time, are two-step confirmed and are read back.
- **`public/llms.txt`** — which is *served* at `/llms.txt` — advertised "22
  read-only tools" long after there were 25. The count is gone rather than
  corrected; `tools/list` is authoritative and a hand-maintained number in a
  served file will drift again.
- **`tests/docs-claims.test.ts`** now pins all three to the source: it derives
  the curation tool names from `src/tools/` and fails if the documents claim
  otherwise. Nothing connected code and prose before, which is why the drift
  survived four sessions.
- README (EN + DE), `CLAUDE.md` and `docs/DEPLOYMENT.md` updated in step: the
  open-outcome rule, the number-format rule for env variables, a rollback
  procedure with the two things that do *not* roll back with the image
  (configuration, and anything curation wrote), the `/health` deploy fingerprint,
  and the widget count in the verification step (three → four).

### Added

- `npm run test:coverage` — the same suite with the runner's coverage report.
  Opt-in, so `npm test` stays short.

### Verified — MCP Inspector re-run and the golden prompts' mechanics pass (2026-08-03)

- **Official MCP Inspector CLI, against the running HTTP server:** `tools/list`
  returned 25 tools and a scripted check over title, description, `readOnlyHint`,
  `destructiveHint`, both `openai/toolInvocation/*` strings, `securitySchemes`
  and `inputSchema` found **0 objections**. `resources/list` returned the 4
  widgets with `text/html;profile=mcp-app`, and a `tools/call` over the same
  connection returned real results (315 hits for "Photosynthese"). This closes
  the gap left by the previous run, which was clean at 22/22 on 2026-07-17 and
  predated four tools.
- **Golden prompts, mechanics half:** 17 of 17 runnable prompts delivered live
  against the staging repository (D10 needs `WLO_SKILLS_COLLECTION_ID`). Two
  first-attempt failures were the probe's own fault — `get_topic_page_content`
  takes `query`, not `topic`, and `browse_collection_tree` takes `depth` and
  answers in `results` — which is itself worth recording: a golden-prompt run
  should check parameter names against `tools/list` before filing a tool as
  broken. Tool *selection*, the negative prompts and the widget render still
  need a live ChatGPT session.
- **Deployment posture recorded:** the server runs on the `nip.io` address for
  now and is not being submitted to the GPT store, so `WLO_WIDGET_DOMAIN` stays
  unset — which is what every non-ChatGPT host requires anyway. Verified that no
  public origin is hardcoded anywhere in `src/` or `public/`, so the later switch
  to a real domain is a redeploy with changed env variables. The checklist now
  separates "ready now" from "deliberately deferred" instead of leaving both as
  bare open boxes.

### Documentation — every tool named, counts corrected (2026-08-03)

- **`docs/TOOLS.md` documented 24 tools; there are 39.** It listed neither the
  13 curation tools nor `get_node_collections` and `get_url_text`. It now opens
  with what a session actually sees (25 anonymous · 26 with a skills collection ·
  +13 with write rights · minus `get_url_text` where the operator disabled it)
  and carries a curation section with chat triggers and the three rules that
  bind every write: two-step confirmation, read-back, and irreversible deletion.
- **A rendering defect in the same file:** four rows of the browse table sat
  *after* a blockquote, so they had no header above them and rendered as literal
  pipe characters rather than as table rows.
- **Stale counts corrected** in `README.md` ("25 read tools"), `README.de.md`
  ("24 MCP-Tools"), the project tree in both ("registers all 23 tools") and the
  Apps-SDK submission checklist. The checklist's *historical* measurement — the
  Inspector run that was clean at 22/22 on 2026-07-17 — is left as it was; only
  the claims about today were changed, and `get_url_text` was added as the
  second tool carrying `openWorldHint`.
- Both READMEs gained per-tool detail entries for `get_node_collections` and
  `wlo_auth_status`, which had table rows but no description.

### Added — `get_url_text` and a generic unsafe-tool switch (2026-08-03)

- **`get_url_text`** reads the text behind an arbitrary web URL through the
  extraction service — for a URL named in the conversation rather than a WLO
  record. WLO material keeps its own path: `get_wlo_content_text` reads the
  repository directly and is both faster and more reliable. "No text" is a
  normal outcome with a `reason`, not an error; the service renders with
  Playwright and has known gaps (protected pages, bot detection, media files),
  so the description names `method: "simple"` as the one sensible retry.
- **A tool can declare itself unsafe.** `WloToolDef.unsafe = { reason }`, and
  the single registration seam skips it when the operator sets
  `WLO_DISABLE_UNSAFE_TOOLS` (names, or `all`). Unsafe tools are registered by
  default and each logs a startup **warning** naming itself and the reason — a
  default-on risk documented only in a changelog is one nobody inheriting a
  deployment will read. `.env.example` and `docker-compose.yml` ship `all`, so a
  real deployment starts without them. Ordinary tools are untouched by the
  switch; that is asserted, because a security knob that empties the server is
  an outage, not a mitigation.
- **`get_url_text` is documented as not-for-production.** Before anything is
  requested it refuses a literal private host, a public name whose DNS record
  resolves into a private range, and a name it cannot resolve at all. What it
  cannot check is the decisive part: we never fetch the target — Playwright
  inside the extraction service does — so a redirect into an internal address,
  or a DNS answer that changes between our lookup and the service's, is
  invisible here. That needs enforcement inside the fetching service.

### Fixed — IPv4-mapped IPv6 addresses passed the private-network check (2026-08-03)

- **`http://[::ffff:127.0.0.1]/` was not recognised as loopback.** `new URL()`
  rewrites that host to `[::ffff:7f00:1]`, so the dotted quad is gone before any
  check runs and the IPv6 branch had no idea that `7f00:1` is 127.0.0.1.
  Measured, not theorised. This was **live on the existing `ccm:wwwurl` path**:
  anyone able to set that field — including through this server's own write
  tools — could have pointed the extraction service at its own loopback.
  `isPrivateHost` now unwraps the mapped address in both spellings (`::ffff:10.0.0.1`
  as DNS returns it, `::ffff:a00:1` as `new URL()` produces it) and judges the
  IPv4 inside; a mapped PUBLIC address such as `::ffff:808:808` stays public.
- The rule moved into its own module (`src/url-safety.ts`) with tests. It had
  none: it was a private function reached only through a tool that degrades to
  `null` on refusal, so a hole in it looked exactly like a service switched off.
- Correction to an earlier assumption recorded in the plan: decimal and hex IPv4
  literals (`http://2130706433/`) were never a hole — `new URL()` normalises them
  to `127.0.0.1` first — and a DNS check would not have caught them either
  (`dns.lookup('2130706433')` answers `ENOTFOUND`).

### Fixed — Supporting layer: test honesty, deployment config, docs (R12, 2026-08-03)

- **Eleven documented settings never reached the container.** `docker compose`
  auto-loads a neighbouring `.env`, but only for `${…}` *interpolation* — a
  variable the compose file never names is not passed to the service. Measured
  with `docker compose --env-file … config`: with `WLO_SKILLS_COLLECTION_ID`,
  `WLO_ALLOW_SERVICE_WRITES` and `WLO_TEXT_EXTRACTION_URL` all set, the rendered
  service environment contained none of them. These are not tuning knobs — they
  decide which tools *exist*: `WLO_ALLOW_SERVICE_WRITES` gates all 13 curation
  tools, `WLO_SKILLS_COLLECTION_ID` registers `find_wlo_skills`, `WLO_INBOX_ID`
  is required before the service account can create anything. An operator set
  them, restarted, and the capability was still missing with nothing logged.
  All eleven are now forwarded (`PORT` deliberately is not — the port mapping
  hardcodes the container side, so overriding it would leave the server
  listening where nothing is published), and
  `tests/deploy-env-passthrough.test.ts` pins `.env.example` and
  `docker-compose.yml` to each other so the next new setting cannot drift.
- **Two validation tests passed over a deleted constraint.** Both named
  themselves "(no network)" and wrapped the call in a `try/catch` that accepted
  *any* failure as the rejection they were looking for. Measured: with the
  `excludeNodeIds` cap removed from the schema, the handler ran, its upstream
  call failed because the network was unreachable, the catch read that as the
  rejection — 11/11 green over a removed input-validation cap. Rejection before
  any upstream request is now asserted (`assertRejectsWithoutUpstream`), which
  fails with "4 !== 0" instead of passing.
- **The offline guarantee is now enforced instead of promised.** README and
  CONTRIBUTING state "no network required" in six places and nothing checked it.
  `npm test` loads `tests/netguard.mjs`, which fails any fetch to a non-loopback
  host that no `installFetchMock` intercepted; loopback stays allowed because the
  transport and REST tests boot a real local server. Verified twice: the full
  suite is genuinely offline (1021/1021 with every external host blocked), and a
  probe test fetching `example.com` fails with the guard's message.
- **`CLAUDE.md` documented a test command that runs nothing on the shipped
  runtime.** It gave `node --import tsx --test "tests/*.test.ts"`; Node 20 —
  what `engines` and the Docker image declare — takes that glob literally, which
  is exactly why `scripts/run-tests.mjs` exists.
- **`package.json` declared no license** although the repository ships
  Apache-2.0, and was not marked `private`, so a stray `npm publish` would have
  attempted to publish an internal server package. Both added.
- **The project tree in both READMEs omitted `scripts/`** — the directory
  `npm test` depends on — and `docs/TOOLS.md`.

### Fixed — Matching and ranking, measured live (carry-overs from R4/R7, 2026-08-03)

- **A German article in the query no longer makes the local matcher accept
  everything.** `nodeMatchesText` split the query on whitespace with no stopword
  filter and matched any word as a substring — and German stopwords sit inside
  ordinary words ("Stu-die-n", "Me-die-n"). Measured over a 60-node pool from a
  real search: `"Bruchrechnung"` correctly matched 0 nodes, `"die
  Bruchrechnung"` matched 43 (72%), `"der Wald"` 48, `"IT"` 47. The filter was a
  no-op for any query phrased the way a person speaks. It now drops stopwords
  and single characters, and a query of nothing but stopwords matches nothing
  rather than everything.
- **A short query term must match at a word start.** A substring test is right
  for German — "Rechnung" belongs inside "Bruchrechnung" — but for a two- or
  three-letter term it is mostly accident: the query "IT" put "s-it-ting",
  "Maur-it-ius", "Pol-it-ik" and "C-it-izenship" in the top five of a live
  search. Compounds and inflections carry the term at a word start while the
  accidental matches bury it mid-word, so short terms now require that boundary.
  "EU" still matches "Europäische" and "Bio" still matches "Biologie".
- **The relevance scorer's phrase bonus follows the same rule.** It awards +30,
  its largest single bonus, for `title.includes(query)` — which for a one-word
  query is exactly the substring test the term branch had already given up, and
  it outweighed that branch four to one. Multi-word phrases are unaffected.
- **The three copies of "which query words count" are now one function.** Scoring,
  the quality floor and the local matcher each had their own; the copy in the
  scorer decided the order a user sees.
- **`get_compendium_text` no longer fetches every property to read two.**
  Measured read-only against the editorial repository: a `propertyFilter`
  returns each field it names byte-identical to the `-all-` read, including a
  4914-character description — the filter bounds which properties come back,
  never their content. Responses shrink ~43%.

### Fixed — Transport, REST & entry points (review R11, 2026-08-03)

- **The CORS policy no longer invites a browser to relay credentials.** The MCP
  endpoint forwards a caller's `Authorization` header to the WLO repository,
  which is why it caps how many *distinct* logins one client may present. That
  cap keys on the client address — and advertising `Authorization` as a
  cross-origin-allowed header was the way around it: a web page could spend
  every visitor's address on a different guess and read the outcome, since a
  write-capable login yields a longer tool list. CORS restrains browsers and
  nothing else, and no browser is a client of this endpoint, so the header is
  simply no longer offered.
- **The dispatch matches on the path, not on the raw request target.**
  `req.url` carries the query string, so `POST /mcp?v=1` answered "Not found.
  Use POST /mcp" and `GET /health?t=1` 404'd — while the REST router and the
  static layer had normalized correctly all along.
- **Both public HTML surfaces declare a Content-Security-Policy.** The search
  view (`?format=html`) and the prompt launcher embed repository-supplied text;
  escaping was the only control. The search view denies everything but inline
  style; the launcher additionally permits its own inline script and a
  same-origin fetch. Neither may be framed.
- **The HTML search view is readable in a dark-mode browser.** It hardcodes a
  light palette but declared no background, so the browser painted its own dark
  canvas under near-black text — measured at roughly 1.1:1, i.e. unreadable. It
  now states its background and `color-scheme: light`, giving ~16:1.

### Fixed — Apps-SDK & widgets (review R10, 2026-08-03)

- **A material title can no longer forge an entry in the multi-select
  hand-off.** "Use selected" injects a message *as the user* listing one
  material per line as `- „title" (nodeId: x)`, and the title — which comes from
  spidered external sources — went in raw. A line break in one forged a second
  entry naming an id the teacher never picked, which the model would then act
  on. The single-tile buttons have sanitized their title since 2026-07-28; this
  path built its own message and did not. HTML escaping does not help here: the
  delimiter of a prompt list is the newline, not `<`.
- **The detail view states the licence even when the record has none.** The
  tile always shows the row, deliberately — teachers must be able to tell "free
  to reuse" from "no licence stated". The Einzelansicht omitted it, and that is
  the view where the reuse decision is actually made.
- **Inlined widget JS and CSS are escaped against their own closing tag.** The
  build writes the bundle into `<script>…</script>`; an HTML parser ends a
  raw-text element at the first `</script`, whatever the JavaScript grammar
  says, and esbuild does not escape it because it cannot know the output is
  being inlined. One string literal would have truncated the bundle and spilled
  the rest into the document as markup.
- **A tree node's `aria-controls` no longer depends on the node id being
  id-safe.** `aria-controls` is a space-separated id list, so a node id carrying
  whitespace pointed the disclosure button at two elements that do not exist.

### Fixed — Curation tools (review R9, 2026-08-03)

- **`wlo_remove_from_collection` never worked.** Filing material into a
  collection creates a *reference* node with its own id, and the two directions
  of the repository API do not take the same one: the `PUT` that files material
  takes the original node id, while the `DELETE` that removes it requires the
  reference id. Measured against staging, the delete with the original id
  answers `200` and removes nothing — the reference was still readable
  afterwards. The tool now resolves the reference from the collection listing
  first, accepts either id from the caller, and says plainly when the material
  is not in the collection at all instead of reporting a removal that did not
  happen.
- **The removal is confirmed on the reference node, not through `/usage/v1`.**
  That endpoint answers `500` for exactly the state this check exists to
  observe: a material whose reference was just deleted keeps a usage row
  pointing at the node it can no longer resolve. Every successful removal would
  have been reported as unverified.
- **Removing a compendium text now reads the record back.** Writing one already
  did; removing one reported success from the status code alone.
- **A confirmation token now binds the whole change, not part of it.** Three
  fields sat outside the change set and were therefore not covered by the
  fingerprint: a collection's `description` on create and rename, and
  `commit`/`versionComment` on `wlo_update_content`. A token approved for one
  description authorised writing a different one; an approved metadata edit
  could silently cut a new version.
- **`cm:title` and `cm:description` are named in the writable-field list.** Both
  were already written by the collection tools; the list understated the write
  surface it exists to declare.
- **Repository-supplied values are sanitized before they are interpolated into
  a confirmation preview or a rejection message** — field names, offered
  vocabulary values, suggestion ids and statuses. These messages carry elevated
  authority: they are what a curator approves.
- **A collection title longer than 255 characters is refused before anything is
  sent.** Every other written field passes the length check; this one reached
  the repository unchecked.

### Fixed — Detail & auxiliary tools (review R8, 2026-08-03)

- **Repository text can no longer forge a detail record.** `get_node_details`
  rebuilt `renderToText`'s line format by hand — `## title`, `nodeId:`,
  `Lizenz:` — but without its `oneLine` protection, so a newline in a title
  opened a second, fabricated record with its own nodeId and its own licence
  line. The same gap is closed in `get_related_content`, `get_node_collections`,
  `get_node_breadcrumb`, `find_wlo_skills`, `get_wlo_content_text`,
  `get_collection_stats`, `lookup_wlo_publishers` and `get_compendium_text`.
  Decided per site, not swept: prose bodies (the stored full text, a compendium
  text, a skill's instruction Markdown) keep their line breaks — they are
  documents, not fields.
- **`get_wlo_content_text` states a provenance that cannot be forged.** A
  newline in the title used to fabricate a second `Quelle:` line, i.e. claim
  repository origin for text taken from a linked page — the one line a teacher
  reads to attribute the material.
- **A record that is merely not public is no longer reported as non-existent.**
  `getNodeMetadata` returns `null` for every non-OK status, so `get_node_details`,
  the knowledge-convention `fetch` and `get_node_collections` all answered "Node
  X nicht gefunden" for a 401/403 (not public — measured: such a node refuses
  its metadata too) and for a 503. New `readNodeMetadata` carries the status;
  the three answers are now kept apart.
- **`get_node_breadcrumb` no longer invents a cause.** A failed `/parents` read
  was reported as "probably a file node or the root". New `readNodeBreadcrumb`
  reports the failed read as one.
- **`get_node_details` no longer claims a full text is absent after a failed
  read**, and its JSON output carries `textContentError` alongside the empty
  string, mirroring `parentsError`.
- **Two unbounded values in the detail record are capped** to the same limits
  `renderToText` applies: the compendium text (500 chars) and the description
  (400). A call asking for title and licence used to return an entire editorial
  essay inline.
- **`get_nodes_details` bounds its full-text fan-out** to the first 20 nodes.
  Concurrency alone does not bound wall-clock: 50 slow reads at pool width 10
  could outlast the server's own 30 s request timeout, and the caller lost the
  connection instead of receiving the metadata it also asked for. Skipped ids
  are named in `textContentSkipped` — never silently dropped.

### Fixed — Wikipedia returned the wrong article (2026-08-02)

- **A search-resolved Wikipedia hit is now checked for relevance, and the
  candidate the query is about is chosen instead of the first one.** Measured
  before: `Stadt Berlin` answered with `Bern`, `Dreiecke` with `Dreiecker` — a
  mountain in the Allgäu. That is not cosmetic: a caller turning the extract
  into teaching material appends "Quelle: Wikipedia-Artikel „…"", so a wrong
  article publishes a false attribution.
  The check sits on the **candidates**, not on the finished summary, because
  every wrong article measured came from the opensearch fallback and never from
  the direct lookup — a direct hit is the exact title or a curated **redirect**
  (`Bruchrechnen` → `Bruchrechnung`), which is an editorial statement that both
  names mean the same topic and is trusted as such.
  The candidate list also grew from 1 to 10, which turns a rejection into a
  correct answer: for `Dreiecke` the right article was the fifth result.
  Live-verified against de.wikipedia.org, 10/10 cases as expected.
- **`WikiSummary` carries `match`** (`exact` | `fuzzy`) on the MCP tool, on
  `GET /api/wikipedia` and in the Apps-SDK output schema, so a consumer that
  attributes the text can tell whether the article is the one the user named.
  The Markdown output states the substitution for a fuzzy hit.
- **A generic classifier noun no longer outvotes the proper name.** The topic is
  taken from the longest content word, so `Insel Rab` answered `Insel (Album)` (a
  music album), `Element Zinn` answered `Élément moral` (a French legal concept)
  and `Fluss Po` answered `Fluss-Greiskraut` (a plant) — the classifier matched
  and the name was never weighed. Found by a live probe, not by review. Among
  accepted candidates, one that accounts for more of the query now wins over one
  that accounts for less (`Satz des Pythagoras` over `Pythagoras`).
- **A short topic word no longer empties the query.** `Stadt Rom` reduced to
  nothing at all — "stadt" is a stop word and "rom" fell under the length floor —
  so the search never ran. The floor is now a preference: when nothing longer
  survives, the short words are used, and they can still only match a whole word.
- **No candidate on topic now means "no article", not the closest string.** The
  rejected candidates are logged so a miss can be diagnosed.
- The substitution notice is shared by `get_wikipedia_summary` and
  `search_wlo_all` instead of living on one of them — it had been written on the
  less-used surface and forgotten on the documented default entry point.
  Rationale, measurement and the deliberate deviations from the proposal are in
  [`docs/plans/2026-08-02-wikipedia-relevance.md`](docs/plans/2026-08-02-wikipedia-relevance.md).

### Removed — the Vercel serverless path (2026-08-02)

- **`api/mcp.ts`, `vercel.json` and `tests/api-mcp.test.ts` are gone.** The
  serverless entry point had been retained but not operated for months, which
  meant every change to the credential chain, the tool registration or the
  transport had to be made twice and reasoned about twice — the R6 review found
  it drifted exactly there. Vercel is no longer a deployment target, so the
  second copy is now a liability rather than an option.
  **Nothing was lost with the tests:** each of the six properties they pinned
  (health payload, 405 on a wrong method, the `Accept` patch, the relay-abuse
  guard, an unusable `Authorization` header not borrowing the service account,
  and per-user credential propagation) has a twin against the self-hosted path
  in `tests/http-app.test.ts` and `tests/auth-per-user.test.ts`.
  Earlier entries in this same Unreleased section that describe `api/mcp.ts` are
  superseded by this one; they are kept as the record of what was done.
  The type gate (`tsconfig.typecheck.json`) and CI still cover `tests/` and the
  widget entry points — only `api/**/*` left its `include`.
  **Serverless constraints no longer apply anywhere in this codebase.** The
  server is a long-lived process: in-memory rate limiting, per-process caching
  and startup work are all sound, and the README/PERFORMANCE caveats about cold
  starts are gone rather than merely qualified.

### Fixed — R7 review: search & discovery tools (2026-08-02)

- **`search_wlo_within_collection` no longer corrupts its own JSON.** With
  `outputFormat:"json"`, the sampling note ("searched the first 100 of 214") and
  the sub-collection hint were appended to the JSON string, so `JSON.parse`
  threw for every client that read the text block. Both now ride as their own
  content blocks, the way the unresolved-filter hint already did.
- **Repository text can no longer forge a tool's own record delimiters.**
  `renderToText` has collapsed newlines in repository values since the licence
  fix; four tools rendered their own line-oriented text and did not. A
  collection title containing a newline could add a branch to the collection
  tree, a Fachportal to the portal list, an entry to the Themenseiten listing,
  or a section to a swimlane outline — each with a `nodeId` of its choosing,
  which is what the next tool call acts on. `oneLine` is now exported from
  `formatter.ts` and applied in `browse.ts`, `topic-pages-present.ts` and
  `topic-page-content.ts`. A Wikipedia extract in `search_wlo_all` is rendered
  as a blockquote instead: prose may wrap, but no line inside it can open one of
  the answer's own `#` sections.
- **An unreadable collection listing is no longer reported as an empty one.**
  `getChildCollections` degrades to `[]` on any non-OK status, so a 503 reached
  the user as "no collections found — try a broader term", as `WLO Fachportale:
  0`, or as `Sub-Sammlungen: 0` per portal. The new `getChildCollectionsResult`
  reports whether the listing was readable; the four places that turn emptiness
  into a claim now fail loudly or omit the count instead of asserting a fact
  about the catalogue that is really a fact about the server.
- **A facet query can no longer take down the process.** `searchFacets` was
  started before the main search and awaited after it, so a throw from the main
  search left it unawaited — an unhandled rejection ends the Node process. The
  `.catch` now sits at the call site, where the floating promise is created,
  rather than relying on an invariant held in another module.
- A collection that is both a top-level entry and a sibling's child is no longer
  emitted twice in `browse_collection_tree`. The duplicate only appeared past the
  eleventh top-level node: the ids were claimed inside each worker, whose
  synchronous prefix covered exactly the first pool-width of them. The two
  argument-error paths now log like every other failure, and the stale Vercel
  reference in the `mapPool` rationale is gone.

### Fixed — R6 review: auth & credentials (2026-08-02)

- **An `Authorization` header the server cannot use no longer borrows the shared
  service account.** A refused scheme (Bearer, Digest) or a malformed Basic
  payload was indistinguishable from sending no header at all, so the caller
  quietly acted under the service identity — with rights they never asked for
  and, with `WLO_ALLOW_SERVICE_WRITES` set, the ability to write changes
  attributable to nobody. Such a request is now served anonymously, on both HTTP
  entry points, with a warning in the log. Sending no header still resolves to
  the service account; that fallback is the intended one.
- **A Basic header with an empty password is refused.** `resolveServiceCredential`
  already rejected a half-filled login for a documented reason; the header path
  accepted it, which produced `mode: "user"`, registered the curation tools and
  then failed every upstream call with 401.
- **The cleartext-transport warning no longer depends on a service account being
  configured.** It sat behind that early return, so the deployment where every
  individual user's own password travels in the clear — per-user mode, which
  needs no service account — was the one that never heard about it. The warning
  now fires for the transport itself at boot; loopback stays exempt.
- **The Vercel entry point guards forwarded credentials.** It relayed a
  client-supplied `Authorization` header upstream with no cap on distinct
  logins, the relay-abuse vector the self-hosted handler has guarded since it
  started forwarding headers. On serverless the in-memory guard is per-instance
  and resets on a cold start, so a platform rate rule is still required — but a
  weakened guard beats none. (Entry point retained, not deployed.)

### Fixed — R5 review: write pipeline (2026-08-02)

- **Six mutations reported success from the HTTP status alone; every one of them
  now reads the record back.** Creating and renaming a collection, filing and
  removing a reference, deleting a record and deleting a collection all answered
  "done" on `res.ok`, although the write pipeline's own rule is that a `200` from
  edu-sharing is not evidence — the collection endpoint is measured to discard
  `cm:description` while answering one, and the mechanism that discards a write
  when the caller lacks the right is not endpoint-specific. This is the gap that
  was found in production for `wlo_submit_content`. Create/rename compare
  `cm:title` (and the description) on a read-back; the reference tools ask the
  usage endpoint, which resolves a reference id to its original first; both
  deletions require the record to be unreadable (`404`), not merely a `200` from
  the DELETE. The three answers stay apart — `failed` (nothing happened),
  `not_visible` (accepted, not in the record), `unverified` (we could not find
  out) — because each permits a different sentence.
- **A commit that falls back to field-by-field no longer versions each field.**
  `POST …/metadata` creates a version every time, and the retry ran with the
  caller's options, so one rejected value out of five left four history entries
  carrying the same comment. The retry now drafts and a single commit covers
  whatever landed.
- **Upstream error bodies are sanitized before they reach the model.**
  `failureDetail` embedded up to 200 raw characters of an edu-sharing response in
  six user-facing replies; a newline in a stack trace ended our sentence and
  opened a line that read like one of ours.
- **Author names are escaped for vCard.** `toVcard` interpolated the name into
  `N:` and `FN:` unescaped, so a pasted line break ("Maria Schmidt⏎Universität
  Musterstadt") produced a card a strict parser drops whole — the author vanishes
  from the record rather than being slightly wrong. A `;` shifted every following
  `N:` component.
- **Write values are bounded in number as well as in length.** No property capped
  its value count, and only four of fourteen capped the length of a value; the
  real bound was the HTTP body cap, which the stdio path does not have.

### Fixed — R4 review: read services (2026-08-02)

- **The recursive collection walk is bounded by the collections it reads, not
  only by the rows it collects.** `collectRecursiveContents` stopped at
  `maxResults` rows — but rows are counted only when they are new, so a curated
  subtree whose sub-collections share their references de-duplicates itself into
  a standstill and the queue kept draining. Two sequential upstream calls per
  collection, continuing after the client's 30 s request timeout had already
  closed the socket. A visit cap (50 collections) now ends the walk, with a
  warning in the log; `totalHits` remains the "there is more below" signal. The
  module's own header had claimed both walks capped their fan-out; only the
  keyword-fallback walk did.
- **A refused parent lookup on a collection is no longer reported as "in no
  collection".** `getNodeParents` degrades to `[]` on any non-OK response, so a
  403 and a genuine root collection arrived identical, and
  `get_wlo_node_details` printed "Keine Eltern-Sammlungen gefunden." for a
  collection that is filed somewhere — the same confident falsehood
  `getParentCollections` was written to prevent on its material branch. New
  `readNodeParents` reports whether the repository answered (the split
  `getNodeTextContent` / `readNodeTextContent` already uses); the collection
  branch now returns `unknown` on a failed or unparseable read. `getNodeParents`
  keeps its graceful contract for breadcrumbs, where a missing crumb is cosmetic.
- **A failing keyword search no longer discards the topic-page portals.** In
  `findTopicPagesByQuery` the portal leg was guarded and its supplementary
  sibling was not, although only the portals carry `ccm:page_config_ref` — a
  timeout on the supplement failed the whole call. Same guard `searchAll`
  already carries.
- **The topic-page widget fan-out is capped per lane.** `MAX_LANES` bounded the
  swimlanes but not the widgets inside one: the grid is parsed unbounded and
  each widget node costs its own metadata request (measured in the new test:
  1200 requests for a 12×100 page). Only the first content-bearing widget of a
  lane is ever used, so at most four per lane are read.
- Doc fix: `enrichCompendium` described its gap-fill as "one bulk `-all-` fetch";
  `getNodesMetadata` is a pooled fan-out of one request per id — edu-sharing has
  no bulk metadata endpoint.

### Fixed — R3 review: vocabularies & presentation (2026-08-02)

- **A repository-supplied field can no longer forge a record in the Markdown
  output.** `renderToText` writes a line-oriented format (`## title`,
  `Key: value`) in which every value comes from the repository — titles,
  descriptions, publisher names, `_DISPLAYNAME` labels, URLs. A newline in any of
  them opened a second, fabricated record carrying its own `nodeId` and its own
  `Lizenz:` line; a forged "CC BY 4.0" over material that has no licence is
  exactly the claim a teacher acts on. Values are now flattened to one line each
  where the format needs one line. The text itself is unchanged — this is the
  renderer protecting its delimiters, not sanitizing (`text-sanitize.ts` remains
  the elevated-authority boundary), and JSON output keeps the line breaks.
- **`elementary school` now resolves to Grundschule, not Elementarbereich.** The
  alias sat on both entries and the first-wins exact match handed the English
  term for primary school to the pre-school concept — a wrong filter with no
  "did you mean" hint, because a non-null result reads as "resolved". A test now
  asserts that no label or alias is shared by two concepts of one vocabulary.
- **`resolveVocab` requires a real scheme before treating input as a URI.**
  `startsWith('http')` accepted any word beginning with those four letters and
  passed the typo on as a filter value: a guaranteed empty result, and the fuzzy
  suggestion suppressed along with it.
- **The eight aggregated learning-resource-type concepts missing from the local
  table were added** (48 in total). The repository derives them from `new_lrt`,
  so they appear as facet values — and facet values carry no server-side
  `_DISPLAYNAME`, so they rendered as bare UUID URIs. Labels are the official
  prefLabels from the published vocabulary, read once from the index rather than
  inferred from the child concepts.
- **Typo tolerance restored for university subjects spelled with "ß".** The word
  splitter used a Latin-1 range that excludes U+00DF, so "Gießereiwesen" was
  tokenised as "Gie"/"ereiwesen"; it now splits on Unicode letter classes.

### Fixed — remaining `res.json()` sites in the service and write layers (2026-08-02)

- The five call sites R2 deliberately left alone now go through `readJson` too,
  each keeping its own contract rather than inheriting one. `listSuggestions`
  and the collection-usage lookup **throw**, because both document that an empty
  array is the positive claim "there is nothing here" — a claim that must never
  cover "we could not look". The two create paths (`createCollection`,
  `createContentNode`) take the route their missing-id branch already took: the
  POST was accepted, so a record may exist, and reporting a plain failure would
  invite a retry — which with `renameIfExists` produces a *second* record rather
  than a no-op. Their message now says to look in the repository before
  repeating the operation. `auth/identity.ts` was checked and left unchanged:
  its parse is already inside the `try` that carries its "never throws" contract.

### Changed — modularization (2026-08-02)

Three files past the 300-line threshold were split along the seam where two
responsibilities had accumulated, not at the line count. All moves are
behaviour-preserving; the suite is the guard.

- `src/services/collection-traversal.ts` (new) — the DAG walks
  (`findCollectionsByTreeTraversal`, `collectRecursiveContents`) out of
  `tools/collections.ts` (461 → 338). Bounded fan-out over the collection graph
  changes with the repository's data; the tool schema changes with its contract.
- `src/services/topic-page-discovery.ts` (new) — the three-mode Themenseiten
  discovery out of `tools/topic-pages.ts` (311 → 174), same seam.
- `src/wlo-node-text.ts` (new) — `/textContent` and the anonymous file download
  out of `wlo-node.ts` (333 → 228). Reading a node's TEXT carries its own
  timeout budget, byte cap and UTF-8 handling; reading its metadata carries
  none of that. Re-exported through the `wlo-api` barrel, so no caller changed.

### Fixed — review package R2, upstream API clients (2026-08-02)

- **An upstream 200 that is not JSON no longer decides the failure mode.**
  `res.ok` says the server answered; it does not say the body is JSON. A reverse
  proxy's maintenance page, a captive portal and an empty body all arrive as
  HTTP 200 with something `res.json()` throws on — and every client function
  parsed unguarded, so the parse error escaped past functions that document
  themselves as degrading to `[]`/`null`. The worst case was
  `fetchWikipediaSummary`, whose whole contract is "returns null when no article
  matches": its `try` covered the network call but not the parse, so a Wikimedia
  CDN interstitial turned an optional enrichment into **HTTP 500 from
  `/api/wikipedia`** instead of a 404. That it bites was already visible in the
  code — `services/search.ts` wraps the call in `.catch(() => null)`, a
  workaround only needed because the function broke its own promise. A new
  `src/read-json.ts` leaf now parses once for all three clients: callers that
  degrade get `null` and log which call failed; callers that throw by contract
  (`ngsearch`, `getCollectionContents`) throw a named error instead of
  `Unexpected token <`.
- **A truncated download no longer ends in a broken character, and its cap is
  measured in bytes.** `getNodeDownloadText`'s no-body fallback compared
  `text.length` (UTF-16 units) against a byte limit, so German text could run to
  roughly three times the intended size; the streaming path cut at an arbitrary
  byte offset, which lands inside a multi-byte sequence and left a U+FFFD before
  the truncation marker.

### Security — review package R2 (2026-08-02)

- **A material URL pointing into a private network is no longer forwarded to the
  text-extraction service.** The URL comes from a repository record's
  `ccm:wwwurl` — content any curator can set, including through this server's own
  write tools — and the only check was that it began with `http`. The service
  fetches whatever it is given, so `http://169.254.169.254/…` or an RFC-1918
  address turned it into a probe of whatever network it sits in; self-hosted
  next to this server, that network is the operator's. Loopback, link-local,
  RFC-1918 and IPv6 unique-local/link-local hosts are now refused before the
  request is made, and the refusal is logged. Known limit, stated in the code: a
  public name that *resolves* to a private address still passes — closing that
  needs resolution-time enforcement inside the fetching service.

### Changed — review package R2 (2026-08-02)

- **The metadata fan-out can ask for the fields it actually reads.**
  `getNodesMetadata` had no projection parameter and always pulled `-all-`
  (~59 properties per node). Resolving a topic page's swimlane widgets reads
  exactly one property off each node and paid for all of them, on the hot path
  of the most expensive tool. It now takes an optional `props` list; the widget
  resolution passes `['ccm:widget_config']` and every other caller keeps `-all-`.
- **`wikipedia-api.ts` no longer imports the whole edu-sharing client.** It
  pulled its one shared constant through the `wlo-api` barrel while its own
  header claimed it must never pull WLO config in — a contradiction inside a
  single file. It now imports from the config leaf, and the header states what is
  actually true: no repository credential can reach Wikipedia, because this
  module calls `fetch` directly rather than the credential-attaching `wloFetch`.

### Security — review package R1, foundation & config (2026-08-02)

- **Invisible Unicode can no longer smuggle instructions through
  `sanitizeText`.** The rule flattened C0/C1 control characters, which left every
  invisible class untouched: the Unicode tag block (U+E0000–U+E007F) encodes a
  full ASCII sentence that renders as nothing, bidi overrides (U+202A–U+202E)
  make the displayed text differ from what is read, and zero-width space splits
  words invisibly. Measured: 32 tag codepoints carrying "IGNORE ALL PREVIOUS
  INSTRUCTIONS" survived unchanged. This is the exact threat the module was
  written for — a value posing as a fresh instruction block — in the variant its
  tests did not cover. The worst path is `followUpPrompt`, which embeds a
  repository-supplied title in a message injected with *user* authority; titles
  come from spidered external sources. Invisibles are now dropped (not turned
  into spaces, which would insert word breaks) and dropped *before* the length
  cap, so padding cannot push the readable part out. ZWNJ/ZWJ and LRM/RLM
  deliberately survive — Persian and Indic orthography and emoji sequences need
  them, and direction *hints* cannot reorder text the way an override can.

### Changed — review package R1 (2026-08-02)

- **`WLO_TEXT_EXTRACTION_URL` has no default any more.** It defaulted to the
  *staging* extraction service regardless of which repository was configured, so
  any production deploy that had not set it sent the URLs of production material
  to another environment — the outcome the surrounding validation exists to
  prevent ("a typo must not redirect material URLs to a host the operator never
  chose"); an unset variable is no more a choice than a typo. Unset now disables
  the external path and logs why, leaving `/textContent` as the only source.
  **Action for operators: set `WLO_TEXT_EXTRACTION_URL` explicitly**, or accept
  repository-only full text.
- **A malformed numeric env value is refused instead of half-parsed.**
  `parseInt` stops at the first non-digit, so `WLO_FETCH_TIMEOUT_MS=20s`
  resolved to a **20 ms** timeout — a deployment where every upstream call fails,
  with nothing in the log pointing at the cause. `resolvePositiveInt` now
  requires a plain run of digits and warns with the variable name and the
  rejected value. Unset and empty stay silent.
- **The credential boundary moved to a file named after it.** `wloFetch` and
  `withCredential` — the single function deciding who receives the operator's
  password — lived in `wlo-config.ts`, a 412-line module also holding env
  resolution, the shared node types and the property-filter helpers. Now
  `src/wlo-fetch.ts` (fetch + credential boundary + `logUpstreamMiss`) and
  `src/wlo-types.ts` (`WloNode`, `SearchResponse`, `SearchCriterion`); the
  barrel `wlo-api.ts` re-exports both, so no downstream import changed. Pure
  relocation, no logic touched.
- **The logger cannot become the failure it is reporting.** A field that cannot
  be serialised (circular reference, BigInt) made `JSON.stringify` throw inside
  `emit`, replacing the real error with a TypeError. The record now degrades to
  its header plus a `logError` field.

### Fixed — the remaining three findings from the chatbot team (2026-08-02)

- **`find_wlo_skills` is no longer offered unconfigured.** Without
  `WLO_SKILLS_COLLECTION_ID` every call failed with "set
  WLO_SKILLS_COLLECTION_ID" — a message aimed at the operator, delivered to a
  model that cannot act on it and cannot guess a valid nodeId. The tool now takes
  its collection as an argument and is registered only when one is configured,
  the same gate the write tools use. The unreachable runtime branch went with it.
- **`includeRaw` now matches its description, and itself.** It promised "the
  original ccm:* / cclom:* property URIs" and delivered five vocabulary fields —
  in JSON. Markdown carried only three, so switching output format silently
  dropped the target group and the resource type. Both now return the same five,
  and the description names them instead of implying the full property bag.
- **`search_wlo_collections` and `search_wlo_topic_pages` no longer contradict
  each other.** One said a Sammlung *is* a Themenseite, the other said it checks
  which collections have one. Measured for "Mathematik": 5 collections, 1 topic
  page. Both descriptions now state the containment — a Themenseite is a
  collection that additionally carries a curated page layout — and each names the
  other tool for its case.

### Fixed — `includeParents` answered "in no collection" for material that was in several (2026-08-02)
Reported by the chatbot team, confirmed by measurement. The flag read
`/node/v1/nodes/{id}/parents`, which carries the ancestor chain for a collection
and an **empty list** for a content item — always, with a `200`. A model reading
that answers "this is in no collection", which is a false statement rather than a
missing one.

- `includeParents` now picks the endpoint that knows: `/parents` for a
  collection, `/usage/v1/usages/node/{original}/collections` for a material
  (resolving a reference id to its original first).
- A failed lookup is reported as such instead of collapsing into an empty list —
  "we could not find out" and "it is in none" lead to different answers.
- Both `get_node_details` and `get_nodes_details` are fixed.
- The test mock that had served `/parents` with a collection for content nodes
  was corrected to what the endpoint actually returns. It was the reason the
  defect survived a full test suite.

### Changed — a timed-out create no longer claims nothing was created (2026-08-02)
The abort hits the response, not the work: measured, a timed-out
`wlo_create_content` had already produced the record. Raising the timeout makes
that rarer, never impossible, so the reply now states the outcome as open and
offers a retry — safe, because the duplicate check finds and names an existing
record instead of making a second one. An ordinary refusal from the repository
is still reported plainly as a failure.

### Changed — upstream timeout default raised to 20 s (2026-08-02)
`WLO_FETCH_TIMEOUT_MS` defaulted to 10 s, which cut a create off mid-flight while
the repository had already made the record.

- Measured per call against staging: creating a `ccm:io` takes **4.2–8.0 s** (18
  samples), everything else stays under 2.5 s, and production reads are faster
  still. The create is the outlier by a factor of three; 10 s left as little as
  1.26× headroom over the worst run.
- Two explanations were tested and discarded first: a cold process is not slower,
  and the total pipeline duration does not matter because the timeout is per
  request.
- The new default is ~2.5× the worst measured call and stays below
  `WLO_TEXT_TIMEOUT_MS` (25 s), which remains the deliberate outlier for
  full-text reads. Both defaults are now named constants, and the test asserts
  the *margin* over the measurement rather than the literal number.

### Changed — submitting for review now reads the record back (2026-08-02)
`wlo_submit_content` was the one write that reported success on the strength of
a `200` alone. The live run showed the submission is verifiable: a submitted
record carries `ccm:wf_status: 200_tocheck` and `ccm:wf_receiver`, one that was
never submitted carries neither.

- The reply now names the status the record actually carries and the group it is
  waiting for, instead of a bare "eingereicht".
- A call answered with `200` whose record shows no workflow status is reported as
  NOT submitted — the same treatment every other silent drop gets. A draft
  sitting in nobody's queue while the user believes an editor has it is the
  failure this prevents.
- A record that cannot be re-read afterwards leaves the outcome explicitly open.

### Fixed — collections could not be created or renamed (2026-08-02)
Found by the first live run against a real repository. Both calls had been
covered by tests the whole time; the tests asserted our own inference back to us,
because the faked upstream accepts any body.

- **`wlo_create_collection`** answered `500` (`cmNameReadableName is null`) on
  every call. The endpoint derives the node name from a top-level `title` field
  in the body; `properties['cm:title']` alone is not read for that.
- **`wlo_rename_collection`** answered `500` (`NodeRef.getId()` on null). The
  update DTO must carry `ref.id` even though the id is already in the path.
- **A collection's description was silently discarded.** The collection endpoint
  accepts `cm:description` with `200` and stores nothing — the fourth measured
  instance of that pattern. It now travels through the node metadata route, and
  a description that still fails to land is reported instead of swallowed.

### Added — metadata proposals (2026-08-01)
Three tools that separate "a model thinks this should say X" from "the record
says X". Both facts stay readable in the repository afterwards.

- **`wlo_suggest_metadata`** stores per-field proposals with a rationale and
  leaves the record untouched. **`wlo_list_suggestions`** shows them with their
  status and the id to decide on. **`wlo_decide_suggestion`** accepts or
  declines one.
- **Accepting applies the value; the endpoint does not.** Measured on staging: a
  suggestion moved to `ACCEPTED` left the node's property absent.
  `/suggestions/v1` records proposals and decisions, nothing more — so accepting
  runs the ordinary write pipeline with its read-back.
- **Order matters, and it is fixed.** The value is written and read back
  **before** the proposal is marked accepted. A proposal marked accepted over a
  record that never received the value reads, to the next curator, as work
  already done; a written value with the proposal still open costs one repeated
  decision and states nothing untrue. A write the repository discarded therefore
  produces no `ACCEPTED` at all, and the reply says the proposal is still open.
- **`type: AI` is permanent, `status` carries the human decision.** The upstream
  `PATCH` takes no type, which matches what the two fields mean: the type records
  that a model wrote the proposal, the status that a person approved it.
  Overwriting the type would not add the approval — it would erase the
  authorship.
- Proposals are validated against the same allow-list as a direct edit, both when
  stored and when accepted. A proposal naming a property this server must not
  write (e.g. `ccm:oeh_lrt_aggregated`) is refused with the property named, and
  declining stays available so it does not sit on the list forever.

### Added — curation, first slice (2026-08-01)
The server can change data for the first time. It is deliberately narrow: one
tool, and the whole safety apparatus around it built before the tool existed.

- **`wlo_update_content`** edits the metadata of an existing record — title,
  description, keywords (added to, not replacing), source URL, language, author,
  publisher, licence, content type, subject, educational level, target group.
- **Two-step confirmation.** A call without `confirmToken` reads the record,
  renders the diff, hands back a single-use key valid for ten minutes, and writes
  nothing. The key is bound to a hash of the planned change, so a preview of a
  harmless edit cannot authorise a different one.
- **Read-back after every write.** edu-sharing answers `200` in three measured
  situations where the value is discarded (MDS filter, missing aspect, missing
  right). Each field is re-read and reported as saved, discarded, or rewritten by
  the repository; a discarded field is never reported as success.
- **Gated twice.** Write tools are not registered for a caller who may not write,
  so they never appear in `tools/list` — and each refuses at call time as well,
  because a host may serve a cached list. Anonymous never writes; an individual
  login always may; the shared service account only with the new
  **`WLO_ALLOW_SERVICE_WRITES`**, since a change under a collective identity is
  attributable to nobody.
- **A fixed licence key list.** An invented licence (a university's name, say) is
  rejected with the value named rather than written to an OER record.
  `ccm:oeh_lrt_aggregated` is never written — the repository derives it.
- **Drafts do not create versions.** Editing uses `PUT`; `commit: true` with a
  `versionComment` closes a round of work as a new version (`POST`).
- Tool descriptors may now declare their own `_meta.securitySchemes`. The
  server-wide `noauth` default is a default, not a rule — a tool that refuses
  anonymous callers must not claim otherwise.
- **`wlo_create_content`** creates a record for a material reachable by URL. A
  duplicate check on that URL runs first and compares each hit's actual URL
  case-insensitively — the API's own "did anything come back" is too loose,
  because the search also returns neighbours. `cclom:title` is deliberately not
  in the create body: measured, the repository replaces a create-time title with
  one derived from the URL, so the title is written in the metadata step after.
  New records go to `-userhome-` under a personal login, or to the shared inbox
  named by the new **`WLO_INBOX_ID`** under the service account.
- **`wlo_submit_content`** hands a record to the editorial review queue. Kept
  separate from creating on purpose: submitting spends a reviewer's attention
  and cannot be taken back quietly, so no draft reaches the queue because
  somebody was still writing.
### Added — `get_node_collections`: from a material back to its collections (2026-08-01)
The one lookup that ran the other way was missing. `get_node_details`'s
`includeParents` returned an empty list for every content node tested, and a
model that receives an empty list answers "this is in no collection" — a false
statement, which is worse than a missing one.

- A **separate tool**, not a flag: `get_node_details` advertises itself as fast
  (metadata only) and is called casually. This costs two upstream round-trips
  for a question that is rarely asked.
- **A reference id is resolved to its original first, always.** Filing material
  into a collection creates a reference node with its own id, and collection
  listings hand those out — but the usage endpoint only knows the original and
  answers `200` with an empty array for a reference. A "try it, resolve on
  empty" fallback was rejected: an empty array is a legitimate answer, and
  reading it as "probably a reference" makes the normal case slow and the empty
  case ambiguous.
- **The empty case is named.** `not_in_any_collection` versus `node_not_found` —
  the usage endpoint answers `500` for an unknown id on both production and
  staging, so it cannot tell them apart, but resolving the node first can.
- A failed lookup throws rather than degrading to an empty list. "We could not
  find out" must not reach a user as "it is in nothing".

Reported and pre-measured by the chatbot team; every claim in that report was
reproduced here before any code was written, and the finished service was run
against the live API on the same nodes.

### Fixed — a local run ignored `.env` entirely (2026-08-01)
`npm run dev`, `dev:http`, `start` and `start:http` did not read `.env`: there is
no `dotenv` dependency and no `--env-file` flag, so only `docker compose` ever
loaded it. A developer who pointed `WLO_REPOSITORY_URL` at staging still had
every local call go to **production**, because the built-in fallback in
`wlo-config.ts` is the production instance. Nothing warned about it.

The four scripts now pass Node's own `--env-file-if-exists=.env` (no dependency
added). `npm test` deliberately does not — the suite must not depend on a local
file. `engines.node` is raised to `>=20.12.0`, the release that added the flag;
`>=20` was promising a runtime that lacks it.

- **Collections**: `wlo_create_collection`, `wlo_rename_collection`,
  `wlo_add_to_collection`, `wlo_remove_from_collection`. Adding and removing
  material are separate tools whose wording cannot be confused with deleting it —
  a collection holds references, and the reference endpoint is one path segment
  away from the node endpoint that would destroy the material for everyone.
- **`wlo_update_compendium`** writes, replaces, or removes a collection's
  editorial prose. Always through the property endpoint: the field is not in the
  metadata set, where `PUT` would answer 200 and store nothing. Removal is its
  own parameter rather than an empty string, because only `null` clears a
  property.
- **`wlo_delete_content`** and **`wlo_delete_collection`**. `recycle=true` is
  always sent explicitly rather than relying on a default. Neither tool promises
  the deletion can be undone: a person-scoped archive query found a deleted node
  once and then returned nothing for the same node minutes later, so
  recoverability could not be demonstrated, and a reassurance we cannot back up
  is how someone loses their material.
- The content type (`ccm:oeh_lrt`) now resolves against the full **`new_lrt`**
  vocabulary — 220 concepts, generated from the published SKOS source by
  `scripts/generate-lrt-vocab.mjs`. Two labels ("Suchmaschine",
  "Stationenlernen") belong to two different concepts each and are reported with
  both candidates rather than silently resolved. The six concepts the vocabulary
  maps to no aggregated type are accepted with a warning, because material
  tagged only with those does not appear under the aggregated content-type
  facets.

### Fixed — auth review (2026-07-31)
A review of the credential chain before deployment; the first finding is the
reason nothing was deployed until it was closed.
- **The public REST layer inherited the service account.** `GET /api/*` and the
  launcher are open to the internet with no login, but the credential chain
  applied to them too, so everything the account could see beyond public was
  world-readable without any authentication — a silent authorization downgrade,
  and a breach of the design's own "anonymous-only" requirement for that
  surface. Measured, not inferred: an anonymous `GET /api/search` produced
  upstream calls carrying `Basic …`.

  **Fixed at the default, not at the call site.** The whole HTTP handler now
  runs anonymous, and the MCP endpoint — the one branch that needs rights —
  resolves the credential chain itself. Opting out per surface would have left
  the same trap for the next surface someone adds; this way a new branch is
  safe without anyone remembering. Behaviour is unchanged, and that the outer
  scope carries the protection was confirmed by removing it and watching the
  public-REST test fail while the MCP one still passed.
- **A caller-supplied account name reached the model unsanitized.** In per-user
  mode the label is whatever precedes the colon in the Basic header; line
  breaks survived into `wlo_auth_status` output, letting a name read as a
  separate instruction block. The repository-supplied authority and profile
  name are now cleaned at the same boundary — those are editable by the
  logged-in person too. The rule moved out of the widget module into
  `text-sanitize.ts`, shared by both sides instead of duplicated.
- **A credential over a non-`https` repository URL** was sent in the clear with
  no warning; the boot check now says so (loopback exempt, so a local
  development instance does not train the operator to ignore it).
- **The endpoint could relay credential guessing.** A client-supplied header is
  forwarded upstream, so WLO logins could be tried from this server's address.
  Capped by the number of *distinct* logins per client
  (`AUTH_CREDENTIAL_LIMIT`, default 10 per 10 minutes) rather than by request
  rate — a per-user client legitimately sends its header on every call, so a
  rate cap would throttle exactly the people it should serve. Values are stored
  as digests, never in the clear.

### Added — tests closing a known gap (2026-07-31)
- **The SSE/ALS integration test the design called for but never got.** The
  plan listed "SSE response mode breaks ALS propagation" as a risk to be
  discharged by a dedicated test; only an isolated unit test existed, which
  would have stayed green while every per-user request silently fell back to
  the service account. Now driven through a real `node:http` server with
  `MCP_SSE=1`, including three concurrent users overlapping in flight. The test
  was confirmed to fail when the propagation is deliberately broken. Result:
  the risk is discharged — propagation works.

### Changed — consistency and drift guards (2026-07-31)
- **The retained Vercel entry point resolves the same credential chain.**
  `api/mcp.ts` ignored the `Authorization` header, so per-user mode would have
  silently done nothing if that path were ever revived — the quiet capability
  gap this server keeps finding elsewhere. It serves only the MCP endpoint, so
  the service-account fallback is correct there and no public surface needs
  holding anonymous.
- **The duplicated follow-up dispatch is pinned instead of merged.**
  `shared/mount.ts` and `search-results/main.ts` carry the same click-handling
  branch; the latter keeps its own copy because it also owns the multi-select.
  Merging them would parameterise the shell for one caller, and these `main.ts`
  files have no behavioural test coverage — only `render.ts` is tested — so a
  refactor could not be shown to preserve behaviour, and adding a DOM test
  runner for a cosmetic gain is not worth a new dependency. A source-level test
  now fails if the two copies drift apart, matching the idiom the project
  already uses for `main.ts`. Confirmed to fire by renaming an attribute in one
  copy.

### Fixed — a misconfigured server reported "nothing found" (2026-07-31)
Found while verifying the auth modes against the real repository, not by
reading code.

- **A rejected credential made every search answer "0 hits" with no error.**
  With a wrong service password, `search_wlo_all` returned
  "Gefundene Treffer gesamt: 0" and `isError: false` — a configuration fault
  rendered as a fact about the world, which the model then passes on as
  "there is nothing on this topic". Cause: `enhancedSearch` treats "every query
  variant failed" the same as "no matches" (`reranker.ts`). One variant failing
  is what `Promise.allSettled` is for; ALL of them failing means the search
  could not be performed, and that now throws. Live re-check with the same
  broken configuration: `isError: true`, "search failed: no query variant could
  be executed (ngsearch failed: 401 Unauthorized)".

### Corrected — a documented fact about edu-sharing was wrong (2026-07-31)
- **"edu-sharing does not reject wrong credentials, it answers as guest" is
  false.** Re-measured against production: wrong credentials get `401`, on the
  identity endpoint and the search endpoint alike, for a wrong password on a
  real account as well as for an unknown user. Only the ABSENCE of a header
  gives `200`/`esguest`. The claim had been copied from a 2026-07-30 probe into
  `.env.example`, both READMEs, `docker-compose.yml`, `docs/TOOLS.md`, the
  design doc, the boot warning, and the `wlo_auth_status` tool description —
  all corrected. The practical consequence is the opposite of what was
  documented: a typo does not degrade to public content, it stops the server
  answering at all.

### Verified live against the real repository (2026-07-31)
- **All three modes confirmed end to end**, the third one for the first time:
  anonymous (no configuration), service account (`mode: "service"`,
  `authenticated: true`), and per-user — the same credentials delivered as an
  `Authorization: Basic` header resolve to `mode: "user"`, proving the header
  path against real WLO rather than a fake.
- **The public-REST fix confirmed under production conditions:**
  `GET /api/search?query=Entwurf` reports 1459 (the public count) while the
  service account sees 1464. Before the fix that surface would have answered
  1464 to anyone, unauthenticated.

### Verified live (service account, 2026-07-31)
The credential chain confirmed against the production repository with a real
WLO account — the part that could not be tested from the API spec alone.
- `wlo_auth_status` → `mode: "service"`, `authenticated: true`, authority and
  display name reported; the boot check logs `repository credential verified`.
- **The account genuinely sees more**, stable across three alternating runs:
  `"Entwurf"` 1459 → 1464, `"Test"` 6805 → 6863, `"intern"` 481 → 482. Small,
  reproducible, and exactly the shape expected of drafts an editor may see.
  Public-facing queries (`"Bruchrechnung"`, subject portals) are unchanged, so
  the anonymous experience is not altered.
- **Operational trap found and documented:** an unquoted `#` in the password
  truncates the value silently — both in `node --env-file` and in Docker
  Compose's `.env` (measured: 13 characters became 3). Combined with
  edu-sharing's silent guest fallback that produces a server which looks
  configured and serves public data only. `docker-compose.yml` now carries the
  two variables plus the quoting rule, and `.env.example` states it.

### Added (the credential chain, finished, 2026-07-30)
- **A configured service account is verified at boot.** Credentials the
  repository rejects are invisible in a normal reply, so a typo would leave the
  server looking configured while nothing works. One probe at startup turns
  that into a log line. (This entry originally said edu-sharing answers as
  guest for wrong credentials; re-measured 2026-07-31 it answers `401` — see
  the correction under the auth review below.) Silent and network-free when nothing is configured: the
  default deployment does not pay for a feature it does not use, and an
  unreachable repository is a warning, never a failed boot.
- **The public REST layer stays anonymous by contract.** A caller-supplied
  `Authorization` header on `/api/*` is not adopted — pinned by a test that
  drives a real HTTP server and inspects the identity at the upstream call.
  Accepting credentials there would turn a deliberately public surface into an
  authenticated API without any of the decisions that would need.
- Setup instructions for the per-user login in `docs/TOOLS.md`, including how
  to build the header and how to confirm it took effect.

### Added (per-user login via the host's connector header, 2026-07-30)
The third rung. A WLO user configures their own credentials once in their AI
host's connector settings; the host sends `Authorization: Basic …` with every
request and the server calls edu-sharing as that person.
- **The model never sees the credentials, and the server never stores them.**
  No login page, no token in the conversation — the two weaknesses the earlier
  envelope design had to accept.
- **Per-request isolation via `AsyncLocalStorage`.** One endpoint serves
  everybody, so the identity cannot live in a module variable; a test
  interleaves three concurrent "requests" and asserts none sees another's.
- **Only HTTP Basic is accepted.** A Bearer header is refused rather than
  forwarded: edu-sharing ignores Bearer instead of rejecting it, so passing one
  on would produce a call that looks authenticated and silently is not.
- Precedence: user header → service account → anonymous. `wlo_auth_status`
  reports which one applied.

Correction to the previous entry: per-user login was never blocked by
edu-sharing. P0 proved OAuth2/Bearer unavailable, and that was over-read as
"no per-user login". `basicAuth` is a declared scheme — which is exactly how
other WLO clients log people in.

### Added (operating modes: anonymous or one service account, 2026-07-30)
The server no longer has to be anonymous. Identity is resolved as a CHAIN, not
as a deployment mode — a service account from the environment, otherwise
anonymous — so a per-user rung can be inserted later without touching callers.
- **`WLO_SERVICE_USER` / `WLO_SERVICE_PASSWORD`** authenticate every upstream
  call via HTTP Basic. Unset (the default) is byte-for-byte today's behaviour.
- **The credential travels to the repository and nowhere else.** One place
  attaches it (`wloFetch`), one rule bounds it: Wikipedia, the text-extraction
  service and a look-alike host never see it, pinned by test.
- **`wlo_auth_status`** reports the resolved mode AND whether it actually
  works — two different facts, because edu-sharing answers `200` as guest for
  wrong credentials instead of failing (probed live). A configured account that
  is not being honoured is named as a configuration error rather than hidden.

P0 verification (staging + prod, recorded in
`docs/plans/2026-07-25-wlo-mcp-optional-auth.md`) settled the transport:
edu-sharing's own OpenAPI declares only `basicAuth` and `cookieAuth` — **no
Bearer** — and offers no OIDC discovery or Dynamic Client Registration. The
earlier design's paste-back Bearer envelope and host-managed OAuth are both
unavailable; per-user login stays open pending a decision by the WLO operators.

### Added (the last two display gaps, 2026-07-30)
- **`get_node_details` renders.** The tool that answers "tell me about THIS
  material" returned neither `structuredContent` nor a widget, while the detail
  view for exactly that shape already existed. One node is a list of one: the
  results widget shows its tile, "Details" opens the Einzelansicht with licence,
  source and the follow-up actions. `get_nodes_details` stays plain — it is a
  model-internal batch resolver with no display job.
- **`get_compendium_text` renders in the reading view.** That widget was built
  for "material full text OR editorial compendium prose" (its own header), yet
  the one tool whose output IS editorial prose never reached it. A bulk fetch
  stays one readable document — the same joined markdown the text output
  carries — but with an empty `nodeId`, which is what gates the per-node
  "summarize this" buttons off: the question is ambiguous across several
  collections.

### Fixed (tool + widget audit, 2026-07-30)
All 23 tools called live, every button chain simulated end to end, every widget
fed real tool output. Mechanics were clean (0 tool errors, 0 broken chains, 0
empty widgets); the defects sat one level up, in what triggers what.
- **Three tools advertised the same example query.** `search`,
  `search_wlo_content` and `search_wlo_all` all carried the literal
  "Video zur Eiszeit", so the same request routed to whichever the model
  happened to pick — and `search` returns only `{id,title,url}`, too little for
  a widget. `search` is now described as what it is (the ChatGPT
  knowledge-convention entry point for citations, forwarding to `search_wlo_all`
  for anything user-facing) and `search_wlo_content` as the deliberate narrowing
  to materials only. `search`/`fetch` still overlap in PURPOSE — the convention
  requires them — but no longer in the example a router matches on. A test pins
  that no multi-word example appears in two descriptions.
- **The topic-page markdown headed the answer with the technical variant name.**
  `structuredContent.collectionTitle` said "Mathematik" while the H1 printed
  `variantTitle` — "Fachportalstartseite". The widget used the right order, the
  text path the exact opposite.
- **Searching a portal-level collection answered "0 Treffer" and nothing else.**
  Matching runs over a collection's DIRECT contents; on the Mathematik portal
  that is 15 entries, none matching, with 11 sub-collections one level down.
  The answer now says which of the two it is and names the way forward.
- **`search_wlo_topic_pages` was the last hit-list tool without
  `structuredContent`.** It now projects each theme page onto one collection
  tile (`nodeId` = owning collection, `topicPageUrl` set → "Themenseite
  öffnen") and carries the results widget. Variants stay in the text.

### Added (the topic page stops being a dead end, 2026-07-30)
- **Swimlane cards can now be opened and acted on.** The topic-page widget was
  the only one whose cards did nothing — an external link out of the chat and
  nothing else — which made the most curated view the one where a click replaced
  no typing. Each card now carries "Details" → Einzelansicht (licence, source)
  and, from there, "Volltext anzeigen" / "Ähnliche Inhalte"; a collection in a
  lane offers its contents directly.
- **`renderDetail` moved to `shared/detail.ts`** so both widgets render the same
  view instead of two copies drifting apart, and `shared/mount.ts` grew from
  "render + repaint" into the tile-widget shell (open/close, Escape, focus per
  WCAG 2.4.3, follow-up routing). `search-results/main.ts` keeps its own copy of
  that loop for now because it also owns the multi-select — folding it in is a
  separate change.
- **The selection message names its tool.** Every single-tile button named the
  tool that continues the flow; "Ausgewählte weiterverwenden" was the one that
  did not. It now points at `get_nodes_details` with `nodeIds` — the batch route
  that reports per-id failures instead of failing the whole call.

### Documented (2026-07-30)
- **Follow-up buttons are a ChatGPT capability, and the docs now say so.**
  Injecting a chat message uses `window.openai.sendFollowUpMessage`; the
  MCP-Apps standard bridge offers only `tools/call` and
  `ui/update-model-context`, neither of which starts a user turn. On other hosts
  the buttons are omitted rather than rendered dead, and the widgets are
  display-only — local interaction (detail view, back, tree expansion) works
  everywhere. README (both languages) and `docs/TOOLS.md` state this.
- Widget counts corrected throughout: **four widgets serving ten tools**.

### Fixed (widget flow audit, 2026-07-30)
Walked every button in all four widgets from the click to the tool that has to
answer it.
- **"Themenseite öffnen" named a parameter its tool does not have.** The message
  said "Rufe dazu get_topic_page_content mit dieser nodeId auf", but that tool
  takes query/collectionId/variantId and answers "Bitte query, collectionId oder
  variantId angeben." Proven live: the same id succeeds as `collectionId`
  (866 ms, 8 swimlanes) and fails as `nodeId`. Taken literally the button was
  broken; it worked only when the model translated the name on its own.
  `FOLLOW_UP_PARAMS` now maps each action to the parameter its tool really has,
  and a test checks every entry against the registered tool's input schema.
- **A capped browse branch looked complete.** `browse_collection_tree` bounds
  depth and per-node width and reports it via `hasMoreChildren` / `truncated`;
  the tool's text told the model, but the tree widget rendered neither, so a
  truncated catalogue read as exhaustive. Capped branches now carry a visible
  "… mehr vorhanden" marker.

### Fixed (first live-deployment feedback, 2026-07-30)
Five reports from the deployed server, each traced to a root cause before any
fix (`/better-coding-debug`).
- **One widget now serves every result list.** It was wired to `search_wlo_all`
  alone, so the same request rendered as tiles or as plain text depending on
  which search tool the model happened to pick — "ich suche etwas zur Eiszeit"
  came back as text, "ich suche inhalte zu bruchrechnung" as a widget. The
  renderer accepts the flat `{total,count,results}` shape as well as the
  `search_wlo_all` envelope, splitting it by `nodeType` so collections keep
  their band and their "Inhalte anzeigen" action. Wired to `search_wlo_content`,
  `search_wlo_collections`, `get_collection_contents`,
  `search_wlo_within_collection` and `get_related_content`.
- **Four list tools returned no `structuredContent` at all** — registered with
  the plain `server.tool`, they answered with a text blob. Two of them are what
  the widget's own buttons route to, so "Inhalte anzeigen" and "Ähnliche
  Inhalte" dead-ended in unstructured text. All four moved onto the Apps-SDK
  seam with `nodeListSchema`.
- **The full-text tool was invisible to the router.** `get_wlo_content_text`
  was absent from the server `instructions`, which additionally steered away
  from extra calls — so a request for a material's Volltext produced no tool
  call at all, only an apology. The instructions now name it (and
  `get_collection_contents`). Its own description claimed the call "dauert
  typisch 1–3 Sekunden" and advised against it; measured live, the repository
  path answers in **288 ms**. The claim is corrected and the discouragement
  scoped to the external-extraction fallback that is actually slow.
- **Content tiles were too tall and narrow.** The preview box was a portrait
  3/4, which at a 220px column made the card ~470px tall and cropped the
  landscape previews most materials have. Now 16/9 — the card stays portrait,
  the image stops dictating its height.
- **The selection bar sat behind every result.** It was emitted after the grid
  and pinned with `position: sticky`, but the widget document deliberately has
  no scrollport ("the host sizes the iframe"), so sticky degraded to static at
  the very bottom. It now renders above the grid.

### Fixed (pre-deploy audit follow-up, 2026-07-30)
Every finding from the pre-deploy audit, resolved.
- **Follow-up prompts sanitize the title.** A control character or a runaway
  title from repository metadata went into the message verbatim;
  `sanitizeTitle` now flattens control characters, collapses whitespace and caps
  the title at 120 characters. The three remaining prompt builders collapsed
  into the one in `shared/follow-up.ts`.
- **`src/topic-page-api.ts` split in two** (448 lines, two reasons to change).
  Discovery — searching page variants, resolving a variant to its owning
  collection — stays; parsing what a page SHOWS moved to
  `src/topic-page-structure.ts`. A pure move: 547/547 tests unchanged.
- **A broken `WLO_TEXT_EXTRACTION_URL` now disables the service instead of
  building an unusable request target.** No scheme, a non-http(s) scheme, or a
  query/fragment → the external path is off and a warning is logged. It
  deliberately does **not** fall back to the default: a typo must not redirect
  material URLs to a host the operator never chose.
- **Three env variables were missing from the README table** —
  `WLO_TEXT_EXTRACTION_URL`, `WLO_TEXT_TIMEOUT_MS`, `WLO_TOPIC_POOL` — although
  `CONTRIBUTING.md` requires both places. Added in both languages.
- **`get_wlo_content_text` was missing from README.de.md** (tool table and
  detail section) while the English README documented it.
- **Historical tool counts are now marked as historical** rather than silently
  read as current: the O9 benchmark covered the 22 tools registered that day,
  and the MCP Inspector cross-check ran against those same 22 — the 23rd is
  covered by the conformance test, not by that Inspector run.
- **Dev dependencies updated in range** (`@types/node` 20.19.43, `tsx` 4.23.1),
  clearing the low-severity esbuild advisory that came in through `tsx`.
  `npm audit` is clean at every level. `CONTRIBUTING.md` now records why
  `@types/node` 26, TypeScript 7 and zod 4 are held back.

### Added (every tile continues a flow, 2026-07-28)
An audit of all four widgets found the same gap repeatedly: cards that showed
something but offered no way to *do* anything with it, so the user had to type
what a button could have carried.
- **Collection and topic-page tiles were dead ends** — a link out to
  edu-sharing and nothing else. Each now carries the one action that continues
  the conversation: a collection with a Themenseite opens that, a plain one
  lists its contents. One primary action per card, never two competing ones.
- **The detail view now leads to the full text** (`get_wlo_content_text`) and to
  similar materials (`get_related_content`). The reading widget and its tool
  existed but nothing in the UI routed to them.
- **Branch nodes in the browse tree could only be unfolded, never opened.** They
  now carry the same "Inhalte anzeigen" button as leaf nodes, so a subject with
  sub-topics no longer hides its own materials behind typing.
- **`shared/follow-up.ts` is the single place a button becomes a message.** Two
  properties are pinned by test for every action: the message names the NODE ID
  (the content tools resolve by id; a title-only prompt made the model ask for
  one) and the TOOL that does the job, so the model continues the flow instead
  of guessing. Keeping the mapping in one module stops the four widgets' wording
  from drifting apart.
- Every action button is a real `<button>` with an accessible name that includes
  the material, and none is rendered unless the host can take a follow-up
  message — a control that cannot work is worse than no control.

### Fixed (tiles are uniform, and selectable, 2026-07-28)
Cards in a row were interchangeable in purpose but not in size: a tall document
scan next to a wide video thumbnail, or a terse description next to a verbose
one, moved the licence rows and the Details button to a different height in
every card (user report 2026-07-28). Portrait tiles are wanted — ragged ones
are not.
- **One preview format for all tiles** (`3 / 4`, portrait, `object-fit: cover`),
  so the image fills a fixed box instead of dictating the card's height.
- **Title and description clamped to a fixed line count** (2 and 3) with that
  height reserved up front, so a one-line description and a four-line one leave
  the card the same size. The full text stays in the DOM for screen readers and
  the title still links to the complete resource.
- **The fact rows and the Details button are anchored to the bottom**
  (`margin-top: auto` on a `flex: 1` body), so licence and source line up across
  a row rather than floating wherever the text happened to end.

### Added (pick materials and carry them into the chat, 2026-07-28)
A teacher who finds three fitting worksheets wants to work with *those three*.
- **A selection checkbox per content tile** — a native `<input type="checkbox">`
  (keyboard-operable and announced without ARIA gymnastics), named per material
  so it is unambiguous out of context, on a 32 px hit area over the preview.
- **An action bar** appears once something is ticked (never a "0 selected"
  strip), sticky so it stays reachable in a long list, and `aria-live="polite"`
  so the changing count is announced without interrupting.
- **"Ausgewählte weiterverwenden"** injects a user message listing each material
  **with its nodeId**, so the model can load them — the lesson from the browse
  widget, whose title-only prompt made it ask for an id. Widget state persists
  the ids; titles are backfilled from the rendered tiles after a re-mount, and a
  material whose title cannot be recovered travels as its id alone rather than
  as empty quotes.
- Selection is gated on `canFollowUp()`: without a host that can take the
  message, no checkboxes and no bar ship — a selection nothing can act on is
  worse than none. As everywhere else, the widget calls no tool itself.

### Added (W5 reading widget + Markdown subset renderer, 2026-07-28)
A 41 000-character full text is unreadable as a wall of plain text, and a reader
who sees a material wants to *do* something with it. W5 renders the text and
hands the conversation the next step.
- **`shared/markdown.ts` — a deliberately narrow Markdown subset**, not a
  parser: headings, paragraphs, lists, blockquotes, fenced code, rules, bold,
  italic, inline code and http(s) links. The source is escaped FIRST and only
  the recognised subset is turned back into markup, because the text comes from
  third-party publishers and an external conversion service. No package was
  added: a general parser widens the attack surface for no benefit and would
  dwarf the 7–9 kB widget bundles, and a pure function also serves the REST
  layer, which a browser-only package could not. A whitelist test asserts that
  eight hostile inputs (`<script>`, `<iframe>`, `<svg onload>`, `data:` links,
  markup inside headings/lists/quotes) can produce no element outside the
  renderer's own tag set.
- **Widget W5 `reading`**, attached to `get_wlo_content_text`. Shows the text,
  states its provenance as a visible fact (repository vs. linked page, with the
  link), flags truncation, and gives each empty cause its own wording instead of
  a blank panel — `access_denied` reads "not publicly accessible", not "no text".
- **Follow-up actions**: "Zusammenfassen", "Einfacher formulieren", "Aufgaben
  ableiten". They inject a user message that names the material AND its nodeId,
  so downstream tools can resolve it — the lesson from the browse widget, whose
  title-only prompt made the model ask for an id. Like the tree, the widget
  never calls a tool itself: ChatGPT mirrors a widget-initiated result back as
  new toolOutput and may re-mount the frame. Rendered only when the host can
  inject a message (`canFollowUp`), so no dead controls ship.
- Document headings render one level down (`#` → `h2`): the widget title owns
  the page's only `h1`, and two competing top-level headings would break the
  outline screen readers navigate by.
- **Every button now gets a visible focus ring by default.** The shared
  stylesheet declared focus rings per class, so each new control shipped without
  one until someone remembered — an accessibility floor that depended on memory.
  The existing per-class rules are left in place (now redundant, harmless).

### Added (`get_wlo_content_text` — the material's own text, 2026-07-28)
Until now every tool returned metadata *about* a material; none returned the
material. A teacher could be told a worksheet exists but not work with it.
Plan: `docs/plans/2026-07-28-content-text-and-widget-actions.md`.
- **New tool `get_wlo_content_text`** (23rd tool): full text by `nodeId`, with
  `source`, `charCount`, `truncated` and — on a miss — a `reason`
  (`no_text_no_url`, `extraction_failed`, `node_not_found`), matching the
  convention `get_topic_page_content` established.
- **The repository is the primary source.** Measured across 32 live records:
  edu-sharing's own `/textContent` already holds usable text for **29 of them**,
  for externally linked pages as well as attached files. The external
  text-extraction service is the fallback for the remaining link-only records —
  it offers *only* `POST /from-url` and answers **424** for an edu-sharing
  download URL, so it cannot serve repository-hosted files at all.
- **No in-process conversion** (no PDF parser, no Markitdown). Both paths are
  remote HTTP, i.e. asynchronous I/O; a CPU-bound converter would block the
  single Node thread for every other user — the explicit reason for this design.
- Node metadata and the text are read **in parallel**: the text read is the slow
  one (median 4.6 s live), so fetching the title and fallback URL alongside it
  costs no extra wall time.
- `WLO_TEXT_EXTRACTION_URL` (default the staging service, **empty disables the
  external path**) — every edu-sharing instance runs its own, so the address is
  configuration. Only public material URLs are ever sent there.
- `WLO_TEXT_TIMEOUT_MS` (default 25000) for both full-text paths.
  `getNodeTextContent` accepts the override: `/textContent` was measured at a
  maximum of 9.2 s, which the 10 s default would cut off — losing a text that
  exists.
- **edu-sharing converts PDF/DOCX/PPTX itself.** Of 10 real binaries found in a
  250-record sample, 9 are repository-hosted, and `/textContent` returns their
  text — 115 834 characters from one PDF, 44 764 from another, 37 940 from a
  PPTX, 13 083 from a DOCX. No local converter is needed for hosted files
  either; the question was never conversion.
- **`access_denied` as its own reason.** The remaining hosted files answer
  **403 on both** `/textContent` and their download URL: they exist but are not
  public. Reporting that as "no text stored" (or, worse, as `node_not_found` —
  such a node refuses its metadata too) points at the wrong problem. A refused
  read is now checked before the not-found branch and reported as
  `access_denied`; no converter can help there, only rights can. `wlo-node.ts`
  gained `readNodeTextContent`, which reports the HTTP status alongside the
  text; `getNodeTextContent` delegates to it and keeps its signature, so the
  five other call sites are untouched.
- Tool descriptions now state the cost trade-off explicitly: `get_node_details`
  is the fast metadata read (~0.3 s), `get_wlo_content_text` the slower content
  read (1–3 s). Both remain available; the model is told which to reach for.
- Verified live: worksheet records returned their actual text from the
  repository in 1.5–2.2 s with truncation and provenance reported, a
  permission-restricted DOCX returned `access_denied`, and an unknown id
  returned `node_not_found`.

### Fixed (licence is stated, never omitted, 2026-07-28)
A missing licence and a permissive one looked identical: the tile and the
Markdown output simply dropped the row. For a teacher that is the reading that
is unsafe to act on — "no licence stated" means *do not* treat it as free.
- The licence row is now always rendered; absent data reads "nicht angegeben"
  (`not stated` in English), matching the REST page's existing "Lizenz unklar".
- The property itself was never missing on our side: `ccm:commonlicense_key` is
  in `DISPLAY_PROPS` and reaches `FormattedNode.license`. It is genuinely unset
  upstream on many records — all six sampled Tutory worksheets lack it even at
  the full `-all-` projection, where edu-sharing itself reports a "none" licence
  icon.

### Changed (bounded, self-disclosing browse tree, 2026-07-27)
Measuring the tools' **opt-in modes** — which the first sweep had not covered —
exposed the real outlier: `browse_collection_tree` at depth 2 with
`includeContentPreview` took **11.7 s and returned 460 kB**. The tree fetched up
to 30 sub-collections per node with no overall bound (a 15-node portal yields
~100 nodes) and every enrichment then cost one upstream call per node — up to
1500 upstream calls from a single tool call in the worst case.
- **The tree is now bounded and says so.** The slice per parent is derived from
  a total node budget (150) and capped at 10, computed *before* the walk so
  every parent gets the same size — a counter drained by concurrent workers
  would have made the output nondeterministic. Depth stays capped at 2.
- **Truncation is disclosed, not silent.** A node whose children were cut
  carries `hasMoreChildren`, the envelope carries `truncated`, and the Markdown
  output names the exact follow-up call (`browse_collection_tree mit
  nodeId=…`). The tool description instructs the model to tell the user and
  open a branch deliberately instead of presenting a slice as the whole tree.
  Detecting "there is more" costs nothing: the walk fetches one child more than
  it shows rather than spending a round-trip on a count.
- The preview pass now runs at the level-1 width instead of 5.
- Measured against the production repository: depth 2 with preview 11.7 s →
  **6.5 s** (460 kB → 362 kB), with counts 5.1 s → **4.0 s** (103 kB → 84 kB),
  depth 1 with counts 2.0 s → **1.5 s**.
- Still expensive by nature: `includeContentPreview` costs one upstream call per
  tree node. It is opt-in, off by default, and now bounded — but a caller that
  enables it on a wide tree should expect seconds, not milliseconds.

### Changed (fan-out sweep across every tool, 2026-07-27)
All 22 tools were benchmarked live with realistic arguments (two runs each) to
find where time actually goes instead of guessing. Result: most tools already
answer in under a second; three call sites carried avoidable waiting.
- **Mode-B candidate check now uses `WLO_TOPIC_POOL`** instead of a hard-coded
  width of 4. `findTopicPagesByQuery` examines up to 12 candidate collections,
  each costing a metadata read plus (when it owns a page config) a children
  read — three to four sequential waves. Measured in isolation against
  production: 1797 ms at width 4, 788 ms in one wave. No second knob: it is the
  same class of work as the Mode-C fan-out, bounded by the same upstream.
- **`getTopicPageContent` gained a both-ids fast path.** Given a collectionId
  *and* a variantId it now reads both nodes in parallel instead of walking
  collection → page-config folder → variant. `findTopicPagesByQuery` returns
  both, so the query path and `search_wlo_topic_pages`'s `includeContent` leg
  now pass them through; the collection is still read, so the page header
  survives. Measured: 1238 ms → 774 ms for that stage.
- **`browse_collection_tree` level-1 fan-out 5 → 10.** At depth 2 each level-1
  node costs exactly one `/children` call and level-2 nodes do not recurse, so
  the width was four sequential waves for a 20-child portal. The nested pool is
  now a separate, deliberately narrow constant (4), because it only performs
  I/O on the opt-in `includeContentCounts` path — that keeps the worst case
  bounded at 40 concurrent calls rather than squaring the wider level-1 width.
- Also narrowed the candidate metadata read in `getCollectionThemePages` to the
  three owner fields it actually uses (it ran `-all-` on the Mode-B hot path).
- Measured locally against the production repository, best of two runs:
  `get_topic_page_content(query)` 3253 → **2175 ms**, `browse_collection_tree`
  depth 2 2899 → **1968 ms** and depth 1 1378 → **943 ms**,
  `search_wlo_topic_pages(query)` 1621 → **1191 ms**. Every other tool was
  already at or below ~1.2 s and was left alone.
- Concurrency was verified empirically rather than assumed: against the live
  server, five simultaneous tool calls cost the same per call as a single one
  (factor 0.96) and ten cost 1.65× — far from the factor 10 that serialization
  would produce. The limit that appears at ten is edu-sharing, not this server.

### Fixed (topic-page owner resolution was silently broken, 2026-07-27)
Follow-up to the latency work below: profiling the remaining 7 s revealed that
Mode C was not merely slow but **wrong**, and had been for as long as the
`/parents` walk existed.
- **`/parents` answers 500 (AccessDeniedException) for anonymous callers on
  page-config folders.** `getNodeParents` degrades a non-OK response to `[]`,
  so every owner resolution failed silently: the listing showed identical
  "Fachportalstartseite" titles, no `topicPageUrl`, and a `collectionId` that
  was really the variant id. Live-verified against production; `-all-` and a
  narrow projection fail alike, so this predates the projection change.
- **Replaced the walk with two `/metadata` reads** along
  `virtual:primaryparent_nodeid` (variant → page-config folder → collection).
  That endpoint works anonymously and costs ~0.19 s instead of ~1.1 s.
- A collection may own **several** page-config folders while its own
  `ccm:page_config_ref` names only the active one (5 of 25 sampled pages), so
  the folder is deliberately not required to match that ref — requiring it
  would drop those pages. Carrying `ccm:page_config_ref` at all is what marks a
  collection as a Themenseite owner, exactly as before.
- **Candidate pool factor 3 → 2.** The theoretical bound was three variants per
  page (one per target group); the live data averages 1.10 (108 variants across
  98 pages: 92 with one, five with two, one with six), so factor 2 keeps ample
  headroom and the one-shot top-up covers outliers.
- Filtering the listing to a single target group was evaluated and rejected:
  98 of 108 variants carry no target group at all, and a server-side `teacher`
  filter returns 3 variants covering 3 of 98 pages.
- Measured against the production repository at the default `WLO_TOPIC_POOL=10`:
  `{maxResults: 20}` 9.9 s → **3.2 s**, `{maxResults: 10}` 4.5 s → **1.4 s**,
  `{maxResults: 5}` 2.8 s → **0.66 s**, with `educationalContext` **0.55 s** —
  while the payload grew (real titles and URLs where there had been none).
  Against the originally reported 17–19 s that is roughly a factor of six.
- Scope check: `/parents` is fine for ordinary collections (200, ~0.4 s) and
  fails for content nodes (`ccm:io`), which `getNodeBreadcrumb` already
  documents and tolerates. Only the page-config case was undiagnosed.

### Security (dependency advisories, 2026-07-27)
The CI `npm audit --omit=dev --audit-level=high` gate failed; both advisories
came from the single runtime dependency `@modelcontextprotocol/sdk`.
- **`@modelcontextprotocol/sdk` 1.29.0 → 1.30.0.** The moderate
  `@hono/node-server` advisory (GHSA-frvp-7c67-39w9, path traversal in
  `serve-static` on Windows via encoded `%5C`) was unreachable under 1.29.0,
  which pinned `^1.19.9`; 1.30.0 declares `^1.19.9 || ^2.0.5` and the patched
  2.x becomes installable. Resolved: `@hono/node-server` 1.19.14 → 2.0.12.
- **`fast-uri` 3.1.3 → 3.1.4** (high, GHSA-v2hh-gcrm-f6hx, host confusion via a
  literal backslash authority delimiter), reached through `ajv`, whose `^3.0.1`
  range already allowed the fix — only the lockfile was holding it back.
- No `overrides` were needed; every version stays inside the range its parent
  declares. `npm audit --omit=dev --audit-level=high` now reports 0
  vulnerabilities.
- Verified beyond the suite because `@hono/node-server` crossed a major version
  and it builds the Web Request the transport sees: over a real socket, `POST
  /mcp` with `Accept: application/json` only, and with no `Accept` header at
  all, both still return 200 with all 22 tools — the `rawHeaders` Accept patch
  in `http-app.ts` survives the bump. Tool latencies and response sizes are
  unchanged.
- Re-checked the standing follow-up: SDK 1.30.0 still has zero occurrences of
  `securitySchemes`, so the `_meta.securitySchemes` fallback in
  `apps/tool-defaults.ts` remains the maximum this SDK can emit.

### Fixed (topic-page listing latency, 2026-07-27)
A client measured **17–19 s** for `search_wlo_topic_pages` without a `query`
(Mode C) while every other tool answered in 1.3–6.5 s. Analysis and plan:
`docs/plans/2026-07-27-topic-pages-latency.md`.
- **Removed a dead upstream call per variant.** Mode C fetched the owning
  collection's full metadata only to read `ccm:page_config_ref` — a value the
  parent walk already holds (it selects that collection *because* the property
  is set) and that `buildTopicPageUrl` only truthiness-checks. The resolver now
  returns it (`TopicPageOwner.pageConfigRef`), halving the round-trips. This
  also removes a silent failure path: a failed metadata fetch used to yield an
  empty `topicPageUrl`.
- **Fixed a cache stampede in the parent walk.** `resolveVariantCollection`
  cached the *resolved value*, so sibling variants enriched concurrently all
  missed the cache and re-ran the same walk (proven by a call-count test: three
  siblings of one page cost three walks). It now caches the in-flight promise.
- **Replaced the candidate floor.** `max(50, maxResults * 5)` charged a
  5-result request for 50 variant enrichments; now `max(10, maxResults * 3)`
  (three = the maximum variants per topic page), with a single top-up to the
  former pool size when the merge falls short — and none when upstream already
  returned everything it had.
- **Narrowed the projection on the hot path.** `getNodeParents` and
  `getNodeMetadata` accept an optional property list (default stays `-all-`);
  the owner walk now requests the three fields it reads instead of ~59 per node
  of the whole ancestor chain.
- Measured with the new `scripts/measure-topic-pages.mjs` against the production
  repository: `{maxResults: 20}` 9.9 s, `{maxResults: 10}` 4.5 s,
  `{maxResults: 5}` 2.8 s — and 6.3 / 3.0 / 1.8 s at `WLO_TOPIC_POOL=20`, at
  unchanged response sizes. That 10 and 5 now differ at all is the direct
  evidence the floor is gone (the client measured 8.5 s vs 8.2 s before).

### Added (topic-page diagnostics & tuning, 2026-07-27)
- **`WLO_TOPIC_POOL`** (default 10) — concurrency of the Mode-C owner
  resolution, the server's most fan-out-heavy path. Ships inert; raising it
  trades upstream load for wall-clock.
- **`reason` on empty topic-page results** — `get_topic_page_content` and
  `GET /api/topic-page` now report *which* of five causes produced an empty
  payload (`no_match`, `node_not_found`, `no_page_config_ref`, `no_variant`,
  `empty_config`). The reporting client was probing three candidate collections
  in sequence because every miss looked identical.
- **`outputFormat: json` is now honoured on the empty path too.** It previously
  returned German prose in the text block while the success path returned JSON,
  so clients parsing that field broke on exactly the case they needed to inspect.
- `search_wlo_topic_pages` states that it has **no `discipline` filter** and
  points at `educationalContext`/`targetGroup` (unknown arguments are dropped
  silently by schema validation — the client sent `discipline` for months
  without any signal). Its `sort` description no longer implies that `alpha` is
  a global A–Z index; it sorts the fetched candidate set.

### Changed (deployment scope, 2026-07-27)
- Documented that production runs **self-hosted and persistent** (Docker on the
  vServer). The Vercel entry point (`api/mcp.ts`, `vercel.json`) is retained but
  not operated; serverless cold-start reasoning no longer applies. `PERFORMANCE`
  O7 (in-process cache) was re-scoped accordingly and now carries the constraint
  that its cache key must include the identity once optional auth lands.

### Added (fetcher-proof search entry, 2026-07-17)
Root cause across all live chat tests: AI fetch layers strip the query string
from MODEL-built URLs (anti-exfiltration), so every REST call arrived as a bare
`/api/search` → 400 — reproduced live; the exact filtered URL returns 200 from
a browser/curl. Server-side countermeasures (nip.io stays for now, per
operator decision):
- **`GET /api/search/<term>` path form** — the term rides in the path and
  survives query-string stripping; optional filters stay query params and
  degrade gracefully. Explicit `q` wins over the path term. Malformed
  percent-encoding → 400 (guarded decode, like the skills route).
- **`GET /api/search` without a term → 200 guidance envelope** (deliberate
  contract change; over-long/bogus input still 400s). Hosts surface only the
  status of a 4xx to the model, so the recovery instructions must live in a
  200 body: empty buckets, empty `query` echo (trips the template's freshness
  check), and `warnings` teaching the path form + paste-back.
- **`/llms.txt`** (self-describing API surface for AI fetchers) on the static
  allow-list; **`Cache-Control: no-store`** on all REST responses.
- Launcher templates + example URL now lead with the path form (DE/EN), carry a
  fixed URL pattern with the example term "OER" (labelled "replace with the
  user's topic" — no warm-up call), and tell the chat to explain the options
  (topic + optional subject/level/type filters) before asking for the topic.
- **Templates rewritten in the USER's voice; authorization claims removed.**
  Live-observed: Claude flagged the launcher prompt as prompt injection at
  chat start and distrusted the URL even more. The prompt WAS carrying the
  classic injection signature — a prefilled instruction block in command tone
  ("Du hast Zugriff…") plus an authorization claim ("dein Abruf-Werkzeug DARF
  sie laden") and ALL-CAPS urgency ("ERSTER AUFTRAG"). Both language templates
  now read as the user's own request ("Ich möchte offene Bildungsmaterialien
  finden… bitte nutze die API so", "Meine erste Suche: {url} – bitte direkt
  abrufen"); the claim and the caps are gone, pinned by doesNotMatch tests.
  The launcher field hint still explains that a pre-picked topic lets Claude
  run the first search without a paste-back. In-chat FOLLOW-UP topics still
  need the paste in Claude's refusal mode — that is the host's provenance
  rule, only the MCP connector removes it.
- **Both bundled skills** (`public/skills/*.skill.md`) updated the same way:
  path-form search leads, the stripped-query failure mode is named with its
  recovery (path form / paste-back), and the wlo-search failure table reflects
  the new missing-term contract (empty `query` + `warnings` ≠ "no results").
  Pinned by a content test in `tests/rest-skills.test.ts`.
- **`?format=html` on `/api/search` (both forms)** — renders the same envelope
  as a minimal, escaped, self-contained HTML page (`src/rest/search-page.ts`,
  reusing the widgets' `escapeHtml`). Evidence arrived after the first pass:
  ChatGPT's browsing DID retrieve a user-pasted API URL but could not use the
  body ("keine WLO-JSON-Suchantwort") — its reader pipeline consumes HTML, not
  raw JSON. Templates + skills teach reader-only chats to try `?format=html`
  before falling back to the JSON paste. Doubles as the human share link.
Rejected from the same proposal, with reasons: positional multi-segment paths
(`/search/<q>/<fach>/<typ>` — ambiguous positions; filters already degrade
gracefully), blanket never-400 fuzzy matching (filters are already lenient;
invalid input should stay loud), HTML via `Accept`-header content negotiation
(invisible and fragile — superseded by the explicit `?format=html` view once
live evidence arrived), `Vary: Accept` (no content negotiation exists).

### Changed (launcher instruction templates, live-finding driven, 2026-07-17)
Both language templates (`instruction_tpl` in `public/launcher.html`) now encode
what the live chat tests showed:
- **MCP first** when the WLO MCP is registered natively.
- **No test/warm-up call** — without a topic the chat must ask, not invent
  "test" (observed live).
- **User-paste fetch fallback:** claude.ai's fetch tool restricts MODEL-built
  URLs — live evidence indicates it strips their query string (anti-exfiltration
  safeguard), so our API correctly answers 400 ("q is required"; reproduced:
  bare `/api/search` → 400, the exact status every chat test saw on every
  endpoint), while the same URL pasted by the USER is fetched intact → 200.
  This — not a response cache — explains "first call fails, re-pasted call
  works" AND the "cache ignores the query string" illusion. The template now
  teaches the workaround, including "a 400 on a correctly built URL = your tool
  stripped the query → ask for a paste-back, do not blindly retry".
- **Query-echo self-check** (`response.query` must match the term) and honest
  output rules: paraphrase noisy `description`, empty `license` = "licence
  unclear", never invent hits.
Pinned by 2 new template tests (DE + EN) in `tests/launcher-instructions.test.ts`.

### Added (deploy fingerprint on /health + audit quick wins, 2026-07-17)
- **`/health` now carries `widgets: { <name>: <8-hex build hash> }`** — the
  content-addressed widget hashes as a deploy fingerprint (self-hosted AND
  Vercel handler). Whether a fix is actually live is now one curl compared
  against the local build, replacing the manual byte-diff probe that two live
  test rounds were lost without (audit roadmap #3). Tolerant when widgets are
  not built (empty map).
- Audit quick wins: dead `.wlo-tree__loading` CSS removed; orphaned i18n keys
  `loading`/`loadError` removed from both locales (zero usages verified) —
  all three widget bundles shrank measurably.

### Fixed (browse "Inhalte anzeigen" asked for a Node ID, 2026-07-17)
- The follow-up button injected a title-only message ("Zeige mir die Inhalte der
  WLO-Sammlung „X“"), so the model had no nodeId and answered that it needs one
  (live). The prompt now embeds the nodeId and names the tool
  (`askFollowUpPrompt`, pure + unit-tested): "… (nodeId: <id>). Rufe dazu
  get_collection_contents mit dieser nodeId auf." The button already carried
  `data-node-id`; the click handler now passes it through.

### Changed (browse widget redesigned as a STATIC pre-expanded tree, 2026-07-17)
- **No more in-widget tool calls — the flicker class is eliminated by design**
  (user-approved). ChatGPT mirrors widget-initiated `callTool` results back as
  new toolOutput (and may re-mount the frame); the earlier echo-guard fix never
  got a valid live test (byte-probes showed the old build was still deployed),
  and rather than keep fighting undocumented host behaviour the widget now
  renders PRE-EXPANDED from the data the tool call already delivered (nested
  `children`, e.g. `browse_collection_tree` depth=2). Toggles are purely local;
  collapse choices persist via widget state.
- **Deeper levels via follow-up buttons:** childless collections render an
  "Inhalte anzeigen" button that injects a follow-up user message
  (`sendFollowUpMessage`, ChatGPT extension) — the MODEL runs the next tool
  call and renders a fresh card. Capability-gated: hosts without the API
  (standard MCP-Apps bridge) get no dead buttons, the ↗ links remain.
- Reducer shrank to init/toggle (loading/error states gone); `isOwnDrilldownEcho`
  removed as dead. Old drill-down tests deliberately replaced by the new
  contract's tests + source pins (`no callTool in browse main.ts` is now a
  hard regression guard; focus({preventScroll}) pin unchanged).

### Fixed (browse tree reset/flicker on expand in ChatGPT, 2026-07-17)
- **Expanding a subcategory no longer resets the tree.** Root cause: ChatGPT
  mirrors a WIDGET-initiated `callTool` result back as a new toolOutput
  (`openai:set_globals`); the browse widget's onUpdate treated that echo as a
  fresh seed and re-initialised the whole tree — visible as "loading… →
  flicker → expansion gone". Fix: the widget tracks which nodeIds it fetched
  itself; an output whose `parent` is in that set is recognised as an own
  drill-down echo (`isOwnDrilldownEcho`, pure + unit-tested) and repaints
  WITHOUT re-seeding. Foreign outputs (model-initiated calls, portal lists)
  still re-seed as before. This was the second, independent cause behind the
  earlier flicker report (the first — focus() scroll-jumping the iframe — was
  fixed this morning); wiring pinned by a source-level test since browse
  main.ts is DOM glue verified live.

### Fixed (ChatGPT "Failed to fetch template" after redeploys, 2026-07-17)
- **Stale widget URIs keep resolving.** Root cause: every redeploy rolls new
  content-addressed `ui://` URIs, but the server registered ONLY the current
  one — a host whose connector still held the previous tool descriptor
  (ChatGPT syncs tools/list on connect, not per chat) then read a dead URI →
  "Fehler beim Laden der App / Failed to fetch template" (the tool call itself
  succeeded; Claude was unaffected only because fresh chats re-sync). Fix: a
  per-widget `ResourceTemplate` (`ui://widget/<name>-{hash}.html`) now serves
  the CURRENT build for ANY old hash of a known widget — like a CDN keeping old
  asset paths alive. New URIs still roll (cache-busting intact); unknown widget
  names still 404. Regression test in `tests/apps-resources.test.ts`.

### Changed (tool descriptions lead with the trigger, 2026-07-17)
- **Every relevant tool description now LEADS with its trigger** (the user
  intent / when-to-use), well-formulated and up front, instead of opening with
  architecture or mechanics — so the model picks the right WLO tool from a
  natural teacher query.
- The primary search tools carry concrete, teacher-phrased triggers in the
  first ~256 chars (where ChatGPT/OpenAI weights tool selection): a query like
  "Video zur Eiszeit" now fires WLO instead of a generic web search.
  `search_wlo_all`, `search_wlo_content`, `search_wlo_collections`, the ChatGPT
  `search` tool and `get_topic_page_content` name concrete material types
  (Video/Arbeitsblatt/Übung) + example queries up front and say "statt einer
  Websuche".
- The drill/browse/detail tools were reordered trigger-first too:
  `get_subject_portals`, `browse_collection_tree`, `get_collection_contents`,
  `search_wlo_within_collection`, `get_related_content`, `get_node_breadcrumb`,
  `get_collection_stats`, `get_compendium_text` now open with the natural
  request they serve (e.g. "mehr wie dieses", "welche Fächer gibt es?", "was
  steckt in dieser Sammlung?"). Behaviour and parameters unchanged.
- Left as-is (already capability/trigger-first): `get_node_details`,
  `get_nodes_details`, `lookup_wlo_vocabulary`, `lookup_wlo_publishers`,
  `find_wlo_skills`, `fetch`, `wlo_health_check`. `get_wikipedia_summary` keeps
  its explicit "do NOT use for WLO material" guard so it does not steal
  material queries.
- Pinned by `tests/tool-triggers.test.ts` (concrete trigger + example query in
  the first 256 chars of the primary search tools).

### Added (get_topic_page_content one-step topic path, 2026-07-17)
- **`get_topic_page_content` now accepts a `query`** (topic name) and resolves
  the best-matching Themenseite itself, returning render-ready swimlanes in a
  SINGLE call. Root cause it fixes: the swimlane widget only triggered via the
  two-step chain `search_wlo_topic_pages` → `get_topic_page_content`, which the
  model broke in practice, so the swimlane view "never triggered" (live-observed
  2026-07-17; the tool itself resolves swimlanes correctly — proven by a live
  probe). A direct request ("zeig die Themenseite zu Optik") now renders in one
  step; `variantId`/`collectionId` still work for the post-search path.
- The topic→collection resolution (search_wlo_topic_pages Mode B) is extracted
  to `services/topic-page.findTopicPagesByQuery` and shared by both tools (no
  duplication); Mode B behaviour is unchanged (its 3 characterization tests
  stay green). A query that matches nothing returns the empty-payload contract,
  not an error. 3 new tests in `tests/tools-topic-page-content.test.ts`.

### Changed (search-results: collection band above content, 2026-07-17)
- The topic-page + collection tiles now sit in one lightly separated band above
  the material grid (edu-sharing look), replacing the per-section left-border
  accent with a single subtle divider + spacing. The band (and its divider) is
  dropped entirely for content-only results, so there is never a stray
  separator. `wlo-section--emphasis` removed as dead. Tests updated to pin the
  band + the no-band case.

### Fixed (browse tree flicker / viewport jump in ChatGPT, 2026-07-17)
- **`focus()` no longer scroll-jerks the host iframe.** Expanding a subcategory
  in the browse tree made the widget flicker and the view jump in ChatGPT. Root
  cause: `paint()` re-focuses the toggle with `element.focus()`, which
  scroll-into-views by default — and an expand repaints twice (loading → loaded),
  so the iframe scrolled twice per click. Fix: `focus({ preventScroll: true })`
  keeps the a11y focus restore (WCAG 2.4.3) without the scroll. Same pattern +
  fix in the search-results detail view (open/close). Pinned at source level
  (`tests/widgets-focus-scroll.test.ts`) since these main.ts files are DOM/host
  glue, verified live rather than unit-tested.

### Fixed (focused audit on widgets + REST, 2026-07-17)
Deep pass over the redesigned widgets and the REST layer; three Low findings,
all fixed test-first (no Medium+ findings; prod `npm audit` clean):
- The detail-view CTA arrow (`↗`) is decorative — now `aria-hidden` so screen
  readers announce only the action label (search-results widget).
- An empty topic page kept its header hidden: the title/description now render
  above the empty state (the title says WHAT is empty), and both empty branches
  (MCP tool + REST) pass `collectionTitle`/`description` through.
- `X-Content-Type-Options: nosniff` on every REST response (JSON + raw skill
  Markdown), matching the static-asset surface.

### Added (public robots.txt + repo-bound root default, 2026-07-17)
- **`GET /robots.txt`** (permissive) joins the HTTP static allow-list: AI fetch
  tools check robots.txt before touching the public `GET /api/*` surface, and a
  missing file left the decision to each fetcher's default policy. Live finding
  behind it: a Claude sandbox refused the REST API as "robots-disallowed" /
  `host_not_allowed` (its own egress allowlist blocks the nip.io host) while
  the same endpoints answered 200 JSON from outside — the server was never at
  fault.
- **Root-collection default is now resolved per repository host.** The root id
  is repository-bound; the known WLO hosts (prod + staging) each carry an
  explicit default — identical today, live-verified on both via node metadata
  (2026-07-17). An unknown host without `WLO_ROOT_COLLECTION_ID` now logs a
  startup warning instead of silently using a WLO id that cannot exist there
  (`resolveRootCollectionId` in `src/wlo-config.ts`, pure + unit-tested).

### Added (widget redesign toward the edu-sharing look, 2026-07-17)
Patterned on the official Apps-SDK examples (pizzaz list/carousel card
anatomy: image block, clamped title, labelled meta rows, one primary CTA) and
the edu-sharing search page, within the ChatGPT inline-card rules (wrapping
grids instead of nested horizontal scroll).
- **Collection tiles (edu-sharing style):** Sammlungen/Themenseiten render as
  colored blocks with a stack glyph, name below, and a text+icon "Themenseite"
  badge — never colour-only. Content cards gain labelled fact rows
  (Lizenz/Quelle).
- **In-widget Einzelansicht:** every content card carries a "Details" button
  (strictly opt-in per widget — no dead buttons elsewhere); the detail view
  replaces the grid with large preview, full description, all subject/level/
  type chips, licence/source, and Open-content / Topic-page CTAs. Zero extra
  tool calls — the data is already in structuredContent. Focus management per
  WCAG 2.4.3 (open → back button, close → originating card; host repaints
  never steal focus), Escape closes, selection persists via the ChatGPT
  widget-state extension. The i18n conformance test immediately caught a
  hardcoded German quote pair in the new aria-label — fixed via the locale
  table.
- **Topic-page header:** `get_topic_page_content` now carries the owning
  collection's title + description (optional, backward-compatible in schema
  and REST), and the widget renders them WLO-style above the swimlanes.
- Widget descriptions updated; content-addressed URIs roll automatically.
  README (EN/DE), the submission checklist, and the golden prompts are synced
  to the redesigned widgets and the widget `_meta` (description, CSP,
  `prefersBorder`).

### Fixed (Apps-SDK metadata completeness, 2026-07-17)
- **Every tool now carries a human-readable `title`.** The 14 tools registered
  via plain `server.tool` (a signature without a title parameter) shipped with
  the machine name only, while the Apps SDK expects a title alongside it and
  the submission scan reads it. Titles are stamped centrally in
  `tool-defaults.ts` (registration-site titles win). A new conformance test
  pins the FULL per-tool metadata set — title, the three annotation hints,
  `securitySchemes`, invocation status strings — for all current and future
  tools, so this class of gap cannot reappear silently. Audit result:
  annotations 22/22, noauth 22/22, status strings 22/22 were already complete;
  `outputSchema` remains deliberately on the 10 list-/widget-/knowledge-tools
  (extending it to the detail tools is the documented API design pass).

### Fixed (full live probe of all 22 tools, 2026-07-17)
Every tool was called against the PRODUCTION API — the gate the mocks could
never close, and the one that had let `fileSize` through. Two tools failed; both
are fixed and the probe now reports **22/22**.
- **`search_wlo_within_collection` had never worked in production.** It scoped
  its `ngsearch` with `virtual:primaryparent_nodeid` — a criterion the backend
  rejects with **400 Bad Request** on every call (isolated live: `ngsearchword`
  → 1985 hits, `ccm:taxonid` → 910 hits, `virtual:primaryparent_nodeid` → 400).
  The audit-H-A `/children` fallback never fired because it was written for an
  *empty* result, while the call *throws*. `GET /api/collection?q=` was broken
  the same way. The collection's own `/children` listing is now the only scope,
  with query + vocab filters matched locally — and the result discloses when a
  collection exceeds the sampled window instead of looking exhaustive.
  Two test files asserted the primaryparent criterion and thus kept a
  permanently broken tool green; they were rewritten (not quietly deleted) with
  the reason recorded in each file.
- **`get_related_content` died on an unreadable parent collection.** The
  optional siblings lookup hit `403 Forbidden` on real data,
  `getCollectionContents` threw, and the whole tool failed — discarding the
  related results it had already fetched. It now degrades with a warning, like
  the wiki/collections legs of `searchAll`.

### Fixed (live Claude session findings, 2026-07-17)
- **The widget cache key now covers the whole resource.** `ui://` URIs are
  content-addressed so hosts refetch changed widgets — but the hash covered only
  the HTML, not the `_meta`. A metadata-only fix (the `ui.domain` removal below)
  therefore kept the identical URI, and Claude went on serving its cached,
  broken copy: the deployed fix silently had no effect, and the live server
  provably emitted clean metadata while the host still reported the old value.
  The hash now covers HTML **and** `_meta`, so any change — including an
  env-driven one — yields a new URI.
- **`fileSize` violated our own outputSchema (MCP conformance):** the live
  edu-sharing API serialises `node.size` as a STRING; the formatter passed it
  through while the declared schema says `number`. Spec-compliant hosts
  (Claude) validate `structuredContent` against `outputSchema` and rejected the
  ENTIRE tool result ("Expected number, received string") whenever a hit
  carried a binary size — `search_wlo_content`/`search_wlo_all` failed on real
  data. Root-cause fix in the formatter (coerce once at the source; unparseable
  → 0), `WloNode.size` typed honestly (`number | string`), regression tests at
  unit and tool level. Mocks had never set `size`, which is why 394 green tests
  missed it — exactly the "live data shapes" gate the audit kept open.
- **The widget domain is no longer advertised unless configured.** A host
  validates the domain against its OWN sandbox format and rejects the whole
  widget for a foreign value — Claude expects `{hash}.claudemcpcontent.com`,
  reported "Invalid ui.domain format" and aborted the bound tool call
  (`search_wlo_all` surfaced as "server cannot be reached"). Both
  `_meta.ui.domain` and its `openai/widgetDomain` alias are now emitted only
  when `WLO_WIDGET_DOMAIN` is explicitly set (a ChatGPT plugin submission needs
  it), and then on both keys.
  Dropping only the standard key was NOT enough: the live payload proved Claude
  normalises the vendor alias onto `ui.domain` — the rejected value existed
  solely in `openai/widgetDomain`. A server cannot know a host's sandbox
  domain, so sending neither and letting each host assign its own is the honest
  default. Docs updated (README EN+DE, `.env.example`).

### Fixed (CI green on the runtime we ship, 2026-07-17)
- **`npm test` no longer depends on the Node version.** The script passed a glob
  (`--test "tests/*.test.ts"`); glob support in the test runner only arrived
  after Node 20, which instead takes the pattern as a literal path (`Could not
  find 'tests/*.test.ts'`) and exits 1 — and it auto-discovers only
  `.js/.cjs/.mjs`, never `.ts`. So the suite passed on the Node 22 dev machine
  and had never once been green in CI, which runs Node 20 (what `engines` and
  the `node:20-alpine` image declare). `scripts/run-tests.mjs` now expands the
  file list itself, which also fixes Windows, where `cmd.exe` does not expand
  globs either. It fails loudly on an empty match instead of reporting a green
  run of zero tests. Verified in a `node:20-alpine` container: the old command
  reproduces the CI error, the new one runs 394/394.
- **CI actions off the deprecated Node 20 action runtime:** `actions/checkout`
  and `actions/setup-node` pinned to v5 (`node24` runtime, SHAs verified against
  the GitHub API), clearing GitHub's force-migration warning. `node-version`
  deliberately stays 20 — that is our app's runtime, so CI keeps testing what we
  ship.
- **Lockfile back in sync with `package.json`:** the root entry lacked the
  `npm >= 9` engines floor added earlier (one line; no dependency was
  re-resolved).

### Fixed (Apps-SDK conformance follow-up, 2026-07-17)
- **Widget `_meta` on the read result:** the Apps-SDK doc places the widget
  metadata (CSP/domain/prefersBorder) on the `contents[]` entry of a resource
  READ; it was only emitted on the `resources/list` descriptor. Both surfaces
  now carry it, so a host reading either sees the CSP allowlist.
- **Standard-bridge `setWidgetState` is a deliberate no-op:** the fallback
  posted a `ui/update-model-context` message with a non-spec `{widgetState}`
  payload (the method expects model-visible `{content: […]}`). Widget-state
  persistence is a ChatGPT-only extension, so on the standard MCP-Apps bridge
  the state now simply stays in memory for the mount.
- **`WLO_WIDGET_DOMAIN` (new env):** the app identity domain advertised as
  `_meta.ui.domain` / `openai/widgetDomain` — required and unique per app at
  plugin submission — is now configurable instead of always being derived from
  `WLO_REPOSITORY_URL`. Default unchanged (edu-sharing origin); the widget CSP
  allowlist intentionally stays the data origin. Documented in README (EN+DE)
  and `.env.example`.
- **`securitySchemes` decision dated:** the Apps-SDK auth doc shows a top-level
  `securitySchemes` tool field, but the LATEST published
  `@modelcontextprotocol/sdk` (1.29.0, checked 2026-07-17) does not know the
  field — the `_meta.securitySchemes` mirror remains the maximum the SDK can
  emit; re-check on the next SDK bump (noted in `apps/tool-defaults.ts`).
- **Locale-appropriate quotes in the search-results widget:** the query heading
  used German „…“ quotes in every locale; the quote pair now comes from the
  widget string table (EN: “…”).

### Fixed (deep-audit remediation + live verification, 2026-07-17)
- **Topic-page variants read at the correct depth (audit #1, live-verified):**
  `getCollectionThemePages` now takes the page variants directly from the
  config folder's children (which themselves carry `ccm:page_variant_config`)
  instead of reading the children's contents — those are widget nodes, which
  produced subtly wrong `variantId`/`targetGroup` ("nicht gesetzt") while the
  title/URL looked correct. Also drops the per-child fan-out (one upstream call
  instead of N). Test mocks reduced to the single true shape.
- **Topic-page discovery repaired for the live API (new, live-verified):** the
  keyword-collections endpoint returns a fixed reduced projection WITHOUT
  `ccm:page_config_ref` and does not surface the subject portals at all — so
  `search_wlo_topic_pages` Mode B and the `search_wlo_all` topicPages bucket
  found NOTHING against production. New `searchTopicPageCollections()` matches
  the root subject portals locally (their `/children` projection carries the
  config ref); Mode B additionally metadata-checks keyword hits instead of
  pre-filtering on a property the projection can never deliver. Verified live:
  `searchAll('physik')` now returns the Physik portal as a topic page.
- **Malformed percent-escape no longer hangs the socket (audit #2):**
  `GET /api/skills/%ZZ` returned no response for ~30 s (`decodeURIComponent`
  threw outside its guard → unhandled rejection); now a clean 400.
- **`searchAll` degrades instead of failing (audit #3):** a thrown collections
  search (timeout/DNS/reset) no longer discards the already-fetched content
  results; the leg logs a warning and returns empty, like the Wikipedia leg.
- **Collection filters are now real (audit #4):** `search_wlo_collections`
  advertised discipline/educationalContext filtering but applied none. The
  backend rejects extra criteria (400, live-verified), so the resolved
  criteria are applied locally against node metadata on all three retrieval
  paths; `total` reflects the filtered set; the never-effective `userRole`
  parameter was removed (its property is absent from the keyword projection).
  `search_wlo_all` documents that vocab filters scope to the content bucket.
- **Relevance default un-deadened (audit #6):** the zod `.default('alpha')` on
  `search_wlo_topic_pages.sort` made the documented "relevance when a query is
  given" default unreachable — Mode B ranked by relevance and then re-sorted
  alphabetically. Queries now keep the reranked order by default.
- **Quality floor counts what the scorer counts (audit #8):** the reranker's
  minimum-score floor now uses the same stopword-filtered term list as the
  scoring, so stopword-heavy queries ("was ist die optik") no longer flip into
  the junk-preserving all-entries fallback.
- **Shared `nodeTitle()` chain (audit #9):** the title fallback chain
  (`cclom:title → cm:title → cm:name → node.name → node.title`) lives once in
  `node-match.ts` and is used by the formatter, reranker scoring, deleted-node
  check, alphabetical sort, and breadcrumbs — page variants titled only in
  `cm:title` are no longer mis-sorted, mis-matched, or dropped as "deleted".
- **Recursive pagination honesty:** `get_collection_contents` with
  `includeSubcollections` silently ignored `skipCount` (while `_queryMeta`
  reported it); it now paginates locally (skip window capped at 400 so a huge
  offset cannot force a full-subtree crawl).
- **REST `lang` validated at the boundary:** `GET /api/wikipedia?lang=…` now
  rejects malformed language codes with 400 instead of relying on the
  wikipedia-api backstop. Static responses send `X-Content-Type-Options:
  nosniff`. Skills ranking tokenizer is Unicode-aware ("Köln", "Übung").
- **Widget a11y:** the browse tree no longer steals focus on theme/locale
  repaints (focus restore is scoped to the user's own toggle interaction);
  widgets stamp the resolved locale onto `<html lang>` at runtime (WCAG 3.1.2).
- **Docs:** README EN+DE now describe the rightmost (proxy-appended)
  `X-Forwarded-For` hop, matching the code; stale comments fixed (server.ts
  registration list, register.ts plan jargon, dead `filters` binding removed);
  CLAUDE.md tool-group list completed; `engines` gains the documented npm floor.

### Added (CI type gate + dispatch tests, 2026-07-17 — audit #5)
- **`npm run typecheck`** (`tsconfig.typecheck.json`): `tsc --noEmit` over
  everything the build project cannot see — `api/` (Vercel entry), `tests/`
  (tsx strips types), and the widget DOM entry points (esbuild does not
  type-check) — wired into CI before the test step. Surfaced and fixed 15
  latent type errors in 6 test files.
- **`src/http-app.ts`:** the self-hosted request handler extracted from
  `http.ts` (which listens on import and was therefore untestable) into a
  `createHttpRequestHandler(options)` factory; `http.ts` stays the thin env +
  listen entry. New `tests/http-app.test.ts` drives the real dispatch over an
  ephemeral-port server: health/OPTIONS/405/404/launcher, 400 invalid JSON,
  413 body cap, 429 rate limit, and a full MCP `initialize` round-trip
  (Accept normalization included). New `tests/api-mcp.test.ts` does the same
  for the Vercel handler (GET health, 405, JSON-only-Accept initialize).
- **Bounded lane resolution (audit #10):** topic-page swimlane resolution runs
  through `mapPool(…, 4)` instead of an unbounded `Promise.all`, capping the
  page×lane upstream fan-out.
- **Test-helper consolidation:** `connectedClient()` (was duplicated in 19
  files) and `toolText()` (2 local copies, one missing the type filter) are
  now shared via `tests/fetchMock.ts`.

### Changed (cleanup + modularization round, 2026-07-16)
- **Reranker split (behavior-preserving):** query expansion — the synonym table,
  stopword set, and `expandQuery` — moved verbatim from `src/reranker.ts` (329 →
  212 lines) into the new `src/query-expand.ts` (91 lines); the reranker keeps
  scoring, RRF merge, and orchestration. `DE_STOPWORDS` is shared (scoring drops
  stopwords too). Verified by the unchanged reranker/search-pipeline suites.
- **Recursive collection walk extracted:** the BFS branch of
  `get_collection_contents` moved out of the tool handler into the named
  `collectRecursiveContents` helper (same file, mirrors the
  `findCollectionsByTreeTraversal` pattern); the handler is a thin dispatcher.
- **Export-surface cleanup (knip-driven, each verified by grep):** 14
  module-internal symbols un-exported (`SKILLS`, `TOPIC_PAGE_PROPS`,
  `WIKI_USER_AGENT`, `NOAUTH_SECURITY_SCHEMES`, REST validation caps, widget
  sub-schemas, `buildDownloadUrl`, `DOWNLOAD_TEXT_CAP_BYTES`, `WIDGET_NAMES`).
  Type-only knip flags were deliberately left (cascade false-positives from the
  esbuild widget entries + the intentional `_queryMeta` contract re-exports).
- **Test gaps closed (audit follow-up):** markdown render wrappers of
  `get_related_content` (Basis line + siblings section), `get_node_breadcrumb`
  (' › ' join + empty-path message), and `get_collection_stats` (sampled-hint)
  are now pinned (`tests/tool-render-wrappers.test.ts`, 3 tests).
- Module maps in README (DE/EN) and `CLAUDE.md` updated for the new
  `query-expand.ts` / `node-match.ts`.

### Fixed (deep-audit remediation 2026-07-16, evening round)
- **H-A — `search_wlo_within_collection` empty for curated collections:** the
  `virtual:primaryparent_nodeid`-scoped search returns nothing for reference
  collections (the common WLO case). The service now falls back to enumerating
  the collection's actual `/children` (bounded to 100) and applies the free-text
  query plus the resolved vocab filters locally (new shared `src/node-match.ts`;
  pagination is local over the filtered set). 3 regression tests.
- **Q-2 — duplicate rows in the collection tree-traversal fallback:** matches are
  now de-duplicated by nodeId at insertion (collections form a DAG, so the same
  node could surface at several levels), keeping rows and `total` honest. Test.
- **Q-3 — `excludeNodeIds` under-filled the direct keyword-collection page:** the
  direct path now over-fetches by the exclusion count (mirroring the
  content-search H1 fix) and falls through to the tree traversal when every
  direct hit was excluded, instead of returning an empty page. `total` now counts
  the kept hits. 2 tests.
- **Docs/security wording:** `.env.example` claimed the client IP comes from the
  "first" X-Forwarded-For hop; the code (correctly) uses the RIGHTMOST,
  proxy-appended hop — the doc now says so. `get_collection_stats`'s description
  claimed "facet aggregations over the collection subtree"; it is a tally over up
  to 100 direct child files (a sample) and now says so.
- **Observability:** `getNodesMetadata` logs a warning when a per-node fetch
  throws instead of silently dropping the node.

### Changed (token efficiency, same round)
- **`search_wlo_all` defaults to `outputFormat: "markdown"`** (was `json`): the
  full bucket envelope always rides in `structuredContent`, so the model-facing
  text no longer duplicates it by default (~40–60 % fewer tokens per default
  call). Explicit `outputFormat: "json"` still returns the envelope in the text
  (back-compat for clients that only read content blocks).
- **Compact JSON everywhere model-facing:** dropped `null, 2` pretty-printing
  from all tool JSON outputs (~15–30 % smaller). `_queryMeta` keeps its documented
  shape — slimming it was evaluated and rejected (external consumers parse it).
- **Grade-number aliases:** `"Klasse 5"` / `"5. Klasse"` (grades 1–13) now resolve
  to their Bildungsstufe in `educationalContext` filters. Test.
- **Apps-SDK:** widget resources now advertise a per-widget description
  (`ui.description` + `openai/widgetDescription`). Test. Topic-page Mode B
  resolves candidate collections' Themenseiten in a bounded pool (≤4 in flight)
  instead of serially; characterization test pins the behaviour.
- **CI hardening:** `permissions: contents: read` and both actions pinned to
  full commit SHAs (verified against the GitHub API).
- **Removed:** the deprecated `getCollectionMetadata` alias (no callers;
  `getNodesMetadata` is the name). Named the reranker blend weights
  (`QUALITY_WEIGHT`/`RRF_WEIGHT`/`APPEARANCE_BONUS_MAX`); documented the
  re-rank-per-page limitation on `skipCount` (with `excludeNodeIds` as the
  robust alternative) and that `search_wlo_all` uses `maxContent`/`maxCollections`.

### Fixed (audit-final remediation 2026-07-16)

- **H1 — silent result cap (correctness):** `search_wlo_content` capped its upstream
  fetch pool at a flat 20 when `excludeNodeIds` was set, so pagination-via-exclusion
  with `maxResults > 20` silently returned ≤ 20 hits. Now over-fetches
  `maxResults + excluded.size` (bounded, never below `maxResults`), mirroring the
  recursive collection branch (`src/tools/content-search.ts`). Regression test added.
- **M2 — duplicate result rows:** recursive `get_collection_contents`
  (`includeSubcollections`) now de-duplicates by `nodeId` across sub-collections, so
  an item referenced in two collections appears once (`src/tools/collections.ts`).
  Regression test added.
- **M3 — masked upstream outage:** `searchPageVariants` now `logUpstreamMiss`-logs a
  non-OK upstream response before degrading to `[]`, so an outage is no longer
  indistinguishable from a genuine "no topic pages" result (`src/topic-page-api.ts`).
- **L4 — prototype-chain lookup:** `universitySubjectLabel` now own-property-guards the
  slug lookup (`Object.hasOwn`), so a `…/hochschulfaechersystematik/toString` URI can
  no longer return `Object.prototype.toString` (`src/vocabs-hochschule.ts`). Test added.
- **L5 — empty labels:** the URI-only fallback in `resolveLabels` now drops
  empty-string URIs (`!!u && …`), so an empty taxonid no longer injects an empty
  discipline label (which the widget tile's `disciplines[0]` would surface)
  (`src/formatter.ts`). Test added.
- **L10 — reranker title source:** relevance scoring now uses the same title fallback
  chain as `formatNode` (`cclom:title → cm:title → cm:name → node.name → node.title`),
  so a node titled only at cm:title / node level no longer scores against an empty
  title (`src/reranker.ts`). Test added.
- **L1 — serverless leak on error:** the Vercel handler closes the per-request
  server/transport in a `finally`, so a throw from `connect`/`handleRequest` no longer
  leaks it on a warm instance (`api/mcp.ts`, mirrors `http.ts`).
- **L8 — widget stuck loading:** the standard `ui/*` host bridge now rejects a
  `tools/call` promise on a JSON-RPC error (via the new pure, unit-tested
  `settleCallResponse`) and times out an unanswered call after 15 s, so a failing or
  silent host no longer leaves the widget spinning forever (`host.ts`, `host-bridge.ts`).
- **L9 — widget origin leak:** outbound widget messages other than the initial
  `ui/initialize` are now held until the host origin is pinned, instead of being
  posted to `'*'` (any framing origin) (`src/apps/widgets/shared/host.ts`).
- **L7 — widget image scheme guard:** the tile's `previewUrl` `<img src>` is now
  `safeHref`-guarded like every href (non-http(s) → icon fallback)
  (`src/apps/widgets/shared/tile.ts`).
- **L11 — vocab alias shadowing:** `discipline="sonstiges"` now resolves to the
  Sonstiges concept (999), not Allgemein/fächerübergreifend (720) which listed it as a
  stray alias; the dead `media education` alias on 400 (Mediendidaktik) is removed —
  it stays on 900 (Medienbildung) (`src/vocabs.ts`). Test added.
- **L16 — non-deterministic duplicate subtree:** `browse_collection_tree` now claims a
  child in the `visited` set at scheduling time, so a collection shared by two parents
  is emitted under exactly one — deterministically — instead of racing to appear twice
  (`src/tools/browse.ts`). Test added.

### Fixed (whole-repo audit 2026-07-16)

- **Launcher DOM-XSS (T1):** the public launcher now scheme-guards result links —
  an untrusted `ccm:wwwurl` (e.g. `javascript:`/`data:`) is rendered as plain text
  instead of a clickable href (`public/launcher.html`, inline `safeUrl` mirroring
  the widgets' `safe-url.ts`); external links also gain `rel="noreferrer"`.
- **Rate-limit bypass (T2):** `clientKey` now takes the RIGHTMOST (proxy-appended)
  `X-Forwarded-For` hop under `TRUST_PROXY`, not the client-spoofable leftmost one
  (`src/rate-limit.ts`) — a client can no longer forge a fresh limiter key per
  request behind an appending reverse proxy.
- **`browse_collection_tree` unbounded recursion (T3):** the tree walk now tracks
  the current level and recurses only while `level < depth` (a closure-constant
  check descended the WHOLE subtree), caps concurrency with `mapPool(…,5)`, and
  guards cycles with a visited set (`src/tools/browse.ts`). Fixes the depth
  semantics and the anonymous amplification-DoS vector.
- **MCP error boundary (T4):** the self-hosted `POST /mcp` branch is wrapped in
  try/catch (generic 500 if headers unsent, server always closed) and a
  process-level `unhandledRejection` handler was added (`src/http.ts`) — an
  edge-case throw no longer crashes the server or hangs the client.
- **Download size cap (T5):** `getNodeDownloadText` streams and caps the anonymous
  file download at 64 KB with a truncation marker (`src/wlo-node.ts`), bounding the
  memory + model-context use of `find_wlo_skills`.
- **Info-disclosure (T7):** the Vercel handler returns a generic `Internal server
  error` and logs the detail server-side, instead of leaking `err.message`
  (`api/mcp.ts`); a wrong HTTP verb on `/mcp` now returns `405 Allow: POST` on the
  self-hosted path too (`src/http.ts`).
- **Bounded upstream fan-out (T8):** `getNodesMetadata` now uses an internal
  order-preserving worker pool, `get_nodes_details` and `get_subject_portals`
  route their fan-outs through `mapPool` instead of raw `Promise.all(Settled)` —
  a single call can no longer open dozens–hundreds of simultaneous upstream
  sockets (`src/wlo-node.ts`, `src/tools/node-details.ts`, `src/tools/browse.ts`).
  `get_nodes_details` also gained the missing `try/catch`/`toolError` wrapper.
- **postMessage hardening (T6):** the standard-bridge widget listener now trusts
  only messages from its host parent frame and pins the outbound `targetOrigin`
  to the host once known, instead of accepting any origin / posting to `'*'`
  (`src/apps/widgets/shared/host.ts`).
- **Slow-body / socket protection (T9):** the self-hosted HTTP server sets
  `requestTimeout`/`headersTimeout` (`src/http.ts`) — bounding a dribbled request
  without cutting off long-lived SSE responses.
- **Per-request disk I/O (T10):** built widget HTML is read + hashed once and
  memoized, not re-read on every stateless request (`src/apps/resources.ts`).
- **Container hardening:** the compose service caps memory/CPU, drops all Linux
  capabilities, forbids privilege escalation, and runs a read-only root filesystem
  (`docker-compose.yml`).
- **Prompt-injection framing (T-INJ):** `find_wlo_skills` frames the untrusted
  uploaded Markdown as curated suggestions to review (not authoritative
  instructions) and documents the write-controlled-collection trust assumption
  (`src/tools/skills.ts`).
- **Observability:** non-OK upstream responses on the graceful-degrade paths are
  now logged (`logUpstreamMiss`) instead of silently returning empty, so an
  outage is distinguishable from "no results" (`src/wlo-config.ts` + call sites).
- **Accessibility:** the browse widget restores keyboard focus to the toggled
  node after a re-render and links each toggle to its region via `aria-controls`
  (`src/apps/widgets/browse/{main,render}.ts`); search `query` inputs are capped
  at 200 chars (`src/tools/content-search.ts`).
- **Launcher scheme-guard now regression-tested:** the self-contained launcher's
  inline `safeUrl()` (which drops `javascript:`/`data:` result URLs) is exercised
  by extracting it from the page in `tests/launcher-safe-url.test.ts`, pinned to
  the widgets' `safeHref` behaviour — closing the one test-debt item (M1) from the
  2026-07-16 re-audit.

### Added
- **University-subject fuzzy lookup (Hochschulfächer Stage 2), model-free.**
  `lookup_wlo_vocabulary` now accepts `vocabulary="universitySubject"` plus a
  free-text `query`; `suggestUniversitySubjects` (`src/vocabs-hochschule.ts`) does a
  per-word Levenshtein match over the 344 bundled Hochschulfächer labels and returns
  a short `{label, uri}` pick-list — a *disambiguation choice* the model resolves,
  never an automatic single-match, so the school↔university input invariant is
  untouched. The `uri` is the real `ccm:taxonid` form (verified against the live
  discipline facet), usable directly as a `discipline` filter. No embedding/AI model
  is loaded and no runtime dependency is added; the `levenshtein` primitive was
  extracted to a shared leaf module `src/text-distance.ts` (reused by
  `vocab-suggest.ts`, no circular import). Tests: `tests/vocabs-hochschule.test.ts`
  (7 unit) + `tests/tools-vocabulary.test.ts` (3 integration).
- REST `GET /api/search` parity with the MCP search tools for generic (non-MCP)
  clients: it now returns `unresolvedFilters` (mistyped vocab filters + "did you
  mean" suggestions) and — with `?includeFacets=1` — `facets` (`{label, count, uri}`
  per bucket), so the facet-driven university-subject flow works over REST too. The
  facet aggregation was extracted into a shared `searchFacets` (`src/services/search.ts`)
  now used by `search_wlo_content`, `search_wlo_all`, and the REST layer (dedup).
  Field projection (`?fields=…`) was also extended to `GET /api/collection`
  (shared `projectItems` in `src/rest/project.ts`).
- University-subject (Hochschulfächersystematik) resolution via facets, conflict-
  free with school subjects. The 344 university concepts are bundled as a
  **display-only** URI→label table (`src/vocabs-hochschule.ts`), consulted by
  `labelFromUri` only for a `discipline` URI that misses the local school table —
  and deliberately **not** wired into `resolveVocab` (input), so a shared label
  like `discipline="Mathematik"` still resolves to the school subject and is never
  ambiguous. `resolveFacetCounts` now carries the concept `uri` per facet bucket
  (`{label, count, uri}`), so a chatbot can read a university subject off a faceted
  search (`includeFacets: true`) and filter by that URI (input accepts raw URIs).
  `QueryMeta.facets` and the `includeFacets` tool descriptions updated accordingly.
- Optional field projection on `GET /api/search` (`?fields=title,url,…`): trims
  each result item in every bucket to the requested keys (`nodeId` always kept),
  cutting the JSON — and thus the tokens an LLM client ingests — without touching
  the MCP tools, widgets, or service layer. Allow-list-validated in
  `src/rest/validate.ts` (`parseFields`), applied by the pure
  `src/rest/project.ts` (`projectEnvelope`). Absent param → full payload
  (back-compat); an all-invalid `fields` → `400` so the caller can self-correct.
- `find_wlo_skills` MCP tool (21 → 22 tools; `src/tools/skills.ts` +
  `findSkills` in `src/services/skills.ts`) — finds WLO "skills" (reusable
  instruction Markdown curated as uploaded files in a WLO collection) matching a
  task and returns their raw instructions to apply. Reuses `listCollectionContents`
  and fetches each match's raw Markdown via the new `getNodeDownloadText`
  (anonymous `eduservlet/download`). `nodeId` defaults to `WLO_SKILLS_COLLECTION_ID`.
  Gives natively-registered MCP clients the same skills capability as the
  launcher/REST path.
- `GET /api/collection` REST endpoint (`src/rest/routes.ts` +
  `listCollectionContents` in `src/services/search.ts`) — lists or searches a WLO
  collection's contents (`{ collectionId, query, total, results }`, each result
  carrying the anonymous `downloadUrl`). Without `q` it lists direct file children
  via `/children` (reliable for reference collections); with `q` it searches
  within. `nodeId` defaults to the new `WLO_SKILLS_COLLECTION_ID` env var. This is
  the prompt launcher's **skills** source: skills live as uploaded Markdown files
  in a WLO collection; their title/description say what each does, and the
  `downloadUrl` serves the raw instruction text.
- Deployment for the self-hosted vServer (Docker):
  - Optional real Server-Sent-Events streaming on `POST /mcp`, gated by `MCP_SSE`
    (`src/mcp-transport.ts`; truthy → `enableJsonResponse:false`). Required by
    ChatGPT developer mode; JSON mode stays the default for back-compat.
  - The Docker image now bundles the built widgets (`dist-widgets/`) and the
    public launcher + skills (`public/`), so widgets render and
    `/launcher.html` + `/api/skills` serve from the container. `MCP_SSE=1` is the
    image default.
  - `docker-compose.yml` (env/ports/restart/healthcheck) with an annotated
    reverse-proxy note — SSE requires `proxy_buffering off;`. A `.dockerignore`
    keeps the build context lean.
  - Submission collateral: `docs/PRIVACY.md` (stateless, read-only, no PII stored)
    and `docs/apps-sdk-submission-checklist.md` (each requirement mapped to its
    implementing artifact + golden demo prompts).
- `docs/apps-sdk-golden-prompts.md` — a developer-mode evaluation set (direct /
  indirect / negative prompts mapped to the expected tool + widget, plus a
  precision-recall log) to dogfood tool selection and confirm the widgets render
  (audit items S4 + the P3.6 render/drill-down gate). Linked from the README
  (DE/EN) and the submission checklist.
- Four optional retrieval tools (17 → 21 tools), each read-only and additive:
  - `lookup_wlo_publishers` (`src/services/publishers.ts`) — the publishers/
    sources (`ccm:oeh_publisher_combined`) with per-publisher content counts via a
    facet aggregation, optionally scoped by query/discipline/educationalContext.
    For discovering valid `publisher` filter values.
  - `get_related_content` (`src/services/related.ts`) — "more like this": reads a
    seed node's disciplines + educational contexts and searches for other material
    with the same profile (seed excluded); optional `includeSiblings` adds the
    primary parent collection's other contents.
  - `get_collection_stats` (`src/services/stats.ts`) — a collection's composition:
    total file/sub-collection counts plus a breakdown of its files by resource
    type/subject/level, tallied over the actual child files (accurate for
    reference collections, where a facet query returns nothing).
  - `get_node_breadcrumb` (`getNodeBreadcrumb` in `src/wlo-api.ts`) — a collection
    node's ancestor path root → node, from the single-call `/parents` chain
    (cycle-guarded, depth-capped). File nodes have no breadcrumb (empty path).
- Apps-SDK foundation (OpenAI Apps SDK / MCP Apps compatibility):
  - A single registration seam `registerWloTool` (`src/apps/register.ts`) that
    attaches an `outputSchema`, `annotations`, and — when a widget is wired
    (Phase 4) — the standard `_meta.ui.resourceUri` (+ the ChatGPT
    `openai/outputTemplate` alias) in ONE place. zod output schemas
    (`src/apps/outputSchemas.ts`) mirror the existing envelopes and become the
    `structuredContent` contract the model (and later the widgets) read.
  - The display tools `search_wlo_all`, `search_wlo_content`,
    `search_wlo_collections`, `get_subject_portals`, `browse_collection_tree`
    and `get_topic_page_content` now return `structuredContent` alongside the
    unchanged text output (back-compat for non-Apps clients). `get_topic_page_content`
    resolves its swimlane payload in both output formats so the structured
    result is always render-ready.
  - Every tool advertises `annotations.readOnlyHint: true` (all WLO tools are
    read-only); `get_wikipedia_summary` also sets `openWorldHint: true`.
  - A server `instructions` block (`src/apps/instructions.ts`) giving cross-tool
    guidance (the `search_wlo_all` fast path vs. deep-dive tools vs. `search`/`fetch`).
- Two knowledge tools implementing the ChatGPT convention (`src/tools/knowledge.ts`):
  - `search` — lightweight hits `{ results: [{ id, title, url }] }` across WLO.
  - `fetch` — one node's full document `{ id, title, text, url, metadata }`.
  Both duplicate their JSON in `content[0].text` (what ChatGPT reads) and in
  `structuredContent`, and reuse the existing services (`searchAll`, node detail).
- Apps-SDK widget suite (rendered by Apps-SDK / MCP Apps hosts from
  `structuredContent`; non-Apps clients are unaffected):
  - A build pipeline (`src/apps/widgets/build.mjs`, esbuild) that bundles each
    widget's vanilla-TS `main.ts` and INLINES it — together with a shared
    `base.css` and the widget's `styles.css` — into one self-contained HTML file
    under `dist-widgets/<name>.html` (no external `<script src>`/`<link>`, as the
    sandboxed iframe requires).
  - `src/apps/resources.ts` registers each built widget as a `ui://` resource
    (MIME `text/html;profile=mcp-app`, content-addressed URI, `_meta.ui.csp`/
    `domain` whitelisting the configured edu-sharing origin) and wires its URI to
    the rendering tool via the seam's `widgetUri`. Missing builds degrade
    gracefully (tools keep working without a widget).
  - **W3** shared OER tile (`widgets/shared/tile.ts`): accessible card (meaningful
    German alt text on real thumbnails, decorative icon fallback, one primary
    link, discipline/level/type chips, license/publisher), reused by W1/W2/W4.
    Every interpolated field is HTML-escaped.
  - **W1** combined search results (`search_wlo_all`): Themenseiten / Sammlungen
    (emphasized) / Inhalte sections of tiles.
  - **W4** topic-page swimlanes (`get_topic_page_content`): per-swimlane heading +
    tile grid + a "more on the topic page" link.
  - **W2** interactive collection browse (`get_subject_portals` /
    `browse_collection_tree`): a keyboard-operable disclosure tree that drills
    deeper via `window.openai.callTool('browse_collection_tree', …)` and persists
    the open path via `setWidgetState`; a pure reducer drives the state.
  - Widgets are theme-aware (light/dark), WCAG 2.2 AA (contrast tokens, focus
    rings, no nested scroll, ≥24px targets), and localized (DE default, EN
    fallback) via a tiny string table honoring `window.openai.locale`.
- Public read-only REST layer (`src/rest/`, served by `http.ts` only — **not**
  the Vercel handler): four `GET` endpoints that are thin wrappers over the
  existing services, for non-MCP AI tools and the prompt launcher.
  - `GET /api/search` (→ `searchAll`, all `include*` flags as query params),
    `GET /api/compendium` (→ `getCompendiumTexts`, `ids`/`nodeId`, ≤25),
    `GET /api/topic-page` (→ `getTopicPageContent` + `resolveTopicPageSwimlanes`),
    `GET /api/wikipedia` (→ `fetchWikipediaSummary`, `404` when no article).
  - `routeRestRequest` is a pure, offline-testable core (returns `{status, json}`
    or `null` for a non-owned path); `handleRestRequest` is the thin `http.ts`
    adapter. Inputs validated server-side (`validate.ts`: query ≤200, nodeId ≤50,
    ≤25 ids, integer clamps, enum `targetGroup`); non-`GET` → `405`; unknown
    `/api` path falls through to `404`; a service error becomes a generic `500`
    (no internal detail leaked). CORS `*` for `GET`; its own per-IP limiter
    `API_RATE_LIMIT_RPM` (default 30/min → `429`).
- Prompt launcher (HTTP mode) — a static, bilingual (DE/EN) page for AI tools
  without MCP, backed by the public REST layer:
  - `public/launcher.html`: a self-contained page (no third-party scripts, fonts,
    or requests) that hands an AI chat the *knowledge* to use the WLO REST API
    itself, rather than sending one canned search. The generated message explains
    the search endpoint (`GET /api/search?q=…` + filters/flags, load JSON raw and
    summarise), the other endpoints, and that ready-made skills are loadable by URL
    (`GET /api/skills` → `GET /api/skills/<id>`). An optional query + Fach/Stufe/Typ
    filters are woven in as a concrete example and drive a "Load raw result" button
    (direct content search). The message can be copied into any chat or opened via a
    deep link in Claude (`claude.ai/new?q=`), ChatGPT (`chatgpt.com/?q=`), or
    Microsoft Copilot (`copilot.microsoft.com/?q=`); Gemini (no native URL prefill)
    opens the app with the message placed on the clipboard. Prefills from `?q=`
    (bookmarklet). WCAG 2.2 AA: labelled fields, keyboard-operable, theme-aware
    (`prefers-color-scheme`), reduced-motion respected.
  - Served by `http.ts` via a new static route (`src/rest/static.ts`:
    `resolveStaticRoute` pure core + `handleStaticRequest` adapter, allow-list only
    → no path traversal). `GET /launcher.html` and `GET /` serve the launcher,
    `GET /bookmarklet.md` the bookmarklet doc; `POST /` remains the MCP endpoint.
  - URL-loadable skills for AI apps (`src/rest/skills.ts`): a registry + raw loader
    behind `GET /api/skills` (catalogue `{ skills: [{ id, name, description, path }] }`)
    and `GET /api/skills/<id>` (raw Markdown, `text/markdown`; `404` for unknown id).
    `<id>` is a stable slug now, intended to become a WLO nodeId later. Two skills
    ship in `public/skills/` (`wlo-search`, `wlo-topic-launcher`). The REST result
    type gained an optional raw-text body so `handleRestRequest` can serve Markdown.
  - `public/bookmarklet.md` (selection → launcher, install docs, DE/EN).
- Three new tools:
  - `get_wikipedia_summary` — a short Wikipedia lead extract (+ link, optional
    thumbnail) for a term, to complement WLO material with encyclopedic context.
    Backed by a dependency-free Wikipedia REST client (`src/wikipedia-api.ts`)
    with opensearch title-resolution fallback, a descriptive User-Agent, the
    shared upstream timeout, and ISO-639 language hardening. `readOnlyHint` +
    `openWorldHint`.
  - `get_compendium_text` — the FULL, untruncated editorial compendium text of
    one or more collections (bulk, ≤25 ids), for when a search result shows only
    the 500-char preview. Backed by `src/services/compendium.ts`.
  - `search_wlo_within_collection` — filtered full-text search scoped to a single
    collection subtree (`virtual:primaryparent_nodeid`), reusing the vocab filter
    builder. Backed by `src/services/search.ts`.
- `search_wlo_all` enrichment flags (all opt-in, default off; each runs in the
  existing bounded/parallel pattern): `skipCount` (content paging),
  `includeCompendium` (gap-fill full compendium for collections/topic pages),
  `includeTextContent` (stored full text per content item, capped 4000),
  `includeWikipedia` (a `wikipedia` summary for the query), and
  `includeTopicPageContent` + `maxPerSwimlane` (resolved swimlane content per
  topic page). The tool body moved into `src/services/search.ts::searchAll`
  (reused by the coming REST layer and widgets); the default-flag envelope is
  unchanged.
- `search_wlo_topic_pages`: optional `includeContent` (+ `maxPerSwimlane`) —
  in JSON mode, attach each topic page's resolved swimlane content in the same
  call (bounded ≤5 parallel).
- `browse_collection_tree`: optional `includeContentPreview` (1–5) — attach the
  first N content items of each sub-collection as a `contentPreview` array
  (bounded pass), a peek inside without a second call.
- `FormattedNode.compendiumText` — the editorial compendium text
  (`ccm:oeh_collection_compendium_text`), a curated prose summary of what a
  collection covers and the most authoritative source for a collection overview
  when present. Carried by the detail tools (`get_node_details` /
  `get_nodes_details`, full text via `-all-`) and — since it is part of
  `DISPLAY_PROPS` — by collection search/list/browse, so a collection result can
  be oriented on without a second call; `markdown` output caps it at 500 chars to
  stay lean, `json` keeps the full field. Absent (undefined) on nodes without the
  property; no extra round-trips.
- Search tools (`search_wlo_content`, `search_wlo_all`): optional `includeFacets`
  — returns facet counts (`learningResourceType` / `discipline` /
  `educationalContext`, resolved to labels) in `_queryMeta.facets`, so callers can
  offer targeted narrowing ("how many videos vs. worksheets?") without
  probe-searches. The facet aggregation runs in parallel with the main search
  (≈0 added latency, verified live: ~130 ms serial). Opt-in; default output
  unchanged.
- `search_wlo_content`: optional `includeTextContent` — enriches each result
  with its stored full text (crawled webpage/PDF, capped) in the same call,
  saving a follow-up `get_node_details`/`get_nodes_details` round-trip when the
  caller needs the text of the top hits. Opt-in (adds one round-trip per result),
  bounded concurrency; the default output is unchanged.
- Search tools (`search_wlo_content`, `search_wlo_all`): a vocab filter that
  cannot be resolved to a URI (e.g. `discipline: "Xyz"`) — previously dropped
  silently — is now reported in `_queryMeta.unresolvedFilters` (`{field, value}`),
  so callers can self-correct (e.g. via `lookup_wlo_vocabulary`) instead of
  silently getting unfiltered results. Omitted when everything resolves.
- `browse_collection_tree`: accepts a `subject` NAME (e.g. "Mathematik" or the
  abbreviation "Mathe") as an alternative to `nodeId` — resolved to its Fachportal
  server-side (tiered exact → prefix → substring match), so callers can drill down
  by subject without a preceding `get_subject_portals` round-trip. `nodeId` still
  works unchanged; an unknown subject returns the list of available Fachportale.
- `get_nodes_details`: optional `includeTextContent` / `includeParents` flags —
  bulk-enrich each node with its stored full text and/or parent collections in a
  single call (bounded concurrency), mirroring `get_node_details`. Opt-in; the
  default metadata-only output is unchanged.
- Offline test suite (`node:test`, `npm test`): vocabulary, formatter, reranker,
  API URL helpers, server registration (MCP in-memory), fetch-mocked search
  pipeline and handler tests, plus rate-limiter, body-reader, and client-IP tests.
- GitHub Actions CI (`.github/workflows/ci.yml`): build + test on Node 20, with a
  gate on shipped high/critical vulnerabilities
  (`npm audit --omit=dev --audit-level=high`).
- Structured JSON logger (`src/logger.ts`) — writes only to stderr (stdio-safe);
  all tool errors are now logged server-side via a central `toolError` helper.
- HTTP-mode hardening: per-IP rate limiting (`RATE_LIMIT_RPM`, default 120/min →
  `429`), request-body size limit (`MAX_BODY_BYTES`, default 1 MB → `413`),
  upstream timeout for every edu-sharing request (`WLO_FETCH_TIMEOUT_MS`, default
  10 s) via a central `wloFetch` wrapper, and `TRUST_PROXY` for correct per-client
  rate limiting behind a reverse proxy.
- Docker `HEALTHCHECK` on `/health`; `engines` field (`node >=20`).
- Documentation set, English-canonical with German copies: `README.md` /
  `README.de.md`, `CONTRIBUTING.md` / `CONTRIBUTING.de.md`, `PERFORMANCE.md` /
  `PERFORMANCE.de.md`.

### Changed
- **M4 — topic-pages god-function split (behavior-preserving):** the ~180-line
  `search_wlo_topic_pages` handler is now a thin pipeline. Mode C's page-variant
  enrichment (`listThemePageVariants`) and the A/B/C mode dispatch
  (`collectThemePages`) plus the `_queryMeta` builder (`buildTopicPagesMeta`) stay
  in `src/tools/topic-pages.ts`; the pure merge/sort and JSON/Markdown rendering
  moved to a new `src/tools/topic-pages-present.ts` (`mergeThemePages`,
  `renderThemePages`) — now unit-tested in isolation (`tests/topic-pages-present.test.ts`,
  8 cases: dedup/merge, alpha+relevance sort, slice, title fallback, both renderers).
  Verified by the existing MCP-level suite (unchanged) plus the new units.
- **Audit-final maintainability (no behavior change):** de-duplicated the
  `workspace://SpacesStore/` stripping helper (three copies →
  one `stripStoreRef` in `src/wlo-node.ts`, re-exported via the `wlo-api` barrel);
  named the node-details full-text caps (`TEXT_CONTENT_CAP` 4000 for JSON/bulk,
  `TEXT_CONTENT_MARKDOWN_CAP` 2000 for the human markdown preview) instead of stray
  literals; documented that the Vercel serverless path (`api/mcp.ts`) needs a
  platform (Vercel Firewall) rate rule since in-memory limiting is ineffective on
  serverless; corrected a misleading relevance-sort comment and the `CLAUDE.md`
  tool count (12 → 22).
- **REST layer split (no behavior change):** `src/rest/routes.ts` grew past the
  ~300-line threshold with the search enrichments above, so the per-endpoint
  handlers moved to `src/rest/handlers.ts` and the shared `RestResult`/`badRequest`
  to `src/rest/result.ts`; `routes.ts` is now just the router + node:http adapter.
  Verified behavior-preserving by the existing REST tests.
- **Launcher AI-picker polish:** dropped the decorative per-chip dot — it rendered
  as a stretched oval in the flex row and carried no information (identical on every
  chip) — and now mark the selected AI with a trailing check. The check is a
  non-colour selection cue (WCAG 1.4.1) on top of the existing border/background/
  text change (`public/launcher.html`).
- Apps-SDK hardening + cross-host portability (from the 2026-07-16 compliance
  audit): widgets now use a portable host bridge (`src/apps/widgets/shared/host.ts`
  + unit-tested `host-bridge.ts`) — `window.openai` under ChatGPT AND the standard
  MCP-Apps `ui/*` postMessage bridge in any other host, so the same widget code is
  portable. The seam emits `_meta.ui.widgetAccessible` (+ `openai/widgetAccessible`)
  for widget-callable tools (`browse_collection_tree`). The widget MIME is
  env-configurable (`WLO_WIDGET_MIME`, default `text/html;profile=mcp-app`). The
  `search`/`fetch` `url` always falls back to the absolute render URL, and the
  server `instructions` block was trimmed to ≤512 chars (fast path first).
- Uniform read-only tool defaults applied once in `src/apps/tool-defaults.ts`
  (`applyReadOnlyToolDefaults` wraps both registration paths — no call-site
  churn): every tool declares its anonymous stance via
  `_meta.securitySchemes: [{ type: 'noauth' }]` (the base-SDK `_meta` mirror the
  host/submission scan reads) and the Apps-SDK-required `destructiveHint:false` /
  `openWorldHint:false` annotations (explicit per-tool values, e.g.
  `get_wikipedia_summary`'s `openWorldHint:true`, are preserved). Widget-callable
  tools now also emit the current standard `_meta.ui.visibility: ["model","app"]`
  (the gate for widget→host `tools/call`) alongside the legacy
  `widgetAccessible` aliases. Verified against the live Apps-SDK docs 2026-07-16.
- Per-tool ChatGPT invocation status strings
  (`_meta["openai/toolInvocation/invoking"|"invoked"]`, ≤64 chars, German) — a
  short label shown while each tool runs / after it finishes. Copy table in
  `src/apps/tool-status.ts`, stamped by name via `applyReadOnlyToolDefaults`; a
  non-ChatGPT host ignores these `openai/*` keys.
- `search_wlo_collections`: the multi-level keyword tree-traversal fallback was
  extracted from the tool handler into the named, independently-tested
  `findCollectionsByTreeTraversal` (`src/tools/collections.ts`); behaviour
  unchanged (the level-1 → level-2 → scored-level-3 caps are preserved).
- `wlo-api.ts` (475 lines) split by responsibility into `wlo-config.ts` (env +
  fetch + shared types + DISPLAY_PROPS), `wlo-search.ts` (search endpoints) and
  `wlo-node.ts` (node endpoints + URL builders); `wlo-api.ts` is now a thin barrel
  re-export so callers still import from `./wlo-api.js` unchanged.
- Prompt launcher (`public/launcher.html`) redesigned around **Boerdi**, the WLO
  owl mascot (self-contained inline SVG, blue theme, theme-aware, WCAG AA): the
  primary flow is now an AI picker (radio chips) plus one **Open** button; the
  targeted-search fields and the instruction preview collapse into `<details>` so
  the default view is simple. The injected instruction now sources skills from
  `GET /api/collection` (each result's `downloadUrl` serves the raw Markdown) and
  points natively-registered clients at the `find_wlo_skills` tool. Still bilingual
  DE/EN, no third-party assets.
- `server.ts` split from a ~1500-line file into responsibility-scoped modules
  under `src/tools/*`; topic-page API extracted to `src/topic-page-api.ts`; the
  HTTP rate limiter and body reader extracted to `src/rate-limit.ts` /
  `src/read-body.ts`. Behavior unchanged.
- `getCollectionMetadata` → `getNodesMetadata` (old name kept as a `@deprecated`
  alias for one release).
- `mapPool` is fault-tolerant: a failed item becomes `null` (logged) and no longer
  aborts the whole batch.
- Dockerfile hardened: runs as the non-root `node` user, base image pinned by digest.
- `@modelcontextprotocol/sdk` updated to ^1.29.0.
- Reranker: stopwords no longer contribute to the relevance score.
- **All code comments translated to English.** German runtime/product strings
  (tool descriptions, output text) intentionally kept German.
- README/docs completely rewritten: all 12 tools documented (including
  `get_topic_page_content`, previously missing), full module tree, complete
  `FormattedNode` schema, all environment variables.

### Fixed
- **Markdown skills / launcher prompt now search instead of only advising:** the
  two prompt-launcher skills (`public/skills/wlo-search.skill.md`,
  `wlo-topic-launcher.skill.md`) and the launcher's `instruction_tpl`
  (`public/launcher.html`, DE + EN) read as API reference docs and carried an
  unresolved `BASE = https://YOUR-WLO-HOST` placeholder, so a chat following them
  described the API and recommended filters but never called `/api/search`. They
  now (a) resolve `{BASE}` self-referentially to "the origin you loaded this skill
  from", and (b) lead with an imperative "issue the request now, don't just
  advise" directive plus a one-line fallback for chats without a fetch tool. The
  target endpoint was verified working (live read-only smoke: "Photosynthese" +
  Biologie → 74 content hits). Guarded by `tests/rest-skills.test.ts` (no
  placeholder host, self-resolving base, act-now directive) and the new
  `tests/launcher-instructions.test.ts`.
- Node IDs are URL-encoded before interpolation into upstream URLs
  (`encodeURIComponent`), preventing path/query manipulation.
- Removed dead code: the unused `ngsearchCollections` export.
- Documented the differing `total` semantics of `search_wlo_all` and recursive
  `get_collection_contents` (field names kept stable).

### Security
- Widget links are now **URL-scheme validated**: a new `safeHref` guard
  (`src/apps/widgets/shared/safe-url.ts`) drops any node-derived URL whose scheme
  is not http(s)/mailto before it becomes an `href`, so a `javascript:`/`data:`
  value in the external, publisher-supplied `ccm:wwwurl` metadata can no longer
  render as a clickable link in the widget iframe (defense-in-depth alongside the
  existing HTML escaping and the widget CSP). Applied to all four href sites
  (tile, topic-page, browse open + leaf links). Audit finding 2026-07-15 F1.
- Fixed the **shipped** transitive vulnerabilities from the SDK dependency tree
  (hono, express, path-to-regexp, qs, fast-uri, …) via `npm audit fix` — the
  production audit is now free of high/critical advisories.
- Remaining `undici` CVEs are confined to the `@vercel/node` **dev** dependency
  and are not shipped (see README "Security & operations").
- `excludeNodeIds` parameter capped at 200 entries.
