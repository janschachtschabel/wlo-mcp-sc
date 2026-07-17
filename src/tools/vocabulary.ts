/**
 * tools/vocabulary.ts – filter-value discovery:
 * lookup_wlo_vocabulary (valid labels/URIs of the filter vocabularies, purely
 * local) and lookup_wlo_publishers (the publishers/sources present in WLO with
 * per-publisher counts, via a facet aggregation over the live index).
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import type { VocabKey } from '../vocabs.js';
import { listVocab } from '../vocabs.js';
import { suggestUniversitySubjects } from '../vocabs-hochschule.js';
import { lookupPublishers } from '../services/publishers.js';
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
      `# Hochschulfächer zu „${q}"`,
      '',
      'Keine passenden Konzepte gefunden. Versuche einen anderen/kürzeren Begriff, oder nutze',
      'eine Suche mit `includeFacets: true` und lies die Hochschulfächer aus dem `discipline`-Facet ab.',
    ].join('\n');
  }
  const lines = [
    `# Hochschulfächer zu „${q}" (${matches.length})`,
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

export function registerVocabularyTool(server: McpServer): void {
  server.tool(
    'lookup_wlo_vocabulary',
    `Look up available values for WLO filter parameters.
Use this to discover valid labels and URIs for Bildungsstufe (educational context),
Schulfach/Disziplin, Zielgruppe (user role), or Lernressourcentyp (learning resource type).
For "universitySubject" (Hochschulfächer) the vocabulary is large, so pass a free-text
\`query\` (e.g. "Maschinenbau") to get a short candidate list to filter by.
Useful before calling search tools to find the correct filter values.`,
    {
      vocabulary: z.enum(['educationalContext', 'discipline', 'userRole', 'lrt', 'license', 'targetGroup', 'universitySubject']).describe(
        'Which vocabulary to list: ' +
        '"educationalContext" (Bildungsstufen), ' +
        '"discipline" (Schulfächer), ' +
        '"userRole" (Zielgruppen), ' +
        '"lrt" (Lernressourcentypen aggregiert), ' +
        '"license" (CC-Lizenzen), ' +
        '"targetGroup" (Themenseiten-Zielgruppen: teacher/learner/general), ' +
        '"universitySubject" (Hochschulfächersystematik — groß; mit `query` eingrenzen)'
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

      const vocab = params.vocabulary as VocabKey;
      const entries = listVocab(vocab);

      const vocabNames: Record<VocabKey, string> = {
        educationalContext: 'Bildungsstufe (educationalContext)',
        discipline:         'Schulfach / Disziplin (discipline)',
        userRole:           'Zielgruppe (userRole)',
        lrt:                'Lernressourcentyp aggregiert (lrt)',
        license:            'Lizenzen (license)',
        targetGroup:        'Themenseiten-Zielgruppe (targetGroup)',
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
        const lines: string[] = [`# WLO Anbieter (${publishers.length})`, ''];
        for (const p of publishers) {
          lines.push(`- **${p.label}** — ${p.count} Materialien`);
        }
        return { content: [{ type: 'text' as const, text: lines.join('\n') }] };
      } catch (err) {
        return toolError('Fehler beim Abruf der Anbieter', err);
      }
    },
  );
}
