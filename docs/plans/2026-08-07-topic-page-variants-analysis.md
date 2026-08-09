# WLO Themenseiten and their page variants — the measured reference

**Status:** reference. Every number here was measured on **2026-08-07** against
BOTH instances (anonymous, read-only): production
`redaktion.openeduhub.net` and `repository.staging.openeduhub.net`.
Implemented in this repository the same day (§8), reviewed and corrected in a
second round (§9).

**How to use this document.** §1–§6 are facts about the repository — re-measure
before contradicting any of them. §7 is the rule set that follows from those
facts and binds the code. §8 records what was built, §9 what only a live run
revealed, §10 what cannot be fixed from here.

**Why it exists.** The WLO team reported that page variants are "now enriched
with properties" and suggested three new filters. One of the three holds. The
other two do not, and acting on them would have made the listing worse — so the
measurements are written down rather than the conclusions alone.

---

## 1. The node model

A Themenseite is not a node type. It is a **collection that additionally carries
a curated page layout**:

```
Sammlung (ccm:map)
  │  ccm:page_config_ref  →  workspace://SpacesStore/<folder>
  ▼
page-config folder (ccm:map, cm:name "PAGE_<uuid>")
  │  ccm:page_config      →  { "variants": [...], "default": "..." }
  ├─ page variant (aspect ccm:page_variant, cm:name "PAGE_VARIANT_<uuid>")
  │     ccm:page_variant_config  →  { structure: { swimlanes: [...] } }
  ├─ page variant …
  └─ page variant …
```

Three things about this shape are easy to get wrong, and all three have been got
wrong in this codebase before:

- **The variants are the DIRECT children of the page-config folder.** They
  themselves carry `ccm:page_variant_config`. Reading the children's *contents*
  instead reaches `WIDGET_*` nodes, which have no variant metadata and no
  swimlanes — the symptom is a variant list with wrong ids and zero lanes.
- **A collection may own SEVERAL page-config folders.** Its own
  `ccm:page_config_ref` names the active one; the others are editorial leftovers
  that still contain variants. Measured: 5 of 25 sampled pages (2026-07-27), and
  one production collection holds three.
- **`/parents` is not usable** on page-config folders: it answers 500
  (AccessDeniedException) for anonymous callers and costs ~1.1 s doing it.
  Walk `virtual:primaryparent_nodeid` via `/metadata` instead (~0.19 s).

### Scale

| | staging | production |
|---|---|---|
| page variants total | 99 | 121 |
| non-template variants | 68 | 109 |
| templates (`is_template: true`) | 30 | 12 |
| global templates (`virtual:page_variant_global: true`) | 21 | 2 |
| distinct pages (page-config folders) | 45 | 99 |
| root-level portals owning a page | 6 of 30 | 27 of 30 |

Variants per page, production: **93 pages have exactly one**, five have two, one
has six. Staging is messier test data (one folder holds ten, another nine).

> The older claim that "Themenseiten are not fully rolled out on production" is
> false and was still in the project skills on 2026-08-07. Production carries
> more than twice as many pages as staging.

---

## 2. Which variant the page renders — `ccm:page_config`

The page-config **folder** carries a JSON document that nothing else exposes:

```json
{
  "variants": ["workspace://SpacesStore/722da7dd-…", "workspace://SpacesStore/f88b8249-…"],
  "default":  "workspace://SpacesStore/722da7dd-…"
}
```

Measured:

- Present on **99/99** production and **45/45** staging pages.
- `default` is set on **76/99** production and **5/45** staging pages, and where
  set it is **always** `variants[0]` — 76/76 and 5/5, no counter-example, no
  value pointing outside the list.
- `variants[]` covers **every** real child: children not listed = **0** on both
  instances. The reverse happens — `variants[]` names variants that no longer
  exist (**3 dangling refs** on staging, 0 on production).
- For every page with more than one variant (6 production, 7 staging), the
  `variants[]` order and the `/children` order agree on the first element.

**The selection rule:**

```
rendered variant = default, if that node still exists among the folder's children
                 ↳ else the first entry of variants[] that still exists
                 ↳ else children[0]
```

…and, when the folder was reached bottom-up from a variant rather than top-down
from the collection, **only if the folder is the one the owner's
`ccm:page_config_ref` names**. A variant in a superseded folder is not what the
page shows.

Taking `children[0]` — the previous behaviour — happens to land on the same node
in all 13 measured multi-variant pages. That is an accident of ordering, not a
rule the repository promises.

---

## 3. The profiling properties exist and are mostly empty

| non-template variants | staging (68) | production (109) |
|---|---|---|
| without `ccm:page_variant_profiling_target_group` | 49 (72 %) | **98 (90 %)** |
| without `ccm:educationalcontext` | 45 (66 %) | **97 (89 %)** |

Both are queryable and always were. They are simply not filled in.

The consequence is the single most important rule in this document: **an
Elasticsearch criterion can only match a value that is present.** Sending either
field to the search therefore does not narrow the result set, it *hides* nine
pages out of ten. A caller asking for `targetGroup: 'teacher'` on production
reaches exactly **one** variant.

Filter locally, and treat "unset" as "not excluded".

Both fields DO accept multiple values (OR), measured on both instances — useful
once the data is maintained.

---

## 4. What the `page_variant` query can and cannot do

### `virtual:page_variant_global` — `['false']` is a no-op

| criteria | staging | production |
|---|---|---|
| none | 99 | 121 |
| `virtual:page_variant_global: ['false']` | **99** | **121** |
| `virtual:page_variant_global: ['true']` | 21 | 2 |
| `ccm:page_variant_is_template: ['true']` | 30 | 12 |

The MDS statement is value-specific — `<statement value="true">{"match":
{"path":"${systemfolder}"}}</statement>` — so any other value contributes no
query fragment at all. `['false']` returns the *unfiltered* set, templates
included.

The two flags are also not interchangeable: `global` is a strict **subset** of
`is_template` (overlap = all of `global`; 9 staging / 10 production templates are
not global). **`ccm:page_variant_is_template: ['false']` is the correct filter**
and the only one that reliably separates real pages from templates.

### `virtual:parent_recursive` — real, useful, single-value only

Scopes the search to a collection **subtree**:

```
virtual:parent_recursive = <Physik portal>  → 31 variants (production)
page_config_ref → /children on the same id  →  1 variant
```

That is a different question, not a faster route to the same answer: the subtree
carries the topic pages of the portal's sub-collections.

- Multiple values are refused:
  `InvalidParameterException: Trying to search for multiple values of a
  non-multivalue field virtual:parent_recursive`. Candidate collections cannot be
  batched into one query.
- `virtual:parent` (non-recursive) at a **collection** returns 0 — variants are
  not its direct children. At a **page-config folder** it returns exactly that
  folder's variants, i.e. the same set `/children` already gives. No gain.
- Combines with `ccm:page_variant_is_template` and the profiling filters.
- Against the WLO root: 88 of 121 production variants, 51 of 99 on staging — so
  a third of all variants live outside the portal tree.

### There is no way to search topic pages by name

`ngsearchword` is *accepted* by the query and matches **nothing** — 0 hits for
any term, on both instances. No title parameter exists either:

```
Could not find parameter cclom:title in the query page_variant
```

This is why finding a Themenseite by topic has to go the long way round: search
*collections* by keyword, then check each for a page config.

---

## 5. Titles: the variant label is not the page name

| | staging | production |
|---|---|---|
| readable `cclom:title` | 46/68 | **109/109** |
| `cclom:title` still `PAGE_VARIANT_<uuid>` | 22/68 | 0/109 |
| `cm:title` is the technical `PAGE_VARIANT_<uuid>` string | 54/68 | **109/109** |

Two consequences:

- **`cm:title` is worthless as a label** and must not be a fallback: falling back
  to it replaces "no label" with a UUID that merely looks like one. Only
  `cclom:title` is a human label — and on staging even that is technical for a
  third of the variants, so the *shape* has to be checked, not just the field.
- The readable titles are *"Fachportalstartseite"*, *"Vorlage: Themenseite"*,
  *"Standard-Vorlage_Kopie"* — they name **the layout the variant was copied
  from**, not the topic. The topic name is the owning **collection's** title
  (*"Evidenzbasierte Medizin – EbM"*). Matching a user's query against variant
  titles cannot work.

### Siblings are editorial copies, not target-group fassungen

Properties that differ between sibling variants of one page (count of the 6
multi-variant production pages): `cm:created`, `cm:modified`, `cclom:title`,
`cm:title`, `cm:name`, `ccm:page_variant_config`, `ccm:educationalcontext`,
`ccm:page_variant_profiling_target_group` — all 6/6; `ccm:page_variant_template_ref`
4/6.

A real six-variant page reads:

```
Fachportalstartseite            (kein targetGroup)
Vorlage "Geisteswissenschaften"_Kopie        learner
Leeres Template_Kopie                        general
Vorlage "Geisteswissenschaften"_Kopie_Kopie  (kein targetGroup)
Fachportalstartseite_Kopie                   general
Fachportalstartseite_Birte                   general
```

The mental model "one variant per target group" does not survive contact with the
data. Three of these carry `general`. Which one renders is **not** derivable from
the target group — only from `ccm:page_config` (§2).

---

## 6. Latency: where the time goes

A `page_variant` hit carries **nothing that identifies the owning collection**.
Measured absent from the response: `virtual:parent`, `ccm:page_config_ref`,
`path`, `virtual:primarypath`. The only containment fact on a hit is
`virtual:primaryparent_nodeid` — the page-config folder.

So every listing pays, per page: one `/metadata` on the folder (which also yields
`ccm:page_config`, so ask for both properties at once) plus one `/metadata` on
the collection above it. Two reads per page, purely to learn its name.

That cost is the reason the listing resolves **only the pages it will return**,
rather than a pool sized by guesswork.

Typical measured timings (production, anonymous): variant search 1.2–1.8 s for
the full set; `/metadata` ~0.2–0.5 s; a `maxResults: 5` listing ≈ 11 upstream
calls, ~3 s cold.

---

## 7. The rules that bind the implementation

1. **Filter the profiling fields locally; unset never excludes.** One place:
   `variantMatchesFilters` (`src/topic-page-api.ts`). The listing modes drifted
   apart once already — Mode C filtered upstream while Modes A/B filtered
   locally — so the same `targetGroup` produced two different result sets.
2. **`ccm:page_variant_is_template: ['false']` is the only criterion sent** for a
   plain listing. Not `virtual:page_variant_global` (§4).
3. **The rendered variant comes from `ccm:page_config`** (§2), and only from the
   folder the owner's `ccm:page_config_ref` names.
4. **Group by page-config folder, but count distinct OWNERS.** The folder is the
   only key a search hit carries; the collection is what the merge collapses on.
   They are not the same thing (§9a).
5. **Never fall back to `cm:title`** for a variant label (§5).
6. **Read the folder once for both facts** — owner and `ccm:page_config` live on
   the same node.
7. **Disclose the search cap.** The listing fetches at most 300 variants in its
   one search; the catalogue fits below that today, and a cap nobody mentions
   reads as completeness.

---

## 8. What was implemented (2026-08-07)

- `variantMatchesFilters` — the one filter rule, unset never excludes.
- `src/topic-page-config.ts` — `parsePageConfigOrder`, `readPageConfigOrder`,
  `orderVariants`: the `ccm:page_config` document and the selection rule, split
  out because it follows the page builder's schema rather than edu-sharing's
  endpoints.
- `resolvePageFolder` — one folder read yields owner *and* variant order.
- `ThemePageInfo.isDefault` + `ThemePageVariant.isDefault` — the rendered variant
  is named, in JSON and in the Markdown listing.
- `search_wlo_topic_pages(withinCollectionId)` — the subtree mode (§4).
- The listing groups by folder before resolving owners; the pool factor and the
  one-shot top-up are gone.

---

## 9. What only a live run revealed

Everything in §8 was green against `fetchMock` before it ever reached a
repository. Four defects were not — none of them could have been, because each
needs a data shape nobody thought to fake.

**9a. Grouping key ≠ merge key.** A collection may hold several page-config
folders (§1), so grouping by folder under-delivered against a merge that keys on
the collection: 20 pages requested, 19 returned, and *"Zukunfts- und
Berufsorientierung"* appeared three times in the top five. Fixed by resolving in
waves until enough distinct owners are in hand — every wave works from the search
result already in memory, so it costs no further search.

**9b. Several "rendering" variants for a page that renders one.** Each folder has
its own `default`, so marking the first variant of each folder claimed several
active variants per page. Only the folder named by `ccm:page_config_ref` can hold
the rendered variant; variants of superseded folders stay listed (dropping them
would lose the pages whose only folder is superseded) but are never marked.

**9c. The merged entry did not lead with the rendered variant.** The folders are
resolved independently, so the superseded one can come back first — and
`includeContent` resolves `variants[0]`, i.e. it rendered a **superseded copy** of
the page. The rendered variant is now moved to the front whenever it arrives.

**9d. The rendered variant may not be in the list at all.** For
*"Zukunfts- und Berufsorientierung"* (`00b632ac…`) the active folder is
`5fa56e66…`, holding exactly one variant `9b24debf…` which *is* the recorded
default — and *is* among the 109 search hits. It is simply never selected,
because the wave loop stops once 20 distinct owners are in hand and that folder
sits behind the cut. With no variant marked, `includeContent` took `variants[0]`,
an arbitrary superseded copy.

Fixed for the **harm**: `includeContent` hands over a variant id only when one is
known to be the rendered one, otherwise none — and `getTopicPageContent` then
walks the authoritative chain collection → `ccm:page_config_ref` →
`ccm:page_config.default`. Verified live: that page now resolves `9b24debf`.

**Still open, and it is a design decision, not a mechanical fix:** the variant
*list* for such a page stays incomplete (it shows four superseded copies, not the
rendered one). Two ways out — have `enrichPage` report the variants of the
owner's ACTIVE folder from the group map already in memory, which removes the
superseded copies from the listing and contradicts the documented promise to keep
listing them; or have the wave loop additionally resolve each owner's active
folder, trading upstream calls for completeness. Affects 1 page in 20 live.

**Measured before → after (production, `maxResults: 20`):**

| | before | after |
|---|---|---|
| distinct pages, no filter | 19 | 20 |
| distinct pages, `targetGroup: 'teacher'` | 16 | 20 |
| duplicate collection names in the top 5 | 3× one collection | none |
| multi-variant entries not leading with the rendered variant | — | 0 in 3 runs |
| Physik: `collectionId` → `withinCollectionId` | 1 | 20 (capped by `maxResults`) |

> The upstream hit order is **not stable** between calls: three consecutive runs
> returned 7, 5 and 5 multi-variant entries among the first 20 pages. Measure
> repeatedly; a single clean run proves little.

The lesson is the one the write-support work recorded on 2026-08-02, now
confirmed for a **read** path: a test against `fetchMock` proves the code sends
what we decided to send. It cannot tell us the repository's data has a shape we
did not imagine.

---

## 10. What is blocked repository-side

None of these can be fixed here. Ordered by what they would buy:

1. **A `page_variant` hit identifies no owning collection.** `virtual:parent`,
   `ccm:page_config_ref`, `path`, `virtual:primarypath` are all absent from the
   response (measured). Every listing therefore costs two extra metadata reads
   per page just to learn its name. Exposing the parent collection id as a
   returned property would remove the dominant cost of the whole listing path.
2. **`ngsearchword` on `page_variant` matches nothing.** A working text search
   over variant/collection titles would replace the entire collection detour.
3. **The profiling properties are ~90 % unpopulated on production.** Either
   backfill them, or have the MDS statement treat "unset" as matching, so a
   filter narrows instead of hiding.
4. **`virtual:parent_recursive` is single-value.** Multi-value would let one
   query cover a whole candidate set.
5. **`virtual:page_variant_global` has no `false` statement** — there is no way
   to ask for "not global" server-side.
6. **`cm:title` on variants holds `PAGE_VARIANT_<uuid>`** on 109/109 production
   nodes, which makes a standard title field useless for display.
7. **`ccm:page_config.variants` carries dangling references** to deleted variants
   (3 on staging). Consumers must intersect with the folder's real children.

---

## 11. Where the code lives

| Concern | Module |
|---|---|
| the `ccm:page_config` document, order + default | `src/topic-page-config.ts` |
| variant search, filter rule, folder→owner walk | `src/topic-page-api.ts` |
| one page's variant → swimlanes | `src/topic-page-structure.ts` |
| the four listing modes | `src/services/topic-page-discovery.ts` |
| keyword → Themenseiten (Mode B core) | `src/services/topic-page.ts` |
| merge, sort, render | `src/tools/topic-pages-present.ts` |
| tool schema and dispatch | `src/tools/topic-pages.ts` |

Tests that pin the rules: `tests/topic-pages-filter-consistency.test.ts` (§7.1),
`tests/topic-page-active-variant.test.ts` (§2, §9b–d),
`tests/tools-topic-pages-pool.test.ts` (§7.4, §7.7),
`tests/topic-pages-subtree.test.ts` (§4),
`tests/topic-pages-present.test.ts` (§9c).
