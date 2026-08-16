# WLO MCP Server

MCP server that exposes WirLernenOnline (WLO) OER content — search, collections,
topic pages, node details — to AI agents over the Model Context Protocol.
Being extended to be OpenAI Apps-SDK compatible, more token-efficient (fewer
sequential tool calls), and richer (compendium texts, Wikipedia, a low-barrier
prompt-launcher). See the active plan below before implementing.

## Coding workflow (better-coding skills)

This project uses the better-coding skill set. Follow this process for all
coding work, and re-invoke the relevant skill before each new package or
coding section — skills unload as the session grows, so do not assume one is
still in context because it loaded earlier.

Pipeline: start (boot, once) → orient (route) → plan (design) → workflow
(implement) → review → verify. Bug: debug → workflow → review → verify.
Whole-repo health/security: audit. UI: pair frontend with workflow.

The skills and what each is for:
- /better-coding-start    — boot the workflow once per session; write/refresh this block
- /better-coding-orient   — route a new/unscoped task; understand unfamiliar code before changing it
- /better-coding-plan     — design & spec a non-trivial feature before code; produce the task list
- /better-coding-workflow — write or change any code (the engineering discipline)
- /better-coding-frontend — build or audit UI: accessibility, UX states, i18n, privacy
- /better-coding-review   — review a diff/PR before merge (read-only, severity-tagged)
- /better-coding-audit    — whole-repo health & security check (12 dimensions)
- /better-coding-debug    — anything broken: bug, failing test, build break (root-cause first)
- /better-coding-verify   — before claiming done/fixed/passing (evidence gate)
- /better-coding-help     — explain the set (for humans)

Re-invocation rule (skills unload — reload before each unit of work):
- Before EACH implementation package or coding section: /better-coding-workflow
  (plus /better-coding-frontend when it touches UI)
- Before reviewing a diff: /better-coding-review
- Before claiming done/fixed/passing: /better-coding-verify
- When something breaks: /better-coding-debug
Self-check: about to write code with no recent "better-coding-workflow active"
line in context → the skill has unloaded; reload it first.

Interaction language: German for conversation, questions, and reports. Code,
identifiers, comments, commit messages, and docs (README, CHANGELOG) remain
English. User-facing artifacts (launcher page copy, tool descriptions shown to
end users) may be bilingual DE/EN.

## Active plan

The current rebuild/extension is designed in:
- **Status (READ FIRST on resume): `docs/plans/STATUS.md`** — live progress
  tracker; says which phase is done and which task is next, with evidence.
- Design: `docs/plans/2026-07-15-wlo-mcp-apps-sdk-rebuild.md` (goal, approach,
  architecture, non-functional, risks — the source of truth for scope)
- Tasks:  `docs/plans/2026-07-15-wlo-mcp-apps-sdk-tasks.md` (9 phases P0–P8,
  dependency-ordered, TDD; each phase opens with a `/better-coding-workflow`
  refresh step, UI phases also `/better-coding-frontend`)
- **Write support / curation — COMPLETE (all 6 phases, 22 tasks, 2026-08-01):**
  - Design: `docs/plans/2026-08-01-write-support-design.md`
  - Tasks:  `docs/plans/2026-08-01-write-support-tasks.md` (22 tasks, 6 phases)
  - Evidence: `docs/plans/2026-07-31-write-support-research.md` — every factual
    claim is measured there; do not re-derive or contradict it without a new
    measurement.

  Targets **staging**. Six rules bind the implementation and still bind any
  change to it: every write reads back (three edu-sharing mechanisms discard a
  write while answering `200`); every mutation is confirmed two-step (preview +
  single-use token) before it happens, and EVERYTHING the call will send must be
  in the previewed change set, because the token is bound to a fingerprint of it
  (a free-text note beside the change set is an approval for text nobody saw);
  write tools refuse at call time — and since 2026-08-05 they are LISTED for
  every caller, which reverses the earlier half of this rule ("absent in
  anonymous mode") deliberately and on the user's decision: a model that never
  sees a write tool never calls one, so nothing ever asks the host to log the
  user in, and a connector stays anonymous forever. The refusal is unchanged and
  absolute; it now carries `_meta["mcp/www_authenticate"]` so the client starts
  the login. Every curation tool goes through `registerCurationTool`
  (`tools/curation-shared.ts`) — the one place that stamps `oauth2` and runs the
  gate, enforced by `tests/shared-rule-discipline.test.ts`;
  `ccm:oeh_lrt_aggregated` is never written by us (the repository derives it);
  accepting a suggestion writes and reads back BEFORE it marks the suggestion
  accepted — an `ACCEPTED` proposal over a record that never got the value reads
  as work already done; and an ABORTED request is reported as an open outcome,
  never as a failure — the abort hits the response, not the work, so every
  curation `catch` goes through `timeoutOrError` (`tools/curation-shared.ts`)
  rather than `toolError`.

  Live pass against staging done 2026-08-02 (STATUS.md). It found two defects
  that every test had missed — `wlo_create_collection` and
  `wlo_rename_collection` never worked, because the tests asserted our own
  inferred request body back to us against a faked upstream. Measurements in the
  research doc §9. Lesson that binds future work: a test against `fetchMock`
  proves the code sends what we decided to send, never that the repository
  accepts it. `wlo_submit_content` was verified separately (§10) and gained the
  read-back it lacked. Every curation tool has now run against a real repository.

- **URL-based full-text tool + generic unsafe-tool switch — IMPLEMENTED
  (2026-08-03; P0–P4 done, see the tasks file's progress table):**
  - Design: `docs/plans/2026-08-03-url-text-tool-design.md`
  - Tasks:  `docs/plans/2026-08-03-url-text-tool-tasks.md` (16 tasks, 5 phases)

  Adds ONE read tool, `get_url_text` (arbitrary URL → text via the extraction
  service), and a generic mechanism by which a tool declares itself `unsafe` and
  the operator switches it off with `WLO_DISABLE_UNSAFE_TOOLS`. Unsafe tools are
  registered BY DEFAULT, so a startup warning naming each one is part of the
  design. The tool is documented as **not for production**: we never fetch the
  target ourselves — Playwright inside the extraction service does — so a
  redirect to a private address, or a DNS answer that changes between our lookup
  and the service's, cannot be seen at this layer. Closing that needs
  resolution-time enforcement inside the fetching service. What IS enforced
  (`src/url-safety.ts`): the literal host check — including IPv4-mapped IPv6,
  a hole found and closed 2026-08-03 that was live on the existing `ccm:wwwurl`
  path — plus a check of the RESOLVED addresses, which catches a public name
  whose record points inside. Decimal/hex IPv4 literals need no handling:
  `new URL()` normalises them to dotted quad first (measured). Feeding extracted
  text into the curation path is explicitly out of scope.

- **MCP-Zugang per WLO-Konto (verschlüsselter Zugangsblock) — COMPLETE
  (2026-08-04/05; P0–P6 plus a review round of 7 fixed findings):**
  - Design: `docs/plans/2026-08-04-mcp-access-token-design.md`
  - Tasks:  `docs/plans/2026-08-04-mcp-access-token-tasks.md` (18 tasks, 7 phases)
  - Team decision paper (7 open questions F1–F7 for the user, not for us):
    `docs/plans/2026-08-04-auth-optionen-entscheidung.md`

  A user fetches a block at `/auth` whose password was encrypted **in the
  browser**, pastes it once as `Bearer …`, and revokes it at `/auth-revoke.html`
  (or `/auth/revoke`). Off unless `WLO_AUTH_PRIVATE_KEY` is set. The measurement
  that closed every other option: edu-sharing offers no OIDC discovery, no DCR,
  and declares only `basicAuth`/`cookieAuth` — **there is no token to relay**, so
  any scheme carries the credential itself. Do not re-derive this; re-measure it
  if you must contradict it.

  Rules that bind any change here: `/auth*` sends **no CORS header** (both abuse
  limiters count per client ADDRESS, so a wildcard origin lets a page spend every
  visitor's quota on a password guess and read the outcome); the access id lives
  INSIDE the AEAD (otherwise it is swapped to dodge revocation); the registry is
  an ALLOW-list where every failure closes the door, holds ids and never a
  credential, and is the ONLY runtime disk writer (enforced by
  `tests/shared-rule-discipline.test.ts`); its write chain must not carry one
  rejection forward, and a failed write is undone rather than left granting what
  it could not record.

- **OAuth 2.1 für alle Clients — IN ARBEIT, P1–P4 fertig, nur P5 (live + Doku) offen (2026-08-05):**
  - Design: `docs/plans/2026-08-05-mcp-oauth-design.md`
  - Tasks:  `docs/plans/2026-08-05-mcp-oauth-tasks.md` (17 tasks, 5 packages)

  Measured 2026-08-05: ChatGPT's connector offers **no header or API-key field**
  at all — only OAuth / none / mixed — so the access block cannot be entered
  there. Its probe fails with `does not implement OAuth`, and every discovery
  path on our server answers 404. OAuth is therefore the only mechanism that
  reaches every client, and a working reference exists at
  `C:\Users\jan\github\mcp-wiki-js-ai` (1331 lines, no new dependency).

  Two decisions the design locks: the access token IS the existing `wlo2.…`
  block, so no credential ever rests on disk (the rejected vault) and no session
  store is needed; and a request with NO `Authorization` keeps answering 200
  anonymously — the 401 fires only for a presented-but-unusable OAuth token.
  Open point 1 — whether a client discovers OAuth without a 401 — was the gate
  and was **measured positive on 2026-08-05**: ChatGPT read both discovery
  documents unprompted and reached `/oauth/register`. Anonymous reading and
  OAuth therefore coexist on the same URL; no second URL, no forced 401.

  Rules P3 adds, and they bind any change to the login flow: **the request is
  checked before anyone is shown a password field**, and a refused one gets a
  page, never a redirect — sending an error to a `redirect_uri` we did not
  recognise turns this server into a redirector. The check lives ONCE, in
  `src/auth/oauth-authorize.ts`, because GET decides what to show and POST what
  to mint, and a second copy is where the PKCE requirement quietly disappears
  from the path that actually issues the code. The consent page learns who is
  asking from `GET /oauth/authorize` with `Accept: application/json`, not from
  the query string — `client_id` is a ciphertext only the server opens, and
  repeating the caller's own text back would let it name itself. The access
  block waits in `oauth-codes.ts` as a CIPHERTEXT until `/oauth/token`; that
  module deliberately does not import `access-token.ts`.

  Rules P4 adds: the access token **IS** the block, which is the only reason one
  revocation ends both ways in — do not wrap it in a second credential. No
  `refresh_token`, no `expires_in`. The code is removed from the store BEFORE
  any check runs (a failed PKCE proof must not leave it retryable), and every
  failure answers the same `invalid_grant` text, because which check failed is
  what a holder of a stolen code would like to learn.

  Two rules from working the T5.3 leftovers: the OAuth surface spends TWO
  budgets — `/oauth/authorize` the tight `/auth*` one (a password is typed
  there), everything else the connector's own, because both discovery documents,
  the registration and the token exchange come from the CLIENT's address and a
  hosted connector serves many users from few of them; and the consent screen
  ranks the CHECKED value above the CLAIMED one — registration is open, so
  `client_name` is whatever the caller typed, and the verified redirect target
  leads with the emphasis while the name is labelled as self-declared.

  The T5.3 review (2026-08-09) adds one rule and it binds any change to the
  block format: **a block is LENGTH-bounded at `decodeAccessToken`**
  (`MAX_BLOCK_CHARS`, the one place every path decodes one). Shape was checked
  and size was not, and the payload takes arbitrary padding — a 1 MB junk field
  yields a 1 333 836-character block that decodes fine, because `validatePayload`
  drops unknown fields from the RESULT while the caller keeps the string.
  `/oauth/authorize` RETAINS that string in the code store, which bounds the
  number of records and not their size. A real block is 573 characters (605
  against the deployed RSA-2048 key), so do not lower the bound below an
  RSA-4096 rotation's needs — and do not remove it.

  Measured lesson from P3, the second time this shape has appeared: page and
  endpoint were each green against the author's own idea of the request body and
  **disagreed** (`response_type` was missing, so every consent failed). Only
  running it found that. `tests/oauth-authorize-page.test.ts` now takes the
  field names out of the PAGE and feeds them to the REAL check, and
  `tests/oauth-flow.test.ts` walks all nine steps through a real server —
  ending on the two lines that matter: a revoked token gets 401, and a request
  with no header still gets the full anonymous list.

  Three implementation decisions the tasks add on top of the design: the
  `client_id` carries its own content (AES-GCM under a key derived from the
  existing private key) rather than living in a store, because the allow-list is
  the only disk writer and an in-memory store would break every client on every
  deploy; the issuance path is EXTRACTED into `src/auth/access-issue.ts` rather
  than copied, because the authority check is the rule "200 is not proof of a
  login" hangs on; and the issuer origin comes from `WLO_PUBLIC_BASE_URL`, from
  the `Host` header only under `TRUST_PROXY`.

- **Skill-Abruf (`search_skill` / `get_skill`) — COMPLETE (2026-08-08),
  Redaktions-Anleitung: `docs/SKILLS.md`, Verlauf in `STATUS.md`:**

  A skill is a `ccm:io` whose **content type** marks it
  (`ccm:oeh_extendedType = …/contentTypes/ai_skill`, full URI — the slug matches
  nothing; it was `ai_prompt` until the vocabulary split on 2026-08-12) and whose attached file is the `SKILL.md`. Both tools are registered
  unconditionally; `WLO_SKILLS_COLLECTION_ID` only NARROWS the search, and
  `WLO_SKILL_TOOL_MODE=one-tool` swaps **the search alone** for
  `get_skill_for_task` — `get_skill` is registered in EVERY mode (2026-08-16),
  because it is the only tool that takes a nodeId and the surfaces handing them
  out are not governed by that switch: `get_skill_registry` is unconditional and
  IS a list of them, every collection result carries that list, and a skill names
  its references and companions by id. Leaving it out made the approval list
  unusable in that mode. The swap is therefore 1:1 and the tool count does NOT
  change — two docs said 41 because `tests/docs-claims.test.ts` derived the
  expectation from a COMMENT about the code (`names.length - 1`) instead of the
  code; it now measures both modes through `registerSkillTools`.

  Four measurements bind any change here (2026-08-08, re-measure before
  contradicting): (1) `ngsearch` returns **no collections at all**
  (`contentType=FOLDERS` → 0) and the collections endpoint takes **only**
  `ngsearchword` — so a skill must stay a `ccm:io`, and a collection scope must be
  WALKED (`virtual:parent_recursive` → 400 on ngsearch, unlike the page_variant
  query). (2) That walk is level-parallel and bounded on three axes; sequential it
  took 90.3 s over a subject portal. Any collection left unread — cap, depth or a
  failed listing — must be logged, and a root that is wholly unreadable THROWS
  rather than reporting an empty catalogue. (3) `ccm:original` is the identity: it
  is in the projection, results dedupe on it, and the original wins over a
  reference. (4) The instruction TEXT reads fine through a reference id; only the
  companion-folder lookup has to resolve `ccm:original` first.

  Three rules the tool layer holds: the server-derived sections (activation
  line, file manifest, `:::` references) are rendered BEFORE the untrusted
  document, because after it they are indistinguishable from sections the
  document forged; a companion is pointed at the tool that fits its MIME type —
  `get_skill` returns the file VERBATIM, so anything that is not `text/*` goes
  to `get_wlo_content_text`; and a loaded skill ANNOUNCES itself
  (`services/skill-activation.ts`, 2026-08-15) with a line the model is asked to
  print — `[ edu-sharing Skill ] <cclom:title> - aktiv`, also carried as the
  `activation` field so a client rendering the answer itself does not depend on
  the model complying. Two things bind any change to it. It rests on the CONTENT
  TYPE, not on which tool was called: `get_skill` also serves a skill's
  companion files, and announcing a template as an active skill asserts what the
  record denies. And the title goes through `sanitizeText`, never `oneLine` —
  it lands inside an instruction reproduced verbatim to a person, which is the
  elevated-authority boundary, not the delimiter protection an ordinary rendered
  value gets. Compliance cannot be enforced; that is the same standing a host's
  own skill files have.

  **A catalogue says it is not the instruction (2026-08-16).** Every surface
  that lists skills BY NAME closes with `DESCRIPTIONS_ONLY_NOTE` — one constant
  in `formatter.ts`, beside `registrySummaryLines`, pinned by
  `tests/shared-rule-discipline.test.ts`; two of the three surfaces already
  carried their own closing pointer, identical by luck, and the third had none.
  It reaches `registrySummaryLines` (so: search results, `subjectRegistryText`,
  `get_node_details`, topic pages), `search_skill` and `get_skill_registry`,
  each in BOTH formats (`hint` in JSON, same rule as that tool's untrusted
  warning), and in `get_skill_registry` it stays ahead of the `---`. Three rules
  bind any change. (1) It is emitted only where a skill nodeId was PRINTED —
  not on the head-line tier and not for an empty catalogue: naming `get_skill`
  "mit dessen nodeId" over an answer that carries none promises a step the
  content cannot support. `get_skill_for_task`'s alternatives are excluded for
  the neighbouring reason — under `one-tool` the named tool is not registered.
  That rule is PER FORMAT, and both JSON sites broke it in the first cut:
  `get_skill_registry` answers its JSON branch BEFORE the `!registry` check, so
  an unconditional `hint` shipped beside `registry: null`. What made it
  invisible is worth more than the fix — the positive tests covered both
  formats and the negative ones only markdown. The `hint` field itself belongs
  to those two tools ALONE: prose hints are markdown-only everywhere else
  (`registryHintFor`; `renderToJson` carries none), and the envelope says the
  same thing through `registryChecked`/`licenseFilter`/`skillRegistry`. These
  two build their payload by hand, which is the whole reason they need it.
  (2) It says what the listing is NOT and never what it HOLDS: the two surfaces
  hold different things (a node's catalogue is title+nodeId only, the tool's
  adds descriptions and keywords), so a first draft naming the fields — "nur
  Titel und Beschreibungen" — was false on the surface that shows the most of
  them. (3) It is INDENTED with the entries it closes; flush left it lands
  between the last skill and the node's own `Typ:` line and reads as a claim
  about the record. Both (2) and (3) were found by rendering the output, not by
  a test — which is why each now has an assertion. (4) It RULES OUT the two ids
  standing beside the right one, because naming the tool is not enough where
  THREE nodeIds are in view — the collection's on the record line, the registry
  document's on the head line, the skill's on its entry, and the one nearest
  the note is the registry's. Indefinite ("einer Registry oder Sammlung"), not
  definite: `search_skill`'s catalogue holds neither, so "der" would point at
  things its answer does not show.

- **Use-Case-Lücken (Lizenzfilter, Usage, Themenseiten-Variante) — COMPLETE
  (2026-08-09):** `docs/plans/2026-08-09-usecase-gap-tools.md` (design + tasks in
  one file). Three packages, of which one is deliberately NOT built.

  **P1 licence filter** — see `filter-criteria.ts` under Architecture above. One
  rule sits outside it and binds any change: the OER BUNDLE fans out over its
  four keys and merges round-robin (`services/license-search.ts`). It was five
  until 2026-08-12: `COPYRIGHT_FREE` is not an open licence — "kostenfrei
  zugänglich", ordinary copyright otherwise — and answered 12 445 records to
  callers asking for freely reusable material, which is the surplus direction
  this file already calls harmful. All three tool descriptions had always listed
  only the four, so the code was the outlier. Sending no
  criterion and filtering the generic page locally — the first version — answered
  "kein Treffer" over the 18 793 OER records staging holds for `Mathematik`,
  because relevance ranking and licence are unrelated and the top fifty carried
  no `ccm:commonlicense_key` at all. Concatenating the five instead of
  interleaving them handed the whole cap to the first key (six hits, all CC 0,
  while 11 563 CC BY-SA never appeared). Both were invisible to every test.
  Measure with FACETS before contradicting any of this: `ngsearch` takes
  `facets: string[]` and counts exact keys server-side over the whole result set.

  Three further rules from working the review's leftovers (2026-08-09): the
  facet total is DISCARDED when the bucket list is full (`FACET_LIMIT`, one
  exported constant) — a possibly-truncated sum understates the corpus while
  looking exact, and staging's 16 keys are a property of that instance;
  EVERY path that accepts `license` must disclose its exactness pass, which is
  why `searchAll` carries `content.licenseFilter {checked, kept}` (neither
  `count`, post-cap, nor `total`, the corpus, can stand in for it); and paging
  the BUNDLE is not a partition — the same `skipCount` goes to every key, so
  the tools say so and point at `excludeNodeIds`.

  "EVERY path" is literal and was found violated on two of the five the day it
  was written (2026-08-09), both in `rest/`: **an envelope field is not a
  disclosure if the renderer drops it.** `/api/search?format=html` accepts
  `license`, ran the pass, and rendered nothing — an emptied result read as a
  bare "Keine Treffer." over material that is demonstrably there — and
  `/api/collection?q=…` returned only its post-filter `total`, which is
  indistinguishable from an empty collection. The page now carries the sentences
  through `warnings`, and the counts come from the UNPROJECTED envelope, because
  `fields` may drop `licenseFilter` and a disclosure that disappears when the
  response is trimmed is no disclosure. Counting the paths is the check: three
  MCP tools plus `/api/search` (JSON and HTML) plus `/api/collection`.
  `search_wlo_within_collection` deliberately has no paging notice — it slices
  ONE locally filtered list, so its paging is a real partition.
  `content.licenseFilter` exists exactly when a licence was given AND the content
  leg ran (`include`), and that is deliberate: it is the SINGLE gate both
  `search_wlo_all` and the HTML page hang their sentences on. Emitting it as
  `{checked: 0, kept: 0}` for a collections-only call read like a filter that
  emptied the bucket, and re-deriving the condition from `include` per call site
  is a second copy of one rule — which is how the paging notice came to fire over
  a content search that never happened, twice.

  A review of that fan-out (2026-08-09) found three more, and they bind too. (a)
  The reported total is the FACET count of exact keys (`exactLicenseTotal`),
  never a sum of the keys' `pagination.total`: the families NEST — `CC_BY`
  contains `CC_BY_SA` (Mathematik 27 351 vs 3 848 + 9 554) and also the NC/ND
  records — so summing overstated by 98–164 % (`Mathematik` 37 851 for 14 343),
  and a single licence reported its family (343 over a list of 42). Facet buckets
  are matched through `resolveVocab`, the SAME resolution `filterByExactLicense`
  applies to a node, because the index holds `CC BY-SA` with spaces as its own
  key — count and list must not disagree about what counts. (b) Every path that
  accepts `license` needs its own exactness pass: the bundle contributes NO
  criterion, so `search_wlo_within_collection`, which matches locally, filtered
  nothing at all and answered `license: "OER"` with CC BY-NC-ND. (c) Losing one
  key is tolerated, losing ALL five throws — an empty merge is indistinguishable
  from "there is no freely reusable material on this topic".

  **P2 `wlo_register_usage` — not built, and the reason binds any retry.** The
  write endpoint is gated on an **application signature**, not a user: `POST
  /usage/v1/usages/repository/-home-` answers 403 `app signature required` for an
  authenticated service user, for every `appId` tried and for an EMPTY body (so
  the gate precedes the body), and 500 `Signature could not be verified!` when
  the four `X-Edu-App-*` headers are present but bogus — including with a
  registered app id. `prepareUsage` answers 200 and records nothing. The READ
  side works and is empty everywhere. Getting a key is not a code change: an
  edu-sharing app signature lets its holder act for arbitrary users, which
  reverses this server's auth design. Operator decision, not a task.

  **P3 `wlo_set_topic_page`** — the 14th curation tool and the only one whose
  result is immediately public: it sets `default` in `ccm:page_config`, which
  decides which variant a Themenseite renders. Measured 2026-08-09 and the reason
  every check is local: the repository validates NOTHING — `POST …/property`
  stored the literal `"not json at all"` and answered 200, and accepted the
  property on a `ccm:io`. Rules that bind any change: the stored document is
  EDITED, never composed (`setDefaultVariant` in `topic-page-config.ts`, which
  keeps unknown keys and the variant list — 28/28 real documents carry
  `variants[]`, only 2/28 a `default`); the value is written as a store ref
  (`toStoreRef`, the inverse of the `stripStoreRef` every read applies); a
  variant that is not a usable child of THIS page's config folder is refused, and
  an unreadable child listing is refused as unreadable rather than as "no such
  variant"; the read-back compares the PARSED document, because a repository
  that stores whatever it is handed proves nothing by echoing our bytes; and a
  no-op (the variant already renders) is refused rather than written again —
  `buildChangeSet` gives the other tools that for free by dropping unchanged
  FIELDS, and this change has none. The
  confirm token binds to the sentence naming page and both variants with ids —
  a document of store refs is not something a person can check in a preview.

- **Skill-Registry pro Inhaltssammlung — CODE COMPLETE (P0–P3, 2026-08-10);
  only the live `:::` run is open, and it waits on editorial work:**
  - Design: `docs/plans/2026-08-10-skill-registry-design.md`
  - Tasks:  `docs/plans/2026-08-10-skill-registry-tasks.md` (12 Aufgaben, 4 Phasen)

  The editorial process inverts the question `search_skill` answers: not "which
  skills exist" but "which skills are APPROVED for this collection", declared by
  a registry document inside the collection. A registry is built like a skill
  record — attached Markdown, `:::` blocks — but keeps the `ai_prompt` content
  type that skills left behind on 2026-08-12 (`REGISTRY_CONTENT_TYPE_URI`), so
  `parseSkillReferences` and `readSkillText` are reused rather than rebuilt (both
  duplications were written before being caught; `readSkillText` is exported from
  `skills.ts` for exactly this).

  Four measurements from T1 bind any change here (2026-08-10, re-measure before
  contradicting): (1) `/children` carries `mimetype`/`mediatype` in EVERY
  projection but `ccm:oeh_extendedType` **only when the request asks for it** —
  same node, same call, empty under `DISPLAY_PROPS` — so the registry lookup must
  pass `SKILL_PROPS` or every candidate is invisible. (2) A SKILL.md reports
  `text/x-web-markdown`, not `text/markdown` (25/25). (3) **28/28** skill files
  are named `SKILL.md`, so the `SKILL_REGISTRY.md` tie-break distinguishes
  nothing today and the ambiguity disclosure is the RULE, not a corner case.
  (4) **0/28** documents contain `:::` at all and **0/28** are collection
  references — the block format was documented but unexercised on staging.
  **Superseded 2026-08-12:** the editorial team filed one. `loadSkillRegistry`
  on the Optik collection returns "Skillkatalog Physik Optik" (16 717 chars,
  **56** `:::` blocks) resolving to **28 entries, 0 unresolved**. The path is
  measured; what was waiting was editorial work, not code.

  The registry is found through the collection's CHILDREN listing, never the
  search index: the two are separate systems, and the Optik case (2026-08-09)
  showed a record can fall out of the index while sitting in the node store. An
  approval list must not depend on it.

  Two rules the service holds: the catalogue has TWO cost tiers in ONE function
  (`resolveHeads`) — the search tier costs exactly 2 upstream calls per
  collection no matter how many skills are declared, because the `:::` block
  already carries the title, and a test COUNTS those calls because the cost is
  part of the contract; and a found-but-unreadable registry comes back NAMED with
  `reason: 'unreadable'`, because "there is no registry here" is a different and
  wrong claim.

  **Reach and caps changed 2026-08-15 (the user's decision), and the two changes
  interlock.** (a) `REGISTRY_SEARCH_MAX` IS `REGISTRY_MAX` (100): one number, so
  a listing and `get_skill_registry` cannot disagree about what "the approved
  skills" are. It costs no request — the cheap tier reads title and nodeId from
  the `:::` block. The sentence moved with it: a capped listing may no longer
  say "mehr mit get_skill_registry" (the tool caps at the same 100) and points
  at the registry DOCUMENT instead, which that tool returns unchanged; the
  equality is pinned in `tests/skill-registry.test.ts` because raising one
  number alone makes that sentence quietly wrong. (b) The catalogue was attached
  to a tool's RESULTS, which answered for every collection except **the one the
  tool was called on** — `get_collection_contents`,
  `search_wlo_within_collection`, `get_node_details`, `get_topic_page_content`
  all take it as an argument and never return it (and with
  `contentFilter="files"` the results are materials, so nothing was attached at
  all). `subjectRegistryText` (`tools/shared.ts`, over `ensureRegistryFor`) is
  the ONE place that answers for a single collection — enforced by
  `tests/shared-rule-discipline.test.ts` — and for a Themenseite the id is the
  COLLECTION's, never the variant's. Its block NAMES the collection in words:
  it lands under the last listed record, and without that line it reads as that
  record's registry, which for a material cannot exist. Three rendering tiers
  now exist and the rule is the answer's SHAPE, not its subject: record lists
  and the subject collection get the full catalogue; a tool that renders one
  block per node (`browse_collection_tree`, `get_subject_portals`,
  `search_wlo_topic_pages`) gets the head line via
  `registrySummaryLines(…, {entries:false})` and reads the cache ONLY
  (`cachedRegistriesFor`) — thirty portals or fifty branches paying a children
  listing each is the crawl this cache exists to prevent. `get_related_content`
  answers for the collection it TOUCHES, exposed as `registryCollectionId`, and
  which one that is depends on the SEED — the tool takes a material or a
  collection: a collection seed IS the collection in play (its own
  `virtual:primaryparent_nodeid` is a level the caller never named, which is
  what a `siblingCollectionId` named after the siblings got wrong), a material
  seed points at the parent the siblings were read from, and with no siblings
  requested there is no collection and nothing is said. Its two RESULT lists
  come from `FILES` queries and can hold no collection at all, which is why the
  `registryHintFor` call over their union was unreachable code and is gone.

  Two rules the review of the same day added, and both are about a NEGATIVE.
  (1) The catalogue is attached to the NODE, before any `outputFormat` branch —
  both browse tools computed it after the JSON early-return, so a JSON caller
  got nothing while the docs promised it to both. It costs no schema work:
  `CollectionTreeNode` IS a `FormattedNode` and both browse schemas extend
  `formattedNodeSchema`, so the field and its zod entry already exist — and zod
  strips what is not declared, which is why `structuredContent` is asserted
  separately from the text. (2) `ensureRegistryFor` reports THREE outcomes
  (`{registry, answered}`), not two: a catalogue, "answered, none there", and
  "not answered" — collapsing the last two into one `null` made a failed listing
  read as a collection that approves nothing. A lookup that learned nothing is
  QUEUED, or the tick never warms it and every request repeats the live call.
  `subjectRegistryText` renders silence for the middle case and the "nicht
  geprüft" sentence for the last, and nothing at all for an empty id — which
  `get_topic_page_content` passes whenever a query matched no page.

  P3 adds the search-side enrichment (`enrichSkillRegistry` in
  `services/search.ts`), rendered once in `renderToText` (both tools go through
  it, every line via `oneLine`, the FULL catalogue listed per collection).
  Two rules from 2026-08-11, both the user's decision, and they interlock —
  changing one without the other makes a sentence in the output false.
  (a) `REGISTRY_LINES_MAX` was 4, is now **30**: an approval list showing four of
  nine is the "short list standing for a long one" shape this project refuses
  elsewhere, and the entry a model needs may be the fifth. (b) The catalogue cap
  is per TIER, and the tier IS `resolveHeads`: `REGISTRY_SEARCH_MAX` = **30** for
  the listing (equal to `REGISTRY_LINES_MAX`, so a listing is always complete for
  what it carries), `REGISTRY_MAX` = **100** for the tool, which fetches one head
  per skill and is called about ONE collection. The head line follows from the
  pair: nothing capped → "alle hier gelistet", and `get_skill_registry` is named
  for what it ADDS (descriptions, keywords, prose), not for completeness it
  cannot improve; capped → "hier die ersten 30, mehr mit get_skill_registry",
  which is true only because the tool cap is higher — and never "alle", because
  past 100 the tool caps too. **(b) was superseded on 2026-08-15** — the tiers
  now carry the SAME 100 and the capped sentence had to stop offering the tool;
  see the Skill-Registry-Cache block below. (a)'s reasoning is what survived and
  was applied again. It is **off by default** and the default is a MEASUREMENT: the
  live run showed ~1.0–1.4 s added per search, paid through the `/children` call
  whether or not a registry exists — neither collection in that run had one and
  it still cost 1.4 s. What replaces it is FREE: a pointer line on every
  collection result (`registryLines` emits it when `skillRegistry` is absent and
  `nodeType === 'collection'`), the server instructions, and cross-references
  pinned in `tests/tool-descriptions.test.ts`. The lookup then happens once, for
  the one collection in play, rather than for all five. Three rules bind any
  change: `WLO_REGISTRY_IN_SEARCH` is read INSIDE `searchAll`, not at the three
  call sites; a new `FormattedNode` field
  must be DECLARED in `formattedNodeSchema`, because zod strips unknown keys and
  the field would vanish from every `structuredContent` with nothing failing
  (found in this diff); and the measured cost is **~1.0–1.4 s** per search, not
  the 0.5 s first estimated — driven by the child COUNT of the largest
  collection, while the projection costs nothing (27 fields vs 3: 531 vs 523 ms,
  measured before the "obvious" optimisation was written, which is why it was
  not). Staging's variance is large enough that one measurement pair proves
  nothing: a run WITHOUT the enrichment took 7.0 s, slower than any run with it.

  Live-verified 2026-08-10: `no_registry` on a real collection,
  `collection_not_found` on an unknown id, and an unreadable listing degrading
  rather than throwing. The `:::` path itself was the one gap and is now closed
  (2026-08-12): a real registry on the Optik collection resolves 28 of 28
  declared skills with nothing unresolved.

  The review of this package (2026-08-10, 7 findings) adds four rules and they
  bind any change here. (1) A registry's TITLE is read through `nodeTitle`
  (`node-match.ts`), the canonical chain, never through one property: `cm:title`
  is in the same projection and is the carrier this repo measured as actually set
  — reading `cclom:title` alone made a marked registry invisible and, with a
  second `ai_prompt` document present, answered with the WRONG document's
  catalogue. Every fixture goes through `makeNode`, which writes only
  `cclom:title`, so the suite was validating the implementation's choice; a
  detection test must set `cm:title`. (2) The registry pointer is an ANSWER-level
  line, not a list-level one — `registryHintFor` is exported and a composed
  answer (`search_wlo_all`: three lists, and topic pages are `ccm:map` so they
  format as collections) suppresses `renderToText`'s own hint and emits it once.
  `get_related_content` was the second such caller until 2026-08-15, when its
  union hint turned out to be unreachable (see above). (3) Whether the lookup RAN is reported as
  `collections.registryChecked`, the same shape and the same reason as
  `content.licenseFilter`: a collection without a registry carries no field, so
  the results cannot tell "not looked up" from "looked up, none there", and a
  renderer that guesses tells a caller its answered question was skipped.
  (4) A bounded scan discloses its bound — `scanTruncated {scanned,total}` from
  `pagination.total`, because "diese Sammlung führt keine Registry" over 50 of
  400 files is a claim the read does not support. Corollary that cost two of the
  seven findings: `WLO_REGISTRY_IN_SEARCH` living inside `searchAll` means every
  caller inherits the cost, so a path that cannot RENDER the field either learns
  to (`/api/search?format=html`) or declines it (`knowledge.ts`, whose
  `{id,title,url}` shape has nowhere to put it).

- **Skill-Registry-Cache — COMPLETE (2026-08-11), inkl. Review (8 Befunde) und
  Live-Lauf gegen Staging; offen ist nur der `:::`-Pfad (0 Registries vorhanden):**
  - Design: `docs/plans/2026-08-11-skill-registry-cache-design.md`
  - Tasks:  `docs/plans/2026-08-11-skill-registry-cache-tasks.md` (11 Aufgaben, 4 Phasen)

  `services/skill-registry-cache.ts` makes the catalogue part of every collection
  answer: `ensureRegistries` serves from memory and falls back to a bounded live
  children listing for what it lacks. That retires `WLO_REGISTRY_IN_SEARCH`
  (gone) and re-points `includeSkillRegistry` at FORCING a fresh lookup — it no
  longer decides whether the registry appears at all. Five rules bind any change.

  (1) **A NEGATIVE may only come from the CHILDREN listing; the index may only
  produce a POSITIVE.** The asymmetry is the whole design. A corpus hit is a
  record the index handed over, so "this collection HAS a registry" rests on
  evidence and is adopted at once (fast path: one document read, no listing).
  Absence from the index rests on a gap nobody can see — a record can fall out
  of it while sitting in the node store (2026-08-09) — so a parent the corpus
  does not name stays UNKNOWN and the listing answers it. Same asymmetry inside
  the tick: only a lookup that ANSWERED is remembered; a throw or `unreadable`
  is remembered as nothing and re-queued, or an outage becomes a statement.
  (Measured 2026-08-11: `virtual:primaryparent_nodeid` is on 28/28 records and
  already in `SKILL_PROPS`, but for harvested material the primary parent is the
  spider folder — `dwu_spider`, `leifi_spider` — which is a `ccm:map` too, so a
  type check would not save you; looking up BY collection id is what makes the
  mapping self-validating.)

  (2) **The live fallback is bounded per request** (`LIVE_FALLBACK_MAX = 10`,
  pooled): a listing of 50 collections must not fire 50 upstream calls. What
  does not fit is queued and reported as UNANSWERED, so the caller's "nicht
  geprüft" line stays true instead of implying a look that never happened.
  `collection_not_found` IS remembered — a nodeId that does not exist will not
  start existing.

  (3) **No pre-built index of the tree.** Measured 2026-08-11: level 1 = 35
  collections, level 2 = 331, level 3 ≈ 1335 → a full walk is ~1700 collections
  and ~3400 requests per cycle, ~11 req/s sustained on a 5-minute schedule.
  The queue is bounded by real usage instead (a search returns five).
  Re-measure before contradicting.

  (4) **`registryChecked` needs the live pass as its own term**, not inferred
  from how many nodes carry a field: a live lookup that found NOTHING also
  leaves no field, so counting fields reports a completed check as skipped
  (caught by an existing test the day it was written).

  (5) **The cache starts ONLY from `http.ts`/`stdio.ts`**, never at module load —
  a timer firing on import hits the network in every test and `tests/netguard.mjs`
  fails the run. Pinned by `tests/shared-rule-discipline.test.ts`, which also
  names the three files that must call `ensureRegistries`.
  `tools/browse.ts` is deliberately excluded: it renders its own line formats
  with no registry line, so attaching would put the field in
  `structuredContent` while the text dropped it.

  The review of this package (2026-08-11, 8 findings) adds three rules and they
  bind any change here. (6) **A lookup has THREE outcomes, not two.** Beside
  "answered" and "failed" there is the scan cut short at `REGISTRY_SCAN_MAX`:
  `loadSkillRegistry` reports `scanTruncated` for exactly this, and both cache
  paths dropped it — so 50 files read of 400 was cached as "this collection has
  no registry", held for the TTL and re-affirmed by every refresh, because the
  same first page comes back each time. It is remembered (re-reading answers
  nothing) but does NOT count as answered, so the caller keeps its pointer line.
  Do not simplify that to "remember nothing and re-queue": that is an endless
  crawl for an answer the cap makes unobtainable. (7) **`WLO_SKILL_CACHE` covers
  the REQUEST path**, not only the timer — the switch is flipped for the cost,
  and a live fallback that kept running charges every request the full children
  listing while no tick exists to expire anything or drain the queue it feeds.
  (8) There is **one** function that turns a `SkillRegistry` into the field a
  result node carries (`toRegistrySummary`, `services/skill-registry.ts`), its
  return type is `FormattedNode`'s own field rather than a re-declaration, and
  the discipline test fails a second copy — four existed, and what a copy drifts
  on is `truncated`, the disclosure that the catalogue is shorter than the
  registry declares.

- **Sammlungssuche über beide Backends (P1) + Vokabular-Abgleich (P2) —
  COMPLETE (2026-08-11/12):**
  - Design + Aufgaben: `docs/plans/2026-08-11-collection-name-search-and-vocab-sync.md`

  **P2 (2026-08-12):** `npm run sync:vocabs` compares the six checked-in
  vocabularies against a live repository and REPORTS — it never writes, because
  labels need judgement (ours are sometimes better than the repository's, and the
  worst defect found was a label that existed and looked fine). Four measurements
  bind any change here. (1) The mds `values` endpoint is **not** the source for
  licences: asked for `ccm:commonlicense_key` it answers with the bare key as its
  own `displayString` for all 16 values IN EVERY LOCALE; the names live in
  `GET /config/v1/language/defaults` → `LICENSE.NAMES`. For the other five
  vocabularies `values` does carry captions (100 %), which is why the script has
  two legs. (2) `pattern: ""` lists everything and the documented `"-all-"`
  returns EMPTY. (3) `ccm:taxonid` mixes 345 Hochschulfächer with 71 Schulfächer,
  separable by URI — we mirror `/vocabs/discipline/` only, by the user's decision.
  (4) `ccm:commonlicense_version` is absent on 90 of 90 sampled CC records, not
  in `DISPLAY_PROPS` and not facetable, so no display label may carry a version;
  the versioned spellings stay as ALIASES so existing prompts keep resolving.
  Three defects fixed: `COPYRIGHT_FREE` read "urheberrechtsfrei", the OPPOSITE of
  what the repository means (12 445 records); three keys were unknown, costing
  both the label and the record's survival in `filterByExactLicense`
  (`COPYRIGHT_LICENSE` 1 359, `CC_BY_SA_NC` 497 — aliased onto `CC_BY_NC_SA`
  because it is a legacy spelling of one licence, not a second one —
  `UNTERRICHTS_UND_LEHRMEDIEN` 15); and every CC label asserted "4.0". What is
  deliberately NOT mirrored is named in the script's `NOT_MIRRORED` map with the
  reason (`MULTI` is not a licence but a statement about a set), because a report
  with permanent false positives stops being read. The corpus is pinned offline
  as `CORPUS_LICENSE_KEYS` in `tests/vocabs.test.ts` — 16 keys, their record
  counts, and what each must resolve to — rather than as a live test `npm test`
  could not run (`netguard`).

  The repository answers "which collections match this word?" through TWO
  unrelated indexes and **neither is a superset of the other** (measured
  2026-08-11, re-measure before contradicting): the mds `collections` query
  cannot return the collection `9e7ae956` ("Optik") for ANY search word — terms
  occurring only in its own keywords return zero hits there — while
  `GET /collection/v1/collections/-home-/search` returns it every time; and the
  mds query matches `ccm:oeh_collection_compendium_text`, which the second
  endpoint does not read (6 of 6 checked). Neither searches the materials inside
  a collection.

  `services/collection-search.ts` is the ONE place that knows there are two, and
  the three call sites (`services/search.ts`, `services/topic-page.ts`,
  `tools/collections.ts`) go through it — enforced by
  `tests/shared-rule-discipline.test.ts`, not by this sentence. Three rules bind
  any change. (1) The name leg's own nodes are DISCARDED: that endpoint ignores
  `propertyFilter` and answers with a fixed projection without
  `ccm:page_config_ref`, so adopting them files a Themenseite as an ordinary
  collection — the same trap the mds keyword endpoint sprang on 2026-07-17. It is
  an ID source; what it contributes is re-read with our projection, and an id
  that cannot be re-read is dropped rather than adopted half-projected. (2) It
  gets its OWN cap (`NAME_LEG_MAX = 5`), never the caller's: its latency scales
  with the result count (889/1275/2565 ms at 3/5/10 for "Mathematik") and at the
  caller's cap of 10 the first version TRIPLED the collections leg — 7–10 of its
  10 hits were new ids and each had to be re-read. The leg is a repair for
  records the index cannot return at any rank, and those rank high; 5 not 3
  because "Optik" sits at position 3 of that ranking. (3) Round-robin, not
  concatenation — same rule and reason as the licence bundle; `searchAll` reranks
  afterwards and overrides it, the other two call sites do not.

  Measured cost: +0.6 to +1.2 s on the collections leg (median of 5). Live-verified
  2026-08-11: `searchAll({query:'Optik'})` returns `9e7ae956` at position 1 of the
  **topicPages** bucket — it carries a `page_config_ref`, so that bucket is right.
  Noted while verifying and NOT changed here: `searchAll` drops every collection
  with a `topicPageUrl` from the collections bucket whether or not `topicPages`
  was requested, so `include: ['collections']` never shows a Themenseite.

- **Relay clients and the credential limiter — P1 COMPLETE (2026-08-12); P2
  designed, not built:** `docs/plans/2026-08-12-relay-credential-limiter.md`

  The guessing guard on `POST /mcp` bounds **distinct secrets per identity**, and
  which identity that is depends on the scheme: `Basic` per client ADDRESS, a
  `wlo2.` block per **`jti`**. One place holds it — `abuseBucketKey`
  (`auth/credential.ts`). Keying a block by address was wrong twice over, and
  both halves were measured: it refused a **relay client** (a chatbot backend
  serving many people from one address hit the cap at its 11th signed-in person,
  while anonymous callers kept working — a misleading signature), and it
  under-bounded a guesser, who multiplied their budget simply by rotating
  addresses (50 addresses = 500 tries; now 10 in one bucket).

  Two rules bind any change. **Do not exempt blocks from the counter** on the
  argument that they are "already proven": `AUTH.md` §4 — the public key is
  published, so whoever learns a `jti` can mint blocks carrying it with any
  password. And **the bucket key is never logged or returned** — for a block it
  IS the access id, the secret revocation hangs on; the refusal names its
  `scope` and the address instead.

  P2 (a session credential for a chatbot embedded INSIDE the repository) is
  designed in the same file and still unbuilt — but "no concrete embedding
  exists yet", the reason it was parked, stopped being true on 2026-08-12: the
  embedded case is served by the ticket block below, through a different
  mechanism. What P2 alone would still add is a host that cannot hand over a
  ticket either. The measurement it rests on is already in
  `2026-08-04-mcp-access-token-design.md` — a `JSESSIONID` DOES carry our
  endpoints; it was rejected as *block content* only because it has no lifetime,
  which is not a constraint for a host that has a live session per request. The
  invariant that must travel with it: the cookie branch belongs INSIDE
  `withCredential`'s repository-host check, not beside it.

- **Ticket-Tausch für eingebettete Widgets (`POST /auth/ticket`) — COMPLETE
  (2026-08-12); vollständig dokumentiert in `docs/AUTH.md` §5c:**

  An edu-sharing page that already knows who is signed in hands its widget that
  person's ticket (the `?ticket=…` convention the md-editor consumes in
  production). `auth/ticket-exchange.ts` proves it against the repository and
  wraps it in an ordinary `wlo2.` block carrying `k: 'ticket'`; from there
  NOTHING is special — same header, same registry, same revocation, and
  `credentialFromAccessBlock` rebuilds `EDU-TICKET <ticket>` upstream instead of
  `Basic`. Wrapping rather than letting the widget hold the raw ticket is the
  same reasoning that made blocks encrypt passwords: a block is useless anywhere
  except against this server, a raw ticket is a live repository credential.

  This is the THIRD mechanism tried for the embedded case and the first that
  works — do not re-derive the other two, they are measured in
  `2026-08-12-relay-credential-limiter.md`: the `JSESSIONID` relay of P2 above
  is dead for a widget (`HttpOnly` ⇒ no JavaScript can read it, no `SameSite`
  ⇒ a cross-site iframe carries nothing), and `appauth` is impersonation by
  design — whoever may call it may become anyone.

  Four rules bind any change here. (1) **The access id is a hash of the ticket**
  (`sha256('wlo-ticket:' + ticket)`), never random: an embedded widget exchanges
  on EVERY page load, so random ids would list a fresh entry each time until
  `MAX_BLOCKS_PER_LABEL` started evicting the person's OTHER blocks — the ones
  they pasted into their AI hosts. It stays a usable revocation secret because
  its only preimage is the ticket, and whoever holds that holds the stronger
  secret already. **That fixes the page load and not the session** (audit
  2026-08-13): the next session brings a new ticket, a new hash and a new entry,
  so a widget files about one per working day against a cap that counts
  deliberate acts — and ten days of it retired a pasted block, leaving a 401 that
  re-pasting could not cure. The entry therefore carries `k: 'ticket'`
  (`RegistryEntry`, mirroring `AccessPayload.k`) and **the cap applies per KIND**,
  one constant over two classes. `removeByLabel` is deliberately NOT split — a
  ticket block is as much of an access as a pasted one, and "everything revoked"
  over a widget that keeps working is a lie. (2) The registry is written **only when the id is not listed
  yet**, and that guard is not cosmetic: `add` ALWAYS commits (serialise, temp
  file, rename) and the registry is the one thing this server writes to disk at
  runtime, so without it every page load rewrote the file — the sole difference
  being a refreshed `iat`, while the first one is the more accurate record of
  when the access began. (3) The endpoint spends its **own** limiter budget
  (`TICKET_CREDENTIAL_LIMIT`, default 200) in its own buckets: a ticket is
  server-generated and unguessable, so counting distinct ones bounds nothing a
  password bucket bounds, and sharing `/auth/issue`'s budget would let one busy
  embedding spend the password-guessing quota. Where it is not wired, the
  fallback is the TIGHTER budget, deliberately. (4) `/auth/ticket` is the ONE
  exact-match carve-out from the no-CORS rule on `/auth*` (`isCredentialSurface`,
  `http-app.ts`) — it is called cross-origin by construction and no password is
  typed there; the carve-out is exact-match so `/auth/ticket-anything` cannot
  inherit it.

  What happens when the ticket DIES is measured (2026-08-13, staging) and needs
  no code of ours: `/iam/…/-me-` answers **404**, and search/node/children answer
  **500** `A valid SecureContext was not provided`. Never 200-as-guest — the fear
  worth testing, since a silently-guest credential is exactly what
  `auth/identity.ts` exists for. `ngsearch` throws on non-OK rather than
  degrading, so it reaches the caller as an error and not as "keine Treffer". Do
  not add an expiry of ours; the repository enforces one, visibly, on every call.
  The `401` `docs/AUTH.md` §5c claimed here was wrong and is corrected.

Per-package close-out (user protocol): at the end of EACH phase, update
`STATUS.md`, keep it linked here, then stop and let the user clear context
before the next package.

Read the design doc BEFORE implementing; execute the tasks in order and update
their checkboxes as work proceeds. Do not add tools/endpoints not listed there
without updating the plan first (a plan is a contract — see the workflow block).
Decisions already locked: adapt (not rebuild); base-SDK `_meta` seam for
Apps-SDK; vanilla-TS+esbuild widgets; `src/services/` seam for REST/widget
reuse; add ChatGPT `search`/`fetch` tools; Docker/vServer deploy with real SSE.

## Tech stack

- TypeScript (ESM, `module`/`moduleResolution` NodeNext, target ES2022,
  `strict: true`), Node >= 20.
- Runtime deps: `@modelcontextprotocol/sdk` (MCP server + stdio/HTTP transports),
  `zod` (tool input schemas). Deliberately minimal — no web framework.
- Dev: `tsx` (run TS directly), `typescript` (build), `esbuild` (widget bundle).
- Deploy target: **self-hosted persistent HTTP** (`src/http.ts`, Docker on the
  vServer); stdio (`src/stdio.ts`) for local use. There is no serverless target
  — the Vercel entry point was removed on 2026-08-02. Do not reason about
  serverless constraints (cold starts, per-request statelessness as a platform
  limit); the server is a long-lived process.

## Commands

- Build: `npm run build` (tsc → `dist/`)
- Test: `npm test` (→ `scripts/run-tests.mjs`, which expands the file list itself
  — Node 20 takes a `--test "tests/*.test.ts"` glob literally and runs nothing,
  and 20 is what `engines` and the Docker image ship). Single file:
  `node --import tsx --test tests/reranker.test.ts`. `npm test` additionally
  loads `tests/netguard.mjs`, which fails any unmocked non-loopback fetch, so a
  test that forgets `installFetchMock` is caught instead of silently going
  upstream; a single-file run has no such guard. `npm run test:coverage` runs the
  same suite with the runner's coverage report. `npm run test:live` runs
  `tests/live/*.test.ts` (write-contract tests against a REAL repository —
  staging only, enforced in the test file; needs the service credential from
  `.env`; never part of `npm test` or CI, which have no credential). It exists
  because the offline suite proves only that the code sends what we decided to
  send, never that the repository accepts it — the gap that cost
  `wlo_create_collection`/`wlo_rename_collection` their function in 2026-08.
- Dev (stdio): `npm run dev` — Dev (HTTP): `npm run dev:http`
- Start built: `npm start` (stdio) / `npm run start:http` (HTTP on `PORT`)
- Lint: `npm run lint` (ESLint, correctness rules only — see `eslint.config.mjs`;
  gated in CI). No formatter is configured; match surrounding style.

## Conventions

- ESM everywhere: intra-project imports MUST use the `.js` extension
  (`./tools/collections.js`) even though the source is `.ts` — NodeNext requires it.
- Each tool group lives in `src/tools/<area>.ts` and exports a
  `register<Area>Tool(s)(server)` function; `src/server.ts` assembles them and
  registration order = display order in `tools/list`.
- Tools return either Markdown or JSON (`outputFormat` param); a trailing
  `_queryMeta` text block carries machine-readable query context (see `shared.ts`).
- Tool-layer helpers live in `src/tools/shared.ts`: `toolError` (log + client
  error), `queryMetaContent`, `pickThemePageTitle`. Two helpers that started
  there are NOT there any more, because `services/` and `rest/` need them and a
  lower layer must not depend on `tools/`: `mapPool` (bounded-concurrency
  fan-out, returns `(R|null)[]` — filter nulls) is in `src/concurrency.ts`, and
  `buildFilterCriteria`/`formatUnresolvedHint` (label→URI vocab mapping) in
  `src/filter-criteria.ts`. The direction is enforced by
  `tests/shared-rule-discipline.test.ts`, not by this sentence.
- Config is env-only (`WLO_REPOSITORY_URL`, `PORT`, `RATE_LIMIT_RPM`, …); no secrets
  in code. See `.env.example`.
- Tests use the built-in `node:test` runner via tsx; upstream HTTP is faked with
  `tests/fetchMock.ts` — no live network in tests.

## Architecture

- `src/server.ts` — transport-agnostic `createMcpServer({ issuer })` factory; the
  only place tools are wired up. It takes NO write mode and no credential: every
  tool, curation included, is registered unconditionally, and the write gate runs
  at CALL time in `registerCurationTool`. (An earlier version did decide
  registration by write mode; that is what 2026-08-05 reversed, and the
  measurement is in the write-support block above — a tool nobody sees is a login
  nobody starts.) Two thin entry points connect a
  transport to it: `stdio.ts` (local/Docker) and `http.ts` (self-hosted
  Streamable HTTP + rate limit + body cap — the production path).
- `src/tools/*` — the 28 read tools (all unconditional, of which `get_url_text`
  is declared `unsafe` and removable via `WLO_DISABLE_UNSAFE_TOOLS`;
  `search` gains the `search_wlo_all` buckets + widget and `fetch` the full
  record + detail widget under `WLO_SEARCH_OUTPUT_MODE=rich`, off by default —
  the switch covers BOTH because `search`→`fetch` is one flow and enriching only
  the first step leaves the second rendering nothing. The convention gives each
  a SINGLE parameter, so output and display are the only part of
  `search_wlo_all`/`get_node_details` that can be copied at all, and whether a
  connector tolerates keys beside the required ones is unmeasured; the
  convention shape therefore stays first and untouched in both modes, pinned by
  `tests/tools-knowledge-rich.test.ts`;
  `search_skill` becomes `get_skill_for_task` under
  `WLO_SKILL_TOOL_MODE=one-tool`, while `get_skill` stays registered) plus the 14 curation tools (`curation-*.ts`,
  registered unconditionally and gated at call time; `curation-shared.ts` holds
  `registerCurationTool` (the gate + the `oauth2` declaration) and the
  two-step preview/confirm/report they share, `curation-fields.ts` the 13-field
  write surface both editing and proposing draw from), grouped by responsibility (collections,
  content-search, node-details, node-relations, vocabulary, topic-pages,
  topic-pages-present, topic-page-content, browse, compendium, wikipedia,
  collection-stats, health, knowledge, skills) + `shared.ts`.
  The Apps-SDK display tools are registered via `src/apps/register.ts`.
  A tool module holds its schema and its rendering, never an algorithm: bounded
  traversals a tool would otherwise inline live in `src/services/`
  (`collection-traversal.ts`, `topic-page-discovery.ts`).
  A tool that renders its own line-oriented text (browse tree, Fachportal list,
  Themenseiten listing, swimlane outline) must pass every repository-supplied
  value through `oneLine` from `formatter.ts` — a newline in a title otherwise
  forges a second record with a nodeId the next call acts on.
- `src/services/collection-search.ts` — "which collections match this word?",
  asked of BOTH repository backends and merged. The one place that knows there
  are two; see the plan entry above for the three rules that bind it.
- `src/services/write/*` — the shared write pipeline (gate → fields → change-set
  → confirm → verify). No MCP SDK import; every mutation goes through it, so the
  safety properties are tested once instead of per tool.
- `src/wlo-api.ts` — barrel over the edu-sharing REST client: `wlo-search.ts` +
  `wlo-node.ts` (endpoints), `wlo-config.ts` (env, `DISPLAY_PROPS`, URL
  sanitization), `wlo-types.ts` (`WloNode`/`SearchResponse`), and
  `wlo-node-text.ts` (`/textContent` + the anonymous download, byte-capped), and
  **`wlo-fetch.ts` — `wloFetch` plus the credential boundary**: the only place
  the operator's password is attached, and only ever to the repository host.
  `src/topic-page-api.ts` — topic-page discovery (repository I/O only);
  **`src/topic-page-variant.ts` — what a variant IS**: `TOPIC_PAGE_PROPS`,
  `ThemePageInfo`, `variantFields` (the ONE projection of a variant node onto
  its fields — a second copy fails `tests/shared-rule-discipline.test.ts`),
  `variantMatchesFilters`, `isUsableVariant`, `pickThemePageTitle`. Split out of
  `topic-page-api.ts` on 2026-08-11 at 389 lines: 8 of its 13 importers needed
  only this half, and one of them (`topic-page-title.ts`) closed an import cycle
  by moving. The property list and the projection live together because adding a
  field to one without the other reads back empty with nothing failing;
  `src/topic-page-structure.ts` — one page's variant → swimlanes;
  `src/topic-page-title.ts` — what may be SHOWN as a page's title. The rule is
  about the VALUE, not the property it came from: `cm:name` is
  `PAGE_VARIANT_<uuid>` by construction, `cm:title` holds it on 109/109
  production variants, and `cclom:title` — the field the code trusted — on
  **22/68 staging** ones, because a page nobody renamed keeps it everywhere. So
  every read from the repository passes through `displayTitleOrEmpty`, and every
  sentence a PERSON has to check names a variant through one rule (`nameOf` in
  `services/write/topic-page.ts`: real title, else the id) — the confirm token
  binds to that sentence, and a technical id is not something anyone can check.
  It is a leaf module and not `tools/shared.ts`, where it started, because
  `topic-page-variant.ts`, `topic-page-structure.ts` and
  `services/write/topic-page.ts` all need it and none may import from `tools/`.
  Since the 2026-08-11 split it imports NOTHING: `pickThemePageTitle` needed
  `ThemePageInfo` and so pointed back at the module that imports this one — the
  one cycle in this corner. It moved to `topic-page-variant.ts` beside the type,
  and `tools/shared.ts` re-exports it unchanged;
  `src/topic-page-config.ts` — the `ccm:page_config` document (which variant a
  page renders, and in which order) — the page builder's schema, which changes
  independently of edu-sharing's endpoints.
  Four rules here rest on measurements in
  `docs/plans/2026-08-07-topic-page-variants-analysis.md` — re-measure before
  contradicting any of them. (1) `targetGroup`/`educationalContext` are filtered
  LOCALLY and an unset value is never excluded (`variantMatchesFilters`, the one
  place the rule lives): ~90 % of production variants carry neither, so an
  upstream filter hides pages instead of narrowing them, and
  `virtual:page_variant_global: ['false']` is a no-op, not an alternative flag.
  (2) Which variant a page RENDERS comes from `ccm:page_config` on the
  page-config folder (`default`, else the first still-existing entry of
  `variants[]`) — not from the child order, which agreed only by accident, and
  not from the target group, because siblings are mostly editorial copies.
  (3) A collection may own SEVERAL page-config folders: group by folder (the only
  key a search hit carries), but count distinct OWNERS, and only the folder named
  by the owner's `ccm:page_config_ref` can hold the rendering variant. Both (3)
  defects were invisible to `fetchMock` and appeared on the first live run.
  (4) **`variantPreset` is not `targetGroup`, and must never stand in for it**
  (measured 2026-08-11, §3b). A variant may carry a `variables` block in
  `ccm:page_variant_config` holding the profile selector's INITIAL state —
  `virtual:profiling_widget_intention` (`teach`/`learn`) and
  `…_education_level` (educationalContext URIs, **comma-joined in ONE string**,
  not an array). That is the mechanism behind "land on the page, then pick
  Lehrkraft + Sek I": not a variant switch, and not a swimlane filter — 0 grid
  cells reference a variable. It is better filled than the official fields
  (25/69 and 32/69 against 17/69 and 21/69), which is exactly the trap: the two
  sources overlap on 1 resp. 2 of 69 variants and **disagree in 3 of 3** of
  those. Merging them raises the reported coverage and lowers the truth. It is
  parsed in one place (`parseVariantPreset`, `topic-page-config.ts`), carried as
  its own field through both variant projections, and `virtual:profiling_target_group`
  is deliberately ignored — both variants that carry it hold the full
  `["learner","teacher","general"]`, i.e. the selector's OPTION LIST.
- `src/wikipedia-api.ts` + **`src/wikipedia-relevance.ts`** — the encyclopedia
  client and the rule that decides which fuzzy search candidate a query is about.
  A direct/redirect hit is trusted (`match: 'exact'`); only search candidates are
  judged, and an off-topic one yields no article at all rather than the closest
  string. Design + the live measurement behind it:
  `docs/plans/2026-08-02-wikipedia-relevance.md` — do not re-derive the rules
  without a new measurement.
- `src/formatter.ts` — node → Markdown/JSON rendering. `src/reranker.ts` —
  quality-based reranking for `enhancedSearch` (query variants live in
  `src/query-expand.ts`). `src/node-match.ts` — local text/criteria matching for
  /children fallbacks. `src/filter-criteria.ts` additionally owns the LICENCE
  rules, and both rest on a measurement (2026-08-09, re-measure before
  contradicting): `ccm:commonlicense_key` matches a licence FAMILY, not a licence
  — `CC_BY` returns 343 hits for "Optik" including CC BY-ND and CC BY-NC-ND, and
  quoting changes nothing, so plain CC BY is the one licence that cannot be
  isolated upstream and the surplus is MORE restrictive than requested.
  `filterByExactLicense` therefore enforces exactness locally, and
  `pageSizeForLicense` widens the candidate window to 50 only when a licence is
  filtered — without it the pass starved and answered "0 Treffer" for a filter
  with 343 hits behind it. `enhancedSearch` ignores its size argument for the
  upstream request (always `POOL_SIZE` per query variant, then trims the ranked
  merge), so the widening is invisible in `maxItems`.
  `src/result-dedupe.ts` — the ONE rule for collapsing
  content hits that share an external URL, used by both independent search paths
  (`searchAll` and `search_wlo_content`) and enforced by
  `tests/shared-rule-discipline.test.ts`. It deduplicates on `ccm:wwwurl`, NOT on
  `ccm:original`: measured 2026-08-09, the eight `Wellenoptik` copies were eight
  separate records each owning itself, so the `ccm:original` rule collapses
  nothing there. The FIRST hit wins, not the newest — the newest was an untouched
  `1.0` copy while the only edited record (`1.2`) was the oldest, and neither
  date nor version is in the search projection. Dedupe runs before the result
  cap; the page is NOT widened to compensate, so a copy-heavy query returns fewer
  results while `total` still reports the real backend count. `src/vocabs.ts` — local vocabulary label↔URI tables (no
  API call). `src/text-sanitize.ts` — makes foreign text safe to embed where it
  carries elevated authority (injected user messages, confirm previews): drops
  invisible Unicode and flattens control characters (`flattenText`), plus a
  length cap (`sanitizeText`). Use `sanitizeText` for ONE foreign value and
  `flattenText` for a sentence assembled from parts already capped — capping an
  assembled sentence again spends the 120-char budget on fixed prose and cuts the
  facts (it truncated confirm previews mid-word until 2026-08-04).
  `src/url-safety.ts` — whether a URL may be handed to a service that will
  fetch it: the literal private-host rule (incl. IPv4-mapped IPv6) plus a
  DNS-resolution check. `src/unsafe-tools.ts` — the operator's off-switch for
  tools that declare `unsafe`; the gate itself sits in `apps/register.ts`, the
  one seam every tool passes through. `src/text-cap.ts` — the shared truncation
  rule (cut at a word boundary, disclose the full length): `capText` for a text
  block, `cutAtWordBoundary` when the caller needs its own marker (the
  confirmation preview is line-oriented, so `\n\n[…gekürzt]` would forge a change
  line), and the exported `TRUNCATION_MARKER` for the byte-capped download, which
  cannot use a character-based cap at all. The ONLY module that may write that
  marker.
  `src/read-json.ts` — the one place an upstream body is parsed: `res.ok` says
  the server answered, not that the body is JSON, so every client goes through
  it and each decides whether a parse failure degrades or throws.
  Both of those "only place" claims are enforced by
  `tests/shared-rule-discipline.test.ts` rather than asserted here — each was
  found violated by modules written after the helper existed (6 and 1
  respectively). A unit test of a helper proves the helper is right and says
  nothing about whether anyone uses it.
  `src/request-url.ts` — the one place an inbound request target is parsed.
  node:http accepts targets `new URL()` refuses (`//[`), and three layers used
  to parse the same `req.url` with only the first one guarded; the throw moved
  down a layer, escaped the handler, and the caller got no answer at all.
  `src/logger.ts`, `src/rate-limit.ts`, `src/read-body.ts` — support.
- `docs/plans/` — design documents, including the
  [full-codebase review plan](docs/plans/2026-08-02-full-review-plan.md) (12
  packages, R1–R12) and its live progress table.
