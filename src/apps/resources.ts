/**
 * apps/resources.ts – Apps-SDK `ui://` widget resources.
 *
 * A widget is a single self-contained HTML file (JS+CSS inlined by
 * `widgets/build.mjs`) served as an MCP resource with MIME
 * `text/html;profile=mcp-app`. A tool renders its widget by pointing
 * `_meta.ui.resourceUri` at that resource (wired via the `registerWloTool`
 * seam). This file owns the resource side: the versioned URI, the resource
 * `_meta` (CSP/domain), registration, and loading the built HTML from disk.
 */

import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { WLO_REPOSITORY_URL } from '../wlo-api.js';

/**
 * MIME type an MCP-Apps host requires for an inlined widget resource. Defaults to
 * the current MCP-Apps standard `text/html;profile=mcp-app` — the value the
 * ChatGPT host keys on to enable the MCP-Apps bridge (per the Apps-SDK
 * build/mcp-server docs, verified 2026-07-16). `text/html+skybridge` is the
 * pre-migration Skybridge value; it no longer appears in the current docs but is
 * kept reachable via `WLO_WIDGET_MIME=text/html+skybridge` as a safety valve for
 * an older in-field runtime — a one-env flip, no code change.
 */
export const WIDGET_MIME_TYPE: string =
  (process.env['WLO_WIDGET_MIME'] ?? '').trim() || 'text/html;profile=mcp-app';

/** Renderable widgets shipped as resources (the tile is a shared component, not a resource). */
const WIDGET_NAMES = ['search-results', 'topic-page', 'browse'] as const;
export type WidgetName = (typeof WIDGET_NAMES)[number];

/**
 * Short human-readable component descriptions (audit A-2): hosts use them to
 * label the rendered widget (discovery + accessibility). German, like the rest
 * of the user-facing copy.
 */
const WIDGET_DESCRIPTIONS: Record<string, string> = {
  'search-results': 'WLO-Suchergebnisse als Kachelliste (Materialien, Sammlungen, Themenseiten)',
  'topic-page': 'WLO-Themenseite mit ihren Swimlanes und Inhalten',
  'browse': 'Interaktiver WLO-Sammlungsbaum zum Stöbern',
};

/**
 * Content-addressed resource URI. A rebuilt widget yields a new hash so hosts
 * that cache `ui://` resources fetch the fresh HTML instead of a stale copy.
 */
export function computeWidgetUri(name: string, html: string): string {
  const hash = createHash('sha256').update(html).digest('hex').slice(0, 8);
  return `ui://widget/${name}-${hash}.html`;
}

/** The configured edu-sharing origin — the only host a widget loads data/images from. */
function eduSharingOrigin(): string {
  try {
    return new URL(WLO_REPOSITORY_URL).origin;
  } catch {
    return '';
  }
}

/**
 * App identity domain for the ChatGPT plugin submission (`ui.domain` +
 * `openai/widgetDomain`); ChatGPT renders the widget under
 * `<domain>.web-sandbox.oaiusercontent.com`.
 *
 * The STANDARD `ui.domain` key is only emitted when WLO_WIDGET_DOMAIN is
 * explicitly set: Claude's MCP-Apps host validates the field against its OWN
 * sandbox format (`{hash}.claudemcpcontent.com`) and rejects the whole widget
 * for foreign values (live-found 2026-07-17). The vendor-prefixed
 * `openai/widgetDomain` alias is always emitted (non-ChatGPT hosts ignore
 * `openai/*` keys) so ChatGPT dev mode keeps working without configuration.
 * Read at call time so per-request servers and tests see the current env.
 */
function widgetDomain(): { explicit: string | undefined; alias: string } {
  const explicit = (process.env['WLO_WIDGET_DOMAIN'] ?? '').trim() || undefined;
  return { explicit, alias: explicit ?? eduSharingOrigin() };
}

/**
 * Resource `_meta` for a widget: the MCP-Apps standard `ui.*` keys plus the
 * ChatGPT `openai/widget*` aliases. The CSP whitelists exactly the edu-sharing
 * origin (preview images + any widget-side fetch) so the sandboxed iframe can
 * load OER thumbnails but nothing else.
 */
export function widgetResourceMeta(name?: string): Record<string, unknown> {
  const origin = eduSharingOrigin();
  const domain = widgetDomain();
  const domains = origin ? [origin] : [];
  const description = name ? WIDGET_DESCRIPTIONS[name] : undefined;
  return {
    ui: {
      prefersBorder: true,
      // Standard key only when explicitly configured (see widgetDomain).
      ...(domain.explicit ? { domain: domain.explicit } : {}),
      csp: { connectDomains: domains, resourceDomains: domains, frameDomains: [] },
      ...(description ? { description } : {}),
    },
    'openai/widgetPrefersBorder': true,
    'openai/widgetDomain': domain.alias,
    'openai/widgetCSP': {
      connect_domains: domains,
      resource_domains: domains,
      frame_domains: [],
    },
    ...(description ? { 'openai/widgetDescription': description } : {}),
  };
}

export interface WidgetResource {
  name: string;
  uri: string;
  html: string;
}

/** Register one built widget as a fetchable `ui://` resource. */
export function registerWidgetResource(server: McpServer, res: WidgetResource): void {
  const meta = widgetResourceMeta(res.name);
  server.registerResource(
    res.name,
    res.uri,
    { mimeType: WIDGET_MIME_TYPE, _meta: meta },
    () => ({
      // The Apps-SDK doc places the widget _meta (CSP/domain) on the READ
      // contents entry; hosts may read either surface, so emit it on BOTH the
      // resources/list descriptor above and each contents entry here.
      contents: [{ uri: res.uri, mimeType: WIDGET_MIME_TYPE, text: res.html, _meta: meta }],
    }),
  );
}

// `dist-widgets/` sits at the repo root, two levels up from this file whether it
// runs compiled (`dist/apps/resources.js`) or via tsx (`src/apps/resources.ts`).
const distWidgetsDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'dist-widgets');

/**
 * Load + hash the built widget HTML once and memoize it. The server is created
 * per request (stateless HTTP), so without this cache every request would
 * re-read the 3 files from disk and recompute their sha256 URIs. A widget whose
 * HTML has not been built is skipped (empty entry).
 */
let widgetCache: WidgetResource[] | null = null;
function loadWidgets(): WidgetResource[] {
  if (widgetCache) return widgetCache;
  const built: WidgetResource[] = [];
  for (const name of WIDGET_NAMES) {
    const file = join(distWidgetsDir, `${name}.html`);
    if (!existsSync(file)) continue;
    const html = readFileSync(file, 'utf8');
    built.push({ name, uri: computeWidgetUri(name, html), html });
  }
  widgetCache = built;
  return built;
}

/**
 * Register every built widget resource and return a `name → uri` map for the
 * tool seam. A widget whose HTML has not been built (e.g. tests that skip
 * `npm run build:widgets`) is skipped gracefully: its tool simply omits the
 * `widgetUri` and still returns text + structuredContent as before.
 */
export function registerWidgets(server: McpServer): Partial<Record<WidgetName, string>> {
  const uris: Partial<Record<WidgetName, string>> = {};
  for (const res of loadWidgets()) {
    registerWidgetResource(server, res);
    uris[res.name as WidgetName] = res.uri;
  }
  return uris;
}
