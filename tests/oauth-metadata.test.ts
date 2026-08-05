/**
 * oauth-metadata.test.ts – the two OAuth discovery documents and, more
 * importantly, WHERE this server says it lives (P1/T1.1).
 *
 * The issuer is not decoration: it is the origin a client will send its user's
 * browser to, and the origin it will fetch a token from. Building it out of the
 * `Host` header means the caller chooses it — a forged header points a victim's
 * client at somebody else's login page. So the header is only consulted under
 * `TRUST_PROXY`, the same condition under which this server already believes
 * `X-Forwarded-For`, and a configured value always wins.
 *
 * Pure module: no HTTP, no `process.env`. The environment is read by `http.ts`
 * and passed in — the rule `access-setup.ts` documents and
 * `env-parsing-discipline.test.ts` enforces.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  authorizationServerMetadata,
  bearerChallenge,
  protectedResourceMetadata,
  resolveIssuer,
} from '../src/auth/oauth-metadata.js';

// ── the issuer ──────────────────────────────────────────────────────────────

test('a configured base URL wins, normalised to its origin', () => {
  assert.equal(
    resolveIssuer({ configured: 'https://mcp.example/pfad?x=1', trustProxy: false }),
    'https://mcp.example',
    'a path or query in the configured value is not part of the origin',
  );
  assert.equal(resolveIssuer({ configured: 'https://mcp.example', trustProxy: false }), 'https://mcp.example');
  assert.equal(resolveIssuer({ configured: '  https://mcp.example  ', trustProxy: false }), 'https://mcp.example');
});

test('a configured value that will not parse disables OAuth rather than falling back', () => {
  // Falling through to the header here would be the worst of both: the operator
  // believes they pinned the origin, and the caller picks it anyway.
  assert.equal(resolveIssuer({ configured: 'not a url', host: 'mcp.example', trustProxy: true }), null);
});

test('without a configured value the Host header is used only under TRUST_PROXY', () => {
  assert.equal(
    resolveIssuer({ host: 'mcp.example', trustProxy: false }),
    null,
    'no configuration and no reason to trust the header — OAuth stays off',
  );
  assert.equal(resolveIssuer({ host: 'mcp.example', trustProxy: true }), 'https://mcp.example');
});

test('the forwarded protocol is honoured, defaulting to https', () => {
  assert.equal(resolveIssuer({ host: 'mcp.example', trustProxy: true }), 'https://mcp.example');
  assert.equal(
    resolveIssuer({ host: 'localhost:3000', forwardedProto: 'http', trustProxy: true }),
    'http://localhost:3000',
  );
  // node:http hands back an array when a header arrives more than once; a proxy
  // chain writes the OUTERMOST hop first, which is the one facing the client.
  assert.equal(
    resolveIssuer({ host: 'mcp.example', forwardedProto: ['https', 'http'], trustProxy: true }),
    'https://mcp.example',
  );
  assert.equal(
    resolveIssuer({ host: 'mcp.example', forwardedProto: 'https, http', trustProxy: true }),
    'https://mcp.example',
    'a comma-joined chain is read the same way',
  );
  assert.equal(
    resolveIssuer({ host: 'mcp.example', forwardedProto: 'gopher', trustProxy: true }),
    'https://mcp.example',
    'an unknown scheme is ignored, not carried into the documents',
  );
});

test('a Host header carrying anything but a host is refused', () => {
  for (const host of [
    'mcp.example/evil',            // a path smuggled in → issuer with a path
    'mcp.example\nX-Evil: 1',      // header splitting
    'mcp.example ',                // stray whitespace is not a host
    'evil@mcp.example',            // userinfo
    'mcp.example:99999',           // not a port
    '',
  ]) {
    assert.equal(resolveIssuer({ host, trustProxy: true }), null, `refused: ${JSON.stringify(host)}`);
  }
});

test('bracketed IPv6 and an explicit port survive', () => {
  assert.equal(resolveIssuer({ host: '[::1]:3000', forwardedProto: 'http', trustProxy: true }), 'http://[::1]:3000');
  assert.equal(resolveIssuer({ host: 'mcp.example:8443', trustProxy: true }), 'https://mcp.example:8443');
});

test('a missing host with no configuration is simply off', () => {
  assert.equal(resolveIssuer({ trustProxy: true }), null);
  assert.equal(resolveIssuer({ trustProxy: false }), null);
});

// ── the documents ───────────────────────────────────────────────────────────

const ISSUER = 'https://mcp.example';

test('the authorization-server document points every endpoint at this issuer', () => {
  const doc = authorizationServerMetadata(ISSUER);
  assert.equal(doc['issuer'], ISSUER);
  assert.equal(doc['authorization_endpoint'], `${ISSUER}/oauth/authorize`);
  assert.equal(doc['token_endpoint'], `${ISSUER}/oauth/token`);
  assert.equal(doc['registration_endpoint'], `${ISSUER}/oauth/register`);
});

test('the authorization-server document announces only what the token endpoint honours', () => {
  const doc = authorizationServerMetadata(ISSUER);
  // We issue no refresh token, so announcing the grant would be a promise the
  // token endpoint answers with `unsupported_grant_type`.
  assert.deepEqual(doc['grant_types_supported'], ['authorization_code']);
  assert.deepEqual(doc['response_types_supported'], ['code']);
  // `plain` is refused at the authorize step; announcing it would invite it.
  assert.deepEqual(doc['code_challenge_methods_supported'], ['S256']);
  // Public clients: no secret is ever issued.
  assert.deepEqual(doc['token_endpoint_auth_methods_supported'], ['none']);
  assert.deepEqual(doc['scopes_supported'], ['wlo']);
});

test('the protected-resource document names the MCP endpoint and this server as its authority', () => {
  const doc = protectedResourceMetadata(ISSUER);
  assert.equal(doc['resource'], `${ISSUER}/mcp`);
  assert.deepEqual(doc['authorization_servers'], [ISSUER]);
  assert.deepEqual(doc['bearer_methods_supported'], ['header']);
  assert.deepEqual(doc['scopes_supported'], ['wlo']);
});

// ── the challenge ───────────────────────────────────────────────────────────

test('the challenge points at the protected-resource document', () => {
  const challenge = bearerChallenge(ISSUER);
  assert.match(challenge, /^Bearer /);
  assert.match(challenge, /error="invalid_token"/);
  assert.match(challenge, /resource_metadata="https:\/\/mcp\.example\/\.well-known\/oauth-protected-resource"/);
});

test('without an issuer the challenge keeps its verdict and drops the pointer', () => {
  // A 401 with no way to proceed is still the honest answer: the token is not
  // usable. Inventing an origin we do not stand behind would be worse.
  const challenge = bearerChallenge(null);
  assert.match(challenge, /^Bearer /);
  assert.match(challenge, /error="invalid_token"/);
  assert.doesNotMatch(challenge, /resource_metadata/);
});

test('the challenge is a single header line — no newline can be smuggled in', () => {
  // It is built from a constant and the issuer, and `resolveIssuer` refuses a
  // host with anything unusual in it; this pins the outcome rather than the rule.
  assert.doesNotMatch(bearerChallenge(ISSUER), /[\r\n]/);
});

test('neither document carries anything secret', () => {
  const both = JSON.stringify([authorizationServerMetadata(ISSUER), protectedResourceMetadata(ISSUER)]);
  assert.ok(!/secret|private|password|passwort/i.test(both), `discovery documents are public: ${both}`);
});
