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
  findExisting, flattenTree, treeStep, type OnExisting, type TreeInput, type TreeItem,
} from '../services/write/collection-tree.js';
import {
  PLAN_BUDGET_MS, findPlan, hasPlanCapacity, runPlan, startPlan, type ItemState, type StoredPlan,
} from '../services/write/plan-runner.js';
import { flattenText, sanitizeText } from '../text-sanitize.js';
import type { WloToolResult } from '../apps/register.js';
import {
  codedError, confirmOrExplain, previewReply, rejectionReply, timeoutOrError, isPreviewCall, type WriteAuthChallenge,
  registerCurationTool,
} from './curation-shared.js';
import { planErrorReply, planReply } from './curation-plan-reply.js';

const KIND = 'collection-tree';
const MAX_CHILDREN = 15;

// Depth 4 spelled out level by level: a recursive schema has no depth bound a
// client can see. `strict` on the innermost level makes a fifth level an error
// instead of being stripped in silence.
const node = { title: z.string().min(1).max(200), description: z.string().max(2000).optional() };
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
    return `${item.key}: vorhanden (${existingId}), wird übernommen`
      + (item.description ? ' — die angegebene Beschreibung wird dort nicht gesetzt' : '');
  }
  return `${item.key}: anlegen${item.description ? ` — Beschreibung: „${flattenText(item.description)}“` : ''}`;
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
Grenzen: höchstens ${MAX_CHILDREN} Kinder je Knoten, Tiefe 4, 250 Knoten. Antwort: nodes [{path, nodeId, status, code}], Pfad = Titel mit „/“.`,
    inputSchema: {
      parentCollectionId: z.string().min(1).max(200).describe('Bestehende Sammlung, unter der der Baum entsteht.'),
      tree: z.array(level1).min(1).max(MAX_CHILDREN).describe('Knoten {title, description?, children?}, bis Tiefe 4.'),
      onExisting: z.enum(['merge', 'fail']).optional().default('merge'),
      confirmToken: z.string().max(200).optional(),
      continuationToken: z.string().max(200).optional(),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    handler: async (params) => {
      // What is LEFT of this call's budget after the reads (rule 3 of plan 2026-11-08):
      // a confirmation that read 200 records must not add a full 40 s on top.
      const started = Date.now();
      const remaining = () => Math.max(0, PLAN_BUDGET_MS - (Date.now() - started));
      requireWrite();
      const parentId = String(params['parentCollectionId']).trim();
      const onExisting = (params['onExisting'] ?? 'merge') as OnExisting;
      const flat = flattenTree(params['tree'] as TreeInput[]);
      if (!flat.ok) return rejectionReply(flat.reasons);
      const items = flat.items;
      // Everything the plan was built from — a key presented with other
      // arguments is not this plan.
      const args = JSON.stringify([parentId, onExisting, items.map(i => [i.key, i.description ?? ''])]);
      const step = (plan: StoredPlan<TreeItem>) => treeStep(parentId, plan, onExisting);

      const key = String(params['continuationToken'] ?? '') || String(params['confirmToken'] ?? '');
      if (key) {
        const found = findPlan<TreeItem>(KIND, key, args);
        if (found && !found.ok) return planErrorReply(found.code);
        if (found) return answer(found.plan, await runPlan(found.plan, step(found.plan), remaining()), parentId);
        if (params['continuationToken']) return planErrorReply('plan_expired');
      }

      try {
        const target = await readFilingTarget(parentId);
        if (!target.ok) {
          return target.reason === 'not_found'
            ? codedError('not_found', `Die Elternsammlung ${parentId} wurde nicht gefunden.`)
            : codedError('not_a_collection', `${parentId} ist keine Sammlung.`);
        }
        const walk = await findExisting(parentId, items);
        if (!walk.ok) {
          return codedError('not_checked', `Die Unterordner von ${walk.unreadable} ließen sich nicht lesen. Ohne diesen Blick kann `
            + '„anlegen“ eine Dublette sein — es wurde nichts geändert. Bitte später erneut versuchen.');
        }
        if (onExisting === 'fail' && walk.existing.size) {
          return rejectionReply([...walk.existing].map(([path, id]) =>
            `„${path}“ gibt es schon (${id}). Mit onExisting: merge wird sie übernommen.`));
        }
        const created = items.filter(i => !walk.existing.has(i.key)).length;
        const cs = buildChangeSet(parentId, 'collection', {}, {}, {
          action: `Legt unter „${sanitizeText(target.target.title)}“ (${parentId}) ${created} Sammlungen an; `
            + `${items.length - created} vorhandene werden übernommen:`,
          items: items.map(i => stepLine(i, walk.existing.get(i.key))),
        });
        const token = String(params['confirmToken'] ?? '');
        if (!token) return previewReply(cs, 'Zum Anlegen bitte bestätigen.');
        // A second call with the same key may have started the plan while this
        // one was reading; without this look it reaches the spent key, answers
        // `confirm_unknown` and asks for a new preview — whose confirmation would
        // run the plan a second time (overall review W1–W4, 2026-11-08).
        const running = findPlan<TreeItem>(KIND, token, args);
        if (running && !running.ok) return planErrorReply(running.code);
        if (running) return answer(running.plan, await runPlan(running.plan, step(running.plan), remaining()), parentId);
        // Checked BEFORE the key is redeemed: refused here, it stays valid.
        if (!hasPlanCapacity()) return planErrorReply('too_many_plans');
        const refusal = confirmOrExplain(token, cs);
        if (refusal) return refusal;

        const initial = new Map<string, ItemState>(
          [...walk.existing].map(([path, nodeId]) => [path, { status: 'existing', nodeId }]),
        );
        const planId = startPlan(KIND, args, items, initial, token);
        const plan = findPlan<TreeItem>(KIND, planId, args);
        if (!plan?.ok) return planErrorReply('plan_expired');
        return answer(plan.plan, await runPlan(plan.plan, step(plan.plan), remaining()), parentId);
      } catch (err) {
        return timeoutOrError('Fehler beim Anlegen des Sammlungsbaums', err,
          'Ob schon Sammlungen angelegt wurden', { preview: isPreviewCall(params) });
      }
    },
  });
}
