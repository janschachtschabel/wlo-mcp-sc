# Tasks: URL-based full-text tool + generic "unsafe tool" switch

Design: [`2026-08-03-url-text-tool-design.md`](2026-08-03-url-text-tool-design.md).
Read it before starting. 16 tasks in 5 phases, dependency-ordered.

Baseline to hold at every phase close: `npm test` (1021 green at plan time),
`npm run typecheck`, `npm run build` — all three.

## Progress

| Phase | Tasks | Status | Evidence |
|---|---|---|---|
| P0 Behaviour-preserving extraction | 1–2 | ✅ done (2026-08-03) | 1035 tests (+14), typecheck + build clean |
| P1 The unsafe-tool switch | 3–4 | ✅ done (2026-08-03) | 1047 tests (+12), typecheck + build clean |
| P2 The stronger URL check | 5–6 | ✅ done (2026-08-03) | 1054 tests (+7), incl. a live-defect fix |
| P3 The tool | 7–10 | ✅ done (2026-08-03) | 1078 tests (+22), live probe over 7 URLs |
| P4 Configuration and documentation | 11–16 | ✅ done (2026-08-03) | env + compose pulled forward; README ×2, DEPLOYMENT, CHANGELOG, CLAUDE.md |

Execution notes (things the plan did not foresee):

- **Task 4** — the first fixture registered *only* the unsafe tool and asserted
  an empty `tools/list`. It failed with `-32601 Method not found`: an `McpServer`
  with no tool at all never advertises the tools capability. The fixture now
  registers a safe tool alongside, which is also what a real server looks like.
- **Tasks 11–12 pulled forward** on request (2026-08-03), together with the
  decision that the SHIPPED configuration disables unsafe tools
  (`WLO_DISABLE_UNSAFE_TOOLS=all`) even though the code default registers them.
- **Compose substitution form matters**: `${VAR:-all}` overrides an explicitly
  EMPTY value too, so the documented way to switch the tools back on would have
  silently failed. Measured with `docker compose config`, fixed to `${VAR-all}`,
  and pinned by a test — the missing colon reads as a typo and would otherwise
  be "corrected".
- **Task 7 (the schema) got no test of its own.** A test that builds an object
  and parses it with zod tests zod. The schema is proven where it is used — the
  tool test parses real `structuredContent` against it — and its agreement with
  the `UrlText` interface is a compile-time matter the typecheck already covers.
- **Two things the plan did not foresee in Task 9/10**, both contracts the
  existing suite enforces: every tool needs an entry in `apps/tool-status.ts`
  (`openai/toolInvocation/*`) and in the title map of `apps/tool-defaults.ts`,
  and the tool COUNT is asserted in a second place —
  `tests/tools-curation-gating.test.ts`, not only `server.test.ts`.
- **`service_disabled` was added beyond the plan's reason list.** Folding "no
  extraction service configured" into `extraction_failed` would report a missing
  setting as a fact about the page — the shape that once made a wrong service
  password answer every search with "0 hits".
- **The URL is normalised before it is reported.** Measured: `z.string().url()`
  accepts a literal newline and WHATWG parsing strips it, so echoing the raw
  input would name a URL that was never requested — and forge a second
  `Quelle:` line. The service now reports and requests `target.href`.
- **Task 5 found a live defect, not just a missing feature.** The plan assumed
  the DNS check would cover odd IP spellings. Measurement said otherwise: decimal
  and hex literals are normalised by `new URL()` and were never a hole, while
  IPv4-mapped IPv6 WAS one — `http://[::ffff:127.0.0.1]/` became hostname
  `[::ffff:7f00:1]`, which `isPrivateHost` waved through. Reachable via the
  existing `ccm:wwwurl` path. Fixed inside `isPrivateHost`; design doc and
  CLAUDE.md corrected.

---

## Phase P0 — Behaviour-preserving extraction (no feature yet)

**Step 0: invoke `/better-coding-workflow`** (skills unload — reload before coding).

Two units the new code must share rather than copy. Both are moves; the existing
tests are the regression net, and each gets a characterisation test at its new
home.

### Task 1: extract `capText`

**Files**
- Create: `src/text-cap.ts`
- Modify: `src/services/content-text.ts` (private `cap()` → uses `capText`)
- Test: `tests/text-cap.test.ts` (create)

**What.** `cap()` in `content-text.ts` cuts to `maxChars` at a word boundary and
reports the pre-truncation length. The new URL service needs exactly that rule.
Move the rule; leave `cap()` as the thin shape-adapter it becomes.

**Interfaces**
```ts
export interface CappedText { text: string; charCount: number; truncated: boolean }
export function capText(text: string, maxChars: number): CappedText;
```

**Steps**
- [x] Write `tests/text-cap.test.ts` first, covering the behaviour `cap()` has
      today: short text untouched and `truncated:false`; long text cut at the
      last space when that space sits past 80 % of `maxChars`; cut hard when it
      does not; `charCount` is always the FULL length; the marker
      `\n\n[…gekürzt]` is appended on truncation; input is trimmed.
- [x] Run `node --import tsx --test tests/text-cap.test.ts` — expect
      `Cannot find module '../src/text-cap.js'`.
- [x] Create `src/text-cap.ts`:
```ts
/**
 * text-cap.ts – One truncation rule, shared.
 *
 * Cutting a text for a model is not `slice()`: the caller must be told what it
 * is missing, and a cut mid-word reads as a typo rather than as an omission.
 * Extracted from `services/content-text.ts` when a second caller (the URL text
 * service) needed the identical rule — two copies of a truncation marker drift
 * silently, and the drift is only visible to the reader of the output.
 */

export interface CappedText {
  text: string;
  /** Length BEFORE truncation, so the caller can see what it is missing. */
  charCount: number;
  truncated: boolean;
}

const TRUNCATION_MARKER = '\n\n[…gekürzt]';
/** Only accept a word boundary in the last fifth — otherwise cut hard. */
const MIN_BOUNDARY_RATIO = 0.8;

export function capText(text: string, maxChars: number): CappedText {
  const full = text.trim();
  if (full.length <= maxChars) {
    return { text: full, charCount: full.length, truncated: false };
  }
  const slice = full.slice(0, maxChars);
  const lastSpace = slice.lastIndexOf(' ');
  const cut = lastSpace > maxChars * MIN_BOUNDARY_RATIO ? slice.slice(0, lastSpace) : slice;
  return { text: `${cut.trimEnd()}${TRUNCATION_MARKER}`, charCount: full.length, truncated: true };
}
```
- [x] Rewrite the private `cap()` in `services/content-text.ts` to call
      `capText(r.text, maxChars)` and spread the result over the `ContentText`
      fields; delete the now-duplicated body. Import
      `import { capText } from '../text-cap.js';`.
- [x] Run `node --import tsx --test tests/text-cap.test.ts tests/services-content-text.test.ts tests/tools-content-text.test.ts` — all green.

**Verification.** `npm test` → 1021 + the new text-cap tests, 0 fail.
**Rollback.** Revert both files; `cap()` was self-contained.

### Task 2: extract `isPrivateHost` into `url-safety.ts`

**Files**
- Create: `src/url-safety.ts`
- Modify: `src/text-extraction-api.ts` (delete the local `isPrivateHost`, import it)
- Test: `tests/url-safety.test.ts` (create)

**What.** Move `isPrivateHost` verbatim. It becomes a shared rule with a second
caller in P2, and its file name should say what it decides.

**Steps**
- [x] Write `tests/url-safety.test.ts` first: `localhost`, `x.localhost`,
      `127.0.0.1`, `10.1.2.3`, `172.16.0.1`, `172.31.255.255`, `192.168.1.1`,
      `169.254.169.254` (cloud metadata), `0.0.0.0`, `::1`, `fc00::1`, `fe80::1`
      → true; `example.com`, `172.15.0.1`, `172.32.0.1`, `8.8.8.8`,
      `2001:4860:4860::8888` → false.
- [x] Run it — expect the module-not-found error.
- [x] Create `src/url-safety.ts` with the function copied **unchanged** from
      `text-extraction-api.ts` lines 38–64, plus this header:
```ts
/**
 * url-safety.ts – Is this URL safe to hand to a service that will fetch it?
 *
 * The question is not "is this a valid URL" but "does asking a fetching service
 * for it turn that service into a probe for the network it sits in". It has its
 * own module because two callers now ask it: the curated `ccm:wwwurl` fallback
 * (narrow, the URL comes from a curator) and the `get_url_text` tool (wide, the
 * URL comes from whoever is talking to the model).
 */
```
- [x] In `text-extraction-api.ts`: delete the local function and its JSDoc, add
      `import { isPrivateHost } from './url-safety.js';`. Keep the JSDoc's
      limitation paragraph — move it to `url-safety.ts` where the rule now lives.
- [x] Run `node --import tsx --test tests/url-safety.test.ts tests/text-extraction-api.test.ts` — green.

**Verification.** `npm test` green; `npm run typecheck` clean.
**Rollback.** Move the function back; single import to undo.

---

## Phase P1 — The generic unsafe-tool switch

**Step 0: invoke `/better-coding-workflow`.**

Built and tested before the tool exists, so the mechanism is proven on its own
rather than through the feature.

### Task 3: `src/unsafe-tools.ts`

**Files**
- Create: `src/unsafe-tools.ts`
- Test: `tests/unsafe-tools.test.ts` (create)

**What.** Parse `WLO_DISABLE_UNSAFE_TOOLS` once and answer
`isUnsafeToolDisabled(name)`. Accepted values: a comma/space-separated list of
tool names, or `all`/`1`/`true`/`yes`/`on` for every unsafe tool. Unset or empty
→ nothing disabled (tools are registered by default — see the design's
Decisions).

**Interfaces**
```ts
export function isUnsafeToolDisabled(name: string): boolean;
/** Exported for tests: the pure parse, independent of process.env. */
export function parseDisableList(raw: string | undefined): { all: boolean; names: ReadonlySet<string> };
```

**Steps**
- [x] Write `tests/unsafe-tools.test.ts` first: `undefined`/`''`/`'   '` → nothing
      disabled; `'get_url_text'` → that name disabled, another name not;
      `'a, b ,c'` → all three; `'all'`/`'ALL'`/`'1'`/`'true'` → `all:true`;
      mixed case name `'GET_URL_TEXT'` disables `get_url_text` (compare
      lower-cased); a name that matches nothing does not throw.
- [x] Run it — expect module-not-found.
- [x] Create `src/unsafe-tools.ts`:
```ts
/**
 * unsafe-tools.ts – The operator's off-switch for tools declared unsafe.
 *
 * A tool declares itself unsafe in its definition (`WloToolDef.unsafe`) with the
 * reason; this module holds the operator's answer to that declaration. Unsafe
 * tools are registered BY DEFAULT — the decision of 2026-08-03 — so this is a
 * disable list, not an enable list, and the startup warning in `apps/register.ts`
 * is what keeps a default-on unsafe tool from being invisible.
 *
 * Leaf module: no project imports, so it can be tested without a server.
 */

const ALL_TOKENS = new Set(['all', '1', 'true', 'yes', 'on']);

export function parseDisableList(raw: string | undefined): { all: boolean; names: ReadonlySet<string> } {
  const entries = (raw ?? '')
    .toLowerCase()
    .split(/[\s,]+/)
    .filter(Boolean);
  if (entries.some(e => ALL_TOKENS.has(e))) return { all: true, names: new Set() };
  return { all: false, names: new Set(entries) };
}

const disabled = parseDisableList(process.env['WLO_DISABLE_UNSAFE_TOOLS']);

/** True when the operator switched this unsafe tool off. */
export function isUnsafeToolDisabled(name: string): boolean {
  return disabled.all || disabled.names.has(name.toLowerCase());
}
```
- [x] Run the test — green.

**Verification.** `node --import tsx --test tests/unsafe-tools.test.ts`.
**Rollback.** Delete both files; nothing imports them yet.

### Task 4: the `unsafe` field on `WloToolDef` + the registration gate

**Files**
- Modify: `src/apps/register.ts`
- Test: `tests/unsafe-gate.test.ts` (create)

**What.** `registerWloTool` — the single seam every tool goes through — skips a
tool whose `unsafe` declaration the operator disabled, and logs either way.

**Interfaces.** `WloToolDef.unsafe?: { reason: string }` (see design).

**Steps**
- [x] Write `tests/unsafe-gate.test.ts` first. Because `unsafe-tools.ts` reads
      the env at module load, the test drives the gate through an injectable
      predicate rather than by mutating `process.env` mid-process: give
      `registerWloTool` an optional last parameter
      `isDisabled: (name: string) => boolean = isUnsafeToolDisabled`. Assert
      (a) a tool WITHOUT `unsafe` is registered even when the predicate returns
      true — the switch must not touch ordinary tools; (b) a tool WITH `unsafe`
      is registered when the predicate returns false; (c) it is NOT registered
      when the predicate returns true. Follow the established pattern of
      `tests/apps-register.test.ts`: its `clientFor(register)` helper builds a
      REAL `McpServer` with an in-memory client, so absence is asserted against
      `client.listTools()` — the same surface a host sees — rather than against
      a recorded call.
- [x] Run it — expect a TypeScript/assertion failure (the parameter does not exist).
- [x] In `register.ts`: extend `WloToolDef` with the documented `unsafe` field
      (JSDoc from the design), add the injectable parameter, and gate at the top
      of `registerWloTool`:
```ts
  if (def.unsafe) {
    if (isDisabled(def.name)) {
      log.info('unsafe tool disabled by configuration', { tool: def.name, variable: 'WLO_DISABLE_UNSAFE_TOOLS' });
      return;
    }
    // Registered by default, so the operator of an inherited deployment must be
    // able to see it without reading the changelog.
    log.warn('registering a tool declared UNSAFE', { tool: def.name, reason: def.unsafe.reason });
  }
```
- [x] Run the test — green. Run `tests/apps-register.test.ts` and
      `tests/server.test.ts` — unchanged (no tool declares `unsafe` yet).

**Verification.** `npm test` green, tool list in `server.test.ts` unchanged.
**Rollback.** Revert `register.ts`; the field is additive.

---

## Phase P2 — The stronger URL check

**Step 0: invoke `/better-coding-workflow`.**

### Task 5: `resolvesToPrivateAddress`

**Files**
- Modify: `src/url-safety.ts`
- Test: `tests/url-safety.test.ts` (extend)

**What.** Resolve a hostname and judge every returned address. This is the check
that closes what the literal test misses: decimal (`2130706433`) and hex
(`0x7f.0.0.1`) IPv4 literals, and IPv4-mapped IPv6 (`::ffff:10.0.0.1`), all of
which resolve to a private address while looking like an ordinary name.

**Interfaces**
```ts
export function resolvesToPrivateAddress(
  hostname: string,
  lookup?: (h: string) => Promise<{ address: string }[]>,
): Promise<'public' | 'private' | 'unresolvable'>;
```
The injectable `lookup` keeps the test offline — the netguard blocks real network
calls, and DNS is exactly the kind of dependency a test must not have.

**Steps**
- [x] Extend `tests/url-safety.test.ts`: a fake lookup returning `10.0.0.5` →
      `'private'`; returning `93.184.216.34` → `'public'`; returning BOTH → the
      private one wins (`'private'` — one bad answer is enough); returning `[]`
      → `'unresolvable'`; a lookup that rejects (ENOTFOUND) → `'unresolvable'`;
      returning `::ffff:10.0.0.1` → `'private'`.
- [x] Run — expect module-not-found for the new export.
- [x] Implement in `src/url-safety.ts`:
```ts
import { lookup as dnsLookup } from 'node:dns/promises';

/** `::ffff:10.0.0.1` is a private IPv4 wearing an IPv6 coat — unwrap it first. */
function unwrapMappedIpv4(address: string): string {
  const m = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(address);
  return m ? m[1]! : address;
}

export async function resolvesToPrivateAddress(
  hostname: string,
  lookup: (h: string) => Promise<{ address: string }[]> =
    h => dnsLookup(h, { all: true }) as Promise<{ address: string }[]>,
): Promise<'public' | 'private' | 'unresolvable'> {
  let addresses: { address: string }[];
  try {
    addresses = await lookup(hostname);
  } catch {
    // A name we cannot resolve is one we cannot judge. Refusing is the safe
    // answer: the fetching service may resolve it differently than we do.
    return 'unresolvable';
  }
  if (addresses.length === 0) return 'unresolvable';
  // ONE private answer is enough. A name with a public and a private record is
  // exactly the shape a rebinding attack takes.
  return addresses.some(a => isPrivateHost(unwrapMappedIpv4(a.address))) ? 'private' : 'public';
}
```
- [x] Run the test — green.

**Verification.** `node --import tsx --test tests/url-safety.test.ts`.
**Rollback.** Delete the export and its tests.

### Task 6: document the limitation where the rule lives

**Files**
- Modify: `src/url-safety.ts` (module JSDoc)

**What.** State, at the rule, what the rule cannot do — the redirect and
rebinding gap from the design (R1). No behaviour change, no test.

**Steps**
- [x] Append to the module JSDoc:
```
 * What this CANNOT decide, deliberately: we never fetch the target ourselves —
 * the extraction service does, with Playwright, in its own process. A URL that
 * passes here and then REDIRECTS to a private address, or whose DNS answer
 * changes between our lookup and the service's, is invisible at this layer.
 * Closing that needs resolution-time enforcement inside the fetching service.
 * It is the reason `get_url_text` is declared unsafe rather than merely guarded.
```
- [x] `npm run typecheck`.

---

## Phase P3 — The tool

**Step 0: invoke `/better-coding-workflow`.**

### Task 7: `urlTextSchema`

**Files**
- Modify: `src/apps/outputSchemas.ts`
- Test: `tests/apps-structured-content.test.ts` (extend)

**Steps**
- [x] Add the schema assertion to the existing structured-content test first
      (a valid `UrlText` parses; a missing `charCount` fails).
- [x] Add, next to `contentTextSchema`:
```ts
/** Mirrors `UrlText` (services/url-text.ts). */
export const urlTextSchema = z.object({
  url: z.string(),
  text: z.string(),
  /** Length BEFORE truncation, so the caller sees what it is missing. */
  charCount: z.number(),
  truncated: z.boolean(),
  /** Only when there is no text: why. */
  reason: z.string().optional(),
});
```
- [x] Run the test — green.

### Task 8: `services/url-text.ts`

**Files**
- Create: `src/services/url-text.ts`
- Test: `tests/services-url-text.test.ts` (create)

**What.** The algorithm: validate scheme → literal host → resolved address →
extract → cap. Every refusal has its own `reason`.

**Interfaces.** As in the design. `getUrlText` takes injectable `lookup` and
`extract` parameters so the test needs neither DNS nor network.

**Steps**
- [x] Write `tests/services-url-text.test.ts` first:
      `ftp://example.com` → `reason: 'not_http'` and the extractor is NEVER
      called; `http://127.0.0.1/x` → `'private_host'`, extractor not called;
      a public name resolving to `10.0.0.5` → `'private_host'`, extractor not
      called; an unresolvable name → `'dns_failed'`, extractor not called;
      extractor returns `null` → `'extraction_failed'`; extractor returns 50
      chars → `'extraction_failed'` (below the useful-content floor, same
      200-char rule as `content-text.ts`); extractor returns a long text →
      `truncated:true`, `charCount` = full length, no `reason`.
      Assert "extractor not called" explicitly with a call counter — the point
      of the guard is that nothing is fetched.
- [x] Run — expect module-not-found.
- [x] Implement (structure; complete bodies follow the interfaces above):
      parse with `new URL()` inside try/catch → `not_http` on throw or on a
      non-http(s) protocol; `isPrivateHost(u.hostname)` → `private_host`;
      `await resolvesToPrivateAddress(u.hostname, lookup)` → `'private'` →
      `private_host`, `'unresolvable'` → `dns_failed`; then
      `await extract(url, method)`; `null` or `< MIN_USEFUL_CHARS` (200,
      imported from a shared constant or re-declared with the same comment) →
      `extraction_failed`; else `capText(text, maxChars)` spread into the result.
      Log every refusal with `log.warn` naming the reason and `u.hostname` —
      **never the full URL**, which can carry a token in its query string.
- [x] Run the test — green.

**Verification.** `node --import tsx --test tests/services-url-text.test.ts`.
**Rollback.** Delete both files.

### Task 9: `tools/url-text.ts`

**Files**
- Create: `src/tools/url-text.ts`
- Test: `tests/tools-url-text.test.ts` (create)

**What.** Schema, description, rendering. Registered through `registerWloTool`
with `unsafe: { reason: … }`.

**Input schema**
```ts
url: z.string().url().max(2000).describe('Vollständige http(s)-URL der Webseite.'),
method: z.enum(['browser', 'simple']).optional().default('browser').describe(
  '"browser" rendert JavaScript (Standard, langsamer); "simple" holt nur das HTML. ' +
  'Scheitert der eine Weg an einer Seite, ist der andere der sinnvolle zweite Versuch.'),
maxChars: z.number().int().min(500).max(50000).optional().default(8000),
outputFormat: z.enum(['markdown', 'json']).optional().default('markdown'),
```

**Description** must state, in the tool text a model reads:
- what it does and that the source is an external extraction service;
- that "no text" is a normal outcome (`reason`), with the `method` retry (R4);
- that it is **not** the tool for WLO material — `get_wlo_content_text` with a
  `nodeId` is, because that reads the repository directly;
- the `unsafe` note, so a host that surfaces descriptions shows it.

**Steps**
- [x] Write `tests/tools-url-text.test.ts` first, via `connectedClient()`:
      the tool appears in `tools/list`; a private URL returns a result whose
      text names the reason and makes no upstream call (assert with
      `installFetchMock` call count — the netguard would otherwise catch it);
      markdown output carries a `Quelle:` line with the URL; `outputFormat:
      'json'` returns `structuredContent` matching `urlTextSchema`.
- [x] Run — expect the tool to be missing.
- [x] Implement, mirroring `tools/content-text.ts`: `registerWloTool(server, {…})`,
      `outputSchema: urlTextSchema`, `annotations: { readOnlyHint: true,
      openWorldHint: true }` (it reaches an open-world external source, like
      `get_wikipedia_summary`), `unsafe: { reason: 'fetches an arbitrary
      caller-supplied URL through the extraction service; redirects and DNS
      rebinding cannot be checked from here' }`, and `toolError` in the catch.
      **Pass the header line through `oneLine`** — the URL is caller-supplied
      and a newline in it would forge a second `Quelle:` line, the same defect
      already fixed in `content-text.ts`.
- [x] Run the test — green.

### Task 10: wire it into `server.ts`

**Files**
- Modify: `src/server.ts`
- Modify: `tests/server.test.ts` (the exact tool-list assertion — R3)
- Test: `tests/server.test.ts` (extend with the disabled case)

**Steps**
- [x] Update `EXPECTED_TOOLS` in `tests/server.test.ts` to include
      `get_url_text`, and update the test title from "24 unconditional read
      tools" to 25. Add a second test that builds a server with the tool
      disabled (inject the predicate via the seam from Task 4, or set the env
      before importing in a dedicated child test file) and asserts
      `get_url_text` is absent while every other tool is present.
- [x] Run — expect the list assertion to fail (tool missing).
- [x] In `server.ts`, register after `registerContentTextTool` so the two
      full-text tools sit next to each other in display order:
      `registerUrlTextTool(server);  // get_url_text — UNSAFE, see WLO_DISABLE_UNSAFE_TOOLS`
- [x] Run — green.

**Verification.** `npm test`; the startup log shows the unsafe warning once.
**Rollback.** Remove the registration line and revert the test list.

---

## Phase P4 — Configuration and documentation

**Step 0: invoke `/better-coding-workflow`.**

### Task 11: `.env.example`

- [x] Add `WLO_DISABLE_UNSAFE_TOOLS` with: what it does; that unsafe tools are
      registered by default; the accepted values (names, or `all`); which tools
      are currently declared unsafe and why; and the recommendation to set it to
      `all` in production.

### Task 12: `docker-compose.yml`

- [x] Add `WLO_DISABLE_UNSAFE_TOOLS: "${WLO_DISABLE_UNSAFE_TOOLS:-}"` to the
      capability-gates block.
- [x] Run `node --import tsx --test tests/deploy-env-passthrough.test.ts` — it
      fails if Task 11 is done and this is not. That is the point of that test.

### Task 13: README (EN) and README.de

- [x] Env table: one row for `WLO_DISABLE_UNSAFE_TOOLS`.
- [x] Tool table: one row for `get_url_text`, marked unsafe.
- [x] A short subsection under the security heading: **"Tools declared unsafe"** —
      what the declaration means, that they are on by default, how to switch them
      off, and the explicit recommendation **not to run `get_url_text` in
      production**, with the reason (the redirect/rebinding gap that cannot be
      closed at this layer) and the correct fix (enforcement inside the
      extraction service).
- [x] Project tree: `src/url-safety.ts`, `src/unsafe-tools.ts`, `src/text-cap.ts`.

### Task 14: `docs/DEPLOYMENT.md`

- [x] Add `WLO_DISABLE_UNSAFE_TOOLS` to the deployment-relevant variable table,
      with `all` as the recommended production value.
- [x] One sentence in the verification section: after `docker compose up`, the
      log line `registering a tool declared UNSAFE` is expected unless the
      variable is set — so an operator can confirm the switch took effect.

### Task 15: `CHANGELOG.md`

- [x] An `### Added` entry under `[Unreleased]`: the tool, the generic switch,
      the strengthened URL check (naming what it now catches that the literal
      check missed), and the limitation it does not close.

### Task 16: `CLAUDE.md`

- [x] Architecture section: the new modules and their one-line responsibility;
      the read-tool count (25 unconditional; `get_url_text` switchable,
      `find_wlo_skills` conditional).
- [x] Add a line to the "Active plan" block linking this design + task file, so
      the contract is findable — the file states the tool surface, and CLAUDE.md
      forbids adding tools not listed in a plan.

---

## Verification plan

| Requirement | How it is verified | Success |
|---|---|---|
| The tool reads a public page | `tests/tools-url-text.test.ts` with a faked extractor; plus ONE manual live call against the staging service | text returned, `truncated`/`charCount` correct |
| A private/loopback URL is refused before any fetch | `tests/services-url-text.test.ts` call-counter assertions | extractor call count 0, `reason: 'private_host'` |
| A public name resolving to a private address is refused | fake `lookup` returning `10.0.0.5` | `reason: 'private_host'`, extractor not called |
| Unsafe tools are on by default | `tests/server.test.ts` tool list | `get_url_text` present |
| The switch removes it | the disabled-case test from Task 10 | absent; all others present |
| The switch does not touch safe tools | `tests/unsafe-gate.test.ts` case (a) | registered despite predicate true |
| The setting reaches the container | `tests/deploy-env-passthrough.test.ts` | green |
| No regression | `npm test`, `npm run typecheck`, `npm run build` | 1021 + new, 0 fail; clean; clean |

**Regression risks.** `tests/server.test.ts` (tool list), the content-text tests
(Task 1 touches `cap()`), `tests/text-extraction-api.test.ts` (Task 2 moves
`isPrivateHost`), `tests/deploy-env-passthrough.test.ts` (Task 11/12 must land
together).

**Live check, once, at the end.** One real call through the running server
against the staging extraction service with a public URL, and one with
`http://127.0.0.1:3000/health` to see the refusal. Both read-only; no credential
is involved, since `wloFetch` attaches it only to the repository host.
