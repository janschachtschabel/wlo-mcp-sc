# Plan: Apps-SDK hardening + cross-host portability + modularization

Acts on the 2026-07-16 Apps-SDK compliance review. **Guiding constraint
(user):** stay compatible for OTHER AI apps, not ChatGPT-only → prefer the
MCP-Apps **standard** surface, keep `window.openai` as an extension with
feature-detection. Every phase ends green (`npm run build` + `npm test`).

## Phase A — Cross-host portability + Apps-SDK fixes (priority)

- **A1 (F2) — Standard `ui/*` bridge alongside `window.openai`.** New
  `src/apps/widgets/shared/host.ts`: one host abstraction the widgets use —
  `getToolOutput()`, `onUpdate(cb)`, `callTool(name,args)`, `setState`,
  `getState`, `getLocale`. Under ChatGPT it delegates to `window.openai` +
  `openai:set_globals`; otherwise it speaks the standard `ui/*` JSON-RPC over
  `postMessage` (`ui/notifications/tool-result`/`-input`, `tools/call`,
  `ui/initialize`). Pure message helpers (`buildToolCall`, `parseHostMessage`)
  are unit-tested; the postMessage glue is dev-mode-verified (like the existing
  widget glue). The three `main.ts` entries switch to `host.ts`.
- **A2 (F1) — Configurable widget MIME, default the standard.**
  `WLO_WIDGET_MIME` env, default `text/html;profile=mcp-app` (portable). Operator
  can set `text/html+skybridge` for a legacy ChatGPT runtime. `resources.ts`.
- **A3 (F3) — `widgetAccessible` on `browse_collection_tree`.** The seam gains a
  `widgetAccessible` flag → emits `_meta.ui.widgetAccessible` + the
  `openai/widgetAccessible` alias; set on the browse tool (its widget calls it).
- **A4 (F6) — Declare `noauth` per tool. ✅ DONE.** Applied uniformly across all
  22 tools via `src/apps/tool-defaults.ts` (`applyReadOnlyToolDefaults` wraps
  `server.tool`/`server.registerTool` to stamp
  `_meta.securitySchemes:[{type:'noauth'}]` onto every `RegisteredTool`, merged
  so widget `_meta` survives) — not seam-only, so it covers the plain
  `server.tool` registrations too. `_meta.securitySchemes` is the base-SDK
  back-compat mirror (no top-level slot; no `openai/` alias). The same wrap also
  fills the required `destructiveHint`/`openWorldHint` annotations, and the seam
  now emits the current `_meta.ui.visibility:["model","app"]` for widget-callable
  tools — both added in the 2026-07-16 SDK re-check.

## Phase B — Correctness / quality fixes

- **B1 (F5) — `search`/`fetch` `url` always absolute.** Fall back to
  `buildRenderUrl(nodeId)` in `tools/knowledge.ts` so `url` is never ''.
- **B2 (F4) — Trim `instructions` ≤ ~512 chars.** Rewrite `apps/instructions.ts`
  fast-path-first; keep the search/fetch convention line.

## Phase C — Modularization (per the code-quality audit)

- **C1 — Split `wlo-api.ts` (475 lines)** along its seams, behaviour-preserving,
  keeping `wlo-api.ts` as a thin **barrel re-export** so the ~21 import sites do
  NOT churn:
  - `wlo-config.ts` — env consts (`WLO_REPOSITORY_URL`, `BASE_URL`, roots,
    timeout, skills id, `HEADERS`, `wloFetch`, sanitize).
  - `wlo-search.ts` — `ngsearch`, `searchCollectionsByKeyword`, `DISPLAY_PROPS`,
    `appendPropertyFilter`, criterion types.
  - `wlo-node.ts` — node/children/metadata/breadcrumb/textContent/download +
    URL builders. `WloNode`/`SearchResponse` types live in `wlo-config.ts` or a
    small `wlo-types.ts`.
  - `wlo-api.ts` re-exports all of the above (public surface unchanged).
- **C2 — extract the `collections.ts` level-2 expansion helper. ✅ DONE.** The
  multi-level keyword tree-traversal fallback moved from the
  `search_wlo_collections` handler (~123-line handler) into the named top-level
  `findCollectionsByTreeTraversal` + hoisted `matchesQuery`, behaviour-preserving
  and now covered by a dedicated `tests/collections-tree.test.ts` (the fallback
  path was previously untested — the structured-content test only hit the fast
  path).

## Non-goals / respected decisions
- No OAuth (read-only stays anonymous). No ChatGPT-only extensions
  (requestModal/file/checkout). No behaviour change to tool outputs.
- F1's actual ChatGPT MIME choice + F3's effect still need the **P3.6
  developer-mode** confirmation; the code keeps both paths open.
