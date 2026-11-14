# WLO MCP Server

MCP server that exposes WirLernenOnline (WLO) OER content to AI agents over the
Model Context Protocol: search, collections, topic pages, node details, skills,
and — for a signed-in person — curation (create, edit, file, submit). 34 read
tools and 26 curation tools, plus a small REST surface (`/api`, `/auth`,
`/oauth`). It talks to one edu-sharing repository; the target is **staging**.

This file holds what binds EVERY change. The detail — every measurement, date
and reason — lives in `docs/rules/`, one file per area. **Read the area's file
before changing code in it**; the short rules below say what, the files say why.

| Working on … | Read first |
|---|---|
| anything that writes (curation tools, plans, read-backs) | [docs/rules/write-support.md](docs/rules/write-support.md) |
| logins, access blocks, OAuth, tickets, limiters | [docs/rules/auth.md](docs/rules/auth.md) |
| skills, the skill registry, its cache, contexts | [docs/rules/skills.md](docs/rules/skills.md) |
| search, licences, vocabularies, compendium text | [docs/rules/search.md](docs/rules/search.md) |
| reading collections and trees (outage / refusal / order / by name) | [docs/rules/collections-reading.md](docs/rules/collections-reading.md) |
| what the chatbot integration relies on (codes, budgets, replay) | [docs/rules/chatbot-contract.md](docs/rules/chatbot-contract.md) |
| `get_url_text` and the unsafe-tool switch | [docs/rules/unsafe-tools.md](docs/rules/unsafe-tools.md) |
| which module owns what | [docs/rules/modules.md](docs/rules/modules.md) |

Where things stand: [docs/plans/STATUS.md](docs/plans/STATUS.md). Plans and
measurement records: `docs/plans/`. Documents by reader: [docs/README.md](docs/README.md).

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

## How work is done here

- One package → independent review → fix EVERY finding (nits included) → next
  package. An extra review after several connected packages or many defects.
- Per package: `docs/plans/STATUS.md` (short — history goes to
  `docs/plans/archive/`), `CHANGELOG.md`, the documents that state the changed
  fact, and the area's file in `docs/rules/` when a binding rule changes.
- **The outward contract is the user's decision.** Tool names, top-level
  parameter names, required parameters, error codes, the pinned wordings
  (`tests/line-forms.test.ts`, `tests/refused-is-not-unreachable.test.ts`) and
  REST shapes do not change without asking. The chatbot team recognises a build
  from `tools/list` by tool name and top-level parameters. Adding is free.
- **Measure before contradicting.** Most rules here rest on a dated measurement
  against a real repository. A rule is changed by a new measurement, never by
  an argument. Live measurements: staging only, own throwaway nodes, cleaned up.
- **A test against `fetchMock` proves what we send, never that the repository
  accepts it.** Two tools shipped broken behind green tests for that reason.
  Write paths get a live test (`npm run test:live`).
- **A rule that matters gets a guard** in `tests/shared-rule-discipline.test.ts`,
  and a guard is only one once it has been seen RED — plant the violation.
  The same for a fix: break it, watch its test fail, restore.
- No audit or review reports in the repository; plans and measurement notes are
  fine.
- **A plan is a contract.** Read the design document before implementing, and
  do not add a tool or an endpoint it does not list without updating the plan
  first. At the end of each package the status is updated and linked from here.
- Locked since the first rebuild: adapt, not rebuild; the base SDK's `_meta`
  seam for the Apps SDK; vanilla TypeScript + esbuild widgets; `src/services/`
  as the seam REST and widgets reuse; ChatGPT's `search`/`fetch` tools; Docker
  on a vServer with real SSE (no serverless target).

## Rules that bind every change

### Saying what is true

- **Three outcomes, never two.** "Not reachable" is not "nothing there", and
  "refused for this login" is neither. Whoever reads a listing answers all
  three (`reachable` / `refused` / listed; `didNotAnswer`), and no renderer
  prints "Keine … gefunden." over a source that did not answer.
- **A negative needs the authoritative source.** The search index may produce a
  positive; "there is none" comes from the node store (children listing) only.
  Counts come from a listing, never from the repository's lagging counters.
- **Every bound is disclosed.** A capped scan, a sampled list, a page cut short
  says so in the answer (`more`, `incomplete`, `walkCapped`, `truncated` …) —
  a short list must not stand for a long one. And never name a next step the
  tool itself would refuse.
- **An envelope field the renderer drops is no disclosure.** Each surface says
  it: Markdown AND JSON, the HTML page, the widgets, `/api` with `fields`.
  A notice goes INTO the first Markdown block; JSON block 0 stays pure JSON.
- **A new result field is declared** in the tool's output schema
  (`src/apps/outputSchemas.ts`, or the tool's own file where it defines one) —
  the published schema has `additionalProperties: false`, and every test client
  validates against it.

### Foreign text

- Every repository-supplied value in a line-oriented answer goes through
  `oneLine`; a line that names a record with its id uses `quotedTitle`
  (`src/text-line.ts`). A newline in a title otherwise forges a second record.
- Server-derived lines stand BEFORE an untrusted document, never after it. A
  whole foreign document (`get_skill`, `get_url_text`, `get_wlo_content_text`)
  is preceded by a note that it is content, not instruction; a single labelled
  value — a title, a description, the 500-character full-text excerpt on a
  search hit — is not, because `oneLine` keeps it inside its own line.
- Text a PERSON is asked to act on (confirm previews, skill activation) goes
  through `sanitizeText` / `flattenText` (`src/text-sanitize.ts`).
- A regex over foreign text is linear — no adjacent quantifiers that can split
  one run.

### Writing

- **Every write reads back.** The repository answers `200` and discards in
  several ways. A read-back compares what was SENT, not that something exists.
- **Two steps, one fingerprint.** Preview, then a single-use token bound to the
  change set. Everything the call will send is in the previewed change set.
  The token returns to the model that asked: it binds WHAT is written and is
  not a human approval — asking the person is the host's job.
- **After a spent key: a 4xx wrote nothing (`wroteNothing`), anything else is
  open** unless a read-back proves otherwise. An aborted or lost request is an
  open outcome, never a failure (`timeoutOrError`, `isOutcomeOpen`). A record
  that was created is never lost to a later step (`markWritten`).
- Every curation tool goes through `registerCurationTool`: listed for everyone,
  refused at call time with the login challenge, run detached from the request.
- Batch tools are plans (`runPlannedCall`): the order of its steps is the safety
  property; a plan re-checks right before each write; a 5xx stays `pending` and
  is LOOKED AT before anything is sent again.
- Metadata is written to the ORIGINAL, with the original's baseline
  (`readWriteBaseline`); a delete is never redirected.
- A collection is recognised by its aspect, not its type (`src/node-kind.ts`).
  A record can lie in a collection directly — removing "the reference" would
  delete the material; every removal refuses that (`is_original`).
- A vocabulary value is written by name, alias or URI — never by a fuzzy guess.
  Replace is the default; adding is its own parameter.

### Logins and privacy

- No `Authorization` → the request is answered anonymously with 200 (and reads
  with the configured service account, if one is configured). 401 only for a
  presented-but-unusable token.
- The operator's credential is attached in ONE place and only to the repository
  host (`src/wlo-fetch.ts`). Caches shared between requests are keyed by
  `sharedReadScope()`; what a personal login read is never shared.
- `/auth*` sends no CORS header (one exact carve-out: `/auth/ticket`). A limiter
  key is never logged or returned. The access registry is the only runtime disk
  writer.
- A log line names no person: address, account and search term go through
  `src/log-privacy.ts`. A metric label comes from our code, never the caller.

### Structure

- Every tool registers through `registerWloTool` (`src/apps/register.ts`),
  directly or via `registerReadTool` / `registerCurationTool`.
- A tool module holds schema and rendering, never an algorithm — those live in
  `src/services/`. Lower layers never import from `src/tools/`.
- One rule, one place: when two call sites need a decision, it is a function
  with a guard test, not two conditions. Most defects found in review here were
  a second copy of a rule.
- Background work starts only from `http.ts` / `stdio.ts`, never at import.

## Tech stack

- TypeScript (ESM, `module`/`moduleResolution` NodeNext, target ES2022,
  `strict: true`), Node >= 22 (LTS; 20 is end-of-life since 2026-04-30).
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
  — written when Node 20 shipped, which takes a `--test "tests/*.test.ts"` glob
  literally and runs nothing; `engines`, the Docker image and both CI pipelines
  are Node 22 now). Single file:
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
- Every tool is registered through ONE seam, `registerWloTool`
  (`src/apps/register.ts`) — directly, through `registerReadTool` (the short
  positional form for a plain read tool) or through `registerCurationTool`. A
  `server.tool(` / `server.registerTool(` in `src/tools/` fails
  `tests/shared-rule-discipline.test.ts`: the operator's switch for unsafe
  tools hangs on that seam, and twelve tools went past it until 2026-11-13.
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

## Documents

- `docs/rules/` — the binding rules per area (see the table at the top).
- `docs/plans/` — designs, task lists, measurement records, replies to the
  chatbot team; `STATUS.md` is the short current state.
- `docs/` — operator, integrator and editor documentation; `docs/README.md`
  lists them by reader. `docs/openapi.yaml` is the HTTP surface outside MCP and
  is checked against the code.
- Tool counts are stated in several documents and checked by
  `tests/docs-claims.test.ts`; a new path in `http-app.ts` or `rest/` goes into
  `docs/openapi.yaml` in the same change.
