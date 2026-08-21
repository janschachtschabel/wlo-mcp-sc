/**
 * tools/compendium.ts – get_compendium_text:
 * The editorial compendium text of one or more collections — the authoritative
 * prose overview (collection search only carries a 500-char preview).
 * Read-only.
 *
 * Every answer opens with the OUTLINE and only then carries text, in one of two
 * shapes: without `query` the whole text, each main section capped on its own;
 * with `query` the passages that answer it, ranked by BM25. The outline is in
 * both because a model handed excerpts otherwise cannot tell what it did not
 * see, and so cannot ask the narrower second question.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { getCompendiumTexts, type CompendiumEntry } from '../services/compendium.js';
import { buildCompendiumView, type CompendiumView } from '../services/compendium-view.js';
import { WLO_COMPENDIUM_SECTION_MAX } from '../wlo-config.js';
import { oneLine } from '../formatter.js';
import { toolError } from './shared.js';
import { registerWloTool } from '../apps/register.js';
import { contentTextSchema } from '../apps/outputSchemas.js';

const NO_TEXT = '_Kein Kompendiumstext hinterlegt._';

/**
 * The outline, as an indented list.
 *
 * Every title goes through `oneLine`, the blanket rule for a renderer that
 * writes its own lines. Today nothing can reach it: a heading line carrying a
 * line terminator is not recognised as a heading at all, because JavaScript's
 * `.` excludes `\r` as well as `\n` — measured, `## Echt\r- Gefälscht` produces no
 * outline entry rather than a forged one. The call stays because the guarantee
 * belongs to the renderer: it must not depend on which characters the parser of
 * the day happens to exclude.
 */
function outlineLines(view: CompendiumView): string[] {
  return view.outline.map(entry => `${'  '.repeat(entry.depth)}- ${oneLine(entry.title)}`);
}

/** What this answer holds and what the caller can ask for instead — never a claim beyond that. */
function hintLine(view: CompendiumView, query: string): string {
  const size = `${view.charCount} Zeichen`;
  if (!query) {
    const cap = view.truncated
      ? `gekürzt auf max. ${WLO_COMPENDIUM_SECTION_MAX} Zeichen je Hauptabschnitt`
      : 'vollständig';
    return `_Gesamttext ${size}, ${cap}. Für gezielte Absätze: dasselbe Werkzeug mit query="…" aufrufen._`;
  }
  const missing = view.unmatchedTerms.length
    ? ` Nicht gefunden: ${view.unmatchedTerms.join(', ')}.`
    : '';
  const found = view.passages.length
    ? `${view.passages.length} Passage${view.passages.length === 1 ? '' : 'n'} zu „${query}"`
    : `Keine Passage zu „${query}"`;
  return `_${found} aus ${size} Gesamttext.${missing} Ohne query kommt der ganze Text._`;
}

/**
 * Terms missing from EVERY text of a bulk fetch.
 *
 * The intersection, deliberately not the union: a term absent from one
 * collection but present in another HAS been found, and reporting it as missing
 * would tell the caller its search word does not occur while the answer in
 * front of it contains that very word.
 */
function unmatchedEverywhere(views: Array<CompendiumView | undefined>): string[] {
  const present = views.filter((v): v is CompendiumView => !!v);
  if (present.length === 0) return [];
  return present[0]!.unmatchedTerms.filter(term => present.every(v => v.unmatchedTerms.includes(term)));
}

/** The document half of the answer: passages under their heading path, or the capped sections. */
function bodyText(view: CompendiumView): string {
  if (view.passages.length) {
    return view.passages
      .map(p => (p.path.length ? `### ${oneLine(p.path.join(' › '))}\n\n${p.text}` : p.text))
      .join('\n\n');
  }
  if (view.sections.length) return view.sections.map(s => s.text).join('\n\n');
  return '';
}

/**
 * One collection as Markdown.
 *
 * Order matters and is the same rule `get_skill` follows: what the SERVER
 * derived (heading, outline, hint) stands before the repository's document.
 * After it, a forged outline inside the document would be indistinguishable
 * from ours.
 */
function renderEntry(entry: CompendiumEntry, view: CompendiumView | undefined, query: string): string {
  // Flattened because the blocks are separated by `---` and opened by a
  // heading: a newline in a title would split one collection's prose into two,
  // the second under a collection name nobody wrote.
  const heading = oneLine(`# ${entry.title || entry.nodeId}`);
  if (!view) return `${heading}\n\n${NO_TEXT}`;

  const parts = [heading];
  const outline = outlineLines(view);
  if (outline.length) parts.push(['## Inhalt', '', ...outline].join('\n'));
  parts.push(hintLine(view, query));
  const body = bodyText(view);
  if (body) parts.push(body);
  return parts.join('\n\n');
}

/**
 * @param readingWidgetUri – the W5 (reading) `ui://` resource, when built. The
 *   compendium IS editorial prose, which is what that view renders; it was the
 *   only long-text tool that never reached it (audit 2026-07-30).
 */
export function registerCompendiumTool(server: McpServer, readingWidgetUri?: string): void {
  registerWloTool(server, {
    name: 'get_compendium_text',
    title: 'WLO Kompendiumstext',
    widgetUri: readingWidgetUri,
    // Kept under MAX_DESCRIPTION (tests/tool-descriptions.test.ts) — a host
    // truncates from the END, and the WICHTIG sentence is the one instruction
    // that must survive, so it sits ahead of the mechanics rather than last.
    description: `Hole den redaktionellen Kompendiumstext einer oder mehrerer WLO-Sammlungen. Die Redaktion gliedert ihn typischerweise in drei Teile: (1) Weltwissen zum Thema in seinen Facetten, (2) Kompetenzen und Lehrplanbezüge nach Bildungsstufe und Bundesland, (3) kurze Vorstellung der Sammlungsinhalte. Er ist damit der MASSSTAB: für Lückenanalysen (Soll gegen get_collection_contents als Ist), für Sachrichtigkeits-Prüfungen und für Lernpfade. WICHTIG: Die Absätze sind Arbeitsmaterial, keine fertige Ausgabe — verarbeite sie und antworte in eigenen Worten; gib sie nicht wörtlich als Zitat aus (sie sind nicht zur direkten Anzeige gedacht). Jede Antwort beginnt mit dem Inhaltsverzeichnis. Mit "query" (z. B. "Lehrplan Thüringen Regelschule") kommen nur die passenden Absätze zurück — kürzer und die bevorzugte Form bei einer konkreten Frage; ohne "query" der ganze Text, je Hauptabschnitt gekürzt. Gib eine "Sammlung-nodeId" (oder mehrere). NICHT für Dateien/Materialien — nur für Sammlungen mit redaktionellem Text.`,
    inputSchema: {
      nodeId: z.string().optional().describe('A single collection nodeId.'),
      nodeIds: z.array(z.string()).max(25).optional().describe('Up to 25 collection nodeIds for a bulk fetch.'),
      query: z.string().max(200).optional().describe(
        'Suchtext, z. B. "Lehrplan Thüringen Regelschule". Nur die dazu passenden Absätze kommen zurück '
        + '(BM25-Ranking), das Inhaltsverzeichnis immer. Ohne Angabe: der ganze Text.'),
      outputFormat: z.enum(['markdown', 'json']).optional().default('markdown')
        .describe('"markdown" (default) or "json". JSON: {entries:[{nodeId,title,outline,charCount,truncated, and either compendiumText or passages+unmatchedTerms}]} \u2014 a collection without a compendium text carries only {nodeId,title,compendiumText:null}.'),
    },
    outputSchema: contentTextSchema,
    annotations: { readOnlyHint: true },
    handler: async (params) => {
      try {
        const ids = [...(params.nodeId ? [params.nodeId] : []), ...(params.nodeIds ?? [])];
        if (ids.length === 0) {
          return { content: [{ type: 'text' as const, text: 'Bitte nodeId oder nodeIds angeben.' }], isError: true };
        }

        // The caller's own text, not the repository's — but it is echoed into a
        // line-oriented answer, so it is flattened like everything else there.
        const query = oneLine((params.query ?? '').trim());
        const entries = await getCompendiumTexts(ids);
        const views = entries.map(e => (e.compendiumText
          ? buildCompendiumView(e.compendiumText, { query, maxSectionChars: WLO_COMPENDIUM_SECTION_MAX })
          : undefined));

        const joined = entries.map((e, i) => renderEntry(e, views[i], query)).join('\n\n---\n\n');

        // The reading view shows ONE text. A bulk fetch is still one readable
        // document — the same joined markdown the text output carries — but it
        // has no single owner, so `nodeId` stays empty. That is deliberate:
        // the widget gates its "summarize this" buttons on nodeId, and those
        // are meaningless across several collections.
        const single = entries.length === 1 ? entries[0] : undefined;
        const structuredContent = {
          nodeId: single?.nodeId ?? '',
          title: single?.title ?? `Kompendiumstexte (${entries.length})`,
          text: joined,
          source: 'repository' as const,
          sourceUrl: null,
          // The length of the SOURCE texts, per the schema — what the caller is
          // missing, not what it received.
          charCount: views.reduce((sum, v) => sum + (v?.charCount ?? 0), 0),
          truncated: views.some(v => v?.truncated),
          // This answer is working MATERIAL, not a document to read: the prose
          // arrives as paragraph chunks (BM25 passages with `query`, capped
          // sections without), and off the screen those are disjointed
          // fragments. The reading widget shows a handover line instead, and
          // the reader sees what the model made of it (user decision
          // 2026-08-21). Nothing about the model's copy changes.
          forModel: true,
          // Only a query answer HAS passages; absent means the whole text went
          // over, and the widget must not be able to print "0 Passagen" for it.
          ...(query
            ? {
              passageCount: views.reduce((sum, v) => sum + (v?.passages.length ?? 0), 0),
              // The handover renders no prose, so the "not found" statement the
              // markdown hint carries has to travel as a field or the reader
              // never learns their term was absent (review 2026-08-21).
              unmatchedTerms: unmatchedEverywhere(views),
            }
            : {}),
          // No `reason`: the schema reserves it for "there is no text", and
          // there always is one here — a collection without prose still yields
          // the "_Kein Kompendiumstext hinterlegt._" line, which says so in the
          // text itself.
        };

        if (params.outputFormat === 'json') {
          const payload = entries.map((e, i) => {
            const view = views[i];
            if (!view) return { nodeId: e.nodeId, title: e.title, compendiumText: null };
            const base = {
              nodeId: e.nodeId,
              title: e.title,
              outline: view.outline,
              charCount: view.charCount,
              truncated: view.truncated,
            };
            // A query answer carries its passages and NOT the full text:
            // shipping both beside each other would undo the narrowing the
            // caller asked for.
            return query
              ? { ...base, passages: view.passages, unmatchedTerms: view.unmatchedTerms }
              : { ...base, compendiumText: view.sections.map(s => s.text).join('\n\n') };
          });
          return {
            content: [{ type: 'text' as const, text: JSON.stringify({ entries: payload }) }],
            structuredContent,
          };
        }
        return { content: [{ type: 'text' as const, text: joined }], structuredContent };
      } catch (err) {
        return toolError('Fehler beim Abruf des Kompendiumstextes', err);
      }
    },
  });
}
