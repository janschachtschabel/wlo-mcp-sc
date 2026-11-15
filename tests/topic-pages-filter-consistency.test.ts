import { test } from 'node:test';
import assert from 'node:assert/strict';

import { connectedClient, installFetchMock, makeNode } from './fetchMock.js';

/**
 * `targetGroup` and `educationalContext` must mean the SAME thing in every mode
 * of search_wlo_topic_pages: a variant that carries no value is NOT excluded.
 *
 * Measured 2026-08-07 (docs/plans/2026-08-07-topic-page-variants-analysis.md):
 * 98 of 109 non-template variants on production carry no target group and 97
 * carry no educational context. Sending either filter upstream therefore does
 * not narrow the result, it hides nine pages out of ten — Mode C used to do
 * exactly that while Modes A/B kept the unset ones, so one parameter produced
 * two different result sets depending on which mode the caller triggered.
 */

/** A page-variant hit; `tg`/`ctx` omitted → the property is absent entirely. */
function variant(i: number, cfg: string, tg?: string, ctx?: string[]) {
  return makeNode(`var-${i}`, `PAGE_VARIANT_${i}`, {
    'cm:name': [`PAGE_VARIANT_${i}`],
    ...(tg ? { 'ccm:page_variant_profiling_target_group': [tg] } : {}),
    ...(ctx ? { 'ccm:educationalcontext': ctx } : {}),
    'virtual:primaryparent_nodeid': [`workspace://SpacesStore/${cfg}`],
  });
}

/** cfg-N → coll-N, each collection owning its own page config. */
function ownerHop(url: string): { json: unknown } | null {
  const cfg = /nodes\/-home-\/cfg-(\d+)\/metadata/.exec(url);
  if (cfg) {
    return { json: { node: makeNode(`cfg-${cfg[1]}`, 'Config', {
      'virtual:primaryparent_nodeid': [`workspace://SpacesStore/coll-${cfg[1]}`],
    }) } };
  }
  const coll = /nodes\/-home-\/coll-(\d+)\/metadata/.exec(url);
  if (coll) {
    return { json: { node: makeNode(`coll-${coll[1]}`, `Sammlung ${coll[1]}`, {
      'cclom:title': [`Sammlung ${coll[1]}`],
      'ccm:page_config_ref': [`workspace://SpacesStore/cfg-${coll[1]}`],
    }) } };
  }
  return null;
}

function installModeC(nodes: ReturnType<typeof variant>[]) {
  return installFetchMock((url) => {
    if (url.includes('/queries/-home-/mds_oeh/page_variant')) return { json: { nodes } };
    return ownerHop(url) ?? { json: {} };
  });
}

async function search(args: Record<string, unknown>): Promise<{
  total: number;
  results: Array<{ title: string; variants: Array<{ targetGroup: string; targetGroupLabel: string }> }>;
}> {
  const client = await connectedClient();
  try {
    const r = await client.callTool({
      name: 'search_wlo_topic_pages',
      arguments: { outputFormat: 'json', ...args },
    });
    return JSON.parse((r as { content: Array<{ text: string }> }).content[0]?.text ?? '{}');
  } finally {
    await client.close();
  }
}

/** The criteria body of the (single) page_variant search. */
function searchCriteria(calls: Array<{ url: string; init?: RequestInit }>): Array<{ property: string; values: string[] }> {
  const call = calls.find(c => c.url.includes('/queries/-home-/mds_oeh/page_variant'));
  assert.ok(call, 'expected a page_variant search');
  return JSON.parse(String(call.init?.body ?? '{}')).criteria ?? [];
}

test('Mode C: a targetGroup filter keeps variants that carry no target group', async () => {
  const mock = installModeC([
    variant(0, 'cfg-0', 'teacher'),
    variant(1, 'cfg-1'),               // unset — the 90 % case on production
    variant(2, 'cfg-2', 'learner'),    // set and different → excluded
  ]);
  try {
    const parsed = await search({ targetGroup: 'teacher', maxResults: 10 });
    assert.deepEqual(parsed.results.map(r => r.title), ['Sammlung 0', 'Sammlung 1']);
  } finally {
    mock.restore();
  }
});

test('Mode C: the target group is never sent upstream', async () => {
  const mock = installModeC([variant(0, 'cfg-0', 'teacher')]);
  try {
    await search({ targetGroup: 'teacher', maxResults: 5 });
    const props = searchCriteria(mock.calls).map(c => c.property);
    assert.ok(!props.includes('ccm:page_variant_profiling_target_group'),
      'filtering upstream drops every variant with an unset value');
    assert.deepEqual(props, ['ccm:page_variant_is_template']);
  } finally {
    mock.restore();
  }
});

test('Mode C: an educationalContext filter keeps variants that carry none', async () => {
  const ctx = 'http://w3id.org/openeduhub/vocabs/educationalContext/grundschule';
  const mock = installModeC([
    variant(0, 'cfg-0', undefined, [ctx]),
    variant(1, 'cfg-1'),                                          // unset → kept
    variant(2, 'cfg-2', undefined, ['http://w3id.org/openeduhub/vocabs/educationalContext/hochschule']),
  ]);
  try {
    const parsed = await search({ educationalContext: 'Grundschule', maxResults: 10 });
    assert.deepEqual(parsed.results.map(r => r.title), ['Sammlung 0', 'Sammlung 1']);
  } finally {
    mock.restore();
  }
});

test('Mode C: the educational context is never sent upstream', async () => {
  const mock = installModeC([variant(0, 'cfg-0')]);
  try {
    await search({ educationalContext: 'Grundschule', maxResults: 5 });
    const props = searchCriteria(mock.calls).map(c => c.property);
    assert.ok(!props.includes('ccm:educationalcontext'));
  } finally {
    mock.restore();
  }
});

test('Mode A: the same filter rule applies when checking one collection', async () => {
  const ctx = 'http://w3id.org/openeduhub/vocabs/educationalContext/grundschule';
  const mock = installFetchMock((url) => {
    if (url.includes('/nodes/-home-/coll-a/metadata')) {
      return { json: { node: makeNode('coll-a', 'Optik', {
        'cclom:title': ['Optik'],
        'ccm:page_config_ref': ['workspace://SpacesStore/cfg-a'],
      }) } };
    }
    if (url.includes('/nodes/-home-/cfg-a/children')) {
      return { json: { nodes: [
        makeNode('v-keep', 'Variante ohne Stufe', {
          'ccm:page_variant_config': ['{"structure":{"swimlanes":[]}}'],
          'cclom:title': ['Variante ohne Stufe'],
        }),
        makeNode('v-drop', 'Variante Hochschule', {
          'ccm:page_variant_config': ['{"structure":{"swimlanes":[]}}'],
          'cclom:title': ['Variante Hochschule'],
          'ccm:educationalcontext': ['http://w3id.org/openeduhub/vocabs/educationalContext/hochschule'],
        }),
        makeNode('v-match', 'Variante Grundschule', {
          'ccm:page_variant_config': ['{"structure":{"swimlanes":[]}}'],
          'cclom:title': ['Variante Grundschule'],
          'ccm:educationalcontext': [ctx],
        }),
      ] } };
    }
    return { json: {} };
  });
  try {
    const parsed = await search({
      collectionId: 'coll-a', educationalContext: 'Grundschule',
      mergeVariants: false, maxResults: 10,
    });
    assert.equal(parsed.total, 2, 'the unset variant and the matching one survive; the mismatch does not');
  } finally {
    mock.restore();
  }
});

test('an unset target group is reported as the SAME value in every mode', async () => {
  // `targetGroup` is a machine field; the German placeholder belongs in
  // `targetGroupLabel`, which the presentation layer derives. Mode A used to
  // emit "nicht gesetzt" here while Mode C emitted "", so a consumer testing
  // for the empty string saw one of them as a set value.
  const modeC = installModeC([variant(0, 'cfg-0')]);
  let fromModeC: string;
  try {
    fromModeC = (await search({ maxResults: 5 })).results[0].variants[0].targetGroup;
  } finally {
    modeC.restore();
  }

  const modeA = installFetchMock((url) => {
    if (url.includes('/nodes/-home-/coll-a/metadata')) {
      return { json: { node: makeNode('coll-a', 'Optik', {
        'cclom:title': ['Optik'],
        'ccm:page_config_ref': ['workspace://SpacesStore/cfg-a'],
      }) } };
    }
    if (url.includes('/nodes/-home-/cfg-a/children')) {
      return { json: { nodes: [makeNode('v-1', 'Variante', {
        'cclom:title': ['Variante'],
        'ccm:page_variant_config': ['{"structure":{"swimlanes":[]}}'],
      })] } };
    }
    return { json: {} };
  });
  try {
    const fromModeA = (await search({ collectionId: 'coll-a' })).results[0].variants[0].targetGroup;
    assert.equal(fromModeA, '');
    assert.equal(fromModeA, fromModeC);
  } finally {
    modeA.restore();
  }
});

test('the German placeholder still reaches the label, not the machine field', async () => {
  const mock = installModeC([variant(0, 'cfg-0')]);
  try {
    const v = (await search({ maxResults: 5 })).results[0].variants[0];
    assert.equal(v.targetGroup, '');
    assert.equal(v.targetGroupLabel, 'nicht gesetzt');
  } finally {
    mock.restore();
  }
});

/**
 * An `educationalContext` the vocabulary cannot resolve used to be passed on as
 * RAW TEXT and compared against URIs. It never matched, so every variant that
 * declares a context was dropped and only the context-less ones survived — and
 * nothing said so. The five other search tools drop an unresolved filter and
 * report it with `formatUnresolvedHint`; this one did neither, which is the
 * worse half: silently narrowing is not the same as ignoring.
 */
test('an unresolvable educationalContext is ignored, not applied as raw text', async () => {
  const ctx = 'http://w3id.org/openeduhub/vocabs/educationalContext/grundschule';
  const mock = installModeC([
    variant(0, 'cfg-0', undefined, [ctx]),  // declares a context
    variant(1, 'cfg-1'),                    // declares none
  ]);
  try {
    const parsed = await search({ educationalContext: 'Quatschstufe', maxResults: 10 });
    assert.deepEqual(parsed.results.map(r => r.title), ['Sammlung 0', 'Sammlung 1'],
      'a typo must not quietly hide every page that declares a context');
  } finally {
    mock.restore();
  }
});

test('an unresolvable educationalContext is reported to the caller', async () => {
  const mock = installModeC([variant(0, 'cfg-0')]);
  const client = await connectedClient();
  try {
    const r = await client.callTool({
      name: 'search_wlo_topic_pages',
      arguments: { educationalContext: 'Quatschstufe', maxResults: 5 },
    });
    const text = (r as { content: Array<{ type: string; text?: string }> }).content
      .filter(p => p.type === 'text').map(p => p.text ?? '').join('\n');
    assert.match(text, /Quatschstufe/, 'names the value that did not resolve');
    assert.match(text, /nicht erkannt/, 'and says it was not applied');
  } finally {
    await client.close();
    mock.restore();
  }
});

/**
 * `_queryMeta.criteria` is the machine-readable statement of what was actually
 * searched — the comment above `buildTopicPagesMeta` says so, and lists an
 * unreached `ngsearchword` as the reason. A dropped `educationalContext` broke
 * the same rule: it appeared as an applied criterion while the search ignored
 * it, so a downstream consumer would report a narrowing that never happened.
 */
test('_queryMeta does not list an educationalContext that never applied', async () => {
  const mock = installModeC([variant(0, 'cfg-0')]);
  const client = await connectedClient();
  try {
    const r = await client.callTool({
      name: 'search_wlo_topic_pages',
      arguments: { educationalContext: 'Quatschstufe', maxResults: 5 },
    });
    const text = (r as { content: Array<{ type: string; text?: string }> }).content
      .filter(p => p.type === 'text').map(p => p.text ?? '').join('\n');
    assert.doesNotMatch(text, /"ccm:educationalcontext"/, 'not reported as a criterion');
  } finally {
    await client.close();
    mock.restore();
  }
});

test('_queryMeta still lists an educationalContext that DID apply', async () => {
  const mock = installModeC([variant(0, 'cfg-0')]);
  const client = await connectedClient();
  try {
    const r = await client.callTool({
      name: 'search_wlo_topic_pages',
      arguments: { educationalContext: 'Grundschule', maxResults: 5 },
    });
    const text = (r as { content: Array<{ type: string; text?: string }> }).content
      .filter(p => p.type === 'text').map(p => p.text ?? '').join('\n');
    assert.match(text, /"ccm:educationalcontext"/);
    assert.match(text, /educationalContext\/grundschule/, 'as the resolved URI');
  } finally {
    await client.close();
    mock.restore();
  }
});
