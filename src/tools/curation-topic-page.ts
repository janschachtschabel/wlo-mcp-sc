/**
 * tools/curation-topic-page.ts – choosing which variant a Themenseite renders.
 *
 * The only curation tool whose result is immediately public: the change decides
 * what a visitor of the WLO topic page sees. Everything that makes that safe
 * lives in `services/write/topic-page.ts`; this module owns the conversation.
 *
 * One deviation from the other twelve, and it is deliberate. The confirmation
 * token is bound to a SENTENCE, not to the property value: the value is a
 * page-builder document of store refs, unreadable in a preview, and what a
 * person actually approves is "this page renders variant B instead of A". The
 * sentence names the page and both variants WITH their ids, so any upstream
 * change that would alter the outcome — a different variant active, the target
 * gone — re-plans to a different sentence and the token stops matching. What it
 * deliberately does not bind is the rest of the document: those keys belong to
 * the page builder, are carried through untouched, and the current value is the
 * right one to preserve at write time, not the one read minutes earlier.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { requireWrite } from '../services/write/credential-gate.js';
import { buildChangeSet } from '../services/write/change-set.js';
import { planRenderedVariant, writeRenderedVariant } from '../services/write/topic-page.js';
import { sanitizeText } from '../text-sanitize.js';
import {
  registerCurationTool,
  type WriteAuthChallenge,
  previewReply,
  confirmOrExplain,
  reportMutation,
  errorText,
  timeoutOrError,
} from './curation-shared.js';

export function registerCurationTopicPageTool(server: McpServer, challenge: WriteAuthChallenge): void {
  registerCurationTool(server, challenge, {
    name: 'wlo_set_topic_page',
    title: 'WLO Themenseiten-Variante festlegen',
    description:
      'Lege fest, WELCHE VARIANTE eine WLO-Themenseite öffentlich rendert. Eine Themenseite kann mehrere ' +
      'Varianten haben (z. B. für verschiedene Zielgruppen); dieses Werkzeug bestimmt die aktive. Die ' +
      'Variantenliste selbst wird nicht verändert — es werden keine Varianten angelegt, gelöscht oder ' +
      'umsortiert. Die passenden variantId-Werte liefert get_topic_page_content bzw. ' +
      'search_wlo_topic_pages. ACHTUNG: Die Änderung ist sofort öffentlich sichtbar. ZWEISTUFIG: ohne ' +
      'confirmToken nur Vorschau, es wird nichts geschrieben. Danach wird zurückgelesen und berichtet, ob ' +
      'die Seite die Variante wirklich rendert. Erfordert eine Anmeldung.',
    inputSchema: {
      collectionId: z.string().describe('nodeId der Sammlung, zu der die Themenseite gehört.'),
      variantId: z.string().describe('nodeId der Variante, die künftig gerendert werden soll.'),
      confirmToken: z.string().optional()
        .describe('Bestätigungsschlüssel aus der Vorschau. Ohne ihn wird ausschließlich die Vorschau erzeugt.'),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    handler: async (params: Record<string, unknown>) => {
      const collectionId = String(params['collectionId'] ?? '');
      const variantId = String(params['variantId'] ?? '');
      try {
        requireWrite();

        const planned = await planRenderedVariant(collectionId, variantId);
        if (!planned.ok) return errorText(planned.reason);
        const plan = planned.plan;

        const cs = buildChangeSet(plan.folderId, 'topic-page', {}, {}, { action: describe(plan) });
        const token = typeof params['confirmToken'] === 'string' ? params['confirmToken'] : '';
        if (!token) return previewReply(cs, 'Zum Umstellen bitte bestätigen.');

        const refusal = confirmOrExplain(token, cs);
        if (refusal) return refusal;

        return reportMutation(
          await writeRenderedVariant(plan),
          `Die Themenseite „${plan.pageTitle}“ rendert jetzt „${plan.variantTitle}“.`,
          'Die Variante konnte nicht umgestellt werden',
        );
      } catch (err) {
        return timeoutOrError('Die Themenseiten-Variante konnte nicht umgestellt werden', err,
          `Ob „${sanitizeText(collectionId)}“ jetzt eine andere Variante rendert, ist offen`);
      }
    },
  });
}

/** The sentence the token is bound to — see the module note on why it is this one. */
function describe(plan: {
  pageTitle: string; collectionId: string;
  currentTitle: string; currentIsByPosition: boolean;
  variantTitle: string; variantId: string;
}): string {
  const current = plan.currentIsByPosition
    ? `„${plan.currentTitle}“ (bisher ist keine Variante festgelegt; gerendert wird die erste der Liste)`
    : `„${plan.currentTitle}“`;
  return (
    `Themenseite „${plan.pageTitle}“ (${plan.collectionId}): rendert künftig ` +
    `„${plan.variantTitle}“ (${plan.variantId}) statt ${current}. ` +
    'Die Variantenliste bleibt unverändert. Die Umstellung ist sofort öffentlich sichtbar.'
  );
}
