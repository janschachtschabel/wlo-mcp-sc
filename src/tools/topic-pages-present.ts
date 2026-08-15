/**
 * tools/topic-pages-present.ts – pure presentation layer for
 * search_wlo_topic_pages: turn the raw ThemePageInfo[] returned by the mode
 * dispatch into merged, sorted, display-ready entries (mergeThemePages) and
 * render them as JSON or Markdown (renderThemePages). No upstream I/O lives
 * here, which keeps the merge/sort/render rules unit-testable in isolation.
 */

import type { ThemePageInfo } from '../topic-page-variant.js';
import type { FormattedNode } from '../formatter.js';
import { oneLine, registrySummaryLines } from '../formatter.js';
import type { SwimlanePayload } from '../services/topic-page.js';
import { labelFromUri } from '../vocabs.js';
import { pickThemePageTitle } from './shared.js';
import type { VariantPreset } from '../topic-page-config.js';

/**
 * How a Themenseite comes up before anyone touches its profile selector.
 *
 * Reported beside `targetGroup`, never merged into it: measured 2026-08-11 over
 * 69 staging variants, the two sources are near-disjoint (1 resp. 2 carry both)
 * and where both exist they disagree in 3 of 3 cases. Raw values plus labels,
 * the same shape `targetGroup`/`targetGroupLabel` uses — a bare vocabulary URI
 * is not something a model can weigh.
 */
export interface VariantPresetView {
  intention?: 'teach' | 'learn';
  intentionLabel?: string;
  educationLevels?: string[];
  educationLevelLabels?: string[];
}

export interface ThemePageVariant {
  variantId: string;
  targetGroup: string;
  targetGroupLabel: string;
  /** Absent when the variant declares no preset — 37 of 69 staging variants. */
  variantPreset?: VariantPresetView;
  topicPageUrl: string;
  /**
   * The variant the Themenseite actually renders (`ccm:page_config.default`).
   * Sibling variants are mostly editorial copies rather than target-group
   * fassungen — measured 2026-08-07 — so "which one is live" is not derivable
   * from the target group and has to be said out loud.
   */
  isDefault: boolean;
}

/** German labels for the two intentions the page builder stores. */
const INTENTION_LABELS: Record<string, string> = { teach: 'Lehren', learn: 'Lernen' };

function presetView(p: VariantPreset): VariantPresetView {
  return {
    ...(p.intention ? { intention: p.intention, intentionLabel: INTENTION_LABELS[p.intention] } : {}),
    ...(p.educationLevels?.length
      ? {
          educationLevels: p.educationLevels,
          educationLevelLabels: p.educationLevels.map(u => labelFromUri(u, 'educationalContext')),
        }
      : {}),
  };
}

export interface PresentedThemePage {
  title: string;
  collectionId: string;
  variants: ThemePageVariant[];
  educationalContexts: string[];
  topicPageUrl: string;
  /** Resolved swimlane content, only when includeContent is requested. */
  content?: SwimlanePayload;
  /**
   * The approved-skills catalogue of the OWNING COLLECTION — a Themenseite is a
   * collection with a page layout, so the registry hangs off `collectionId` and
   * never off a variant, which is one rendering of it.
   *
   * Carried on the page rather than passed to the renderer, so the JSON payload,
   * `structuredContent` and the Markdown listing all read the same field. The
   * renderer used to take a lookup map, which left both JSON paths empty.
   */
  skillRegistry?: FormattedNode['skillRegistry'];
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
      ...(r.variantPreset ? { variantPreset: presetView(r.variantPreset) } : {}),
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
    // Same field the search tools carry, so a widget or REST caller reading
    // `structuredContent` sees the catalogue here too rather than only in the
    // Markdown listing.
    ...(p.skillRegistry ? { skillRegistry: p.skillRegistry } : {}),
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
    // Head line only: this listing is already a block per page carrying variant
    // ids, and a hundred skills under each would bury what it exists to show.
    if (r.skillRegistry) parts.push(...registrySummaryLines(r.skillRegistry, { entries: false }));
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
