/**
 * tools/curation-tree.ts – wlo_create_collection_tree (BOERDi wishlist item 6,
 * decision E4 = B, 2026-11-06).
 *
 * One approval for a whole tree. The preview names every node and what will
 * happen to it, and the key binds to exactly those lines (`ChangeSet.items`).
 * Execution is time-budgeted (`plan-runner.ts`); an unfinished plan hands back a
 * continuation key, and either key may be presented again by the same identity:
 * it continues or replays the result, never creates twice. The rules of the
 * plan, the walk and the step live in `services/write/collection-tree.ts`.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { buildChangeSet } from '../services/write/change-set.js';
import { requireWrite } from '../services/write/credential-gate.js';
import { readFilingTarget } from '../services/write/create-filing.js';
import {
  findExisting, flattenTree, treeStep, type OnExisting, type TreeInput, type TreeItem, type TreeMetadata,
} from '../services/write/collection-tree.js';
import { displayValue } from '../services/write/change-set.js';
import { WRITABLE_FIELDS } from '../services/write/fields.js';
import { MAX_KEYWORDS } from './curation-fields.js';
import { runPlan, type ItemState, type StoredPlan } from '../services/write/plan-runner.js';
import { flattenText, sanitizeText } from '../text-sanitize.js';
import type { WloToolResult } from '../apps/register.js';
import {
  codedError, previewReply, rejectionReply, type WriteAuthChallenge, registerCurationTool,
} from './curation-shared.js';
import { planReply } from './curation-plan-reply.js';
import { canonicalArgs, runPlannedCall } from './curation-plan.js';

const KIND = 'collection-tree';
const MAX_CHILDREN = 15;

// Depth 4 spelled out level by level: a recursive schema has no depth bound a
// client can see. `strict` on the innermost level makes a fifth level an error
// instead of being stripped in silence.
// Subject, level and keywords per node (S3, 2026-11-14): one approval instead
// of a second call once the ids are back. Lists are bounded in the schema.
const labels = z.union([z.string().min(1).max(200), z.array(z.string().min(1).max(200)).max(20)]).optional();
const metadata = {
  discipline: labels.describe('Fach als Label oder Liste, z. B. "Physik" — nur Name, Alias oder URI, kein Teilwort.'),
  educationalContext: labels.describe('Bildungsstufe als Label oder Liste, z. B. "Sekundarstufe I".'),
  keywords: z.array(z.string().min(1).max(200)).max(MAX_KEYWORDS).optional().describe('Schlagwörter.'),
};
const node = { title: z.string().min(1).max(200), description: z.string().max(2000).optional(), ...metadata };
const level4 = z.object(node).strict();
const level3 = z.object({ ...node, children: z.array(level4).max(MAX_CHILDREN).optional() }).strict();
const level2 = z.object({ ...node, children: z.array(level3).max(MAX_CHILDREN).optional() }).strict();
const level1 = z.object({ ...node, children: z.array(level2).max(MAX_CHILDREN).optional() }).strict();

const STATUS_LABEL: Record<string, string> = {
  created: 'angelegt', existing: 'war schon vorhanden', unverified: 'angelegt, aber nicht vollständig bestätigt',
  failed: 'nicht angelegt', pending: 'offen',
};
const CODE_LABEL: Record<string, string> = {
  parent_failed: 'Elternsammlung fehlt', exists: 'gibt es schon', timeout: 'Antwort kam nicht rechtzeitig',
  not_checked: 'Unterordner nicht lesbar', forbidden: 'keine Berechtigung',
  order_not_set: 'die Reihenfolge dieser Ebene ließ sich nicht setzen',
};
const label = (s: ItemState) =>
  `${STATUS_LABEL[s.status] ?? s.status}${s.code ? ` — ${CODE_LABEL[s.code] ?? s.code}` : ''}`;

function answer(plan: StoredPlan<TreeItem>, report: Awaited<ReturnType<typeof runPlan>>, parentId: string): WloToolResult {
  return planReply(
    `Sammlungsbaum unter ${parentId}:`, report, plan.expiresAt,
    plan.items.map(i => ({ id: { path: i.key }, text: i.key, state: plan.state.get(i.key)! })), label,
  );
}

/**
 * One preview line — part of what the token binds to, so the description goes
 * in WHOLE (`flattenText`, never the capping `sanitizeText`): two descriptions
 * sharing their first 120 characters would otherwise share a key.
 */
function stepLine(item: TreeItem, existingId: string | undefined): string {
  if (existingId) {
    // An existing collection is taken as it is: nothing of this node is written there.
    const unset = [...(item.description ? ['Beschreibung'] : []), ...Object.keys(item.extra ?? {}).map(labelOf)];
    return `${item.key}: vorhanden (${existingId}), wird übernommen`
      + (unset.length ? ` — bleibt unverändert, dort NICHT gesetzt: ${unset.join(', ')}` : '');
  }
  return `${item.key}: anlegen${item.description ? ` — Beschreibung: „${flattenText(item.description)}“` : ''}${extraText(item)}`;
}

const labelOf = (property: string) => WRITABLE_FIELDS[property]?.label ?? property;

/** The metadata of one node as a person can check it: labels, not URIs — and all of it, because it is what is sent. */
function extraText(item: TreeItem): string {
  return Object.entries(item.extra ?? {})
    .map(([property, values]) => ` — ${labelOf(property)}: ${values.map(v => `„${flattenText(displayValue(property, v))}“`).join(', ')}`)
    .join('');
}

export function registerCurationTreeTools(server: McpServer, challenge: WriteAuthChallenge): void {
  registerCurationTool(server, challenge, {
    replay: false, // the key continues a stored plan (plan-runner.ts)
    name: 'wlo_create_collection_tree',
    title: 'WLO Sammlungsbaum anlegen',
    description: `Lege einen ganzen Baum von Untersammlungen unter einer bestehenden Sammlung an — mit EINER Bestätigung.
Ohne Schlüssel: Vorschau, die jeden Knoten mit Aktion nennt (anlegen / vorhanden). Mit confirmToken: der Plan läuft, bis zu ~40 s je Aufruf. Ist er nicht fertig, kommt complete: false mit continuationToken — derselbe Aufruf mit diesem Schlüssel setzt fort, ohne neue Bestätigung (30 min ab Bestätigung).
Ein Schlüssel darf erneut vorgelegt werden (z. B. nach einem Abbruch): er setzt fort oder liefert dasselbe Ergebnis, legt nie doppelt an.
onExisting: merge (Vorgabe) übernimmt eine vorhandene Untersammlung gleichen Titels (Groß/Klein und Leerzeichen egal); fail verweigert.
Je Knoten optional discipline, educationalContext, keywords; \`shared\` setzt sie für den ganzen Baum, ein eigener Wert des Knotens ERSETZT ihn. Eine übernommene Sammlung bleibt unverändert.
Grenzen: höchstens ${MAX_CHILDREN} Kinder je Knoten, Tiefe 4, 250 Knoten. Antwort: nodes [{path, nodeId, status, code}], Pfad = Titel mit „/“.`,
    inputSchema: {
      parentCollectionId: z.string().min(1).max(200).describe('Bestehende Sammlung, unter der der Baum entsteht.'),
      tree: z.array(level1).min(1).max(MAX_CHILDREN).describe('Knoten {title, description?, discipline?, educationalContext?, keywords?, children?}, bis Tiefe 4.'),
      shared: z.object(metadata).strict().optional().describe(
        'Gemeinsame Werte für JEDEN neuen Knoten des Baums. Ein Knoten, der dasselbe Feld selbst nennt, ersetzt den gemeinsamen Wert (eine leere Liste schaltet ihn dort ab).'),
      onExisting: z.enum(['merge', 'fail']).optional().default('merge'),
      confirmToken: z.string().max(200).optional(),
      continuationToken: z.string().max(200).optional(),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    handler: async (params) => {
      requireWrite();
      const parentId = String(params['parentCollectionId']).trim();
      const onExisting = (params['onExisting'] ?? 'merge') as OnExisting;
      const flat = flattenTree(params['tree'] as TreeInput[], (params['shared'] ?? {}) as TreeMetadata);
      if (!flat.ok) return rejectionReply(flat.reasons, flat.candidates.length ? { candidates: flat.candidates } : {});
      const items = flat.items;
      return runPlannedCall<TreeItem>({
        kind: KIND, params,
        // Everything the plan was built from — a key presented with other
        // arguments is not this plan.
        args: canonicalArgs([parentId, onExisting, items.map(i => [i.key, i.description ?? '', i.extra ?? {}])]),
        step: (plan) => treeStep(parentId, plan, onExisting),
        answer: (plan, report) => answer(plan, report, parentId),
        prepare: async () => {
          const target = await readFilingTarget(parentId);
          if (!target.ok) {
            return { reply: target.reason === 'not_found'
              ? codedError('not_found', `Die Elternsammlung ${parentId} wurde nicht gefunden.`)
              : codedError('not_a_collection', `${parentId} ist keine Sammlung.`) };
          }
          const walk = await findExisting(parentId, items);
          if (!walk.ok) {
            return { reply: codedError('not_checked', `Die Unterordner von ${walk.unreadable} ließen sich nicht lesen. Ohne diesen Blick kann `
              + '„anlegen“ eine Dublette sein — es wurde nichts geändert. Bitte später erneut versuchen.') };
          }
          if (onExisting === 'fail' && walk.existing.size) {
            return { reply: rejectionReply([...walk.existing].map(([path, id]) =>
              `„${path}“ gibt es schon (${id}). Mit onExisting: merge wird sie übernommen.`)) };
          }
          const created = items.filter(i => !walk.existing.has(i.key)).length;
          const cs = buildChangeSet(parentId, 'collection', {}, {}, {
            action: `Legt unter „${sanitizeText(target.target.title)}“ (${parentId}) ${created} Sammlungen an; `
              + `${items.length - created} vorhandene werden übernommen. Neue Untersammlungen stehen danach in der hier genannten `
              + 'Reihenfolge hinter den schon vorhandenen ihrer Elternsammlung:',
            items: items.map(i => stepLine(i, walk.existing.get(i.key))),
          });
          const initial = new Map<string, ItemState>(
            [...walk.existing].map(([path, nodeId]) => [path, { status: 'existing', nodeId }]),
          );
          return { draft: { cs, items, initial, preview: () => previewReply(cs, 'Zum Anlegen bitte bestätigen.') } };
        },
        context: 'Fehler beim Anlegen des Sammlungsbaums',
        whatIsOpen: 'Ob schon Sammlungen angelegt wurden',
      });
    },
  });
}
