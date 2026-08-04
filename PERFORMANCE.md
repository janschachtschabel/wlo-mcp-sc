# WLO-MCP — Performance & Optimizations

> 🇬🇧 English · 🇩🇪 [Deutsche Fassung](PERFORMANCE.de.md)

As of: 2026-06-01. This document records the latency-relevant design decisions
of the MCP server — what has been implemented, which values are active, and where
potential still remains.

## Context
A search turn in the chatbot took a measured **9–18 s** (a factual question without
search ~4 s). Main costs: the edu-sharing searches (several edu-sharing REST calls
per tool) and several sequential LLM calls in the backend. The following MCP
changes reduce the number + size of the edu-sharing calls.

> **Operating mode:** the deployment is the **self-hosted, persistent** HTTP
> mode (Docker on the vServer). There is no serverless target, so anything below
> about cold starts describes a constraint this server does not have.

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

## O8 — Topic-page listing (Mode C)  *(implemented 2026-07-27)*
A client reported **17–19 s** for `search_wlo_topic_pages` without a `query`
(analysis: `docs/plans/2026-07-27-topic-pages-latency.md`). Three causes, all
fixed:
- **Dead upstream call:** every variant fetched its owning collection's metadata
  just to read `ccm:page_config_ref` — a value the parent walk already holds (it
  picks that collection precisely because of it) and that `buildTopicPageUrl`
  only truthiness-checks. Removed outright → half the round-trips.
- **Cache stampede:** the parent cache stored the resolved *value* instead of the
  in-flight *promise*, so concurrently enriched sibling variants all missed it
  and re-ran the same walk. It now caches the promise.
- **Candidate floor:** `max(50, maxResults * 5)` charged a 5-result request for
  50 variants. Now `max(10, maxResults * 3)` (three = the maximum variants per
  topic page) with a single top-up to the former pool if the merge falls short.

The parent walk also asks for the three fields it reads instead of `-all-` (~59
properties for every node of the ancestor chain), and `WLO_TOPIC_POOL` makes the
concurrency of this fan-out configurable.

**The real finding surfaced while profiling the remaining seconds:** `/parents`
answers **500 (AccessDenied)** for anonymous callers on page-config folders.
`getNodeParents` degrades a failed response to `[]`, so the owner resolution
failed silently for every variant. The listing showed identical
"Fachportalstartseite" titles, no topic-page URLs, and a `collectionId` that was
really the variant id. Mode C was not just slow but unusable — and paid ~1.1 s
per variant for it.

Replaced with two `/metadata` reads along `virtual:primaryparent_nodeid`
(variant → page-config folder → collection). That endpoint works anonymously at
~0.19 s. Pool factor also 3 → 2, because the data averages just 1.10 variants
per page (108 variants across 98 pages).

Narrowing the listing to a single target-group variant was evaluated and
rejected: 98 of 108 variants carry no target group at all, and a server-side
`teacher` filter returns 3 variants covering 3 of 98 pages.

Measured (locally against the production repository, `scripts/measure-topic-pages.mjs`):

| Call | originally reported | after pool/projection | after the `/metadata` fix |
|---|---|---|---|
| `{maxResults: 20}` | 17–19 s | 9.9 s | **3.2 s** |
| `{maxResults: 10}` | 8.5 s | 4.5 s | **1.4 s** |
| `{maxResults: 5}`  | 8.2 s | 2.8 s | **0.66 s** |
| `{maxResults: 20, educationalContext}` | 3.4 s | 1.5 s | **0.55 s** |

All at `WLO_TOPIC_POOL=10`; the payload actually **grew**, because it now
carries real titles and links. That 10 and 5 differ at all (previously 8.5 s vs
8.2 s — both on the floor of 50) is additional evidence the floor is gone.

Scope of the `/parents` defect: the endpoint is fine for ordinary collections
(200, ~0.4 s) and also fails for content nodes (`ccm:io`), which
`getNodeBreadcrumb` already documents and tolerates. Only the page-config case
was undiagnosed.

## O10 — Bounded, self-disclosing browse tree  *(implemented 2026-07-27)*
Measuring the **opt-in modes** — which O9 had skipped — exposed the real
outlier: `browse_collection_tree` at depth 2 with `includeContentPreview` took
**11.7 s and returned 460 kB**. The tree fetched up to 30 sub-collections per
node with no overall bound (a 15-node portal yields ~100 nodes), and every
enrichment then cost one upstream call per node — up to 1500 upstream calls from
a single tool call in the worst case.

- **The tree is bounded.** The slice per parent derives from a total node budget
  (150), capped at 10, computed *before* the walk so every parent gets the same
  size — a counter drained by concurrent workers would make the output
  nondeterministic. Depth stays capped at 2.
- **Truncation is disclosed.** Cut nodes carry `hasMoreChildren`, the envelope
  carries `truncated`, and the Markdown output names the exact follow-up call.
  The tool description instructs the model to say so and open a branch
  deliberately rather than present a slice as the whole tree. Detecting "there
  is more" is free: the walk fetches exactly one child more than it shows.

| Mode | before | after |
|---|---|---|
| depth 2 + content preview | 11.7 s / 460 kB | **6.5 s / 362 kB** |
| depth 2 + counts | 5.1 s / 103 kB | **4.0 s / 84 kB** |
| depth 1 + counts | 2.0 s | **1.5 s** |

Still expensive by nature: `includeContentPreview` costs one upstream call per
tree node. It is opt-in and off by default — a caller that enables it on a wide
tree should expect seconds.

## O9 — Fan-out sweep across every tool  *(implemented 2026-07-27)*
All 22 tools registered at that date were benchmarked live with realistic
arguments to locate the bottleneck instead of guessing at it. Most answer in
under a second; three call sites carried avoidable waiting.
(`get_wlo_content_text`, the 23rd tool, was added afterwards and is not part of
these numbers.)

- **The Mode-B candidate check now uses `WLO_TOPIC_POOL`** instead of a
  hard-coded width of 4. `findTopicPagesByQuery` examines up to 12 candidates,
  each costing a metadata read plus possibly a children read — three to four
  sequential waves. Measured in isolation: 1797 ms at width 4, 788 ms in one wave.
- **`getTopicPageContent` gained a both-ids fast path.** With the collection and
  variant ids both known, the two nodes are read **in parallel** instead of
  walking collection → page-config folder → variant. The resolver returns both
  ids anyway. Measured: 1238 ms → 774 ms.
- **`browse_collection_tree`: level-1 width 5 → 10.** At depth 2 each level-1
  node costs exactly one `/children` call and level-2 nodes do not recurse, so
  the width was four sequential waves. The nested pool is now a separate,
  deliberately narrow constant (4) because it only performs I/O on the opt-in
  `includeContentCounts` path — bounding the worst case at 40 concurrent calls
  instead of squaring the wider level-1 width.

Measured (locally against the production repository, best of two runs):

| Tool | before | after |
|---|---|---|
| `get_topic_page_content` (query) | 3253 ms | **2175 ms** |
| `browse_collection_tree` depth 2 | 2899 ms | **1968 ms** |
| `browse_collection_tree` depth 1 | 1378 ms | **943 ms** |
| `search_wlo_topic_pages` (query) | 1621 ms | **1191 ms** |

Every other tool was already at or below ~1.2 s and was left alone.

**Concurrency was measured, not assumed:** against the live server five
simultaneous tool calls cost the same per call as a single one (factor 0.96) and
ten cost 1.65× — far from the factor 10 that serialization would produce. What
slows down at ten is edu-sharing, not this server.

## Open optimization potential

### O7 — In-process cache  *(NOT implemented)*
**Largest remaining lever.** In its target deployment the server runs
**persistently** (Docker on the vServer); only a per-request MCP server object is
created and closed, the process itself stays up. An **in-process result cache**
(search results, node metadata, vocabulary with TTL) would therefore take effect,
unlike in a serverless deployment where it does not survive requests.
- Most valuable for topic pages: the parent walk and collection metadata rarely
  change and dominate the listing.
- **Reconcile with the auth work before building it**
  (`docs/plans/2026-07-25-wlo-mcp-optional-auth.md`): once responses depend on the
  logged-in user's rights, the cache key must include the identity — otherwise
  user B receives user A's rights-filtered result.
- Suggested order: measure O8 in production first, then decide whether O7 is
  still needed at all.

### Smaller, optional levers
- Lower `POOL_SIZE` further (25→15) — minimally less recall.
- edu-sharing's own response time (~1–4 s/ngsearch) is infra (staging; prod possibly
  faster) — not solvable in the MCP code; we only reduce the number + size of the calls.
