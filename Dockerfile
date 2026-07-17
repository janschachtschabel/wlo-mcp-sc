# Pinned by digest for reproducible builds (tag kept for readability).
# node:20-alpine @ v20.20.2 — refresh the digest when bumping the base image.
FROM node:20-alpine@sha256:fb4cd12c85ee03686f6af5362a0b0d56d50c58a04632e6c0fb8363f609372293 AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src/ ./src/
RUN npm run build

FROM node:20-alpine@sha256:fb4cd12c85ee03686f6af5362a0b0d56d50c58a04632e6c0fb8363f609372293 AS runner
WORKDIR /app
ENV NODE_ENV=production
# Repository defaults to WLO production. Override at run time, e.g.:
#   docker run -e WLO_REPOSITORY_URL=https://repository.staging.openeduhub.net/edu-sharing wlomcp
ENV WLO_REPOSITORY_URL=https://redaktion.openeduhub.net/edu-sharing
ENV PORT=3000
# Serve real SSE by default — ChatGPT developer mode on the vServer needs it.
# The reverse proxy in front MUST disable response buffering (see docker-compose.yml).
# Override with -e MCP_SSE=0 for plain JSON responses (curl / simple clients).
ENV MCP_SSE=1
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=builder /app/dist ./dist
# Widget HTML (built in the builder stage) and the public launcher + skills must
# ship in the image: resources.ts reads dist-widgets/ and rest/static|skills read
# public/ (both resolved at the repo root, one level above dist/). Without them
# widgets silently degrade and /launcher.html + /api/skills 500.
COPY --from=builder /app/dist-widgets ./dist-widgets
COPY public/ ./public/

EXPOSE 3000

# Run as the unprivileged `node` user (uid 1000, ships with the base image)
# instead of root, shrinking the blast radius of any RCE.
USER node

# Liveness probe hits the built-in /health endpoint (busybox wget ships in
# alpine). Uses the configured PORT via the shell form so ${PORT} expands.
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${PORT:-3000}/health" >/dev/null 2>&1 || exit 1

# Default: HTTP server (use CMD override for stdio)
CMD ["node", "dist/http.js"]
