# Tasks: Optional user authentication (guest-default)

Design (source of truth): `2026-07-25-wlo-mcp-optional-auth.md`
Status tracking: add a section to `docs/plans/STATUS.md` when P0 starts.

Process rules (user protocol):
- Every phase starts with **step 0: invoke `/better-coding-workflow`**
  (P3 additionally `/better-coding-frontend`). Skills unload — reload first.
- TDD: each task writes its failing test first and shows red → green output.
- Per-phase close-out: update `STATUS.md`, `CHANGELOG.md`, keep `CLAUDE.md`
  pointer current, then STOP so the user can clear context. Never commit —
  the user uploads files manually.
- Note on granularity: tasks in P2–P3 name exact files, signatures, and test
  cases, but deliberately do not pre-write endpoint-level code that depends on
  P0's findings (writing unverified edu-sharing endpoint code now would be
  fabrication). P1 is P0-independent and fully specified.

---

## Phase P0 — Verification spike (read-only, no product code)

Step 0: invoke `/better-coding-workflow`.

### Task 0.1: Probe edu-sharing auth capabilities on staging
**Files:** none (curl probes; findings go into the design doc)
**What:** Against `https://repository.staging.openeduhub.net/edu-sharing`:
(a) check `GET /.well-known/openid-configuration` on the repo host and on the
instance's IdP host if discoverable; (b) check whether
`POST /oauth2/token` (grant_type=password) exists — probe with an invalid
dummy user and read the error shape only (no real credentials in probes);
(c) with a user-supplied test account token (ask the user to run ONE curl
locally if needed), verify `Authorization: Bearer` on
`GET /rest/authentication/v1/validateSession` and on one `ngsearch` call;
(d) record token lifetime fields from the token response shape.
**Verification:** the design doc's "Verified facts" checklist is fully filled
with probe evidence (status codes + response excerpts, secrets redacted).

### Task 0.2: Decide variant A/B and pin endpoints
**Files:** Modify `docs/plans/2026-07-25-wlo-mcp-optional-auth.md`
**What:** Based on 0.1, fix the login flow variant, the exact endpoints,
client id/registration needs, and the identity endpoint. If only variant B is
possible: STOP and get explicit user approval before P3 is allowed to build
the credential form. Update the tasks below where marked "(per P0)".
**Verification:** design doc has no remaining "(per P0)" unknowns; user has
approved the variant.

Close-out: STATUS.md section created; report to user; context clear.

---

## Phase P1 — Auth core (crypto, context, resolution, transport)

Step 0: invoke `/better-coding-workflow`.

### Task 1.1: Auth config module
**Files:** Create `src/auth/config.ts`; Modify `.env.example`;
Test `tests/auth-config.test.ts`
**What:** Pure resolver (pattern: `resolveRootCollectionId`) for:
`WLO_AUTH_SECRET` (auth enabled iff set; warn if < 16 chars),
`WLO_AUTH_SESSION_TTL_MINUTES` (default 240, positive int),
`WLO_AUTH_PUBLIC_URL` (required when enabled; used for login links),
`WLO_AUTH_RATE_LIMIT_RPM` (default 10), plus variant-specific endpoint/client
values (per P0). Export `authConfig(): AuthConfig | null` (null = disabled).
**Tests:** disabled when unset; defaults; short-secret warning; URL required.
**Verification:** `node --import tsx --test tests/auth-config.test.ts` green.

### Task 1.2: Session-token envelope (wrap/unwrap)
**Files:** Create `src/auth/session-token.ts`; Test `tests/auth-session-token.test.ts`
**What:** AES-256-GCM via `node:crypto` (key = SHA-256(secret); 12-byte random
IV; format `wlo1.<b64url iv>.<b64url ct||tag>`); payload
`{v:1, tok, scope:'read', exp, name?}`. `unwrapSessionToken` throws
`AuthError('invalid')` on format/MAC/version mismatch, `AuthError('expired')`
past `exp`.
**Tests:** roundtrip preserves payload; tampered ciphertext → invalid; wrong
secret → invalid; expired → expired; foreign string → invalid; token string
never contains the inner token in plaintext (no substring).
**Verification:** test file green.

### Task 1.3: AuthContext via AsyncLocalStorage
**Files:** Create `src/auth/context.ts`; Test `tests/auth-context.test.ts`
**What:** `AuthContext` (design "Interfaces"), `runWithAuth(ctx, fn)`,
`currentAuth()` on a module-level `AsyncLocalStorage` instance (the store
itself is immutable per run — no mutable global auth state).
**Tests:** value visible inside `runWithAuth` across `await`; null outside;
two interleaved async runs with different contexts never see each other's
value (isolation pin for R8).
**Verification:** test file green.

### Task 1.4: resolveAuth precedence
**Files:** Create `src/auth/resolve.ts`; Test `tests/auth-resolve.test.ts`
**What:** Implements header → param → anonymous with the failure semantics
from the design (header invalid → `{ctx:null, error}` marked for HTTP 401;
param invalid/expired → error for a tool-level message; both present →
header wins; neither → `{ctx:null}`).
**Tests:** all six branches, incl. "Bearer " prefix parsing and precedence.
**Verification:** test file green.

### Task 1.5: wloFetch attaches Bearer behind host guard
**Files:** Modify `src/wlo-config.ts` (`wloFetch`); Test `tests/auth-fetch.test.ts`
**What:** When `currentAuth()` is non-null AND the URL starts with
`WLO_REPOSITORY_URL`, merge `Authorization: Bearer <eduToken>` into headers
(caller-supplied Authorization wins if ever set). Never attach on any other
host (Wikipedia stays clean).
**Tests (fetchMock):** repo URL + ctx → header present; repo URL, no ctx → no
header; non-repo URL + ctx → no header.
**Verification:** test file + existing suite green (`npm test`).

### Task 1.6: HTTP header parsing (http-app + Vercel parity)
**Files:** Modify `src/http-app.ts`, `api/mcp.ts`, `src/server.ts`
(`createMcpServer(opts?)`); Test `tests/http-auth-header.test.ts`
**What:** Before MCP handling: read `Authorization`; when auth is enabled and
a header is present, validate via `resolveAuth` — invalid/expired → 401 JSON
`{error}` (no `WWW-Authenticate` yet, per design); valid → pass
`{headerAuth}` into `createMcpServer` and wrap `transport.handleRequest` in
`runWithAuth(headerAuth, …)`. No header → exactly today's path. Add
`Authorization` to the CORS allow-list.
**Tests:** through `createHttpRequestHandler` with fetchMock: valid header →
upstream sees Bearer (JSON mode AND `MCP_SSE` mode — the ALS/SSE propagation
pin from the design's risk list); bad header → 401; no header → anonymous and
byte-identical behaviour; auth disabled → header ignored path documented.
**Verification:** test file + full suite + `npm run typecheck` green.

Close-out: STATUS/CHANGELOG updated; stop for context clear.

---

## Phase P2 — Tool seam + auth tools

Step 0: invoke `/better-coding-workflow`.

### Task 2.1: authToken seam on every tool
**Files:** Create `src/apps/tool-auth-seam.ts`; Modify `src/server.ts`;
Test `tests/auth-tool-seam.test.ts`
**What:** Wrap `server.tool`/`server.registerTool` (pattern:
`tool-defaults.ts`; applied only when auth is enabled): inject optional
`authToken: z.string().optional()` (short German description pointing to
`wlo_login`) into each tool's input schema except `wlo_login`; in the handler
wrapper: strip `authToken` from args BEFORE anything else (log-leak
prevention), resolve (param path; header context already active from P1.6
wins via `currentAuth()` presence with `source:'header'`), on `AuthError`
return a German error ("Sitzung abgelaufen/ungültig — bitte neu über
wlo_login anmelden", `isError:true`), else `runWithAuth` around the original
handler and append the `_auth` echo text block
(`{"_auth":{"mode":"user","displayName":…,"expiresAt":…}}`) to the result.
Reject param tokens for any tool whose annotations are not
`readOnlyHint:true` (future-write contract, unit-tested with a dummy tool).
**Tests:** param reaches wloFetch as Bearer; stripped from handler args;
expired → error, NOT anonymous; header beats param; anonymous call has no
`_auth` block and unchanged output; dummy non-read tool + param token →
login-required contract shape; no `wlo1.` substring in any structuredContent.
**Verification:** test file + full suite green.

### Task 2.2: wlo_login + wlo_auth_status tools
**Files:** Create `src/tools/auth.ts`; Modify `src/server.ts`,
`docs/TOOLS.md`; Test `tests/tools-auth.test.ts`
**What:** Registered only when auth is enabled. `wlo_login` (title "WLO
Anmeldung"; trigger-first German description ≤ 256 chars: anmelden/einloggen/
"meine Inhalte"): returns login URL (`<PUBLIC_URL>/auth/login`) + numbered
German instructions incl. "füge den Token danach hier im Chat ein" and the
standing instruction to the model to pass the token as `authToken` on every
subsequent WLO call. `wlo_auth_status` (title "WLO Anmeldestatus"): with
valid context → mode/user/expiry; anonymous → guest-mode note + login hint;
invalid/expired param → the P2.1 error message. Both `readOnlyHint: true`.
**Tests:** registration gated by env; login output contains URL + both
instructions; status for all three states.
**Verification:** test file + suite green; tool count in docs updated (24).

### Task 2.3: Concurrency isolation test (R8 pin)
**Files:** Test `tests/auth-isolation.test.ts`
**What:** Through one `createHttpRequestHandler`: fire two overlapping MCP
tool calls, one with token A (header), one with token B (param), one
anonymous; fetchMock records the Authorization header per upstream call.
Assert exact per-call mapping and zero bleed.
**Verification:** test green under `--test-concurrency` default.

Close-out: STATUS/CHANGELOG; stop for context clear.

---

## Phase P3 — Login pages (UI)

Step 0: invoke `/better-coding-workflow` **and** `/better-coding-frontend`.
Gate: variant fixed in P0 (variant B additionally user-approved).

### Task 3.1: Auth upstream client (per P0 endpoints)
**Files:** Create `src/auth/upstream.ts`; Test `tests/auth-upstream.test.ts`
**What:** Variant A: build authorize URL (client id, pinned redirect URI,
`state`, S256 PKCE), exchange code at the token endpoint; Variant B: password
grant call. Plus `fetchDisplayName(eduToken)` (endpoint per P0). All via
`wloFetch`, never logging bodies.
**Tests (fetchMock):** exchange happy path; upstream 4xx → typed failure;
display-name fallback when the identity call fails (name optional).
**Verification:** test file green.

### Task 3.2: /auth routes + flow cookie + rate limit
**Files:** Create `src/auth/routes.ts`; Modify `src/http-app.ts`, `src/http.ts`;
Test `tests/auth-routes.test.ts`
**What:** Mount before `/api/*`, own `RateLimiter` (config from 1.1).
Variant A: `GET /auth/login` sets the encrypted HttpOnly/Secure/SameSite=Lax
flow cookie (state+verifier, 10-min exp) and redirects to the IdP;
`GET /auth/callback` validates state against the cookie (mismatch/expired →
error page, 400), exchanges, wraps the envelope, clears the cookie, renders
the token page. Variant B: `GET /auth/login` renders the form; `POST` grants
upstream and renders the token page. All responses: `no-store`, `nosniff`,
same-origin CSP. Errors never echo upstream bodies or credentials.
**Tests:** rate limit 429; state mismatch 400; happy path returns a token
page whose embedded token unwraps to the mocked upstream token with
scope 'read'; headers pinned; cookie flags pinned.
**Verification:** test file + suite green.

### Task 3.3: Pages (login/token/error) — a11y + copy
**Files:** Create `src/auth/pages.ts`; Test `tests/auth-pages.test.ts`
**What:** Pure renderers, self-contained HTML (escapeHtml reuse), German-first
+ one EN hint. Token page: token in a `<code>` block (selectable without JS)
+ copy button (progressive enhancement), expiry time, safety note ("nur
Lesen, läuft ab, nicht weitergeben"), numbered paste-back steps. Login page
explains what login changes (personalisierte Inhalte). WCAG-AA contrast,
labels, focus visible. User reviews the German copy at close-out.
**Tests:** escaping (XSS pin with hostile display name), token present
exactly once, no external asset URLs (`https?://` allowlist = own host only).
**Verification:** test file green; frontend checklist pass noted.

Close-out: STATUS/CHANGELOG; user copy review; stop for context clear.

---

## Phase P4 — Docs, deploy, end-to-end verify

Step 0: invoke `/better-coding-workflow`; end with `/better-coding-verify`.

### Task 4.1: Env + deployment docs
**Files:** Modify `.env.example`, `docs/DEPLOYMENT.md`, `docker-compose.yml`
(env passthrough only)
**What:** Document all `WLO_AUTH_*` vars (secret generation one-liner,
`openssl rand -base64 32`), nginx notes (`/auth` never cached; TLS assumed),
IdP client registration incl. exact redirect URI, ChatGPT reconnect note for
the two new tools, explicit "Vercel = guest-only (no login pages)" statement.
**Verification:** docs mention every new env var exactly as implemented
(grep cross-check).

### Task 4.2: README (DE/EN) + TOOLS.md + CHANGELOG sync
**Files:** Modify `README.md`, `README.de.md`, `docs/TOOLS.md`, `CHANGELOG.md`
**What:** Short "Optionale Anmeldung" section: guest default, what login
adds, the security model in three sentences (envelope, read-only, TTL),
chat trigger examples ("melde mich bei WLO an").
**Verification:** grep cross-check of tool and env names against the code; suite green.

### Task 4.3: Full verify + live smoke
**Files:** none
**What:** `npm test` (full), `npm run typecheck`, `npm run build`; after the
user deploys: `/health` fingerprint check, then a real login on the vServer
(user performs the browser leg), `wlo_auth_status` via curl MCP call with the
minted token, one authenticated search vs. anonymous diff.
**Verification:** evidence block (commands + output) in the close-out report;
regression = entire pre-existing suite green.

Close-out: STATUS final, CLAUDE.md active-plan pointer, stop.

---

## Dependency order

P0 → P1 → P2 → P3 → P4. Within P1: 1.1 → (1.2, 1.3 parallel) → 1.4 → 1.5 →
1.6. P2 requires P1 complete; P3 requires P0 variant decision + P2 seam;
P4 last. Future write tools (separate plan) build on the P2 contract.
