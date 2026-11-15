# What the chatbot integration relies on

Binding rules for this area, moved verbatim out of `CLAUDE.md` on 2026-11-14 (the file had grown to 2154 lines).
A dated sentence records what was measured or decided that day; where a later block says "superseded", the later one holds.
Index: [README.md](README.md) · short rules: [`CLAUDE.md`](../../CLAUDE.md).

- **BOERDi-Wunschliste (Chatbot-Werkzeuge) — COMPLETE (P1–P6, 2026-11-06; item 9 via decision A):**
  `docs/plans/2026-11-06-boerdi-wunschliste.md` (Machbarkeit je Punkt, Blocker,
  Entscheidungen E1–E6, Phasen). Two rules bind it: every new write keeps the
  two-step rule — a batch or combined write puts EVERY step (e.g. the
  collection add of `addToCollectionId`) into the ChangeSet the token binds to;
  and `structuredContent.confirm` is built from that same ChangeSet in
  `previewReply`, never beside it. Item 9 is free for design since MA-0 was measured (2026-11-06, non-admin test
  account `WLO_TEST_USER`): no folder right → batches lie FLAT in `-userhome-`, and
  the owner's search finds them at once. Staging rejects EVERY content upload
  (500 `InvalidTypeException … property name: content`, raw REST, both accounts) —
  the same defect as the filing regression; file types/sizes stay unmeasured. (Lifted 2026-11-13: staging accepts content writes and filing again — the live suite is 16/16 — so file types and sizes were measured the same day: `npm run measure:uploads`, table in the plan file — eleven of the fifteen accepted kinds tried, each stored as detected; 50 MB takes 85 s.)
  P2 adds two rules: a licence resolves EXACTLY or not at all (`resolveVocabMatch`
  has no fuzzy step for `license` — "CC BY NC" became `CC_BY`, the freer key),
  and the `ccm:wwwurl` search returns prefix NEIGHBOURS while a decorated
  spelling (trailing slash, `utm_`) does not find the clean stored one (measured
  2026-11-06) — so `services/url-matches.ts` asks up to three spellings and
  compares every hit; never trust "a result came back".
  P3 adds: `get_collection_overview` reports an unanswered skill lookup as
  `missing: not_checked`, never as "no skills", and carries only outline levels
  0–1 (Optik: 242 headings, 19 KB in full); its text closes a printed skill list
  with `DESCRIPTIONS_ONLY_NOTE` like every other catalogue surface.
  P4 adds: `count_wlo_content_matches` never drops an unresolved filter (the
  query goes to `missing`) — a count without the filter reads as the filtered
  one; and the depth-3 tree budget (300) is computed BEFORE the walk, never by a
  counter. Staging regression found 2026-11-06: `PUT …/references/{id}` answers
  500 `InvalidTypeException` for every record — filing is not live-testable
  until the repository is fixed (see STATUS).
  E4 is decided (2026-11-06): **B** — the server holds the approval for the
  whole plan; a key may be re-presented by the SAME identity and then continues
  or replays the result, never creates twice. Design: plan file, "P5 — Entwurf".
  P5 adds (`services/write/plan-runner.ts`): a plan is bound to identity AND
  arguments, ≤ 5 per identity, every step in `ChangeSet.items` — and a preview
  line carries what is SENT in full (`flattenText`, never the capping
  `sanitizeText`: two descriptions sharing 120 characters shared a key). Measured
  2026-11-06 and binding: sibling collections created AT ONCE under one parent →
  500 `ConcurrencyFailureException: Acl…` while the collection IS created (17/24);
  different parents 12/12. So creates per parent run one at a time, and a refused
  create is looked up before it is called `failed`. Lesson: `mapPool` returns
  `null` for a throw — a measurement counting its results counts only successes
  (the "0.35 s at 4 parallel" figure was wrong for that reason).
  P6 adds: `get_skill_registry` + `task` hands over an instruction ONLY on a
  confident choice (`services/skill-for-task.ts`: a word at most half the
  candidates carry, a 1.5× lead) — plain ranking picked the wrong skill in 2 of
  4 natural phrasings on the real Optik registry; otherwise `ambiguous` with the
  candidates, never a fallback to the next one. Unresolved (unreadable) approved
  skills are candidates too. Item 9 is NOT built: a private file's bytes are not
  readable with a Basic login (`eduservlet/download` 403, `/content` 405,
  `/textContent` empty — measured 2026-11-06), so item 9 (decision A) keeps a
  compact manifest summary in `cm:description` of the vorgang.json record
  (`services/write/batch-manifest.ts`, ONE place for writer and reader; read
  back, missing → `unverified`). Measured and binding: a property the content
  model does not declare is NOT kept — `PUT …/metadata` 400, `POST …/property`
  200 and silently dropped; model text properties keep 53 950 characters.
  `wlo_list_my_batches` finds manifests through the NODE store of the own area,
  never the index (a "no batches" is a negative).

- **Chatbot-Anbindung: Budget, Überlast-Codes, sichere Wiederholung, Status-
  Endpunkte, Anmeldung Stufe 2 — COMPLETE (phases 1–7, 2026-11-07), each with a
  review whose findings are fixed (STATUS.md):**
  `docs/plans/2026-11-07-chatbot-anbindung-stabilitaet.md` (design + tasks;
  phases 5–7 implement the S7 decision R4 → R2 → R1). Phase 1 binds: the tool
  budget counts `tools/call` only, every POST is bounded at 3× before its body is
  read, a trusted client (`TRUSTED_CLIENT_KEYS`, `X-WLO-Client-Key`) is counted
  by key instead of address, and a 429 carries the rest of the window. Since
  2026-11-15 the same key on `/auth/session` and `/auth/revoke` spends the
  client's protocol budget, and the distinct-session guard counts per address the
  client names in the `X-Forwarded-For` hop it adds (the chatbot backend forwards
  the session exchange from its own path on the repository's host). Ticket and
  session blocks belong to ONE listing of their id: after a revocation or the
  twelve hours a re-exchange gives a new block, never the old one back (`/auth/status`
  answers 401 for a block of a gone listing); at the rollout, ticket blocks a reload
  had issued answered 401 once. Two
  measurements bind it: a stateless server answers `tools/call` as the FIRST POST without
  `initialize` (SDK 1.32.2), and a fresh connection to edu-sharing costs only
  0.1–0.3 s — the 22 s cold path is not the transport. Phases 2–7 add rules that
  bind: `upstream_busy` (429/503) carries `retryAfter` through ONE pairing place
  (`failureFields`); a redeemed confirm token REPLAYS its result for the same
  identity and arguments for 30 min, never writes twice, and EVERY error after
  redemption carries `outcomeOpen` — `false` only where the call provably wrote
  nothing (`exists`, a `not_stored` report with no field landed and nothing
  stored differently), else `true`; a created record is always `true`
  (`markWritten`). `requiresNewPreview` says the key is spent, never whether
  anything was written — reading it as "start over" created duplicates
  (chatbot finding 4); `/auth/status` and
  `wlo_auth_status` carry `upstream: ok|unreachable` from `checkIdentity`
  (429/5xx, a throw or a non-identity 200 = unreachable; 401/403/404 = an
  answer), and only an `unreachable` one is held 10 s instead of 60 — an outage
  must not read as a refused login, nor a refusal as an outage (chatbot team
  B2) — and every path that PROVES a login (`proveLogin`: `/auth/issue`,
  `/auth/revoke-all`, `/auth/ticket`, the OAuth consent, `/api/uploads`)
  answers an unreachable repository 503 `upstream_unreachable`, never as a
  refused login, the four REST ones through `rest/login-failure.ts`; every 429
  on `/auth*`, `/oauth/*`, `/api` and `/auth/status` is the REST shape
  `{error, code, retryAfter}` with the rest of the window (B1), `/api/uploads`
  keeping `error` as its code string; `/ready` probes at most once per 30 s
  for callers while the tick probes fresh; the slow-upstream log also fires for a
  call that THROWS (the 22 s case is past the 20 s budget). R4:
  `TICKET_ALLOWED_ORIGINS` refuses a foreign browser origin AFTER the address
  budget (a forged `Origin` must not be a free log line) and mirrors only a listed
  origin in CORS. R2: `POST /auth/revoke` takes the block as `Bearer`, answers
  200 `{revoked}` in every case. R1: the expiry lives in the allow-list
  (`RegistryEntry.exp`, checked in `registry.has`), 12 h for ticket blocks and
  for OAuth logins whose VERIFIED `redirect_uri` lies in `WIDGET_OAUTH_ORIGINS`
  (empty = no OAuth block expires — AI hosts are never affected); expired entries
  are dropped BEFORE the per-account cap counts, or a widget's daily logins
  evict the block pasted into an AI host; never a new `k` for this, because an
  unknown `k` fails an old build closed.

- **Coded errors and output schemas (2026-11-13).** A spec-following client
  validates `structuredContent` against `outputSchema` even on `isError`. So
  every tool with an output schema publishes `anyOf: [success, { error }]`
  (`apps/output-schema.ts`, applied in `registerWloTool` — one place). It rests
  on a zod hook; `tests/output-schema-errors.test.ts` is the tripwire.
