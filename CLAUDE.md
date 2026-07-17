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
- Dev: `tsx` (run TS directly), `typescript` (build), `esbuild` (widget bundle). No `@vercel/node` — `api/mcp.ts` uses local `node:http` request/response types.
- Deploy targets: Vercel serverless (`api/mcp.ts`), self-hosted HTTP (`src/http.ts`),
  stdio for local/Docker (`src/stdio.ts`).

## Commands

- Build: `npm run build` (tsc → `dist/`)
- Test: `npm test` (`node --import tsx --test "tests/*.test.ts"`) — run a single
  file: `node --import tsx --test tests/reranker.test.ts`
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
- Cross-cutting helpers are centralized in `src/tools/shared.ts`: `buildFilterCriteria`
  (label→URI vocab mapping), `mapPool` (bounded-concurrency fan-out, returns
  `(R|null)[]` — filter nulls), `toolError` (log + client error), `queryMetaContent`.
- Config is env-only (`WLO_REPOSITORY_URL`, `PORT`, `RATE_LIMIT_RPM`, …); no secrets
  in code. See `.env.example`.
- Tests use the built-in `node:test` runner via tsx; upstream HTTP is faked with
  `tests/fetchMock.ts` — no live network in tests.

## Architecture

- `src/server.ts` — transport-agnostic `createMcpServer()` factory; the only place
  tools are wired up. Three thin entry points connect a transport to it:
  `stdio.ts` (local/Docker), `http.ts` (self-hosted Streamable HTTP + rate limit +
  body cap), `api/mcp.ts` (Vercel serverless, stateless one-server-per-request).
- `src/tools/*` — the 22 MCP tools, grouped by responsibility (collections,
  content-search, node-details, node-relations, vocabulary, topic-pages,
  topic-pages-present, topic-page-content, browse, compendium, wikipedia,
  collection-stats, health, knowledge, skills) + `shared.ts`.
  The Apps-SDK display tools are registered via `src/apps/register.ts`.
- `src/wlo-api.ts` — edu-sharing REST client (search/node/render endpoints),
  `DISPLAY_PROPS`, URL sanitization. `src/topic-page-api.ts` — topic-page/swimlane API.
- `src/formatter.ts` — node → Markdown/JSON rendering. `src/reranker.ts` —
  quality-based reranking for `enhancedSearch` (query variants live in
  `src/query-expand.ts`). `src/node-match.ts` — local text/criteria matching for
  /children fallbacks. `src/vocabs.ts` — local vocabulary label↔URI tables (no
  API call). `src/logger.ts`, `src/rate-limit.ts`, `src/read-body.ts` — support.
- `docs/plans/` — design documents.
