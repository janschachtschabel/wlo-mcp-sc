# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this project adheres
to [Semantic Versioning](https://semver.org/).

## [Unreleased]

Hardening, tests, modularization, and a full documentation overhaul following the
code audits.

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
