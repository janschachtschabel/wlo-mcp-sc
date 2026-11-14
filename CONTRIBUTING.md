# Contributing

> 🇬🇧 English (canonical) · 🇩🇪 [Deutsche Fassung](CONTRIBUTING.de.md)

A short guide for changes to this repository. Goal: small, verified,
readable changes that keep the project maintainable.

## Workflow

1. Before coding: read the affected files, plan the smallest sensible change.
2. For new logic or bug fixes: **test first** (`node:test`) — see it red, then green.
3. Before "done": run all four gates below — green, and read the output. These are
   exactly what CI runs, so a red one here is a red PR there.
4. Keep docs (README, CHANGELOG, comments) in sync in the same change.

```bash
npm install
npm run build      # tsc (strict)
npm run typecheck  # type gate over src + tests + widget entry points
npm run lint       # ESLint, correctness rules only
npm test           # offline suite (node:test), no network required
```

`npm run test:live` exists too and is deliberately **not** one of the gates: it
drives real writes against the staging repository and needs a service credential
from `.env`, which CI has not got. Run it when you change the write pipeline —
the offline suite fakes the upstream, so it proves what we send, never what the
repository accepts.

"No network required" is enforced, not just intended: `npm test` loads
`tests/netguard.mjs`, which fails any fetch to a non-loopback host that no
`installFetchMock` intercepted. If you see `netguard: the test suite must not
reach the network`, the test under it is missing its mock — a real upstream call
makes the suite depend on a live repository and can make a test pass for the
wrong reason (an assertion that only checks "something failed" cannot tell a
validation error from a connection error).

## Language

- **Code identifiers** (variables, functions, types): English.
- **Code comments** (`//`, `/* */`, JSDoc): **English.**
- **User-facing product strings** — tool descriptions passed to `registerWloTool(...)` / `registerReadTool(...)`,
  parameter `.describe(...)` texts, and runtime output (`Beschreibung:`,
  `Keine Sammlungen gefunden`, error messages) — are intentionally **German**:
  WLO is a German-language platform and these strings are seen by end users and
  the LLM. Do not translate them without a product decision.
- Domain proper nouns (`Sammlung`, `Themenseite`) may stay German inside English
  comments — they are WLO concepts.
- Comments explain **why**, not what the code plainly does.

## Documentation

Start at [`docs/README.md`](docs/README.md) — it says which document answers
what, for whom, and in which language.

The tool table exists **by hand in six documents** (`README.md`, `README.de.md`,
`docs/TOOLS.md`, `docs/TOOLS-KOMPAKT.md`, `docs/INTEGRATION.md`,
`docs/MCP-REFERENZ.md`). When you add, rename or remove a tool:

1. `npm run docs:tools` prints every registered tool with the first sentence of
   its description, as a Markdown table, straight from the server
   (`WLO_BATCH_UPLOAD_ENABLED=1 npm run docs:tools` includes the batch tools).
   Copy the row from there rather than writing it from memory.
2. Add it to all six documents and correct the counts they state.
3. `node --import tsx --test tests/docs-claims.test.ts` fails for any of the six
   that does not name a registered tool, and for a stated count the server
   contradicts.

`npm run dump:tools` prints the full `tools/list` answer as JSON (schemas
included) when you need more than the summary.

## Tests

- Only mock external boundaries (network via `tests/fetchMock.ts`), never the
  unit under test.
- Tests are deterministic (no `Date.now()`/randomness/timing dependence without
  need — inject the clock, as the rate-limiter tests do).
- Never weaken or skip a test just to make the suite green.
- Prefer testing observable behavior through the public API over internals.

## Security

- No secrets in source — everything via env.
- Validate external input at trust boundaries (the tools' zod schemas).
- URL-encode IDs before interpolating them into URLs (`encodeURIComponent`).
- Route all upstream requests through `wloFetch` (enforces the timeout).
- Log only via `src/logger.ts` (JSON lines; stderr under stdio, where stdout
  belongs to the MCP framing — stdout over HTTP).

## Commits

- [Conventional Commits](https://www.conventionalcommits.org/): `feat:`, `fix:`,
  `refactor:`, `test:`, `docs:`, `chore:`, `ci:`, `build:`.
- One logical change per commit; do not bundle feature + refactor + formatting sweeps.
- Do not commit debug output, commented-out code, or secrets.

## Environment variables

Always document a new env variable in **both** `README.md` (table) **and**
`.env.example`.

## Dependencies

The runtime surface is deliberately two packages (`@modelcontextprotocol/sdk`,
`zod`). Before adding a third, check whether the standard library, an existing
dependency, or existing project code already covers it.

The two runtime packages are pinned to a **patch range** (`~`), and Dependabot
opens a pull request for each of them separately instead of grouping them: the
code leans on their internals — `src/apps/output-schema.ts` reads zod's
`_zod.def` and hooks into its `toJSONSchema`, and several rules rest on measured
behaviour of one SDK version (a stateless server answering `tools/call` without
`initialize`, how `structuredContent` is validated). A minor update of either is
a change to read and test, not a routine bump.

In-range updates of the development packages (`npm update`) are routine. Two
majors are held back on purpose — reopen them as their own change with its own
test run, not as a side effect of unrelated work:

| Package | Held at | Why |
|---|---|---|
| `@types/node` | 22.x | Must describe the OLDEST supported runtime (`engines.node: ">=22.12.0"`). Newer types would let code typecheck against APIs Node 22 does not have. |
| `typescript` | 5.x | A compiler major; upgrade it deliberately, with the full suite and the build as the gate. |
