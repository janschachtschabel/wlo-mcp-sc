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
import { ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';

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
  'search-results': 'WLO-Suchergebnisse: Sammlungs-Kacheln und Material-Karten mit aufklappbarer Detailansicht',
  'topic-page': 'WLO-Themenseite: Titel und Beschreibung über den Swimlanes mit ihren Inhalten',
  'browse': 'Interaktiver WLO-Sammlungsbaum zum Stöbern',
};

/**
 * Content-addressed resource URI: the hash covers the ENTIRE resource — the
 * HTML **and** its `_meta` (CSP, domain, description).
 *
 * Hosts treat the `ui://` URI as their cache key, so anything that changes the
 * resource must change the URI. Hashing only the HTML meant a metadata-only fix
 * kept the old URI and hosts kept serving their cached, stale copy — the
 * deployed fix silently had no effect (live-proven 2026-07-17). `_meta` is
 * derived from the environment, so a config change correctly yields a new URI
 * too.
 */
export function computeWidgetUri(name: string, html: string, meta: Record<string, unknown> = {}): string {
  const hash = createHash('sha256')
    .update(html)
    .update(JSON.stringify(meta))
    .digest('hex')
    .slice(0, 8);
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
 * App identity domain for the ChatGPT plugin submission (`ui.domain` + its
 * `openai/widgetDomain` alias); ChatGPT renders the widget under
 * `<domain>.web-sandbox.oaiusercontent.com`.
 *
 * Emitted ONLY when WLO_WIDGET_DOMAIN is explicitly set — and then on both
 * keys. A host validates the domain against its OWN sandbox format and rejects
 * the whole widget for a foreign value: Claude expects
 * `{hash}.claudemcpcontent.com` and aborts the bound tool call otherwise
 * (live-proven 2026-07-17). Crucially it NORMALISES the vendor alias onto the
 * standard key, so dropping only `ui.domain` is not enough — the rejected value
 * came from `openai/widgetDomain`, the sole place it still existed. A server
 * cannot know a host's sandbox domain, so the honest default is to send
 * neither and let each host assign its own.
 *
 * Read at call time so per-request servers and tests see the current env.
 */
function widgetDomain(): string | undefined {
  return (process.env['WLO_WIDGET_DOMAIN'] ?? '').trim() || undefined;
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
      // Both domain keys only when explicitly configured (see widgetDomain).
      ...(domain ? { domain } : {}),
      csp: { connectDomains: domains, resourceDomains: domains, frameDomains: [] },
      ...(description ? { description } : {}),
    },
    'openai/widgetPrefersBorder': true,
    ...(domain ? { 'openai/widgetDomain': domain } : {}),
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

  // STALE-URI compatibility read (live failure 2026-07-17: ChatGPT "Failed to
  // fetch template"): every redeploy rolls a new content-addressed URI, but a
  // host whose connector still holds the PREVIOUS tool descriptor (ChatGPT
  // syncs tools/list on connect, not per chat) then reads the old URI — which
  // this server no longer registered. Like a CDN, any old hash for a KNOWN
  // widget name must keep resolving; it serves the CURRENT build. New URIs
  // still roll on every change (fresh hosts get fresh cache keys) — only the
  // dead-end for stale sessions is gone.
  server.registerResource(
    `${res.name} (stale-uri compat)`,
    new ResourceTemplate(`ui://widget/${res.name}-{hash}.html`, { list: undefined }),
    { mimeType: WIDGET_MIME_TYPE, _meta: meta },
    (uri) => ({
      contents: [{ uri: uri.href, mimeType: WIDGET_MIME_TYPE, text: res.html, _meta: meta }],
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
    // Same meta object the registration emits — so the URI provably matches
    // the resource it addresses.
    built.push({ name, uri: computeWidgetUri(name, html, widgetResourceMeta(name)), html });
  }
  widgetCache = built;
  return built;
}

/**
 * Deploy fingerprint: `widget name → 8-hex content hash` of the loaded builds.
 * Exposed on `/health` so "is the fix actually deployed?" is one curl — the
 * content-addressed hash changes with every widget/meta change, which made it
 * the de-facto deploy marker during live debugging (2026-07-17: two test
 * rounds ran against stale builds before this existed). Empty when widgets
 * are not built.
 */
export function widgetBuildIds(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const res of loadWidgets()) {
    const m = res.uri.match(/-([0-9a-f]{8})\.html$/);
    if (m?.[1]) out[res.name] = m[1];
  }
  return out;
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
