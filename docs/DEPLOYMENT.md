# Deployment — self-hosted vServer (Docker)

How to run the WLO MCP server on your own server so an AI host (ChatGPT developer
mode, Claude, an MCP client) can reach it over HTTPS. The image is self-contained:
it bundles the built widgets (`dist-widgets/`) and the public launcher + skills
(`public/`), runs as a non-root user, and exposes MCP, a health check, the public
REST API, and the prompt launcher.

For the serverless alternative see the Vercel section in the README; this guide is
the **self-hosted / ChatGPT-developer-mode** path, which needs real SSE and is why
a correctly configured reverse proxy matters.

## 1. Prerequisites

- Docker + the Compose plugin (`docker compose version`).
- For ChatGPT developer mode: a public domain with TLS, terminated by a reverse
  proxy (nginx / Traefik / Caddy) in front of the container.
- Outbound network access to the WLO repository (`redaktion.openeduhub.net` by
  default) and, when the Wikipedia tool is used, to `*.wikipedia.org`.

## 2. Quick start

```bash
git clone <your fork> && cd wlo-mcp-server
cp .env.example .env          # optional — defaults work without it
docker compose up -d --build
curl localhost:3000/health    # -> {"status":"ok","server":"wlo-mcp","version":"1.0.0"}
```

The container listens on port 3000 inside; compose publishes it on
`127.0.0.1:3000` by default (loopback — meant to sit behind the reverse proxy).

## 3. Configuration

Every setting is an environment variable. Put overrides in a `.env` next to
`docker-compose.yml` (auto-loaded) or export them in the shell — never edit the
tracked compose file. The full list with defaults is in
[`.env.example`](../.env.example); the deployment-relevant ones:

| Variable | Default | Purpose |
|----------|---------|---------|
| `WLO_REPOSITORY_URL` | `https://redaktion.openeduhub.net/edu-sharing` | Upstream edu-sharing repository (prod; set to the staging host if needed). |
| `MCP_SSE` | `1` | `1` = real SSE streaming (needed by ChatGPT). `0` = single-JSON responses. |
| `TRUST_PROXY` | `1` | Trust the first `X-Forwarded-For` hop for per-client rate limiting behind a proxy. Set `0` if directly exposed. |
| `RATE_LIMIT_RPM` | `120` | Per-IP requests/min on `/mcp` (`0` disables). |
| `API_RATE_LIMIT_RPM` | `30` | Per-IP requests/min on the public `/api/*` surface. |
| `WLO_FETCH_TIMEOUT_MS` | `10000` | Per-upstream-request timeout. |
| `BIND_ADDR` | `127.0.0.1` | Host interface compose publishes on. Set `0.0.0.0` **only** with `TRUST_PROXY=0` for direct exposure. |
| `HOST_PORT` | `3000` | Host-side port of the published mapping. |

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

A `resources/list` MCP call should return three `ui://widget/...` resources — that
confirms the bundled widgets shipped.

## 6. ChatGPT developer mode (the one manual gate)

Point ChatGPT developer mode at `https://mcp.example.org/mcp` and run the golden
prompts from [`apps-sdk-submission-checklist.md`](apps-sdk-submission-checklist.md).
Confirm each widget renders and the `search` / `fetch` tools resolve. This is the
only check that cannot be automated offline (see the P3.6 note in the plan).

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
