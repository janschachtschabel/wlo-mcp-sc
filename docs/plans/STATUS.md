# WLO MCP Apps-SDK Rebuild — Status

Living progress tracker for the [design](2026-07-15-wlo-mcp-apps-sdk-rebuild.md)
+ [tasks](2026-07-15-wlo-mcp-apps-sdk-tasks.md). Updated at the end of each
package (phase). A fresh context resumes from: CLAUDE.md → this file → the
design/tasks docs.

**Working directory:** `C:\Users\jan\staging\Windsurf\wlo-mcp-server-sc`
**Process:** one package = one phase; after each, update this file + hand off for
a context reset (see the workflow block in CLAUDE.md).

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
