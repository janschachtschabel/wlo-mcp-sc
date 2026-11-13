# wlo-mcp — Helm chart (DRAFT)

Deploys the WLO MCP server: the access to **one** edu-sharing repository for MCP
clients. This chart is a draft for handing the service to a platform team. It
has been linted and rendered (`helm lint`, `helm template`), **not installed on
a cluster**. The running installation is Docker Compose on one host
(`docker-compose.yml`, `docs/DEPLOYMENT.md`); nothing here changes it.

Service fact sheet (German): [`docs/STECKBRIEF.md`](../../../docs/STECKBRIEF.md).

## Install

```bash
# 1. The Secret is yours to create — the chart never builds one from values.
#    Every key is optional; leave out what the deployment does not use.
kubectl -n <namespace> create secret generic wlo-mcp-secrets \
  --from-file=WLO_AUTH_PRIVATE_KEY=authkey.pem \
  --from-literal=METRICS_TOKEN="$(openssl rand -hex 32)"

# 2. Install with the required values.
helm install wlo-mcp deploy/helm/wlo-mcp -n <namespace> \
  --set image.repository=<registry>/<image> \
  --set repositoryUrl=https://<repository-host>/edu-sharing \
  --set existingSecret=wlo-mcp-secrets \
  --set-string config.WLO_PUBLIC_BASE_URL=https://<public-host>
```

`--from-file` matters for the private key: it is a multi-line PEM and must
arrive unchanged.

## Required values

| Value | Why there is no default |
|---|---|
| `image.repository` | No registry is decided yet. `image.tag` defaults to the chart's `appVersion`, which equals `package.json`'s version — but **no published, tagged image exists yet**. |
| `repositoryUrl` | One MCP per repository. The code would fall back to staging; the chart refuses to render instead, so a forgotten value cannot land anywhere. |
| `existingSecret` | Not required for anonymous reading. Needed as soon as people sign in (`WLO_AUTH_PRIVATE_KEY`), a service account is used, `/metrics` gets a token or a trusted client gets a key. |

Worth setting although optional: `config.WLO_PUBLIC_BASE_URL` (the OAuth
documents name it — empty, the origin is taken from each request's `Host`
header while `TRUST_PROXY` is on, and OAuth answers 404 while it is off),
`ingress.*`, and `networkPolicy` — off by default, and **with
`networkPolicy.enabled=true` both `networkPolicy.ingressNamespace` and
`networkPolicy.monitoringNamespace` are required** (the render fails without
them; the chart ships no guess).

## TRUST_PROXY and the client address — check before going live

> **Derived from the code (`clientKey`, `src/rate-limit.ts`), not measured on a
> cluster.**

The chart sets `TRUST_PROXY=1`. The server then takes the **last** entry of
`X-Forwarded-For` — the one the proxy directly in front of it appended, i.e.
the address *that proxy* saw — as the client. (Without the header it falls back
to the socket address; an IPv6 client is counted by its /64. The rule assumes
exactly one trusted proxy in front.)

So the limits are only per client if the **ingress controller itself sees real
client addresses**. If it sits behind a load balancer or a `NodePort` that
rewrites the source (SNAT), what it appends is a node or load-balancer address,
and **every user shares one bucket** of each of these:

| Limit | Default | Shared bucket means |
|---|---|---|
| Tool budget on `/mcp` (`RATE_LIMIT_RPM`) | 120 `tools/call` per minute and address (every POST: 3 × that) | all users together get 120 tool calls a minute, then `429` |
| Distinct-login guard (`AUTH_CREDENTIAL_LIMIT`) | 10 different logins per address in 10 minutes | the 11th person signing in with `Basic` (or at `/auth/issue`, the OAuth consent, `/api/uploads`) within 10 minutes is refused — `too_many_logins` |

The same holds for the two further per-address budgets: `API_RATE_LIMIT_RPM`
(30 per minute, `/api/*`, `/auth*`, `/oauth/authorize`) and
`TICKET_CREDENTIAL_LIMIT` (200 distinct tickets in 10 minutes). An access block
(`Bearer wlo2.…`) on `/mcp` is counted per block, not per address, and a
trusted client (`TRUSTED_CLIENT_KEYS`) by its key — neither depends on this.

What to do: let the controller see the client — `externalTrafficPolicy: Local`
on its Service, or PROXY protocol between load balancer and controller — and
make sure it **appends** to `X-Forwarded-For` (ingress-nginx does). The reverse
mistake is as bad: with `TRUST_PROXY=1` and nothing in front that appends, a
client chooses its own bucket by sending the header.

## Configuration

- **`config`** — every non-secret environment variable, as a string. An empty
  string means *not set*: the variable is not emitted and the code's default
  applies. Leave the numbers empty; each default sits in `src/wlo-config.ts`
  next to the measurement behind it, and a value here beats it for good. What a
  variable means: `.env.example` and `docs/MCP-REFERENZ.md`.
- **`existingSecret`** — the six credential-like variables, read key by key with
  `optional: true`: `WLO_SERVICE_USER`, `WLO_SERVICE_PASSWORD`,
  `WLO_AUTH_PRIVATE_KEY`, `WLO_AUTH_PRIVATE_KEY_PREVIOUS`, `METRICS_TOKEN`,
  `TRUSTED_CLIENT_KEYS`. Putting one of them under `config` fails the render.
- **Set by the chart itself**, each tied to another object: `WLO_REPOSITORY_URL`
  (`repositoryUrl`), `PORT` (`service.public.port`), `INTERNAL_PORT`
  (`service.internal.port`), `WLO_AUTH_REGISTRY_PATH` (the `/data` mount).

A changed ConfigMap restarts the pod. A changed Secret does **not** — the chart
does not own it; run `kubectl rollout restart deployment/wlo-mcp` after rotating
a key (rotation window: `WLO_AUTH_PRIVATE_KEY_PREVIOUS`, DEPLOYMENT.md §3.1).

## What gets created

| Object | Notes |
|---|---|
| Deployment | `replicas: 1`, `strategy: Recreate`, non-root (uid 1000), read-only root filesystem, all capabilities dropped, no service-account token |
| Service `wlo-mcp` | public port 3000: `/mcp`, `/api/*`, `/auth*`, `/oauth/*` |
| Service `wlo-mcp-internal` | ClusterIP, port 9090: only `/health`, `/ready`, `/metrics` |
| ConfigMap | from `config` and the fixed values |
| PersistentVolumeClaim `wlo-mcp-data` | ReadWriteOnce, 100Mi, kept on uninstall — the access registry |
| NetworkPolicy, Ingress, ServiceMonitor, PrometheusRule | optional, off by default; the NetworkPolicy needs both namespaces (see the limits below) |

## Deliberately not in the chart

| Not offered | Why |
|---|---|
| A `replicaCount` value, a HorizontalPodAutoscaler, a PodDisruptionBudget | Confirmation keys, plans, batches, upload slots, OAuth codes and the rate limiters live in process memory; the access registry is one JSON file. With two pods a preview issued by one is unknown to the other and each grants the full rate budget. Availability comes from a fast restart (72 MB, ready in seconds). A PDB over one replica would only block node drains. |
| `RollingUpdate` | It keeps two pods alive at once, and the ReadWriteOnce claim would stall it anyway. `Recreate` costs a gap of "longest running call + start" per rollout; clients see `502`/`503` and retry. |
| A probe on `/ready` | `/ready` answers 503 while the **repository** is unreachable. As a readiness probe it would take the only pod out of service — sign-in pages included — for a fault that is not its own; as a liveness probe it would restart it in a loop. Both probes use `/health`; the repository's state is the `WloMcpRepositoryFailing` alert and an external check on `/ready`. |
| A Secret built from values | A credential in `values.yaml` ends up in a repository or in the release history. `WLO_AUTH_PRIVATE_KEY` decrypts every issued access block into a live password. |
| A default for `image.repository` and `repositoryUrl` | See "Required values". |
| `PORT`, `INTERNAL_PORT`, `WLO_AUTH_REGISTRY_PATH` under `config` | Each must agree with a container port, a Service or the volume mount; the chart derives them. |
| `BIND_ADDR`, `HOST_PORT` | They configure the compose file's host port mapping; a Service does that here. |
| The compose file's `init: true` | No equivalent is needed: the HTTP entry point installs its own SIGTERM handler (`src/shutdown.ts`), so the stop does not depend on an init process. |
| The compose file's log rotation (`max-size`, `max-file`) | Container log rotation belongs to the node / the platform's log pipeline. The server writes one JSON line per event to stdout. |
| The image's `HEALTHCHECK` | Kubernetes ignores it; the probes replace it. |
| TLS termination, certificates | The ingress controller's job. The pod speaks plain HTTP. |
| Backups | The claim must be in the platform's backup; the chart only keeps it on uninstall. |

## Probes, stopping, sizing

- **Liveness** → `GET /health` on the **internal** port: it keeps answering
  while the public listener drains, so a draining pod is not killed early.
  **Readiness** → `GET /health` on the **public** port: once it stops accepting,
  traffic stops.
- **Stop.** On SIGTERM the server stops accepting, lets the work in hand finish
  and exits — at once when idle, after at most 70 s (`SHUTDOWN_GRACE_MS`) when a
  long write runs. `terminationGracePeriodSeconds: 90` is deliberately above
  that and above the compose file's 75 s.
- **Resources** (measured 2026-11-13, DEPLOYMENT.md §5.0.2): 72 MB idle, 172 MB
  under a search burst, **about 480 MB worst case** = 172 MB search peak
  + 178 MB upload store at its bound (128 MB held plus up to one more file of
  `UPLOAD_MAX_BYTES`, 50 MB) + 131 MB full-text plans at theirs — before
  request bodies in flight; 0.3 core under load. Hence request 256Mi / 100m,
  limit 768Mi / 1 CPU — proposals to re-measure on the target hardware.

## Limits of this draft — read before relying on it

- **NetworkPolicy is off by default.** Until it is enabled nothing restricts
  who reaches the pod's two ports inside the cluster — including `/metrics` on
  the internal one, which needs no token unless `METRICS_TOKEN` is set.
- **NetworkPolicy cannot restrict by host name.** Egress is DNS plus TCP 443 to
  `networkPolicy.egress.httpsCIDRs`, by default everywhere (`0.0.0.0/0` and
  `::/0`): the repository,
  Wikipedia and the optional text-extraction service have no stable addresses
  known to this chart. Narrow it with real CIDRs or a CNI-specific FQDN policy.
  A repository reached over plain HTTP or another port needs
  `networkPolicy.egress.extra`.
- **The two namespace names have no default.** `networkPolicy.enabled=true`
  without `ingressNamespace` and `monitoringNamespace` fails the render. A
  wrong name still cuts the traffic silently (the ingress answers 504, the
  scrape fails) — the chart cannot check that a namespace exists.
- **Kubelet probes** are admitted by most CNIs regardless of policy; where not,
  set `networkPolicy.probeSourceCIDRs`.
- **Ingress annotations are ingress-nginx-specific** and apply to the whole
  Ingress, not to `/mcp` alone. The requirement behind them (DEPLOYMENT.md §4)
  holds for any controller: no response buffering, a 3600 s read timeout, body
  size ≥ `MAX_BODY_BYTES` (and ≥ `UPLOAD_MAX_BYTES`, e.g. `100m`, with batch
  upload on).
- **The public port also serves `/health`, `/ready` and `/metrics`** (the last
  only with `METRICS_TOKEN`). The server keeps them there; block the paths at
  the controller if they must be internal-only.
- **`METRICS_TOKEN` applies to the internal port too.** Without it, `/metrics`
  on the internal port needs no token (the network decides who reaches it) and
  does not exist on the public one. With it, enable
  `monitoring.serviceMonitor.bearerToken`.
- **Alert thresholds are proposals** without operating history. The rules use
  only series the server exports (plus `up`).
- **No alert here can see a crash loop.** A recreated pod is a new series, so
  the server's own metrics cannot count restarts; `WloMcpRecentlyStarted`
  (info) only says "this process is younger than 10 minutes". Take restarts
  from kube-state-metrics (`kube_pod_container_status_restarts_total`) and
  memory from cAdvisor where those are scraped.
- **The counters start at zero with the process**, and a counter series exists
  only from its first event on. The alerts on rare events
  (`WloMcpToolThrows`, `WloMcpSheddingRepositoryCalls`, `WloMcpServerErrors`)
  are written to catch that first event; a rule you add with a bare
  `increase()`/`rate()` will miss it.
- **`WloMcpServerErrors` leaves out `route="ready"`, `route="api"` and every
  `503`**: those are 5xx the server answers because the *repository* (or
  Wikipedia) failed, and `WloMcpRepositoryFailing` covers them. A defect in an
  `/api` handler is therefore not seen by that alert — only in the log.
- **`fsGroup: 1000`** makes the claim writable for the image's `node` user; a
  storage class that ignores `fsGroup` needs another answer.

## Checks

`tests/helm-chart.test.ts` pins, by reading the files (no `helm` needed): one
replica and `Recreate`, no autoscaler, probes on `/health` only, the grace
period above `SHUTDOWN_GRACE_MS`, `appVersion` = `package.json` version, no
credential in `values.yaml`/`configmap.yaml`, that every variable
`docker-compose.yml` passes to the container can be set through the chart,
that the NetworkPolicy is off by default and refuses to render without its
namespaces, that the `/data` mount is the directory of
`WLO_AUTH_REGISTRY_PATH`, and that the alert rules name only metrics, `outcome`
values and `route` values the source emits. Comments are stripped first, so
nothing passes because of one.

```bash
node --import tsx --test tests/helm-chart.test.ts
helm lint deploy/helm/wlo-mcp --set image.repository=x/y --set repositoryUrl=https://host/edu-sharing
# with the NetworkPolicy:
#   --set networkPolicy.enabled=true --set networkPolicy.ingressNamespace=<ns> --set networkPolicy.monitoringNamespace=<ns>
```
