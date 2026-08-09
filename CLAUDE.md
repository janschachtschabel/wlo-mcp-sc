# WLO MCP Server

MCP server that exposes WirLernenOnline (WLO) OER content — search, collections,
topic pages, node details — to AI agents over the Model Context Protocol.
Being extended to be OpenAI Apps-SDK compatible, more token-efficient (fewer
sequential tool calls), and richer (compendium texts, Wikipedia, a low-barrier
prompt-launcher). See the active plan below before implementing.

## Coding workflow (better-coding skills)

This project uses the better-coding skill set. Follow this process for all
coding work, and re-invoke the relevant skill before each new package or
coding section — skills unload as the session grows, so do not assume one is
still in context because it loaded earlier.

Pipeline: start (boot, once) → orient (route) → plan (design) → workflow
(implement) → review → verify. Bug: debug → workflow → review → verify.
Whole-repo health/security: audit. UI: pair frontend with workflow.

The skills and what each is for:
- /better-coding-start    — boot the workflow once per session; write/refresh this block
- /better-coding-orient   — route a new/unscoped task; understand unfamiliar code before changing it
- /better-coding-plan     — design & spec a non-trivial feature before code; produce the task list
- /better-coding-workflow — write or change any code (the engineering discipline)
- /better-coding-frontend — build or audit UI: accessibility, UX states, i18n, privacy
- /better-coding-review   — review a diff/PR before merge (read-only, severity-tagged)
- /better-coding-audit    — whole-repo health & security check (12 dimensions)
- /better-coding-debug    — anything broken: bug, failing test, build break (root-cause first)
- /better-coding-verify   — before claiming done/fixed/passing (evidence gate)
- /better-coding-help     — explain the set (for humans)

Re-invocation rule (skills unload — reload before each unit of work):
- Before EACH implementation package or coding section: /better-coding-workflow
  (plus /better-coding-frontend when it touches UI)
- Before reviewing a diff: /better-coding-review
- Before claiming done/fixed/passing: /better-coding-verify
- When something breaks: /better-coding-debug
Self-check: about to write code with no recent "better-coding-workflow active"
line in context → the skill has unloaded; reload it first.

Interaction language: German for conversation, questions, and reports. Code,
identifiers, comments, commit messages, and docs (README, CHANGELOG) remain
English. User-facing artifacts (launcher page copy, tool descriptions shown to
end users) may be bilingual DE/EN.

## Active plan

The current rebuild/extension is designed in:
- **Status (READ FIRST on resume): `docs/plans/STATUS.md`** — live progress
  tracker; says which phase is done and which task is next, with evidence.
- Design: `docs/plans/2026-07-15-wlo-mcp-apps-sdk-rebuild.md` (goal, approach,
  architecture, non-functional, risks — the source of truth for scope)
- Tasks:  `docs/plans/2026-07-15-wlo-mcp-apps-sdk-tasks.md` (9 phases P0–P8,
  dependency-ordered, TDD; each phase opens with a `/better-coding-workflow`
  refresh step, UI phases also `/better-coding-frontend`)
- **Write support / curation — COMPLETE (all 6 phases, 22 tasks, 2026-08-01):**
  - Design: `docs/plans/2026-08-01-write-support-design.md`
  - Tasks:  `docs/plans/2026-08-01-write-support-tasks.md` (22 tasks, 6 phases)
  - Evidence: `docs/plans/2026-07-31-write-support-research.md` — every factual
    claim is measured there; do not re-derive or contradict it without a new
    measurement.

  Targets **staging**. Six rules bind the implementation and still bind any
  change to it: every write reads back (three edu-sharing mechanisms discard a
  write while answering `200`); every mutation is confirmed two-step (preview +
  single-use token) before it happens, and EVERYTHING the call will send must be
  in the previewed change set, because the token is bound to a fingerprint of it
  (a free-text note beside the change set is an approval for text nobody saw);
  write tools refuse at call time — and since 2026-08-05 they are LISTED for
  every caller, which reverses the earlier half of this rule ("absent in
  anonymous mode") deliberately and on the user's decision: a model that never
  sees a write tool never calls one, so nothing ever asks the host to log the
  user in, and a connector stays anonymous forever. The refusal is unchanged and
  absolute; it now carries `_meta["mcp/www_authenticate"]` so the client starts
  the login. Every curation tool goes through `registerCurationTool`
  (`tools/curation-shared.ts`) — the one place that stamps `oauth2` and runs the
  gate, enforced by `tests/shared-rule-discipline.test.ts`;
  `ccm:oeh_lrt_aggregated` is never written by us (the repository derives it);
  accepting a suggestion writes and reads back BEFORE it marks the suggestion
  accepted — an `ACCEPTED` proposal over a record that never got the value reads
  as work already done; and an ABORTED request is reported as an open outcome,
  never as a failure — the abort hits the response, not the work, so every
  curation `catch` goes through `timeoutOrError` (`tools/curation-shared.ts`)
  rather than `toolError`.

  Live pass against staging done 2026-08-02 (STATUS.md). It found two defects
  that every test had missed — `wlo_create_collection` and
  `wlo_rename_collection` never worked, because the tests asserted our own
  inferred request body back to us against a faked upstream. Measurements in the
  research doc §9. Lesson that binds future work: a test against `fetchMock`
  proves the code sends what we decided to send, never that the repository
  accepts it. `wlo_submit_content` was verified separately (§10) and gained the
  read-back it lacked. Every curation tool has now run against a real repository.

- **URL-based full-text tool + generic unsafe-tool switch — IMPLEMENTED
  (2026-08-03; P0–P4 done, see the tasks file's progress table):**
  - Design: `docs/plans/2026-08-03-url-text-tool-design.md`
  - Tasks:  `docs/plans/2026-08-03-url-text-tool-tasks.md` (16 tasks, 5 phases)

  Adds ONE read tool, `get_url_text` (arbitrary URL → text via the extraction
  service), and a generic mechanism by which a tool declares itself `unsafe` and
  the operator switches it off with `WLO_DISABLE_UNSAFE_TOOLS`. Unsafe tools are
  registered BY DEFAULT, so a startup warning naming each one is part of the
  design. The tool is documented as **not for production**: we never fetch the
  target ourselves — Playwright inside the extraction service does — so a
  redirect to a private address, or a DNS answer that changes between our lookup
  and the service's, cannot be seen at this layer. Closing that needs
  resolution-time enforcement inside the fetching service. What IS enforced
  (`src/url-safety.ts`): the literal host check — including IPv4-mapped IPv6,
  a hole found and closed 2026-08-03 that was live on the existing `ccm:wwwurl`
  path — plus a check of the RESOLVED addresses, which catches a public name
  whose record points inside. Decimal/hex IPv4 literals need no handling:
  `new URL()` normalises them to dotted quad first (measured). Feeding extracted
  text into the curation path is explicitly out of scope.

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

- **OAuth 2.1 für alle Clients — IN ARBEIT, P1–P4 fertig, nur P5 (live + Doku) offen (2026-08-05):**
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

- **Skill-Abruf (`search_skill` / `get_skill`) — COMPLETE (2026-08-08),
  Redaktions-Anleitung: `docs/SKILLS.md`, Verlauf in `STATUS.md`:**

  A skill is a `ccm:io` whose **content type** marks it
  (`ccm:oeh_extendedType = …/contentTypes/ai_prompt`, full URI — the slug matches
  nothing) and whose attached file is the `SKILL.md`. Both tools are registered
  unconditionally; `WLO_SKILLS_COLLECTION_ID` only NARROWS the search, and
  `WLO_SKILL_TOOL_MODE=one-tool` swaps both for `get_skill_for_task`.

  Four measurements bind any change here (2026-08-08, re-measure before
  contradicting): (1) `ngsearch` returns **no collections at all**
  (`contentType=FOLDERS` → 0) and the collections endpoint takes **only**
  `ngsearchword` — so a skill must stay a `ccm:io`, and a collection scope must be
  WALKED (`virtual:parent_recursive` → 400 on ngsearch, unlike the page_variant
  query). (2) That walk is level-parallel and bounded on three axes; sequential it
  took 90.3 s over a subject portal. Any collection left unread — cap, depth or a
  failed listing — must be logged, and a root that is wholly unreadable THROWS
  rather than reporting an empty catalogue. (3) `ccm:original` is the identity: it
  is in the projection, results dedupe on it, and the original wins over a
  reference. (4) The instruction TEXT reads fine through a reference id; only the
  companion-folder lookup has to resolve `ccm:original` first.

  Two rules the tool layer holds: the server-derived sections (file manifest,
  `:::` references) are rendered BEFORE the untrusted document, because after it
  they are indistinguishable from sections the document forged; and a companion
  is pointed at the tool that fits its MIME type — `get_skill` returns the file
  VERBATIM, so anything that is not `text/*` goes to `get_wlo_content_text`.

- **Use-Case-Lücken (Lizenzfilter, Usage, Themenseiten-Variante) — COMPLETE
  (2026-08-09):** `docs/plans/2026-08-09-usecase-gap-tools.md` (design + tasks in
  one file). Three packages, of which one is deliberately NOT built.

  **P1 licence filter** — see `filter-criteria.ts` under Architecture above. One
  rule sits outside it and binds any change: the OER BUNDLE fans out over its
  five keys and merges round-robin (`services/license-search.ts`). Sending no
  criterion and filtering the generic page locally — the first version — answered
  "kein Treffer" over the 18 793 OER records staging holds for `Mathematik`,
  because relevance ranking and licence are unrelated and the top fifty carried
  no `ccm:commonlicense_key` at all. Concatenating the five instead of
  interleaving them handed the whole cap to the first key (six hits, all CC 0,
  while 11 563 CC BY-SA never appeared). Both were invisible to every test.
  Measure with FACETS before contradicting any of this: `ngsearch` takes
  `facets: string[]` and counts exact keys server-side over the whole result set.

  Three further rules from working the review's leftovers (2026-08-09): the
  facet total is DISCARDED when the bucket list is full (`FACET_LIMIT`, one
  exported constant) — a possibly-truncated sum understates the corpus while
  looking exact, and staging's 16 keys are a property of that instance;
  EVERY path that accepts `license` must disclose its exactness pass, which is
  why `searchAll` carries `content.licenseFilter {checked, kept}` (neither
  `count`, post-cap, nor `total`, the corpus, can stand in for it); and paging
  the BUNDLE is not a partition — the same `skipCount` goes to all five keys, so
  the tools say so and point at `excludeNodeIds`.

  "EVERY path" is literal and was found violated on two of the five the day it
  was written (2026-08-09), both in `rest/`: **an envelope field is not a
  disclosure if the renderer drops it.** `/api/search?format=html` accepts
  `license`, ran the pass, and rendered nothing — an emptied result read as a
  bare "Keine Treffer." over material that is demonstrably there — and
  `/api/collection?q=…` returned only its post-filter `total`, which is
  indistinguishable from an empty collection. The page now carries the sentences
  through `warnings`, and the counts come from the UNPROJECTED envelope, because
  `fields` may drop `licenseFilter` and a disclosure that disappears when the
  response is trimmed is no disclosure. Counting the paths is the check: three
  MCP tools plus `/api/search` (JSON and HTML) plus `/api/collection`.
  `search_wlo_within_collection` deliberately has no paging notice — it slices
  ONE locally filtered list, so its paging is a real partition.
  `content.licenseFilter` exists exactly when a licence was given AND the content
  leg ran (`include`), and that is deliberate: it is the SINGLE gate both
  `search_wlo_all` and the HTML page hang their sentences on. Emitting it as
  `{checked: 0, kept: 0}` for a collections-only call read like a filter that
  emptied the bucket, and re-deriving the condition from `include` per call site
  is a second copy of one rule — which is how the paging notice came to fire over
  a content search that never happened, twice.

  A review of that fan-out (2026-08-09) found three more, and they bind too. (a)
  The reported total is the FACET count of exact keys (`exactLicenseTotal`),
  never a sum of the keys' `pagination.total`: the families NEST — `CC_BY`
  contains `CC_BY_SA` (Mathematik 27 351 vs 3 848 + 9 554) and also the NC/ND
  records — so summing overstated by 98–164 % (`Mathematik` 37 851 for 14 343),
  and a single licence reported its family (343 over a list of 42). Facet buckets
  are matched through `resolveVocab`, the SAME resolution `filterByExactLicense`
  applies to a node, because the index holds `CC BY-SA` with spaces as its own
  key — count and list must not disagree about what counts. (b) Every path that
  accepts `license` needs its own exactness pass: the bundle contributes NO
  criterion, so `search_wlo_within_collection`, which matches locally, filtered
  nothing at all and answered `license: "OER"` with CC BY-NC-ND. (c) Losing one
  key is tolerated, losing ALL five throws — an empty merge is indistinguishable
  from "there is no freely reusable material on this topic".

  **P2 `wlo_register_usage` — not built, and the reason binds any retry.** The
  write endpoint is gated on an **application signature**, not a user: `POST
  /usage/v1/usages/repository/-home-` answers 403 `app signature required` for an
  authenticated service user, for every `appId` tried and for an EMPTY body (so
  the gate precedes the body), and 500 `Signature could not be verified!` when
  the four `X-Edu-App-*` headers are present but bogus — including with a
  registered app id. `prepareUsage` answers 200 and records nothing. The READ
  side works and is empty everywhere. Getting a key is not a code change: an
  edu-sharing app signature lets its holder act for arbitrary users, which
  reverses this server's auth design. Operator decision, not a task.

  **P3 `wlo_set_topic_page`** — the 14th curation tool and the only one whose
  result is immediately public: it sets `default` in `ccm:page_config`, which
  decides which variant a Themenseite renders. Measured 2026-08-09 and the reason
  every check is local: the repository validates NOTHING — `POST …/property`
  stored the literal `"not json at all"` and answered 200, and accepted the
  property on a `ccm:io`. Rules that bind any change: the stored document is
  EDITED, never composed (`setDefaultVariant` in `topic-page-config.ts`, which
  keeps unknown keys and the variant list — 28/28 real documents carry
  `variants[]`, only 2/28 a `default`); the value is written as a store ref
  (`toStoreRef`, the inverse of the `stripStoreRef` every read applies); a
  variant that is not a usable child of THIS page's config folder is refused, and
  an unreadable child listing is refused as unreadable rather than as "no such
  variant"; the read-back compares the PARSED document, because a repository
  that stores whatever it is handed proves nothing by echoing our bytes; and a
  no-op (the variant already renders) is refused rather than written again —
  `buildChangeSet` gives the other tools that for free by dropping unchanged
  FIELDS, and this change has none. The
  confirm token binds to the sentence naming page and both variants with ids —
  a document of store refs is not something a person can check in a preview.

Per-package close-out (user protocol): at the end of EACH phase, update
`STATUS.md`, keep it linked here, then stop and let the user clear context
before the next package.

Read the design doc BEFORE implementing; execute the tasks in order and update
their checkboxes as work proceeds. Do not add tools/endpoints not listed there
without updating the plan first (a plan is a contract — see the workflow block).
Decisions already locked: adapt (not rebuild); base-SDK `_meta` seam for
Apps-SDK; vanilla-TS+esbuild widgets; `src/services/` seam for REST/widget
reuse; add ChatGPT `search`/`fetch` tools; Docker/vServer deploy with real SSE.

## Tech stack

- TypeScript (ESM, `module`/`moduleResolution` NodeNext, target ES2022,
  `strict: true`), Node >= 20.
- Runtime deps: `@modelcontextprotocol/sdk` (MCP server + stdio/HTTP transports),
  `zod` (tool input schemas). Deliberately minimal — no web framework.
- Dev: `tsx` (run TS directly), `typescript` (build), `esbuild` (widget bundle).
- Deploy target: **self-hosted persistent HTTP** (`src/http.ts`, Docker on the
  vServer); stdio (`src/stdio.ts`) for local use. There is no serverless target
  — the Vercel entry point was removed on 2026-08-02. Do not reason about
  serverless constraints (cold starts, per-request statelessness as a platform
  limit); the server is a long-lived process.

## Commands

- Build: `npm run build` (tsc → `dist/`)
- Test: `npm test` (→ `scripts/run-tests.mjs`, which expands the file list itself
  — Node 20 takes a `--test "tests/*.test.ts"` glob literally and runs nothing,
  and 20 is what `engines` and the Docker image ship). Single file:
  `node --import tsx --test tests/reranker.test.ts`. `npm test` additionally
  loads `tests/netguard.mjs`, which fails any unmocked non-loopback fetch, so a
  test that forgets `installFetchMock` is caught instead of silently going
  upstream; a single-file run has no such guard. `npm run test:coverage` runs the
  same suite with the runner's coverage report.
- Dev (stdio): `npm run dev` — Dev (HTTP): `npm run dev:http`
- Start built: `npm start` (stdio) / `npm run start:http` (HTTP on `PORT`)
- No linter/formatter is configured; match surrounding style.

## Conventions

- ESM everywhere: intra-project imports MUST use the `.js` extension
  (`./tools/collections.js`) even though the source is `.ts` — NodeNext requires it.
- Each tool group lives in `src/tools/<area>.ts` and exports a
  `register<Area>Tool(s)(server)` function; `src/server.ts` assembles them and
  registration order = display order in `tools/list`.
- Tools return either Markdown or JSON (`outputFormat` param); a trailing
  `_queryMeta` text block carries machine-readable query context (see `shared.ts`).
- Tool-layer helpers live in `src/tools/shared.ts`: `toolError` (log + client
  error), `queryMetaContent`, `pickThemePageTitle`. Two helpers that started
  there are NOT there any more, because `services/` and `rest/` need them and a
  lower layer must not depend on `tools/`: `mapPool` (bounded-concurrency
  fan-out, returns `(R|null)[]` — filter nulls) is in `src/concurrency.ts`, and
  `buildFilterCriteria`/`formatUnresolvedHint` (label→URI vocab mapping) in
  `src/filter-criteria.ts`. The direction is enforced by
  `tests/shared-rule-discipline.test.ts`, not by this sentence.
- Config is env-only (`WLO_REPOSITORY_URL`, `PORT`, `RATE_LIMIT_RPM`, …); no secrets
  in code. See `.env.example`.
- Tests use the built-in `node:test` runner via tsx; upstream HTTP is faked with
  `tests/fetchMock.ts` — no live network in tests.

## Architecture

- `src/server.ts` — transport-agnostic `createMcpServer({ issuer })` factory; the
  only place tools are wired up. It takes NO write mode and no credential: every
  tool, curation included, is registered unconditionally, and the write gate runs
  at CALL time in `registerCurationTool`. (An earlier version did decide
  registration by write mode; that is what 2026-08-05 reversed, and the
  measurement is in the write-support block above — a tool nobody sees is a login
  nobody starts.) Two thin entry points connect a
  transport to it: `stdio.ts` (local/Docker) and `http.ts` (self-hosted
  Streamable HTTP + rate limit + body cap — the production path).
- `src/tools/*` — the 27 read tools (all unconditional, of which `get_url_text`
  is declared `unsafe` and removable via `WLO_DISABLE_UNSAFE_TOOLS`;
  `search` gains the `search_wlo_all` buckets + widget and `fetch` the full
  record + detail widget under `WLO_SEARCH_OUTPUT_MODE=rich`, off by default —
  the switch covers BOTH because `search`→`fetch` is one flow and enriching only
  the first step leaves the second rendering nothing. The convention gives each
  a SINGLE parameter, so output and display are the only part of
  `search_wlo_all`/`get_node_details` that can be copied at all, and whether a
  connector tolerates keys beside the required ones is unmeasured; the
  convention shape therefore stays first and untouched in both modes, pinned by
  `tests/tools-knowledge-rich.test.ts`;
  `search_skill`+`get_skill` become a single `get_skill_for_task` under
  `WLO_SKILL_TOOL_MODE=one-tool`) plus the 14 curation tools (`curation-*.ts`,
  registered unconditionally and gated at call time; `curation-shared.ts` holds
  `registerCurationTool` (the gate + the `oauth2` declaration) and the
  two-step preview/confirm/report they share, `curation-fields.ts` the 13-field
  write surface both editing and proposing draw from), grouped by responsibility (collections,
  content-search, node-details, node-relations, vocabulary, topic-pages,
  topic-pages-present, topic-page-content, browse, compendium, wikipedia,
  collection-stats, health, knowledge, skills) + `shared.ts`.
  The Apps-SDK display tools are registered via `src/apps/register.ts`.
  A tool module holds its schema and its rendering, never an algorithm: bounded
  traversals a tool would otherwise inline live in `src/services/`
  (`collection-traversal.ts`, `topic-page-discovery.ts`).
  A tool that renders its own line-oriented text (browse tree, Fachportal list,
  Themenseiten listing, swimlane outline) must pass every repository-supplied
  value through `oneLine` from `formatter.ts` — a newline in a title otherwise
  forges a second record with a nodeId the next call acts on.
- `src/services/write/*` — the shared write pipeline (gate → fields → change-set
  → confirm → verify). No MCP SDK import; every mutation goes through it, so the
  safety properties are tested once instead of per tool.
- `src/wlo-api.ts` — barrel over the edu-sharing REST client: `wlo-search.ts` +
  `wlo-node.ts` (endpoints), `wlo-config.ts` (env, `DISPLAY_PROPS`, URL
  sanitization), `wlo-types.ts` (`WloNode`/`SearchResponse`), and
  `wlo-node-text.ts` (`/textContent` + the anonymous download, byte-capped), and
  **`wlo-fetch.ts` — `wloFetch` plus the credential boundary**: the only place
  the operator's password is attached, and only ever to the repository host.
  `src/topic-page-api.ts` — topic-page discovery;
  `src/topic-page-structure.ts` — one page's variant → swimlanes;
  `src/topic-page-title.ts` — what may be SHOWN as a page's title. The rule is
  about the VALUE, not the property it came from: `cm:name` is
  `PAGE_VARIANT_<uuid>` by construction, `cm:title` holds it on 109/109
  production variants, and `cclom:title` — the field the code trusted — on
  **22/68 staging** ones, because a page nobody renamed keeps it everywhere. So
  every read from the repository passes through `displayTitleOrEmpty`, and every
  sentence a PERSON has to check names a variant through one rule (`nameOf` in
  `services/write/topic-page.ts`: real title, else the id) — the confirm token
  binds to that sentence, and a technical id is not something anyone can check.
  It is a leaf module and not `tools/shared.ts`, where it started, because
  `topic-page-api.ts`, `topic-page-structure.ts` and `services/write/topic-page.ts`
  all need it and none may import from `tools/`;
  `src/topic-page-config.ts` — the `ccm:page_config` document (which variant a
  page renders, and in which order) — the page builder's schema, which changes
  independently of edu-sharing's endpoints.
  Three rules here rest on measurements in
  `docs/plans/2026-08-07-topic-page-variants-analysis.md` — re-measure before
  contradicting any of them. (1) `targetGroup`/`educationalContext` are filtered
  LOCALLY and an unset value is never excluded (`variantMatchesFilters`, the one
  place the rule lives): ~90 % of production variants carry neither, so an
  upstream filter hides pages instead of narrowing them, and
  `virtual:page_variant_global: ['false']` is a no-op, not an alternative flag.
  (2) Which variant a page RENDERS comes from `ccm:page_config` on the
  page-config folder (`default`, else the first still-existing entry of
  `variants[]`) — not from the child order, which agreed only by accident, and
  not from the target group, because siblings are mostly editorial copies.
  (3) A collection may own SEVERAL page-config folders: group by folder (the only
  key a search hit carries), but count distinct OWNERS, and only the folder named
  by the owner's `ccm:page_config_ref` can hold the rendering variant. Both (3)
  defects were invisible to `fetchMock` and appeared on the first live run.
- `src/wikipedia-api.ts` + **`src/wikipedia-relevance.ts`** — the encyclopedia
  client and the rule that decides which fuzzy search candidate a query is about.
  A direct/redirect hit is trusted (`match: 'exact'`); only search candidates are
  judged, and an off-topic one yields no article at all rather than the closest
  string. Design + the live measurement behind it:
  `docs/plans/2026-08-02-wikipedia-relevance.md` — do not re-derive the rules
  without a new measurement.
- `src/formatter.ts` — node → Markdown/JSON rendering. `src/reranker.ts` —
  quality-based reranking for `enhancedSearch` (query variants live in
  `src/query-expand.ts`). `src/node-match.ts` — local text/criteria matching for
  /children fallbacks. `src/filter-criteria.ts` additionally owns the LICENCE
  rules, and both rest on a measurement (2026-08-09, re-measure before
  contradicting): `ccm:commonlicense_key` matches a licence FAMILY, not a licence
  — `CC_BY` returns 343 hits for "Optik" including CC BY-ND and CC BY-NC-ND, and
  quoting changes nothing, so plain CC BY is the one licence that cannot be
  isolated upstream and the surplus is MORE restrictive than requested.
  `filterByExactLicense` therefore enforces exactness locally, and
  `pageSizeForLicense` widens the candidate window to 50 only when a licence is
  filtered — without it the pass starved and answered "0 Treffer" for a filter
  with 343 hits behind it. `enhancedSearch` ignores its size argument for the
  upstream request (always `POOL_SIZE` per query variant, then trims the ranked
  merge), so the widening is invisible in `maxItems`.
  `src/result-dedupe.ts` — the ONE rule for collapsing
  content hits that share an external URL, used by both independent search paths
  (`searchAll` and `search_wlo_content`) and enforced by
  `tests/shared-rule-discipline.test.ts`. It deduplicates on `ccm:wwwurl`, NOT on
  `ccm:original`: measured 2026-08-09, the eight `Wellenoptik` copies were eight
  separate records each owning itself, so the `ccm:original` rule collapses
  nothing there. The FIRST hit wins, not the newest — the newest was an untouched
  `1.0` copy while the only edited record (`1.2`) was the oldest, and neither
  date nor version is in the search projection. Dedupe runs before the result
  cap; the page is NOT widened to compensate, so a copy-heavy query returns fewer
  results while `total` still reports the real backend count. `src/vocabs.ts` — local vocabulary label↔URI tables (no
  API call). `src/text-sanitize.ts` — makes foreign text safe to embed where it
  carries elevated authority (injected user messages, confirm previews): drops
  invisible Unicode and flattens control characters (`flattenText`), plus a
  length cap (`sanitizeText`). Use `sanitizeText` for ONE foreign value and
  `flattenText` for a sentence assembled from parts already capped — capping an
  assembled sentence again spends the 120-char budget on fixed prose and cuts the
  facts (it truncated confirm previews mid-word until 2026-08-04).
  `src/url-safety.ts` — whether a URL may be handed to a service that will
  fetch it: the literal private-host rule (incl. IPv4-mapped IPv6) plus a
  DNS-resolution check. `src/unsafe-tools.ts` — the operator's off-switch for
  tools that declare `unsafe`; the gate itself sits in `apps/register.ts`, the
  one seam every tool passes through. `src/text-cap.ts` — the shared truncation
  rule (cut at a word boundary, disclose the full length): `capText` for a text
  block, `cutAtWordBoundary` when the caller needs its own marker (the
  confirmation preview is line-oriented, so `\n\n[…gekürzt]` would forge a change
  line), and the exported `TRUNCATION_MARKER` for the byte-capped download, which
  cannot use a character-based cap at all. The ONLY module that may write that
  marker.
  `src/read-json.ts` — the one place an upstream body is parsed: `res.ok` says
  the server answered, not that the body is JSON, so every client goes through
  it and each decides whether a parse failure degrades or throws.
  Both of those "only place" claims are enforced by
  `tests/shared-rule-discipline.test.ts` rather than asserted here — each was
  found violated by modules written after the helper existed (6 and 1
  respectively). A unit test of a helper proves the helper is right and says
  nothing about whether anyone uses it.
  `src/request-url.ts` — the one place an inbound request target is parsed.
  node:http accepts targets `new URL()` refuses (`//[`), and three layers used
  to parse the same `req.url` with only the first one guarded; the throw moved
  down a layer, escaped the handler, and the caller got no answer at all.
  `src/logger.ts`, `src/rate-limit.ts`, `src/read-body.ts` — support.
- `docs/plans/` — design documents, including the
  [full-codebase review plan](docs/plans/2026-08-02-full-review-plan.md) (12
  packages, R1–R12) and its live progress table.
