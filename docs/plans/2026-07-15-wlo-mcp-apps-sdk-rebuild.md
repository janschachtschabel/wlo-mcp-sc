# Design: WLO MCP Server — Apps-SDK Compatibility, Token Efficiency & Extensions

> Status: **DRAFT — awaiting approval**. Author: planning session 2026-07-15.
> Process: produced with `/better-coding-plan`. Execution: `/better-coding-workflow`
> per phase (each phase starts with a skill-refresh step). Task list:
> [2026-07-15-wlo-mcp-apps-sdk-tasks.md](2026-07-15-wlo-mcp-apps-sdk-tasks.md).

## Goal

Extend (not rebuild) the WLO MCP server so it is OpenAI **Apps-SDK compatible**
(renderable UI, structured content, submission-ready metadata), **more
token-efficient** (bundle sequential tool calls into one), **functionally
richer** (new tools + compendium/Wikipedia knowledge layers), reachable by
**non-MCP AI tools** (public REST + prompt launcher), and of **higher code
quality** — fit to demo at Summer Camp and to submit as a ChatGPT app.

## Context

Today the server is a clean, transport-agnostic MCP with 12 tools
(`src/server.ts` factory + `src/tools/*`), an edu-sharing REST client
(`src/wlo-api.ts`), quality reranking, three transports (stdio, self-hosted
HTTP, Vercel serverless), tests, and CI. It is well-modularized and tested — so
this is an **additive extension**, not a rewrite. What changes: tools gain
Apps-SDK metadata + structured content + optional UI widgets; `search_wlo_all`
and friends gain bundling parameters; a services seam is introduced so a new
public REST layer and the widgets reuse the same logic without duplication; a
static prompt-launcher is added for AI tools without MCP. Deployment moves to a
**Docker vServer** (real SSE), so the HTTP transport becomes the primary target.

## Scope

**In scope**
- Internal enablers: `DISPLAY_PROPS += ccm:oeh_collection_compendium_text`,
  fuzzy vocab suggestions, a shared `resolveTopicPageSwimlanes` helper,
  `skipCount` pagination for content search.
- 3 new tools: `get_compendium_text`, `get_wikipedia_summary`,
  `search_wlo_within_collection`.
- 5 extended tools: `search_wlo_all` (+5 params), `search_wlo_topic_pages`
  (+2), `browse_collection_tree` (+1), `search_wlo_content` (+skipCount),
  `lookup_wlo_vocabulary` (unchanged; obsoleted in ~90% by fuzzy suggestions).
- Apps-SDK foundation: `outputSchema` + `structuredContent` + tool
  `annotations` + server `instructions` + "Use this when…/Do not use for…"
  descriptions on all tools.
- ChatGPT knowledge convention: additional read-only `search` + `fetch` tools
  with the fixed result shapes.
- Apps-SDK **widget suite** (focus: collections): (W1) combined search
  results, (W2) interactive hierarchical browse (subject portals → topic tree →
  content), (W3) content/collection tile card, (W4) topic-page (swimlane) view.
- Public REST layer (4 endpoints) reusing the services seam.
- Prompt launcher (static `launcher.html`) + bookmarklet + 2 sample skills.
- 4 optional tools: `get_node_breadcrumb`, `get_related_content`,
  `get_collection_stats`, `lookup_wlo_publishers`.
- Docker/vServer deployment with real SSE; submission collateral (privacy
  policy, Apps-SDK checklist); code-quality uplift throughout.

**Out of scope**
- OAuth / user accounts (WLO is anonymous, read-only) — deferred until a write
  action exists.
- Write operations against edu-sharing (comments, ratings, submissions).
- Rebuilding existing, working tools beyond the additive changes above.
- A React design-system port; widgets stay lean (see Approach D).
- Instant Checkout / commerce, PiP games — not applicable to WLO.

## Approach (Phase-2 exploration → decisions)

### A. Rebuild vs. adapt → **ADAPT** (user-delegated decision)
- *Rebuild:* clean slate, but discards tested edge-case handling (URL
  sanitization, bounded concurrency, reranking, rate-limit, 3 transports). High
  cost, high risk, no benefit — the current structure already matches the
  target. *Adapt:* additive changes, every existing test stays as a regression
  guard. **Chosen: adapt.** The quality uplift is achieved by refactoring seams
  (services layer, shared helpers) as we extend, not by starting over.

### B. Apps-SDK integration point → **base SDK `_meta` + a thin `registerWloTool` seam**
- *Option 1 — `@modelcontextprotocol/ext-apps` `registerAppTool`:* convenience,
  but adds a dependency whose exact API/version we must pin, and couples all
  registrations to it.
- *Option 2 — base `server.registerTool()` with `_meta.ui.*` + `outputSchema`
  set directly:* confirmed to work with the pinned `@modelcontextprotocol/sdk`;
  no new dependency; full control.
- **Chosen: Option 2**, wrapped in one helper `registerWloTool(server, def)` in
  `src/apps/register.ts` that centralizes annotations, `outputSchema`,
  `_meta.ui` (resourceUri/domain/csp), and the dual return
  (`content` text for back-compat **+** `structuredContent`). `ext-apps` is
  evaluated as an optional convenience during Phase 3 but is not load-bearing.
  This de-risks the plan against package/version uncertainty.

### C. Widget ↔ tool data contract → **`structuredContent` = `FormattedNode`-shaped**
- `FormattedNode` already carries everything a tile needs (title, description,
  `previewUrl`/`previewIsIcon`, vocab labels, `license`, `publisher`,
  `nodeType`, `topicPageUrl`, `compendiumText`). The widget consumes
  `structuredContent` (via `window.openai.toolOutput`) directly. We define zod
  `outputSchema`s that mirror the existing envelopes (`{content, collections,
  topicPages}`, the swimlane payload, the browse tree) so the model reads the
  same JSON the widget renders. Bulk/secondary data (full text) goes in result
  `_meta` (widget-only), never inflating the model context.

### D. Widget tech → **vanilla TS bundled+inlined with esbuild (no React)**
- *React + bundler:* matches some Apps-SDK samples, but adds React/runtime and
  a heavier build for what are read-only display cards.
- *Hand-written HTML strings:* zero build, but the interactive browse widget
  (W2) and shared tile rendering get unmaintainable.
- **Chosen: vanilla TS components compiled per-widget by `esbuild` into a
  single inlined `ui://` HTML resource** (one dev dependency, `esbuild`). Keeps
  the project's minimal-dependency ethos, gives type-checked widget code, and
  satisfies "inline the bundle" (troubleshooting gotcha). Theming via the
  Apps-SDK CSS-variable tokens so light/dark both work.

### E. No-logic-duplication for REST/widgets → **introduce a `src/services/` seam**
- New business logic (compendium, wikipedia, within-collection, the
  `search_all` bundling, subject-tree browse) is written as pure service
  functions in `src/services/*` returning plain data (`FormattedNode[]` /
  envelopes). MCP tool handlers, REST handlers, and widget-triggered
  `callTool`s all call the **same** service function. Existing tools are
  refactored into services **only where** REST/widgets need to share them
  (bounded, opportunistic — not a wholesale rewrite). Dependency direction:
  `transports/tools/rest/widgets → services → wlo-api/topic-page-api`.

## Global constraints (from the constitution, verbatim intent)
- TypeScript ESM, NodeNext: **intra-project imports use the `.js` extension**.
- Each tool group in `src/tools/<area>.ts` exports `register<Area>(server)`;
  registration order = `tools/list` display order.
- Config is **env-only**; no secrets in code (`.env.example` documents each).
- Tests use `node:test` via tsx; upstream HTTP faked with `tests/fetchMock.ts`
  — **no live network in tests**.
- Code, identifiers, comments, commits, README/CHANGELOG in **English**;
  user-facing artifact copy (launcher, tool descriptions) may be **DE/EN**.
- No planned source file past ~300 lines; a split that would exceed it is a
  planned task.

## Architecture

### New / modified files (responsibilities)

**Services seam (new) — `src/services/`**
- `search.ts` — `searchAll(params): Promise<SearchAllEnvelope>` (bundling +
  enrichment: compendium/textContent/wikipedia/topicPageContent), `searchWithinCollection(...)`.
- `compendium.ts` — `getCompendiumTexts(ids): Promise<CompendiumEntry[]>`.
- `wikipedia.ts` — `fetchWikipediaSummary(query, lang, sections): Promise<WikiSummary|null>`.
- `browse.ts` — `browseTree(...)`, `subjectPortals(...)` (moved logic reused by W2 + REST).
- `topic-page.ts` — re-exports `resolveTopicPageSwimlanes(...)`.
- `related.ts`, `stats.ts`, `breadcrumb.ts`, `publishers.ts` — optional-tool logic.

**Apps-SDK layer (new) — `src/apps/`**
- `register.ts` — `registerWloTool(server, def)` seam (Approach B); `outputSchemas.ts`
  (zod schemas = structuredContent contracts); `resources.ts` —
  `registerWidgetResource(server, {uri, html})`; `instructions.ts` — server
  `instructions` text.
- `widgets/` — `search-results/`, `browse/`, `tile/`, `topic-page/` (each: `main.ts`,
  `styles.css`, `index.html` shell) + `build.mjs` (esbuild inline → `dist-widgets/*.html`).

**External-knowledge API (new)**
- `src/wikipedia-api.ts` — Wikipedia REST client (summary + opensearch fallback,
  User-Agent header, timeout, no key).

**REST layer (new) — `src/rest/`**
- `routes.ts` — `handleRestRequest(req,res)` dispatch for
  `/api/{search,compendium,topic-page,wikipedia}`; `validate.ts` (query≤200,
  nodeId≤50); reuses `src/services/*`. Mounted by `src/http.ts`.

**Launcher (new) — `public/`** (served static by `http.ts`)
- `launcher.html` (+ inlined `launcher.js`, bilingual copy), `bookmarklet.md`.
- `public/skills/` — 2 skills (`wlo-search.skill.md`, `wlo-topic-launcher.skill.md`),
  served raw via `GET /api/skills/<id>` (registry `src/rest/skills.ts`).

**Modified**
- `src/wlo-api.ts` — `DISPLAY_PROPS += 'ccm:oeh_collection_compendium_text'`;
  add `getNodeBreadcrumb`, facet helper for publishers if missing.
- `src/tools/shared.ts` — `buildFilterCriteria` fuzzy suggestions +
  `levenshtein`; `suggestVocab`; re-export `resolveTopicPageSwimlanes`.
- `src/tools/content-search.ts` — `search_wlo_content` +`skipCount`;
  `search_wlo_all` +5 params (delegates to `services/search.ts`).
- `src/tools/topic-pages.ts` — +`includeContent`/`maxPerSwimlane`.
- `src/tools/topic-page-content.ts` — extract swimlane logic to
  `services/topic-page.ts` (`resolveTopicPageSwimlanes`), tool becomes a thin caller.
- `src/tools/browse.ts` — +`includeContentPreview`; add optional-tool registrations.
- `src/server.ts` — register new tools (`get_compendium_text`,
  `get_wikipedia_summary`, `search_wlo_within_collection`, `search`, `fetch`, 4
  optional), attach `instructions`, wire widget resources.
- `src/http.ts` — mount REST routes + static launcher; real SSE (see Non-functional).
- `Dockerfile`, `.env.example`, `README*.md`, `CHANGELOG.md`, `vercel.json` (kept as
  secondary transport).

### Data flow
1. **MCP tool call** → tool handler (`src/tools/*`) → `src/services/*` →
   `wlo-api`/`wikipedia-api` → returns envelope. Handler returns
   `{content:[text, _queryMeta], structuredContent}`; if a widget is attached,
   `_meta.ui.resourceUri` tells ChatGPT to render it from `structuredContent`.
2. **Widget** loads in iframe → reads `window.openai.toolOutput`
   (= structuredContent) → renders tiles; interactive browse calls
   `window.openai.callTool('browse_collection_tree', …)` for drill-down.
3. **REST call** → `handleRestRequest` → same `src/services/*` → JSON. CORS GET,
   rate-limited, validated.
4. **Launcher** (static) → builds a deeplink+prompt that instructs an external
   AI to GET a REST endpoint with the user's query.

### Interfaces (contracts — exact shapes)

```ts
// src/apps/register.ts
export interface WloToolDef {
  name: string;
  title: string;                 // human-readable (Apps-SDK)
  description: string;           // "Use this when… Do not use for…"
  inputSchema: z.ZodRawShape;
  outputSchema?: z.ZodTypeAny;   // → structuredContent contract
  annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean; openWorldHint?: boolean };
  widgetUri?: string;            // ui://… when a widget renders this tool
  handler: (args: any) => Promise<{
    content: { type: 'text'; text: string }[];
    structuredContent?: unknown;
    _meta?: Record<string, unknown>;   // widget-only, never sent to model
    isError?: boolean;
  }>;
}
export function registerWloTool(server: McpServer, def: WloToolDef): void;

// src/services/wikipedia.ts
export interface WikiSummary { title: string; extract: string; thumbnail?: string; url: string; lang: string; }
export function fetchWikipediaSummary(query: string, lang?: string, sections?: 1|2|3): Promise<WikiSummary | null>;

// src/services/compendium.ts
export interface CompendiumEntry { nodeId: string; title: string; compendiumText: string | null; }
export function getCompendiumTexts(nodeIds: string[]): Promise<CompendiumEntry[]>;

// src/services/search.ts  (search_wlo_all bundling)
export interface SearchAllOptions { /* existing params */ includeCompendium?: boolean;
  includeTextContent?: boolean; includeWikipedia?: boolean; includeTopicPageContent?: boolean;
  skipCount?: number; maxPerSwimlane?: number; }
export interface SearchAllEnvelope {
  query: string;
  content:     { total: number; count: number; results: FormattedNode[] };
  collections: { total: number; count: number; results: FormattedNode[] };
  topicPages:  { total: number; count: number; results: (FormattedNode & { topicPageContent?: SwimlanePayload })[] };
  wikipedia?:  WikiSummary;
}

// ChatGPT knowledge convention (src/tools/knowledge.ts) — fixed shapes
// search  → structuredContent { results: {id,title,url}[] } AND content[0].text = same JSON
// fetch   → structuredContent { id,title,text,url,metadata } AND content[0].text = same JSON
```

### Dependencies (new, justified)
- **`esbuild`** (dev) — inline-bundle widget TS into single-file `ui://` HTML
  resources (Apps-SDK requires inlined JS). Chosen over webpack/rollup for
  speed + zero-config single-file output. No runtime dependency added.
- No new **runtime** dependencies. Wikipedia uses `fetch`; REST uses the
  existing `node:http`. `@modelcontextprotocol/ext-apps` only if Phase-3
  evaluation shows a clear win (else base SDK `_meta`).

## Non-functional
- **Performance / token budget:** every enrichment runs in the existing
  `Promise.all` + `mapPool` bounded-concurrency pattern (parallel, capped);
  `structuredContent` carries compact `FormattedNode`s; full text goes in
  `_meta` (widget-only) — the model context stays small. Result counts capped,
  `skipCount` paginates. Manifest kept lean (descriptions trimmed).
- **Security:** REST is read-only, CORS `*` for GET only, rate-limited
  (reuse `createRateLimiter`, 30/min default for `/api/*`), inputs validated
  server-side (query≤200, nodeId≤50, enum filters). No secrets in
  `structuredContent`/props. Widget CSP: `_meta.ui.csp.connectDomains` must
  whitelist the edu-sharing host + preview-image hosts; `_meta.ui.domain` set
  for submission. Assume prompt injection → validate all tool inputs (already
  via zod).
- **Accessibility (widgets, WCAG 2.2 AA — defer detail to
  `/better-coding-frontend`):** alt text on every OER thumbnail (German,
  meaningful), AA contrast via system tokens, no nested scroll, ≤2 actions per
  card, layout survives text resize, keyboard operable.
- **i18n:** widget + launcher copy through a tiny string table (DE default, EN
  fallback); tool descriptions English (model-facing). Locale hint
  `_meta["openai/locale"]` respected where feasible.
- **Privacy/GDPR:** launcher self-hosted assets, no third-party requests before
  action, no PII in URLs/logs; logger already redacts to structured fields;
  publish a retention/privacy policy doc for submission.
- **Observability:** existing `log` structured logger extended to REST +
  services; correlation via existing patterns; no raw prompt text stored.

## Risks
- **R1 — ChatGPT SSE compatibility on our transport.** Mitigation: Phase 3
  validates in developer mode via ngrok against `http.ts` real-SSE before the
  Docker move; keep `enableJsonResponse` switchable behind an env flag.
- **R2 — Apps-SDK metadata drift** (docs are a moving "MCP Apps" standard).
  Mitigation: seam in `src/apps/register.ts` isolates all `_meta.ui.*` in one
  file; fetch the two un-fetched doc pages ("Build your ChatGPT UI", "Connect
  from ChatGPT") at Phase-3/4 start.
- **R3 — Widget CSP blocks edu-sharing/image hosts.** Mitigation: enumerate all
  hosts early; set `connectDomains`/`resourceDomains`; test in MCP Inspector.
- **R4 — Scope vs. Summer Camp deadline.** Mitigation: phases are ordered so
  each ships working software; W2 (interactive) is the last widget; optional
  tools are a self-contained late phase that can slip without blocking a demo.
- **R5 — Services extraction regresses existing tools.** Mitigation: extract
  behind existing tests; every existing test must stay green (regression gate).

## Phasing overview (each phase = working, testable software)
- **P0** Groundwork & green baseline (build/test, esbuild dev-dep, test conventions).
- **P1** Internal enablers (DISPLAY_PROPS, fuzzy suggestions, swimlane helper, skipCount).
- **P2** New tools + `search_wlo_all` enrichment + topic-pages/browse params (as services).
- **P3** Apps-SDK foundation (structuredContent, outputSchema, annotations, instructions, `search`/`fetch`) + ngrok/ChatGPT validation.
- **P4** Widget suite W1–W4 (with `/better-coding-frontend`).
- **P5** Public REST layer (thin wrappers over services).
- **P6** Prompt launcher + bookmarklet + 2 sample skills (with `/better-coding-frontend`).
- **P7** Optional tools (breadcrumb, related, stats, publishers).
- **P8** Docker/vServer deploy (real SSE) + submission collateral + `/better-coding-audit` + `/better-coding-verify`.

## Open questions
None blocking. Two Apps-SDK doc pages ("Build your ChatGPT UI", "Connect from
ChatGPT") are fetched at the start of P3/P4 to lock the exact `window.openai`
surface and connect steps — a research step inside those phases, not a design
gap.

## References (Apps-SDK surface — locked P3 Step 0b, 2026-07-15)

Fetched from the official OpenAI Apps-SDK docs to remove R2 (metadata drift).
Sources: [Reference](https://developers.openai.com/apps-sdk/reference),
[Build your ChatGPT UI](https://developers.openai.com/apps-sdk/build/chatgpt-ui),
[Build your MCP server](https://developers.openai.com/apps-sdk/build/mcp-server).

**Key confirmation:** the design's `_meta.ui.*` shorthand IS the real MCP-Apps
standard namespace; `openai/*` keys are ChatGPT compatibility aliases. Our
`registerWloTool` seam emits the **standard** key and the alias together.

### Result shape (what goes where)
- `content` (text) — what the **model** reads in the conversation (back-compat;
  keep for non-Apps clients).
- `structuredContent` — the JSON the **widget** reads (via `window.openai.toolOutput`)
  and that the model also parses. This is the `outputSchema` contract.
- result `_meta` — **widget-only**, never shown to the model (bulk/secondary data,
  e.g. full text). Read in the widget via `window.openai.toolResponseMetadata`.
- SDK rule (verified in `mcp.js`): with an `outputSchema`, a **non-error** result
  MUST include `structuredContent` (validated by `safeParseAsync`; unknown extra
  keys tolerated, missing required keys / wrong types throw `InvalidParams`).
  An `isError:true` result skips output validation → error path needs no
  structuredContent.

### Tool-descriptor `_meta` keys
- `_meta.ui.resourceUri` (standard) + `_meta["openai/outputTemplate"]` (alias) —
  the `ui://…` widget this tool renders.
- `_meta.ui.visibility` (standard) / `_meta["openai/visibility"]` — model/app/both.
- `_meta["openai/toolInvocation/invoking"]` / `…/invoked` — status text (≤64 chars).

### Resource (widget) `_meta` keys — used in P4, not P3
- `_meta.ui.prefersBorder`, `_meta.ui.domain` (submission-required origin),
  `_meta.ui.csp` = `{ connectDomains, resourceDomains, frameDomains }`.
- Aliases: `openai/widgetDescription`, `openai/widgetPrefersBorder`,
  `openai/widgetDomain`, `openai/widgetCSP` (snake_case `connect_domains`, …).
- Widget resource MIME type: **`text/html;profile=mcp-app`**; URI scheme `ui://`.

### `window.openai` surface (widget iframe — used in P4)
- Properties: `toolInput`, `toolOutput`, `toolResponseMetadata`, `widgetState`,
  `theme`, `displayMode`, `maxHeight`, `safeArea`, `view`, `userAgent`, `locale`.
- Methods: `setWidgetState(state)`, `callTool(name, args)`,
  `sendFollowUpMessage({prompt})`, `requestDisplayMode(...)`, `requestModal(...)`,
  `requestClose()`, `notifyIntrinsicHeight(...)`, `openExternal({href})`,
  file APIs (`uploadFile`/`selectFiles`/`getFileDownloadUrl`).
- Events: `openai:set_globals` (globals updated); tool results also arrive as a
  `ui/notifications/tool-result` postMessage carrying `structuredContent`.
