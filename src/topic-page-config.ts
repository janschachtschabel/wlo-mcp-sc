/**
 * topic-page-config.ts – the `ccm:page_config` document: which variant a
 * Themenseite actually renders, and in which order its variants stand. Both
 * directions live here — reading it (`parsePageConfigOrder`) and editing it
 * (`setDefaultVariant`) follow the same schema and must not drift apart.
 *
 * Split out of `topic-page-api.ts` (2026-08-07), which had accumulated a third
 * responsibility beside "find Themenseiten" and "walk a variant to its owner".
 * This one follows the PAGE BUILDER's document schema — the same reason
 * `topic-page-structure.ts` is its own module — while discovery follows
 * edu-sharing's search and containment endpoints. They change independently.
 */

import type { WloNode } from './wlo-api.js';
import { getNodeMetadata, stripStoreRef, toStoreRef } from './wlo-api.js';

/** The active variant plus the authoritative variant order of ONE topic page. */
export interface PageConfigOrder {
  /** Variant ids in the order the page builder keeps them (bare UUIDs). */
  order: string[];
  /** The variant marked as default, or '' when the page records none. */
  defaultId: string;
}

/** No opinion — the caller keeps whatever order the repository returned. */
const NO_ORDER: PageConfigOrder = { order: [], defaultId: '' };

/**
 * Read `ccm:page_config` off a page-config FOLDER — the document that says
 * which variant a Themenseite actually renders.
 *
 * Measured 2026-08-07: present on 99/99 production and 45/45 staging pages;
 * `default` is set on 76/99 production pages and, where set, is always
 * `variants[0]` (76/76, zero counter-examples, zero values outside the list).
 * `variants[]` always covers every real child, but can also name variants that
 * no longer exist (3 dangling refs on staging) — which is why the order is
 * applied to the nodes that came back, never used to fetch.
 */
export async function readPageConfigOrder(configId: string): Promise<PageConfigOrder> {
  const node = await getNodeMetadata(configId, ['ccm:page_config']);
  return parsePageConfigOrder(node?.properties?.['ccm:page_config']?.[0]);
}

/**
 * Parse a raw `ccm:page_config` value. Separate from the read because the folder
 * is often fetched for its parent anyway (`resolvePageFolder`), and fetching the
 * same node twice for two of its properties is a wasted request.
 *
 * A missing or unparseable document yields no opinion — a page whose config JSON
 * is broken still has variants, and keeping the repository's own child order
 * beats dropping the whole Themenseite.
 */
export function parsePageConfigOrder(raw: string | undefined): PageConfigOrder {
  if (!raw) return NO_ORDER;
  try {
    const parsed = JSON.parse(raw);
    const order: string[] = Array.isArray(parsed?.variants)
      ? parsed.variants.filter((v: unknown): v is string => typeof v === 'string').map(stripStoreRef)
      : [];
    const defaultId = typeof parsed?.default === 'string' ? stripStoreRef(parsed.default) : '';
    return { order, defaultId };
  } catch {
    return NO_ORDER;
  }
}

/**
 * Set which variant the page renders — an EDIT of the stored document, not a
 * document we compose.
 *
 * Reading and writing this property are deliberately asymmetric.
 * `parsePageConfigOrder` is lossy on purpose: it strips store refs and keeps only
 * the two keys the readers need. Round-tripping a write through it would drop
 * every other key and rewrite the variant list in a form no existing document
 * uses. So this works on the RAW string, changes exactly `default`, and carries
 * everything else — including keys this project has never seen — through
 * untouched.
 *
 * It throws rather than repairing, and that is the point. Measured on staging
 * 2026-08-09: `POST …/property?property=ccm:page_config` answers 200 for the
 * literal string `"not json at all"` and stores it verbatim, and accepts the
 * property on a `ccm:io` that is no page-config folder at all. Nothing upstream
 * validates this document; a malformed one surfaces in the page builder, on a
 * public page. Every guarantee therefore has to be made here — including the one
 * the repository would never make: a `default` outside `variants[]` renders
 * nothing, so it is refused.
 *
 * @param raw       the folder's current `ccm:page_config` value
 * @param variantId the variant to render, bare id or store ref
 * @returns the new document, ready to write
 * @throws if the document is missing, unparseable, has no variant list, or does
 *         not list `variantId`
 */
export function setDefaultVariant(raw: string | undefined, variantId: string): string {
  if (!raw?.trim()) {
    throw new Error('Diese Themenseite hat kein ccm:page_config-Dokument — es wird keins angelegt.');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('Das ccm:page_config-Dokument ist kein gültiges JSON und wird nicht überschrieben.');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Das ccm:page_config-Dokument ist kein Objekt und wird nicht überschrieben.');
  }

  const doc = parsed as Record<string, unknown>;
  const variants = Array.isArray(doc.variants)
    ? doc.variants.filter((v): v is string => typeof v === 'string')
    : [];
  if (!variants.length) {
    throw new Error('Das ccm:page_config-Dokument enthält keine variants-Liste.');
  }

  const wanted = stripStoreRef(variantId);
  if (!variants.some(v => stripStoreRef(v) === wanted)) {
    throw new Error(`Die Variante ${wanted} steht nicht in variants[] dieser Themenseite.`);
  }

  // Spread keeps an existing `default` in its original position and replaces only
  // its value; a document without one gains the key at the end.
  return JSON.stringify({ ...doc, default: toStoreRef(wanted) });
}

/**
 * Reorder a folder's variant nodes so the active one comes first: the recorded
 * `default`, then the config's own order, then anything the config never listed
 * (in the order the repository returned it). Pure — the caller supplies both.
 */
export function orderVariants(variants: WloNode[], cfg: PageConfigOrder): WloNode[] {
  const remaining = new Map(variants.map(v => [v.ref?.id ?? '', v]));
  const out: WloNode[] = [];
  const take = (id: string): void => {
    const node = remaining.get(id);
    if (!node) return;          // dangling config entry — no such node (any more)
    remaining.delete(id);
    out.push(node);
  };
  if (cfg.defaultId) take(cfg.defaultId);
  for (const id of cfg.order) take(id);
  out.push(...remaining.values());
  return out;
}
