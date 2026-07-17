/**
 * tools/health.ts – wlo_health_check:
 * Reachability/latency probe against the configured repository.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import {
  BASE_URL,
  WLO_REPOSITORY_URL,
  WLO_ROOT_COLLECTION_ID,
  getNodeMetadata,
} from '../wlo-api.js';

export function registerHealthTool(server: McpServer): void {
  server.tool(
    'wlo_health_check',
    `Probe whether the WLO repository API is reachable and responding.
Returns latency in ms, the resolved root collection nodeId, and a status flag.
Useful for callers (e.g. chatbots) to quickly tell "WLO is down" from "your query produced no hits".`,
    {},
    { readOnlyHint: true },
    async () => {
      const t0 = Date.now();
      try {
        const root = WLO_ROOT_COLLECTION_ID;
        const node = await getNodeMetadata(root);
        const latencyMs = Date.now() - t0;
        const ok = node !== null;
        const payload = {
          ok,
          repositoryUrl: WLO_REPOSITORY_URL,
          baseUrl: BASE_URL,
          rootNodeId: root,
          rootResolved: ok ? (node.properties?.['cclom:title']?.[0] ?? node.properties?.['cm:name']?.[0] ?? null) : null,
          latencyMs,
          checkedAt: new Date().toISOString(),
        };
        return { content: [{ type: 'text' as const, text: JSON.stringify(payload) }] };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        const payload = {
          ok: false,
          repositoryUrl: WLO_REPOSITORY_URL,
          baseUrl: BASE_URL,
          error: msg,
          latencyMs: Date.now() - t0,
          checkedAt: new Date().toISOString(),
        };
        return { content: [{ type: 'text' as const, text: JSON.stringify(payload) }], isError: true };
      }
    },
  );
}
