# Design + Tasks: closing the tool gaps from the use-case review

Design and task list in one file — the packages are small and independent, so a
separate `-tasks.md` would mostly repeat this one.

## Goal

Close the MCP-tool gaps the 2026-08 use-case/pattern review identified, and only
those that are actually gaps: measurement showed several of its "missing" tools
already exist, and several others are blocked on decisions that are not ours.

## Context

The review lists 13 new tools plus 6 to sharpen, and marks ~40 use cases red.
Measured against the running server on 2026-08-09, its tool inventory is out of
date in five places, and the licence question it marks "unverified / high
priority" is answerable. What remains is much smaller than the document
suggests.

### Measurements this plan rests on (2026-08-09, staging, anonymous)

| Claim in the review | Measured |
|---|---|
| `wlo_create_content` is "URL only", so `wlo_create_text_content` is needed | **False** — it already takes `content`, `contentFormat`, `fileBase64` |
| `wlo_update_content` is "metadata only", so `wlo_update_content_text` is needed | **False** — same three fields |
| `find_wlo_skills` exists, `get_skill_bundle` is missing | **Reversed** — `find_wlo_skills` is gone; `get_skill(nodeId, includeFiles)` is the bundle |
| Curation tools "do not appear in `tools/list` without identity" | **False** — an anonymous `tools/list` returned 40 tools including all 13 |
| `get_url_text` | **Missing from the inventory** — it exists |
| Licence filtering "unverified" | **Works**: `Optik` 756 → 343 with `ccm:commonlicense_key=CC_BY`; `virtual:license` and `ccm:license` → 400 `DAOValidationException`. `lookup_wlo_vocabulary` already carries a `license` vocabulary mapping labels → `CC_BY` |
| `wlo_register_usage` — is a write path even there? | **Yes**: `POST /usage/v1/usages/repository/{repositoryId}` (OpenAPI, 316 paths). Read-back: `GET /usage/v1/usages/node/{nodeId}` |

## Scope

**In scope**

- **P1 — licence filter.** A `license` parameter on `search_wlo_content` and
  `search_wlo_all`, resolved through the existing vocabulary. Not a new tool.
- **P2 — `wlo_register_usage`.** One new curation tool that records a usage of a
  node.
- **P3 — `wlo_set_topic_page`.** Gated: starts with a measurement task, and its
  design is written only once that measurement exists.

**Out of scope, each with the reason**

| Not built | Why |
|---|---|
| `get_compendium_section` | Reading a chapter presupposes a chapter structure. The storage form (YAML / Markdown / RAG; property / own object / series) is open decision 3+4 of the review. Building the interface first would fix it to a structure that does not exist. |
| `get_qa_pairs` / `wlo_update_qa_pairs` | Same block — Q&A lives inside the compendium text today and has no ids. |
| `search_web`, `crawl_source` | Needs a provider decision (which API, cost, GDPR) and an `unsafe` classification like `get_url_text`. No decision exists. |
| `get_collection_coverage` | "Complete" is undefined — open decision 6 (QS metrics). A coverage number without a definition is a number nobody can act on. |
| Repo trigger / webhook, registry write access | Not MCP tools; deployment and editorial concerns. |
| `wlo_create_text_content`, `wlo_update_content_text` | Already exist (see the table above). |
| `get_skill_bundle` | Already exists as `get_skill(includeFiles)`. |

## Global constraints (from `CLAUDE.md`)

- ESM with `.js` extensions on intra-project imports; no new runtime dependency.
- Tool modules hold schema + rendering only; algorithms go to `services/`,
  vocabulary logic to `filter-criteria.ts`.
- **Every curation tool goes through `registerCurationTool`** — the one place
  that stamps `oauth2` and runs the gate. Enforced by
  `tests/shared-rule-discipline.test.ts`.
- **Every write reads back**, and is two-step (preview + single-use token bound
  to a fingerprint of the change set).
- An aborted request is reported as an open outcome, never a failure
  (`timeoutOrError`).
- A test against `fetchMock` proves we send what we decided to send, never that
  the repository accepts it. **Every write path runs live against staging once.**

## P1 — licence filter

### Approach

`buildFilterCriteria` is the single place where a label becomes a criterion, and
it already reports unresolved values with "did you mean" suggestions. Adding
`license` there means both search tools, the `searchAll` service and the REST
layer gain it at once, with the existing unresolved-reporting for free.

Rejected alternative: a `license` parameter parsed inside each tool. It would
duplicate the vocabulary lookup and skip the unresolved reporting — the exact
layering the module's own docstring was written to prevent.

### Files

| File | Change |
|---|---|
| `src/filter-criteria.ts` | `license?: string` in the params, resolved via `resolveVocab(v, 'license')` → `{ property: 'ccm:commonlicense_key', values: [key] }` |
| `src/services/search.ts` | `license?: string` on `SearchAllOptions` (passed straight through — `buildFilterCriteria(opts)` already receives the whole object) |
| `src/tools/content-search.ts` | `license` input on `search_wlo_content` and `search_wlo_all` |
| `src/rest/validate.ts` | allow `license` as a query parameter |
| `tests/filter-criteria.test.ts` | resolution + unresolved reporting |
| `tests/tools-license-filter.test.ts` | the criterion reaches the upstream request |

### Interfaces

```ts
buildFilterCriteria(params: {
  educationalContext?: string; discipline?: string; userRole?: string;
  publisher?: string; learningResourceType?: string;
  license?: string;                     // NEW — "CC BY 4.0" | "gemeinfrei" | "CC_BY"
}): { criteria: SearchCriterion[]; labeled: LabeledCriterion[]; unresolved: UnresolvedFilter[] }
```

### Tasks

Step 0: invoke `/better-coding-workflow`.

1. **Test: the vocabulary resolves.** `buildFilterCriteria({ license: 'CC BY 4.0' })`
   yields `{ property: 'ccm:commonlicense_key', values: ['CC_BY'] }`; a raw key
   (`'CC_BY'`) resolves too; nonsense (`'CC XY'`) lands in `unresolved` with
   suggestions. Red → implement in `filter-criteria.ts` → green.
2. **Test: the criterion reaches the request.** Through `search_wlo_content` with
   `license: 'CC BY 4.0'`, the mocked upstream body contains the criterion. Red →
   add the input to both tools + `SearchAllOptions` → green.
3. **Test: an unrecognised licence is reported, not silently dropped** — the
   `formatUnresolvedHint` line appears in the tool's visible output.
4. **REST**: add `license` to the allow-list in `rest/validate.ts` with a test.
5. **Live check** against staging: `search_wlo_content("Optik", license: "CC BY 4.0")`
   returns fewer hits than without, and every returned `license` is `CC BY 4.0`.
6. Docs: `docs/TOOLS.md`, both READMEs, `CHANGELOG.md`.

**3. The reported total counted the same records twice.** The fan-out summed the
five keys' `pagination.total`. But the families NEST: `CC_BY` contains
`CC_BY_SA` (Mathematik: family 27 351 vs exact 3 848 + 9 554), and it also
carries the NC/ND records that are not OER at all. Measured overstatement:
Optik 575 vs 274, Mathematik **37 851 vs 14 343**, Musik 4 401 vs 2 218 — +98 %
to +164 %. The same defect existed one size smaller for a SINGLE licence, where
the family total (Optik + CC BY: 343) was reported over a list of 42. The total
now comes from a facet aggregation of EXACT keys (`exactLicenseTotal`), matched
through `resolveVocab` so it obeys the same rule as `filterByExactLicense` — the
index holds `CC BY-SA` with spaces as its own key (Optik 6, Musik 1), and a
literal comparison would count those records as neither while the filter keeps
them. Verified live against an independently computed facet: 0 difference on all
five test queries.

**4. `search_wlo_within_collection` applied no licence filter for the bundle.**
Its filters are matched locally against the collection's children, and a licence
SET contributes no criterion to match against — so `license: "OER"` returned
everything, CC BY-NC-ND and undeclared records included. It now runs the same
exactness pass as the other two paths (live: 44 → 42, 10 → 9) — and the same
empty-result notice, since a pass that can empty a result has to say so.

**5. A total upstream failure was reported as an empty result.** All five
requests failing left an empty merge, indistinguishable from "there is no OER
material here". It throws now; losing ONE key is still tolerated.

### Verification

- `node --import tsx --test tests/filter-criteria.test.ts tests/tools-license-filter.test.ts`
- `npm test` (no regression), `tsc --noEmit` exit 0, `npm run build` exit 0
- Live: hit count drops and every hit carries the requested licence

### What implementation revealed — the design above was incomplete

Findings 1–2 came from the first live run, 3–5 from a review of the fan-out that
was itself built to fix 1–2. None was visible to any test: `fetchMock` answers
what the test decided, so it can prove we send what we meant to send and nothing
about what the repository does with it, or about how the delivered page is
composed.

**1. The upstream key matches a licence FAMILY, not a licence.** `CC_BY` returns
343 hits for "Optik" — CC BY-ND, CC BY-NC-SA and CC BY-NC-ND among them. Quoting
the value changes nothing (343 either way). Sub-keys behave the same one level
down: `CC_BY_NC` (172) covers `CC_BY_NC_SA` and `CC_BY_NC_ND`; `CC_BY_SA` is 110
and `CC_BY_ND` 19. So **plain CC BY is the one licence that cannot be isolated
upstream** — precisely the one people filter for when they intend to remix, and
the surplus hits are MORE restrictive than what they asked for. Passing the
criterion through alone would have shipped a filter that answers a "may I remix
this" question with No-Derivatives material. Exactness is therefore enforced
locally in `filterByExactLicense`.

**2. Local exactness starves without headroom.** With the filter in place the
first live run returned **zero** results for CC BY 4.0 — the page of ten from
those 343 held no exact record. Unlike duplicate copies, this over-match is
systematic, which is what justifies widening the candidate window only for this
one filter (`pageSizeForLicense`, `LICENSE_PAGE = 50`). Re-measured after the
change: CC BY 4.0 returns CC BY 4.0 and nothing else.

Note for whoever touches this: `enhancedSearch` ignores the size argument for
the upstream request — it always fetches its own `POOL_SIZE` (25) per query
variant and uses the argument to trim the ranked merge. The widening therefore
shows up in how many candidates reach the licence pass, never in `maxItems`. A
first version of the test asserted the URL and was wrong about the mechanism.

**3. A set of licences cannot be expressed upstream either.** The review asked
for one bundle beside single licences — OER. The obvious multi-value criterion
fails: two values at `ccm:commonlicense_key` answer 400 `DAOValidationException`,
the criterion repeated twice AND-s (343 + 110 → 110), and an "A OR B" string
matches 0. The OR measured on `ccm:oeh_extendedType` does **not** transfer, and
assuming it did shipped a 400 that every test passed. The bundle therefore sent
no criterion at first and was applied entirely locally — **superseded by finding
5 below**, which is where that answer turned out to be wrong rather than merely
weak; the bundle fans out over its five keys today. Narrowing on `CC_BY` instead would
keep both CC members but lose every public-domain record — and the live run shows
that is not theoretical: `Optik` + OER returned an `Urheberrechtsfrei` item.

**4. An emptied licence result must say why.** `Optik` + CC BY-NC 4.0 reports 172
backend hits and returns none; `licenseFilterNotice` now names the number of
checked candidates and why the total still differs.

**5. The bundle's local-only filtering was not a weak answer but a wrong one —
and facets are what showed it.** `ngsearch` takes a `facets` argument and counts
the exact keys server-side over the WHOLE result set (the first attempt sent them
as bare strings and got no facet block back, which looked like "this instance
cannot do facets"; the signature takes `string[]` and builds `{property}` itself).
With that instrument: staging's `Mathematik` holds 18 793 records with an OER
licence, 41.9 % of everything carrying a licence — and the tool answered "kein
Treffer". The first fifty by relevance had no `ccm:commonlicense_key` at all
(50/50 absent; through `enhancedSearch` 23× CC BY-NC-SA + 2× CUSTOM). Relevance
and licence are unrelated, so the top of one is no sample of the other, and the
"variable yield" reported earlier understated it badly.

Each key narrows upstream on its own, so the bundle now **fans out over its five
keys and merges** (`src/services/license-search.ts`) — five requests, and only
for the bundle. Candidates checked went 50 → 152 (Mathematik), 40 → 140 (Optik),
25 → 104 (Musik); exact OER hits went 0 → 127, 2 → 107, 0 → 102.

The merge is **round-robin**: concatenating handed the whole cap to the first key,
so `Mathematik` + OER returned six hits that were all CC 0 (191 records) while the
11 563 CC BY-SA ones never reached the page. Both defects were invisible to every
test — the first because `fetchMock` answers whatever the test decided, the second
because no test asked what the mix of the delivered page was.

**The OER share itself, measured by facet (2026-08-09).** Staging first — it is
where `WLO_REPOSITORY_URL` points by default, and it is the larger catalogue:

| | Staging | Production |
|---|---|---|
| records | 403 431 | 318 696 |
| OER | 31.5 % (42.8 % of those carrying a licence) | 34.4 % (47.6 %) |
| CC/PD only, without `COPYRIGHT_FREE` | 28.4 % | 28.8 % |
| no licence key at all | 105 969 (26.3 %) | 88 200 (27.7 %) |

Per query it ranges from 8.4 % (Klimawandel, production) to 64.9 % (Optik,
production) — the operator's estimate of 7-10 % matches individual topics, not
the catalogue. Records with no licence key are counted as not-OER: an unlabelled
record is not evidence of a free licence (operator's decision, pinned by
`tests/tools-license-filter.test.ts`).

**Contract widened on the user's instruction:** `search_wlo_within_collection`
takes `license` too, as does the second filter list in `rest/handlers.ts`. Its
filters are matched locally against the stored property (`nodeMatchesCriteria` →
exact `includes`), so the family over-match does not apply there.

## P2 — `wlo_register_usage`

### Approach

A curation tool like the other twelve: registered through `registerCurationTool`,
gated at call time, two-step preview/confirm, and a read-back. The usage API is
its own endpoint family, so the client goes next to the other endpoint modules
rather than into `wlo-node.ts`.

**The request body is not designed from the OpenAPI schema alone.** Task 1 of
this package is a live probe against staging with a throwaway node, because this
project has twice shipped a write that every test passed and the repository
rejected. The design of tasks 2+ is written after that probe.

### Files (provisional, confirmed by task 1)

| File | Change |
|---|---|
| `src/wlo-usage.ts` | new — `registerUsage()` (POST) and `readUsages()` (GET), both through `wloFetch` + `readJson` |
| `src/services/write/…` | reuse unchanged — gate → change set → confirm → verify |
| `src/tools/curation-usage.ts` | new — the tool, via `registerCurationTool` |
| `src/server.ts` | registration next to the other curation tools |

### Tasks

Step 0: invoke `/better-coding-workflow`.

1. **Live probe** (no product code): what body does
   `POST /usage/v1/usages/repository/-home-` accept, what does it answer, and
   does `GET /usage/v1/usages/node/{id}` show the result? Record in this file.
2. ~~Client module + unit tests against `fetchMock`.~~
3. ~~Tool with preview/confirm through `registerCurationTool`.~~
4. ~~Read-back.~~
5. ~~Live run against staging.~~
6. ~~Docs + `CHANGELOG.md`.~~

### Task 1 result — the gate closed. Tasks 2-6 are NOT built.

Measured on staging 2026-08-09 as the authenticated service user
(`authority = WLO-Upload`); scripts `probe-usage.mjs`, `probe-usage2.mjs`. This
package was written with task 1 as its gate precisely so that this outcome costs
one probe instead of a client, a tool and a test suite.

**The write endpoint is gated by an APPLICATION SIGNATURE, not by a user.** The
OpenAPI summary says so ("app signature headers and authenticated user
required") and the repository enforces it:

| Request | Answer |
|---|---|
| `POST …/usages/repository/-home-`, full body, `appId: local` | 403 `DAOSecurityException: app signature required to use this endpoint.` |
| same, body `{ nodeId }` only | 403, identical message |
| same, body `{}` | 403, identical message |
| same, `appId` ∈ {`-home-`, `local`, `Wordpress_6a43d5fc8b480`, `moodle_647dc21e185a4`, `sample-app`} | 403, identical message |
| all four `X-Edu-App-*` headers, bogus signature, unregistered app id | **500 `Signature could not be verified!`** |
| same, with a REGISTERED app id (`Wordpress_Staging_WLO`) | **500 `Signature could not be verified!`** |

Two things follow. The identical answer to an **empty body** puts the gate before
the body is read, so no body shape reaches the handler — task 1's original
question ("what body does it accept?") has no answer to find. And the 500 on
present-but-wrong headers shows the signature is genuinely verified, so the
endpoint needs the **private key of an application registered at the
repository**, which our service user is not and cannot become by sending a
different field.

Neither is there a side door. `POST /node/v1/nodes/-home-/{id}/prepareUsage`
answers 200, but it returns the node's metadata (the remote-object step of the
same app flow) and the node's usage list is still `[]` afterwards.

The READ side works without any of this: `GET /usage/v1/usages/node/{id}` → 200
`{"usages":[]}`, and `…/collections` → 200 `[]`. Three real editorial records
(first content hits for "Optik") also report `usages=0, collections=0` — so
there is currently nothing to read either.

**What it would take, and why that is not our call.** WLO operators would have to
register an application for this server and hand us its private key. An
edu-sharing app signature is not a scoped API token: it is the credential that
lets its holder act *on behalf of arbitrary users*, which is exactly why this
endpoint is gated on it. The server's auth design
(`2026-08-04-mcp-access-token-design.md`, `2026-08-05-mcp-oauth-design.md`) rests
on the measurement that **there is no token to relay** — every scheme carries the
user's own credential, and nothing more powerful than that user ever rests on our
disk. A repository-wide impersonation key reverses that decision. It is a
decision for the operators, not a task in this plan.

### Risk (retained — it is now the finding)

The endpoint takes a repository id and an app id; a usage recorded under the
wrong app id is invisible to the statistics it was meant to feed. Task 1
established that we cannot record one under **any** app id.

## P3 — `wlo_set_topic_page`

Writes `ccm:page_config`, the page builder's own document — the same one
`src/topic-page-config.ts` reads. Writing it wrong does not fail loudly; it
changes which variant a live page renders.

### Gate result (staging, 2026-08-09) — open, and that is the problem

Scripts `probe-pageconfig-write.mjs` (write test on a throwaway `ccm:map` in our
own userhome — no editorial page was touched) and `probe-pageconfig-read.mjs`
(read-only over 28 real page-config folders).

**The document is smaller than the reader suggests.** Across 28 distinct
page-config folders behind 40 staging page variants:

```
{"variants":["workspace://SpacesStore/54d4ecaa-…","workspace://SpacesStore/05ec7229-…"]}
```

| Key | Present |
|---|---|
| `variants` | 28/28 |
| `default` | **2/28** |

No other key occurs. Two things follow for a writer: the variants are stored as
**full store refs**, not the bare UUIDs `stripStoreRef` hands the read side — the
write direction needs the inverse — and `default` is normally absent, so setting
it ADDS a key to a document that did not have one. (CLAUDE.md records `default`
on 76/99 PRODUCTION pages; 2/28 is staging, not a contradiction.)

**Both write routes work.** On a throwaway `ccm:map`:

| Route | Answer | Read-back |
|---|---|---|
| `PUT …/metadata?obeyMds=false` | 200 | verbatim |
| `POST …/property?property=ccm:page_config` | 200 | verbatim |

So unlike the compendium text, this property is not property-route-only. We use
the property route anyway: it is the one that bypasses the MDS entirely, and the
MDS route's 200-while-storing-nothing failure mode is the one `nodes.ts` was
written to avoid.

**The repository validates nothing — every guarantee has to be ours.** Measured,
not assumed:

| Written | Answer | Stored |
|---|---|---|
| `"not json at all"` | 200 | `"not json at all"`, verbatim |
| a valid document on a `ccm:io` (never a page-config folder) | 200 | verbatim |

That is the finding that shapes the design below. The endpoint is a dumb string
setter on an unconstrained property, and a broken document does not fail here —
it fails later, in the page builder, on a public page. What the builder does with
a malformed document is NOT measured and cannot be measured without breaking a
live staging page, which is the operators' call and not a probe's.

### Approach

One curation tool, `wlo_set_topic_page`, that sets **which variant a Themenseite
renders** — the `default` key, nothing else.

Deliberately NOT in scope: reordering `variants[]`, adding or removing variants,
creating a page. Those are page-builder operations with no safe read-back story;
`default` is the single field that decides what the public sees, and the one the
use-case review asked for.

Five rules, each traceable to a measurement above:

1. **Read-modify-write, never fabricate.** The current document is read, exactly
   one key is set, and every other key — including keys we do not know — is
   carried through. Building a document from our own model would drop
   `variants[]` on 28/28 pages.
2. **The document is never round-tripped through `parsePageConfigOrder`.** That
   function strips store refs and discards unknown keys — lossless for reading,
   destructive for writing. The write path works on the RAW string.
3. **The variant must be a real, usable child of that folder** (`isUsableVariant`
   over the folder's children). The repository accepts any string; a `default`
   pointing at nothing renders nothing.
4. **The store-ref form is written back**, matching 28/28 existing documents.
5. **Read back and re-parse.** The standing read-back rule plus what the probe
   showed: a 200 with garbage stored is a real outcome here, so the verification
   compares the parsed document, not only the string.
6. **A no-op is refused, not written.** Added by the review round: the other
   twelve tools get this from `buildChangeSet`, which drops unchanged FIELDS, and
   this change has none. Only an explicitly recorded `default` counts — with none
   the page renders `variants[0]` by position, and writing that same variant down
   turns "whoever happens to be first" into a decision.

The folder is resolved the way every reader already resolves it: `collectionId` →
`ccm:page_config_ref` → folder. Only that folder can hold the rendering variant
(CLAUDE.md rule 3 — a collection may own several page-config folders).

### Files

| File | Change |
|---|---|
| `src/topic-page-config.ts` | `setDefaultVariant(raw, variantId): string` — the pure document transform, next to the parser that reads the same schema |
| `src/services/write/topic-page.ts` | new — resolve folder, validate the variant, write via the property route, read back |
| `src/tools/curation-topic-page.ts` | new — the tool, via `registerCurationTool` |
| `src/server.ts` | registration next to the other curation tools |
| `tests/topic-page-config.test.ts` | the transform: keys preserved, store-ref form, absent `default` added |
| `tests/curation-topic-page.test.ts` | gate, preview/confirm, refusal on a foreign variant, read-back mismatch |

### Interfaces

```ts
// topic-page-config.ts — pure, raw in / raw out, unknown keys preserved
export function setDefaultVariant(raw: string | undefined, variantId: string): string;

// services/write/topic-page.ts
export interface SetTopicPageVariantResult {
  ok: boolean;
  collectionName: string;
  previousVariantId: string;   // '' when the page recorded no default
  variantTitle: string;
  detail?: string;             // why it failed / could not be verified
}
```

### Tasks

Step 0: invoke `/better-coding-workflow`.

- [x] 1. **Test → implement `setDefaultVariant`**: unknown keys preserved,
  `variants` untouched, store-ref form written, an absent `default` added, an
  unparseable document refused (throw — never silently replace an editorial
  document). — 11 tests, `tests/topic-page-config-write.test.ts`.
- [x] 2. **Test → implement the service**: folder resolution, variant validation,
  property write, read-back comparison. — `src/services/write/topic-page.ts`.
- [x] 3. **Test → implement the tool** through `registerCurationTool`: gate,
  change set naming page + old + new variant, `timeoutOrError` on abort. —
  14 tests, `tests/tools-curation-topic-page.test.ts`.
- [x] 4. Register in `server.ts`; the counts in `server.test.ts` and
  `tools-curation-gating.test.ts` and the name list in `tests/curation-tools.ts`
  moved from 13 to 14 curation tools. All three guards fired on the first run —
  they are what caught the missing `toolInvocation` status.
- [x] 5. **Live run** against staging on a page structure we create and delete
  ourselves — never on editorial content.
- [x] 6. Docs: `docs/TOOLS.md`, both READMEs, `CHANGELOG.md`.

### Live run (staging, 2026-08-09) — `live-topic-page.mts`

The real tool through the real MCP server against the real repository, on a
Themenseite the script builds (collection → page-config folder → two variants)
and deletes again.

| Step | Result |
|---|---|
| Preview | names page, both variants with ids, states that no default is set yet and that the change is immediately public; mints a token |
| Confirm | `default` set to variant B; `variants[]` unchanged |
| Foreign variant id | refused, listing the two available variants; document unchanged |
| Switch back to A | `default` replaced, not appended |
| `get_topic_page_content` | reads the page back through the normal path |

**What only the live run found:** creating a variant with
`ccm:page_variant_config` in the `children` call silently drops the property —
`obeyMds` defaults to true and the MDS filters it out, the exact failure mode
`services/write/nodes.ts` documents. The first run therefore built two variants
the tool correctly refused as unusable. The fixture now sets the property through
the property route. No product change; the tool's refusal was right.

## Risks across the plan

| Risk | Mitigation |
|---|---|
| A write passes every test and the repository discards it | Each write package ends with a live run against staging (P2 task 5) |
| The licence filter silently narrows to nothing on an unknown label | `buildFilterCriteria` reports unresolved filters; P1 task 3 pins that the hint is visible |
| Scope creep back into the blocked tools | The out-of-scope table names the blocking decision for each |

## Open questions

None for P1. P2 has one, answered by its own task 1. P3 is gated on a
measurement and has no design yet.
