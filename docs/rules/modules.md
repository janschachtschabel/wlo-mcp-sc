# Module by module: what lives where, and the rule each one holds

Binding rules for this area, moved verbatim out of `CLAUDE.md` on 2026-11-14 (the file had grown to 2154 lines).
A dated sentence records what was measured or decided that day; where a later block says "superseded", the later one holds.
Index: [README.md](README.md) · short rules: [`CLAUDE.md`](../../CLAUDE.md).

- `src/server.ts` — transport-agnostic `createMcpServer({ issuer })` factory; the
  only place tools are wired up. It takes NO write mode and no credential: every
  tool, curation included, is registered unconditionally, and the write gate runs
  at CALL time in `registerCurationTool`. (An earlier version did decide
  registration by write mode; that is what 2026-08-05 reversed, and the
  measurement is in the write-support block above — a tool nobody sees is a login
  nobody starts.) Two thin entry points connect a
  transport to it: `stdio.ts` (local/Docker) and `http.ts` (self-hosted
  Streamable HTTP + rate limit + body cap — the production path).
- `src/tools/*` — the 34 read tools (all unconditional, of which `get_url_text`
  is declared `unsafe` and removable via `WLO_DISABLE_UNSAFE_TOOLS`;
  `search_wlo_content_many` runs up to eight content searches in one call;
  `search` gains the `search_wlo_all` buckets + widget and `fetch` the full
  record + detail widget under `WLO_SEARCH_OUTPUT_MODE=rich`, off by default —
  the switch covers BOTH because `search`→`fetch` is one flow and enriching only
  the first step leaves the second rendering nothing. The convention gives each
  a SINGLE parameter, so output and display are the only part of
  `search_wlo_all`/`get_node_details` that can be copied at all, and whether a
  connector tolerates keys beside the required ones is unmeasured; the
  convention shape therefore stays first and untouched in both modes, pinned by
  `tests/tools-knowledge-rich.test.ts`;
  `search_skill` becomes `get_skill_for_task` under
  `WLO_SKILL_TOOL_MODE=one-tool`, while `get_skill` stays registered) plus the 26 curation tools (`curation-*.ts`,
  registered unconditionally and gated at call time; `curation-shared.ts` holds
  `registerCurationTool` (the gate + the `oauth2` declaration) and the
  two-step preview/confirm conversation they share — split 2026-11-13: the
  reply shapes are in `curation-reply.ts` (a leaf), the outcome reports in
  `curation-report.ts`, both re-exported from `curation-shared.ts` so no tool
  imports differently —, `curation-fields.ts` the
  write surface (`CONTENT_FIELDS`, 27 parameters since the quality fields were opened) both editing and proposing draw from), grouped by responsibility (collections,
  content-search, node-details, node-relations, vocabulary, topic-pages,
  topic-pages-present, topic-page-content, browse, compendium, wikipedia,
  collection-stats, health, knowledge, skills) + `shared.ts`.
  The Apps-SDK display tools are registered via `src/apps/register.ts`.
  A tool module holds its schema and its rendering, never an algorithm: bounded
  traversals a tool would otherwise inline live in `src/services/`
  (`collection-traversal.ts`, `topic-page-discovery.ts`).
  A tool that renders its own line-oriented text (browse tree, Fachportal list,
  Themenseiten listing, swimlane outline) must pass every repository-supplied
  value through `oneLine` (`text-line.ts`, re-exported by `formatter.ts`) — a newline in a title otherwise
  forges a second record with a nodeId the next call acts on.

- `src/services/collection-search.ts` — "which collections match this word?",
  asked of BOTH repository backends and merged. The one place that knows there
  are two; see the plan entry above for the three rules that bind it.
- `src/services/bapi/*` — b-api flows (Kestra) through `{repository}/rest/bapi` (2026-11-18): `jobs.ts` is the ONE
  caller of that proxy (guarded) — four calls, method and path together, a personal login only, `DisableGuest`
  on each — plus the one anonymous start-up probe of the flow list, without `DisableGuest`; `proxy-switch.ts`
  decides whether the tools are on (`WLO_BAPI_VIA_REPOSITORY`, else that probe, started from `http.ts` only);
  `node-metadata-write.ts` checks the ids before a preview; `job-owners.ts` keeps who started which job,
  because through the proxy every person shares the repository's b-api key. Rules: `write-support.md`.
- `src/services/write/*` — the shared write pipeline (gate → fields → change-set
  → confirm → verify). No MCP SDK import; every mutation goes through it, so the
  safety properties are tested once instead of per tool.
- `src/wlo-api.ts` — barrel over the edu-sharing REST client: `wlo-search.ts` +
  `wlo-node.ts` (endpoints), `wlo-config.ts` (env, `DISPLAY_PROPS`, URL
  sanitization), `wlo-types.ts` (`WloNode`/`SearchResponse`), and
  `wlo-node-text.ts` (`/textContent` + the file download, BOTH byte-capped
  since 2026-11-13: `/textContent` answers the whole text as one JSON value — a
  50 MB text file answered 52 million characters — so the read stops at
  `TEXT_CONTENT_MAX_BYTES` and reports `cut` — which every caller must
  honour: the tool says "at least N characters", a skill instruction is refused
  whole, a write's read-back counts as unreadable; `{"text":null}` is the
  repository saying "none" (`none`), which is what Markdown, images, audio and
  video answer, and is not the same as a body naming no text field
  (`storedTextAnswered` — that one is "could not be read" on every path). A
  file that IS text and is not extracted — Markdown, an ALLOW list — is read as
  itself for a public, unlinked record through `fileTextFor`
  (`services/content-text.ts`), the one way out all four paths that show a
  stored text take: `get_wlo_content_text`, `includeTextContent` on details
  and on search hits, and `fetch`), and
  **`wlo-fetch.ts` — `wloFetch` plus the credential boundary**: the only place
  the operator's password is attached, and only ever to the repository host.
  `src/topic-page-api.ts` — topic-page discovery (repository I/O only);
  **`src/topic-page-variant.ts` — what a variant IS**: `TOPIC_PAGE_PROPS`,
  `ThemePageInfo`, `variantFields` (the ONE projection of a variant node onto
  its fields — a second copy fails `tests/shared-rule-discipline.test.ts`),
  `variantMatchesFilters`, `isUsableVariant`, `pickThemePageTitle`. Split out of
  `topic-page-api.ts` on 2026-08-11 at 389 lines: 8 of its 13 importers needed
  only this half, and one of them (`topic-page-title.ts`) closed an import cycle
  by moving. The property list and the projection live together because adding a
  field to one without the other reads back empty with nothing failing;
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
  `topic-page-variant.ts`, `topic-page-structure.ts` and
  `services/write/topic-page.ts` all need it and none may import from `tools/`.
  Since the 2026-08-11 split it imports NOTHING: `pickThemePageTitle` needed
  `ThemePageInfo` and so pointed back at the module that imports this one — the
  one cycle in this corner. It moved to `topic-page-variant.ts` beside the type,
  and `tools/shared.ts` re-exports it unchanged;
  `src/topic-page-config.ts` — the `ccm:page_config` document (which variant a
  page renders, and in which order) — the page builder's schema, which changes
  independently of edu-sharing's endpoints.
  Four rules here rest on measurements in
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
  (4) **`variantPreset` is not `targetGroup`, and must never stand in for it**
  (measured 2026-08-11, §3b). A variant may carry a `variables` block in
  `ccm:page_variant_config` holding the profile selector's INITIAL state —
  `virtual:profiling_widget_intention` (`teach`/`learn`) and
  `…_education_level` (educationalContext URIs, **comma-joined in ONE string**,
  not an array). That is the mechanism behind "land on the page, then pick
  Lehrkraft + Sek I": not a variant switch, and not a swimlane filter — 0 grid
  cells reference a variable. It is better filled than the official fields
  (25/69 and 32/69 against 17/69 and 21/69), which is exactly the trap: the two
  sources overlap on 1 resp. 2 of 69 variants and **disagree in 3 of 3** of
  those. Merging them raises the reported coverage and lowers the truth. It is
  parsed in one place (`parseVariantPreset`, `topic-page-config.ts`), carried as
  its own field through both variant projections, and `virtual:profiling_target_group`
  is deliberately ignored — both variants that carry it hold the full
  `["learner","teacher","general"]`, i.e. the selector's OPTION LIST.
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
  cap. Since the audit of 2026-11-12 a page left short by it IS filled: first
  from the rest of the ranked window in hand, then from further windows
  (`services/content-search.ts`) — the earlier rule "the page is not widened, a
  copy-heavy query returns fewer results" is superseded. `total` still reports
  the real backend count. `src/vocabs.ts` — local vocabulary label↔URI tables (no
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
  line), and the exported `TRUNCATION_MARKER` for whoever must RECOGNISE the
  marker (the byte-capped download that appended it was removed 2026-11-12 —
  the skill path refuses instead of cutting). The ONLY module that may write that
  marker.
  `src/read-json.ts` — the one place an upstream body is parsed: `res.ok` says
  the server answered, not that the body is JSON, so every client goes through
  it and each decides whether a parse failure degrades or throws.
  Both of those "only place" claims are enforced by
  `tests/shared-rule-discipline.test.ts` rather than asserted here — each was
  found violated by modules written after the helper existed (6 and 1
  respectively). A unit test of a helper proves the helper is right and says
  nothing about whether anyone uses it.
  `src/shutdown.ts` — what a stop signal does (audit 2026-11-12, B-1): stop
  accepting, let the WORK in hand finish, exit; cut after `SHUTDOWN_GRACE_MS`
  (70 s — sized for a `ccm:wwwurl` write and a plan slice, and free when nothing
  runs), which `stop_grace_period` in the compose file must EXCEED. Without a
  handler Node as PID 1 ignores SIGTERM, so every deploy ended in SIGKILL. It
  counts work, not connections, and both directions were measured wrong in the
  first cut: a connection that never sent a request held `server.close` for the
  whole grace period, and a client that hung up mid-request left no connection
  while its write still ran. Work = a handler not returned (`trackRequests`), an
  answer not flushed, and anything running `detachedFromRequest`. Installed only
  from `http.ts`.
  `src/upstream-gate.ts` — the process-wide bound on calls open at the
  repository (`WLO_UPSTREAM_CONCURRENCY`, default 24; audit 2026-11-12, P-1).
  Every other bound is per call or per client, and one OER search alone starts
  ~25 requests. Three rules: below the limit the slot is taken SYNCHRONOUSLY
  (`tryAcquireUpstreamSlot`) — an `await` before `fetch` changed when a call is
  sent and a test caught it; the call's timeout starts when it is SENT, not
  while it waits; and a call with no slot within `GATE_MAX_WAIT_MS` (5 s — far
  below the call timeout, so "busy" arrives while someone still listens) or
  meeting a full queue is NOT sent and answered as a synthetic 503 +
  `Retry-After`: `upstream_busy` to callers that throw on non-OK, "empty" to the
  six read helpers that degrade (as for a real 503 — package 9). The readiness
  probe runs `outsideUpstreamGate`: it measures the repository, and our own
  queue read as "unreachable" for 30 s on the endpoint a circuit-breaker
  watches. Only the repository host is counted. The default is sized by
  what ONE call needs — the audit's "throttles at ~11 req/s" is not a measured
  throttle but the crawl rate computed in the cache block above.
  `src/request-scope.ts` — whether anybody still waits for the work in hand.
  `http-app.ts` runs `/mcp` and `/api/*` with a signal that aborts when the
  connection closes BEFORE the answer finished; `wloFetch` honours it. **Writes
  never do:** `registerCurationTool` runs every curation handler
  `detachedFromRequest` — the abort hits the response, not the work, and what an
  aborted write loses is our read-back and the stored result a re-presented key
  replays. The abort reason is `ClientGoneError` — its own class, named neither
  "abort" nor "timeout", because `isUpstreamTimeout` reads both and a hang-up is
  not an open outcome; `toolError` logs it at info and `mapPool` stops on it. Detached work is COUNTED (the shutdown waits for it); a shared
  background read (the registry lookup several callers await) uses
  `sharedAcrossRequests`, which is neither bound to one caller nor counted. A
  write is also never SHED at the gate (`patient`): the synthetic 503 is
  something a write path cannot tell from the repository's own, and after a
  spent key a 5xx reads as "open" or ends a plan step as failed for a request
  that was never sent — so detached work waits for its slot, bounded by its own
  timeout only.
  `src/request-url.ts` — the one place an inbound request target is parsed.
  node:http accepts targets `new URL()` refuses (`//[`), and three layers used
  to parse the same `req.url` with only the first one guarded; the throw moved
  down a layer, escaped the handler, and the caller got no answer at all.
  `src/short-cache.ts` — a minute of memory for reads every request repeats
  (audit 2026-11-12, P-4: the subject-portal list, a collection's first three
  skill descriptions). Three rules: only an ANSWER is kept, never "could not be
  read"; the VALUE is kept, never a promise in flight (it belongs to the
  request that started it and dies with that request's abort signal); and
  nothing that must be current goes through it (a read-back, a preview).
  `tests/fetchMock.ts` clears it on every install — a test that replaces
  `fetch` itself must call `clearShortCaches()`.
  A TITLE is chosen in `src/node-match.ts` and nowhere else (A-7): `nodeTitle` /
  `titleFromProperties` (record: `cclom:title` first) and
  `collectionTitleFromProperties` (`cm:title` first — what the collection
  endpoint writes). A chain written out elsewhere fails a test.
  `src/keyed-digest.ts` — how a credential is REMEMBERED (audit 2026-11-12,
  S-10): as an HMAC under a per-process secret, never as a bare hash — a
  SHA-256 of `Basic user:pass` is a password hash. Every place that keeps a
  login only to recognise it again uses this one function.
  `src/request-id.ts` — one id per inbound request (audit 2026-11-12, B-5):
  answered as `X-Request-Id`, and the logger puts it on every line as `req`.
  Its OWN store, not `request-scope.ts`: a write leaves that scope on purpose
  and must keep its id. A caller's id is adopted only as a plain token — it
  lands in every log line. The same module holds the caller's TRACE context
  (`x-client-trace-id`, B3): read only when well-formed, logged, and handed on
  by `wloFetch` to the repository alone, as a child span. A caller's trace is never replaced; a request
  without a B3 trace gets one started (`traceForRequest`, since 1.2.0 — the platform guide asks for it). `src/metrics.ts` + `src/rest/metrics-route.ts` —
  `GET /metrics`, off unless `METRICS_TOKEN` is set. Counted at the three
  seams (response end in `http-app.ts`, `registerWloTool`, `wloFetch`). Two
  rules: a label value comes from OUR code (route class, tool name, status
  class), never from the caller — a path or a query as a label is unbounded
  memory and a record of who did what; and a metric is declared in `METRICS`.
  `src/log-privacy.ts` — what a log line says about a PERSON (user decision
  2026-11-13): a client address, an account name and a search term are written
  as pseudonyms (`~` + 12 hex, a keyed digest valid for one process run) unless
  `LOG_PERSONAL_DATA=plain`. Every log field that can carry one goes through
  `logAddress` / `logAccount` / `logTerm`; the guard in
  `tests/shared-rule-discipline.test.ts` knows the field NAMES a person hides
  behind and grows with each finding — `subject`, `title` and a path ending in
  the term were found by review, after the first version passed. Nothing reads
  the log back; limiters and the allow-list use the real values in memory.
  `src/logger.ts` — one JSON object per line, in the service guide's field
  names (`timestamp`, `level`, `service`, `message`; D8, 2026-11-13). The
  default stream is stderr and that is the safe one: under stdio, stdout is the
  protocol. Only `http.ts` moves the log to stdout, through
  `logger-stdout.ts` as its FIRST import — modules log while they load, and a
  call further down would leave those lines on stderr (`tests/logger.test.ts`
  pins the position, and that `stdio.ts` never imports it). `LOG_LEVEL` sets
  the threshold. `src/rest/internal-port.ts` — `INTERNAL_PORT`: a second
  listener for `/health`, `/ready`, `/metrics` ONLY, beside the public port
  (D10). Its own handler, not a mode of `createHttpRequestHandler`: no CORS,
  budget, credential scope or request counter belongs there. `unref`'d, so it
  answers `/health` while the public listener drains and never holds the
  process. Durations in `metrics.ts` are histograms on ONE bucket layout
  (`DURATION_BUCKETS_S`, sized by what was measured here; D9).
  `src/rate-limit.ts`, `src/read-body.ts` — support.
- `docs/openapi.yaml` — the HTTP surface outside MCP; `tests/openapi.test.ts`
  fails a route the code dispatches and the document does not name (and the
  reverse). A new path in `http-app.ts` or `rest/` goes into the document in
  the same change. `deploy/helm/wlo-mcp/` — a DRAFT chart (D13, 2026-11-13,
  installed nowhere); `tests/helm-chart.test.ts` pins what follows from this
  server's design and must not drift: ONE replica with `Recreate`, probes on
  `/health` and never `/ready`, a termination grace above `SHUTDOWN_GRACE_MS`,
  no secret in values. `docs/STECKBRIEF.md` is the fact sheet for a platform
  team. Sizing is measured, not estimated: `npm run measure:resources`,
  `docs/DEPLOYMENT.md` §5.0.2 — a held full text costs up to twice its UTF-8
  size (one character outside Latin-1 makes the string two bytes each).
- `docs/plans/` — design documents, including the
  [full-codebase review plan](../plans/2026-08-02-full-review-plan.md) (12
  packages, R1–R12) and its live progress table.

- `src/accident.ts` — which errors are OURS (audit 2026-11-14). JavaScript's own four error classes are answered
  with a generic sentence and the code `internal_error` (REST: 500 without a code) and logged in full; `fetch
  failed` and `terminated` are TypeErrors that are the repository not answering. One rule for `toolError` and
  REST's `failureResult` — a second attempt to tell "ours" from "theirs" by the WORDING of a plain `Error` made
  every new outage sentence a silent 500 and was removed the day it was written.
  `src/http-options.ts` — `buildHttpOptions(env)`: the security wiring of `http.ts` as a function a test can
  call. `http.ts` listens on import, so deleting a limiter there used to leave the suite green.
  `src/response-headers.ts` — the headers every response of both listeners carries.
  `tests/netguard.mjs` RECORDS a network call and fails the run at exit: server code catches the throw as an
  upstream failure, and two tests reached staging unnoticed. `connectedClient` (`tests/fetchMock.ts`) validates
  `structuredContent` against the published schema in every test. `tests/tools-list-budget.test.ts` bounds the
  size of `tools/list` (231 306 characters for 60 tools on 2026-11-14) — a ratchet, raised on purpose or not at all.
