/**
 * tools/collection-tree-list.ts – list_collection_tree (chatbot team, S2,
 * 2026-11-14). Schema and rendering only; the walk lives in
 * `services/collection-tree-flat.ts`.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { registerWloTool } from '../apps/register.js';
import { resolvedCollectionSchema } from '../apps/outputSchemas.js';
import { nodeIdLine, oneLine, quotedTitle } from '../formatter.js';
import { RESTRICTED_NOTICE } from '../services/collection-traversal.js';
import {
  FLAT_TREE_DEPTH_MAX, FLAT_TREE_LISTINGS_MAX, FLAT_TREE_PAGE_MAX, FLAT_TREE_SKIP_MAX, NotACollectionError, listCollectionTree,
  type FlatTree,
} from '../services/collection-tree-flat.js';
import { codedErrorResult, toolError } from './shared.js';
import { collectionDisciplineParam, collectionNameParam, withCollectionByName } from './collection-arg.js';

/**
 * Said when a listing below the start collection did not answer. Carries the
 * wording a client recognises an outage by ("ließ sich gerade nicht lesen").
 */
export const TREE_INCOMPLETE_NOTICE = 'Hinweis: Mindestens eine Unterliste ließ sich gerade nicht lesen — der Zweig darunter fehlt '
  + 'in dieser Liste. Das ist KEIN Befund „mehr gibt es nicht“; bitte später erneut versuchen. Solange das so ist, '
  + 'gelten auch die Positionen für skipCount nicht verlässlich.';

/** Said when the walk stopped at its bound on listings before the page was full. */
export const TREE_CAPPED_NOTICE = `Hinweis: Der Lauf hat seine Obergrenze von ${FLAT_TREE_LISTINGS_MAX} Abfragen erreicht — tiefere `
  + 'Ebenen fehlen in dieser Liste. Für den Rest eine Untersammlung als Start nehmen (nodeId aus dieser Liste) oder depth verkleinern.';

export const collectionTreeListSchema = z.object({
  root: z.object({ nodeId: z.string(), title: z.string() }),
  depth: z.number(),
  count: z.number(),
  skipCount: z.number(),
  items: z.array(z.object({
    nodeId: z.string(),
    title: z.string(),
    /** Titles from the start collection down to this one, both included. */
    path: z.array(z.string()),
    /** 1 = a direct sub-collection of the start collection. */
    depth: z.number(),
    parentId: z.string(),
    contentCount: z.number().optional(),
    childrenUnread: z.literal(true).optional(),
    childrenRefused: z.literal(true).optional(),
    contentsRefused: z.boolean().optional(),
    contentsUnread: z.boolean().optional(),
  })),
  more: z.object({ nextSkipCount: z.number() }).optional(),
  incomplete: z.literal(true).optional(),
  restricted: z.literal(true).optional(),
  walkCapped: z.literal(true).optional(),
  resolvedCollection: resolvedCollectionSchema,
});

export function registerCollectionTreeListTool(server: McpServer): void {
  registerWloTool(server, {
    name: 'list_collection_tree',
    title: 'WLO Sammlungsbaum als Liste',
    description: `Der Teilbaum unter EINER Sammlung als flache Liste: je Untersammlung nodeId, Titel, Pfad (Titel von der Start-Sammlung abwärts), Tiefe und parentId — bis ${FLAT_TREE_DEPTH_MAX} Ebenen tief, in der Reihenfolge, die das Repository hält (gesetzte Position, sonst Reihenfolge des Anlegens), Ebene für Ebene. Gedacht zum RECHNEN: einen Entwurf gegen den Bestand abgleichen, einen angelegten Baum zurücklesen, Kennungen für Folgeschritte holen. Nicht je Elternknoten gekürzt; lange Listen kommen in Seiten (\`more.nextSkipCount\` → \`skipCount\`).
Statt der nodeId geht der Titel als \`collection\` (gleichnamige: \`discipline\`). Zum Anschauen und Stöbern ist browse_collection_tree gedacht, für die Inhalte get_collection_contents.
\`incomplete\` / \`restricted\`: ein Zweig ließ sich nicht lesen bzw. ist mit dieser Anmeldung nicht lesbar; \`walkCapped\`: der Lauf hat seine Obergrenze (${FLAT_TREE_LISTINGS_MAX} Abfragen) erreicht — die Liste ist dann NICHT vollständig. Eine Inhaltszahl, die fehlt, steht nur am Eintrag (\`contentsRefused\` / \`contentsUnread\`).`,
    inputSchema: {
      nodeId: z.string().max(200).optional().describe('nodeId of the start collection. nodeId OR `collection` (title) — one of them is required.'),
      collection: collectionNameParam,
      discipline: collectionDisciplineParam('discipline'),
      depth: z.number().int().min(1).max(FLAT_TREE_DEPTH_MAX).optional().default(FLAT_TREE_DEPTH_MAX).describe(
        `How many levels below the start collection (1–${FLAT_TREE_DEPTH_MAX}, default ${FLAT_TREE_DEPTH_MAX}). Each collection above the last level costs one listing call.`),
      maxItems: z.number().int().min(1).max(FLAT_TREE_PAGE_MAX).optional().default(FLAT_TREE_PAGE_MAX).describe(
        `Page size (1–${FLAT_TREE_PAGE_MAX}, default ${FLAT_TREE_PAGE_MAX}).`),
      skipCount: z.number().int().min(0).max(FLAT_TREE_SKIP_MAX).optional().default(0).describe(
        'Offset into the list — take it from `more.nextSkipCount`. The list keeps its order between calls as long as the tree is not '
        + 'changed and no call is `incomplete` (a branch that answers on one call and not on the next shifts every later position).'),
      includeContentCounts: z.boolean().optional().default(false).describe(
        'When true, each item of the page carries `contentCount` (its direct contents) — one extra call per item.'),
      outputFormat: z.enum(['markdown', 'json']).optional().default('markdown'),
    },
    outputSchema: collectionTreeListSchema,
    annotations: { readOnlyHint: true },
    handler: withCollectionByName({
      idParam: 'nodeId', disciplineParam: 'discipline', missing: 'Bitte nodeId oder collection angeben.',
    }, async (params) => {
      try {
        const tree = await listCollectionTree({
          rootId: String(params.nodeId).trim(),
          depth: params.depth ?? FLAT_TREE_DEPTH_MAX,
          maxItems: params.maxItems ?? FLAT_TREE_PAGE_MAX,
          skipCount: params.skipCount ?? 0,
          includeContentCounts: params.includeContentCounts ?? false,
        });
        const notices = [
          ...(tree.incomplete ? [TREE_INCOMPLETE_NOTICE] : []),
          ...(tree.restricted ? [RESTRICTED_NOTICE] : []),
          ...(tree.walkCapped ? [TREE_CAPPED_NOTICE] : []),
        ];
        if (params.outputFormat === 'json') {
          // Block 0 is the payload; prose inside it breaks every parser.
          return {
            content: [{ type: 'text' as const, text: JSON.stringify(tree) }, ...notices.map(text => ({ type: 'text' as const, text }))],
            structuredContent: tree,
          };
        }
        return { content: [{ type: 'text' as const, text: render(tree, notices) }], structuredContent: tree };
      } catch (err) {
        if (err instanceof NotACollectionError) return codedErrorResult('not_a_collection', oneLine(err.message));
        return toolError('Fehler beim Lesen des Sammlungsbaums', err);
      }
    }),
  });
}

/** One line per collection: what the server knows first, the titles last and quoted. */
function render(tree: FlatTree, notices: string[]): string {
  const range = tree.count ? `Einträge ${tree.skipCount + 1}–${tree.skipCount + tree.count}` : 'keine Einträge';
  const head = `Sammlungsbaum unter ${nodeIdLine(tree.root.nodeId)} (bis Tiefe ${tree.depth}): ${range} — ${quotedTitle(tree.root.title)}`;
  // The server's own sentences BEFORE the repository's titles.
  const lines: string[] = [oneLine(head), ...notices];
  if (tree.more) {
    lines.push(`Es gibt weitere Einträge — nächste Seite mit skipCount=${tree.more.nextSkipCount}.`);
  } else if (!tree.count && !notices.length) {
    lines.push(tree.skipCount ? 'Ab dieser Position gibt es keine weiteren Untersammlungen.' : 'Diese Sammlung hat keine Untersammlungen.');
  }
  for (const item of tree.items) {
    const count = item.contentCount !== undefined ? ` [${item.contentCount} Inhalte]`
      : item.contentsRefused ? ' [Inhalte mit dieser Anmeldung nicht lesbar]'
        : item.contentsUnread ? ' [Inhalte ließen sich gerade nicht lesen]' : '';
    const children = item.childrenRefused ? ' [Unterthemen mit dieser Anmeldung nicht lesbar]'
      : item.childrenUnread ? ' [Unterthemen ließen sich gerade nicht lesen]' : '';
    lines.push(oneLine(`- ${nodeIdLine(item.nodeId)} [Ebene ${item.depth}]${count}${children} — ${item.path.map(t => quotedTitle(t)).join(' › ')}`));
  }
  return lines.join('\n');
}
