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

### Die Ursache — gefunden 2026-08-05

Der Gegentest fiel eindeutig aus: **ohne Authentifizierung verbindet sich
ChatGPT, mit OAuth nicht.** Damit lag es an den 13 Werkzeugen, die eine
Identität hinzufügt — und der einzige strukturelle Unterschied war:

```
Lesewerkzeuge     _meta.securitySchemes: [{ "type": "noauth" }]
Kurationswerkzeuge _meta.securitySchemes: [{ "type": "http" }]
```

Die Apps-SDK-Dokumentation (developers.openai.com/apps-sdk/build/auth) zählt die
gültigen Typen auf: **`noauth` und `oauth2`, mehr gibt es nicht.** `http` war aus
OpenAPI entliehen. Ein unbekannter Typ verwirft die **ganze** Werkzeugliste —
deshalb kam im Server-Log nichts an: die Anfrage wurde korrekt beantwortet, der
Client nahm die Antwort nur nicht an.

**Behoben:** `[{ type: 'oauth2', scopes: ['wlo'] }]`, aus **einer** Konstante
(`OAUTH_SECURITY_SCHEMES` in `apps/tool-defaults.ts`) statt dreizehn Literalen;
der Scope kommt aus `SCOPES` in `auth/oauth-metadata.ts`, damit Werkzeug und
Autorisierungsserver nicht auseinanderlaufen können.

`tests/tool-security-schemes.test.ts` prüft die Regel über **alle** Werkzeuge in
beiden Betriebsarten — ein einziges mit unbekanntem Typ reicht, und dann ist
nicht ein Werkzeug kaputt, sondern die Verbindung.

Ein bestehender Test (`tools-curation-gating.test.ts`) nagelte den falschen Wert
fest. Die geprüfte Eigenschaft blieb, nur der erwartete Wert stammte aus der
falschen Annahme; die Änderung trägt einen datierten Kommentar.

**Nachweis:** `npm test` → 1306/1306, `tsc` exit 0.
**Live bestätigt 2026-08-05 nach dem Deploy:** der OAuth-Connector wird in
ChatGPT ohne Fehler angelegt, die Anmeldung läuft durch, die Werkzeuge stehen
zur Verfügung. Damit ist die Ursache belegt, nicht nur begründet.

### Offen, davon unabhängig

Im anonymen Betrieb arbeitet das Volltext-Werkzeug nicht wie erwartet: auf
„frage den Inhalt des Übungsblattes ab" reagiert ChatGPT nicht, auf ausdrückliche
Nachfrage ruft es Werkzeuge auf und erfindet danach Inhalte. Das ist ein
**eigener** Befund, kein Auth-Problem.

**Erste Messung dazu (2026-08-05, live gegen Produktion, anonym):** das Werkzeug
liefert. Acht von acht Materialien aus einer echten Suche nach „Bruchrechnung
Arbeitsblatt" gaben `source: "repository"` mit 937 bis 53 986 Zeichen echtem
Text; kein einziges `source: "none"`. Der Guard, den man hier vermuten würde
(leere Antwort ⇒ Modell ergänzt), ist vorhanden und greift nicht ein, weil es
nichts zu greifen gibt: bei fehlendem Text kommt `source: "none"` mit `reason`
und im Markdown „_Kein Volltext verfügbar (…)_".

Damit ist die naheliegende Erklärung ausgeschlossen. Was bleibt: entweder ruft
das Modell das Werkzeug nicht auf (Beschreibung/Auslöser), oder die Rückgabe
erreicht es nicht (das Werkzeug trägt `openai/outputTemplate` — ein Widget).
**Das nächste, was fehlt, ist der Werkzeugaufruf-Verlauf aus ChatGPTs eigener
Oberfläche** (Aufruf aufklappen): was gesendet und was zurückgegeben wurde.
Ohne den ist alles Weitere geraten.


## ChatGPT verlangt eine Zustimmung PRO UNTERHALTUNG (2026-08-05)

Nach dem erfolgreichen Deploy war der Connector verbunden — und im Chat trotzdem
unbenutzbar: das Modell behauptete, es habe keinen Zugriff, und **im Server-Log
kam nichts an**. Kein Serverproblem: ChatGPT hatte schlicht nicht angerufen.

Die Lösung ist eine Eigenschaft des Clients, keine unserer: ChatGPT zeigt eine
eigene Karte **„wlo verbinden — ChatGPT benötigt Zugriff auf wlo"** mit einem
`Verbinden`-Knopf, und die erscheint erst, wenn eine Anfrage sie auslöst
(hier: „kannst du bei wlo nach inhalten suchen?"). Ein in den Einstellungen
verbundener Connector ist **nicht** automatisch in einer Unterhaltung aktiv.

**Folgen, die man kennen muss:**

1. Für jede Fehlersuche gilt: **erst ins Log sehen.** Leeres Log heißt „der
   Client hat nicht angerufen" und schließt den Server als Ursache aus. Das hat
   hier in einem Schritt entschieden, was vorher eine Stunde Suche war.
2. **Ein Modell ohne angehängte Werkzeuge erfindet.** Der frühere Befund
   „ruft Werkzeuge auf, liefert dann ausgedachte Daten" stammt sehr
   wahrscheinlich aus genau diesem Zustand. Er ist damit **nicht bestätigt** und
   gehört mit einer wirklich verbundenen Unterhaltung neu beobachtet, bevor am
   Volltext-Werkzeug etwas geändert wird.
3. Gehört in die Bedienungsanleitung für Redakteure: nach dem Verbinden in den
   Einstellungen im Chat einmal nach WLO fragen und die Karte bestätigen.

## Erste echte Nutzung im Chat — vier Beobachtungen (2026-08-05)

**1. Zustimmung pro Unterhaltung ist ungewöhnlich, aber erklärbar.** Andere
MCP-Server verbinden beim Eintragen. Der Unterschied dürfte sein, dass wir
`_meta.securitySchemes` überhaupt deklarieren — und seit heute 13 Werkzeuge mit
`oauth2`. Ein Server, der nichts deklariert, gibt dem Client nichts zu fragen.
**Nicht gemessen**, und die Alternative wäre eine falsche Angabe (Schreibwerkzeuge
als `noauth` auszuweisen), also bleibt es so. Gehört in die Anleitung, nicht in
den Code.

**2. „Failed to fetch template", Ergebnisse 5–6 s später.** Gemessen gegen
Produktion: `resources/list` in 197 ms, alle vier Widgets lesbar in 40–140 ms,
und **alle 13 Werkzeuge mit Vorlage zeigen auf eine Ressource, die es gibt** —
kein toter Verweis. Der Ladefehler war vorübergehend und der zweite Versuch
erfolgreich. Ohne Log-Zeile aus genau diesem Moment ist nicht zu sagen, ob die
Anfrage uns überhaupt erreichte. **Wenn es wiederkommt:** sofort
`docker compose logs --since 2m mcp-server` — leeres Log heißt clientseitig.

**3. Häkchen allein reichen nicht.** Die Auswahl liegt im Widget-Zustand
(`setWidgetState`), und den sieht das Modell nicht. Erst „Auswahl verwenden"
schickt eine Nachricht mit Titel und `nodeId` jedes Stücks und nennt
`get_nodes_details` als nächsten Schritt (`widgets/search-results/selection.ts`).
Das ist so gebaut und richtig — aber es muss jemand wissen.

**4. Volltext-Auslöser verbessert.** „hole den Volltext" wirkte, „zeig mir den
Inhalt des Arbeitsblatts" nicht. Die Beschreibung nannte die Fähigkeit, nicht die
Formulierungen. Jetzt stehen die Auslöser vorn, `get_node_details` ist als das
falsche Werkzeug benannt, und ein fehlender Text ist ausdrücklich eine Auskunft —
**nichts erfinden**. Neu geschrieben statt verlängert: 1162 → unter 1024 Zeichen.
Ein Test hält beides fest (`tests/tools-content-text.test.ts`).

### Offen, ohne Beleg

Fünf Beschreibungen liegen über 1024 Zeichen (`search_wlo_topic_pages` 1573,
`get_node_details`, `get_wlo_content_text` — jetzt behoben —,
`search_wlo_collections`, `search_wlo_all`). Ob ChatGPT das erzwingt, ist
**nicht gemessen**; der Connector arbeitet damit. Nicht auf Verdacht kürzen —
erst messen, ob eine Beschreibung abgeschnitten ankommt.

## Offener Wunsch: Inhalt als DATEI anlegen, nicht nur als URL (2026-08-05)

Live entstanden: `wlo_create_content` verlangt eine Quell-URL, also lässt sich
etwas, das im Chat erarbeitet wurde (Markdown, ein erzeugtes Bild), nicht
ablegen. Gewünscht: beides unterstützen — URL, Datei, oder beides — und dort,
wo es unklar ist (Inhalt erarbeitet, URL war nur die Quelle), **fragen**.

**Das ist ein Entwurfsvorhaben, kein Handgriff.** Drei Bedingungen binden es:

1. **Fingerabdruck.** Der Bestätigungs-Token ist an die gezeigte Änderungsmenge
   gebunden; alles, was der Aufruf sendet, muss darin stehen. Hochgeladene Bytes
   sind Nutzlast — sonst genehmigt jemand „Knoten anlegen" und wir laden
   zusätzlich etwas hoch, das er nie gesehen hat.
2. **Rücklesen.** Nach dem Upload prüfen, dass der Knoten den Inhalt trägt.
   edu-sharing verwirft Schreibvorgänge und antwortet trotzdem mit 200.
3. **Erst messen.** Der Content-Upload ist ein Endpunkt, den wir noch nie
   benutzt haben. Lehre vom 2026-08-02: ein Test gegen `fetchMock` beweist, dass
   wir senden, was wir uns ausgedacht haben — nie, dass das Repository es
   annimmt. Also zuerst eine Messung gegen **Staging**, dann der Entwurf.

Offene Entwurfsfragen für diese Messung: welcher Endpunkt und welche
Reihenfolge (Knoten anlegen → Inhalt hochladen?), welche MIME-Typen und welche
Größenbegrenzung, was in der Vorschau steht (Name, Typ, Größe, Prüfsumme?), und
ob das ein eigenes Werkzeug wird oder ein Feld an `wlo_create_content`.

## Randbefund: ChatGPT drosselt (2026-08-05)

Im Chat sichtbar: „Capabilities reduced until … Responses may have lower quality
and **some tools are unavailable**." Ein Teil des sprunghaften Verhaltens —
mal zwei Werkzeuge, mal keins — kommt von dort und nicht von diesem Server. Bei
jeder künftigen „das Werkzeug fehlt"-Meldung: erst diese Zeile suchen, dann das
Log (`mcp request` nennt jetzt `method` und `mode`), dann den Server verdächtigen.

## Gemischte Authentifizierung nach offiziellem Muster — FERTIG (2026-08-05)

Punkte 1 und 2 aus dem zweiten Nachtrag in
`docs/plans/2026-08-05-mcp-oauth-design.md` sind umgesetzt. Punkt 3 (das Feld
`securitySchemes` statt nur `_meta`) bleibt vom SDK blockiert.

**Was sich ändert:** die dreizehn Kurationswerkzeuge stehen jetzt in jeder
`tools/list` — auch ohne Anmeldung — und verweigern beim Aufruf mit
`_meta["mcp/www_authenticate"]`, womit der Client die Anmeldung startet. Die
Lesewerkzeuge deklarieren beide Schemata (`noauth` + `oauth2`).

**Die Regel, die dabei gekippt wurde,** ist in `CLAUDE.md` ersetzt, nicht
gelöscht: „Schreibwerkzeuge fehlen im anonymen Betrieb" war als
Sicherheitsmaßnahme gedacht und war der Grund, warum die Anmeldung nie begann.
Die Verweigerung selbst ist unverändert und absolut.

**Belege:**

- `npx tsc -p tsconfig.typecheck.json --noEmit` → Exit 0
- Volle Suite → 1311/1311 (mit `--test-concurrency=3`; siehe Hinweis unten)
- `tests/curation-auth-challenge.test.ts` (5 Fälle): die tragende Zusicherung ist
  **null** Anfragen nach oben bei einem anonymen Aufruf, nicht der Antworttext.
- `tests/shared-rule-discipline.test.ts`: neuer Quelltext-Scan — kein
  Kurationswerkzeug darf am Tor `registerCurationTool` vorbei registriert werden.

**Betriebshinweis zur Suite:** `npm test` lässt den Node-Runner mit voller
Parallelität laufen. Auf einer Maschine unter Speicherdruck (gemessen
2026-08-05: 0,6 GB frei von 15,3 GB) brechen die Kindprozesse reihenweise mit
`FATAL ERROR: Zone Allocation failed - process out of memory` ab — das sieht wie
Dutzende fehlgeschlagene Tests aus und ist keins. Gegenprobe mit
`--test-concurrency=3`, bevor jemand den Fehler im Code sucht.

**Noch offen aus P5:** Test mit Claude als Client; `/better-coding-review` über
den gesamten OAuth-Diff.

## Review der Auth-Integration und dessen Behebung — FERTIG (2026-08-06)

Vollständiger Review über `src/auth/*`, `src/rest/oauth-*.ts`, `auth-pages.ts`,
die Seitenskripte und die Einbindung in `http-app.ts`. Sechs Befunde, alle
behoben, jeder mit einem vorher rot gesehenen Test.

**Der tragende (MAJOR):** `/auth/issue`, `/auth/revoke` und `POST
/oauth/authorize` haben den Body ohne Blick auf `Content-Type` geparst. Die
CSRF-Begründung im Quelltext („JSON braucht einen Preflight") gilt nur, wenn der
Server `application/json` **verlangt** — ein `<form enctype="text/plain">` ist
eine simple request und sein Body kann als JSON gebaut werden. Damit ließ sich
jeder Besucher einer fremden Seite zu einem Rateversuch von **seiner** Adresse
aus bringen; die Rückmeldung holt sich die Angreiferin, indem sie den selbst
gebauten Block danach bei `/mcp` vorlegt. Der `authAbuseLimiter`, der pro Adresse
zählt, war so zu umgehen. Jetzt 415 ohne den Header.

Vier kleinere: Maskierung im RFC-6750-Challenge, Userinfo im Loopback-Zweig von
`redirectUriMatches`, `isValidRedirectUri` auch beim Öffnen einer `client_id`,
`code_verifier` auf 43–128 Zeichen (RFC 7636 §4.1).

**Eine korrigierte Zusicherung:** `access-registry.ts` behauptete „revoking a
block requires holding it". Falsch — `remove` geht über die Zugangs-id, und
Blöcke kann mit dem veröffentlichten Schlüssel jede:r bauen. Der Handel ist
gewollt (wer eine Kompromittierung bemerkt, muss sofort sperren können), macht
aber **die id zum Geheimnis**: sie darf nie geloggt und nie zurückgegeben werden.
Beide Hälften sind jetzt in `tests/auth-endpoints.test.ts` festgehalten.

**Belege:** `npx tsc -p tsconfig.typecheck.json --noEmit` → Exit 0;
volle Suite → 1320/1320 (`--test-concurrency=3`, siehe Speicherhinweis oben).

**Lehre für die nächste Runde:** der erste Test zur Verifier-Länge war grün, ohne
dass die Prüfung existierte — ein zu kurzer Verifier scheitert ohnehin am
Hashvergleich. Erst ein Code, dessen `code_challenge` das echte S256 des kurzen
Verifiers ist, trennt die beiden Zustände. Ein Test, der auch ohne die Änderung
grün ist, belegt nichts.

## Werkzeugbeschreibungen überarbeitet (2026-08-06)

Anlass: Claude bekam „aus der Wikipedia-Seite von Apolda einen Inhalt bauen" und
machte eine eigene Websuche, statt `get_url_text` zu nehmen. Dazu die
Beobachtung des Nutzers, dass Lehrkräfte nicht „Bildungsinhalte" sagen, sondern
„ein Video zu Bruchrechnung", und dass das Repository auch WirLernenOnline,
edu-sharing oder openeduhub heißt.

Vier Lücken, alle behoben und in `tests/tool-descriptions.test.ts` festgehalten:

1. **Alltagssprache.** `search_wlo_all` führt jetzt mit den Formulierungen statt
   mit der Form des Rückgabewerts und sagt, dass ein genanntes Medium ein FILTER
   ist, kein Grund für ein anderes Werkzeug.
2. **Die anderen Namen** stehen in den Server-Instructions — einmal gelesen, für
   alle Werkzeuge gültig, statt dreizehnmal in Schreibwerkzeugen wiederholt.
3. **Wikipedia → `get_url_text`.** Beide Werkzeuge nennen einander jetzt;
   `get_wikipedia_summary` sagt ausdrücklich, dass es nur den Anriss liefert.
4. **Länge.** Vier Beschreibungen lagen über 1024 Zeichen (bis 1573), jetzt keine
   mehr; die längste hat 1006. Gekürzt wurde Implementierungsdetail, das auch in
   den Parameterbeschreibungen steht — nie eine zugesagte Eigenschaft.

**Ein Test hat mich dabei korrigiert:** beim Kürzen von `get_node_details` fielen
die fünf `raw`-Feldnamen mit heraus. `node-details.test.ts` hält seit einem
früheren Fund fest, dass die Beschreibung genau die Felder nennt, die geliefert
werden — „eine Beschreibung, die breiter ist als das Verhalten, schickt
Aufrufende nach Werten, die nie ankommen". Die Namen sind zurück, gekürzt wurde
stattdessen die englische Einleitung.

**Belege:** `npx tsc … --noEmit` → Exit 0; volle Suite → 1329/1329.

**Ungemessen und bewusst so gelassen:** ob ein Host die 1024 Zeichen wirklich
erzwingt. Unter der Grenze zu schreiben macht die Frage gegenstandslos, statt
sie zu einem Risiko zu machen.

## URLs, Werkzeugübersicht und Wikipedia-Volltext (2026-08-06)

Drei Punkte aus dem Live-Test, alle umgesetzt.

**1. URL und nodeId gehen in den Antworten verloren.** Beide standen längst in
jedem Datensatz (`nodeId:` und `URL:`), aber Clients formatieren um und werfen
nackten Text zuerst weg. Zwei Hebel statt einem: die Überschrift ist jetzt ein
Markdown-Link (`## [Titel](<URL>)`) — fertige Formatierung wird kopiert, nicht
neu erfunden —, und die Instructions sagen es zusätzlich ausdrücklich. Titel und
URL sind beide repository-eigen, also maskiert `headingFor` eckige Klammern im
Titel und nutzt die spitzklammrige CommonMark-Form für die Adresse; sonst wäre
das eine neue Fälschungsmöglichkeit an derselben Stelle, an der `oneLine` eine
geschlossen hat.

**2. Sollen alle 38 Werkzeuge in den Instructions stehen? Nein.** Der Client hat
`tools/list` mit allen Beschreibungen; eine Namensliste wäre eine zweite,
driftende Kopie. Was fehlte, war die KATEGORIE: der Text las sich wie ein reiner
Lesedienst, sodass „leg das bei WirLernenOnline an" den Namen fand, aber nicht
die Zusage, dass Anlegen überhaupt geht. Jetzt genannt — lesen, Volltext,
schreiben (zweistufig) — ohne Aufzählung.

**3. Wikipedia liefert jetzt den ganzen Artikel.** Gemessen 2026-08-06 über
`action=query&prop=extracts&explaintext=1`: Apolda 366 Zeichen als Anriss,
**123.682** als Artikel; Photosynthese 354 vs. 105.632. Ein Aufruf, ohne
Extraktionsdienst. `fullText=true` schaltet es ein, die Vorgabe bleibt der
Anriss — 120k Zeichen als Standard würden jeden Kontext fluten. Kappung über
`capText` (`maxChars`, Vorgabe 8000).

**Die Reihenfolge ist dabei tragend:** der Volltext wird über den von
`fetchWikipediaSummary` AUFGELÖSTEN Titel geholt, nie über die rohe Anfrage.
Sonst umginge er die Relevanzprüfung aus `wikipedia-relevance.ts` — „Stadt
Berlin" hat einmal den Schweizer Bundesort geliefert, und darunter schreibt ein
Aufrufer „Quelle: Wikipedia-Artikel ‚X'". Der zusätzliche Rundlauf ist der Preis
dieser Zusage; ein Test hält beides fest.

**Belege:** `npx tsc … --noEmit` → Exit 0; volle Suite → 1333/1333.

**Wieder in dieselbe Falle gelaufen:** der Heredoc frisst eine Backslash-Ebene,
`\[` wurde zur Zeichenklasse. Steht seit dem 2026-08-05 in CLAUDE.md, und ich
habe es trotzdem gemacht. Für maskierte Zeichen `String.includes` statt
`new RegExp` — ein Muster wäre grün gewesen und hätte nichts belegt.

## Doku nachgezogen + AUTH.md (2026-08-06)

**Werkzeugübersichten geprüft, nicht angenommen:** ein Abgleich der in
`README.md`, `README.de.md` und `docs/TOOLS.md` genannten Werkzeugnamen gegen die
Liste des laufenden Servers ergab **keine fehlenden und keine erfundenen Namen**.
Falsch waren zwei Aussagen:

1. `docs/TOOLS.md` führte eine Sichtbarkeitstabelle „Mit Schreibrechten →
   zusätzlich die 13 Kurations-Tools", und `README.de.md` schrieb „nur mit
   Schreibrechten sichtbar". Beides gilt seit dem 2026-08-05 nicht mehr.
2. Wikipedia war überall als „Kurzzusammenfassung" beschrieben, obwohl das
   Werkzeug seit heute mit `fullText` den ganzen Artikel liefert.

Beides korrigiert. Zwei neue Prüfungen in `tests/docs-claims.test.ts` halten es
fest — eine gegen die alte Sichtbarkeitsbehauptung in allen drei Dokumenten, eine
darauf, dass `docs/AUTH.md` die Regeln nennt, für die es existiert.

**Nicht korrigiert, weil geprüft und richtig:** die Aussage, `get_url_text` sei
im Docker-Deployment ab Werk abgeschaltet. `docker-compose.yml:123` setzt
`${WLO_DISABLE_UNSAFE_TOOLS-all}` und `.env.example` liefert `all` aktiv aus. Auf
dem vServer läuft eine eigene Compose-Datei ohne diese Zeile — das ist eine
Abweichung des Deployments, kein Dokumentationsfehler.

**Neu: `docs/AUTH.md`** — die Erklärung der Auth-Umsetzung an einer Stelle:
warum es keinen Token zum Weiterreichen gibt (die Messung vom 2026-07-30), die
drei Identitäten, das Format des Zugangsblocks, die Positivliste und was ein
Widerruf wirklich beweist, beide Anmeldewege samt OAuth-Ablauf, die
Missbrauchsschranken und ihre zwei Voraussetzungen (kein CORS-Header UND
`application/json`), die Betreiber-Einstellungen — und zum Schluss neun Regeln,
die eine spätere Änderung nicht unbemerkt aufheben darf.

**Ein eigener Testfehler unterwegs:** mein erstes Muster gegen die alte
Sichtbarkeitsbehauptung verbot auch den jetzt wahren Satz („für alle sichtbar,
aber nur mit Anmeldung benutzbar"). Das Muster war falsch, nicht die Doku —
korrigiert und beide Fälle gegengeprüft.

**Belege:** `npx tsc … --noEmit` → Exit 0; volle Suite → 1335/1335.

## Anonym verbinden ohne eigenes Konto — FERTIG (2026-08-06)

Anlass, live gemessen bei claude.ai: MCP-Adresse eintragen genügt, der Client
findet die Discovery-Dokumente und startet OAuth — und ab da will er einen
Token. „Einfach nichts schicken" kann er nicht. Wer nur suchen wollte, hatte
Anmelden oder Abbrechen, und Abbrechen ist keine Verbindung. Der Server war über
diesen Client anonym gar nicht nutzbar.

**Umgesetzt:** dritter Knopf auf der Zustimmungsseite, Token `wlo-anon.v1`.

Entscheidung des Nutzers zur Bedeutung: *„anonym ist quasi wie vor Einführung der
auth — API wird ohne konkrete Userlogins genutzt."* Also identisch zu einem
Aufruf ohne Header, inklusive Dienstkonto-Rückfall, wo eines konfiguriert ist.

**Warum das klein bleiben durfte:** der Token gewährt exakt das, was ein Aufruf
ohne Header gewährt. Wer ihn fälscht, hat sich das Weglassen des Headers
gespart. Also kein Schlüsselmaterial, kein Eintrag in der Positivliste, kein
Widerruf, keine Ablauffrist — nichts davon würde etwas schützen, und jedes würde
suggerieren, dass es das tut. Er funktioniert deshalb auch ohne eingerichtete
Zugangsblöcke.

**Zwei Eigenschaften halten ihn ehrlich**, beide als Test:

1. Die Absicht muss dastehen (`anonymous: true`). Ein Aufruf, der den Block bloß
   vergessen hat, scheitert weiterhin — sonst würde ein Fehler still zur anonymen
   Verbindung.
2. Exakter Vergleich. Ein Tippfehler im Token ist ein kaputter Token (401), kein
   anonymer.

Die ältere Regel „ein vorgelegter, unbrauchbarer Bearer ist ein 401" bleibt
unangetastet; dies ist der eine Wert, bei dem „keine Zugangsdaten" die Antwort
ist statt des Fehlers. Als Regel 10 in `docs/AUTH.md` aufgenommen.

**Nebenbei entschärft:** die Zustimmungsseite baut ihren POST-Rumpf jetzt in
EINER Funktion, die beide Ausgänge nutzen. Ein zweites Literal ist genau die
Stelle, an der am 2026-08-05 `response_type` verschwand und jede Zustimmung
scheitern ließ. `tests/oauth-authorize-page.test.ts` liest die Feldnamen jetzt
aus dieser Funktion und schickt sie durch die echte Prüfung.

**Belege:** `npx tsc … --noEmit` → Exit 0; volle Suite → 1342/1342. Der tragende
Test läuft gegen einen echten Server durch den ganzen Ablauf und endet auf den
zwei Zeilen, die zählen: kein 401, und dieselbe Werkzeugliste wie ohne Header.

## Widerruf per WLO-Anmeldung — FERTIG (2026-08-06)

`POST /auth/revoke-all` und ein zweites Formular auf `/auth-revoke.html`: WLO-Login
eintippen, alle Zugangsblöcke dieses Kontos werden gesperrt.

**Die Lücke, die das schließt, kam aus der Nutzung, nicht aus einem Review.** Der
Widerruf verlangte bisher die Zugangs-ID, und die steht nur *im* Block — über
OAuth geht der Block aber an den KI-Host und die Person sieht ihn nie. Genau die
Nutzer, die am ehesten sperren wollen (Connector angelegt, später gelöscht),
hatten damit keinen Weg dorthin; blieb nur, dass die Betreiberin die
Registry-Datei bearbeitet. Den Connector im KI-Host zu löschen widerruft nichts:
dieser Server führt keinen Client-Zustand, nur die Positivliste.

**Die tragende Prüfung:** der Login wird oben verifiziert, BEVOR etwas entfernt
wird. Unser öffentlicher Schlüssel ist veröffentlicht, damit Browser
verschlüsseln können — also kann jeder einen Block bauen, der einen beliebigen
Namen trägt. Ohne die Prüfung würde ein geratener Benutzername den KI-Host einer
fremden Person trennen. Die Prüfung liegt jetzt EINMAL in
`src/auth/access-verify.ts`, durch das Ausgabe, OAuth-Autorisierung und Widerruf
alle drei gehen. Nachgewiesen, nicht behauptet: mit abgeschaltetem
Autoritäts-Check fällt `a login WLO does not accept revokes nothing` um (8/9),
mit ihm sind es 9/9.

`tests/shared-rule-discipline.test.ts` bekam dafür zwei Wächter: es gibt genau
ein Modul mit dem Autoritäts-Check, und beide block-verarbeitenden Aufrufer
müssen `verifyBlockLogin` benutzen. Der erste ist beim Umzug sofort rot geworden
— er zeigte auf `access-issue.ts` — und hat damit genau seine Aufgabe erfüllt.

**Vergleich ist EXAKT, nicht case-insensitiv.** Ob edu-sharing `Jan` und `jan`
als einen Login behandelt, ist ungemessen. Falten wäre eine Bequemlichkeit, wenn
es dasselbe Konto ist, und ein Weg, fremde Zugänge zu löschen, wenn nicht. Die
Seite nennt die Anzahl, also fällt eine abweichende Schreibweise auf.

**Korrigiert:** `docs/AUTH.md` behauptete „ein Widerruf beendet beide Wege
gleichzeitig". Für den Einfüge-Weg stimmt das, für OAuth nicht. Steht jetzt
richtig da, samt der Korrektur selbst.

**Nebenbei:** `publicKey()` stand wortgleich in `auth.js` und `authorize.js`. Eine
dritte Kopie war der Punkt, an dem Unterschiede anfangen sich zu verstecken —
jetzt `fetchPublicKey()` in `access-block.js`, dem Modul, das ohnehin alle drei
Seiten importieren.

**Belege:** `npx tsc -p tsconfig.typecheck.json --noEmit` → Exit 0; volle Suite
→ **1355/1355**. Neue Dateien: `src/auth/access-verify.ts`,
`src/auth/access-revoke.ts`, `tests/auth-revoke-all.test.ts` (9 Tests).

## Datei-Upload statt Quell-URL — VERTRAG GEMESSEN, VERHALTEN NOCH NICHT (2026-08-06)

Fortschritt gegen die drei Bedingungen von 2026-08-05 (siehe „Offener Wunsch"):
Bedingung 3 („erst messen") ist **halb** erfüllt.

**Gemessen am 2026-08-06 aus `openapi.json` von Staging selbst** — und es ändert
die geplante Bauweise, bevor eine Zeile geschrieben wurde. Statt „Knoten anlegen,
dann Inhalt hochladen" gibt es EINEN Aufruf:

```
POST /node/v1/nodes/{repository}/{node}/children/_content
     ?type=ccm:io&renameIfExists=&versionComment=&obeyMds=
     multipart:  properties = {"properties": {"cclom:title": ["…"], …}}
                 file       = die Bytes
```

Der zweistufige Weg existiert daneben (`POST …/{node}/content`, dort ist
`mimetype` ein Pflicht-Query-Parameter, Feld ebenfalls `file`), wird aber nicht
gebraucht. Ebenfalls vorhanden: `POST …/{node}/textContent` (JSON-String,
`mimetype` Pflicht) — der einfachere Weg für reines Markdown.

**Noch NICHT gemessen, und ein Vertrag ist keine Messung** (Lehre 2026-08-02):

- Q1 Nimmt `_content` ein `ccm:io` ganz ohne `ccm:wwwurl` an?
- Q2 Woher kommt der MIME-Typ — Part-Content-Type, Dateiname, keins von beidem?
- Q3 Was trägt der Knoten danach: herunterladbar? Was tritt an die Stelle von
  `ccm:wwwurl` (an dem heute die Dublettenprüfung hängt)?
- Q4 Weist `obeyMds=true` einen Datensatz mit fehlenden Pflichtfeldern ab?
- Q5 Gilt dasselbe für PDF wie für Markdown?
- Q6 Liest `/textContent` den Upload zurück — funktioniert also
  `get_wlo_content_text` auf so einem Datensatz?

**KORREKTUR, noch am selben Tag.** Die Formulierung „Blocker: die lokale `.env`"
war irreführend und der Nutzer hat zu Recht widersprochen: die `.env` ist zur
Laufzeit an dieser Funktion völlig unbeteiligt — der Zugang kommt aus dem
Zugangsblock des Nutzers oder dem Dienstkonto, und die Rechte haben die Leute.
Die `.env` war ausschließlich mein **Messinstrument**, um von hier aus einen
Wegwerfknoten auf Staging anzulegen. Dass sie nicht funktioniert (401 gegen
beide Repositories, gemessen 2026-08-06), blockiert eine Messung, nicht den
Entwurf.

**Und die entscheidende Messung existiert längst** — im Projekt-Skill
`wlo-content-files`, validiert am **2026-05-08 gegen prod UND staging**:

- Ein `ccm:io` **ohne `ccm:wwwurl`** anzulegen geht. Der validierte Child-IO-Pfad
  legt genau so einen an (`cm:name`, `ccm:childobject_order`, keine URL). Q1 ist
  damit beantwortet: die Sperre „Ohne Quell-URL kann kein Datensatz angelegt
  werden" in `nodes-lifecycle.ts` ist UNSERE Regel, nicht die des Repositories.
- Datei anhängen: `POST …/{id}/content?mimetype=…&versionComment=…`, multipart
  `file`. Deckt sich mit der heute gezogenen `openapi.json`. Q2 beantwortet.
- **Das Rücklesen ist vorhanden:** ein Knoten ohne Bytes hat `size: null` und
  `downloadUrl: null`; nach dem Upload sind beide gesetzt. Bedingung 2 ist damit
  erfüllbar, ohne etwas zu erfinden. Q3 beantwortet.
- **Falle, die wir sonst gebaut hätten:** `POST /textContent` ist KEIN Speicher.
  Es antwortet 200, legt den Rumpf wörtlich als Binärinhalt ab, und `GET`
  liefert danach `{"text": null}`. Nur `/content` ist belastbar. Q6 beantwortet.
- Jeder Upload erzeugt eine neue Version. `PUT`-Metadaten versionieren nicht,
  `POST`-Metadaten schon — passt zum vorhandenen `commit`-Schalter.

**Offen bleibt genau eins, und es ist eine Entwurfsfrage, keine Messung:** ein
MCP-Werkzeugaufruf ist JSON, Bytes müssen also als Base64 durch die Parameter.
`MAX_BODY_BYTES` steht auf 1 MB, Base64 bläht um ein Drittel — es passen gut
700 KB Nutzdaten samt Metadaten im selben Aufruf. Für generierte Inhalte
(Markdown, ein paar KB) ist das reichlich; ein 5-MB-PDF geht so nicht und würde
auch das Kontextfenster des Modells sprengen. Ebenfalls offen: was an die Stelle
der Dublettenprüfung tritt, die heute an `ccm:wwwurl` hängt.

`_content` (Anlegen und Bytes in EINEM Aufruf, aus der `openapi.json`) bleibt
ungemessen. Der zweistufige Weg ist der validierte — im Zweifel der gemessene
Pfad, nicht der elegantere.

**Bereit, falls doch gemessen werden soll:** `probe-upload.mjs` im Scratchpad.
Sie weigert sich zu schreiben, wenn die Autorität `esguest` ist oder fehlt, und
löscht alles, was sie anlegt.

Bedingung 1 (der Bestätigungs-Fingerabdruck muss die Bytes umfassen) steht
unverändert und bindet den Entwurf.

## Wegweiser auf der Startseite — FERTIG (2026-08-06)

Frage des Nutzers: „findet der user das leicht?" Gemessen statt geraten — und
nein: `/` verlinkte genau zwei Dinge, `#` und `bookmarklet.md`. Alle Auth-Seiten
verlinken *zurück* auf `/`, aber `/` verlinkte auf keine von ihnen. Die
Sperrseite war am Tag ihrer Fertigstellung von der Startseite aus unerreichbar.

Zweiter Befund derselben Durchsicht, größer als der erste: **die MCP-Adresse
stand nirgends auf der Seite.** Die Karte „WLO-Dienste einrichten" sagte „trägst
du den WLO-MCP-Server in deiner KI ein" — und nannte nicht, was man einträgt.

Umgesetzt, ohne neue Seite (`/` IST die zentrale Seite; eine zweite Übersicht
wäre eine zweite Stelle, die driftet):
- Die MCP-Adresse mit Kopierknopf, gebaut aus `location.origin` — kein Literal,
  das beim nächsten Hostwechsel falsch ist. Ein Test verbietet eine feste Adresse.
- Ein Satz dazu, was ohne Anmeldung geht (suchen, lesen) und wofür ein Konto
  nötig ist (anlegen, bearbeiten), mit Links zu beiden Auth-Seiten.
- Ein `<nav>` im Fuß mit allen sechs Seiten, als echte Navigation mit Überschrift.
- `llms.txt` nennt jetzt die Anmeldung. Vorher stand dort nur „Everything
  reachable without a login is read-only" — ein KI-Client erfuhr nicht, dass es
  `/auth` gibt oder dass 13 Kurationswerkzeuge hinter einer Anmeldung warten.

`tests/launcher-wayfinding.test.ts` (3 Tests) pinnt die Ziele, die dynamische
Adresse und dass **beide Sprachtabellen** jeden Schlüssel tragen — ein Wegweiser,
den es nur auf Deutsch gibt, ist für die halbe Zielgruppe wieder eine Sackgasse.
Gegenprobe gefahren: mit sabotierten Links/Schlüsseln fallen die Tests um.

Zwei eigene Testfehler dabei gefunden und behoben: die EN-Tabelle schließt ohne
Komma (nur `en` betroffen, weil sie die letzte ist), und eine 600-Zeichen-
Nähe-Heuristik war Raterei — ersetzt durch die Eigenschaft, auf die es ankommt:
keine feste Adresse im Dokument.

**Belege:** Typecheck Exit 0 · volle Suite **1358/1358** · echter Server: alle
sechs Ziele antworten 200, `/mcp` initialisiert · im Browser geprüft: DE und EN
ohne leere Strings, 375 px ohne Querscrollen, kein Ziel unter 24 px.

## Inhalt ohne URL — ENTWURF STEHT, Implementierung offen (2026-08-06)

Entwurf: `docs/plans/2026-08-06-content-without-url-design.md`.

Entscheidungen des Nutzers: **Markdown als Text** (damit Arbeitsblätter direkt
gehen) **plus Base64 für Bilder**; Dublettenprüfung **über den Titel im eigenen
Ablageort**. Kein allgemeiner Binär-Upload.

Der Entwurf hält fest, was bereits gemessen ist (siehe Eintrag oben und den
Skill `wlo-content-files`, validiert 2026-05-08 gegen prod und staging), was
bewusst NICHT benutzt wird (`_content` ist ungemessen; `/textContent` ist
gemessen wirkungslos), und die drei bindenden Regeln — Fingerabdruck über die
Bytes, Rücklesen über `size`/`downloadUrl`, kein `/textContent`.

Eine Nebenwirkung, die dazugehört und nicht nebenbei passieren darf:
`MAX_BODY_BYTES` (1 MB) begrenzt den ganzen JSON-RPC-Rumpf, und der 413 kommt
aus der Transportschicht, bevor das Werkzeug läuft — das Modell sieht heute
`Request body exceeds N bytes` ohne Handlungsanweisung.

## Review-Runde über beide Pakete — 6 Befunde behoben (2026-08-06)

Ein MAJOR, drei MINOR, zwei NIT. Der Widerrufs-Teil war sauber; alle Befunde
lagen im Wegweiser und in der Dokumentation.

**[MAJOR] `copyText()` kopierte nicht, was es sollte — und meldete Erfolg.** Der
Rückfallzweig (für Browser ohne Clipboard-API, die einen sicheren Kontext
braucht) **ignorierte sein `text`-Argument** und markierte fest `#prompt`. Das
war unsichtbar, solange nur die Anleitung kopiert wurde — `#prompt` hält genau
sie — und wurde in dem Moment ein Defekt, als ich einen zweiten Aufrufer mit der
MCP-Adresse dazustellte. Verschärfend: `#prompt` liegt in einem geschlossenen
`<details>` und ist nicht fokussierbar, es wurde also gar nichts kopiert.
`execCommand` meldet eine Verweigerung zudem per Rückgabewert `false` statt zu
werfen, und der wurde ignoriert.

Im Browser reproduziert, vor dem Fix:
```
intendedToCopy:     http://…/mcp
actuallySelected:   (nichts – activeElement blieb BODY)
messageShownToUser: "Adresse in die Zwischenablage kopiert."
```
Nach dem Fix, gleiches Szenario: `whatWasActuallyCopied` = die Adresse,
verweigerte Kopie → ehrliche Fehlermeldung in DE und EN, keine Streuelemente.

Die Lehre daran, und sie ist allgemeiner als der Fehler: **ich habe einen Helfer
wiederverwendet, ohne seinen Vertrag zu prüfen.** Er hatte einen Parameter, den
er nicht benutzte, und der einzige bestehende Aufrufer machte das unsichtbar.
Ein zweiter Aufrufer deckt so etwas auf — oder erbt es stumm.

**[MINOR] Falsche Wiederherstellungsanweisung.** Der geteilte `copy_failed`-Text
schickte Leute „ins Vorschau-Feld", wo die Anleitung steht, nicht die Adresse.
Eigener Schlüssel `mcp_copy_failed` in beiden Sprachen.

**[MINOR] `href=""` am Beispiel-Such-Link.** Löst auf das aktuelle Dokument auf:
ohne JavaScript hätte der einzige skriptabhängige Link der Liste die Seite neu
geladen. Jetzt ein echter Pfad im Markup, den das Skript nur noch verfeinert.

**[MINOR] Kein Test fasste den Kopierknopf an.** Genau die Lücke, durch die der
MAJOR gekommen ist — ich hatte den Knopf im Browser gesehen, ohne den
Rückfallzweig auszulösen. `tests/launcher-copy.test.ts` (4 Tests) extrahiert die
ausgelieferte Funktion und führt sie gegen eine DOM-Attrappe aus, in der
sichtbar wird, *was* die Kopie tatsächlich nimmt. Gegenprobe gefahren: ohne die
Rückgabewert-Prüfung fällt der Verweigerungs-Test um.

Außerdem erfasst der i18n-Test jetzt auch Schlüssel, die nur über `t("…")`
benutzt werden — sonst bleibt genau die Hälfte ungeprüft, die ein Nutzer im
Fehlerfall zu sehen bekommt.

**[NIT] `llms.txt` behauptete Pfade ungeprüft.** Neuer Test: jeder Pfad, den die
Datei nennt, muss von einer echten Route bedient werden — gegen die QUELLE
geprüft, weil die REST-Handler ins Netz gingen und ein Test, der dafür das Netz
mocken müsste, den Mock testet. Fand beim Schreiben sofort die variable
Suchform, die kein Literal in der Routentabelle hat. Gegenprobe: ein erfundener
Pfad in `llms.txt` lässt den Test umfallen.

**[NIT] `/auth/revoke-all` gab ein `label` zurück, das niemand liest.** Entfernt:
die Seite kennt den Namen, der Nutzer hat ihn selbst eingetippt.

**Belege:** Typecheck Exit 0 · volle Suite **1364/1364** (+6) · im Browser das
Ausgangsszenario nachgestellt, Fehler weg, beide Sprachen geprüft.

## Datei-Upload statt Quell-URL — FERTIG (2026-08-06)

Entwurf: `docs/plans/2026-08-06-content-without-url-design.md` (dort auch die drei
Abweichungen, die beim Bauen entstanden). Beide Wege stehen jetzt nebeneinander:

- `url` — das Material liegt woanders, der Datensatz zeigt darauf, das Repository
  erschließt es. Unverändert.
- `content` / `fileBase64` — der Datensatz TRÄGT das Material als Datei. Für
  alles, was im Chat entsteht und keine eigene URL hat.

Genau eine Quelle pro Aufruf. Zwei zugleich ist eine Ablehnung, nie eine stille
Rangfolge — „url gewinnt" würde einen Link anlegen, während die Person ihr
Arbeitsblatt in der Vorschau gesehen hat.

**Was der Aufrufer nicht falsch machen kann, weil er es nicht sagen kann.** Der
Bildtyp wird aus den Magic Bytes gelesen (PNG, JPEG, GIF, WebP), nie angegeben;
Unerkanntes wird abgelehnt statt geraten. Der Dateiname wird aus dem Titel
abgeleitet — es gibt keinen vom Aufrufer gelieferten Namen und damit gar keine
Traversal-Fläche. **HTML und SVG fehlen bewusst:** eine HTML-Datei, die das
Repository von seiner Domain ausliefert, ist gespeichertes XSS, und ein SVG ist
ein Dokument, das Skript ausführt — Magic Bytes können dort Zeichnung und
Nutzlast nicht trennen, weil dieselbe Datei beides ist.

**Die Bytes stehen im Fingerabdruck.** Die Vorschau nennt Name, Typ, exakte Größe
und ein SHA-256-Präfix, bei Text zusätzlich den lesbaren Anfang. Der Token ist
daran gebunden, also wird ein Bestätigen mit ANDEREN Bytes abgelehnt. Belegt,
nicht behauptet: mit entfernter Dateibeschreibung fallen zwei Tests um (7/9),
mit ihr sind es 9/9.

**Und der Upload wird zurückgelesen.** Ein `ccm:io` ohne Inhalt meldet `size` und
`downloadUrl` als null; nach dem Upload sind beide gesetzt. Ein Upload, der nicht
ankam, steht neben der neuen nodeId — „angelegt, trägt aber KEINEN Inhalt" —
statt in einem allgemeinen Erfolg zu verschwinden. Ein fehlgeschlagener Upload
lässt das Anlegen nicht scheitern: der Knoten existiert, seine ID muss den
Aufrufer erreichen, und ein Fehler über einem existierenden Datensatz lädt zu
einem Wiederholungsversuch ein, der einen zweiten anlegen würde.

Dublettenprüfung mit dem Anker, den der jeweilige Weg hat: die URL BLOCKIERT (sie
identifiziert das Material exakt), ein Titeltreffer im Ablageort WARNT nur in der
Vorschau — zwei Arbeitsblätter dürfen denselben Namen tragen.

`MAX_BODY_BYTES` steigt von 1 MB auf **4 MB**, ausdrücklich und nicht nebenbei:
ein Bild kommt als Base64 im JSON-RPC-Rumpf (2 MB dekodiert, ~2,7 MB kodiert),
das alte Limit hätte einen Aufruf abgelehnt, den das Werkzeug bedienen soll — in
der Transportschicht, bevor das Werkzeug etwas Brauchbares sagen kann. Der 413
nennt jetzt Ursache und Stellschraube.

**Neue Module:** `services/write/content-source.ts` (rein: welche Quelle, welche
Bytes, welcher Typ, welcher Name), `content-upload.ts` (Upload + Rücklesen),
`duplicates.ts` (aus `nodes-lifecycle.ts` herausgezogen, das sonst über 300
Zeilen gewachsen wäre).

**Belege:** Typecheck Exit 0 · volle Suite **1402/1402** (+38), dreimal in Folge
grün. Neue Tests: `write-content-source.test.ts` (19),
`write-content-upload.test.ts` (5), `tools-curation-create-file.test.ts` (9,
Ende-zu-Ende durch das Werkzeug), `write-nodes-duplicate.test.ts` (+5).

**Eigener Fehler dabei, festgehalten weil er wiederkommt:** ein Python-Rewrite
hat `.env.example` von LF auf CRLF umgestellt, und der Parser in
`deploy-env-passthrough.test.ts` fand danach KEINEN einzigen aktiven Schlüssel —
in JavaScript ist `\r` ein Zeilenendezeichen, das `.` nicht matcht, also scheitert
`/^([A-Z_]+)=(.*)$/` an jeder Zeile. Die Zeilenende-Falle steht seit dem
2026-08-05 in CLAUDE.md; diesmal in die andere Richtung. Skripte, die
Projektdateien umschreiben, müssen die Zeilenenden erhalten.

**Noch nicht gegen ein echtes Repository gelaufen.** Alle Tests hier fälschen den
Upstream, und die Lehre vom 2026-08-02 gilt unverändert: das beweist, dass wir
senden, was wir uns ausgedacht haben, nie dass das Repository es annimmt. Die
Anfrageform stammt aus einer Messung (`wlo-content-files`, 2026-05-08 gegen prod
und staging; `openapi.json` von Staging, 2026-08-06), aber der Live-Durchlauf
steht aus — er braucht einen von Staging akzeptierten Login.

## Review des Datei-Upload-Pfads — 5 Befunde behoben (2026-08-06)

Zwei MAJOR, zwei MINOR, ein NIT. Beide MAJOR waren Stellen, an denen der Code
gegen den gefälschten Upstream grün war und gegen die Wirklichkeit nicht.

**[MAJOR] Eine `data:`-URL wurde als „kein erkanntes Bild" abgelehnt.** Das ist
die Form, in der ein Modell Bilddaten fast immer liefert — jede Browser-API und
jedes Bildwerkzeug erzeugt sie. Doppelt schlecht: die Funktion scheiterte an
ihrer wahrscheinlichsten Eingabe, und die Meldung zeigte auf den DATEITYP,
während das Problem die KODIERUNG war, also hätte das Modell ein anderes Bild
versucht statt zweiundzwanzig Zeichen zu entfernen. Das Präfix wird jetzt
entfernt, der darin **angegebene Typ aber verworfen** — sonst könnte ein Aufrufer
genau die Nichtübereinstimmung wieder einführen, gegen die die Erkennung da ist.

**[MAJOR] Beim Anlegen ohne URL fehlte `cm:name`.** Die einzige *gemessene*
Anlage eines `ccm:io` ohne `ccm:wwwurl` (Child-IO-Pfad, 2026-05-08 gegen prod und
staging) schickt ihn mit. Wir sendeten weder URL noch Namen — das Repository
hatte nichts, woraus es den Knoten benennen konnte. Kein Test konnte das merken,
weil ein gefälschter Upstream alles annimmt, was wir uns ausdenken. Exakt die
Form des Defekts vom 2026-08-02. Jetzt wird der abgeleitete Dateiname als
`cm:name` gesendet — nur auf dem Datei-Weg; auf dem URL-Weg leitet das Repository
den Namen aus der Adresse ab, und ein Name dort würde einen Pfad ändern, um den
es hier nicht geht.

**[MINOR] Die Base64-Plausibilitätsprüfung war lockerer als das, was sie
modelliert.** Toleranz 4 gegen maximal 2 Zeichen Padding: `not base64 !!!`
re-kodiert genau vier Zeichen kürzer und rutschte durch, gefangen erst von den
Magic Bytes — mit der falschen Meldung. Toleranz jetzt 2.

**[MINOR] Testlücke.** Kein Test benutzte eine `data:`-URL; geprüft wurde
sauberes Base64, nicht das, was ankommt. Genau die Lücke, durch die Befund 1 kam.

**[NIT]** `describeUpload` mischte typografische und gerade Anführungszeichen.

**Belege:** Typecheck Exit 0 · volle Suite **1409/1409** (+7). Gegenprobe für
beide MAJOR: mit entfernter Data-URL-Behandlung und entferntem `cm:name` fallen
drei Tests um (28/31), mit ihnen 31/31.

**Offen und bewusst nicht gebaut:** `wlo_update_content` trägt keinen Datei-Pfad.
Eine Datei an einem BESTEHENDEN Datensatz zu ersetzen ist ein eigener Vorgang mit
eigener Bestätigungssemantik (die alte Fassung verschwindet in der
Versionshistorie) — `uploadContent(nodeId, file)` ist bereits eigenständig, das
Anschließen wäre klein, aber es ist eine Erweiterung der Mutationsfläche eines
vorhandenen Werkzeugs und gehört entschieden, nicht nebenbei gemacht.

## Datei ersetzen an bestehenden Datensätzen — FERTIG (2026-08-06)

`wlo_update_content` nimmt jetzt dieselben Datei-Parameter wie das Anlege-Werkzeug.
Ein Aufruf ändert Metadaten, nur die Datei, oder beides — eine Datei allein zählt
als Änderung, was vorher nicht ging.

**Ersetzen ist nicht Anlegen**, und die Vorschau sagt es: der vorhandene Inhalt
wird ersetzt, die bisherige Fassung bleibt in der Versionshistorie. Dieser Satz
steht in der Änderungsmenge neben Name, Typ, Größe und Prüfsumme der neuen Datei
— der Bestätigungsschlüssel ist also an die neuen Bytes gebunden, genauso wie
beim Anlegen. Belegt: entfernt man `describeUpload` aus der Ersetzen-Aktion,
fallen drei Tests um (12/15), mit ihr sind es 15/15.

Der Dateiname kommt aus dem **gespeicherten** Titel, wenn der Aufruf keinen
ändert. Metadaten-Schreibvorgang und Upload sind zwei getrennte
Repository-Operationen, jede kann für sich scheitern — beide werden berichtet,
nie zu einem Urteil verschmolzen. Der Upload läuft NACH den Metadaten, damit ein
Datensatz, dessen Inhalts-Ersetzung scheitert, wenigstens die Felder trägt, die
ihn beschreiben sollen.

Die Regeln, die entscheiden, ob Bytes hochgeladen werden dürfen — Typerkennung,
Größen, Kodierung, abgeleiteter Name — sind über `resolveFileUpload` **geteilt**,
nicht kopiert. Unterschiedlich ist nur die Frage drumherum: Anlegen braucht eine
Quelle und `url` ist eine davon, an einem bestehenden Datensatz ist `url` ein
gewöhnliches Metadatenfeld und gar keine Datei ein völlig gültiger Aufruf.

**Nebenbei einen Flake wirklich aufgeklärt statt weggewünscht.**
`tools-curation-create-file.test.ts` fiel etwa jeden fünften Lauf um, jedes Mal
an einer anderen Stelle — und ich hatte das gestern als Kollateralschaden
abgetan. Ursache war NICHT der Token-Speicher, sondern mein Test-Helfer:
`/confirmToken[^\w]*(…)/`, und `[^\w]` matcht `-`. Ein base64url-Schlüssel darf
mit `-` beginnen (rund 1 von 64 tut es), der gierige Teil fraß es, und der
eingelöste Schlüssel war einer, den der Speicher nie ausgegeben hatte. Die sechs
älteren Kurations-Testdateien nehmen `-` aus der Klasse aus — ich hatte die
kürzere Form ohne diese Ausnahme hierher kopiert. Zwölf Läufe in Folge grün nach
der Korrektur, und die Begründung steht jetzt dort, wo sie bisher fehlte.

**Belege:** Typecheck Exit 0 · volle Suite **1419/1419** (+10), dreimal in Folge
grün. Der Live-Durchlauf gegen ein echtes Repository steht weiterhin aus.

---

## Themenseiten-Varianten — FERTIG, live gegen beide Instanzen (2026-08-07)

Auslöser: Rückmeldung des WLO-Teams, die Varianten seien „mittlerweile um
Properties angereichert" und über `virtual:page_variant_global` bzw.
`virtual:parent(_recursive)` filterbar. Gemessen statt geglaubt — Analyse,
Zahlen und die repository-seitigen Blocker:
[2026-08-07-topic-page-variants-analysis.md](2026-08-07-topic-page-variants-analysis.md).

**Was von den Hinweisen trägt und was nicht.** `virtual:parent_recursive`
existiert und kann einen Sammlungs-Teilbaum durchsuchen — daraus ist ein neuer
Modus geworden. `virtual:page_variant_global: ['false']` filtert dagegen **gar
nichts** (99 vs. 99 auf Staging, 121 vs. 121 auf Produktion — identisch mit „kein
Kriterium"): das MDS-Statement existiert nur für den Wert `"true"`. Und die
angereicherten Properties sind da, nur überwiegend leer — **98 von 109**
Produktions-Varianten ohne Zielgruppe, **97 von 109** ohne Bildungsstufe.

**Der Befund, der das Paket ausgelöst hat.** `targetGroup` bedeutete in unseren
Modi zweierlei: Modus C reichte ihn an die Suche durch (ungesetzt = raus), Modi
A/B filterten lokal (ungesetzt = bleibt). Auf Produktion war das der Unterschied
zwischen 16 und 20 Seiten. Die Regel liegt jetzt an EINER Stelle
(`variantMatchesFilters`), ungesetzt schließt nie aus, und `docs/TOOLS.md`
behauptet nicht mehr, die Filter beschleunigten den Aufruf.

**Die offene Frage des Teams — welche Variante ist die richtige — ist
beantwortet.** Der page_config-Ordner trägt `ccm:page_config` mit `variants[]`
und `default`; vorhanden auf 99/99 (prod) und 45/45 (staging), und wo `default`
gesetzt ist, immer `variants[0]` (76/76). Die angezeigte Variante steht jetzt
vorn und trägt `isDefault`. Bisher nahmen wir das erste Kind des Ordners — was in
allen 13 gemessenen Mehrfach-Seiten dasselbe traf, aber durch eine Sortierung,
die nichts garantiert.

**Zwei Fehler fand erst der Live-Lauf, keiner davon war mit `fetchMock`
auffindbar.** Eine Sammlung kann MEHRERE page_config-Ordner besitzen: die
Gruppierung nach Ordner lieferte deshalb 19 statt 20 Seiten und listete
„Zukunfts- und Berufsorientierung" dreimal, und jeder Ordner brachte seine eigene
„angezeigte Variante" mit. Behoben durch Auflösen in Wellen bis genug
verschiedene Besitzer beisammen sind (ohne zweite Suche — die Treffer liegen
schon im Speicher) und dadurch, dass nur der vom Besitzer per
`ccm:page_config_ref` benannte Ordner die angezeigte Variante tragen kann.

Damit gilt die Lehre vom 2026-08-02 auch für einen LESENDEN Pfad: ein Test gegen
`fetchMock` beweist, dass wir senden, was wir senden wollten. Über die Form der
Daten im Repository sagt er nichts.

**Belege:** Typecheck Exit 0 · volle Suite **1442/1442** (+18) · zwei Sabotage-
Gegenproben (maxResults-Schranke, Varianten-Sortierung) jeweils rot · Live-Lauf
gegen Produktion UND Staging.

| gemessen live, `maxResults: 20` (prod) | vorher | nachher |
|---|---|---|
| Seiten ohne Filter | 19 | 20 |
| Seiten mit `targetGroup: 'teacher'` | 16 | 20 |
| doppelte Sammlungsnamen unter den ersten 5 | 3× dieselbe | keine |
| Fachportal Physik: `collectionId` → `withinCollectionId` | 1 | 20 (durch `maxResults` begrenzt) |

**Offen — BEIDES am 2026-08-09 behoben, siehe „Die zwei zurückgestellten
Themenseiten-Befunde" am Ende dieser Datei.** Der Stand von damals:

Auf Staging tragen 22 von 68 Varianten ein `cclom:title` der Form
`PAGE_VARIANT_<uuid>`; für den Eintragstitel fängt `pickThemePageTitle` das ab,
im `variantTitle` von `get_topic_page_content` nicht. Auf Produktion tritt das
nicht auf (0 von 109). Die Prüffunktion liegt in `tools/shared.ts` und dürfte
von den tieferen Schichten aus nicht importiert werden — sie zu verschieben wäre
ein eigener Schnitt. (Genau dieser Schnitt ist jetzt gemacht:
`src/topic-page-title.ts`. Die Vermutung „nur `get_topic_page_content`" war zu
eng — betroffen waren zusätzlich `topic-page-api.ts` und, am schwersten, die
Bestätigungs-Vorschau von `wlo_set_topic_page`.)

`search_wlo_topic_pages` meldet unauflösbare Vokabular-Filter nicht: ein
`educationalContext`, den `resolveVocab` nicht auflöst, wird als Rohtext gegen
URIs verglichen, trifft nie, und lässt nur die kontextlosen Varianten übrig —
ohne Hinweis. Andere Suchwerkzeuge nutzen dafür `formatUnresolvedHint`.
(Behoben; zusätzlich meldete `_queryMeta` den verworfenen Filter weiter als
angewandtes Kriterium.)

## Review-Runde über das Themenseiten-Paket — 7 Befunde behoben (2026-08-07)

Ein MAJOR, fünf MINOR, ein NIT — alle aus dem eigenen Paket, alle behoben.

**Der MAJOR war eine Lücke, die genau dort saß, wo das Paket seinen Zweck hat.**
Besitzt eine Sammlung mehrere page_config-Ordner, werden diese unabhängig
aufgelöst — kommt der überholte Ordner zuerst aus der Suche, stand seine Variante
im zusammengefassten Eintrag vorn. `includeContent` löst `variants[0]` auf, hätte
also die **überholte** Fassung der Seite gerendert, und die Werkzeugbeschreibung
verspricht ausdrücklich das Gegenteil. `enrichPage` sortierte korrekt innerhalb
einer Gruppe; über Gruppen derselben Sammlung hinweg sortierte niemand.
`mergeThemePages` stellt die angezeigte Variante jetzt voran. Reproduziert vor
der Behebung, danach erneut geprüft.

Der Rest: `targetGroup` trug in Modus A/B die deutsche Zeichenkette
„nicht gesetzt" im **Maschinenfeld**, in Modus C/D `''` — jetzt überall `''`, die
Beschriftung entsteht in der Präsentationsschicht. `_queryMeta.criteria` führte
`ngsearchword` auch dann auf, wenn der Modus die Suchanfrage verworfen hatte —
die Kriterien folgen jetzt dem tatsächlich gewählten Modus. Der Owner-Cache
(`TopicPageOwnerCache`, `parentCache`) war durch die Gruppierung tot und ist
entfernt; `resolveVariantCollection` schrumpft damit auf den Rückfallweg, für den
es noch gebraucht wird. Die Suchgrenze von 300 Varianten meldet sich jetzt per
`log.warn`, statt Vollständigkeit vorzutäuschen. Und der JSDoc zu `isDefault`
nannte die Ordner-Bedingung nicht, die im Code steht.

**Korrektur einer eigenen Falschaussage:** der Absatz oben behauptete,
`educationalContext` wirke in Modus B weiterhin gar nicht. Das stimmt nicht — der
Filter fließt seit diesem Paket durch (`collectThemePages` →
`findTopicPagesByQuery(query, filters)` → `getCollectionThemePages(cId, filters)`
→ `variantMatchesFilters`). Er greift auf Varianten-Ebene, nicht bei der Auswahl
der Kandidaten-Sammlungen, und schränkt wegen der leeren Felder kaum ein — aber
er ist verdrahtet. Ich hatte den Zustand von VOR der Änderung fortgeschrieben.

**Ein achter Befund kam beim Nachmessen des MAJOR-Fixes dazu — wieder nur live
sichtbar.** Die Sortier-Korrektur greift nur, wenn die angezeigte Variante
überhaupt in der Liste steckt. Für „Zukunfts- und Berufsorientierung" steckt sie
nicht drin: die Sammlung hält mehrere page_config-Ordner, der aktive liegt in der
Gruppen-Reihenfolge hinter der Stelle, an der die Wellen abbrechen (20
verschiedene Besitzer beisammen). Die Variante ist in den 109 Suchtreffern
enthalten, sie wird nur nie ausgewählt. Ohne markierten Default nahm
`includeContent` einfach `variants[0]` — also eine überholte Kopie.

Behoben ist der **Schaden**: `includeContent` übergibt nur noch eine Variante,
von der bekannt ist, dass die Seite sie rendert; sonst gar keine, und
`getTopicPageContent` läuft die belastbare Kette Sammlung →
`ccm:page_config_ref` → `ccm:page_config.default`. Live geprüft: für genau diese
Seite wird jetzt `9b24debf` aufgelöst, die eingetragene Default-Variante.

**Offen und bewusst nicht mitgemacht — eine Design-Frage, keine Mechanik:** die
Variantenliste dieser Seite bleibt unvollständig (sie zeigt vier überholte
Kopien, nicht die gerenderte). Zwei Wege stehen zur Wahl: entweder liefert
`enrichPage` die Varianten des vom Besitzer benannten AKTIVEN Ordners aus der
bereits geladenen Gruppenkarte — dann verschwinden die überholten Kopien aus der
Auflistung — oder die Wellenschleife löst für jeden Besitzer zusätzlich dessen
aktiven Ordner auf, was Vollständigkeit gegen Aufrufe tauscht. Die erste Variante
widerspricht der bisher dokumentierten Zusage, überholte Ordner weiter zu
listen; das ist eine Entscheidung, keine Korrektur. Betrifft live 1 von 20
Seiten.

**Belege:** Typecheck Exit 0 · volle Suite **1453/1453** (+11) · zwei
Sabotage-Gegenproben (Merge-Reihenfolge, Kriterien-Ableitung) jeweils rot · drei
Live-Läufe gegen Produktion: falsch sortierte Einträge **0**.

---

## Skill-Abruf: zwei Werkzeuge, Inhaltsart-Filter, Begleitdateien (2026-08-08) — FERTIG

`find_wlo_skills` ist ersetzt durch **`search_skill`** (Katalog: nodeId, Titel,
Beschreibung, Keywords — ohne Anleitungstext) und **`get_skill`** (die angehängte
SKILL.md zu einer nodeId). `WLO_SKILL_TOOL_MODE=one-tool` tauscht beide gegen
`get_skill_for_task`, das selbst wählt und lädt — die Variante existiert, um
gegen den Standard gemessen zu werden. Lesende Tools 26 → 27.

**Was einen Datensatz zum Skill macht, ist jetzt seine Inhaltsart**
(`ccm:oeh_extendedType = …/contentTypes/ai_prompt`), nicht sein Ablageort.
Gemessen auf beiden Instanzen: das Feld ist indiziert und facettierbar, das
Kriterium schränkt ein (110 von 403 431 für `organization`), mehrere Werte werden
ODER-verknüpft (110 + 42 = 152), und es UND-verknüpft mit `ngsearchword`. Es
braucht die volle URI; der Kurz-Slug trifft nichts. **Kein `ai_prompt`-Datensatz
existiert bisher** — der Filter ist bewiesen, seine Wirkung auf echte Skills
nicht.

Beide Werkzeuge sind damit **bedingungslos registriert**;
`WLO_SKILLS_COLLECTION_ID` grenzt nur noch ein. Die Eingrenzung läuft als
Unterbaum-Lauf, weil `ngsearch` `virtual:parent_recursive` mit 400 ablehnt (die
`page_variant`-Abfrage akzeptiert es — `ngsearch` nicht).

**Vier Messungen, die Entscheidungen erzwungen haben:**

1. `ngsearch` liefert **überhaupt keine Sammlungen** (`FOLDERS` → 0, `ALL` → nur
   `ccm:io`); der Sammlungs-Endpunkt kann **nur** Stichwort, jedes andere
   Kriterium → 400. Ein Skill als Sammlung wäre unauffindbar. Deshalb `ccm:io`.
2. Der Unterbaum-Lauf war sequenziell: **90,3 s** über ein Fachportal. Ebenenweise
   im Pool: 8,1 s. Die dokumentierte Struktur (Wurzel + 12 Skillsets) kostet
   **2,4 s in zwei Wellen**; eine genannte Sammlung ohne Untersammlungen **1
   Aufruf / 0,8 s** gegen 60 Aufrufe / 12,9 s mit.
3. Begleitdateien: Ordner-Auflistung kostet 0,2–0,4 s bei einem echten
   Skill-Ordner, aber 1,7–20,6 s bei WLO-Sammelordnern (484–3744 Dateien), einer
   von sechs verweigert anonym. Daher die Grenze von 25 Dateien.
4. Eine **Referenz** liefert denselben Download wie ihr Original (200, identische
   3466 Bytes) — der Textabruf braucht `ccm:original` nicht, die Ordnersuche
   schon.

**`ccm:original` ist Teil der Identität:** jeder Treffer trägt `originalId`,
`search_skill` dedupliziert darüber, und bei Original + Referenz gewinnt das
Original. `get_skill` löst zusätzlich die `:::`-Blöcke der SKILL.md
(`wlo-material`, `ki-skill`) zu `references` samt nodeId auf — das Modell muss
keine ID aus einer URL herausklauben, und welche ID wozu gehört, unterscheidet
sich je Blocktyp.

**Review-Runde: 9 Befunde, 8 behoben, 1 durch Messung widerlegt.** Die drei
MAJOR: der Ein-Tool-Modus verwies auf ein dort nicht registriertes `get_skill`;
das Datei-Manifest schickte auch Binärdateien durch den Rohdownload (DOCX als
dekodiertes ZIP); und der Lauf konnte stumm abschneiden, wenn die Besuchsgrenze
alle Kinder der letzten gelesenen Ebene verwarf. Widerlegt: der vermutete Defekt
beim Textabruf über eine Referenz-ID (Messung 4 oben).

**Belege:** Typecheck Exit 0 · Build Exit 0 · volle Suite **1497/1497** (+28) ·
jeder neue Test vorher rot gesehen · Live-Gegenproben gegen Staging und
Produktion wie oben.

**Offen — bewusst nicht mitgemacht:**
- Kein `ai_prompt`-Datensatz existiert; nichts ist gegen echte Skill-Inhalte
  gelaufen. Das ist die Sorte Nachweis, die bei den Themenseiten vier Defekte
  fand, die kein Mock sah.
- `search_skill` bietet **keine** `discipline`/`educationalContext`-Filter. Die
  Messung dafür liegt vor (`ai_prompt AND taxonid=Physik` funktioniert:
  9878 → 9877 mit Inhaltsart), gebaut ist es nicht — es ist die Entscheidung
  „taggen statt platzieren", nicht eine Korrektur.
- Serienobjekte (`ccm:childio`) als Alternative zum Ordner: die vermutete
  6-Dateien-Grenze ist **nicht gemessen** (bräuchte einen Schreibversuch auf
  Staging).
- Redaktions-Anleitung: `docs/SKILLS.md`.

## Use-Case-Lücken: Lizenzfilter, Usage, Themenseiten-Variante (2026-08-09) — FERTIG

Plan: `docs/plans/2026-08-09-usecase-gap-tools.md` (Design + Aufgaben in einer
Datei). Drei Pakete, davon eines bewusst **nicht** gebaut.

### P1 — Lizenzfilter (`search_wlo_content`, `search_wlo_all`, `search_wlo_within_collection`, `/api/search`)

Ein `license`-Parameter, der ein Label („CC BY 4.0", „gemeinfrei") ebenso nimmt
wie den Repository-Schlüssel (`CC_BY`). Aufgelöst in `buildFilterCriteria`, also
für beide Suchwerkzeuge, den `searchAll`-Service und die REST-Schicht auf einmal.

**Vier Messungen, die der Entwurf nicht hatte:**

1. Der Schlüssel trifft eine **Familie**, keine Lizenz: `CC_BY` liefert für
   „Optik" 343 Treffer inklusive CC BY-ND, CC BY-NC-SA und CC BY-NC-ND;
   Anführungszeichen ändern nichts. Genau die eine Lizenz, nach der jemand
   filtert, der bearbeiten will, ist upstream nicht isolierbar — und die Zugabe
   ist **restriktiver** als das Gewünschte. Exaktheit deshalb lokal
   (`filterByExactLicense`).
2. Der lokale Pass **verhungert ohne Vorrat**: der erste Live-Lauf gab 0 Treffer
   für CC BY 4.0, weil in der Zehnerseite aus jenen 343 kein exakter Datensatz
   stand. `pageSizeForLicense` weitet das Kandidatenfenster auf 50 — nur bei
   gesetztem Lizenzfilter, weil nur dort der Überschuss systematisch ist.
3. Eine **Menge** von Lizenzen ist upstream nicht ausdrückbar: zwei Werte an
   `ccm:commonlicense_key` → 400 `DAOValidationException`, das Kriterium zweimal
   → UND (343 + 110 → 110), „A OR B" als Wert → 0. Das ODER, das an
   `ccm:oeh_extendedType` gemessen war, überträgt sich **nicht** — die Annahme
   hatte einen 400 ausgeliefert, den jeder Test grün gesehen hatte. Das
   OER-Bündel (`CC_0`, `PDM`, `COPYRIGHT_FREE`, `CC_BY`, `CC_BY_SA`) schickte
   deshalb zunächst gar kein Kriterium und filterte vollständig lokal
   (**überholt** — siehe „Nachtrag OER-Anteil + zwei Defekte im Lizenz-Bündel"
   weiter unten: genau das war der Defekt, das Bündel fächert heute über seine
   fünf Schlüssel). Auf `CC_BY` zu
   verengen hätte beide CC-Mitglieder behalten und jedes gemeinfreie Material
   verloren — der Live-Lauf zeigte sofort ein „Urheberrechtsfrei"-Material.
4. Ein **geleertes** Ergebnis muss den Grund nennen: „Optik" + CC BY-NC 4.0
   meldet 172 Backend-Treffer und liefert keinen. `licenseFilterNotice` nennt
   jetzt die Zahl der geprüften Kandidaten und warum die Gesamtzahl abweicht.

**Bekannte Schwäche — noch am selben Tag BEHOBEN, nicht mehr offen:** Weil das
Bündel nicht vorfilterte, hing seine Ausbeute daran, wie viel OER zufällig in den
50 Kandidaten lag — zwei identische Läufe gaben 4 bzw. 1 Treffer. Die hier als
„sauber, aber nicht einseitig entschieden" vermerkte Fächerung über die fünf
Schlüssel ist gebaut (`src/services/license-search.ts`) und live gemessen; die
Schwankung war zudem stark untertrieben (Mathematik: 0 von 50 exakten Treffern
über 18 793 vorhandene). Belege im Nachtrag weiter unten.

### P2 — `wlo_register_usage`: NICHT gebaut, das Repository lässt es nicht zu

Aufgabe 1 des Pakets war als Gate geschrieben, und das Gate schloss. Gemessen als
angemeldeter Dienstnutzer (`WLO-Upload`), Skripte `probe-usage.mjs` /
`probe-usage2.mjs`:

| Anfrage | Antwort |
|---|---|
| voller Body, `appId: local` | 403 `app signature required to use this endpoint.` |
| Body nur `{ nodeId }` | 403, gleiche Meldung |
| **leerer Body** `{}` | 403, gleiche Meldung |
| `appId` ∈ {`-home-`, `local`, 3 registrierte} | 403, gleiche Meldung |
| alle vier `X-Edu-App-*`-Header, Signatur erfunden | **500 `Signature could not be verified!`** |
| dasselbe mit **registrierter** App-ID | **500**, identisch |

Die identische Antwort auf einen **leeren Body** legt das Gate vor das Lesen des
Bodys — es gibt keine Body-Form, die durchkommt. Und der 500 bei vorhandenen,
falschen Headern zeigt: die Signatur wird wirklich geprüft, es braucht den
**privaten Schlüssel einer am Repository registrierten Anwendung**. Kein
Seitenweg: `prepareUsage` antwortet 200, liefert die Node-Metadaten und
hinterlässt keine Usage. Die Leseseite (`GET /usage/v1/usages/node/{id}`)
funktioniert ohne all das und ist überall leer (auch drei echte
Redaktions-Datensätze: `usages=0`).

Einen solchen Schlüssel zu bekommen ist keine Code-Änderung: eine
edu-sharing-App-Signatur erlaubt ihrem Halter, **für beliebige Nutzer** zu
handeln — genau deshalb ist der Endpunkt darauf gegated. Das kehrt die
Auth-Entscheidung dieses Servers um („es gibt kein Token zum Weiterreichen;
nichts Mächtigeres als das eigene Konto liegt bei uns"). Betreiber-Entscheidung.

### P3 — `wlo_set_topic_page`: FERTIG, live gegen Staging

Das 14. Kurationswerkzeug und das einzige, dessen Ergebnis **sofort öffentlich**
ist: es setzt `default` im `ccm:page_config`-Dokument, das entscheidet, welche
Variante eine Themenseite rendert. Es legt keine Varianten an, löscht und
sortiert keine.

**Gate-Messung (28 echte page-config-Ordner, Staging):** Das Dokument ist
kleiner als der Leser vermuten lässt — `variants` 28/28, `default` **2/28**, kein
weiterer Schlüssel. Varianten stehen als volle Store-Refs
(`workspace://SpacesStore/…`), nicht als nackte UUIDs. Beide Schreibwege
funktionieren (`PUT /metadata?obeyMds=false` und `POST /property`, je 200 mit
wortgleichem Rücklesen).

**Und der Befund, der das Design bestimmt: das Repository prüft nichts.**
`POST …/property?property=ccm:page_config` speicherte die Zeichenkette
`"not json at all"` und antwortete 200; die Eigenschaft wurde auch auf einem
`ccm:io` angenommen, der nie ein page-config-Ordner ist. Ein kaputtes Dokument
fällt nicht hier auf, sondern im Page-Builder, auf einer öffentlichen Seite.
Daher liegt jede Zusage bei uns:

- Das gespeicherte Dokument wird **bearbeitet, nie gebaut** (`setDefaultVariant`):
  unbekannte Schlüssel und `variants[]` überleben unangetastet.
- `default` wird als Store-Ref geschrieben (`toStoreRef`, die Umkehrung des
  `stripStoreRef`, das jede Leseseite anwendet).
- Eine Variante, die kein nutzbares Kind **dieses** Ordners ist, wird abgelehnt;
  eine **nicht lesbare** Kinderliste wird als nicht lesbar abgelehnt, nicht als
  „gibt es nicht".
- Ein unlesbares Dokument wird nicht überschrieben.
- Das Rücklesen vergleicht das **geparste** Dokument — ein Repository, das alles
  speichert, beweist mit zurückgegebenen Bytes nichts.

Der Bestätigungsschlüssel bindet an den **Satz**, der Seite und beide Varianten
mit IDs nennt, nicht an den Property-Wert: ein Dokument aus Store-Refs kann
niemand in einer Vorschau prüfen. Jede Änderung upstream, die das Ergebnis
verschiebt, plant zu einem anderen Satz und entwertet den Schlüssel.

**Live-Lauf** (`live-topic-page.mts`) auf einer Themenseite, die das Skript
selbst anlegt und löscht — redaktionelle Seiten wurden nicht angefasst:
Vorschau → Bestätigen → `default` auf B, `variants[]` unverändert; fremde
Variante abgelehnt mit Auflistung der beiden echten, Dokument unverändert;
Rückschalten auf A ersetzt statt anzuhängen; `get_topic_page_content` liest das
Ergebnis über den normalen Weg.

**Was erst der Live-Lauf fand:** Eine Variante mit `ccm:page_variant_config` über
den `children`-Aufruf anzulegen verliert die Eigenschaft still — `obeyMds` steht
per Vorgabe auf true. Der erste Lauf baute damit zwei Varianten, die das Werkzeug
korrekt als unbrauchbar ablehnte. Fehler in der Probe, nicht im Produkt; die
Ablehnung war richtig.

**Belege:** volle Suite **1560/1560** (+25) · Typecheck Exit 0 · Build Exit 0 ·
jeder neue Test vorher rot gesehen · Live gegen Staging wie oben. Drei bestehende
Zähler-Tests (`server.test.ts`, `tools-curation-gating.test.ts`,
`apps-tool-defaults.test.ts`) schlugen beim ersten Lauf an — sie fanden den
fehlenden `toolInvocation`-Status.

### Review-Runde über P3 — 3 Befunde, alle behoben (2026-08-09)

Kein kritischer, kein Major. Die Leitfrage war „schreibt es je etwas Kaputtes auf
eine öffentliche Seite?" — die Wege einzeln durchgegangen und keinen gefunden:
Die Variantenliste kann nicht verlorengehen, `default` nicht auf Nichtexistentes
zeigen (die Variante muss *sowohl* in `variants[]` stehen als auch nutzbares Kind
sein), ungültiges JSON nicht entstehen. Das Rücklesen ist eine echte Anfrage —
`wlo-node.ts`/`wlo-fetch.ts` haben keinen Cache, der es entwerten könnte. Ein
Schlüssel von Seite X bestätigt Seite Y nicht: der Fingerabdruck deckt `nodeId`
(den Ordner) und den Satz ab, der die Sammlung nennt.

1. **MINOR — der No-Op fehlte.** Wer die bereits aktive Variante setzt, bekam
   eine Vorschau „rendert künftig „B" statt „B"" und danach einen überflüssigen
   Schreibvorgang auf genau das Dokument, das eine öffentliche Seite steuert. Die
   anderen zwölf Werkzeuge haben das Problem nicht, weil `buildChangeSet`
   unveränderte FELDER verwirft — hier gibt es kein Feld. Behoben mit zwei Tests,
   die auch die Abgrenzung festhalten: Ist gar kein `default` gesetzt, rendert
   die Seite `variants[0]` der Position wegen, und dieselbe Variante explizit
   festzuschreiben ist eine echte Änderung — der einzige Aufruf, der das Rendern
   einer Seite stabil macht. Live gegengeprüft.
2. **MINOR — `VARIANT_PAGE = 50` kann still abschneiden.** Jenseits davon würde
   eine Variante als „gehört nicht zur Themenseite" abgelehnt, also mit dem
   falschen Grund. Nicht auf dieser Ebene zu erkennen:
   `getChildCollectionsResult` verwirft die `pagination` der Antwort. Als
   bekannte Grenze am Konstanten-Kommentar festgehalten statt vorgetäuscht
   geschlossen; praktisch tragen 93 von 99 Produktionsseiten genau eine Variante.
3. **NIT — Node-ID roh im Ablehnungstext.** In der „Verfügbar:"-Liste lief der
   Titel durch `sanitizeText`, die ID nicht — und anders als der Vorschau-Satz
   wird diese Zeichenkette nicht durch `flattenText` gereicht. Jetzt beide.

Als Beobachtung festgehalten, nicht als Befund: Es gibt kein optimistisches
Sperren. Zwischen dem planenden Lesen und dem Schreiben liegt ein Fenster, und
die Property-Route bietet kein ETag — eine in diesem Moment hinzugefügte Variante
ginge verloren. Steht jetzt im Modul-Kommentar.

**Belege nach den Korrekturen:** volle Suite **1562/1562** (+2) · Typecheck
Exit 0 · Build Exit 0 · Live-Lauf gegen Staging erneut, inklusive der neuen
No-Op-Ablehnung.

### Nachtrag OER-Anteil + zwei Defekte im Lizenz-Bündel (2026-08-09)

Anlass war eine Frage des Betreibers: „nur 7–10 % der Inhalte sind OER — wenn
sich das mit deinen Daten deckt, ist es ok." Es deckt sich nicht, und beim
Nachmessen fielen zwei Defekte auf, die jeder Test grün gesehen hatte.

**Das Instrument.** `ngsearch` nimmt einen `facets`-Parameter und zählt die
exakten Schlüssel **serverseitig über die ganze Treffermenge**. Der erste Versuch
schickte sie als blanke Strings und bekam keinen Facettenblock — das sah aus wie
„die Instanz kann das nicht", war aber das falsche Format (die Signatur nimmt
`string[]` und baut selbst `{property}`). Eine Stichprobe der ersten 100 Treffer
ist kein Ersatz: Rangfolge und Lizenz haben nichts miteinander zu tun.

**Der Anteil (Facetten, 2026-08-09):**

Staging steht voran — dorthin zeigt `WLO_REPOSITORY_URL` per Vorgabe, und es ist
der größere Bestand:

| | Staging | Produktion |
|---|---|---|
| Datensätze gesamt | **403 431** | 318 696 |
| davon mit Lizenzangabe | 297 462 | 230 496 |
| OER (CC0, PDM, urheberrechtsfrei, CC BY, CC BY-SA) | **31,5 %** aller / 42,8 % der ausgezeichneten | **34,4 %** / 47,6 % |
| nur CC/PD (ohne `COPYRIGHT_FREE`) | 28,4 % | 28,8 % |
| ohne jede Lizenzangabe | **105 969 (26,3 %)** | 88 200 (27,7 %) |

Je Anfrage schwankt es stark: Produktion von 8,4 % (Klimawandel) bis 64,9 %
(Optik). 7–10 % trifft einzelne Themen, nicht den Bestand. Datensätze ohne
Lizenzangabe zählen als nicht-OER — eine fehlende Angabe ist kein Beleg für eine
freie Lizenz.

**Defekt 1 — das Bündel antwortete „kein Treffer" über 18 793 Treffern.** Weil
eine Lizenz-MENGE upstream nicht ausdrückbar ist, schickte die erste Fassung gar
kein Kriterium und filterte die generische Ergebnisseite lokal. Gemessen:
`Mathematik` hat auf Staging 18 793 Datensätze mit OER-Lizenz (41,9 % der
ausgezeichneten) — das Werkzeug lieferte **null**. Die ersten fünfzig nach
Relevanz trugen überhaupt keinen `ccm:commonlicense_key` (50/50 fehlend in der
rohen Suche; über `enhancedSearch` 23× CC BY-NC-SA + 2× CUSTOM). Das ist kein
schwacher Filter, das ist ein falscher. Die früher berichtete „schwankende
Ausbeute" hat es deutlich untertrieben.

Jeder Schlüssel für sich verengt upstream sehr wohl. Das Bündel **fächert jetzt
über seine fünf Schlüssel** (`src/services/license-search.ts`) — fünf Anfragen
statt einer, und nur für das Bündel.

| Anfrage | geprüfte Kandidaten | mit exakter OER-Lizenz |
|---|---|---|
| Mathematik | 50 → **152** | 0 → **127** |
| Optik | 40 → **140** | 2 → **107** |
| Musik | 25 → **104** | 0 → **102** |
| Klimawandel | 50 → **97** | 0 → **94** |

**Defekt 2 — und der fiel erst im Live-Lauf auf.** Die fünf Ergebnismengen
aneinanderzuhängen gibt die ganze Ergebnisgrenze dem erstgenannten Schlüssel:
`Mathematik` + OER lieferte sechs Treffer, **alle CC 0** — dem seltensten der
fünf (191 Datensätze) — während die 11 563 CC BY-SA nie auf die Seite kamen. Es
gibt keine Rangfolge ÜBER die fünf Mengen hinweg, also ist Round-Robin die
einzige faire Zusammenführung: jeder Schlüssel steuert seinen besten Treffer bei,
bevor einer seinen zweiten beisteuert. Danach tragen dieselben sechs Treffer CC 0,
Public Domain Mark, Urheberrechtsfrei, CC BY 4.0 und CC BY-SA 4.0.

Beide Defekte waren für `fetchMock` unsichtbar — der erste, weil der Mock
antwortet, was der Test beschlossen hat, der zweite, weil kein Test danach fragte,
wie die ausgelieferte Seite ZUSAMMENGESETZT ist.

**Belege:** volle Suite **1573/1573** (+11) · Typecheck Exit 0 · Build Exit 0 ·
Live gegen Staging vor und nach jeder der beiden Korrekturen.

### Review-Runde über den Lizenzfilter — 3 Befunde, alle behoben (2026-08-09)

Selbstprüfung der Änderungen, die nach der P3-Review entstanden waren. Alle drei
waren für `fetchMock` unsichtbar und wurden live gegen Staging belegt.

**Befund 1 — die gemeldete Gesamtzahl zählte dieselben Datensätze mehrfach.**
Die Fächerung addierte die fünf `pagination.total`. `ccm:commonlicense_key`
trifft aber eine FAMILIE, und die Familie `CC_BY` **enthält** `CC_BY_SA`:

| Anfrage | Fächerung meldete | wahr (exakte Facette) | Überzählung |
|---|---|---|---|
| Optik | 575 | 274 | +110 % |
| Mathematik | **37 851** | **14 343** | +164 % |
| Musik | 4 401 | 2 218 | +98 % |

Beleg für die Verschachtelung: Mathematik Familie `CC_BY` = 27 351, exakt
`CC_BY` = 3 848, exakt `CC_BY_SA` = 9 554 — die Familie fasst beide. Obendrein
trägt sie die NC/ND-Datensätze, die gar kein OER sind. Eine EINZELNE Lizenz hatte
denselben Defekt eine Nummer kleiner: Optik + CC BY meldete die 343 der Familie
über einer Liste von 42.

Die Zahl kommt jetzt aus einer Facetten-Aggregation, die EXAKTE Schlüssel
serverseitig über die ganze Treffermenge zählt (`exactLicenseTotal`) — eine
zusätzliche Anfrage, und nur wenn überhaupt nach Lizenz gefiltert wird. Die
Eimer werden über `resolveVocab` zugeordnet, dieselbe Auflösung, die
`filterByExactLicense` auf einen Datensatz anwendet. Das ist kein Detail: Staging
führt `CC BY-SA` **mit Leerzeichen** als eigenen Schlüssel (Optik 6, Musik 1), und
ein wörtlicher Vergleich zählte diese Datensätze als keines von beidem, während
der Filter sie behält. Zähler und Liste gehorchen so einer Regel.

Live nach der Korrektur, gegen eine unabhängig gerechnete Facette:

| Anfrage | gemeldet | Gegenprobe | Differenz |
|---|---|---|---|
| Mathematik + OER | 14 343 | 14 343 | 0 |
| Optik + OER | 280 | 274 + 6 (`CC BY-SA`) | 0 |
| Musik + OER | 2 219 | 2 218 + 1 | 0 |
| Optik + CC BY 4.0 | 42 | 42 | 0 |
| Mathematik + CC BY-SA 4.0 | 9 554 | 9 554 | 0 |

**Befund 2 — `search_wlo_within_collection` filterte das OER-Bündel überhaupt
nicht.** Dieser Pfad prüft Filter LOKAL gegen die Kinder der Sammlung. Eine
einzelne Lizenz kommt dort als Kriterium an und wird exakt verglichen; das Bündel
liefert aber gar kein Kriterium (eine Lizenz-MENGE ist upstream nicht
ausdrückbar), und eine eigene Exaktheitsprüfung fehlte. `license: "OER"` gab
also alles zurück — CC BY-NC-ND eingeschlossen und Datensätze ganz ohne
Lizenzangabe. Live nach der Korrektur: 44 → 42 (NC-ND, NC-SA fallen), 10 → 9
(`COPYRIGHT_LICENSE` fällt).

**Befund 3 — ein Totalausfall meldete „0 Treffer".** Scheiterten alle fünf
Anfragen, war das Ergebnis leer und von „es gibt kein frei nachnutzbares Material
zu diesem Thema" nicht zu unterscheiden. Eine fehlende Antwort wirft jetzt, wie
in jedem anderen Suchpfad. Der Ausfall EINER Lizenz wird weiterhin getragen.

Mit der Korrektur zu Befund 2 kam ein viertes Loch: die neue Lizenzprüfung kann
das Sammlungs-Ergebnis für sich allein leeren, und der bestehende Hinweis hätte
den Aufrufer dann eine Ebene tiefer geschickt, während das Material genau dort
liegt — unter einer Lizenz, nach der er nicht gefragt hat. Der Pfad rendert jetzt
denselben `licenseFilterNotice` wie die Suche (live: „5 von 7 geprüften Treffern
… entfernt"). Bei einer EINZELNEN Lizenz feuert er dort nicht, und das ist
richtig: das Kriterium ist auf diesem Pfad schon exakt, die zweite Prüfung
verwirft nichts.

Mit korrigiert: der sichtbare Hinweis behauptete, die Gesamtzahl nenne „alle
Treffer der Suche". Die erste Neufassung sagte „serverseitig gezählt" — das war
auf dem Sammlungs-Pfad wieder falsch, weil dort lokal über das geprüfte Fenster
gezählt wird. Der Satz sagt jetzt nur, was auf beiden Pfaden gilt.

**Belege:** volle Suite **1581/1581** (+7) · Typecheck Exit 0 · live gegen
Staging vor und nach jeder der Korrekturen.


## OAuth — T5.3 Review über den gesamten Diff (2026-08-09)

Die letzte offene Aufgabe des OAuth-Plans, die keinen Client braucht. Geprüft:
10 Module, ~1 230 Zeilen (`auth/oauth-authorize|codes|clients|metadata`,
`auth/access-issue`, `rest/oauth-pages|consent|token|http`, `apps/tool-defaults`)
plus die Einbindung in `http-app.ts` und die Einwilligungsseite, in drei
Sitzungen à ≤ 400 Zeilen.

**1 schwerer Befund, 2 Kleinigkeiten — alle behoben.**

**[MAJOR] Ein Zugangsblock hatte keine Längengrenze, und der Code-Speicher hält
ihn.** `decodeAccessToken` prüfte die Form, nicht die Größe. Gemessen: ein Block
mit 1-MB-Füllfeld misst 1 333 836 Zeichen und **dekodiert** — `validatePayload`
wirft das Zusatzfeld nur aus dem ERGEBNIS, die Zeichenkette behält der Aufrufer.
`/oauth/authorize` legt sie in den Code-Speicher, der 1 000 Einträge begrenzt und
deren Größe nicht; der Körper darf 4 MiB haben. Wer ein gültiges WLO-Konto hat,
konnte damit bis zu 4 GB für 60 Sekunden binden. `MAX_BLOCK_CHARS = 4096` sitzt
jetzt in `decodeAccessToken` — der einen Stelle, durch die Einfüge-Route,
`Bearer`-Kopf und OAuth-Einwilligung alle gehen.

Gegenprobe (rot-grün): Grenze entfernt → genau dieser Test fällt, die übrigen 13
bleiben grün; Grenze zurück → 14/14. Maße: echter Block **573** Zeichen lokal,
**605** gegen den öffentlichen Schlüssel der laufenden Instanz (RSA-2048).

**[NIT] `/oauth/register` wurde per Ausschluss erreicht** — ein künftiger Eintrag
in `ROUTES` ohne eigenen Zweig wäre stillschweigend zur Client-Registrierung
geworden. Jetzt ein benannter Pfadvergleich, sonst `false`.

**[NIT] Zwei Log-Stellen** nannten den WLO-Benutzernamen roh, vier andere durch
`sanitizeText`. Kein Loch — der Logger kodiert mit `JSON.stringify` —, aber eine
Regel, die an vier von sechs Stellen gilt, liest sich als optional.

**Ausdrücklich geprüft und sauber:** PKCE-Pflicht in einer Fassung für GET und
POST · keine Weiterleitung bei Ablehnung · zeichengenauer Rückleitungsvergleich
mit dokumentierter Loopback-Lockerung (Userinfo auch beim Einlösen abgewiesen) ·
Code vor jeder Prüfung entfernt · konstantzeitiger PKCE-Vergleich · `state`
durchgereicht, „abwesend bleibt abwesend" · Herkunft nur aus
`WLO_PUBLIC_BASE_URL`, aus `Host` nur unter `TRUST_PROXY` · kein Block, kein
Code, kein Token in irgendeinem Log · Client-Name per `textContent` gesetzt,
CSP `default-src 'none'` mit `form-action 'none'` · CORS-Ausnahme für
`/oauth/authorize` samt belegter Begründung für die übrigen Pfade.

**Zwei Beobachtungen, bewusst NICHT behoben** (nicht gemessen, also keine
Befunde): die ganze OAuth-Fläche teilt den engen Eimer
(`API_RATE_LIMIT_RPM` = 30/min je Adresse) mit `/api/*` und `/auth*`, wobei vier
Anfragen je Anmeldung von der Client-Adresse kommen; und der auf der
Einwilligungsseite gezeigte Client-Name ist bei offener Registrierung frei
wählbar — die Seite nennt daneben die Ziel-Herkunft, was die übliche
Gegenmaßnahme ist, und der Entwurf benennt das Restrisiko.

**Belege:** volle Suite **1583/1583** (+2) · Typecheck Exit 0 · rot-grün für den
schweren Befund einzeln nachgewiesen · Blockgröße gegen die laufende Instanz
gemessen.


## Die offengelassenen Beobachtungen abgearbeitet (2026-08-09)

Beide Review-Runden hatten Punkte als „Beobachtung" oder „bekannte Grenze"
stehen lassen. Auf Ansage der Betreiberin sind sie jetzt alle behoben — fünf
Änderungen, jede mit einem vorab roten Test.

1. **`search_wlo_all` filterte nach Lizenz, ohne es zu sagen.** Der dritte
   Suchpfad mit `license`, und der letzte, der still verwarf. Die Hülle trägt
   jetzt `content.licenseFilter {checked, kept}` (auch über REST), das Werkzeug
   rendert denselben Hinweis wie die beiden anderen Pfade. Weder `count` (nach
   der Ergebnisgrenze) noch `total` (Korpuszahl) konnte dafür einspringen.
2. **Eine möglicherweise abgeschnittene Facette gilt nicht mehr als Gesamtzahl.**
   `ngsearch` fragt höchstens `FACET_LIMIT` = 20 Eimer ab; eine volle Liste heißt
   „vielleicht gekürzt", und eine Summe darüber untertreibt, während sie exakt
   aussieht. Sie fällt jetzt zurück. Staging führt 16 Schlüssel, dort greift es
   nicht — das ist eine Eigenschaft dieser Instanz, nicht des Formats, weshalb
   die Grenze jetzt eine exportierte Konstante ist.
3. **Blättern über das Bündel sagt, dass es keine Fortsetzung ist.** Derselbe
   `skipCount` geht an alle fünf Schlüssel; Seite 2 ist „die zweite Seite jeder
   Lizenz". Nicht behebbar (eine Rangfolge über fünf Ergebnismengen gibt das
   Repository nicht her), also benannt — mit dem Verweis auf `excludeNodeIds`.
4. **Die OAuth-Fläche gibt das Passwort-Budget nicht mehr für Maschinenverkehr
   aus.** Vier Anfragen je Anmeldung (beide Discovery-Dokumente, Registrierung,
   Token) kommen von der CLIENT-Adresse, und ein gehosteter Connector bedient
   viele Nutzer aus wenigen Ausgangsadressen. Die laufen jetzt über dasselbe
   Budget, das der MCP-Endpunkt demselben Client gibt; `/oauth/authorize` behält
   den engen `/auth*`-Eimer, weil dort ein Passwort eingegeben wird.
5. **Die Einwilligungsseite stellt die geprüfte Tatsache über die behauptete.**
   Bei offener Registrierung ist `client_name` frei erfunden — die Seite führte
   damit auf und listete das geprüfte Weiterleitungsziel als gleichwertige Zeile
   darunter. Jetzt steht das Ziel zuerst und trägt die Hervorhebung, der Name ist
   als Selbstauskunft ausgewiesen, und ein Satz sagt, welches von beiden zählt.

Beim Umsetzen selbst gefunden und mit korrigiert: mein Skript hatte nur einen der
beiden Rückgabezweige in `content-search.ts` umgeschrieben (die Zusicherung prüfte
nur, dass sich *irgendetwas* geändert hatte) und in zwei `join('
')` einen echten
Zeilenumbruch erzeugt. Beides fiel im Testlauf auf, nicht in der Durchsicht.

**Belege:** volle Suite **1591/1591** (+8) · Typecheck Exit 0 · Build Exit 0 ·
gerenderte Einwilligungsseite gegengelesen (Ziel steht vor dem Namen).

## Nachlese: was die Behebung selbst noch fand (2026-08-09)

Nach den fünf Korrekturen eine Durchsicht der eigenen Änderungen und der
Nutzer-Doku. Ergebnis: ein Fehler in meiner eigenen Korrektur, sechs veraltete
Doku-Stellen, zwei veraltete Plan-Kästchen.

**Code — ein Befund, behoben.** Der neue Blätter-Hinweis in `search_wlo_all` hing
nicht an `want.has('content')`. Ein Aufruf mit `include: ['collections']` und
gesetzter Lizenz hätte gemeldet, diese Seite sei „keine Fortsetzung" — über eine
Inhaltssuche, die gar nicht lief. `license` berührt nur den Inhalts-Zweig, also
schweigen jetzt beide Hinweise, wenn der nicht angefragt war.

**Doku — sechs Stellen, alle aus der Lizenz-Arbeit von heute.**

1. `/api/search` nimmt `license`, die dokumentierte Parameterliste nannte es
   nicht (beide READMEs). Wer nur die Doku liest, konnte den Filter dort nicht
   finden.
2. `docs/TOOLS.md` führte den Lizenzfilter nur bei `search_wlo_content` — er
   sitzt auch auf `search_wlo_all` (dem dokumentierten Standard-Einstieg) und
   `search_wlo_within_collection`.
3. „die fünf Filter" bei `search_wlo_all` sind sechs, seit `license` dazukam.
4. Dasselbe bei `search_wlo_within_collection`.
5. **Sachlich falsch, und älter als heute:** beide READMEs beschrieben
   `search_wlo_within_collection` als Suche „auf einen Sammlungs-Teilbaum
   begrenzt (via `virtual:primaryparent_nodeid`)" — genau das Kriterium, das das
   Backend mit 400 beantwortet (live geprüft 2026-07-17, im Code dokumentiert).
   Tatsächlich werden bis zu 100 direkte Kinder lokal geprüft. Die Doku
   versprach einen Geltungsbereich, den es nicht gibt.
6. Die Werkzeugtabellen beider READMEs trugen dieselbe Behauptung.

Jede der drei Tatsachenaussagen, die ich dabei neu geschrieben habe, ist am
Quelltext geprüft: `license` im REST-Filterlauf (`rest/handlers.ts`), `license`
im Schema von `search_wlo_all`, `WITHIN_CHILDREN_MAX = 100` samt `truncated`.

**Plan — zwei Kästchen standen offen, obwohl die Arbeit getan war.** „Dasselbe
mit Claude" aus T1.6 ist am **2026-08-06 live gegen claude.ai gemessen** worden:
MCP-Adresse eintragen genügt, der Client liest die Discovery-Dokumente
unaufgefordert und startet OAuth. Der ganze dritte Ausgang der
Zustimmungsseite ist aus dieser Messung entstanden — belegt in `STATUS.md` und
`docs/AUTH.md`, nur nie in die Aufgabenliste und in den offenen Punkt 2 des
Designs zurückgetragen. Beides jetzt geschlossen. Vom Claude-Punkt in T5.1
bleibt genau eine Hälfte offen und sie ist jetzt benannt: eine Anmeldung mit
echtem WLO-Konto **durch Claude**, mit Werkzeugliste, einem Schreibaufruf und
dem Widerruf.

**Belege:** volle Suite **1592/1592** (+1) · Typecheck Exit 0 · Build Exit 0.

## Die Lizenz-Offenlegung fehlte auf beiden REST-Pfaden (2026-08-09)

Die Regel „**jeder** Pfad, der `license` nimmt, legt seinen Exaktheits-Pass
offen" steht seit heute früh in CLAUDE.md — und war am selben Tag auf zwei von
fünf Pfaden verletzt. Gefunden, indem ich die Regel wörtlich genommen und die
Pfade gezählt habe, statt sie für erledigt zu halten.

Beide Fälle haben eine Ursache: **ein Feld im Umschlag ist keine Offenlegung,
wenn der Renderer es fallen lässt.**

**1. `GET /api/search?format=html` sagte nichts.** Die JSON-Ansicht legt über
`content.licenseFilter` offen; die HTML-Ansicht rendert `content`,
`collections`, `topicPages` und `warnings` — und keine der beiden Zahlen. Ein
Filter, der jeden Kandidaten entfernt, erschien dort als schlichtes „Keine
Treffer." Das ist genau der Fall, für den die Regel geschrieben wurde, und
ausgerechnet auf dem sichtbarsten Pfad: `format=html` ist die Ansicht, die eine
KI-Browsing-Pipeline überhaupt lesen kann (rohes JSON verwirft sie, live 2026-07-17).

Die Seite trägt die Sätze jetzt über den vorhandenen `warnings`-Streifen —
`licenseFilterNotice` und `licensePagingNotice`, dieselben, die die drei
MCP-Werkzeuge ausgeben. Kein neuer Text, keine zweite Formulierung derselben
Regel.

Ein Detail, das beim Schreiben auffiel und mehr ist als Kosmetik: die Zahlen
kommen aus dem **unprojizierten** Umschlag. `fields=…` läuft durch
`projectEnvelope`, und eine Offenlegung, die verschwindet, sobald ein Client die
Antwort kürzt, ist keine.

**2. `GET /api/collection?q=…&license=…` gab nur sein `total` zurück** — und das
ist bereits gefiltert, also von einer leeren Sammlung nicht zu unterscheiden.
Jetzt derselbe Vertrag wie bei `/api/search`: `licenseFilter { checked, kept }`,
gesetzt nur bei gesetztem Filter.

**3. Derselbe falsche Mechanismus wie in den READMEs, diesmal im Code-Kommentar.**
Über `handleCollection` stand „searches within the collection
(primaryparent-scoped)" — `virtual:primaryparent_nodeid` beantwortet das Backend
mit 400 (live 2026-07-17). Korrigiert auf das, was tatsächlich passiert.

**Was der Test mich gelehrt hat, statt umgekehrt.** Mein erster Test für den
Sammlungs-Pfad erwartete `checked: 2` bei `license=CC BY 4.0` und bekam `1`. Der
Code hatte recht: eine **einzelne** Lizenz kommt als Kriterium an, und
`nodeMatchesCriteria` matcht sie lokal bereits exakt — der Zusatzpass entfernt
dort nichts. Er trägt beim **Bündel**, das kein Kriterium liefert; genau der
Defekt von heute früh. Test korrigiert, Code unangetastet.

**Nicht geändert und geprüft:** `search_wlo_within_collection` hat bewusst keinen
Blätter-Hinweis. Es schneidet über *eine* lokal gefilterte Liste, seine
Seitenaufteilung ist also eine echte Partition — anders als beim Fächer über fünf
Schlüssel.

**Doku:** beide READMEs beschrieben die Antwortform von `/api/search` und
`/api/collection`, ohne `licenseFilter` je zu erwähnen — auch das ältere Feld
nicht. Beide Zeilen ergänzt, in beiden Sprachen.

**Belege:** volle Suite **1596/1596** (+4, beide neuen Paare vorab rot gesehen) ·
Typecheck Exit 0 · Build Exit 0.

**Ebenfalls korrigiert: zwei überholte Stellen im Protokoll.** Der P1-Abschnitt
weiter oben trug noch den Stand *vor* der Fächerung — „das OER-Bündel schickt
gar kein Kriterium und filtert vollständig lokal" und eine „bekannte Schwäche,
offen", deren Behebung im Nachtrag darunter steht. Beides als überholt
gekennzeichnet mit Verweis auf den Nachtrag; dasselbe in Punkt 3 von
`2026-08-09-usecase-gap-tools.md`. Ein Protokoll darf einen alten Stand
festhalten, aber nicht so, dass er sich wie der aktuelle liest.

**Und ein Fehler in genau dieser Behebung, gefunden in der Selbstdurchsicht.**
Auf der HTML-Seite rief ich `licensePagingNotice` ungefiltert auf — bei
`include=collections&license=OER&skipCount=8` hätte sie gemeldet, diese Seite sei
keine Fortsetzung, über eine Inhaltssuche, die nie lief. Das ist derselbe Fehler,
den ich heute früh im Werkzeug behoben hatte, von mir auf dem REST-Pfad
nachgebaut. Zweimal derselbe Fehler heißt: die Bedingung gehört nicht an jede
Aufrufstelle.

Deshalb trägt sie jetzt der Umschlag. `content.licenseFilter` entsteht nur, wenn
eine Lizenz gesetzt war **und** der Inhalts-Zweig lief — vorher erschien es bei
`include: ['collections']` als `{checked: 0, kept: 0}`, was sich liest wie ein
Filter, der den Eimer geleert hat, statt wie eine Suche, die nicht stattfand.
Seine Anwesenheit ist damit das einzige Tor, und Werkzeug wie HTML-Seite hängen
beide daran; die `want.has('content')`-Prüfung im Werkzeug ist entfallen.

**Der dritte Renderer, aus demselben Argument.** Wenn ein Feld im Umschlag keine
Offenlegung ist, sobald der Renderer es fallen lässt, dann gilt das nicht nur für
die HTML-Seite. Das Suchergebnis-Widget rendert denselben Umschlag und zeigte
„Keine Treffer gefunden." — über Material, das es gibt, nur nicht unter dieser
Lizenz. Der leere Zustand nennt den Grund jetzt samt Zahl der geprüften
Kandidaten, in beiden Sprachen über die Zeichenketten-Tabelle des Widgets (`t()`
kann nicht interpolieren, deshalb ist der Satz in zwei Schlüssel geteilt und die
Zahl wird dazwischen komponiert).

Bewusst nur der **geleerte** Fall: werden Treffer angezeigt, sieht die Person
Material, und die genauen Zahlen stehen im Textblock des Werkzeugs. Der
Erklärungssatz trägt volle Vordergrund-Kontrastfarbe statt des gedämpften Tons
der Zeile darüber — er ist das Einzige auf diesem Bildschirm, das einen falschen
Schluss verhindert.

Damit sind alle drei Renderer desselben Umschlags gleich ehrlich: Werkzeug-Text,
HTML-Seite, Widget.

## Review vor dem Deploy: drei Befunde, zwei davon echt (2026-08-09)

Eine strukturierte Durchsicht der heutigen Änderungen, bevor irgendetwas
hochgeht. Ergebnis: 0 CRITICAL, 1 MAJOR, 2 MINOR — und einer der MINORs hielt der
Nachprüfung nicht stand.

**[MAJOR] `/api/collection` ignorierte ohne `q` jeden Filter.** Ein Aufruf ohne
Suchbegriff ging an `listCollectionContents`, eine Funktion ohne Filterparameter.
Gemessen vor der Behebung, drei Kinder und `license=OER`:

```
total: 3
results: [ 'Offen', 'NC-ND', 'Ohne Lizenzangabe' ]
licenseFilter: undefined
```

CC BY-NC-ND und ein Datensatz ohne jede Lizenzangabe als OER-Antwort, ohne
Hinweis. Das MCP-Werkzeug daneben hatte diese Lücke nie — sein Schema sagt
„Empty = all contents (filtered)", und `searchWithinCollection` behandelt eine
leere Query als „alle Inhalte". Die Verzweigung fragt jetzt, ob es überhaupt
etwas zu matchen gibt (`query || irgendein Filter`). Der Fall ohne beides bleibt
beim schlichten Listen, denn das blättert upstream, während lokales Matchen eine
begrenzte Seite Kinder liest.

**Und die Folge daraus, die zur selben Änderung gehört:** durch die Korrektur
laufen mehr Aufrufe über den 100er-Stichprobenpfad — die REST-Antwort sagte aber
nirgends, dass sie eine Stichprobe ist. `truncated` und `collectionTotal` fahren
jetzt mit, dieselbe Tatsache, die das Werkzeug als Satz ausgibt. Ein gefiltertes
Ergebnis über einer 900-Elemente-Sammlung las sich sonst wie eine vollständige
Antwort.

**[MINOR] „All THREE paths" war seit heute früh falsch.** Der Doc-Kommentar an
`licenseFilterNotice` ist die Stelle, an der jemand nachschlägt, wen eine
Änderung mitziehen muss — und er unterschlug genau die zwei REST-Pfade, die
morgens die Offenlegung fallen ließen. Jetzt fünf, benannt, mit dem Hinweis, dass
die Zahl der Prüfpunkt ist.

**[MINOR] zurückgewiesen — der Befund war überzogen.** Ich hatte gemeldet,
`${lf.checked}` gehe im Widget ohne `escapeHtml` in den DOM. Stimmt, ist aber
nicht ausnutzbar: die Bedingung darüber (`lf.checked > 0`) vergleicht numerisch,
und `Number('<img …')` ist `NaN`. Gemessen über sieben Eingaben — jeder String
mit Markup fällt durch, jeder der durchkommt ist eine Zahl. Also keine
Verteidigung gegen einen unmöglichen Fall eingebaut. Stattdessen ein Test, der
die stillschweigende Abhängigkeit festnagelt: wird die Bedingung je gelockert
(etwa um wie die HTML-Seite auch gekürzte Ergebnisse zu erklären), fällt er,
bevor die Eigenschaft leise verschwindet.

**Sonst geprüft und in Ordnung** (damit „nichts gemeldet" nicht mit „nicht
geprüft" verwechselt wird): der Label→Schlüssel-Rundlauf für alle fünf
OER-Schlüssel inklusive der mit Leerzeichen geschriebenen `CC BY-SA`;
`exactLicenseTotal` bekommt bei einer Einzellizenz korrekt die Kriterien mit
Familienfilter; `/auth*` und `/oauth/authorize` teilen dieselbe Limiter-**Instanz**,
nicht nur dieselbe Größe; `MAX_BLOCK_CHARS` greift transitiv auch auf dem
OAuth-Pfad (`grantConsent` → `issueAccessBlock` → `verifyBlockLogin` →
`decodeAccessToken`), kein Zweig stellt ohne Prüfung aus; `client_name` im Log
ist bei der Registrierung bereits geflacht und gekappt. `npm audit --omit=dev`:
0 Schwachstellen.

## Die zwei zurückgestellten Themenseiten-Befunde abgearbeitet (2026-08-09)

Beide standen als „Offen" im Protokoll, beide waren als Defekt beschrieben und
als Aufwand zurückgestellt — keiner war eine Entwurfsfrage.

**1. Der Platzhalter-Titel erreichte drei Ausgaben.** `cm:title` war als
Rückfallwert ausgeschlossen, weil er auf 109 von 109 Produktions-Varianten
`PAGE_VARIANT_<uuid>` trägt. Das Feld, dem wir vertrauten, trägt dieselbe
Zeichenkette aber auf **22 von 68 Staging-Varianten**: eine Seite, die niemand
umbenannt hat, behält sie auch in `cclom:title`. Ungefiltert lief das in
`variantTitle` und von dort in die REST-Antwort, in `structuredContent` und in
die Widget-Überschrift.

Die genannte Blockade war „`isPlaceholderTitle` liegt in `tools/shared.ts` und
darf von den tieferen Schichten nicht importiert werden". Genau dafür nennt
`tests/shared-rule-discipline.test.ts` die Abhilfe wörtlich — „move the shared
thing to a leaf module instead" —, und `mapPool` wie `buildFilterCriteria` sind
denselben Weg schon gegangen. Die Regel liegt jetzt in `src/topic-page-title.ts`;
`tools/shared.ts` re-exportiert sie, damit die Werkzeuge eine Importstelle
behalten.

Geprüft wird jetzt der **Wert**, nicht das Feld, an beiden Stellen, an denen er
aus dem Repository kommt (`topic-page-structure.ts`, `topic-page-api.ts`) — leer
statt Ersatz, weil jeder Aufrufer schon eine bessere Ausweichkette hat
(Sammlungstitel, dann generisches Label).

**Die dritte Stelle wog am schwersten und stand in keiner Notiz:** die
Bestätigungs-Vorschau von `wlo_set_topic_page`. `titleOf` nahm `cclom:title`
zuerst, also konnte der Satz, an den der Bestätigungs-Token bindet, die Variante
als `PAGE_VARIANT_<uuid>` benennen — die Person sieht nichts Prüfbares. Jetzt
überspringt `titleOf` Platzhalter, und `nameOf` gibt jedem Satz dieselbe
Ausweichkette: echter Titel, sonst die id. Drei Sätze gingen vorher
unterschiedliche Wege (einer hatte die Ausweiche, zwei nicht).

**2. `search_wlo_topic_pages` reichte einen unauflösbaren Filter roh weiter.**
Ein `educationalContext`, den `resolveVocab` nicht auflöst, wurde als Rohtext
gegen URIs verglichen. Er traf nie — also überlebten nur die Varianten **ohne**
Kontext, und nichts sagte es. Das ist die schlechtere Hälfte: still verengen ist
nicht dasselbe wie ignorieren, und der vorhandene Hinweistext sagt „nicht erkannt
und **ignoriert**".

Der Wert wird jetzt verworfen und gemeldet, über `buildFilterCriteria` und
`formatUnresolvedHint` — dieselbe Property, dieselbe „Meintest du?"-Quelle wie
bei den fünf anderen Suchwerkzeugen. Kein Nachbau.

**Und ein dritter Fund beim Beheben:** `_queryMeta.criteria` führte den
verworfenen Filter weiter als angewandtes Kriterium. Der Kommentar direkt über
`buildTopicPagesMeta` formuliert genau diese Regel und begründet sie mit einem
nie abgeschickten `ngsearchword` — für `educationalContext` galt sie nicht. Die
aufgelöste URI wird jetzt durchgereicht statt ein zweites Mal abgeleitet.

**Was der Test mich lehrte, statt umgekehrt.** Mein erster roter Lauf hatte den
falschen Grund: als unauflösbaren Wert hatte ich „Sekundarstufe 17" gewählt — der
löst über den Fuzzy-Zweig auf `sekundarstufe_1` auf. Gemessen, Test auf
„Quatschstufe" korrigiert, und danach die Behebung **vollständig** zurückgenommen,
um beide Tests aus dem richtigen Grund rot zu sehen.

**Belege:** volle Suite **1610/1610** (+11) · Typecheck Exit 0 · Build Exit 0.

**Weiterhin offen und ohne mich nicht behebbar:** der Claude-Anmeldetest (braucht
ein WLO-Konto vor einem Claude-Client); `wlo_register_usage` (App-Signatur, eine
Betreiber-Entscheidung); die fünf Werkzeugbeschreibungen über 1024 Zeichen (nicht
gemessen, ob ChatGPT das erzwingt — nicht auf Verdacht kürzen); und die
Entwurfsfragen aus früheren Paketen (Datei-Upload per Base64, Variantenliste
vollständig vs. Aufrufe, `ai_prompt`-Testdatensatz).

## Zwei neue Dokumente für Team und Chatbot-Entwicklung (2026-08-09)

**`docs/INTEGRATION.md`** — die Übergabe: alle 41 Werkzeuge gruppiert, jede von
außen aufrufbare Adresse (MCP, 8 REST-Routen, 6 Nutzerseiten, 5 OAuth-Adressen,
4 Zugangsblock-Endpunkte) und das Verhalten, an dem Integrationen scheitern.
Dazu zwei Abschnitte, die die eigentliche Arbeit sind: „Was es bewusst nicht
gibt" und eine Fehlersuche nach Symptom.

**`docs/AUTH-CONCEPT.md`** — das Anmelde-Konzept: die drei geforderten
Zugangsarten nebeneinander, die edu-sharing-Messung, aus der alles folgt, sieben
Sicherheitsschichten, und ein Abgleich mit sechs Alternativen. Diese Lücke war
echt: `AUTH.md` beschreibt den Mechanismus, das Entscheidungspapier von 2026-08-04
ist Geschichte (seine offene Option A ist gebaut) — das *Warum* stand nirgends.

Bewusst enthalten: was das Konzept **nicht** schützt, und die eine Alternative,
die besser wäre als unsere (OIDC bei edu-sharing — eine organisatorische Anfrage,
keine Code-Frage).

### Nicht aufgezählt, sondern gemessen

Die Werkzeugliste kommt aus einem gestarteten Server, jede Route aus dem echten
Router. Das hat vier eigene Fehler gefunden, bevor sie jemand las: `/api/wikipedia`
nimmt `q`, nicht `title` (400); `outputFormat` bieten **21** Werkzeuge, nicht 14
(ich hatte *Dateien* gezählt); zwei Gruppenüberschriften trugen die falsche Zahl.
Zum Schluss die Werkzeugnamen im Dokument gegen die Serverliste diffed:
identisch, 41/41.

### Was die Doku-Arbeit im Code fand

**Fünf veraltete Zahlen.** `wlo_set_topic_page` kam als 14. Kurationswerkzeug
dazu, ohne dass die Summen nachgezogen wurden: beide READMEs sagten „dreizehn",
die deutsche zusätzlich „25 öffentliche Werkzeuge" (27), `docs/TOOLS.md` an vier
Stellen „40 MCP-Tools" / „13 kuratierende". Das Werkzeug selbst war überall
dokumentiert — nur die Arithmetik nicht.

**Zwei Beschreibungen einer Architektur, die es nicht mehr gibt.** Beim Schreiben
des Auth-Konzepts geprüft und durch einen gestarteten Server bestätigt:
`createMcpServer` nimmt `{ issuer }`, keinen Write-Mode, und alle 14
Kurationswerkzeuge stehen auch anonym in der Liste. `CLAUDE.md` und der
Kopfkommentar von `services/write/credential-gate.ts` beschrieben beide noch den
umgekehrten Entwurf — Registrierung nach Write-Mode, Schreibwerkzeuge nicht in
`tools/list`. Das wurde am 2026-08-05 bewusst umgedreht; nur die Beschreibungen
blieben zurück. Dass die Projekt-Verfassung selbst eine überholte Architektur
beschreibt, ist der teuerste dieser Funde.

**Ein falscher Kommentar zur Rumpf-Grenze.** `http-app.ts` nannte „default 1 MB";
dort gibt es gar keinen Default — der Einstiegspunkt reicht `MAX_BODY_BYTES`
durch, 4 MiB, was in jeder anderen Datei richtig steht.


---

## Skill-Registry pro Inhaltssammlung — P0 + P1 fertig (2026-08-10)

Entwurf: [`2026-08-10-skill-registry-design.md`](2026-08-10-skill-registry-design.md) ·
Aufgaben: [`2026-08-10-skill-registry-tasks.md`](2026-08-10-skill-registry-tasks.md)

Der neue Redaktionsprozess dreht die Frage um: nicht „welche Skills gibt es",
sondern **„welche Skills sind fuer diese Sammlung freigegeben"**. Die Freigabe
steht als Registry-Dokument in der Sammlung selbst.

### P0 (T1) — die Messung gegen Staging, VOR dem Code

Vier Fragen, vier Antworten. Drei davon haben den Entwurf geaendert.

| Frage | Antwort |
|---|---|
| Traegt `/children` das Feld `mimetype`? | **Ja**, in jeder Projektion — `mimetype`/`mediatype` sind Knotenfelder, kein `propertyFilter` beruehrt sie |
| Traegt `/children` `ccm:oeh_extendedType`? | **Nur mit ausdruecklicher Projektion.** Derselbe Knoten, derselbe Aufruf: mit `DISPLAY_PROPS` leer, mit `SKILL_PROPS` die volle URI |
| Medientyp einer SKILL.md? | **`text/x-web-markdown`** (25/25), `mediatype: file-markdown` — weder `text/markdown` noch `text/plain` |
| Gibt es schon eine Registry? | **Nein** (`SKILL_REGISTRY` → 0 Treffer) |

Drei Zusatzbefunde derselben Messung, alle plan-relevant:

- **28/28** Skill-Dateien heissen `cm:name = SKILL.md`. Die Namensregel des
  Tie-Breaks unterscheidet heute also **nichts** — die Titelregel ist die, die
  sofort greifen kann, und der Mehrdeutigkeitsfall ist der Regelfall, nicht die
  Ausnahme.
- **0/28** sind Sammlungsverweise (`ccm:original` ≠ eigene id). Skills liegen
  heute in Arbeitsbereich-Ordnern, nicht in Sammlungen. Belastbar unabhaengig
  von der kaputten Usage-Leseseite: ein Verweis waere ein eigener Datensatz in
  der Suche, und `dedupeByOriginal` existiert genau deswegen.
- **0/28** Dokumente enthalten `:::` ueberhaupt (roh geprueft, nicht nur ueber
  den Parser — zwei Scheintreffer waren das Wort `wlo-material` im Fliesstext).
  Das Blockformat ist in `docs/SKILLS.md` belegt, aber **kein Live-Dokument auf
  Staging uebt es aus**. Der `:::`-Pfad gilt damit als ungemessen, nicht als
  gruen; T12 ist die einzige echte Probe und haengt an Redaktionsarbeit.

### Entscheidung des Nutzers waehrend P0

Der Katalog soll **direkt in der Sammlungssuche** stehen, nicht nur ein Marker —
bei begrenzten Kosten und spaeter wieder abschaltbar. Daraus wurden zwei Stufen
**einer** Funktion:

| Stufe | Wer | Eintraege tragen | Abrufe je Sammlung |
|---|---|---|---|
| `resolveHeads: false` | die Suche | Titel + nodeId, direkt aus dem `:::`-Block | **2** |
| `resolveHeads: true` | `get_skill_registry` | zusaetzlich Beschreibung + Schlagwoerter | 2 + ≤ 30 parallel |

Der Grund, warum die guenstige Stufe so guenstig ist: **der Block traegt den
Titel schon selbst.** Titel und nodeId kosten keinen einzigen Zusatzabruf.

### P1 (T2–T5) — der Dienst

`src/services/skill-registry.ts` (neu, ~250 Zeilen) + `tests/skill-registry.test.ts`
(21 Tests). Alles TDD, jeder Test zuerst rot gesehen.

- `pickRegistryNode` — reine Auswahlregel: `ai_prompt` + Markdown, Tie-Break auf
  `SKILL_REGISTRY.md` bzw. `SKILL REGISTRY` im Titel, danach stabil nach `nodeId`
  sortiert. Der Markdown-Test nimmt den **gemessenen** Wert `text/x-web-markdown`
  plus die IANA-Schreibweise und `mediatype: file-markdown`.
- `findRegistryMarker` — ein Aufruf, `SKILL_PROPS` als Projektion (ohne die ist
  jeder Kandidat unsichtbar), degradiert auf `null` statt zu werfen.
- `loadSkillRegistry` — beide Stufen, `unresolved` fuer nicht lesbare Verweise,
  `ambiguous` bei mehreren Kandidaten, Kappung bei `REGISTRY_MAX = 30` mit
  Offenlegung.
- Drei benannte Fehlerfaelle: `collection_not_found`, `no_registry`, `unreadable`.
  Ein gefundenes, aber nicht lesbares Registry-Dokument kommt **benannt** zurueck
  — „hier gibt es keine Registry" waere eine andere und falsche Aussage.

### Zwei Duplikate im eigenen Diff gefunden und entfernt

Beide waren schon geschrieben, bevor sie auffielen:

- die `ai_prompt`-URI ein zweites Mal hingeschrieben, statt
  `SKILL_CONTENT_TYPE_URI` aus `skill-catalogue.ts` zu importieren;
- die Lesekette „Download, sonst `/textContent`" nachgebaut, statt `readSkillText`
  aus `skills.ts` zu exportieren. Eine Registry **ist** ein Skill-Datensatz, und
  zwei Kopien der Anonym-Download-Regel waeren zwei Stellen zum Auseinanderlaufen.

### Was der Parser an meinen eigenen Testdaten fand

Zwei Fehler, beide in den Tests, keiner im Code — und beide haetten den Katalog
im Test leer aussehen lassen, ohne dass der Code schuld war:

1. `parseSkillReferences` extrahiert nur **UUID-foermige** ids. Meine Bloecke
   trugen `skill-a`, also parste jeder Verweis zu einer leeren nodeId.
2. Nach dem Ersetzen durch UUID-Konstanten wurden aus Objektschluesseln
   Bezeichner (`SKILL_A: {…}` statt `[SKILL_A]: {…}`) — der Schluessel hiess
   danach woertlich `"SKILL_A"`.

Lehre in derselben Familie wie die bekannte `fetchMock`-Regel: ein Test kann
gruen aussehen wollen und dabei eine Bedingung pruefen, die es live nie gibt.

**Nachweis:** `npx tsc -p tsconfig.typecheck.json --noEmit` → 0 Fehler ·
`npm test` → **1631 Tests, 1631 pass, 0 fail** (30,5 s).

### Offen (P2–P3)

T6–T8 `get_skill_registry` + zwei Env-Schalter (`WLO_DISABLE_SKILL_SEARCH`,
`WLO_DISABLE_REGISTRY_IN_SEARCH`) · T9–T10 Anreicherung und Darstellung in der
Suche · T11 Doku · **T12 Live-Lauf — braucht zuerst eine echte Registry in einer
Staging-Sammlung (Redaktion), weil es heute weder eine Registry noch einen Skill
in einer Sammlung noch ein Dokument mit `:::`-Bloecken gibt.**


## Skill-Registry — P2 fertig (2026-08-10)

`get_skill_registry` ist das **28. Lesewerkzeug**; der Server bietet jetzt
42 Werkzeuge (28 lesend + 14 kuratierend).

### Was gebaut wurde

- **`src/tools/skill-registry.ts` (neu, 137 Zeilen)** — eigenes Modul, nicht eine
  vierte Registrierung in `tools/skills.ts`: das ist mit 346 Zeilen schon ueber
  der Schwelle, und „welche Skills gelten fuer DIESE Sammlung" ist eine andere
  Frage als „welche Skills gibt es". Reihenfolge der Ausgabe: Kopf → Katalog →
  Offenlegungen → Hinweis → Trenner → **dann** das fremde Dokument. Das ist eine
  Sicherheitseigenschaft, keine Layoutfrage.
- **`WLO_DISABLE_SKILL_SEARCH`** — nimmt `search_skill` aus der Liste;
  `get_skill` und `get_skill_registry` bleiben immer, weil die Registry nodeIds
  ausgibt und `get_skill` das Werkzeug dafuer ist. Im `one-tool`-Modus ohne
  Wirkung: dort IST `get_skill_for_task` die Suche. Als **Parameter** von
  `registerSkillTools` gebaut (Env-Lesung in `wlo-config.ts`), damit er ohne
  Env-Gefummel testbar ist — dasselbe Muster wie `mode`. Log-Zeile beim Start,
  einmal je Prozess.
- Apps-SDK-Metadaten (`tool-defaults.ts`, `tool-status.ts`) und
  `.env.example` nachgezogen.

### Planaenderung: der zweite Schalter wandert nach T9

`WLO_DISABLE_REGISTRY_IN_SEARCH` war in T7 geplant, schaltet aber Verhalten ab,
das es vor T9 nicht gibt. Ein Schalter fuer nichts ist spekulative Konfiguration;
er wird in T9 gebaut und dort getestet. Beide Plandateien sind entsprechend
korrigiert.

### Was der Testlauf fand

**Fuenf Regressionen, alle die erwartete Folge eines 28. Werkzeugs** — und genau
deswegen wertvoll: der Bestand schreibt die Werkzeugzahl an vier Stellen fest
(`server.test.ts`, `server-unsafe-disabled.test.ts`, `tools-curation-gating.test.ts`)
und verlangt fuer JEDES Werkzeug Titel und Statustexte. Ein neues Werkzeug ohne
Apps-SDK-Metadaten faellt damit auf, statt still unbeschriftet auszuliefern.

**Zwei eigene Testfehler, keiner davon im Code:**

1. Die Injektions-Zusicherung war zu grob formuliert („die nodeId darf auf keiner
   Zeile stehen"). Der geflachte Titel *enthaelt* die eingeschleuste id — und das
   ist korrekt: `oneLine` haelt sie auf EINER Zeile, statt eine zweite
   Katalogzeile entstehen zu lassen. Die Zusicherung prueft jetzt die echte
   Eigenschaft: keine Zeile beginnt als gefaelschter Eintrag.
2. Ein Regex suchte nach dem Wort „mehrere", das in der Offenlegung nie steht.
   Ersetzt durch die staerkere Pruefung: die **Anzahl** der Kandidaten und die
   **gewaehlte** id muessen beide dastehen.

**Nachweis:** `npx tsc -p tsconfig.typecheck.json --noEmit` → 0 Fehler ·
`npm test` → **1640 Tests, 1640 pass, 0 fail** · Beschreibung von
`get_skill_registry` an einem laufenden Server gemessen: **607 Zeichen** (Grenze
1024).

### Bewusst nicht getan

`src/services/skill-registry.ts` liegt bei 312 Zeilen, knapp ueber der Schwelle.
Etwa die Haelfte davon ist Dokumentation, die Verantwortung ist eine einzige
(„die Registry einer Sammlung"), und die Datei liest sich von oben nach unten
ohne Sprung. Eine Teilung waere hier ein Refactoring fuer eine Zahl, nicht fuer
eine Naht — notiert statt gemacht.


## Skill-Registry — P3 fertig, T12 nur teilweise (2026-08-10)

### T9/T10 — die Anreicherung der Sammlungssuche

Jedes Sammlungs-Ergebnis traegt jetzt die Skills, die diese Sammlung freigegeben
hat. `enrichSkillRegistry` sitzt im vorhandenen Anreicherungs-Block von
`searchAll` — als **einzige** Anreicherung, die standardmaessig AN ist, auf
Nutzerentscheidung. Gerendert wird in `renderToText`, der einen Stelle, durch die
beide Werkzeuge gehen; jede Zeile laeuft durch `oneLine`, und in der Liste stehen
hoechstens 4 Skills je Sammlung, mit genannter Restzahl.

Der Schalter `WLO_DISABLE_REGISTRY_IN_SEARCH` wird **in `searchAll`** gelesen,
nicht an den drei Aufrufstellen: eine je Aufrufstelle wiederholte Bedingung ist
genau die Form, in der in diesem Projekt schon zweimal ein Pfad von der Regel
abgewichen ist. Der Betreiber-Schalter gewinnt ausserdem gegen einen Aufrufer,
der die Anreicherung ausdruecklich anfordert — er existiert wegen der Kosten.

### T11 — Doku

`docs/SKILLS.md` bekommt die Redaktionsanleitung samt **Beispiel-Dokument** (das
ist noetig, weil auf Staging noch keine Registry existiert), `docs/TOOLS.md` und
`docs/INTEGRATION.md` das Werkzeug und die Abgrenzung, beide READMEs und der
CHANGELOG den Eintrag. Zahlen **an einem laufenden Server gemessen**, nicht
gezaehlt: **42 Werkzeuge, 22 mit `outputFormat`**.

### T12 — was ohne Registry messbar war, gemessen

**Der Live-Lauf hat die Kostenzusage widerlegt, die ich gegeben hatte.**

| Messung | Ergebnis |
|---|---|
| Anreicherung allein, 2 Sammlungen parallel | 1390 / 1409 / 1500 ms |
| `searchAll` aus → ein (3 Runden) | 2767→4111 · 3300→4263 · **7034→3769** |
| `/children`, Sammlung mit 3 Dateien | ~0,53 s |
| `/children`, Sammlung mit 28 Dateien | ~1,34 s |
| Projektion 27 Felder vs. 3 Felder | 531 vs. 523 ms · 1345 vs. 1604 ms |

Der Aufschlag betraegt **~1,0–1,4 s**, nicht die geschaetzten 0,5 s. Drei Dinge
dazu, und alle drei binden kuenftige Aenderungen:

1. **Der erste Messwert war falsch.** Eine einzelne Messung sah wie eine
   Verdopplung aus (3,5 s → 7,0 s). Drei Runden zeigten, dass Staging stark
   streut — ein Lauf OHNE Anreicherung brauchte 7,0 s und war damit langsamer als
   jeder Lauf mit ihr. Ein Messpaar traegt hier keine Aussage.
2. **Die Projektion kostet nichts.** Die naheliegende Optimierung (statt
   `SKILL_PROPS` nur die drei gebrauchten Felder) bringt messbar **null** — die
   Dauer haengt an der Kindzahl. Gemessen, bevor der Code danach geaendert wurde;
   die Aenderung ist unterblieben.
3. Da die Abrufe parallel laufen, bestimmt die **groesste** Sammlung die Dauer,
   nicht ihre Anzahl. Wegoptimieren laesst sich das nicht — es ist die Latenz von
   `/children`. Dafuer gibt es den Schalter.

Ausserdem live geprueft: `reason: no_registry` an einer echten Sammlung,
`collection_not_found` an einer unbekannten id (HTTP 404), `findRegistryMarker`
liefert `null` statt zu werfen.

**Offen und nur mit Redaktionsarbeit erreichbar:** der ganze `:::`-Pfad. Ein
Registry-Dokument anlegen, den Katalog in der Suche sehen, `get_skill_registry`
→ `get_skill` durchlaufen. Bis dahin ist dieser Pfad durch Unit-Tests gedeckt und
durch **keinen** echten Datensatz — die zwei Live-Laeufe dieses Projekts fanden
je Defekte, die kein Mock sah.

### Ein Befund aus dem eigenen Diff

`formattedNodeSchema` spiegelt `FormattedNode`, und **Zod entfernt unbekannte
Schluessel stillschweigend**: ohne Eintrag waere `skillRegistry` aus jedem
`structuredContent` verschwunden, ohne dass irgendwo etwas fehlschlaegt. Der
Widget-Pfad und jeder schema-pruefende Client haetten die Registry nie gesehen.
Test ergaenzt, der genau das festhaelt.

**Nachweis:** `npx tsc -p tsconfig.typecheck.json --noEmit` → 0 Fehler ·
`npm test` → **1655 Tests, 1655 pass, 0 fail**.


## Skill-Registry — die Anreicherung ist jetzt AUS, der Auslöser ist Text (2026-08-10)

Nutzerentscheidung nach dem Live-Lauf: **~1,4 s auf jede Suche sind zu teuer.**
Die Anreicherung wird nur noch auf Anforderung ausgefuehrt.

### Warum der Marker nichts gespart haette

Im Live-Lauf hatte **keine** der beiden Sammlungen eine Registry — es gab also
null Dokument-Abrufe, und die Anreicherung kostete trotzdem 1,4 s. Die Kosten
stecken vollstaendig im `/children`-Aufruf. Ein blosser Marker ("hat eine, ja
oder nein") haette denselben Aufruf gebraucht und exakt gleich viel gekostet.

| | Kosten |
|---|---|
| Anreicherung an | +1,0-1,4 s bei JEDER Suche, fuer 5 Sammlungen, unabhaengig davon, ob eine Registry existiert |
| Anreicherung aus | 0 s — und ~0,5-1,3 s nur dann, wenn das Modell fuer EINE Sammlung nachsieht |

### Wie ein Modell die Registry jetzt findet: drei kostenlose Signale

Die Frage des Nutzers war die richtige — ein generisches Werkzeug ohne Auslöser
wird nicht gerufen. Der Auslöser muss aber kein ABRUF sein, er kann **Text** sein:

1. **Eine Hinweiszeile an jedem Sammlungs-Ergebnis** (`registryLines` in
   `formatter.ts`, wenn `skillRegistry` fehlt und `nodeType === 'collection'`) —
   genau dort, wo das Modell die nodeId ohnehin in der Hand haelt. Nur fuer
   Sammlungen: ein Material kann keine Registry haben.
2. **Die Server-Instructions** nennen den Anlass ("arbeitest du mit einer
   Sammlung") und sagen ausdruecklich, dass nichts automatisch nachgeschlagen wird.
3. **Querverweise in den Werkzeugbeschreibungen**, festgehalten in
   `tests/tool-descriptions.test.ts` — dasselbe Mittel, mit dem 2026-08-06 schon
   `get_wikipedia_summary` → `get_url_text` verdrahtet wurde, nachdem eine
   Live-Messung zeigte, dass das Modell sonst woanders hingeht.

Der Schalter dreht sich mit: aus `WLO_DISABLE_REGISTRY_IN_SEARCH` wird
**`WLO_REGISTRY_IN_SEARCH`** (Standard aus). Ein "Disable"-Flag fuer etwas, das
ohnehin aus ist, waere irrefuehrend.

**Offener Vorbehalt:** solange auf Staging keine einzige Registry existiert,
fuehrt jeder dieser Hinweise zu einem Abruf, der "keine Registry" zurueckgibt.
Verkraftbar (der Abruf ist billiger als die Dauer-Anreicherung), aber der Nutzen
beginnt mit der Redaktionsarbeit, nicht mit dem Deploy.

### Zwei Funde beim Umbau

**Eine Beschreibung riss die 1024-Zeichen-Grenze.** Der Querverweis brachte
`search_wlo_collections` auf 1149 Zeichen — ein Test faengt das ab (die Notiz in
CLAUDE.md, fuenf Beschreibungen seien "ungemessen" ueber der Grenze, ist damit
ueberholt). Beim Kuerzen schlug ein ZWEITER Test an, der genau den Satz schuetzt,
den ich streichen wollte ("nur manche Sammlungen haben eine Themenseite") — er
stammt aus einem beobachteten Fehlgriff. Geloest, indem der Verweis in den Satz
ueber die Folgeaufrufe wanderte, wo er ohnehin hingehoert; die Messklammer
(„5 Sammlungen, davon 1") entfiel, sie steht weiterhin in README.de.md.

**Ein Schreibvorgang stellte `.env.example` von LF auf CRLF um** — und
`deploy-env-passthrough.test.ts` parst diese Datei mit `/^([A-Z_]+)=(.*)$/`.
JavaScripts `.` matcht kein ``, also fand die Regex **gar nichts**, und zwei
Tests meldeten "die Einstellung fehlt" statt "die Zeilenenden haben sich
geaendert". Datei zurueckgestellt und die Regex auf `[^
]*` gehaertet: der
naechste Windows-Editor loest sonst dieselbe Falle aus.

**Nachweis:** `npx tsc -p tsconfig.typecheck.json --noEmit` → 0 Fehler ·
`npm test` → **1665 Tests, 1665 pass, 0 fail**.

### Aufraeumen erledigt (2026-08-10, nach Freigabe)

**Zwei Testdateien entfernt**, nachdem belegt war, dass sie nichts mehr pruefen:
`WLO_DISABLE_REGISTRY_IN_SEARCH` kommt in `src/` nicht mehr vor, und
`tests/search-registry-disabled.test.ts` war trotzdem 2/2 gruen. Ausserhalb des
Paares referenzierte sie niemand (`tests/disable-registry-env.ts` wurde nur von
ihr importiert; der Runner liest das Verzeichnis). Ersetzt durch
`tests/enable-registry-env.ts` + `tests/search-registry-enabled.test.ts`, die den
Schalter in der neuen Richtung pruefen — inklusive der Zusicherung, dass er die
Abrufe wirklich ausloest und nicht nur ein Feld setzt.

**`findRegistryMarker` entfernt** — beim Nachsehen gefunden: **null Aufrufer im
Produktivcode**. Die Funktion entstand in T3, als die Suche nur einen Marker
tragen sollte; seit der Katalog-Entscheidung geht alles ueber die guenstige Stufe
von `loadSkillRegistry`, und die Messung zeigte danach, dass ein reiner Marker
ohnehin nichts spart — die Kosten stecken im `/children`-Aufruf, den beide
brauchen. Exportiert, getestet, unbenutzt.

Ihre vier Tests sind nicht verfallen, sondern **umgehaengt**: die zwei
eigenstaendigen Zusicherungen (die Projektion `ccm:oeh_extendedType`, gemessen in
T1, und der Titel-Fallback auf `cm:name`) laufen jetzt ueber
`loadSkillRegistry`; die anderen beiden — „keine Registry" und „Abruf schlaegt
fehl" — waren schon durch die `reason`-Tests gedeckt (`no_registry`,
`unreadable`). `scanForRegistry` bleibt als benannter Schritt, sein Kommentar
behauptet nicht mehr zwei Aufrufer.

Nachgezogen: `CLAUDE.md` (nannte die Funktion in der Live-Zeile), der Entwurf
(mit Begruendung, warum sie wieder verschwand) und die Aufgabenliste.

**Nachweis:** `npx tsc -p tsconfig.typecheck.json --noEmit` → 0 Fehler ·
`npm test` → **1661 Tests, 1661 pass, 0 fail** (1665 vor dem Aufraeumen; −2
leerlaufende Tests, −2 zusammengefuehrte).


## Skill-Registry — laesst sich der Abruf parallelisieren? (2026-08-10)

Frage des Nutzers. Antwort: **nur an einer Stelle, und die ist jetzt doppelt so
schnell.**

`loadSkillRegistry` hat drei Stufen, und die ersten beiden sind zwingend
sequenziell — jede braucht das Ergebnis der vorigen:

```
/children  ->  Registry-nodeId  ->  Dokument lesen  ->  welche Skills  ->  Koepfe holen
```

Nur die dritte Stufe kann parallel laufen, und sie tat es schon (`mapPool`).
Gemessen wurde also die richtige Groesse dieser Grenze, ueber 28 echte
Skill-Datensaetze, je zwei Laeufe, bester Wert:

| Grenze | Dauer | gegenueber 5 |
|---|---|---|
| 1 | 9068 ms | — |
| 5 (bisher) | 2083 ms | Basis |
| **10 (neu)** | **1095 ms** | **~1,9x** |
| 20 | 1048 ms | ~2,0x |
| 30 | 870 ms | ~2,4x |

Der Knick liegt bei 10: 10 halbiert die Phase fast, 10->20 bringt ~4 %, und 30
hiesse, alle `REGISTRY_MAX` Abrufe gleichzeitig loszuschicken — die Form, die auf
einer belebteren Instanz in ein Limit laeuft. Kein Abruf schlug bei irgendeiner
Groesse fehl.

**Wer davon profitiert, und wer nicht:**

- Nur `get_skill_registry` (`resolveHeads: true`). Die **Suche** holt gar keine
  Koepfe — Titel und nodeId stehen im `:::`-Block — und wird dadurch kein
  bisschen schneller.
- Der Gewinn beginnt erst **oberhalb von 5 Skills** je Registry: darunter war es
  ohnehin eine Runde. Bei 28 Skills sinkt der ganze Aufruf von ~3,8 s auf ~2,8 s.

**Was nicht schneller wird und warum:** die Kinderliste (ein Aufruf, 0,53–1,34 s,
haengt an der Kindzahl) und das Dokument (ein Aufruf). Beide sind einzelne
Abrufe an einer Kette — es gibt nichts, das man nebenher erledigen koennte, weil
das jeweils Naechste erst aus dem Ergebnis hervorgeht. Ueber MEHRERE Sammlungen
laeuft ohnehin schon alles parallel (`enrichSkillRegistry`, Grenze 5, und bei
`maxCollections = 5` starten damit alle gleichzeitig).

**Nachweis:** `npx tsc -p tsconfig.typecheck.json --noEmit` → 0 Fehler ·
`npm test` → **1661 Tests, 1661 pass, 0 fail**.


## Skill-Registry — was darf ein Hinweis sagen, der nichts gelesen hat? (2026-08-10)

Frage des Nutzers, und sie deckte einen Fehler in meiner eigenen Zeile auf. Sie
lautete:

> `Skills für diese Sammlung: mit get_skill_registry und dieser nodeId prüfen`

Das ist eine **Existenzbehauptung ueber Daten, die niemand abgerufen hat** — und
da heute praktisch keine Sammlung eine Registry fuehrt, waere sie fast immer
falsch. Drei Folgen: das Modell meldet dem Nutzer moeglicherweise „es gibt
Skills", bevor es nachgesehen hat; es ruft fuer jede Sammlung ins Leere; und ein
Hinweis, der immer feuert und selten traegt, wird als Dekoration gelernt.

**Was eine Zeile ohne Datenkenntnis sagen darf, sind genau drei Dinge:** dass die
Antwort UNBEKANNT ist, WIE man sie bekommt, und WANN sich das lohnt. Der dritte
Teil traegt am meisten — ohne Anlass ist es Rauschen.

Neuer Text, **einmal je Antwort** statt einmal je Sammlung (der Satz ist fuer
alle identisch, und die nodeIds stehen ohnehin im selben Block):

> Hinweis: Ob eine Sammlung eigene Arbeitsanleitungen („Skills") freigegeben hat,
> ist hier nicht geprueft — viele fuehren keine. `get_skill_registry` mit ihrer
> nodeId beantwortet es, und lohnt sich, wenn es um das Vorgehen MIT einer
> Sammlung geht („wie arbeite ich damit", „was ist hier vorgesehen") statt um
> ihre Inhalte.

Der Hinweis entfaellt, wenn die Frage schon beantwortet ist: traegt jede
gerenderte Sammlung ihre Registry (opt-in-Anreicherung), waere „nicht geprueft"
neben der Pruefung schlicht falsch.

Vier Tests halten das fest: der Hinweis nennt die Unsicherheit, er nennt den
Anlass, er steht bei drei Sammlungen **einmal**, und er verschwindet, sobald die
Registry mitgeliefert wird.

**Nachweis:** `npx tsc -p tsconfig.typecheck.json --noEmit` → 0 Fehler ·
`npm test` → **1664 Tests, 1664 pass, 0 fail**.


## Skill-Registry — kann man die Zuordnung billiger machen? (Messung 2026-08-10)

Frage des Nutzers: die Registry zeitnah mitliefern, ohne die Sammlungsdaten zu
ueberlasten — geht das? Vier Messungen, read-only.

| Gemessen | Ergebnis |
|---|---|
| Traegt eine Verweis-Property durch die Sammlungssuche? | **JA** — 8 von 63 Treffern (8 Suchen) tragen `ccm:page_config_ref`, 7 den Kompendialtext |
| Wird die angeforderte Projektion honoriert? | **JA** — Suche und direkter Knotenabruf liefern dieselben 9 Properties; die 16 „fehlenden" fehlen auch am Knoten |
| Was kostet ein Feld mehr in der Projektion? | **nichts** (27 vs. 3 Felder: 531 vs. 523 ms, gemessen zuvor) |
| Vertraegt die Suche eine Property, die es noch nicht gibt? | **JA** — gleiche Trefferzahl, kein Fehler, das Feld fehlt einfach |

**Korrektur einer Code-Notiz.** In `services/search.ts` steht, der
Sammlungs-Endpunkt habe eine „fixed reduced projection without
`ccm:page_config_ref`". Das ist widerlegt — die Property kommt durch. Richtig ist
die zweite Haelfte derselben Notiz: die **Portale** erscheinen in der
Stichwortsuche gar nicht (an „Physik" geprueft: das Portal mit page_config_ref
war in 15 Treffern nicht dabei). Der Code funktioniert, nur die Begruendung im
Kommentar stimmt zur Haelfte nicht. NICHT geaendert — ausserhalb des Auftrags,
hier notiert.

**Was daraus folgt.** Die Kosten der heutigen Loesung entstehen, weil die
Zuordnung nur IMPLIZIT existiert („irgendwo unter den Kindern liegt ein
ai_prompt-Dokument") und deshalb ein `/children` je Sammlung braucht. Traegt die
Sammlung selbst einen Verweis auf ihre Registry — dasselbe Muster wie
`ccm:page_config_ref` —, dann:

- kommt der Marker in jedem Suchtreffer **gratis** mit (0 Zusatzabrufe),
- faellt `/children` ganz weg,
- und ein Dokument wird nur noch fuer die Sammlungen gelesen, die wirklich eine
  Registry haben, statt fuer alle fuenf.

Offen ist, WO dieser Verweis wohnt (eigene Property vs. Keyword-Konvention) —
das ist eine Repository-/Redaktionsentscheidung, keine Code-Entscheidung.


## Skill-Registry — Entscheidung: kein Repository-Vertrag, dafuer ein Parameter (2026-08-10)

Der Nutzer hat die drei Wege abgewogen und entschieden: **Keyword-Konvention geht
nicht, eine eigene Property koennen wir nicht bauen.** Also bleibt der Abruf beim
Werkzeug, und die Mitlieferung wird ein **optionaler Parameter**.

### Was gebaut wurde

`includeSkillRegistry` (Standard `false`) an den beiden Werkzeugen, die
Sammlungen zurueckgeben: **`search_wlo_all`** und **`search_wlo_collections`**.
Gesetzt, traegt jede Sammlung derselben Antwort ihre Registry — ohne zweiten
Aufruf. Die Beschreibung nennt die Kosten (2 Abrufe je Sammlung, ~1,0–1,4 s,
auch fuer Sammlungen ohne Registry), weil ein Modell eine Rundreise nicht
abwaegen kann, von der es nichts weiss; ein Test haelt das fest — die Zahl,
nicht nur das Wort (Review 2026-08-10: hier stand die verworfene 0,5-s-Schaetzung).

`WLO_REGISTRY_IN_SEARCH` bleibt als betriebsweiter Standard daneben
(`opts.includeSkillRegistry ?? WLO_REGISTRY_IN_SEARCH`).

### Ein Umzug, den ein zweiter Aufrufer rechtfertigt

`enrichSkillRegistry` lag privat in `services/search.ts`. `search_wlo_collections`
geht **nicht** durch `searchAll`, brauchte die Funktion aber auch — also ist sie
nach `services/skill-registry.ts` gewandert und exportiert. Dorthin gehoert sie
ohnehin: „wie eine Registry an einen Knoten kommt" ist Registry-Wissen, kein
Suchwissen. Verhalten unveraendert, die 8 Dienst-Tests blieben gruen.

In `search_wlo_collections` sitzt die Anreicherung **nach** der Kappung auf
`maxResults`, damit die Kosten an dem haengen, was tatsaechlich gezeigt wird.

### Warum der teure Weg verworfen wurde — mit Zahlen

Die Alternative waere gewesen, die Zuordnung explizit zu machen (ein Verweis an
der Sammlung, wie `ccm:page_config_ref`). Gemessen ist sie klar ueberlegen — 0
Zusatzabrufe statt 1 je Sammlung, weil die Projektion nichts kostet und
Verweis-Properties nachweislich durch die Sammlungssuche reisen (8 von 63
Treffern tragen `ccm:page_config_ref`). Sie scheitert nicht an der Technik,
sondern daran, dass beide Traeger ausscheiden: Keywords sind fuer die Redaktion
keine Option, und eine eigene Property verlangt eine MDS-Aenderung, die dieses
Team nicht bauen kann. Festgehalten, falls sich das aendert.

**Nachweis:** `npx tsc -p tsconfig.typecheck.json --noEmit` → 0 Fehler ·
`npm test` → **1669 Tests, 1669 pass, 0 fail**.

---

## Review der Skill-Registry — 7 Befunde behoben (2026-08-10)

`/better-coding-review` ueber die 8 neuen und 14 geaenderten Dateien: 0 critical,
**2 major**, 4 minor, 1 nit. Alle behoben, jeder mit einem zuerst roten Test.

### Die beiden MAJOR

**Erkennung an EINER Property.** `isMarked` und `registryTitleOf` lasen
`cclom:title`; `cm:title` liegt in derselben Projektion und ist die zweite
Stufe von `nodeTitle` — der kanonischen Kette, die `formatNode` fuer die
Eintraege desselben Katalogs benutzt, und der Traeger, den dieses Repo als den
tatsaechlich gesetzten gemessen hat (109/109 Produktionsvarianten). Eine so
betitelte Registry war unsichtbar, und bei zwei `ai_prompt`-Dokumenten fiel die
Wahl auf die nodeId-Sortierung: **der Katalog eines fremden Dokuments** als
Freigabeliste. Belegt durch Ausfuehrung (`picked aaa-0` statt `zzz-reg`).
Warum kein Test das fand: jede Fixture geht durch `makeNode`, das ausschliesslich
`cclom:title` schreibt — die Suite prueft die Wahl der Implementierung, nicht die
Wirklichkeit des Repositories.

**Der Hinweis gehoert zur Antwort, nicht zur Liste.** Er wurde in `renderToText`
gesetzt. `search_wlo_all` rendert drei Listen, und Themenseiten sind `ccm:map`,
formatieren also als Sammlung — gemessen: **zwei Hinweise je Antwort**, und mit
`includeSkillRegistry: true` stand „nicht geprueft" direkt unter dem Block, in
dem geprueft worden war. `get_related_content` hat dieselbe Form (zwei Listen).
`registryHintFor` ist jetzt exportiert, zusammengesetzte Antworten unterdruecken
den Listen-Hinweis und setzen ihn einmal ueber die Vereinigung. Dazu
**`collections.registryChecked`** im Envelope, nach dem Muster von
`content.licenseFilter`: eine Sammlung ohne Registry traegt gar kein Feld, die
Ergebnisse koennen „nicht nachgesehen" und „nachgesehen, keine da" also nicht
unterscheiden.

### Die uebrigen fuenf

- **Gekappter Scan behauptete Abwesenheit.** 50 Dateikinder werden gelesen,
  `pagination.total` wurde verworfen — eine groessere Sammlung, deren Registry
  dahinter einsortiert ist, bekam „fuehrt keine Skill-Registry". Jetzt
  `scanTruncated {scanned,total}`, im Werkzeugtext genannt und geloggt.
- **Kostenangabe.** Drei Werkzeugbeschreibungen (und `wlo-config`s Logzeile)
  trugen die verworfene Schaetzung 0,5–1,3 s — genau dort, wo ein Modell
  entscheidet, ob es zahlt. Auf **1,0–1,4 s** korrigiert; der Test pinnt die Zahl.
- **Kappungs-Zusage.** „alle mit `get_skill_registry`" neben 44 deklarierten
  Skills — das Werkzeug kappt selbst bei 30. Jetzt „die ersten 30".
- **Wer nicht darstellen kann, zahlt nicht.** `WLO_REGISTRY_IN_SEARCH` wird in
  `searchAll` gelesen, also erbten `/api/search?format=html` und das
  ChatGPT-`search` die Anreicherung. Die HTML-Seite rendert sie jetzt; `search`
  lehnt sie ab (`{id,title,url}` hat keinen Platz dafuer).
- **JSON-Zweig ohne Untrusted-Hinweis.** Die Markdown-Ansicht rahmt das Dokument,
  die JSON-Ansicht reichte denselben Text ohne Warnung weiter. Feld `note`.

**Nachweis:** `npx tsc -p tsconfig.typecheck.json --noEmit` → 0 Fehler ·
`npm run build` → exit 0 · `npm test` → **1682 Tests, 1682 pass, 0 fail**
(13 neue Tests, alle vor dem Fix rot gelaufen).

---

## Skill-Registry-Cache — P1–P4 (2026-08-11)

Der Katalog kommt jetzt bei **jedem** Sammlungs-Ergebnis mit, fuer **0**
Zusatzabrufe. Was das moeglich macht: ein Hintergrunddienst merkt sich je
Sammlung, was ihre **Kinderliste** sagt, und erneuert es alle 5 Minuten.

### Der Knackpunkt, und warum der erste Entwurf falsch war

Der erste Entwurf baute den Cache aus dem **Suchindex** — ein Aufruf, sofort
vollstaendig — und umging den Konflikt mit `CLAUDE.md:366` ueber eine
Zusatzregel („nie Abwesenheit behaupten"). Der Nutzer wies darauf hin, dass die
Kinderliste sicherer ist und im Hintergrund nichts kostet. Das ist richtig, und
es macht die Zusatzregel ueberfluessig: der Cache ruft `loadSkillRegistry` auf,
also denselben autoritativen Weg wie der Live-Pfad. Der Index liefert nur noch
den Startschuss, welche Knoten ueberhaupt in Frage kommen.

### Warum kein Vorab-Durchlauf (gemessen 2026-08-11)

| Ebene | Sammlungen | Dauer |
|---|---|---|
| 1 | 35 | 1650 ms |
| 2 | 331 | 6590 ms (35 Abrufe, Pool 10) |
| 3 | ~1335 (hochgerechnet) | 4055 ms fuer 30 Stichproben |

Vollstaendig waeren ~1700 Sammlungen und ~3400 Abrufe je Zyklus, ~11 Anfragen/s
Dauerlast. Verworfen. Die Warteschlange ist stattdessen durch die tatsaechliche
Nutzung begrenzt.

### Weitere Messungen, die den Entwurf tragen

- Repository-weite `ai_prompt`-Suche: **1 Aufruf**, 28 Treffer,
  1175 / 1215 / 1322 ms (drei Laeufe). 28/28 Markdown, **0** Referenzen.
- `virtual:primaryparent_nodeid` auf 28/28 und **schon in `SKILL_PROPS`**.
- Der Elternknoten ist **nicht** verlaesslich die Sammlung: bei geharvestetem
  Material ist es der Spider-Ordner (`dwu_spider`, `leifi_spider`) — ebenfalls
  `ccm:map`. Deshalb Abfrage **mit der Sammlungs-id**, was sich selbst prueft.
- `usedInCollections` ist bei 0/20 Material-Treffern und 0/28 Skills gefuellt.

### Was gebaut wurde

`src/services/skill-registry-cache.ts` (Warteschlange, Takt, Ablauf nach TTL,
Startschuss, Anreicherung), Start **nur** aus `http.ts`/`stdio.ts`, angeschlossen
an `searchAll`, `search_wlo_collections`, `get_collection_contents`,
`get_node_collections`. `tools/browse.ts` bewusst nicht — es rendert eigene
Zeilenformate ohne Registry-Zeile, das Feld laege nur in `structuredContent`.

`WLO_REGISTRY_IN_SEARCH` **entfernt**; `includeSkillRegistry: true` heisst jetzt
**Live-Abruf erzwingen**. Neu: `WLO_SKILL_CACHE` (an),
`WLO_SKILL_CACHE_REFRESH_MS` (5 min), `WLO_SKILL_CACHE_TTL_MS` (10 min).

### Zwei Dinge, die die Tests fanden

**Rot-gruen erzwungen:** die drei Ausfall-Tests waren beim ersten Lauf sofort
gruen, weil der Fehlerzweig schon aus T2 stand. Mit ausgehaengtem Zweig fielen
genau zwei von ihnen — erst damit war belegt, dass sie die Regel halten.

**Eine echte Regression, vom Altbestand gefangen:** `registryChecked` wurde
zunaechst aus der Zahl der angereicherten Knoten abgeleitet. Ein Live-Lauf, der
NICHTS findet, hinterlaesst aber ebenfalls kein Feld — die abgeschlossene
Pruefung las sich als uebersprungen. Der Live-Pfad ist jetzt ein eigener Term.

**Nachweis:** `npx tsc -p tsconfig.typecheck.json --noEmit` → 0 Fehler ·
`npm test` → **1713 Tests, 1713 pass, 0 fail** (31 neue).

### Offen

Der Live-Lauf gegen Staging (Startschuss protokollieren, zwei Suchen
vergleichen) und — weiterhin — der `:::`-Pfad, der auf Redaktionsarbeit wartet.

---

## Review des Skill-Registry-Cache — 8 Befunde behoben (2026-08-11)

Vollstaendiges Review des Pakets gegen den Entwurf. Verdikt vorher:
**1 critical, 2 major, 4 minor, 1 nit** — nicht merge-reif. Alle acht behoben.

### Der schwerste: ein gekappter Scan wurde als Antwort gecacht

`loadSkillRegistry` meldet `scanTruncated`, wenn es 50 von 400 Dateien gelesen
hat — genau damit ein leeres Ergebnis nicht als Abwesenheit durchgeht. **Beide**
Cache-Pfade warfen das Feld weg. Damit stand „diese Sammlung fuehrt keine
Registry" fuer die volle TTL und wurde bei jeder Erneuerung neu bestaetigt, weil
dieselbe erste Seite zurueckkommt. Das war Befund 3 des vorigen Reviews, eine
Ebene hoeher wieder da — und diesmal haltbar.

Am Quelltext verifiziert und **durch Ausfuehrung belegt**: `50 von 400 Dateien
gelesen, als abgeschlossene Antwort gemeldet: true`.

Die Loesung ist **nicht** „nichts merken und neu vormerken": das waere eine
endlose Kriecherei nach einer Antwort, die die Kappung unerreichbar macht. Der
Eintrag wird gemerkt (erneutes Lesen liefert nichts Neues), zaehlt aber **nicht**
als geprueft. Ein eigener Test haelt beide Haelften; mit der naiven Variante
fallen drei Tests.

### Der zweite: `WLO_SKILL_CACHE=off` schaltete den Live-Rueckfall nicht ab

Der Schalter sass nur am Timer. Gemessen: mit `off` **1 Kinderliste** pro
Anfrage. Das ist das Schlechteste aus beiden Welten — jede Anfrage zahlt den
vollen Abruf, und ohne Takt laeuft nichts ab, waehrend die Warteschlange bis zum
Deckel volllaeuft und dauerhaft warnt. Drei Dokumentationsstellen sagten bereits
das Gegenteil. `ensureRegistries` kehrt jetzt sofort mit 0 zurueck; eigene
Testdatei `tests/skill-cache-disabled.test.ts` (der Schalter wird beim
Modul-Load gelesen, also braucht es einen eigenen Prozess).

### Die uebrigen sechs

- **`CACHE_MAX_ENTRIES` gab es nur im Entwurf** — dort zweimal genannt, einmal
  als *die* Minderung gegen „Warteschlange als Speicherhebel". Jetzt gebaut:
  2000, aeltester **geprueft**-Zeitpunkt faellt heraus, mit Logzeile.
- **Die Abbildung `SkillRegistry` → Knotenfeld stand viermal** (Live-Rueckfall,
  Takt, Seed, `enrichSkillRegistry`). Jetzt `toRegistrySummary`, Rueckgabetyp ist
  `FormattedNode`s eigenes Feld statt einer zweiten Deklaration. Neuer
  Disziplin-Test faengt die fuenfte Kopie — als Gegenprobe eingebaut, faellt.
- **Der Startschuss ueberschrieb Antworten der Kinderliste.** Der Index darf nur
  fuer eine Sammlung sprechen, die noch niemand geprueft hat.
- **Kein In-Flight-Schutz:** zwei gleichzeitige Anfragen auf dieselbe kalte
  Sammlung feuerten zwei Abrufe. Jetzt `lookupOnce`.
- **`checkedAt`** wird auf beiden Schreibpfaden **nach** dem Abruf genommen.
- **Entwurfs-Drift:** Interfaces und Datenfluss beschrieben noch den Stand ohne
  Live-Rueckfall; `ensureRegistries` kam gar nicht vor. Nachgezogen.

### Was das Review ueber die Tests sagte

Fuer die zwei schwersten Befunde gab es **keinen** Test. Beim ersten existierte
der Fall eine Ebene tiefer (`tests/skill-registry.test.ts`: „a scan that hit its
cap does not claim the collection has no registry") — der Cache konsumierte das
Feld nur nicht. Beim zweiten wurde `WLO_SKILL_CACHE=off` nur gegen den Start
geprueft, nie gegen den Anfragepfad. Beide Luecken sind jetzt geschlossen.

**Rot-gruen belegt:** vor dem Fix fielen 5 der 6 neuen Tests in
`skill-registry-cache.test.ts` mit den richtigen Meldungen
(`undefined !== 1`, `1 !== 0`, `2 !== 1`, `2100 !== 2000`, „the listing keeps the
last word") plus der Schalter-Test (`1 !== 0`).

**Nachweis:** `npx tsc -p tsconfig.typecheck.json --noEmit` → 0 Fehler ·
`npm test` → **1730 Tests, 1730 pass, 0 fail** (9 neue).

### Live gegen Staging, 2026-08-11 — der Live-Lauf ist damit erledigt

**Startschuss.** 1 `ngsearch`, 28 Datensaetze, 28 Kandidaten, **28 uebernommen**,
`Startschuss + erster Takt: 1632 ms`. Warteschlange danach 0. Alle 28 Eltern sind
Skill-Ordner, keine Sammlung — genau wie am 2026-08-11 gemessen, und deshalb
harmlos: nachgeschlagen wird mit der Sammlungs-id.

**Suche „Optik", zwei Laeufe.** 1. Lauf **5731 ms**, 2. Lauf **1680 ms**,
`registryChecked: true` in beiden. Zwei Sammlungen, beide ohne Registry — korrekt,
es existiert noch keine. Der Aufschlag des ersten Laufs betraegt hier ~4,05 s fuer
zwei kalt aufgeloeste Sammlungen und liegt damit **ueber** den fruehen 1,0–1,4 s.
Eine einzelne Beobachtung, keine neue Messung: die Streuung auf Staging ist
dokumentiert gross (ein Lauf ohne Anreicherung brauchte am 2026-08-10 7,0 s).

**Der CRITICAL-Fix an echten Daten.** Ueber 152 verschiedene Sammlungen aus 8
Suchen gesucht; die groessten Dateilisten: **Museen 169**, Englisch 77,
**Fachportale 66**, Grundfragen 42. Drei davon liegen ueber
`REGISTRY_SCAN_MAX = 50` — der Fall ist also nicht exotisch, sondern trifft eine
Fachportal-Sammlung. Gegen „Museen" (169 Dateien):

```
warn  skill-registry: the file listing was cut short — "no registry" is not a finding of absence
      collectionId=40eb93f1… scanned=50 total=169 cap=50
ensureRegistries -> answered=0            (Frage bleibt offen, Hinweiszeile bleibt)
Eintrag: registry=null scanTruncated={"scanned":50,"total":169}
erneut  -> answered=0                     (gemerkt, kein zweiter Abruf)
```

Vor dem Fix waere genau diese Sammlung als „fuehrt keine Skill-Registry"
gecacht worden, `registryChecked` haette `true` gemeldet und der Hinweis auf
`get_skill_registry` waere verschwunden — fuer die volle TTL und bei jeder
Erneuerung neu bestaetigt.

### Offen

Nur noch der `:::`-Pfad: **0** Registries auf Staging, er wartet auf
Redaktionsarbeit, nicht auf Code.

---

## Vollstaendiger Live-Smoke gegen Staging (2026-08-11)

Alles einmal durchgetestet: 42 Werkzeuge, die REST-Schicht, beide Transporte,
die Schreibsperre, der Build. Ein Befund gefunden und behoben.

### Phase A — 28 Lese-Werkzeuge, live

Erster Durchgang 26/28 gruen; die zwei Fehlschlaege waren **falsche Argumente
des Testskripts**, nicht der Werkzeuge (`browse_collection_tree` und
`get_compendium_text` lehnten korrekt mit einer klaren Meldung ab). Ausserdem
war die entdeckte „Sammlungs-id" in Wahrheit eine Inhalts-id — vier
Sammlungs-Werkzeuge liefen damit ins Leere. Zweiter Durchgang mit einer echten
`ccm:map` aus dem Collections-Endpunkt: **8/8 gruen**. Damit **28/28**.

Auffaellige Laufzeiten (Staging): `search_wlo_all` 5,2 s · `search` 5,0 s ·
`get_topic_page_content` 5,1 s · `browse_collection_tree` (subject) 4,4 s.
Der Rest unter 2,6 s, `lookup_wlo_vocabulary` 2 ms (rein lokal).

### Phase B — die 14 Kurations-Werkzeuge verweigern

**14/14 verweigert**, jedes mit `_meta["mcp/www_authenticate"]`, jedes mit der
Dienstkonto-Begruendung (`WLO_ALLOW_SERVICE_WRITES` ist nicht gesetzt).
**Nichts geschrieben.** Das Skript bricht beim ersten hart ab, das nicht
verweigert — es brach zweimal ab, beide Male wegen ungueltiger Argumente von mir:
die **Schema-Validierung liegt vor der Sperre**, ein fehlerhafter Aufruf bekommt
also `-32602` statt der Anmelde-Aufforderung. Kein Mangel (geschrieben wird so
oder so nichts), aber gut zu wissen.

Alle 14 tragen die `oauth2`-Deklaration im Listing.

### Phase C — HTTP: REST, Discovery, statische Seiten, MCP

- `/health`, `/llms.txt`, `/launcher.html`, `/bookmarklet.md`, `/api/skills`,
  `/api/wikipedia`, `/api/search` (JSON/HTML/license), `/api/collection`,
  `/api/topic-page` — alle 200.
- **Lizenz-Offenlegung live bestaetigt:** `q=Optik` 756 Treffer, mit
  `license=OER` 280, und `content.licenseFilter = {checked: 110, kept: 84}`.
  Die HTML-Seite traegt die Saetze mit („… hatten nicht genau die Lizenz OER und
  wurden entfernt", „das Repository kann Lizenzen ohnehin nur als FAMILIE
  filtern"). Genau die Regel, die am 2026-08-09 auf zwei Pfaden verletzt war.
- **CORS-Grenze:** `/api/search` traegt `Access-Control-Allow-Origin: *`,
  `/auth` traegt **keinen** — wie die Regel es verlangt.
- Validierung: `/api/collection` und `/api/compendium` → 400 mit Begruendung,
  unbekannter Pfad → 404, `maxItems=9999` wird gekappt (count 8).
  `/api/search` **ohne** `q` antwortet 200 mit leerem Ergebnis statt 400 —
  abweichend von den anderen, aber harmlos.
- **MCP anonym:** `initialize` ok, `tools/list` → **42 Werkzeuge, davon 14
  Kurations-Werkzeuge** (die Entscheidung vom 2026-08-05 live bestaetigt),
  `tools/call` ok, `resources/list` → 4 Widgets.
- **Auth-Regeln:** ohne `Authorization` → **200**; `Bearer <muell>` → **401**
  mit `WWW-Authenticate: Bearer error="invalid_token"`. Ohne
  `WLO_AUTH_PRIVATE_KEY` antworten `/auth/public-key`, `/oauth/*` und beide
  Discovery-Dokumente 404 mit klarer Meldung; die `/auth`-Seite rendert, und der
  Client zeigt beim Absenden „Der Server bietet gerade keine Zugaenge an."
- **Der Cache startet aus `http.ts`** — im Log: 28 Datensaetze, 28 uebernommen.

### Phase D — stdio und Build

stdio-Handshake: `initialize` → wlo-mcp/2025-06-18, `tools/list` → 42,
`wlo_health_check` → ok. `npm run build` exit 0, Widgets gebuendelt
(browse/reading/search-results/topic-page).

### Der Befund: die Unsafe-Warnung feuerte pro ANFRAGE

Gemessen: **ein** Serverstart, **sechs** identische Warnungen fuer sechs
Anfragen. Der Kommentar an der Stelle sagt „at startup" — aber die Registrierung
laeuft je `createMcpServer()`, und der Streamable-HTTP-Transport baut einen je
Anfrage. Bei 120 rpm sind das 120 Zeilen je Minute; so hoert eine Warnung auf,
gelesen zu werden.

Behoben mit `logOnce`, **nach Werkzeugnamen** verschluesselt — ein ZWEITES
unsicheres Werkzeug muss weiterhin genannt werden, das ist der Sinn der Meldung.
Rot-gruen: 5 Registrierungen desselben Werkzeugs → vorher 5 Warnungen, jetzt 1;
ein zweites Werkzeug bekommt weiterhin seine eigene Zeile. Gegenprobe am
laufenden Server: **8 Anfragen, 1 Warnung** (vorher 6/6).

**Nachweis:** `npx tsc -p tsconfig.typecheck.json --noEmit` → 0 Fehler ·
`npm test` → **1731 Tests, 1731 pass, 0 fail** · `npm run build` → exit 0 ·
Serverlog waehrend des gesamten Laufs: **0 Fehler**.

Die Smoke-Skripte liegen unter `.claude/smoke/` (gitignoriert, nie im Repo).

---

## Restarbeiten nach dem Smoke — und eine Korrektur an mir selbst (2026-08-11)

### Die eine Beobachtung, die KEINE war

Ich hatte gemeldet, `/api/search` ohne `q` antworte „200 mit leerem Ergebnis"
statt 400, abweichend von den anderen Endpunkten. **Das war falsch, und mein
Testskript ist schuld:** es druckte 70 Zeichen des Bodys, also nie die
`warnings`. Der Quelltext entscheidet das ausdruecklich und begruendet es in
sieben Kommentarzeilen — KI-Fetch-Schichten strippen den Query-String, und ein
400 ist dort eine Sackgasse, weil Hosts den Status zeigen und nicht den Body.
Die Antwort ist ein Wegweiser-Umschlag mit `warnings: ['No search term
received.', '… nutze GET /api/search/<term> …']`, und sie kostet **0**
Upstream-Aufrufe (im Serverlog nachgezaehlt). Nichts zu beheben.

Lehre fuers naechste Smoke-Skript: einen Body abschneiden heisst, den Teil
wegzuwerfen, in dem die Erklaerung steht.

### Die eine, die eine war: gekappter Korpus ohne Ansage

`seedFromCorpus` liest **eine** Seite (`CORPUS_PAGE_MAX = 100`). Staging haelt
28, der Deckel greift also heute nicht — jenseits davon verlieren die
uebrigen Sammlungen still den Schnellpfad. Die Zahlen standen in einer
info-Zeile, nichts markierte die Ungleichung. Genau die unsichtbare
Unvollstaendigkeit, vor der dasselbe Modul an seinem Warteschlangen-Deckel und
an seinem Scan-Deckel warnt. Jetzt warnt es auch hier.

Rot-gruen: Korpus meldet `total: 250` bei 1 gelieferten Datensatz → vorher
**0** Warnungen, jetzt **1**, und sie nennt die 250. Gegenprobe am echten
Server: `records: 28, total: 28` → **0** Warnungen, wie es sein soll.

### Das Aufgabendokument war ein Vertrag, der log

47 offene Kaestchen und eine Fortschrittstabelle, die nur P1 als fertig fuehrte —
waehrend P2–P4 gebaut, getestet und dokumentiert sind. Dieselbe Drift wie
Befund 7 des Reviews, nur eine Datei weiter. Jede Aufgabe gegen ihr
Lieferergebnis geprueft (Dateien, Exporte, Aufrufstellen, Doku-Treffer), dann
abgehakt.

**Zwei Abweichungen dabei aufgefallen und im Dokument festgehalten** statt
stillschweigend mit abgehakt: T9 reichert **vier** Renderpfade an, nicht fuenf
(`tools/browse.ts` ist bewusst draussen), und aus dem Anfragepfad wurde
`ensureRegistries` statt nur `attachCachedRegistries`.

**Ein abgehakter Pruefschritt war wortwoertlich falsch formuliert:** T5 sagte
`grep WLO_REGISTRY_IN_SEARCH` → „nur CHANGELOG-Historie". Ausgefuehrt: kein
lebender Code, keine Tests — aber die Treffer stehen in den Plandokumenten und in
`STATUS.md`, nicht im CHANGELOG. Sache stimmt, Formulierung nachgezogen.

**Nachweis:** `npx tsc -p tsconfig.typecheck.json --noEmit` → 0 Fehler ·
`npm test` → **1732 Tests, 1732 pass, 0 fail** · Serverlog: 0 Fehler.

---

## Doku-Abgleich gegen die echten Werkzeuge (2026-08-11)

Auftrag: README und Doku an die aktuellen Tools und Schemata angleichen, plus
Hinweise zum Skill-Handling. Vorgehen: **erst die Grundwahrheit aus dem
laufenden Server** (`tools/list` samt Schemata), dann jedes Dokument dagegen
diffen — nicht lesen und glauben.

### Grundwahrheit

**42 = 28 lesend + 14 kuratierend.** Unter `WLO_SKILL_TOOL_MODE=one-tool` **41**
(gemessen, beide Modi gestartet), davon 22 bzw. 21 mit `outputFormat`.

### Was der Abgleich fand

| Klasse | Anzahl | Beispiel |
|---|---|---|
| Falsche Zahl | 12 | README.md widersprach sich selbst: „28 read tools" (Z. 10) vs. „27 MCP read tools" (Z. 65) vs. „registers all 39 tools" (Z. 934) |
| Falsche **Aussage** | 2 | „the same 25 public tools" / „die 27 oeffentlichen Werkzeuge" — anonym kommen **alle 42** |
| Fehlendes Werkzeug | 1 | `get_skill_registry` stand in **keinem** README |
| Erfundener Parameter | 2 | `search_wlo_collections` mit `userRole?`, `get_node_collections` mit `maxResults?` |
| Undokumentierter Schalter | 4 | `WLO_SKILL_TOOL_MODE`, `WLO_SKILL_CACHE` (**standardmaessig an**), `_REFRESH_MS`, `_TTL_MS` |

Die zwei falschen Aussagen wiegen schwerer als die zehn falschen Zahlen: sie
behaupten, anonyme Aufrufer saehen die Kurations-Werkzeuge nicht. Genau das
verbietet `docs-claims.test.ts` seit dem 2026-08-05 in Prosa — die Zahl schluepfte
daran vorbei. Beide Saetze sagen jetzt, was passiert und warum.

### Zwei Fehlalarme, die keine Befunde waren

`get_skill_for_task` sah wie ein Geist aus — ist aber der Ein-Werkzeug-Modus.
`wlo_register_usage` steht in `INTEGRATION.md` **korrekt** in einer „das tut der
Server nicht"-Liste samt Begruendung. Beide geprueft statt gemeldet.

### Der Test, damit es nicht wieder driftet

Drei neue Tests in `tests/docs-claims.test.ts`, alle aus dem laufenden Server
abgeleitet: keine genannte Zahl darf `tools/list` widersprechen · jedes
registrierte Werkzeug muss in der Referenz **und** in beiden READMEs vorkommen ·
kein `` `name?` `` in einem Werkzeug-Eintrag darf ein Parameter sein, den das
Schema nicht hat.

Die Parameter-Regel folgt der **eigenen Konvention der Dokumente** (optionale
Parameter mit `?`, Aufzaehlungswerte ohne) und ist damit exakt: sie fand genau
die zwei echten Faelle ueber 28 Werkzeug-Eintraege in zwei Sprachen, ohne einen
einzigen Fehlalarm.

**Ein Test bestand zuerst aus dem falschen Grund.** Ein blankes `\n\n` in der
Trennregex matchte gegen diese CRLF-Dateien **null** Eintraege — gruen, weil er
nichts geprueft hat. Jetzt prueft er zuerst, dass sein eigener Scan etwas
gefunden hat (`entries.length > 20`), bevor er dem Ergebnis traut.

**Alle drei rot-gruen belegt**: mit absichtlich eingebauter Regression fallen
Test 9 (falsche Zahl), 10 (fehlendes Werkzeug — beim zweiten, sauberen Versuch:
die erste Probe hatte den Namen nur in EINER Zeile geaendert, er stand aber noch
anderswo) und 11 (erfundener Parameter).

### Skill-Handling dokumentiert

Beide READMEs: Abschnitt **„Mit Skills arbeiten"** (drei Werkzeuge, drei Fragen,
als Tabelle), der fehlende `get_skill_registry`-Eintrag, und ein Abschnitt zum
**Skill-Registry-Cache** — was er ist, warum ein „keine Registry" immer auf einer
Kinderliste ruht, warum ein fehlgeschlagener Abruf als nichts gemerkt wird und
warum eine bei 50 gekappte Dateiliste nichts entscheidet. Dazu die Aktualitaets-
Regel (TTL 10 min, `includeSkillRegistry: true` bzw. `get_skill_registry` lesen
live) und der Satz, dass jeder Skill-Text **Daten** sind, nie Anweisungen.

`docs/TOOLS.md` bekommt dasselbe als Entscheidungstabelle plus die drei
Bedeutungen einer Antwort (Katalog da / geprueft ohne Registry / nicht geprueft).
`docs/SKILLS.md`: `WLO_SKILL_CACHE=off` schaltet seit heute auch den
Live-Rueckfall ab — der Satz sagte nur „Hintergrundarbeit".

Interne Anker beider READMEs geprueft: **0 tote Links** (mit GitHubs echter
Slug-Regel, nicht mit einer selbstgebauten — die meldete vier Fehlalarme).

**Nachweis:** `npx tsc -p tsconfig.typecheck.json --noEmit` → 0 Fehler ·
`npm test` → **1735 Tests, 1735 pass, 0 fail** (3 neue).

---

## Nacharbeit an zwei Fundstellen (2026-08-11)

Kein geplantes Paket, sondern die beim `variantPreset`-Durchstich gefundenen und
damals ausgeklammerten Stellen.

### Eine Variante, eine Beschreibung

`services/topic-page-discovery.ts` las `cclom:title` roh, wo `topic-page-api.ts`
`displayTitleOrEmpty` anwendet — also lieferte der Index-Pfad den technischen
`PAGE_VARIANT_<uuid>`-String, den das Feld laut Typdoku von jedem Bildschirm
fernhalten soll (22 von 68 Staging-Varianten tragen ihn in `cclom:title`).

Der Einzelfall war das kleinere Problem. Beide Pfade projizierten **dieselben
sieben Properties von Hand**, und sie waren genau auf dem einen Feld
auseinandergelaufen, das eine Regel statt eines Lesevorgangs braucht. Sichtbar
wurde es nicht, weil `pickThemePageTitle` stromabwärts nochmal prüft — der
gebrochene Vertrag saß einen Konsumenten vor einem echten Fehler.

Behoben durch **eine** Projektion, `variantFields` in `topic-page-api.ts`, neben
`variantMatchesFilters` und aus demselben Grund. Seitenbezogene Fakten
(`topicPageUrl`, `collectionId`, `collectionName`, `isDefault`) bleiben bewusst
draußen: die beiden Routen erfahren sie tatsächlich verschieden.

Neuer Wächter in `tests/shared-rule-discipline.test.ts` (Marker `variantName:`,
Owner `topic-page-api.ts`) — durch injizierte Verletzung geprüft, er nennt Datei
und Zeile. Neuer Vertragstest `tests/topic-page-variant-fields.test.ts` schickt
dieselbe Variante durch beide Routen und vergleicht.

### 19 Konzepte hießen falsch

`labels[0]` macht zwei Jobs — Anzeigeform und Match-Alias — und war für den
Match-Teil kleingeschrieben, während `labelFromUri` nur den ersten Buchstaben
großzieht. Ergebnis in **jeder** Trefferliste (Fach und Bildungsstufe stehen an
jedem Knoten): `Sekundarstufe i`, `Deutsch als zweitsprache`, `Mint` für MINT.

Gegen die SKOS-Quelle abgeglichen: **19 von 116** Konzepten betroffen, eines
darüber hinaus falsch — `Umweltgefährdung, Umweltschutz` hatte das Komma
verloren. Anzeigeformen kommen jetzt aus dem offiziellen deutschen prefLabel.
Das Matching bleibt unberührt (alle Vergleiche lowercasen beidseitig); das eine
Label, das sich um mehr als Groß-/Kleinschreibung ändert, behält die alte
Schreibweise als Alias.

Gemessen, nicht geraten: mein erstes Suchmuster fand 17 der 19 — es verpasste
`Alt-Griechisch` und `MINT`.

**Nachtrag am selben Tag, und er korrigiert den Absatz, der hier stand.** Der
erste Durchgang prüfte nur zwei der sechs Tabellen gegen die offizielle Quelle,
weil das Messskript einen Vokabelschlüssel abfragte, den es nicht gibt
(`learningResourceType` statt `lrt`) und den Wurf in einem `catch { continue }`
verschluckte — genau die Sorte Fehler, die die Workflow-Skill verbietet. Die
Nachprüfung über **alle** Tabellen fand 4 weitere, alle im aggregierten
LRT-Vokabular: `Interaktives medium`, `Projekt-material`, `Entdeckendes lernen`,
`Kreative aktivität`. Damit **23 von 152**.

Und es gibt nun doch einen **Wächter**: die Heuristik trägt, sobald sie nur
deutsche Funktionswörter (`und`, `als`, `für`, …) ausnimmt statt Ad-hoc-Begriffe.
Über alle sechs Tabellen 0 Fehlalarme; durch injiziertes `Darstellendes spiel`
geprüft, er nennt das Konzept. Die gestrige Begründung („eine Heuristik trügt")
galt für ein Muster, das ich nicht zu Ende gedacht hatte.

Zwei Dinge, die der zweite Durchgang als **Nicht-Befund** belegt hat. Neun
aggregierte LRT-Anzeigeformen sind absichtlich verkürzt (`Tests` für `Tests /
Fragebögen`), und **jeder** weggelassene Teil existiert als Alias — die Kurzform
ist eine gepflegte Entscheidung, ihre Verlängerung wäre Geschmack gegen eine
funktionierende Wahl. Nur die Groß-/Kleinschreibung wurde geheilt. Und
`vocabs-lrt.ts` ist eine wortgetreue Kopie seiner Quelle: **220 von 220** Labels
identisch — deshalb ist die handgepflegte aggregierte Tabelle die Ausnahme.

Wo das überhaupt sichtbar ist, war eine eigene Messung wert: `formatNode`
bevorzugt den Server-`_DISPLAYNAME` und fällt nur auf unsere Tabelle zurück, eine
normale Trefferliste trägt also meist das Repository-Label. Allein aus unserer
Tabelle kommen Facetten, Lizenz, `lookup_wlo_vocabulary` und die
Themenseiten-Felder aus rohen URIs — `variantPreset.educationLevelLabels`
darunter. Ein Kommentar, der „in jeder Trefferliste" behauptete, ist entsprechend
korrigiert.

Beide Wirkungsorte sind inzwischen **gemessen**, nicht nur hergeleitet:
`lookup_wlo_vocabulary(lrt)` liefert alle vier korrigierten Labels, und die
Facetten — die einzige Stelle ganz ohne `_DISPLAYNAME` — zeigen
`Sekundarstufe I (22 504)`, `Sekundarstufe II (17 181)`, `Berufliche Bildung
(1 838)`. Der erste Versuch hatte keine Facetten zurückbekommen; das lag an
meinem `_queryMeta`-Parsing, nicht am Server.

Die beiden **generierten** Tabellen wurden zum Abschluss ebenfalls gegen ihre
Quelle gestellt und sind sauber: `vocabs-lrt.ts` 220/220, `vocabs-hochschule.ts`
344/344 identisch. Damit ist jede Vokabeltabelle des Projekts geprüft, und der
Defekt saß ausschließlich in der handgepflegten.

### Alle Label-Konsumenten geprüft, plus eine ungeschützte Invariante

Zum Abschluss jeder Aufrufer von `labelFromUri`/`listVocab`/`resolveVocab`
durchgesehen. Zwei waren noch nicht betrachtet und beide sind unberührt:
`services/write/fields.ts` liest nur URIs, und `vocab-suggest.ts` lowercased vor
dem Levenshtein-Vergleich, sodass die neuen Großbuchstaben keine Distanz
verschieben. Sein `capitalize` schreibt nur den ersten Buchstaben groß und lässt
den Rest stehen — hätte es `toLowerCase()` auf den Rest angewandt, wäre der Fix
im Vorschlagspfad wieder verloren gegangen.

Dabei fiel auf, dass die Eigenschaft, auf der das ruht, **nirgends geprüft** war:
ein Vorschlag muss zurück auflösen. „Meinten Sie X" ist wertlos, wenn X eingetippt
nicht erkannt wird — und weil `capitalize` den Vorschlag verändert, ist er nie
wörtlich ein Tabelleneintrag. Zwei Tests decken das jetzt über die **vollen**
Tabellen ab (152 + 220 Konzepte, jedes Label und jeder Alias als Eingabe).

Der zweite war sofort rot, und das war ein Testfehler: `resolveLrt` antwortet für
`Suchmaschine` mit `ambiguous`, weil zwei der 220 Labels von verschiedenen
Konzepten geteilt werden und der Resolver bewusst beide Kandidaten meldet, statt
den ersten zu wählen. Erkannt-aber-mehrdeutig ist kein Fehlschlag; nur `unknown`
ist einer.

Beide Wächter beschossen — und der Beschuss korrigierte meinen eigenen Kommentar.
Ein **durchgehend** case-sensitiver Resolver lässt den Test an `Sekundarstufe I`
scheitern. Ein nur im EXAKT-Pfad case-sensitiver **nicht**: der Fuzzy-Fallback
(`includes`) antwortet weiter, exakte Auflösung degradiert also still zu Fuzzy.
Diese Maskierung hat einen Boden — der Fuzzy-Zweig verlangt vier Zeichen auf
beiden Seiten. Der Kommentar sagt das jetzt, statt mehr zu behaupten, als der
Test leistet.

**Beobachtung ohne Codeänderung** (der Mechanismus ist vorhanden und
dokumentiert): die `discipline`-Facette liefert kollidierende Labels — für
`Mathematik` drei Buckets mit demselben Text (38 284 / 16 599 / 380) und drei
verschiedenen URIs, 5 von 100 Buckets betroffen. `resolveFacetCounts` gibt die
URI je Bucket mit, und die Werkzeugbeschreibung nennt genau diesen Weg. Sie
erwähnt allerdings nur die Kollision Schule↔Hochschule; zwei der drei
`Mathematik`-Buckets sind **beide** Hochschulkonzepte (`n37`, `n105`).

Der Test, der die Wirkung belegte, war der aus der Vorsitzung: er hatte
`Sekundarstufe i` als gemessene Realität festgenagelt und schlug fehl.

**Nachweis:** `npx tsc -p tsconfig.typecheck.json --noEmit` → 0 Fehler ·
`npm test` → **1757 Tests, 1757 pass, 0 fail** (9 neue) · `npm run build` → exit 0
· Live gegen Staging: 4 Seiten über beide Routen verglichen, identisch;
`Sekundarstufe I` 14×, `Sekundarstufe II` 7×, `Berufliche Bildung` 4× in echter
Ausgabe, keine kleingeschriebene Fortsetzung mehr. Die eine Seite, die Modus A
nicht fand, ist belegtes Verhalten: ihre Varianten liegen in einem abgelösten
page-config-Folder (`d68edc17`), während die Sammlung `e51327a5` als aktiven Ref
führt — beide korrekt `isDefault=false`.

### Split von `topic-page-api.ts` (2026-08-11, auf Zuruf mit Vorbehalt)

Freigegeben unter „wenn sinnvoll und ohne Nachteile" — also erst gemessen, dann
gemacht. Was den Ausschlag gab, war nicht die Zeilenzahl: **8 der 13 Importeure
brauchten nur die Regel-Hälfte** (ein Typ, ein Filterprädikat, eine
Property-Liste) und zogen dafür das HTTP-Modul mit. Einer dieser acht war
`topic-page-title.ts`, dessen Typ-Import zurück auf das Modul zeigte, das es
selbst importiert — der einzige Import-Zyklus in dieser Ecke.

Neu: `src/topic-page-variant.ts` (189 Zeilen) — `TOPIC_PAGE_PROPS`,
`ThemePageInfo`, `VariantFields`, `variantFields`, `variantMatchesFilters`,
`isUsableVariant`, `pickThemePageTitle`. `topic-page-api.ts` 389 → 248 Zeilen,
nur noch Repository-Aufrufe. `topic-page-title.ts` 47 Zeilen und **0 Importe**:
`pickThemePageTitle` ist zu dem Typ gezogen, auf dem es arbeitet, damit ist der
Zyklus aufgelöst. `tools/shared.ts` re-exportiert es unverändert, also hat sich
für kein Werkzeug etwas geändert — und der Satz in CLAUDE.md über die
Tool-Layer-Helfer bleibt wahr.

`TOPIC_PAGE_PROPS` liegt bewusst neben `variantFields`: wer ein Feld in die
Projektion aufnimmt, ohne es in die Property-Liste zu schreiben, liest leer
zurück, ohne dass etwas fehlschlägt. In einem kleinen Modul ist diese Kopplung
sichtbar.

Kein Barrel. Jeder Importeur nennt jetzt das Modul, von dem er wirklich abhängt
— 13 Importzeilen, mechanisch, vom Typechecker abgesichert. Zwei
Off-by-One-Fehler beim Verschieben (eine schließende Klammer im falschen Modul)
hat `tsc` sofort gemeldet.

Der Disziplin-Wächter aus der Fehlerbehebung hat den Umzug bemerkt und musste
seinen Owner nachziehen — genau sein Zweck.

**Nachweis:** `npx tsc -p tsconfig.typecheck.json --noEmit` → 0 Fehler ·
`npm test` → **1757 Tests, 1757 pass, 0 fail** · `npm run build` → exit 0 ·
Live gegen Staging: derselbe Vergleich über beide Suchrouten wie vor dem
Umbau, vier Seiten identisch.

### Review der Sitzung und vier behobene Befunde (2026-08-11)

Strukturierter Review über ca. 450 geänderte Codezeilen: 0 kritisch, 0 major,
3 minor, 1 NIT — alle vier behoben.

**(1) Drei tote Importe** in `topic-page-api.ts` (`DISPLAY_PROPS`,
`parseVariantPreset`, `VariantPreset`), Rückstand des Splits. Der Standard-
Typecheck erfasst das nicht; erst `--noUnusedLocals` zeigt es. Das war der eine
echte Nachteil, den der Split hinterlassen hatte.

**(2) Falscher Modulkopf** in `topic-page-title.ts`: nannte `topic-page-api.ts`
als Konsumenten, obwohl das Modul es seit dem Split nicht mehr importiert —
CLAUDE.md sagte es bereits richtig, Code-Kommentar und Projektdoku widersprachen
sich also. Korrigiert, plus ein Satz, warum diese Datei nichts importiert.

**(3) `ThemePageInfo.isTemplate` war ein totes Feld** und ist entfernt: nirgends
gelesen, hart auf `false` gesetzt, obwohl der Node `ccm:page_variant_is_template`
trägt. In einer Funktion, die laut Doku „den Node auf seine Felder projiziert",
ist ein erfundener Wert das falsche Signal — für einen Template-Node wäre `false`
schlicht gelogen. Templates werden weiter oben ausgeschlossen (`searchPageVariants`
sendet das Kriterium, die Sammlungsroute filtert mit `isUsableVariant`); ein
Kommentar an der Fundstelle sagt das, damit die Konstante nicht zurückkehrt.
Sechs Fixtures zogen nach, vom Typechecker gefunden.

**(4) `displayLabel` vereinheitlicht** (NIT): `labelFromUri` hatte den
Uppercase-Guard, `listVocab` nicht. Die beiden konnten für jedes Label
auseinanderlaufen, das klein beginnt und Großbuchstaben enthält („eLearning" →
„eLearning" vs. „ELearning"). Kein solcher Eintrag existiert — genau deshalb wäre
die Divergenz erst nach dem Hinzufügen aufgefallen. Jetzt eine Funktion, damit
strukturell garantiert.

Ein Verdacht wurde geprüft und **verworfen**: `suggestVocab` liefert den
matchenden Begriff statt des primären Labels („Grundschule" statt
„Primarstufe"). Der Testkommentar verlangt genau das ausdrücklich — es ist eine
Entscheidung, kein Fehler.

**Nachweis:** `npx tsc -p tsconfig.typecheck.json --noEmit` → 0 Fehler (auch mit
`--noUnusedLocals`, bis auf drei vorbestehende `url`-Parameter in Tests) ·
`npm test` → **1757 Tests, 1757 pass, 0 fail** · `npm run build` → exit 0 ·
Live gegen Staging: vier Seiten über beide Suchrouten identisch, Labels korrekt.
