/**
 * tools/topic-pages-present.ts – pure presentation layer for
 * search_wlo_topic_pages: turn the raw ThemePageInfo[] returned by the mode
 * dispatch into merged, sorted, display-ready entries (mergeThemePages) and
 * render them as JSON or Markdown (renderThemePages). No upstream I/O lives
 * here, which keeps the merge/sort/render rules unit-testable in isolation.
 */

import type { ThemePageInfo } from '../topic-page-api.js';
import type { FormattedNode } from '../formatter.js';
import { oneLine } from '../formatter.js';
import type { SwimlanePayload } from '../services/topic-page.js';
import { labelFromUri } from '../vocabs.js';
import { pickThemePageTitle } from './shared.js';

export interface ThemePageVariant {
  variantId: string;
  targetGroup: string;
  targetGroupLabel: string;
  topicPageUrl: string;
  /**
   * The variant the Themenseite actually renders (`ccm:page_config.default`).
   * Sibling variants are mostly editorial copies rather than target-group
   * fassungen — measured 2026-08-07 — so "which one is live" is not derivable
   * from the target group and has to be said out loud.
   */
  isDefault: boolean;
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
      isDefault: r.isDefault === true,
    };

    const key = opts.merge ? collectionId : r.variantId;
    if (seen.has(key)) {
      const ex = seen.get(key)!;
      if (!ex.variants.some(v => v.variantId === variant.variantId)) {
        // The rendered variant leads, whenever it arrives. A collection can own
        // several page-config folders and they are resolved independently, so
        // the superseded one can come back first — and `variants[0]` is what
        // `includeContent` resolves, i.e. what the page would be rendered from.
        if (variant.isDefault) ex.variants.unshift(variant); else ex.variants.push(variant);
      }
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
/**
 * Project the presented theme pages onto the node-list shape the results widget
 * renders — ONE tile per page, not per variant.
 *
 * A Themenseite is not a node, so the projection fills the fields it has and
 * leaves the rest empty: `nodeId` is the OWNING collection (what every
 * follow-up needs) and `topicPageUrl` is set, which is what makes the tile
 * offer "Themenseite öffnen" rather than "Inhalte anzeigen". The variants
 * (target groups) do not survive into the widget — they never did — and stay
 * in the text output.
 */
export function themePagesAsNodeList(out: PresentedThemePage[]): {
  total: number;
  count: number;
  results: FormattedNode[];
} {
  const results = out.map((p): FormattedNode => ({
    nodeId: p.collectionId,
    title: p.title,
    description: '',
    keywords: [],
    disciplines: [],
    educationalContexts: p.educationalContexts ?? [],
    userRoles: [],
    learningResourceTypes: [],
    url: p.topicPageUrl,
    downloadUrl: '',
    contentUrl: '',
    previewUrl: '',
    previewIsIcon: true,
    mimeType: '',
    fileSize: 0,
    license: '',
    publisher: '',
    nodeType: 'collection',
    topicPageUrl: p.topicPageUrl,
  }));
  return { total: results.length, count: results.length, results };
}

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
        // Which one the page shows is not guessable from the target group —
        // most siblings are editorial copies — so it is stated.
        const mark = v.isDefault ? ' — angezeigte Variante' : '';
        parts.push(`  - ${v.targetGroupLabel} (Variante-ID: ${v.variantId})${mark}`);
      }
    }
    // Every part is one logical line — the collection name that becomes the
    // `## ` heading is repository-supplied, and a newline in it would open a
    // second Themenseite entry carrying a `Sammlung-nodeId:` of its own. That
    // id is what the next tool call acts on. Same rule as renderToText.
    lines.push(parts.map(oneLine).join('\n'));
    lines.push('');
  }
  return { content: [{ type: 'text' as const, text: lines.join('\n').trim() }, meta] };
}
