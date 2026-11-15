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
  FLAT_TREE_DEPTH_MAX, FLAT_TREE_LISTINGS_MAX, FLAT_TREE_PAGE_MAX, FLAT_TREE_PARENTS_NAMED_MAX, FLAT_TREE_SKIP_MAX, NotACollectionError, listCollectionTree,
  type FlatTree,
} from '../services/collection-tree-flat.js';
import { codedErrorResult, toolError } from './shared.js';
import { collectionDisciplineParam, collectionNameParam, flatTreeOrderParam, withCollectionByName } from './collection-arg.js';

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

/** Said instead of "nächste Seite" when the next page would start past the largest offset the tool takes. */
export const TREE_SKIP_LIMIT_NOTICE = `Hinweis: Die Liste geht weiter, aber skipCount reicht nur bis ${FLAT_TREE_SKIP_MAX} — die folgenden `
  + 'Einträge sind von hier aus nicht abrufbar. Für den Rest eine Untersammlung als Start nehmen (nodeId aus dieser Liste) oder depth verkleinern.';

/**
 * Follows an order-of-`position` answer's head line: which rule, and — where
 * it is known — which of its two cases held on the first level. Not over an
 * empty page, like `storedNotice`: an order of nothing says nothing.
 */
function orderNotice(tree: FlatTree): string[] {
  if (tree.count === 0) return [];
  const first = tree.root.childrenPositioned === undefined ? ''
    : tree.root.childrenPositioned ? ' Erste Ebene: in gesetzter Reihenfolge.' : ' Erste Ebene: nach Titel (keine unterscheidenden Positionen gesetzt).';
  return [`Reihenfolge: gesetzte Position, sonst Titel.${first}`];
}

/**
 * The same for `stored` (the default), which sorts nothing: only which case
 * held on the first level — never "nach Titel", which this order is not. Not
 * over an empty page: "keine Positionen" beside "keine Untersammlungen" says
 * nothing, and the empty answer stays the one it was.
 */
function storedNotice(tree: FlatTree): string[] {
  if (tree.root.childrenPositioned === undefined || tree.count === 0) return [];
  return [tree.root.childrenPositioned ? 'Erste Ebene: in gesetzter Reihenfolge.' : 'Erste Ebene: keine unterscheidenden Positionen gesetzt.'];
}

/**
 * WHERE the walk could not read, after the notice that says THAT it could not:
 * the notices keep the wording a client recognises them by, the ids stand on a
 * line of their own. An id is repository-supplied like a title — one line.
 */
function parentsNotice(lead: string, ids: string[], total: number | undefined, rootId: string): string {
  const listed = ids.map(id => `${nodeIdLine(id)}${id === rootId ? ' (Start-Sammlung)' : ''}`).join(', ');
  return oneLine(`${lead} bei: ${listed}${total ? ` (die ersten ${ids.length} von ${total})` : ''}.`);
}

export const collectionTreeListSchema = z.object({
  root: z.object({
    nodeId: z.string(), title: z.string(),
    childrenPositioned: z.boolean().optional().describe('As on an item, for the start collection\'s own sub-collections.'),
  }),
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
    childrenPositioned: z.boolean().optional().describe(
      'With order="stored" or "position": true = at least two of the item\'s sub-collections hold different set positions (they are '
      + 'in that order); false = THIS call listed them to their end and positions order nothing there ("position" then lists them by '
      + 'title, "stored" as the repository does — sort them yourself). Absent = not listed to the end, nothing known — absent also '
      + 'when there are fewer than two.'),
  })),
  more: z.object({ nextSkipCount: z.number() }).optional(),
  /** The list goes on past the largest `skipCount` this tool takes — never beside `more`. */
  skipLimitReached: z.literal(true).optional(),
  incomplete: z.literal(true).optional(),
  restricted: z.literal(true).optional(),
  walkCapped: z.literal(true).optional(),
  // Described IN the schema: the tool description has no room left for it (1024 characters).
  unreadParents: z.array(z.string()).optional().describe(
    'nodeIds of every parent whose sub-collection listing did not answer (in whole or from a later page on) in THIS call\'s walk, '
    + `in walk order — the start collection and parents on other pages included. At most ${FLAT_TREE_PARENTS_NAMED_MAX}. `
    + 'A parent the walk never asked (full page, walkCapped) is not listed.'),
  refusedParents: z.array(z.string()).optional().describe('The same for a listing the repository refused (401/403/404).'),
  unreadParentsTotal: z.number().optional().describe('How many there are — set only where unreadParents names fewer.'),
  refusedParentsTotal: z.number().optional().describe('How many there are — set only where refusedParents names fewer.'),
  resolvedCollection: resolvedCollectionSchema,
});

export function registerCollectionTreeListTool(server: McpServer): void {
  registerWloTool(server, {
    name: 'list_collection_tree',
    title: 'WLO Sammlungsbaum als Liste',
    description: `Der Teilbaum unter EINER Sammlung als flache Liste: je Untersammlung nodeId, Titel, Pfad (Titel von der Start-Sammlung abwärts), Tiefe und parentId — bis ${FLAT_TREE_DEPTH_MAX} Ebenen tief, in der Reihenfolge des Repositorys (anders mit \`order\`), Ebene für Ebene. Gedacht zum RECHNEN: einen Entwurf gegen den Bestand abgleichen, einen angelegten Baum zurücklesen, Kennungen für Folgeschritte holen. Nicht je Elternknoten gekürzt; lange Listen kommen in Seiten (\`more.nextSkipCount\` → \`skipCount\`).
Statt der nodeId geht der Titel als \`collection\` (gleichnamige: \`discipline\`). Zum Anschauen und Stöbern ist browse_collection_tree gedacht, für die Inhalte get_collection_contents.
\`incomplete\` / \`restricted\`: ein Zweig ließ sich nicht lesen bzw. ist mit dieser Anmeldung nicht lesbar (WO: \`unreadParents\` / \`refusedParents\`); \`walkCapped\`: der Lauf hat seine Obergrenze (${FLAT_TREE_LISTINGS_MAX} Abfragen) erreicht — die Liste ist dann NICHT vollständig. Eine Inhaltszahl, die fehlt, steht nur am Eintrag (\`contentsRefused\` / \`contentsUnread\`).`,
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
      order: flatTreeOrderParam,
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
          order: params.order,
        });
        // Not a caveat: it must not keep an empty list from saying that it is empty.
        const said = params.order === 'position' ? orderNotice(tree) : [];
        const notices = [
          ...(tree.incomplete ? [TREE_INCOMPLETE_NOTICE] : []),
          ...(tree.unreadParents ? [parentsNotice('Unterliste gerade nicht gelesen', tree.unreadParents, tree.unreadParentsTotal, tree.root.nodeId)] : []),
          ...(tree.restricted ? [RESTRICTED_NOTICE] : []),
          ...(tree.refusedParents ? [parentsNotice('Unterliste mit dieser Anmeldung nicht lesbar', tree.refusedParents, tree.refusedParentsTotal, tree.root.nodeId)] : []),
          ...(tree.walkCapped ? [TREE_CAPPED_NOTICE] : []),
          ...(tree.skipLimitReached ? [TREE_SKIP_LIMIT_NOTICE] : []),
        ];
        // AFTER the notices: with the default order every answer carries this
        // line, and the notices a client recognises keep the place they had.
        const after = params.order === 'position' || params.order === 'title' ? [] : storedNotice(tree);
        if (params.outputFormat === 'json') {
          // Block 0 is the payload; prose inside it breaks every parser. The
          // blocks after it are the notices ONLY: the order lines would repeat
          // `root.childrenPositioned`, which block 0 carries, and a default
          // answer would have gained a second block a client does not expect.
          return {
            content: [{ type: 'text' as const, text: JSON.stringify(tree) }, ...notices.map(text => ({ type: 'text' as const, text }))],
            structuredContent: tree,
          };
        }
        return { content: [{ type: 'text' as const, text: render(tree, notices, said, after) }], structuredContent: tree };
      } catch (err) {
        if (err instanceof NotACollectionError) return codedErrorResult('not_a_collection', oneLine(err.message));
        return toolError('Fehler beim Lesen des Sammlungsbaums', err);
      }
    }),
  });
}

/** One line per collection: what the server knows first, the titles last and quoted. */
function render(tree: FlatTree, notices: string[], said: string[], after: string[]): string {
  const range = tree.count ? `Einträge ${tree.skipCount + 1}–${tree.skipCount + tree.count}` : 'keine Einträge';
  const head = `Sammlungsbaum unter ${nodeIdLine(tree.root.nodeId)} (bis Tiefe ${tree.depth}): ${range} — ${quotedTitle(tree.root.title)}`;
  // The server's own sentences BEFORE the repository's titles.
  const lines: string[] = [oneLine(head), ...said, ...notices, ...after];
  if (tree.more) {
    // Page sizes that do not divide the largest offset: the last reachable page
    // starts INSIDE this one. Said, or the repeated rows read as a second set.
    const overlap = tree.skipCount + tree.count - tree.more.nextSkipCount;
    lines.push(overlap > 0
      ? `Es gibt weitere Einträge — nächste Seite mit skipCount=${tree.more.nextSkipCount} (weiter reicht skipCount nicht; `
        + `die ersten ${overlap} Einträge dort wiederholen das Ende dieser Seite).`
      : `Es gibt weitere Einträge — nächste Seite mit skipCount=${tree.more.nextSkipCount}.`);
  } else if (!tree.count && !notices.length) {
    lines.push(tree.skipCount ? 'Ab dieser Position gibt es keine weiteren Untersammlungen.' : 'Diese Sammlung hat keine Untersammlungen.');
  }
  for (const item of tree.items) {
    const count = item.contentCount !== undefined ? ` [${item.contentCount} Inhalte]`
      : item.contentsRefused ? ' [Inhalte mit dieser Anmeldung nicht lesbar]'
        : item.contentsUnread ? ' [Inhalte ließen sich gerade nicht lesen]' : '';
    const children = item.childrenRefused ? ' [Unterthemen mit dieser Anmeldung nicht lesbar]'
      : item.childrenUnread ? ' [Unterthemen ließen sich gerade nicht lesen]' : '';
    // `childrenPositioned` is NOT marked here: with the default order every
    // answer carries the flag, and a marker between `[Ebene n]` and ` — `
    // changed the line a client parses. It is in the data, per item.
    lines.push(oneLine(`- ${nodeIdLine(item.nodeId)} [Ebene ${item.depth}]${count}${children} — ${item.path.map(t => quotedTitle(t)).join(' › ')}`));
  }
  return lines.join('\n');
}
