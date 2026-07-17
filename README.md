# WLO MCP Server

> 🇬🇧 English (canonical) · 🇩🇪 [Deutsche Fassung](README.de.md)

A [Model Context Protocol](https://modelcontextprotocol.io) (MCP) server that lets
AI agents **search and retrieve open educational resources (OER)** from
[WirLernenOnline (WLO)](https://wirlernenonline.de) via the public
edu-sharing REST API.

It exposes **22 tools** for full-text search, collection/topic-page browsing,
metadata lookup, and vocabulary resolution — all against the anonymous, read-only
public API. No authentication, no writes.

---

## Table of contents

- [Concept](#concept)
- [Features](#features)
- [Requirements](#requirements)
- [Installation](#installation)
- [Configuration](#configuration)
- [Running the server](#running-the-server)
- [REST API](#rest-api-public-read-only)
- [Prompt launcher](#prompt-launcher)
- [Tools](#tools)
- [Output formats](#output-formats)
- [Filters & vocabulary](#filters--vocabulary)
- [Deployment](#deployment)
- [Security & operations](#security--operations)
- [Architecture](#architecture)
- [Development](#development)
- [Further documents](#further-documents)

---

## Concept

In WLO, a **Sammlung** (collection) and a **Themenseite** (topic page) are the
same thing: a curated thematic page that bundles educational content in
**swimlanes** (Schwimmlinien / carousels), grouped by topic, subject, or level.
Sub-collections are sub-topic-pages. A collection that carries a
`ccm:page_config_ref` property has a curated **topic page** with target-group
specific variants (teachers / learners / general).

Everything the server returns is public OER metadata; the server is a thin,
stateless proxy in front of edu-sharing.

## Features

- **22 MCP tools** — content search, collection search, combined search, topic
  pages and their swimlane content, subject portals, tree browsing, node
  details (single & bulk), vocabulary lookup, publisher lookup, health check,
  Wikipedia summary, full compendium text, scoped in-collection search, related
  content, collection statistics, node breadcrumb, **WLO skill discovery**, and
  the ChatGPT `search`/`fetch` knowledge tools.
- **OpenAI Apps SDK support** — display tools return `structuredContent`
  (per-tool `outputSchema`) with read-only `annotations`, the server advertises
  cross-tool `instructions`, and four tools ship an inlined `ui://` widget
  (combined search results with an in-widget detail view, topic-page swimlanes
  under a title/description header, and an interactive collection browser),
  each described by widget `_meta` (description, CSP, `prefersBorder`) —
  theme-aware, WCAG 2.2 AA, DE/EN. Non-Apps clients are unaffected.
- **Quality reranking** — multi-query expansion (synonyms, keyword, title,
  stop-word variants) fused with Reciprocal Rank Fusion (RRF) and a metadata
  quality score. Deterministic ordering.
- **Three transports** — stdio, standalone Streamable HTTP, and a Vercel
  serverless function — all from one transport-agnostic server factory.
- **Public REST layer** (HTTP mode) — read-only `GET /api/{search,compendium,
  topic-page,wikipedia}` wrappers over the same services, for non-MCP AI tools
  and the prompt launcher. Rate-limited, CORS `GET`, validated. See
  [REST API](#rest-api-public-read-only).
- **Prompt launcher** (HTTP mode) — a self-contained, bilingual (DE/EN) static
  page at `/launcher.html`, guided by **Boerdi** the WLO owl: pick your AI and one
  **Open** button hands that chat the knowledge to use the WLO services itself
  (search + raw JSON + ready-made skills from `GET /api/collection`), as a
  Claude/ChatGPT/Copilot/Gemini message. Advanced query fields collapse by default;
  a bookmarklet pre-fills a selection. See [Prompt launcher](#prompt-launcher).
- **German ⇄ URI vocabulary** — filters accept German labels
  (`Mathematik`, `Grundschule`, `Lehrer/in`, `Video`) or full URIs.
- **Hardened HTTP mode** — upstream timeouts, request-body size limit, per-IP
  rate limiting, URL-encoded node IDs, structured JSON logging.

## Requirements

- **Node.js ≥ 20** (pinned in `package.json` `engines`; CI and the Docker image
  build/test against Node 20).
- **npm ≥ 9**.

## Installation

```bash
git clone <repo-url>
cd wlo-mcp-server
npm install
npm run build
```

## Configuration

All configuration is via environment variables. Copy `.env.example` to `.env`
and adjust as needed. Only `WLO_REPOSITORY_URL` is commonly changed; everything
else has sensible defaults.

| Variable | Default | Scope | Description |
|---|---|---|---|
| `WLO_REPOSITORY_URL` | `https://redaktion.openeduhub.net/edu-sharing` | all | edu-sharing instance the server talks to. Paths are identical across instances, so this base URL is the only switch between prod / staging / a custom repository. Input is forgiving: whitespace, trailing slash(es), and a trailing `/rest` are stripped; a missing protocol defaults to `https://`; a bare host gets `/edu-sharing` appended. Suspicious values (deep `/components/...` links, double `/edu-sharing`) log a startup warning. |
| `WLO_ROOT_COLLECTION_ID` | per host | all | Root node of the collection hierarchy — **repository-bound**. The known WLO hosts (prod `redaktion.openeduhub.net`, staging `repository.staging.openeduhub.net`) get a per-host default automatically (the same id on both today, live-verified 2026-07-17, but maintained per host). Any **other** edu-sharing instance must set this explicitly — otherwise the server logs a startup warning and falls back to the WLO id, which will not exist there. |
| `WLO_SKILLS_COLLECTION_ID` | _(unset)_ | all | nodeId of the WLO collection holding the launcher **skills** (uploaded Markdown files). When set, `GET /api/collection` with no `nodeId` defaults to it. Unset → callers pass an explicit `?nodeId=`. |
| `WLO_POOL_SIZE` | `25` | all | Candidate pool size **per search variant** for reranking (`enhancedSearch`) — **not** the number of returned hits (that is `maxResults`). Smaller = faster/smaller fetches at minimally lower recall. |
| `WLO_FETCH_TIMEOUT_MS` | `10000` | all | Per-request timeout (ms) for every upstream edu-sharing call. Prevents a hung backend socket from blocking a tool call. |
| `PORT` | `3000` | HTTP mode | Port for the standalone HTTP server. |
| `MCP_SSE` | `false` | HTTP mode | When truthy (`1`/`true`/`yes`), serve `POST /mcp` as a real Server-Sent-Events stream (required by ChatGPT developer mode). Default is single-JSON responses (maximal client compatibility). Behind a reverse proxy, buffering **must** be disabled for the `/mcp` location — see [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md). The Docker image defaults this to `1`. |
| `WLO_WIDGET_MIME` | `text/html;profile=mcp-app` | all | MIME type for the inlined Apps-SDK widget resources. Default is the MCP-Apps standard (portable). Set to `text/html+skybridge` if a legacy ChatGPT runtime does not render the widgets with the standard value. |
| `WLO_WIDGET_DOMAIN` | unset | all | App identity domain for the ChatGPT plugin submission (required + unique per app there; widgets render under `<domain>.web-sandbox.oaiusercontent.com`). When set, it is emitted on `_meta.ui.domain` **and** its `openai/widgetDomain` alias; **when unset, on neither** — a host validates the domain against its own sandbox format and rejects the whole widget (aborting the bound tool call) for a foreign value: Claude expects `{hash}.claudemcpcontent.com` and normalises the vendor alias onto the standard key, so dropping only one is not enough. Leave unset for Claude and every non-ChatGPT host. The widget CSP allowlist stays the edu-sharing origin regardless. |
| `MAX_BODY_BYTES` | `1048576` (1 MB) | HTTP mode | Max request-body size; larger POSTs get `413`. Caps a memory-exhaustion vector. |
| `RATE_LIMIT_RPM` | `120` | HTTP mode | Requests/minute **per client IP** on the MCP endpoint; over the limit returns `429`. `/health` is exempt. Set `0` to disable (e.g. behind a WAF/platform limiter). |
| `API_RATE_LIMIT_RPM` | `30` | HTTP mode | Requests/minute **per client IP** on the public REST endpoints (`GET /api/*`); over the limit returns `429`. Tighter than `RATE_LIMIT_RPM` because it is an anonymous public surface. Set `0` to disable. |
| `TRUST_PROXY` | `false` | HTTP mode | When truthy (`1`/`true`/`yes`), take the client IP from the rightmost (proxy-appended) `X-Forwarded-For` hop instead of the socket address — required for correct per-client rate limiting **behind a reverse proxy**. Off by default because `X-Forwarded-For` is spoofable on a directly-exposed server. |

> **One server = one repository.** Each process points at exactly one
> edu-sharing instance. To serve prod and staging in parallel, deploy two
> instances with different `WLO_REPOSITORY_URL`.

## Running the server

```bash
node dist/stdio.js        # stdio transport (Claude Desktop, local clients)
node dist/http.js         # HTTP mode → http://localhost:3000/mcp

npm run dev               # stdio with auto-reload (tsx)
npm run dev:http          # HTTP with auto-reload (tsx)
npm test                  # offline unit/smoke tests (node:test)
```

## REST API (public, read-only)

In HTTP mode the server also exposes a small **public REST layer** — thin `GET`
wrappers over the same services the MCP tools use, for non-MCP AI tools and the
prompt launcher. Read-only, `CORS *` for `GET`, per-IP rate-limited
(`API_RATE_LIMIT_RPM`, default 30/min), inputs validated server-side (query ≤
200 chars, nodeId ≤ 50, ≤ 25 ids). Responses are JSON with `Cache-Control:
no-store` + `nosniff`; errors are `{ "error": "…" }` with a `4xx`/`5xx` status.
One deliberate exception: `GET /api/search` **without a term** returns a `200`
guidance envelope (empty buckets + `warnings`) instead of a `400` — AI fetch
layers strip query strings from model-built URLs and surface only the status,
so the guidance must live in a readable body. The surface is self-describing
for AI fetchers via [`/llms.txt`](public/llms.txt) and permissive
[`/robots.txt`](public/robots.txt).

| Endpoint | Query params | Returns |
|---|---|---|
| `GET /api/search/<term>` | Path form of `/api/search` — the term rides in the **path**, filters stay optional query params. Preferred for AI tools: some AI fetch layers strip the query string from model-built URLs (live-diagnosed), and the path form survives that — a stripped request only loses the filters, not the search. An explicit `q` query param wins over the path term. | Same envelope as `GET /api/search`. |
| `GET /api/search` | `q` (required), `educationalContext`, `discipline`, `learningResourceType`, `userRole`, `publisher`, `maxContent`, `maxCollections`, `skipCount`, `include` (`content,collections,topicPages`), `includeCompendium`, `includeTextContent`, `includeWikipedia`, `includeTopicPageContent`, `maxPerSwimlane`, `includeFacets`, `fields` | The combined `search_wlo_all` envelope (`content` / `collections` / `topicPages` buckets, optional `wikipedia`). Adds `unresolvedFilters` (mistyped vocab filters + "did you mean" suggestions) when any filter doesn't resolve, and — with `includeFacets=1` — `facets` (`{label, count, uri}` per bucket; the `discipline` facet resolves university subjects, see below). Optional `fields=title,url,…` trims each result item to those keys (`nodeId` always kept) — a token saving for LLM clients reading the raw JSON. |
| `GET /api/collection` | `nodeId` (defaults to `WLO_SKILLS_COLLECTION_ID`), `q` (optional, search within), `max`, `fields`, vocab filters | A collection's contents: `{ collectionId, query, total, results: [{ nodeId, title, description, learningResourceTypes, publisher, url, downloadUrl }] }`. Without `q` it lists the direct file children (reliable for reference collections); with `q` it searches within. Optional `fields=…` trims each result item (`nodeId` always kept). The launcher's **skills** source — each result's `downloadUrl` serves the raw Markdown. |
| `GET /api/compendium` | `ids` (comma-separated) or `nodeId`, ≤ 25 | `{ entries: [{ nodeId, title, compendiumText }] }` — the FULL editorial compendium text. |
| `GET /api/topic-page` | `collectionId` or `variantId` (≥ 1 required), `targetGroup` (`teacher`/`learner`/`general`), `maxPerSwimlane` | The render-ready swimlane payload (`variantTitle`, `topicPageUrl`, `swimlanes[]`). |
| `GET /api/wikipedia` | `q` (required), `lang` (default `de`), `sections` (1–3) | A Wikipedia lead summary `{ title, extract, thumbnail?, url, lang }`, or `404` when no article matches. |
| `GET /api/skills` | — | The skill catalogue `{ skills: [{ id, name, description, path }] }` for AI apps (see [Prompt launcher](#prompt-launcher)). |
| `GET /api/skills/<id>` | — | One skill's **raw Markdown** (`text/markdown`), or `404` for an unknown id. `<id>` is a stable slug today (intended to become a WLO nodeId later). |

```bash
curl "http://localhost:3000/api/search?q=Photosynthese&includeWikipedia=1"
```

The REST layer is served by `http.ts` only — **not** by the Vercel handler
(`api/mcp.ts`).

## Prompt launcher

In HTTP mode the server serves a static, bilingual (DE/EN) **prompt launcher** at
`GET /launcher.html` (and `GET /` as a convenience), guided by **Boerdi**, the WLO
owl mascot who helps users set up the WLO services. It is a self-contained page —
no third-party scripts, fonts, or requests. You pick your AI and click one **Open**
button; the launcher hands that chat the **knowledge** to use the WLO services
itself. The generated message explains

- how to search — `GET /api/search?q=…` (+ the `discipline` / `educationalContext`
  / `learningResourceType` filters and the `includeWikipedia` / `includeCompendium`
  flags) — and to load the JSON result **raw** and summarise it,
- the other endpoints (`/api/topic-page`, `/api/compendium`, `/api/wikipedia`), and
- how to use ready-made **skills**: list them at `GET /api/collection` (the
  configured WLO skills collection) and load each skill's raw Markdown from its
  `downloadUrl`.

Advanced query fields (subject / level / type) are **collapsed by default**; an
optional search term is woven in as a concrete example and drives the **Load raw
result** button. The message can be **copied** into any chat or opened via a deep
link in **Claude** (`claude.ai/new?q=`), **ChatGPT** (`chatgpt.com/?q=`), or
**Microsoft Copilot** (`copilot.microsoft.com/?q=`); for **Gemini** (no native URL
prefill) the app opens and the message is placed on the clipboard to paste.
Natively-registered MCP clients get the same skills via the `find_wlo_skills` tool.
A [bookmarklet](public/bookmarklet.md) opens the launcher pre-filled with the text
selected on any page (`/launcher.html?q=<selection>`).

## Tools

| # | Tool | Purpose | Output |
|---|---|---|---|
| 1 | `search_wlo_collections` | Search collections/topic pages (keyword + tree fallback) | markdown / json |
| 2 | `search_wlo_content` | Full-text search for individual content items | markdown / json |
| 3 | `get_collection_contents` | Items / sub-collections of a collection (paginated, optional recursive) | markdown / json |
| 4 | `get_node_details` | Full metadata for one node + optional full text + parents + raw URIs | markdown / json |
| 5 | `search_wlo_all` | **Combined**: content + collections + topic pages in one parallel call, separate buckets | markdown / json |
| 6 | `lookup_wlo_vocabulary` | List valid labels/URIs for a filter vocabulary | markdown |
| 7 | `search_wlo_topic_pages` | Find/list topic pages, merge target-group variants | markdown / json |
| 8 | `get_subject_portals` | The top-level subject portals under the WLO root | markdown / json |
| 9 | `browse_collection_tree` | Drill into sub-collections (depth 1–2), optional file counts | markdown / json |
| 10 | `wlo_health_check` | Reachability + latency of the WLO API | json |
| 11 | `get_nodes_details` | Bulk metadata for many `nodeIds` in parallel | json |
| 12 | `get_topic_page_content` | The swimlane **content structure** of a topic page, render-ready | markdown / json |
| 13 | `get_wikipedia_summary` | Short Wikipedia lead extract (+ link) for a term — encyclopedic context | markdown / json |
| 14 | `get_compendium_text` | FULL editorial compendium text of one/more collections (bulk, ≤25) | markdown / json |
| 15 | `search_wlo_within_collection` | Filtered full-text search scoped to one collection subtree | markdown / json |
| 16 | `search` | ChatGPT knowledge convention: lightweight hits `{id,title,url}` across WLO | json (+ text) |
| 17 | `fetch` | ChatGPT knowledge convention: one node's full document `{id,title,text,url,metadata}` | json (+ text) |
| 18 | `lookup_wlo_publishers` | List publishers/sources with per-publisher content counts (facet) | markdown / json |
| 19 | `get_related_content` | "More like this": content sharing a seed node's subject/level (+ optional siblings) | markdown / json |
| 20 | `get_node_breadcrumb` | A collection's ancestor path (root → node) in the content tree | markdown / json |
| 21 | `get_collection_stats` | A collection's composition: file/sub-collection counts + type/subject/level breakdown | markdown / json |
| 22 | `find_wlo_skills` | Find WLO "skills" (reusable instruction Markdown curated in a WLO collection) matching a task and return their instructions to apply | markdown / json |

The display/search tools also return `structuredContent` (validated against a
per-tool `outputSchema`) and carry `annotations` (`readOnlyHint`; `openWorldHint`
for `get_wikipedia_summary`) — the OpenAI Apps SDK / MCP Apps foundation. The
server advertises cross-tool usage `instructions`. See [`docs/plans/`](docs/plans/).

### Tool routing heuristic (for LLMs)

- Broad topic, wants content **and** collections **and** topic pages together → `search_wlo_all`.
- A material/resource type (video, worksheet, …) → `search_wlo_content`.
- A topic page / collection on a subject → `search_wlo_topic_pages` (mode B, with `query`).
- Navigate a subject (drill-down) → `get_subject_portals`, then `browse_collection_tree`.
- User clicks a card → `get_node_details` with that `nodeId`.
- Need metadata for N shown cards → `get_nodes_details(nodeIds=[...])` (one call, not N).
- See what is **on** a topic page → `get_topic_page_content` (after `search_wlo_topic_pages`).

### Tool details

**1. `search_wlo_collections`** — `query`, `parentNodeId?`, `educationalContext?`,
`discipline?`, `userRole?`, `maxResults?` (1–50, default 5), `excludeNodeIds?`
(≤200), `outputFormat?`. Tries a keyword collection search first, then a bounded
tree traversal from the root/parent.

**2. `search_wlo_content`** — `query` (required), `educationalContext?`,
`discipline?`, `userRole?`, `learningResourceType?`, `publisher?`, `maxResults?`
(1–50, default 8), `excludeNodeIds?` (≤200), `includeTextContent?` (default
false — also fetch each result's stored full text, capped; one round-trip per
result), `includeFacets?` (default false — facet counts in `_queryMeta.facets`,
run in parallel), `outputFormat?`. Multi-query expansion + quality reranking.

**3. `get_collection_contents`** — `nodeId` (required), `query?`, `contentFilter?`
(`files` | `folders` | `both`, default `files`), `includeSubcollections?`
(recursive, files only), `maxResults?` (1–100, default 20), `skipCount?`,
`excludeNodeIds?` (≤200), `outputFormat?`.

**4. `get_node_details`** — `nodeId` (required), `includeTextContent?`,
`includeParents?`, `includeRaw?`, `outputFormat?`. Returns the same
`FormattedNode` shape as search tools, plus optional stored full text, parent
collections, and raw `ccm:*`/`cclom:*` URIs. For collections with a curated
**compendium text** (`ccm:oeh_collection_compendium_text`), it comes back as
`compendiumText` — the most authoritative collection summary. The detail tools
carry the full text (`-all-` query); collection search/list/browse also carry it
(part of `DISPLAY_PROPS`) — capped at 500 chars in `markdown`, full in `json`.

**5. `search_wlo_all`** — `query` (required), the five filters, `maxContent?`
(1–50, default 8), `maxCollections?` (1–20, default 5), `include?`
(`['content','collections','topicPages']`), `excludeNodeIds?` (≤200),
`skipCount?` (content paging), `includeFacets?` (default false — facet counts in
`_queryMeta.facets`, run in parallel), and the opt-in enrichment flags
`includeCompendium?` / `includeTextContent?` / `includeWikipedia?` /
`includeTopicPageContent?` (+ `maxPerSwimlane?`, 1–10, default 3),
`outputFormat?` (default `markdown` — compact text; the full bucket envelope
always rides in `structuredContent`, and `json` puts it in the text too). Runs
content, collection, and (when requested)
Wikipedia search in parallel and returns three buckets (+ optional `wikipedia`);
enrichments run bounded/parallel over the results. Note on `total`:
`content.total` is the true backend hit count; `collections.total`/
`topicPages.total` are the shown counts. The logic lives in
`src/services/search.ts::searchAll` (shared with the REST layer and widgets).

**6. `lookup_wlo_vocabulary`** — `vocabulary` (`educationalContext` | `discipline`
| `userRole` | `lrt` | `license` | `targetGroup` | `universitySubject`). Lists
labels + URIs; purely local, no API call. `universitySubject` (Hochschulfächer,
344 concepts) is large, so pass a free-text `query` (e.g. `"Maschinenbau"`) to get
a short fuzzy pick-list of `{label, uri}` — the chosen `uri` is usable directly as
a `discipline` filter. Model-free (Levenshtein), never auto-resolved.

**7. `search_wlo_topic_pages`** — `query?`, `targetGroup?` (`teacher` | `learner`
| `general`), `educationalContext?`, `collectionId?`, `mergeVariants?` (default
true), `sort?` (`relevance` | `alpha`), `maxResults?` (1–20, default 5),
`includeContent?` (default false; JSON mode — attach each page's resolved
swimlane `content`, ≤5 parallel) + `maxPerSwimlane?` (1–10, default 3),
`outputFormat?`. Three modes: by `collectionId` (direct), by `query` (search →
check for topic page), or filters-only (list all).

**8. `get_subject_portals`** — `educationalContext?`, `includeContentCounts?`,
`outputFormat?`. The first-level collections directly under the WLO root
(Mathematik, Informatik, …), alphabetically ordered.

**9. `browse_collection_tree`** — `nodeId?` **or** `subject?` (at least one; give
a subject/Fachportal name like `"Mathematik"`/`"Mathe"` and it is resolved to its
portal server-side — no `get_subject_portals` round-trip needed; an unknown
subject returns the list of available portals), `depth?` (1–2, default 1),
`includeContentCounts?`, `includeContentPreview?` (1–5 — attach the first N
content items of each sub-collection as `contentPreview`, bounded pass),
`maxResults?` (1–100, default 50), `outputFormat?`.

**10. `wlo_health_check`** — no parameters. Returns `ok`, latency, repository URL,
resolved root title.

**11. `get_nodes_details`** — `nodeIds` (array, 1–50, required),
`includeTextContent?` (default false), `includeParents?` (default false). Bulk
metadata (the same `FormattedNode` shape, keyed by nodeId), optionally enriched
per node like `get_node_details`. Failed lookups are returned in a `failed`
array, not as an overall error.

**12. `get_topic_page_content`** — `collectionId?` **or** `variantId?` (at least
one required), `targetGroup?`, `outputFormat?`, `maxPerSwimlane?` (1–10, default
3). Returns the topic page's swimlane sections. In JSON mode each swimlane is
**render-ready**: it carries its heading plus up to `maxPerSwimlane` real content
cards, resolved by executing the swimlane widget's saved query, with a `hasMore`
flag and a `topicPageUrl` jump link. Use after `search_wlo_topic_pages`.

**13. `get_wikipedia_summary`** — `query` (required, ≤200), `language?` (ISO-639,
default `de`), `sections?` (1–3 leading paragraphs, default 1), `outputFormat?`.
Returns a Wikipedia lead extract with a link (and optional thumbnail), resolving
a fuzzy/misspelled query via opensearch when the direct title misses. For
encyclopedic context alongside WLO material — not for OER material search.
`readOnlyHint` + `openWorldHint`.

**14. `get_compendium_text`** — `nodeId?` **or** `nodeIds?` (array, ≤25),
`outputFormat?`. Returns the FULL, untruncated editorial compendium text of the
given collection(s) — the authoritative prose overview — for when a collection
result shows only the 500-char preview. `compendiumText` is `null` for nodes
without the property.

**15. `search_wlo_within_collection`** — `nodeId` (required, the collection),
`query?`, the five vocab filters, `maxResults?` (1–50, default 10), `skipCount?`,
`outputFormat?`. A full-text search scoped to one collection subtree (via
`virtual:primaryparent_nodeid`) — "which videos on X are in this collection?".
Use `search_wlo_content` for an unscoped search, `get_collection_contents` to
list a collection unfiltered.

**18. `lookup_wlo_publishers`** — `query?`, `discipline?`, `educationalContext?`,
`maxResults?` (1–100, default 20), `outputFormat?`. Lists the publishers/sources
(`ccm:oeh_publisher_combined`) with per-publisher content counts, via a facet
aggregation over the live index (largest first). Optionally scoped to a topic /
subject / level. Use it to discover valid values for the `publisher` filter.

**19. `get_related_content`** — `nodeId` (required, the seed), `maxResults?`
(1–30, default 8), `includeSiblings?` (default `false`), `outputFormat?`. Reads
the seed's disciplines + educational contexts and finds other material with the
same profile (the seed excluded); `includeSiblings` also returns the other
contents of the seed's primary parent collection. "Was passt noch dazu?"

**20. `get_node_breadcrumb`** — `nodeId` (required), `outputFormat?`. Returns the
node's ancestor path ordered root → node (one `/parents` call, cycle-guarded,
depth-capped). Works for collection nodes; file/content nodes have no breadcrumb
and return an empty path.

**21. `get_collection_stats`** — `nodeId` (required), `outputFormat?`. Summarizes
a collection: total file and sub-collection counts, plus a breakdown of its files
by learning-resource type, subject, and level. The breakdown is tallied over the
collection's actual child files (a sample of up to 100 — reported when the total
is larger), which is accurate for reference collections where a facet query is not.

**22. `find_wlo_skills`** — `query?`, `maxResults?` (1–20, default 5),
`includeContent?` (default true), `nodeId?`, `outputFormat?`. Finds WLO **skills**
— reusable instruction documents (Markdown) curated as uploaded files in a WLO
collection — that match a task, and returns their raw instructions to apply.
`nodeId` defaults to `WLO_SKILLS_COLLECTION_ID`; omit `query` to list all
available skills. Each result's title/description says what the skill does and
when to use it. Shares its listing/fetch logic with `GET /api/collection`, so
native MCP clients get the same skills capability as the launcher/REST path.

## Output formats

Most tools accept `outputFormat: "markdown"` (default, human-readable) or
`"json"` (structured, easier to parse). Search-family tools also append a
`_queryMeta` text part carrying the executed query, filters, pagination, and a
`searchUrl` back-link — for consumers that want to reconstruct the search.

`_queryMeta` may also carry two optional blocks:

- **`unresolvedFilters`** — `{ field, value }[]` of vocab filters the caller
  supplied that could not be resolved to a URI and were therefore dropped from
  the search. Surfaced so the caller can self-correct (e.g. via
  `lookup_wlo_vocabulary`). Omitted when everything resolved.
- **`facets`** — present only with `includeFacets: true`: facet counts keyed by
  filter name, e.g. `{ learningResourceType: [{ label: "Video", count: 1203 }], … }`
  — how many hits per type/subject/level, so a client can offer targeted
  narrowing without probe-searches.

The shared `FormattedNode` shape (output of all content-returning tools):

```ts
{
  nodeId: string;
  title: string;
  description: string;
  keywords: string[];
  disciplines: string[];            // labels, e.g. ["Mathematik"]
  educationalContexts: string[];    // labels, e.g. ["Sekundarstufe I"]
  userRoles: string[];              // labels, e.g. ["Lehrer/in"]
  learningResourceTypes: string[];  // labels, e.g. ["Arbeitsblatt"]
  url: string;                      // primary "open this" link (ccm:wwwurl or viewer)
  downloadUrl: string;              // direct binary download (files only), else ""
  contentUrl: string;              // in-repo viewer URL, else ""
  previewUrl: string;               // thumbnail (may be a generic icon)
  previewIsIcon: boolean;           // true = generic mediatype icon, not a real thumbnail
  mimeType: string;                 // e.g. "application/pdf", else ""
  fileSize: number;                 // bytes (0 for nodes without binary content)
  license: string;                  // label, e.g. "CC BY-SA 4.0"
  publisher: string;
  nodeType: 'collection' | 'content';
  topicPageUrl: string;             // set when ccm:page_config_ref is present
  textContent?: string;             // stored full text — only with includeTextContent
  compendiumText?: string;          // editorial collection summary — full on detail tools (`-all-`); also in collection search/list, capped to 500 chars in markdown
}
```

## Filters & vocabulary

Filters accept German labels or full URIs. Resolution is asymmetric on purpose:

- **Input (label → URI)** is conservative on the school-subject vocabulary to
  avoid ambiguous over-broad matches.
- **Display (URI → label)** uses the server-side `<property>_DISPLAYNAME` fields
  from the edu-sharing index, which cover both the school and higher-education
  vocabularies without a local mapping.

Use `lookup_wlo_vocabulary` to discover valid values. Authoritative sources are
the official SKOS vocabularies at `https://vocabs.openeduhub.de`.

**University subjects (Hochschulfächersystematik).** School and university
subjects share many labels ("Mathematik", "Physik", …), so the university
vocabulary is deliberately kept out of *input* resolution — `discipline="Mathematik"`
always means the school subject, never an ambiguous match. To filter by a
*university* subject there are two model-free paths, both conflict-free:
1. **Facet-driven (corpus-grounded):** run a faceted search (`includeFacets: true`)
   and read the `discipline` facet — each bucket carries a readable `label`
   (university subjects resolved via the bundled `src/vocabs-hochschule.ts`) **and**
   its concept `uri`; pass that `uri` back as `discipline` (raw URIs are accepted).
2. **Fuzzy lookup:** `lookup_wlo_vocabulary` with `vocabulary="universitySubject"`
   and a `query` returns a short `{label, uri}` pick-list (Levenshtein, no ML); the
   model picks one and filters by its `uri`.

Both keep the university vocabulary out of *input* label resolution, so there is
never a local school↔university conflict.

**API base URLs:** the REST API lives at `<WLO_REPOSITORY_URL>/rest/...`, the
frontend (render and topic-page links) at `<WLO_REPOSITORY_URL>/components/...`.
Paths are identical across edu-sharing instances.

## Deployment

### Vercel (serverless)

`api/mcp.ts` is a Streamable-HTTP handler; `vercel.json` rewrites `/mcp` and `/`
to it. Set `WLO_REPOSITORY_URL` as a project env var. Rate/body limits are not
applied here — the platform provides them.

### Docker

```bash
docker compose up -d --build          # build + run detached (recommended)
# or, without compose:
docker build -t wlomcp .
docker run -p 3000:3000 wlomcp        # prod default
# → http://localhost:3000/mcp  ·  /health  ·  /api/*  ·  /launcher.html
```

The image bundles the built widgets (`dist-widgets/`) and the public launcher +
skills (`public/`), runs as the non-root `node` user, pins the base image by
digest, and has a `HEALTHCHECK` on `/health`.

**SSE and the reverse proxy.** The image defaults to real Server-Sent-Events
streaming (`MCP_SSE=1`), which ChatGPT developer mode requires. A reverse proxy
in front (nginx/Traefik/Caddy) **must not buffer** the `/mcp` response or the
stream never reaches the client — for nginx set `proxy_buffering off;` and a long
`proxy_read_timeout` on that location. Override with `-e MCP_SSE=0` to fall back
to single-JSON responses (curl / simple clients). Behind a TLS-terminating proxy,
also set `TRUST_PROXY=1`.

**Full vServer walkthrough** — `.env` configuration, the complete nginx SSE
config, TLS, verification, and the ChatGPT developer-mode gate — is in
[`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md). Every compose setting is overridable
via a `.env` file (auto-loaded) without editing the tracked compose file.

### Local

```bash
npm install && npm run build
node dist/http.js                                                        # prod default
WLO_REPOSITORY_URL=https://repository.staging.openeduhub.net/edu-sharing node dist/http.js
```

### Apps-SDK submission & privacy

- [`docs/apps-sdk-submission-checklist.md`](docs/apps-sdk-submission-checklist.md)
  — each OpenAI Apps-SDK requirement mapped to its implementing artifact, plus
  golden demo prompts and the remaining operator actions.
- [`docs/apps-sdk-golden-prompts.md`](docs/apps-sdk-golden-prompts.md) — the full
  developer-mode evaluation set (direct / indirect / negative prompts + a
  precision-recall log) to dogfood tool selection and confirm the widgets render.
- [`docs/PRIVACY.md`](docs/PRIVACY.md) — the baseline privacy policy (stateless,
  read-only, no personal data stored) for operators to adapt and publish.

## Security & operations

- **HTTP-mode hardening:** every upstream request has a timeout
  (`WLO_FETCH_TIMEOUT_MS`); request bodies are capped (`MAX_BODY_BYTES`, `413`
  over the limit); the MCP endpoint is per-IP rate-limited (`RATE_LIMIT_RPM`,
  `429` over the limit); node IDs are URL-encoded before being interpolated into
  upstream URLs. Behind a reverse proxy, set `TRUST_PROXY=1` so rate limiting
  keys on the real client IP.
- **Public REST surface:** `GET /api/*` is read-only, has its own tighter per-IP
  limiter (`API_RATE_LIMIT_RPM`, default 30/min), rejects non-`GET` methods
  (`405`), validates every input server-side (query/nodeId/id-count caps), and
  never leaks internal error detail (generic `500`). CORS is `*` for `GET` only.
- **Hardening asymmetry:** body/rate limits apply in the standalone HTTP server,
  **not** in the Vercel handler (`api/mcp.ts`), which relies on the platform.
- **`npm audit`:** the production dependency tree is free of high/critical
  advisories (`npm audit --omit=dev --audit-level=high`, wired as a CI gate).
  The full tree now carries a single **low, dev-only** advisory (`esbuild`,
  pulled in by `tsx` — a Windows dev-server file-read issue), which is neither
  shipped nor run in CI/production: a production install (`npm ci --omit=dev`, as
  in the Dockerfile) contains none. The former `@vercel/node` dev tree (undici et
  al.) was dropped — `api/mcp.ts` now uses local `node:http` request/response
  types. The server uses Node's built-in `fetch`.
- **Monitoring & logging:** `GET /health` (HTTP mode) returns `200` with a small
  JSON status — use it for uptime monitoring; the Docker `HEALTHCHECK` targets
  it. For "is WLO reachable" (upstream, not proxy) use the `wlo_health_check`
  tool. Logs are structured JSON lines on **stderr** (`ts`, `level`, `name`,
  `msg` + fields); stdout is reserved for the MCP stdio framing.

## Architecture

```
wlo-mcp-server/
├── src/
│   ├── server.ts             # factory: registers all 22 tools (transport-agnostic)
│   ├── tools/                # tool definitions, grouped by responsibility
│   │   ├── shared.ts         #   _queryMeta, filter builder, mapPool, toolError, title fallbacks
│   │   ├── collections.ts    #   search_wlo_collections, get_collection_contents, search_wlo_within_collection
│   │   ├── content-search.ts #   search_wlo_content, search_wlo_all
│   │   ├── node-details.ts   #   get_node_details, get_nodes_details
│   │   ├── node-relations.ts #   get_related_content, get_node_breadcrumb
│   │   ├── collection-stats.ts #  get_collection_stats
│   │   ├── skills.ts         #   find_wlo_skills
│   │   ├── vocabulary.ts     #   lookup_wlo_vocabulary, lookup_wlo_publishers
│   │   ├── topic-pages.ts    #   search_wlo_topic_pages
│   │   ├── topic-page-content.ts # get_topic_page_content
│   │   ├── browse.ts         #   get_subject_portals, browse_collection_tree
│   │   ├── compendium.ts     #   get_compendium_text
│   │   ├── wikipedia.ts      #   get_wikipedia_summary
│   │   ├── knowledge.ts      #   search, fetch (ChatGPT knowledge tools)
│   │   └── health.ts         #   wlo_health_check
│   ├── services/             # business logic reused by tools + REST + widgets
│   │   ├── search.ts         #   searchAll (combined search + opt-in enrichments)
│   │   ├── compendium.ts     #   getCompendiumTexts
│   │   ├── publishers.ts     #   lookupPublishers (facet-based counts)
│   │   ├── related.ts        #   getRelatedContent
│   │   ├── stats.ts          #   getCollectionStats
│   │   ├── skills.ts         #   findSkills (list + rank + fetch raw Markdown)
│   │   └── topic-page.ts     #   resolveTopicPageSwimlanes
│   ├── apps/                 # OpenAI Apps-SDK seam + widgets
│   │   ├── register.ts       #   registerWloTool (outputSchema/annotations/_meta.ui)
│   │   ├── tool-defaults.ts  #   applyReadOnlyToolDefaults: noauth _meta + required hints + status, on every tool
│   │   ├── tool-status.ts    #   per-tool openai/toolInvocation status strings (DE)
│   │   ├── outputSchemas.ts  #   zod structuredContent schemas
│   │   ├── resources.ts      #   ui:// widget resources (loads dist-widgets/)
│   │   ├── instructions.ts   #   server instructions block
│   │   └── widgets/          #   vanilla-TS widgets (esbuild → dist-widgets/*.html)
│   ├── vocabs.ts             # label ↔ URI mappings (6 vocabularies)
│   ├── vocabs-hochschule.ts  # university-subject URI→label (display-only; NOT in resolveVocab)
│   ├── vocab-suggest.ts      # fuzzy vocab suggestions (levenshtein, ≤2 edits)
│   ├── wlo-api.ts            # barrel re-export of the edu-sharing REST client
│   ├── wlo-config.ts         #   env config + shared types + wloFetch + DISPLAY_PROPS
│   ├── wlo-search.ts         #   search endpoints (ngsearch, collection keyword search)
│   ├── wlo-node.ts           #   node endpoints (children/metadata/text/download/breadcrumb) + URL builders
│   ├── topic-page-api.ts     # topic-page API (page_variant, swimlane parsing, variant→collection)
│   ├── wikipedia-api.ts      # Wikipedia REST summary client (opensearch title fallback)
│   ├── reranker.ts           # RRF merge + quality scoring (pure)
│   ├── query-expand.ts       # query → weighted backend variants (synonyms, stopwords)
│   ├── node-match.ts         # local node matching (text + criteria) for /children fallbacks
│   ├── formatter.ts          # WloNode → FormattedNode → markdown / json
│   ├── logger.ts             # minimal structured JSON logger (stderr only)
│   ├── rate-limit.ts         # in-memory per-IP rate limiter + client-IP resolution
│   ├── read-body.ts          # bounded request-body reader (413 support)
│   ├── mcp-transport.ts      # Streamable-HTTP transport options (MCP_SSE → JSON vs SSE)
│   ├── rest/                 # public read-only REST layer (GET /api/*) over the services
│   │   ├── validate.ts       #   input validation (query/nodeId/id-count caps, int clamp, fields)
│   │   ├── project.ts        #   field projection for /api/{search,collection} (?fields=)
│   │   ├── result.ts         #   RestResult shape + badRequest helper
│   │   ├── handlers.ts       #   the per-endpoint handlers (handleSearch, handleCollection, …)
│   │   ├── routes.ts         #   routeRestRequest (pure router) + handleRestRequest (http.ts adapter)
│   │   ├── skills.ts         #   skill registry + raw loader (GET /api/skills[/<id>])
│   │   └── static.ts         #   resolveStaticRoute (pure) + handleStaticRequest (serves /launcher.html)
│   ├── stdio.ts              # entry: stdio transport
│   └── http.ts               # entry: Streamable HTTP (CORS, rate/body limits, routing)
├── public/                   # static assets served by http.ts
│   ├── launcher.html         #   bilingual prompt launcher (self-contained; GET /launcher.html, GET /)
│   ├── bookmarklet.md        #   selection → launcher bookmarklet (install docs, DE/EN)
│   └── skills/               #   AI-app skills served raw via GET /api/skills/<id>
├── tests/                    # offline unit/smoke tests (node:test): npm test
├── api/mcp.ts                # Vercel serverless wrapper
├── docs/                     # DEPLOYMENT.md, PRIVACY.md, apps-sdk-submission-checklist.md, apps-sdk-golden-prompts.md, plans/
├── Dockerfile · docker-compose.yml · .dockerignore · vercel.json · .env.example
```

**Data flow:** transport entry (`stdio.ts` / `http.ts` / `api/mcp.ts`) →
`createMcpServer()` (`server.ts`) → a tool handler (`tools/*`) →
`wlo-api.ts`/`topic-page-api.ts` (all upstream calls via `wloFetch`) →
`reranker.ts` + `formatter.ts` → tool result. Dependencies point inward; there
are no circular imports.

### Library functions

The internal building blocks behind the tools (useful when reading or extending
the code), grouped by module.

**`wlo-api.ts` — edu-sharing REST client**

| Function | What it does |
|---|---|
| `ngsearch` | Full-text search for **file** nodes (FILES) |
| `searchCollectionsByKeyword` | **Collection search** — returns real `ccm:map` collections |
| `getCollectionContents` | Children (items / sub-collections) of a node |
| `getChildCollections` | Direct sub-collections (`filter=folders`) |
| `getNodeMetadata` / `getNodesMetadata` | Metadata for one / many nodes |
| `getNodeTextContent` | Stored full text of a node |
| `getNodeParents` | Parent nodes of a node |
| `wloFetch` | `fetch` wrapper that enforces the upstream timeout |
| `sanitizeRepositoryUrl` | Normalize a repository-URL input |
| `buildTopicPageUrl` / `buildRenderUrl` | Build frontend links |
| `appendPropertyFilter` | Append the repeated `propertyFilter` params |

**`topic-page-api.ts` — topic pages**

| Function | What it does |
|---|---|
| `searchPageVariants` | Search `page_variant` nodes |
| `resolveVariantCollection` | Resolve a variant back to its owning collection |
| `getCollectionThemePages` | Topic-page variants of a collection |
| `getTopicPageContent` | Parse a topic page's swimlane structure |

**Ranking, formatting, vocabulary**

| Function | Module | What it does |
|---|---|---|
| `enhancedSearch` | `reranker.ts` | Multi-query expansion + RRF + quality score |
| `rerankNodes` | `reranker.ts` | Re-sort already-fetched nodes by relevance |
| `sortByTitle` | `reranker.ts` | Deterministic alphabetical sort |
| `formatNode` / `formatNodes` | `formatter.ts` | `WloNode` → `FormattedNode` |
| `renderToText` / `renderToJson` | `formatter.ts` | `FormattedNode` → markdown / JSON |
| `resolveFacetCounts` | `formatter.ts` | Facet groups → labeled counts keyed by filter name |
| `resolveVocab` | `vocabs.ts` | Label → URI |
| `labelFromUri` | `vocabs.ts` | URI → label |
| `listVocab` | `vocabs.ts` | List a vocabulary's entries |

**HTTP infrastructure & tool helpers**

| Function | Module | What it does |
|---|---|---|
| `createRateLimiter` | `rate-limit.ts` | In-memory per-IP fixed-window limiter |
| `clientKey` | `rate-limit.ts` | Resolve client IP (honors `X-Forwarded-For` when `TRUST_PROXY`) |
| `readBodyWithLimit` | `read-body.ts` | Read the request body bounded by `MAX_BODY_BYTES` |
| `log` | `logger.ts` | Structured JSON logger (stderr) |
| `buildFilterCriteria` | `tools/shared.ts` | German labels/filters → search criteria |
| `queryMetaContent` | `tools/shared.ts` | Build the `_queryMeta` block |
| `toolError` | `tools/shared.ts` | Log + build a uniform tool-error result |
| `mapPool` | `tools/shared.ts` | Bounded-concurrency async map (fault-tolerant) |
| `pickThemePageTitle` | `tools/shared.ts` | Best human-readable topic-page title |
| `matchSubjectPortal` | `tools/browse.ts` | Resolve a subject name → its Fachportal node (tiered) |

## Development

- `npm run build` — TypeScript compile (strict).
- `npm test` — offline test suite (`node:test`), no network required.
- CI (`.github/workflows/ci.yml`) runs build + test on Node 20 with a production
  `npm audit` gate.
- See **[CONTRIBUTING.md](CONTRIBUTING.md)** for conventions (comment language,
  test discipline, commit style, security rules).

## Further documents

- **[CHANGELOG.md](CHANGELOG.md)** — notable changes.
- **[CONTRIBUTING.md](CONTRIBUTING.md)** — contribution guide.
- **[PERFORMANCE.md](PERFORMANCE.md)** — performance design notes.
- **[docs/apps-sdk-submission-checklist.md](docs/apps-sdk-submission-checklist.md)** — ChatGPT app submission requirements, each mapped to its evidence.
- **[docs/apps-sdk-golden-prompts.md](docs/apps-sdk-golden-prompts.md)** — the developer-mode evaluation prompt set (discovery precision/recall).
- **[README.de.md](README.de.md)** — German copy of this document.
