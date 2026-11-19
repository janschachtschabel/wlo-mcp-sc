/**
 * http-options.test.ts – the security wiring of the HTTP entry point (audit
 * 2026-11-14, T1).
 *
 * `http.ts` listens on import, so nothing could import it — and an auditor
 * deleted `protocolLimiter`, `clientBudgets`, `ticketAllowedOrigins`,
 * `widgetOAuthOrigins` and `metricsToken` from it, hard-coded
 * `trustProxy: true`, and the whole suite stayed green. The construction now
 * lives in `buildHttpOptions(env)`; each test below fails when one option is
 * dropped or stops following its variable.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { buildHttpOptions } from '../src/http-options.js';
import { PROTOCOL_FACTOR } from '../src/client-budget.js';
import type { RateLimiter } from '../src/rate-limit.js';

/** How many requests of one address pass before the limiter refuses. */
function allowed(limiter: RateLimiter | undefined, max = 2000): number {
  assert.ok(limiter, 'the limiter is wired');
  for (let i = 0; i < max; i++) if (limiter.check('a', 1_000)) return i;
  return Infinity;
}

const KEY = 'k'.repeat(40);

test('defaults: every budget is on, nothing optional is', () => {
  const { options, settings, notices } = buildHttpOptions({});
  assert.equal(allowed(options.rateLimiter), 120);
  assert.equal(allowed(options.protocolLimiter), 120 * PROTOCOL_FACTOR);
  assert.equal(allowed(options.apiRateLimiter), 30);
  assert.equal(options.maxBodyBytes, 4_194_304);
  assert.equal(options.trustProxy, false, 'X-Forwarded-For is client text unless a proxy is declared');
  assert.equal(options.ticketAllowedOrigins, undefined, 'no list = no restriction, as before');
  assert.equal(options.widgetOAuthOrigins?.size, 0, 'no OAuth login expires by default');
  assert.equal(options.metricsToken, undefined, '/metrics does not exist without a token');
  assert.equal(options.publicBaseUrl, undefined);
  assert.equal(options.clientBudgets?.clients.size, 0);
  assert.equal(options.streamOptions.enableJsonResponse, true);
  assert.deepEqual(notices, []);
  assert.deepEqual(settings, {
    rateLimitRpm: 120, apiRateLimitRpm: 30, authCredentialLimit: 10, ticketCredentialLimit: 200,
    maxBodyBytes: 4_194_304, trustProxy: false,
  });
});

test('RATE_LIMIT_RPM sets the tool budget AND the protocol budget; 0 switches both off', () => {
  const on = buildHttpOptions({ RATE_LIMIT_RPM: '2' }).options;
  assert.equal(allowed(on.rateLimiter), 2);
  assert.equal(allowed(on.protocolLimiter), 2 * PROTOCOL_FACTOR);
  const off = buildHttpOptions({ RATE_LIMIT_RPM: '0' }).options;
  assert.equal(allowed(off.rateLimiter), Infinity);
  assert.equal(allowed(off.protocolLimiter), Infinity);
});

test('API_RATE_LIMIT_RPM sets the REST budget on its own', () => {
  const { options } = buildHttpOptions({ API_RATE_LIMIT_RPM: '3', RATE_LIMIT_RPM: '7' });
  assert.equal(allowed(options.apiRateLimiter), 3);
  assert.equal(allowed(options.rateLimiter), 7);
});

test('AUTH_CREDENTIAL_LIMIT and TICKET_CREDENTIAL_LIMIT are two limiters with two budgets', () => {
  const { options } = buildHttpOptions({ AUTH_CREDENTIAL_LIMIT: '1', TICKET_CREDENTIAL_LIMIT: '2' });
  assert.equal(options.authAbuseLimiter.check('ip:a', 'login-1', 1_000), false);
  assert.equal(options.authAbuseLimiter.check('ip:a', 'login-2', 1_000), true, 'the second distinct login is one too many');
  assert.ok(options.ticketAbuseLimiter, 'the ticket limiter is wired — absent, tickets spend the password budget');
  assert.notEqual(options.ticketAbuseLimiter, options.authAbuseLimiter);
  assert.equal(options.ticketAbuseLimiter.check('ip:a', 't1', 1_000), false);
  assert.equal(options.ticketAbuseLimiter.check('ip:a', 't2', 1_000), false);
  assert.equal(options.ticketAbuseLimiter.check('ip:a', 't3', 1_000), true);
  const off = buildHttpOptions({ AUTH_CREDENTIAL_LIMIT: '0' }).options;
  assert.equal(off.authAbuseLimiter.check('ip:a', 'x', 1), false);
  assert.equal(off.authAbuseLimiter.check('ip:a', 'y', 1), false);
});

test('TRUSTED_CLIENT_KEYS gives each client its own two budgets; a refused entry is named, never its key', () => {
  const { options, notices } = buildHttpOptions({ TRUSTED_CLIENT_KEYS: `bot:5:${KEY},kurz:5:abc` });
  assert.deepEqual([...options.clientBudgets!.clients.values()], [{ name: 'bot', rpm: 5 }]);
  assert.equal(allowed(options.clientBudgets!.tool('client:bot')), 5);
  assert.equal(allowed(options.clientBudgets!.protocol('client:bot')), 5 * PROTOCOL_FACTOR);
  assert.equal(notices.length, 1);
  assert.equal(notices[0]!.level, 'warn');
  assert.match(notices[0]!.message, /TRUSTED_CLIENT_KEYS/);
  assert.deepEqual(notices[0]!.fields, { names: ['kurz'] });
  assert.ok(!JSON.stringify(notices).includes('abc'), 'the key itself is never repeated');
});

test('TICKET_ALLOWED_ORIGINS: a list restricts; a list with nothing usable admits NO origin and says so', () => {
  const listed = buildHttpOptions({ TICKET_ALLOWED_ORIGINS: 'https://portal.example.org, https://b.example.org' });
  assert.deepEqual([...listed.options.ticketAllowedOrigins!].sort(), ['https://b.example.org', 'https://portal.example.org']);
  assert.deepEqual(listed.notices, []);

  const partly = buildHttpOptions({ TICKET_ALLOWED_ORIGINS: 'https://portal.example.org,*' });
  assert.equal(partly.options.ticketAllowedOrigins!.size, 1);
  assert.equal(partly.notices[0]!.level, 'warn');

  const broken = buildHttpOptions({ TICKET_ALLOWED_ORIGINS: '*' });
  assert.equal(broken.options.ticketAllowedOrigins?.size, 0, 'closed, not open');
  assert.equal(broken.notices[0]!.level, 'error');
  assert.match(broken.notices[0]!.message, /NO browser origin/);
});

test('WIDGET_OAUTH_ORIGINS: listed origins expire; a list with nothing usable is an error line', () => {
  const listed = buildHttpOptions({ WIDGET_OAUTH_ORIGINS: 'https://widget.example.org' });
  assert.deepEqual([...listed.options.widgetOAuthOrigins!], ['https://widget.example.org']);
  const broken = buildHttpOptions({ WIDGET_OAUTH_ORIGINS: 'not-an-origin' });
  assert.equal(broken.options.widgetOAuthOrigins?.size, 0);
  assert.equal(broken.notices[0]!.level, 'error');
  assert.match(broken.notices[0]!.message, /do NOT expire/);
});

test('METRICS_TOKEN: a real token opens /metrics; a short one stays off and is said', () => {
  const token = 'm'.repeat(24);
  assert.equal(buildHttpOptions({ METRICS_TOKEN: token }).options.metricsToken, token);
  const short = buildHttpOptions({ METRICS_TOKEN: 'geheim' });
  assert.equal(short.options.metricsToken, undefined);
  assert.equal('metricsToken' in short.options, false);
  assert.match(short.notices[0]!.message, /METRICS_TOKEN is too short/);
});

test('WLO_SESSION_EXCHANGE takes every on spelling, like every switch but TRUST_PROXY', () => {
  for (const yes of ['1', 'true', 'yes', 'on', ' ON ']) {
    assert.equal(buildHttpOptions({ WLO_SESSION_EXCHANGE: yes }).options.sessionExchange, true, JSON.stringify(yes));
  }
  for (const no of ['', '0', 'false', 'off', '2']) {
    assert.notEqual(buildHttpOptions({ WLO_SESSION_EXCHANGE: no }).options.sessionExchange, true, JSON.stringify(no));
  }
});

test('TRUST_PROXY: only an explicit yes — never by default, never for another value', () => {
  for (const yes of ['1', 'true', 'TRUE', 'yes']) {
    assert.equal(buildHttpOptions({ TRUST_PROXY: yes }).options.trustProxy, true, yes);
  }
  for (const no of ['', '0', 'false', 'no', 'on', ' true ', '2']) {
    assert.equal(buildHttpOptions({ TRUST_PROXY: no }).options.trustProxy, false, JSON.stringify(no));
  }
});

test('MAX_BODY_BYTES, WLO_PUBLIC_BASE_URL and MCP_SSE reach the handler', () => {
  const { options } = buildHttpOptions({
    MAX_BODY_BYTES: '1000', WLO_PUBLIC_BASE_URL: 'https://mcp.example.org', MCP_SSE: '1',
  });
  assert.equal(options.maxBodyBytes, 1000);
  assert.equal(options.publicBaseUrl, 'https://mcp.example.org');
  assert.equal(options.streamOptions.enableJsonResponse, false);
});

test('http.ts builds its handler from buildHttpOptions and from nothing else', () => {
  // The function above is only worth its tests while the entry point uses it.
  // `http.ts` cannot be imported (it listens), so its SOURCE is read.
  const source = readFileSync(new URL('../src/http.ts', import.meta.url), 'utf8');
  assert.match(source, /buildHttpOptions\(process\.env\)/);
  assert.match(source, /createHttpRequestHandler\(\s*(?:http\.)?options\s*\)/, 'the built options are passed on whole');
  assert.doesNotMatch(source, /createRateLimiter|createDistinctValueLimiter|createClientBudgets/,
    'no limiter is constructed beside the tested function');
  assert.doesNotMatch(source, /trustProxy:\s*true/);
});

test('the session exchange: off by default, its own origin list, closed when every entry is unusable', () => {
  const none = buildHttpOptions({});
  assert.equal(none.options.sessionExchange, undefined);
  assert.equal(none.options.sessionAllowedOrigins, undefined);

  const on = buildHttpOptions({ WLO_SESSION_EXCHANGE: '1' });
  assert.equal(on.options.sessionExchange, true);
  assert.equal(on.options.sessionAllowedOrigins, undefined, 'no list: the repository origin, decided at the endpoint');
  assert.ok(on.notices.some(n => /WLO_SESSION_EXCHANGE/.test(n.message)), 'said at startup');

  const listed = buildHttpOptions({ WLO_SESSION_EXCHANGE: '1', WLO_SESSION_ALLOWED_ORIGINS: 'https://redaktion.example.org' });
  assert.deepEqual([...listed.options.sessionAllowedOrigins!], ['https://redaktion.example.org']);
  assert.equal(listed.options.ticketAllowedOrigins, undefined, 'the ticket path is not narrowed by it');

  const broken = buildHttpOptions({ WLO_SESSION_EXCHANGE: '1', WLO_SESSION_ALLOWED_ORIGINS: '*, redaktion' });
  assert.equal(broken.options.sessionAllowedOrigins?.size, 0, 'closed, not opened to the default');
  assert.ok(broken.notices.some(n => n.level === 'error' && /WLO_SESSION_ALLOWED_ORIGINS/.test(n.message)));

  const stray = buildHttpOptions({ WLO_SESSION_ALLOWED_ORIGINS: 'https://redaktion.example.org' });
  assert.equal(stray.options.sessionAllowedOrigins, undefined);
  assert.ok(stray.notices.some(n => /WLO_SESSION_ALLOWED_ORIGINS/.test(n.message) && /WLO_SESSION_EXCHANGE/.test(n.message)),
    'a list without the switch is said, not silently ignored');
});

test('WLO_SESSION_MOUNT_PATH: taken only with the exchange, only ending in /auth/session', () => {
  const ok = buildHttpOptions({ WLO_SESSION_EXCHANGE: '1', WLO_SESSION_MOUNT_PATH: '/edu-sharing/services/wlo-mcp/auth/session' });
  assert.equal(ok.options.sessionMountPath, '/edu-sharing/services/wlo-mcp/auth/session');
  for (const bad of ['/edu-sharing/services/wlo-mcp', 'edu-sharing/x/auth/session', '/a/../auth/session', '/a b/auth/session',
    '//auth/session', '/x/./auth/session', '/a//b/auth/session', '/a%2Fb/auth/session', '/Ä/auth/session']) {
    const r = buildHttpOptions({ WLO_SESSION_EXCHANGE: '1', WLO_SESSION_MOUNT_PATH: bad });
    assert.equal(r.options.sessionMountPath, undefined, bad);
    assert.ok(r.notices.some(n => n.level === 'error' && /WLO_SESSION_MOUNT_PATH/.test(n.message)), bad);
  }
  const off = buildHttpOptions({ WLO_SESSION_MOUNT_PATH: '/edu-sharing/services/wlo-mcp/auth/session' });
  assert.equal(off.options.sessionMountPath, undefined, 'not without the switch');
});
