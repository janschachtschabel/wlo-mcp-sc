# Apps-SDK Submission Checklist — WLO MCP Server

Maps each OpenAI Apps-SDK submission requirement to the artifact that satisfies
it in this repository, so a reviewer (or the submitter) can verify readiness at a
glance. Requirements are drawn from the Apps-SDK reference surface locked in the
design doc (§ "References (Apps-SDK surface — locked P3 Step 0b)").

Legend: ✅ implemented & verified · 🔶 implemented, needs a live developer-mode
render to confirm · ⬜ operator action.

## Current posture (2026-08-03) — read this before ticking anything

**No submission is pending.** The deployment runs on the `nip.io` address and is
deliberately *not* listed in the GPT store yet; a version on a proper domain comes
later. Everything below therefore splits into two groups:

- **Ready now** — the server-side requirements. The tool surface was re-verified
  with the official MCP Inspector CLI on 2026-08-03: 25 tools, **0 objections**
  across title, description, hints, invocation status strings, `securitySchemes`
  and `inputSchema`. The golden prompts' mechanics pass delivered 17 of 17.
- **Deliberately deferred** — everything that depends on the final domain
  (`WLO_WIDGET_DOMAIN`, org verification, portal metadata, screenshots) and the
  developer-mode render. These stay ⬜ **on purpose**, not because they were
  forgotten.

The one thing worth deciding early anyway: the MCP origin is **locked across
versions** once submitted. A `nip.io` URL would chain the app to that IP forever,
so the switch to the real domain has to happen *before* the first submission —
not after. Nothing in the code hardcodes an origin (verified 2026-08-03), so that
switch is a redeploy with changed env variables.

## Server & transport

| Requirement | Status | Evidence |
|-------------|--------|----------|
| MCP server over Streamable HTTP | ✅ | `src/http.ts` (`POST /mcp`) |
| Real SSE streaming for ChatGPT developer mode | ✅ | `MCP_SSE=1` → `enableJsonResponse:false` (`src/mcp-transport.ts`); image defaults it on; smoke-verified (`content-type: text/event-stream`) |
| Reverse proxy must not buffer SSE | ⬜ | Documented in `docker-compose.yml` + README; operator configures nginx `proxy_buffering off;` |
| Stateless server | ✅ | one server+transport per request; no session state. The 25–26 read tools all carry `readOnlyHint:true`. **Not read-only as a whole:** with a write-capable identity the server also registers 13 curation tools — see the row below |
| Server `instructions` block (fast path vs deep-dive vs search/fetch) | ✅ | `src/apps/instructions.ts`; asserted non-empty in `tests/server.test.ts` |
| Health endpoint | ✅ | `GET /health` → `200` (`src/http.ts`) |

## Tools

| Requirement | Status | Evidence |
|-------------|--------|----------|
| Clear tool names + "Use this when… / Do not use for…" descriptions | ✅ | tool registrations in `src/tools/*`; disambiguation asserted in `tests/server.test.ts` |
| `annotations.readOnlyHint` on every tool | ✅ | asserted for every registered tool in `tests/server.test.ts` (25 read tools in the suite's configuration) |
| `annotations.openWorldHint` where a tool leaves WLO | ✅ | `get_wikipedia_summary` (`src/tools/wikipedia.ts`) and `get_url_text` (`src/tools/url-text.ts`) — the two that reach a source outside WLO |
| `outputSchema` + `structuredContent` on display tools | ✅ | `src/apps/register.ts` seam + `src/apps/outputSchemas.ts`; `tests/apps-structured-content.test.ts` |
| ChatGPT `search` + `fetch` tools with the fixed shapes | ✅ | `src/tools/knowledge.ts`; `tests/tools-knowledge.test.ts` |
| Tool-invocation status strings (`openai/toolInvocation/*`) on every tool | ✅ | `src/apps/tool-status.ts` via `tool-defaults.ts`; pinned by the conformance test in `tests/apps-tool-defaults.test.ts` |
| Human-readable `title` on every tool (the submission scan reads it) | ✅ | seam titles + `TOOL_TITLES` in `src/apps/tool-defaults.ts`; conformance test pins title + hints + noauth + status for all current AND future tools (25/25 today). Re-verified with the official MCP Inspector CLI on 2026-08-03 against the running HTTP server: `tools/list` returned 25 tools, and a scripted check of title + description + readOnlyHint + destructiveHint + both `openai/toolInvocation/*` strings + `securitySchemes` + `inputSchema` found **0 objections**. (The earlier one-off run was clean at 22/22 on 2026-07-17.) |

## Widgets

| Requirement | Status | Evidence |
|-------------|--------|----------|
| Self-contained widget HTML (JS+CSS inlined, no external `<script src>`) | ✅ | `src/apps/widgets/build.mjs` → `dist-widgets/*.html`; `tests/apps-resources.test.ts` |
| Widget resource MIME `text/html;profile=mcp-app`, `ui://` scheme | ✅ | `src/apps/resources.ts` (`WIDGET_MIME_TYPE`) |
| `_meta.ui.domain` = submission origin | ⬜ | ABSENT by default (hosts validate it against their own sandbox format — Claude rejects foreign values and aborts the bound tool call, live-proven 2026-07-17). **Correct for the current posture:** the deployment runs on `nip.io` and is not being submitted yet, so `WLO_WIDGET_DOMAIN` stays unset. For the later ChatGPT submission, set it to the final app domain; it is then emitted on `ui.domain` + the `openai/widgetDomain` alias — a redeploy with a changed env variable, no code change |
| `_meta.ui.csp` restricts connect/resource/frame domains | ✅ | `src/apps/resources.ts` — whitelists only the edu-sharing origin |
| Widget `_meta` descriptions + `prefersBorder` (hosts label the rendered component) | ✅ | `WIDGET_DESCRIPTIONS` in `src/apps/resources.ts`, emitted on `ui.*` **and** the `openai/widget*` aliases, on both the `resources/list` descriptor and each read `contents` entry; `tests/apps-resources.test.ts` |
| Content-addressed URIs (cache-busting on rebuild) | ✅ | `computeWidgetUri()` sha256 over the HTML **and** the resource `_meta` — a metadata-only change also rolls the URI (hosts key their cache on it; live-proven 2026-07-17) |
| Widgets bundled in the deployment image | ✅ | Dockerfile copies `dist-widgets/`; container `resources/list` returns the 3 `ui://` widgets |
| WCAG AA (alt text, contrast, keyboard) | ✅ | built to the `/better-coding-frontend` floor (P4); tile alt text / decorative-icon fallback in `widgets/shared/tile.ts`; detail-view focus management (open → back button, close → originating card, Escape closes) in `widgets/search-results/main.ts` |

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
| Privacy policy | ✅ | `docs/PRIVACY.md` — covers the anonymous read path, the optional credential and its forwarding, the curation (write) tools, and the third-party recipients. Operator adds contact + which mode the deployment runs in |
| No third-party asset/IP leakage in public pages | ✅ | `public/launcher.html` fully self-contained (P6) |
| Least privilege / write scope | ✅ | Anonymous callers get a read-only surface: the 13 curation tools are **not registered** without a write-capable identity, and each refuses again at call time (a host may cache an older tool list). Every mutation is two-step — preview, then a single-use token bound to a fingerprint of exactly that change — and is read back from the repository before anything is reported. Writes under the shared service account are off unless the operator sets `WLO_ALLOW_SERVICE_WRITES`. Container runs as non-root |

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
- 🔶 **Run the full golden-prompt regimen** ([`apps-sdk-golden-prompts.md`](apps-sdk-golden-prompts.md))
  and record precision/recall + false-positives; sharpen tool descriptions if the
  model mis-selects (S4). **Half of this is done (2026-08-03):** the mechanics
  pass — does each prompt's expected tool actually deliver against the live
  repository — ran green for 17 of 17 runnable prompts (D10 needs
  `WLO_SKILLS_COLLECTION_ID`). What remains needs a model: tool *selection*
  (A/B), the negative prompts (C), and the widget render + drill-down (D).
- ⬜ Fill in the operator identity/contact in `docs/PRIVACY.md`.
- ⬜ Configure the reverse proxy for SSE (`proxy_buffering off;`, long read timeout).
- ⬜ Provide a public HTTPS origin and set `WLO_WIDGET_DOMAIN` to it for the submission scan. **Deferred by decision (2026-08-03):** the deployment runs on the `nip.io` address for now and is NOT being listed in the GPT store yet, so `WLO_WIDGET_DOMAIN` stays unset — which is also what every non-ChatGPT host requires. Verified the same day that nothing in the code hardcodes a public origin (`src/` and `public/` contain no deployment host; the only absolute URL is the Wikipedia API User-Agent contact string), so moving to the final domain is a redeploy with changed env variables, not a code change.

## Plugin-submission portal specifics (per the 2026-07 "Prepare an app for plugin submission" doc)

| Requirement | Status | Notes |
|-------------|--------|-------|
| Organization verification (individual or business) in the OpenAI Platform Dashboard | ⬜ | Enforced at review; publishing under an unverified name is rejected |
| `api.apps.write` / `api.apps.read` permissions for the submitter | ⬜ | Org owners have both automatically |
| Project with **global** data residency | ⬜ | EU-data-residency projects cannot submit plugins containing apps (current portal limitation) |
| Universal MCP server URL (not Template) | ✅ | One hosted endpoint for all users; no per-tenant URLs |
| Publicly accessible domain, no local/testing endpoint | ⬜ | ⚠️ **Choose the FINAL domain before the first submission.** The MCP server origin (scheme/host/port) is LOCKED across versions — changing it later means a brand-new app + review. A `nip.io`/raw-IP URL is a testing endpoint in reviewers' eyes AND would chain the app to that IP forever. Use e.g. `mcp.wirlernenonline.de` from the start |
| CSP declared for the exact fetch domains | ✅ | `_meta.ui.csp` = the edu-sharing origin only (`src/apps/resources.ts`) |
| Scan Tools imports the advertised metadata as a locked snapshot | ✅ | Everything it reads is complete: names, titles, descriptions, schemas, `_meta.securitySchemes`, annotations, UI-resource CSP, server `instructions` (verified with the MCP Inspector CLI 2026-07-17) |
| Annotation justifications match server-advertised values | ⬜ | All read tools are `readOnlyHint:true`, `destructiveHint:false`. Two carry `openWorldHint:true` in the MCP-spec sense (they query an open external source): `get_wikipedia_summary` and `get_url_text`; justification wording: *read-only lookup of a public source, writes nothing, cannot change public internet state*. Note that `get_url_text` is declared **unsafe** and is switched off by default in the shipped deployment config — a submission should state whether it is enabled. The 13 curation tools are not part of this read-only surface: they never appear without a write-capable identity. |
| Response minimization (no telemetry/session/trace IDs in tool output) | ✅ | Responses carry only content metadata; the `_queryMeta` block is subject-matter context (search term, resolved criteria, pagination, repository URL) — no user identifiers, no session/request IDs |
| Test prompts + expected responses for the form | ✅ | [`apps-sdk-golden-prompts.md`](apps-sdk-golden-prompts.md); must pass on ChatGPT web AND mobile |
| Screenshots | ⬜ | Optional and only because the app HAS a UI — capture the three rendered widgets in developer mode |

### ⚠️ Post-publication maintenance rule for OUR widget URIs

The published app pins the scanned metadata **snapshot** — including the
`ui://widget/<name>-<hash>.html` URIs — while tool calls and resource reads hit
the live server. Our URIs are **content-addressed** (hash over HTML + `_meta`),
and the stateless container serves only the CURRENT build: after any widget
rebuild the published snapshot's old URI **no longer exists on the server**,
which the doc classifies as a breaking change that "can break the current
version as soon as the server change deploys".

Operating rule once a version is published: **do not deploy widget-affecting
changes** (widget source, `WLO_WIDGET_MIME`, `WLO_WIDGET_DOMAIN`,
`WLO_REPOSITORY_URL` — all flow into the hash) without going through
scan → submit → approve → publish for a new version. Server-only fixes that
leave `dist-widgets/` and the widget `_meta` untouched deploy freely. During
developer-mode testing (now) this rule does not apply — there the changing URI
is exactly what busts host caches, live-proven with Claude.
