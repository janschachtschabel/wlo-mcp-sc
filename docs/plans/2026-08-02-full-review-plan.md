# Full-Codebase Review — Plan & Progress

A layer-by-layer review of the entire server before upload/deploy. Twelve
packages, reviewed in dependency order (inward → outward), each with
`/better-coding-review`. This file is both the plan and the live tracker: a
fresh context resumes from CLAUDE.md → this file.

**Scope:** ~15.4k lines of production TypeScript in `src/` + `api/`, plus the
supporting layer (tests, build, deploy, docs). All of it, nothing sampled.

---

## Method (per package)

1. Invoke `/better-coding-review` (skills unload — reload before each package).
2. Read every file in the package in full, plus its tests.
3. Report findings in chat, severity-tagged (CRITICAL / MAJOR / MINOR / NIT),
   each with file:line, the failure scenario, and a fix.
4. **Cross-package impact analysis** — for every CRITICAL/MAJOR, name which
   other packages depend on the defect, and whether the same mistake pattern
   recurs there. A defect found in a shared helper is a defect in every caller.
5. Fix what is confirmed, TDD (red → green), with real command output.
6. Full suite + typecheck + build green → release the next package.

**Reports live in chat only** — no audit/review files are added to the repo
(user rule). This plan file carries only the progress table and the durable
cross-package notes.

**Nothing is committed or pushed.** The user uploads manually.

---

## Ordering rationale

Dependency order, innermost first. A defect in `wlo-config` or `wlo-api`
propagates to everything above it, so finding it early means each later package
is reviewed against already-corrected foundations. The two highest-risk
packages by blast radius are **R5 (write pipeline)** and **R6 (auth)** — if the
review has to be cut short, those two plus R1 are the ones that must happen.

---

## Packages

| # | Package | Files | LOC | Risk lens |
|---|---------|-------|-----|-----------|
| R1 | Foundation & config | `wlo-config`, `logger`, `rate-limit`, `read-body`, `text-sanitize`, `text-distance`, `query-expand`, `node-match` | 837 | secrets, input validation, DoS limits |
| R2 | Upstream API clients | `wlo-api`, `wlo-node`, `wlo-search`, `topic-page-api`, `topic-page-structure`, `wikipedia-api`, `text-extraction-api` | 1075 | SSRF, error propagation, timeouts |
| R3 | Vocabularies & presentation | `vocabs*`, `vocab-suggest`, `formatter`, `reranker` | 1779 | data/URI correctness, output escaping |
| R4 | Read services | `src/services/*.ts` | 1105 | fan-out bounds, N+1, partial failure |
| R5 | Write pipeline ⚠ | `src/services/write/*` | 1504 | the five write rules, read-back, tokens |
| R6 | Auth & credentials ⚠ | `src/auth/*` + gating end-to-end | 264 | credential leakage, per-user isolation |
| R7 | Search & discovery tools | `tools/shared`, `content-search`, `collections`, `topic-pages*`, `topic-page-content`, `browse` | ~2014 | schema/description accuracy, budgets |
| R8 | Detail & auxiliary tools | `tools/node-details`, `node-relations`, `vocabulary`, `compendium`, `wikipedia`, `content-text`, `knowledge`, `collection-stats`, `skills`, `health`, `auth` | ~1242 | same, plus gating |
| R9 | Curation tools | `tools/curation-*` | 1451 | two-step confirm, absent-when-anonymous |
| R10 | Apps-SDK & widgets | `src/apps/**` (+ `/better-coding-frontend`) | 2628 | XSS, a11y, privacy, host bridge |
| R11 | Transport, REST & entry points | `server`, `http`, `http-app`, `stdio`, `mcp-transport`, `src/rest/*` | ~1340 | request handling, headers, rate limit |
| R12 | Supporting layer | `tests/`, `Dockerfile`, `package.json`, `.github/`, `docs/` | — | test honesty, supply chain, doc drift |

---

## Progress

| # | Package | Status | Findings | Notes |
|---|---------|--------|----------|-------|
| R1 | Foundation & config | ✅ done (2026-08-02) | 1 major, 4 minor, 2 nits — all fixed; 1 nit retracted | 863 tests (+17) |
| R2 | Upstream API clients | ✅ done (2026-08-02) | 1 major, 5 minor, 2 nits — all fixed | 887 tests (+24) |
| R3 | Vocabularies & presentation | ✅ done (2026-08-02) | 1 major, 3 minor, 1 nit — all fixed | 900 tests (+8) |
| R4 | Read services | ✅ done (2026-08-02) | 2 major, 4 minor, 1 nit — 5 fixed, 1 deferred (needs a live measurement), 1 retracted | 905 tests (+5) |
| R5 | Write pipeline | ✅ done (2026-08-02) | 1 major, 4 minor, 1 nit — all fixed | 926 tests (+21) |
| R6 | Auth & credentials | ✅ done (2026-08-02) | 4 minor — all fixed | 934 tests (+8) |
| R7 | Search & discovery tools | ✅ done (2026-08-02) | 4 major, 5 minor, 4 nits — all fixed | 944 tests (+10) |
| R8 | Detail & auxiliary tools | ✅ done (2026-08-03) | 8 major, 7 minor, 2 nits — 16 fixed, 1 pushed back | 982 tests (+17) |
| R9 | Curation tools | ✅ done (2026-08-03) | 1 critical, 3 major, 4 minor, 2 nits — 10 fixed, 1 retracted by measurement | 999 tests (+17) |
| R10 | Apps-SDK & widgets | ✅ done (2026-08-03) | 2 major, 1 minor, 2 nits — 5 fixed | 1004 tests (+5) |
| R11 | Transport, REST & entry points | ✅ done (2026-08-03) | 2 major, 2 minor — 4 fixed | 1011 tests (+7) |
| R12 | Supporting layer | ✅ done (2026-08-03) | 3 major, 1 minor, 2 nits — all fixed | 1021 tests (+10, incl. the carry-overs) |

---

## Cross-package notes

Durable observations that affect more than one package. Added as the review
finds them.

- **The binding lesson from the write work:** a test against `fetchMock` proves
  the code sends what we decided to send, never that the repository accepts it.
  Where a package's correctness depends on upstream behaviour, a green test is
  not evidence — say so in the finding rather than treating it as covered.
- **A shared leaf module needs its own tests (R1).** `text-sanitize.ts` had 12+
  callers and a security purpose, but was only exercised indirectly through
  `followUpPrompt`. Those indirect tests covered newlines, C0 characters and the
  length cap and missed every invisible-Unicode class. When a package contains a
  leaf whose whole job is a rule, check for a test file named after it.
- **`sanitizeText` is the elevated-authority boundary, not a general filter
  (R1).** It is applied where foreign text is read as more than data: injected
  user messages (`follow-up.ts`), confirm previews (`change-set.ts`), curation
  replies, the account display name. `formatter.ts` deliberately does NOT use
  it — tool output is data. R3 checks whether anything in that output is in
  practice read as instruction; R10 checks the widget HTML escape path.
  **R3's answer:** that framing held — the text stays data and is still not
  sanitized. The real exposure was the *format*, not the text: see the renderer
  note below.
- **`res.ok` is not "the body is JSON" (R2) — now closed everywhere.**
  Every upstream client parsed with an unguarded `await res.json()`, so a 200
  carrying a proxy error page threw past functions documented to degrade. All
  sites now go through the `src/read-json.ts` leaf, each keeping its own
  contract: search and the two creates report, the "is there anything here"
  readers throw. `auth/identity.ts:45` was checked and needed nothing — its
  parse already sits inside the `try` that carries its "never throws" contract.
  The lesson that outlives the fix: **the pattern was not uniform**, so the
  right response to a repeated defect is reading each site, not a sweep.
- **Split at the seam, not at the line count (2026-08-02).** Three files past
  300 lines were split where a second responsibility had accumulated:
  `tools/collections.ts` and `tools/topic-pages.ts` each mixed a bounded
  traversal/discovery algorithm with MCP wiring (→ `services/*`), and
  `wlo-node.ts` mixed metadata access with text reading, which alone carries a
  byte cap, its own timeout budget and UTF-8 care (→ `wlo-node-text.ts`).
  Deliberately NOT split: `vocabs*.ts` (461/344/334 lines) are lookup tables —
  one responsibility, merely long, and one file per vocabulary is already the
  right structure. `tools/browse.ts`, `tools/content-search.ts` and
  `services/search.ts` (309–343) hold their bulk INSIDE one registration
  function; a cut there would be arbitrary. Re-check them if they gain a
  helper block ahead of the first export, which is the tell the other three had.
- **A line-oriented renderer must protect its own delimiters (R3) — fixed in the
  shared renderer, OPEN in seven tool-local ones.** `formatter.renderToText`
  let a newline inside a repository-supplied value open a second, fabricated
  record with its own `nodeId` and `Lizenz:` line; it now flattens each value to
  the one line the format allots it. **The same pattern recurs**, each with its
  own `## ${title}` interpolation, in `tools/browse.ts:127,319,321`,
  `tools/node-details.ts:136,171`, `tools/topic-pages-present.ts:162`,
  `tools/skills.ts:36`, `tools/node-relations.ts:171`,
  `tools/content-search.ts:308` and `tools/topic-page-content.ts`. They were
  deliberately NOT swept: the sources differ (WLO records, our own curated skills
  collection, the Wikipedia API), and the R2 lesson says a repeated defect is
  read site by site, not patched wholesale. **R7 and R8 must check each of these
  and decide per site** — that is a required item of those packages, not an
  optional one. R10 asks the same question of the widget HTML escape path.
  **R7's answer for its four sites:** all four needed it, and reading them
  individually paid off — three (`browse.ts`, `topic-pages-present.ts`,
  `topic-page-content.ts`) render records and take `oneLine`, now exported from
  `formatter.ts`; the fourth (`content-search.ts:308`, the Wikipedia extract)
  would have been damaged by it, because prose legitimately wraps. That one is
  quoted with `> ` instead, which denies the line start without touching the
  paragraphs. A wholesale sweep would have flattened it.
  **R8's answer — CLOSED, and the list was too short.** The three sites named
  here all needed `oneLine`, but reading the package found **six more** that the
  R3 sweep had never listed: `tools/content-text.ts:59` (the `Quelle:` line —
  the worst of them, because a forged provenance is a false attribution),
  `tools/collection-stats.ts:38,51`, `tools/vocabulary.ts:168`,
  `tools/compendium.ts:45`, `tools/node-relations.ts:66,110`. Two lessons:
  a list of known sites is a starting point, never the scope; and the
  per-site decision holds — the stored full text, the compendium prose and a
  skill's instruction Markdown are DOCUMENTS and keep their line breaks, while
  every field around them is flattened. `node-details.ts` needed a small
  restructure for that: blank lines became their own array entries, because
  `oneLine` folds an embedded `\n` into a space and a heading stops being one.
  **R10's answer — CLOSED, and the delimiter turned out not to be HTML.**
  The widget HTML path was already sound: every interpolated value goes through
  `escapeHtml`, every node-derived URL through `safeHref` first, and
  `renderMarkdown` escapes before it rebuilds its narrow subset. The forging
  site was one layer over: `search-results/selection.ts` builds a message that
  is injected AS THE USER and lists one material per LINE, and it interpolated
  the title raw — so a newline forged an extra `- „…“ (nodeId: …)` entry naming
  an id nobody picked. `escapeHtml` does not touch newlines and never should;
  the rule that applies there is `sanitizeText`, which the single-tile path had
  used since 2026-07-28 while this one built its own message. **The lasting
  form: ask what the FORMAT's delimiter is before asking which escape to use.**
  Markdown records break on `\n`, HTML breaks on `<`, and a prompt-injected
  list breaks on `\n` again even though it is assembled by HTML-rendering code.
- **A control is only as strong as the header two functions above it (R11).**
  The MCP endpoint's credential-guessing cap was carefully built and carefully
  commented — and keyed on the client address, while the CORS policy in the same
  function advertised `Authorization` cross-origin, which lets an attacker spend
  a fresh address per victim browser. Neither half is wrong on its own; they
  were written at different times and never read together. **When reviewing a
  guard, read what else in the same request path can supply the input it
  bounds** — the bypass is rarely inside the guard.
- **A page has to be OPENED (R11) — the review twin of the Wikipedia lesson
  below.** `search-page.ts` reads perfectly: every field escaped, links
  scheme-guarded, a coherent light palette. Loading it in a dark-mode browser
  showed near-black text on the UA's dark canvas at ~1.1:1, because the palette
  declared `color` and no `background`. No unit test could see it and reading the
  source did not. **For any code that emits a rendered surface, budget one look
  at the rendered thing** — the same way a heuristic gets a live probe.
- **A matching rule is not reviewable by reading it (Wikipedia work,
  2026-08-02).** The relevance rules passed a full structured review with four
  minors and no majors. A live probe run immediately afterwards — the same rules,
  real queries — surfaced three confidently wrong answers the review had not
  seen (`Insel Rab` → a music album, `Element Zinn` → a French legal concept,
  `Fluss Po` → a plant). Reading a rule tells you what it does on the inputs you
  think of; only running it over real inputs tells you which inputs you did not
  think of. **For any heuristic — ranking, matching, scoring, classification —
  budget a probe over real data as part of the review, not after it.**
  **CLOSED for `reranker.ts` and `node-match.ts` (probed 2026-08-03), and the
  lesson held both times.** Both had passed a reading review. Run over real
  queries, `node-match`'s `nodeMatchesText` matched 0/60 nodes for
  `"Bruchrechnung"` and 43/60 for `"die Bruchrechnung"` — one German article
  turned a correct rejection into a 72% pass rate, because stopwords sit inside
  ordinary words. The reranker put "s-it-ting", "Maur-it-ius" and "Pol-it-ik" in
  the top five for `"IT"`. Neither is visible by reading: both look like a
  reasonable substring test.
  **The fix required the probe too, not just the bug.** The first instinct —
  demand a word boundary — would have broken German, where "Rechnung" belongs
  inside "Bruchrechnung". The measured data showed what actually separates
  signal from accident: a compound or inflection carries the term at a word
  START ("eu|ropäisch", "bio|logie", "mittelalter|lich") while the accidents
  bury it mid-word. So the rule is word-start for SHORT terms only. **A probe
  earns its cost twice — once finding the defect, once ruling out the fix that
  would have caused a worse one.**
  The same probe also showed a defect the fix nearly missed: the scorer's
  phrase branch (+30, its largest bonus) is a raw substring test that bypassed
  the term branch entirely for a one-word query. **When a rule is applied at one
  site, grep for the other branches that answer the same question** — here there
  were three copies of "which query words count", now one function.
- **The delimiter rule needs a test that fires a newline through the renderer
  (R7).** All four sites had passing tests; none fed a title containing `\n`, so
  the defect was invisible to the suite while being one line of mock data away.
  `tests/tools-output-integrity.test.ts` is where that class lives now — extend
  it in R8 rather than starting a new file per tool.
- **A worker pool's synchronous prefix hides a claiming bug up to the pool
  width (R7).** `browse_collection_tree` registered each level-1 node in its
  `visited` set inside the worker. `mapPool` starts `min(limit, items.length)`
  workers synchronously, so with ≤10 top-level nodes every id was registered
  before the first `await` and the de-duplication looked correct — the existing
  regression test used two. It breaks at eleven. **Whenever a test for a
  concurrency property uses fewer items than the concurrency limit, it is not
  testing the concurrency.** Size the fixture above the limit.
- **Concurrency is not a wall-clock bound (R8).** `get_nodes_details` looked
  bounded — 50 ids, pool width 10 — but the enriched read is `/textContent`,
  measured at median 4.6 s and max 9.2 s, so five waves can outlast `http.ts`'s
  own 30 s `requestTimeout` and the caller loses the connection instead of
  receiving the metadata it also asked for. **A pool bounds simultaneous LOAD;
  only a count bounds TIME.** Wherever a fan-out enriches with a slow read, the
  number of slow reads needs its own cap — and, per the R7 note, the ids that
  fall outside it must be named rather than silently left empty
  (`textContentSkipped`). R9–R11 carry the same question for every `mapPool`
  whose mapper is not a plain metadata read.
- **`outputFormat:"json"` means the text block must PARSE (R7).**
  `search_wlo_within_collection` appended two German hints to the JSON string.
  Three sibling tools got this right and one carried a comment explaining the
  rule, which is exactly why nobody re-checked the fourth. Existing json tests
  asserted on `structuredContent` and never parsed the text block, so the
  corruption was untested. Any tool offering `outputFormat` needs one test that
  calls `JSON.parse` on `content[0].text`.
- **A degrading read makes "we could not find out" indistinguishable from a
  fact — check what the caller then CLAIMS (R4).** Several upstream readers
  return `[]`/`null` on a non-OK response so a secondary read cannot fail a
  call. That is right for a breadcrumb and wrong the moment a caller turns the
  empty value into a statement about the record ("in no collection", "no
  results"). `readNodeParents` now sits beside `getNodeParents` for exactly that
  split, as `readNodeTextContent` does beside `getNodeTextContent`. **Later
  packages: for every graceful `[]` they consume, ask what sentence the user
  ends up reading.** Remaining degrading readers to audit under this lens:
  ~~`getChildCollections`~~, ~~`searchCollectionsByKeyword`~~ (both R7, below),
  `getNodeMetadata`'s `null` (R8).
  **R7's answer:** `getChildCollections` was the worse of the two — four callers
  turned its `[]` into a claim ("try a broader term", `WLO Fachportale: 0`,
  `Sub-Sammlungen: 0`, an empty tree). It gained a `getChildCollectionsResult`
  sibling carrying `reachable`, following the `readNodeParents` precedent; the
  plain form stays for the callers that only navigate. `searchCollectionsByKeyword`
  needed nothing: its one caller falls through to a tree traversal on an empty
  result, so the empty value never becomes a sentence. Same lens, opposite
  verdicts — which is the argument for reading each one rather than sweeping.
  **R8's answer for `getNodeMetadata` — CLOSED, and it was the widest of them.**
  `null` for every non-OK status reached the user as "Node X nicht gefunden" in
  three tools (`get_node_details`, the knowledge `fetch`, `get_node_collections`)
  and as "evtl. ein Datei-Knoten oder die Wurzel" in `get_node_breadcrumb`. A
  non-public record refuses its metadata too — `services/content-text.ts` had
  already MEASURED that and handled it correctly, so the right answer existed in
  the codebase while three siblings contradicted it. `readNodeMetadata` and
  `readNodeBreadcrumb` now sit beside their reducing forms, and
  `getNodeCollections` reserves `null` for a genuine 404 and throws otherwise —
  its two callers already treated a throw as "could not verify".
  **The generalisable part: when one module has measured an upstream behaviour,
  grep for the other callers of the same read before assuming they agree.**
- **A row/result target is not a fan-out bound (R4).** `collectRecursiveContents`
  looked bounded because it stopped at `maxResults` rows, but de-duplication
  meant a wide subtree could produce no new rows and never stop. Whenever a loop
  ends on "enough output", check what happens when the input stops producing
  output: the terminating condition has to be on the WORK, not on the yield.
  The same question applies to any bound stated per container (`MAX_LANES` capped
  swimlanes while the requests were per widget inside them).
- **CLOSED (R4's deferred projection question, measured 2026-08-03).**
  `services/compendium.ts` fetched `-all-` to read two fields; it now projects
  `DISPLAY_PROPS`. The measurement had to be redesigned before it could be made,
  and that is the transferable part: **the field the question named could not be
  its witness.** `ccm:oeh_collection_compendium_text` is unpopulated across all
  196 collections reachable from twelve broad search terms — and `-all-` returns
  47 properties, not the ~59 this note assumed. So the question was restated
  from the FIELD to the MECHANISM: does a `propertyFilter` alter what it
  returns? Every named field came back byte-identical to the `-all-` read,
  including a 4914-character `cclom:general_description` — the filter bounds
  which properties come back, never their content — and responses shrank 43%
  (19941 → 11287 bytes over four collections). **When a measurement cannot be
  taken on the object named, ask whether the property in question belongs to the
  object or to the mechanism**; measure the mechanism and say which one you
  measured. Staging carries no compendium texts at all, so this ran read-only
  and anonymous against the editorial repository.
- **A mock that answers only the mutation lets a test claim a success the code
  cannot (R5).** The six read-backs added here were green on the first run of
  the tool tests — because `serve()` answered `200` to every GET, so the tools
  silently took the sad path and the assertions (which only checked the request
  shape) never noticed. The lesson generalises past the write pipeline: **when a
  test exercises a call whose result is read back, the mock has to model the
  read-back too**, and a happy-path test must assert `isError !== true`, not just
  the URL. R9 and R11 inherit this directly. **R9 inherited it twice:** the
  removal's own mock kept serving the reference node after the DELETE, so the
  happy path read back as "still there" and the test failed for the mock's
  reason, not the code's. A read-back test needs the mock to model the *effect*,
  not only the call.
- **A test against `fetchMock` cannot find a tool that never worked — third
  confirmation (R9).** `wlo_create_collection` and `wlo_rename_collection` were
  found broken against staging on 2026-08-02; `wlo_remove_from_collection` was
  the third, found on 2026-08-03. Every one had a green test asserting the
  request the code had decided to send. Here the repository's own API is
  asymmetric in a way no schema shows: filing material takes the ORIGINAL node
  id (`PUT …/references/{original}`), removing it requires the REFERENCE id
  (`DELETE …/references/{reference}`) — and the delete with the original id
  answers `200` and removes nothing. **Every mutating tool owes one live run
  against a real repository before it is believed**, and the run has to check
  the effect, not the status code. R11 inherits this for anything it touches
  that writes.
- **`res.ok` is not "it happened" either (R5) — the second half of the R2
  lesson.** R2 closed "a 200 does not mean the body is JSON". R5 closed the
  companion: a 200 does not mean the mutation took effect. Six mutations outside
  the field pipeline reported success from the status code alone, the same
  construction that was found broken in production for `wlo_submit_content`. The
  three answers a mutation may now give are kept apart — `failed`,
  `not_visible`, `unverified` — because each permits a different sentence.
  **CLOSED by R9 (2026-08-03) — and the guess in this note was wrong.** It
  predicted a lag that would make `wlo_add_to_collection` report a false
  `not_visible`. Measured against staging: the add is reflected immediately, so
  that tool was never affected. The endpoint fails in a state nobody had thought
  to ask about — a node never filed answers `200`/0 rows, a filed one `200`/1
  row, and one whose reference was **just removed** answers `500`
  (`UsageException: Node does not exist` — a usage row still pointing at the
  deleted reference), recovering the moment the material is filed again. So the
  removal's read-back could never have used `/usage/v1`; it asks the reference
  node itself. The lasting form: **when a note guesses which state an endpoint
  will misbehave in, measure every state, not the guessed one** — the guessed
  state was fine and the unguessed one was broken.
- **"Absent" and "present but unusable" are different inputs (R6).** Three of
  R6's four findings are the same shape: a guard keyed on the presence of one
  thing while the rule belonged to another. The refused `Authorization` header
  was treated as "no header" and fell back to the shared account; the
  cleartext-transport warning was gated on a service account existing although
  it is the transport that leaks; the empty password was accepted on one path
  and refused on the other. When reading a guard, ask **what it is actually
  keyed on** versus what the rule is about. R7–R11 carry the same question for
  every `?? fallback` on an input a caller supplied.
- **Two entry points that must stay in step need a test each, not one (R6) —
  RESOLVED by deletion (2026-08-02).** `api/mcp.ts` was retained but not
  deployed, and it had drifted: no relay guard, no anonymous downgrade. R6 fixed
  the drift and pinned it with `tests/api-mcp.test.ts`; the Vercel path was then
  dropped entirely, so the duplication that caused the drift is gone rather than
  guarded. Every property that file pinned has a twin in `tests/http-app.test.ts`
  / `tests/auth-per-user.test.ts`, which is what made the deletion safe — and the
  check for those twins is the lasting form of this note. **R11 now reviews one
  HTTP entry point plus stdio**, not two HTTP ones. The general lesson survives:
  a second copy of a security-relevant path is only as honest as its own test,
  and deleting the copy beats testing it twice when it has no user.
- **RETRACTED — the `.env` credential does authenticate against staging
  (re-measured 2026-08-02).** An earlier note here claimed it had stopped
  working. The probe that produced that claim ran without `--env-file`, so it
  sent no credentials at all and measured anonymous access. Re-run with the env
  file loaded, `/iam/v1/people/-home-/-me-` answers `200` with authority
  `WLO-Upload` (anonymous answers `200` with `esguest`). **The lesson is the
  finding:** this project loads `.env` only via `node --env-file-if-exists`, so
  a scratch probe started any other way silently measures the anonymous path —
  and anonymous is a *plausible* result, which is why it was believed. Any
  ad-hoc measurement script must print whether the credential was loaded before
  printing its result. The `/usage/v1` write-visibility measurement (R5) and the
  deferred R4 projection question are therefore NOT blocked.
- **A file's header comment can contradict its own imports (R2).**
  `wikipedia-api.ts` claimed it "must never pull WLO config" while importing the
  `wlo-api` barrel for a timeout constant. Both statements had been true at
  different times. When a module documents an isolation property, check the
  import block against it — later packages carry the same kind of claim
  (`text-sanitize`, the write pipeline's gate).
- **A test can pass for the wrong reason, and a broad `catch` is how (R12).**
  Two validation tests named themselves "(no network)" and accepted any thrown
  error as the rejection under test. Measured: with the input cap deleted from
  the schema, the handler ran, its upstream call failed because the network was
  unreachable, and the catch reported that failure as the rejection — green over
  a removed constraint. Naming a property in the test title does not assert it.
  Where a test's verdict rests on "something failed", assert WHICH thing failed —
  here, that nothing was fetched at all. The general form: a mutation you expect
  the suite to catch is the only proof that it does.
- **A configuration setting is only real if the deployment carries it (R12).**
  Eleven documented variables — including the gates for all 13 curation tools
  and for `find_wlo_skills` — never reached the container, because compose reads
  `.env` for `${…}` interpolation only. Nothing was logged; the capability was
  simply absent. Whenever a package adds an env var, the pass-through in
  `docker-compose.yml` is part of the change, not a follow-up
  (`tests/deploy-env-passthrough.test.ts` now enforces it).
- **Two verified non-issues, so later packages need not re-derive them (R1):**
  Node 22 strips `Authorization` on a cross-origin redirect (measured), so
  `wloFetch` cannot leak the credential via a repository redirect; and
  `http.ts` sets `requestTimeout = 30_000` / `headersTimeout = 15_000`, so the
  body drain in `read-body.ts` is bounded by the socket layer.

---

## Baseline before the review

- `npm test` → 846 tests, 846 pass, 0 fail
- `npx tsc -p tsconfig.typecheck.json --noEmit` → clean
- `npm run build` → clean

Every package closes by re-running all three.
