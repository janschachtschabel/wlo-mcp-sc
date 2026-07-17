# Contributing

> 🇬🇧 English (canonical) · 🇩🇪 [Deutsche Fassung](CONTRIBUTING.de.md)

A short guide for changes to this repository. Goal: small, verified,
readable changes that keep the project maintainable.

## Workflow

1. Before coding: read the affected files, plan the smallest sensible change.
2. For new logic or bug fixes: **test first** (`node:test`) — see it red, then green.
3. Before "done": run `npm run build` **and** `npm test` — both green, read the output.
4. Keep docs (README, CHANGELOG, comments) in sync in the same change.

```bash
npm install
npm run build   # tsc (strict)
npm test        # offline suite (node:test), no network required
```

## Language

- **Code identifiers** (variables, functions, types): English.
- **Code comments** (`//`, `/* */`, JSDoc): **English.**
- **User-facing product strings** — tool descriptions passed to `server.tool(...)`,
  parameter `.describe(...)` texts, and runtime output (`Beschreibung:`,
  `Keine Sammlungen gefunden`, error messages) — are intentionally **German**:
  WLO is a German-language platform and these strings are seen by end users and
  the LLM. Do not translate them without a product decision.
- Domain proper nouns (`Sammlung`, `Themenseite`) may stay German inside English
  comments — they are WLO concepts.
- Comments explain **why**, not what the code plainly does.

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
- Log only via `src/logger.ts` (JSON to **stderr** — stdout belongs to the MCP
  stdio framing).

## Commits

- [Conventional Commits](https://www.conventionalcommits.org/): `feat:`, `fix:`,
  `refactor:`, `test:`, `docs:`, `chore:`, `ci:`, `build:`.
- One logical change per commit; do not bundle feature + refactor + formatting sweeps.
- Do not commit debug output, commented-out code, or secrets.

## Environment variables

Always document a new env variable in **both** `README.md` (table) **and**
`.env.example`.
