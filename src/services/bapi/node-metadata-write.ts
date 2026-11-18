/**
 * services/bapi/node-metadata-write.ts – what is checked before the flow
 * `edusharing.chatbot/node-metadata-write` may be offered for approval.
 *
 * The flow REPLACES title, description, keywords, language, subject, level,
 * audience and resource type of every node it is given, each change a new
 * version (its own description, read 2026-11-17). So the preview states that,
 * and the ids are checked first, as the person who asks:
 *
 *   - 1–50 ids, none twice (the chatbot splits larger sets);
 *   - each a record (`ccm:io`) — not a collection, not a folder;
 *   - not a reference inside a collection: the flow would write onto the copy,
 *     the original stays as it was (the rule "metadata goes to the original",
 *     which a flow that takes ids cannot follow — so the id is refused);
 *   - writable for the person (`access` names `Write`).
 *
 * A read that did not answer is not a "no": such an id is reported as
 * unchecked, and the whole set is `upstream_error`, worth trying again.
 */

import { mapPool } from '../../concurrency.js';
import { isCollectionNode, isContentNode } from '../../node-kind.js';
import { readNodeMetadata } from '../../wlo-node.js';
import { titleFromProperties } from '../../node-match.js';
import { sanitizeText } from '../../text-sanitize.js';

export const NODE_METADATA_WRITE = 'edusharing.chatbot/node-metadata-write';
export const MAX_NODES = 50;
export const LANGUAGES = ['de', 'en'] as const;

export type NodeProblem = 'not_found' | 'not_readable' | 'not_a_record' | 'is_reference' | 'not_writable' | 'unchecked';
export interface CheckedNode { nodeId: string; title: string }

export type NodeCheck =
  | { ok: true; nodes: CheckedNode[]; language: 'de' | 'en' }
  | { ok: false; reason: 'bad_inputs' | 'upstream_error'; problems: Array<{ nodeId: string; problem: NodeProblem }>; message: string };

const REFERENCE_ASPECT = 'ccm:collection_io_reference';

/** Shape of the inputs: `{node_ids: string[1..50], language?: "de"|"en"}`, nothing else. */
export function parseInputs(inputs: Record<string, unknown>):
  { ok: true; ids: string[]; language: 'de' | 'en' } | { ok: false; message: string } {
  const extra = Object.keys(inputs).filter(k => k !== 'node_ids' && k !== 'language');
  if (extra.length) return { ok: false, message: `Unbekannte Eingaben: ${extra.map(sanitizeText).join(', ')}.` };
  const raw = inputs['node_ids'];
  if (!Array.isArray(raw) || raw.some(id => typeof id !== 'string' || !/^[A-Za-z0-9-]{1,100}$/.test(id))) {
    return { ok: false, message: 'node_ids muss eine Liste von nodeIds sein.' };
  }
  const ids = raw as string[];
  if (ids.length < 1 || ids.length > MAX_NODES) return { ok: false, message: `node_ids: 1 bis ${MAX_NODES} nodeIds je Auftrag.` };
  if (new Set(ids).size !== ids.length) return { ok: false, message: 'node_ids enthält eine nodeId doppelt.' };
  const language = inputs['language'] ?? 'de';
  if (language !== 'de' && language !== 'en') return { ok: false, message: 'language: nur "de" oder "en".' };
  return { ok: true, ids, language };
}

/** Read every id as the person and say which may be handed to the flow. */
export async function checkNodes(ids: string[], language: 'de' | 'en'): Promise<NodeCheck> {
  const checked = await mapPool(ids, 6, async (nodeId) => {
    try {
      const { node, status } = await readNodeMetadata(nodeId, ['cclom:title', 'cm:name']);
      if (!node) {
        const problem: NodeProblem = status === 404 ? 'not_found' : status === 401 || status === 403 ? 'not_readable' : 'unchecked';
        return { nodeId, problem };
      }
      if (!isContentNode(node) || isCollectionNode(node)) return { nodeId, problem: 'not_a_record' as const };
      if (node.aspects?.includes(REFERENCE_ASPECT)) return { nodeId, problem: 'is_reference' as const };
      if (!Array.isArray(node.access)) return { nodeId, problem: 'unchecked' as const };
      if (!node.access.includes('Write')) return { nodeId, problem: 'not_writable' as const };
      return { nodeId, title: sanitizeText(titleFromProperties(node.properties ?? {})) || '(ohne Titel)' };
    } catch {
      return { nodeId, problem: 'unchecked' as const };
    }
  });
  // A slot without an answer (`mapPool` leaves null) is unchecked — never silently dropped.
  const problems = checked.flatMap((c, i) => (!c ? [{ nodeId: ids[i]!, problem: 'unchecked' as const }]
    : 'problem' in c && c.problem ? [{ nodeId: c.nodeId, problem: c.problem }] : []));
  if (problems.length) {
    const upstream = problems.every(p => p.problem === 'unchecked');
    return {
      ok: false, reason: upstream ? 'upstream_error' : 'bad_inputs', problems,
      message: upstream
        ? 'Die Datensätze konnten gerade nicht geprüft werden (keine Antwort des Repositorys). Es wurde nichts gestartet; bitte erneut versuchen.'
        : 'Nicht jeder Datensatz kann an den Auftrag gehen. Es wurde nichts gestartet.',
    };
  }
  const nodes = checked.flatMap(c => (c && 'title' in c && typeof c.title === 'string' ? [{ nodeId: c.nodeId, title: c.title }] : []));
  return { ok: true, nodes, language };
}

/** What the person approves, in one sentence (the preview names every record beside it). */
export function overwriteSentence(count: number): string {
  return `Überschreibt Titel, Beschreibung, Schlagworte, Fach, Bildungsstufe, Zielgruppe, Ressourcentyp und Sprache `
    + `dieser ${count === 1 ? 'eines Materials' : `${count} Materialien`} mit vom Metadaten-Agenten erzeugten Werten; `
    + 'jede Änderung legt eine neue Version an.';
}
