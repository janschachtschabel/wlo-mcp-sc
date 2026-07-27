# Design: Mode-C latency of `search_wlo_topic_pages` (client report 2026-07-27)

Status: **implemented 2026-07-27** — P0–P5 done, P6 not built (see below).
Trigger: latency report from the WLO-Chatbot backend (Python MCP client).

## Outcome (measured, not predicted)

`scripts/measure-topic-pages.mjs` against the production repository, same
network path for both columns:

| Call | `WLO_TOPIC_POOL=10` | `WLO_TOPIC_POOL=20` | client's baseline (old code) |
|---|---|---|---|
| `{maxResults: 20}` | 9.9 s | 6.3 s | 17.3–19.4 s |
| `{maxResults: 10}` | 4.5 s | 3.0 s | 8.5 s |
| `{maxResults: 5}` | 2.8 s | 1.8 s | 8.2 s |
| `{maxResults: 20, educationalContext}` | 1.5 s | 1.7 s | 3.4 s |
| `{query: "Photosynthese"}` | 1.5 s | 1.6 s | 2.2 s |

Response sizes are byte-identical between the two columns. The baseline column
was measured by the client from a different network location, so only the
*shape* is comparable — and the shape is the proof: their signature finding
"maxResults 10 and 5 cost the same" (both pinned to the floor of 50) is gone,
the two now scale apart.

One finding was NOT in the original analysis and surfaced only when the
call-count test ran: the parent cache stored resolved values instead of
in-flight promises, so concurrently enriched sibling variants **all** missed it
and repeated the same walk. Three siblings of one page cost three walks; they
now cost one. This is the mechanical explanation for the client's observation
that "memoization rarely takes effect".

### Not built

- **P6 (portal fast path)** — unchanged: only on request, and it trades away
  coverage of Themenseiten deeper in the tree.
- **Task 5.4, the generic unknown-parameter warning** — the spike answered the
  feasibility question: the SDK hands the raw `request.params.arguments` to its
  own `CallToolRequestSchema` handler (`server/mcp.js`) before
  `validateToolInput` strips unknown keys, so wrapping that handler — with a
  registration-time record of each tool's known keys, which the existing
  `tool-defaults.ts` seam already has the hook for — would surface them. It was
  deliberately left unbuilt: it is the only change that would sit in the path of
  *every* tool call, and the concrete reported symptom is already covered by the
  description fix in Task 5.3. Worth its own package and review pass if wanted.
  (The alternative — `.passthrough()` schemas — was rejected: it advertises
  `additionalProperties: true` in `tools/list` and would invite models to invent
  parameters.)

## Goal

Bring `search_wlo_topic_pages` without `query` (Mode C) from the measured
17–19 s down to a chatbot-viable range (target < 4 s for the default call),
and remove two reporting gaps the same client hit (silent parameter drop,
reasonless empty result of `get_topic_page_content`).

## Context

The client measured, per tool call, with reproducible arguments:

| Call | Measured |
|---|---|
| `{maxResults: 20}` | 17.3–19.4 s |
| `{maxResults: 10}` | 8.5 s |
| `{maxResults: 5}` | 8.2 s |
| `{maxResults: 20, educationalContext: "Sekundarstufe I"}` | 3.4 s |
| `{query: "Photosynthese", maxResults: 10}` | 2.2 s |
| all other tools | 1.3–6.6 s |

The report's own diagnosis (`Math.max(50, maxResults * 5)` in
`tools/topic-pages.ts:57` drives the cost; `educationalContext` shrinks the
variant set upstream) is **correct and confirmed by code reading**. The report
misses the larger finding (F1 below).

## Cost model (validated against the measurements)

Mode C = one `searchPageVariants` POST, then per variant **two sequential**
upstream calls inside a `mapPool` of concurrency 10:

1. `resolveVariantCollection` → `getNodeParents(parentId)` (memoized per parent)
2. `getNodeMetadata(ownerId)` (memoized per owner)

```
wall ≈ L_search + ceil(N_variants / 10) × (L_parents + L_metadata)
```

Fitting the measurements: N=50 → 8.2 s and N=100 → 17.3 s give
`L_parents + L_metadata ≈ 1.8 s`, i.e. **≈ 0.9 s per upstream call** — both
calls run with `propertyFilter=-all-` (~59 properties/node; `/parents`
additionally returns the *whole* ancestor chain). The model also explains why
`maxResults` 10 and 5 cost the same (both hit the floor of 50) and why
`educationalContext` is fast (fewer variants come back from upstream).

The report's remark that memoization "rarely takes effect" is right and
explainable: a `page_config` folder holds the variants of exactly one
Themenseite, and most Themenseiten have a single variant — so parent count ≈
variant count and both caches are near-useless in the real data.

## Findings

**F1 — The `getNodeMetadata` call per owner is provably dead work.**
`listThemePageVariants` (`tools/topic-pages.ts:68-74`) fetches the owner's
full metadata solely to read `ccm:page_config_ref`, which it passes to
`buildTopicPageUrl`. But (a) `buildTopicPageUrl` (`wlo-node.ts:21-27`) only
*truthiness-checks* that argument — the built URL contains `collectionId`
alone; and (b) the owner was selected by `resolveVariantCollection`
(`topic-page-api.ts:142`) **precisely because** its `ccm:page_config_ref` is
non-empty. So the value is known-truthy before the call is made. The same
insight is already applied elsewhere in this repo —
`services/topic-page.ts:180-184` passes `collectionId` as a deliberate
placeholder with that exact comment. Removing the call also removes a silent
failure path: today a failing metadata fetch yields an empty `topicPageUrl`.
→ **halves Mode C**, zero behaviour change.

**F2 — Both remaining calls use the heaviest possible projection.**
`getNodeParents` and `getNodeMetadata` hardcode `propertyFilter=-all-`
(`wlo-node.ts:109,225`) although the Mode-C path needs exactly three fields
(`ccm:page_config_ref`, `cclom:title`, `cm:name`). The repo already owns the
mechanism for this (`appendPropertyFilter`, `DISPLAY_PROPS`, optimization O2)
— it is simply not wired into these two functions. Other callers
(`get_node_details`, breadcrumb) legitimately need `-all-`, so the projection
must become an **optional parameter**, not a global change.

**F3 — The `Math.max(50, maxResults * 5)` floor makes frugal callers pay.**
`maxResults: 5` costs 50 variants and 8.2 s for five delivered results. The
factor exists so dedup/merge keeps enough candidates after grouping by
collection. The provable worst case is **3 variants per Themenseite**
(teacher/learner/general), so `maxResults × 3` covers the merge with no floor
needed. Caveat, and this is a behaviour question, not just a tuning knob:
`sort: 'alpha'` sorts *within the fetched pool*, and the upstream returns an
arbitrary order — so a smaller pool yields a different alphabetical subset.
Today's "alphabetical" is already a sort over an arbitrary 50, not over all
Themenseiten. Shrinking the pool changes which pages appear.

**F4 — Concurrency 10 is conservative once only one call per variant remains.**
Raising the Mode-C pool halves wall time again, at the price of upstream load.
Must be env-tunable and measured, not guessed.

**F5 — `get_topic_page_content` returns an empty result without a reason.**
The empty branch (`tools/topic-page-content.ts:82-102`) collapses five
distinct causes into one message: node not found, no `ccm:page_config_ref`,
no non-template variant, unparseable/empty `ccm:page_variant_config`, and
"query matched nothing". The client therefore probes up to three candidates
blindly (~4 s wasted). Second defect in the same branch: in
`outputFormat: json` the empty path returns German prose as `content[0].text`
while the normal path returns `JSON.stringify(payload)` — an inconsistent
contract for any client parsing that field.

**F6 — Unknown tool parameters are dropped silently.**
The MCP SDK parses arguments with a plain `z.object(shape)`, which strips
unknown keys. The client sent `discipline` to `search_wlo_topic_pages` (which
has no such parameter) for months without any signal — byte-identical
responses with and without it. A warning would have to be raised *before*
zod strips the key, i.e. below the current registration seam, so this needs a
spike rather than a one-liner. A zero-risk partial fix is available today:
name the absent filter explicitly in the tool description.

**F7 — O7 (in-process cache) is now worth more than when it was deferred.**
`PERFORMANCE.de.md:138` deprioritized it because a serverless deploy makes it
a no-op. The production instance now runs persistently (Docker on the
vServer), and parent walks plus node metadata for topic pages are the most
cacheable data in the system. **Interaction to respect:** the optional-auth
plan (`2026-07-25-wlo-mcp-optional-auth.md`) makes responses identity-
dependent — a cache introduced afterwards must key on identity or be
restricted to anonymous calls, otherwise user A's rights-scoped result leaks
to user B. Cheapest sequencing: land F1–F3 first and re-measure; build O7
only if still needed, and then with the auth constraint designed in.

**F8 — A structurally cheaper Mode C exists, with a coverage trade-off.**
`searchTopicPageCollections` (`topic-page-api.ts:112-119`) already lists
topic-page-owning collections in **one** upstream call
(`getChildCollections(WLO_ROOT_COLLECTION_ID, 100)` + local filter on
`ccm:page_config_ref`), titles included, zero per-item enrichment. It covers
only root-level subject portals, whereas the `page_variant` search finds
Themenseiten anywhere in the tree and supports `targetGroup`. Not a drop-in
replacement — offered as an explicit option below.

## Approach

Ordered by (impact ÷ risk), each package independently shippable and
measurable. P1 alone is expected to halve the time at essentially zero risk;
P1+P2 should reach the target without any behaviour change. P3 is the only
package that changes *which* results are returned and therefore needs an
explicit decision.

## Non-functional

- No new dependencies; no new env var except the two tuning knobs in P4.
- Every package keeps the existing test suite green (regression gate).
- Measurement is part of each package, not an afterthought: a small timing
  script (`scripts/measure-topic-pages.mjs`, new) runs the report's exact
  argument sets against a configured instance and prints before/after.
  Live timings are environment-dependent, so numbers below are predictions
  from the cost model and must be confirmed by measurement.

## Risks

- Predictions assume upstream latency stays ~0.9 s/call; a loaded
  edu-sharing shifts all absolute numbers (ratios hold).
- P3 changes result composition under `sort: 'alpha'` — needs the user's
  decision, and the tool description must then stop implying a global
  alphabetical order.
- P4's higher concurrency raises upstream load; ship it behind an env knob
  with a conservative default and back it out if upstream errors rise.

---

# Tasks

Process: every phase starts with **step 0: invoke `/better-coding-workflow`**;
TDD (failing test first, real output shown); per-phase close-out updates
`STATUS.md` + `CHANGELOG.md`, then stop for a context reset. No commits — the
user uploads and deploys.

## P0 — Measurement harness (prerequisite, no product change)

Step 0: invoke `/better-coding-workflow`.

### Task 0.1: Timing script
**Files:** Create `scripts/measure-topic-pages.mjs`
**What:** Node script, no deps: takes a base URL from `argv`/env, issues the
seven argument sets from the client report as MCP `tools/call` POSTs, prints
`args → ms → response chars` as a table plus a JSON line per run for
before/after diffing. Sequential (not parallel) so runs don't distort each
other.
**Verification:** run against the live instance; output reproduces the
client's order of magnitude (≈17–19 s for `{maxResults: 20}`). This is the
**baseline** every later package is compared against.

## P1 — Remove the dead metadata call (F1)

Step 0: invoke `/better-coding-workflow`.

### Task 1.1: Return the page-config ref from the resolver
**Files:** Modify `src/topic-page-api.ts` (`resolveVariantCollection`,
`resolveParent`); Test `tests/topic-page-resolve.test.ts`
**What:** Extend the resolver's return type from `{id, name}` to
`{id, name, pageConfigRef}`, taking the value from the grandparent node the
walk already inspects. No extra fetch.
**Test first:** fetchMock returns a parent chain whose owner carries
`ccm:page_config_ref`; assert the resolver returns it, and assert the number
of `fetch` calls stays unchanged.
**Verification:** new test green; existing suite green.

### Task 1.2: Drop `getNodeMetadata` from the Mode-C loop
**Files:** Modify `src/tools/topic-pages.ts:59-87` (remove `ownerMetaCache`
and the `getNodeMetadata` call; build `topicPageUrl` from the resolver's
`pageConfigRef`); Test `tests/tools-topic-pages-modec.test.ts`
**What:** Behaviour-preserving deletion — the URL is byte-identical because
`buildTopicPageUrl` ignores the ref's value.
**Test first:** Mode C over N mocked variants asserts (a) identical
`topicPageUrl`/title output as before, (b) **exactly one** upstream call per
distinct parent — pin the call count, since that is the actual fix.
**Verification:** tests green; then P0 script → expect ≈ **19.4 s → 9–10 s**
and ≈ **8.2 s → 4–5 s**.

## P2 — Narrow the projection on the hot path (F2)

Step 0: invoke `/better-coding-workflow`.

### Task 2.1: Optional projection parameter
**Files:** Modify `src/wlo-node.ts` (`getNodeParents(nodeId, props?)`,
`getNodeMetadata(nodeId, props?)` — default stays `-all-` via
`appendPropertyFilter`); Test `tests/wlo-node-projection.test.ts`
**What:** Opt-in narrowing only; all existing call sites keep `-all-`.
**Test first:** assert the request URL carries repeated `propertyFilter`
params when `props` is passed, and exactly `-all-` when it is not.

### Task 2.2: Use the narrow set in the topic-page resolver
**Files:** Modify `src/topic-page-api.ts` (`resolveVariantCollection` passes
`['ccm:page_config_ref', 'cclom:title', 'cm:name']`)
**Verification:** suite green; P0 script → expect a further reduction of the
remaining per-call latency (magnitude to be measured, not predicted).

## P3 — Adaptive candidate pool (F3) — **decision required**

Step 0: invoke `/better-coding-workflow`.
Gate: user decides between (a) keep today's composition, (b) accept a
different alphabetical subset for a large speed-up.

### Task 3.1: Replace the floor with a merge-aware pool
**Files:** Modify `src/tools/topic-pages.ts:53-57`; Test
`tests/tools-topic-pages-pool.test.ts`
**What:** `Math.max(50, maxResults * 5)` → `Math.max(10, maxResults * 3)`
(3 = the provable maximum of variants per Themenseite), with an optional
single top-up fetch when the merged count falls short of `maxResults`.
**Test first:** assert the requested `maxItems` for maxResults 5/10/20 and
that a short merge triggers exactly one top-up, never a loop.
**Verification:** P0 script → expect `{maxResults: 5}` ≈ **1.5–2 s** and
`{maxResults: 20}` ≈ **3–5 s** (on top of P1+P2).

### Task 3.2: Make the ordering claim honest
**Files:** Modify the `sort` description in `src/tools/topic-pages.ts:192`
and `docs/TOOLS.md`
**What:** State that `alpha` sorts the fetched candidate set, not the global
catalogue — true today as well, and doubly relevant after 3.1.

## P4 — Concurrency knob (F4)

Step 0: invoke `/better-coding-workflow`.

### Task 4.1: Env-tunable Mode-C pool
**Files:** Modify `src/tools/topic-pages.ts` (pool size from config),
`src/wlo-config.ts` (`WLO_TOPIC_POOL` , default 10), `.env.example`;
Test `tests/wlo-config.test.ts` (extend)
**What:** Default unchanged (10) so this ships inert; the vServer can raise
it to 20 and the P0 script measures the effect and any upstream errors.
**Verification:** config test green; measured comparison at 10 vs 20 with an
explicit note on upstream error counts.

## P5 — Client-facing honesty fixes (F5, F6)

Step 0: invoke `/better-coding-workflow`.

### Task 5.1: Reason codes for the empty topic-page result
**Files:** Modify `src/topic-page-api.ts` (`getTopicPageContent` returns a
discriminated result carrying `reason`), `src/tools/topic-page-content.ts`
(empty branch emits it), `src/apps/outputSchemas.ts` (add
`reason: z.string().optional()` to `swimlanePayloadSchema`);
Test `tests/tools-topic-page-content.test.ts` (extend)
**What:** Enumerate exactly: `node_not_found`, `no_page_config_ref`,
`no_variant`, `empty_config`, `no_match`.
**Test first:** one case per reason asserts the emitted code.
**Verification:** widget still renders (optional field); suite green.

### Task 5.2: Consistent JSON contract in the empty branch
**Files:** Modify `src/tools/topic-page-content.ts:98-101`
**What:** With `outputFormat: 'json'`, return `JSON.stringify(payload)` as
the text block (as the non-empty path does) instead of German prose; keep
prose for markdown.
**Test first:** assert `JSON.parse(content[0].text)` succeeds in JSON mode
for an empty result.

### Task 5.3: Name the absent filters in the descriptions
**Files:** Modify `src/tools/topic-pages.ts` (description),
`docs/TOOLS.md`; Test `tests/tool-triggers.test.ts` (extend the pin)
**What:** One sentence: this tool has no `discipline` filter — use
`educationalContext`/`targetGroup`, or `search_wlo_collections` for subject
filtering. Zero-risk mitigation of F6 while the generic warning is unbuilt.

### Task 5.4 (spike, timeboxed): generic unknown-parameter warning
**Files:** none yet — investigation only
**What:** Determine whether unknown argument keys can be observed before the
SDK's zod parse (request-handler interception vs. schema passthrough), and
whether the result can be surfaced in `_queryMeta` next to the existing
`unresolvedFilters`. Outcome: either a follow-up task with an exact approach,
or a documented "not feasible on this SDK version" note.
**Verification:** written finding; no product change in this task.

## P6 — Optional: fast portal path for Mode C (F8) — **only on request**

Not scheduled. If the chatbot's real need is "offer the user the available
subject-portal Themenseiten", a `scope: 'portals' | 'all'` parameter could
serve that from one upstream call (~1–2 s) while `all` keeps today's
exhaustive semantics. Requires verifying whether portal collections carry
enough metadata for the `educationalContext`/`targetGroup` filters; without
that, the two paths are not equivalent and the parameter must say so.

## Verification plan

- Per package: its own tests (red → green, real output) + the full existing
  suite + `npm run typecheck`.
- Cross-package: the P0 script against the live instance, before and after,
  with the client's exact argument sets. Report actual numbers, never
  predictions, in the close-out.
- Regression risk concentrated in `tests/tools-topic-pages*.test.ts`,
  `tests/tools-topic-page-content.test.ts`, `tests/apps-*` (output schema).
- Report the measured result back to the reporting client, including which
  of their five points were confirmed and which were declined.
