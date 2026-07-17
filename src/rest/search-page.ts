/**
 * rest/search-page.ts – Readable HTML view of the /api/search envelope
 * (`?format=html`).
 *
 * Some AI browsing pipelines can open a user-pasted URL but only consume
 * READER content — raw JSON is dropped (live-observed with ChatGPT,
 * 2026-07-17: it retrieved the API URL but reported "no WLO JSON response").
 * This renders the same envelope as a minimal, self-contained HTML page
 * (inline CSS, no external assets), which doubles as the human-friendly share
 * target. Pure function; every interpolated field is escaped (backend data)
 * and links are scheme-guarded.
 */

import { escapeHtml } from '../apps/widgets/shared/escape.js';

interface PageBucket {
  total?: number;
  count?: number;
  results?: Record<string, unknown>[];
}

export interface SearchPageData {
  query?: string;
  content?: PageBucket;
  collections?: PageBucket;
  topicPages?: PageBucket;
  warnings?: string[];
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

/** Only plain http(s) URLs become links (backend metadata is untrusted). */
function safeHttpHref(v: unknown): string {
  const s = str(v).trim();
  return /^https?:\/\//i.test(s) ? s : '';
}

function item(node: Record<string, unknown>): string {
  const title = escapeHtml(str(node['title']) || '(ohne Titel)');
  const href = safeHttpHref(node['url']) || safeHttpHref(node['contentUrl']) || safeHttpHref(node['topicPageUrl']);
  const head = href ? `<a href="${escapeHtml(href)}" rel="noopener noreferrer">${title}</a>` : title;
  const desc = str(node['description']).slice(0, 220);
  const facts = [str(node['publisher']), str(node['license']) || 'Lizenz unklar'].filter(Boolean).join(' · ');
  return `<li>${head}${desc ? ` — ${escapeHtml(desc)}` : ''}<br /><small>${escapeHtml(facts)}</small></li>`;
}

function section(heading: string, bucket: PageBucket | undefined): string {
  const results = bucket?.results ?? [];
  if (results.length === 0) return '';
  return (
    `<section><h2>${escapeHtml(heading)} (${bucket?.total ?? results.length})</h2>` +
    `<ol>${results.map(item).join('')}</ol></section>`
  );
}

export function renderSearchPage(data: SearchPageData): string {
  const q = str(data.query);
  const warnings = (data.warnings ?? []).map(w => `<p class="warn">${escapeHtml(str(w))}</p>`).join('');
  const jsonHref = q ? `/api/search/${encodeURIComponent(q)}` : '/api/search/';
  const body =
    section('Inhalte', data.content) +
    section('Sammlungen', data.collections) +
    section('Themenseiten', data.topicPages);
  const empty = body
    ? ''
    : `<p>Keine Treffer.${q ? '' : ' Suchbegriff in den Pfad setzen: /api/search/&lt;Begriff&gt;?format=html'}</p>`;
  return (
    '<!doctype html>\n<html lang="de"><head><meta charset="utf-8" />' +
    '<meta name="viewport" content="width=device-width, initial-scale=1" />' +
    `<title>WLO-Suche${q ? `: ${escapeHtml(q)}` : ''}</title>` +
    '<style>body{font:16px/1.55 system-ui,sans-serif;max-width:760px;margin:2rem auto;padding:0 1rem;color:#1a1a1a}' +
    'h1{font-size:1.4rem}h2{font-size:1.1rem;margin-top:1.6rem}ol{padding-inline-start:1.2rem}li{margin:0 0 .7rem}' +
    'small{color:#565656}.warn{background:#fff4d6;padding:.5rem .8rem;border-radius:6px}a{color:#14539a}</style>' +
    `</head><body><h1>WLO-Suchergebnisse${q ? `: „${escapeHtml(q)}“` : ''}</h1>` +
    warnings +
    body +
    empty +
    `<p><small><a href="${escapeHtml(jsonHref)}">JSON-Ansicht</a> · Öffentliche, nur lesende WirLernenOnline-API</small></p>` +
    '</body></html>\n'
  );
}
