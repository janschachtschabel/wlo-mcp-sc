/**
 * rest/internal-port.ts – the operator's three paths on a port of their own
 * (chatbot feedback 2026-11-13, D10; service guide of Team 6: two ports).
 *
 * `GET /health`, `GET /ready`, `GET /metrics` — and nothing else. With
 * `INTERNAL_PORT` set, a second listener serves them where the platform's
 * probes and the scraper reach it and the public proxy does not. It is an
 * ADDITION: the same paths stay on the public port until the deployment that
 * needs them gone is in place.
 *
 * Deliberately not a mode of `createHttpRequestHandler`: that handler carries
 * CORS, budgets, the credential scope and the request counters, none of which
 * belong on a port only the cluster talks to — and a probe every few seconds
 * would otherwise be the loudest series in `wlo_http_requests_total`.
 *
 * `/metrics` needs no token here unless one is configured: who can reach this
 * port is decided by the network, which is the point of having it. With
 * `METRICS_TOKEN` set the token is asked for on both ports alike.
 */

import type { IncomingMessage, ServerResponse } from 'node:http';

import { log } from '../logger.js';
import { parseRequestUrl } from '../request-url.js';
import { writeHealth, HEALTH_PATH } from './health.js';
import { METRICS_PATH, handleMetrics, writeMetrics } from './metrics-route.js';
import { handleReady, READY_PATH } from './ready.js';

export function createInternalHandler(opts: { metricsToken?: string } = {}) {
  const answer = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const path = parseRequestUrl(req.url)?.pathname;
    if (req.method === 'GET' && path === HEALTH_PATH) return writeHealth(res);
    if (req.method === 'GET' && path === READY_PATH) return handleReady(res);
    if (req.method === 'GET' && path === METRICS_PATH) {
      return opts.metricsToken ? handleMetrics(req, res, opts.metricsToken) : writeMetrics(res);
    }
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found' }));
  };
  // node:http does not await a listener: a throw in here would be an unhandled
  // rejection, which ends the process on Node 22 — over a probe.
  return (req: IncomingMessage, res: ServerResponse): void => {
    answer(req, res).catch((err: unknown) => {
      log.error('internal port handler failed', { error: err instanceof Error ? err.message : String(err) });
      if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Internal error' }));
    });
  };
}
