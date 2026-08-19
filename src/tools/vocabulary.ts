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
  server.tool(
    'lookup_wlo_vocabulary',
    `Look up the values a WLO field accepts — for SEARCH filters and for WRITING.
Filters: valid labels and URIs for Bildungsstufe (educational context),
Schulfach/Disziplin, Zielgruppe (user role), Lernressourcentyp, Lizenz.
For "universitySubject" (Hochschulfächer) the vocabulary is large, so pass a free-text
\`query\` (e.g. "Maschinenbau") to get a short candidate list to filter by.
Writing: "qualityScale" lists the 0-5 (and 0-1) quality ratings with their captions and the
curation parameter each belongs to; "qualityFinding" the verdicts of a quality check.
Neither is filterable — those fields can be read off a record and written, never searched.
Useful before calling a search tool, wlo_create_content, wlo_update_content or
wlo_suggest_metadata.`,
    {
      vocabulary: z.enum(['educationalContext', 'discipline', 'userRole', 'lrt', 'license', 'targetGroup', 'universitySubject', 'qualityFinding', 'qualityScale']).describe(
        'Which vocabulary to list: ' +
        '"educationalContext" (Bildungsstufen), ' +
        '"discipline" (Schulfächer), ' +
        '"userRole" (Zielgruppen), ' +
        '"lrt" (Lernressourcentypen aggregiert), ' +
        '"license" (CC-Lizenzen), ' +
        '"targetGroup" (Themenseiten-Zielgruppen: teacher/learner/general), ' +
        '"universitySubject" (Hochschulfächersystematik — groß; mit `query` eingrenzen), ' +
        '"qualityScale" (Qualitätsbewertungen 0–5 bzw. 0–1 mit Beschriftung — zum Schreiben), ' +
        '"qualityFinding" (Prüfergebnisse einer Qualitätsprüfung — zum Schreiben)'
      ),
      query: z.string().max(100).optional().describe(
        'Only for "universitySubject": a free-text term (e.g. "Maschinenbau") fuzzy-matched ' +
        'to candidate Hochschulfächer. Returns a pick-list of {label, URI}; the chosen URI is ' +
        'usable directly as a `discipline` filter. Ignored for the other vocabularies.'
      ),
    },
    { readOnlyHint: true },
    async (params) => {
      // University subjects: model-free fuzzy DISAMBIGUATION (never auto-resolved),
      // kept out of the label→URI input side to avoid school-subject label clashes.
      if (params.vocabulary === 'universitySubject') {
        return { content: [{ type: 'text' as const, text: universitySubjectLookup(params.query) }] };
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
        const aliases = e.aliases.length ? ` | Aliases: ${e.aliases.slice(0, 4).join(', ')}` : '';
        lines.push(`- **${e.label}**${aliases}`);
        lines.push(`  URI: ${e.uri}`);
      }

      return { content: [{ type: 'text' as const, text: lines.join('\n') }] };
    },
  );
}

export function registerPublisherTool(server: McpServer): void {
  server.tool(
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
