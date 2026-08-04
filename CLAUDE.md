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
  write tools are absent in anonymous mode AND refuse at call time;
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

- `src/server.ts` — transport-agnostic `createMcpServer(writeMode)` factory; the
  only place tools are wired up. The write mode decides whether the curation
  tools are registered at all, so each entry point resolves the request's
  credential BEFORE building the server. Two thin entry points connect a
  transport to it: `stdio.ts` (local/Docker) and `http.ts` (self-hosted
  Streamable HTTP + rate limit + body cap — the production path).
- `src/tools/*` — the 26 read tools (25 unconditional, of which `get_url_text`
  is declared `unsafe` and removable via `WLO_DISABLE_UNSAFE_TOOLS`;
  `find_wlo_skills` needs `WLO_SKILLS_COLLECTION_ID`) plus the 13 curation tools (`curation-*.ts`,
  registered only with a write-capable identity; `curation-shared.ts` holds the
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
  `src/topic-page-structure.ts` — one page's variant → swimlanes.
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
  /children fallbacks. `src/vocabs.ts` — local vocabulary label↔URI tables (no
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
