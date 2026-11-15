# Design: URL-based full-text tool + a generic "unsafe tool" switch

Status: **planned** (not implemented). Date: 2026-08-03.
Tasks: [`2026-08-03-url-text-tool-tasks.md`](2026-08-03-url-text-tool-tasks.md).

## Goal

Give a model (and through it a user) a way to read the text behind an arbitrary
web URL, and give the operator a generic way to switch off tools that are
declared unsafe — with documentation that recommends against running this one in
production.

## Context

Today the text-extraction service has exactly one caller: `content-text.ts`
falls back to it when edu-sharing's own `/textContent` holds nothing and the
record carries a `ccm:wwwurl`. The URL therefore always comes from a curated
repository field. There is no path for a URL that a user or the model supplies —
`get_wlo_content_text` accepts only a `nodeId`.

Measured 2026-08-03 against the staging extraction service: 19 of 22 external
pages returned 200 with 1 000–10 000 characters in 1.4–3.6 s; the three failures
were podcast audio files, where the service correctly answers 424 "No content
was extracted". The service is built on Playwright and has known crawling gaps
(protected/paywalled pages, bot detection), so a call can fail for reasons that
have nothing to do with our code.

Two things change with a free URL:

1. **The input becomes attacker-controlled.** `ccm:wwwurl` is set by a curator;
   a tool argument is set by whoever is talking to the model. The existing
   `isPrivateHost` guard checks the *literal* hostname only — its own comment
   says so — which is a narrow gap for curated data and a wide one here.
2. **The tool cannot promise a result.** Crawling gaps mean "no text" is a
   normal outcome, not an error.

## Scope

**In scope**

- One new read tool, `get_url_text`: URL in, text out.
- A generic mechanism by which a tool declares itself `unsafe` (with a reason)
  and the operator can switch off unsafe tools via one env variable.
- A stronger URL check for the new tool: literal host **plus** DNS resolution of
  the host, refusing any address that resolves into a private range.
- Documentation in README (EN/DE), `docs/DEPLOYMENT.md`, `.env.example`,
  `docker-compose.yml`, CHANGELOG and CLAUDE.md, including the explicit
  recommendation not to run the tool in production.

**Out of scope**

- Feeding the extracted text into the curation/write path (creating a WLO record
  from a URL). Decided 2026-08-03: that is its own package, because it touches
  the write pipeline's confirm/read-back rules.
- A widget for the new tool.
- A generic *deny*-list for arbitrary (safe) tools. Decided 2026-08-03: the
  mechanism covers tools declared unsafe; a knob for switching off harmless
  tools has no requester.
- Any in-process HTML/PDF conversion. Unchanged from `content-text.ts`: it would
  be CPU-bound and block the single Node thread.

## Decisions taken (2026-08-03)

| Question | Decision | Consequence |
|---|---|---|
| Default state | **Registered by default, switchable off** | The env variable is a *disable* list, so its name is `WLO_DISABLE_UNSAFE_TOOLS`, not `…ENABLE…`. A deployment that never heard of the variable serves the tool — the documentation warning is therefore not enough on its own, and a startup **warning** naming every registered unsafe tool is part of this design. |
| Mechanism | **Generic over tools declared unsafe** | `WloToolDef` gains `unsafe?: { reason: string }`; the registration seam skips such tools when disabled. A second unsafe tool costs one field, not a new concept. |
| SSRF depth | **Literal host + DNS resolution** | See "Non-functional → Security". The redirect part of that answer cannot be honoured at this layer — see Risks R1. |
| Reuse of the text | **Return it; the model works with it** | A pure read tool. |
| What exactly is unsafe | **Extraction of an ARBITRARY internet page**, i.e. `get_url_text`. Extraction driven by `ccm:wwwurl` is **not** | The existing fallback in `services/content-text.ts` keeps working unconditionally and is never gated by the switch. Its URL comes from a curated repository field, so the caller cannot choose the target — which is the entire difference. Switching unsafe tools off must not cost `get_wlo_content_text` its fallback. |
| Shipped configuration (added 2026-08-03, after P1) | **The code default stays "registered", but `.env.example` and `docker-compose.yml` ship `WLO_DISABLE_UNSAFE_TOOLS=all`** | Two layers, deliberately. The code answers "what happens when nobody configured anything" with *on*, as decided above; the shipped configuration answers "what does a real deployment get" with *off*, because there is no control over what the tool fetches yet (no resolution-time enforcement in the extraction service — R1). An operator who wants it turns it on by name and can see in the file that they did. |

## Approach

Three approaches were considered for the switch:

**A — one variable per unsafe tool** (`WLO_ENABLE_URL_TEXT_TOOL`).
Least code. Rejected: the second unsafe tool starts from zero, which is the
outcome the request explicitly named.

**B — declaration on the tool + one env variable (chosen).**
A tool carries `unsafe: { reason }`. `registerWloTool` — already the single seam
through which every tool is registered — skips it when the operator disabled it.
Generic, one place, and the reason travels with the declaration so it can be
logged and shown in the tool description.

**C — a registry/policy module listing tool names and risk classes.**
Rejected as speculative: it invents risk classes nobody asked for, and it
separates "this tool is unsafe" from the tool, where it drifts.

For the URL check, the addition is to validate the **resolved addresses** as
well as the hostname string, so that an ordinary-looking name whose A record
points inside (`internal.example.com → 10.0.0.5`) is refused.

**Corrected 2026-08-03 by measurement** — the plan originally claimed the DNS
check would also cover odd IP spellings. It does not, and the truth splits:

- Decimal and hex IPv4 literals (`http://2130706433/`, `http://0x7f.0.0.1/`)
  never reach a DNS lookup: `new URL()` normalises both to hostname `127.0.0.1`,
  so the *literal* check already caught them. `dns.lookup('2130706433')` in fact
  answers `ENOTFOUND`.
- IPv4-mapped IPv6 was a **real hole in the literal check, live today** — and
  the DNS check would not have closed it either. `new URL()` rewrites
  `http://[::ffff:127.0.0.1]/` to hostname `[::ffff:7f00:1]`; the dotted quad is
  gone before any check runs, and the IPv6 branch does not know that `7f00:1`
  is 127.0.0.1. Fixed where it belongs, inside `isPrivateHost`, by unwrapping
  the mapped address in both spellings (`::ffff:10.0.0.1` from DNS,
  `::ffff:a00:1` from `new URL()`) before judging it.

That hole was reachable through the EXISTING `ccm:wwwurl` path, not only through
the planned tool: anyone able to set that field could have pointed the
extraction service at its own loopback.

## Global constraints

Copied from CLAUDE.md; every task respects them.

- ESM, NodeNext: intra-project imports carry the `.js` extension.
- No new runtime dependency. The DNS check uses `node:dns/promises` (stdlib).
- Each tool group lives in `src/tools/<area>.ts` and exports
  `register<Area>Tool(s)(server)`; `src/server.ts` is the only place tools are
  wired up, and registration order is display order.
- A tool module holds its schema and its rendering, never an algorithm —
  algorithms live in `src/services/`.
- Tests use `node:test` via tsx; upstream HTTP is faked with `tests/fetchMock.ts`;
  `npm test` now fails any unmocked non-loopback fetch (`tests/netguard.mjs`).
- Config is env-only; every new variable must appear in `.env.example` **and**
  in `docker-compose.yml` (enforced by `tests/deploy-env-passthrough.test.ts`).
- Code, comments and docs in English; tool descriptions may be bilingual.

## Architecture

### Files

| File | Create/Modify | Responsibility |
|---|---|---|
| `src/text-cap.ts` | create | `capText(text, maxChars)` → `{ text, charCount, truncated }`. Extracted verbatim from the private `cap()` in `content-text.ts` so both callers share one truncation rule. |
| `src/url-safety.ts` | create | `isPrivateHost(hostname)` (moved from `text-extraction-api.ts`) and `resolvesToPrivateAddress(hostname)` (new, DNS). The one place "is this URL safe to hand to a fetching service" is decided. |
| `src/unsafe-tools.ts` | create | Parses `WLO_DISABLE_UNSAFE_TOOLS`; exports `isUnsafeToolDisabled(name)`. Leaf module, no project imports beyond `logger.js`. |
| `src/apps/register.ts` | modify | `WloToolDef.unsafe?: { reason: string }`; `registerWloTool` skips a disabled unsafe tool and logs the decision either way. |
| `src/services/url-text.ts` | create | `getUrlText(url, method, maxChars)` — the algorithm: validate → resolve → extract → cap. No MCP import. |
| `src/tools/url-text.ts` | create | `registerUrlTextTool(server)` — schema, description, rendering. |
| `src/apps/outputSchemas.ts` | modify | `urlTextSchema`. |
| `src/text-extraction-api.ts` | modify | Import `isPrivateHost` from `url-safety.ts` instead of defining it. |
| `src/services/content-text.ts` | modify | Use `capText` from `text-cap.ts`. |
| `src/server.ts` | modify | Register the new tool. |
| `.env.example`, `docker-compose.yml` | modify | `WLO_DISABLE_UNSAFE_TOOLS`. |
| `README.md`, `README.de.md`, `docs/DEPLOYMENT.md`, `CHANGELOG.md`, `CLAUDE.md` | modify | Documentation, incl. the production warning. |

No planned file exceeds ~300 lines: `url-safety.ts` ≈ 90, `unsafe-tools.ts` ≈ 45,
`services/url-text.ts` ≈ 80, `tools/url-text.ts` ≈ 90, `text-cap.ts` ≈ 25.

### Data flow

```
tools/url-text.ts  (schema, description, markdown/json rendering)
        │  getUrlText(url, method, maxChars)
        ▼
services/url-text.ts
        │ 1. new URL(url), require http(s)                  → refuse: not_http
        │ 2. isPrivateHost(hostname)          url-safety.ts  → refuse: private_host
        │ 3. resolvesToPrivateAddress(host)   url-safety.ts  → refuse: private_host / dns_failed
        │ 4. extractTextFromUrl(url, method)  text-extraction-api.ts → wloFetch → service
        │ 5. capText(text, maxChars)          text-cap.ts
        ▼
   { url, text, charCount, truncated, reason? }
```

Registration gate, orthogonal to the flow:

```
server.ts → registerUrlTextTool → registerWloTool({ …, unsafe: { reason } })
                                        │
                                        ├─ isUnsafeToolDisabled(name) → skip + log.info
                                        └─ otherwise                  → register + log.warn
```

### Interfaces

```ts
// src/text-cap.ts
export interface CappedText { text: string; charCount: number; truncated: boolean }
export function capText(text: string, maxChars: number): CappedText;

// src/url-safety.ts
export function isPrivateHost(hostname: string): boolean;
export function resolvesToPrivateAddress(hostname: string): Promise<'public' | 'private' | 'unresolvable'>;

// src/unsafe-tools.ts
export function isUnsafeToolDisabled(name: string): boolean;

// src/apps/register.ts  (added field)
export interface WloToolDef {
  /** Declares the tool unsafe: it is registered by default but the operator can
   *  switch it off with WLO_DISABLE_UNSAFE_TOOLS. The reason is logged at
   *  startup and belongs in the tool description too. */
  unsafe?: { reason: string };
}

// src/services/url-text.ts
export type UrlTextMiss = 'not_http' | 'private_host' | 'dns_failed' | 'extraction_failed';
export interface UrlText {
  url: string;
  text: string;
  charCount: number;
  truncated: boolean;
  reason?: UrlTextMiss;
}
export function getUrlText(url: string, method: 'browser' | 'simple', maxChars: number): Promise<UrlText>;

// src/tools/url-text.ts
export function registerUrlTextTool(server: McpServer): void;
```

### Data model

No persistence. `urlTextSchema` mirrors `UrlText`.

### Dependencies

None added. `node:dns/promises` is stdlib. Decision-ladder check: the standard
library resolves hostnames, so no package is needed.

## Non-functional

**Performance.** One remote render per call, measured 1.4–3.6 s (max observed
3.6 s) against staging. `WLO_TEXT_TIMEOUT_MS` (default 25 s) already bounds it.
The DNS lookup adds one resolver round trip, typically < 20 ms. No new
concurrency: one call, one extraction.

**Security.** The threat is SSRF: the tool causes a *third* process to fetch a
URL that the caller chose.

- Mitigated: literal private hosts (including IPv4-mapped IPv6, fixed 2026-08-03,
  and decimal/hex literals, which `new URL()` normalises before we see them) and
  — new — a public NAME that *resolves* to a private address. An unresolvable
  name counts as a refusal, not as public.
- Mitigated: the operator's credential never reaches the extraction service.
  `wloFetch` attaches it only to the repository host (`wlo-fetch.ts`), and the
  target URL is a request *body field*, never a fetch target of ours.
- **Not mitigated, by construction:** redirects and DNS rebinding. We do not
  fetch the target; Playwright inside the extraction service does. A URL that
  passes our check and then redirects to `10.0.0.5`, or whose DNS answer changes
  between our lookup and the service's, is not something this layer can see.
  The only place that can enforce it is the fetching service itself. This is the
  main reason the tool is declared unsafe and documented as not-for-production.
- Not mitigated: cost/abuse. One call is seconds of remote browser time. On the
  HTTP path `RATE_LIMIT_RPM` (default 120/min per IP) applies; stdio is local.
  No per-tool budget is planned — it would be speculative.

**Observability.** `log.warn` at startup for every registered unsafe tool
(name + reason), `log.info` for every one skipped. A refused URL logs the reason
and the host, never the full URL — a URL can carry a token in its query string.

**i18n / UI / privacy.** No UI. The tool description follows the existing
bilingual convention. No user-facing strings outside it.

## Risks

**R1 — The redirect gap is real and cannot be closed here.** Mitigation:
declared `unsafe`, documented in README/DEPLOYMENT/CHANGELOG as not for
production, logged loudly at startup, and the design names the correct fix
(resolution-time enforcement inside the extraction service). If that service
gains the check, the `unsafe` declaration can be revisited — the mechanism makes
that a one-field change.

**R2 — Default-on means an existing deployment gains the tool on upgrade.**
Mitigation: the startup warning names the tool and the reason on every boot, and
`docs/DEPLOYMENT.md` gets the variable in its table. Accepted deliberately (see
Decisions).

**R3 — The tool list is asserted exactly in `tests/server.test.ts`.** Adding a
tool that is registered by default changes that assertion. Mitigation: it is an
explicit task, and a second test pins the *disabled* case, so the switch is
covered in both directions.

**R4 — Crawling gaps make failures look like bugs.** Mitigation: `reason:
"extraction_failed"` is a normal, documented outcome; the tool description says
so and names `method: "simple"` as the retry for a page where the browser render
fails (and vice versa).

**R5 — Extracting `cap()` and `isPrivateHost` touches working code.**
Mitigation: both are behaviour-preserving moves in their own tasks (P0), before
any feature task, each verified by the existing tests plus a characterisation
test for the moved unit.

## Open questions

None.
