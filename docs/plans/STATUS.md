# WLO MCP Apps-SDK Rebuild — Status

Living progress tracker for the [design](2026-07-15-wlo-mcp-apps-sdk-rebuild.md)
+ [tasks](2026-07-15-wlo-mcp-apps-sdk-tasks.md). Updated at the end of each
package (phase). A fresh context resumes from: CLAUDE.md → this file → the
design/tasks docs.

**Working directory:** `C:\Users\jan\staging\Windsurf\wlo-mcp-server-sc`
**Process:** one package = one phase; after each, update this file + hand off for
a context reset (see the workflow block in CLAUDE.md).

> **Superseded on 2026-08-02 — Vercel is gone.** `api/mcp.ts`, `vercel.json` and
> `tests/api-mcp.test.ts` were deleted; the self-hosted Docker/Caddy deployment
> is the only target and `stdio.ts` + `http.ts` the only entry points. Every
> mention of Vercel, `api/mcp.ts`, `@vercel/node` or serverless constraints below
> is a record of what was true at the time — **do not act on it**. In particular
> the `@vercel/node` dependency findings and the "bundle dist-widgets for Vercel"
> follow-ups are closed by the removal, not outstanding.

---

## Progress

| Phase | Status | Notes |
|-------|--------|-------|
| P0 Groundwork & baseline | ✅ done (2026-07-15) | baseline green; esbuild + widget-build stub wired |
| P1 Internal enablers | ✅ done (2026-07-15) | DISPLAY_PROPS, fuzzy suggestions, swimlane service, skipCount — 114 tests |
| P2 New tools + bundling | ✅ done (2026-07-15) | +3 tools (wikipedia/compendium/within_collection), search_wlo_all +6 flags, topic-pages/browse params — 148 tests |
| P3 Apps-SDK foundation | ✅ done (2026-07-15) | seam + outputSchemas, structuredContent on 6 display tools, readOnlyHint on all, server instructions, `search`/`fetch` — 165 tests, 17 tools. **3.6 dev-mode gate = manual (user)** |
| P4 Widget suite | ✅ done (2026-07-15) | build pipeline + `ui://` resources, W3 tile, W1/W4/W2 widgets, seam `widgetUri` wiring — 201 tests |
| P5 REST layer | ✅ done (2026-07-15) | `GET /api/{search,compendium,topic-page,wikipedia}` over services, validated + rate-limited — 219 tests |
| P6 Launcher | ✅ done (2026-07-15) | knowledge-instruction launcher (Claude/ChatGPT/Copilot/Gemini) + static route + `/api/skills[/<id>]` + bookmarklet — 236 tests |
| P7 Optional tools | ✅ done (2026-07-15) | +4 tools: publishers/related/breadcrumb/stats — 251 tests, 21 tools; live-smoked |
| P8 Deployment | ✅ done (2026-07-15) | MCP_SSE flag + Docker bundles widgets/public + compose + submission docs + audit — 254 tests; image smoke-verified |

---

## P0 — completed 2026-07-15

**Done:**
- Task 0.1 — green baseline established.
- Task 0.2 — `esbuild` dev-dependency added (`^0.28.1`, pinned by npm);
  `src/apps/widgets/build.mjs` stub created; `package.json` scripts
  `build:widgets` added and chained into `build`.

**Verification (evidence):**
- `npm install` → 222 packages, ok.
- `npm run build` → `tsc && node src/apps/widgets/build.mjs` → exit 0
  (tsc ignores the `.mjs` build tool correctly; stub prints "no widgets yet").
- `npm test` → **96 pass, 0 fail** (1.2s) — regression gate green.

**Files touched:** `package.json` (scripts + devDep), `src/apps/widgets/build.mjs` (new).

**Carry-over notes:**
- `npm audit` reports **11 vulnerabilities (1 low, 4 moderate, 6 high)** at
  baseline — mostly dev tooling. Address in **P8** (audit); do not fix piecemeal now.
- Git: **the user manages commits themselves — the agent does NOT commit**
  (decided 2026-07-15). Just keep files + this STATUS.md current per package.

---

## P1 — completed 2026-07-15

**Done (all TDD, red→green shown):**
- Task 1.1 — `ccm:oeh_collection_compendium_text` added to `DISPLAY_PROPS`
  (`src/wlo-api.ts`). A prior guard test asserted the OPPOSITE (keep it out for
  leanness); the design doc deliberately reverses that for token efficiency, so
  the test was **flipped** (not deleted) with the new rationale
  (`tests/formatter.test.ts`). Truncation to 500 chars in `renderToText` bounds
  the text output.
- Task 1.2 — `src/vocab-suggest.ts`: pure `levenshtein()` +
  `suggestVocab(input, vocab)` (≤3 labels, edit-distance ≤2 first, then
  substring; reads `listVocab`). 9 tests.
- Task 1.3 — `buildFilterCriteria` now attaches fuzzy `suggestions` to
  `unresolved` filters; new `formatUnresolvedHint()` renders
  `⚠ Filter "X" … Meintest du: …?`. Wired as a **dedicated visible content
  block** (json-safe — never concatenated into a json envelope) in
  `search_wlo_content`, `search_wlo_all`, `search_wlo_collections`.
- Task 1.4 — `src/services/topic-page.ts::resolveTopicPageSwimlanes()` extracted
  from `get_topic_page_content` (behaviour-preserving; MAX_LANES=12, cap logic
  intact). Tool now delegates. First test coverage for swimlane resolution
  (`tests/services-topic-page.test.ts`, 2 tests). **New `src/services/` seam.**
- Task 1.5 — `search_wlo_content` gains `skipCount` (backend offset, default 0);
  `enhancedSearch` forwards it per variant and reports it as `pagination.from`.

**Verification (evidence):**
- `npm run build` → exit 0.
- `npm test` → **114 pass, 0 fail** (~1.7s). Was 96 at P0 baseline → +18 new
  tests (vocab-suggest 9, shared 4, content-search 3, services-topic-page 2).

**Docs kept in sync (same change):** README.md, README.de.md, CHANGELOG.md
corrected — they claimed compendium is "never in search/list"; now they state it
rides in collection search/list/browse (capped 500 in markdown, full in json).

**Files touched:** `src/wlo-api.ts`, `src/vocab-suggest.ts` (new),
`src/tools/shared.ts`, `src/tools/content-search.ts`, `src/tools/collections.ts`,
`src/reranker.ts`, `src/services/topic-page.ts` (new),
`src/tools/topic-page-content.ts`; tests: `formatter`, `vocab-suggest` (new),
`tools-shared`, `content-search`, `services-topic-page` (new); docs as above.

**Carry-over notes:** unchanged from P0 — 11 npm-audit vulns → **P8**; git: the
user manages commits, the agent does NOT commit.

---

## P2 — completed 2026-07-15

**Done (all TDD, red→green shown):**
- Task 2.1 — `src/wikipedia-api.ts`: `fetchWikipediaSummary(query, lang, sections)`
  — REST summary + opensearch title-resolution fallback, descriptive User-Agent,
  shared `WLO_FETCH_TIMEOUT_MS`, **lang host-injection hardening** (ISO-639 only),
  `sections` caps leading paragraphs. 8 tests.
- Task 2.2 — `get_wikipedia_summary` tool (`src/tools/wikipedia.ts`): markdown/json,
  regex-validated `language`, `annotations {readOnlyHint, openWorldHint}`. 3 tests.
- Task 2.3 — `getCompendiumTexts` service (`src/services/compendium.ts`, reuses
  `formatNode` for full untruncated text) + `get_compendium_text` tool (≤25 ids,
  one entry per requested id). 4 + 4 tests.
- Task 2.4 — `searchWithinCollection` service + `search_wlo_within_collection`
  tool: `ngsearch` scoped by `virtual:primaryparent_nodeid`, reuses
  `buildFilterCriteria`. 3 + 1 tests.
- Task 2.5 — `searchAll` service (`src/services/search.ts`): behaviour-preserving
  extraction of the `search_wlo_all` body, then 5 opt-in enrichments
  (`includeCompendium` gap-fill, `includeTextContent` cap 4000, `includeWikipedia`,
  `includeTopicPageContent` via `resolveTopicPageSwimlanes`, `skipCount`). Tool
  delegates; default-flag envelope unchanged. 7 service + 1 tool-delegation tests.
- Task 2.6 — `search_wlo_topic_pages` +`includeContent`/`maxPerSwimlane` (JSON mode,
  bounded ≤5). 2 tests.
- Task 2.7 — `browse_collection_tree` +`includeContentPreview` (1–5, bounded
  `mapPool` pass). 2 tests.

**Verification (evidence):**
- `npm run build` → exit 0.
- `npm test` → **148 pass, 0 fail** (~2.8s). Was 114 at P1 → +34 new tests.
- Tool count 12 → **15** (`server.test.ts` asserts the exact set).

**Docs kept in sync (same change):** CHANGELOG.md [Unreleased] gained the 3 tools,
the `search_wlo_all` flags, and the topic-pages/browse params; README.md +
README.de.md tool count 12→15, tool table rows 13–15, and detail entries updated.

**Files touched (new):** `src/wikipedia-api.ts`, `src/tools/wikipedia.ts`,
`src/services/compendium.ts`, `src/tools/compendium.ts`, `src/services/search.ts`;
(modified) `src/server.ts`, `src/tools/collections.ts`, `src/tools/content-search.ts`,
`src/tools/topic-pages.ts`, `src/tools/browse.ts`; tests: `wikipedia-api`,
`tools-wikipedia`, `services-compendium`, `tools-compendium`,
`services-search-within`, `tools-search-within`, `services-search-all`,
`topic-pages`, `browse` (extended), `content-search` (extended), `server` (count).

**Carry-over / known limitations:**
- `searchWithinCollection` scopes via the `virtual:primaryparent_nodeid` criterion
  (per plan). Offline tests prove the criterion is SENT; whether edu-sharing
  honours it for subtree scoping is **not yet verified live** — confirm in the
  P3.6 developer-mode gate.
- `includeCompendium` gap-fills only collections/topic pages missing inline
  compendium (DISPLAY_PROPS already carries it for most) — no redundant round-trips.
- File-size watch (soft ~300-line threshold): `collections.ts` (353) and
  `topic-pages.ts` (316) are marginally over. Each still has one clear
  responsibility and the plan placed the new tool there (Task 2.4); a future split
  is a candidate, not blocking.
- 11 npm-audit vulns still deferred to **P8**; git: the user manages commits, the
  agent does NOT commit.

---

## P3 — completed 2026-07-15 (code; 3.6 is a manual user gate)

**Step 0b research (done):** fetched the official Apps-SDK "reference" +
"chatgpt-ui" pages; recorded the exact `_meta`/`window.openai` surface into the
design doc's new **"References (Apps-SDK surface — locked P3 Step 0b)"** section.
Key finding: the design's `_meta.ui.*` shorthand IS the MCP-Apps standard;
`openai/*` keys are ChatGPT aliases. De-risks R2.

**Done (all TDD, red→green shown):**
- Task 3.1 — `registerWloTool` seam (`src/apps/register.ts`) + zod
  `outputSchema`s (`src/apps/outputSchemas.ts`: node list, search-all envelope,
  swimlane payload, browse tree, subject-portal list, search/fetch shapes). The
  seam attaches `outputSchema`/`annotations` and maps `widgetUri` →
  `_meta.ui.resourceUri` + `openai/outputTemplate` in ONE place. Verified SDK
  behaviour in `mcp.js`: non-error result with an outputSchema MUST carry
  `structuredContent` (strict `safeParseAsync`, extra keys tolerated); `isError`
  skips validation. 6 tests.
- Task 3.2 — migrated `search_wlo_all`, `search_wlo_content`,
  `search_wlo_collections`, `get_subject_portals`, `browse_collection_tree`,
  `get_topic_page_content` to `registerWloTool` and to emit `structuredContent`
  next to the UNCHANGED text output (handler bodies kept byte-identical). Empty
  success paths return valid empty envelopes. `get_topic_page_content` now
  resolves its swimlane payload in BOTH formats (structuredContent must be
  render-ready for W4); markdown TEXT is unchanged. 6 contract tests.
- Task 3.3 — annotations pass: `readOnlyHint:true` added to every remaining tool
  (node details ×2, vocabulary, topic-pages search, health, collection
  contents); `get_wikipedia_summary` keeps `openWorldHint`. Descriptions already
  carry "use this / not that" disambiguation, so the literal "must start with
  'Use this when'" test was **deliberately relaxed** to "non-empty description +
  correct readOnlyHint" (preserves the good existing copy). 1 test over all tools.
- Task 3.4 — server `instructions` block (`src/apps/instructions.ts`): fast path
  (`search_wlo_all` + flags) vs deep-dive tools vs `search`/`fetch`. Wired via
  `new McpServer(info, { instructions })`. 1 test.
- Task 3.5 — `search` + `fetch` knowledge tools (`src/tools/knowledge.ts`), fixed
  ChatGPT shapes, JSON duplicated in `content[0].text` AND `structuredContent`,
  reuse `searchAll` + node detail. 3 tests.
- Task 3.6 — **manual gate, NOT executed here** (needs ngrok + ChatGPT developer
  mode + live network). See the hand-off steps; confirms R1 (SSE). The real-SSE
  flag itself is P8 Task 8.1.

**Verification (evidence):**
- `npm run build` → exit 0.
- `npm test` → **165 pass, 0 fail** (~2.8s). Was 148 at P2 → +17 new tests.
- Tool count 15 → **17** (`server.test.ts` asserts the exact set + readOnlyHint
  on every tool + non-empty `instructions`).

**Docs kept in sync (same change):** CHANGELOG.md (Apps-SDK foundation +
`search`/`fetch`), README.md + README.de.md (15→17 tools, table rows 16–17,
structuredContent/annotations/instructions note). Design doc gained the locked
Apps-SDK References section.

**Files touched (new):** `src/apps/register.ts`, `src/apps/outputSchemas.ts`,
`src/apps/instructions.ts`, `src/tools/knowledge.ts`; (modified) `src/server.ts`,
`src/tools/content-search.ts`, `src/tools/collections.ts`, `src/tools/browse.ts`,
`src/tools/topic-page-content.ts`, `src/tools/node-details.ts`,
`src/tools/vocabulary.ts`, `src/tools/topic-pages.ts`, `src/tools/health.ts`;
tests: `apps-register`, `apps-structured-content`, `tools-knowledge` (new),
`server` (extended); docs as above.

**Carry-over / known limitations:**
- **3.6 developer-mode validation is still pending (user action)** — run it
  before relying on ChatGPT rendering; it also confirms whether real SSE is
  required (P8 Task 8.1 has the `MCP_SSE` flag).
- `get_topic_page_content` markdown mode now also resolves swimlane widgets to
  populate `structuredContent` (extra bounded upstream calls vs. before; text
  output unchanged). Deliberate — the widget needs a render-ready payload in the
  default path.
- The seam keeps handler args untyped (`args: any`, per the locked design); one
  local (`collections.ts` `query`) was re-annotated `string` to restore
  inference. No widget `_meta` is emitted yet (no `widgetUri` set until P4).
- 11 npm-audit vulns still deferred to **P8**; git: the user manages commits, the
  agent does NOT commit.

---

## P4 — completed 2026-07-15

**Done (all TDD, red→green shown; DOM-free render/state modules unit-tested in
Node — no jsdom dependency added):**
- Task 4.1 — Widget build pipeline + resource layer. `build.mjs` esbuild-inlines
  each widget's `main.ts` + shared `base.css` + widget `styles.css` into one
  self-contained `dist-widgets/<name>.html` (no external `<script src>`; a
  `.js`→`.ts` resolver bridges NodeNext imports). `src/apps/resources.ts`:
  content-addressed `ui://widget/<name>-<hash>.html`, MIME
  `text/html;profile=mcp-app`, `_meta.ui.csp`/`domain` from `WLO_REPOSITORY_URL`,
  `registerWidgets(server)` loads built HTML (graceful skip when absent). Browser
  `main.ts` entries excluded from tsc (DOM globals) via `tsconfig.exclude`.
- Task 4.2 — W3 shared tile (`widgets/shared/tile.ts`): accessible card, meaningful
  German alt text / decorative icon fallback, one primary link, chips, escaped.
  `escape.ts` (XSS) + `strings.ts` (DE/EN i18n) + `types.ts` (decoupled node shapes).
- Task 4.3 — W1 `renderSearchResults` (Themenseiten/Sammlungen[emph]/Inhalte);
  wired to `search_wlo_all` via the seam `widgetUri`.
- Task 4.4 — W4 `renderTopicPage` (swimlanes = wrapping tile grids [no nested
  scroll] + "more on topic page"); wired to `get_topic_page_content`.
- Task 4.5 — W2 interactive browse: pure `browseReducer` (init/expand/collapse/
  loaded/error) + `renderBrowse` (disclosure tree, `aria-expanded`), `main.ts`
  delegates clicks → `callTool('browse_collection_tree')`, persists via
  `setWidgetState`; wired to `get_subject_portals` + `browse_collection_tree`.

**Verification (evidence):**
- `npm run build` → tsc exit 0; `build:widgets` inlines all 3 widget HTML files
  (browse 4.4 kB / search-results 3.1 kB / topic-page 3.0 kB JS; verified: no
  external `<script src>`/`<link>`, inline `<style>`, `#wlo-root` present).
- `npm test` → **201 pass, 0 fail** (~4.8s). Was 165 at P3 → +36 (escape 3,
  resources 3, tile 8, search-results 5, wiring 4, topic-page 3, browse-state 6,
  browse-render 4).

**Docs kept in sync (same change):** CHANGELOG.md (widget-suite entry),
README.md + README.de.md (Apps-SDK feature bullet now names the shipped widgets),
`.gitignore` (`dist-widgets/`).

**Files touched (new):** `src/apps/resources.ts`; `src/apps/widgets/build.mjs`
(rewritten from stub); `src/apps/widgets/shared/{escape,strings,types,tile}.ts`,
`base.css`; `src/apps/widgets/search-results/{render,main}.ts`+`styles.css`;
`src/apps/widgets/topic-page/{render,main}.ts`+`styles.css`;
`src/apps/widgets/browse/{state,render,main}.ts`+`styles.css`; tests
`widgets-{escape,tile,search-results,wiring,topic-page,browse-state,browse-render}.test.ts`,
`apps-resources.test.ts`. (Modified) `src/server.ts` (`registerWidgets` + thread
`widgetUri`), `src/tools/content-search.ts` / `browse.ts` / `topic-page-content.ts`
(accept + attach `widgetUri`), `tsconfig.json`, `.gitignore`, docs.

**Carry-over / known limitations:**
- **`dist-widgets/` must be shipped for hosts to render widgets.** Local/stdio +
  self-hosted HTTP work (repo-root `dist-widgets/`). **Vercel** (`api/mcp.ts`)
  and **Docker** need the folder bundled — Vercel `includeFiles` / Dockerfile
  `COPY` — handled in P8 (deploy); until then those transports degrade gracefully
  (no widget, tools still return text + structuredContent).
- Widget render/state are unit-tested as pure string/reducer functions; the
  **live iframe behavior** (DOM glue in `main.ts`, `window.openai.callTool`
  drill-down, `setWidgetState` restore) is verified in the **P3.6 developer-mode
  gate** (still a pending user action), not in Node tests.
- `search_wlo_all`'s optional `wikipedia` summary is not yet rendered in W1
  (scope kept to the three result buckets) — a cheap follow-up.
- Widget HTML shell is `lang="de"` (default copy); EN copy still renders under an
  `en` locale. Minor.
- 11 npm-audit vulns still deferred to **P8**; git: the user manages commits, the
  agent does NOT commit.

## P5 — completed 2026-07-15

**Done (all TDD, red→green shown):**
- Task 5.1 — `src/rest/validate.ts` (pure input validation: query ≤200, nodeId
  ≤50, ≤25 ids, `clampInt`, `parseBool`, filter ≤100) + `src/rest/routes.ts`.
  `routeRestRequest(method, url)` is the pure, offline-testable core — dispatches
  `GET /api/{search,compendium,topic-page,wikipedia}` to the existing
  `src/services/*` (searchAll / getCompendiumTexts / getTopicPageContent +
  resolveTopicPageSwimlanes / fetchWikipediaSummary), returns `{status, json}`
  or `null` for a non-owned path. No new business logic. `handleRestRequest`
  is the thin `http.ts` adapter. Non-`GET` → 405; validation → 400; wikipedia
  miss → 404; service error → generic 500 (no leak). 15 tests.
- Task 5.2 — mounted the `/api/*` branch in `src/http.ts` (after `/health`,
  before the MCP POST branch): own tighter per-IP limiter `API_RATE_LIMIT_RPM`
  (default 30/min → 429); the existing wildcard CORS headers already permit
  cross-origin `GET`; an unknown `/api` path falls through to the 404. Adapter
  tested with a fake req/res (3 tests). Startup log + `.env.example` extended.

**Verification (evidence):**
- `npm run build` → tsc exit 0; `build:widgets` inlines all 3 widgets unchanged.
- `npm test` → **219 pass, 0 fail** (~5.4s). Was 201 at P4 → +18 (rest-routes
  15, http-rest 3).
- Live mount smoke-test (built `dist/http.js` on port 3999, no upstream network):
  `OPTIONS /api/search` → 204; `GET /api/search` (no q) → 400; `POST
  /api/search?q=x` → 405; `GET /api/unknown` → 404 (fall-through); CORS header
  `Access-Control-Allow-Origin: *` present.

**Docs kept in sync (same change):** README.md + README.de.md (ToC entry, new
"REST API" section + table, `API_RATE_LIMIT_RPM` env row, Features bullet,
Security bullet, module tree `rest/`), CHANGELOG.md (REST layer entry),
`.env.example` (`API_RATE_LIMIT_RPM`).

**Files touched (new):** `src/rest/validate.ts`, `src/rest/routes.ts`; tests
`rest-routes.test.ts`, `http-rest.test.ts`. (Modified) `src/http.ts` (import +
`apiRateLimiter` + `/api/*` branch + startup log), `.env.example`, `README.md`,
`README.de.md`, `CHANGELOG.md`.

**Carry-over / known limitations:**
- `/api/search` → `searchAll` fans out to several upstream calls; the tighter
  `API_RATE_LIMIT_RPM` (30/min) is the anonymous-public guard. Live upstream
  responses are NOT exercised in tests (offline `fetchMock`); the mount itself is
  verified live (see smoke-test) without touching the network.
- REST is served by `http.ts` only; the Vercel handler (`api/mcp.ts`) does not
  mount it — a Vercel `/api/*` route would be a separate P8 decision (out of
  scope here; the launcher targets the self-hosted server).
- 11 npm-audit vulns still deferred to **P8**; git: the user manages commits, the
  agent does NOT commit.

## P6 — completed 2026-07-15 (redesigned per user feedback)

**Scope change (user feedback, mid-implementation):** the launcher is NOT a
single canned search-prompt. It hands the user's AI chat the *knowledge* to use
the WLO REST URLs itself (search → load JSON RAW → summarise), plus a pointer to
URL-loadable skills, and must offer targets beyond OpenAI (Claude, ChatGPT,
Microsoft Copilot, Gemini). Direct content search stays usable. The design/tasks
doc P6 section was updated to record this.

**Done (all TDD, red→green shown):**
- Task 6.1 — `src/rest/static.ts` (pure `resolveStaticRoute` path→asset map +
  thin `handleStaticRequest` adapter, mirrors `rest/routes.ts`; closed allow-list
  → no directory-traversal) serving `GET /launcher.html`, `GET /`, and
  `GET /bookmarklet.md` (`text/markdown`). Mounted in `src/http.ts` AFTER the MCP
  branch (so `POST /` stays MCP). `public/launcher.html` (self-contained,
  bilingual DE/EN, no third-party assets) generates an **instruction message**
  that teaches the chat: the search endpoint (`/api/search?q=…` + filters/flags,
  load JSON raw + summarise), the other endpoints, and skills-by-URL
  (`/api/skills` → `/api/skills/<id>`). Optional query + Fach/Stufe/Typ = a woven-in
  concrete example driving a "Load raw result" button (direct content search).
  Targets: Claude/ChatGPT/Copilot deep links (`?q=`), Gemini (no native prefill →
  open app + copy to clipboard), or copy-only. 9 tests (rest-static).
- Task 6.1b — `src/rest/skills.ts`: registry + raw loader behind `GET /api/skills`
  (`{ skills:[{id,name,description,path}] }`) and `GET /api/skills/<id>` (raw
  Markdown; `404` unknown; `405` non-GET). `id` = stable slug now, WLO nodeId
  later; id is only looked up in the closed registry → no traversal. `RestResult`
  gained an optional `raw`/`contentType` body; `handleRestRequest` serves Markdown
  or JSON accordingly; prefix dispatch for `/api/skills/<id>` in `routeRestRequest`.
  8 tests (rest-skills).
- Task 6.2 — `public/bookmarklet.md`: selection→launcher `javascript:` one-liner
  (`/launcher.html?q=<selection>`) + bilingual install/use docs.
- Task 6.3 — two self-contained skills MOVED to `public/skills/`
  (`wlo-search.skill.md`, `wlo-topic-launcher.skill.md`) so they are served raw by
  `/api/skills/<id>`; each documents the REST URL + params + response shape + how
  to present results (verified envelope/entry shapes). `examples/` removed.

**Verification (evidence):**
- `npm run build` → tsc exit 0; `build:widgets` inlines all 3 widgets unchanged.
- `npm test` → **236 pass, 0 fail** (~6.9s). Was 219 at P5 → +17 (rest-static 9,
  rest-skills 8).
- Live smoke-test (built `dist/http.js`): `GET /launcher.html` → 200 `text/html`;
  `GET /` → 200; `GET /bookmarklet.md` → 200 `text/markdown`; `GET /api/skills` →
  200 JSON list; `GET /api/skills/wlo-search` → 200 raw Markdown;
  `GET /api/skills/nope` → 404; `POST /api/skills` → 405; `POST /launcher.html` →
  405; `GET /nope` → 404; **regression** `POST /` + `POST /mcp` → 200 `tools/list`.
- Live client-logic check (Browser pane, served page): `?q=` prefill works; the
  instruction contains the search pattern, `/api/skills` list URL, `/api/skills/<id>`
  load pattern, AND a concrete example when a query is set; skills URL =
  `…/api/skills`; example updates with `&discipline=…`; Claude deep link encodes
  the instruction; Copilot host `copilot.microsoft.com`; Gemini shows the note +
  app-only link (no `?q=`); copy-target hides the Open link; empty query disables
  "Load raw result" + hides the example but keeps the generic instruction; EN toggle
  translates. No console errors. (Screenshot tool timed out; CSS unchanged from the
  earlier verified render.)

**Docs kept in sync (same change):** README.md + README.de.md (REST table
`/api/skills[/<id>]` rows, rewritten "Prompt launcher" section, Features bullet,
module tree `public/skills/` + `rest/skills.ts`), CHANGELOG.md.

**Files touched (new):** `src/rest/static.ts`, `src/rest/skills.ts`,
`public/launcher.html`, `public/bookmarklet.md`,
`public/skills/{wlo-search,wlo-topic-launcher}.skill.md`; tests
`rest-static.test.ts`, `rest-skills.test.ts`. (Modified) `src/http.ts` (static
mount), `src/rest/routes.ts` (raw-body `RestResult` + `/api/skills[/<id>]`
routing), `README.md`, `README.de.md`, `CHANGELOG.md`, design/tasks P6 section.

**Carry-over / known limitations:**
- **`public/` (incl. `public/skills/`) must be shipped** for the launcher + skills
  to serve. Local/repo-run works; **Docker/Vercel** need the folder bundled — same
  shape as the `dist-widgets/` carry-over → **P8**. Missing asset → generic 500
  (logged); other routes unaffected.
- Skill `id`s are slugs now; when skills move into WLO as nodes, swap the registry
  ids for nodeIds — the `/api/skills/<id>` URL contract is unchanged.
- Deep-link prefill is native only for Claude/ChatGPT/Copilot (`?q=`); Gemini has
  no native URL prefill (verified via web research) → app + clipboard fallback. For
  long instructions the "copy" path is the robust primary route.
- Client-side launcher JS is inlined (not through the widget esbuild pipeline);
  verified live in the Browser pane, not node:test — consistent with P4 widget glue.
- Live upstream responses still only via offline `fetchMock` in tests; the "Load
  raw result" button hits live upstream at runtime.
- 11 npm-audit vulns still deferred to **P8**; git: the user manages commits, the
  agent does NOT commit.

## P7 — completed 2026-07-15

**Done (all TDD, red→green shown; all four tools implemented):**
- Task 7.1 — `lookup_wlo_publishers` (`src/services/publishers.ts` + tool in
  `src/tools/vocabulary.ts`): ngsearch facet on `ccm:oeh_publisher_combined` →
  labeled counts (facet values are plain publisher names, NOT URIs — verified
  live, so no vocab resolution). Optional `query`/`discipline`/`educationalContext`
  scoping via `buildFilterCriteria`; sorted count-desc; `maxResults` cap. 4 tests.
- Task 7.2 — `get_related_content` (`src/services/related.ts` + tool in new
  `src/tools/node-relations.ts`): reads the seed's `ccm:taxonid` +
  `ccm:educationalcontext` URIs → ngsearch filter, excludes the seed, over-fetch
  by 1. Optional `includeSiblings` uses the seed's `virtual:primaryparent_nodeid`
  (works for file nodes, unlike `/parents`). Returns `null` when the seed is not
  found. 4 tests.
- Task 7.3 — `get_collection_stats` (`src/services/stats.ts` + tool in new
  `src/tools/collection-stats.ts`): file/sub-collection counts from the children
  pagination totals. **Design correction (live-driven):** the breakdown is tallied
  over the collection's ACTUAL child files (sample ≤100, `sampledFiles` reported),
  NOT via an ngsearch facet query — a facet scoped by `virtual:primaryparent_nodeid`
  returns nothing for reference collections (the common WLO case; smoke showed an
  empty breakdown, the tally showed 7 lrt buckets for the same node). 3 tests.
- Task 7.4 — `get_node_breadcrumb` (`getNodeBreadcrumb` in `src/wlo-api.ts` + tool
  in `node-relations.ts`). **Design correction (live-driven):** the plan assumed an
  iterative walk, but edu-sharing's `/parents` returns the WHOLE ancestor chain in
  ONE call, ordered self-first (`[self, …, root]`) for collection nodes (verified
  live). So the implementation reverses that single response to root→node, with a
  cycle-guard (dedup) + depth-cap kept as the safety net the plan asked for. File
  nodes (`ccm:io`) 500 on `/parents` → empty breadcrumb (documented). 4 tests.

All four register with plain `server.tool` + `{ readOnlyHint: true }` (no widget,
no structuredContent) — matching `lookup_wlo_vocabulary`/node-details/health.

**Verification (evidence):**
- `npm run build` → tsc exit 0; `build:widgets` inlines all 3 widgets unchanged.
- `npm test` → **251 pass, 0 fail** (~5.0s). Was 236 at P6 → +15 (publishers 4,
  related 4, stats 3, breadcrumb 4).
- Tool count 17 → **21** (`server.test.ts` asserts the exact set + readOnlyHint on
  every tool).
- Live smoke (`dist/services/*` against the real repository, read-only):
  publishers global (BpB/Youtube/OERSI…) + scoped by discipline (Biologie →
  Youtube/Science in School/Serlo); stats for a real collection (files 5, subs 3,
  7 lrt breakdown buckets); breadcrumb "Portale > Medienbildung > Bedienen und
  Anwenden"; related for "Photosynthese der Algen" (Biologie → related bio items).

**Docs kept in sync (same change):** README.md + README.de.md (17→21 tools, table
rows 18–21, detail entries, module tree `node-relations.ts`/`collection-stats.ts`
+ `vocabulary.ts` publishers), CHANGELOG.md (four-tools entry).

**Files touched (new):** `src/services/publishers.ts`, `src/services/related.ts`,
`src/services/stats.ts`, `src/tools/node-relations.ts`, `src/tools/collection-stats.ts`;
tests `services-publishers.test.ts`, `services-related.test.ts`, `services-stats.test.ts`.
(Modified) `src/wlo-api.ts` (`getNodeBreadcrumb`), `src/tools/vocabulary.ts`
(`registerPublisherTool`), `src/server.ts` (wiring), `tests/wlo-api.test.ts`
(breadcrumb), `tests/server.test.ts` (21-tool set), README.md, README.de.md,
CHANGELOG.md.

**Carry-over / known limitations:**
- `get_related_content` `includeSiblings` fetches the primary parent collection's
  files; for very large parents (e.g. 2058 items) edu-sharing takes several seconds
  even for a handful of items and can hit the 10s `WLO_FETCH_TIMEOUT_MS` — surfaced
  cleanly via `toolError`. The related RESULTS (the core) are unaffected. Opt-in
  and default off.
- `get_collection_stats` breakdown is a sample (≤100 files); for larger collections
  it is proportional, not exhaustive (`sampledFiles` vs `fileCount` reported).
- `get_node_breadcrumb` covers collection nodes; file/content nodes (`ccm:io`) have
  no `/parents` chain and return an empty path (documented in the tool description).
- 11 npm-audit vulns still deferred to **P8**; git: the user manages commits, the
  agent does NOT commit.

## P8 — completed 2026-07-15

**Done (all TDD where code-bearing; deployment/docs verified by running):**
- Task 8.1 — Real-SSE HTTP transport. New pure `src/mcp-transport.ts`
  (`streamableHttpOptions(env)` → `enableJsonResponse: !MCP_SSE`), unit-tested
  offline (`tests/mcp-transport.test.ts`, 3 tests, RED→GREEN); `src/http.ts`
  resolves it once at module load and spreads a fresh copy per request, logs the
  mode, and the Accept-normalization comment was corrected (no longer claims
  "always a single JSON body"). `.env.example` documents `MCP_SSE` + the
  reverse-proxy no-buffering requirement. **Live smoke:** JSON mode →
  `content-type: application/json` (one body); `MCP_SSE=1` → `text/event-stream`
  (`event: message\ndata: …`) — both 200, 21 tools. Confirms R1 (the P3.6 SSE
  question); the ChatGPT developer-mode render itself remains the manual user gate.
- Task 8.2 — Dockerfile + compose. Runner stage now copies `dist-widgets/` (from
  builder) and `public/` (from context) and defaults `ENV MCP_SSE=1`, closing the
  P4/P6 "must ship these folders" carry-over. New `docker-compose.yml`
  (env/ports/restart/healthcheck + an annotated nginx SSE `proxy_buffering off;`
  recipe) and a minimal `.dockerignore`. **Live verify:** `docker build` OK;
  container `/health` 200, `POST /mcp` tools/list 200 (SSE, 21 tools),
  `resources/list` returns the 3 `ui://` widgets (dist-widgets shipped),
  `/launcher.html` + `/api/skills` 200 (public shipped). Review-driven hardening:
  ports bind to `127.0.0.1` (behind-proxy topology; prevents X-Forwarded-For
  spoofing of the rate limiter on a directly-exposed host). `docker compose config`
  valid.
- Task 8.3 — Submission collateral. New `docs/PRIVACY.md` (stateless, read-only,
  no PII stored; logging disclosure matches the code — verified by the reviewer)
  and `docs/apps-sdk-submission-checklist.md` (every Apps-SDK requirement mapped to
  its implementing artifact + golden demo prompts + remaining operator actions).
  README.md/README.de.md (Docker compose + SSE/proxy note, submission+privacy
  pointer, module tree `mcp-transport.ts`), CHANGELOG.md, `.env.example` synced.
- Task 8.4 — Audit + final verify. Focused fresh-eyes review of the P8 surface
  (transport wiring, Docker paths, compose, docs) — **no CRITICAL/MAJOR**; one
  MINOR (loopback binding) fixed, one NIT (pre-existing `@hono` comment) left as
  out-of-scope. npm-audit: **prod tree `--omit=dev` = 0** (the shipped/Docker
  artifact); the 11 full-tree advisories are entirely dev-only (`@vercel/node`
  types → undici/ajv/path-to-regexp/minimatch/js-yaml/smol-toml; `tsx`→esbuild
  dev-server), never bundled or executed — the pre-existing, documented
  **accepted** decision (the @vercel/node D-1 finding), whose only npm
  "fix" is a breaking `@vercel/node@4` downgrade. Not overturned unilaterally in a
  deploy package; a clean forward path (drop `@vercel/node` for local `node:http`
  Vercel types) is recorded as a follow-up for the user.

**Verification (evidence):**
- `npm run build` → tsc exit 0; widgets inlined (browse 4.4 / search-results 3.1 /
  topic-page 3.0 kB).
- `npm test` → **254 pass, 0 fail** (~6.6s). Was 251 at P7 → +3 (mcp-transport).
- Tool count unchanged at **21**.
- `npm audit --omit=dev` → **0 vulnerabilities** (shipped guarantee).
- Docker image + container smoke-verified (see 8.1/8.2 above); `docker compose config` valid.

**Files touched (new):** `src/mcp-transport.ts`, `docker-compose.yml`,
`.dockerignore`, `docs/PRIVACY.md`, `docs/apps-sdk-submission-checklist.md`;
tests `mcp-transport.test.ts`. (Modified) `src/http.ts`, `Dockerfile`,
`.env.example`, `README.md`, `README.de.md`, `CHANGELOG.md`.

**Carry-over / known limitations:**
- **P3.6 ChatGPT developer-mode render is still the one manual user gate** — point
  developer mode at a live `https://…/mcp` (SSE) deployment and run the golden
  prompts (`docs/apps-sdk-submission-checklist.md`) to confirm widgets render and
  `search`/`fetch` resolve. Cannot be automated offline.
- Reverse proxy MUST disable buffering for the `/mcp` SSE location (documented in
  compose + README + `.env.example`); operator must also fill in the PRIVACY.md
  contact and configure TLS.
- Dev-only npm-audit advisories accepted (see 8.4); optional follow-up: drop
  `@vercel/node` for local Vercel types to reach full-tree-0.
- Vercel handler (`api/mcp.ts`) stays JSON-mode (serverless); real SSE is the
  self-hosted vServer path. Git: the user manages commits, the agent does NOT commit.

---

## Plan complete (P0–P8)

All nine packages of the [design](2026-07-15-wlo-mcp-apps-sdk-rebuild.md) are
implemented and verified. The one remaining action is external: the **P3.6
ChatGPT developer-mode render** against a live SSE deployment (manual user gate),
plus the operator steps in `docs/apps-sdk-submission-checklist.md`
(public HTTPS origin, reverse-proxy SSE config, PRIVACY.md contact).

## Post-plan follow-ups (2026-07-15)

- **Docker deployment finalized:** `.env`-override compose (loopback binding),
  `docs/DEPLOYMENT.md` (build/TLS/nginx-SSE/verify walkthrough). README DE/EN,
  env table (`MCP_SSE`), and the module tree (`apps/`, `services/`, +3 tools,
  +2 files) corrected for accuracy.
- **Release-readiness audit** (2026-07-15)
  — overall 84/100, verdict **Conditional** (no Critical/High). Prod dependency
  tree = 0 vulns.
- **Audit fix landed:** 🟡 F1 resolved — `safeHref` URL-scheme guard
  (`apps/widgets/shared/safe-url.ts`) on all four widget href sites; 261 tests
  pass. F2 (`wlo-api.ts` split) evaluated → deferred (optional, not biting). F5
  (`@vercel/node` dev advisories) handed to a background task.
- **Skills delivery (WLO-collection based):** new `GET /api/collection` endpoint +
  `listCollectionContents` service + `WLO_SKILLS_COLLECTION_ID` env (skills = files
  in a WLO collection, delivered via each node's anonymous `downloadUrl`). New MCP
  tool `find_wlo_skills` (21 → **22 tools**) reuses it + `getNodeDownloadText` so
  native MCP clients get skills too. **270 tests pass.** Live-verified: a true
  uploaded file's `eduservlet/download` returns the raw binary with its real
  content-type (a 322 KB PDF → `application/pdf`, `%PDF-`); a **web-link node**
  returns the linked page instead — so skill files must be REAL uploads, not links
  (documented in `.env.example`).
- **Launcher redesigned:** `public/launcher.html` around **Boerdi** the WLO owl
  (inline SVG, blue theme, WCAG AA) — AI picker + one Open button, advanced fields
  collapsed, skills sourced from `/api/collection`, native `find_wlo_skills` hint.
  Bilingual DE/EN verified live in the browser (deep-links, EN toggle, no console
  errors). Screenshots time out in this env (as in P6) → verified via the a11y tree.

## Apps-SDK hardening completed (2026-07-16)

Acts on the 2026-07-16 Apps-SDK compliance review
per [`docs/plans/2026-07-16-apps-sdk-hardening.md`](2026-07-16-apps-sdk-hardening.md).
All phases A/B/C now complete.

- **A1 (F2) portability, A2 (F1) MIME, A3 (F3) widgetAccessible, B1 (F5) url,
  B2 (F4) instructions, C1 wlo-api split** — landed earlier (275 tests).
- **A4 (F6) — `noauth` declared on all 22 tools.** `src/apps/tool-defaults.ts`
  (`applyReadOnlyToolDefaults`) wraps `server.tool` + `server.registerTool` once
  in `createMcpServer` and stamps `_meta.securitySchemes:[{type:'noauth'}]` onto
  every `RegisteredTool` (merged — widget `_meta` survives). Chosen over
  seam-only (which covers ~8 of 22) so the read-only stance is uniform. The base
  SDK descriptor has no top-level securitySchemes slot, so `_meta` is the only
  wire path (verified in `mcp.js`) and is exactly the docs' back-compat mirror;
  no `openai/` alias exists for this field.
- **C2 — `collections.ts` tree-traversal extracted.** The multi-level keyword
  fallback moved out of the `search_wlo_collections` handler (~123 lines) into
  the named `findCollectionsByTreeTraversal` + hoisted `matchesQuery`;
  behaviour-preserving, and the previously-untested fallback path is now pinned
  by `tests/collections-tree.test.ts`.

**Verification (evidence):**
- `npm run build` → tsc exit 0; widgets rebuilt (browse 5.9 / search-results 4.5 /
  topic-page 4.5 kB).
- `npm test` → **279 pass, 0 fail** (was 275 → +4: server all-22 securitySchemes
  coverage, `apps-security` merge ×2, `collections-tree` fallback ×1).
- New TDD: `server.test.ts` (RED→GREEN over all 22 tools), `apps-security.test.ts`,
  `collections-tree.test.ts` (characterization: green before AND after the extract).

## Apps-SDK re-check + alignment (2026-07-16)

Thorough gegencheck of the descriptor against the live Apps-SDK subpages (two
parallel doc-research passes; facts cross-verified).
Two code alignments landed from it (module `security.ts` → `tool-defaults.ts`):

- **Widget MIME (F1) confirmed correct** — the current docs enable the MCP-Apps
  bridge only for `text/html;profile=mcp-app` (our default); `text/html+skybridge`
  is the pre-migration value, kept as an env safety valve. Comment refined; no
  behaviour change.
- **F3 → current standard** — widget-callable tools now emit
  `_meta.ui.visibility:["model","app"]` (the current gate for widget→host
  `tools/call`) plus the legacy `widgetAccessible` aliases.
- **Required annotations** — `applyReadOnlyToolDefaults` also fills
  `destructiveHint:false` + `openWorldHint:false` on every tool (explicit values
  like `get_wikipedia_summary`'s `openWorldHint:true` preserved), closing the
  docs' "all three hints required" gap.
- **Invocation status strings (last "Kann" item)** — per-tool
  `openai/toolInvocation/invoking|invoked` (≤64 chars, German) from the copy
  table `src/apps/tool-status.ts`, stamped by name in the same wrap. A
  non-ChatGPT host ignores these `openai/*` keys.

**Verification:** `npm run build` exit 0; `npm test` → **285 pass, 0 fail**
(279 → +6: required-hints coverage, tool-defaults hint/override tests,
toolInvocation all-22 coverage, `tool-status` map tests). Docs synced (CHANGELOG,
recheck report, compliance audit, this file). Not committed.

**Docs synced (same change):** CHANGELOG (Changed), the compliance audit
(F6 resolved), the hardening plan (A4/C2 ✅). Not committed (user manages git).

**Still open (unchanged):** the **P3.6 ChatGPT developer-mode render** gate
(confirms F1 MIME + F3 drill-down live); the full golden-prompt regimen (S4).

## Whole-repo audit + remediation (2026-07-16)

Full 12-dimension audit (2026-07-16,
overall **73/100, Conditional**) via 4 parallel role-specific reader passes, every
finding verified against source. **All Critical/High/Medium findings remediated
the same day** under better-coding-workflow (see the report's "Resolution status"):

- **Blockers:** T1 launcher DOM-XSS href guard · T2 XFF rightmost-hop rate-limit ·
  T3 bounded `browse_collection_tree` recursion · T4 MCP error boundary +
  `unhandledRejection` · T5 64 KB download cap.
- **Hardening:** T6 postMessage origin/target · T7 Vercel error generic-ise + 405 ·
  T8 bounded fan-outs · T9 socket timeouts · T10 widget cache · container
  resource/privilege hardening · T-INJ untrusted-skill framing · upstream-miss
  logging · browse a11y focus/`aria-controls` · search `query` `.max(200)`.
- **Deferred (🟢, non-blocking):** DNS-rebinding allow-list; pure-maintainability
  refactors (shared `bestTitle`/`stripStoreRef`, central text caps, reranker weight
  table); remaining `nodeId` `.max()` caps.

**Verification:** `npm run build` exit 0; `npm test` **288 pass / 0 fail** (285 →
+3: download ×2, browse-depth ×1); live-smoked `POST /mcp` 200 + `405` wrong-verb;
`docker compose config` valid; prod `npm audit` 0. Docs synced (CHANGELOG,
audit report resolution, this file). Not committed.


## Pre-deploy audit remediation (2026-07-30)

All findings from the pre-deploy audit resolved under better-coding-workflow.

- **Follow-up prompts** — `sanitizeTitle` (control characters flattened,
  whitespace collapsed, 120-char cap) and the three remaining prompt builders
  consolidated into `src/apps/widgets/shared/follow-up.ts`; the `as never`
  casts in the reading widget replaced by explicit key maps.
- **`src/topic-page-api.ts` split** (448 lines → 265 + 190). Discovery stays;
  `src/topic-page-structure.ts` owns variant → swimlanes. Pure move, no logic
  change — 7 import sites updated.
- **`resolveExtractionUrl` guard** — a value that cannot serve as a base for
  `<url>/from-url` disables the service and warns instead of falling back to
  the default (a typo must not redirect material URLs to an unchosen host).
  TDD: RED on 5 cases, then GREEN.
- **Docs** — `get_wlo_content_text` added to README.de.md (table + detail);
  three undocumented env vars (`WLO_TEXT_EXTRACTION_URL`,
  `WLO_TEXT_TIMEOUT_MS`, `WLO_TOPIC_POOL`) added to both README tables;
  historical 22-tool counts (O9 benchmark, MCP Inspector cross-check) marked as
  historical rather than left to read as current; dependency-deferral rationale
  recorded in CONTRIBUTING (both languages).
- **Dependencies** — in-range `npm update` (`@types/node` 20.19.43, `tsx`
  4.23.1) cleared the low-severity esbuild advisory carried in through tsx.

**Also repaired:** five documentation files that a PowerShell
`Get-Content`/`Set-Content` round-trip in this session had double-encoded
(UTF-8 read as CP1252) and given a BOM. Repaired line-wise via a strict
round-trip test, because the files mixed damaged and correctly-encoded lines.
Line endings are LF, matching the rest of the repo.

**Verification:** `npm run typecheck` exit 0 · `npm test` **548 pass / 0
fail** (547 → +1: the extraction-URL guard) · `npm run build` exit 0, four
widget bundles emitted · `npm audit --omit=dev --audit-level=high` and
`npm audit --audit-level=low` both 0 vulnerabilities · encoding check 0
damaged lines / no BOM across 12 files. Not committed (user manages git).


## First live-deployment feedback (2026-07-30)

Five reports from https://wlo-mcp.87.106.195.152.nip.io/mcp, each root-caused
before a fix (`/better-coding-debug`), then implemented under
`/better-coding-workflow`.

| Report | Root cause | Fix |
|---|---|---|
| Widget appears inconsistently | Widget wired to `search_wlo_all` only | Renderer accepts a flat node list (split by `nodeType`); widget wired to all six list tools |
| Model struggles to continue after "Inhalte anzeigen" | `get_collection_contents`, `search_wlo_within_collection`, `get_related_content` registered with plain `server.tool` → no `structuredContent`, no widget | Moved onto the Apps-SDK seam with `nodeListSchema` |
| Volltext not fetched despite a known nodeId | `get_wlo_content_text` absent from the server `instructions`; its description discouraged the call with a wrong cost figure | Named in the instructions; cost claim corrected to the measured 288 ms |
| Content tiles too tall/narrow | `.wlo-tile__thumb` was portrait 3/4 | 16/9 — card stays portrait, image no longer sets the height |
| "Ausgewählte verwenden" needs far scrolling | Bar emitted after the grid with `position: sticky`, but the widget has no scrollport by design | Rendered above the grid |

Live evidence gathered before fixing: `get_wlo_content_text` answers in 288 ms
with 978 characters from the repository — the tool worked, it was never called.
A tool-by-tool probe showed 6 of 14 returning no `structuredContent`.

**Verification:** `npm run typecheck` exit 0 · `npm test` **555 pass / 0
fail** (548 → +7) · `npm run build` exit 0 · post-build wiring check: all six
list tools plus `get_wlo_content_text` advertise both widget and outputSchema.
Not committed (user manages git).

**One test deliberately reversed:** `widgets-wiring.test.ts` asserted "the
plain content search is NOT a widget tool". That pinned a design decision the
live feedback overturned; the assertion now requires the opposite, with the
reason recorded in the test. `widgets-tile.test.ts` kept its intent (one fixed
ratio for every preview) but no longer pins a portrait number.


## Widget flow findings closed (2026-07-30)

The three findings left open by the flow audit, all resolved.

- **topic-page had no actions at all.** Its swimlane cards now carry
  "Details" → Einzelansicht (licence, source) and from there "Volltext
  anzeigen" / "Ähnliche Inhalte"; a collection in a lane opens its contents.
  To avoid a second copy of the view, `renderDetail` moved to
  `shared/detail.ts` (pure move — search-results stayed green throughout) and
  `shared/mount.ts` became the tile-widget shell (open/close, Escape, focus
  per WCAG 2.4.3, follow-up routing), replacing `mountSimpleWidget`.
- **The selection message named no tool** — the only follow-up that did not.
  It now points at `get_nodes_details` with `nodeIds`.
- **Follow-ups are a ChatGPT capability.** Verified against the bridge: the
  MCP-Apps standard offers `tools/call` and `ui/update-model-context`,
  neither of which starts a user turn. No code change is possible without
  building in-widget navigation (a different feature); documented instead in
  both READMEs and `docs/TOOLS.md`. Confirmed all four widgets gate their
  buttons, so no host ever shows a dead control.

**Encoding check corrected.** The line-wise repair could only fix a line that
was damaged in its entirety, so a line holding BOTH damage and correct text
("werkzeugübergreifende … fünf") was neither repaired nor reported — the
earlier "0 defekte Zeilen" was wrong for that class. A sequence-level repair now
runs over every tracked and untracked text file; one line in README.de.md was
still broken and is fixed.

**Verification:** `npm run typecheck` exit 0 · `npm test` **563 pass / 0
fail** (557 → +6) · `npm run build` exit 0 (topic-page bundle 10.0 → 13.5 kB)
· `npm audit --audit-level=low` 0 vulnerabilities · repo-wide encoding scan
clean. Not committed (user manages git).

**Deliberately deferred:** `search-results/main.ts` still holds its own copy
of the open/close/focus loop because it also owns the multi-select; folding it
into the shared shell is its own change, noted in `shared/mount.ts`.


## Tool + widget audit, findings fixed (2026-07-30)

Scoped audit on three axes — all 23 tools called live, every button chain
simulated click → message → tool call, every widget fed real tool output.

**Mechanics were clean:** 0 tool errors, 0 broken button chains, 0 widgets that
render empty despite hits. The defects were one level up, in triggering.

| Fund | Fix |
|---|---|
| `search`, `search_wlo_content`, `search_wlo_all` all advertised "Video zur Eiszeit" | Descriptions differentiated; `search` framed as the citation entry point that forwards. Test pins that no multi-word example appears twice. |
| Topic-page markdown H1 printed `variantTitle` ("Fachportalstartseite") | Uses `collectionTitle` first, like the widget |
| Portal-level search answered a bare "0 Treffer" | Says which case it is (15 direct entries, none matching, 11 sub-collections) and names `get_collection_contents` |
| `search_wlo_topic_pages` had no `structuredContent` | Projects each theme page onto one collection tile + results widget |

**`search`/`fetch` overlap is by design** — the ChatGPT knowledge convention
requires both. What was removed is the shared EXAMPLE a router matches on, not
the overlap in purpose. Remaining conflicts checked and cleared: the only other
shared quoted strings are vocabulary values ("Mathematik") used as filter
examples, which is correct.

**A test of mine validated my own assumption.** The first version of the
empty-collection fix mocked `collectionTotal = 0`; live it is 15. The unit test
passed while the live behaviour did not change. Re-measured, test corrected to
the observed shape, then fixed.

**Verification:** `npm run typecheck` exit 0 · `npm test` **567 pass / 0
fail** (563 → +4) · `npm run build` exit 0 · live re-run of all four findings
against the production repository. Not committed (user manages git).


## Open display gaps closed (2026-07-30)

The two remaining tools whose output had no rendering, both solvable without a
design decision.

- **`get_node_details`** -> `nodeListSchema` (one node = a list of one) plus
  the results widget. A miss returns an empty list rather than no
  structuredContent, so the widget shows its empty state instead of the host
  failing. `get_nodes_details` deliberately untouched: batch resolver, no
  display job.
- **`get_compendium_text`** -> `contentTextSchema` plus the reading widget,
  which its own header names as the home for "editorial compendium prose". Bulk
  fetches keep every text but carry no `nodeId`, which gates the per-node
  actions off.

Verified live against the production repository: get_node_details renders 1
tile with the Details button and the licence row; a single collection renders
in the reading view with 6 actions; a 3-collection bulk renders the joined text
with 0 actions.

**Verification:** `npm run typecheck` exit 0 · `npm test` **571 pass / 0
fail** (567 -> +4) · `npm run build` exit 0 · `npm audit` 0 vulnerabilities.
Not committed (user manages git).

**Still open and NOT done here** (deliberate): optional auth (planned, no code —
recommended to wait for write features); the second-server setup guide with a
real load measurement; the final domain decision before any ChatGPT submission;
manual screen-reader/keyboard pass; the German closing-quote sweep (118 spots,
cosmetic, wants its own diff).


## Auth: P0 executed, modes 1+2 shipped (2026-07-30)

### P0 findings (staging + prod, live probes)

The verification spike overturned the earlier design AND my own recommendation
from the same day to drop the login page in favour of host-managed OAuth.

- No OIDC discovery, no Dynamic Client Registration -> a host cannot
  self-configure OAuth against WLO.
- The repository OpenAPI declares exactly `basicAuth` + `cookieAuth`.
  **No Bearer.** A Bearer header is ignored, not rejected.
- `POST /oauth2/token` exists but needs an operator-registered client, and
  its tokens are of unverified use against the REST endpoints we call.
- **Wrong credentials answer 200 as guest**, never 401. No loud failure mode.
- Identity: `GET /rest/iam/v1/people/-home-/-me-` -> `person.authorityName`,
  `esguest` when unauthenticated.

### Shipped

A credential CHAIN rather than three deployment modes, so one instance can
later serve several rungs and write tools attach to the same seam:

| Rung | State |
|---|---|
| per-user login | blocked on a WLO-operator decision (see below) |
| service account from env (HTTP Basic) | **done** |
| anonymous | unchanged |

- `src/auth/credential.ts` - env -> Basic header; both halves required
  (half a credential would silently downgrade to guest).
- `src/auth/identity.ts` - asks the repository who we are, because it will
  not tell us on its own.
- `src/tools/auth.ts` - `wlo_auth_status`, reporting mode and whether it
  works as two separate facts.
- `wloFetch` attaches the credential to the repository ONLY; a look-alike
  host and every third-party service are pinned by test.

### Open: per-user login

Two routes remain, neither buildable on assumptions:
(a) an MCP-hosted login page verifying WLO credentials via Basic + `-me-`;
(b) a registered `oauth2/token` client, IF the operators can create one and
its tokens are accepted by our endpoints. Needs a decision plus access.

**Verification:** `npm run typecheck` exit 0 - `npm test` **587 pass / 0
fail** (571 -> +16) - `npm run build` exit 0 - `npm audit` 0 vulnerabilities.
Live: `wlo_auth_status` reports mode=anonymous/authority=esguest without env
credentials, and `search_wlo_all` returns unchanged results. Not committed.


## Auth chain finished (2026-07-30)

All three rungs live. The correction that unblocked it: P0 proved OAuth2/Bearer
unavailable, which was over-read as "no per-user login". `basicAuth` is a
declared scheme — the same one other WLO clients use — so per-user login was
never blocked by the repository, only the DELIVERY of the credentials was open.

| Rung | Delivery | State |
|---|---|---|
| personal account | `Authorization: Basic` from the AI host connector settings | done |
| service account | `WLO_SERVICE_USER` / `WLO_SERVICE_PASSWORD` | done |
| anonymous | nothing configured | unchanged |

Closing package:
- **Boot-time verification** of a configured service account, logged. Silent and
  network-free when nothing is configured; never throws.
- **REST layer pinned anonymous** — a caller-supplied Authorization header on
  `/api/*` is not adopted, driven through a real HTTP server in the test.
- **Setup docs** in `docs/TOOLS.md` (section 1a): the chain, how to build the
  header, how to confirm it works, and why Basic rather than OAuth.

Security properties held by test: per-request isolation via AsyncLocalStorage
(three interleaved users), credential only ever sent to the repository host,
Bearer refused rather than forwarded, no credential material in any tool output.

**Verification:** `npm run typecheck` exit 0 - `npm test` **598 pass / 0
fail** (593 -> +5) - `npm run build` exit 0 - `npm audit` 0 vulnerabilities.

**NOT yet verified — needs real credentials:** that a genuine WLO login is
accepted end to end. The mechanism follows the API spec and both branches are
tested, but no real account has been used. To check without credentials
entering a chat: put `WLO_SERVICE_USER`/`WLO_SERVICE_PASSWORD` into a local
`.env` (gitignored) and run the server with `node --env-file=.env`; then
`wlo_auth_status` must report `authenticated: true`.


## Auth review + fixes (2026-07-31)

A review of the credential chain before deploying it — the auth package was the
only part of the day's work that changes the security posture, and it had never
been reviewed. It found one critical defect the whole test suite had missed.

**The critical one: the public REST layer inherited the service account.**
`GET /api/*` and the launcher are reachable from the internet with no login,
but the credential chain applied there too. Everything the account could see
beyond public was world-readable, with no authentication and no audit trail —
and it contradicted the design's own explicit scope line for that surface. It
was measured, not inferred: an anonymous `GET /api/search` produced upstream
calls carrying `Basic …`.

Why nothing caught it: the existing test pinned that `/api/*` ignores a
CALLER-supplied header, which it always did. Nobody had asked the other
question — what the server does with the credential it configures itself.

The chain now needs an explicit scope. `runAnonymous` marks a call as
deliberately unauthenticated (`null` in the ALS, distinct from "no scope"), and
the public surface opens one.

Also fixed:
- Caller-supplied account name reached the model unsanitized (line breaks
  survived into `wlo_auth_status`). The repository-supplied authority and
  profile name are cleaned at the same boundary — the logged-in person can edit
  those too. Rule extracted from the widget module to `src/text-sanitize.ts`.
- A credential over a non-`https` repository URL went out in the clear with no
  warning; the boot check now says so (loopback exempt).
- The endpoint could relay credential guessing. Capped by DISTINCT logins per
  client (`AUTH_CREDENTIAL_LIMIT`, default 10/10 min), not by request rate — a
  rate cap would throttle exactly the per-user clients it should serve. Only
  schemes we actually forward count; digests stored, never raw values.
- Docs corrected: the design doc claimed per-user login was still open while
  the code implemented it, and claimed the REST layer was anonymous while it
  was not. `.env.example`/README had no mode-3 documentation at all.

**Risk discharged:** "SSE response mode breaks ALS propagation" was listed in
the design and never tested — only an isolated unit test existed, which would
have stayed green while every per-user request silently fell back to the
service account. Now driven through a real `node:http` server with `MCP_SSE=1`,
three concurrent users overlapping in flight. The test was confirmed to go red
when the propagation is deliberately broken. It does not break: propagation
works.

**Verification:** `npm test` **619 pass / 0 fail** (598 -> +21) -
`npx tsc -p tsconfig.typecheck.json --noEmit` exit 0 - `npm run build` exit 0 -
`npm audit --omit=dev` 0 vulnerabilities - `docker compose config` valid.
Not committed.

**Still open:**
- The write-capable test account (`WLO-Upload`) must be swapped for a read-only
  one before mode 2 goes into regular operation. Deliberate for now, so future
  write tools can be tested.
- Whether ChatGPT/Claude connector UIs accept a custom `Authorization` header
  is untested, so mode 3 is "available where the host supports it".
- `api/mcp.ts` (Vercel, retained but unused) does not read the header, so mode
  3 would not work there.
- `runAnonymous` is opt-out, not opt-in: a NEW public surface added as its own
  top-level branch in `http-app.ts` would inherit the service account again.
  All current `/api/*` routes are covered because they share one call site.

### German closing quotes swept (same day, own diff)

The item parked as "118 spots, cosmetic, wants its own diff" — done as its own
change. German quotation is `„…“`; 123 places closed with an ASCII `"` instead,
including two lines written earlier the same day.

108 in Markdown, 9 in TypeScript, 6 in the launcher HTML. Every code occurrence
was inspected individually first: all sit inside template literals, HTML text,
or single-quoted strings, so no ASCII `"` being replaced was a string
terminator. No occurrence fell inside a fenced code block.

Two tests pin these strings and were updated in lockstep — deliberately by
watching them go red first. One of them, `tools-auth.test.ts`, asserts the
ABSENCE of an empty quote pair, so the changed closer would have made it
silently vacuous rather than failing; it was re-checked against a deliberately
reintroduced bug afterwards.

A line-bounded rule missed three quotes that wrap a line break — invisible to
the "0 remaining" counter that shared the same assumption. Found by inspecting
the list of opening quotes with no closer on their line, and re-verified with a
multi-line-aware pass. (Two entries on that list are correct as they stand: the
widget locale table and a negative regex.)

**Verification:** `npm test` **619 pass / 0 fail** - typecheck exit 0 -
`npm run build` exit 0 - no mojibake in any touched file. Not committed.

### Public surfaces made safe by default (same day)

The recurrence risk recorded above — `runAnonymous` was opt-out, so a new
top-level branch in `http-app.ts` would inherit the service account again —
is closed by inverting the default instead of by remembering.

The whole HTTP handler now runs inside an anonymous scope. The MCP endpoint is
the single branch that elevates, and it resolves the chain itself
(`userCred ?? configuredServiceCredential()`) rather than relying on a fallback
that would also reach anything added later. The per-surface `runAnonymous` on
`/api/*` was removed as redundant — which is what makes the new default
load-bearing rather than decorative.

Behaviour is unchanged (the suite stayed green across the restructure). That the
outer scope actually carries the protection was checked by removing it: the
public-REST test fails, the MCP test still passes. The scope contract itself
("no scope" ≠ "explicitly anonymous", and nesting a user credential inside an
anonymous scope works) is now pinned in `auth-per-user.test.ts`.

`api/mcp.ts` needs no equivalent: it serves only the MCP endpoint, where the
service account is the intended identity. `stdio.ts` likewise runs in the
operator's own process.

**Verification:** `npm test` **621 pass / 0 fail** (619 -> +2) - typecheck
exit 0 - `npm run build` exit 0. Not committed.

## Live verification of all three modes + two real defects (2026-07-31)

Ran the built server against the production repository instead of asserting the
modes from the code. Two things that testing against a fake could not show.

**All three modes confirmed:**
| Mode | Delivery | Live result |
|---|---|---|
| anonymous | nothing configured | public content, authority `esguest` |
| service | `WLO_SERVICE_USER`/`_PASSWORD` | `mode: "service"`, `authenticated: true` |
| user | `Authorization: Basic` header | `mode: "user"`, `authenticated: true` |

Mode 3 had never been checked against real WLO. Trick that made it possible
without a second account: deliver the SAME credentials via the header instead
of the environment — if the rung works, the mode flips from `service` to `user`.
It does.

**The public-REST fix confirmed under production conditions:**
`GET /api/search?query=Entwurf` → 1459 (public), while the service account sees
1464. Before the fix that surface would have served 1464 to anyone.

**Defect found: a misconfigured server said "nothing found".** With a wrong
password every upstream call is 401, and `search_wlo_all` answered
"Gefundene Treffer gesamt: 0" with `isError: false`. `enhancedSearch` treated
"every query variant failed" as "no matches" — resilience applied one level too
far. All-variants-failed now throws. Re-checked live with the same broken
config: `isError: true`, "…(ngsearch failed: 401 Unauthorized)".

**Documented fact corrected.** "edu-sharing does not reject wrong credentials,
it answers as guest" is FALSE. Wrong credentials get `401`, on the identity and
the search endpoint alike, for a wrong password on a real account as well as an
unknown user. Only the ABSENCE of a header yields `200`/`esguest`. The claim had
spread from a 2026-07-30 probe into `.env.example`, both READMEs,
`docker-compose.yml`, `docs/TOOLS.md`, the design doc, the boot warning and the
tool description — all corrected. The consequence is the opposite of what was
written: a typo does not degrade to public data, it stops the server answering.

**Verification:** `npm test` **623 pass / 0 fail** (621 -> +2) - typecheck
exit 0 - `npm run build` exit 0. Live probes as above. Not committed.

**Skill layer — assessed, not yet changed.** `~/.claude/skills/wlo-mcp-search`
(314 lines) documents this server's search tools and says nothing about the
three modes or `wlo_auth_status`; `wlo-edu-sharing-api` covers Basic auth and
already advises preferring a passed-through user header, but carries no note
that wrong credentials are rejected with 401, and its Bearer/OAuth2 line is
about the backend filter and reads as available on WLO, where it is not
(no discovery, no DCR, token endpoint needs a registered client). Both are the
user's cross-project knowledge base — proposed, awaiting the user's go.

### Open points worked through (2026-07-31, later)

- **Skill layer updated** (user's cross-project knowledge base, with their go).
  `wlo-mcp-search` was stale beyond the auth gap: it named the Vercel endpoint
  as production, the old source path, "12 Tools" (there are 24 — counted from a
  live `tools/list`, a grep would have said 16 and been wrong), and stated
  "read-only, öffentlich, kein Auth-Header". All corrected, plus a section on
  the three modes and the `/api/*` scope rule. `wlo-edu-sharing-api` kept its
  (correct) statement about what the backend filter supports and gained a
  clearly-scoped WLO note: Bearer is ignored rather than honoured there, wrong
  credentials give 401, and `-me-` is the identity probe.
- **`api/mcp.ts` now resolves the same credential chain**, so the retained
  Vercel path cannot silently lack per-user mode.
- **Widget duplication: deliberately NOT refactored.** Only `search-results`
  duplicates the tile shell (`reading` and `browse` are different widgets, not
  copies — checked, an earlier note implying three was wrong). The blocker is
  coverage: the widget tests exercise `render.ts`, so `main.ts` interaction glue
  has none, and behaviour preservation could not be demonstrated. Added a
  source-level drift test instead, and verified it fires.

**Verification:** `npm test` **626 pass / 0 fail** (623 -> +3) - typecheck
exit 0 - `npm run build` exit 0. Not committed.

## New scope: write support / curation — research phase (2026-07-31)

New order: create and submit content, improve and save existing content, the
same for collections and sub-collections, edit/regenerate compendium texts,
produce and store full texts, choose metadata with vocabulary support, delete
content and collections, use the suggestions endpoints for accept/reject, and
consider comments/ratings. All work targets **staging**.

Research (no code, no writes to staging):
**`docs/plans/2026-07-31-write-support-research.md`**

Headline findings:
- **Full text is mostly not a write.** `GET …/textContent` is itself the
  extraction trigger: measured on a link record it returned 1941 characters and
  left `ccm:fulltext_status = CONTENT_AVAILABLE`, second call served from cache.
  `POST /textContent` is only needed where the repository cannot extract.
- **LRT settled.** `ccm:oeh_lrt` carries `new_lrt`; the aggregation is published
  in the vocabulary (214/220 concepts map to exactly one target, none to more)
  and 300 sampled nodes never carry one field without the other. Author the full
  LRT, let the mandatory read-back reveal whether the repository derives the
  aggregated one. Search keeps using the aggregated vocabulary (user decision).
- **`/suggestions/v1`** is purpose-built for the accept/reject flow
  (`type=AI`, then `PATCH status=ACCEPTED|DECLINED`).
- **Submitting** is `asProposal=true` on the reference PUT — there is no
  `POST /proposals`.
- **MDS membership decides the write route** — verified: both LRT fields are in
  the MDS, compendium text and the fulltext properties are not.
- Governing rule for everything: **never trust a `200` — read back.**

**Deferred decision (user, 2026-07-31):** no license gate on stored full text
for now — WLO has read use cases that are not prohibited; narrowing comes later.
Recorded in §3a of the research doc; revisit before production use.

**Update (same day):** the user supplied the upload process of the sibling
metadata-agent project — a proven six-step flow against the same repositories.
It answered minimum metadata and where new nodes land, and it added a mechanism
we had missed entirely: **Alfresco aspects**. A property whose aspect is not set
is dropped silently, which makes three independent silent-drop mechanisms (MDS
filter, missing aspect, missing right) and one countermeasure for all of them.
It also changed the "submit" conclusion: WLO editorial runs on the workflow
endpoint (`status: 200_tocheck`), not on `asProposal`.

Two claims in that document did not survive checking: `ccm:oeh_flex_lrt` is
neither in the MDS nor on any sampled node, and `ccm:oeh_event_begin` *is* an
MDS widget today. Also corrected: **my own** earlier "no node carries one LRT
field without the other" was wrong — 30 of 400 do, and every one of them is
tagged "Unterrichtsplanung", one of the six concepts the vocabulary maps to
nothing. The exception explains itself, which makes the derivation conclusion
stronger than when it had no exceptions.

**Controlled writes done (authorised, 2026-07-31).** One throwaway node in the
service account's `-userhome-` — deliberately not the shared inbox, and no
workflow started, to keep test noise out of the editorial queue. Deleted
afterwards; it now sits in that account's archive and can be purged or restored.
Findings in §5a of the research doc:

- **The title is silently overwritten at create time** with a value derived from
  `ccm:wwwurl`. Set it in the metadata step. Not in the sibling documentation.
- **Full-text extraction is URL-driven, not content-driven.** Decisive test: a
  throwaway node whose `ccm:wwwurl` pointed at a real page returned **101 125
  characters** via `GET …/textContent?forceUpdate=true`, with
  `ccm:fulltext_status = CONTENT_AVAILABLE` — while the 92 bytes previously
  written via `POST /textContent` were ignored. So `POST /textContent` is not
  destructive, just pointless for a link record: the bytes are stored and never
  read. An earlier note here blamed `TRANSFORM_ERROR_EXTERNAL` on the POST; it
  was caused by the dead `example.org` URL of the first test node. Corrected.
  **Erschließung therefore needs no write at all**, also for newly created
  records: set a correct URL, force the extraction, done.
- **The aspect step is not the prerequisite it is described as** — the author
  field wrote without `cm:author`, and `cm:geographic` was added by the
  repository itself. MDS filtering, by contrast, is exactly as documented.
- **`POST /metadata` creates a version every time** (5 versions after 5 writes).
- **Delete must be treated as irreversible.** `recycle=true` is the flag that
  decides recoverability and must always be set explicitly, and
  `POST /archive/v1/restore/` exists — but the archive search could not be
  relied on: the person-scoped query found the first deleted node once, then
  minutes later returned 0 entries and no longer found it either. A tool cannot
  demonstrate recoverability at the moment of deletion, so it must confirm
  first and must not promise a restore it cannot verify.
- Suggestions, comments and ratings all answer `200` on staging (read paths).

**Social features (from the Ideendatenbank app, 2026-07-31):** comments and
ratings are hardcoded to `ccm:io` — a **collection cannot be commented on or
rated** (`500` from the Java layer). `PUT /rating` returns `500` on production
*and stores anyway* (`config.values.rating is null` — treat exactly that text as
success, then read back); `DELETE` leaves the rating, use `PUT ?rating=0`.
Comment bodies are raw UTF-8, rating bodies are JSON-quoted — both with
`Content-Type: application/json`. The global skill `wlo-comments-ratings` was
corrected: it documented `POST …?rating=4.5`, but the path has only `PUT`/
`DELETE` (`POST` → `405`) and a float value is silently discarded.

**Skills updated to anchor this knowledge (2026-07-31):** `wlo-comments-ratings`
(rating write path corrected, `ccm:io`-only constraint, delete workaround) and
`wlo-edu-sharing-api` (URL-driven full-text extraction, `POST /textContent`
pointless for link records, silent title overwrite at create, `obeyMds`,
aspects, versioning, delete/recycle and unreliable archive search).

**Still open — decisions, not discoveries:** where full text goes for the
records the repository cannot extract; versioning policy (`PUT` drafting vs
`POST` commit); the write paths of suggestions/comments/ratings; and an explicit
allow-list of fields a curation tool may set (the sibling project uses a
`repo_field` flag we have no equivalent for).

**Security note:** the pasted upload document contains a plaintext password for
the `WLO-Upload` account, so it is now in the conversation transcript. Rotating
that credential was recommended.

## Write support: design + tasks ready (2026-08-01)

Knowledge phase closed. Plan written, **awaiting approval — no code yet**:
- Design: `docs/plans/2026-08-01-write-support-design.md`
- Tasks:  `docs/plans/2026-08-01-write-support-tasks.md` (18 tasks, 6 phases)

User decisions taken into the design: all four areas in scope; confirmation via
a two-step preview + token (works on every host, unlike elicitation); the
writable field set limited to the sibling project's core fields; new nodes land
by mode (`-userhome-` vs inbox) and the review workflow runs only on explicit
submit, so drafts never reach the editorial queue.

Chosen architecture: one shared write pipeline in `src/services/write/`
(gate → resolve → plan → confirm → write → read back → report) with thin tools
on top, rather than self-contained tools. The read-back is step 6 of the
pipeline, not per-tool discipline — three separate edu-sharing mechanisms
discard a write while answering `200`.

Deliberately out of scope, each with a reason in the design: comments/ratings
(own error contract, `ccm:io`-only), storing full text (no working route
exists — the deliverable is telling the user so), preview images, ACLs.

**Phase 6 (suggestions) is blocked by design** and opens with a live probe: the
endpoint shapes are verified but the write paths are not, and the promised
workaround code from the sibling app never arrived.

Skills updated the same day so this knowledge survives outside the repo:
`wlo-edu-sharing-api` (full text, write traps, suggestions), `wlo-content-files`
(full text, what creates a version), `wlo-comments-ratings` (rating write path
corrected), `wlo-collections-references` (delete/recycle).

## Write support Phase 1 done: the shared write pipeline (2026-08-01)

Tasks 1–5 implemented TDD, each red before green. Nothing is user-visible yet —
no tool registered, no endpoint touched. What exists is the machinery every
later mutation goes through:

| File | What it does |
|---|---|
| `src/services/write/credential-gate.ts` | `writeMode()` / `requireWrite()` — anonymous never writes; a service account only with `WLO_ALLOW_SERVICE_WRITES` |
| `src/services/write/fields.ts` | the 14-field allow-list, licence key check, VCARD transform, vocabulary resolution |
| `src/services/write/change-set.ts` | the diff a user confirms, rendered in German, sanitized |
| `src/services/write/confirm.ts` | single-use tokens bound to a SHA-256 of the change set, TTL 10 min |
| `src/services/write/verify.ts` | the read-back: `stored` / `dropped` / `changed` per field |

**Verification:** `npm test` → 680 tests, 680 pass, 0 fail (626 before this
phase, 54 new). `npx tsc -p tsconfig.typecheck.json --noEmit` → clean.
`npm run build` → clean.

**Three departures from the task list, each recorded there with its reason:**
1. The VCARD shape in the task list was written from memory and was wrong. The
   implementation follows what the WLO metadata agent actually uploads
   (`VERSION` directly after `BEGIN`, `N` with five components) — that is the
   format the existing records carry.
2. `CC_0`/`CC0` are excluded from the "default the version to 4.0" rule. CC0
   exists only as 1.0; defaulting it to 4.0 would invent a licence, which is the
   exact defect the licence allow-list exists to prevent.
3. Vocabulary fields additionally check that a resolved URI really belongs to
   that vocabulary. `resolveVocab` passes any `http…` input through — right for
   search, wrong for a write.

**Retracted at the start of Phase 2:** Phase 1 closed with a "trap found" note
saying `ccm:lifecyclecontributer_author` needs the `cm:author` aspect. That was
taken from the sibling project's documentation and contradicts our own measured
evidence — the research doc records that the field wrote fine without the aspect
(`ccm:io` already carries `cclom:lifecycle`) and says in as many words: do not
build it as a hard gate, let the read-back decide. No aspect step is being
built. The lesson is the one the research doc already states at the top:
documentation loses to measurement, including when the documentation is a
sibling project's working code.

**Next:** Phase 2 (Tasks 6–8) — the first end-to-end slice, editing an existing
record, which is where the pipeline first becomes visible to a user.

## Write support Phase 2 done: the first end-to-end slice (2026-08-01)

Tasks 6–8, TDD throughout. The server can now change data — one tool, with the
whole apparatus from Phase 1 wired behind it.

| File | What changed |
|---|---|
| `src/services/write/nodes.ts` | new — `updateNodeMetadata`: MDS route vs property route, `PUT` draft vs `POST` commit, bulk-then-field-by-field retry |
| `src/tools/curation-shared.ts` | new — the two-step conversation: preview, refusal, honest per-field report. Kept out of `tools/shared.ts`, which is about search |
| `src/tools/curation-content.ts` | new — `wlo_update_content` |
| `src/server.ts` | `createMcpServer(mode)`; curation tools register only when the mode is not `none` |
| `src/http-app.ts`, `api/mcp.ts` | resolve the credential BEFORE building the server and pass the mode through |
| `src/apps/register.ts`, `src/apps/tool-defaults.ts` | a tool may declare its own `_meta.securitySchemes`; `noauth` became a default rather than a rule |

**Verification:** `npm test` → 705 tests, 705 pass, 0 fail (680 before this phase,
25 new). Typecheck clean, build clean.

The load-bearing test asserts on the RECORDED UPSTREAM CALLS, not on reply text:
a preview call must produce zero write requests. A tool that reports "nothing was
written" while having written is exactly what the two-step exists to prevent, and
reply text cannot detect it.

**Also fixed, because the change made them false:** the `noauth` claim would have
been stamped on a tool that refuses anonymous callers; `api/mcp.ts` built its
server before resolving the credential, so a per-user caller there would have
been given the service account's tool list. Docs synced in the same change —
`.env.example`, both READMEs (new "Kuratieren / Curation" section, the
`WLO_ALLOW_SERVICE_WRITES` row, the "24 tools" claim), CHANGELOG.

**Open decision for the user:** in stdio mode the credentials come from the
environment and therefore count as a service account, so writing there needs
`WLO_ALLOW_SERVICE_WRITES=1` even when the env holds a person's own login. That
errs safe and is documented, but it is a friction worth confirming.

**Next:** Phase 3 (Tasks 9–10) — the `new_lrt` vocabulary, 220 concepts, and
wiring it into the field layer.

## Write support Phase 3 done: the authoring vocabulary (2026-08-01)

Tasks 9–10, TDD throughout.

| File | What it is |
|---|---|
| `scripts/generate-lrt-vocab.mjs` | new — regenerates the table from the published SKOS vocabulary; the counts it prints are the ones the test pins |
| `src/vocabs-lrt.ts` | new, GENERATED — 220 concepts, `AGGREGATION` (214), `UNMAPPED` (6), `resolveLrt` |
| `src/services/write/fields-lrt.ts` | new — the content-type validator, split out when `fields.ts` passed 300 lines |
| `src/services/write/fields.ts` | `ccm:oeh_lrt` now resolves against `new_lrt`, not the aggregated table; `FieldValidation` gained an optional `note` |
| `src/vocab-suggest.ts` | `suggestFromEntries` extracted so the 220-concept vocabulary reuses the existing fuzzy matcher instead of growing a second one |
| `src/tools/curation-shared.ts` | notes are shown in the preview, above the confirmation line |

**Verification:** `npm test` → 727 tests, 727 pass, 0 fail (705 before this phase,
22 new). Typecheck clean, build clean. The generator's own output confirms every
number the plan predicted: 220 concepts, 214 mapped (broadMatch 153,
relatedMatch 58, exactMatch 3), 6 unmapped with exactly the named labels.

**Found during generation, not in the plan: two labels are shared.**
"Suchmaschine" exists both under "Quelle" (a source website that is a search
engine) and under "Inhalteverwaltung, Suche" (a tool); "Stationenlernen" exists
as a pedagogical method and as an open activity. They mean different things, so
`resolveLrt` returns `ambiguous` with both candidates and their parent concepts
instead of picking the one that sits earlier in the hierarchy. Silently choosing
would write a content type the curator did not choose — the same class of defect
as an invented licence.

**Also found: `exactMatch` is not a safe source for the aggregation.** Some
concepts carry an `exactMatch` into an unrelated `contentTypes` vocabulary, so
the generator filters all match kinds by namespace rather than taking the first.

**Next:** Phase 4 (Tasks 11–13) — duplicate check, create, submit for review.

## Write support Phase 4 done: create and submit (2026-08-01)

Tasks 11–13, TDD throughout.

| File | What it is |
|---|---|
| `src/services/write/nodes-lifecycle.ts` | new — `findByUrl`, `createContentNode`, `resolveCreateParent`, `submitForReview` |
| `src/services/write/nodes.ts` | now only the write transport for an existing node; `failureDetail` exported for the split |
| `src/services/write/change-set.ts` | `action` — a mutation that changes no field but still needs confirming (submitting); `hasSomethingToConfirm` |
| `src/tools/curation-content.ts` | `wlo_create_content`, `wlo_submit_content`; the field schema shared between update and create |
| `src/wlo-config.ts` | `WLO_INBOX_ID`, deliberately without a default |

**Verification:** `npm test` → 752 tests, 752 pass, 0 fail (727 before this phase,
25 new). Typecheck clean, build clean.

The load-bearing test is "creating never touches the review workflow": it creates
a record end to end and asserts zero `/workflow` calls. Submitting spends a
reviewer's attention and cannot be taken back quietly, so it must never happen
as a side effect of writing a draft.

**Two splits, both forced by the 300-line threshold, both behaviour-preserving:**
`nodes.ts` (310) → transport vs. lifecycle; `fields.ts` had already been split in
Phase 3. The design's file table estimated `nodes.ts` at ~200 lines for create +
update + delete + duplicate + submit; that estimate was wrong and the split is
the response.

**Decisions made here that the user has not yet confirmed:**
- `WLO_INBOX_ID` has no default and service-account creation is refused without
  it. A hardcoded id would point at a different collection on staging than on
  production — but it does mean the variable must be set before the service
  account can create anything.
- A create is confirmed against a change set anchored on the URL, since the
  record has no id yet. The read-back afterwards uses the new id.

**Still open from Phase 2:** whether stdio should write without
`WLO_ALLOW_SERVICE_WRITES`. Explained in the Phase 2 report; no code change made.

**Next:** Phase 5 (Tasks 14–17) — collections, compendium text, delete.

## Write support Phase 5 done: collections, compendium, delete (2026-08-01)

Tasks 14–17, TDD throughout. Seven more tools; the curation surface is now ten.

| File | What it is |
|---|---|
| `src/services/write/collections.ts` | new — create, rename, add reference, remove reference, delete collection |
| `src/services/write/nodes-lifecycle.ts` | `deleteContentNode` — always `recycle=true`, explicitly |
| `src/services/write/nodes.ts` | `deleteProperty` — the only way to clear a property (`null`, not an empty value) |
| `src/tools/curation-collections.ts` | new — create/rename/add/remove, none destructive |
| `src/tools/curation-compendium.ts` | new — `wlo_update_compendium` |
| `src/tools/curation-delete.ts` | new — both irreversible acts together, so the "no way back" wording is written once |

**Verification:** `npm test` → 790 tests, 790 pass, 0 fail (752 before this phase,
38 new). Typecheck clean, build clean.

One earlier run reported 2 failures — it ran concurrently with `tsc` and counted
only 778 tests, the signature of resource starvation rather than a defect. Two
consecutive full runs and three targeted runs of the two files were clean.

**The two assertions this phase exists for:**
1. Removing material from a collection must never reach the node endpoint. The
   reference endpoint and the node endpoint differ by one path segment, and a
   conversation blurs exactly that. Asserted on the request URL.
2. No deletion reply may promise a restore. `recycle=true` is always sent, but
   the archive query could not demonstrate recoverability — so the tools say the
   deletion cannot be undone through this server and stop there.

**Deviation from the plan, recorded:** Task 16 called for
`src/services/write/compendium.ts`. It was not built. `updateNodeMetadata`
already routes `ccm:oeh_collection_compendium_text` through the property
endpoint via the field allow-list, so a separate service would have duplicated
the one thing that matters. What was missing was clearing a property, which is
five lines (`deleteProperty`) rather than an eighty-line module.

**Also:** `curation-content.ts` would have passed 300 lines with a delete tool
in it. Delete went to its own file instead — which is the better home anyway,
since content and collection deletion share their safety wording.

**Inbox id, measured 2026-08-01:** the id from the metadata-agent config
(`21144164-…`) belongs to a node that EXISTS on staging and production — 403
DAOSecurityException, where an invented id answers 404 DAOMissingException and a
known public node answers 200. Not proven: that it is the upload inbox, or that
the account may write into it. Recorded in `.env.example` as an example value
with that evidence level, not as a default.

**Next:** Phase 6 (Task 18) — the suggestions probe, which is a live measurement
against staging, not code. It is blocked by design until that probe succeeds.

## Phase 6 unblocked: the suggestions probe succeeded (2026-08-01)

Task 18 run live against **staging** with the `WLO-Upload` service account, on
three throwaway `ccm:io` nodes the probe created and deleted itself
(`recycle=true`). No code written. Full record: research doc §8.

| Step | Result |
|---|---|
| `POST …?type=AI&version=…` (body = array) | `200`, stored with `status: PENDING` |
| `GET …` | `200` |
| `PATCH …?id=…&status=ACCEPTED` | `200`, read-back confirms `status: ACCEPTED` |

**The blocking condition is lifted.** Two findings change what Phase 6 builds:

1. **POST returns an array, GET returns a map keyed by `propertyId`.** Reading
   the GET as an array reports "no suggestions" for a node that has them — it
   bit the probe itself on its first run.
2. **Accepting does NOT apply the value to the node.** After `ACCEPTED` the
   property was still absent. `/suggestions/v1` records proposals and decisions;
   applying them stays our job, through `updateNodeMetadata` and its read-back.
   A tool that stopped at `PATCH` would report a recorded opinion as a changed
   record.

A new **Task 19** is therefore in the task list: three design questions to
settle before the tools (does accepting apply in the same call; who may accept;
is `USER_PROPOSAL` in scope). The original plan left Phase 6's tools
unspecified on purpose, because the probe's outcome would decide their shape.

**Incidental finding, worth acting on:** the local `.env` points
`WLO_REPOSITORY_URL` at **production** (`redaktion.openeduhub.net`), not
staging. The probe overrode the host explicitly rather than trusting the file.
Anyone running write experiments from this checkout should check that first.

## Fixed while switching to staging: `.env` was never loaded locally (2026-08-01)

Asked to point the local checkout at staging, the file change alone did not do
it — and finding out why matters more than the change.

`npm run dev`, `dev:http`, `start` and `start:http` did **not** read `.env`.
There is no `dotenv` dependency and no `--env-file` flag; only `docker compose`
ever loaded that file. So `WLO_REPOSITORY_URL` in `.env` had no effect on any
local run, which fell back to the built-in default in `wlo-config.ts` — the
**production** instance. Anyone editing `.env` to avoid touching production was
protected by nothing, and no warning said so.

Measured before the fix: `.env` set to staging, resolved config still
`https://redaktion.openeduhub.net/edu-sharing`, service credential `(keins)`.
After: staging, credential `WLO-Upload`, and `npm run dev` logs
`repository credential verified`.

Fix: the four scripts pass Node's own `--env-file-if-exists=.env` — no
dependency added, and a missing file is tolerated. `npm test` deliberately does
not, so the suite stays independent of a local file (790/790 still green).
`engines.node` raised to `>=20.12.0`, the release that added the flag.

This is also why the suggestions probe overrode the host in its own script
instead of trusting the environment. That was caution at the time; it turns out
to have been the only thing standing between the probe and production.

## Added outside the write-support plan: `get_node_collections` (2026-08-01)

Requested directly by the user on a pre-measured report from the chatbot team.
Not part of the write-support plan — a read tool, recorded here so the addition
is not silent.

**Their report was verified before any code was written**, anonymously against
production, and every claim reproduced:

```
reference c2e9b9ca-… → originalId 5a19e0e1-…, aspect ccm:io_reference present
usages/5a19e0e1-…/collections → 200, 2 ACTIVE: "Ernährung", "Biologie-Breakouts"
usages/c2e9b9ca-…/collections → 200, 0 entries      ← the silent empty
```

Two details the report did not state, measured here:
- the response is a **bare array**, not `{usages: […]}`;
- an unknown id answers **500 on production too**, not only on staging. So the
  usage endpoint alone cannot separate "no such node" from "broken" — resolving
  the node first (404) can, which is why that order is fixed.

**Verification:** `npm test` → 806 tests, 806 pass, 0 fail (790 before, 16 new).
Typecheck clean, build clean. The finished service was then run against the live
API on the same three ids: reference → 2 collections, original → 2 collections,
invented id → `node_not_found`.

Four existing tests had to be updated because the surface genuinely changed (the
tool count, the expected-tool list, the status-string table). While there, the
gating test's `WRITE_TOOLS` list was completed from three names to all ten — it
had been listing only the Phase 2 tools, so a Phase 5 tool leaking into the
anonymous surface would have been caught only by the count.

**Not implemented, reported by the same team, for a separate decision:**
1. `includeParents` on `get_node_details` returns `[]` for every content node
   and never errors. Either remove it or fill it via this same usage path — the
   status quo is a documented flag that silently never delivers.
2. `includeRaw` promises "the original `ccm:*` / `cclom:*` property URIs" and
   delivers five vocabulary fields. Description or behaviour has to give.
3. `search_wlo_collections` says a collection IS a topic page;
   `search_wlo_topic_pages` says it checks which collections have one. Measured
   for "Mathematik": 5 collections, 1 topic page. The two descriptions
   contradict each other.
4. `find_wlo_skills` is listed but unconfigured, so every call fails with
   "set WLO_SKILLS_COLLECTION_ID". Suggested: hide it until it is configured.

---

## Write support Phase 6 done: metadata proposals (2026-08-01)

The last phase of the write-support plan. Three tools that keep "a model thinks
this should say X" and "the record says X" as two separate, separately visible
facts.

| Tool | What it does |
|---|---|
| `wlo_suggest_metadata` | Stores per-field proposals with a rationale. The record is untouched. |
| `wlo_list_suggestions` | Shows them with rationale, status, and the id to decide on. |
| `wlo_decide_suggestion` | Accept (apply → read back → mark) or decline (mark only). |

**The one design decision, made before any code.** Accepting is two upstream
operations and either can fail alone, so their order is a real choice:

- `PATCH` first → a failed write leaves a proposal that *claims* to be applied.
  The next curator reads "angenommen" and believes the record carries the value.
- **Write first** → a failed `PATCH` leaves the value in the record and the
  proposal open. The record is right; only the bookkeeping lags.

The second failure is the harmless one, so the value is applied and read back
**before** the proposal is marked accepted, and a write the repository discarded
produces no `ACCEPTED` at all. `tools-curation-suggestions.test.ts` asserts the
call order on the recorded upstream calls, not on the reply text.

**Two shapes, one endpoint.** `POST` answers with an array, `GET` with a map
keyed by `propertyId` — both measured, and the trap that bit the probe itself. A
single parsing helper accepts either, and a test feeds it the map shape
specifically: an array-only reader answers "keine Vorschläge" for a node that
has several, which is wrong rather than empty. For the same reason an unreadable
`GET` throws instead of returning `[]`.

**`type: AI` is permanent; `status` carries the human decision.** The live
OpenAPI (staging, read today) shows the `PATCH` takes no `type`. That matches
what the two fields mean and settles the user's "only a human check makes it
human": the check is recorded as `ACCEPTED`, and overwriting the type would not
add the approval, it would erase the authorship.

**Refactoring done in the same pass, both triggered by real thresholds:**
- `CONTENT_FIELDS` / `FIELD_SCHEMA` moved to `src/tools/curation-fields.ts`. The
  suggestion tools need the same 13 fields, and a second copy is how a field
  gets added to one tool and forgotten in the other — with no test able to
  notice, because each would pass on its own.
- The suggestion tools crossed 300 lines in one file and were split along their
  actual seam: `curation-suggestions.ts` stores opinions, `curation-decide.ts`
  changes records. `recordTitle` (duplicated during the first draft),
  `fieldLabel`, and `plainText` went to `curation-shared.ts`.

**Verification:** `npm test` → **823 tests, 823 pass, 0 fail** (806 before, 17
new). `npx tsc -p tsconfig.typecheck.json --noEmit` clean, `npm run build`
clean. Every test ran red first for the right reason before its implementation
existed.

**Not verified live.** The probe (Task 18) exercised the three endpoints against
staging with real nodes, so the shapes and status transitions are measured. The
three *tools* are covered by tests against a faked upstream only — they have not
been run against staging end to end. That is the next thing to do with a real
credential, and until then "the tools work" is a claim the tests support, not
one a live run has demonstrated.

The write-support plan (`2026-08-01-write-support-tasks.md`) is now complete:
all 6 phases, 22 tasks. 25 read tools + 13 curation tools.

---

## Live pass against staging — and two defects only it could find (2026-08-02)

The outstanding item from the write-support plan: the curation tools had never
been run against a real repository. Done now, with the `WLO-Upload` service
account against **staging**, driving the real MCP server through an in-memory
client. Everything the run created was deleted again through the tools
themselves; a read-back on each id afterwards returns 404.

**Worked on the first live attempt, no change needed:** `wlo_create_content`,
`wlo_update_content` (title, merged keywords, VCARD author), the whole
suggestion group (propose → list → accept → decline), `wlo_update_compendium`
(write and remove), `wlo_add_to_collection`, `wlo_remove_from_collection`,
`get_node_collections`, `wlo_delete_content`, `wlo_delete_collection`, and the
token gate (a wrong `confirmToken` wrote nothing). The suggestion order held
live: value written and read back, then `ACCEPTED`; the declined proposal left
the record untouched.

**Defect 1 — `wlo_create_collection` never worked.** `500 NullPointerException:
cmNameReadableName is null`. The body carried `properties['cm:title']`; the
endpoint derives the node name from a top-level **`title`** field. Every test
passed because the fake upstream accepts any body — the tests asserted our own
inference back to us.

**Defect 2 — `wlo_rename_collection` never worked**, and a collection's
description was silently discarded on both routes. Rename needs **`ref.id` in
the body** despite the id being in the path. `cm:description` answers `200` from
the collection endpoint and is never stored; it has to go through the node
route. `cm:title` does land through the collection route, so only the
description needs the extra call.

Both fixed in `src/services/write/collections.ts`, with four tests written red
first that encode the measured shape (`title`, `ref.id`, description on the node
route, and no extra call when there is no description). A dropped description is
now reported rather than swallowed — `wlo_create_collection` says the collection
exists but the description did not land, and `wlo_rename_collection` says "nicht
vollständig geändert" because title and description travel separately. Full
measurements in the research doc, §9.

**Verified after the fix, live:** create with description → both read back;
rename with description → both read back; the rest of the chain unchanged.

**Verification:** `npm test` → **828 tests, 828 pass, 0 fail** (823 before, 5
new). Typecheck clean. Live run clean, staging left empty of probe objects.

**One finding recorded, not fixed:** a client-side timeout on
`wlo_create_content` leaves the record created upstream while the tool reports
failure — the abort hits the response, not the work. A retry is safe (the
duplicate check names the existing record), but the first reply is wrong about
what happened. Staging routinely needs more than the 10 s
`WLO_FETCH_TIMEOUT_MS` default; the probe used 60 s. Worth raising the default,
or wording the timeout reply as "unklar" rather than "fehlgeschlagen".

---

## `wlo_submit_content` verified live, and given the read-back it lacked (2026-08-02)

Tested on the user's explicit go-ahead. Throwaway records on staging, created
and deleted by the probe; each id returns 404 afterwards.

**It works.** `PUT …/workflow` with our hard-coded receiver and status is
accepted, and the submission is real: the record comes back carrying
`ccm:wf_status: 200_tocheck`, `ccm:wf_receiver`, `ccm:wf_instructions` (the
comment) and a `ccm:wf_protocol` JSON record. The group
`GROUP_ORG_WLO-Uploadmanager` exists on staging and is the right one — the value
we hard-coded, not a guess that happened to be accepted.

**And that made a gap visible.** A record that was never submitted has no
`ccm:wf_status` at all. So "submitted" and "not submitted" are distinguishable
by reading the record — and this tool was the only write in the whole pipeline
reporting success on the strength of a `200`. `submitForReview` now returns
`submitted` / `dropped` / `unverified` / `failed`, and the tool words each
honestly: the success case names the status and the queue, a `200` over a record
with no workflow status is reported as NOT submitted, and an unreadable record
leaves the outcome open. Three tests, red first.

Verified live after the change: the reply reads "Zur redaktionellen Prüfung
eingereicht — der Datensatz trägt jetzt den Status 200_tocheck und liegt bei
GROUP_ORG_WLO-Uploadmanager."

**Verification:** `npm test` → **831 tests, 831 pass, 0 fail** (828 before, 3
new). Typecheck clean. Measurements in the research doc, §10.

With this, every curation tool has been exercised against a real repository.
Nothing in the write-support plan is unverified any more.

---

## The create timeout: measured, and the default resized (2026-08-02)

Follow-up on the finding from the live pass. The question was whether the failed
create really was the timeout, and if so what a defensible value is.

**It was.** Timing every upstream call separately against staging:

| Call | Range |
|---|---|
| creating a `ccm:io` (`POST …/children`) | **4.2 – 8.0 s** (18 samples) |
| writing metadata (`PUT …/metadata`) | 0.5 – 0.9 s |
| reading a node | 0.3 – 0.4 s |
| search (`ngsearch`) | 0.5 – 2.4 s (production: max 1.1 s) |

Reads are not the problem on either repository — production was faster than
staging across the board (search 1.1 s vs 2.4 s worst). The create is the outlier
by a factor of three, and the old 10 s default left as little as **1.26×**
headroom over the worst observed run. That is what tripped.

**Two hypotheses tested and discarded** before settling on the number: a cold
process is not slower (first call 4.6–6.3 s, second 4.7–5.9 s across six fresh
processes — no difference), and the total pipeline duration is irrelevant because
the timeout is per request, not per tool call.

**New default: 20 s** (`DEFAULT_FETCH_TIMEOUT_MS`). ~2.5× the worst measured
call, still below `WLO_TEXT_TIMEOUT_MS` (25 s), which stays the deliberate
outlier for full-text reads. A hung socket is still bounded at something a
caller can wait out.

The test does not assert "is it 20000" — that would only restate the code. It
asserts the *margin* over the measured worst case, so a future change that
quietly narrows it fails. A second test pins that full text keeps the longer of
the two timeouts.

**Verification:** `npm test` → **833 tests, 833 pass, 0 fail** (831 before, 2
new). Typecheck and build clean. Live with the new default, five fresh
processes: every create succeeded, headroom 2.5×–4.0×.

**Still open from the same finding:** the reply wording. Raising the timeout
makes the case rarer, not impossible — an aborted create still leaves the record
upstream while the tool says "konnte nicht angelegt werden". The honest wording
is "unklar, ob angelegt — bitte erneut versuchen, ein vorhandener Datensatz wird
dann genannt", because the duplicate check makes the retry safe.

---

## Chatbot-Fund 1 behoben: `includeParents` (2026-08-02)

Der einzige der vier Funde, der **aktiv falsche Antworten** produziert hat — und
deshalb zuerst.

`includeParents` las `/node/v1/nodes/{id}/parents`. Dieser Endpunkt trägt die
Ahnenkette einer **Sammlung**; für einen **Inhalts-Knoten** antwortet er `200`
mit einer leeren Liste, immer. Das Werkzeug meldete daraufhin „Keine
Eltern-Sammlungen gefunden", ein Modell macht daraus „liegt in keiner Sammlung",
und das ist eine falsche Aussage, keine fehlende.

`getParentCollections(node, id)` wählt jetzt nach Knotenart:

| Knotenart | Quelle |
|---|---|
| Sammlung (`ccm:map`) | `/parents` — die Ahnenkette |
| Material (`ccm:io`) | `/usage/v1/usages/node/{original}/collections` |

Eine Reference-ID wird vorher auf ihr Original aufgelöst (dieselbe Falle wie bei
`get_node_collections`). Der Knoten wird durchgereicht statt neu geladen, also
kostet der Fix keinen zusätzlichen Roundtrip. Ein **fehlgeschlagener** Abruf wird
als solcher gemeldet (`parentsError` im JSON, eigener Satz im Markdown) statt zu
einer leeren Liste zu verfallen.

Behoben in `get_node_details` **und** `get_nodes_details`.

**Warum es eine volle Testsuite überlebt hat:** das Mock lieferte für `/parents`
eines Inhalts-Knotens eine Sammlung — also gerade das, was live nie passiert.
Der Test bestätigte eine Annahme, statt Verhalten zu prüfen. Das Mock ist jetzt
auf die gemessene Realität korrigiert (leeres `/parents`, Sammlungen über
`/usage/v1`). Dieselbe Lehre wie bei den Sammlungs-Defekten.

**Verifikation:** `npm test` → **839 Tests, 839 grün** (835 vorher, 4 neu + 1
korrigiert). Typecheck und Build sauber.

**Offen von den vier Funden:** `includeRaw` (Beschreibung passt nicht zum
Verhalten), die widersprüchlichen Beschreibungen von `search_wlo_collections` /
`search_wlo_topic_pages`, und `find_wlo_skills` (gelistet, aber unkonfiguriert →
scheitert bei jedem Aufruf).

---

## Chatbot-Funde 2–4 behoben (2026-08-02)

Die drei verbliebenen Meldungen des Chatbot-Teams, alle klein und unabhängig.

**`find_wlo_skills` war gelistet und unbrauchbar.** Ohne
`WLO_SKILLS_COLLECTION_ID` scheiterte jeder Aufruf mit „setze
WLO_SKILLS_COLLECTION_ID" — eine Nachricht an die Betreiberin, zugestellt an ein
Modell, das nichts damit anfangen kann und keine gültige nodeId erraten kann. Die
Sperre gehört an die Registrierung, nicht in die Laufzeit: `registerSkillsTool`
nimmt die Sammlung jetzt als Argument, `server.ts` registriert nur mit einer.
Dieselbe Logik wie bei den Schreibwerkzeugen — was nicht funktionieren kann,
wird besser nicht angeboten. Der dadurch unerreichbare Laufzeit-Zweig ist
entfallen. Read-Tool-Zahl damit **24** ohne konfigurierte Skill-Sammlung, 25 mit.

**`includeRaw` widersprach sich selbst.** Die Beschreibung versprach „die
originalen `ccm:*`/`cclom:*`-Property-URIs", geliefert wurden fünf
Vokabular-Felder — und das nur im JSON. Markdown trug drei, wer das Ausgabeformat
wechselte, verlor stillschweigend Zielgruppe und Ressourcentyp. Beide liefern
jetzt dieselben fünf, und die Beschreibung nennt sie beim Namen statt den ganzen
Property-Bag anzudeuten.

**Die beiden Suchbeschreibungen widersprachen einander.** In
`search_wlo_collections` stand wörtlich „In WLO ist eine Sammlung dasselbe wie
eine Themenseite", während `search_wlo_topic_pages` sich als „sucht Sammlungen
und prüft dann, welche eine Themenseite haben" beschrieb. Die Messung entscheidet
es: für „Mathematik" 5 Sammlungen, davon 1 mit Themenseite. Beide Texte benennen
jetzt die Enthaltensein-Beziehung — eine Themenseite ist eine Sammlung mit
zusätzlichem kuratiertem Seiten-Layout — und verweisen füreinander.

Für diese Art Defekt gibt es jetzt eine eigene Testdatei
(`tests/tool-descriptions.test.ts`): eine Werkzeug-Beschreibung ist das Einzige,
woran ein Modell zwei ähnliche Werkzeuge unterscheidet, und Widersprüche darin
fallen sonst niemandem auf.

**Verifikation:** `npm test` → **846 Tests, 846 grün** (839 vorher, 7 neu).
Typecheck und Build sauber.

Damit sind alle vier Funde des Chatbot-Teams abgearbeitet.

---

## Vollständiges Code-Review (R1–R12) — abgeschlossen 2026-08-03

Alle zwölf Pakete des
[Review-Plans](2026-08-02-full-review-plan.md) sind durch; die Fortschritts-
tabelle dort trägt Funde und Testzahlen pro Paket, die übertragbaren Lehren
stehen darunter unter „Cross-package notes".

Von **846 Tests** zu Beginn auf **1021** am Ende, Typecheck und Build durchgehend
sauber, `npm audit --omit=dev` ohne Befund. Zwei Eigenschaften, die vorher nur
behauptet waren, sind jetzt erzwungen: die Testsuite läuft nachweislich offline
(`tests/netguard.mjs`), und jede dokumentierte Einstellung erreicht im
Docker-Deployment tatsächlich den Container
(`tests/deploy-env-passthrough.test.ts`).

Offen bleibt **nichts aus dem Review**.

---

## URL-Text-Werkzeug + Unsicher-Schalter — abgeschlossen 2026-08-03

Plan: [Entwurf](2026-08-03-url-text-tool-design.md) ·
[Aufgaben](2026-08-03-url-text-tool-tasks.md) (16 Aufgaben, 5 Phasen, alle ✅).

Neu: `get_url_text` (Text einer beliebigen Web-Adresse über den
Extraktionsdienst) und ein generischer Mechanismus, mit dem ein Werkzeug sich als
`unsafe` deklariert und die Betreiberin es über `WLO_DISABLE_UNSAFE_TOOLS`
abschaltet. Im Code sind unsichere Werkzeuge **an** (mit Startwarnung), in
`.env.example` und `docker-compose.yml` **aus** (`all`).

Dabei gefunden und behoben: `isPrivateHost` erkannte IPv4-in-IPv6 nicht —
`http://[::ffff:127.0.0.1]/` wird von `new URL()` zu `[::ffff:7f00:1]`, und das
kam durch. Das war **auf dem bestehenden `ccm:wwwurl`-Pfad live erreichbar**.

Stand: **1078 Tests grün**, Typecheck und Build sauber, `npm audit` (voll und
Produktion) ohne Befund. Live gegen Staging geprüft: 7 URLs, davon 2 öffentlich
gelesen und 5 korrekt abgelehnt.

---

## Apps-SDK-Prüfungen — nachgeholt 2026-08-03

**MCP Inspector (offiziell, CLI) gegen den laufenden HTTP-Server:** `tools/list`
liefert 25 Werkzeuge, ein Skript-Check über Titel, Beschreibung, `readOnlyHint`,
`destructiveHint`, beide `openai/toolInvocation/*`-Texte, `securitySchemes` und
`inputSchema` findet **0 Beanstandungen**. `resources/list` zeigt die 4 Widgets
mit `text/html;profile=mcp-app`; ein `tools/call` über dieselbe Leitung liefert
echte Treffer. Damit ist die Lücke zum letzten Lauf (22/22 am 2026-07-17) zu.

**Goldene Prompts:** die Mechanik-Hälfte ist durch — 17 von 17 lauffähigen
Prompts liefern live (D10 braucht `WLO_SKILLS_COLLECTION_ID`). Die
Werkzeug*wahl* eines Modells, die Negativ-Prompts und der Widget-Render brauchen
ChatGPT-Entwicklermodus und bleiben offen.

**Deployment-Haltung:** vorerst die `nip.io`-Adresse, keine Einreichung im GPT
Store. `WLO_WIDGET_DOMAIN` bleibt deshalb ungesetzt — genau richtig, denn jeder
Nicht-ChatGPT-Host verlangt das ohnehin. Geprüft: **kein öffentlicher Origin ist
im Code hartkodiert**, der Wechsel auf die echte Domain ist ein Redeploy mit
geänderten Umgebungsvariablen. Wichtig für später: der MCP-Origin ist nach der
ersten Einreichung versionsübergreifend gesperrt — der Domainwechsel muss also
davor passieren.

`WLO_TEXT_EXTRACTION_URL` ist inzwischen gesetzt
(`https://text-extraction.staging.openeduhub.net/`) — passend zur ebenfalls auf
Staging zeigenden `WLO_REPOSITORY_URL`. **Für den vServer beachten:** dort zeigt
das Repository auf die Redaktions-Instanz; dieselbe Staging-Extraktions-URL würde
Produktions-Material-URLs in eine andere Umgebung schicken.

---

## Vollständiges Projekt-Audit + Behebung — 2026-08-04

Audit über alle 12 Dimensionen (~17.400 LOC Quellcode, 120 Dateien).
**Keine ausnutzbare Schwachstelle.** Gesamtnote 83/100 gewichtet; schwächste
Dimension Dokumentation (62), stärkste Abhängigkeiten (90).

**Ein Muster trug fast alle Befunde:** eine Regel wurde erkannt, benannt und an
*einer* Stelle gelöst — und dann nicht dorthin getragen, wo sie ebenfalls gilt.
Kein Befund lautete „das war nicht durchdacht".

Behoben (jeder Fix per Mutationstest gegengeprüft — Fix zurückgedreht, Test muss
rot werden):

| # | Befund | Fix |
|---|---|---|
| A-1 | `PRIVACY.md` behauptete „read-only, keine Authentifizierung" bei 13 Schreibwerkzeugen und weitergereichten Zugangsdaten | neu geschrieben: Credential-Kette, was Kuration schreibt, alle vier Empfänger, Betreiber-Checkliste |
| A-2 | Einreichungs-Checkliste: „no write tools ✅" gegenüber dem Prüfer | durch das wahre *und* stärkere Argument ersetzt |
| A-3 | Timeout → „konnte nicht … werden" in 12 von 13 Kurationswerkzeugen. Reproduziert: erfolgreiches `DELETE`, dessen Read-Back ablief, meldete „konnte nicht gelöscht werden" | `timeoutOrError` in `curation-shared.ts` an allen 9 Fangstellen; `confirmDeleted` liefert bei geworfenem Read-Back `unverified` |
| A-4 | `renderChangeSet` kappte die ganze Action-Zeile bei 120 Zeichen → Vorschau brach mitten im Satz ab, Decline-Vorschau verlor nodeId und Folgesatz | `sanitizeText` = `flattenText` + Cap; Renderer nutzt `flattenText` |
| A-5 | `wlo_submit_content`: Redaktionsnotiz weder in der Vorschau noch im Token-Fingerprint | Notiz in die Action; `comment`/`versionComment` auf `max(1000)` |
| A-6 | `public/llms.txt` (wird unter `/llms.txt` ausgeliefert) nannte „22 read-only tools" | Zahl entfernt statt gepflegt |
| A-7 | 5 Env-Variablen mit rohem `parseInt` → `MAX_BODY_BYTES=1MB` = 1 Byte, jede Anfrage `413` | alle über `resolvePositiveInt`; neue `resolveNonNegativeInt` für die Rate-Limits (dort ist `0` dokumentiert) |
| AR-2 | `rest/routes.ts` prüfte das rohe Request-Target, `http-app.ts` den geparsten Pfad | beide auf den geparsten Pfad |

**Neue Wächter-Tests** — die Drift überlebte vier Sitzungen, weil nichts Code und
Prosa verband:

- `tests/docs-claims.test.ts` — liest die Kurations-Werkzeugnamen aus
  `src/tools/` und lässt die drei veröffentlichten Dokumente scheitern, wenn sie
  etwas anderes behaupten.
- `tests/env-parsing-discipline.test.ts` — Quelltext-Prüfung auf
  `parseInt(process.env…)`. Nötig, weil `http.ts` beim Import lauscht und
  deshalb nicht importierbar ist: genau so überlebte das rohe `parseInt` die
  Einführung des Helfers samt seiner Unit-Tests.

**Nicht gemacht, bewusst:**

- **ESLint** (Befund M-1). Das Projekt hat absichtlich 4 Dev-Abhängigkeiten;
  `@typescript-eslint` bringt ~100 mit. Das ist eine Lieferketten-Entscheidung
  für die Betreiberin, kein Beifang einer Fehlerbehebung.
- **`noUncheckedIndexedAccess`** (Befund M-2). Gemessen: **134 Fehler** über die
  Codebasis. Ein mehrtägiger Refactor, der nicht in eine Behebungs-Runde gebündelt
  gehört.
- **S-1** (`prune` nur beim Ausstellen). Erneut geprüft: kein Defekt.
  `MAX_PENDING` begrenzt die Map, die Einfügereihenfolge ist die Ablaufreihenfolge.
  Der Befund war von mir selbst 🟢/kosmetisch eingestuft — Code dafür zu ändern
  wäre Churn.

Stand: **1104 Tests grün**, Typecheck sauber, Build sauber, `npm audit --omit=dev`
ohne Befund. `tsx` auf 4.23.5 gehoben. Neu: `npm run test:coverage`.

---

## Zweites Projekt-Audit + Behebung — 2026-08-04

Erneuter Gesamtdurchgang nach der Runde oben (Deep für Auth, HTTP-Dispatch,
REST-Router, Write-Pipeline, URL-Sicherheit, Widgets/Launcher). Fünf Befunde,
alle wieder von derselben Form: **eine Regel, die an einer Stelle gilt und an der
zweiten nicht.** Zwei davon liefen bereits in jedem Container.

| # | Befund | Behoben in |
|---|---|---|
| A 🟠 | `GET //[` bekam **gar keine Antwort**: drei Schichten parsten dasselbe Request-Target, nur der Dispatcher abgesichert — sein Fallback reichte den Rohstring weiter, der Throw entkam dem Handler. Socket bis `requestTimeout` (30 s) belegt, unauthentifiziert, von keinem Limiter gedeckt. | neu `src/request-url.ts`; `http-app.ts`, `rest/routes.ts`, `rest/static.ts` |
| B 🟠 | `docker-compose.yml` nagelte `WLO_FETCH_TIMEOUT_MS` auf `10000`, während Code **und** `.env.example` 20000 sagten. Compose gewinnt — jeder Container lief mit dem Wert, der ein 4,2–8,0 s dauerndes `create` mittendrin abschneidet. | `docker-compose.yml`, `docs/DEPLOYMENT.md` |
| C 🟠 | Die Bestätigungsvorschau kappte Werte bei 120 Zeichen mit blossem „…". Gemessen: 524 Zeichen geschrieben, 120 gezeigt. Felder erlauben 20 000 / 100 000. Der Token bindet den vollen Wert — der Mensch bestätigte ungesehenen Text. | `services/write/change-set.ts`, `text-cap.ts` |
| D 🟡 | `.env.example` führte `WLO_TEXT_EXTRACTION_URL` auf **Staging** aktiv, direkt unter einem Produktions-Repository. `cp .env.example .env` baute damit genau den Umgebungs-Mix, dessentwegen der Code-Default entfernt worden war. | `.env.example` |
| E 🟢 | Kommentar über der Tool-Registrierung behauptete „every WLO tool is public, read-only … no authentication" — zwanzig Zeilen über den 13 Kurationswerkzeugen. | `src/server.ts` |

**Neue Schutztests** (jeder vorher rot gesehen):

- `tests/http-app.test.ts` — Rohsocket-Test. `fetch` kann `//[` nicht senden, es
  normalisiert das Target; der Test spricht deshalb direkt TCP.
- `tests/rest-static.test.ts` / `tests/rest-routes.test.ts` — jede Schicht
  antwortet auf ein unparsbares Target mit „nicht meine Route" statt zu werfen.
- `tests/write-change-set.test.ts` — fünf Fälle: normale Beschreibung ungekürzt,
  Kürzung nennt die Gesamtlänge, Schnitt an der Wortgrenze, Schlagwortliste und
  Löschtitel gleich behandelt.
- `tests/deploy-env-passthrough.test.ts` — **die strukturelle Lücke**: die Datei
  band bisher, dass jede Einstellung *weitergereicht* wird, nie ihren *Wert*.
  Zwei neue Regeln: keine Zahl darf im Compose wiederholt werden (Modus-Flags mit
  bewusst abweichendem Deployment-Default sind namentlich mit Begründung
  ausgenommen), und `.env.example` darf keine Einstellung aktiv führen, die eine
  Kopie stillschweigend übernimmt.

Beiläufig entfernt: drei tote Importe (`safeHref`, `followUpButton` im
Search-Results-Renderer, `ThemePageInfo` in `tools/topic-pages.ts`) — je genau
ein Vorkommen, die Importzeile. Sichtbar erst mit `tsc --noUnusedLocals`, das
nicht Teil des normalen Gates ist.

**Mutationsprüfung**: A (drei Schichten einzeln + Vollrücklauf), B, C und D je
zurückgedreht — jedes Mal wurde der zugehörige Test rot. E ist ein Kommentar und
nicht testbar; das ist so gesagt, nicht kaschiert.

### Nachfassen: zwei weitere Befunde aus den Pruefungen, die im Audit fehlten

Der `--noUnusedLocals`-Fund zeigte, dass ich Pruefungen nicht gefahren hatte.
Ein zweiter Durchgang mit Quelltext-Sweeps brachte:

| # | Befund | Behoben in |
|---|---|---|
| F 🟢 | `auth/identity.ts` parste seinen Antwort-Body direkt statt ueber `readJson` — obwohl `read-json.ts` **und** `CLAUDE.md` behaupten, jeder Client gehe darueber. Eine Wartungsseite mit `200` und HTML erschien als `identity check failed: Unexpected token <` statt benannt. | `src/auth/identity.ts` |
| G 🟡 | **`text-cap.ts` wurde von 2 von 8 Aufrufstellen benutzt.** Sechs Module trugen `x.slice(0, CAP) + '
[…gekürzt]'` selbst — Schnitt mitten im Wort statt an der Wortgrenze — und der bytebasierte Download-Pfad war schon auf `'

…[gekürzt]'` abgedriftet. Genau das, wogegen das Modul laut eigenem Docstring extrahiert wurde. | `services/search.ts`, `tools/content-search.ts`, `tools/knowledge.ts`, `tools/node-details.ts` (3×), `wlo-node-text.ts`, `text-cap.ts` |

**Neuer Schutztest** `tests/shared-rule-discipline.test.ts` — Quelltext-Scans fuer
beide Regeln, Geschwister von `env-parsing-discipline.test.ts`. Gefunden mit 7
bzw. 1 Verstoss; beide Mutationen wieder rot gesehen. Ein Unit-Test des Helfers
beweist, dass der Helfer stimmt, und sagt nichts darueber, ob ihn jemand benutzt.

**Kein Befund, geprueft und verworfen:**

- **Import-Zyklus** `fields.ts ↔ fields-lrt.ts`: Fehlalarm meines eigenen
  Detektors. Es ist ein `import type`, der wegkompiliert wird — im gebauten
  `dist/services/write/fields-lrt.js` steht kein `./fields.js`.
- **Kuerzungen in `formatter.ts` / `browse.ts` / `search-page.ts`** nennen die
  Gesamtlaenge nicht. Anders als bei C bestaetigt dort niemand etwas; das Modell
  kann den vollen Text ueber `get_wlo_content_text` holen. Kein Defekt, und
  fuenf Dateien dafuer anzufassen waere Churn.

Stand: **1119 Tests grün** (vorher 1104), Typecheck sauber, Build sauber,
`npm audit --omit=dev` ohne Befund, `tsc --noUnusedLocals` ohne toten Import
in `src/`.

**Nicht gemacht, bewusst:** ESLint und `noUncheckedIndexedAccess` bleiben offen
wie oben begründet. `clampInt` in `rest/validate.ts` benutzt weiterhin rohes
`parseInt` — das ist **kein** Befund: ein Query-Parameter mit Default und Clamp
ist normale REST-Nachsicht, nicht die Env-Falle, die `resolvePositiveInt` schliesst.


---

## Modulgrenzen-Pass (2026-08-04)

Prüfauftrag: erfüllen alle Projektdateien die Qualitäts- und Längenvorgaben des
better-coding-workflow-Skills? Vokabulardaten ausgenommen.

**Gemessen, nicht geschätzt** (`scratchpad/fnlen.mjs`, Klammer-Matching über
`src/**/*.ts`): 16 Dateien über 300 Zeilen, 41 Einheiten über 50 Zeilen.

Die Länge allein ist kein Defekt — das Skill nennt die Schwellen ausdrücklich
Rauchmelder, nicht Feuer. Geprüft wurde deshalb gegen die projekteigene, härtere
Regel aus `CLAUDE.md`: *ein Tool-Modul hält sein Schema und sein Rendering, nie
einen Algorithmus*. Danach sind `collections.ts`, `content-search.ts`,
`node-details.ts` und `node-relations.ts` sauber, obwohl lang: ihre Algorithmen
liegen bereits in `services/`.

| Befund | Problem | Ort |
|---|---|---|
| H 🟡 | `browse_collection_tree` hielt den beschränkten, zyklengesicherten Baumlauf inline — 190-Zeilen-Handler in einer 376-Zeilen-Datei — obwohl `CLAUDE.md` `services/collection-traversal.ts` als Ort dafür benennt. | `tools/browse.ts` → `services/collection-traversal.ts` |
| I 🟡 | `services/` und `rest/` importierten aus `tools/`: `mapPool` (Nebenläufigkeits-Primitiv) und `buildFilterCriteria`/`formatUnresolvedHint` (Vokabular-Auflösung) lagen in `tools/shared.ts`, weil die Tools die ersten Aufrufer waren. Fünf Module griffen von unten nach oben. | 5 Module → `src/concurrency.ts`, `src/filter-criteria.ts` |

Beides dieselbe Form wie jede vorige Runde: etwas dort abgelegt, wo der erste
Aufrufer es brauchte, danach von überall her benutzt.

**Ergebnis:** `browse.ts` 376 → 274 Zeilen (Handler 321 → 219), `tools/shared.ts`
300 → 171, Inversionen 5 → **0**.

**Verhaltenserhaltung belegt:** die 17 bestehenden Browse-Tests waren vor dem
Eingriff grün und danach unverändert grün. Zwei Mutationen am extrahierten Walk
(`TREE_CHILDREN_MAX` 10→8; Zyklenwächter entfernt) treffen jeweils den richtigen
Test — die alten tool-basierten Tests fallen beim entfernten Wächter ebenfalls,
was die Extraktion end-to-end bestätigt.

**Neue Tests:** `tests/services-collection-tree.test.ts` (5) prüft die
zurückgegebene STRUKTUR statt einen Baum aus gerendertem Markdown zu erschließen
— erst die Extraktion macht das möglich. Dritter Guard in
`tests/shared-rule-discipline.test.ts` gegen die Schichtungs-Inversion; Mutation
rot gesehen, nennt Datei und Zeile. `mapPool`- und `buildFilterCriteria`-Tests
sind mit ihren Modulen umgezogen.

**Kein Befund, geprüft und verworfen:**

- **`createHttpRequestHandler` (208 Zeilen)** ist ein linearer Dispatcher: jeder
  Zweig kurz, eine Verantwortlichkeit, von oben nach unten lesbar.
- **`collection-traversal.ts` liegt jetzt bei 311 Zeilen** — knapp über der
  Schwelle, aber drei beschränkte Walks mit *einem* Änderungsgrund: wie sich der
  Sammlungsgraph des Repositories verhält. Aufteilen wäre Zahlenkosmetik.
- **Testdateien über 300 Zeilen** (`tools-output-integrity` 599, `write-collections`
  563): nach Prüfgegenstand geschnitten, was der richtige Schnitt ist.
- **Vokabulare** (`vocabs-hochschule.ts` 464, `vocabs.ts` 364, `vocabs-lrt.ts` 334)
  sind Daten und laut Auftrag ausgenommen.

Stand: **1125 Tests grün** (vorher 1119), Typecheck sauber, Build sauber (4
Widgets), `npm audit --omit=dev` ohne Befund, `tsc --noUnusedLocals` ohne toten
Import in `src/`.

---

## MCP-Zugang per WLO-Konto (Zugangsblock) — abgeschlossen 2026-08-04/05

Design: [`2026-08-04-mcp-access-token-design.md`](2026-08-04-mcp-access-token-design.md) ·
Aufgaben: [`2026-08-04-mcp-access-token-tasks.md`](2026-08-04-mcp-access-token-tasks.md)
(P0–P6 ✅, dazu eine Review-Runde mit 7 behobenen Befunden).

**Was es löst.** Die bisherige Anleitung lautete `printf 'name:passwort' | base64`.
Das schreibt das Klartextpasswort in die Shell-History und legt es dauerhaft
lesbar beim KI-Anbieter ab; der Wert funktioniert gegen **ganz WLO**, nicht nur
gegen diesen Server, und ist ohne Passwortwechsel nicht zurückzunehmen. Jetzt
holt sich eine Nutzerin unter `/auth` einen Block, dessen Passwort **im Browser**
verschlüsselt wurde, trägt ihn einmal als `Bearer …` ein und sperrt ihn bei Bedarf
unter `/auth-revoke.html` (oder `/auth/revoke`). Aus unter
`WLO_AUTH_PRIVATE_KEY` = nicht gesetzt.

**Gemessene Randbedingung, die alles andere ausschloss:** edu-sharing bietet
keine OIDC-Discovery, keine Dynamic Client Registration und deklariert nur
`basicAuth`/`cookieAuth` (P0, 2026-07-30). **Es gibt kein Token, das wir
weiterreichen könnten** — jede Lösung transportiert die Zugangsdaten selbst.
Deshalb hybride Verschlüsselung statt eines Tresors: ein Einbruch liefert den
Schlüssel, aber keine Sammlung von Passwörtern.

**Was die Review-Runde fand** (alle behoben, Details in der Aufgabenliste): ein
`Access-Control-Allow-Origin: *` auf `/auth*`, das die Rateversuche gegen WLO
über die Adressen fremder Besucher verteilbar machte und damit genau den
Begrenzer umging, der laut Bedrohungstabelle davor schützen sollte; eine
serialisierte Schreibkette, die **eine** abgelehnte Schreiboperation dauerhaft
weitertrug (jeder spätere Widerruf scheiterte bis zum Neustart, ohne es zu
versuchen); ein Schreibfehler, der als Rejection in einen Zweig ohne Fehlergrenze
entkam, worauf der Aufrufer 30 s lang **gar keine Antwort** bekam.

**Live gegen einen laufenden Server geprüft (2026-08-05)** — bis dahin die
größte offene Lücke, und die Klasse von Lücke, die schon bei den
Kurationswerkzeugen zwei Defekte durchgelassen hat. Aufbau: echter Server, echte
Browser-Krypto, echte Registerdatei; nur edu-sharing durch eine Attrappe ersetzt,
damit keine echten Zugangsdaten getippt werden mussten. Ergebnis: Block erzeugt
(532 Zeichen), Registereintrag ohne jedes Credential, `wlo_auth_status` meldet
`mode: user`, nach dem Sperren über die Seite ist das Register leer und derselbe
Block liefert `mode: anonymous`. Damit ist auch die Naht zwischen WebCrypto im
Browser und `node:crypto` im Server **live** bestätigt, nicht nur im Test.

**Zugleich behoben:** der Kontrast-Befund der Launcher-Seite. Vier Bedienelemente
trugen den dekorativen `--border` (live gemessen 1.75:1 hell / 1.90:1 dunkel, wo
WCAG 1.4.11 3:1 fordert). Neuer Test `tests/launcher-contrast.test.ts` prüft die
Eigenschaft, nicht den Token-Namen: Randfarbe gegen die Fläche, auf der sie
tatsächlich liegt, in beiden Schemata.

Stand: **1195 Tests grün** (vorher 1125), Typecheck sauber, Build sauber
(4 Widgets), `npm audit --omit=dev` ohne Befund, `docker compose config` gültig.

**Offen (Betreiberin):** Schlüssel erzeugen und in die `.env` auf dem Server;
`log_credentials` im Caddyfile prüfen; die sieben Entscheidungsfragen F1–F7 im
Team-Papier [`2026-08-04-auth-optionen-entscheidung.md`](2026-08-04-auth-optionen-entscheidung.md).

---

## OAuth 2.1 für alle Clients — P1 abgeschlossen 2026-08-05

Design: [`2026-08-05-mcp-oauth-design.md`](2026-08-05-mcp-oauth-design.md) ·
Aufgaben: [`2026-08-05-mcp-oauth-tasks.md`](2026-08-05-mcp-oauth-tasks.md)

| Paket | Stand |
|---|---|
| P1 Discovery + Vier-Wege-Entscheidung + 401 | ✅ fertig (2026-08-05) |
| P2 `/oauth/register` | ⛔ gesperrt bis zur Messung T1.6 |
| P3 `/oauth/authorize` + Anmeldeseite | ⛔ gesperrt |
| P4 `/oauth/token` | ⛔ gesperrt |
| P5 Live-Durchlauf + Doku | ⛔ gesperrt |

**Warum überhaupt.** Am 2026-08-05 gemessen: ChatGPTs Connector-Dialog bietet
**kein** Header- oder API-Key-Feld — nur OAuth, keine Authentifizierung oder
gemischt. Der fertige Zugangsblock ist dort also nicht eintragbar. OAuth ist der
einzige Weg, der jeden Client erreicht.

**Was P1 gebaut hat.**
- `src/auth/oauth-metadata.ts` — die beiden Dokumente (RFC 8414, RFC 9728), die
  Herkunftsauflösung und der `WWW-Authenticate`-Text. Rein, ohne HTTP.
- `src/rest/oauth-pages.ts` — vier `GET`-Pfade: beide Dokumente je einmal blank
  und einmal mit `/mcp`-Anhang, weil Clients unterschiedlich raten. 404 statt
  500, wenn die Funktion aus ist (kein Schlüsselmaterial ODER keine Herkunft).
- `src/http-app.ts` — Verdrahtung, die CORS-Ausnahme und der 401.
- `WLO_PUBLIC_BASE_URL` in `.env.example`, `docker-compose.yml`, beiden READMEs
  und `DEPLOYMENT.md`.

**Die eine Verhaltensänderung.** Ein `Bearer`, den wir nicht öffnen können
(gefälscht, gesperrt, fremder Schlüssel), bekommt jetzt `401` mit dem Zeiger auf
das Discovery-Dokument statt einer anonymen Antwort. Unverändert bleiben die
zwei Zeilen, die zählen: **ohne** `Authorization` weiterhin `200` mit der vollen
anonymen Werkzeugliste, und ein unlesbarer `Basic`-Kopf degradiert weiterhin auf
anonym — ein falsches WLO-Passwort ist kein ungültiges Token von uns.

Drei bestehende Tests wurden dadurch rot und **begründet** angepasst, nicht
stillschweigend: zweimal wanderte die Regel „ein unbrauchbarer Kopf leiht sich
nie das Dienstkonto" auf `Digest` bzw. auf die stärkere Zusicherung (die Anfrage
wird gar nicht erst bedient, es geht also nichts nach oben), einmal lautet die
Zusicherung jetzt „401, niemals 429" statt „200" — die Regel dort war immer, dass
rotierende Bearer-Token das Kontingent für verschiedene Anmeldungen nicht
verbrauchen dürfen, und die gilt unverändert.

**Zwei Festlegungen, die P1 vorwegnimmt.** Die CORS-Ausnahme für
`/oauth/authorize` steht schon jetzt, ein Paket bevor der Endpunkt existiert —
sie in P3 nachzureichen hieße, sie genau dann zu brauchen, wenn niemand mehr an
sie denkt. Und `OAuthEndpointDeps` trägt nur, was P1 benutzt; Body-Grenze und
Anmeldungs-Begrenzer kommen mit ihrem ersten Aufrufer.

Stand: **1233 Tests grün** (vorher 1219), Typecheck sauber.

**Live gegen die produktive Instanz bestätigt (2026-08-05, nach dem Deploy).**
`WLO_PUBLIC_BASE_URL` im Container angekommen, `access blocks are enabled` im
Start-Log, beide Discovery-Dokumente liefern die konfigurierte Herkunft,
`POST /mcp` ohne Kopf antwortet weiterhin mit der Werkzeugliste (SSE), und
`Bearer erfunden` bekommt `HTTP/2 401` mit dem `resource_metadata`-Zeiger.
Damit ist P1 nicht nur getestet, sondern im Betrieb gemessen — die Klasse von
Nachweis, deren Fehlen bei den Kurationswerkzeugen zwei Defekte durchgelassen
hat. Beiläufig behoben: der Healthcheck meldet wieder `healthy` (das Alpine-Image
bringt seinen eigenen mit `wget` mit, der frühere rief ein nicht vorhandenes
`curl`).

### T1.6 — die Messung, und warum sie das Tor ist

Der Entwurf wollte sie „vor dem ersten Paket". Das ging nicht: der gedachte
Versuch (Endpunkt-Felder in ChatGPT von Hand füllen) hätte auf Endpunkte
gezeigt, die 404 antworten, und wäre aus dem falschen Grund gescheitert. Der
Befund vom 2026-08-05 zeigt zugleich den richtigen Weg — ChatGPT hat
`/.well-known/oauth-protected-resource` **von sich aus** abgefragt. Der Client
sucht also, ohne dass ein 401 ihn schickt. **P1 liefert genau das und ist damit
das Experiment.**

### T1.6 — durchgeführt 2026-08-05, Ergebnis POSITIV

ChatGPT-Connector auf `…/mcp`, Authentifizierung `OAuth`, alle vier
Endpunkt-Felder leer. Antwort:

```
Dynamic client registration failed: registration endpoint returned 404
(Not found. Use POST /mcp)
```

Der Klammertext ist unsere eigene 404-Antwort. Die Kette: `does not implement
OAuth` verschwunden → `/.well-known/oauth-authorization-server` **von sich aus**
gelesen → `registration_endpoint` entnommen → `POST /oauth/register` versucht.

**Der Zielkonflikt existiert nicht.** Anonymes Lesen und OAuth stehen
nebeneinander auf derselben URL; der Nutzer entscheidet im Auswahlfeld seines
Clients. Keine zweite URL, kein erzwungener 401. **P2–P5 sind freigegeben.**

Beim Testen aufgefallen und erklärt: in der Referenz wählt man „keine
Authentifizierung" und landet trotzdem in der Anmeldung — weil jener Server
anonymen Zugriff nicht kennt und mit 401 antwortet. Bei uns heißt „keine
Authentifizierung" wirklich anonym; wer sich anmelden will, wählt OAuth.

**Erledigt (Betreiberin) am 2026-08-05:**
1. `WLO_PUBLIC_BASE_URL=https://wlo-mcp.87.106.195.152.nip.io` in die `.env`,
   hochladen, neu bauen, neu starten.
2. `curl -s https://wlo-mcp.87.106.195.152.nip.io/.well-known/oauth-protected-resource`
   → muss das Dokument liefern, nicht 404.
3. ChatGPT-Connector auf die MCP-URL zeigen, **ohne** Endpunkte von Hand.
   Verschwindet `does not implement OAuth`? Welche Pfade fragt der Client ab
   (Caddy-Zugriffslog)? Verlangt er einen 401?
4. Dasselbe mit Claude.

Fällt die Messung negativ aus, ist die nächste Handlung eine **Design-Änderung**
(zweite URL, die mit 401 antwortet, oder OAuth erzwingen) — nicht P2.

---

## OAuth — P2 abgeschlossen 2026-08-05

`POST /oauth/register` (RFC 7591) steht, plus das Modul, an dem die Sicherheit
des ganzen Vorhabens hängt.

**`src/auth/oauth-clients.ts`** — die Redirect-Regel und die zustandslose
`client_id`.
- `isValidRedirectUri`: `https` überall, `http` **nur** auf Loopback; kein
  Fragment, keine Zugangsdaten im URI, kein anderes Schema (`javascript:`,
  `data:`, `file:`, App-Schemata).
- `redirectUriMatches`: zeichengenau — **außer** beide Seiten sind Loopback,
  dann sind Port und Loopback-Schreibweise frei (RFC 8252 §7.3: ein nativer
  Client wählt seinen Port zur Laufzeit, und Clients schreiben mal `localhost`,
  mal `127.0.0.1`). Schema, Pfad und Query bleiben auch dort gebunden.
  `localhost.evil.example` ist **kein** Loopback — die Namen werden exakt
  verglichen, nicht als Präfix.
- `client_id` = `wloc1.<iv>.<ct>`, AES-256-GCM unter einem per HKDF aus dem
  vorhandenen privaten Schlüssel abgeleiteten Schlüssel, eigene `info`-Zeichen-
  kette zur Zweck-Trennung. Kein Speicher, neustartfest, überlebt eine
  Schlüsselrotation (alle Schlüssel werden probiert).

**`POST /oauth/register`** — offen wie die Spezifikation es erwartet, und
harmlos: eine Registrierung gewährt nichts, es folgt immer noch eine Anmeldung
im Browser. Kein `client_secret`. Der `client_name` läuft durch `flattenText`
und wird auf 100 Zeichen gekappt — er steht später auf dem Bildschirm, auf dem
jemand sein Passwort tippt, und eine eingeschmuggelte Zeile dort wäre eine
zweite, gefälschte Aussage.

Stand: **1256 Tests grün** (vorher 1233), Typecheck sauber.

**Kein Deploy nötig.** P2 allein ändert für einen Client nichts Sichtbares: die
Registrierung gelänge, dann scheiterte `/oauth/authorize` (P3). Sinnvoll wird
der nächste Live-Test nach P4.

---

## OAuth — P3 abgeschlossen 2026-08-05

**Stand:** `/oauth/authorize` steht — beide Hälften. Ein Client, der diesen
Server einträgt, kommt jetzt bis zur Anmeldeseite, meldet sich an und erhält
einen Autorisierungscode. Was noch fehlt, ist der Tausch dieses Codes gegen den
Zugang: **P4 (`/oauth/token`)**.

**Nachweis:** `npm test` → **1290 Tests, 1290 bestanden** (vor P3: 1266).
`npx tsc -p tsconfig.typecheck.json --noEmit` → exit 0. Dazu ein Durchlauf gegen
einen echten lokalen Server im Browser (siehe „Was das Ausführen fand").

### Was gebaut wurde

| Datei | Rolle |
|---|---|
| `src/auth/oauth-codes.ts` | der einzige Zustand: Codes, eine Minute, einmal nutzbar, unter SHA-256 abgelegt, in der Zahl begrenzt |
| `src/auth/access-issue.ts` | die Ausstellung, aus `rest/auth-pages.ts` **verschoben** (nicht kopiert) |
| `src/auth/oauth-authorize.ts` | was eine Autorisierungsanfrage annehmbar macht — rein, von GET und POST geteilt |
| `src/rest/oauth-consent.ts` | `GET`/`POST /oauth/authorize` obendrauf — eigenes Modul, weil `oauth-pages.ts` sonst zwei Änderungsgründe trägt |
| `src/rest/oauth-http.ts` | was beide OAuth-Module teilen (eine `send`-Fassung, ein Kopfsatz) |
| `src/rest/static.ts` | `sendAsset` herausgelöst, `AUTH_CSP`/`AUTHORIZE_ASSET` exportiert |
| `public/authorize.html`, `public/authorize.js` | die Seite, auf der jemand sein Passwort tippt |
| `src/http-app.ts` | ein Code-Speicher je Prozess, an den Endpunkt gereicht |

### Die drei Festlegungen, die tragen

1. **Erst prüfen, dann fragen.** Unbekannter Client, nicht registrierte
   Rückleitung, `plain` statt `S256`, fremder `response_type` → 400 mit einer
   deutschen Seite und **ohne Weiterleitung**. Ein Fehler an eine Adresse zu
   schicken, die wir nicht anerkannt haben, machte diesen Server zum Umleiter
   für jeden, der einen Link schreiben kann.
2. **Der Block bleibt Chiffrat.** Er wartet im Speicher auf `/oauth/token`; wir
   könnten ihn öffnen, tun es nicht. Das ist der Unterschied zum verworfenen
   Tresor, und `oauth-codes.ts` importiert `access-token.ts` deshalb nicht.
3. **Eine Prüffassung für beide Hälften.** GET entscheidet, was gezeigt wird,
   POST, was geprägt wird — mit zwei Fassungen verschwindet die PKCE-Pflicht
   irgendwann auf dem Pfad, der den Code wirklich ausgibt.

### Was das Ausführen fand — und kein Test sah

Ein lokaler Durchlauf im Browser (eigener Wegwerf-Schlüssel, Repository auf eine
tote Adresse gesetzt, damit **keine** Anmeldung irgendwo ankommt) zeigte sofort:
jede Einwilligung endete mit „Dieser Anfragetyp wird nicht unterstützt".

Die Seite sendete `response_type` nicht mit; der Endpunkt verlangt es. **Beide
Seiten waren grün getestet** — jede gegen die Vorstellung des Autors vom Körper
der Anfrage. Genau die Lehre, die in `CLAUDE.md` schon für die Kuratierung
steht, hier ein zweites Mal.

Der Test dagegen (`oauth-authorize-page.test.ts`) liest die Feldnamen **aus der
Seite** und gibt sie der **echten** Prüffunktion. Er wäre rot gewesen.

Live bestätigt: Seite mit Programmname und Rückleitungsziel, Ablehnen-Knopf
liefert `?error=access_denied&state=…` an den Callback, falsche Anmeldedaten
ergeben den deutschen Text und die Eingaben bleiben stehen, keine
CSP-Verletzung in der Konsole.

**Nicht live geprüft:** der Erfolgsfall — er braucht echte WLO-Zugangsdaten.
Abgedeckt ist er durch die Endpunkt-Tests mit gefälschter Autorität; der
Live-Nachweis gehört nach P4 in einen Durchlauf gegen Staging.

### Hochladen

Nicht nötig für P3 allein: ein Client käme jetzt bis zur Anmeldung und
scheiterte am Tausch. Der nächste sinnvolle Live-Test ist **nach P4**.

Neu/geändert: `src/auth/oauth-codes.ts`, `src/auth/access-issue.ts`,
`src/auth/oauth-authorize.ts`, `src/rest/oauth-pages.ts`, `src/rest/oauth-consent.ts`,
`src/rest/oauth-http.ts`, `src/rest/static.ts`,
`src/rest/auth-pages.ts`, `src/http-app.ts`, `public/authorize.html`,
`public/authorize.js`, `public/auth.css`, `tests/oauth-codes.test.ts`,
`tests/oauth-authorize-page.test.ts`, `tests/oauth-endpoints.test.ts`,
`tests/shared-rule-discipline.test.ts`, `CHANGELOG.md`,
`docs/plans/2026-08-05-mcp-oauth-tasks.md`, `docs/plans/STATUS.md`.

---

## OAuth — P4 abgeschlossen 2026-08-05

**Stand:** Der Anmeldeweg ist **vollständig**. Ein Client findet den Server,
registriert sich, schickt den Nutzer zur Anmeldung, tauscht den Code und
arbeitet danach mit dessen WLO-Rechten. Offen ist nur noch **P5**: der
Live-Durchlauf gegen ChatGPT und Claude plus Doku.

**Nachweis:** `npm test` → **1302 Tests, 1302 bestanden** (vor P4: 1291).
`npx tsc -p tsconfig.typecheck.json --noEmit` → exit 0.

### Was gebaut wurde

| Datei | Rolle |
|---|---|
| `src/rest/oauth-token.ts` | `POST /oauth/token` — der Tausch. Eigenes Modul, nicht in `oauth-pages.ts`: Metadaten ausliefern, ein Passwort entgegennehmen und einen Einmal-Code einlösen sind drei verschiedene Dinge |
| `src/rest/oauth-pages.ts` | `/oauth/token` in die Route-Tabelle |
| `tests/oauth-flow.test.ts` | der ganze Weg durch einen echten `node:http`-Server |

### Die drei Festlegungen

1. **Das Token IST der Block.** Kein zweites Geheimnis, kein Speicher, keine
   Lebensdauer, die wir nicht einhalten könnten — und genau deshalb beendet ein
   Widerruf auf `/auth-revoke.html` beide Wege gleichzeitig. Kein
   `refresh_token`, kein `expires_in`.
2. **Verbraucht ist verbraucht.** Der Code wird aus dem Speicher genommen,
   **bevor** irgendeine Prüfung läuft. Bliebe er nach einem falschen
   PKCE-Nachweis liegen, wäre der Einmal-Code ein Rateorakel.
3. **Ein Fehlertext für jeden Fehlschlag.** `invalid_grant` mit derselben
   Beschreibung für unbekannten Code, fremden Client, abweichendes Ziel und
   falschen Verifier: welcher Teil nicht stimmte, ist genau das, was jemand mit
   einem gestohlenen Code gern wüsste.

### Der Fluss-Test, und warum er nicht geschenkt ist

`tests/oauth-flow.test.ts` geht neun Schritte: zwei Discovery-Dokumente,
Registrierung, Einwilligung, Tausch, ein `tools/list` mit dem Token (die
Kurations-Werkzeuge sind dabei), Widerruf, dasselbe Token → **401**, und ohne
Kopf → **200 mit der anonymen Liste**. Die letzten beiden sind der Zweck: die
Zusicherung, die das Design gibt, und die, die dieses Vorhaben am leichtesten
kaputt macht.

Weil der Test nach dem Code entstand, wurde er **durch Mutation geprüft** statt
behauptet:

| Mutation | Ergebnis |
|---|---|
| `access_token` ist nicht mehr der Block | Fluss-Test rot |
| `consume` löscht den Eintrag nicht | Fluss-Test rot („zweimal einlösen") |
| Code bleibt nach dem Einlösen im Speicher | Endpunkt-Tests rot (`store.size()`) |

Dazu ein Riss, den vorher nichts abdeckte: das Discovery-Dokument verspricht
Clients drei Pfade, und eine Umbenennung der Route hätte es still gebrochen —
der Client folgt dem Dokument in ein 404 und meldet „kein OAuth hier". Jetzt
prüft ein Test, dass jeder genannte Pfad auch geführt wird.

`tsc` fand außerdem einen Typfehler in meinem eigenen Test, den `npm test` nicht
sehen kann (tsx prüft keine Typen) — beides gehört in jeden Durchlauf.

### Hochladen — jetzt lohnt es

Nach P4 ist der Weg zum ersten Mal live prüfbar. Neu/geändert gegenüber dem
Stand auf dem Server: alles aus dem P3-Abschnitt oben **plus**
`src/rest/oauth-token.ts`, `src/rest/oauth-pages.ts`, `tests/oauth-flow.test.ts`,
`tests/oauth-endpoints.test.ts`, `CHANGELOG.md`,
`docs/plans/2026-08-05-mcp-oauth-tasks.md`, `docs/plans/STATUS.md`.

**Vor dem Live-Test bedenken:** die Anmeldeseite verlangt echte WLO-Zugangsdaten
— dieser Schritt ist bisher nur mit gefälschter Autorität geprüft.

---

## OAuth — P5 Live-Durchlauf 2026-08-05: OAuth funktioniert, ChatGPT verbindet trotzdem nicht

**Kurz:** Der gesamte Anmeldeweg ist gegen Produktion **nachgewiesen**. ChatGPT
durchläuft ihn vollständig und meldet danach „Beim Herstellen der Verbindung ist
ein Problem aufgetreten". Die Ursache liegt **nicht** in P1–P4.

### Was live belegt ist (2026-08-05, `wlo-mcp.87.106.195.152.nip.io`)

Server-Log eines echten ChatGPT-Anlaufs:

```
oauth client registered      name: ChatGPT, redirectUris: 1
access block issued          label: janschachtschabel
authorization code issued    client: ChatGPT
access token issued          label: janschachtschabel
→ danach sechs bediente MCP-Anfragen in 450 ms, KEIN 401, kein Fehler
```

Sechs Anfragen in dieser Zeit entsprechen der üblichen Connector-Abfolge
(`initialize`, `notifications/initialized`, `tools/list`, `resources/list`,
`prompts/list`, `resources/templates/list`). Alle wurden bedient.

Eigene Messung durch Caddy und TLS:

| Prüfung | Ergebnis |
|---|---|
| `initialize` anonym | 200, korrekte Aushandlung, `text/event-stream` |
| `tools/list` anonym | 200, 75 825 B, 25 Werkzeuge |
| `tools/list` mit gültigem Block | 200, 93 218 B, **38** Werkzeuge |
| Versionsaushandlung `2024-11-05` … `2026-01-01` | jeweils korrekt beantwortet |
| `GET /mcp` | 405 mit `Allow: POST` — spezifikationskonform |
| `prompts/list` | `-32601`, korrekt: `initialize` bietet nur `resources` und `tools` an |

### Was damit AUSGESCHLOSSEN ist — nicht erneut prüfen

- **OAuth in jedem Schritt** (Discovery, Registrierung, Einwilligung, Tausch)
- **Das Token** — ein gültiger Block liefert live 38 Werkzeuge
- **Caddy, TLS, SSE, zustandsloser Transport**
- **Handshake, Fähigkeiten, Protokollversion**
- **Identitätstrennung** — anonym 25 / Nutzer 38 / danach wieder 25, in beiden
  Betriebsarten. (Eine erste Messung schien ein Leck zu zeigen; das war ein
  Fehler im Prüfskript: `call(m, p, undefined, id)` löst in JavaScript den
  Vorgabewert aus, der Durchlauf lief also mit demselben Token.)
- **Werkzeug-Schemata** — kein `anyOf`, `oneOf`, `allOf`, `$ref`, `const` in
  keinem der 38; kein Name über 64 Zeichen. Das größte Schema
  (`search_wlo_all`, 3097 B) steht bereits in der anonymen Liste, die 13
  Kurationswerkzeuge sind allesamt kleiner.

### Zwei falsche Fährten, die Zeit gekostet haben

1. Ein 401 auf einen frisch geholten Block — das mitkopierte Wort `Bearer` aus
   dem Textfeld der Seite ergab `Authorization: Bearer Bearer wlo2…`.
   **Behoben am selben Tag:** `/auth` hat jetzt zwei Kopfknöpfe — „Mit ‚Bearer'
   kopieren" für ein Kopfzeilenfeld und „Nur den Block kopieren" für ein Feld,
   das nur den Block will. Die Statuszeile nennt, welche Form in der
   Zwischenablage liegt. Festgenagelt in `tests/auth-pages-static.test.ts`.
2. `MAX_BLOCKS_PER_LABEL = 10` mit Verdrängung des ältesten Eintrags erklärt
   401-Fälle bei ÄLTEREN Blöcken, war hier aber nicht die Ursache.

### Was offen ist — genau ein Bit

**Nimmt ChatGPT eine Verbindung zu diesem Server überhaupt an?** Das ist nie
gemessen worden: vor OAuth kam der Connector nie so weit. Ohne diese Antwort ist
jeder nächste Schritt geraten.

- Connector mit **„Keine Authentifizierung"** anlegen.
  - scheitert ebenfalls → unabhängig von der Identität; nächster Verdächtiger
    ist die Größe der Werkzeugliste (75,8 KB anonym / 92,7 KB angemeldet)
  - verbindet sich → es liegt an dem, was die Nutzer-Identität hinzufügt

Zweiter Kandidat, falls der erste nichts bringt: **`MCP_SSE`**. Produktion läuft
mit `1`. Die Beschreibung in `src/mcp-transport.ts` behauptet, SSE sei „required
by ChatGPT developer mode" — diese Aussage stammt jedoch aus der Zeit, in der
ChatGPT sich nie verbinden konnte, ist also **nicht unter den heutigen
Bedingungen gemessen**. Sie gehört nachgemessen, bevor man sich auf sie verlässt.
