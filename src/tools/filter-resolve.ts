/**
 * tools/filter-resolve.ts – resolve_wlo_filters: every filter label of a plan
 * to the value WLO stores, in one call (BOERDi wishlist item 3, 2026-11-06).
 *
 * Replaces chains of `lookup_wlo_vocabulary` calls before a write and the
 * caller's own matching. The resolution itself is `filter-resolve.ts`; this
 * module holds only the schema and the rendering.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { registerWloTool } from '../apps/register.js';
import { RESOLVABLE_VOCABS, resolveFilters } from '../filter-resolve.js';
import { oneLine } from '../formatter.js';

/** Per vocabulary — a plan names a handful, and every value is a table lookup. */
const MAX_VALUES = 10;

const values = z.array(z.string().max(200)).max(MAX_VALUES).optional();

const resolvedSchema = z.object({
  input: z.string(),
  status: z.enum(['exact', 'alias', 'fuzzy']),
  uri: z.string(),
  label: z.string(),
  keys: z.array(z.string()).optional(),
  suggestions: z.array(z.string()).optional(),
});

export const filterResolutionSchema = z.object({
  results: z.object(Object.fromEntries(
    RESOLVABLE_VOCABS.map(v => [v, z.array(resolvedSchema).optional()]),
  ) as Record<(typeof RESOLVABLE_VOCABS)[number], z.ZodOptional<z.ZodArray<typeof resolvedSchema>>>),
  unresolved: z.array(z.object({
    vocabulary: z.enum(RESOLVABLE_VOCABS),
    input: z.string(),
    suggestions: z.array(z.string()),
  })),
});

export function registerFilterResolveTool(server: McpServer): void {
  registerWloTool(server, {
    name: 'resolve_wlo_filters',
    title: 'WLO Filter auflösen',
    description: `Löse alle Filter- und Metadaten-Bezeichnungen eines Vorhabens in EINEM Aufruf auf: Fach, Bildungsstufe, Ressourcentyp, Lizenz, Zielgruppe (userRole) und Themenseiten-Zielgruppe (targetGroup) → der Wert, den WLO speichert (URI bzw. Lizenzschlüssel).
Jeder Wert sagt, WIE er aufgelöst wurde: "exact" (Hauptbezeichnung, URI oder Schlüssel), "alias" (eine andere bekannte Schreibweise, z. B. "Klasse 7" → Sekundarstufe I) oder "fuzzy" (geraten, mit "suggestions" — nie still übernehmen, sondern nachfragen). Was nicht auflöst, steht in "unresolved" mit Vorschlägen. Lizenzen lösen nur exakt auf: "CC BY NC" ohne Bindestrich wird NICHT zu CC BY. Dieselbe Auflösung wie in den Such- und Schreibwerkzeugen. Rein lokal, keine Anfrage an WLO.
Nicht für die Liste ALLER Werte eines Vokabulars — dafür lookup_wlo_vocabulary.`,
    inputSchema: {
      filters: z.object({
        discipline: values.describe('Fächer, z. B. "Physik"'),
        educationalContext: values.describe('Bildungsstufen, z. B. "Klasse 7", "Sek I"'),
        lrt: values.describe('Ressourcentypen, z. B. "Arbeitsblatt"'),
        license: values.describe('Lizenzen, z. B. "CC BY-SA" oder "OER"'),
        userRole: values.describe('Zielgruppen, z. B. "Lehrkraft"'),
        targetGroup: values.describe('Themenseiten-Zielgruppen: teacher, learner, general'),
      }).describe(`Je Vokabular höchstens ${MAX_VALUES} Werte.`),
    },
    outputSchema: filterResolutionSchema,
    annotations: { readOnlyHint: true, idempotentHint: true },
    handler: async (params) => {
      const resolution = resolveFilters(params.filters ?? {});
      const lines: string[] = [];
      for (const vocab of RESOLVABLE_VOCABS) {
        for (const r of resolution.results[vocab] ?? []) {
          const extra = r.status === 'fuzzy' && r.suggestions?.length
            ? ` — geraten, gemeint vielleicht: ${r.suggestions.join(', ')}`
            : r.keys ? ` — steht für ${r.keys.join(', ')}` : '';
          lines.push(oneLine(`${vocab}: „${r.input}" → ${r.label} (${r.uri}) [${r.status}]${extra}`));
        }
      }
      for (const u of resolution.unresolved) {
        const hint = u.suggestions.length ? ` — Meintest du: ${u.suggestions.join(', ')}?` : '';
        lines.push(oneLine(`${u.vocabulary}: „${u.input}" nicht aufgelöst${hint}`));
      }
      return {
        content: [{ type: 'text' as const, text: lines.join('\n') || 'Keine Werte angegeben.' }],
        structuredContent: resolution,
      };
    },
  });
}
