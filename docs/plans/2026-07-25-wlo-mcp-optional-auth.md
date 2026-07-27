# Design: Optional user authentication (guest-default) for the WLO MCP server

Status: **draft — awaiting approval** (created 2026-07-25)
Tasks: `2026-07-25-wlo-mcp-optional-auth-tasks.md`

## Goal

Let a user optionally log in with their WLO / edu-sharing account — via a chat
command and an MCP-hosted login page — so that every subsequent MCP call runs
with that user's rights (personalized result sets now, write tools later),
while anonymous guest mode remains the untouched default and multiple users
with different rights can use the same server concurrently without any
cross-contamination.

## Context

Today the server is 100 % anonymous: 22 read-only tools call the public
edu-sharing REST API with no credentials; transports are stateless
(one `McpServer` per HTTP request). The user wants: (R1) guest mode stays the
default with zero regression; (R2) explicit login on request via an MCP tool;
(R3) after login **all** calls carry the user's rights; (R4) a foundation for
future write tools, with clear "login required" guidance; (R5) both the MCP
server and the LLM can tell whether the user is authenticated; (R6) login via
a jump link to an MCP-hosted page that hands the user a session token;
(R7) the connector stays registrable in any LLM host **without** auth
configuration; (R8) concurrent multi-user safety.

A prior security review of this feature (conversation, 2026-07-25) set two
hard constraints that this design encodes:

1. The token the user pastes into the chat is **never** the raw edu-sharing
   token — only a server-issued, encrypted, read-scoped, short-lived envelope.
2. Future **write** operations never accept the paste-back envelope; they will
   require host-managed transport auth (Authorization header), where the model
   never sees the secret.

## Scope

In scope:
- Session-token envelope (issue/validate, stateless crypto, no server store).
- Auth resolution per call: `Authorization: Bearer` header → `authToken` tool
  parameter → anonymous; invalid header → HTTP 401; invalid/expired parameter
  → explicit tool error (never a silent anonymous downgrade).
- Central seam that adds an optional `authToken` parameter to every WLO tool
  and attaches the user's edu-sharing token to upstream calls in one place.
- Two new MCP tools: `wlo_login` (returns the login URL + instructions) and
  `wlo_auth_status` (reports mode/identity/expiry).
- MCP-hosted login pages on the self-hosted HTTP server (`/auth/*`), with
  their own stricter rate limit.
- Auth-state echo so the model always knows the current mode (R5).
- Docs, env config, deployment notes.

Out of scope (explicitly):
- Actual write tools (create/update nodes) — this design only lays their
  auth contract.
- Spec-true MCP OAuth (401 + `WWW-Authenticate` +
  `/.well-known/oauth-protected-resource`) — future "Option C"; the design
  keeps the seam (header-based auth) so it can be added without breaking
  anything, but the server never sends 401 to anonymous clients (that would
  destroy guest-by-default on OAuth-capable hosts).
- Authentication for the public REST layer (`/api/*`) and the launcher — they
  stay anonymous-only.
- Multi-repository tenancy — one server still targets one
  `WLO_REPOSITORY_URL` (confirmed reading: "different rights" = different
  accounts/roles within one instance).
- Persisting tokens server-side in any form (cache, session store, DB).

## Explored approaches

**A — Host-managed OAuth only (MCP spec 401 flow).**
How: server responds 401 + `WWW-Authenticate`; host runs OAuth; token arrives
as Bearer header. Pros: gold standard, model never sees the token. Cons:
kills R1/R7 — hosts that see 401 force a login before any use, hosts without
MCP-OAuth support (REST/launcher/simple clients) cannot log in at all; ChatGPT
and Claude trigger their OAuth UX at connect time, not on user request.
Risk: guest mode regression. **Rejected as the sole mechanism.**

**B — Server-issued paste-back envelope + optional Bearer header (chosen).**
How: an MCP-hosted page performs the real login against edu-sharing, wraps the
resulting edu-sharing token into an encrypted, read-scoped, expiring envelope
(`wlo1.…`), and shows it to the user; the user pastes it into the chat; the
model passes it as an `authToken` parameter on every call. The same envelope
is also accepted as a Bearer header (for clients that can set headers), and
the header always wins. Pros: works in every host, guest default untouched,
leak damage capped (read-only + TTL), stateless, multi-user safe by
construction. Cons: token lives in conversation context (accepted for
read-scope only; see Security). Cost: ~5 packages. **Chosen.**

**C — Server-side session store (session id ↔ token map).**
How: login stores the token server-side; chat carries only a session id.
Pros: shorter string in chat. Cons: introduces exactly the state this
architecture deliberately avoids — breaks one-server-per-request equivalence,
needs eviction/TTL bookkeeping, breaks under multi-instance/Vercel, and a
session id in the chat is exfiltratable just like a token (it IS the
credential) with no crypto guarantees. **Rejected.**

**Transport of the auth context inside the process** (micro-decision):
explicit parameter threading through every function in `wlo-search.ts`,
`wlo-node.ts`, `topic-page-api.ts`, `services/*` (≈15 files of mechanical
signature churn) **vs.** `AsyncLocalStorage` set at the tool-handler boundary
and read in exactly one place (`wloFetch`). Chosen: **AsyncLocalStorage**
(`node:async_hooks`, stable since Node 16, zero deps). Rationale: the repo
already wraps both tool-registration methods once instead of touching all
call sites (`apps/tool-defaults.ts`); this extends the same seam. We control
the ALS entry point (the wrapped tool handler invokes `runWithAuth`), so no
reliance on SDK-internal context propagation; a dedicated integration test
pins that the header reaches `fetch` in both JSON and SSE response modes.

## Global constraints (from CLAUDE.md)

TypeScript ESM/NodeNext, `.js` import extensions, Node ≥ 20, no new runtime
dependencies (crypto = `node:crypto`, ALS = `node:async_hooks`), tools live in
`src/tools/<area>.ts`, env-only config, tests via `node:test` + tsx with
`tests/fetchMock.ts` (no live network), German user-facing copy / English
code+docs, no commits by the agent.

## Architecture

### Token model — the session envelope

```
wlo1.<base64url(iv 12B)>.<base64url(ciphertext||gcmTag)>
```

- AES-256-GCM, key = SHA-256 of `WLO_AUTH_SECRET` (env, required to enable
  auth; min 16 chars, recommend 32+ random).
- Plaintext payload (JSON): `{ v: 1, tok: <edu-sharing access token>,
  scope: 'read', exp: <unix seconds>, name?: <display name> }`.
- TTL: `WLO_AUTH_SESSION_TTL_MINUTES` (default **240**). Deliberate deviation
  from the review's "minutes not hours" idea: the envelope is hard-capped to
  read scope, so a working-session TTL is an accepted usability trade-off;
  the inner edu-sharing token's own expiry caps it further.
- **No refresh token inside the envelope** — a leaked envelope must not be
  renewable. Expiry ⇒ the user logs in again.
- Stateless: the server never stores anything; any instance holding
  `WLO_AUTH_SECRET` can validate any envelope (multi-instance/restart safe).
- Not revocable individually (stateless trade-off, documented); revocation =
  edu-sharing-side session invalidation or waiting out the TTL.

### Auth resolution — precedence and failure semantics

```
resolveAuth(headerValue?, authTokenArg?) →
  1. header present  → unwrap; invalid/expired → HTTP 401 (before MCP handling)
  2. else arg present → unwrap; invalid/expired → typed AuthError
                        → tool returns a clear German error + hint to wlo_login
                        (NEVER silently falls back to anonymous — the user must
                        not believe they see their scoped view when they don't)
  3. else → anonymous (exactly today's behaviour)
```

Header wins over parameter (host-managed beats model-provided). Anonymous
clients send no header, so the 401 path can never hit a guest.

### Data flow (read call, authenticated via parameter)

```
user pastes wlo1.… → model calls search_wlo_all({query, authToken})
→ [auth seam] strips authToken from args, unwrapSessionToken()
→ runWithAuth({eduToken, name, scope}, () => original handler(args))
→ handler → services → wloFetch(url)
→ wloFetch: currentAuth() present AND url starts with WLO_REPOSITORY_URL
   → add `Authorization: Bearer <eduToken>`   (host guard: never attach the
     token to any non-repository URL, e.g. Wikipedia)
→ edu-sharing ACLs decide what this user sees
→ result; seam appends `{"_auth":{"mode":"user","displayName":…}}` text block
```

Login flow (variant decided by P0 verification, see below):

```
user: "ich möchte mich anmelden" → model calls wlo_login
→ tool returns { loginUrl: <PUBLIC_URL>/auth/login, instructions }
→ user opens page in browser → authenticates against edu-sharing
→ /auth/callback (or form POST) exchanges upstream, wraps envelope
→ token page: copy button + expiry + "paste this into the chat" + safety note
→ user pastes wlo1.… → model calls wlo_auth_status({authToken}) to confirm
→ model includes authToken in every further WLO tool call
```

### Files

Create (each single-responsibility, < 300 lines):
- `src/auth/config.ts` — env resolution: `AUTH_ENABLED` (derived from
  `WLO_AUTH_SECRET` being set), secret, TTL, public URL, rate limit, upstream
  auth endpoints (variant-dependent). Pure + testable like `wlo-config.ts`.
- `src/auth/session-token.ts` — `wrapSessionToken` / `unwrapSessionToken`
  (AES-256-GCM, format above), typed `AuthError('expired'|'invalid')`.
- `src/auth/context.ts` — `AuthContext`, `runWithAuth`, `currentAuth`
  (AsyncLocalStorage), `authHeaders` helper.
- `src/auth/resolve.ts` — precedence logic `resolveAuth(...)`.
- `src/auth/upstream.ts` — the edu-sharing leg: exchange (variant A: OIDC code
  + PKCE; variant B: password grant), `fetchDisplayName(token)` via
  `GET /rest/authentication/v1/validateSession` or `/rest/iam/v1/people/-me-`
  (endpoint fixed in P0). Uses `wloFetch` WITHOUT auth context.
- `src/auth/routes.ts` — HTTP handlers for `GET /auth/login`,
  `GET /auth/callback` (A) or `POST /auth/login` (B); flow state in an
  encrypted, HttpOnly, Secure, SameSite=Lax cookie (10-min TTL); own rate
  limiter; `Cache-Control: no-store`, `nosniff`, strict same-origin CSP.
- `src/auth/pages.ts` — pure HTML renderers (login page, token page, error
  page), self-contained like `rest/search-page.ts`, German-first copy.
- `src/tools/auth.ts` — `registerAuthTools(server)`: `wlo_login`,
  `wlo_auth_status` (registered only when auth is enabled).
- `src/apps/tool-auth-seam.ts` — wraps the two registration methods (same
  pattern as `tool-defaults.ts`): injects the optional `authToken` zod param
  into every tool schema (except `wlo_login`), strips it before the handler,
  resolves, `runWithAuth`, appends the `_auth` echo block, rejects
  param-sourced tokens for any future tool not marked `readOnlyHint: true`.

Modify:
- `src/wlo-config.ts` — `wloFetch` reads `currentAuth()` and attaches the
  Bearer header behind the repository-host guard.
- `src/server.ts` — `createMcpServer(opts?: { headerAuth?: AuthContext })`;
  apply the auth seam; register auth tools when enabled.
- `src/http-app.ts` — parse/validate `Authorization` before MCP handling
  (invalid → 401); mount `/auth/*` before `/api/*`; extend CORS allowed
  headers with `Authorization`.
- `api/mcp.ts` — same header parsing for parity (login pages stay
  vServer-only; a Vercel deploy without `WLO_AUTH_SECRET` is byte-identical
  to today).
- `src/http.ts` — construct the auth rate limiter from env, pass through.
- `.env.example`, `README.md`, `README.de.md`, `docs/DEPLOYMENT.md`,
  `docs/TOOLS.md`, `CHANGELOG.md`, `docs/plans/STATUS.md`, `CLAUDE.md`
  (active-plan pointer).

### Interfaces (type-consistent across all tasks)

```ts
// auth/context.ts
export interface AuthContext {
  eduToken: string;            // inner edu-sharing access token (server-side only)
  scope: 'read';               // 'write' reserved for future header-only flows
  displayName?: string;
  expiresAt: number;           // unix seconds
  source: 'header' | 'param';
}
export function runWithAuth<T>(ctx: AuthContext | null, fn: () => T): T;
export function currentAuth(): AuthContext | null;

// auth/session-token.ts
export function wrapSessionToken(
  p: { eduToken: string; displayName?: string; ttlSeconds: number }, secret: string): string;
export function unwrapSessionToken(token: string, secret: string): AuthPayload; // throws AuthError
export class AuthError extends Error { kind: 'expired' | 'invalid'; }

// auth/resolve.ts
export function resolveAuth(
  headerValue: string | undefined, authTokenArg: string | undefined, secret: string,
): { ctx: AuthContext | null; error?: AuthError };

// server.ts
export function createMcpServer(opts?: { headerAuth?: AuthContext }): McpServer;
```

Login-required contract for FUTURE write tools (defined now, reused later):
tool returns `isError` content with German guidance + a structured block
`{"_auth":{"required":true,"loginTool":"wlo_login","reason":"write"}}` so the
model reliably offers `wlo_login` (R4).

### Login flow variants — P0 decision gate

- **Variant A (preferred): OIDC authorization code + PKCE** against the
  instance's IdP (edu-sharing OIDC/Keycloak). Credentials never touch our
  server. Requires: discovery/authorize/token endpoints + a registered client
  with pinned redirect URI `https://<host>/auth/callback`.
- **Variant B (fallback): edu-sharing OAuth2 password grant**
  (`POST <repo>/oauth2/token`) behind an MCP-hosted credential form.
  Credentials transit our server once (never stored, never logged, direct
  exchange, autocomplete attributes, explicit warning copy on the page).
  **Variant B is only built after explicit user approval**, because its trust
  model is materially different.

P0 (a read-only probe spike against staging) verifies: which variant is
possible, exact endpoints/client registration, whether the REST API accepts
`Authorization: Bearer <token>` (probe `validateSession`), token lifetime,
and records the findings in the "Verified facts" section below.

## Non-functional

**Security (threat → mitigation):**
- Envelope exfiltration via prompt injection / chat history / host tool-args
  UI → envelope is read-scoped, expiring, non-refreshable, and never valid
  for write tools; raw edu-sharing token never enters the conversation.
- Token sent to a foreign host → `wloFetch` host guard (attach only on
  `WLO_REPOSITORY_URL`-prefixed URLs); Wikipedia client untouched.
- Token in logs → seam strips `authToken` from args before any handler code
  runs; nothing logs headers or args today (pinned by test); logger note
  updated.
- Token in widget payloads → `_auth` echo carries mode+name only; test pins
  that no `wlo1.` string can appear in `structuredContent`.
- Login CSRF / code interception (variant A) → `state` + PKCE in an
  encrypted, HttpOnly, short-lived cookie; redirect URI exact-pinned.
- Credential stuffing on `/auth/*` → separate limiter
  (`WLO_AUTH_RATE_LIMIT_RPM`, default 10/min/IP).
- Silent privilege downgrade → invalid param token = hard tool error;
  invalid header = HTTP 401.
- Multi-user bleed (R8) → no server-side auth state anywhere; per-request
  server + per-call ALS scope; concurrency test with two different tokens.

**Privacy:** login pages self-contained (no external assets/fonts, matching
the launcher); credentials (variant B) and tokens never persisted or logged;
cookie limited to the 10-minute flow; no PII in URLs (`code`/`state` are the
OAuth-standard exception, delivered over TLS and consumed immediately).

**i18n / a11y:** pages German-first with one English hint line, semantic HTML,
label-tied inputs, visible focus, WCAG-AA contrast, copy button also
selectable as plain text (works without JS). `/better-coding-frontend`
accompanies P3.

**Observability:** structured logs for login start/success/failure and 401s
(user name yes, tokens never); `/health` unchanged.

**Performance:** unwrap = one AES-GCM decrypt per call (microseconds); no
extra upstream round-trips on tool calls (display name rides in the
envelope).

## Risks

- edu-sharing offers neither OIDC code flow nor password grant on the target
  instance → P0 surfaces this before any build; plan pauses for re-decision.
- REST does not accept Bearer on all needed endpoints → P0 probes
  `validateSession` + one search call; if partial, scope shrinks to the
  endpoints that do.
- Models forget to attach `authToken` on later turns → mitigations:
  `wlo_login`/`wlo_auth_status` output explicitly instructs "include this
  token in every WLO tool call", the `_auth` echo reinforces state each call;
  residual risk accepted (worst case: a call runs anonymous **and visibly
  says so** via the missing `_auth` block — no silent wrong data, and the
  user can re-paste).
- SSE response mode breaks ALS propagation → dedicated integration test in
  P1; fallback documented (explicit threading) but not expected.
- ChatGPT connector descriptor sync lag (known from the stale-URI incident)
  → new tools appear only after reconnect; documented in DEPLOYMENT.

## Verified facts (filled by P0 — empty until then)

- [ ] Auth mechanism available on staging (OIDC code+PKCE / password grant)
- [ ] Exact token endpoint(s) + client id/registration requirements
- [ ] `Authorization: Bearer` accepted by `validateSession` + `ngsearch`
- [ ] Upstream token lifetime / refresh behaviour
- [ ] Identity endpoint for display name

## Open questions

None blocking the P0 spike. Two decision gates are built into the plan:
(1) variant A vs. B after P0 (B additionally needs explicit approval);
(2) final go for P3 page copy (user reviews the German wording).
