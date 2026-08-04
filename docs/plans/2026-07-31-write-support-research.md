# Research: write support (curation) for the WLO MCP server

Status: **knowledge gathering — no design decisions taken, no code written**
Date: 2026-07-31 · Target repository for all work: **staging**
(`https://repository.staging.openeduhub.net/edu-sharing`)

The order: create and submit content, read/improve/save existing content, the
same for collections and sub-collections, edit and regenerate compendium texts,
produce and store full texts (paired with the text-extraction service), choose
metadata with vocabulary support, delete content and collections, use the
suggestions endpoints to put AI-generated metadata in front of the user for
accept/reject, and consider comments/ratings.

Findings come from the OpenAPI spec (316 paths), read-only probes over ~400
live nodes, the published vocabularies, the sibling metadata-agent project's
upload documentation, and — with the user's explicit authorisation — **a small
set of controlled writes on one throwaway staging node** (§5a), which has since
been deleted.

---

## 1. What already exists and does not need building

| Capability | Where | State |
|---|---|---|
| Auth, three modes (anonymous / service account / per-user Basic) | `src/auth/` | done, live-verified 2026-07-31 |
| Read tools (24), services layer reused by REST + widgets | `src/tools/`, `src/services/` | done |
| Vocabulary label→URI resolution | `src/vocabs.ts` (+ hochschule, suggest) | partial, see §5 |
| Full-text READ, incl. external extraction service | `src/services/content-text.ts`, `src/text-extraction-api.ts` | done |
| Compendium text READ | `src/tools/compendium.ts` | done |

The write features are the first ones that need an **identity with rights**, so
they sit directly on the auth chain finished earlier today. Per-user mode (the
caller's own WLO login, delivered as an `Authorization` header) is the mode that
makes an edit attributable to a person in edu-sharing's audit trail.

---

## 2. The governing rule for every write

From the skill library, and it outranks every endpoint detail:

> **Never trust a `200 OK`. Read back.**

edu-sharing silently discards a write when (a) the property is not in the
metadata set (MDS), or (b) the caller lacks the write right. Both answer `200`.
A write tool that reports "saved" without re-reading the value would be exactly
the class of silent failure this server has spent the day removing.

Two consequences for any design:
- every mutating tool needs a read-back-and-compare step before it reports success;
- `node.access` should be checked for `"Write"` up front, because group
  inheritance grants and withholds it in non-obvious ways.

---

## 3. Endpoint map (verified against the staging OpenAPI)

### Content nodes
| Purpose | Endpoint |
|---|---|
| create | `POST /node/v1/nodes/{repo}/{parent}/children` — `type*`, `aspects`, `renameIfExists`, `versionComment`, `assocType`, `obeyMds`; body = property map. Parent may be `-userhome-` or `-inbox-`. |
| update metadata (MDS-filtered) | `PUT /node/v1/nodes/{repo}/{node}/metadata` |
| update a property the MDS does not know | `POST /node/v1/nodes/{repo}/{node}/property?property={prop}`, body `["value"]`, `null` deletes |
| binary content | `POST /node/v1/nodes/{repo}/{node}/content` |
| ~~full text~~ | `POST …/textContent` exists but is **useless for link records** — the bytes are stored and never read (§5a.4). Full text comes from `GET …/textContent?forceUpdate=true`, which makes the repository crawl `ccm:wwwurl` itself |
| delete | `DELETE /node/v1/nodes/{repo}/{node}` |
| preview image | `POST /node/v1/nodes/{repo}/{node}/preview` |

### Collections
| Purpose | Endpoint |
|---|---|
| create (sub-)collection | `POST /collection/v1/collections/{repo}/{collection}/children` — parent `-root-` for level 0; body = `Node`; `type` `EDITORIAL` or `EDITORIAL_GROUP` |
| update / delete | `PUT` / `DELETE /collection/v1/collections/{repo}/{collection}` |
| add content to a collection | `PUT /collection/v1/collections/{repo}/{collection}/references/{node}` — **PUT, no body**; `allowDuplicate`, **`asProposal`** |
| remove from collection | `DELETE …/references/{node}` |
| move / copy | `POST /node/v1/nodes/{repo}/{node}/children/_move` \| `_copy` |

**On "submitting":** there is no `POST /proposals`; the spec exposes only
`GET …/children/proposals`. Two mechanisms exist — `asProposal=true` on the
reference PUT, and the workflow endpoint (`PUT …/workflow`, status
`200_tocheck`). **The workflow route is the one WLO editorial actually uses**
(see §3b); prefer it.

### Suggestions (the accept/reject flow the order asks for)
| Purpose | Endpoint |
|---|---|
| store generated metadata | `POST /suggestions/v1/{repo}/{node}` — `type*` = `AI` \| `USER_PROPOSAL`, `version*`; body = array of `CreateSuggestionRequestDTO` |
| read | `GET /suggestions/v1/{repo}/{node}` (filterable by `status`), plus `…/raw` |
| **accept / reject** | `PATCH /suggestions/v1/{repo}/{node}` — `id[]`, `status` = `ACCEPTED` \| `PENDING` \| `DECLINED` |
| discard a version | `DELETE /suggestions/v1/{repo}/{node}?version=…` |

`CreateSuggestionRequestDTO` = `propertyId*`, `value*`, `description*`,
`confidence`. This is purpose-built for the requested flow: the model proposes
per-property values with a confidence and a rationale, the user accepts or
declines each, and the decision is stored server-side rather than in chat.

**Do not confuse it with** `POST /mds/v1/metadatasets/{repo}/{mds}/values/{widget}/suggest`,
which is value autocomplete for one input widget. Different purpose, similar name.

### Social features (present in staging)
- Comments: `PUT /comment/v1/comments/{repo}/{node}` to add,
  `POST`/`DELETE /comment/v1/comments/{repo}/{comment}` to edit/delete.
  **Trap:** the endpoint demands `Content-Type: application/json` (else `415`
  since ~04/2026) but reads the body as raw UTF-8 bytes — it does *not* JSON-decode.
- Ratings: `PUT` / `DELETE /rating/v1/ratings/{repo}/{node}`, plus `…/history`.

The endpoints exist in the staging spec; whether the *feature* is switched on
differs per repository, which is why the order calls them out separately.

---

## 3b. The established WLO upload flow (from the metadata-agent project)

The user supplied the upload process of a sibling project (metadata-agent-api /
browser plugin). It is a proven six-step flow against the same repositories, so
it outranks anything inferred from the spec alone. Every claim below that this
project relies on was re-verified against staging; the two places where the
sibling document is out of date are marked.

```
repo_field IDs → duplicate check → create node → set ASPECTS
              → write metadata (obeyMds=false) → collections → workflow
```

1. **Duplicate check** — `ngsearch` on `ccm:wwwurl` before creating anything.
   The plugin additionally compares the URL case-insensitively; the API only
   checks whether any hit came back. For a curation tool the stricter comparison
   is the right one.
2. **Create** — `POST …/children?type=ccm:io&renameIfExists=true&versionComment=…`
   with a *small* body: `ccm:linktype: ["USER_GENERATED"]` plus title,
   description, keywords, `ccm:wwwurl`, language. **Every value is an array**,
   even single ones. Parent is the shared inbox in guest mode
   (`21144164-30c0-4c01-ae16-264452197063`) or `-userhome-` when a real user is
   logged in — which maps exactly onto our service-account vs per-user modes.
3. **Aspects** — see §3c. This step is missing from our earlier endpoint map and
   is a silent-drop mechanism in its own right.
4. **Metadata** — `POST …/metadata?versionComment=…&obeyMds=false`, bulk first,
   then field-by-field on failure so one bad field cannot block the rest.
5. **Collections** — one `PUT …/references/{node}` per collection, no body.
6. **Workflow** — `PUT …/workflow` with
   `{receiver:[{authorityName:"GROUP_ORG_WLO-Uploadmanager"}], status:"200_tocheck", comment:…}`.

**This changes the "submit" conclusion.** §3 called `asProposal=true` the submit
path from spec reading. The *established* mechanism is the workflow endpoint
with status `200_tocheck` — verified to exist (`PUT …/workflow`, plus `GET` for
the history). Both exist; the workflow route is the one WLO editorial actually
runs on, and a curation tool should follow it rather than invent a second one.

### Transformations the repository demands (all reusable for us)
- **License**: the schema holds a URI; the repository wants
  `ccm:commonlicense_key` + `ccm:commonlicense_cc_version` as separate fields.
  Keys are validated against a fixed allow-list — explicitly to stop an LLM
  inventing a license. **We must do the same:** a hallucinated license on OER is
  a serious defect, not a cosmetic one.
- **Author**: `cm:author` plaintext → `ccm:lifecyclecontributer_author` as a
  VCARD string (`BEGIN:VCARD…N:Last;First…END:VCARD`), split at the *last* space.
- **Geo**: nested `schema:location[].geo` → flat `cm:latitude` / `cm:longitude`.
- **Complex values flattened** by preferring `uri` → `name` → `label` →
  `@value` → `value`.
- Internal prefixes (`virtual:`, `schema:`, `preview:`, `sys:`, `_`) are never sent.

### Where the sibling document is out of date (re-checked 2026-07-31)
| Claim there | Measured here |
|---|---|
| `ccm:oeh_flex_lrt` is the content-type field written on upload | **not in the MDS and absent from all 60 sampled nodes.** The live fields are `ccm:oeh_lrt` (58/60) and `ccm:oeh_lrt_aggregated` (42/60), both in the MDS |
| `ccm:oeh_event_begin` is not an MDS widget, hence `obeyMds=false` | `ccm:oeh_event_begin` **is** in the MDS today. `cm:latitude`/`cm:longitude` and `ccm:linktype` are not, so the argument for `obeyMds=false` still holds — just not with that example |

---

## 3c. Aspects — a third silent-drop mechanism

Alfresco *aspects* are property packs. A property whose aspect is not on the
node **cannot be written**: the request is accepted and the value is dropped
without an error. This is separate from MDS filtering and from missing rights,
and it is the most common cause of "the data just is not there".

```
GET  …/{node}/metadata?propertyFilter=-all-   → node.aspects
PUT  …/{node}/aspects                         → body: the FULL list (existing + new)
```

| Aspect | Enables |
|---|---|
| `cm:geographic` | `cm:latitude`, `cm:longitude` |
| `cm:author` | `ccm:lifecyclecontributer_author` |

So there are now **three** ways a write can vanish silently — MDS filtering,
missing aspect, missing right — and one countermeasure for all of them:
read back and compare (§2).

### `PUT` vs `POST` on `/metadata` — this answers the versioning question
Both exist and they are not equivalent:

| | Summary | Query |
|---|---|---|
| `PUT …/metadata` | "Change metadata of node" | `obeyMds` |
| `POST …/metadata` | "Change metadata of node (**new version**)" | `versionComment*` (required), `obeyMds` |

The sibling project uses `POST`, so every metadata write there creates a
version. For a conversational curation tool that edits iteratively, that would
produce a version per keystroke-equivalent. A deliberate choice is needed:
`PUT` while drafting, `POST` with a meaningful comment when the user commits.

`obeyMds=false` is required for any property without an MDS widget — otherwise
it is dropped silently, which is the same failure mode again.

---

## 3a. Full text — mostly NOT a write operation (measured 2026-07-31)

Domain context from the user: WLO records are normally **metadata only** — the
material itself lives elsewhere. Full text is a by-product of crawling, and
having it makes the actual content reachable and reusable.

Measured against a live staging record (a link to `tutory.de`, i.e. no binary
content of its own):

| Step | Result |
|---|---|
| metadata before | no `ccm:fulltext_*` property at all |
| `GET …/textContent` | `200`, 1941 characters of real extracted text |
| metadata after | new property `ccm:fulltext_status = ["CONTENT_AVAILABLE"]` |
| `GET …/textContent` again | `200`, 235 ms, identical text — served from the cache |

**The read endpoint is the extraction trigger.** For material the repository can
process, "erschließen" needs no write at all: calling `GET /textContent` makes
the repository extract, cache and track the text itself. That is dramatically
cheaper and safer than us storing text — no rights transfer, no node mutation,
no version churn.

That leaves `POST /textContent` needed only where the repository cannot extract
— precisely the gap the project's external extraction service already fills
(measured 2026-07-28: the repository's own `/textContent` covered 29 of 32
sampled records; the remaining 3 are the case in question).

**Still unknown, and the one real write-side question:** what `POST /textContent`
does to a *link* record. Its summary says "change content of node as text",
which on a node whose whole purpose is `ccm:wwwurl` may create binary content it
never had. This needs one controlled write on a throwaway node.

**MDS membership, checked directly (it decides the write route):**

| Property | In `mds_oeh`? | Consequence |
|---|---|---|
| `ccm:oeh_lrt` | **yes** | `PUT /metadata` works |
| `ccm:oeh_lrt_aggregated` | **yes** | `PUT /metadata` works |
| `ccm:fulltext_content` | no | `PUT /metadata` would silently drop it |
| `ccm:fulltext_status` | no | read-only state, not ours to set |
| `ccm:oeh_collection_compendium_text` | no | must use `POST …/property` (§4) |

### Decision on rights (user, 2026-07-31) — deliberately deferred

Storing the full text of an externally linked page inside WLO is a different act
from linking to it, so the question was raised: should stored full text be gated
on the record's license?

**Decided: no gate for now.** WLO already has read use cases for full text that
are not prohibited, so the capability is allowed to proceed unrestricted. Any
narrowing comes later.

> **Revisit before this reaches production use.** This is a conscious deferral,
> not an oversight — recorded here so it is found rather than rediscovered. If a
> license gate is added later it belongs at the point where text is *stored*
> (`POST /textContent` and any property write), not at the point where it is
> read: reading is what is already established as unproblematic.

---

## 4. Compendium texts — the one route that is not obvious

`ccm:oeh_collection_compendium_text` (Markdown; on collections and on `ccm:io`)
is **not in the MDS**. `PUT /metadata` answers `200` and stores nothing. The
working route is the property endpoint:

```
POST /node/v1/nodes/-home-/{id}/property?property=ccm:oeh_collection_compendium_text
Body: ["<markdown>"]        (null deletes)
→ then read back and compare
```

Whether a property is in the MDS is answerable: `GET /mds/v1/metadatasets/-home-/mds_oeh`.

---

## 5. Vocabularies — measured, and the repo is not aligned

The four vocabularies named in the order, counted from the live JSON
(SKOS: `hasTopConcept`, optional `narrower`, `prefLabel` keyed by language,
optional `altLabel`):

| Vocabulary | Live concepts | In `src/vocabs.ts` | Gap |
|---|---|---|---|
| `educationalContext` | 12 | 12 | — |
| `discipline` | 70 | 70 | — |
| `intendedEndUserRole` | 7 | 7 | — |
| `new_lrt` | **220** (8 top, hierarchical) | **0** | the repo does not carry this vocabulary at all |
| `new_lrt_aggregated` (used by the repo instead) | 48 | 40 | 8 missing |

`new_lrt` and `new_lrt_aggregated` are **different axes**, not versions of one
another: the aggregated one is a flat list of media types (Bild, Video, Audio,
Interaktives Medium …), the other a hierarchy of educational object types
(Quelle, Bildungsangebot, Methode, Tool, Material …).

A live probe of real staging nodes shows **three** LRT properties carried at once:

```
ccm:oeh_lrt                      → …/vocabs/new_lrt/<uuid>
ccm:oeh_lrt_aggregated           → …/vocabs/new_lrt_aggregated/<uuid>
ccm:educationallearningresourcetype → …/vocabs/learningResourceType/<slug>
```

All vocabulary URIs except the last are UUIDs, so a label→URI table is not a
convenience but a requirement for any user-facing choice.

---

### 5.1 The aggregation is derivable — measured, and it settles the LRT question

The field name is confirmed: `ccm:oeh_lrt` carries `new_lrt`,
`ccm:oeh_lrt_aggregated` carries `new_lrt_aggregated`.

**The mapping is published in the vocabulary itself.** 214 of the 220 `new_lrt`
concepts point at exactly one aggregated concept — `broadMatch` (153),
`relatedMatch` (58), `exactMatch` (3). **No concept has more than one target**,
so the mapping is unambiguous. Six upper-level terms carry no mapping at all
(Material, Dokumente und textbasierte Inhalte, Anleitung, Weiteres Material,
Unterrichtsplanung, Lehr- und Lernmaterial).

**Real nodes behave exactly as a derivation would.** Across 400 sampled staging
nodes:

```
both = 337   full-only = 30   aggregated-only = 0   no LRT = 33
vocabulary prediction (earlier 300-node run): 506 correct, 0 wrong, 0 extra
```

An earlier 300-node sample reported `full-only = 0`; that was luck of the
queries, and the corrected figure is **better** evidence, because the exceptions
are explained rather than absent. Every one of the 30 full-only nodes carries
`new_lrt/7381f17f…` = **"Unterrichtsplanung"** — one of the six concepts the
vocabulary maps to nothing. So:

- aggregated is present whenever the source concept has a mapping,
- aggregated is absent exactly where the vocabulary offers none,
- aggregated **never** appears without a full value (0 of 400).

**Consequence worth knowing:** material tagged only with one of those six
upper-level concepts cannot carry an aggregated value at all — and is therefore
invisible to aggregated-based search facets. If an authoring tool offers those
six, it should say so.

This is strong evidence that the aggregated field is derived rather than
authored — but it does **not** establish *when* (write time, a pipeline, or the
crawler). The design does not need that answer:

> **Author `ccm:oeh_lrt`, then read back and see whether
> `ccm:oeh_lrt_aggregated` appeared.** If it did, the repository derives it. If
> it did not, compute it from the vocabulary mapping and write it too.

The read-back is required anyway (§2), so the safety step doubles as the
capability probe — per repository, at runtime, without depending on backend
internals. The six unmapped concepts need an explicit rule: if the user picks
one, no aggregated value can be derived.

**Decision (user, 2026-07-31):** search keeps using the aggregated vocabulary —
coarser buckets are easier for a model to judge and cheaper to query. The full
vocabulary is for *authoring*.

---

## 5a. Controlled writes on staging (2026-07-31) — the remaining questions, answered

Authorised by the user. One throwaway `ccm:io` node
(`de81d9a7-84d5-4a2b-81d9-a784d5da2b99`) created in the **`-userhome-` of the
service account**, deliberately NOT in the shared inbox and with **no workflow
started** — both would have put test noise into the editorial queue, which
`wlo-inbox-pattern` warns against. Deleted afterwards (see 7).

**1. The title is silently overwritten at create time.** Sent
`cclom:title = ["ZZZ TESTKNOTEN …"]`, read back
`"example.org/wlo-mcp-write-probe-2026-07-31"` — derived from `ccm:wwwurl`. The
metadata step afterwards sets it correctly. **So the title must be written in
step 4, not at create.** Not mentioned in the sibling documentation.

**2. MDS filtering: confirmed exactly as documented.** `cm:latitude` with
`obeyMds=true` → HTTP `200`, value absent. With `obeyMds=false` → stored.

**3. Aspects: the explicit step was NOT required for either field.**
- `ccm:lifecyclecontributer_author` wrote fine with **no** `cm:author` aspect —
  `ccm:io` already carries `cclom:lifecycle` by default.
- `cm:geographic` **appeared by itself** when `cm:latitude` was written with
  `obeyMds=false`; the repository added it.

  The sibling project's aspect step is harmless, but it is not the prerequisite
  it is described as — at least not for these two fields on `ccm:io`. Do not
  build it as a hard gate; let the read-back decide.

**4. `POST /textContent` on a link record — resolved, and my first reading of it
was wrong.**

Three body formats were tried on a fresh node (raw text, `{"text":…}`,
`{"text":…,"status":…}`). All three: HTTP `200`, `cclom:size` exactly equal to
the bytes sent, and `GET …/textContent` → `{"text": null}`. So the body is
stored **verbatim** whatever its shape — the format was never the issue. (The
user's hypothesis that a structured JSON with the crawler status is expected is
not borne out, but testing it is what produced the answer below.)

The deciding test: set the node's `ccm:wwwurl` to a **real, reachable** page
(`de.wikipedia.org/wiki/Photosynthese`) and force extraction.

```
GET …/textContent?forceUpdate=true  → 101 125 characters of the actual article
ccm:fulltext_status                 → CONTENT_AVAILABLE
cclom:size                          → 92   (the text I had POSTed — ignored)
```

**Extraction is URL-driven, not content-driven.** The transform service fetches
`ccm:wwwurl`; the bytes stored by `POST /textContent` are never read.

This corrects an earlier conclusion in this document: the
`TRANSFORM_ERROR_EXTERNAL` seen on the first test node was caused by its dead
`example.org` URL, **not** by the `POST`. The POST is not destructive — it is
simply pointless for a link record.

**Consequences for the design, and they are good ones:**
- "Erschließen" works for newly created records too: set a correct
  `ccm:wwwurl`, call `GET …/textContent?forceUpdate=true`, and the repository
  crawls, extracts and caches by itself. No write, no rights transfer.
- `POST /textContent` should not be used for link records at all.
- The remaining gap is narrow: text produced by *our* external extraction
  service for records the repository cannot crawl has no proven storage route.

**5. Versioning.** After create + three metadata POSTs + one textContent POST the
node had **5 versions**. `POST /metadata` creates one every time. A
conversational editor doing a POST per edit would produce version spam — use
`PUT` while drafting and `POST` only when the user commits.

**6. Suggestions, comments and ratings are reachable on staging** — `GET`
returned `200` with `{"suggestions":{}}`, `{"comments":[]}` and `[]`
respectively. Read paths work; the write paths remain untested.

**7. Delete, and why it must be treated as irreversible.**
`DELETE …/{node}?recycle=true` → `200`, node `404` through the normal API. The
`recycle` flag decides whether a delete is recoverable and must always be set
explicitly, never left to a default. `POST /archive/v1/restore/{repo}` exists.

But **the archive search could not be relied on**:

```
directly after deleting node 1:  /archive/v1/search/-home-             → 0 entries
                                 /archive/v1/search/-home-/*/<person>  → 3 entries, node found
after deleting node 2 (minutes later, same query):                     → 0 entries,
                                 and node 1 was no longer found either
```

So the unscoped query never finds anything, and the person-scoped query returned
the node once and then stopped returning it — including the node it had found
before. Whatever the cause (index lag, eventual consistency), **a tool cannot
demonstrate recoverability at the moment of deletion.**

Therefore: require confirmation before every delete, state plainly that it may
not be undoable, and never promise a restore that cannot be verified.

## 5b. Social features — learned from the Ideendatenbank (2026-07-31)

The user pointed at a sibling app that uses comments and ratings in production
(`ideendatenbank`, `backend/app/edu_sharing.py` plus its local
`wlo-engagement-api` skill). Three constraints matter for this design, and two
of them were wrong in our own global skill.

**1. Comments and ratings work ONLY on `ccm:io`.** On a collection (`ccm:map`)
the server answers `500` — hardcoded in the Java, not a configuration:
`Ratings only supported for nodes of type ccm:io` /
`Association ccm:map_comment has not been defined in the model`. The order asks
for social features to be "considered"; this is the answer to that question —
**a collection cannot be commented on or rated.** The established pattern is a
collection as container plus one `ccm:io` carrying the social features.

**2. `PUT /rating…?rating=N` returns `500` on production and stores anyway.**
Message: `config.values.rating is null`. Exactly that text must be treated as
success — not every `500`. Afterwards read the rating back from the metadata to
confirm. `DELETE` has its own bug (returns `500`, the rating stays); the working
way to withdraw a rating is `PUT …?rating=0`.

**3. Two body conventions that are not interchangeable**, both sent with
`Content-Type: application/json`:

| Endpoint | Body |
|---|---|
| `PUT /comment/…/{node}` | **raw UTF-8 text** — `JSON.stringify` would store the quotes literally |
| `PUT /rating/…/{node}` | a **JSON-quoted** string; `" "` suffices, the content is ignored |

The comment app even carries a repair heuristic on read for records written
before that was understood. This is the same server behaviour measured on
`/textContent` (§5a.4) — the body is stored verbatim, whatever it is.

**Corrections made to the global skill `wlo-comments-ratings`:** it documented
`POST /rating/v1/ratings/…?rating=4.5`. Verified against the staging OpenAPI:
the path exposes only `PUT` and `DELETE` — `POST` answers `405` — and a value
serialised as `4.0` instead of `4` is discarded. Code written from that skill
would have failed silently on both counts.

---

---

## 6. What is still open

Everything that blocked planning is now answered (§5a). What remains is a
decision, not a discovery:

1. **Where does full text go for records the repository cannot crawl?**
   Extraction is URL-driven and works for anything reachable — including newly
   created records — so this gap is narrow: it is only the records whose URL the
   repository fails on, where *our* external extraction service could still
   produce text. That text has **no proven storage route** (`POST /textContent`
   is written but never read back). Options: a property via `POST …/property`
   with a chosen name, or accept that those records keep no repository-side
   text. A product decision, not a technical unknown.
2. **Versioning policy** — `PUT` while drafting vs `POST` on commit (§5a.5).
3. **Write paths of suggestions / comments / ratings** — read paths confirmed
   reachable, writes untested.
4. **Which fields a curation tool may set at all.** The sibling project filters
   by a `repo_field` flag from its own schemas; we have no equivalent and need
   an explicit allow-list, or we inherit the risk of writing whatever a model
   proposes.

## 6a. Requirements set by the user (2026-07-31) — and what the protocol offers

### Confirmation before anything destructive
Delete, change and overwrite must ask the user first. Three mechanisms exist and
they are not interchangeable:

1. **Tool annotations** (`destructiveHint`, `readOnlyHint`, `idempotentHint`) —
   present in the SDK and already used by this server. They are *hints*: a host
   MAY prompt. Necessary, not sufficient.
2. **`server.elicitInput(...)`** — verified present in SDK 1.30. The server asks
   the user directly through the host's own UI, so the question cannot be
   paraphrased away by the model. This is the right primary mechanism, but it
   depends on the client declaring the `elicitation` capability, so it needs a
   capability check.
3. **Two-step tool protocol** — a `preview` call returns exactly what would
   change plus a token; a `commit` call requires that token. Works on every
   host, including those without elicitation, and gives the model something
   concrete to show. This is the fallback, and probably the floor for deletes.

A preview must state the change *concretely* (old value → new value, which node,
which collection), never "I will update the metadata".

### Write tools are gated on the auth mode
| Mode | Write tools |
|---|---|
| anonymous | **not offered at all** |
| service account (env) | offered only when an explicit env flag enables it |
| per-user login | always offered |

Feasible without restructuring: `credentialFromHeader` already resolves the
caller at `http-app.ts:107`, *before* `createMcpServer()` at line 164, so the
factory can take the resolved mode and register conditionally. (That ordering
exists by accident — it came from the credential-stuffing guard added earlier
the same day.)

**But a varying tool list has a consequence that must be designed for:** hosts
cache the tool list. A client that connects anonymously caches a list without
write tools, and adding credentials later may not refresh it — this project has
already been bitten by exactly that (the ChatGPT descriptor sync lag). So:

- conditional registration keeps write tools out of an anonymous listing, **and**
- every write tool re-checks the credential at call time and refuses with a
  clear message. A cached list can lie; the call-time check cannot be bypassed.

The service-account flag deserves care: in that mode every user of the server
shares one identity, so an edit is attributable only to the account, not the
person. Off by default is the right default.

---

## 7. Risks visible already

- **Silent no-op writes** (MDS filtering, missing rights) — mitigated only by
  read-back; must be built in from the first tool, not added later.
- **A model editing live curated content.** Every mutating tool needs an
  explicit user confirmation step and an exact statement of what will change.
  `readOnlyHint: false` and a destructive hint belong on these tools.
- **Deletion is the highest-stakes operation here** and the one most easily
  triggered by a misread instruction.
- **Prompt injection gains teeth.** Until now injected text could only mislead a
  reader; with write tools it could cause a mutation. Content flowing from the
  repository into the model must stay sanitized, and no tool may act on
  instructions found in fetched content.
- **Per-repository feature drift** (ideas database, comments, ratings) — probe
  capability rather than assume it.

---

## 8. Suggested next step

A planning pass (`/better-coding-plan`) that resolves questions 1–8 first —
several need one controlled write on staging, which needs your go-ahead and a
throwaway test node. Until then any task breakdown would rest on assumptions,
and the two most consequential unknowns (LRT authoring, textContent semantics)
are exactly the kind that look harmless and turn out not to be.

---

## 8. Suggestions — the write paths, measured (2026-08-01)

Probed live against **staging** with the `WLO-Upload` service account, on three
throwaway `ccm:io` nodes created and deleted (`recycle=true`) by the probe
itself. This closes the gap that blocked Phase 6: the endpoint shapes were known
from the OpenAPI, the write paths were not.

| Step | Request | Result |
|---|---|---|
| store | `POST /suggestions/v1/-home-/{node}?type=AI&version=probe-1`, body = **array** of `CreateSuggestionRequestDTO` | `200`, returns the stored suggestions with server-generated ids and `status: PENDING` |
| read | `GET /suggestions/v1/-home-/{node}` | `200` |
| accept | `PATCH /suggestions/v1/-home-/{node}?id={id}&status=ACCEPTED` | `200`, and the read-back shows `status: ACCEPTED` — the status really changes |

### Two findings that matter for the implementation

**1. POST and GET are asymmetric.** The POST answers with an *array* of
suggestions. The GET answers with a *map keyed by propertyId*:

```json
{"nodeId": "…", "suggestions": {"cclom:general_description": [ {…}, … ]}}
```

Code that reads the GET as an array finds nothing and reports "no suggestions"
for a node that has them. (This bit the probe itself on its first run.)

**2. Accepting a suggestion does NOT write the value onto the node.** After
`status: ACCEPTED`, the node's `cclom:general_description` was still absent.

That is the design-relevant one. `/suggestions/v1` is a **staging area for
proposals plus a record of the decision** — not a mechanism that applies them.
So a curation flow built on it is:

```
propose  → POST   (status PENDING)
show     → GET    (map by property!)
decide   → PATCH  (status ACCEPTED / DECLINED — decision recorded)
apply    → our own updateNodeMetadata + read-back        ← still ours to do
```

A tool that accepted a suggestion and reported success would be reporting a
recorded decision as a changed record. The application step and its read-back
stay exactly as mandatory as everywhere else in this design.

**Not probed:** `DELETE …?version=`, `…/raw`, `type=USER_PROPOSAL`, and whether
a non-service identity may PATCH someone else's suggestion.

---

## 9. Collections — the create/rename bodies, measured (2026-08-02)

Found by running the tools against **staging** with the `WLO-Upload` service
account, not by reading the API. The shape we had was inferred and wrong in
three ways; each failure mode is different, and two of them are silent.

`POST /collection/v1/collections/-home-/{parent}/children` — body is a `Node`
DTO (per the live OpenAPI: required `access, createdAt, createdBy, name, owner,
ref`, though only some are enforced).

| Body sent | Result |
|---|---|
| `{properties:{cm:title}, collection:{type}}` | **500** `NullPointerException: cmNameReadableName is null` |
| `{name, collection:{type}}` | **500**, same |
| `{title, ...}` without `collection` | **500** `NodeRef.getId()` on null |
| `{title, properties:{cm:title}, collection:{type}}` | **200** |

So the top-level **`title`** is what the endpoint derives the node name from —
`properties['cm:title']` alone is not read for that purpose, however plausible
it looks. `collection` must be present too.

`PUT /collection/v1/collections/-home-/{id}` — needs **`ref: {id, repo}` in the
body**, even though the id is already in the path. Without it: `500
NullPointerException: NodeRef.getId()`. The DTO is read, not the URL.

**`cm:description` is discarded on both routes.** The call answers `200` and the
property is absent on read-back — a fourth instance of the silent-drop pattern
this design exists for. Measured working routes for it:

| Route | Result |
|---|---|
| collection `POST`/`PUT` body `properties['cm:description']` | 200, **not stored** |
| `POST /node/v1/nodes/-home-/{id}/property?property=cm:description` | 200, stored |
| `PUT /node/v1/nodes/-home-/{id}/metadata?obeyMds=false` | 200, stored |

`cm:title` DOES land through the collection route, so only the description
needs the second call.

**Also observed, not fixed:** a client-side timeout on `wlo_create_content` left
the record created upstream while the tool reported a failure. The abort hits the
response, not the work. A retry is safe — the duplicate check finds the record
and names it — but the first reply says "konnte nicht angelegt werden" about a
record that exists. Staging needs well over the 10 s default; the probe used 60 s.

---

## 10. Submitting for review — measured (2026-08-02)

The last unverified write path. Run against **staging** with `WLO-Upload` on
throwaway records, created and deleted by the probe.

`PUT /node/v1/nodes/-home-/{node}/workflow` with
`{receiver:[{authorityName:'GROUP_ORG_WLO-Uploadmanager'}], status:'200_tocheck', comment}`
→ `200`, and the submission is real.

The receiver group exists on staging under both spellings:
`GROUP_ORG_WLO-Uploadmanager` and `ORG_WLO-Uploadmanager` resolve to the same
`EDITORIAL` group ("WLO-Uploadmanager"). Our hard-coded value is the correct one.

**What the record carries afterwards** — this is the part that mattered, because
it makes the submission verifiable:

| Property | Value after submitting |
|---|---|
| `ccm:wf_status` | `200_tocheck` |
| `ccm:wf_receiver` | `GROUP_ORG_WLO-Uploadmanager` |
| `ccm:wf_instructions` | the comment |
| `ccm:wf_protocol` | JSON: editor, receiver, comment, time, status |

`GET …/workflow` returns a history array with `status`, `comment` and the fully
expanded `receiver` group.

**Control:** a record created and NOT submitted has `ccm:wf_status: undefined`.
So "submitted" and "not submitted" are distinguishable by reading the record —
which is why `submitForReview` now reads back instead of trusting the `200`.
