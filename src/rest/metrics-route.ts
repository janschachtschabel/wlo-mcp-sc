/**
 * rest/metrics-route.ts – `GET /metrics`, for the operator's scraper only.
 *
 * OFF unless `METRICS_TOKEN` is set, and then answered only to that token. What
 * is counted names no caller, but which tools run how often and how the
 * repository answers is the operator's picture of the service, not the public's.
 * Without a token the path does not exist (404 like any unknown one), so the
 * default deployment gains no surface.
 */

import { createHash, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';

import { renderMetrics } from '../metrics.js';
import { upstreamGateStats } from '../upstream-gate.js';
import { SERVER_VERSION } from '../version.js';

export const METRICS_PATH = '/metrics';

/** Shorter than this is a guessable word, not a secret — and a guessable token is worse than none. */
const MIN_TOKEN_CHARS = 16;

/** The configured token, or undefined when the endpoint stays off. */
export function metricsTokenFrom(raw: string | undefined): string | undefined {
  const token = raw?.trim() ?? '';
  return token.length >= MIN_TOKEN_CHARS ? token : undefined;
}

/** Whether a value was given that is too short to be used — the startup line says so. */
export function metricsTokenRejected(raw: string | undefined): boolean {
  const token = raw?.trim() ?? '';
  return token.length > 0 && token.length < MIN_TOKEN_CHARS;
}

/** Compared as digests: equal length for `timingSafeEqual`, and no early exit on the first differing byte. */
function sameToken(given: string, expected: string): boolean {
  const digest = (v: string) => createHash('sha256').update(v).digest();
  return timingSafeEqual(digest(given), digest(expected));
}

/** Values that are a state, not a count — read at the moment of the scrape. */
function gauges(): string {
  const gate = upstreamGateStats();
  return [
    '# HELP wlo_build_info The running version.',
    '# TYPE wlo_build_info gauge',
    `wlo_build_info{version="${SERVER_VERSION}"} 1`,
    '# HELP process_uptime_seconds Seconds since the process started.',
    '# TYPE process_uptime_seconds gauge',
    `process_uptime_seconds ${Math.round(process.uptime())}`,
    '# HELP process_resident_memory_bytes Resident set size.',
    '# TYPE process_resident_memory_bytes gauge',
    `process_resident_memory_bytes ${process.memoryUsage().rss}`,
    '# HELP wlo_upstream_in_flight Repository calls open right now.',
    '# TYPE wlo_upstream_in_flight gauge',
    `wlo_upstream_in_flight ${gate.inFlight}`,
    '# HELP wlo_upstream_waiting Repository calls waiting for a slot right now.',
    '# TYPE wlo_upstream_waiting gauge',
    `wlo_upstream_waiting ${gate.waiting}`,
    '# HELP wlo_upstream_limit The configured bound on open repository calls (WLO_UPSTREAM_CONCURRENCY).',
    '# TYPE wlo_upstream_limit gauge',
    `wlo_upstream_limit ${gate.limit}`,
  ].join('\n') + '\n';
}

/** Answers the request. The caller has already matched method, path and "a token is configured". */
export function handleMetrics(req: IncomingMessage, res: ServerResponse, token: string): void {
  const header = req.headers['authorization'];
  const given = typeof header === 'string' && header.startsWith('Bearer ') ? header.slice('Bearer '.length) : '';
  if (!given || !sameToken(given, token)) {
    res.writeHead(401, { 'Content-Type': 'application/json', 'WWW-Authenticate': 'Bearer realm="metrics"' });
    res.end(JSON.stringify({ error: 'Unauthorized' }));
    return;
  }
  res.writeHead(200, { 'Content-Type': 'text/plain; version=0.0.4; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(gauges() + renderMetrics());
}
