/**
 * rest/health.ts – `GET /health`: the process is up, and which build it is.
 *
 * Carries the widget build hashes as the DEPLOY FINGERPRINT (content-addressed
 * → changes with every widget/meta change), so whether a fix is actually live
 * is one curl instead of a byte-diff probe. One function, because the public
 * and the internal port both answer it and must answer the same.
 *
 * Says nothing about the repository — that is `/ready`. A liveness probe that
 * failed with the repository would restart a healthy process.
 */

import type { ServerResponse } from 'node:http';

import { widgetBuildIds } from '../apps/resources.js';
import { SERVER_VERSION } from '../version.js';

export const HEALTH_PATH = '/health';

export function writeHealth(res: ServerResponse): void {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ status: 'ok', server: 'wlo-mcp', version: SERVER_VERSION, widgets: widgetBuildIds() }));
}
