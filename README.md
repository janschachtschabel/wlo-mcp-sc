# WLO MCP Server

> 🇬🇧 English (canonical) · 🇩🇪 [Deutsche Fassung](README.de.md)

A [Model Context Protocol](https://modelcontextprotocol.io) (MCP) server that lets
AI agents **search and retrieve open educational resources (OER)** from
[WirLernenOnline (WLO)](https://wirlernenonline.de) via the public
edu-sharing REST API.

It exposes **26 read tools** (25 unconditional; `find_wlo_skills` appears only with a configured skills collection, and `get_url_text` is removable via `WLO_DISABLE_UNSAFE_TOOLS`) for full-text search, collection/topic-page browsing,
metadata lookup, and vocabulary resolution — all against the anonymous, read-only
public API. Without a login that is the whole surface: no authentication, no writes.

On top of those 25 sit **thirteen curation tools** (creating, editing,
submitting, collections, compendium texts, metadata proposals, deleting). They
are *listed* for every caller — that is how a client learns a login is worth
starting — and **refuse without one**, answering with the challenge that asks the
host to sign the user in. Every change is previewed and confirmed before it
happens, and read back afterwards — see [Curation](#curation-writing-to-wlo).

---

## Table of contents

- [Concept](#concept)
- [Features](#features)
- [Requirements](#requirements)
- [Installation](#installation)
- [Configuration](#configuration)
- [Running the server](#running-the-server)
- [REST API](#rest-api-public-read-only)
- [Prompt launcher](#prompt-launcher)
- [Tools](#tools)
- [Signing in with OAuth](#signing-in-with-oauth)
- [Curation](#curation-writing-to-wlo)
- [Output formats](#output-formats)
- [Filters & vocabulary](#filters--vocabulary)
- [Deployment](#deployment)
- [Security & operations](#security--operations)
- [Architecture](#architecture)
- [Development](#development)
- [Further documents](#further-documents)

---

## Concept

In WLO, a **Sammlung** (collection) bundles educational content by topic,
subject, or level; sub-collections are sub-topics. A collection that carries a
`ccm:page_config_ref` property additionally has a curated **Themenseite** (topic
page): a page layout of **swimlanes** (Schwimmlinien / carousels) with
target-group specific variants (teachers / learners / general).

The two are therefore **not** interchangeable. Every Themenseite is a Sammlung,
but only some Sammlungen have one — measured for "Mathematik": 5 collections, 1
topic page. `search_wlo_collections` finds all of them,
`search_wlo_topic_pages` the subset with a curated page.

Everything the server returns is public OER metadata; the server is a thin,
stateless proxy in front of edu-sharing.

## Features

- **26 MCP read tools** (25 unconditional — `find_wlo_skills` is registered only when `WLO_SKILLS_COLLECTION_ID` is set, because unconfigured it could not work) — content search, collection search, combined search, topic
  pages and their swimlane content, subject portals, tree browsing, node
  details (single & bulk), vocabulary lookup, publisher lookup, health check,
  Wikipedia summary, full compendium text, scoped in-collection search, related
  content, collection statistics, node breadcrumb, **WLO skill discovery**, and
  the ChatGPT `search`/`fetch` knowledge tools.
- **OpenAI Apps SDK support** — display tools return `structuredContent`
  (per-tool `outputSchema`) with read-only `annotations`, the server advertises
  cross-tool `instructions`, and **four inlined `ui://` widgets serve ten tools**
  (search results — shared by every tool that returns a hit list, with an
  in-widget detail view, tile selection and per-tile follow-up actions;
  topic-page swimlanes under a title/description header, each card openable;
  an interactive collection browser; and a reading view for a material's full
  text),
  each described by widget `_meta` (description, CSP, `prefersBorder`) —
  theme-aware, WCAG 2.2 AA, DE/EN. Non-Apps clients are unaffected.
  Buttons that continue the conversation inject a chat message, which is a
  **ChatGPT extension** (`sendFollowUpMessage`); the MCP-Apps standard bridge
  offers no equivalent, so on other hosts those buttons are omitted rather than
  rendered dead, and the widgets are display-only. Local interaction (detail
  view, back, expanding the tree) works everywhere.
- **Quality reranking** — multi-query expansion (synonyms, keyword, title,
  stop-word variants) fused with Reciprocal Rank Fusion (RRF) and a metadata
  quality score. Deterministic ordering.
- **Two transports** — stdio and a standalone Streamable HTTP server — both from
  one transport-agnostic server factory.
- **Public REST layer** (HTTP mode) — read-only `GET /api/{search,compendium,
  topic-page,wikipedia}` wrappers over the same services, for non-MCP AI tools
  and the prompt launcher. Rate-limited, CORS `GET`, validated. See
  [REST API](#rest-api-public-read-only).
- **Prompt launcher** (HTTP mode) — a self-contained, bilingual (DE/EN) static
  page at `/launcher.html`, guided by **Boerdi** the WLO owl: pick your AI and one
  **Open** button hands that chat the knowledge to use the WLO services itself
  (search + raw JSON + ready-made skills from `GET /api/collection`), as a
  Claude/ChatGPT/Copilot/Gemini message. Advanced query fields collapse by default;
  a bookmarklet pre-fills a selection. See [Prompt launcher](#prompt-launcher).
- **Personal access blocks** (HTTP mode, opt-in via `WLO_AUTH_PRIVATE_KEY`) — a
  page at `/auth` where someone signs in with their own WLO account and gets an
  access block whose password was encrypted **in the browser**. They paste it
  once into their AI host and revoke it at `/auth-revoke.html`. Unlike a Basic
  header, the block is unreadable to the AI provider, useless against anything
  but this server, and withdrawable without a password change.
- **German ⇄ URI vocabulary** — filters accept German labels
  (`Mathematik`, `Grundschule`, `Lehrer/in`, `Video`) or full URIs.
- **Hardened HTTP mode** — upstream timeouts, request-body size limit, per-IP
  rate limiting, URL-encoded node IDs, structured JSON logging.

## Requirements

- **Node.js ≥ 20** (pinned in `package.json` `engines`; CI and the Docker image
  build/test against Node 20).
- **npm ≥ 9**.

## Installation

```bash
git clone <repo-url>
cd wlo-mcp-server
npm install
npm run build
```

**Optional — let people sign in with their own WLO account** (HTTP mode). Skip
this and the server reads anonymously; `/auth` then says it issues no access.

```bash
openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 -out authkey.pem
[ -n "$(tail -c1 .env)" ] && echo >> .env   # .env may lack a trailing newline
printf 'WLO_AUTH_PRIVATE_KEY="%s"\n' "$(cat authkey.pem)" >> .env
chmod 600 authkey.pem .env
docker compose config > /dev/null && echo "env OK"   # under Docker: parse check
```

A `.env` file is **not** a shell: writing `WLO_AUTH_PRIVATE_KEY="$(cat key.pem)"`
into it stores that literal text and the key is rejected at startup. The `printf`
above writes the PEM itself. The `tail -c1` guard matters — appending to a file
whose last line has no newline glues the key onto that line, and compose then
refuses to parse the file at all (hit in the field, 2026-08-05). The public key is derived from it — there is no
second variable. **Whoever holds this key can decrypt every issued block back
into a live WLO password**: server only, never the image or the repository.

## Configuration

All configuration is via environment variables. Copy `.env.example` to `.env`
and adjust as needed — `npm run dev`, `dev:http`, `start` and `start:http` load it
via Node's `--env-file-if-exists`, and `docker compose` picks it up on its own.
(`npm test` deliberately does NOT: the suite must not depend on a local file.) Only `WLO_REPOSITORY_URL` is commonly changed; everything
else has sensible defaults.

| Variable | Default | Scope | Description |
|---|---|---|---|
| `WLO_REPOSITORY_URL` | `https://redaktion.openeduhub.net/edu-sharing` | all | edu-sharing instance the server talks to. Paths are identical across instances, so this base URL is the only switch between prod / staging / a custom repository. Input is forgiving: whitespace, trailing slash(es), and a trailing `/rest` are stripped; a missing protocol defaults to `https://`; a bare host gets `/edu-sharing` appended. Suspicious values (deep `/components/...` links, double `/edu-sharing`) log a startup warning. |
| `WLO_ROOT_COLLECTION_ID` | per host | all | Root node of the collection hierarchy — **repository-bound**. The known WLO hosts (prod `redaktion.openeduhub.net`, staging `repository.staging.openeduhub.net`) get a per-host default automatically (the same id on both today, live-verified 2026-07-17, but maintained per host). Any **other** edu-sharing instance must set this explicitly — otherwise the server logs a startup warning and falls back to the WLO id, which will not exist there. |
| `WLO_SKILLS_COLLECTION_ID` | _(unset)_ | all | nodeId of the WLO collection holding the launcher **skills** (uploaded Markdown files). When set, `GET /api/collection` with no `nodeId` defaults to it. Unset → callers pass an explicit `?nodeId=`. |
| `WLO_POOL_SIZE` | `25` | all | Candidate pool size **per search variant** for reranking (`enhancedSearch`) — **not** the number of returned hits (that is `maxResults`). Smaller = faster/smaller fetches at minimally lower recall. |
| `WLO_FETCH_TIMEOUT_MS` | `20000` | all | Per-request timeout (ms) for every upstream edu-sharing call. Prevents a hung backend socket from blocking a tool call. Sized from measurement (staging, 2026-08-02): creating a record takes 4.2–8.0 s, every other call under 2.5 s. |
| `WLO_SERVICE_USER` / `WLO_SERVICE_PASSWORD` | _(unset)_ | all | Optional service account. Unset (default) → the server reads **anonymously**, public content only, exactly as before. Both set → every call authenticates as that one account via HTTP Basic, so **all** users of this MCP see the same elevated content. Use a purpose-made, read-only account: whatever it can see, every user can see, and edu-sharing's audit trail shows the service account rather than the person. Half a credential is treated as none. **Wrong credentials do not downgrade to public content** — the repository answers `401` (measured against production 2026-07-31, on the identity and the search endpoints alike), so every query fails and the server returns nothing at all. Unset both variables to run anonymously instead. Check with the `wlo_auth_status` tool: `mode: "service"` together with `authenticated: false` means the credentials are being rejected. HTTP Basic is used because it is the only scheme besides the session cookie that edu-sharing's own OpenAPI declares. **Scope:** the service account applies to the MCP endpoint only. The public REST layer (`GET /api/*`) and the launcher stay anonymous by design — they are reachable from the internet without any login, so letting them inherit the account would make everything it can see world-readable. A credential over a non-`https` repository URL is sent in the clear (Basic is base64, not encryption); the server warns about this at startup. |
| `WLO_ALLOW_SERVICE_WRITES` | _(unset)_ | all | Allows the **service account** to use the curation (write) tools. Off by default: a change made under a shared account is attributable to nobody — the repository history records the account name, not the person who asked for it. A caller with their own WLO login may always write and needs nothing here; an anonymous caller never can — they see the tools (that is how their client learns to offer a login) and every call is refused. This also governs stdio, where the credentials come from the environment and therefore count as a service account. Accepted values: `1`, `true`, `yes`, `on`; anything else (including `false`) leaves it off. See [Curation](#curation-writing-to-wlo). |
| `WLO_AUTH_PRIVATE_KEY` | _(unset)_ | http | PKCS#8 PEM enabling **personal access blocks**: a user fetches an encrypted block at `/auth`, pastes it once into their AI host's `Authorization` field as `Bearer …`, and can revoke it at `/auth-revoke.html` (or `/auth/revoke` — the same page). Each account keeps its ten most recent blocks. Unset means the whole feature is off — the `/auth/…` endpoints answer 404, the pages say so, and a Bearer header is refused exactly as before. The public key is DERIVED from this one, so there is no second variable to drift. Generate with `openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048`. **This key decrypts every issued block back into a live WLO password** — keep it in the server's `.env`, never in the image or the repository. |
| `WLO_AUTH_PRIVATE_KEY_PREVIOUS` | _(unset)_ | http | The previous key during a rotation. Blocks are always issued with the current key but opened with either, so a rotation does not invalidate every user's configuration at once; remove it once the overlap window is over. An unusable value here switches the feature **off** rather than silently dropping the window — otherwise exactly what the window exists for would break, and you would hear about it from users instead of from the boot log. |
| `WLO_AUTH_REGISTRY_PATH` | `/data/access-registry.json` | http | Where the allow-list of issued access ids lives. It holds ids, user names and issue times — **never a credential**. It is a POSITIVE list: lose it and every issued block stops working (inconvenient) rather than every revoked block starting to work again (unsafe). In Docker this is the one writable volume; `read_only: true` still covers everything else. **Back it up.** |
| `WLO_PUBLIC_BASE_URL` | _(unset)_ | http | The public origin clients type in, e.g. `https://wlo-mcp.example.org` — scheme and host, no path. It is what the OAuth discovery documents (`/.well-known/oauth-authorization-server`, `/.well-known/oauth-protected-resource`) name as their own endpoints. Unset means those paths answer 404 unless `TRUST_PROXY=1`, in which case the origin is derived from the request's `Host` header — which the CALLER supplies. Set it: a forged header would otherwise point somebody's client at a login page we do not own. Independent of the access-block feature only in appearance — both are off without `WLO_AUTH_PRIVATE_KEY`, since an OAuth login issues exactly the same access block. |
| `WLO_INBOX_ID` | _(unset)_ | all | nodeId of the shared inbox new records are filed in when the server writes under the **service account**. A personal login files to `-userhome-` instead and needs nothing here. Deliberately without a default: node ids are repository-bound, so a hardcoded one would point at a different collection on staging than on production, and at nothing elsewhere. Unset means service-account creation is refused with a message naming this variable — better than a record filed somewhere nobody looks. |
| `AUTH_CREDENTIAL_LIMIT` | `10` | HTTP mode | How many **distinct** logins one client address may present within 10 minutes; over the limit returns 429. The server forwards a client-supplied `Authorization` header upstream, so it could be used to guess WLO logins from *our* address. A requests-per-minute cap is the wrong instrument here — a per-user client sends its header on **every** call — so the signal is the number of different logins: a real person has exactly one. `0` disables the check. |
| `WLO_DISABLE_UNSAFE_TOOLS` | *(unset — nothing disabled; shipped as `all`)* | all | Switches off tools that declare themselves **unsafe**. A comma/space-separated list of tool names, or `all` (also `1`/`true`/`yes`/`on`). Unset means unsafe tools ARE registered, and the server logs a warning naming each one at startup — a risk that only appears in a changelog is one nobody inheriting a deployment will read. `.env.example` and `docker-compose.yml` ship `all`, i.e. **off by default in a real deployment**; set the variable to an empty value to switch them on. Currently exactly one tool is affected: `get_url_text`. Note that `get_wlo_content_text` is **not** — see [Tools declared unsafe](#tools-declared-unsafe). |
| `WLO_TEXT_EXTRACTION_URL` | *(none — unset disables)* | all | Base URL of the text-extraction service `get_wlo_content_text` falls back to for externally linked material (`ccm:wwwurl`) whose text the repository has not stored. Each instance normally runs its own, so there is **no default**: unset (or empty) disables the external path and logs why, and the repository's own `/textContent` remains the only source. A value that cannot serve as a base (no scheme, not http(s), or carrying a query/fragment) disables it and warns too, so a typo cannot redirect material URLs to a host you did not choose. Point it at the extraction service belonging to *your* repository — a default pointing at the staging service used to send production material URLs into another environment. |
| `WLO_TEXT_TIMEOUT_MS` | `25000` | all | Timeout (ms) for full-text reads — both `/textContent` and the extraction service. Deliberately larger than `WLO_FETCH_TIMEOUT_MS`: `/textContent` was measured at a 4.6 s median and a 9.2 s maximum. Full text is the one call allowed to take longer than everything else. |
| `WLO_TOPIC_POOL` | `10` | all | Fan-out width for topic-page candidate enrichment (metadata reads issued in parallel). Higher = fewer sequential waves at more simultaneous upstream load. |
| `PORT` | `3000` | HTTP mode | Port for the standalone HTTP server. |
| `MCP_SSE` | `false` | HTTP mode | When truthy (`1`/`true`/`yes`), serve `POST /mcp` as a real Server-Sent-Events stream (required by ChatGPT developer mode). Default is single-JSON responses (maximal client compatibility). Behind a reverse proxy, buffering **must** be disabled for the `/mcp` location — see [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md). The Docker image defaults this to `1`. |
| `WLO_WIDGET_MIME` | `text/html;profile=mcp-app` | all | MIME type for the inlined Apps-SDK widget resources. Default is the MCP-Apps standard (portable). Set to `text/html+skybridge` if a legacy ChatGPT runtime does not render the widgets with the standard value. |
| `WLO_WIDGET_DOMAIN` | unset | all | App identity domain for the ChatGPT plugin submission (required + unique per app there; widgets render under `<domain>.web-sandbox.oaiusercontent.com`). When set, it is emitted on `_meta.ui.domain` **and** its `openai/widgetDomain` alias; **when unset, on neither** — a host validates the domain against its own sandbox format and rejects the whole widget (aborting the bound tool call) for a foreign value: Claude expects `{hash}.claudemcpcontent.com` and normalises the vendor alias onto the standard key, so dropping only one is not enough. Leave unset for Claude and every non-ChatGPT host. The widget CSP allowlist stays the edu-sharing origin regardless. |
| `MAX_BODY_BYTES` | `1048576` (1 MB) | HTTP mode | Max request-body size **in bytes**; larger POSTs get `413`. Caps a memory-exhaustion vector. Plain digits only — `1MB` is refused with a warning and the default is kept, rather than read as `1` byte (which would answer every request with `413`). |
| `RATE_LIMIT_RPM` | `120` | HTTP mode | Requests/minute **per client IP** on the MCP endpoint; over the limit returns `429`. `/health` is exempt. Set `0` to disable (e.g. behind a WAF/platform limiter). |
| `API_RATE_LIMIT_RPM` | `30` | HTTP mode | Requests/minute **per client IP** on the public REST endpoints (`GET /api/*`); over the limit returns `429`. Tighter than `RATE_LIMIT_RPM` because it is an anonymous public surface. Set `0` to disable. |
| `TRUST_PROXY` | `false` | HTTP mode | When truthy (`1`/`true`/`yes`), take the client IP from the rightmost (proxy-appended) `X-Forwarded-For` hop instead of the socket address — required for correct per-client rate limiting **behind a reverse proxy**. Off by default because `X-Forwarded-For` is spoofable on a directly-exposed server. |


**Number formats.** Every numeric variable above takes plain digits and nothing
else. A value with a unit or separator (`20s`, `1MB`, `120/min`) is **refused**
with a warning naming the variable, and the default is used — `parseInt` would
otherwise stop at the first non-digit and silently produce a 20-millisecond
timeout or a one-byte body cap. The rate limits additionally accept `0`, which
means "disabled"; every other numeric variable requires at least `1`.

### Who the server reads as

Three modes, in the order the server resolves them per call:

1. **Anonymous** (default, no configuration) — public content only. This is
   what every deployment does until you change something.
2. **One shared service account** — set `WLO_SERVICE_USER` and
   `WLO_SERVICE_PASSWORD`. Every user of this MCP server then sees the same
   elevated content. Applies to the MCP endpoint only; `GET /api/*` and the
   launcher stay anonymous.
3. **Each person with their own WLO login.** The host sends an `Authorization`
   header the server binds to that single request — nothing is stored, and the
   model never sees it. Results follow that person's own rights, and
   edu-sharing's audit trail names them rather than a shared account. Two ways
   to produce that header, and they are not equivalent:

   - **An encrypted access block (recommended).** With `WLO_AUTH_PRIVATE_KEY`
     set, the user opens `/auth`, signs in with their WLO account, and the page
     encrypts the password **in the browser** into a `wlo2.…` block that only
     this server can open. They paste it once as `Bearer wlo2.…` and can revoke
     it at `/auth-revoke.html`.
   - **`Authorization: Basic <base64(user:password)>`.** Works everywhere and
     needs nothing on the server — but base64 is not encryption. The value *is*
     the password, it is readable by whoever stores it, it works against **all**
     of WLO rather than just this server, and it cannot be withdrawn short of a
     password change. Building it on a command line writes the password into the
     shell history. Use it where the block is not offered.

A per-user credential overrides the service account for that request; without
either, the call is anonymous. Ask the `wlo_auth_status` tool which mode is
active — and note that `authenticated` is a separate fact from `mode`, because
edu-sharing answers as guest instead of rejecting bad credentials.

Whether mode 3 is available depends on the AI host: it must let you set a
custom header on the connector. Where it cannot, modes 1 and 2 still apply.

> **One server = one repository.** Each process points at exactly one
> edu-sharing instance. To serve prod and staging in parallel, deploy two
> instances with different `WLO_REPOSITORY_URL`.

## Running the server

```bash
node dist/stdio.js        # stdio transport (Claude Desktop, local clients)
node dist/http.js         # HTTP mode → http://localhost:3000/mcp

npm run dev               # stdio with auto-reload (tsx)
npm run dev:http          # HTTP with auto-reload (tsx)
npm test                  # offline unit/smoke tests (node:test)
npm run test:coverage     # the same suite plus the runner's coverage report
npm run typecheck         # type gate over src + tests + widget entry points
```

## REST API (public, read-only)

In HTTP mode the server also exposes a small **public REST layer** — thin `GET`
wrappers over the same services the MCP tools use, for non-MCP AI tools and the
prompt launcher. Read-only, `CORS *` for `GET`, per-IP rate-limited
(`API_RATE_LIMIT_RPM`, default 30/min), inputs validated server-side (query ≤
200 chars, nodeId ≤ 50, ≤ 25 ids). Responses are JSON with `Cache-Control:
no-store` + `nosniff`; errors are `{ "error": "…" }` with a `4xx`/`5xx` status.
One deliberate exception: `GET /api/search` **without a term** returns a `200`
guidance envelope (empty buckets + `warnings`) instead of a `400` — AI fetch
layers strip query strings from model-built URLs and surface only the status,
so the guidance must live in a readable body. `?format=html` on `/api/search`
(both forms) renders the same envelope as a minimal, self-contained HTML page —
for AI browsing pipelines that open URLs but only consume reader content (raw
JSON is dropped), and as the human-friendly share link. The surface is
self-describing for AI fetchers via [`/llms.txt`](public/llms.txt) and
permissive [`/robots.txt`](public/robots.txt).

| Endpoint | Query params | Returns |
|---|---|---|
| `GET /api/search/<term>` | Path form of `/api/search` — the term rides in the **path**, filters stay optional query params. Preferred for AI tools: some AI fetch layers strip the query string from model-built URLs (live-diagnosed), and the path form survives that — a stripped request only loses the filters, not the search. An explicit `q` query param wins over the path term. | Same envelope as `GET /api/search`. |
| `GET /api/search` | `q` (required), `educationalContext`, `discipline`, `learningResourceType`, `userRole`, `publisher`, `maxContent`, `maxCollections`, `skipCount`, `include` (`content,collections,topicPages`), `includeCompendium`, `includeTextContent`, `includeWikipedia`, `includeTopicPageContent`, `maxPerSwimlane`, `includeFacets`, `fields` | The combined `search_wlo_all` envelope (`content` / `collections` / `topicPages` buckets, optional `wikipedia`). Adds `unresolvedFilters` (mistyped vocab filters + "did you mean" suggestions) when any filter doesn't resolve, and — with `includeFacets=1` — `facets` (`{label, count, uri}` per bucket; the `discipline` facet resolves university subjects, see below). Optional `fields=title,url,…` trims each result item to those keys (`nodeId` always kept) — a token saving for LLM clients reading the raw JSON. |
| `GET /api/collection` | `nodeId` (defaults to `WLO_SKILLS_COLLECTION_ID`), `q` (optional, search within), `max`, `fields`, vocab filters | A collection's contents: `{ collectionId, query, total, results: [{ nodeId, title, description, learningResourceTypes, publisher, url, downloadUrl }] }`. Without `q` it lists the direct file children (reliable for reference collections); with `q` it searches within. Optional `fields=…` trims each result item (`nodeId` always kept). The launcher's **skills** source — each result's `downloadUrl` serves the raw Markdown. |
| `GET /api/compendium` | `ids` (comma-separated) or `nodeId`, ≤ 25 | `{ entries: [{ nodeId, title, compendiumText }] }` — the FULL editorial compendium text. |
| `GET /api/topic-page` | `collectionId` or `variantId` (≥ 1 required), `targetGroup` (`teacher`/`learner`/`general`), `maxPerSwimlane` | The render-ready swimlane payload (`variantTitle`, `topicPageUrl`, `swimlanes[]`). |
| `GET /api/wikipedia` | `q` (required), `lang` (default `de`), `sections` (1–3) | A Wikipedia lead summary `{ title, extract, thumbnail?, url, lang, match }`, or `404` when no article matches. `match` is `exact` (the title as asked, or a Wikipedia redirect from it) or `fuzzy` (no article of that name; resolved by search and checked for relevance). A candidate that is not on topic yields `404`, not a plausible wrong article — see [Wikipedia resolution](#wikipedia-resolution). |
| `GET /api/skills` | — | The skill catalogue `{ skills: [{ id, name, description, path }] }` for AI apps (see [Prompt launcher](#prompt-launcher)). |
| `GET /api/skills/<id>` | — | One skill's **raw Markdown** (`text/markdown`), or `404` for an unknown id. `<id>` is a stable slug today (intended to become a WLO nodeId later). |

```bash
curl "http://localhost:3000/api/search?q=Photosynthese&includeWikipedia=1"
```

The REST layer is served by `http.ts` only — **not** by the stdio entry point.

## Prompt launcher

In HTTP mode the server serves a static, bilingual (DE/EN) **prompt launcher** at
`GET /launcher.html` (and `GET /` as a convenience), guided by **Boerdi**, the WLO
owl mascot who helps users set up the WLO services. It is a self-contained page —
no third-party scripts, fonts, or requests. You pick your AI and click one **Open**
button; the launcher hands that chat the **knowledge** to use the WLO services
itself. The generated message explains

- how to search — `GET /api/search?q=…` (+ the `discipline` / `educationalContext`
  / `learningResourceType` filters and the `includeWikipedia` / `includeCompendium`
  flags) — and to load the JSON result **raw** and summarise it,
- the other endpoints (`/api/topic-page`, `/api/compendium`, `/api/wikipedia`), and
- how to use ready-made **skills**: list them at `GET /api/collection` (the
  configured WLO skills collection) and load each skill's raw Markdown from its
  `downloadUrl`.

Advanced query fields (subject / level / type) are **collapsed by default**; an
optional search term is woven in as a concrete example and drives the **Load raw
result** button. The message can be **copied** into any chat or opened via a deep
link in **Claude** (`claude.ai/new?q=`), **ChatGPT** (`chatgpt.com/?q=`), or
**Microsoft Copilot** (`copilot.microsoft.com/?q=`); for **Gemini** (no native URL
prefill) the app opens and the message is placed on the clipboard to paste.
Natively-registered MCP clients get the same skills via the `find_wlo_skills` tool.
A [bookmarklet](public/bookmarklet.md) opens the launcher pre-filled with the text
selected on any page (`/launcher.html?q=<selection>`).

## Tools

| # | Tool | Purpose | Output |
|---|---|---|---|
| 1 | `search_wlo_collections` | Search collections/topic pages (keyword + tree fallback) | markdown / json |
| 2 | `search_wlo_content` | Full-text search for individual content items | markdown / json |
| 3 | `get_collection_contents` | Items / sub-collections of a collection (paginated, optional recursive) | markdown / json |
| 4 | `get_node_details` | Full metadata for one node + optional full text + parents + raw URIs | markdown / json |
| 5 | `search_wlo_all` | **Combined**: content + collections + topic pages in one parallel call, separate buckets | markdown / json |
| 6 | `lookup_wlo_vocabulary` | List valid labels/URIs for a filter vocabulary | markdown |
| 7 | `search_wlo_topic_pages` | Find/list topic pages, merge target-group variants | markdown / json |
| 8 | `get_subject_portals` | The top-level subject portals under the WLO root | markdown / json |
| 9 | `browse_collection_tree` | Drill into sub-collections (depth 1–2), optional file counts | markdown / json |
| 10 | `wlo_health_check` | Reachability + latency of the WLO API | json |
| 11 | `get_nodes_details` | Bulk metadata for many `nodeIds` in parallel | json |
| 12 | `get_topic_page_content` | The swimlane **content structure** of a topic page, render-ready | markdown / json |
| 13 | `get_wikipedia_summary` | Short Wikipedia lead extract (+ link) for a term — encyclopedic context | markdown / json |
| 14 | `get_compendium_text` | FULL editorial compendium text of one/more collections (bulk, ≤25) | markdown / json |
| 15 | `search_wlo_within_collection` | Filtered full-text search scoped to one collection subtree | markdown / json |
| 16 | `search` | ChatGPT knowledge convention: lightweight hits `{id,title,url}` across WLO | json (+ text) |
| 17 | `fetch` | ChatGPT knowledge convention: one node's full document `{id,title,text,url,metadata}` | json (+ text) |
| 18 | `lookup_wlo_publishers` | List publishers/sources with per-publisher content counts (facet) | markdown / json |
| 19 | `get_related_content` | "More like this": content sharing a seed node's subject/level (+ optional siblings) | markdown / json |
| 20 | `get_node_breadcrumb` | A collection's ancestor path (root → node) in the content tree | markdown / json |
| `get_node_collections` | Which collections a material is filed in — the reverse of every other lookup. Answers "where does this sit?" and "where do I find more like it?". Resolves a reference id to its original first, so an id from a collection listing works like one from a search. |
| 21 | `get_collection_stats` | A collection's composition: file/sub-collection counts + type/subject/level breakdown | markdown / json |
| 22 | `find_wlo_skills` | Find WLO "skills" (reusable instruction Markdown curated in a WLO collection) matching a task and return their instructions to apply | markdown / json |
| 23 | `get_wlo_content_text` | A material's OWN full text (worksheet, article), not its metadata — repository first, linked page as fallback | markdown / json |
| 24 | `get_node_collections` | Which collections a given material sits in (reverse lookup via `/usage/v1`) | markdown / json |
| 25 | `wlo_auth_status` | Which identity this session is using, and what it may do | markdown / json |
| 26 | `get_url_text` | **UNSAFE** — the text behind an ARBITRARY web URL, via the extraction service. Not for WLO material (use 23). Switchable off with `WLO_DISABLE_UNSAFE_TOOLS`; **not recommended in production** — see [Tools declared unsafe](#tools-declared-unsafe) | markdown / json |

The display/search tools also return `structuredContent` (validated against a
per-tool `outputSchema`) and carry `annotations` (`readOnlyHint`; `openWorldHint`
for `get_wikipedia_summary`) — the OpenAI Apps SDK / MCP Apps foundation. The
server advertises cross-tool usage `instructions`. See [`docs/plans/`](docs/plans/).

### Tool routing heuristic (for LLMs)

- Broad topic, wants content **and** collections **and** topic pages together → `search_wlo_all`.
- A material/resource type (video, worksheet, …) → `search_wlo_content`.
- A topic page / collection on a subject → `search_wlo_topic_pages` (mode B, with `query`).
- Navigate a subject (drill-down) → `get_subject_portals`, then `browse_collection_tree`.
- User clicks a card → `get_node_details` with that `nodeId`.
- Need metadata for N shown cards → `get_nodes_details(nodeIds=[...])` (one call, not N).
- See what is **on** a topic page → `get_topic_page_content` (after `search_wlo_topic_pages`).

### Tool details

**1. `search_wlo_collections`** — `query`, `parentNodeId?`, `educationalContext?`,
`discipline?`, `userRole?`, `maxResults?` (1–50, default 5), `excludeNodeIds?`
(≤200), `outputFormat?`. Tries a keyword collection search first, then a bounded
tree traversal from the root/parent.

**2. `search_wlo_content`** — `query` (required), `educationalContext?`,
`discipline?`, `userRole?`, `learningResourceType?`, `publisher?`, `maxResults?`
(1–50, default 8), `excludeNodeIds?` (≤200), `includeTextContent?` (default
false — also fetch each result's stored full text, capped; one round-trip per
result), `includeFacets?` (default false — facet counts in `_queryMeta.facets`,
run in parallel), `outputFormat?`. Multi-query expansion + quality reranking.

**3. `get_collection_contents`** — `nodeId` (required), `query?`, `contentFilter?`
(`files` | `folders` | `both`, default `files`), `includeSubcollections?`
(recursive, files only), `maxResults?` (1–100, default 20), `skipCount?`,
`excludeNodeIds?` (≤200), `outputFormat?`.

**4. `get_node_details`** — `nodeId` (required), `includeTextContent?`,
`includeParents?`, `includeRaw?`, `outputFormat?`. Returns the same
`FormattedNode` shape as search tools, plus optional stored full text, parent
collections, and raw `ccm:*`/`cclom:*` URIs. For collections with a curated
**compendium text** (`ccm:oeh_collection_compendium_text`), it comes back as
`compendiumText` — the most authoritative collection summary. The detail tools
carry the full text (`-all-` query); collection search/list/browse also carry it
(part of `DISPLAY_PROPS`) — capped at 500 chars in `markdown`, full in `json`.

**5. `search_wlo_all`** — `query` (required), the five filters, `maxContent?`
(1–50, default 8), `maxCollections?` (1–20, default 5), `include?`
(`['content','collections','topicPages']`), `excludeNodeIds?` (≤200),
`skipCount?` (content paging), `includeFacets?` (default false — facet counts in
`_queryMeta.facets`, run in parallel), and the opt-in enrichment flags
`includeCompendium?` / `includeTextContent?` / `includeWikipedia?` /
`includeTopicPageContent?` (+ `maxPerSwimlane?`, 1–10, default 3),
`outputFormat?` (default `markdown` — compact text; the full bucket envelope
always rides in `structuredContent`, and `json` puts it in the text too). Runs
content, collection, and (when requested)
Wikipedia search in parallel and returns three buckets (+ optional `wikipedia`);
enrichments run bounded/parallel over the results. Note on `total`:
`content.total` is the true backend hit count; `collections.total`/
`topicPages.total` are the shown counts. The logic lives in
`src/services/search.ts::searchAll` (shared with the REST layer and widgets).

**6. `lookup_wlo_vocabulary`** — `vocabulary` (`educationalContext` | `discipline`
| `userRole` | `lrt` | `license` | `targetGroup` | `universitySubject`). Lists
labels + URIs; purely local, no API call. `universitySubject` (Hochschulfächer,
344 concepts) is large, so pass a free-text `query` (e.g. `"Maschinenbau"`) to get
a short fuzzy pick-list of `{label, uri}` — the chosen `uri` is usable directly as
a `discipline` filter. Model-free (Levenshtein), never auto-resolved.

**7. `search_wlo_topic_pages`** — `query?`, `targetGroup?` (`teacher` | `learner`
| `general`), `educationalContext?`, `collectionId?`, `mergeVariants?` (default
true), `sort?` (`relevance` | `alpha`), `maxResults?` (1–20, default 5),
`includeContent?` (default false; JSON mode — attach each page's resolved
swimlane `content`, ≤5 parallel) + `maxPerSwimlane?` (1–10, default 3),
`outputFormat?`. Three modes: by `collectionId` (direct), by `query` (search →
check for topic page), or filters-only (list all).

**8. `get_subject_portals`** — `educationalContext?`, `includeContentCounts?`,
`outputFormat?`. The first-level collections directly under the WLO root
(Mathematik, Informatik, …), alphabetically ordered.

**9. `browse_collection_tree`** — `nodeId?` **or** `subject?` (at least one; give
a subject/Fachportal name like `"Mathematik"`/`"Mathe"` and it is resolved to its
portal server-side — no `get_subject_portals` round-trip needed; an unknown
subject returns the list of available portals), `depth?` (1–2, default 1),
`includeContentCounts?`, `includeContentPreview?` (1–5 — attach the first N
content items of each sub-collection as `contentPreview`, bounded pass),
`maxResults?` (1–100, default 50), `outputFormat?`.

**10. `wlo_health_check`** — no parameters. Returns `ok`, latency, repository URL,
resolved root title.

**11. `get_nodes_details`** — `nodeIds` (array, 1–50, required),
`includeTextContent?` (default false), `includeParents?` (default false). Bulk
metadata (the same `FormattedNode` shape, keyed by nodeId), optionally enriched
per node like `get_node_details`. Failed lookups are returned in a `failed`
array, not as an overall error.

**12. `get_topic_page_content`** — `collectionId?` **or** `variantId?` (at least
one required), `targetGroup?`, `outputFormat?`, `maxPerSwimlane?` (1–10, default
3). Returns the topic page's swimlane sections. In JSON mode each swimlane is
**render-ready**: it carries its heading plus up to `maxPerSwimlane` real content
cards, resolved by executing the swimlane widget's saved query, with a `hasMore`
flag and a `topicPageUrl` jump link. Use after `search_wlo_topic_pages`.

**13. `get_wikipedia_summary`** — `query` (required, ≤200), `language?` (ISO-639,
default `de`), `sections?` (1–3 leading paragraphs, default 1), `outputFormat?`.
Returns a Wikipedia lead extract with a link (and optional thumbnail), resolving
a fuzzy/misspelled query via search when the direct title misses. The summary
carries `match`: `exact` for the title as asked (or a Wikipedia redirect from
it), `fuzzy` when it was resolved by search — the Markdown output states the
substitution in that case. When no candidate is on topic the tool returns
nothing rather than the closest string; see
[Wikipedia resolution](#wikipedia-resolution). For encyclopedic context
alongside WLO material — not for OER material search.
`readOnlyHint` + `openWorldHint`.

**14. `get_compendium_text`** — `nodeId?` **or** `nodeIds?` (array, ≤25),
`outputFormat?`. Returns the FULL, untruncated editorial compendium text of the
given collection(s) — the authoritative prose overview — for when a collection
result shows only the 500-char preview. `compendiumText` is `null` for nodes
without the property.

**15. `search_wlo_within_collection`** — `nodeId` (required, the collection),
`query?`, the five vocab filters, `maxResults?` (1–50, default 10), `skipCount?`,
`outputFormat?`. A full-text search scoped to one collection subtree (via
`virtual:primaryparent_nodeid`) — "which videos on X are in this collection?".
Use `search_wlo_content` for an unscoped search, `get_collection_contents` to
list a collection unfiltered.

**16. `search`** and **17. `fetch`** — the ChatGPT *knowledge convention*, a
fixed pair of names and shapes a host may call on its own for retrieval-augmented
answers. `search` takes a `query` and returns deliberately lightweight hits
(`{id, title, url}`) so a model can cite without paying for full records;
`fetch` takes one of those `id`s and returns the whole document
(`{id, title, text, url, metadata}`). They are a thin convention layer over the
same pipeline as 2 and 23 — offered under the names that convention requires, so
a host that looks for them finds them. For anything a person asks in words, the
richer tools above are the better choice.

**18. `lookup_wlo_publishers`** — `query?`, `discipline?`, `educationalContext?`,
`maxResults?` (1–100, default 20), `outputFormat?`. Lists the publishers/sources
(`ccm:oeh_publisher_combined`) with per-publisher content counts, via a facet
aggregation over the live index (largest first). Optionally scoped to a topic /
subject / level. Use it to discover valid values for the `publisher` filter.

**19. `get_related_content`** — `nodeId` (required, the seed), `maxResults?`
(1–30, default 8), `includeSiblings?` (default `false`), `outputFormat?`. Reads
the seed's disciplines + educational contexts and finds other material with the
same profile (the seed excluded); `includeSiblings` also returns the other
contents of the seed's primary parent collection. "Was passt noch dazu?"

**20. `get_node_breadcrumb`** — `nodeId` (required), `outputFormat?`. Returns the
node's ancestor path ordered root → node (one `/parents` call, cycle-guarded,
depth-capped). Works for collection nodes; file/content nodes have no breadcrumb
and return an empty path.

**21. `get_collection_stats`** — `nodeId` (required), `outputFormat?`. Summarizes
a collection: total file and sub-collection counts, plus a breakdown of its files
by learning-resource type, subject, and level. The breakdown is tallied over the
collection's actual child files (a sample of up to 100 — reported when the total
is larger), which is accurate for reference collections where a facet query is not.

**22. `find_wlo_skills`** — `query?`, `maxResults?` (1–20, default 5),
`includeContent?` (default true), `nodeId?`, `outputFormat?`. Finds WLO **skills**
— reusable instruction documents (Markdown) curated as uploaded files in a WLO
collection — that match a task, and returns their raw instructions to apply.
`nodeId` defaults to `WLO_SKILLS_COLLECTION_ID`; omit `query` to list all
available skills. Each result's title/description says what the skill does and
when to use it. Shares its listing/fetch logic with `GET /api/collection`, so
native MCP clients get the same skills capability as the launcher/REST path.

**23. `get_wlo_content_text`** — `nodeId`, `maxChars?` (500–50000, default 8000),
`outputFormat?`. Returns the material's **own text**, not its metadata, so the
content can be summarized, simplified or turned into exercises. The repository's
`/textContent` is the primary source — it already holds converted text for ~90 %
of records, including PDF, DOCX and PPTX; only a record that stores nothing and
is externally linked (`ccm:wwwurl`) falls back to the text-extraction service
(`WLO_TEXT_EXTRACTION_URL`, empty disables it). `source` names which path was
taken. A missing text is not an error but a `reason`: `access_denied` (exists but
is not public — no converter helps, only rights), `no_text_no_url`,
`extraction_failed`, `node_not_found`. Long texts are cut and flagged
(`truncated`).

**24. `get_node_collections`** — `nodeId`, `maxResults?`, `outputFormat?`. The
reverse of browsing: given a material, which curated collections carry it. The
answer to "where does this sit?" and "where do I find more like it?", leading
from a single find back to the collection that curates it. For a *collection's*
place in the tree use 21 (`get_node_breadcrumb`) instead.

**25. `wlo_auth_status`** — no parameters. Which rights this server is reading
with: `anonymous` (public data only, the default), `service` (one configured
account, the same rights for everyone) or `user` (the signed-in person's own
rights). `authenticated` is a **separate** statement: `service`/`user` with
`authenticated: false` means WLO rejected the stored credentials, and then
*every* query fails — not "only public content", but nothing at all. That is a
configuration fault worth naming instead of reporting an empty world.

**26. `get_url_text`** *(UNSAFE — see [Tools declared unsafe](#tools-declared-unsafe))*
— `url`, `method?` (`browser` default / `simple`), `maxChars?` (500–50000,
default 8000), `outputFormat?`. The text behind an **arbitrary** web URL, for an
address named in the conversation rather than a WLO record. For WLO material use
23 instead: it reads the repository directly, is faster, and works where this
tool cannot. No text is a normal answer with a `reason` — `not_http`,
`private_host`, `dns_failed`, `service_disabled` (a server setting is missing,
not a property of the page), `extraction_failed`. On the last one exactly one
retry with the other `method` is worth it: the service renders with Playwright
and has known gaps (protected or bot-blocked pages, pure media files). The
reported `url` is the **normalised** one — what was actually requested, which is
not always the string that was passed in.

### Wikipedia resolution

`get_wikipedia_summary` and `GET /api/wikipedia` answer in two ways, and the
`match` field says which:

- **`exact`** — Wikipedia has an article under the name that was asked for, or a
  **redirect** from it (`Bruchrechnen` → `Bruchrechnung`). A redirect is an
  editorial statement that both names denote the same topic, so it is taken as
  given.
- **`fuzzy`** — no article of that name. The query goes to Wikipedia's search,
  and the candidate the query is actually about is chosen — not simply the first
  one. `Feinoptik` → `Feinoptiker`, `Dreiecke` → `Dreieck`.

**When no candidate is on topic, the answer is "no article", never the closest
string.** Measured before this guard existed: `Stadt Berlin` answered with
`Bern`, `Dreiecke` with `Dreiecker`, a mountain in the Allgäu. A caller that
turns the extract into teaching material appends *"Quelle: Wikipedia-Artikel
„…"*, so a plausible wrong article does not merely look odd — it publishes a
false attribution. The rejected candidates are logged, so a miss can be
diagnosed without guessing.

The check runs on the search candidates only. Two consequences worth knowing:
a redirect is never second-guessed (a rule cannot relate "Bruchrechnen" and
"Bruchrechnung" without a stemmer), and an article that merely *mentions* the
topic is not accepted for it — `Stabi Berlin` is not the answer to
`Stadt Berlin`, though a plain word-occurrence check would take it.

## Signing in with OAuth

To work with your own WLO rights, sign in from the client — nothing to copy.
Requires `WLO_AUTH_PRIVATE_KEY` and `WLO_PUBLIC_BASE_URL`; without them every
OAuth path answers 404.

1. Enter the MCP URL in the client and choose **OAuth**. The client discovers
   the flow itself via `/.well-known/oauth-authorization-server` and registers.
2. It sends the browser to `/oauth/authorize`, which names **who** is asking and
   where the answer goes, then asks for the WLO user name and password. The
   password is encrypted **in the browser** and leaves the device only as an
   unreadable block — the same mechanism as `/auth`.
3. Back in the client, the curation tools work — they were listed all along and
   were refusing until now.

**The login can start from a tool call.** The curation tools are in `tools/list`
even for a caller with no identity, declared `oauth2`; calling one without a
usable login returns an error result carrying
`_meta["mcp/www_authenticate"]`, which is the client's cue to run the flow
above. Hiding those tools instead — what this server did until 2026-08-05 —
meant the model never called one, so nothing ever asked the host to sign anyone
in, and a connector added without OAuth simply stayed anonymous forever. The
refusal itself is unchanged: anonymous callers write nothing.

**There is no second secret.** The issued access token *is* the `wlo2.…` block.
One revocation on `/auth-revoke.html` therefore ends both routes at once — the
pasted block and the OAuth connection. No `refresh_token`, no expiry: the access
ends when it is revoked or the WLO password changes.

**A request with no credential still reads anonymously.** It gets the same 25
public tools. The `401` fires only for a token that was presented and cannot be
used, and it carries the pointer to the discovery documents.

> **In ChatGPT:** an app connected in the settings dialog is not yet active in a
> conversation. ChatGPT shows its own card there ("connect wlo"), and it appears
> only once a question triggers it — ask about WLO once and confirm. Without
> that the model has no tools, and a model with no tools answers as if it had
> searched.

## Curation (writing to WLO)

Curation tools change data in the repository, so they are gated twice and never
act in one step.

**Who may write.** Anonymous callers never can — the tools are not registered at
all, so they do not appear in `tools/list`. A caller with their own WLO login
always can. The configured service account can only when
`WLO_ALLOW_SERVICE_WRITES` is set: a change made under a shared account is
attributable to nobody, since the repository's history would record the account
name rather than the person who asked for it. This also covers stdio, where the
credentials come from the environment and therefore count as a service account.

Each tool additionally refuses at call time, because a host may serve a tool list
cached from a session that did have an identity.

**Two steps, always.** A call without `confirmToken` writes nothing. It reads the
record, shows exactly what would change (`Titel: „alt“ → „neu“`), and returns a
single-use key valid for ten minutes. A second call carrying that key performs
the write. The key is bound to a hash of the planned change, so a preview of a
harmless edit cannot authorise a different one — the shape a prompt injection
would otherwise need.

**Nothing is believed until it is read back.** edu-sharing answers `200` in three
measured situations where the value is discarded: the metadata set filters the
property, the node lacks the aspect that carries it, and the caller lacks the
right. After every write the record is re-read and each field reported as saved,
discarded, or rewritten by the repository. A discarded field is never reported as
success.

**An aborted request leaves the outcome open — it is never reported as a
failure.** If the repository does not answer in time, the abort hits the
*response*, not the work: measured on staging, a timed-out create had already
produced the record. Every curation tool therefore separates "the repository
refused" (nothing happened, said plainly) from "we stopped listening" (the
outcome is open, and the reply says so and sends you to look). This matters most
for the two deletions, where a wrong "could not be deleted" is what stops someone
from checking whether their material is gone.

**Versions.** By default an edit updates the record in place (`PUT`). Pass
`commit: true` with a `versionComment` to close a round of work as a new version
(`POST`) — otherwise a conversation that corrects a title three times would leave
three versions behind.

| Tool | What it does |
|---|---|
| `wlo_update_content` | Change the metadata of an existing record: title, description, keywords (added, not replaced), source URL, language, author, publisher, licence, content type, subject, educational level, target group. |
| `wlo_create_content` | Create a new record for a material reachable by URL. Checks first whether a record for that URL already exists and names it instead of creating a second. The record is a draft — it does NOT enter the editorial queue. |
| `wlo_submit_content` | Hand an existing record to the editorial review queue. A separate act, never automatic, so a draft cannot reach a reviewer because someone was still writing. |
| `wlo_create_collection` | Create a collection (a curated topic page), top-level or as a sub-collection. |
| `wlo_rename_collection` | Change a collection's title and description. |
| `wlo_add_to_collection` | Put existing material into a collection. Nothing is moved or copied — a collection holds references. |
| `wlo_remove_from_collection` | Take material out of one collection. The material itself survives and stays in every other collection. |
| `wlo_update_compendium` | Write, replace, or remove a collection's editorial compendium text (Markdown). |
| `wlo_suggest_metadata` | Propose values with a rationale instead of writing them. The record stays untouched. |
| `wlo_list_suggestions` | Show the stored proposals with rationale, status, and the id needed to decide. |
| `wlo_decide_suggestion` | Accept (apply, read back, then mark accepted) or decline a proposal. |
| `wlo_delete_content` | Delete a record. Irreversible through this server — see below. |
| `wlo_delete_collection` | Delete a collection and its sub-collections. The material it referenced survives. |

**Deleting is final here.** `recycle=true` is always sent, so the repository may keep an archive copy — but a person-scoped archive query found a deleted node once and then returned nothing for the same node minutes later, so recoverability could not be demonstrated. The tools therefore say the deletion cannot be undone through this server and promise no restore. Taking material out of a collection (`wlo_remove_from_collection`) is a different act and leaves the material intact.

Licence keys are checked against a fixed list; an invented licence such as a
university's name is rejected with the value named rather than written. The
aggregated content type (`ccm:oeh_lrt_aggregated`) is never written by this
server — the repository derives it.

## Output formats

Most tools accept `outputFormat: "markdown"` (default, human-readable) or
`"json"` (structured, easier to parse). Search-family tools also append a
`_queryMeta` text part carrying the executed query, filters, pagination, and a
`searchUrl` back-link — for consumers that want to reconstruct the search.

`_queryMeta` may also carry two optional blocks:

- **`unresolvedFilters`** — `{ field, value }[]` of vocab filters the caller
  supplied that could not be resolved to a URI and were therefore dropped from
  the search. Surfaced so the caller can self-correct (e.g. via
  `lookup_wlo_vocabulary`). Omitted when everything resolved.
- **`facets`** — present only with `includeFacets: true`: facet counts keyed by
  filter name, e.g. `{ learningResourceType: [{ label: "Video", count: 1203 }], … }`
  — how many hits per type/subject/level, so a client can offer targeted
  narrowing without probe-searches.

The shared `FormattedNode` shape (output of all content-returning tools):

```ts
{
  nodeId: string;
  title: string;
  description: string;
  keywords: string[];
  disciplines: string[];            // labels, e.g. ["Mathematik"]
  educationalContexts: string[];    // labels, e.g. ["Sekundarstufe I"]
  userRoles: string[];              // labels, e.g. ["Lehrer/in"]
  learningResourceTypes: string[];  // labels, e.g. ["Arbeitsblatt"]
  url: string;                      // primary "open this" link (ccm:wwwurl or viewer)
  downloadUrl: string;              // direct binary download (files only), else ""
  contentUrl: string;              // in-repo viewer URL, else ""
  previewUrl: string;               // thumbnail (may be a generic icon)
  previewIsIcon: boolean;           // true = generic mediatype icon, not a real thumbnail
  mimeType: string;                 // e.g. "application/pdf", else ""
  fileSize: number;                 // bytes (0 for nodes without binary content)
  license: string;                  // label, e.g. "CC BY-SA 4.0"
  publisher: string;
  nodeType: 'collection' | 'content';
  topicPageUrl: string;             // set when ccm:page_config_ref is present
  textContent?: string;             // stored full text — only with includeTextContent
  compendiumText?: string;          // editorial collection summary — full on detail tools (`-all-`); also in collection search/list, capped to 500 chars in markdown
}
```

## Filters & vocabulary

Filters accept German labels or full URIs. Resolution is asymmetric on purpose:

- **Input (label → URI)** is conservative on the school-subject vocabulary to
  avoid ambiguous over-broad matches.
- **Display (URI → label)** uses the server-side `<property>_DISPLAYNAME` fields
  from the edu-sharing index, which cover both the school and higher-education
  vocabularies without a local mapping.

Use `lookup_wlo_vocabulary` to discover valid values. Authoritative sources are
the official SKOS vocabularies at `https://vocabs.openeduhub.de`.

**University subjects (Hochschulfächersystematik).** School and university
subjects share many labels ("Mathematik", "Physik", …), so the university
vocabulary is deliberately kept out of *input* resolution — `discipline="Mathematik"`
always means the school subject, never an ambiguous match. To filter by a
*university* subject there are two model-free paths, both conflict-free:
1. **Facet-driven (corpus-grounded):** run a faceted search (`includeFacets: true`)
   and read the `discipline` facet — each bucket carries a readable `label`
   (university subjects resolved via the bundled `src/vocabs-hochschule.ts`) **and**
   its concept `uri`; pass that `uri` back as `discipline` (raw URIs are accepted).
2. **Fuzzy lookup:** `lookup_wlo_vocabulary` with `vocabulary="universitySubject"`
   and a `query` returns a short `{label, uri}` pick-list (Levenshtein, no ML); the
   model picks one and filters by its `uri`.

Both keep the university vocabulary out of *input* label resolution, so there is
never a local school↔university conflict.

**API base URLs:** the REST API lives at `<WLO_REPOSITORY_URL>/rest/...`, the
frontend (render and topic-page links) at `<WLO_REPOSITORY_URL>/components/...`.
Paths are identical across edu-sharing instances.

## Deployment

Production runs **self-hosted and persistent** (Docker, below). There is no
serverless deployment target.

### Docker (the production path)

```bash
docker compose up -d --build          # build + run detached (recommended)
# or, without compose:
docker build -t wlomcp .
docker run -p 3000:3000 wlomcp        # prod default
# → http://localhost:3000/mcp  ·  /health  ·  /api/*  ·  /launcher.html
```

The image bundles the built widgets (`dist-widgets/`) and the public launcher +
skills (`public/`), runs as the non-root `node` user, pins the base image by
digest, and has a `HEALTHCHECK` on `/health`.

**SSE and the reverse proxy.** The image defaults to real Server-Sent-Events
streaming (`MCP_SSE=1`), which ChatGPT developer mode requires. A reverse proxy
in front (nginx/Traefik/Caddy) **must not buffer** the `/mcp` response or the
stream never reaches the client — for nginx set `proxy_buffering off;` and a long
`proxy_read_timeout` on that location. Override with `-e MCP_SSE=0` to fall back
to single-JSON responses (curl / simple clients). Behind a TLS-terminating proxy,
also set `TRUST_PROXY=1`.

**Full vServer walkthrough** — `.env` configuration, the complete nginx SSE
config, TLS, verification, and the ChatGPT developer-mode gate — is in
[`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md). Every compose setting is overridable
via a `.env` file (auto-loaded) without editing the tracked compose file.

### Local

```bash
npm install && npm run build
node dist/http.js                                                        # prod default
WLO_REPOSITORY_URL=https://repository.staging.openeduhub.net/edu-sharing node dist/http.js
```

### Apps-SDK submission & privacy

- [`docs/apps-sdk-submission-checklist.md`](docs/apps-sdk-submission-checklist.md)
  — each OpenAI Apps-SDK requirement mapped to its implementing artifact, plus
  golden demo prompts and the remaining operator actions.
- [`docs/apps-sdk-golden-prompts.md`](docs/apps-sdk-golden-prompts.md) — the full
  developer-mode evaluation set (direct / indirect / negative prompts + a
  precision-recall log) to dogfood tool selection and confirm the widgets render.
- [`docs/PRIVACY.md`](docs/PRIVACY.md) — the baseline privacy policy (stateless,
  read-only, no personal data stored) for operators to adapt and publish.

## Security & operations

### Tools declared unsafe

A tool may declare itself **unsafe**. That does not mean it is broken — it means
it carries a risk this server cannot close from where it sits. Such a tool is
registered by default, logs a startup warning naming itself and the reason, and
can be removed with `WLO_DISABLE_UNSAFE_TOOLS`. The shipped `.env.example` and
`docker-compose.yml` set that to `all`, so a real deployment starts with them off.

Currently one tool is affected:

**`get_url_text` — not recommended in production.** It reads the text behind a
URL the *caller* chooses. Before anything is requested, the server refuses a
literal private-network host (including IPv4-mapped IPv6 such as
`[::ffff:127.0.0.1]`, which `new URL()` rewrites to `[::ffff:7f00:1]`), refuses
a public NAME whose DNS record resolves into a private range, and refuses a name
it cannot resolve at all rather than guessing.

What it **cannot** check is the part that matters most: we never fetch the target
ourselves. The extraction service does, with Playwright, in its own process. So a
URL that passes every check above and then **redirects** to an internal address —
or whose DNS answer changes between our lookup and the service's — is invisible
at this layer. Closing that needs resolution-time enforcement *inside the
fetching service*. Until that exists, treat this tool as a development and
evaluation feature.

`get_wlo_content_text` is deliberately **not** affected, although its fallback
uses the same extraction service. Its URL comes from the record's curated
`ccm:wwwurl`, so the caller cannot choose the target — that difference is the
whole reason only one of the two is declared unsafe. Switching unsafe tools off
must not cost the other one its fallback.

- **HTTP-mode hardening:** every upstream request has a timeout
  (`WLO_FETCH_TIMEOUT_MS`); request bodies are capped (`MAX_BODY_BYTES`, `413`
  over the limit); the MCP endpoint is per-IP rate-limited (`RATE_LIMIT_RPM`,
  `429` over the limit); node IDs are URL-encoded before being interpolated into
  upstream URLs. Behind a reverse proxy, set `TRUST_PROXY=1` so rate limiting
  keys on the real client IP.
- **Public REST surface:** `GET /api/*` is read-only, has its own tighter per-IP
  limiter (`API_RATE_LIMIT_RPM`, default 30/min), rejects non-`GET` methods
  (`405`), validates every input server-side (query/nodeId/id-count caps), and
  never leaks internal error detail (generic `500`). CORS is `*` for `GET` only.
- **`npm audit`:** the production dependency tree is free of high/critical
  advisories (`npm audit --omit=dev --audit-level=high`, wired as a CI gate).
  The full tree now carries a single **low, dev-only** advisory (`esbuild`,
  pulled in by `tsx` — a Windows dev-server file-read issue), which is neither
  shipped nor run in CI/production: a production install (`npm ci --omit=dev`, as
  in the Dockerfile) contains none. The server uses Node's built-in `fetch`.
- **Monitoring & logging:** `GET /health` (HTTP mode) returns `200` with a small
  JSON status — use it for uptime monitoring; the Docker `HEALTHCHECK` targets
  it. For "is WLO reachable" (upstream, not proxy) use the `wlo_health_check`
  tool. Logs are structured JSON lines on **stderr** (`ts`, `level`, `name`,
  `msg` + fields); stdout is reserved for the MCP stdio framing.

## Architecture

```
wlo-mcp-server/
├── src/
│   ├── server.ts             # factory: registers all 39 tools (transport-agnostic)
│   ├── tools/                # tool definitions, grouped by responsibility
│   │   ├── shared.ts         #   _queryMeta, toolError, title fallbacks
│   │   ├── collections.ts    #   search_wlo_collections, get_collection_contents, search_wlo_within_collection
│   │   ├── content-search.ts #   search_wlo_content, search_wlo_all
│   │   ├── node-details.ts   #   get_node_details, get_nodes_details
│   │   ├── node-relations.ts #   get_related_content, get_node_breadcrumb
│   │   ├── collection-stats.ts #  get_collection_stats
│   │   ├── skills.ts         #   find_wlo_skills
│   │   ├── vocabulary.ts     #   lookup_wlo_vocabulary, lookup_wlo_publishers
│   │   ├── topic-pages.ts    #   search_wlo_topic_pages
│   │   ├── topic-page-content.ts # get_topic_page_content
│   │   ├── browse.ts         #   get_subject_portals, browse_collection_tree
│   │   ├── compendium.ts     #   get_compendium_text
│   │   ├── wikipedia.ts      #   get_wikipedia_summary
│   │   ├── knowledge.ts      #   search, fetch (ChatGPT knowledge tools)
│   │   └── health.ts         #   wlo_health_check
│   ├── services/             # business logic reused by tools + REST + widgets
│   │   ├── search.ts         #   searchAll (combined search + opt-in enrichments)
│   │   ├── compendium.ts     #   getCompendiumTexts
│   │   ├── publishers.ts     #   lookupPublishers (facet-based counts)
│   │   ├── related.ts        #   getRelatedContent
│   │   ├── stats.ts          #   getCollectionStats
│   │   ├── skills.ts         #   findSkills (list + rank + fetch raw Markdown)
│   │   └── topic-page.ts     #   resolveTopicPageSwimlanes
│   ├── apps/                 # OpenAI Apps-SDK seam + widgets
│   │   ├── register.ts       #   registerWloTool (outputSchema/annotations/_meta.ui)
│   │   ├── tool-defaults.ts  #   applyReadOnlyToolDefaults: noauth _meta + required hints + status, on every tool
│   │   ├── tool-status.ts    #   per-tool openai/toolInvocation status strings (DE)
│   │   ├── outputSchemas.ts  #   zod structuredContent schemas
│   │   ├── resources.ts      #   ui:// widget resources (loads dist-widgets/)
│   │   ├── instructions.ts   #   server instructions block
│   │   └── widgets/          #   vanilla-TS widgets (esbuild → dist-widgets/*.html)
│   ├── vocabs.ts             # label ↔ URI mappings (6 vocabularies)
│   ├── vocabs-hochschule.ts  # university-subject URI→label (display-only; NOT in resolveVocab)
│   ├── vocab-suggest.ts      # fuzzy vocab suggestions (levenshtein, ≤2 edits)
│   ├── wlo-api.ts            # barrel re-export of the edu-sharing REST client
│   ├── wlo-config.ts         #   env config + shared types + wloFetch + DISPLAY_PROPS
│   ├── wlo-search.ts         #   search endpoints (ngsearch, collection keyword search)
│   ├── wlo-node.ts           #   node endpoints (children/metadata/text/download/breadcrumb) + URL builders
│   ├── topic-page-api.ts     # topic-page discovery (page_variant search, variant→collection)
│   ├── topic-page-structure.ts # one page's content: variant → swimlanes
│   ├── wikipedia-api.ts      # Wikipedia REST summary client (search title fallback)
│   ├── wikipedia-relevance.ts # picks which fuzzy candidate the query is about
│   ├── reranker.ts           # RRF merge + quality scoring (pure)
│   ├── query-expand.ts       # query → weighted backend variants (synonyms, stopwords)
│   ├── node-match.ts         # local node matching (text + criteria) for /children fallbacks
│   ├── formatter.ts          # WloNode → FormattedNode → markdown / json
│   ├── logger.ts             # minimal structured JSON logger (stderr only)
│   ├── rate-limit.ts         # in-memory per-IP rate limiter + client-IP resolution
│   ├── read-body.ts          # bounded request-body reader (413 support)
│   ├── mcp-transport.ts      # Streamable-HTTP transport options (MCP_SSE → JSON vs SSE)
│   ├── rest/                 # public read-only REST layer (GET /api/*) over the services
│   │   ├── validate.ts       #   input validation (query/nodeId/id-count caps, int clamp, fields)
│   │   ├── project.ts        #   field projection for /api/{search,collection} (?fields=)
│   │   ├── result.ts         #   RestResult shape + badRequest helper
│   │   ├── handlers.ts       #   the per-endpoint handlers (handleSearch, handleCollection, …)
│   │   ├── routes.ts         #   routeRestRequest (pure router) + handleRestRequest (http.ts adapter)
│   │   ├── skills.ts         #   skill registry + raw loader (GET /api/skills[/<id>])
│   │   └── static.ts         #   resolveStaticRoute (pure) + handleStaticRequest (serves /launcher.html)
│   ├── stdio.ts              # entry: stdio transport
│   └── http.ts               # entry: Streamable HTTP (CORS, rate/body limits, routing)
├── public/                   # static assets served by http.ts
│   ├── launcher.html         #   bilingual prompt launcher (self-contained; GET /launcher.html, GET /)
│   ├── bookmarklet.md        #   selection → launcher bookmarklet (install docs, DE/EN)
│   └── skills/               #   AI-app skills served raw via GET /api/skills/<id>
├── tests/                    # offline unit/smoke tests (node:test): npm test
│   ├── fetchMock.ts          #   the in-memory MCP client + upstream fetch stub every tool test uses
│   └── netguard.mjs          #   fails any unmocked non-loopback fetch — enforces "no network required"
├── scripts/                  # tooling (not shipped): run-tests.mjs (npm test), vocab generation, measurements
├── docs/                     # DEPLOYMENT.md, PRIVACY.md, TOOLS.md, apps-sdk-submission-checklist.md, apps-sdk-golden-prompts.md, plans/
├── Dockerfile · docker-compose.yml · .dockerignore · .env.example
```

**Data flow:** transport entry (`stdio.ts` / `http.ts`) →
`createMcpServer()` (`server.ts`) → a tool handler (`tools/*`) →
`wlo-api.ts`/`topic-page-api.ts` (all upstream calls via `wloFetch`) →
`reranker.ts` + `formatter.ts` → tool result. Dependencies point inward; there
are no circular imports.

### Library functions

The internal building blocks behind the tools (useful when reading or extending
the code), grouped by module.

**`wlo-api.ts` — edu-sharing REST client**

| Function | What it does |
|---|---|
| `ngsearch` | Full-text search for **file** nodes (FILES) |
| `searchCollectionsByKeyword` | **Collection search** — returns real `ccm:map` collections |
| `getCollectionContents` | Children (items / sub-collections) of a node |
| `getChildCollections` | Direct sub-collections (`filter=folders`) |
| `getNodeMetadata` / `getNodesMetadata` | Metadata for one / many nodes |
| `getNodeTextContent` | Stored full text of a node |
| `getNodeParents` | Parent nodes of a node |
| `wloFetch` | `fetch` wrapper that enforces the upstream timeout |
| `sanitizeRepositoryUrl` | Normalize a repository-URL input |
| `buildTopicPageUrl` / `buildRenderUrl` | Build frontend links |
| `appendPropertyFilter` | Append the repeated `propertyFilter` params |

**`topic-page-api.ts` — finding topic pages**

| Function | What it does |
|---|---|
| `searchPageVariants` | Search `page_variant` nodes |
| `searchTopicPageCollections` | Collections that own a topic page, matched against a query |
| `resolveVariantCollection` | Resolve a variant back to its owning collection |
| `getCollectionThemePages` | Topic-page variants of a collection |

**`topic-page-structure.ts` — what one topic page shows**

| Function | What it does |
|---|---|
| `getTopicPageContent` | Resolve a variant and parse its swimlane structure |

**Ranking, formatting, vocabulary**

| Function | Module | What it does |
|---|---|---|
| `enhancedSearch` | `reranker.ts` | Multi-query expansion + RRF + quality score |
| `rerankNodes` | `reranker.ts` | Re-sort already-fetched nodes by relevance |
| `sortByTitle` | `reranker.ts` | Deterministic alphabetical sort |
| `formatNode` / `formatNodes` | `formatter.ts` | `WloNode` → `FormattedNode` |
| `renderToText` / `renderToJson` | `formatter.ts` | `FormattedNode` → markdown / JSON |
| `resolveFacetCounts` | `formatter.ts` | Facet groups → labeled counts keyed by filter name |
| `resolveVocab` | `vocabs.ts` | Label → URI |
| `labelFromUri` | `vocabs.ts` | URI → label |
| `listVocab` | `vocabs.ts` | List a vocabulary's entries |

**HTTP infrastructure & tool helpers**

| Function | Module | What it does |
|---|---|---|
| `createRateLimiter` | `rate-limit.ts` | In-memory per-IP fixed-window limiter |
| `clientKey` | `rate-limit.ts` | Resolve client IP (honors `X-Forwarded-For` when `TRUST_PROXY`) |
| `readBodyWithLimit` | `read-body.ts` | Read the request body bounded by `MAX_BODY_BYTES` |
| `parseRequestUrl` | `request-url.ts` | Parse a request target once; `null` when node:http accepted what `new URL()` refuses |
| `log` | `logger.ts` | Structured JSON logger (stderr) |
| `buildFilterCriteria` | `filter-criteria.ts` | German labels/filters → search criteria |
| `queryMetaContent` | `tools/shared.ts` | Build the `_queryMeta` block |
| `toolError` | `tools/shared.ts` | Log + build a uniform tool-error result |
| `mapPool` | `concurrency.ts` | Bounded-concurrency async map (fault-tolerant) |
| `pickThemePageTitle` | `tools/shared.ts` | Best human-readable topic-page title |
| `matchSubjectPortal` | `tools/browse.ts` | Resolve a subject name → its Fachportal node (tiered) |

## Development

- `npm run build` — TypeScript compile (strict).
- `npm test` — offline test suite (`node:test`), no network required.
- CI (`.github/workflows/ci.yml`) runs build + test on Node 20 with a production
  `npm audit` gate.
- See **[CONTRIBUTING.md](CONTRIBUTING.md)** for conventions (comment language,
  test discipline, commit style, security rules).

## Further documents

- **[CHANGELOG.md](CHANGELOG.md)** — notable changes.
- **[CONTRIBUTING.md](CONTRIBUTING.md)** — contribution guide.
- **[PERFORMANCE.md](PERFORMANCE.md)** — performance design notes.
- **[docs/apps-sdk-submission-checklist.md](docs/apps-sdk-submission-checklist.md)** — ChatGPT app submission requirements, each mapped to its evidence.
- **[docs/apps-sdk-golden-prompts.md](docs/apps-sdk-golden-prompts.md)** — the developer-mode evaluation prompt set (discovery precision/recall).
- **[README.de.md](README.de.md)** — German copy of this document.
