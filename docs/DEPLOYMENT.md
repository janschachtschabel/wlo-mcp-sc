# Deployment — self-hosted vServer (Docker)

How to run the WLO MCP server on your own server so an AI host (ChatGPT developer
mode, Claude, an MCP client) can reach it over HTTPS. The image is self-contained:
it bundles the built widgets (`dist-widgets/`) and the public launcher + skills
(`public/`), runs as a non-root user, and exposes MCP, a health check, the public
REST API, and the prompt launcher.

This is the **self-hosted / ChatGPT-developer-mode** path — the only deployment
target. It needs real SSE, which is why a correctly configured reverse proxy
matters.

## 1. Prerequisites

- Docker + the Compose plugin (`docker compose version`).
- For ChatGPT developer mode: a public domain with TLS, terminated by a reverse
  proxy (nginx / Traefik / Caddy) in front of the container.
- Outbound network access to the WLO repository (`repository.staging.openeduhub.net`
  by default, `redaktion.openeduhub.net` for production) and, when the Wikipedia
  tool is used, to `*.wikipedia.org`.

## 2. Quick start

```bash
git clone https://github.com/janschachtschabel/wlo-mcp-sc.git && cd wlo-mcp-sc
cp .env.example .env          # optional — defaults work without it

# Optional: let people sign in with their own WLO account (see §3).
# Without this the server reads anonymously and /auth says it issues no access.
openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 -out authkey.pem
# The `tail -c1` guard is not decoration: an .env whose last line has no newline
# would otherwise get the key glued onto it, and compose fails to parse the file
# at all (hit in the field, 2026-08-05).
[ -n "$(tail -c1 .env)" ] && echo >> .env
printf 'WLO_AUTH_PRIVATE_KEY="%s"\n' "$(cat authkey.pem)" >> .env
chmod 600 authkey.pem .env    # this key decrypts every issued block
docker compose config > /dev/null && echo "env OK"   # parses the .env like `up` does

docker compose up -d --build
curl localhost:3000/health    # -> {"status":"ok",...,"widgets":{"browse":"<hash>",...}}
```

`widgets` is the **deploy fingerprint**: a build hash per widget. Note the hash
covers the widget HTML *and* its `_meta`, and that meta carries the configured
edu-sharing origin — so two servers running identical code but different
`WLO_REPOSITORY_URL` values have different hashes **by design**. Compare it
against **the same server before the deploy**, not against a local build
pointing somewhere else; a mismatch across differently-configured servers proves
nothing either way (measured 2026-08-05).

The container listens on port 3000 inside; compose publishes it on
`127.0.0.1:3000` by default (loopback — meant to sit behind the reverse proxy).

## 3. Configuration

Every setting is an environment variable. Put overrides in a `.env` next to
`docker-compose.yml` (auto-loaded) or export them in the shell — never edit the
tracked compose file. The full list with defaults is in
[`.env.example`](../.env.example); the deployment-relevant ones:

| Variable | Default | Purpose |
|----------|---------|---------|
| `WLO_REPOSITORY_URL` | `https://repository.staging.openeduhub.net/edu-sharing` | Upstream edu-sharing repository. **Defaults to STAGING** — set `https://redaktion.openeduhub.net/edu-sharing` explicitly to write to production. |
| `MCP_SSE` | `1` | `1` = real SSE streaming (needed by ChatGPT). `0` = single-JSON responses. |
| `TRUST_PROXY` | `1` | Take the client IP from the rightmost (proxy-appended) `X-Forwarded-For` hop for per-client rate limiting behind a proxy. Set `0` if directly exposed. |
| `RATE_LIMIT_RPM` | `120` | Per-IP requests/min on `/mcp` (`0` disables). |
| `API_RATE_LIMIT_RPM` | `30` | Per-IP requests/min on the public `/api/*` surface. |
| `WLO_FETCH_TIMEOUT_MS` | `20000` | Per-upstream-request timeout. Sized from measurement (creating a record takes 4.2–8.0 s); the compose file deliberately forwards it with an **empty** default so this number lives only in `src/wlo-config.ts`. |
| `WLO_DISABLE_UNSAFE_TOOLS` | `all` (set by compose) | Switches off tools declared unsafe. Compose ships `all`, so `get_url_text` is **absent in a default deployment** — which is the recommendation, see the README section "Tools declared unsafe". Set the variable to an empty value in `.env` to switch them on; the server then logs `registering a tool declared UNSAFE` at startup, which is how you confirm the switch took effect either way. |
| `WLO_SERVICE_USER` / `WLO_SERVICE_PASSWORD` | _(unset)_ | One shared WLO identity for every call on `POST /mcp` — the mode a chatbot or portal deployment uses. Unset = anonymous, public content only. It applies to the MCP endpoint **alone**: the public `/api/*` surface and the launcher stay anonymous by design and never inherit these rights. Wrong credentials do not degrade to public — edu-sharing answers `401` and the server can then answer nothing at all; the startup log names that case. |
| `WLO_ALLOW_SERVICE_WRITES` | _(unset)_ | Lets the service account use the 14 curation (write) tools. Off by default: a change under a shared account is attributable to nobody — the history records the account, not the person who asked. A caller with their own WLO login may always write and needs nothing here. Accepted: `1`, `true`, `yes`, `on`; anything else (including `false`) leaves it off. |
| `WLO_ALLOW_PREPARED_WRITES` | _(unset)_ | For the **embedded** deployment: the chatbot runs inside a repository page where the visitor is already signed in, so a confirmed curation step comes back as a *described* request that the page performs with **their** session — this server writes nothing and needs no write rights. Off by default; anonymous callers never reach it, since building the preview reads the record under the service identity. Not a substitute for `WLO_ALLOW_SERVICE_WRITES` and not implied by it: that one lets the shared account change data, this one lets it change nothing. Currently the route exists for `wlo_add_to_collection`, `wlo_remove_from_collection` and `wlo_suggest_metadata` — the curation steps whose write is a single request; every other curation tool keeps refusing as before, because a create or a rename lands through two calls and half of that is not something to hand a browser. The proposal descriptor carries a body (the drafts) and the provenance query `type=AI`; the executing page cannot drop it, so nothing filed this way can claim a human wrote it. Deciding on a proposal (`wlo_decide_suggestion`) stays here: accepting writes the value into the record, which is a different act from proposing. Accepted: `1`, `true`, `yes`, `on`. |
| `WLO_INBOX_ID` | _(unset)_ | nodeId of the shared inbox new records are filed in under the service account; editing existing records does not need it. No default on purpose — node ids are repository-bound, so a hardcoded one points at a different collection on staging than on production. Unset ⇒ service-account creation is refused with a message naming this variable. |
| `WLO_AUTH_PRIVATE_KEY` | _(unset)_ | Switches on **personal access blocks**: a user fetches an encrypted block at `https://<host>/auth`, pastes it once into their AI host's `Authorization` field, and revokes it at `/auth-revoke.html`. Unset = off; the `/auth/…` endpoints answer 404 and the pages say the server is not issuing access. Generate with `openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048`. **It decrypts every issued block into a live WLO password** — `.env` on the server only, never the image. Multi-line value: a `.env` file is **not** a shell, so `"$(cat key.pem)"` there is stored as that literal text and the key is rejected at startup (measured). Write the PEM itself, in double quotes — `printf 'WLO_AUTH_PRIVATE_KEY="%s"\n' "$(cat authkey.pem)" >> .env` does it in one step. |
| `WLO_AUTH_PRIVATE_KEY_PREVIOUS` | _(unset)_ | The previous key during a rotation, so a key change does not invalidate every user's configuration at once. Remove it after the overlap window. An unusable value switches the feature off rather than silently dropping the window. |
| `WLO_AUTH_REGISTRY_PATH` | `/data/access-registry.json` | The allow-list of issued access ids — ids, user names and issue times, never a credential. Must point into the `wlo-access-registry` volume; anywhere else is read-only and the feature stays off with an error in the log. |
| `WLO_PUBLIC_BASE_URL` | _(unset)_ | The public origin clients type in (`https://<host>`, no path). The OAuth discovery documents name it as their own endpoints. Unset = the `/.well-known/oauth-*` paths answer 404, unless `TRUST_PROXY=1` lets the origin be derived from the caller-supplied `Host` header. Set it explicitly; behind Caddy that is the same host the site block serves. |
| `BIND_ADDR` | `127.0.0.1` | Host interface compose publishes on. Set `0.0.0.0` **only** with `TRUST_PROXY=0` for direct exposure. |
| `HOST_PORT` | `3000` | Host-side port of the published mapping. |

### 3.1 The one thing to back up

If personal access blocks are switched on, compose creates a named volume
`wlo-access-registry` mounted at `/data`. It is the **only** writable path — the
read-only root filesystem still covers everything else — and it holds the
allow-list of issued access ids.

That list is a POSITIVE list, which is deliberate: lose it and every issued block
stops working, so people fetch a new one. The alternative — a deny-list — would
mean that losing the file silently makes every *revoked* block valid again.
Inconvenient beats unsafe, but it does mean the volume belongs in your backup:

```bash
docker run --rm -v wlo-access-registry:/data -v "$PWD:/backup" alpine \
  cp /data/access-registry.json /backup/access-registry.json
```

`docker compose down` keeps the volume; `docker compose down -v` deletes it.

The file is bounded on its own: each WLO account keeps its ten most recent
entries **per kind**, so a lost block ages out once that person has fetched ten
more. The two kinds are blocks someone fetched and pasted, and entries an
embedded widget filed by exchanging a ticket — counted apart since 2026-08-13,
because a widget files roughly one per session and would otherwise retire the
blocks that person had deliberately pasted into their AI hosts. So budget for up
to twenty entries per active account, not ten. Deleting a line by hand revokes
that block immediately — the list is read into memory at startup, so an edit
needs a restart to take effect.

**Rotating the key.** Move the current value to `WLO_AUTH_PRIVATE_KEY_PREVIOUS`,
put the new one in `WLO_AUTH_PRIVATE_KEY`, restart. Blocks issued under either
key work during the window; new ones use the new key. Remove the previous entry
once everyone has re-fetched. Skipping the window invalidates every user's
configuration at the same moment.

## 4. Reverse proxy for SSE (required for ChatGPT)

The image serves `POST /mcp` as a **Server-Sent-Events stream** (`MCP_SSE=1`). SSE
breaks the moment a proxy buffers the response, so the `/mcp` location **must**
disable buffering and use a long read timeout. Without this the client connects
but never receives the stream.

Sample nginx server block (adapt the domain and TLS paths):

```nginx
server {
    listen 443 ssl http2;
    server_name mcp.example.org;

    ssl_certificate     /etc/letsencrypt/live/mcp.example.org/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/mcp.example.org/privkey.pem;

    # MCP endpoint — real SSE. Buffering MUST be off.
    location /mcp {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host              $host;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Connection        '';
        proxy_buffering            off;        # <- required for SSE
        proxy_cache                off;
        proxy_read_timeout         3600s;
        chunked_transfer_encoding  off;
    }

    # Health, public REST, launcher — normal buffered proxying is fine.
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host              $host;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

Notes for other proxies:
- **Caddy** does not buffer by default, so a plain `reverse_proxy 127.0.0.1:3000`
  works; keep `flush_interval -1` for the `/mcp` path to be explicit.
- **Traefik** — disable response buffering on the router/service for `/mcp` (no
  `buffering` middleware, or set `maxResponseBodyBytes: 0`).

Because `TRUST_PROXY=1`, keep `BIND_ADDR=127.0.0.1` (the default) so only the
proxy can reach the container — otherwise a direct client could spoof
`X-Forwarded-For` and evade the rate limiter.

## 5. Verify the deployment

```bash
# Local (on the host):
curl localhost:3000/health
curl -s -X POST localhost:3000/mcp -H 'Content-Type: application/json' \
     -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}' | head -c 80
# -> "event: message\ndata: {..."   (SSE framing confirms MCP_SSE is on)

# Through the proxy (public):
curl https://mcp.example.org/health
curl https://mcp.example.org/launcher.html -I    # 200 text/html
curl https://mcp.example.org/api/skills          # 200 JSON skill list
```

A `resources/list` MCP call should return four `ui://widget/...` resources
(`search-results`, `topic-page`, `browse`, `reading`) — that confirms the bundled
widgets shipped.

`GET /health` also carries the **deploy fingerprint**: the content hash of each
built widget. It changes with every widget or widget-metadata change, so
comparing it before and after answers "is the new build actually live?" without
diffing bytes:

```bash
curl -s https://mcp.example.org/health | grep -o '"widgets":{[^}]*}'
```

### 5.1 Rolling back

The image is the unit of rollback; there is no migration and no persistent state
to unwind (confirmation tokens and rate-limit counters live in memory and are
meant to be lost on restart).

```bash
# Tag every deploy so there is something to go back TO.
docker build -t wlomcp:$(git rev-parse --short HEAD) .
docker tag wlomcp:$(git rev-parse --short HEAD) wlomcp:current

# Roll back: point the tag at the previous build and restart.
docker tag wlomcp:<previous-sha> wlomcp:current
docker compose up -d
curl -s https://mcp.example.org/health   # fingerprint should show the old hashes
```

Two things do **not** roll back with the image and have to be undone
deliberately:

- **Configuration.** `.env` is not part of the image. If the bad deploy also
  changed a variable, change it back — a rolled-back image with the new `.env` is
  a combination that was never tested.
- **Anything the curation tools wrote.** Those changes live in the repository,
  not here. Rolling the server back does not revert them; use the repository's
  own version history.

## 6. ChatGPT developer mode (the one manual gate)

Point ChatGPT developer mode at `https://mcp.example.org/mcp` and run the golden
prompts from [`apps-sdk-submission-checklist.md`](apps-sdk-submission-checklist.md).
Confirm each widget renders and the `search` / `fetch` tools resolve. This is the
only check that cannot be automated offline (see the P3.6 note in the plan).

**Two things that look like server faults and are not** (both measured
2026-08-05):

- **ChatGPT asks a second time, inside the conversation.** A connector linked in
  the settings is not yet active in a chat: ChatGPT shows a card — "wlo
  verbinden · ChatGPT benötigt Zugriff auf wlo" — and it only appears once a
  request calls for it. Until it is confirmed, the model has no tools, and a
  model with no tools answers as if it had searched: fluently, and entirely made
  up. Tell users to ask about WLO once and confirm the card.
- **Read the server log before anything else.** Every MCP request builds a
  server and logs at least one line. An empty log means the client never called,
  which rules out this server in one step. Both of the above cost an afternoon
  of searching in the right place for the wrong thing.

With `WLO_AUTH_PRIVATE_KEY` set, choose **OAuth** as the authentication method;
the connector registers itself and sends the user to `/oauth/authorize` to log
in with their own WLO account. Without a key, choose "no authentication" — the
25 read tools work anonymously.

The curation tools are listed either way. Without a usable login they refuse and
answer with the challenge that asks the client to start the OAuth flow, so a
connector set up as "no authentication" can still be told to sign in. If
`WLO_AUTH_PRIVATE_KEY` is unset there is nothing to sign in to, and the refusal
is simply final.

## 7. Stdio variant (local MCP clients)

For a desktop MCP client that speaks stdio instead of HTTP, override the image
command:

```bash
docker run --rm -i -e WLO_REPOSITORY_URL=https://redaktion.openeduhub.net/edu-sharing \
  wlomcp:latest node dist/stdio.js
```

## 8. Troubleshooting

| Symptom | Cause / fix |
|---------|-------------|
| Client connects to `/mcp` but never gets a response | Proxy is buffering SSE — set `proxy_buffering off;` and a long `proxy_read_timeout` on the `/mcp` location (§4). |
| Widgets don't render in the host | `dist-widgets/` missing from the image — rebuild (`docker compose build --no-cache`); `resources/list` should list 3 `ui://` widgets. |
| `/launcher.html` or `/api/skills` returns 500 | `public/` missing from the image — rebuild. |
| Frequent `429` | Lower traffic or raise `RATE_LIMIT_RPM` / `API_RATE_LIMIT_RPM`; confirm `TRUST_PROXY=1` so limits key on the real client IP, not the proxy. |
| Rate limits keyed on one IP (the proxy) | `TRUST_PROXY` is `0` behind a proxy — set it to `1`. |

## 9. Privacy & submission

Before exposing publicly, complete [`PRIVACY.md`](PRIVACY.md) (add the operator
contact) and walk the [`apps-sdk-submission-checklist.md`](apps-sdk-submission-checklist.md).
