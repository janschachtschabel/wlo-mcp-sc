# Apps-SDK Submission Checklist — WLO MCP Server

Maps each OpenAI Apps-SDK submission requirement to the artifact that satisfies
it in this repository, so a reviewer (or the submitter) can verify readiness at a
glance. Requirements are drawn from the Apps-SDK reference surface locked in the
design doc (§ "References (Apps-SDK surface — locked P3 Step 0b)").

Legend: ✅ implemented & verified · 🔶 implemented, needs a live developer-mode
render to confirm · ⬜ operator action.

## Server & transport

| Requirement | Status | Evidence |
|-------------|--------|----------|
| MCP server over Streamable HTTP | ✅ | `src/http.ts` (`POST /mcp`), `api/mcp.ts` (Vercel) |
| Real SSE streaming for ChatGPT developer mode | ✅ | `MCP_SSE=1` → `enableJsonResponse:false` (`src/mcp-transport.ts`); image defaults it on; smoke-verified (`content-type: text/event-stream`) |
| Reverse proxy must not buffer SSE | ⬜ | Documented in `docker-compose.yml` + README; operator configures nginx `proxy_buffering off;` |
| Stateless, read-only server | ✅ | one server+transport per request; every tool `readOnlyHint:true` |
| Server `instructions` block (fast path vs deep-dive vs search/fetch) | ✅ | `src/apps/instructions.ts`; asserted non-empty in `tests/server.test.ts` |
| Health endpoint | ✅ | `GET /health` → `200` (`src/http.ts`) |

## Tools

| Requirement | Status | Evidence |
|-------------|--------|----------|
| Clear tool names + "Use this when… / Do not use for…" descriptions | ✅ | tool registrations in `src/tools/*`; disambiguation asserted in `tests/server.test.ts` |
| `annotations.readOnlyHint` on every tool | ✅ | asserted for all 22 tools in `tests/server.test.ts` |
| `annotations.openWorldHint` where a tool leaves WLO | ✅ | `get_wikipedia_summary` (`src/tools/wikipedia.ts`) |
| `outputSchema` + `structuredContent` on display tools | ✅ | `src/apps/register.ts` seam + `src/apps/outputSchemas.ts`; `tests/apps-structured-content.test.ts` |
| ChatGPT `search` + `fetch` tools with the fixed shapes | ✅ | `src/tools/knowledge.ts`; `tests/tools-knowledge.test.ts` |
| Tool-invocation status strings (`openai/toolInvocation/*`) | 🔶 | seam supports `_meta`; optional polish — confirm in developer mode |

## Widgets

| Requirement | Status | Evidence |
|-------------|--------|----------|
| Self-contained widget HTML (JS+CSS inlined, no external `<script src>`) | ✅ | `src/apps/widgets/build.mjs` → `dist-widgets/*.html`; `tests/apps-resources.test.ts` |
| Widget resource MIME `text/html;profile=mcp-app`, `ui://` scheme | ✅ | `src/apps/resources.ts` (`WIDGET_MIME_TYPE`) |
| `_meta.ui.domain` = submission origin | ✅ | derived from `WLO_REPOSITORY_URL` origin (`widgetResourceMeta()`) |
| `_meta.ui.csp` restricts connect/resource/frame domains | ✅ | `src/apps/resources.ts` — whitelists only the edu-sharing origin |
| Content-addressed URIs (cache-busting on rebuild) | ✅ | `computeWidgetUri()` sha256 hash |
| Widgets bundled in the deployment image | ✅ | Dockerfile copies `dist-widgets/`; container `resources/list` returns the 3 `ui://` widgets |
| WCAG AA (alt text, contrast, keyboard) | ✅ | built to the `/better-coding-frontend` floor (P4); tile alt text / decorative-icon fallback in `widgets/shared/tile.ts` |

## Distinct value & demo

- **Distinct value:** curated German OER discovery — subject portals, structured
  topic pages (swimlanes), collections, compendium background texts, publisher
  facets, and related content — surfaced as renderable widgets, not just a
  generic web search. Token-efficient: one `search_wlo_all` call returns content
  + collections + topic pages (+ optional compendium/Wikipedia) in a single
  round-trip.
- **Golden prompts (demo script):**
  1. "Finde Materialien zur Photosynthese für die Sekundarstufe I." → `search_wlo_all` → search-results widget.
  2. "Zeig mir die WLO-Themenseite zu Optik." → `get_topic_page_content` → topic-page widget (swimlanes).
  3. "Welche Fachportale gibt es bei WLO?" → `get_subject_portals` → browse widget; expand a portal (interactive `browse_collection_tree`).
  4. "Welche Anbieter liefern die meisten Biologie-Materialien?" → `lookup_wlo_publishers`.
  5. "Gib mir einen Wikipedia-Überblick zu Zellatmung." → `get_wikipedia_summary`.
- **Full evaluation set:** the direct / indirect / negative prompt regimen with a
  precision-recall log lives in [`apps-sdk-golden-prompts.md`](apps-sdk-golden-prompts.md)
  — run it in developer mode (settles S4 + the P3.6 render/drill-down gate).

## Compliance & policy

| Requirement | Status | Evidence |
|-------------|--------|----------|
| Privacy policy | ✅ | `docs/PRIVACY.md` (stateless, read-only, no PII stored; operator adds contact) |
| No third-party asset/IP leakage in public pages | ✅ | `public/launcher.html` fully self-contained (P6) |
| Least privilege / read-only scope | ✅ | no write tools; container runs as non-root |

## Remaining before submission (operator actions)

- 🔶 **Developer-mode render (the P3.6 gate):** point ChatGPT developer mode at a
  live `https://…/mcp` (SSE) deployment and run the
  [golden prompts](apps-sdk-golden-prompts.md) — confirm each widget renders
  (settles **F1**), the browse drill-down loads children (settles **F3**), and the
  `search`/`fetch` tools resolve. This is the one check that cannot be automated
  offline. Capture a screenshot per rendered widget for the review.
- ⬜ **Submission-portal metadata** (set in the OpenAI developer/submission portal,
  NOT in the server code): app display name, description, **icon**, and
  **categories**. The server only carries `name` + `instructions`.
- ⬜ **Run the full golden-prompt regimen** ([`apps-sdk-golden-prompts.md`](apps-sdk-golden-prompts.md))
  and record precision/recall + false-positives; sharpen tool descriptions if the
  model mis-selects (S4).
- ⬜ Fill in the operator identity/contact in `docs/PRIVACY.md`.
- ⬜ Configure the reverse proxy for SSE (`proxy_buffering off;`, long read timeout).
- ⬜ Provide a public HTTPS origin and confirm `_meta.ui.domain` matches it.
