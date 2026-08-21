# Architecture

How the WLO MCP server is put together, and which rules a change has to respect.
Written for developers who will modify it. For *using* the server (tools,
parameters, env keys) see [`MCP-REFERENZ.md`](MCP-REFERENZ.md); for the
contribution process see [`../CONTRIBUTING.md`](../CONTRIBUTING.md).

---

## 1. What it is

A long-lived Node process that exposes the OER holdings of
[WirLernenOnline](https://wirlernenonline.de) — an [edu-sharing](https://edu-sharing.com)
repository — to AI agents over the Model Context Protocol: search, collections,
topic pages, full texts, curated AI skills, and (after login) writing.

Three properties shape every design decision in here:

- **It is a translator, not a store.** The server holds no database. Everything
  it answers comes from edu-sharing's REST API on the fly. The one exception is
  an in-memory cache (§9) and one small file on disk (§8).
- **It is anonymous by default.** A request without `Authorization` gets `200`
  and the full tool list. Reading works without a credential; writing is refused
  at call time, not by hiding the tool.
- **It is a long-lived process.** There is no serverless target — the Vercel
  entry point was removed on 2026-08-02. Do not reason about cold starts or
  per-request statelessness as platform constraints.

**Stack:** TypeScript (ESM, NodeNext, `strict`), Node ≥ 20.12. Two runtime
dependencies on purpose: `@modelcontextprotocol/sdk` and `zod`. No web
framework — the HTTP layer is `node:http` plus a router of our own.

---

## 2. Entry points and transports

`src/server.ts` exports `createMcpServer({ issuer })` — a transport-agnostic
factory that wires up every tool. It takes no credential and no write mode:
**all tools are registered unconditionally**, and authorisation happens when a
tool is *called*.

Two thin entry points connect a transport to it:

| File | Transport | Used for |
|---|---|---|
| `src/stdio.ts` | stdio | local development, `npm run dev` |
| `src/http.ts` | Streamable HTTP (+ SSE) | **the production path**, Docker on the vServer |

`src/http.ts` owns everything a network-facing process needs and the factory
must not know about: port binding, rate limits, body caps, proxy trust, the
credential limiter, and starting the skill-registry cache. `src/http-app.ts`
holds the request handler and route table; `src/rest/*` the non-MCP endpoints.

Registration order in `server.ts` **is** display order in `tools/list`. Moving a
line changes what a model sees first.

---

## 3. Layers and the dependency rule

```
   entry points          stdio.ts · http.ts
        │
   MCP surface           server.ts → tools/*        ← schemas + rendering only
        │                        ↕ apps/*           ← the registration seam, widgets
   domain services       services/*                 ← algorithms, traversals, the write pipeline
        │
   repository clients    wlo-*.ts · topic-page-api.ts · wikipedia-api.ts · text-extraction-api.ts
        │
   leaf utilities        formatter · text-* · vocabs* · node-* · url-safety · concurrency …
```

**The rule: dependencies point downwards, never up.** `services/` and `rest/`
must not import from `tools/`. This is not a convention in a document — it is a
test (`tests/shared-rule-discipline.test.ts`) that scans the source and fails
the build.

The rule has a practical consequence you will meet the first time you extract
something: a helper that started in `tools/shared.ts` and turns out to be needed
by a service has to **move down**, not be imported sideways. Two already did —
`mapPool` (bounded-concurrency fan-out) is in `src/concurrency.ts`, and
`buildFilterCriteria` / `formatUnresolvedHint` in `src/filter-criteria.ts`.

**A tool module holds a schema and a rendering, never an algorithm.** A bounded
traversal a tool would otherwise inline belongs in `services/`
(`collection-traversal.ts`, `topic-page-discovery.ts`).

---

## 4. Directory map

| Path | Responsibility |
|---|---|
| `src/server.ts` | the factory; the only place tools are assembled |
| `src/stdio.ts`, `src/http.ts` | transports |
| `src/http-app.ts`, `src/rest/*` | HTTP routing, REST endpoints, auth/OAuth pages |
| `src/tools/*` (29 files) | one module per tool group; schema + rendering |
| `src/tools/shared.ts` | tool-layer helpers (`toolError`, `queryMetaContent`, `subjectRegistryText`) |
| `src/tools/curation-shared.ts` | `registerCurationTool` — the write gate every curation tool passes |
| `src/services/*` (23 files) | search, traversal, skills, compendium, collection search |
| `src/services/write/*` (15 files) | the shared write pipeline (§7) |
| `src/auth/*` (13 files) | access blocks, OAuth 2.1, ticket exchange, identity |
| `src/apps/*` | the Apps-SDK seam: `register.ts`, `outputSchemas.ts`, `resources.ts`, `widgets/` |
| `src/wlo-api.ts` | barrel over the edu-sharing client |
| `src/wlo-fetch.ts` | **the credential boundary** — the only place a password is attached |
| `src/formatter.ts` | node → Markdown / JSON rendering |
| `docs/plans/` | design documents and `STATUS.md`, the live progress tracker |

---

## 5. The tool layer

### Anatomy

Each group exports `register<Area>Tool(s)(server, …)` and is called from
`server.ts`. A tool is declared through **one seam**, `registerWloTool`
(`src/apps/register.ts`):

```ts
registerWloTool(server, {
  name: 'get_collection_stats',
  title: 'WLO Sammlungsstatistik',
  description: '…',                      // German: the model and end users read it
  inputSchema: { nodeId: z.string()… },  // zod raw shape
  outputSchema: collectionStatsSchema,   // from apps/outputSchemas.ts
  annotations: { readOnlyHint: true },
  widgetUri,                             // optional Apps-SDK widget
  unsafe: { reason: '…' },               // optional: operator-removable
  handler: async (params) => { … },
});
```

The seam is where cross-cutting behaviour lives, which is why nothing may bypass
it: `_meta.securitySchemes`, widget metadata, and the `unsafe` off-switch
(`WLO_DISABLE_UNSAFE_TOOLS`) are applied here, once, for every tool.

### The output contract

Every search tool answers **three things side by side**:

1. a **text block** — Markdown or JSON, per the `outputFormat` parameter
2. **`structuredContent`** — the same envelope as data
3. a trailing **`_queryMeta`** text block — pagination, criteria, `searchUrl`,
   and where applicable `unresolvedFilters` and `facets`

Two traps live here, and both have cost this project real defects:

> **zod strips what is not declared.** A new field on `FormattedNode` or on an
> envelope that is not added to `src/apps/outputSchemas.ts` reaches the text
> output and vanishes from `structuredContent` — with nothing failing. Assert
> the text and the structured content *separately*.

> **Some clients pass only the first content block to the model.** Measured on a
> real client in 2026-08. A second block is therefore not a place for anything
> the model must see: `get_topic_page_content` inlines its skill catalogue into
> block 1 in Markdown mode, and keeps a second block only for JSON, where block
> 1 must stay parseable.

### Rendering rules

A tool that writes its own line-oriented text (browse tree, portal list,
swimlane outline) must pass every repository-supplied value through `oneLine`
from `formatter.ts`. A newline in a title otherwise forges a second record with
a nodeId the next call acts on.

Text that carries **elevated authority** — an instruction reproduced verbatim to
a person, a confirmation preview — goes through `sanitizeText` / `flattenText`
(`src/text-sanitize.ts`) instead, which also drops invisible Unicode.

Server-derived sections (activation lines, file manifests, table of contents)
are rendered **before** an untrusted document, never after: after it they are
indistinguishable from sections the document forged.

---

## 6. Services

Where the algorithms live. Some that carry non-obvious rules:

- **`search.ts`** — `searchAll`, the multi-bucket search behind `search_wlo_all`,
  `search` and the REST layer. Buckets: content, collections, topic pages. A
  Themenseite *is* a `ccm:map`, so the collection result set is split by
  `topicPageUrl`.
- **`collection-search.ts`** — the one module that knows the repository answers
  "which collections match this word?" through **two unrelated indexes**, neither
  a superset of the other. Three call sites go through it.
- **`skill-registry.ts` / `skill-registry-cache.ts`** — which skills a collection
  approves (§9).
- **`compendium.ts` / `compendium-view.ts`** — editorial prose per collection,
  with a table of contents and BM25-ranked passages (`src/text-bm25.ts`).
- **`write/*`** — the write pipeline (§7). No MCP SDK import anywhere in it, so
  the safety properties are tested once instead of per tool.

---

## 7. The write pipeline

Fourteen curation tools share one path. Every one of them is registered through
`registerCurationTool` (`tools/curation-shared.ts`) — the single place that
stamps the `oauth2` security scheme and runs the gate.

```
call
 └─ credential gate          refuse at call time, with a WWW-Authenticate challenge
 └─ resolve write target     a reference redirects to its ORIGINAL (services/write/nodes.ts)
 └─ read baseline           …from the node that will actually be written
 └─ build change set        diff; unchanged fields drop out; vocab values get labels
 └─ preview + confirm token  bound to a fingerprint of exactly that change set
 └─ write
 └─ read back               edu-sharing has three ways to discard a write and answer 200
```

Six rules bind any change here, and each exists because it was violated once:

1. **Every write reads back.** A `200` is not proof that anything was stored.
2. **Every mutation is confirmed in two steps**, and *everything the call will
   send* must be in the previewed change set — the token binds to a fingerprint
   of it. Free text beside the change set is an approval for text nobody saw.
3. **Write tools refuse at call time and are listed for everyone.** Hiding them
   was the reason logins never started: a model that never sees a write tool
   never calls one, so nothing ever asks the host to authenticate.
4. **`ccm:oeh_lrt_aggregated` is never written by us** — the repository derives it.
5. **Accepting a suggestion writes and reads back *before* marking it accepted.**
6. **An aborted request is an open outcome, never a failure** — the abort hits
   the response, not the work. Every curation `catch` goes through
   `timeoutOrError`.

Two more that came out of live measurement:

- **Redirection to the original happens at the tool entry, not inside the write
  call.** The confirm token binds to the preview, so the target must be fixed
  before writing. The redirect is part of the change set (`redirectedFrom`) and
  the first line of the preview.
- **The baseline travels with the target.** Tools call `readWriteBaseline`, not
  `resolveWriteTarget` — diffing against the wrong node reports success for a
  write the original never received.

> **A test against `fetchMock` proves the code sends what we decided to send,
> never that the repository accepts it.** Two curation tools were green in every
> unit test and had never worked. That gap is what `tests/live/*` exists for
> (§11).

---

## 8. Authentication

Reading is anonymous. Writing needs an identity, and there are four ways to get
one — all documented in [`AUTH.md`](AUTH.md):

| Mechanism | For |
|---|---|
| `Basic` | scripts, development |
| **Access block** (`wlo2.…` as `Bearer`) | hosts with a header field; the password is encrypted **in the browser** at `/auth` |
| **OAuth 2.1** | hosts without one (the ChatGPT connector); open registration, PKCE required |
| **Ticket exchange** (`POST /auth/ticket`) | widgets embedded in edu-sharing pages |

The measurement that closed every other option: edu-sharing offers no OIDC
discovery, no DCR, and declares only `basicAuth`/`cookieAuth` — **there is no
token to relay**, so any scheme carries the credential itself. The access block
is the answer: encrypted so it is useless anywhere except against this server.

The OAuth access token **is** the access block. That is the only reason one
revocation ends both ways in — do not wrap it in a second credential.

Two invariants:

- **`src/wlo-fetch.ts` is the only place a credential is attached**, and only
  ever to the repository host.
- **`auth/access-registry.ts` is the only module that writes to disk at
  runtime** — enforced by a test. It is an allow-list of ids, never credentials,
  which is why the container can run `read_only: true` with a single writable
  volume.

---

## 9. Caching

One cache: `services/skill-registry-cache.ts`, which lets every collection
answer carry its catalogue of approved skills for free.

Its design rests on an **asymmetry** that is easy to break and hard to notice:

> A **negative** may only come from the children listing; the index may only
> produce a **positive**.

A corpus hit is a record the index handed over, so "this collection HAS a
registry" rests on evidence. *Absence* from the index rests on a gap nobody can
see — a record can fall out of the index while sitting in the node store. So a
collection the corpus does not name stays UNKNOWN, and a listing answers it.

The same asymmetry applies inside the refresh tick: only a lookup that
*answered* is remembered. A throw is remembered as nothing and re-queued, or an
outage becomes a statement.

Three bounds: the live fallback is capped per request (`LIVE_FALLBACK_MAX = 10`,
pooled across buckets); there is **no pre-built index of the tree** (a full walk
is ~1700 collections / ~3400 requests per cycle — the queue is bounded by real
usage instead); and the cache is started **only from the transports**, never at
module load, or a timer fires in every test.

---

## 10. Widgets (Apps SDK)

Four vanilla-TS widgets in `src/apps/widgets/`, bundled by esbuild
(`build.mjs`) into `dist-widgets/` and served as `ui://` resources. They are
attached to tools via `_meta` in the registration seam.

The resource URI is **content-addressed** over HTML *and* metadata, so a pure
configuration change cannot get stuck in a stale host cache. `registerWidgets`
degrades gracefully when `dist-widgets/` is absent — tests and a build without
`build:widgets` simply get tools without widget metadata.

---

## 11. Testing

```bash
npm test                 # 196 files, ~2160 tests — node:test via tsx
npm run test:coverage    # same, with the runner's coverage report
npm run test:live        # tests/live/* — REAL repository, staging only
node --import tsx --test tests/reranker.test.ts     # a single file
```

`npm test` goes through `scripts/run-tests.mjs`, which expands the file list
itself: Node 20 takes a `--test "tests/*.test.ts"` glob literally and runs
nothing, and 20 is what `engines` and the Docker image ship.

**Three mechanisms are worth knowing:**

- **`tests/fetchMock.ts`** — the only boundary that is mocked. No live network.
- **`tests/netguard.mjs`** — loaded by `npm test`, fails the run on any unmocked
  non-loopback fetch, so a test that forgets `installFetchMock` is caught instead
  of silently going upstream. A single-file run has no such guard.
- **`tests/live/*`** — write-contract tests against a real repository, staging
  only (enforced in the test file), needs the service credential, never part of
  `npm test` or CI. It exists because the offline suite cannot prove the
  repository *accepts* what we send.

### Architecture tests

`tests/shared-rule-discipline.test.ts` and `tests/env-parsing-discipline.test.ts`
scan the **source** for rules a unit test cannot see: that a rule extracted into
a shared module is actually the only copy. Every audit round of this project has
turned up the same shape — a rule identified, solved in one place, and then not
carried to the other places it applies to.

Among the 23 rules they enforce: the truncation marker is written in exactly
one module; upstream bodies are parsed only through `readJson`; the access
registry is the only runtime disk writer; services and REST do not import from
tools; every curation tool goes through the gating seam; a rendered `nodeId:`
line goes through `nodeIdLine`; a page variant is projected in exactly one
place; a collection search asks both backends from one module.

**When you add a guard, prove it red.** Inject the violation, watch the test
fail, then restore. A guard that was never red is not a guard — one of them sat
green over a live violation because of one backslash too many in a regex.

---

## 12. Build, run, deploy

```bash
npm run dev          # stdio, tsx, no build step
npm run dev:http     # HTTP on PORT
npm run build        # tsc → dist/ plus the widget bundle
npm start            # built stdio
npm run start:http   # built HTTP — the production command
npm run lint         # ESLint, correctness rules only (gated in CI)
npm run typecheck    # tsc -p tsconfig.typecheck.json
```

Deployment is Docker on a vServer behind a TLS-terminating proxy; see
[`DEPLOYMENT.md`](DEPLOYMENT.md). Configuration is env-only, never secrets in
code — [`.env.example`](../.env.example) is the annotated template, and
[`MCP-REFERENZ.md`](MCP-REFERENZ.md) §3 lists the on/off switches.

> Two env keys have **opposite** defaults in code and in `docker-compose.yml`
> (`WLO_DISABLE_UNSAFE_TOOLS`, `TRUST_PROXY`). The container value is what an
> installation gets. A variable that compose does not pass through by name never
> reaches the container at all — set, ineffective, and nothing is logged.

---

## 13. Adding a tool

1. Decide the module. A new tool usually belongs in an existing
   `src/tools/<area>.ts`; a genuinely new responsibility gets its own file.
2. Put the algorithm in `services/`, not in the tool. The tool holds the schema
   and the rendering.
3. Declare the output schema in `src/apps/outputSchemas.ts` — **every field**,
   or zod strips it from `structuredContent`.
4. Register via `registerWloTool`. Never call `server.tool` / `registerTool`
   directly; a curation tool goes through `registerCurationTool` instead
   (enforced by a test).
5. Write the description in German, and delimit it against its neighbours: a
   description is the only thing a model has when choosing between two similar
   tools. `tests/tool-descriptions.test.ts` pins those contracts.
6. Add it to `server.ts` at the position it should occupy in `tools/list`.
7. Tests first: red, then green. Assert the Markdown output *and*
   `structuredContent` separately.
8. Update `README.md` / `README.de.md`, `docs/TOOLS.md`,
   `docs/MCP-REFERENZ.md`, and `CHANGELOG.md` in the same change.
   `tests/docs-claims.test.ts` checks documented counts against the code.

---

## 14. Constraints that came from measurement

These are not opinions, and re-deriving them from first principles will produce
the wrong answer. Each is measured; if you must contradict one, **measure
again** first. The full evidence is in `docs/plans/`, and `CLAUDE.md` carries
the condensed list.

- **`ccm:commonlicense_key` matches a licence FAMILY, not a licence.** `CC_BY`
  returns CC BY-ND and CC BY-NC-ND too, and the surplus is *more* restrictive
  than requested. Exactness is enforced locally (`filter-criteria.ts`).
- **The OER bundle fans out over four keys and merges round-robin.**
  Concatenating hands the whole cap to the first key; a single upstream
  criterion answered "no hits" over 18 793 records.
- **A facet total is discarded when the bucket list is full** — a possibly
  truncated sum understates the corpus while looking exact.
- **Which variant a topic page renders comes from `ccm:page_config`**, not from
  child order, and target-group filtering is **local**: ~90 % of variants carry
  no target group, so an upstream filter hides pages instead of narrowing them.
- **`/children` carries `ccm:oeh_extendedType` only when the request asks for
  it** — the same node, the same call, empty under the default projection.
- **`skipCount` beyond ~10 000 answers HTTP 500**, and `facetLimit` is not a
  bucket ceiling (the server returns up to 5×).
- **`httpServer.requestTimeout` is not a response deadline.** It bounds
  *receiving* the request. Three comments once justified designs with a ceiling
  that does not exist.
- **A write carrying `ccm:wwwurl` needs a 60 s budget**, because the repository
  renders the page (cold: 46.5 s measured).

---

*Last reviewed 2026-08-20 against the source. When a section here stops matching
the code, the code is right — fix the section.*
