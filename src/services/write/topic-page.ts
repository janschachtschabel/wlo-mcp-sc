/**
 * services/write/topic-page.ts – which variant a Themenseite renders.
 *
 * The one write in this project whose effect is not a metadata field but a
 * PUBLIC PAGE: `ccm:page_config` is the page builder's own document, and its
 * `default` decides what a visitor sees.
 *
 * Measured on staging 2026-08-09 (P3 gate,
 * docs/plans/2026-08-09-usecase-gap-tools.md) and the reason this module is
 * cautious in ways the endpoint is not:
 *
 *   - `POST …/property?property=ccm:page_config` answered 200 for the literal
 *     string `"not json at all"` and stored it verbatim.
 *   - It accepted the property on a `ccm:io`, which is never a page-config
 *     folder.
 *   - 28/28 real documents store their variants as full store refs
 *     (`workspace://SpacesStore/…`), and only 2/28 carry a `default` at all.
 *
 * Nothing upstream validates this document. A malformed one does not fail here;
 * it fails later, in the builder, on a page the public is reading. So every
 * check happens before the write, the stored document is EDITED rather than
 * composed (`setDefaultVariant`), and the result is read back and re-parsed
 * before anything is reported.
 *
 * Not solved here, because it cannot be: between the read that plans the write
 * and the write itself there is a window, and the property route offers no ETag
 * to close it. A variant an editor adds in that moment is lost. The window is
 * small and the alternative — refusing every write that cannot prove exclusivity
 * — would refuse most of them.
 */

import { getChildCollectionsResult, getNodeMetadata, stripStoreRef } from '../../wlo-node.js';
import { TOPIC_PAGE_PROPS, isUsableVariant } from '../../topic-page-api.js';
import { parsePageConfigOrder, setDefaultVariant } from '../../topic-page-config.js';
import { sanitizeText } from '../../text-sanitize.js';
import { log } from '../../logger.js';
import { setProperty } from './nodes.js';
import type { MutationOutcome } from './verify.js';
import { isPlaceholderTitle } from '../../topic-page-title.js';

const PROPERTY = 'ccm:page_config';

/** Only the collection fields needed to find and name the page. */
const OWNER_PROPS: string[] = ['ccm:page_config_ref', 'cclom:title', 'cm:name'];

/**
 * How many variants of one page-config folder are read. Real pages have 1-3
 * (93 of 99 production pages carry exactly one), so this is headroom rather
 * than a limit anyone should meet.
 *
 * Known limit if one ever did: `getChildCollectionsResult` returns nodes and
 * reachability, not the total, so a truncated listing is indistinguishable here
 * from a complete one — a variant beyond the cap would be refused as "not part
 * of this page", which is the wrong reason and invites the wrong correction.
 * Closing that needs the child listing to report its total.
 */
const VARIANT_PAGE = 50;

/** A fully checked, ready-to-write change of the rendered variant. */
export interface TopicPagePlan {
  collectionId: string;
  /** The page-config folder the document lives on — never the collection. */
  folderId: string;
  /** Sanitized: it comes from the repository and travels into the preview. */
  pageTitle: string;
  /** Title of the variant that renders today. */
  currentTitle: string;
  /** True when the page records no `default` and renders `variants[0]` by position. */
  currentIsByPosition: boolean;
  variantId: string;
  variantTitle: string;
  /** The edited document, exactly as it will be sent. */
  document: string;
}

export type PlanResult =
  | { ok: true; plan: TopicPagePlan }
  | { ok: false; reason: string };

/**
 * Work out what would change, refusing anything the repository would accept but
 * the page builder could not use.
 *
 * Reads three things: the collection (to find its ACTIVE page-config folder —
 * a collection may own several, and only the one named by `ccm:page_config_ref`
 * holds the rendering variant), the folder's document, and the folder's children
 * (to prove the variant is really one of this page's).
 */
export async function planRenderedVariant(
  collectionId: string,
  variantId: string,
): Promise<PlanResult> {
  const collection = await getNodeMetadata(collectionId, OWNER_PROPS);
  if (!collection) {
    return { ok: false, reason: `Die Sammlung „${sanitizeText(collectionId)}“ wurde nicht gefunden oder ist nicht lesbar.` };
  }
  const props = collection.properties ?? {};
  const ref = props['ccm:page_config_ref']?.[0];
  if (!ref) {
    return {
      ok: false,
      reason: `Die Sammlung „${sanitizeText(collectionId)}“ ist keine Themenseite — sie hat kein ` +
        'ccm:page_config_ref und damit keine Varianten, zwischen denen gewählt werden könnte.',
    };
  }
  const folderId = stripStoreRef(ref);
  const pageTitle = sanitizeText(props['cclom:title']?.[0] ?? props['cm:name']?.[0] ?? collectionId);

  // The listing must be READ, not merely empty: a 503 turned into "this variant
  // is not part of the page" would refuse a correct call with a wrong reason —
  // and, worse, invite the caller to pick a different variant.
  const listing = await getChildCollectionsResult(folderId, VARIANT_PAGE, 0, TOPIC_PAGE_PROPS);
  if (!listing.reachable) {
    return {
      ok: false,
      reason: `Die Varianten der Themenseite „${pageTitle}“ konnten nicht gelesen werden. Ob „` +
        `${sanitizeText(variantId)}“ dazugehört, ist damit offen — es wurde nichts geändert.`,
    };
  }
  const variants = listing.nodes.filter(isUsableVariant);
  const wanted = stripStoreRef(variantId);
  const target = variants.find(v => v.ref?.id === wanted);
  if (!target) {
    // The id is sanitized like the title: this sentence is NOT flattened on its
    // way out (unlike the change-set action, which `renderChangeSet` flattens),
    // so a newline in a repository value would open what reads as a line of ours.
    const known = variants.map(v => `${titleOf(v)} (${sanitizeText(v.ref?.id ?? '?')})`).join(', ');
    return {
      ok: false,
      reason: `Die Variante „${sanitizeText(variantId)}“ gehört nicht zur Themenseite „${pageTitle}“. ` +
        (known ? `Verfügbar: ${known}.` : 'Diese Themenseite hat keine nutzbare Variante.'),
    };
  }

  const folder = await getNodeMetadata(folderId, [PROPERTY]);
  if (!folder) {
    return { ok: false, reason: `Die Seitenkonfiguration von „${pageTitle}“ war nicht lesbar — es wurde nichts geändert.` };
  }
  const raw = folder.properties?.[PROPERTY]?.[0];
  const current = parsePageConfigOrder(raw);

  // Nothing to do — and saying so beats writing an identical document to the one
  // property that steers a public page. The other curation tools get this for
  // free: `buildChangeSet` drops unchanged FIELDS, and this change has none.
  //
  // Only an explicitly recorded default counts. With none, the page renders
  // `variants[0]` by position, and writing that same variant down turns "whoever
  // happens to be first" into a decision — a real change, and the one call that
  // makes a page's rendering stable.
  if (current.defaultId && current.defaultId === wanted) {
    return {
      ok: false,
      reason: `Die Themenseite „${pageTitle}“ rendert „${nameOf(target, wanted)}“ bereits — es gibt nichts zu ändern.`,
    };
  }

  let document: string;
  try {
    document = setDefaultVariant(raw, wanted);
  } catch (err) {
    // The transform refuses rather than repairs — an editorial document we
    // cannot read is one we must not overwrite.
    return { ok: false, reason: err instanceof Error ? err.message : String(err) };
  }

  const currentId = current.defaultId || current.order[0] || '';
  return {
    ok: true,
    plan: {
      collectionId,
      folderId,
      pageTitle,
      currentTitle: nameOf(variants.find(v => v.ref?.id === currentId), currentId),
      currentIsByPosition: current.defaultId === '',
      variantId: wanted,
      variantTitle: nameOf(target, wanted),
      document,
    },
  };
}

/**
 * Write the planned document and report what the folder shows afterwards.
 *
 * The read-back compares the PARSED document, not the string: the repository
 * stores whatever it is handed, so "the bytes came back" would prove only that
 * it echoed us — while a page that renders the wrong variant is exactly the
 * failure this check exists for.
 */
export async function writeRenderedVariant(plan: TopicPagePlan): Promise<MutationOutcome> {
  const failure = await setProperty(plan.folderId, PROPERTY, [plan.document]);
  if (failure) return { status: 'failed', detail: failure };
  log.info('topic page variant set', { collectionId: plan.collectionId, folderId: plan.folderId });

  const folder = await getNodeMetadata(plan.folderId, [PROPERTY]);
  if (!folder) {
    return {
      status: 'unverified',
      detail: `Die Seitenkonfiguration von „${plan.pageTitle}“ war zur Kontrolle nicht lesbar.`,
    };
  }
  const after = parsePageConfigOrder(folder.properties?.[PROPERTY]?.[0]);
  if (after.defaultId !== plan.variantId) {
    return {
      status: 'not_visible',
      detail: `Die Themenseite „${plan.pageTitle}“ rendert weiterhin nicht „${plan.variantTitle}“.`,
    };
  }
  return { status: 'ok' };
}

/**
 * A variant's display title, sanitized — it is repository text bound for the
 * preview.
 *
 * Placeholders are skipped rather than shown: a variant nobody renamed carries
 * `PAGE_VARIANT_<uuid>` in `cm:name` AND `cclom:title` (22 of 68 on staging), and
 * naming the target by a technical id gives the person confirming nothing to
 * check — while the token binds to that very sentence. Empty here, so the caller
 * falls back to the id, which at least identifies the variant unambiguously.
 */
function titleOf(node: { name?: string; properties?: Record<string, string[]> } | undefined): string {
  if (!node) return '';
  const candidates = [node.properties?.['cclom:title']?.[0], node.properties?.['cm:name']?.[0], node.name];
  const raw = candidates.find(c => !isPlaceholderTitle(c)) ?? '';
  return raw ? sanitizeText(raw) : '';
}

/**
 * How a variant is NAMED in a sentence a person has to check — a real title, or
 * the id when there is none. Every such sentence goes through here, so an
 * unnamed variant cannot appear as a pair of empty quotes in one of them and as
 * an id in the next.
 */
function nameOf(
  node: { name?: string; properties?: Record<string, string[]> } | undefined,
  id: string,
): string {
  return titleOf(node) || sanitizeText(id);
}
