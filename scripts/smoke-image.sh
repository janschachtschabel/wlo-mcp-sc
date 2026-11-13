#!/usr/bin/env bash
# smoke-image.sh – build the image and prove that it runs.
#
# The test suite never executes the Dockerfile, the health check or the entry
# point the image starts (`dist/http.js`); until 2026-11 the image was built for
# the first time on the server (audit 2026-11-12, B-3). This script builds it,
# starts it under the same restrictions the compose file sets, and checks what a
# deploy relies on:
#
#   1. it starts and answers /health,
#   2. the HEALTHCHECK command of the image succeeds inside the container,
#   3. /mcp lists the tools,
#   4. `docker stop` ends it cleanly (exit 0) and quickly — the signal handler,
#   5. an address that cannot work stops the start (exit 1) instead of serving.
#
# At RUN time nothing leaves the machine: the repository address is a closed
# local port and the background probes are off. (The BUILD pulls the base image
# and the npm packages, like any build.) Used by CI (.github/workflows/ci.yml)
# and runnable by hand:   npm run smoke:image
set -euo pipefail

# Git Bash on Windows rewrites arguments that look like POSIX paths (`/tmp`,
# `/data`) into `C:/…` before docker sees them, and the mount then fails with
# "mount path must be absolute". Harmless everywhere else.
export MSYS_NO_PATHCONV=1

IMAGE="${SMOKE_IMAGE:-wlo-mcp:smoke}"
NAME="wlo-mcp-smoke-$$"

fail() { echo "SMOKE FAILED: $*" >&2; docker logs "$NAME" 2>&1 | tail -n 40 >&2 || true; exit 1; }
cleanup() { docker rm -f "$NAME" >/dev/null 2>&1 || true; }
trap cleanup EXIT

echo "== build"
# -q prints the image id only; a failing build still reports on stderr.
docker build -q -t "$IMAGE" . >/dev/null

# The hardening of docker-compose.yml: an image that only works with a writable
# root or extra capabilities would pass a plain `docker run` and fail in production.
RUN_FLAGS=(--init --read-only --tmpfs /tmp --cap-drop ALL --security-opt no-new-privileges
  -e WLO_REPOSITORY_URL=http://127.0.0.1:9/edu-sharing
  -e WLO_SKILL_CACHE=0 -e WLO_READY_PROBE_MS=0 -e WLO_DISABLE_UNSAFE_TOOLS=all -e RATE_LIMIT_RPM=0)

echo "== start"
# A free host port chosen by Docker: two runs on one daemon do not collide.
docker run -d --name "$NAME" "${RUN_FLAGS[@]}" -p "127.0.0.1::3000" "$IMAGE" >/dev/null
PORT="$(docker port "$NAME" 3000/tcp | head -n 1 | sed 's/.*://')"
[ -n "$PORT" ] || fail "no host port was published"

for _ in $(seq 1 30); do
  if curl -fsS -o /dev/null "http://127.0.0.1:${PORT}/health" 2>/dev/null; then break; fi
  [ "$(docker inspect -f '{{.State.Running}}' "$NAME")" = "true" ] || fail "the container exited during startup"
  sleep 1
done
HEALTH="$(curl -fsS "http://127.0.0.1:${PORT}/health")" || fail "/health did not answer"
grep -q '"status":"ok"' <<<"$HEALTH" || fail "/health did not answer ok"

echo "== the image's own HEALTHCHECK command, inside the container"
# Read from the image, not retyped here: a Dockerfile that switches to a tool
# the image does not carry must turn this red, not only production "unhealthy".
HC="$(docker inspect -f '{{index .Config.Healthcheck.Test 1}}' "$IMAGE")"
[ -n "$HC" ] || fail "the image declares no HEALTHCHECK"
docker exec "$NAME" sh -c "$HC" || fail "the image's HEALTHCHECK command fails inside the container: $HC"

echo "== tools/list"
TOOLS="$(curl -fsS "http://127.0.0.1:${PORT}/mcp" \
  -H 'content-type: application/json' -H 'accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}')"
# No pipe into `grep -q`: under pipefail a writer cut off by grep's early exit
# fails the pipeline (SIGPIPE) — a false red here, a MISSED error in the log check below.
grep -q '"search_wlo_all"' <<<"$TOOLS" || fail "tools/list does not name search_wlo_all"
grep -q '"wlo_update_content"' <<<"$TOOLS" || fail "tools/list does not name the curation tools"

echo "== no error in the startup log"
LOGS="$(docker logs "$NAME" 2>&1)"
if grep -q '"level":"error"' <<<"$LOGS"; then fail "the startup log holds an error"; fi

echo "== docker stop"
START=$(date +%s)
docker stop -t 20 "$NAME" >/dev/null
TOOK=$(( $(date +%s) - START ))
CODE="$(docker inspect -f '{{.State.ExitCode}}' "$NAME")"
[ "$CODE" = "0" ] || fail "exit code $CODE after docker stop (0 = the signal was handled; 143 = it ended by the signal itself, 137 = it was killed)"
[ "$TOOK" -le 10 ] || fail "docker stop took ${TOOK}s with nothing in flight"
LOGS="$(docker logs "$NAME" 2>&1)"
grep -q 'shutdown complete' <<<"$LOGS" || fail "no 'shutdown complete' in the log"
cleanup

echo "== an unusable repository address stops the start"
# Detached and waited for with a bound: if the refusal is ever lost, the server
# simply starts — and a foreground `docker run` would then never return.
docker run -d --name "$NAME" "${RUN_FLAGS[@]}" -e WLO_REPOSITORY_URL='htps://repository.example.org/edu-sharing' "$IMAGE" >/dev/null
set +e
CODE="$(timeout 60 docker wait "$NAME")"
WAITED=$?
set -e
[ "$WAITED" = "0" ] || fail "the container is still running after 60 s — an unusable address did not stop the start"
[ "$CODE" = "1" ] || fail "expected exit 1 for a mistyped address, got $CODE"
LOGS="$(docker logs "$NAME" 2>&1)"
grep -q 'WLO_REPOSITORY_URL' <<<"$LOGS" || fail "the refusal does not name the variable"

echo "SMOKE OK — image ${IMAGE}"
