/**
 * tools/vocabulary.ts – which values a field accepts:
 * lookup_wlo_vocabulary (valid labels/URIs, purely local) and
 * lookup_wlo_publishers (the publishers/sources present in WLO with
 * per-publisher counts, via a facet aggregation over the live index).
 *
 * The first served filters only until 2026-08-19, when `qualityScale` and
 * `qualityFinding` joined it for the WRITE surface — those fields answer
 * HTTP 400 as a search criterion and are reachable only by reading a record or
 * writing one, so "filter vocabulary" stopped covering what this tool lists.
 */

import { registerReadTool } from '../apps/register.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import type { VocabKey } from '../vocabs.js';
import { listVocab } from '../vocabs.js';
import { suggestUniversitySubjects } from '../vocabs-hochschule.js';
import { scaleEntry, scaleKeys } from '../vocabs-quality-scale.js';
import { QUALITY_SCALE_FIELDS, WRITABLE_FIELDS } from '../services/write/fields.js';
import { CONTENT_FIELDS } from './curation-fields.js';
import { lookupPublishers } from '../services/publishers.js';
import { oneLine } from '../formatter.js';
import { toolError } from './shared.js';
import { LRT_CONCEPTS } from '../vocabs-lrt.js';
import { suggestEntries } from '../vocab-suggest.js';

/**
 * Format the `universitySubject` disambiguation response: a model-free fuzzy
 * pick-list of `{label, URI}` from the free-text `query`, or guidance to supply
 * one. The model picks a candidate and uses its URI as a `discipline` filter —
 * the server never auto-resolves a university subject (see `vocabs-hochschule.ts`).
 */
function universitySubjectLookup(query: string | undefined): string {
  const q = query?.trim();
  if (!q) {
    return [
      '# Hochschulfächer (universitySubject)',
      '',
      'Diese Systematik hat 344 Konzepte — zu viele zum Auflisten. Übergib `query=<Begriff>`',
      '(z. B. `query="Maschinenbau"`), um passende Fächer zu finden. Du erhältst eine kurze',
      'Auswahlliste `{Label, URI}`; wähle EINEN Eintrag und nutze seinen URI direkt als',
      '`discipline`-Filter der Suchtools. Der Server löst Hochschulfächer bewusst NICHT',
      'automatisch auf — die Wahl triffst du.',
      '',
      'Alternativ (korpus-gestützt): eine Suche mit `includeFacets: true` ausführen und die',
      'Hochschulfächer aus dem `discipline`-Facet der echten Treffer ablesen.',
    ].join('\n');
  }
  const matches = suggestUniversitySubjects(q);
  if (matches.length === 0) {
    return [
      // `q` is caller-supplied and sits on a line of its own; flattened for the
      // same reason as every other interpolated value in a line-oriented view.
      oneLine(`# Hochschulfächer zu „${q}“`),
      '',
      'Keine passenden Konzepte gefunden. Versuche einen anderen/kürzeren Begriff, oder nutze',
      'eine Suche mit `includeFacets: true` und lies die Hochschulfächer aus dem `discipline`-Facet ab.',
    ].join('\n');
  }
  const lines = [
    oneLine(`# Hochschulfächer zu „${q}“ (${matches.length})`),
    '',
    'Wähle EINEN Eintrag und nutze seinen URI als `discipline`-Filter:',
    '',
  ];
  for (const m of matches) {
    lines.push(`- **${m.label}**`);
    lines.push(`  URI: ${m.uri}`);
  }
  return lines.join('\n');
}

/**
 * The ordinal quality scales: every position with the caption the metadata set
 * declares for it.
 *
 * Not a `VocabKey`, and handled before that cast for the same reason
 * `universitySubject` is — these live in the generated `vocabs-quality-scale.ts`
 * rather than in the local vocabulary tables.
 *
 * Listed for the WRITE surface, because that is what points here: the refusal in
 * `services/write/fields.ts` and the parameter descriptions of the curation
 * tools both name this tool for the captions, and until 2026-08-19 it had no
 * scale vocabulary at all — so the one recovery path a model is offered after a
 * wrong value ended in a second error. `ccm:containsAdvertisement` has a scale
 * and stays out: it is not writable, and offering it here would advertise a
 * write that is refused.
 */
function qualityScaleLookup(): string {
  const paramOf = new Map(Object.entries(CONTENT_FIELDS).map(([param, property]) => [property, param]));
  const lines: string[] = [
    '# Qualitätsskalen (schreibbar)',
    '',
    'Die Stufen sind aufsteigend: der höchste Wert ist der günstigste. Die beiden',
    '0/1-Felder sind Ja/Nein-Fragen und keine Bewertungen — dort ist 1 das Ja.',
    'Geschrieben wird die Ziffer ODER die Beschriftung — daraus setzt der Server die',
    'Form ein, die das Repository für das jeweilige Feld deklariert.',
    '',
  ];
  for (const property of QUALITY_SCALE_FIELDS) {
    const label = WRITABLE_FIELDS[property]?.label ?? property;
    const param = paramOf.get(property);
    // The property is not the parameter name, and a caption a caller cannot act
    // on is half an answer — so the parameter that writes it is named here.
    lines.push(`- **${label}** (${property})${param ? ` — Parameter: ${param}` : ''}`);
    for (const key of scaleKeys(property)) {
      // Repository-supplied text in a line-oriented answer: a newline in a
      // caption would otherwise forge a position of its own.
      lines.push(`  ${key} = ${oneLine(scaleEntry(property, key)?.caption ?? '')}`);
    }
  }
  return lines.join('\n');
}

export function registerVocabularyTool(server: McpServer): void {
  registerReadTool(server,
    'lookup_wlo_vocabulary',
    `Look up the values a WLO field accepts — for SEARCH filters and for WRITING.
Filters: valid labels and URIs for Bildungsstufe (educational context),
Schulfach/Disziplin, Zielgruppe (user role), Lernressourcentyp, Lizenz.
For "universitySubject" (Hochschulfächer) the vocabulary is large, so pass a free-text
\`query\` (e.g. "Maschinenbau") to get a short candidate list to filter by.
Writing: "contentType" lists the content types the curation tools accept in their
\`contentType\` field (large — narrow it with \`query\`; not the same list as the "lrt" filter);
"qualityScale" the 0-5 (and 0-1) quality ratings with their captions and the curation
parameter each belongs to; "qualityFinding" the verdicts of a quality check.
The last two are not filterable — those fields can be read off a record and written, never searched.
Useful before calling a search tool, wlo_create_content, wlo_update_content or
wlo_suggest_metadata.`,
    {
      vocabulary: z.enum(['educationalContext', 'discipline', 'userRole', 'lrt', 'contentType', 'license', 'targetGroup', 'universitySubject', 'qualityFinding', 'qualityScale']).describe(
        'Which vocabulary to list: ' +
        '"educationalContext" (Bildungsstufen), ' +
        '"discipline" (Schulfächer), ' +
        '"userRole" (Zielgruppen), ' +
        '"lrt" (Lernressourcentypen aggregiert — zum FILTERN der Suche), ' +
        '"contentType" (Inhaltstypen, wie sie wlo_create_content / wlo_update_content im Feld contentType annehmen — zum SCHREIBEN; groß, mit `query` eingrenzen), ' +
        '"license" (CC-Lizenzen), ' +
        '"targetGroup" (Themenseiten-Zielgruppen: teacher/learner/general), ' +
        '"universitySubject" (Hochschulfächersystematik — groß; mit `query` eingrenzen), ' +
        '"qualityScale" (Qualitätsbewertungen 0–5 bzw. 0–1 mit Beschriftung — zum Schreiben), ' +
        '"qualityFinding" (Prüfergebnisse einer Qualitätsprüfung — zum Schreiben)'
      ),
      query: z.string().max(100).optional().describe(
        'A free-text term that narrows a large vocabulary. For "universitySubject" (e.g. "Maschinenbau"): ' +
        'fuzzy-matched to candidate Hochschulfächer, returned as a pick-list of {label, URI}; the chosen ' +
        'URI is usable directly as a `discipline` filter. For "contentType" (e.g. "Video"): the content ' +
        'types whose name or alias is near the term; the NAME is the value for the `contentType` field of ' +
        'wlo_create_content / wlo_update_content (the URI where the listing says the name is ambiguous). ' +
        'Ignored for the other vocabularies.'
      ),
    },
    { readOnlyHint: true },
    async (params) => {
      // University subjects: model-free fuzzy DISAMBIGUATION (never auto-resolved),
      // kept out of the label→URI input side to avoid school-subject label clashes.
      if (params.vocabulary === 'universitySubject') {
        return { content: [{ type: 'text' as const, text: universitySubjectLookup(params.query) }] };
      }

      // What the WRITE checks `contentType` against (`new_lrt`, 220 concepts) —
      // not the aggregated list "lrt" serves, whose URIs the write refuses. Someone
      // who looked up "lrt" after a refusal got values that were refused again
      // (chatbot feedback 2026-11-13, B2).
      if (params.vocabulary === 'contentType') {
        return { content: [{ type: 'text' as const, text: contentTypeLookup(params.query) }] };
      }

      // Before the `VocabKey` cast below, like the branch above: the scales are
      // not one of the local vocabulary tables `listVocab` serves.
      if (params.vocabulary === 'qualityScale') {
        return { content: [{ type: 'text' as const, text: qualityScaleLookup() }] };
      }

      const vocab = params.vocabulary as VocabKey;
      const entries = listVocab(vocab);

      const vocabNames: Record<VocabKey, string> = {
        educationalContext: 'Bildungsstufe (educationalContext)',
        discipline:         'Schulfach / Disziplin (discipline)',
        userRole:           'Zielgruppe (userRole)',
        lrt:                'Lernressourcentyp aggregiert (lrt)',
        license:            'Lizenzen (license)',
        targetGroup:        'Themenseiten-Zielgruppe (targetGroup)',
        qualityFinding:     'Prüfergebnis der Qualitätsprüfung (qualityFinding)',
      };

      const lines: string[] = [`# Vokabular: ${vocabNames[vocab]}`, ''];
      for (const e of entries) {
        const aliases = e.aliases.length ? ` | Aliases: ${e.aliases.join(', ')}` : '';
        lines.push(`- **${e.label}**${aliases}`);
        lines.push(`  URI: ${e.uri}`);
      }

      return { content: [{ type: 'text' as const, text: lines.join('\n') }] };
    },
  );
}

/** The content types a write accepts, by name — all of them, or those near `query`. */
function contentTypeLookup(query: string | undefined): string {
  const q = query?.trim();
  // By CONCEPT, not by the term that matched: a hit through an alias is a hit.
  const near = q ? new Set(suggestEntries(q, LRT_CONCEPTS).slice(0, 12)) : null;
  const wanted = q ? q.toLowerCase() : '';
  const shown = near
    ? LRT_CONCEPTS.filter(c => near.has(c) || c.label.toLowerCase().includes(wanted) || c.aliases.some(a => a.toLowerCase().includes(wanted)))
    : LRT_CONCEPTS;
  const lines = [
    '# Vokabular: Inhaltstyp zum Schreiben (contentType)',
    'Der NAME ist der Wert für `contentType` in wlo_create_content, wlo_update_content, wlo_update_contents und wlo_suggest_metadata.',
    q ? `Eingegrenzt auf „${oneLine(q)}“: ${shown.length} von ${LRT_CONCEPTS.length}.` : `${LRT_CONCEPTS.length} Einträge — mit \`query\` eingrenzen.`,
    '',
  ];
  if (!shown.length) lines.push('Kein Eintrag passt. Ohne `query` kommt die ganze Liste.');
  // A name that stands for two concepts is refused by the write — there the URI is the value.
  const twice = new Set(LRT_CONCEPTS.map(c => c.label).filter((l, i, all) => all.indexOf(l) !== i));
  for (const c of shown) {
    lines.push(`- **${c.label}**${c.path ? ` (unter: ${c.path})` : ''}${c.aliases.length ? ` | Aliases: ${c.aliases.join(', ')}` : ''}`);
    if (twice.has(c.label)) lines.push(`  Der Name ist mehrdeutig — als Wert die URI angeben: ${c.uri}`);
  }
  return lines.join('\n');
}

export function registerPublisherTool(server: McpServer): void {
  registerReadTool(server,
    'lookup_wlo_publishers',
    `List the publishers/sources (Anbieter/Quellen) that provide WLO content, with the
number of materials each has.
Use this to discover which institutions or platforms (e.g. "Serlo", "ZUM", "Bundeszentrale
für politische Bildung") publish on WLO — for an overview, or to pick a valid value for the
\`publisher\` filter of the search tools. Optionally scope the counts to a topic via \`query\`
and/or a \`discipline\`/\`educationalContext\` filter ("who publishes biology material?").
Counts are facet aggregations over the live index, ordered by size.`,
    {
      query: z.string().optional().describe(
        'Optional free-text scope, e.g. "Photosynthese" — counts only publishers with matching content.'
      ),
      discipline: z.string().optional().describe(
        'Optional subject filter (e.g. "Biologie", "Mathematik", or URI) to scope the publisher counts.'
      ),
      educationalContext: z.string().optional().describe(
        'Optional educational level filter (e.g. "Sekundarstufe I", or URI) to scope the publisher counts.'
      ),
      maxResults: z.number().int().min(1).max(100).optional().default(20).describe(
        'Maximum number of publishers to return (1–100, default 20; largest first).'
      ),
      outputFormat: z.enum(['markdown', 'json']).optional().default('markdown'),
    },
    { readOnlyHint: true },
    async (params) => {
      try {
        const publishers = await lookupPublishers({
          query: params.query,
          discipline: params.discipline,
          educationalContext: params.educationalContext,
          maxResults: params.maxResults ?? 20,
        });

        if ((params.outputFormat ?? 'markdown') === 'json') {
          return {
            content: [{
              type: 'text' as const,
              text: JSON.stringify({ total: publishers.length, results: publishers }),
            }],
          };
        }

        if (publishers.length === 0) {
          return { content: [{ type: 'text' as const, text: 'Keine Anbieter gefunden.' }] };
        }
        // The label is the raw facet value of `ccm:oeh_publisher_combined`, i.e.
        // free text from the repository — and the model reads this list to pick
        // a `publisher` filter value. A newline in it would offer an entry that
        // does not exist, with a count nobody produced.
        const lines: string[] = [`# WLO Anbieter (${publishers.length})`, ''];
        for (const p of publishers) {
          lines.push(oneLine(`- **${p.label}** — ${p.count} Materialien`));
        }
        return { content: [{ type: 'text' as const, text: lines.join('\n') }] };
      } catch (err) {
        return toolError('Fehler beim Abruf der Anbieter', err);
      }
    },
  );
}
