/**
 * tools/collection-overview.ts – get_collection_overview (BOERDi wishlist
 * item 1, 2026-11-06). Schema and rendering only; the parallel reads and the
 * "a failed part is named, not fatal" rule live in
 * `services/collection-overview.ts`.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { registerWloTool } from '../apps/register.js';
import { DESCRIPTIONS_ONLY_NOTE, nodeIdLine, oneLine, quotedTitle } from '../formatter.js';
import { getCollectionOverview, OVERVIEW_PARTS, type CollectionOverview } from '../services/collection-overview.js';
import { toolError } from './shared.js';
import { resolvedCollectionSchema } from '../apps/outputSchemas.js';
import { collectionDisciplineParam, collectionNameParam, collectionOrderParam, withCollectionByName } from './collection-arg.js';

const MAX_CONTENTS = 50;
const MAX_SUBCOLLECTIONS = 100;

const labelled = z.array(z.object({ label: z.string(), count: z.number() }));

export const collectionOverviewSchema = z.object({
  collection: z.object({
    nodeId: z.string(), title: z.string(), description: z.string(), url: z.string(),
    isTopicPage: z.boolean(), topicPageUrl: z.string().nullable(),
  }),
  breadcrumb: z.array(z.object({ nodeId: z.string(), title: z.string() })).optional(),
  compendium: z.object({
    hasText: z.boolean(), chars: z.number(), toc: z.array(z.object({ title: z.string(), depth: z.number() })),
    headings: z.number(), tocDepthLimited: z.literal(true).optional(),
  }).optional(),
  stats: z.object({
    contents: z.number(), subcollections: z.number(), sampled: z.number(),
    byType: labelled, bySubject: labelled, byLevel: labelled,
  }).optional(),
  skills: z.array(z.object({
    nodeId: z.string(), title: z.string(), context: z.string().optional(), description: z.string().optional(),
  })).optional(),
  subcollections: z.array(z.object({
    nodeId: z.string(), title: z.string(), contentCount: z.number().optional(),
    /** Its contents are not readable for this login (401/403/404) — no count, and no retry changes that. */
    contentsRefused: z.literal(true).optional(),
    /** Its count did not answer this time — unknown, and asking again may tell. */
    contentsUnread: z.literal(true).optional(),
  })).optional(),
  subcollectionsTruncated: z.literal(true).optional(),
  contents: z.object({
    total: z.number(), truncated: z.boolean(),
    items: z.array(z.object({
      nodeId: z.string(), title: z.string(), url: z.string(), learningResourceTypes: z.array(z.string()), license: z.string(),
      originalId: z.string().optional(),
    })),
  }).optional(),
  missing: z.array(z.object({
    part: z.enum(OVERVIEW_PARTS), code: z.enum(['timeout', 'forbidden', 'not_found', 'upstream_busy', 'upstream_error', 'not_checked']),
  })),
  resolvedCollection: resolvedCollectionSchema,
});

export function registerCollectionOverviewTool(server: McpServer): void {
  registerWloTool(server, {
    name: 'get_collection_overview',
    title: 'WLO Sammlung auf einen Blick',
    description: `Alles Wesentliche zu EINER Sammlung in einem Aufruf: Kopf, Pfad im Themenbaum, Kompendium (nur die oberen zwei Gliederungsebenen und die Länge), Statistik, freigegebene Skills (erste drei mit Beschreibung), Untersammlungen mit Inhaltszahl und die ersten Inhalte. Die Teile laufen parallel; ein Teil, der nicht kam, steht in "missing" ({part, code}) — der Rest kommt trotzdem. Mit "include" nur die gewünschten Teile.
Statt der nodeId kann der Titel der Sammlung als \`collection\` angegeben werden, bei mehreren gleichnamigen mit \`discipline\` (Fach); bei Mehrdeutigkeit kommen Kandidaten statt eines Ergebnisses.
Nicht für den Kompendium-TEXT (get_compendium_text), nicht zum Blättern durch alle Inhalte (get_collection_contents) und nicht für einen tieferen Baum (browse_collection_tree).`,
    inputSchema: {
      collectionId: z.string().max(200).optional().describe('nodeId der Sammlung; eine Verknüpfungs-id wird aufs Original aufgelöst. collectionId ODER `collection` (Titel) — eines von beiden ist Pflicht.'),
      collection: collectionNameParam,
      discipline: collectionDisciplineParam('discipline'),
      include: z.array(z.enum(OVERVIEW_PARTS)).min(1).optional().describe(
        `Welche Teile (Vorgabe: alle): ${OVERVIEW_PARTS.join(', ')}.`),
      maxContents: z.number().int().min(0).max(MAX_CONTENTS).optional().default(10)
        .describe(`Wie viele Inhalte (0–${MAX_CONTENTS}, Vorgabe 10).`),
      maxSubcollections: z.number().int().min(0).max(MAX_SUBCOLLECTIONS).optional().default(30)
        .describe(`Wie viele Untersammlungen (0–${MAX_SUBCOLLECTIONS}, Vorgabe 30). Jede kostet einen Zählabruf für ihre Inhaltszahl — höher heißt langsamer.`),
      order: collectionOrderParam,
    },
    outputSchema: collectionOverviewSchema,
    annotations: { readOnlyHint: true },
    handler: withCollectionByName({
      idParam: 'collectionId', disciplineParam: 'discipline', missing: 'Bitte collectionId oder collection angeben.',
    }, async (params) => {
      try {
        const result = await getCollectionOverview(String(params.collectionId), {
          include: params.include ?? OVERVIEW_PARTS,
          maxContents: params.maxContents ?? 10,
          maxSubcollections: params.maxSubcollections ?? 30,
          order: params.order,
        });
        if (!result.ok) {
          // A code, never the repository's text — and not schema-checked (isError).
          return {
            content: [{ type: 'text' as const, text: `${result.error.message} (${result.error.code})` }],
            structuredContent: { error: result.error },
            isError: true,
          };
        }
        return { content: [{ type: 'text' as const, text: render(result.overview) }], structuredContent: result.overview };
      } catch (err) {
        return toolError('Fehler bei der Sammlungsübersicht', err);
      }
    }),
  });
}

/** The short text form of the same data. Every repository value through `oneLine`. */
function render(o: CollectionOverview): string {
  const lines: string[] = [`## ${o.collection.title || o.collection.nodeId}`, nodeIdLine(o.collection.nodeId)];
  if (o.collection.topicPageUrl) lines.push(`Themenseite: ${o.collection.topicPageUrl}`);
  if (o.breadcrumb?.length) lines.push(`Pfad: ${o.breadcrumb.map(b => b.title).join(' › ')}`);
  if (o.compendium) {
    lines.push(o.compendium.hasText
      ? `Kompendium (${o.compendium.chars} Zeichen): ${o.compendium.toc.filter(t => t.depth === 0).map(t => t.title).join(' · ')}`
      : 'Kein Kompendiumstext.');
  }
  if (o.stats) lines.push(`Statistik: ${o.stats.contents} Inhalte, ${o.stats.subcollections} Untersammlungen`);
  if (o.skills) {
    if (o.skills.length) {
      lines.push(`Freigegebene Skills: ${o.skills.map(s => `${s.nodeId} ${quotedTitle(s.title)}`).join(', ')}`);
      // Every surface that prints skill nodeIds says it is not the instruction
      // (CLAUDE.md, 2026-08-16) — indented with the entries it closes.
      lines.push(`  ${DESCRIPTIONS_ONLY_NOTE}`);
    } else {
      lines.push('Keine freigegebenen Skills.');
    }
  }
  if (o.subcollections?.length) {
    lines.push(`Untersammlungen: ${o.subcollections
      .map(s => `${s.nodeId} (${s.contentsRefused ? 'mit dieser Anmeldung nicht lesbar' : s.contentsUnread ? 'Anzahl gerade nicht lesbar' : s.contentCount ?? '?'}) ${quotedTitle(s.title)}`).join('; ')}${o.subcollectionsTruncated ? ' …' : ''}`);
  }
  if (o.contents) {
    lines.push(`Inhalte (${o.contents.items.length} von ${o.contents.total}):`);
    // Collection children are often REFERENCES: the shared line names the original.
    for (const i of o.contents.items) lines.push(`- ${i.title}`, `  ${nodeIdLine(i.nodeId, i.originalId)}`);
  }
  if (o.missing.length) {
    lines.push(`Nicht geladen: ${o.missing.map(m => `${m.part} (${m.code})`).join(', ')} — der Rest ist vollständig.`);
  }
  return lines.map(oneLine).join('\n');
}
