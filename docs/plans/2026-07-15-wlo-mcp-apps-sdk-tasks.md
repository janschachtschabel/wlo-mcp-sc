# Tasks: WLO MCP Server — Apps-SDK Rebuild

Companion to [the design doc](2026-07-15-wlo-mcp-apps-sdk-rebuild.md). Executed
with `/better-coding-workflow` (TDD). Dependency-ordered; phases are milestones
that each ship working, testable software.

**Task-detail convention (right-sizing for a large plan):** each task gives
exact files, the interface/signature, concrete steps, and a verification
command. `/better-coding-workflow` expands each task's implementation step into
its full TDD micro-steps (failing test → minimal code → green → commit) at
execution time — the per-phase *step 0* refresh exists for exactly that. No
task defers a *decision* (no "add validation" placeholders); the *what* is
fixed here, the *keystrokes* are produced at execution.

Legend: ⟂ = parallelizable within its phase. All paths relative to repo root.

---

## Phase 0 — Groundwork & green baseline
Step 0: invoke `/better-coding-workflow` (skills unload — reload before coding)

### Task 0.1 — Establish a green baseline
- **Files:** none (verification only).
- **What:** `npm install` in `wlo-mcp-server-sc`; confirm `npm run build` and
  `npm test` pass before any change, so later regressions are attributable.
- **Verification:** `npm run build` exits 0; `npm test` — all existing tests
  pass. Record counts in the commit message of Task 0.2.
- **Rollback:** n/a.

### Task 0.2 — Add esbuild dev-dependency + widget build script stub
- **Files:** Modify `package.json` (devDeps `esbuild`; scripts
  `"build:widgets": "node src/apps/widgets/build.mjs"`, and `"build"` chains it).
  Create `src/apps/widgets/build.mjs` (no-op that logs "no widgets yet").
- **What:** Wire the widget build pipeline ahead of Phase 4 so `npm run build`
  stays one command. Pin `esbuild` to a specific version.
- **Verification:** `npm install` succeeds; `npm run build:widgets` prints the
  stub line; `npm run build` still exits 0.
- **Rollback:** revert `package.json`, delete `build.mjs`.

---

## Phase 1 — Internal enablers (no new tools; existing tools improved)
Step 0: invoke `/better-coding-workflow`

### Task 1.1 ⟂ — Compendium in DISPLAY_PROPS
- **Files:** Modify `src/wlo-api.ts` (DISPLAY_PROPS array); Test
  `tests/wlo-api.test.ts`.
- **Interfaces:** none change.
- **What:** Add `'ccm:oeh_collection_compendium_text'` to `DISPLAY_PROPS` so
  collection searches/browse carry the compendium without an extra call.
  `renderToText` already truncates it to 500 chars (formatter.ts:261).
- **Steps:** test asserts `DISPLAY_PROPS.includes('ccm:oeh_collection_compendium_text')`
  and that `formatNode` on a node with that property surfaces `compendiumText`.
- **Verification:** `node --import tsx --test tests/wlo-api.test.ts` green.
- **Rollback:** remove the array entry.

### Task 1.2 — Levenshtein util + `suggestVocab`
- **Files:** Create `src/vocab-suggest.ts` (`levenshtein(a,b): number`,
  `suggestVocab(input, vocab): string[]`); Test `tests/vocab-suggest.test.ts`.
- **Interfaces:** `export function suggestVocab(input: string, vocab: VocabKey): string[]`
  — ≤3 labels, Levenshtein ≤2 first, then substring match; reads `listVocab`.
- **What:** Pure suggestion helper (no I/O) for unresolved filter values.
- **Steps:** test: `suggestVocab('Grundshule','educationalContext')` → includes
  `'Grundschule'`; unknown gibberish → `[]`.
- **Verification:** targeted test green.
- **Rollback:** delete both files.

### Task 1.3 — Surface suggestions in `buildFilterCriteria` + tool text
- **Files:** Modify `src/tools/shared.ts` (`unresolved` entries gain
  `suggestions: string[]`; add a `formatUnresolvedHint(unresolved): string`);
  Modify `src/tools/content-search.ts` + `collections.ts` to append the hint to
  the main text (not only `_queryMeta`); Test `tests/tools-shared.test.ts`.
- **Interfaces:** `unresolved: { field: string; value: string; suggestions?: string[] }[]`.
- **What:** When a vocab filter doesn't resolve, attach up to 3 suggestions and
  print `⚠ Filter "X" für <field> nicht erkannt. Meintest du: A, B?` in output.
- **Steps:** test asserts the suggestion field is populated and the hint string
  renders for an unresolvable discipline.
- **Verification:** shared + content-search tests green.
- **Rollback:** revert the three files.

### Task 1.4 — Extract `resolveTopicPageSwimlanes` service
- **Files:** Create `src/services/topic-page.ts` (move the JSON-mode swimlane
  resolution out of `src/tools/topic-page-content.ts`); Modify
  `topic-page-content.ts` to call it; Test `tests/services-topic-page.test.ts`.
- **Interfaces:** `export interface SwimlanePayload { variantId; collectionId;
  variantTitle; topicPageUrl; swimlaneCount; swimlanesTotal; swimlanes:
  {heading;type;items:FormattedNode[];hasMore:boolean}[] }`;
  `export function resolveTopicPageSwimlanes(struct, maxPerSwimlane): Promise<SwimlanePayload>`.
- **What:** Make the swimlane resolver reusable by `search_wlo_all` and
  `search_wlo_topic_pages`. Behaviour-preserving extraction (MAX_LANES=12, cap logic intact).
- **Steps:** move logic; test with `fetchMock` reproduces the existing
  `get_topic_page_content` JSON payload for a fixture.
- **Verification:** new test green **and** existing topic-page tests unchanged.
- **Rollback:** re-inline into the tool.

### Task 1.5 ⟂ — `skipCount` for `search_wlo_content`
- **Files:** Modify `src/tools/content-search.ts` (add `skipCount` param, pass
  as `from` to `enhancedSearch`/`ngsearch` + `_queryMeta.pagination.skipCount`);
  Test `tests/content-search.test.ts`.
- **Interfaces:** `skipCount: z.number().int().min(0).optional().default(0)`.
- **What:** Enable "more results" paging on content search.
- **Verification:** test asserts `skipCount:8` requests offset 8 (mock assertion).
- **Rollback:** remove the param.

---

## Phase 2 — New tools + `search_wlo_all` enrichment (as services)
Step 0: invoke `/better-coding-workflow`

### Task 2.1 — Wikipedia API client
- **Files:** Create `src/wikipedia-api.ts`; Test `tests/wikipedia-api.test.ts`
  (via `fetchMock`).
- **Interfaces:** `fetchWikipediaSummary(query, lang='de', sections=1): Promise<WikiSummary|null>`
  — REST `.../page/summary/{title}`; opensearch fallback for title
  resolution; sets `User-Agent`; honors `WLO_FETCH_TIMEOUT_MS`; returns `null`
  on 404/no article.
- **What:** External knowledge retrieval, isolated from WLO tools.
- **Steps:** test: mocked summary → `{title,extract,url,lang}`; 404 → `null`;
  fallback path resolves a title then summary.
- **Verification:** targeted test green.
- **Rollback:** delete files.

### Task 2.2 ⟂ — `get_wikipedia_summary` tool
- **Files:** Create `src/tools/wikipedia.ts` (`registerWikipediaTool`); Modify
  `src/server.ts` (register); Test `tests/tools-wikipedia.test.ts`.
- **Interfaces:** input `{query, language?, sections?}`; output markdown/json;
  `annotations.readOnlyHint=true, openWorldHint=true`.
- **What:** MCP wrapper over `fetchWikipediaSummary`; "Use this when… Do not use
  for WLO material search."
- **Verification:** tool returns extract for a mocked query; `server.test.ts`
  sees the new tool in `tools/list`.
- **Rollback:** unregister + delete.

### Task 2.3 — `getCompendiumTexts` service + `get_compendium_text` tool
- **Files:** Create `src/services/compendium.ts` + `src/tools/compendium.ts`;
  Modify `src/server.ts`; Tests `tests/services-compendium.test.ts`,
  `tests/tools-compendium.test.ts`.
- **Interfaces:** `getCompendiumTexts(nodeIds: string[]): Promise<CompendiumEntry[]>`
  using `getNodesMetadata` (`-all-`, full text, **not** truncated); tool input
  `{nodeId?|nodeIds?:string[].max(25)}`.
- **What:** Dedicated full-compendium retrieval (bulk, bounded concurrency);
  `compendiumText:null` when absent.
- **Verification:** service returns full text for a fixture with the property,
  `null` without; tool validates ≤25 ids.
- **Rollback:** delete files + unregister.

### Task 2.4 — `searchWithinCollection` service + `search_wlo_within_collection` tool
- **Files:** Create in `src/services/search.ts` + `src/tools/collections.ts`
  (register); Test `tests/services-search-within.test.ts`.
- **Interfaces:** `searchWithinCollection({nodeId, query, ...filters, maxResults, skipCount})`
  — `ngsearch` scoped by the collection subtree (criterion on
  `virtual:primaryparent_nodeid` / recursive contents + filter), reusing
  `buildFilterCriteria`.
- **What:** Filtered search inside one collection ("all videos on X in the
  Biology collection").
- **Verification:** test asserts scope criterion + filters are applied.
- **Rollback:** delete + unregister.

### Task 2.5 — `searchAll` service (extract + enrich)
- **Files:** Create `src/services/search.ts::searchAll`; Modify
  `src/tools/content-search.ts` (`search_wlo_all` delegates to it); Test
  `tests/services-search-all.test.ts`.
- **Interfaces:** `searchAll(options: SearchAllOptions): Promise<SearchAllEnvelope>`
  (see design doc). New flags default `false`/`0`.
- **What:** Move the current `search_wlo_all` body into the service, then add
  the parallel enrichments: `includeCompendium` (full-metadata fetch per
  collection via `getCompendiumTexts`), `includeTextContent` (`mapPool`, 4000-cap),
  `includeWikipedia` (`fetchWikipediaSummary` in the parallel block),
  `includeTopicPageContent` (`resolveTopicPageSwimlanes` per topic page, capped),
  `skipCount`.
- **Steps:** first a behaviour-preserving extraction test (envelope identical to
  today for default flags), then one test per flag.
- **Verification:** default-flag envelope byte-identical to pre-change fixture;
  each flag adds its field; existing `content-search.test.ts` green.
- **Rollback:** re-inline; flags are additive so revert is clean.

### Task 2.6 ⟂ — `search_wlo_topic_pages` +includeContent/maxPerSwimlane
- **Files:** Modify `src/tools/topic-pages.ts`; Test `tests/topic-pages.test.ts`.
- **Interfaces:** `includeContent: boolean=false`, `maxPerSwimlane: int 1..10 =3`;
  when set (JSON mode), attach `content: SwimlanePayload` per page via
  `resolveTopicPageSwimlanes` (bounded `mapPool`, ≤5 parallel).
- **Verification:** test asserts swimlanes attached only when `includeContent`.
- **Rollback:** remove params.

### Task 2.7 ⟂ — `browse_collection_tree` +includeContentPreview
- **Files:** Modify `src/tools/browse.ts`; Test `tests/browse.test.ts`.
- **Interfaces:** `includeContentPreview: int 1..5` (optional); per sub-collection
  attach first N content items (`getCollectionContents`, `mapPool` bounded).
- **Verification:** test asserts preview items attached per node when set.
- **Rollback:** remove param.

---

## Phase 3 — Apps-SDK foundation (structured content + metadata + search/fetch)
Step 0: invoke `/better-coding-workflow`
Step 0b: research — WebFetch "Build your ChatGPT UI" + "Connect from ChatGPT" pages; record the exact `window.openai` surface + connect steps into the design doc's References.

### Task 3.1 — `registerWloTool` seam + outputSchemas
- **Files:** Create `src/apps/register.ts`, `src/apps/outputSchemas.ts`; Test
  `tests/apps-register.test.ts`.
- **Interfaces:** `registerWloTool(server, def: WloToolDef)` (design doc);
  zod `outputSchema`s for search-all envelope, node list, swimlane payload,
  browse tree.
- **What:** One place that attaches `outputSchema`, `annotations`, `_meta.ui.*`
  and returns `content`(text, back-compat) **+** `structuredContent`.
- **Verification:** a tool registered via the seam appears in `tools/list` with
  `annotations` + `outputSchema`; returns both content and structuredContent.
- **Rollback:** delete; tools keep using `server.tool` directly.

### Task 3.2 — Migrate display tools to emit `structuredContent`
- **Files:** Modify `search_wlo_all`, `search_wlo_content`, `search_wlo_collections`,
  `get_topic_page_content`, `browse_collection_tree`, `get_subject_portals`
  to also return `structuredContent` (the existing envelope) via the seam;
  Tests updated per tool.
- **What:** Model reads structured JSON; widgets (Phase 4) consume the same. Text
  output preserved for non-Apps clients (regression gate).
- **Verification:** each tool's test asserts `structuredContent` matches schema
  AND legacy text still present.
- **Rollback:** seam returns only text (flag).

### Task 3.3 — Tool descriptions + annotations pass ("Use this when… / Do not use for…")
- **Files:** Modify all `src/tools/*` descriptions; add `annotations`
  (`readOnlyHint:true` for all retrieval tools; `openWorldHint:true` for wikipedia).
- **What:** Apps-SDK metadata discipline for correct selection among 16+ tools;
  disambiguate overlapping tools explicitly.
- **Verification:** `server.test.ts` asserts every tool has a non-empty
  description starting with "Use this when" and correct `readOnlyHint`.
- **Rollback:** revert strings.

### Task 3.4 — Server `instructions` block
- **Files:** Create `src/apps/instructions.ts`; Modify `src/server.ts`
  (`new McpServer({..., instructions})`); Test `server.test.ts`.
- **What:** Cross-tool guidance (first 512 chars self-contained): when to use
  the fast path (`search_wlo_all` + flags) vs. deep-dive tools vs. `search`/`fetch`.
- **Verification:** server advertises non-empty `instructions`.
- **Rollback:** remove field.

### Task 3.5 — `search` + `fetch` knowledge tools
- **Files:** Create `src/tools/knowledge.ts`; Modify `src/server.ts`; Test
  `tests/tools-knowledge.test.ts`.
- **Interfaces:** `search(query)` → `structuredContent {results:{id,title,url}[]}`
  **and** `content[0].text` = same JSON; `fetch(id)` →
  `{id,title,text,url,metadata}` likewise. Reuse `searchAll`/node-detail services.
- **What:** ChatGPT company-knowledge convention → first-class WLO knowledge source.
- **Verification:** shapes exactly match; JSON duplicated in `content[0].text`;
  `readOnlyHint:true`.
- **Rollback:** delete + unregister.

### Task 3.6 — Manual validation gate (ChatGPT developer mode via ngrok)
- **Files:** none (evidence task); note results in the design doc.
- **What:** Run `http.ts`, tunnel `ngrok http`, connect in ChatGPT developer
  mode, run a golden-prompt set (5 direct/5 indirect/negatives), confirm tool
  selection + structuredContent render. **Confirms R1 (SSE).**
- **Verification:** screenshot + notes; if SSE required, set the `http.ts`
  real-SSE flag (Phase 8 default).
- **Rollback:** n/a.

---

## Phase 4 — Apps-SDK widget suite (UI) — pair `/better-coding-frontend`
Step 0: invoke `/better-coding-workflow` **and** `/better-coding-frontend`

### Task 4.1 — Widget build pipeline (esbuild inline → ui:// resources)
- **Files:** Implement `src/apps/widgets/build.mjs` (esbuild bundle+inline each
  widget's `main.ts`+`styles.css` into `dist-widgets/<name>.html`); Create
  `src/apps/resources.ts` (`registerWidgetResource`, MIME
  `text/html;profile=mcp-app`, versioned `ui://widget/<name>-<hash>.html`).
- **Verification:** `npm run build:widgets` emits inlined HTML (no external
  `<script src>`); resource registered + fetchable in a unit test.
- **Rollback:** revert to stub.

### Task 4.2 — Shared tile component (W3)
- **Files:** Create `src/apps/widgets/tile/` (renders a `FormattedNode`:
  preview image w/ alt text + icon fallback, title, ≤160-char description,
  chips for discipline/level/type, license/publisher, open link). Theme via
  Apps-SDK CSS vars.
- **What:** The reusable card used by W1/W2/W4. WCAG AA, no nested scroll, ≤2 actions.
- **Verification:** render fixture in a jsdom/DOM test; alt text present; contrast
  tokens used.
- **Rollback:** delete dir.

### Task 4.3 — W1 combined search-results widget
- **Files:** `src/apps/widgets/search-results/`; wire `_meta.ui.resourceUri` on
  `search_wlo_all`; set `_meta.ui.csp`/`domain`.
- **What:** Three sections (Themenseiten / Sammlungen / Inhalte) of tiles from
  `structuredContent`; collections emphasized.
- **Verification:** loads `toolOutput` fixture → renders 3 buckets; CSP lists
  edu-sharing + image hosts.
- **Rollback:** remove resourceUri.

### Task 4.4 — W4 topic-page (swimlane) widget
- **Files:** `src/apps/widgets/topic-page/`; wire on `get_topic_page_content`.
- **What:** Swimlanes with heading + horizontal tiles + "more on topic page" link.
- **Verification:** SwimlanePayload fixture renders lanes; hasMore link present.
- **Rollback:** remove resourceUri.

### Task 4.5 — W2 interactive hierarchical browse widget
- **Files:** `src/apps/widgets/browse/`; wire on `get_subject_portals` /
  `browse_collection_tree`.
- **What:** Subject portals → drill into topic tree → content, using
  `window.openai.callTool('browse_collection_tree', {nodeId})` for expansion and
  `setWidgetState`/`widgetState` for the open path; `displayMode`/`maxHeight`
  responsive. Most complex — built last.
- **Verification:** manual (developer mode) drill-down + a unit test of the
  state reducer; feature-detect `window.openai`.
- **Rollback:** remove resourceUri (tools still return structured/text).

---

## Phase 5 — Public REST layer (thin wrappers over services)
Step 0: invoke `/better-coding-workflow`

### Task 5.1 — REST validation + router
- **Files:** Create `src/rest/validate.ts`, `src/rest/routes.ts`; Test
  `tests/rest-routes.test.ts`.
- **Interfaces:** `handleRestRequest(req,res): Promise<boolean>` (true if
  handled) for `GET /api/{search,compendium,topic-page,wikipedia}`; validation
  (query≤200, nodeId≤50, enum filters).
- **What:** Dispatch to `src/services/*`, JSON responses, structured errors.
- **Verification:** each route returns service JSON for valid input; 400 on
  invalid; unknown path → not handled.
- **Rollback:** delete dir.

### Task 5.2 — Mount REST + rate-limit + CORS in `http.ts`
- **Files:** Modify `src/http.ts` (call `handleRestRequest` before MCP branch;
  apply `createRateLimiter` for `/api/*`, CORS GET); Test `tests/http-rest.test.ts`
  or extend `rate-limit.test.ts`.
- **What:** Wire the public surface into the self-hosted server (not Vercel).
- **Verification:** `GET /api/search?q=…` returns 200 JSON; over-limit → 429;
  `OPTIONS` → 204 CORS.
- **Rollback:** remove the mount.

---

## Phase 6 — Prompt launcher + bookmarklet + sample skills — pair `/better-coding-frontend`
Step 0: invoke `/better-coding-workflow` **and** `/better-coding-frontend`

> **Redesign (user feedback 2026-07-15):** the launcher is NOT one canned
> search-prompt. It teaches the user's AI chat how to use the WLO REST URLs
> itself (search → load JSON RAW → summarise), points to URL-loadable skills, and
> targets Claude/ChatGPT/**Copilot**/Gemini (not just OpenAI). Direct content
> search stays usable. Tasks below reflect this.

### Task 6.1 — `launcher.html` (static, bilingual) + skills endpoint
- **Files:** Create `public/launcher.html` (+ inlined JS/CSS), `src/rest/static.ts`
  (serve `GET /launcher.html`, `GET /`, `GET /bookmarklet.md`), `src/rest/skills.ts`
  (registry + raw loader). Mount static in `http.ts` after the MCP branch.
- **What:** the page generates an **instruction message** teaching the chat: the
  search endpoint (`GET /api/search?q=…` + `discipline`/`educationalContext`/
  `learningResourceType` filters + `includeWikipedia`/`includeCompendium` flags,
  load JSON raw + summarise), the other endpoints, and skills-by-URL
  (`GET /api/skills` list → `GET /api/skills/<id>` raw Markdown). An optional query
  + filters weave in a concrete example and drive a "Load raw result" button
  (direct content search). Targets: deep links `claude.ai/new?q=` /
  `chatgpt.com/?q=` / `copilot.microsoft.com/?q=` (native `?q=` prefill); Gemini
  has no native prefill → open `gemini.google.com/app` + copy to clipboard; plus
  copy-only. `/api/skills[/<id>]` runs through the existing `/api/*` mount;
  `RestResult` gains an optional raw-text body so Markdown can be served.
- **Verification:** Browser pane on the served page — the instruction contains the
  search pattern + `/api/skills` list + `/api/skills/<id>` load pattern (+ a
  concrete example when a query is set); Copilot/Claude/ChatGPT deep links build;
  `/api/skills` returns the catalogue and `/api/skills/<id>` the raw Markdown;
  a11y: labels, keyboard, contrast (`/better-coding-frontend`).
- **Rollback:** delete files + mount.

### Task 6.2 ⟂ — Bookmarklet + docs
- **Files:** Create `public/bookmarklet.md` (the `javascript:` one-liner +
  install steps, bilingual).
- **Verification:** selecting text on a page + clicking opens the launcher with
  `?q=<selection>`.
- **Rollback:** delete.

### Task 6.3 ⟂ — Two skills, served by URL (well-separated)
- **Files:** Create `public/skills/wlo-search.skill.md`,
  `public/skills/wlo-topic-launcher.skill.md` — each explains, on initial load,
  how the AI app calls the REST URL with a query and interprets the result. Served
  raw via `GET /api/skills/<id>` (registry in `src/rest/skills.ts`); `id` is a slug
  now, intended to become a WLO nodeId later.
- **Verification:** each skill is self-contained (URL + query pattern + output
  handling); `GET /api/skills/<id>` returns its raw Markdown; reviewed for clarity.
- **Rollback:** delete.

---

## Phase 7 — Optional tools ✅ done 2026-07-15
Step 0: invoke `/better-coding-workflow`

> **Two live-driven design corrections (recorded per the plan-is-a-contract rule):**
> - **7.3** breakdown is tallied over the collection's actual child files, NOT via
>   an ngsearch facet query — a facet scoped by `virtual:primaryparent_nodeid`
>   returns nothing for WLO reference collections (verified live).
> - **7.4** `/parents` returns the WHOLE ancestor chain in ONE call (self-first),
>   so `getNodeBreadcrumb` reverses a single response instead of iterating; the
>   cycle-guard + depth-cap are kept as the safety net.

### Task 7.1 ⟂ — `lookup_wlo_publishers`
- **Files:** `src/services/publishers.ts` + register in `src/tools/vocabulary.ts`
  or `browse.ts`; Test.
- **Interfaces:** `ngsearch` with `facets:['ccm:oeh_publisher_combined']` → labeled counts.
- **Verification:** returns publisher buckets for a mocked facet response.

### Task 7.2 ⟂ — `get_related_content`
- **Files:** `src/services/related.ts` + tool; Test.
- **Interfaces:** given `nodeId` → fetch metadata → use `disciplines`+
  `educationalContexts` as `ngsearch` filters; exclude self; optional siblings.
- **Verification:** returns filtered results derived from the seed node's vocab.

### Task 7.3 ⟂ — `get_collection_stats`
- **Files:** `src/services/stats.ts` + tool; Test.
- **Interfaces:** aggregate file/sub-collection counts + facet split by
  type/subject/level (parallel `getCollectionContents` + facet query).
- **Verification:** returns counts + breakdown for a fixture collection.

### Task 7.4 ⟂ — `get_node_breadcrumb`
- **Files:** Modify `src/wlo-api.ts` (`getNodeBreadcrumb` walking `getNodeParents`
  to root, cycle-guarded, depth-capped) + tool; Test.
- **Interfaces:** `getNodeBreadcrumb(nodeId): Promise<{nodeId,title}[]>` root→node.
- **Verification:** returns ordered chain to root; stops on cycle/root.

---

## Phase 8 — Deployment (Docker/vServer) + submission + close-out ✅ done 2026-07-15
Step 0: invoke `/better-coding-workflow`

> **Decisions recorded (plan-is-a-contract rule):**
> - **8.4 npm-audit:** the shipped/prod tree (`npm audit --omit=dev`) is **0**;
>   the 11 full-tree advisories are all dev-only (`@vercel/node` types, `tsx`→
>   esbuild) and never bundled/executed. Per the pre-existing accepted decision
>   (the accepted @vercel/node D-1 decision) — whose only npm fix is a breaking
>   `@vercel/node@4` downgrade — they are NOT force-fixed in a deploy package. A
>   clean forward path (drop `@vercel/node` for local `node:http` Vercel types) is
>   left as a user-decided follow-up.
> - **8.2 hardening (review-driven):** compose publishes on `127.0.0.1` (behind-
>   proxy topology) so a direct client can't spoof `X-Forwarded-For` to defeat the
>   rate limiter.

### Task 8.1 — Real-SSE HTTP transport for Docker
- **Files:** Modify `src/http.ts` (env flag `MCP_SSE=1` → `enableJsonResponse:false`
  real streaming; keep JSON mode default for back-compat); `.env.example`.
- **What:** Serve `/mcp` with SSE for ChatGPT on the vServer; document
  reverse-proxy "no buffering" requirement.
- **Verification:** with `MCP_SSE=1`, an MCP request streams; JSON mode
  unchanged when unset. Confirms R1 resolution from Task 3.6.
- **Rollback:** flag defaults off.

### Task 8.2 — Dockerfile + compose for vServer
- **Files:** Modify `Dockerfile` (build widgets + tsc, run `dist/http.js`,
  `MCP_SSE=1`, healthcheck `/health`); Create `docker-compose.yml` (env,
  ports, restart) + reverse-proxy note.
- **Verification:** `docker build` succeeds; container answers `/health` 200 and
  a `tools/list` MCP POST.
- **Rollback:** revert Dockerfile.

### Task 8.3 — Submission collateral + docs
- **Files:** Create `docs/PRIVACY.md` (data categories/retention/controls),
  `docs/apps-sdk-submission-checklist.md` (from research: naming, annotations,
  demo, distinct value, `_meta.ui.domain`, golden prompts); update
  `README.md`/`README.de.md`, `CHANGELOG.md`, `.env.example`.
- **Verification:** checklist items each map to an implemented artifact.
- **Rollback:** delete docs.

### Task 8.4 — Whole-repo audit + final verify
- **What:** invoke `/better-coding-audit` (new REST/public surface + widgets),
  fix criticals, then `/better-coding-verify` (build + full test suite +
  developer-mode golden prompts) before declaring done.
- **Verification:** audit report clean of criticals; `npm run build` + `npm test`
  green; evidence attached.
- **Rollback:** n/a (gate).

---

## Verification plan (acceptance criteria)
- **Token efficiency:** a single `search_wlo_all` with all `include*` flags
  returns content+collections(+compendium)+topicPages(+swimlanes)+wikipedia —
  proven by `services-search-all.test.ts` (one call, all buckets populated).
- **Back-compat:** every pre-existing test stays green after each phase
  (regression gate); default-flag envelopes byte-identical to fixtures.
- **Apps-SDK:** tools expose `outputSchema`+`annotations`+`structuredContent`;
  `search`/`fetch` match the fixed shapes; developer-mode render confirmed (3.6).
- **Widgets:** each widget renders its fixture; WCAG AA (alt text, contrast,
  keyboard) checked by `/better-coding-frontend`.
- **REST:** each endpoint returns service JSON, validates input, rate-limits.
- **Launcher:** generates valid deeplinks hitting the REST API; a11y floor met.
- **Deploy:** Docker container serves `/mcp` (SSE) + `/health` + `/api/*` +
  `/launcher.html`.
- **Regression suite:** `npm test` (all files) is the closing gate every phase.
