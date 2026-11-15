/**
 * topic-page-variant.ts – what a Themenseiten-Variante IS.
 *
 * The rules and shapes, with no upstream I/O: which properties describe a
 * variant, how a repository node is projected onto them, which variants survive
 * a caller's filters, which node counts as a real variant at all, and what may
 * be shown as a page's title.
 *
 * Split out of `topic-page-api.ts` on 2026-08-11, which had grown to 389 lines
 * around two jobs. 8 of its 13 importers needed only this half — including
 * `topic-page-title.ts`, whose type import back into the API module formed the
 * one import cycle in this corner; it is now a leaf with no imports at all.
 * Finding topic pages in the repository stayed in `topic-page-api.ts`; what a
 * page SHOWS is `topic-page-structure.ts`.
 *
 * The projection and the property list live together on purpose: adding a field
 * to `variantFields` means adding it to `TOPIC_PAGE_PROPS`, or the read comes
 * back empty with nothing failing.
 */

import type { WloNode } from './wlo-api.js';
import { DISPLAY_PROPS } from './wlo-api.js';
import type { VariantPreset } from './topic-page-config.js';
import { parseVariantPreset } from './topic-page-config.js';
import { displayTitleOrEmpty, isPlaceholderTitle } from './topic-page-title.js';

// Topic-page variants additionally need the page_variant fields
// (template flag, target group, swimlane config). Exported because
// `topic-page-structure.ts` reads the same projection off the config folder.
export const TOPIC_PAGE_PROPS: string[] = [
  ...DISPLAY_PROPS,
  'ccm:page_variant_is_template',
  'ccm:page_variant_profiling_target_group',
  'ccm:page_variant_config',
];

export type TargetGroup = 'teacher' | 'learner' | 'general';

/**
 * The two profiling filters a caller may narrow a Themenseiten listing with.
 * `educationalContext` is a RESOLVED vocabulary URI, never a label — the
 * label→URI mapping happens in the tool layer.
 */
export interface VariantFilters {
  targetGroup?: TargetGroup;
  educationalContext?: string;
}

/**
 * Does this page variant survive the caller's filters?
 *
 * **A variant that carries no value is never excluded.** Measured 2026-08-07
 * against both instances: 98 of 109 non-template variants on production have no
 * `ccm:page_variant_profiling_target_group` and 97 have no
 * `ccm:educationalcontext` (staging: 49 and 45 of 68). Treating "unset" as a
 * mismatch — which is what handing these fields to the search does, since the
 * ES query can only match a present value — hides nine Themenseiten out of ten.
 * See `docs/plans/2026-08-07-topic-page-variants-analysis.md` §1.
 *
 * This is the ONE place the rule lives, so the listing modes cannot drift apart
 * again: Mode C used to filter upstream while Modes A/B filtered here, and the
 * same `targetGroup` therefore produced two different result sets.
 */
export function variantMatchesFilters(
  props: Record<string, string[] | undefined>,
  filters: VariantFilters,
): boolean {
  const tg = props['ccm:page_variant_profiling_target_group']?.[0];
  if (filters.targetGroup && tg && tg !== filters.targetGroup) return false;
  const contexts = props['ccm:educationalcontext'] ?? [];
  if (filters.educationalContext && contexts.length && !contexts.includes(filters.educationalContext)) return false;
  return true;
}

export interface ThemePageInfo {
  variantId: string;
  variantName: string;
  /**
   * Human-readable label of the page-variant node itself, from `cclom:title`
   * — e.g. "Fachportalstartseite", "Vorlage: Themenseite". Distinct from
   * `variantName`, which holds the auto-generated technical `cm:name`
   * ("PAGE_VARIANT_<uuid>"). Used as a display fallback when the owning
   * collection can't be resolved, so the UI never shows the raw
   * PAGE_VARIANT/UUID string.
   *
   * `cm:title` is deliberately NOT a fallback: it carries that same technical
   * string on 109 of 109 production variants (measured 2026-08-07), so falling
   * back to it replaces "no label" with a UUID that only looks like one.
   */
  variantTitle?: string;
  targetGroup: string;
  educationalContexts: string[];
  /**
   * How the page comes up before anyone touches its profile selector — read
   * from the `variables` block of `ccm:page_variant_config`, absent when the
   * variant declares none (37 of 69 staging variants).
   *
   * A SEPARATE fact from `targetGroup`/`educationalContexts`, never a fallback
   * for them: measured 2026-08-11, the two sources are near-disjoint and where
   * both exist they disagree (3 of 3). See `VariantPreset`.
   */
  variantPreset?: VariantPreset;
  topicPageUrl: string;
  collectionId?: string;
  collectionName?: string;
  /**
   * True for the variant the page actually renders: `ccm:page_config.default`
   * of its page-config folder, or the first still-existing entry of that
   * document's `variants[]` when no default is recorded (`readPageConfigOrder`).
   *
   * A collection can own SEVERAL page-config folders while its own
   * `ccm:page_config_ref` names the active one, so this additionally requires
   * the variant to sit in THAT folder. Variants of a superseded folder are still
   * listed — dropping them would lose the pages whose only folder is superseded
   * — they are simply never the rendered one.
   */
  isDefault?: boolean;
}

/** Everything a `ThemePageInfo` reads off the variant node itself. */
export type VariantFields = Pick<
  ThemePageInfo,
  'variantId' | 'variantName' | 'variantTitle' | 'targetGroup' | 'educationalContexts' | 'variantPreset'
>;

/**
 * Project a page-variant node onto the fields that come from the node itself.
 *
 * The ONE place that projection lives — the sibling rule to
 * `variantMatchesFilters`, and for the same reason. Two independent routes
 * reach a variant (collection → page_config_ref → children, and the
 * page_variant index → walk back up), each surrounds it with different
 * page-level facts, and each used to re-read these seven properties by hand.
 *
 * The copies drifted on `variantTitle`, which is the only one of the seven that
 * needs a RULE rather than a read: `cclom:title` carries the technical
 * `PAGE_VARIANT_<uuid>` string on 22 of 68 staging variants, and the type
 * documents this field as the value that keeps that string off a screen. The
 * index route returned it raw. Adding `variantPreset` is what exposed the
 * duplication — the field had to be written into both projections by hand.
 *
 * What is deliberately NOT here: `topicPageUrl`, `collectionId`,
 * `collectionName` and `isDefault`. Those are facts about the PAGE, not the
 * variant, and the two routes learn them from genuinely different places.
 */
export function variantFields(node: WloNode): VariantFields {
  const p = node.properties ?? {};
  const preset = parseVariantPreset(p['ccm:page_variant_config']?.[0]);
  return {
    variantId: node.ref?.id ?? '',
    variantName: p['cm:name']?.[0] || node.name || '',
    // Checked, not trusted. Empty rather than a substitute, so
    // `pickThemePageTitle` falls through to the owning collection's name.
    variantTitle: displayTitleOrEmpty(p['cclom:title']?.[0]),
    // Empty, not a German placeholder: this is the machine field. The "nicht
    // gesetzt" wording belongs to `targetGroupLabel`, which the presentation
    // layer derives — emitting it here made an unset value look set to any
    // consumer comparing against ''.
    targetGroup: p['ccm:page_variant_profiling_target_group']?.[0] || '',
    educationalContexts: p['ccm:educationalcontext'] ?? [],
    // Free: `ccm:page_variant_config` is already in the projection, because the
    // swimlane structure is read from the same document.
    ...(preset ? { variantPreset: preset } : {}),
  };
}
// No `isTemplate` here, and it is not an oversight: the field existed on
// `ThemePageInfo` until 2026-08-11, was written as a hardcoded `false` by both
// projections, and was never read by anyone. A value this function invents
// contradicts what it claims to do — read the node — and `false` would have been
// a lie for a template node. Templates are excluded upstream instead:
// `searchPageVariants` sends `ccm:page_variant_is_template: false`, and the
// collection route filters with `isUsableVariant`. If a caller ever needs to
// TELL templates apart, read the property here rather than reinstating a
// constant.

/** A real, selectable page variant: configured, and not a template. */
export function isUsableVariant(node: WloNode): boolean {
  const p = node.properties ?? {};
  return !!p['ccm:page_variant_config']?.[0] && p['ccm:page_variant_is_template']?.[0] !== 'true';
}

/**
 * Pick the best human-readable title for a Themenseite, in priority order:
 *   1. owning collection name (`cclom:title`/`cm:name` of the collection),
 *   2. the variant node's own title,
 *   3. the variant's `cm:name` — only if it is NOT a placeholder.
 * Falls back to a generic "Themenseite" so a raw UUID is never displayed.
 */
export function pickThemePageTitle(r: ThemePageInfo): string {
  const candidates = [r.collectionName, r.variantTitle, r.variantName];
  for (const c of candidates) {
    const t = (c ?? '').trim();
    if (t && !isPlaceholderTitle(t)) return t;
  }
  return 'Themenseite';
}
