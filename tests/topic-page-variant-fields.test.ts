/**
 * topic-page-variant-fields.test.ts – the same variant node, read through two
 * different search modes, must describe itself the same way.
 *
 * `search_wlo_topic_pages` reaches a page variant on two independent routes:
 * Mode A/B walk a collection's `ccm:page_config_ref` down to the config
 * folder's children, while Mode C/D search the page_variant index and walk back
 * up. Both then project the SAME repository properties onto a `ThemePageInfo`,
 * and until 2026-08-11 each carried its own copy of that projection.
 *
 * The copies drifted, in the way copies always drift here — on the field that
 * needs a rule rather than a read. `variantTitle` is documented on the type as
 * the value that guarantees "the UI never shows the raw PAGE_VARIANT/UUID
 * string", and 22 of 68 staging variants carry exactly that string in
 * `cclom:title`. Mode A ran it through `displayTitleOrEmpty`; Mode C/D did not.
 * It stayed invisible because `pickThemePageTitle` checks again downstream — so
 * the broken promise sat one consumer away from being a visible bug, which is
 * the definition of latent, not of harmless.
 *
 * Adding `variantPreset` is what surfaced it: the field had to be written into
 * both projections by hand, and the second one was found by a failing test
 * rather than by reading the code.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { installFetchMock, makeNode } from './fetchMock.js';
import { collectThemePages } from '../src/services/topic-page-discovery.js';
import type { ThemePageInfo } from '../src/topic-page-variant.js';

const REF = (id: string) => `workspace://SpacesStore/${id}`;
const EC = 'http://w3id.org/openeduhub/vocabs/educationalContext';

/** A variant nobody ever renamed: the technical id sits in `cclom:title` too. */
const PLACEHOLDER = 'PAGE_VARIANT_2fd0a1c4-8b13-4c8a-9f21-6e5d0c7a9b44';

const VARIANT_CONFIG = JSON.stringify({
  structure: { swimlanes: [] },
  variables: {
    'virtual:profiling_widget_intention': 'teach',
    'virtual:profiling_widget_education_level': `${EC}/sekundarstufe_1`,
  },
});

function variant() {
  return makeNode('var-1', PLACEHOLDER, {
    'cm:name': [PLACEHOLDER],
    'ccm:page_variant_config': [VARIANT_CONFIG],
    'ccm:page_variant_profiling_target_group': ['teacher'],
    'ccm:educationalcontext': [`${EC}/grundschule`],
    'virtual:primaryparent_nodeid': [REF('cfg-1')],
  });
}

/** Serves BOTH routes to the one variant, so the modes can be compared. */
function installBothRoutes() {
  return installFetchMock((url) => {
    // Mode C/D: the page_variant index.
    if (url.includes('/queries/-home-/mds_oeh/page_variant')) {
      return { json: { nodes: [variant()] } };
    }
    // Mode A: collection → page_config_ref → the folder's children.
    if (url.includes('/nodes/-home-/cfg-1/children')) {
      return { json: { nodes: [variant()] } };
    }
    if (url.includes('/nodes/-home-/cfg-1/metadata')) {
      return { json: { node: makeNode('cfg-1', 'Config', {
        'virtual:primaryparent_nodeid': [REF('coll-1')],
      }) } };
    }
    if (url.includes('/nodes/-home-/coll-1/metadata')) {
      return { json: { node: makeNode('coll-1', 'Optik', {
        'ccm:page_config_ref': [REF('cfg-1')],
      }) } };
    }
    return { json: {} };
  });
}

/** The fields that come from the variant node itself, on either route. */
function variantFieldsOf(p: ThemePageInfo) {
  const { variantId, variantName, variantTitle, targetGroup, educationalContexts, variantPreset } = p;
  return { variantId, variantName, variantTitle, targetGroup, educationalContexts, variantPreset };
}

test('both search routes describe the same variant identically', async () => {
  const mock = installBothRoutes();
  try {
    const viaCollection = await collectThemePages({ collectionId: 'coll-1' }, {});
    const viaIndex = await collectThemePages({ withinCollectionId: 'portal', maxResults: 5 }, {});

    assert.equal(viaCollection.results.length, 1, 'Mode A found the variant');
    assert.equal(viaIndex.results.length, 1, 'Mode D found the variant');
    assert.deepEqual(
      variantFieldsOf(viaIndex.results[0]),
      variantFieldsOf(viaCollection.results[0]),
      'a variant must not describe itself differently depending on how it was found',
    );
  } finally {
    mock.restore();
  }
});

test('neither route passes a technical id off as a title', async () => {
  // Stated on its own so a future regression names the reason rather than just
  // "the two disagree" — `displayTitleOrEmpty` is the rule, and an empty string
  // is the deliberate answer: every consumer has a better fallback than we do.
  const mock = installBothRoutes();
  try {
    for (const params of [{ collectionId: 'coll-1' }, { withinCollectionId: 'portal', maxResults: 5 }]) {
      const { results } = await collectThemePages(params, {});
      assert.equal(results[0]?.variantTitle, '', `${JSON.stringify(params)} leaked ${results[0]?.variantTitle}`);
    }
  } finally {
    mock.restore();
  }
});
