/**
 * registry-render.ts – a collection's skill catalogue as answer lines.
 *
 * Split out of `formatter.ts` (audit 2026-11-05, 734 lines): this is the one
 * part of the formatter that changes when the REGISTRY changes (tiers, caps,
 * the catalogue note), not when a node field does. `formatter.ts` re-exports
 * the public names, so no caller had to move.
 */

import type { FormattedNode } from './formatter.js';
import { oneLine } from './text-line.js';

/**
 * What a skill catalogue is NOT: the instructions.
 *
 * Every listing surface hands over titles and nodeIds — a name for a procedure,
 * never the procedure. The failure that costs is a model answering FROM the
 * catalogue: "Fragen generieren" reads like a step that arrived when it is the
 * label of one nobody fetched, and the answer then invents what the SKILL.md
 * would have said. So the sentence names both halves, the tool and what it needs,
 * because a pointer without the nodeId is a step a model cannot take.
 *
 * Shared rather than written per surface: three of them list a catalogue, two
 * already carried near-identical closing pointers of their own and the third had
 * none. Which surfaces may use it is a property of the TIER, not of the caller —
 * see `registrySummaryLines`, where a head-line-only listing prints no skill
 * nodeId and therefore promises no load. Pinned by
 * `tests/shared-rule-discipline.test.ts`.
 *
 * It says what the listing is NOT and never what it holds, because the two
 * surfaces hold different things: a node's catalogue carries title and nodeId
 * only (descriptions cost a read per skill and stay with `get_skill_registry`),
 * that tool's carries descriptions and keywords too. A first draft named the
 * fields — "nur Titel und Beschreibungen" — and was therefore false on the
 * surface that shows the most of them, which is the one a search answer renders.
 *
 * And it rules out the two ids standing beside the right one. Naming the tool is
 * not enough where THREE nodeIds are in view: a rendered collection carries its
 * own on the record line, the registry document's on the head line and the
 * skill's on its entry — and the one nearest the note is the registry's. Both
 * wrong picks fail usefully (`get_skill` on a registry hands back the approval
 * list, on a collection nothing), but a model that reads an approval list as an
 * instruction has been handed a document that looks like the thing it asked for.
 *
 * "einer Registry oder Sammlung", not "der": `search_skill`'s catalogue holds
 * neither, so the definite article would point at things its answer does not
 * show. The indefinite one states a rule instead, which is true on all three.
 */
export const DESCRIPTIONS_ONLY_NOTE =
  'Das ist nur die Übersicht — die Anleitungen selbst stehen nicht darin. '
  + 'Die Anleitung (SKILL.md) lädt `get_skill` mit der nodeId des gewünschten Skills, '
  + 'nicht mit der einer Registry oder Sammlung.';

/**
 * The registry a collection declares, as listing lines — one per part, so the
 * caller's `oneLine` pass covers each of them.
 *
 * Two numbers can differ here and both are stated: how many skills the registry
 * DECLARES (`truncated.referenced`, set when the service capped it) and how many
 * this listing SHOWS. A short list that silently stands for a long one reads as
 * the whole approval list, which is the one thing it must not do.
 */
export function registryLines(n: FormattedNode): string[] {
  return n.skillRegistry ? registrySummaryLines(n.skillRegistry) : [];
}

/**
 * Lines a catalogue may spend inside a RESULT.
 *
 * Replaces `REGISTRY_LINES_MAX` (100), which was not a budget at all: a registry
 * of sixty skills wrote sixty lines into EVERY collection hit. Measured against
 * the real Optik registry on 2026-08-18, that was ~3330 characters per
 * collection, of which 1008 were bare UUIDs — and those UUIDs bought exactly one
 * thing, calling `get_skill` directly, i.e. skipping the step the note three
 * lines below tells the reader not to skip.
 *
 * One number, three forms, and the degradation is MONOTONE: the bigger the
 * registry, the shorter its block gets — never longer. Twelve is where a list
 * stops being scannable and still sits under the cost of one extra round trip.
 *
 * Not shared with `REGISTRY_SEARCH_MAX`: that bounds what the SERVICE hands over
 * (and `get_skill_registry` still shows all of it), this bounds what a search
 * result prints. They answer different questions and may move apart.
 */
export const REGISTRY_INLINE_MAX = 12;

/**
 * Names, several per line, `·`-separated.
 *
 * One line each would make the context index cost as much as the list it
 * replaces. A name longer than the width gets its own line rather than being
 * split — half a context name is a name nobody can pass back.
 */
function packNames(names: string[], width = 100): string[] {
  const out: string[] = [];
  let cur = '';
  for (const name of names) {
    const next = cur ? `${cur} · ${name}` : name;
    if (cur && next.length > width) { out.push(cur); cur = name; }
    else cur = next;
  }
  if (cur) out.push(cur);
  return out;
}

/**
 * The same catalogue, for a registry `renderToText` will not render itself.
 *
 * Two kinds of caller need it, and no count is given here because one goes
 * stale: tools that are ABOUT a collection they never return (via
 * `subjectRegistryText`), and tools that render their own line-oriented format
 * instead of `renderToText`. ONE rule for what a catalogue looks like and which
 * caps it discloses; a copy per caller would drift on `truncated`, the
 * disclosure a reader cannot notice missing.
 *
 * Three forms, chosen by `REGISTRY_INLINE_MAX`:
 *
 * 1. **grouped/flat with nodeIds** — the whole thing fits.
 * 2. **context index** — too many to list, few enough to NAME. No skill nodeId
 *    is printed, so nothing here promises a load. Names, not just a count,
 *    because without a name nobody can ask for one context.
 * 3. **head line alone** — not even the names fit. Then the count and the tool
 *    are the honest answer.
 *
 * @param opts.entries `false` for the head line alone — where a tool renders one
 *   block per node and a hundred skills under each would destroy the shape it
 *   exists for. It may name the context COUNT, never the names: thirty portals
 *   with seven names each is the same wall by another route.
 */
export function registrySummaryLines(
  r: NonNullable<FormattedNode['skillRegistry']>,
  opts: { entries?: boolean; described?: boolean; narrowed?: boolean } = {},
): string[] {
  const declared = r.truncated?.referenced ?? r.entries.length;
  const contexts = r.contexts ?? [];
  const general = r.entries.filter(e => !e.context);
  const packed = contexts.length
    ? packNames(contexts.map(c => oneLine(`${c.path} (${c.skills})`)))
    : [];

  // Grouped costs one line per context, one per entry, one for the always-block.
  const groupedCost = contexts.length + r.entries.length + (contexts.length && general.length ? 1 : 0);
  const form: 'full' | 'index' | 'head' =
    opts.entries === false ? 'head'
      : groupedCost <= REGISTRY_INLINE_MAX ? 'full'
        : contexts.length && packed.length <= REGISTRY_INLINE_MAX ? 'index'
          : 'head';

  // What the head line offers, and it must be true of the form BELOW it.
  //
  // full/uncapped: the whole catalogue is here, so pointing at the tool for
  //   completeness sends a model on a round-trip for what it was just handed —
  //   what that tool adds is depth per entry.
  // full/capped: both tiers carry the same 100, so the tool cannot show MORE
  //   entries. What still names the rest is the document, returned verbatim.
  // index: the names are here, the skills are one targeted call away.
  // head: nothing is listed, so the tool IS the listing.
  let reach: string;
  if (form === 'index') {
    reach = 'Skills und Anleitung je Kontext mit get_skill_registry und context:"<Name>"';
  } else if (form === 'head') {
    reach = 'auflisten mit get_skill_registry';
  } else if (r.truncated) {
    reach = `hier die ersten ${r.truncated.listed}; die übrigen nennt nur das Registry-Dokument selbst `
      + '(get_skill_registry gibt es unverändert aus)';
  } else if (opts.described) {
    // The caller already put the descriptions AND the editors' instruction in
    // this answer (the named-context path of `subjectRegistryText`). Offering
    // them as what the tool adds sends a model back for what it is holding;
    // what is genuinely still there is the keywords and the document itself.
    reach = 'alle hier gelistet; Schlagworte und das Registry-Dokument mit get_skill_registry';
  } else {
    reach = 'alle hier gelistet; Beschreibungen und Redaktionshinweise mit get_skill_registry';
  }
  // A short form still owes the capped disclosure — it is the only sign that the
  // service dropped entries, and the tool cannot make them up either.
  if (form !== 'full' && r.truncated) {
    reach += '; die übrigen nennt nur das Registry-Dokument selbst';
  }

  // Suppressed on a NARROWED answer: `contexts` then holds the one context that
  // matched, so the number would be the view's while the sentence reads as a
  // claim about the registry — and that answer names its context in its opening
  // line anyway. The singular is spelled out because „in 1 Kontexten" is wrong
  // German and a registry with exactly one context is ordinary.
  const outline = opts.narrowed || !contexts.length
    ? ''
    : ` in ${contexts.length} ${contexts.length === 1 ? 'Kontext' : 'Kontexten'}`;
  const lines = [
    `Skill-Registry: ${r.title || '(ohne Titel)'} (nodeId: ${r.nodeId}) — `
    + `${declared} freigegebene Skills${outline}, ${reach}`,
  ];

  const entryLine = (e: { nodeId: string; title: string }, indent: string) =>
    `${indent}Skill: ${e.title} (nodeId: ${e.nodeId}) — laden mit get_skill`;

  if (form === 'index') {
    for (const line of packed) lines.push(`  Kontexte: ${line}`);
    return lines;
  }
  if (form === 'head') return lines;

  if (!contexts.length) {
    for (const e of r.entries) lines.push(entryLine(e, '  '));
  } else {
    const shown = new Set<string>();
    for (const c of contexts) {
      lines.push(oneLine(`  Kontext: ${c.path} (${c.skills})`));
      for (const e of r.entries.filter(x => x.context === c.path)) {
        lines.push(entryLine(e, '    '));
        shown.add(e.nodeId);
      }
    }
    // Everything the groups did not take. In this form that is exactly the
    // context-free skills — a context past `REGISTRY_CONTEXT_MAX` would leave
    // orphans, but fifty contexts never reach the grouped form.
    const rest = r.entries.filter(e => !shown.has(e.nodeId));
    if (rest.length) {
      lines.push(`  Ohne Kontext — gilt immer (${rest.length})`);
      for (const e of rest) lines.push(entryLine(e, '    '));
    }
  }
  // Suppressed entries are not "left out": the head line already offers the
  // listing, so counting them off again would read as a second, unreachable
  // remainder.
  if (declared > r.entries.length) lines.push(`  … und ${declared - r.entries.length} weitere`);
  // Only where a skill nodeId was actually printed. Forms 2 and 3 list none (and
  // an empty catalogue has nothing to list), so the note would point at ids the
  // answer does not carry — a listing that promises a step its own content
  // cannot support is worse than one that promises none.
  //
  // Indented with the entries it closes. Flush left it lands between the last
  // skill and the node's own `Typ:` line, where "das ist nur die Übersicht"
  // reads as a statement about the RECORD rather than about the catalogue.
  if (r.entries.length) lines.push(`  ${DESCRIPTIONS_ONLY_NOTE}`);
  return lines;
}

/**
 * One line telling a model that a collection MAY declare approved skills, and
 * when it is worth finding out. Emitted once per answer, not per collection.
 *
 * Everything about this sentence follows from one constraint: **nothing has been
 * read**. The search does not look a registry up — measured 2026-08-10 at
 * ~1.0–1.4 s per search, paid through the `/children` call whether or not a
 * registry exists — so this line cannot claim one is there. An earlier draft
 * said "Skills für diese Sammlung", which is an existence claim over data nobody
 * fetched; with today's staging (no collection has a registry yet) it would be
 * wrong essentially every time, and a model may report it to a user before
 * checking.
 *
 * So it says three things and no more: that the answer is UNKNOWN, HOW to get
 * it, and WHEN that is worth a round-trip. The third is what keeps it from
 * becoming noise — without an occasion, a hint that fires on every collection
 * listing gets learned as decoration and ignored.
 *
 * Once per ANSWER, because the sentence is identical for every collection and
 * the ids are all in the same block anyway — and "answer" is not the same as
 * "list". `search_wlo_all` renders three lists into one answer and topic pages
 * are `ccm:map`, so a hint emitted per list fired twice; `get_related_content`
 * renders two. Which is why this is exported: a composed answer suppresses the
 * per-list hint (`renderToText`'s `registryHint: false`) and calls this once
 * over the union.
 */
export function registryHintFor(nodes: FormattedNode[]): string[] {
  // Only when at least one collection has NOT already answered the question.
  // Under the (opt-in) search enrichment a collection carries its registry, and
  // repeating "not checked" beside the check would be plainly false.
  const unanswered = nodes.some(n => n.nodeType === 'collection' && !n.skillRegistry);
  if (!unanswered) return [];
  return ['Hinweis: Ob eine Sammlung eigene Arbeitsanleitungen („Skills") freigegeben hat, '
    + 'ist hier nicht geprüft — viele führen keine. `get_skill_registry` mit ihrer nodeId '
    + 'beantwortet es, und lohnt sich, wenn es um das Vorgehen MIT einer Sammlung geht '
    + '(„wie arbeite ich damit", „was ist hier vorgesehen") statt um ihre Inhalte.'];
}
