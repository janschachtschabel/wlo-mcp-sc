/**
 * deploy-env-passthrough.test.ts – Every documented setting must survive the
 * documented deployment path.
 *
 * `docker compose` auto-loads a neighbouring `.env`, but only for `${...}`
 * INTERPOLATION — a variable that the compose file never mentions is not passed
 * into the container. Measured 2026-08-03 with `docker compose --env-file … config`:
 * `WLO_SKILLS_COLLECTION_ID`, `WLO_ALLOW_SERVICE_WRITES` and
 * `WLO_TEXT_EXTRACTION_URL` were all set in the env file and NONE of them
 * reached the service environment. Those three gate `find_wlo_skills`, all 13
 * curation tools, and text extraction respectively — an operator sets them,
 * restarts, and the capability is still missing with nothing logged to say why.
 *
 * A setting is only real if the deployment carries it, so this test pins the
 * two files to each other: everything `.env.example` documents is either
 * forwarded in `docker-compose.yml` or listed below with the reason it is not.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = new URL('../', import.meta.url);
const read = (name: string) => readFileSync(fileURLToPath(new URL(name, root)), 'utf8');

/**
 * Deliberately NOT forwarded into the container.
 *
 *   PORT                 — would desynchronise the container from the `…:3000`
 *                          port mapping compose hardcodes, so the image's own
 *                          default is the only correct value.
 *   BIND_ADDR, HOST_PORT — configure that mapping itself (the `ports:` line),
 *                          which is compose's business and not the server's.
 *                          They belong in `.env.example` because that is where
 *                          an operator looks for "how do I publish this", and
 *                          `docker compose` reads them from the same file.
 */
const NOT_FORWARDED = new Set(['PORT', 'BIND_ADDR', 'HOST_PORT']);

/** Variable names documented in .env.example, whether or not they are commented out. */
function documentedVars(): string[] {
  return [...new Set(
    read('.env.example')
      .split('\n')
      .map(l => l.replace(/^\s*#\s*/, '').match(/^([A-Z][A-Z0-9_]*)=/)?.[1])
      .filter((n): n is string => Boolean(n)),
  )];
}

/** Variable names the compose service actually puts into the container. */
function forwardedVars(): string[] {
  const body = read('docker-compose.yml');
  const start = body.indexOf('environment:');
  assert.notEqual(start, -1, 'docker-compose.yml must declare an environment block');

  const names: string[] = [];
  for (const line of body.slice(start).split('\n').slice(1)) {
    if (line.trim() === '' || /^\s*#/.test(line)) continue;
    const name = line.match(/^\s{6,}([A-Z][A-Z0-9_]*):/)?.[1];
    // The first content line that is not an indented KEY: entry ends the block.
    if (!name) break;
    names.push(name);
  }
  return names;
}

test('every documented env setting reaches the container via docker compose', () => {
  const forwarded = forwardedVars();
  const missing = documentedVars().filter(n => !NOT_FORWARDED.has(n) && !forwarded.includes(n));
  assert.deepEqual(
    missing,
    [],
    'documented in .env.example but never forwarded by docker-compose.yml — ' +
    'setting these in .env does nothing at all',
  );
});

test('the unsafe-tool switch can be turned back ON from a .env', () => {
  // `${VAR:-all}` substitutes the default when the variable is unset OR EMPTY,
  // `${VAR-all}` only when it is unset. The documented way to switch unsafe
  // tools on is to set the variable to an empty value — which the colon form
  // silently overrides, so the documentation would be wrong and nothing would
  // fail. Measured 2026-08-03 with `docker compose config`: with the colon, an
  // explicitly empty value still rendered as "all".
  //
  // The missing colon reads as a typo, which is exactly why it needs a test:
  // "fixing" it would break the on-switch and no other test would notice.
  const line = read('docker-compose.yml')
    .split('\n')
    .find(l => l.includes('WLO_DISABLE_UNSAFE_TOOLS:'));
  assert.ok(line, 'the switch must be forwarded at all');
  assert.match(
    line,
    /\$\{WLO_DISABLE_UNSAFE_TOOLS-/,
    'must use ${VAR-default}, not ${VAR:-default} — otherwise an empty value cannot switch the tools on',
  );
});

test('docker-compose forwards nothing that .env.example does not document', () => {
  const documented = new Set(documentedVars());
  const undocumented = forwardedVars().filter(n => !documented.has(n));
  assert.deepEqual(undocumented, [], 'forwarded but undocumented — an operator cannot discover it');
});

/**
 * Mode flags whose DEPLOYMENT default is meant to differ from the code's.
 *
 * Both describe the shape of this deployment rather than tuning a number:
 *   MCP_SSE     — the code defaults to JSON for maximal client compatibility;
 *                 the shipped image serves real SSE because ChatGPT developer
 *                 mode on the vServer requires it (Dockerfile `ENV MCP_SSE=1`).
 *   TRUST_PROXY — the code defaults to OFF because X-Forwarded-For must not be
 *                 trusted on a directly exposed server; this compose file binds
 *                 to 127.0.0.1 behind a TLS-terminating proxy by construction,
 *                 so here the proxy hop IS the client address.
 *
 * A tuning number has no such second truth, which is why the rest are barred.
 */
const MODE_FLAGS_WITH_A_DEPLOYMENT_DEFAULT = new Set(['MCP_SSE', 'TRUST_PROXY']);

/** `NAME: "${NAME:-<default>}"` lines of the environment block, with the default. */
function numericComposeDefaults(): string[] {
  const body = readFileSync(fileURLToPath(new URL('docker-compose.yml', root)), 'utf8');
  const start = body.indexOf('environment:');
  const out: string[] = [];
  for (const line of body.slice(start).split('\n').slice(1)) {
    if (line.trim() === '' || /^\s*#/.test(line)) continue;
    const m = line.match(/^\s{6,}([A-Z][A-Z0-9_]*):\s*"\$\{[A-Z][A-Z0-9_]*:?-([^}]*)\}"/);
    if (!m) {
      if (/^\s{6,}[A-Z][A-Z0-9_]*:/.test(line)) continue;
      break;
    }
    if (/^\d+$/.test(m[2]!) && !MODE_FLAGS_WITH_A_DEPLOYMENT_DEFAULT.has(m[1]!)) out.push(`${m[1]}=${m[2]}`);
  }
  return out;
}

test('docker-compose restates no numeric default the code already owns', () => {
  // `WLO_FETCH_TIMEOUT_MS: "${WLO_FETCH_TIMEOUT_MS:-10000}"` sat here while the
  // code default was 20000 — and compose wins, so EVERY container ran the value
  // that was measured too short on 2026-08-02: a create took 4.2–8.0 s, ran into
  // the 10 s timeout mid-flight, and the tool reported a failure over a record
  // the repository had already made. Two of the three places said 20000; the one
  // that decides said 10000.
  //
  // The previous test in this file pins that every setting is FORWARDED. Nothing
  // pinned its VALUE, which is why the drift was invisible. An empty default
  // (`${VAR:-}`) leaves the number in exactly one place: the code, where the
  // measurement that justifies it is written down next to it.
  assert.deepEqual(
    numericComposeDefaults(),
    [],
    'a number here is a second source of truth — use "${VAR:-}" and let wlo-config.ts decide',
  );
});

/**
 * Settings `.env.example` may ship ACTIVE (uncommented).
 *
 * Everything else is commented out, because docker-compose.yml tells the
 * operator to `cp .env.example .env` — so an active line here is a default by
 * another route, and it beats both the code and the compose file.
 *
 *   WLO_REPOSITORY_URL       — the one setting a deployment must consciously see;
 *                              its value equals the code default, so copying it
 *                              changes nothing but reading it changes everything.
 *   PORT                     — same value as the image's own ENV.
 *   WLO_DISABLE_UNSAFE_TOOLS — shipped as "all" ON PURPOSE (2026-08-03): the
 *                              opposite of the code's default, because the
 *                              get_url_text redirect gap is unclosable from here.
 */
const MAY_BE_ACTIVE = new Set(['WLO_REPOSITORY_URL', 'PORT', 'WLO_DISABLE_UNSAFE_TOOLS']);

test('.env.example activates no setting that a copy would silently adopt', () => {
  // `WLO_TEXT_EXTRACTION_URL=https://text-extraction.staging.openeduhub.net` sat
  // here active, directly below a WLO_REPOSITORY_URL pointing at PRODUCTION. So
  // `cp .env.example .env` built the exact cross-environment leak that removing
  // the code-side default was meant to end: the URLs of production material sent
  // to a staging host. The default was deleted in one place and reintroduced in
  // the other.
  const active = readFileSync(fileURLToPath(new URL('.env.example', root)), 'utf8')
    .split('\n')
    .map(l => l.match(/^([A-Z][A-Z0-9_]*)=/)?.[1])
    .filter((n): n is string => Boolean(n) && !MAY_BE_ACTIVE.has(n!));
  assert.deepEqual(
    active,
    [],
    'comment it out — this file is copied to .env, so an active line is a default nobody chose',
  );
});
