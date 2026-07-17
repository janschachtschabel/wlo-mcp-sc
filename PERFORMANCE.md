# WLO-MCP — Performance & Optimizations

> 🇬🇧 English · 🇩🇪 [Deutsche Fassung](PERFORMANCE.de.md)

As of: 2026-06-01. This document records the latency-relevant design decisions
of the MCP server — what has been implemented, which values are active, and where
potential still remains.

## Context
A search turn in the chatbot took a measured **9–18 s** (a factual question without
search ~4 s). Main costs: the edu-sharing searches (Vercel cold starts + several
edu-sharing REST calls per tool) and several sequential LLM calls in the backend.
The following MCP changes reduce the number + size of the edu-sharing calls.

## Implemented optimizations (2026-06-01)

### O1 — Combined tool `search_wlo_all`
Delivers **individual content + collections + topic pages in ONE call**, internally
`Promise.all`-parallel. Saves the backend the separate calls to
`search_wlo_content` + `search_wlo_collections` (= fewer MCP round trips /
cold starts). The return value is a structured envelope:
```json
{ "query": "...",
  "content":     { "total": N, "count": M, "results": [...] },
  "collections": { "total": N, "count": M, "results": [...] },
  "topicPages":  { "total": N, "count": M, "results": [...] } }
```
Topic pages = collections with `ccm:page_config_ref` → a single collection search
serves both pots (no separate pass). Deliberately uses the fast keyword path
(not the tree walk) → low concurrency.
*Status: implemented in the MCP AND wired up in the backend (2026-06-01).* The
chatbot calls `search_wlo_all` in the speculative prefetch for generic content/
collection search turns (1 MCP call instead of 3 separate ones) and splits the
envelope into three per-tool payloads, which the existing `parse_wlo_cards`/box
path processes unchanged. Explicit topic-page requests (user types "Themenseite"/
"Fachportal" or LLM tool hint = `search_wlo_topic_pages`) continue to use the
dedicated, session-stateful `search_wlo_topic_pages`. Verified live: same query
"Photosynthese" 12.2 s (3 calls) → 9.1 s (1 call); card pots correctly separated
(content/collections/topicPages).

### O2 — Curated `propertyFilter`
edu-sharing accepts field selection ONLY as a **repeated** `propertyFilter=` param
(comma list → 0 properties). Instead of `-all-` (~59 properties/node), only the
~24 fields actually used are requested (`DISPLAY_PROPS` / for topic pages
`TOPIC_PAGE_PROPS` in `topic-page-api.ts`). The `_DISPLAYNAME` label fields must be
listed explicitly — they then come back correctly (verified).
Retained "extras": `ccm:oeh_lrt(_DISPLAYNAME)`, `ccm:replicationsource(_DISPLAYNAME)`
(= source, e.g. Klexikon), `ccm:author_freetext`.
Top-level fields (`preview`, `content.url`, `mimetype`, `size`, `downloadUrl`)
are NOT affected by propertyFilter.
`get_node_details` deliberately stays on `-all-` (single node, detail tool).

### O4 — `enhancedSearch` tamed
Query expansion produced 6–9 parallel `ngsearch` calls. Now: single-term
variants removed + hard cap `MAX_VARIANTS = 5` (sorted by weight,
`full:` always stays in).

### O5 — Topic-page loops parallelized
`getCollectionThemePages` now fetches the page_config children `Promise.all`-parallel
instead of sequentially (`for … await`). `getTopicPageContent` no longer needs the
per-child fan-out at all (see Stage 3 finding below: the variant IS the
page_config child) → even fewer calls.

### O6 — Collections tree walk capped
Fallback traversal limited: level2 ≤ 25 parents, level3 ≤ 15 (with warn log).
Prevents the earlier 100+-parallel-call avalanche. Direct level1 hits remain
complete.

### O8 — Reranking unified (collections + topic pages)
Previously ONLY individual content was ranked (`enhancedSearch`); collections came
in raw edu-sharing API order → off-topic hits at the top (e.g. "Musik der
Klassik" for "Französische Revolution"). Now `rerankNodes(query)` is applied
uniformly:
- `search_wlo_collections` (in `renderOut`, before the slice),
- `search_wlo_all` (collections → from which the topic pages inherit the order),
- `search_wlo_topic_pages` Mode B (incoming collections + default sorting for
  query = "relevance" instead of "alpha").

`rerankNodes` **only reorders + removes deleted nodes** (no `minScore` drop) → it
cannot lose anything relevant. Loss check over 6 queries:
**0 relevant hits lost from top 3**, gains throughout
(exact hit from #3 → #1; e.g. "Klimawandel"/"Mittelalter" moved up from
3 off-topic collections to 3 exact ones). Browse without query stays unchanged.

## Currently active settings
| Knob | Value | Meaning |
|---|---|---|
| `POOL_SIZE` (`WLO_POOL_SIZE`) | **25** (from 40) | candidate pool **per variant** for ranking — NOT the delivered hit count |
| `MAX_VARIANTS` | 5 | max. parallel search variants |
| `search_wlo_content` maxResults | Default 8 | delivered content (backend really sets 10 speculatively / 4 in the loop) |
| `search_wlo_collections` maxResults | Default 5 | |
| `search_wlo_all` maxContent / maxCollections | 8 / 5 | |
| Collections tree walk | level1 ≤100 · level2 ≤25 · level3 ≤15 | |
| `minScore` | max(5, terms×3) | quality floor in reranking |
| Properties/node | ~24 (instead of ~59) | O2 |

## What gets delivered after ranking
`enhancedSearch`: ≤5 variants × `POOL_SIZE` candidates → RRF merge +
quality score (`computeRelevanceScore`) → `minScore` filter (graceful fallback
to the pool) → deleted nodes removed → **trimmed to `maxResults`** → these
top N as formatted nodes + the **real edu-sharing hit total**. The
candidate pool never leaves the MCP.

## Topic-page content (`get_topic_page_content`) — as of 2026-06-01

**Bugfix (implemented):** The variant resolution was broken — it searched the
*contents* of the `page_config_ref` children (these are `WIDGET_*` nodes WITHOUT
`ccm:page_variant_config`) and therefore **always returned 0 swimlanes**. In
reality the page_config **child collections themselves** carry the
`ccm:page_variant_config` (title e.g. "Variante_Ideal" / "PAGE_VARIANT_…"). Fix in
`getTopicPageContent`: pick the real (non-template) variant directly among the
children. Verified against staging: "Nachhaltigkeit" now returns **8 swimlanes**
with real headings ("Test Tina 2", "Akkordeonelement", "Ankermenü", …).

**`outputFormat:'json'` = RENDER-READY (implemented):** The swimlane items are
**WIDGET nodes** (`ccm:map` with `ccm:widget_config`). The json branch resolves, per
swimlane, the **first content-bearing widget** into real cards — three forms that
occur in WLO:
| Widget type | config field | Resolution |
|---|---|---|
| `content-teaser` | `propertyFilters` (stored query) | → `ngsearch(FILES)` |
| `wlo-collection-chips` | `sortedNodeIds` (fixed list) | → `getNodesMetadata` |
| `wlo-media-rendering` | `selectedNodeId` (single node) | → `getNodesMetadata` |

Other widgets (Text / AI text / `wlo-topics-column-browser` / `editorial-members`
/ iframe) carry no content → empty swimlane (frontend skips them).
Output per swimlane: `{heading, type, items:[card…≤maxPerSwimlane], hasMore}` +
`variantTitle` + `topicPageUrl`. Capped: ≤ `MAX_LANES=12` swimlanes, 1 widget/
swimlane, `maxPerSwimlane` (default 3) cards — keeps the call count bounded.
**Verified live (staging):** "Nachhaltigkeit" fills 5/8 swimlanes —
content-teaser → real content ("Wie funktioniert das Internet?"), collection-chips
→ collections ("Klimawandel", "Nachhaltige Ernährung"), media-rendering → 1 node.
*Backend/frontend wiring (intent/pattern + swimlane boxes with "(Auszug)" +
jump-off button) is still outstanding — the backend does not yet call the tool.*

## Open optimization potential

### O7 — Persistent operation + in-process cache  *(NOT implemented)*
**Largest remaining lever.** The MCP currently runs **stateless serverless**
(`api/mcp.ts`: one server per request, `server.close()` afterwards) → Vercel **cold
starts** (~1–3 s/call) **and** no caching across requests.
- A **persistent process** (the existing `Dockerfile`/stdio mode or Vercel
  "fluid"/keep-warm) eliminates cold starts and is the prerequisite for an
  **in-process result cache** (search results, node metadata, vocabulary with TTL).
- On serverless such a cache would be a no-op (does not survive requests).
- On the code side the cache could be prepared behind an env flag; but it only
  takes effect with a persistent deployment. **Therefore coupled to the operating-mode
  decision.**
- Workaround without a rebuild: **keep-warm cron** (ping `/mcp` every ~5 min) against
  cold starts.

### Smaller, optional levers
- Lower `POOL_SIZE` further (25→15) — minimally less recall.
- edu-sharing's own response time (~1–4 s/ngsearch) is infra (staging; prod possibly
  faster) — not solvable in the MCP code; we only reduce the number + size of the calls.
