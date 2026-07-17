# Privacy Policy — WLO MCP Server

This document describes what data the WLO MCP Server processes, why, and for how
long. It is written to match the actual implementation (a stateless, read-only
proxy) and is intended as a baseline the deploying **operator** adapts and
publishes. The operator that runs a deployment is the data controller and should
add a contact address and their governing jurisdiction.

_Last reviewed: 2026-07-15._

## What this server is

A stateless Model Context Protocol (MCP) server that lets AI assistants search
open educational resources (OER) from [WirLernenOnline](https://wirlernenonline.de)
(the "WLO" edu-sharing repository). It has **no user accounts, no authentication,
no database, no cookies, and no session state** — every request is served in
isolation and nothing about it is retained after the response is sent.

All tools and REST endpoints are **read-only**: the server never writes, rates,
comments, or otherwise mutates upstream content.

## Data the server processes

| Category | Purpose | Retention |
|----------|---------|-----------|
| **Search terms, node IDs, filter labels** (from tool calls / `GET /api/*`) | Forwarded to the upstream edu-sharing repository — and, only when the Wikipedia tool/endpoint is used, to the public Wikipedia REST API — to fulfil the request. | Not stored. Held in memory only for the duration of the request. |
| **Client IP address** | Transient per-IP rate limiting (in-memory counters, fixed 60-second window). With `TRUST_PROXY=1`, the first `X-Forwarded-For` hop is used instead of the socket address. | Not persisted; counters reset on process restart and expire with the window. |
| **Operational logs** (structured JSON to `stderr`) | Diagnostics and abuse protection. On an upstream failure or when a large result set is capped, a log line may include the **search term** (e.g. a Wikipedia query or a capped collection query) — for debugging only. | Governed by the **operator's** logging/aggregation system, not by this server. The server itself writes to `stderr` and keeps nothing. |

The server logs **no credentials or tokens** — it has none. Request bodies and
query strings are not logged; REST error logs record the request **path only**
(e.g. `/api/search`), never its query string.

## What the server does NOT collect

- No accounts, passwords, or authentication data.
- No cookies, tracking pixels, analytics, or advertising identifiers.
- No behavioural profiling across requests.
- The prompt launcher page (`/launcher.html`) is fully self-contained — it loads
  **no third-party fonts, scripts, or assets**, so opening it does not leak the
  visitor's IP to any third party.

## Data recipients (third parties)

Fulfilling a request may transmit the search term to:

1. **The WLO edu-sharing repository** (`WLO_REPOSITORY_URL`, default
   `redaktion.openeduhub.net`) — the source of the OER content. This is the
   server's core purpose.
2. **Wikipedia's public REST API** (`*.wikipedia.org`) — only when the
   `get_wikipedia_summary` tool or `GET /api/wikipedia` endpoint is invoked.
3. **The AI host** that calls this server (e.g. ChatGPT, Claude) — the client
   that initiated the request. That host's own privacy policy governs the
   surrounding conversation; this server neither controls nor receives it.

No data is sold, and no data is shared with any recipient beyond what is
technically required to answer the request above.

## Security controls

- **Transport:** TLS is terminated by the operator's reverse proxy.
- **Read-only:** no write/mutation tools exist.
- **Rate limiting:** per-IP caps on both the MCP endpoint (`RATE_LIMIT_RPM`) and
  the tighter public REST surface (`API_RATE_LIMIT_RPM`).
- **Input validation:** every public REST parameter is length/count-bounded
  server-side; node IDs are URL-encoded before interpolation.
- **Body cap:** oversized POST bodies are rejected (`MAX_BODY_BYTES`, `413`).
- **No detail leakage:** internal errors return a generic `500`.
- **Widget sandbox:** widget CSP whitelists only the configured edu-sharing
  origin (`_meta.ui.domain`), so a rendered widget can fetch OER thumbnails but
  nothing else.
- **Container:** runs as the non-root `node` user; base image pinned by digest.

## Data subject rights

Because the server stores no personal data, there is nothing to export, correct,
or delete at the server level — requests are transient and leave no record in the
application. Operators who enable verbose or long-lived logging become
responsible for the retention and deletion of anything those logs capture, under
their own jurisdiction's rules (e.g. GDPR/DSGVO for EU deployments).

## Operator checklist

Before publishing this policy for a live deployment:

- [ ] Add the operator/controller identity and a contact address.
- [ ] State the log retention period configured for your environment.
- [ ] Confirm the reverse proxy terminates TLS and does not add its own tracking.
- [ ] Confirm `WLO_REPOSITORY_URL` points at the intended repository.
- [ ] Review your jurisdiction's requirements (for EU: GDPR/DSGVO, and — for
      public-sector/educational use — accessibility duties under BITV 2.0 / EN 301 549).
