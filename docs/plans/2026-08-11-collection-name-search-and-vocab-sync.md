# Collection name search (second leg) + vocabulary sync

Design **and** tasks in one file (same shape as `2026-08-09-usecase-gap-tools.md`).
Two independent packages; P1 is implemented first, P2 follows after a context reset.

Every number below was measured live against **staging**
(`repository.staging.openeduhub.net`) on 2026-08-11, anonymously. Re-measure
before contradicting any of it.

---

## Why this exists

A Swagger sweep of the staging REST API (316 paths) found two capabilities the
server does not use. Both are read-only and both fix a defect we already know
about.

---

# P1 — Collection search: a second, name-oriented leg

## The defect

`searchCollectionsByKeyword` (`POST /search/v1/queries/-home-/mds_oeh/collections`)
**cannot return the collection `9e7ae956` ("Optik") for any search word at all** —
not just for "Optik". Measured with terms that occur only in that collection's own
metadata:

| Suchwort (only in Optik's metadata) | mds `collections` | REST `/collections/-home-/search` |
|---|---|---|
| `Oberflächenphänomene` | **0 hits in total** | 1 — Optik |
| `Die Lehre vom Licht` | **0 hits in total** | 1 — Optik |
| `Linse` | 2, Optik absent | 3, Optik present |
| `Auge` | 13, Optik absent | 10, Optik present |
| `Optik` | 3, Optik absent | 4, Optik present |

This is not ranking and not the result cap: the query returns *nothing* for a term
that demonstrably sits in `cclom:general_keyword` of that record. Whether the
record is missing from the index or filtered by the query cannot be distinguished
from outside; operationally it is the same. It continues the 2026-08-09 finding
("a record can fall out of the index while sitting in the node store") and adds:
**a second endpoint still sees it.**

## The two endpoints search different fields

For every hit that only one side returned, all properties were scanned for the
term (the first pass looked only at title/name/description/keywords and therefore
reported a false "nowhere"):

| only in | term | the term sits in |
|---|---|---|
| mds | Klimawandel | **`ccm:oeh_collection_compendium_text`** — 6 of 6 |
| REST | Deutsch | `ccm:taxonid_DISPLAYNAME` — the resolved subject label |
| REST | Nachhaltigkeit | description + keywords — but mds had `total=57` and returned 50, so the cap explains it |

So **mds searches the collection's compendium text, REST does not; REST matches
resolved vocabulary labels, mds does not.** Neither searches the materials inside
a collection (counter-check: a word from a material's title finds neither
collection). They are complementary; neither dominates —

| Suchwort | mds | REST |
|---|---|---|
| Optik | 3 | 4 |
| Grundschule | **1** | **0** |
| Klimawandel | 23 | 17 |
| Mathematik | 17 | 17 |
| Chemie | 46 | 40 |

## Performance — the question "parallel or on demand?"

Per-leg latency, medians of 5 runs, measured the way `searchAll` starts them:

| Suchwort | content (`enhancedSearch`) | collections (mds) | portals (`/children`) | REST collections @40 |
|---|---|---|---|---|
| Optik | 1737 ms | 1158 ms | 1124 ms | 1654 ms |
| Mathematik | 3049 ms | 1674 ms | 1108 ms | **4460 ms** |
| Nachhaltigkeit | 7070 ms | 4158 ms | 1127 ms | **10404 ms** |

At `maxItems=40` the REST leg is the slowest of all four — it would become the
critical path. **But its latency is a parameter, not a constant:** it scales with
the number of collections it returns, ~0.25 s per collection.

| Suchwort | max=5 | max=10 | max=20 | max=40 |
|---|---|---|---|---|
| Optik | 2806 ms | 941 ms | 1098 ms | 1308 ms |
| Mathematik | 1488 ms | 2488 ms | 3362 ms | 3440 ms |
| Nachhaltigkeit | 1353 ms | 2657 ms | 5069 ms | 9707 ms |

`propertyFilter` makes no measurable difference (2173 vs 2124 ms) — see the
projection note below for why.

**Decision: run both legs in parallel, always — but the name leg gets its OWN,
much smaller cap (`NAME_LEG_MAX = 5`), not the caller's.**

The first implementation gave it the caller's cap of 10 and the live run refuted
the estimate below: the collections leg went from 984 ms to **3396 ms** for
"Mathematik". The cause was measured, not guessed — at cap 10 the name leg itself
costs 2565 ms, and 7–10 of its 10 hits were new ids, each of which has to be
re-read (see the projection trap). At cap 5 the leg costs 1275 ms for the same
term and still returns the record this exists to recover.

The reasoning behind the asymmetric cap: **this leg is a repair, not a second
full search.** What justifies it is a record the mds index cannot return at any
rank, and such a record ranks high in a name-oriented list. Positions 6–10 of a
second ranking are merely *different* from the first ranking, not better — and
they are the expensive part. 5 rather than 3 because "Optik" sits at position 3
of its own ranking, which leaves 3 no margin.

Measured cost after that correction (median of 5, collections leg, cap 10):

| Suchwort | before (mds only) | after (both legs) | Δ |
|---|---|---|---|
| Optik | 391 ms | 1550 ms | +1159 ms |
| Mathematik | 1395 ms | 1273 ms | −122 ms |
| Nachhaltigkeit | 934 ms | 1562 ms | +628 ms |
| Deutsch | 1160 ms | 2071 ms | +911 ms |

"Optik" pays the most because its mds leg is the fastest (3 hits, 391 ms), so
`max()` is entirely the name leg — and it is also the query that gains the
missing collection. Inside `search_wlo_all` the content leg runs in parallel and
is slower in most measured terms, so the added wall-clock there is smaller again.

The estimate that follows was made before the live run and is kept because it
shows what the per-leg numbers alone do **not** predict — the re-read cost:

- Parallel costs `max(mds, REST)`, not the sum. At cap 10 that is
  `max(1158, 941) = 1158` (Optik, +0 ms), `max(1674, 2488) = 2488`
  (Mathematik, +814 ms), `max(4158, 2657) = 4158` (Nachhaltigkeit, +0 ms).
- Inside `search_wlo_all` the content leg is slower in 2 of 3 measured terms, so
  the added wall-clock there is **zero** in those cases.
- **On demand was rejected**, and the reason is the motivating case: for "Optik"
  the mds leg returns 3 hits, not 0. A fallback that fires on "no results" would
  never fire, and a parameter the model has to know to set leaves the defect in
  place by default. The whole point is that the missing record is invisible.
- No env switch: the measured cost is 0–0.8 s at the working cap, which does not
  justify speculative configuration. If that ever changes, the switch belongs
  inside the service function (one place), never at the call sites.

## The projection trap

The REST endpoint **ignores `propertyFilter`** and answers with a fixed projection
of 46 properties. Missing from it, among others:

- **`ccm:page_config_ref`** — the Themenseiten marker. `searchAll` splits its
  buckets on `topicPageUrl`, which is derived from exactly this property. A
  REST-only collection that *is* a topic page would silently land in the
  collections bucket with no topic-page URL.
- `cclom:title`, `ccm:oeh_collection_compendium_text`, licence, LRT fields.

This is the same trap the mds keyword endpoint sprang on 2026-07-17 (documented in
`topic-page-api.ts`). Therefore the REST leg is used as an **id-discovery leg
only**: ids it contributes that the mds leg does not already have are re-read
through `getNodesMetadata` with our own projection, so every node in the merged
list carries the same fields. In the measured sample that top-up covers 0–1 ids
for most terms, so it usually costs nothing.

## Merge order

Round-robin, not concatenation — the same rule and the same reason as the licence
bundle (`services/license-search.ts`): appending hands the whole result cap to
whichever list comes first. Note the licence bundle needed it because there is no
ranking *across* its five lists; here `searchAll` does rerank the merged pool
afterwards (an exact title match scores +50 in `reranker.ts`), but the other two
call sites do not, so the fair merge has to happen in the service.

## Where the code goes

- `src/wlo-search.ts` — `searchCollectionsByName`: the raw endpoint, nothing else.
  Same shape and same degradation as `searchCollectionsByKeyword`.
- `src/services/collection-search.ts` — **new**: the two-leg merge, the id top-up,
  the round-robin. An algorithm, so it belongs in `services/`, not in the thin
  API layer and not inlined in a tool (CLAUDE.md, Architecture).
- Three call sites switch to it: `services/search.ts`, `services/topic-page.ts`,
  `tools/collections.ts`. The rule "one place, not three call sites" is the one
  this codebase has already seen drift twice, so it is pinned by
  `tests/shared-rule-discipline.test.ts` rather than by this sentence.

## Tasks

- [x] T1.1 — test first: a collection present only in the REST leg reaches the
      merged result, carries our projection, and is not duplicated when both legs
      return it. Red before the implementation exists.
- [x] T1.2 — `searchCollectionsByName` in `wlo-search.ts` (+ its degradation tests,
      mirroring the three existing `searchCollectionsByKeyword` cases).
- [x] T1.3 — `services/collection-search.ts`: parallel legs, dedupe by nodeId,
      `getNodesMetadata` top-up for REST-only ids, round-robin merge.
- [x] T1.4 — switch the three call sites; discipline test pins that nobody else
      calls either raw leg.
- [x] T1.5 — docs in sync (CHANGELOG, CLAUDE.md architecture note, STATUS.md).
- [x] T1.6 — verify: full suite green, plus a live run against staging showing
      "Optik" in the merged result.

## Outcome (live, 2026-08-11)

`searchAll({query: 'Optik'})` now returns `9e7ae956` at position 1 of the
**topicPages** bucket — that collection carries a `ccm:page_config_ref`, so it is
a Themenseite and the bucket is correct.

One pre-existing behaviour surfaced while verifying and is deliberately NOT
changed here (it predates this package and belongs in its own change):
`searchAll` removes every collection carrying a `topicPageUrl` from the
collections bucket *whether or not* `topicPages` was requested. A caller passing
`include: ['collections']` therefore never sees a Themenseite at all — which is
how the first verification run appeared to fail.

## How often the defect actually occurs (measured 2026-08-11)

Asked of 70 real **sub**-collections (children of 14 subject portals): does the
collection find itself under its own title?

- 2 of 70 (3 %) are unreachable through the mds query — the name leg rescues
  **1** of them ("Optik"), i.e. 1.4 %.
- Counter-direction: **3 of 70 (4 %) are found only by the mds query.** The two
  legs complement each other measurably; swapping one for the other would have
  been a regression, and that is what justifies the merge shape.

End-to-end cost of the leg on `search_wlo_all`, 11 alternating runs per term,
delta taken from the MINIMA because staging's queueing noise makes the median
unusable at this sample size (at 5 runs one term came out *faster* with the extra
leg): +186 / +430 / +461 / +235 / +665 ms for Optik / Mathematik /
Nachhaltigkeit / Klimawandel / Deutsch — median **+430 ms** on a search that
takes 1.3–2.1 s.

All rates are from **staging**. Worth re-running the 70-collection probe against
production before drawing conclusions there.

## Declined: a portal leg for `search_wlo_collections` (user decision, 2026-08-11)

The same probe over the 35 subject **portals** gives a very different rate:
8 of 35 are unreachable through the mds query under their own name (Physik,
Chemie, Deutsch, Geschichte, Biologie, Religion, Sport, Französisch); the name
leg rescues 4. `searchAll` is unaffected — it has its own portal leg, and
`searchAll({query:'Physik'})` returns the portal at position 1 through it.
`search_wlo_collections` has no such leg (its tree-traversal fallback only runs
on ZERO direct hits, and there are ten here), so it answers "Physik" without the
Physik portal — verified through the tool, 2026-08-11.

Proposed and **declined by the user**: not needed for now. Recorded so the
measurement is not re-derived. If it is ever picked up, the fix is the leg
`searchAll` already has (one `/children` call on the root), not a change to
`collection-search.ts` — the portals are a third source, not a third index.

---

# P2 — Vocabulary sync against the repository (COMPLETE, 2026-08-12)

## The defect

`src/vocabs.ts` is a hand-maintained mirror. Measured against the server's own
vocabulary endpoint:

| Vokabular | server | ours |
|---|---|---|
| `ccm:educationalcontext` | 12 | 12 ✓ |
| Schulfächer (`ccm:taxonid`, `/vocabs/discipline/`) | 71 | 70 ✓ (difference is the group header "Schulfächer") |
| `ccm:commonlicense_key` | **16** | **12** |

Missing on our side: `COPYRIGHT_LICENSE`, `CC_BY_SA_NC`, `UNTERRICHTS_UND_LEHRMEDIEN`
and **`CC BY-SA` with spaces** — the very key measured in the index on 2026-08-09
and recorded in CLAUDE.md, which `resolveVocab` today cannot resolve. We carry
`SCHULFUNK`, which the server does not list. This session also corrected 23 wrong
display labels by hand; the endpoint carries the official `displayString`.

## The endpoint

```
POST /mds/v1/metadatasets/-home-/mds_oeh/values
{"valueParameters":{"query":"ngsearch","property":"<prop>","pattern":""},"criteria":[]}
```

Anonymous, 200. `pattern: ""` lists everything; `pattern: "-all-"` returns **empty**
(counter-intuitive, measured). A prefix works: `"Ph"` → Philosophie, Physik.
The header `locale: en_EN` returns English labels. `criteria` does **not** narrow
the list (416 either way), so it is a plain vocabulary listing.

`ccm:taxonid` mixes two vocabularies and they separate cleanly by URI:

```
345  .../vocabs/hochschulfaechersystematik
 71  .../vocabs/discipline          ← Schulfächer
```

Per the user's decision (2026-08-11): **stay with the Schulfächer for school**;
filter on `/vocabs/discipline/` when pulling. `ccm:curriculum` (3211),
`ccm:oeh_widgets` (58) and `ccm:containsAdvertisement` (6) are **out of scope** —
not used today.

## Shape (not yet designed in detail)

A generator/verification script, not a runtime dependency: the tables stay local
so filter resolution works offline and a repository outage cannot break it. The
user's constraint for a later, repository-generic version: **cache it in the MCP**,
never fetch per request.

## Tasks

- [x] T2.1 — `scripts/sync-vocabs.mjs` (`npm run sync:vocabs`): report-only diff of
      all six vocabularies. Deliberately not a writer — see below.
- [x] T2.2 — reconcile the licence table.
- [x] T2.3 — pinned as measured constants instead of a live test (see below).

## What the implementation changed about the plan

**The `values` endpoint is not the source for licences.** Asked for
`ccm:commonlicense_key` it answers with the bare key as its own `displayString`
for all 16 values, **in every locale** — that list is the set of values the index
holds, not a captioned vocabulary. The names live in
`GET /config/v1/language/defaults` → `LICENSE.NAMES` (15 keys). For the other
five vocabularies `values` does carry captions (100 %), so the script uses both
sources. This was measured, not assumed, and it is why the script has two legs.

**Three defects were found, one of them worse than the missing keys:**

1. `COPYRIGHT_FREE` was labelled **"urheberrechtsfrei"** — the opposite of what
   the repository means by it. Its own description reads "Das Werk ist kostenfrei
   zugänglich. Nutzung und Quellenangabe gemäß den allgemeingültigen gesetzlichen
   Regelungen (UrhG)": copyrighted, merely free to access. Official label:
   **"Copyright, freier Zugang"**. It is the third most common licence in the
   corpus — **12 445 of 403 461 records**. The misleading alias went with it, so
   "urheberrechtsfrei" now resolves to nothing and the caller gets the
   unresolved-hint; `gemeinfrei` → `PDM` is the answer to that question.
2. Three keys were unknown to us, together **1 871 records**:
   `COPYRIGHT_LICENSE` (1 359), `CC_BY_SA_NC` (497), `UNTERRICHTS_UND_LEHRMEDIEN`
   (15). An unknown key costs twice — `labelFromUri` shows the raw string and
   `filterByExactLicense` drops the record from every licence-filtered result.
   `CC_BY_SA_NC` became an ALIAS of `CC_BY_NC_SA` rather than an entry of its
   own: it is a legacy spelling of the same three terms, and two keys for one
   licence must not read as two licences.
3. Every CC label asserted **"4.0"**, which no record supports:
   `ccm:commonlicense_version` is absent on 90 of 90 sampled CC records, is not
   in `DISPLAY_PROPS`, and is not facetable (400). The version is gone from the
   display forms and kept as an alias, so every prompt and tool description that
   already says "CC BY 4.0" keeps resolving.

**Not changed, deliberately:** `PDM` ("Public Domain Mark" over the official
"PDM"), `CUSTOM`, `NONE`, `CC_0`, and the `userRole`/`targetGroup`/aggregated-LRT
wordings. Those differ from the repository without being wrong, and several are
maintained decisions pinned by existing tests. A rename with no defect behind it
is taste; the script reports them so a human can judge.

**`MULTI` is reported but not mirrored.** `LICENSE.NAMES` carries it
("Unterschiedliche Lizenzen."), but it is a statement about a SET of licences,
not a licence: no record carries it, and offering it would give
`lookup_wlo_vocabulary` a filter value that can never match. It and the
`discipline` group header are listed in the script's `NOT_MIRRORED` map with
their reasons — a report with permanent false positives stops being read, which
is the only way this script can fail.

**T2.3 changed shape.** A live test cannot run under `npm test` (`netguard`
fails any unmocked upstream call), and one gated behind an env var would be a
test nobody runs. Instead the corpus is pinned as measured constants in
`tests/vocabs.test.ts`: `CORPUS_LICENSE_KEYS` lists all 16 distinct
`ccm:commonlicense_key` values with their record counts and what each must
resolve to. That is deterministic, needs no network, and states the thing that
actually matters — every key the corpus holds resolves to a known licence. The
live comparison is the script's job, on demand.

**The script reports and never writes.** Labels need judgement: ours are
sometimes better than the repository's and sometimes wrong in a way no diff can
see — defect (1) above was a *label that existed and looked fine*.
