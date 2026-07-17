/**
 * tools/topic-pages-present.ts – pure presentation layer for
 * search_wlo_topic_pages: turn the raw ThemePageInfo[] returned by the mode
 * dispatch into merged, sorted, display-ready entries (mergeThemePages) and
 * render them as JSON or Markdown (renderThemePages). No upstream I/O lives
 * here, which keeps the merge/sort/render rules unit-testable in isolation.
 */

import type { ThemePageInfo } from '../topic-page-api.js';
import type { SwimlanePayload } from '../services/topic-page.js';
import { labelFromUri } from '../vocabs.js';
import { pickThemePageTitle } from './shared.js';

export interface ThemePageVariant {
  variantId: string;
  targetGroup: string;
  targetGroupLabel: string;
  topicPageUrl: string;
}

export interface PresentedThemePage {
  title: string;
  collectionId: string;
  variants: ThemePageVariant[];
  educationalContexts: string[];
  topicPageUrl: string;
  /** Resolved swimlane content, only when includeContent is requested. */
  content?: SwimlanePayload;
}

/**
 * Merge raw variants into presented entries: optionally collapse variants of
 * the same collection into one entry (different target groups), resolve
 * target-group / educational-context labels, then order deterministically.
 * - `alpha` sorts by title with the collectionId as tie-breaker.
 * - `relevance` keeps the upstream insertion order (already relevance-ranked).
 * The result is sliced to `maxResults`.
 */
export function mergeThemePages(
  results: ThemePageInfo[],
  opts: { merge: boolean; sort: 'relevance' | 'alpha'; maxResults: number },
): PresentedThemePage[] {
  const seen = new Map<string, PresentedThemePage>();
  const order: string[] = [];

  for (const r of results) {
    const collectionId = r.collectionId ?? r.variantId;
    // Never surface the raw "PAGE_VARIANT_<uuid>" (cm:name) or a bare
    // node UUID. Prefer owning-collection name → variant cm:title →
    // clean cm:name → generic "Themenseite".
    const title = pickThemePageTitle(r);
    const eduLabels = r.educationalContexts.map(u => labelFromUri(u, 'educationalContext'));
    const tgLabel = r.targetGroup ? labelFromUri(r.targetGroup, 'targetGroup') : 'nicht gesetzt';
    const variant: ThemePageVariant = {
      variantId: r.variantId,
      targetGroup: r.targetGroup || '',
      targetGroupLabel: tgLabel,
      topicPageUrl: r.topicPageUrl,
    };

    const key = opts.merge ? collectionId : r.variantId;
    if (seen.has(key)) {
      const ex = seen.get(key)!;
      if (!ex.variants.some(v => v.variantId === variant.variantId)) ex.variants.push(variant);
      for (const e of eduLabels) if (!ex.educationalContexts.includes(e)) ex.educationalContexts.push(e);
      if (!ex.topicPageUrl && variant.topicPageUrl) ex.topicPageUrl = variant.topicPageUrl;
    } else {
      seen.set(key, {
        title,
        collectionId,
        variants: [variant],
        educationalContexts: eduLabels,
        topicPageUrl: r.topicPageUrl,
      });
      order.push(key);
    }
  }

  // Stable, deterministic ordering:
  // - relevance: keep upstream insertion order as-is (already relevance-ranked)
  // - alpha: sort by title (with collectionId tie-breaker)
  const sortedKeys = opts.sort === 'alpha'
    ? [...order].sort((a, b) => {
        const ta = (seen.get(a)?.title ?? '').toLowerCase();
        const tb = (seen.get(b)?.title ?? '').toLowerCase();
        if (ta !== tb) return ta.localeCompare(tb, 'de');
        return a.localeCompare(b);
      })
    : [...order];

  return sortedKeys.slice(0, opts.maxResults).map(k => seen.get(k)!);
}

type TextContent = { type: 'text'; text: string };

/**
 * Render presented Themenseiten as either a JSON payload (total + results) or
 * a Markdown listing, and append the machine-readable `_queryMeta` block in
 * both cases.
 */
export function renderThemePages(
  out: PresentedThemePage[],
  meta: TextContent,
  format: 'markdown' | 'json',
): { content: TextContent[] } {
  if (format === 'json') {
    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify({
          total: out.length,
          results: out,
        }),
      }, meta],
    };
  }

  const lines: string[] = [`Gefundene Themenseiten: ${out.length}\n`];
  for (const r of out) {
    const parts: string[] = [];
    parts.push(`## ${r.title}`);
    parts.push(`Sammlung-nodeId: ${r.collectionId}`);
    if (r.educationalContexts.length) {
      parts.push(`Bildungsstufe: ${r.educationalContexts.join(', ')}`);
    }
    if (r.topicPageUrl) parts.push(`Themenseite: ${r.topicPageUrl}`);
    if (r.variants.length === 1) {
      parts.push(`Zielgruppe: ${r.variants[0].targetGroupLabel}`);
      parts.push(`Variante-ID: ${r.variants[0].variantId}`);
    } else {
      parts.push(`Varianten (${r.variants.length}):`);
      for (const v of r.variants) {
        parts.push(`  - ${v.targetGroupLabel} (Variante-ID: ${v.variantId})`);
      }
    }
    lines.push(parts.join('\n'));
    lines.push('');
  }
  return { content: [{ type: 'text' as const, text: lines.join('\n').trim() }, meta] };
}
